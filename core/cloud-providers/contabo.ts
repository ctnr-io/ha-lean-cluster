import { exec as execUtil, sh } from "../utils.ts";
import * as process from "node:process";

export interface ContaboOauth {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  user: string;
  password: string;
}

export type ContaboRegion = "EU" | "US-central" | "US-east" | "US-west" | "SIN";

export type ContaboProductId = "V76" | "V78";

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
  status:
    | "provisioning"
    | "uninstalled"
    | "running"
    | "stopped"
    | "error"
    | "installing"
    | "unknown"
    | "manual_provisioning"
    | "product_not_available"
    | "verification_required"
    | "rescue"
    | "pending_payment"
    | "other"
    | "reset_password";
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

const {
  CNTB_CLIENT_SECRET = "",
  CNTB_CLIENT_ID = "",
  CNTB_PASSWORD = "",
  CNTB_TOKEN_URL = "",
  CNTB_USER = "",
} = process.env;

export class ContaboProvider {
  constructor(
    private oauth: ContaboOauth = {
      clientSecret: CNTB_CLIENT_SECRET,
      clientId: CNTB_CLIENT_ID,
      password: CNTB_PASSWORD,
      tokenUrl: CNTB_TOKEN_URL,
      user: CNTB_USER,
    }
  ) {}

