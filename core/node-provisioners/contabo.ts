import { readFile } from "../utils.ts";
import * as process from "node:process";
import { ListNodeOptions, Node, NodeRoles, ProvisionNodeOptions } from "./mod.ts";
import { AbstractNodeProvisioner } from "./abstract.ts";
import { ContaboProvider, ContaboRegion, ContaboInstance, ContaboPrivateNetwork } from "../cloud-providers/contabo.ts";
import { hash, randomBytes, randomInt } from "node:crypto";

export class ContaboNodeProvisioner extends AbstractNodeProvisioner {
  constructor(private provider: ContaboProvider) {
    super();
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
      const privateNetworkId = await this.provider.ensurePrivateNetwork({
        name: `cluster_${options.clusterId}_${region}`,
        region,
      });
      const instanceId = await this.provider.ensureInstance({
        provisioning: "manual",
        displayName: `cluster_${options.clusterId}_${hash("sha256", randomBytes(16), "hex").substring(0, 8)}_${roles.join("_")}`,
        sshKeys: [
          await this.provider.ensureSshKey({
            name: `cluster_${options.clusterId}_${region}`,
            value: await readFile("public.key"),
          }),
        ],
        privateNetworks: [privateNetworkId],
        // TODO: add custom minimum cpu & memory
        productId: "V78",
      });

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
        sshKeys: [],
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
