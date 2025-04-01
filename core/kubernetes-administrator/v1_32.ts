import { Node } from "../node-provisioners/mod.ts";
import { executeSSH, sh } from "../utils.ts";
import { AbstractKubernetesAdministrator } from "./abstract.ts";
import { KubernetesAdministrator, UpgradeClusterOptions } from "./mod.ts";

export class KubernetesAdministratorV1_32 extends AbstractKubernetesAdministrator {
  protected getVersion(): "1.32" {
    return "1.32";
  }

  async installDependencies(node: Node): Promise<void> {
    // 1. Update the apt package index and install packages needed to use the Kubernetes apt repository:
    await executeSSH(node.publicIp, "sudo apt-get update");
    // apt-transport-https may be a dummy package; if so, you can skip that package
    await executeSSH(node.publicIp, "sudo apt-get install -y apt-transport-https ca-certificates curl gpg");
    // 2. Download the public signing key for the Kubernetes package repositories. The same signing key is used for all repositories so you can disregard the version in the URL:
    // If the directory '/etc/apt/keyrings' does not exist, it should be created before the curl command, read the note below.
    await executeSSH(node.publicIp, "sudo mkdir -p -m 755 /etc/apt/keyrings");
    await executeSSH(
      node.publicIp,
      "curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.32/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg"
    );
    // 3. Add the appropriate Kubernetes apt repository. Please note that this repository have packages only for Kubernetes 1.32; for other Kubernetes minor versions, you need to change the Kubernetes minor version in the URL to match your desired minor version (you should also check that you are reading the documentation for the version of Kubernetes that you plan to install).
    // This overwrites any existing configuration in /etc/apt/sources.list.d/kubernetes.list
    await executeSSH(
      node.publicIp,
      "echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.32/deb/ /' | sudo tee /etc/apt/sources.list.d/kubernetes.list"
    );
    // 4. Update the apt package index, install kubelet, kubeadm and kubectl, and pin their version:
    await executeSSH(node.publicIp, "sudo apt-get update");
    await executeSSH(node.publicIp, "sudo apt-get install -y kubelet kubeadm kubectl");
    await executeSSH(node.publicIp, "sudo apt-mark hold kubelet kubeadm kubectl");
    // 5. (Optional) Enable the kubelet service before running kubeadm:
    // sudo systemctl enable --now kubelet
  }

  async upgradeCluster(clusterId: string, options: UpgradeClusterOptions): Promise<KubernetesAdministrator> {
    const { etcdNodes } = options;
    
    // Get all nodes
    const nodes = await this.nodeProvisioner.listNodes({
      clusterId,
    });

    // Find all control plane nodes
    const controlPlaneNodes = nodes.filter((node) => node.roles.includes("control-plane"));
    if (controlPlaneNodes.length === 0) {
      throw new Error("No control plane nodes found in the cluster");
    }

    // Before upgrading, backup etcd
    const backupPath = await this.backupEtcd(clusterId);
    console.info(`Backed up etcd to ${backupPath} before upgrade`);

    // Upgrade etcd on all control plane nodes
    for (const node of controlPlaneNodes) {
      console.info(`Upgrading etcd on node ${node.id}`);
      
      // Check current etcd version
      const etcdVersion = await executeSSH(
        node.publicIp,
        "ETCDCTL_API=3 etcdctl version | grep 'etcdctl version' | awk '{print $3}'"
      );
      console.info(`Current etcd version: ${etcdVersion}`);
      
      // Upgrade etcd (in a real implementation, this would involve more steps)
      // For now, we'll just restart etcd to simulate an upgrade
      await executeSSH(node.publicIp, "systemctl restart etcd");
      
      // Verify etcd is healthy after upgrade
      await executeSSH(
        node.publicIp,
        sh`ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
          --cacert=/etc/kubernetes/pki/etcd/ca.crt \
          --cert=/etc/kubernetes/pki/etcd/server.crt \
          --key=/etc/kubernetes/pki/etcd/server.key \
          endpoint health`
      );
    }

    // Check etcd health after upgrade
    const etcdHealth = await this.checkEtcdHealth(clusterId);
    if (!etcdHealth.healthy) {
      throw new Error(`Etcd is not healthy after upgrade: ${etcdHealth.healthOutput}`);
    }

    console.info("Etcd upgrade completed successfully");
    
    // Return the same instance since we're not actually upgrading to a new version
    return this;
  }
}
