import { Node, NodeProvisioner, NodeRoles } from "../node-provisioners/index.ts";
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

export interface InitClusterOptions {
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
  initCluster(options: InitClusterOptions): Promise<string>;
  deleteCluster(clusterId: string): Promise<void>;
  addNode(options: AddNodeOptions): Promise<Node>;
  removeNode(clusterId: string, nodeId: string): Promise<void>;
  upgradeCluster(clusterId: string, options: UpgradeClusterOptions): Promise<void>;
}

export const createKubernetesAdministrator = (version: "1.32", nodeProvisioner: NodeProvisioner): KubernetesAdministrator => {
  switch (version) {
    case "1.32":
      return new KubernetesAdministratorV1_32(nodeProvisioner);
    default:
      throw new Error(`Unsupported Kubernetes version: ${version}`);
  }
};