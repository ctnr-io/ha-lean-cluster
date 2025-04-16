import { describe, it } from "@std/testing/bdd";
import { ContaboNodeProvisioner } from "./contabo.ts";
import { ContaboProvider } from "../cloud_providers/contabo.ts";
import { Node, NodeProvider, NodeProvisioner } from "./mod.ts";
import { assertExists } from "@std/assert";
import { assertFalse } from "@std/assert/false";
import { executeSSH } from "../utils.ts";

// Set up providers and provisioners
const contaboProvider = new ContaboProvider();
const contaboNodeProvisioner = new ContaboNodeProvisioner(contaboProvider);
const provisioners = { contabo: contaboNodeProvisioner } satisfies Record<NodeProvider, NodeProvisioner>;

// Test cluster ID
const clusterId = "test0000";

/**
 * Cleanup function to remove test resources
 */
async function cleanup() {
  console.info("Starting cleanup process...");

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
          instance.displayName.includes(`cluster=${clusterId}`)
        );

        for (const instance of instancesToCleanUp) {
          console.info(`Resetting instance ${instance.instanceId}`);
          await contaboProvider.setInstanceDisplayName(instance.instanceId, "");
          await contaboProvider.stopInstance(instance.instanceId);
        }
      }
    } else {
      // For other providers, deprovision nodes
      for await (const node of provisioner.listNodes({ clusterId })) {
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
        });

        // Verify node was provisioned
        assertExists(node.id);
        console.info(`Provisioned node with ID: ${node.id}`);

        // Verify SSH access to the node
        const [sshOutput] = await executeSSH(node.publicIp, "echo 'hello world'");
        console.info(`SSH test output: ${sshOutput}`);
        assertFalse(sshOutput !== "hello world");
      });

      it("should list nodes", async () => {
        // List nodes for the cluster
        const nodes: Node[] = [];
        for await (const node of provisioner.listNodes({ clusterId })) {
          nodes.push(node);
        }
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

        // List nodes for the cluster
        const nodes: Node[] = [];
        for await (const node of provisioner.listNodes({ clusterId })) {
          nodes.push(node);
        }
        assertFalse(nodes.some((n) => n.id === node.id));
        console.info(`Node ${node.id} successfully deprovisioned`);
      });
    }
  );
});
