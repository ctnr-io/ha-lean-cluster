import { readFile } from "../../api/utils.ts";
import * as process from "node:process";
import {  ListNodeOptions, Node, NodeRoles, ProvisionNodeOptions } from "./index.ts";
import { ContaboContext, ContaboRegion } from "../cloud-providers/contabo.ts";
import { ContaboProvider } from "../cloud-providers/index.ts";
import { generateNodeId, generateNodeNetworkId, retrieveDataFromNodeId } from "./_common.ts";

async function ensureSshKey(ctx: ContaboContext, options: { name: string; value: string }): Promise<number> {
  const { name, value } = options;
  const sshKeys = await ContaboProvider.getSecrets(ctx, { type: "ssh", name });
  if (sshKeys.length === 0) {
    return await ContaboProvider.createSecret(ctx, { type: "ssh", name, value });
  }
  return sshKeys[0].secretId;
}

async function ensurePrivateNetwork(
  ctx: ContaboContext,
  options: { name: string; region: ContaboRegion }
): Promise<number> {
  const privateNetworks = await ContaboProvider.listPrivateNetworks(ctx, { name: options.name });
  if (privateNetworks.length === 0) {
    return await ContaboProvider.createPrivateNetwork(ctx, options);
  }
  return privateNetworks[0].privateNetworkId;
}

async function ensureInstance(
  ctx: ContaboContext,
  options: {
    mode: "auto" | "manual";
    displayName: string;
    sshKeys: number[];
  }
): Promise<number> {
  const { mode, displayName, sshKeys } = options;
  const instance = await ContaboProvider.getAvailableInstance(ctx);
  if (instance) {
    // reinstall instance
    return await ContaboProvider.reinstallInstance(ctx, {
      instanceId: instance.instanceId,
      sshKeys,
      displayName,
    });
  }
  if (mode === "auto") {
    // create instance
    return await ContaboProvider.createInstance(ctx, options);
  }
  throw new Error(
    "Automatic provisioning disabled, no available instances found, please provision instances in Contabo first"
  );
}

const regionMatch: Record<ProvisionNodeOptions["region"], ContaboRegion> = {
  europe: "EU",
};

export async function provisionNode(ctx: ContaboContext, options: ProvisionNodeOptions): Promise<Node> {
  try {
    // TODO: add custom minimum cpu & memory
    // Provision instance and assign it to private network
    const region = regionMatch[options.region];
    // unique roles orderby NodeRoles order 
    const roles = options.roles.sort((a, b) => {
      const aIndex = NodeRoles.indexOf(a);
      const bIndex = NodeRoles.indexOf(b);
      return aIndex - bIndex;
    });
    const privateNetworkId = await ensurePrivateNetwork(ctx, {
      name: `cluster-${options.clusterId}-${region}`,
      region,
    });
    const instanceId = await ensureInstance(ctx, {
      mode: "manual",
      displayName: `cluster-${options.clusterId}-${region}-${roles.join("-")}`,
      sshKeys: [
        await ensureSshKey(ctx, {
          name: process.env.DOMAIN_NAME,
          value: await readFile("private.key"),
        }),
      ],
    });
    await ContaboProvider.assignPrivateNetwork(ctx, privateNetworkId, instanceId);

    // Find instance in private network
    const privateNetwork = await ContaboProvider.getPrivateNetwork(ctx, privateNetworkId);
    const instance = privateNetwork.instances.find((instance) => instance.instanceId === instanceId);
    if (!instance) {
      throw new Error("Instance not found in private network");
    }

    // Transform instance to node
    return {
      clusterId: options.clusterId,
      networkId: generateNodeNetworkId({
        clusterId: options.clusterId,
        provider: "contabo",
        providerCustomerId: privateNetwork.customerId,
        privateNetworkId: String(privateNetworkId),
      }),
      id: generateNodeId({
        clusterId: options.clusterId,
        provider: "contabo",
        providerCustomerId: privateNetwork.customerId,
        privateNetworkId: String(privateNetworkId),
        instanceId: String(instanceId),
      }),
      publicIp: instance.ipConfig.v4.ip,
      privateIp: instance.privateIpConfig.v4[0].ip,
      networkCIDR: privateNetwork.cidr,
      roles: [],
    };
  } catch (error) {
    throw new Error(`Failed to provision node, rolling back`, { cause: error });
  }
}

export async function deprovisionNode(ctx: ContaboContext, id: string): Promise<void> {
  const data = retrieveDataFromNodeId(id);
  const [privateNetworkId, instanceId] = [
    Number.parseInt(String(data.privateNetworkId)),
    Number.parseInt(String(data.instanceId)),
  ];
  await Promise.all([
    ContaboProvider.unassignPrivateNetwork(ctx, privateNetworkId, instanceId),
    ContaboProvider.reinstallInstance(ctx, {
      instanceId,
      displayName: "",
      sshKeys: [
        await ensureSshKey(ctx, {
          name: process.env.DOMAIN_NAME,
          value: await readFile("private.key"),
        }),
      ],
    }),
  ]);
}

export async function listNodes(ctx: ContaboContext, options: ListNodeOptions): Promise<Node[]> {
  const privateNetworks = await ContaboProvider.listPrivateNetworks(ctx, { name: `cluster-${options.clusterId}` });
  return privateNetworks.map(privateNetwork => privateNetwork.instances.map((instance) => {
    const roles = instance.displayName.replace(new RegExp(`cluster-${options.clusterId}-.+-`), '').split("-") as NodeRoles; 
    return {
      clusterId: options.clusterId,
      id: generateNodeId({
        clusterId: options.clusterId,
        provider: "contabo",
        providerCustomerId: privateNetwork.customerId,
        privateNetworkId: String(privateNetwork.privateNetworkId),
        instanceId: String(instance.instanceId),
      }),
      networkId: generateNodeNetworkId({
        clusterId: options.clusterId,
        provider: "contabo",
        providerCustomerId: privateNetwork.customerId,
        privateNetworkId: String(privateNetwork.privateNetworkId),
      }),
      publicIp: instance.ipConfig.v4.ip,
      privateIp: instance.privateIpConfig.v4[0].ip,
      networkCIDR: privateNetwork.cidr,
      roles,
    };
  })).flat();
}

export async function getNode(ctx: ContaboContext, nodeId: string): Promise<Node> {
  const data = retrieveDataFromNodeId(nodeId);
  const privateNetwork = await ContaboProvider.getPrivateNetwork(ctx, parseInt(data.privateNetworkId));
  const instance = privateNetwork.instances.find((instance) => instance.instanceId === parseInt(data.instanceId));
  if (!instance) {
    throw new Error(`Instance not found`);
  }
  return {
    clusterId: data.clusterId,
    id: nodeId,
    networkId: generateNodeNetworkId({
      clusterId: data.clusterId,
      provider: "contabo",
      providerCustomerId: data.providerCustomerId,
      privateNetworkId: data.privateNetworkId,
    }),
    publicIp: instance.ipConfig.v4.ip,
    privateIp: instance.privateIpConfig.v4[0].ip,
    networkCIDR: data.privateNetworkId,
    roles: instance.displayName.replace(new RegExp(`cluster-${data.clusterId}-.+-`), '').split("-") as NodeRoles,
  };
}