  private async exec(command: string): Promise<string> {
    return execUtil(
      [
        command,
        this.oauth.clientSecret && `--oauth2-client-secret=${this.oauth.clientSecret}`,
        this.oauth.clientId && `--oauth2-client-id=${this.oauth.clientId}`,
        this.oauth.password && `--oauth2-password=${this.oauth.password}`,
        this.oauth.tokenUrl && `--oauth2-token-url=${this.oauth.tokenUrl}`,
        this.oauth.user && `--oauth2-user=${this.oauth.user}`,
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  async listInstances({ page, size }: { page?: number; size?: number }): Promise<ContaboInstance[]> {
    const instances = JSON.parse(
      await this.exec(
        [
          "cntb get instances --output json",
          page !== undefined && `--page "${page}"`,
          size !== undefined && `--size "${size}"`,
        ]
          .filter(Boolean)
          .join(" ")
      )
    ) as ContaboInstance[];
    return instances;
  }

  async setInstanceDisplayName(instanceId: number, displayName: string): Promise<void> {
    await this.exec(`cntb update instance "${instanceId}" --displayName "${displayName}"`);
  }

  async listSecrets(options?: {
    type?: "ssh" | "password";
    name?: string;
    page?: number;
    size?: number;
  }): Promise<ContaboSecret[]> {
    const { type, name, page, size } = options ?? {};
    return JSON.parse(
      await this.exec(
        [
          "cntb get secrets --output json",
          name && `--name ${name}`,
          type && `--type ${type}`,
          page !== undefined && `--page "${page}"`,
          size !== undefined && `--size "${size}"`,
        ]
          .filter(Boolean)
          .join(" ")
      )
    ) as ContaboSecret[];
  }

  async getSecret(id: number): Promise<ContaboSecret> {
    return JSON.parse(await this.exec(`cntb get secret --output json "${id}"`))[0] as ContaboSecret;
  }

  async createSecret(options: { type: "ssh" | "password"; name: string; value: string }): Promise<number> {
    const { type, name, value } = options;
    const secretId = await this.exec(`cntb create secret --type "${type}" --name "${name}" --value "${value}"`);
    return parseInt(secretId);
  }

  async deleteSecret(secretId: number): Promise<void> {
    await this.exec(`cntb delete secret "${secretId}"`);
  }

  async getInstance(instanceId: number): Promise<ContaboInstance> {
    return JSON.parse(await this.exec(`cntb get instance --output json "${instanceId}"`))[0] as ContaboInstance;
  }

  async createInstance(options: {
    productId: ContaboProductId;
    sshKeys: number[];
    displayName: string;
  }): Promise<number> {
    const { productId, sshKeys, displayName } = options;
    const instanceId = parseInt(
      await this.exec(
        sh`
          cntb create \
          instance \ 
          --region EU \
          --defaultUser root \
          --imageId d64d5c6c-9dda-4e38-8174-0ee282474d8a \
          ${sshKeys.length > 0 ? `--sshKeys ${sshKeys.join(",")}` : ""} \
          --productId ${productId} \
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
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    return instanceId;
  }

  async reinstallInstance(options: { instanceId: number; sshKeys: number[] }): Promise<number> {
    const { instanceId, sshKeys } = options;
    await this.exec(
      sh`
        cntb \
        reinstall \ 
        instance \
        "${instanceId}" \
        --defaultUser root \
        --imageId d64d5c6c-9dda-4e38-8174-0ee282474d8a \
        ${sshKeys.length > 0 ? `--sshKeys ${sshKeys.join(",")}` : ""} \
        --output json
      `
    );
    // wait for the instance to be ready
    for (let wait = true; wait; await new Promise((resolve) => setTimeout(resolve, 5000))) {
      const instance = await this.getInstance(instanceId);
      switch (instance.status) {
        case "installing":
          break;
        case "stopped":
          await this.startInstance(instanceId);
          wait = false;
          break;
        case "running":
          wait = false;
          break;
        default:
          throw new Error(`Instance ${instanceId} failed to reinstall`);
      }
    }
    return instanceId;
  }

  async cancelInstance(instanceId: number): Promise<void> {
    await this.exec(`cntb cancel instance "${instanceId}"`);
  }

  async stopInstance(instanceId: number): Promise<void> {
    await this.exec(`cntb stop instance "${instanceId}"`);
  }

  async startInstance(instanceId: number): Promise<void> {
    await this.exec(`cntb start instance "${instanceId}"`);
  }

  async restartInstance(instanceId: number): Promise<void> {
    await this.exec(`cntb restart instance "${instanceId}"`);
  }

  async shutdownInstance(instanceId: number): Promise<void> {
    await this.exec(`cntb shutdown instance "${instanceId}"`);
  }

  async upgradeInstance(options: { instanceId: number; privateNetwork?: boolean; backup?: boolean }) {
    const { instanceId, privateNetwork, backup } = options;
    await this.exec(
      [
        `cntb upgrade instance "${instanceId}"`,
        privateNetwork && `--privateNetworking "${privateNetwork}"`,
        backup && `--backup "${backup}"`,
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  async listPrivateNetworks(options?: {
    name?: string;
    page?: number;
    size?: number;
  }): Promise<ContaboPrivateNetwork[]> {
    const { name, page, size } = options ?? {};
    return JSON.parse(
      await this.exec(
        [
          "cntb get privateNetworks --output json",
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
      await this.exec(`cntb get privateNetwork --output json "${privateNetworkId}"`)
    )[0] as ContaboPrivateNetwork;
  }

  async assignPrivateNetwork(privateNetworkId: number, instanceId: number): Promise<void> {
    await this.exec(`cntb assign privateNetwork "${privateNetworkId}" "${instanceId}"`);
  }

  async unassignPrivateNetwork(privateNetworkid: number, instanceId: number): Promise<void> {
    await this.exec(`cntb unassign privateNetwork "${privateNetworkid}" "${instanceId}"`);
  }

  async createPrivateNetwork(options: { name: string; region: ContaboRegion }): Promise<number> {
    return parseInt(
      await this.exec(`cntb create privateNetwork --name "${options.name}" --region "${options.region}"`)
    );
  }

  async deletePrivateNetwork(privateNetworkId: number): Promise<void> {
    await this.exec(`cntb delete privateNetwork "${privateNetworkId}"`);
  }

  // helpers
  public async resetInstance(instanceId: number): Promise<void> {
    await this.setInstanceDisplayName(instanceId, "");
    await this.stopInstance(instanceId).catch(() => {});
  }

  private async resetInstanceWithDisplayName(displayName: string): Promise<void> {
    for (let page = 1; page < Infinity; page++) {
      const instances = await this.listInstances({ page });
      const instance = instances.find((instance) => instance.displayName === displayName);
      if (instance) {
        await this.resetInstance(instance.instanceId);
        return;
      }
    }
  }

  private async getAvailableInstance(options: { displayName: string, productId?: ContaboProductId }): Promise<ContaboInstance | null> {
    for (let page = 1; page < Infinity; page++) {
      const instances = await this.listInstances({ page });
      if (instances.length === 0) {
        return null;
      }
      // find the first available instance
      const availableInstance = instances.find(
        (instance) => instance.displayName === "" 
        // && (options.productId === undefined || instance.productId === options.productId)
        && (instance.status === "stopped" || instance.status === "running")
      );
      if (!availableInstance) {
        return null;
      }

      // apply display name
      try {
        await this.setInstanceDisplayName(availableInstance.instanceId, options.displayName);
      } catch {
        // if the display name is already taken, reset the instance that use it and try again
        await this.resetInstanceWithDisplayName(options.displayName);
        await this.setInstanceDisplayName(availableInstance.instanceId, options.displayName);
      }

      return availableInstance;
    }
    return null;
  }

  async ensureSshKey(options: { name: string; value: string }): Promise<number> {
    const { name, value } = options;
    const sshKeys = await this.listSecrets({ type: "ssh", name });
    if (sshKeys.length === 0) {
      return await this.createSecret({ type: "ssh", name, value });
    }
    return sshKeys[0].secretId;
  }

  async ensurePrivateNetwork(options: { name: string; region: ContaboRegion }): Promise<number> {
    const privateNetworks = await this.listPrivateNetworks({ name: options.name });
    if (privateNetworks.length === 0) {
      return await this.createPrivateNetwork(options);
    }
    return privateNetworks[0].privateNetworkId;
  }

  async ensureInstance(options: {
    provisioning: "auto" | "manual";
    displayName: string;
    sshKeys: number[];
    productId: ContaboProductId;
    privateNetworks: number[];
  }): Promise<number> {
    const { provisioning, productId, displayName, sshKeys, privateNetworks } = options;
    let instance: ContaboInstance | undefined | null = undefined;
    instance = await this.getAvailableInstance(options);

    // if there is no instance available, create one if provisioning is automatic
    if (!instance) {
      if (provisioning !== "auto") {
        throw new Error(
          `Automatic provisioning disabled, no available instances found, please provision instances with productId ${productId} in Contabo first`
        );
      } else {
        // create instance
        const instanceId = await this.createInstance({ productId, sshKeys, displayName });
        instance = await this.getInstance(instanceId);
      }
    }

    // if instance doesn't have privateNetwork addon, add it
    if (!instance.addOns.some((addOn) => addOn.id === 1477)) {
      if (provisioning !== "auto") {
        await this.resetInstance(instance.instanceId);
        throw new Error(
          `Automatic provisioning disabled, no private network addon found on instance ${instance.displayName}, please add private network addon to instance in Contabo first`
        );
      }
      await this.upgradeInstance({
        instanceId: instance.instanceId,
        privateNetwork: true,
      });
    }

    // assign private networks if any and if not
    await Promise.allSettled(
      privateNetworks.map((privateNetworkId) =>
        this.assignPrivateNetwork(privateNetworkId, instance.instanceId).catch(() => {})
      )
    );

    // reinstall instance
    const instanceId = await this.reinstallInstance({
      instanceId: instance.instanceId,
      sshKeys,
    });

    if (instance.displayName !== displayName) {
      await this.setInstanceDisplayName(instanceId, displayName);
    }
    return instanceId;
  }
}
