import { ListNodeOptions, Node, NodeProvider, NodeProvisioner, ProvisionNodeOptions } from "./mod.ts";
import { decodeBase64, encodeBase64 } from "jsr:@std/encoding/base64";

export abstract class AbstractNodeProvisioner implements NodeProvisioner {
  protected static generateNodeNetworkId(data: {
    clusterId: string;
    provider: NodeProvider;
    providerCustomerId: string;
    privateNetworkId: string;
  }): string {
    return encodeBase64(new TextEncoder().encode(JSON.stringify(data)));
  }

  protected static generateNodeId(data: {
    clusterId: string;
    provider: NodeProvider;
    providerCustomerId: string;
    privateNetworkId: string;
    instanceId: string;
  }): string {
    return encodeBase64(new TextEncoder().encode(JSON.stringify(data)));
  }

  protected static retrieveDataFromNodeNetworkId(networkId: string): {
    clusterId: string;
    provider: NodeProvider;
    providerCustomerId: string;
    privateNetworkId: string;
  } {
    return JSON.parse(new TextDecoder().decode(decodeBase64(networkId)));
  }

  protected static retrieveDataFromNodeId(id: string): {
    clusterId: string;
    provider: NodeProvider;
    providerCustomerId: string;
    privateNetworkId: string;
    instanceId: string;
  } {
    return JSON.parse(new TextDecoder().decode(decodeBase64(id)));
  }
  
  abstract provisionNode(options: ProvisionNodeOptions): Promise<Node>;
  abstract deprovisionNode(id: string): Promise<void>;
  abstract listNodes(options: ListNodeOptions): Promise<Node[]>;
  abstract getNode(nodeId: string): Promise<Node>; 
}
