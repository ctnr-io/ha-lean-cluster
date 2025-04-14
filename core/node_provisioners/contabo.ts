import { paginateFind, paginateFilter, readFile, filterAsync, executeSSH } from "../utils.ts";
import { DeprovisionNodeOptions, GetNodeOptions, ListNodesOptions, Node, ProvisionNodeOptions } from "./mod.ts";
import { AbstractNodeProvisioner, NodeProvisioningReportError } from "./abstract.ts";
import { ContaboProvider, ContaboRegion, ContaboInstance } from "../cloud_providers/contabo.ts";
import { hash, randomBytes } from "node:crypto";

export class ContaboNodeProvisioner extends AbstractNodeProvisioner {
  constructor(private provider: ContaboProvider) {
    super();
  }

  protected getProviderSlug(): "cntb" {
    return "cntb";
  }

  private static transformInstanceToNode(options: { clusterId: string; instance: ContaboInstance }): Node {
    const { clusterId, instance } = options;
    return {
      clusterId: clusterId,
      id: String(instance.instanceId),
      publicIp: instance.ipConfig.v4.ip,
    };
  }

  static RegionMatch: Record<ProvisionNodeOptions["region"], ContaboRegion> = {
    eu: "EU",
  };

  async provisionNode(options: ProvisionNodeOptions): Promise<Node> {
    for (let retry = 0; retry < 3; retry++) {
      // Create instance if it doesn't exist and reinstall it
      const instance = await this.provider.ensureInstance({
        provisioning: "manual",
        displayName: (instanceId) => `${instanceId} cluster=${options.clusterId}`,
        sshKeys: [
          await this.provider.ensureSshKey({
            name: `cluster=${options.clusterId}`,
            value: await readFile("public.key"),
          }),
        ],
        privateNetworks: [], // We still need private networks for networking, but not for cluster membership
        productId: "V78",
      });

      // Transform instance to node
      const node = ContaboNodeProvisioner.transformInstanceToNode({
        clusterId: options.clusterId,
        instance,
      });

      // Perform basic checks on the node after provisioning
      try {
        await this.checkNodeProvisioning({
          node,
          peerNodes: await Array.fromAsync(
            filterAsync({
              generator: this.listNodes({ clusterId: options.clusterId }),
              condition: (peerNode) => peerNode.id !== node.id,
            })
          ),
        });
      } catch (error) {
        if (error instanceof NodeProvisioningReportError) {
          this.provider.setInstanceDisplayName(
            instance.instanceId,
            [
              `${instance.instanceId} error=${error.data.type}`,
              error.data.peerNode && `peer=${error.data.peerNode.publicIp}`,
            ]
              .filter(Boolean)
              .join(" ")
          );
          console.error(`Node checks failed: ${error}, retrying...`);

          // Reset the instance (clear display name and stop it)
          await this.provider.resetInstance(instance.instanceId).catch(console.warn);
          continue;
        } else {
          throw error;
        }
      }

      // Kill any apt-get processes that might be running 
      await executeSSH(node.publicIp, "sudo killall apt-get || true")

      return node;
    }
    throw new Error("Node provisioning failed after 3 retries");
  }

  async deprovisionNode(options: DeprovisionNodeOptions): Promise<void> {
    // Reset the instance (clear display name and stop it)
    await this.provider.resetInstance(parseInt(options.nodeId)).catch(console.warn);
  }

  async *listNodes(options: ListNodesOptions): AsyncGenerator<Node> {
    for await (const instance of paginateFilter({
      request: (pageOptions) =>
        this.provider.listInstances({
          ...pageOptions,
        }),
      condition: (instance) => instance.displayName.includes(`cluster=${options.clusterId}`),
      pageSize: options.pageSize,
    })) {
      yield ContaboNodeProvisioner.transformInstanceToNode({
        clusterId: options.clusterId,
        instance,
      });
    }
  }

  async getNode(options: GetNodeOptions): Promise<Node> {
    // Get the instanceId
    const instance = await this.provider.getInstance(parseInt(options.nodeId));
    return ContaboNodeProvisioner.transformInstanceToNode({
      clusterId: options.clusterId,
      instance,
    });
  }
}
