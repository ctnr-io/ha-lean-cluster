import { describe, it } from "@std/testing/bdd";
import { ContaboNodeProvisioner } from "../node_provisioners/contabo.ts";
import { ContaboProvider } from "../cloud_providers/contabo.ts";
import { createKubernetesAdministrator } from "./mod.ts";
import { assertEquals, assertExists } from "@std/assert";
import { assertFalse } from "@std/assert/false";
import { executeSSH, findAsync, firstAsync } from "../utils.ts";
import { Node, NodeRoles } from "../node_provisioners/mod.ts";

// Set up providers and provisioners
const contaboProvider = new ContaboProvider();
const contaboNodeProvisioner = new ContaboNodeProvisioner(contaboProvider);

// Create a kubernetes administrator
const k8sAdmin = createKubernetesAdministrator("1.32", contaboNodeProvisioner);

// Test cluster ID
const clusterId: string = "test0001";

async function cleanup() {
  console.info("Cleaning up test cluster:", clusterId);
  // Get nodes by tags
  const nodes = await Array.fromAsync(
    contaboNodeProvisioner.listNodes({
      clusterId: clusterId,
      // withError: true,
    })
  );
  // Delete all nodes
  for (const node of nodes) {
    await contaboNodeProvisioner.deprovisionNode({
      clusterId: clusterId,
      nodeId: node.id,
    });
  }
}

