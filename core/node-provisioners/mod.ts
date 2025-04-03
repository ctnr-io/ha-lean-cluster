export type NodeRoles = (typeof NodeRoles)[number][];
export const NodeRoles = ["control-plane", "etcd", "worker"] as const;

export interface Node {
  clusterId: string; 
  id: string;
  publicIp: string;
  privateIp: string;
  /*
   * The network ID
   * Determine which node can communicate with which other nodes internally
   * Node communicating internally don't pay for bandwidth
   * It also improve node communication speed
   */
  networkId: string;
  networkCIDR: string;
  roles: NodeRoles;
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
  roles: NodeRoles;
}

export interface DeprovisionNodeOptions {
  clusterId: string;
  nodeId: string;
}

export type NodeRegion = "eu";
export type NodeProviderSlug = 'cntb';

export interface ListNodeOptions {
  clusterId: string;
}

export interface GetNodeOptions {
  clusterId: string;
  nodeId: string;
}

export interface NodeProvisioner {
  provisionNode: (options: ProvisionNodeOptions) => Promise<Node>;
  deprovisionNode: (options: DeprovisionNodeOptions) => Promise<void>;
  listNodes: (options: ListNodeOptions) => Promise<Node[]>;
  getNode: (options: GetNodeOptions) => Promise<Node>;
}

export type NodeProvider = "contabo";
