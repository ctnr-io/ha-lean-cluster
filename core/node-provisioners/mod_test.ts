import { describe, it } from "@std/testing/bdd";
import { ContaboNodeProvisioner } from "./contabo.ts";
import { ContaboProvider } from "../cloud-providers/contabo.ts";
import { Node, NodeProvider, NodeProvisioner } from "./mod.ts";
import { assertExists } from "@std/assert";
import { assertFalse } from "@std/assert/false";
import { executeSSH } from "../utils.ts";

// Set up providers and provisioners
const contaboProvider = new ContaboProvider();
const contaboNodeProvisioner = new ContaboNodeProvisioner(contaboProvider);
const provisioners = { contabo: contaboNodeProvisioner } satisfies Record<NodeProvider, NodeProvisioner>;

// Test cluster ID
const clusterId = "test";

/**
 * Cleanup function to remove test resources
 */
async function cleanup() {
  console.info("Starting cleanup process...");
  
  // Clean up private networks
  const privateNetworks = await contaboProvider.listPrivateNetworks({ name: `cluster=${clusterId}` });
  console.info(`Found ${privateNetworks.length} private networks to clean up`);
  
  for (const privateNetwork of privateNetworks) {
    // Unassign all instances from private network
    for (const instance of privateNetwork.instances) {
      console.info(`Unassigning instance ${instance.instanceId} from private network ${privateNetwork.privateNetworkId}`);
      await contaboProvider.unassignPrivateNetwork(privateNetwork.privateNetworkId, instance.instanceId);
    }
    
    // Delete private network
    console.info(`Deleting private network ${privateNetwork.privateNetworkId}`);
    await contaboProvider.deletePrivateNetwork(privateNetwork.privateNetworkId);
  }
  
  // Clean up instances
  for (const [provider, provisioner] of Object.entries(provisioners)) {
    console.info(`Cleaning up cluster ${clusterId} on ${provider}`);
    
    if (provider === "contabo") {
      // For Contabo, we need to reset instances
      for (let page = 1; page < Infinity; page++) {
        const instances = await contaboProvider.listInstances({ page });
        if (instances.length === 0) {
          break;
        }
        
        const instancesToCleanUp = instances.filter((instance) =>
          instance.displayName.startsWith(`cluster=${clusterId}`) && !instance.displayName.includes("error=")
        );
        
        for (const instance of instancesToCleanUp) {
          console.info(`Resetting instance ${instance.instanceId}`);
          await contaboProvider.resetInstance(instance.instanceId);
        }
      }
    } else {
      // For other providers, deprovision nodes
      const nodes = await provisioner.listNodes({ clusterId });
      for (const node of nodes) {
        console.info(`Deprovisioning node ${node.id}`);
        await provisioner.deprovisionNode({
          clusterId,
          nodeId: node.id,
        });
      }
    }
  }
  
  console.info("Cleanup completed");
}

// Test each provisioner
Object.entries(provisioners).forEach(([provider, provisioner]) => {
  describe(
    `Node Provisioner: ${provider}`,
    {
      beforeAll: cleanup,
      afterAll: cleanup,
      sanitizeOps: true,
      sanitizeResources: true,
      sanitizeExit: true,
    },
    () => {
      let node: Node;
      
      it("should provision a node", async () => {
        // Provision a test node
        node = await provisioner.provisionNode({
          mode: "manual",
          region: "eu",
          clusterId,
          roles: ["control-plane"],
        });
        
        // Verify node was provisioned
        assertExists(node.id);
        console.info(`Provisioned node with ID: ${node.id}`);
        
        // Verify SSH access to the node
        const sshOutput = await executeSSH(node.publicIp, "echo 'hello world'");
        console.info(`SSH test output: ${sshOutput}`);
      });

      it("should list nodes", async () => {
        // List nodes for the cluster
        const nodes = await provisioner.listNodes({
          clusterId,
        });
        
        // Verify nodes were listed
        assertFalse(nodes.length === 0);
        console.info(`Found ${nodes.length} nodes in cluster ${clusterId}`);
      });

      it("should get a node", async () => {
        // Get the node by ID
        const retrievedNode = await provisioner.getNode({
          clusterId,
          nodeId: node.id,
        });
        
        // Verify node was retrieved
        assertExists(retrievedNode);
        assertFalse(retrievedNode.id !== node.id);
        console.info(`Retrieved node with ID: ${retrievedNode.id}`);
      });

      it("should deprovision a node", async () => {
        // Deprovision the node
        console.info(`Deprovisioning node ${node.id}`);
        await provisioner.deprovisionNode({
          clusterId,
          nodeId: node.id,
        });
        
        // Verify node was deprovisioned
        const nodes = await provisioner.listNodes({
          clusterId,
        });
        assertFalse(nodes.some(n => n.id === node.id));
        console.info(`Node ${node.id} successfully deprovisioned`);
      });
    }
  );
});
