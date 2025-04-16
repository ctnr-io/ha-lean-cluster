import { describe, it } from "@std/testing/bdd";
import { ContaboProvider, ContaboInstance } from "./contabo.ts";
import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { hash, randomUUID } from "node:crypto";
import { paginateFind } from "../utils.ts";

// Load SSH public key for testing
const SSH_PUBLIC_KEY = Deno.readTextFileSync("public.key");

// Generate a unique test ID with timestamp
const testId = `test=contabo-provider id=${hash('sha256', randomUUID(), 'hex').substring(0, 8)} ts=${new Date().getTime()}`;
const provider = new ContaboProvider();

// Test instance variables
let instance: ContaboInstance | undefined = undefined;

/**
 * Helper functions for timestamp-based cleanup
 */
function getTestInstanceTimestamp(testId: string): number {
  const timestampString = testId.replace(/.*ts=(\d+).*/, "$1");
  return timestampString ? parseInt(timestampString) : 0;
}

function checkTimestampIsMoreThan1MinutesAgo(testId: string): boolean {
  const timestamp = getTestInstanceTimestamp(testId);
  return timestamp < Date.now() - 60 * 1000;
}

/**
 * Cleanup old test resources
 */
async function cleanupOldResources() {
  console.info("Starting cleanup of old test resources...");
  
  // Clean up old test private networks
  const privateNetworks = await provider.listPrivateNetworks({ page: 1, name: `test=` });
  const privateNetworksToCleanUp = privateNetworks.filter((privateNetwork) =>
    checkTimestampIsMoreThan1MinutesAgo(privateNetwork.name)
  );
  
  console.info(`Found ${privateNetworksToCleanUp.length} old private networks to clean up`);
  
  for (const privateNetwork of privateNetworksToCleanUp) {
    // Unassign all instances from private network
    for (const instance of privateNetwork.instances) {
      console.info(`Unassigning instance ${instance.instanceId} from private network ${privateNetwork.privateNetworkId}`);
      await provider.unassignPrivateNetwork(privateNetwork.privateNetworkId, instance.instanceId);
    }
    
    // Delete private network
    console.info(`Deleting private network ${privateNetwork.privateNetworkId}`);
    await provider.deletePrivateNetwork(privateNetwork.privateNetworkId);
  }

  // Clean up old test instances
  console.info("Cleaning up old test instances...");
  for (let page = 1; page < Infinity; page++) {
    const instances = await provider.listInstances({ page });
    if (instances.length === 0) {
      break;
    }
    
    const instancesToCleanUp = instances
      .filter((instance) => instance.displayName.startsWith("test="))
      .filter((instance) => checkTimestampIsMoreThan1MinutesAgo(instance.displayName));
    
    console.info(`Found ${instancesToCleanUp.length} old instances to clean up on page ${page}`);
    
    for (const instance of instancesToCleanUp) {
      console.info(`Resetting instance ${instance.instanceId}`);
      await provider.setInstanceDisplayName(instance.instanceId, "");
      await provider.stopInstance(instance.instanceId);
    }
  }

  // Clean up old test secrets
  const secrets = await provider.listSecrets({ page: 1, name: `test=` });
  const secretsToCleanUp = secrets.filter((secret) => checkTimestampIsMoreThan1MinutesAgo(secret.name));
  
  console.info(`Found ${secretsToCleanUp.length} old secrets to clean up`);
  
  for (const secret of secretsToCleanUp) {
    console.info(`Deleting secret ${secret.secretId}`);
    await provider.deleteSecret(secret.secretId);
  }
  
  console.info("Old resource cleanup completed");
}

/**
 * Cleanup current test resources
 */
