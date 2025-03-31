import { Node } from "../node-provisioners/mod.ts";
import { executeSSH } from "../utils.ts";
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
    throw new Error("Not implemented");
  }
}
