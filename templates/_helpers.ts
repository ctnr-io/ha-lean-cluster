export const { default: instances } = await import("../.cntb/instances.json", { with: { type: "json" } });
export const { default: privateNetworks } = await import("../.cntb/private-networks.json", { with: { type: "json" } });

type ContaboInstance = (typeof instances)[number];

const NodeRoles = ["control-plane", "etcd", "worker"] as const;
type NodeRoles = (typeof NodeRoles)[number][];

type Node = {
  name: string;
  publicIp: string;
  privateIp: string;
  readonly roles: NodeRoles;
};

export const domainName = "ctnr.io";

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

const getNodeRoles = (instance: ContaboInstance): NodeRoles => {
  const roles = [...new Set(NodeRoles.filter((role) => instance.displayName.includes(role)))];
  return roles;
};

const transformToNode = (instance: ContaboInstance): Node => {
  return {
    name: instance.name,
    publicIp: instance.ipv4,
    privateIp: getPrivateIp(instance),
    roles: getNodeRoles(instance),
  };
};

export const transformNodeToString = (node: Node): string => {
  return `${node.name}\tansible_host=${node.publicIp}\tip=${node.privateIp}\t# roles=${node.roles.join(",")}`;
};

// Sort nodes by roles to ensure that control-plane nodes are first or by name if roles are the same
const sortNodes = (a: Node, b: Node) => {
  const aIndex = NodeRoles.indexOf(a.roles[0]);
  const bIndex = NodeRoles.indexOf(b.roles[0]);
  return aIndex - bIndex ? aIndex - bIndex : a.name.localeCompare(b.name);
};

const Nodes = instances.map(transformToNode).sort(sortNodes);

export const controlPlanes = Nodes.filter((node) => node.roles.includes("control-plane"));
export const etcds = Nodes.filter((node) => node.roles.includes("etcd"));
export const workers = Nodes.filter((node) => node.roles.includes("worker"));

if (controlPlanes.length === 0) {
  throw new Error("No control-plane nodes found");
}
if (etcds.length === 0) {
  throw new Error("No etcd nodes found");
}
if (workers.length === 0) {
  throw new Error("No worker nodes found");
}

export const apiserverIp = controlPlanes[0].publicIp;
export const apiserverPort = 6443;