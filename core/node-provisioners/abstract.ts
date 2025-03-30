import { ListNodeOptions, Node, NodeProvider, NodeProvisioner, ProvisionNodeOptions } from "./index.ts";
import { decodeBase64, encodeBase64 } from "jsr:@std/encoding/base64";

export abstract class AbstractNodeProvisioner implements NodeProvisioner {
  protected static generateNodeNetworkId(data: {
    clusterId: string;
    provider: NodeProvider;
    providerCustomerId: string;
    privateNetworkId: string;
  }): string {
    const encodeBuffer = new TextEncoder().encode;
    return encodeBase64(encodeBuffer(JSON.stringify(data)));
  }

  protected static generateNodeId(data: {
    clusterId: string;
    provider: NodeProvider;
    providerCustomerId: string;
    privateNetworkId: string;
    instanceId: string;
  }): string {
    const encodeBuffer = new TextEncoder().encode;
    return encodeBase64(encodeBuffer(JSON.stringify(data)));
  }

  protected static retrieveDataFromNodeNetworkId(networkId: string): {
    clusterId: string;
    provider: NodeProvider;
    providerCustomerId: string;
    privateNetworkId: string;
  } {
    const decodeBuffer = new TextDecoder().decode;
    return JSON.parse(decodeBuffer(decodeBase64(networkId)));
  }

  protected static retrieveDataFromNodeId(id: string): {
    clusterId: string;
    provider: NodeProvider;
    providerCustomerId: string;
    privateNetworkId: string;
    instanceId: string;
  } {
    const decodeBuffer = new TextDecoder().decode;
    return JSON.parse(decodeBuffer(decodeBase64(id)));
  }
  
  abstract provisionNode(options: ProvisionNodeOptions): Promise<Node>;
  abstract deprovisionNode(id: string): Promise<void>;
  abstract listNodes(options: ListNodeOptions): Promise<Node[]>;
  abstract getNode(nodeId: string): Promise<Node>; 
}
