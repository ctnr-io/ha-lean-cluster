import { exec, sh } from "../../api/utils.ts";

export interface ContaboContext {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  user: string;
  password: string;
}

export type ContaboRegion = "EU" | "US-central" | "US-east" | "US-west" | "SIN";

export interface ContaboIp {
  gateway: string;
  ip: string;
  netmaskCidr: number;
}

export interface ContaboInstance {
  addOns: [
    {
      id: number;
      quantity: number;
    }
  ];
  additionalIps: ContaboIp[];
  cancelDate: string;
  cpuCores: number;
  createdDate: string;
  customerId: string;
  dataCenter: string;
  defaultUser: "root" | "admin" | "Administrator";
  diskMb: string;
  displayName: string;
  imageId: string;
  instanceId: number;
  ipConfig: {
    v4: ContaboIp;
    v6: ContaboIp;
  };
  ipv4: string;
  ipv6: string;
  macAddress: string;
  name: string;
  osType: string;
  productId: string;
  productName: string;
  productType: string;
  ramMb: number;
  region: string;
  regionName: string;
  sshKeys: number[];
  status: string;
  tenantId: string;
  vHostId: number;
  vHostName: string;
  vHostNumber: number;
}

export interface ContaboSecret {
  createdAt: string;
  customerId: string;
  name: string;
  secretId: number;
  tenantId: "INT";
  type: "ssh" | "password";
  updatedAt: string;
  value: "";
}

export interface ContaboPrivateNetwork {
  availableIps: number;
  cidr: string;
  createdDate: string;
  customerId: string;
  dataCenter: string;
  description: string;
  name: string;
  privateNetworkId: number;
  region: ContaboRegion;
  regionName: string;
  tenantId: "INT";
  instances: {
    displayName: string;
    instanceId: number;
    ipConfig: {
      v4: {
        gateway: string;
        ip: string;
        netmaskCidr: number;
      };
      v6: {
        gateway: string;
        ip: string;
        netmaskCidr: number;
      };
    };
    name: string;
    privateIpConfig: {
      v4: [
        {
          gateway: string;
          ip: string;
          netmaskCidr: number;
        }
      ];
    };
    productId: string;
    status: string;
  }[];
}


export type ContaboSshKey = ContaboSecret & { type: "ssh" };

async function execCntb(ctx: ContaboContext, command: string): Promise<string> {
  return exec(
    [
      command,
      "--oauth2-client-secret",
      ctx.clientSecret,
      "--oauth2-clientid",
      ctx.clientId,
      "--oauth2-password",
      ctx.password,
      "--oauth2-tokenurl",
      ctx.tokenUrl,
      "--oauth2-user",
      ctx.user,
    ].join(" ")
  );
}

export async function listInstances(ctx: ContaboContext, { page }: { page: number }): Promise<ContaboInstance[]> {
  const instances = JSON.parse(await execCntb(ctx, "cntb get instances --output json")) as ContaboInstance[];
  return instances;
}

export async function setInstanceDisplayName(
  ctx: ContaboContext,
  instanceId: number,
  displayName: string
): Promise<void> {
  await execCntb(ctx, `cntb set instance "${instanceId}" --display-name "${displayName}"`);
}

export async function getAvailableInstance(ctx: ContaboContext): Promise<ContaboInstance | null> {
  for (let page = 0; page < Infinity; page++) {
    const instances = await listInstances(ctx, { page });
    if (instances.length === 0) {
      return null;
    }
    // find the first available instance
    const availableInstance = instances.find(
      (instance) => instance.displayName === "" && instance.status === "running"
    );
    if (availableInstance) {
      await setInstanceDisplayName(ctx, availableInstance.instanceId, "claimed");
      return availableInstance;
    }
  }
  return null;
}

export async function getSecrets(
  ctx: ContaboContext,
  options?: { type?: "ssh" | "password"; name?: string }
): Promise<ContaboSecret[]> {
  const { type, name } = options ?? {};
  return JSON.parse(
    await execCntb(
      ctx,
      ["cntb get secrets --output json", name && `--name ${name}`, type && `--type ${type}`].filter(Boolean).join(" ")
    )
  ) as ContaboSecret[];
}

