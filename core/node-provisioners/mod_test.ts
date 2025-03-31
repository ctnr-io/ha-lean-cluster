import { describe, it } from "@std/testing/bdd";
import { ContaboNodeProvisioner } from "./contabo.ts";
import { ContaboProvider } from "../cloud-providers/contabo.ts";
import { Node, NodeProvider, NodeProvisioner } from "./mod.ts";
import { assertThrows } from "@std/assert/throws";

const contaboProvider = new ContaboProvider();

const contaboNodeProvisioner = new ContaboNodeProvisioner(contaboProvider);

const provisioners = { contabo: contaboNodeProvisioner } satisfies Record<NodeProvider, NodeProvisioner>;

const clusterId = "test";

async function cleanup() {
  await Promise.all(
    Object.entries(provisioners).map(async ([provider, provisioner]) => {
      console.info("Cleaning up cluster", clusterId, "on", provider);
      if (provider === "contabo") {
        const instances = await contaboProvider.listInstances({ page: 1, size: 5000 });
        return await Promise.all(
          instances
            .filter((instance) => instance.displayName.startsWith(`cluster_${clusterId}_`))
            .map(async (instance) => {
              await contaboProvider.setInstanceDisplayName(instance.instanceId, "");
            })
        );
      }
      return await Promise.all(
        Object.values(provisioner.listNodes({ clusterId })).map(async (node) => {
          await provisioner.deprovisionNode(node.id);
        })
      );
    })
  );
}

// Foreach provisioner, test provisioning, deprovisioning, listing, and getting nodes
Object.entries(provisioners).forEach(([provider, provisioner]) => {
  describe(
    `Node Provisioner: ${provider}`,
    {
      beforeAll: cleanup,
      afterAll: cleanup,
    },
    () => {
      let node: Node;
      it("should provision and deprovision a node", async () => {
        node = await provisioner.provisionNode({
          mode: "manual",
          region: "europe",
          clusterId,
          roles: ["control-plane"],
        });
      });

      it("should list nodes", async () => {
        const nodes = await provisioner.listNodes({
          clusterId,
        });
        console.log(nodes);
      });

      it("should get a node", async () => {
        await provisioner.getNode(node.id);
      });

      it("should deprovision a node", async () => {
        await provisioner.deprovisionNode(node.id);
        assertThrows(async () => {
          await provisioner.getNode(node.id);
        });
      });
    }
  );
});
