import { randomUUID } from "node:crypto";
import { executeSSH, exec } from "../utils.ts";
import {
  DeprovisionNodeOptions,
  GetNodeOptions,
  ListNodesOptions,
  Node,
  NodeProviderSlug,
  NodeProvisioner,
  ProvisionNodeOptions,
} from "./mod.ts";

export class NodeProvisioningReportError extends Error {
  constructor(
    public data: {
      type: "ping_node" | "ssh_node" | "ssh_ping_peer_private" | "ssh_ping_peer_public";
      node: Node;
      peerNode?: Node;
      command: string;
      cause: Error;
    }
  ) {
    super(JSON.stringify(data));
  }
}
export abstract class AbstractNodeProvisioner implements NodeProvisioner {
  protected static generateNodeId(): string {
    return randomUUID();
  }

  protected static retrieveDataFromNodeNetworkId(id: string): {
    clusterId: string;
    providerSlug: NodeProviderSlug;
    networkId: string;
    nodeId: string;
  } {
    const [clusterId, providerSlug, networkId, nodeId] = id.split("-");
    return {
      clusterId,
      providerSlug: providerSlug as NodeProviderSlug,
      networkId,
      nodeId,
    };
  }

  /**
   * Perform basic checks on the node after provisioning
   * @param options
   */
  protected async checkNodeProvisioning(options: { node: Node; peerNodes: Node[] }): Promise<void> {
    const { node, peerNodes } = options;
    const createPingCommand = (ip: string) => `timeout 60s /bin/sh -c \'while ! ping -c 1 ${ip}; do sleep 1; done\'`;
    const internetPingCommand = createPingCommand(node.publicIp);
    const checks = [
      // Check that the node is reachable from internet
      () =>
        exec(internetPingCommand).catch((cause) => {
          throw new NodeProvisioningReportError({
            type: "ping_node",
            node,
            command: internetPingCommand,
            cause,
          });
        }),
      // Check that we can connect through SSH
      () =>
        executeSSH(node.publicIp, "echo 'Hello World!'", undefined, { timeout: 10000, retries: 6 }).catch((cause) => {
          throw new NodeProvisioningReportError({
            type: "ssh_node",
            node,
            command: "echo 'Hello World!'",
            cause,
          });
        }),
      // Check that the node is reachable by other nodes through public network
      ...peerNodes.map((peerNode) => async () => {
        const command = createPingCommand(peerNode.publicIp);
        await executeSSH(node.publicIp, command, undefined, { timeout: 10000, retries: 6 }).catch((cause) => {
          throw new NodeProvisioningReportError({
            type: "ssh_ping_peer_public",
            node,
            peerNode,
            command,
            cause,
          });
        });
      }),
    ];
    // Throw an error if any of the checks fail
    for (const check of checks) {
      await check();
    }
  }

  abstract provisionNode(options: ProvisionNodeOptions): Promise<Node>;
  abstract deprovisionNode(options: DeprovisionNodeOptions): Promise<void>;
  abstract listNodes(options: ListNodesOptions): AsyncGenerator<Node>;
  abstract getNode(options: GetNodeOptions): Promise<Node>;
}
