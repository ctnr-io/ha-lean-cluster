import { exec as execUtil, sh } from "../utils.ts";

export interface ContaboOauth {
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

export class ContaboProvider {
  constructor(private oauth: ContaboOauth) {}

  private async exec(command: string): Promise<string> {
    return execUtil(
      [
        command,
        "--oauth2-client-secret",
        this.oauth.clientSecret,
        "--oauth2-clientid",
        this.oauth.clientId,
        "--oauth2-password",
        this.oauth.password,
        "--oauth2-tokenurl",
        this.oauth.tokenUrl,
        "--oauth2-user",
        this.oauth.user,
      ].join(" ")
    );
  }

  async listInstances({ page }: { page: number }): Promise<ContaboInstance[]> {
    const instances = JSON.parse(await this.exec("cntb get instances --output json")) as ContaboInstance[];
    return instances;
  }

  async setInstanceDisplayName(instanceId: number, displayName: string): Promise<void> {
    await this.exec(`cntb set instance "${instanceId}" --display-name "${displayName}"`);
  }

  async getSecrets(options?: { type?: "ssh" | "password"; name?: string }): Promise<ContaboSecret[]> {
    const { type, name } = options ?? {};
    return JSON.parse(
      await this.exec(
        ["cntb get secrets --output json", name && `--name ${name}`, type && `--type ${type}`].filter(Boolean).join(" ")
      )
    ) as ContaboSecret[];
  }

  async getSecret(id: string): Promise<ContaboSecret> {
    try {
      return JSON.parse(await this.exec(`cntb get secret --output json "${id}"`)) as ContaboSecret;
    } catch (error) {
      throw new Error(`Failed to retrieve secret`, { cause: error });
    }
  }

  async createSecret(options: { type: "ssh" | "password"; name: string; value: string }): Promise<number> {
    const { type, name, value } = options;
    const secretId = await this.exec(`cntb create secret --type ${type} --name ${name} --value ${value}`);
    return parseInt(secretId);
  }

  async getInstance(instanceId: number): Promise<ContaboInstance> {
    try {
      return JSON.parse(await this.exec(`cntb get instance --output json "${instanceId}"`)) as ContaboInstance;
    } catch (error) {
      throw new Error(`Failed to get instance`, { cause: error });
    }
  }

  async createInstance(options: { sshKeys: number[]; displayName: string }): Promise<number> {
    const { sshKeys, displayName } = options;
    const instanceId = parseInt(
      await this.exec(
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
      const instance = await this.getInstance(instanceId);
      if (instance.status === "running") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return instanceId;
  }

  async reinstallInstance(options: { instanceId: number; sshKeys: number[]; displayName: string }): Promise<number> {
    const { instanceId, sshKeys, displayName } = options;
    await this.exec(
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
      const instance = await this.getInstance(instanceId);
      if (instance.status === "running") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return instanceId;
  }

  async listPrivateNetworks(options?: {
    name?: string;
    page?: number;
    size?: number;
  }): Promise<ContaboPrivateNetwork[]> {
    const { page, size } = options ?? {};
    return JSON.parse(
      await this.exec(
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

  async getPrivateNetwork(privateNetworkId: number): Promise<ContaboPrivateNetwork> {
    return JSON.parse(
      await this.exec(`cntb get private-network --output json "${privateNetworkId}"`)
    ) as ContaboPrivateNetwork;
  }

  async assignPrivateNetwork(privateNetworkId: number, instanceId: number): Promise<void> {
    await this.exec(`cntb assign instance "${privateNetworkId}" "${instanceId}"`);
  }

  async unassignPrivateNetwork(privateNetworkid: number, instanceId: number): Promise<void> {
    await this.exec(`cntb unassign instance "${privateNetworkid}" "${instanceId}"`);
  }

  async createPrivateNetwork(options: { name: string; region: ContaboRegion }): Promise<number> {
    return parseInt(
      await this.exec(`cntb create private-network --name "${options.name}" --region "${options.region}"`)
    );
  }
}
