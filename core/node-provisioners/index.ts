import { ContaboContext } from "../cloud-providers/contabo.ts";

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
  region: "europe";
  clusterId: string;
  roles: NodeRoles;
}

export interface ListNodeOptions {
  clusterId: string;
}

export interface NodeProvisioner<Context = unknown> {
  provisionNode: (ctx: Context, options: ProvisionNodeOptions) => Promise<Node>;
  deprovisionNode: (ctx: Context, id: string) => Promise<void>;
  listNodes: (ctx: Context, options: ListNodeOptions) => Promise<Node[]>;
}

export type NodeProvider = "contabo" | "linode";

export const contabo = await import('./contabo.ts') satisfies NodeProvisioner<ContaboContext>;