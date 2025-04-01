import { readFile } from "../utils.ts";
import {
  DeprovisionNodeOptions,
  GetNodeOptions,
  ListNodeOptions,
  Node,
  NodeRoles,
  ProvisionNodeOptions,
} from "./mod.ts";
import { AbstractNodeProvisioner, NodeProvisioningReportError } from "./abstract.ts";
import { ContaboProvider, ContaboRegion, ContaboPrivateNetwork, ContaboInstance } from "../cloud-providers/contabo.ts";

export class ContaboNodeProvisioner extends AbstractNodeProvisioner {
  constructor(private provider: ContaboProvider) {
    super();
  }

  protected getProviderSlug(): "cntb" {
    return "cntb";
  }

  private static getRolesFromInstance(instance: { displayName: string }): NodeRoles {
    return [
      ...new Set(
        instance.displayName
          .replace(/.*role=([cew]+).*/, "$1")
          .split("")
          .map((r) => {
            switch (r) {
              case "c":
                return "control-plane";
              case "e":
                return "etcd";
              case "w":
                return "worker";
            }
          })
      ),
    ] as NodeRoles;
  }
  private static getDisplayNameRolesFromRoles(options: { roles: NodeRoles }): string {
    return [...new Set(options.roles.sort().map((r) => r[0]))].join("");
  }
  private static getNetworkIdFromPrivateNetwork(privateNetwork: { name: string }): string {
    return (
      privateNetwork.name
        .split(" ")
        .find((name) => name.startsWith("network="))
        ?.split("=")[1] ?? ""
    );
  }
  private static getNodeIdFromInstance(instance: { displayName: string }): string {
    return (
      instance.displayName
        .split(" ")
        .find((name) => name.startsWith("node="))
        ?.split("=")[1] ?? ""
    );
  }

  private static transformPrivateNetworkInstanceToNode(options: {
    clusterId: string;
    privateNetwork: ContaboPrivateNetwork;
    instance: ContaboPrivateNetwork["instances"][number];
  }): Node {
    const { clusterId, privateNetwork, instance } = options;
    return {
      clusterId: clusterId,
      networkId: ContaboNodeProvisioner.getNetworkIdFromPrivateNetwork(privateNetwork),
      id: ContaboNodeProvisioner.getNodeIdFromInstance(instance),
      publicIp: instance.ipConfig.v4.ip,
      privateIp: instance.privateIpConfig.v4[0].ip,
      networkCIDR: privateNetwork.cidr,
      roles: this.getRolesFromInstance(instance),
    };
  }

  static RegionMatch: Record<ProvisionNodeOptions["region"], ContaboRegion> = {
    eu: "EU",
  };

  async provisionNode(options: ProvisionNodeOptions): Promise<Node> {
    for (let retry = 0; retry < 3; retry++) {
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
        name: [`cluster=${options.clusterId}`, `network=${ContaboNodeProvisioner.generateNodeNetworkId()}`].join(" "),
        region,
      });
      const nodeId = ContaboNodeProvisioner.generateNodeId();
      const instanceId = await this.provider.ensureInstance({
        provisioning: "manual",
        displayName: [
          `cluster=${options.clusterId}`,
          `node=${nodeId}`,
          `role=${ContaboNodeProvisioner.getDisplayNameRolesFromRoles({ roles })}`,
        ].join(" "),
        sshKeys: [
          await this.provider.ensureSshKey({
            name: `cluster=${options.clusterId}`,
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
      const node = ContaboNodeProvisioner.transformPrivateNetworkInstanceToNode({
        clusterId: options.clusterId,
        privateNetwork,
        instance,
      });

      // Perform basic checks on the node after provisioning
      try {
        const peerNodes = (await this.listNodes({ clusterId: options.clusterId })).filter(
          (peerNode) => peerNode.id !== node.id
        );
        await this.checkNodeProvisioning({ node, peerNodes });
      } catch (error) {
        if (error instanceof NodeProvisioningReportError) {
          this.provider.setInstanceDisplayName(
            instanceId,
            [
              `cluster=${options.clusterId}`,
              `node=${node.id}`,
              `error=${error.data.type}`,
              error.data.peerNode && `peer=${error.data.peerNode.publicIp}`,
            ]
              .filter(Boolean)
              .join(" ")
          );
          console.error(`Node checks failed: ${error}, retrying...`);
          continue
        } else {
          throw error;
        }
      }
      return node;
    }
    throw new Error("Node provisioning failed after 3 retries");
  }

  async deprovisionNode(options: DeprovisionNodeOptions): Promise<void> {
    const privateNetworks = await this.provider.listPrivateNetworks({
      name: `cluster=${options.clusterId}`,
    });
    const [privateNetwork, instance] =
      privateNetworks
        .map((privateNetwork) => {
          const instance = privateNetwork.instances.find((instance) =>
            instance.displayName.includes(`node=${options.nodeId}`)
          );
          return [privateNetwork, instance] as const;
        })
        .shift() ?? [];
    if (!privateNetwork || !instance) {
      throw new Error(`Instance not found`);
    }
    await this.provider.unassignPrivateNetwork(privateNetwork.privateNetworkId, instance.instanceId).catch(() => {});
    await this.provider.resetInstance(instance.instanceId);
  }

  async listNodes(options: ListNodeOptions): Promise<Node[]> {
    const privateNetworks = await this.provider.listPrivateNetworks({ name: `cluster=${options.clusterId}` });
    return privateNetworks
      .map((privateNetwork) =>
        privateNetwork.instances
          .filter((instance) => !instance.displayName.includes(`error=`))
          .map((instance) => {
            return ContaboNodeProvisioner.transformPrivateNetworkInstanceToNode({
              clusterId: options.clusterId,
              privateNetwork,
              instance,
            });
          })
      )
      .flat();
  }

  async getNode(options: GetNodeOptions): Promise<Node> {
    const privateNetworks = await this.provider.listPrivateNetworks({
      name: `cluster=${options.clusterId}`,
    });
    const [privateNetwork, instance] =
      privateNetworks
        .map((privateNetwork) => {
          const instance = privateNetwork.instances.find((instance) =>
            instance.displayName.includes(`node=${options.nodeId}`)
          );
          if (!instance) {
            return undefined;
          }
          return [privateNetwork, instance] as const;
        })
        .filter(Boolean)
        .shift() ?? [];
    if (!privateNetwork || !instance) {
      throw new Error(`Instance not found`);
    }
    return ContaboNodeProvisioner.transformPrivateNetworkInstanceToNode({
      clusterId: options.clusterId,
      privateNetwork,
      instance,
    });
  }
}
