import { hash, randomUUID } from "node:crypto";
import { AddNodeOptions, CreateClusterOptions, EtcdBackupOptions, EtcdHealthStatus, EtcdRestoreOptions, KubernetesAdministrator, UpgradeClusterOptions } from "./mod.ts";
import { Node, NodeProvisioner } from "../node-provisioners/mod.ts";
import { executeSSH, sh, yaml } from "../utils.ts";

export abstract class AbstractKubernetesAdministrator implements KubernetesAdministrator {
  abstract upgradeCluster(clusterId: string, options: UpgradeClusterOptions): Promise<KubernetesAdministrator>;

  constructor(protected nodeProvisioner: NodeProvisioner) {}

  /**
   * Create a backup of the etcd data
   * @param clusterId The ID of the cluster
   * @param options Backup options
   * @returns Path to the backup file
   */
  async backupEtcd(clusterId: string, options: EtcdBackupOptions = {}): Promise<string> {
    const { backupPath = `/tmp/etcd-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.db` } = options;
    
    // Get all nodes
    const nodes = await this.nodeProvisioner.listNodes({
      clusterId,
    });

    // Find a control plane node
    const controlPlaneNode = nodes.find((node) => node.roles.includes("control-plane"));
    if (!controlPlaneNode) {
      throw new Error("No control plane node found in the cluster");
    }

    // Create the backup
    await executeSSH(
      controlPlaneNode.publicIp,
      sh`ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
        --cacert=/etc/kubernetes/pki/etcd/ca.crt \
        --cert=/etc/kubernetes/pki/etcd/server.crt \
        --key=/etc/kubernetes/pki/etcd/server.key \
        snapshot save ${backupPath}`
    );

    // Verify the backup
    await executeSSH(
      controlPlaneNode.publicIp,
      sh`ETCDCTL_API=3 etcdctl --write-out=table snapshot status ${backupPath}`
    );

    return backupPath;
  }

  /**
   * Restore etcd from a backup
   * @param clusterId The ID of the cluster
   * @param options Restore options
   */
  async restoreEtcd(clusterId: string, options: EtcdRestoreOptions): Promise<void> {
    const { backupPath } = options;
    
    // Get all nodes
    const nodes = await this.nodeProvisioner.listNodes({
      clusterId,
    });

    // Find all control plane nodes
    const controlPlaneNodes = nodes.filter((node) => node.roles.includes("control-plane"));
    if (controlPlaneNodes.length === 0) {
      throw new Error("No control plane nodes found in the cluster");
    }

    // Stop kubelet and etcd on all control plane nodes
    await Promise.all(
      controlPlaneNodes.map(async (node) => {
        await executeSSH(node.publicIp, "systemctl stop kubelet");
        await executeSSH(node.publicIp, "docker stop etcd || true");
      })
    );

    // Restore the backup on the first control plane node
    const firstControlPlane = controlPlaneNodes[0];
    await executeSSH(
      firstControlPlane.publicIp,
      sh`ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
        --cacert=/etc/kubernetes/pki/etcd/ca.crt \
        --cert=/etc/kubernetes/pki/etcd/server.crt \
        --key=/etc/kubernetes/pki/etcd/server.key \
        --data-dir=/var/lib/etcd-backup \
        snapshot restore ${backupPath}`
    );

    // Move the restored data to the etcd data directory
    await executeSSH(
      firstControlPlane.publicIp,
      sh`rm -rf /var/lib/etcd && mv /var/lib/etcd-backup /var/lib/etcd && chown -R etcd:etcd /var/lib/etcd`
    );

    // Start kubelet on all control plane nodes
    await Promise.all(
      controlPlaneNodes.map(async (node) => {
        await executeSSH(node.publicIp, "systemctl start kubelet");
      })
    );
  }

