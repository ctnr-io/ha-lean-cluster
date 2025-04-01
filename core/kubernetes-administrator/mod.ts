import { Node, NodeProvisioner, NodeRoles } from "../node-provisioners/mod.ts";
import { executeSSH, sh } from "../utils.ts";
import { hash, randomUUID } from "node:crypto";
import { KubernetesAdministratorV1_32 } from "./v1_32.ts";

export interface ClusterContext<NodeProvisionerContext = unknown> {
  nodeProvisioner: NodeProvisioner;
  nodeProvisionerContext: NodeProvisionerContext;
}

export interface Cluster {
  id: string;
  name: string;
  domainName: string;
  k8sVersion: string;
  cni: "calico" | "flannel";
  podCidr: string;
  serviceCidr: string;
  controlPlaneEndpoint: string;
  nodes: Node[];
  kubeconfig?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EtcdOptions {
  /** Directory where etcd data is stored */
  dataDir?: string;
  /** Auto compaction retention for mvcc key value store in hour */
  compactionRetention?: number;
  /** Etcd quota backend bytes (default: 2GB) */
  quotaBackendBytes?: string;
  /** Maximum client request size in bytes the server will accept */
  maxRequestBytes?: string;
  /** Set level of detail for etcd exported metrics (basic or extensive) */
  metrics?: "basic" | "extensive";
}

export interface EtcdBackupOptions {
  /** Path where the backup file will be stored */
  backupPath?: string;
}

export interface EtcdRestoreOptions {
  /** Path to the backup file to restore from */
  backupPath: string;
}

export interface EtcdHealthStatus {
  /** Whether all etcd endpoints are healthy */
  healthy: boolean;
  /** Number of healthy etcd endpoints */
  healthyEndpoints: number;
  /** Total number of etcd endpoints */
  totalEndpoints: number;
  /** Number of etcd members */
  members: number;
  /** Whether there are any active alarms */
  hasAlarms: boolean;
  /** Raw output from etcd health check */
  healthOutput: string;
  /** Raw output from etcd member list */
  membersOutput: string;
  /** Raw output from etcd alarm list */
  alarmsOutput: string;
}

export interface CreateClusterOptions {
  domainName: string;
  k8sVersion?: string;
  cni?: "calico" | "flannel";
  podCidr?: string;
  serviceCidr?: string;
  /** Options for etcd configuration */
  etcdOptions?: EtcdOptions;
}

export interface AddNodeOptions {
  clusterId: string;
  roles: NodeRoles;
}

export interface UpgradeClusterOptions {
  k8sVersion: string;
  cni: "calico" | "flannel";
  podCidr: string;
  serviceCidr: string;
  controlPlaneNodes: number;
  workerNodes: number;
  etcdNodes: number;
  clusterId: string;
}

export interface KubernetesAdministrator {
  createCluster(options: CreateClusterOptions): Promise<string>;
  deleteCluster(clusterId: string): Promise<void>;
  addNode(options: AddNodeOptions): Promise<Node>;
  removeNode(clusterId: string, nodeId: string): Promise<void>;
  
  /**
   * Upgrade the Kubernetes cluster to a the next available version
   * @returns {KubernetesAdministrator} - The upgraded Kubernetes administrator instance
   * @throws {Error} - If the upgrade fails or next version is not implemented
   */
  upgradeCluster(clusterId: string, options: UpgradeClusterOptions): Promise<KubernetesAdministrator>;
  
  /**
   * Create a backup of the etcd data
   * @param clusterId The ID of the cluster
   * @param options Backup options
   * @returns Path to the backup file
   */
  backupEtcd(clusterId: string, options?: EtcdBackupOptions): Promise<string>;
  
  /**
   * Restore etcd from a backup
   * @param clusterId The ID of the cluster
   * @param options Restore options
   */
  restoreEtcd(clusterId: string, options: EtcdRestoreOptions): Promise<void>;
  
  /**
   * Check the health of the etcd cluster
   * @param clusterId The ID of the cluster
   * @returns Health status of the etcd cluster
   */
  checkEtcdHealth(clusterId: string): Promise<EtcdHealthStatus>;
}

export const createKubernetesAdministrator = (version: "1.32", nodeProvisioner: NodeProvisioner): KubernetesAdministrator => {
  switch (version) {
    case "1.32":
      return new KubernetesAdministratorV1_32(nodeProvisioner);
    default:
      throw new Error(`Unsupported Kubernetes version: ${version}`);
  }
};
