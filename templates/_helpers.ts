export const { default: instances } = await import("../.cntb/instances.json", { with: { type: "json" } });
export const { default: privateNetworks } = await import("../.cntb/private-networks.json", { with: { type: "json" } });

type ContaboInstance = (typeof instances)[number];

const KubesprayNodeRoles = ["control-plane", "etcd", "worker"] as const;
type KubesprayNodeRoles = (typeof KubesprayNodeRoles)[number][];

type KubesprayNode = {
  name: string;
  ansible_host: string;
  ip: string;
  readonly roles: KubesprayNodeRoles;
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

const getKubesprayNodeRoles = (instance: ContaboInstance): KubesprayNodeRoles => {
  const roles = [...new Set(KubesprayNodeRoles.filter((role) => instance.displayName.includes(role)))];
  return roles;
};

const transformToKubesprayNode = (instance: ContaboInstance): KubesprayNode => {
  return {
    name: instance.name,
    ansible_host: instance.ipv4,
    ip: getPrivateIp(instance),
    roles: getKubesprayNodeRoles(instance),
  };
};

export const transformKubesprayNodeToString = (node: KubesprayNode): string => {
  return `${node.name}\tansible_host=${node.ansible_host}\tip=${node.ip}\t# roles=${node.roles.join(",")}`;
};

// Sort nodes by roles to ensure that control-plane nodes are first or by name if roles are the same
const sortKubesprayNodes = (a: KubesprayNode, b: KubesprayNode) => {
  const aIndex = KubesprayNodeRoles.indexOf(a.roles[0]);
  const bIndex = KubesprayNodeRoles.indexOf(b.roles[0]);
  return aIndex - bIndex ? aIndex - bIndex : a.name.localeCompare(b.name);
};

const kubesprayNodes = instances.map(transformToKubesprayNode).sort(sortKubesprayNodes);

export const controlPlanes = kubesprayNodes.filter((node) => node.roles.includes("control-plane"));
export const etcds = kubesprayNodes.filter((node) => node.roles.includes("etcd"));
export const workers = kubesprayNodes.filter((node) => node.roles.includes("worker"));

if (controlPlanes.length === 0) {
  throw new Error("No control-plane nodes found");
}
if (etcds.length === 0) {
  throw new Error("No etcd nodes found");
}
if (workers.length === 0) {
  throw new Error("No worker nodes found");
}


