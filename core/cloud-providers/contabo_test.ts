import { describe, it } from "@std/testing/bdd";
import { ContaboPrivateNetwork, ContaboProvider, ContaboSecret, ContaboInstance } from "./contabo.ts";
import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { randomUUID } from "node:crypto";
import { executeSSH } from "../utils.ts";

const SSH_PUBLIC_KEY = Deno.readTextFileSync("public.key");

const testId = `test_${randomUUID()}_${new Date().getTime()}`;
const provider = new ContaboProvider();

function getTestInstanceTimestamp(testId: string): number {
  const timestampString = testId.split("_")[2];
  return timestampString ? parseInt(timestampString) : 0;
}
function checkTimestampIsMoreThan1MinutesAgo(testId: string): boolean {
  const timestamp = getTestInstanceTimestamp(testId);
  return timestamp < Date.now() - 60 * 1000;
}

let instanceId: number | undefined = undefined;
let instance: ContaboInstance | undefined = undefined;

describe(
  "Contabo Cloud Provider: testId=" + testId,
  {
    beforeAll: async () => {
      // clean up all test private networks with timestamp > 5 minutes
      const privateNetworks = await provider.listPrivateNetworks({ page: 1, name: `test_` });
      const privateNetworkToCleanUp = privateNetworks.filter((privateNetwork) =>
        checkTimestampIsMoreThan1MinutesAgo(privateNetwork.name)
      );
      await Promise.all(
        privateNetworkToCleanUp.map(async (privateNetwork) => {
          // unassign all instances from private network
          await Promise.all(
            privateNetwork.instances.map((instance) =>
              provider.unassignPrivateNetwork(privateNetwork.privateNetworkId, instance.instanceId)
            )
          );
          // delete private network
          await provider.deletePrivateNetwork(privateNetwork.privateNetworkId);
        })
      );

      // clean up all test instance with timestamp > 5 minutes
      for (let page = 1; page < Infinity; page++) {
        const instances = await provider.listInstances({ page });
        if (instances.length === 0) {
          break;
        }
        const instanceToCleanUp = instances
          .filter((instance) => instance.displayName.startsWith("test_"))
          .filter((instance) => checkTimestampIsMoreThan1MinutesAgo(instance.displayName));
        await Promise.all(instanceToCleanUp.map((instance) => provider.resetInstance(instance.instanceId)));
      }

      // clean up all test secrets with timestamp > 5 minutes
      const secrets = await provider.listSecrets({ page: 1, name: `test_` });
      const secretToCleanUp = secrets.filter((secret) => checkTimestampIsMoreThan1MinutesAgo(secret.name));
      await Promise.all(secretToCleanUp.map((secret) => provider.deleteSecret(secret.secretId)));
    },
    afterAll: async () => {
      // clean up test instance
      if (instanceId) {
        await provider.resetInstance(instanceId);
      }
      // clean up test private network
      const privateNetworks = await provider.listPrivateNetworks({ name: testId });
      await Promise.all(
        privateNetworks.map((privateNetwork) => provider.deletePrivateNetwork(privateNetwork.privateNetworkId))
      );
      // clean up test secret
      const secretId = await provider.listSecrets({ type: "ssh", name: testId });
      await Promise.all(secretId.map((secret) => provider.deleteSecret(secret.secretId)));
    },
    sanitizeExit: true,
    sanitizeOps: true,
    sanitizeResources: true,
  },
  () => {
    it("Should be able to create, list, get instances and cancel it", async () => {
      // List instances and get first one
      {
        const instances = await provider.listInstances({ page: 1 });
        const instance = await provider.getInstance(instances[0].instanceId);
        assertEquals(instance.instanceId, instances[0].instanceId);
      }

      // Ensure test instance
      {
        instanceId = await provider.ensureInstance({
          provisioning: "manual",
          displayName: testId,
          sshKeys: [],
          privateNetworks: [],
          productId: "V76",
        });
        instance = await provider.getInstance(instanceId);
        assertStringIncludes(instance.displayName, "test_");
      }
    });

    it("Should be able to create, get and delete secrets and add it", async () => {
      let secretId: number | undefined = undefined;
      let secret: ContaboSecret | null = null;
      try {
        const name = testId;
        secretId = await provider.createSecret({ type: "ssh", name, value: SSH_PUBLIC_KEY });
        const secrets = await provider.listSecrets({ type: "ssh", name });
        secret = secrets[0];
        assertEquals(secret.secretId, secretId);
        secret = await provider.getSecret(secretId);
        assertEquals(secret.name, name);
      } finally {
        if (secretId !== undefined) {
          await provider.deleteSecret(secretId).catch((cause) => {
            throw new Error("The secret was not deleted, you must do it manually: id=" + secretId, {
              cause,
            });
          });
        }
      }
    });

    it("Should be able to create, get and delete privateNetworks", async () => {
      let privateNetworkId: number | undefined = undefined;
      let privateNetwork: ContaboPrivateNetwork | undefined = undefined;
      try {
        const name = testId;
        privateNetworkId = await provider.createPrivateNetwork({ name, region: "EU" });
        const privateNetworks = await provider.listPrivateNetworks({ name });
        privateNetwork = privateNetworks[0];
        assertEquals(privateNetwork.privateNetworkId, privateNetworkId);
        privateNetwork = await provider.getPrivateNetwork(privateNetworkId);
        assertEquals(privateNetwork.name, name);
      } finally {
        if (privateNetworkId !== undefined) {
          await provider.deletePrivateNetwork(privateNetworkId).catch((cause) => {
            throw new Error("The privateNetwork was not deleted, you must do it manually: id=" + privateNetworkId, {
              cause,
            });
          });
        }
      }
    });

    it("Assign secret and private network to instance", async () => {
      let secretId: number | undefined = undefined;
      let privateNetworkId: number | undefined = undefined;
      try {
        if (!instanceId || !instance) {
          throw new Error("Instance is not created");
        }
        // check if the private network addons is enabled on instance
        if (!instance.addOns.some((addOn) => addOn.id === 1477)) {
          console.info("Private network addon is not enabled on instance, add it");
          await provider.upgradeInstance({
            instanceId: instance.instanceId,
            privateNetwork: true,
          });
        }
        instanceId = instance.instanceId;
        privateNetworkId = await provider.createPrivateNetwork({ name: testId, region: "EU" });
        let privateNetwork = await provider.getPrivateNetwork(privateNetworkId);
        secretId = await provider.createSecret({ type: "ssh", name: testId, value: SSH_PUBLIC_KEY });
        const secret = await provider.getSecret(secretId);

        await provider.assignPrivateNetwork(privateNetwork.privateNetworkId, instance.instanceId);
        // refetch private network after assign
        privateNetwork = await provider.getPrivateNetwork(privateNetworkId);
        await provider.reinstallInstance({
          instanceId: instance.instanceId,
          sshKeys: [secret.secretId],
        });

        // check that private network is assigned
        const instanceInPrivateNetwork = privateNetwork.instances.find(
          (instance) => instance.instanceId === instanceId
        );
        assertExists(instanceInPrivateNetwork);

        // check that the private network is assigned to the instance
        const [ipGateway, netmask] = privateNetwork.cidr.split("/");
        const privateIp = instanceInPrivateNetwork.privateIpConfig.v4.find((ip) => ip.gateway === ipGateway);
        const stdout = await executeSSH(instance.ipv4, `ip a`);
        assertExists(privateIp);
        assertStringIncludes(stdout, `inet ${privateIp?.ip}/${netmask}`);
      } finally {
        // unassign private network
        if (privateNetworkId !== undefined && instanceId !== undefined) {
          await provider.unassignPrivateNetwork(privateNetworkId, instanceId).catch(() => {});
        }
        if (privateNetworkId !== undefined) {
          await provider.deletePrivateNetwork(privateNetworkId).catch(() => {});
        }
        if (secretId !== undefined) {
          await provider.deleteSecret(secretId).catch(() => {});
        }
      }
    });
  }
);
