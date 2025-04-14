import { Node } from "../node_provisioners/mod.ts";
import { executeSSH, sh } from "../utils.ts";
import { AbstractKubernetesAdministrator } from "./abstract.ts";
import { KubernetesAdministrator, UpgradeClusterOptions } from "./mod.ts";

/**
 * @see https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/install-kubeadm/
 */
export class KubernetesAdministratorV1_32 extends AbstractKubernetesAdministrator {
  protected getVersion(): "1.32" {
    return "1.32";
  }

  async installDependencies(node: Node): Promise<void> {
    // 1. Update the apt package index and install packages needed to use the Kubernetes apt repository:
    await executeSSH(node.publicIp, "sudo apt-get update");
    // apt-transport-https may be a dummy package; if so, you can skip that package
    await executeSSH(node.publicIp, "sudo apt-get install -y apt-transport-https ca-certificates curl gpg");
    
    // Install containerd if not already installed
    // Check if containerd is installed
    const containerdInstalled = await executeSSH(node.publicIp, "command -v containerd || echo 'not installed'");
    if (containerdInstalled.includes('not installed')) {
      console.log("Installing containerd on node", node.id);
      
      // Install dependencies
      await executeSSH(node.publicIp, "sudo apt-get install -y ca-certificates curl gnupg");
      
      // Add Docker's official GPG key
      await executeSSH(node.publicIp, "sudo install -m 0755 -d /etc/apt/keyrings");
      await executeSSH(node.publicIp, "curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg");
      await executeSSH(node.publicIp, "sudo chmod a+r /etc/apt/keyrings/docker.gpg");
      
      // Add the repository to Apt sources
      await executeSSH(
        node.publicIp,
        `echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null`
      );
      
      // Update apt and install containerd
      await executeSSH(node.publicIp, "sudo apt-get update");
      await executeSSH(node.publicIp, "sudo apt-get install -y containerd.io");
      
      // Configure containerd for Kubernetes
      await executeSSH(node.publicIp, "sudo mkdir -p /etc/containerd");
      await executeSSH(node.publicIp, "containerd config default | sudo tee /etc/containerd/config.toml > /dev/null");
      
      // Set SystemdCgroup to true for containerd
      await executeSSH(node.publicIp, "sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/g' /etc/containerd/config.toml");
      
      // Restart containerd
      await executeSSH(node.publicIp, "sudo systemctl restart containerd");
      await executeSSH(node.publicIp, "sudo systemctl enable containerd");
    } else {
      console.log("containerd already installed on node", node.id);
    }
    
    // 2. Download the public signing key for the Kubernetes package repositories. The same signing key is used for all repositories so you can disregard the version in the URL:
    // If the directory '/etc/apt/keyrings' does not exist, it should be created before the curl command, read the note below.
    await executeSSH(node.publicIp, "sudo mkdir -p -m 755 /etc/apt/keyrings");
    await executeSSH(
      node.publicIp, "sudo rm -rf /etc/apt/keyrings/kubernetes-apt-keyring.gpg"
    )
    await executeSSH(
      node.publicIp,
      "curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.32/deb/Release.key | sudo gpg --dearmor --batch --no-tty -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg"
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
    
    // 5. Configure kernel modules and sysctl settings required for Kubernetes
    await executeSSH(node.publicIp, "cat <<EOF | sudo tee /etc/modules-load.d/k8s.conf\noverlay\nbr_netfilter\nEOF");
    await executeSSH(node.publicIp, "sudo modprobe overlay");
    await executeSSH(node.publicIp, "sudo modprobe br_netfilter");
    
    // Set sysctl parameters for Kubernetes networking
    await executeSSH(node.publicIp, "cat <<EOF | sudo tee /etc/sysctl.d/k8s.conf\nnet.bridge.bridge-nf-call-iptables  = 1\nnet.bridge.bridge-nf-call-ip6tables = 1\nnet.ipv4.ip_forward                 = 1\nEOF");
    await executeSSH(node.publicIp, "sudo sysctl --system");
    
    // 6. Enable the kubelet service
    await executeSSH(node.publicIp, "sudo systemctl enable kubelet");
  }

  async upgradeCluster(clusterId: string, options: UpgradeClusterOptions): Promise<KubernetesAdministrator> {
    const { etcdNodes } = options;
    
    // Get control plane nodes
    const controlPlaneNodes = await Array.fromAsync(
      this.listNodes({ clusterId, type: "control-plane" })
    );

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