async function cleanupCurrentResources() {
  console.info("Cleaning up current test resources...");
  
  // Clean up test instance
  const instanceId = instance?.instanceId;
  if (instanceId) {
    console.info(`Resetting instance ${instanceId}`);
    await provider.setInstanceDisplayName(instanceId, "");
    await provider.stopInstance(instanceId);
  }
  
  // Clean up test private networks
  const privateNetworks = await provider.listPrivateNetworks({ name: testId });
  console.info(`Found ${privateNetworks.length} private networks to clean up`);
  
  for (const privateNetwork of privateNetworks) {
    console.info(`Deleting private network ${privateNetwork.privateNetworkId}`);
    await provider.deletePrivateNetwork(privateNetwork.privateNetworkId);
  }
  
  // Clean up test secrets
  const secrets = await provider.listSecrets({ type: "ssh", name: testId });
  console.info(`Found ${secrets.length} secrets to clean up`);
  
  for (const secret of secrets) {
    console.info(`Deleting secret ${secret.secretId}`);
    await provider.deleteSecret(secret.secretId);
  }
  
  console.info("Current test resource cleanup completed");
}

describe(
  `Contabo Cloud Provider: testId=${testId}`,
  {
    beforeAll: cleanupOldResources,
    afterAll: cleanupCurrentResources,
    sanitizeExit: true,
    sanitizeOps: true,
    sanitizeResources: true,
  },
  () => {
    it("should list, and get instances", async () => {
      // List instances and get first one
      console.info("Listing existing instances");
      const instances = await provider.listInstances({ page: 1 });
      console.info(`Found ${instances.length} instances`);
      
      if (instances.length > 0) {
        const firstInstance = await provider.getInstance(instances[0].instanceId);
        assertEquals(firstInstance.instanceId, instances[0].instanceId);
        console.info(`Successfully retrieved instance ${firstInstance.instanceId}`);
      }

      // Find instance without display name
      const instanceWithoutDisplayName = await paginateFind({
        request: (options) => provider.listInstances(options),
        condition: (instance) => instance.displayName === "",
      });
      assertExists(instanceWithoutDisplayName);

      // Create test instance
      // Warning: We does not create a new instance because contabo is monthly subscription
      console.info("Creating test instance");
      await provider.setInstanceDisplayName(instanceWithoutDisplayName.instanceId, testId);

      // Verify instance was created
      instance = await provider.getInstance(instanceWithoutDisplayName.instanceId);
      assertStringIncludes(instance.displayName, "test=");
      console.info(`Successfully created instance ${instance.instanceId}`);
    });

    it("should create, get, and delete secrets", async () => {
      let secretId: number | undefined = undefined;
      
      try {
        // Create secret
        console.info("Creating test SSH secret");
        secretId = await provider.createSecret({ 
          type: "ssh", 
          name: testId, 
          value: SSH_PUBLIC_KEY 
        });
        
        // List secrets and verify
        const secrets = await provider.listSecrets({ type: "ssh", name: testId });
        const secret = secrets[0];
        assertEquals(secret.secretId, secretId);
        console.info(`Successfully created secret ${secretId}`);
        
        // Get secret and verify
        const retrievedSecret = await provider.getSecret(secretId);
        assertEquals(retrievedSecret.name, testId);
        console.info(`Successfully retrieved secret ${secretId}`);
      } finally {
        // Clean up secret
        if (secretId !== undefined) {
          console.info(`Deleting secret ${secretId}`);
          await provider.deleteSecret(secretId).catch((error) => {
            console.error(`Failed to delete secret ${secretId}:`, error);
          });
        }
      }
    });

    it("should create, get, and delete private networks", async () => {
      let privateNetworkId: number | undefined = undefined;
      
      try {
        // Create private network
        console.info("Creating test private network");
        privateNetworkId = await provider.createPrivateNetwork({ 
          name: testId, 
          region: "EU" 
        });
        
        // List private networks and verify
        const privateNetworks = await provider.listPrivateNetworks({ name: testId });
        const privateNetwork = privateNetworks[0];
        assertEquals(privateNetwork.privateNetworkId, privateNetworkId);
        console.info(`Successfully created private network ${privateNetworkId}`);
        
        // Get private network and verify
        const retrievedNetwork = await provider.getPrivateNetwork(privateNetworkId);
        assertEquals(retrievedNetwork.name, testId);
        console.info(`Successfully retrieved private network ${privateNetworkId}`);
      } finally {
        // Clean up private network
        if (privateNetworkId !== undefined) {
          console.info(`Deleting private network ${privateNetworkId}`);
          await provider.deletePrivateNetwork(privateNetworkId).catch((error) => {
            console.error(`Failed to delete private network ${privateNetworkId}:`, error);
          });
        }
      }
    });

    it("should assign secret and private network to instance", async () => {
      let secretId: number | undefined = undefined;
      let privateNetworkId: number | undefined = undefined;
      
      try {
        // Verify instance exists
        if (!instance) {
          throw new Error("Instance is not created");
        }
        
        // Check if private network addon is enabled
        if (!instance.addOns.some((addOn) => addOn.id === 1477)) {
          console.info("Private network addon is not enabled on instance, enabling it");
          await provider.upgradeInstance({
            instanceId: instance.instanceId,
            privateNetwork: true,
          });
        }
        
        // Create private network
        console.info("Creating private network for assignment test");
        privateNetworkId = await provider.createPrivateNetwork({ 
          name: testId, 
          region: "EU" 
        });
        let privateNetwork = await provider.getPrivateNetwork(privateNetworkId);
        
        // Create SSH secret
        console.info("Creating SSH secret for assignment test");
        secretId = await provider.createSecret({ 
          type: "ssh", 
          name: testId, 
          value: SSH_PUBLIC_KEY 
        });
        const secret = await provider.getSecret(secretId);

        // Assign private network to instance
        console.info(`Assigning private network ${privateNetworkId} to instance ${instance.instanceId}`);
        await provider.assignPrivateNetwork(privateNetwork.privateNetworkId, instance.instanceId);
        
        // Reinstall instance with SSH key
        console.info(`Reinstalling instance ${instance.instanceId} with SSH key ${secretId}`);
        await provider.reinstallInstance({
          instanceId: instance.instanceId,
          sshKeys: [secret.secretId],
          imageId: ContaboProvider.Ubuntu_24_04_ImageId,
        });

        // Verify private network assignment
        privateNetwork = await provider.getPrivateNetwork(privateNetworkId);
        const instanceInPrivateNetwork = privateNetwork.instances.find(
          (inst) => inst.instanceId === instance?.instanceId
        );
        assertExists(instanceInPrivateNetwork);
        console.info("Successfully verified private network assignment");

        // Verify private network configuration on instance
        const [ipGateway, netmask] = privateNetwork.cidr.split("/");
        const privateIp = instanceInPrivateNetwork.privateIpConfig.v4.find((ip) => ip.gateway === ipGateway);
        assertExists(privateIp);
        
        // Verify via SSH that the network interface is configured
        // const [stdout] = await executeSSH(instance.ipv4, `ip a`);
        // assertStringIncludes(stdout, `inet ${privateIp?.ip}/${netmask}`);
        // console.info("Successfully verified private network configuration on instance");
      } finally {
        // Clean up resources
        if (privateNetworkId !== undefined && instance?.instanceId !== undefined) {
          console.info(`Unassigning private network ${privateNetworkId} from instance ${instance.instanceId}`);
          await provider.unassignPrivateNetwork(privateNetworkId, instance.instanceId).catch(() => {});
        }
        
        if (privateNetworkId !== undefined) {
          console.info(`Deleting private network ${privateNetworkId}`);
          await provider.deletePrivateNetwork(privateNetworkId).catch(() => {});
        }
        
        if (secretId !== undefined) {
          console.info(`Deleting secret ${secretId}`);
          await provider.deleteSecret(secretId).catch(() => {});
        }
      }
    });
  }
);
