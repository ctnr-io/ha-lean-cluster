import { paginateFind, paginateFilter, readFile, filterAsync, executeSSH } from "../utils.ts";
import { DeprovisionNodeOptions, GetNodeOptions, ListNodesOptions, Node, ProvisionNodeOptions } from "./mod.ts";
import { AbstractNodeProvisioner, NodeProvisioningReportError } from "./abstract.ts";
import { ContaboProvider, ContaboRegion, ContaboInstance, ContaboProductId } from "../cloud_providers/contabo.ts";
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
      const instance = await this.ensureInstance({
        provisioning: "manual",
        displayName: (instanceId) => `${instanceId} cluster=${options.clusterId}`,
        sshKeys: [
          await this.ensureSshKey({
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
          await this.resetInstance(instance.instanceId).catch(console.warn);
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
    await this.resetInstance(parseInt(options.nodeId)).catch(console.warn);
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








  // helpers

  private async resetInstance(instanceId: number): Promise<void> {
    await this.provider.setInstanceDisplayName(instanceId, "");
    await this.provider.stopInstance(instanceId).catch(() => {});
  }

  private async resetInstanceWithDisplayName(displayName: string): Promise<void> {
    const instance = await paginateFind({
      request: this.provider.listInstances,
      condition: (instance) => instance.displayName === displayName,
    });
    await this.resetInstance(instance.instanceId);
  }

  // async getTagByName(name: string): Promise<ContaboTag> {
  //   return await paginateFind({
  //     request: (options) => this.provider.listTags({ ...options, tagName: name }),
  //     condition: (tag) => tag.name === name,
  //   });
  // }

  // async ensureTag(options: { name: string; color?: string }): Promise<number> {
  //   const { name, color } = options;
  //   try {
  //     const tag = await this.provider.getTagByName(name);
  //     // TODO: update tag color if color is provided
  //     return tag.tagId;
  //   } catch {
  //     return await this.provider.createTag({ name, color });
  //   }
  // }

  // async assignTag(options: {
  //   name: string;
  //   color?: string;
  //   resourceType: ContaboTagAssignmentResourceType;
  //   resourceId: string;
  // }): Promise<number> {
  //   const { name, color, resourceType, resourceId } = options;
  //   const tagId = await this.provider.ensureTag({ name, color });
  //   const tagAssignments = await this.provider.listTagAssignments({
  //     tagId,
  //   });
  //   const tagAssignment = tagAssignments.find(
  //     (tagAssignment) => tagAssignment.resourceId === resourceId && tagAssignment.resourceType === resourceType
  //   );
  //   if (tagAssignment) {
  //     throw new Error(`Tag ${name} already assigned to resource ${resourceId} of type ${resourceType}`);
  //   }
  //   await this.provider.createTagAssignment({ tagId, resourceType, resourceId });
  //   return tagId;
  // }

  // async unassignTag(options: {
  //   name: string;
  //   resourceType: ContaboTagAssignmentResourceType;
  //   resourceId: string;
  // }): Promise<void> {
  //   const { name, resourceType, resourceId } = options;
  //   const tag = await this.provider.getTagByName(name);
  //   const tagAssignments = await this.provider.listTagAssignments({
  //     tagId: tag.tagId,
  //   });
  //   if (tagAssignments.length === 0) {
  //     throw new Error(`Tag ${name} not assigned to resource ${resourceId} of type ${resourceType}`);
  //   }
  //   await this.provider.deleteTagAssignment({ tagId: tag.tagId, resourceType, resourceId });
  //   if (tagAssignments.length === 1) {
  //     await this.provider.deleteTag(tag.tagId);
  //   }
  // }

  // async isTagAssignedToResource(options: {
  //   name: string;
  //   resourceType: ContaboTagAssignmentResourceType;
  //   resourceId: string;
  // }): Promise<boolean> {
  //   const { name } = options;
  //   const [{ tagId }] = (await this.provider.listTags({ tagName: name })) ?? [{}];
  //   if (tagId === undefined) {
  //     return false;
  //   }
  //   try {
  //     await paginateFind({
  //       request: (options) => this.provider.listTagAssignments({ tagId, ...options }),
  //       condition: (tagAssignment) => tagAssignment.resourceId === options.resourceId,
  //     });
  //     return true;
  //   } catch {
  //     return false;
  //   }
  // }

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
  async ensureInstance(options: {
    provisioning: "auto" | "manual";
    displayName: (instanceId: number) => string;
    sshKeys: number[];
    productId: ContaboProductId;
    privateNetworks: number[];
    preferedDataCenter?: string;
  }): Promise<ContaboInstance> {
    let instance: ContaboInstance;
    // Find or create available instance
    {
      try {
        instance = await paginateFind({
          request: (options) => this.provider.listInstances(options),
          condition: async (instance) => {
            // Find instance with matching display name or empty display name
            if (instance.displayName !== "") {
              return false;
            }
            // Find instance with matching product id and empty display name
            if (options.productId !== instance.productId) {
              return false;
            }
            // Find instance not cancelled
            if (instance.cancelDate !== "") {
              await this.provider.setInstanceDisplayName(instance.instanceId, `${instance.instanceId} status=cancelled`);
              return false;
            }
            // Find instance with no errors
            if (instance.errorMessage) {
              await this.provider.setInstanceDisplayName(
                instance.instanceId,
                `${instance.instanceId} error=${instance.errorMessage}`.substring(0, 64)
              );
              return false;
            }
            // If imageId is not the default image, reinstall it
            if (instance.imageId !== ContaboProvider.Ubuntu_24_04_ImageId) {
              await this.provider.reinstallInstance({
                instanceId: instance.instanceId,
                sshKeys: options.sshKeys,
                imageId: ContaboProvider.Ubuntu_24_04_ImageId,
              });
            }
            // Find instance stopped or running
            if (instance.status !== "stopped" && instance.status !== "running") {
              return false;
            }
            return true;
          },
          // Sort instances by prefered data center
          sorter: (a) => options.preferedDataCenter?.localeCompare(a.dataCenter ?? "") ?? 1,
        });
      } catch {
        // if there is no instance available, create one if provisioning is automatic
        if (options.provisioning !== "auto") {
          throw new Error(
            `Automatic provisioning disabled, no available instances found, please provision instances with productId ${options.productId} in Contabo first`
          );
        } else {
          // create instance
          const instanceId = await this.provider.createInstance({
            productId: options.productId,
            sshKeys: options.sshKeys,
            displayName: "provisioning...",
            imageId: ContaboProvider.Ubuntu_24_04_ImageId,
          });
          instance = await this.provider.getInstance(instanceId);
        }
      }
      await this.provider.setInstanceDisplayName(instance.instanceId, options.displayName(instance.instanceId));
    }

    // Setup instance
    // if instance doesn't have privateNetwork addon, add it
    // if (!instance.addOns.some((addOn) => addOn.id === 1477)) {
    //   if (options.provisioning !== "auto") {
    //     await this.provider.resetInstance(instance.instanceId);
    //     throw new Error(
    //       `Automatic provisioning disabled, no private network addon found on instance ${instance.displayName}, please add private network addon to instance in Contabo first`
    //     );
    //   }
    //   await this.provider.upgradeInstance({
    //     instanceId: instance.instanceId,
    //     privateNetwork: true,
    //   });
    // }

    // reinstall instance
    // await this.provider.reinstallInstance({
    //   instanceId: instance.instanceId,
    //   sshKeys: options.sshKeys,
    // });

    instance = await this.provider.getInstance(instance.instanceId);

    // Start instance if not running
    if (instance.status !== "running") {
      await this.provider.startInstance(instance.instanceId);
      instance = await this.provider.getInstance(instance.instanceId);
    }

    // assign private networks if any and if not
    // await Promise.allSettled(
    //   options.privateNetworks.map((privateNetworkId) =>
    //     this.provider.assignPrivateNetwork(privateNetworkId, instance.instanceId).catch(() => {})
    //   )
    // );

    return instance;
  }
}
