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

export interface CreateClusterOptions {
  domainName: string;
  k8sVersion?: string;
  cni?: "calico" | "flannel";
  podCidr?: string;
  serviceCidr?: string;
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
}

export const createKubernetesAdministrator = (version: "1.32", nodeProvisioner: NodeProvisioner): KubernetesAdministrator => {
  switch (version) {
    case "1.32":
      return new KubernetesAdministratorV1_32(nodeProvisioner);
    default:
      throw new Error(`Unsupported Kubernetes version: ${version}`);
  }
};