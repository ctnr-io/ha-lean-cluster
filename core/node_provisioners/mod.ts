export type NodeRoles = (typeof NodeRoles)[number][];
export const NodeRoles = ["control-plane", "etcd", "worker"] as const;

export interface Node {
  clusterId: string; 
  id: string;
  name: string;
  publicIp: string;
  // privateIp: string;
  // networkCIDR: string;
}

export interface ProvisionNodeOptions {
  /**
   * Mode of provisioning
   * - 'auto': Automatically provision a node on the provider if no one is available
   * - 'manual': Throw an error if no node is available on the provider
   */
  mode: "auto" | "manual";
  region: "eu";
  clusterId: string;
  peerNodesIds?: string[];
  sshPublicKey: string;
}

export interface DeprovisionNodeOptions {
  clusterId: string;
  nodeId: string;
}

export type NodeRegion = "eu";
export type NodeProviderSlug = 'cntb';

export interface ListNodesOptions {
  clusterId: string;
  withError?: boolean;
  pageSize?: number;
}

export interface GetNodeOptions {
  clusterId: string;
  nodeId: string;
}

export interface NodeProvisioner {
  provisionNode: (options: ProvisionNodeOptions) => Promise<Node>;
  deprovisionNode: (options: DeprovisionNodeOptions) => Promise<void>;
  listNodes: (options: ListNodesOptions) => AsyncGenerator<Node>;
  getNode: (options: GetNodeOptions) => Promise<Node>;
}

export type NodeProvider = "contabo";
