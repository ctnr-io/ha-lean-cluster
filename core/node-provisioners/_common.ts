import { NodeProvider } from "./index.ts";
import { decodeBase64, encodeBase64 } from "jsr:@std/encoding/base64";


export function generateNodeNetworkId(data: {
  clusterId: string;
  provider: NodeProvider;
  providerCustomerId: string;
  privateNetworkId: string;
}): string {
	const encodeBuffer = new TextEncoder().encode;
	return encodeBase64(encodeBuffer(JSON.stringify(data)));
}

export function generateNodeId(data: {
  clusterId: string;
  provider: NodeProvider;
  providerCustomerId: string;
  privateNetworkId: string;
  instanceId: string;
}): string {
	const encodeBuffer = new TextEncoder().encode;
	return encodeBase64(encodeBuffer(JSON.stringify(data)));
}

export function retrieveDataFromNodeNetworkId(networkId: string): {
  clusterId: string;
  provider: NodeProvider;
  providerCustomerId: string;
  privateNetworkId: string;
} {
	const decodeBuffer = new TextDecoder().decode;
	return JSON.parse(decodeBuffer(decodeBase64(networkId)));
}

export function retrieveDataFromNodeId(id: string): {
  clusterId: string;
  provider: NodeProvider;
  providerCustomerId: string;
  privateNetworkId: string;
  instanceId: string;
} {
	const decodeBuffer = new TextDecoder().decode;
	return JSON.parse(decodeBuffer(decodeBase64(id)));
}