  /**
   * Check the health of the etcd cluster
   * @param clusterId The ID of the cluster
   * @returns Health status of the etcd cluster
   */
  async checkEtcdHealth(clusterId: string): Promise<EtcdHealthStatus> {
    // Get all nodes
    const nodes = await this.nodeProvisioner.listNodes({
      clusterId,
    });

    // Find a control plane node
    const controlPlaneNode = nodes.find((node) => node.roles.includes("control-plane"));
    if (!controlPlaneNode) {
      throw new Error("No control plane node found in the cluster");
    }

    // Check etcd health
    const healthOutput = await executeSSH(
      controlPlaneNode.publicIp,
      sh`ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
        --cacert=/etc/kubernetes/pki/etcd/ca.crt \
        --cert=/etc/kubernetes/pki/etcd/server.crt \
        --key=/etc/kubernetes/pki/etcd/server.key \
        endpoint health --cluster`
    );

    // Check etcd members
    const membersOutput = await executeSSH(
      controlPlaneNode.publicIp,
      sh`ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
        --cacert=/etc/kubernetes/pki/etcd/ca.crt \
        --cert=/etc/kubernetes/pki/etcd/server.crt \
        --key=/etc/kubernetes/pki/etcd/server.key \
        member list -w table`
    );

    // Check for alarms
    const alarmsOutput = await executeSSH(
      controlPlaneNode.publicIp,
      sh`ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
        --cacert=/etc/kubernetes/pki/etcd/ca.crt \
        --cert=/etc/kubernetes/pki/etcd/server.crt \
        --key=/etc/kubernetes/pki/etcd/server.key \
        alarm list`
    );

    // Parse health output
    const healthLines = healthOutput.split("\n").filter((line) => line.trim() !== "");
    const allHealthy = healthLines.every((line) => line.includes("is healthy"));
    const healthyCount = healthLines.filter((line) => line.includes("is healthy")).length;

    // Parse members output
    const memberLines = membersOutput.split("\n").filter((line) => line.includes("started"));
    const memberCount = memberLines.length;

    // Parse alarms output
    const hasAlarms = alarmsOutput.trim() !== "" && !alarmsOutput.includes("memberID:0 alarm:NONE");

    return {
      healthy: allHealthy,
      healthyEndpoints: healthyCount,
      totalEndpoints: healthLines.length,
      members: memberCount,
      hasAlarms,
      healthOutput,
      membersOutput,
      alarmsOutput,
    };
  }

  protected static generateClusterId(): string {
    return hash("sha256", randomUUID(), "hex").substring(0, 8);
  }

  protected abstract getVersion(): "1.32"; // currently only 1.32 is supported

  /**
   * Install kubeadm, kubelet, and kubectl dependencies on the given node
   */
  protected abstract installDependencies(node: Node): Promise<void>;

  async createCluster(options: CreateClusterOptions): Promise<string> {
    const { 
      cni = "calico", 
      podCidr = "10.244.0.0/16", 
      serviceCidr = "10.96.0.0/12",
      etcdOptions = {
        dataDir: "/var/lib/etcd",
        compactionRetention: 0,
        quotaBackendBytes: "2147483648", // 2GB
        maxRequestBytes: "1572864",
        metrics: "basic"
      }
    } = options;

    const k8sVersion = this.getVersion();

    const clusterId = AbstractKubernetesAdministrator.generateClusterId();

    const controlPlaneNode = await this.nodeProvisioner.provisionNode({
      mode: "manual",
      region: "eu",
      clusterId,
      roles: ["control-plane"],
    });

    // Install kubeadm, kubelet, and kubectl dependencies
    await this.installDependencies(controlPlaneNode);

    // Create kubeadm config file with etcd configuration
    const kubeadmConfigYaml = yaml`
      apiVersion: kubeadm.k8s.io/v1beta3
      kind: InitConfiguration
      nodeRegistration:
        criSocket: unix:///var/run/containerd/containerd.sock
      ---
      apiVersion: kubeadm.k8s.io/v1beta3
      kind: ClusterConfiguration
      kubernetesVersion: ${k8sVersion}
      networking:
        podSubnet: ${podCidr}
        serviceSubnet: ${serviceCidr}
      controlPlaneEndpoint: ${controlPlaneNode.publicIp}:6443
      etcd:
        local:
          dataDir: ${etcdOptions.dataDir}
          extraArgs:
            auto-compaction-retention: "${etcdOptions.compactionRetention}"
            quota-backend-bytes: "${etcdOptions.quotaBackendBytes}"
            max-request-bytes: "${etcdOptions.maxRequestBytes}"
            metrics: "${etcdOptions.metrics}"
      certificatesDir: /etc/kubernetes/pki
    `;

    // Write the kubeadm config to a file on the node
    await executeSSH(
      controlPlaneNode.publicIp,
      sh`cat > /tmp/kubeadm-config.yaml <<< "${kubeadmConfigYaml}"`
    );

    // Initialize the cluster with kubeadm using the config file
    await executeSSH(
      controlPlaneNode.publicIp,
      sh`kubeadm init --config=/tmp/kubeadm-config.yaml --upload-cert`
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
          await this.nodeProvisioner.deprovisionNode({
            clusterId, 
            nodeId: node.id
          });
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
      region: "eu",
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
    await this.nodeProvisioner.deprovisionNode({
      clusterId,
      nodeId: nodeToRemove.id
    });
  }
}