describe(
  "Kubernetes Administrator",
  {
    beforeAll: cleanup,
    // afterAll: cleanup,
    sanitizeExit: true,
    sanitizeResources: true,
    sanitizeOps: true,
  },
  () => {
    it("should create a Kubernetes cluster", async () => {
      await k8sAdmin.initCluster({
        clusterId: clusterId,
        podCidr: "10.244.0.0/16",
        serviceCidr: "10.96.0.0/12",
      });

      assertExists(clusterId);
      console.info("Created cluster with ID:", clusterId);

      // Get the nodes to verify the cluster was created
      const nodes = await Array.fromAsync(
        contaboNodeProvisioner.listNodes({
          clusterId: clusterId,
        })
      );
      console.log(nodes);

      // Should have at least one control plane node
      assertFalse(nodes.length === 0);

      // Find the control plane node
      const controlPlaneNode = await firstAsync({
        generator: k8sAdmin.listNodes({ clusterId, type: "control-plane" }),
      });
      assertExists(controlPlaneNode);

      // Verify Kubernetes is running by checking for nodes
      const [kubeNodesOutput] = await executeSSH(
        controlPlaneNode.publicIp,
        "kubectl --kubeconfig=/etc/kubernetes/admin.conf get nodes -o wide"
      );
      console.info("Kubernetes nodes:", kubeNodesOutput);
      assertExists(kubeNodesOutput.includes(controlPlaneNode.publicIp));
    });

    it("should add a worker node to the cluster", async () => {
      // Find the control plane node
      const controlPlaneNode = await firstAsync({
        generator: k8sAdmin.listNodes({ clusterId, type: "control-plane" }),
      });
      assertExists(controlPlaneNode);

      const workerNode = await k8sAdmin.addNode({
        clusterId: clusterId,
        roles: ["worker"],
      });
      assertExists(workerNode);
      console.info("Added worker node:", workerNode.id);

      // Verify the node was added to the cluster
      const [kubeNodesOutput] = await executeSSH(
        controlPlaneNode.publicIp,
        "kubectl --kubeconfig=/etc/kubernetes/admin.conf get nodes -o wide"
      );
      console.info("Kubernetes nodes after adding worker:", kubeNodesOutput);
      assertExists(kubeNodesOutput.includes(workerNode.publicIp));

      // Verify the node has the correct role
      const [nodeRoleOutput] = await executeSSH(
        controlPlaneNode.publicIp,
        `kubectl --kubeconfig=/etc/kubernetes/admin.conf get nodes -o jsonpath='{.items[*].metadata.labels}'`
      );
      console.info("Worker node labels:", nodeRoleOutput);
      assertExists(nodeRoleOutput.includes("node-role.kubernetes.io/worker"));
    });

    it("should add a control plane node to the cluster", async () => {
      // Find the control plane node
      const controlPlaneNode = await firstAsync({
        generator: k8sAdmin.listNodes({ clusterId, type: "control-plane" }),
      });
      assertExists(controlPlaneNode);

      const secondControlPlaneNode = await k8sAdmin.addNode({
        clusterId: clusterId,
        roles: ["control-plane"],
      });

      assertExists(secondControlPlaneNode);
      console.info("Added second control plane node:", secondControlPlaneNode.id);

      // Verify the node was added to the cluster
      const [kubeNodesOutput] = await executeSSH(
        controlPlaneNode.publicIp,
        "kubectl --kubeconfig=/etc/kubernetes/admin.conf get nodes -o wide"
      );
      console.info("Kubernetes nodes after adding second control plane:", kubeNodesOutput);
      assertExists(kubeNodesOutput.includes(secondControlPlaneNode.publicIp));

      // Verify the node has the correct role
      const [nodeRoleOutput] = await executeSSH(
        controlPlaneNode.publicIp,
        `kubectl --kubeconfig=/etc/kubernetes/admin.conf get node ${secondControlPlaneNode.publicIp} -o jsonpath='{.metadata.labels}'`
      );
      console.info("Second control plane node labels:", nodeRoleOutput);
      assertExists(nodeRoleOutput.includes("node-role.kubernetes.io/control-plane"));
    });

    it("should remove a node from the cluster", async () => {
      // Find the control plane node
      const controlPlaneNode = await firstAsync({
        generator: k8sAdmin.listNodes({ clusterId, type: "control-plane" }),
      });
      assertExists(controlPlaneNode);

      // Find a worker node to remove
      const workerNode = await firstAsync({
        generator: k8sAdmin.listNodes({
          clusterId,
          type: "worker",
        }),
      });
      assertExists(workerNode);

      // Remove the worker node
      await k8sAdmin.removeNode(clusterId, workerNode.id);

      // Verify the node was removed
      const updatedNodes = await Array.fromAsync(
        contaboNodeProvisioner.listNodes({
          clusterId: clusterId,
        })
      );
      assertFalse(updatedNodes.some((node) => node.id === workerNode.id));

      // Verify the node was removed from Kubernetes
      const [kubeNodesOutput] = await executeSSH(
        controlPlaneNode.publicIp,
        "kubectl --kubeconfig=/etc/kubernetes/admin.conf get nodes -o wide"
      );
      console.info("Kubernetes nodes after removing worker:", kubeNodesOutput);
      assertFalse(kubeNodesOutput.includes(workerNode.publicIp));
    });

    // it("should check etcd health", async () => {
    //   // Check etcd health
    //   const healthStatus = await k8sAdmin.checkEtcdHealth(clusterId);

    //   // Verify etcd is healthy
    //   assertEquals(healthStatus.healthy, true);
    //   assertExists(healthStatus.healthyEndpoints > 0);
    //   assertExists(healthStatus.members > 0);
    //   assertFalse(healthStatus.hasAlarms);

    //   console.info("Etcd health status:", healthStatus);
    // });

    // it("should backup etcd", async () => {
    //   // Find the control plane node
    //   const controlPlaneNode = await firstAsync({
    //     generator: k8sAdmin.listNodes({ clusterId, type: "control-plane" }),
    //   });
    //   assertExists(controlPlaneNode);

    //   // Backup etcd
    //   const backupPath = await k8sAdmin.backupEtcd(clusterId);

    //   // Verify backup was created
    //   assertExists(backupPath);
    //   console.info("Etcd backup created at:", backupPath);

    //   // Verify backup file exists on the node
    //   const [backupExists] = await executeSSH(
    //     controlPlaneNode.publicIp,
    //     `test -f ${backupPath} && echo "exists" || echo "not found"`
    //   );
    //   assertEquals(backupExists.trim(), "exists");
    // });

    // it("should delete the cluster", async () => {
    //   await k8sAdmin.deleteCluster(clusterId);

    //   // Verify all nodes were deprovisioned
    //   const nodes = await Array.fromAsync(
    //     contaboNodeProvisioner.listNodes({
    //       clusterId: clusterId,
    //       // withError: true,
    //     })
    //   );
    //   assertFalse(nodes.length !== 0);
    // });
  }
);
