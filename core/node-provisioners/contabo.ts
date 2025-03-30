import { readFile } from "../utils.ts";
import * as process from "node:process";
import { ListNodeOptions, Node, NodeRoles, ProvisionNodeOptions } from "./mod.ts";
import { AbstractNodeProvisioner } from "./abstract.ts";
import { ContaboProvider, ContaboRegion, ContaboInstance, ContaboPrivateNetwork } from "../cloud-providers/contabo.ts";

export class ContaboNodeProvisioner extends AbstractNodeProvisioner {
  constructor(private provider: ContaboProvider) {
    super();
  }

  private async getAvailableInstance(): Promise<ContaboInstance | null> {
    for (let page = 0; page < Infinity; page++) {
      const instances = await this.provider.listInstances({ page });
      if (instances.length === 0) {
        return null;
      }
      // find the first available instance
      const availableInstance = instances.find(
        (instance) => instance.displayName === "" && instance.status === "running"
      );
      if (availableInstance) {
        await this.provider.setInstanceDisplayName(availableInstance.instanceId, "claimed");
        return availableInstance;
      }
    }
    return null;
  }

  async ensureSshKey(options: { name: string; value: string }): Promise<number> {
    const { name, value } = options;
    const sshKeys = await this.provider.listSecrets({ type: "ssh", name });
    if (sshKeys.length === 0) {
      return await this.provider.createSecret({ type: "ssh", name, value });
    }
    return sshKeys[0].secretId;
  }

  async ensurePrivateNetwork(options: { name: string; region: ContaboRegion }): Promise<number> {
    const privateNetworks = await this.provider.listPrivateNetworks({ name: options.name });
    if (privateNetworks.length === 0) {
      return await this.provider.createPrivateNetwork(options);
    }
    return privateNetworks[0].privateNetworkId;
  }

  async ensureInstance(options: { mode: "auto" | "manual"; displayName: string; sshKeys: number[] }): Promise<number> {
    const { mode, displayName, sshKeys } = options;
    const instance = await this.getAvailableInstance();
    if (instance) {
      // reinstall instance
      const instanceId = await this.provider.reinstallInstance({
        instanceId: instance.instanceId,
        sshKeys,
      });
      await this.provider.setInstanceDisplayName(instanceId, displayName);
      return instanceId;
    }
    if (mode === "auto") {
      // create instance
      return await this.provider.createInstance({ productId: "V78", sshKeys, displayName });
    }
    throw new Error(
      "Automatic provisioning disabled, no available instances found, please provision instances in Contabo first"
    );
  }

  private static getRolesFromInstanceDisplayName(options: { clusterId: string; displayName: string }): NodeRoles {
    const { clusterId, displayName } = options;
    return displayName.replace(new RegExp(`cluster_${clusterId}_.+_`), "").split("_") as NodeRoles;
  }

  private static transformPrivateNetworkInstanceToNode(options: {
    clusterId: string;
    privateNetwork: ContaboPrivateNetwork;
    instance: ContaboPrivateNetwork["instances"][number];
  }): Node {
    const { clusterId, privateNetwork, instance } = options;
    const privateNetworkId = privateNetwork.privateNetworkId;
    const instanceId = instance.instanceId;
    return {
      clusterId: clusterId,
      networkId: this.generateNodeNetworkId({
        clusterId: clusterId,
        provider: "contabo",
        providerCustomerId: privateNetwork.customerId,
        privateNetworkId: String(privateNetworkId),
      }),
      id: this.generateNodeId({
        clusterId: clusterId,
        provider: "contabo",
        providerCustomerId: privateNetwork.customerId,
        privateNetworkId: String(privateNetworkId),
        instanceId: String(instanceId),
      }),
      publicIp: instance.ipConfig.v4.ip,
      privateIp: instance.privateIpConfig.v4[0].ip,
      networkCIDR: privateNetwork.cidr,
      roles: this.getRolesFromInstanceDisplayName({
        clusterId: clusterId,
        displayName: instance.displayName,
      }),
    };
  }

  static RegionMatch: Record<ProvisionNodeOptions["region"], ContaboRegion> = {
    europe: "EU",
  };

  async provisionNode(options: ProvisionNodeOptions): Promise<Node> {
    try {
      // TODO: add custom minimum cpu & memory
      // Provision instance and assign it to private network
      const region = ContaboNodeProvisioner.RegionMatch[options.region];
      // unique roles orderby NodeRoles order
      const roles = options.roles.sort((a, b) => {
        const aIndex = NodeRoles.indexOf(a);
        const bIndex = NodeRoles.indexOf(b);
        return aIndex - bIndex;
      });
      const privateNetworkId = await this.ensurePrivateNetwork({
        name: `cluster-${options.clusterId}-${region}`,
        region,
      });
      const instanceId = await this.ensureInstance({
        mode: "manual",
        displayName: `cluster_${options.clusterId}_${region}_${roles.join("_")}`,
        sshKeys: [
          await this.ensureSshKey({
            name: process.env.DOMAIN_NAME,
            value: await readFile("private.key"),
          }),
        ],
      });
      await this.provider.assignPrivateNetwork(privateNetworkId, instanceId);

      // Find instance in private network
      const privateNetwork = await this.provider.getPrivateNetwork(privateNetworkId);
      const instance = privateNetwork.instances.find((instance) => instance.instanceId === instanceId);
      if (!instance) {
        throw new Error("Instance not found in private network");
      }

      // Transform instance to node
      return ContaboNodeProvisioner.transformPrivateNetworkInstanceToNode({
        clusterId: options.clusterId,
        privateNetwork,
        instance,
      });
    } catch (error) {
      throw new Error(`Failed to provision node, rolling back`, { cause: error });
    }
  }

  async deprovisionNode(id: string): Promise<void> {
    const data = ContaboNodeProvisioner.retrieveDataFromNodeId(id);
    const [privateNetworkId, instanceId] = [
      Number.parseInt(String(data.privateNetworkId)),
      Number.parseInt(String(data.instanceId)),
    ];
    await this.provider.unassignPrivateNetwork(privateNetworkId, instanceId).catch(() => {});
    await this.provider
      .reinstallInstance({
        instanceId,
        sshKeys: [
          await this.ensureSshKey({
            name: process.env.DOMAIN_NAME,
            value: await readFile("private.key"),
          }),
        ],
      })
      .catch(() => {});
    await this.provider.setInstanceDisplayName(instanceId, "");
  }

  async listNodes(options: ListNodeOptions): Promise<Node[]> {
    const privateNetworks = await this.provider.listPrivateNetworks({ name: `cluster_${options.clusterId}` });
    return privateNetworks
      .map((privateNetwork) =>
        privateNetwork.instances.map((instance) => {
          return ContaboNodeProvisioner.transformPrivateNetworkInstanceToNode({
            clusterId: options.clusterId,
            privateNetwork,
            instance,
          });
        })
      )
      .flat();
  }

  async getNode(nodeId: string): Promise<Node> {
    const data = ContaboNodeProvisioner.retrieveDataFromNodeId(nodeId);
    const privateNetwork = await this.provider.getPrivateNetwork(parseInt(data.privateNetworkId));
    const instance = privateNetwork.instances.find((instance) => instance.instanceId === parseInt(data.instanceId));
    if (!instance) {
      throw new Error(`Instance not found`);
    }
    return ContaboNodeProvisioner.transformPrivateNetworkInstanceToNode({
      clusterId: data.clusterId,
      privateNetwork,
      instance,
    });
  }
}
