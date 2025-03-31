import { describe, it } from "@std/testing/bdd";
import { ContaboNodeProvisioner } from "./contabo.ts";
import { ContaboProvider } from "../cloud-providers/contabo.ts";
import { Node, NodeProvider, NodeProvisioner } from "./mod.ts";
import { assertThrows } from "@std/assert/throws";
import { assertFalse } from "@std/assert/false";

const contaboProvider = new ContaboProvider();

const contaboNodeProvisioner = new ContaboNodeProvisioner(contaboProvider);

const provisioners = { contabo: contaboNodeProvisioner } satisfies Record<NodeProvider, NodeProvisioner>;

const clusterId = "test";

async function cleanup() {
  // clean up private networks
  const privateNetworks = await contaboProvider.listPrivateNetworks({ name: `cluster_${clusterId}_` });
  await Promise.all(
    privateNetworks.map(async (privateNetwork) => {
      // unassign all instances from private network
      await Promise.all(
        privateNetwork.instances.map((instance) =>
          contaboProvider.unassignPrivateNetwork(privateNetwork.privateNetworkId, instance.instanceId)
        )
      );
      await contaboProvider.deletePrivateNetwork(privateNetwork.privateNetworkId);
    })
  );
  await Promise.all(
    Object.entries(provisioners).map(async ([provider, provisioner]) => {
      console.info("Cleaning up cluster", clusterId, "on", provider);
      if (provider === "contabo") {
        for (let page = 1; page < Infinity; page++) {
          const instances = await contaboProvider.listInstances({ page });
          if (instances.length === 0) {
            break;
          }
          const instanceToCleanUp = instances.filter((instance) =>
            instance.displayName.startsWith(`cluster_${clusterId}_`)
          );
          await Promise.all(
            instanceToCleanUp.map(async (instance) => {
              await contaboProvider.resetInstance(instance.instanceId);
            })
          );
        }
      } else {
        return await Promise.all(
          Object.values(provisioner.listNodes({ clusterId })).map(async (node) => {
            await provisioner.deprovisionNode(node.id);
          })
        );
      }
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
      it("should provision a node", async () => {
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
        assertFalse(nodes.length === 0);
      });

      it("should get a node", async () => {
        const { id } = await provisioner.getNode(node.id);
        assertFalse(id !== node.id);
      });

      it("should deprovision a node", async () => {
        await provisioner.deprovisionNode(node.id);
				const nodes = await provisioner.listNodes({
					clusterId,
				})
				assertFalse(nodes.length !== 0);
      });
    }
  );
});
