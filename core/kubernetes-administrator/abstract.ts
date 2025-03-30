import { hash, randomUUID } from "node:crypto";
import { AddNodeOptions, CreateClusterOptions, KubernetesAdministrator, UpgradeClusterOptions } from "./mod.ts";
import { Node, NodeProvisioner } from "../node-provisioners/mod.ts";
import { executeSSH, sh } from "../utils.ts";

export abstract class AbstractKubernetesAdministrator implements KubernetesAdministrator {
  abstract upgradeCluster(clusterId: string, options: UpgradeClusterOptions): Promise<KubernetesAdministrator>;

  constructor(protected nodeProvisioner: NodeProvisioner) {}

  protected static generateClusterId(): string {
    return hash("sha2", randomUUID(), "hex");
  }

  protected abstract getVersion(): "1.32"; // currently only 1.32 is supported

  /**
   * Install kubeadm, kubelet, and kubectl dependencies on the given node
   */
  protected abstract installDependencies(node: Node): Promise<void>;

  async createCluster(options: CreateClusterOptions): Promise<string> {
    const { cni = "calico", podCidr = "10.244.0.0/16", serviceCidr = "10.96.0.0/12" } = options;

		const k8sVersion = this.getVersion();

    const clusterId = AbstractKubernetesAdministrator.generateClusterId();

    const controlPlaneNode = await this.nodeProvisioner.provisionNode({
      mode: "manual",
      region: "europe",
      clusterId,
      roles: ["control-plane"],
    });

		// Install kubeadm, kubelet, and kubectl dependencies
    await this.installDependencies(controlPlaneNode);

    // Initialize the cluster with kubeadm
    await executeSSH(
      controlPlaneNode.publicIp,
      sh`kubeadm init --kubernetes-version=${k8sVersion} \
        --pod-network-cidr=${podCidr} \
        --service-cidr=${serviceCidr} \
        --control-plane-endpoint=${controlPlaneNode.publicIp}:6443 \
        --upload-cert`
    );

    // Install CNI
    if (cni === "calico") {
      await executeSSH(
        controlPlaneNode.publicIp,
        sh`kubectl --kubeconfig=/etc/kubernetes/admin.conf apply -f https://docs.projectcalico.org/manifests/calico.yaml`
      );
    } else if (cni === "flannel") {
      await executeSSH(
        controlPlaneNode.publicIp,
        sh`kubectl --kubeconfig=/etc/kubernetes/admin.conf apply -f https://raw.githubusercontent.com/flannel-io/flannel/master/Documentation/kube-flannel.yml`
      );
    }

    return clusterId;
  }

  async deleteCluster(clusterId: string): Promise<void> {
    // Get all nodes
    const nodes = await this.nodeProvisioner.listNodes({
      clusterId,
    });

    // Reset all nodes
    await Promise.allSettled(
      nodes.map(async (node) => {
        try {
          // Run kubeadm reset on the node
          await executeSSH(node.publicIp, "kubeadm reset -f");

          // Clean up any remaining Kubernetes files
          await executeSSH(node.publicIp, sh`rm -rf /etc/kubernetes /var/lib/kubelet /var/lib/etcd /etc/cni/net.d`);

          // Deprovision the node
          await this.nodeProvisioner.deprovisionNode(node.id);
        } catch (error) {
          console.error(`Error resetting node ${node.id}: ${error}`);
        }
      })
    );
  }

  async addNode(options: AddNodeOptions): Promise<Node> {
    const { clusterId, roles } = options;

    // Get all nodes
    const nodes = await this.nodeProvisioner.listNodes({
      clusterId,
    });

    // Find a control plane node to get the join command from
    const controlPlaneNode = nodes.find((node) => node.roles.includes("control-plane"));

    if (!controlPlaneNode) {
      throw new Error("No control plane node found in the cluster");
    }

    // Provision a new node
    const newNode = await this.nodeProvisioner.provisionNode({
      mode: "manual",
      region: "europe",
      clusterId: clusterId,
      roles: roles,
    });

    // Get the join command from the control plane
    let joinCommand: string;

    if (roles.includes("control-plane")) {
      // Get the control plane join command with certificate key
      const certKey = await executeSSH(
        controlPlaneNode.publicIp,
        "kubeadm init phase upload-certs --upload-certs | tail -1"
      );

      joinCommand = await executeSSH(
        controlPlaneNode.publicIp,
        `kubeadm token create --print-join-command --certificate-key ${certKey}`
      );
    } else {
      // Get the worker join command
      joinCommand = await executeSSH(controlPlaneNode.publicIp, "kubeadm token create --print-join-command");
    }

    // Join the node to the cluster
    await executeSSH(newNode.publicIp, joinCommand);

    return newNode;
  }

  async removeNode(clusterId: string, nodeId: string): Promise<void> {
    // Get all nodes
    const nodes = await this.nodeProvisioner.listNodes({
      clusterId,
    });

    // Find the node to remove
    const nodeIndex = nodes.findIndex((node) => node.id === nodeId);
    if (nodeIndex === -1) {
      throw new Error(`Node with ID ${nodeId} not found in cluster ${clusterId}`);
    }

    const nodeToRemove = nodes[nodeIndex];

    // Find a control plane node (that's not the one being removed)
    const controlPlaneNode = nodes.find((node) => node.roles.includes("control-plane") && node.id !== nodeId);

    if (!controlPlaneNode) {
      throw new Error("Cannot remove the only control plane node");
    }

    // Drain the node
    await executeSSH(
      controlPlaneNode.publicIp,
      `kubectl --kubeconfig=/etc/kubernetes/admin.conf drain ${nodeToRemove.publicIp} --ignore-daemonsets --delete-emptydir-data --force`
    );

    // Delete the node from Kubernetes
    await executeSSH(
      controlPlaneNode.publicIp,
      `kubectl --kubeconfig=/etc/kubernetes/admin.conf delete node ${nodeToRemove.publicIp}`
    );

    // Reset the node
    try {
      await executeSSH(nodeToRemove.publicIp, "kubeadm reset -f");
      await executeSSH(nodeToRemove.publicIp, sh`rm -rf /etc/kubernetes /var/lib/kubelet /var/lib/etcd /etc/cni/net.d`);
    } catch (error) {
      console.error(`Error resetting node ${nodeToRemove.id}: ${error}`);
    }

    // Deprovision the node
    await this.nodeProvisioner.deprovisionNode(nodeToRemove.id);
  }
}
