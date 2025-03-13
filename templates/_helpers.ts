import * as process from "node:process";

const { default: allInstances } = await import("../.cntb/instances.json", { with: { type: "json" } });
const { default: allPrivateNetworks } = await import("../.cntb/private-networks.json", { with: { type: "json" } });

export const domainName = process.env.DOMAIN_NAME;
if (!domainName) {
  throw new Error("DOMAIN_NAME environment variable is required");
}

export const instances = allInstances.filter((instance) => instance.displayName.startsWith(`${domainName}-`));
export const privateNetworks = allPrivateNetworks.filter((network) => network.name.startsWith(`${domainName}-`));

type ContaboInstance = (typeof instances)[number];

/**
 * Node roles supported by the cluster
 * 
 * Naming convention for Contabo VPS instances:
 * Each node name should start with the domain name prefix (${domainName}-) followed by the role:
 * - Control Plane Nodes: <domain-name>-control-plane-X[-etcd][-worker] (where X is the index: 0, 1, 2, etc.)
 * - ETCD Nodes: <domain-name>-etcd-X (where X is the index: 0, 1, 2, etc.)
 * - Worker Nodes: <domain-name>-worker-X[-etcd] (where X is the index: 0, 1, 2, etc.)
 * 
 * Examples:
 * - <domain-name>-control-plane-0: A node that serves only as a control plane
 * - <domain-name>-control-plane-0-etcd: A node that serves as both control plane and etcd
 * - <domain-name>-control-plane-0-etcd-worker: A node that serves as control plane, etcd, and worker
 * - <domain-name>-etcd-0: A node that serves only as etcd
 * - <domain-name>-worker-0: A node that serves only as a worker
 * - <domain-name>-worker-0-etcd: A node that serves as both worker and etcd
 * 
 * ⚠️ IMPORTANT: DO NOT change the first control plane node (<domain-name>-control-plane-0) without understanding 
 * the implications! See README.md for more details.
 */
export const NodeRoles = ["control-plane", "etcd", "worker"] as const;
export type NodeRoles = (typeof NodeRoles)[number][];

export type Node = {
  name: string;
  publicIp: string;
  privateIp: string;
  readonly roles: NodeRoles;
  /** Index of the node within its primary role (e.g., 0 for control-plane-0) */
  index?: number;
};


/**
 * Validate that each instances has the same private IPs in all private networks to facilitate node communication
 * Currently, some instance fail to be connected to the private network, so I accept no 
 */
const getPrivateIp = (instance: ContaboInstance): string => {
  const privateIps = [
    ...new Set(
      privateNetworks.map((network) => {
        return network.instances.find((node) => node.instanceId === instance.instanceId)?.privateIpConfig.v4[0].ip;
      })
    ),
  ];
  if (privateIps.length === 0) {
    throw new Error(`Instance ${instance.displayName} has no private IPs`);
  }
  if (privateIps.length > 1) {
    throw new Error(
      `Instance ${instance.displayName} has different private IPs in different private networks: ${Array.from(privateIps).join(
        ", "
      )}`
    );
  }
  return privateIps[0]!;
};

/**
 * Extract node roles from the instance display name based on the naming convention.
 * The display name should follow the format:
 * - <domain-name>-control-plane-X[-etcd][-worker]
 * - <domain-name>-etcd-X
 * - <domain-name>-worker-X[-etcd]
 * 
 * @param instance The Contabo instance
 * @returns Array of node roles
 */
const getNodeRoles = (instance: ContaboInstance): NodeRoles => {
  const roles = [...new Set(NodeRoles.filter((role) => instance.displayName.includes(role)))];
  return roles;
};

/**
 * Extract the node index from the display name.
 * For example, from "<domain-name>-control-plane-0" it extracts 0.
 * 
 * @param instance The Contabo instance
 * @param role The primary role to extract index for
 * @returns The node index or undefined if not found
 */
const getNodeIndex = (instance: ContaboInstance, role: string): number | undefined => {
  const regex = new RegExp(`${role}-(\\d+)`);
  const match = instance.displayName.match(regex);
  return match ? parseInt(match[1], 10) : undefined;
};

/**
 * Transform a Contabo instance to a Node object.
 * Ensures that the instance name starts with the domain name prefix.
 * 
 * @param instance The Contabo instance
 * @returns Node object with name, IPs, roles, and index
 */
const transformToNode = (instance: ContaboInstance): Node => {
  const roles = getNodeRoles(instance);
  const primaryRole = roles[0]; // First role is considered primary
  
  // Ensure the node name starts with the domain name prefix
  if (!instance.displayName.startsWith(`${domainName}-`)) {
    throw new Error(`Node name ${instance.name} does not start with the domain name prefix ${domainName}-`);
  }

  return {
    name: instance.name,
    publicIp: instance.ipv4,
    privateIp: getPrivateIp(instance),
    roles: roles,
    index: primaryRole ? getNodeIndex(instance, primaryRole) : undefined,
  };
};

/**
 * Sort nodes by roles and indices.
 * 1. First by role priority (control-plane, etcd, worker)
 * 2. Then by node index within the same role
 * 3. Finally by name if roles and indices are the same
 * 
 * This ensures that control-plane-0 comes before control-plane-1, etc.
 * 
 * @param a First node
 * @param b Second node
 * @returns Sort order (-1, 0, 1)
 */
const sortNodes = (a: Node, b: Node) => {
  // First sort by role priority
  const aRoleIndex = NodeRoles.indexOf(a.roles[0]);
  const bRoleIndex = NodeRoles.indexOf(b.roles[0]);
  
  if (aRoleIndex !== bRoleIndex) {
    return aRoleIndex - bRoleIndex;
  }
  
  // If roles are the same, sort by node index
  if (a.index !== undefined && b.index !== undefined) {
    return a.index - b.index;
  } else if (a.index !== undefined) {
    return -1; // Nodes with index come first
  } else if (b.index !== undefined) {
    return 1;
  }
  
  // If roles and indices are the same or undefined, sort by name
  return a.name.localeCompare(b.name);
};

export const nodes = instances.map(transformToNode).sort(sortNodes);

export const controlPlanes = nodes.filter((node) => node.roles.includes("control-plane"));
export const etcds = nodes.filter((node) => node.roles.includes("etcd"));
export const workers = nodes.filter((node) => node.roles.includes("worker"));

if (controlPlanes.length === 0) {
  throw new Error("No control-plane nodes found");
}
if (etcds.length === 0) {
  throw new Error("No etcd nodes found");
}
if (workers.length === 0) {
  throw new Error("No worker nodes found");
}

/**
 * ⚠️ IMPORTANT: The first control plane node (<domain-name>-control-plane-0) is used as the API server by default.
 * Changing or removing this node without proper procedure can cause the entire cluster to fail.
 * See README.md for more details on the proper procedure for replacing the first control plane node.
 */
// Use private IP for internal cluster communication (for kubeadm join operations)
// Public IP is not accessible from inside the nodes
export const apiserverPrivateIp = controlPlanes[0].privateIp;
export const apiserverPublicIp = controlPlanes[0].publicIp;
export const apiserverPort = 6443;