export async function getSecret(ctx: ContaboContext, id: string): Promise<ContaboSecret> {
  try {
    return JSON.parse(await execCntb(ctx, `cntb get secret --output json "${id}"`)) as ContaboSecret;
  } catch (error: unknown) {
    throw new Error(`Failed to retrieve secret`, { cause: error });
  }
}

export async function createSecret(
  ctx: ContaboContext,
  options: { type: "ssh" | "password"; name: string; value: string }
): Promise<number> {
  const { type, name, value } = options;
  const secretId = await execCntb(ctx, `cntb create secret --type ${type} --name ${name} --value ${value}`);
  return parseInt(secretId);
}

export async function getInstance(ctx: ContaboContext, instanceId: number): Promise<ContaboInstance> {
  try {
    return JSON.parse(await execCntb(ctx, `cntb get instance --output json "${instanceId}"`)) as ContaboInstance;
  } catch (error: unknown) {
    throw new Error(`Failed to get instance`, { cause: error });
  }
}

export async function createInstance(
  ctx: ContaboContext,
  options: { sshKeys: number[]; displayName: string }
): Promise<number> {
  const { sshKeys, displayName } = options;
  const instanceId = parseInt(
    await execCntb(
      ctx,
      sh`
				cntb create \
				instance \ 
				--region EU \
				--defaultUser root \
				--imageId d64d5c6c-9dda-4e38-8174-0ee282474d8a \
				--sshKeys ${sshKeys.join(",")}
				--productId V78 \
 		   --displayName "${displayName}" \
				--output json
			`
    )
  );
  // wait for the instance to be ready
  while (true) {
    const instance = await getInstance(ctx, instanceId);
    if (instance.status === "running") {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return instanceId;
}

export async function reinstallInstance(
  ctx: ContaboContext,
  options: {
    instanceId: number;
    sshKeys: number[];
    displayName: string;
  }
): Promise<number> {
  const { instanceId, sshKeys, displayName } = options;
  await execCntb(
    ctx,
    sh`
		cntb create \
		reinstall \ 
    instance \
    "${instanceId}" \
		--defaultUser root \
		--imageId d64d5c6c-9dda-4e38-8174-0ee282474d8a \
		--sshKeys ${sshKeys.join(",")} \
    --displayName "${displayName}" \
		--output json
	`
  );
  // wait for the instance to be ready
  while (true) {
    const instance = await getInstance(ctx, instanceId);
    if (instance.status === "running") {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return instanceId;
}

export async function listPrivateNetworks(
  ctx: ContaboContext,
  options?: {
    name?: string;
    page?: number;
    size?: number;
  }
): Promise<ContaboPrivateNetwork[]> {
  const { page, size } = options ?? {};
  return JSON.parse(
    await execCntb(
      ctx,
      [
        "cntb get private-networks --output json",
        name && `--name "${name}"`,
        page && `--page ${page}`,
        size && `--size ${size}`,
      ]
        .filter(Boolean)
        .join(" ")
    )
  ) as ContaboPrivateNetwork[];
}

export async function getPrivateNetwork(ctx: ContaboContext, privateNetworkId: number): Promise<ContaboPrivateNetwork> {
  return JSON.parse(
    await execCntb(ctx, `cntb get private-network --output json "${privateNetworkId}"`)
  ) as ContaboPrivateNetwork;
}

export async function assignPrivateNetwork(
  ctx: ContaboContext,
  privateNetworkId: number,
  instanceId: number
): Promise<void> {
  await execCntb(ctx, `cntb assign instance "${privateNetworkId}" "${instanceId}"`);
}

export async function unassignPrivateNetwork(
  ctx: ContaboContext,
  privateNetworkid: number,
  instanceId: number
): Promise<void> {
  await execCntb(ctx, `cntb unassign instance "${privateNetworkid}" "${instanceId}"`);
}

export async function createPrivateNetwork(
  ctx: ContaboContext,
  options: { name: string; region: ContaboRegion }
): Promise<number> {
  return parseInt(
    await execCntb(ctx, `cntb create private-network --name "${options.name}" --region "${options.region}"`)
  );
}
