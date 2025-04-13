import { exec as execUtil, sh } from "../utils.ts";
import * as process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import * as YAML from "@std/yaml";
import * as ContaboOpenAPI from "@openapis/contabo";

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

export interface ContaboTag {
  color: string;
  customerId: string;
  name: string;
  tagId: number;
  tenantId: string;
}

export interface ContaboTagAssignment {
  customerId: string;
  resourceId: string;
  resourceName: string;
  resourceType: string;
  tagId: number;
  tagName: string;
  tenantId: string;
}

type ContaboListOptions<Options extends Record<string, any> = {}> = {
  page?: number;
  size?: number;
  orderBy?: `${string}:asc` | `${string}:desc`;
} & Options;

export type ContaboTagAssignmentResourceType = "instance" | "image" | "object-storage";

export type ContaboSshKey = ContaboSecret & { type: "ssh" };

export class ContaboProvider {
  constructor(private oauth: Partial<ContaboOauth> = {}) {
    const { CNTB_CLIENT_SECRET, CNTB_CLIENT_ID, CNTB_PASSWORD, CNTB_TOKEN_URL, CNTB_USER } = process.env;
    const envConfig = {
      clientId: CNTB_CLIENT_ID,
      clientSecret: CNTB_CLIENT_SECRET,
      tokenUrl: CNTB_TOKEN_URL,
      username: CNTB_USER,
      password: CNTB_PASSWORD,
    };

    // Read from ~/.cntb.yaml
    let configData: {
      "oauth2-clientid"?: string;
      "oauth2-client-secret"?: string;
      "oauth2-user"?: string;
      "oauth2-password"?: string;
      "oauth2-tokenurl"?: string;
      api?: string;
    } = {};
    if (existsSync(process.env.HOME + "/.cntb.yaml")) {
      const config = readFileSync(process.env.HOME + "/.cntb.yaml", "utf8");
      configData = YAML.parse(config) as {
        "oauth2-clientid": string;
        "oauth2-client-secret": string;
        "oauth2-user": string;
        "oauth2-password": string;
        "oauth2-tokenurl": string;
        api: string;
      };
    }
    const fileConfig = {
      clientId: configData["oauth2-clientid"],
      clientSecret: configData["oauth2-client-secret"],
      tokenUrl: configData["oauth2-tokenurl"],
      username: configData["oauth2-user"],
      password: configData["oauth2-password"],
    };

    this.oauth = {
      ...fileConfig,
      ...envConfig,
      ...oauth,
    };
  }

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

  private async execList<T>(command: string, options?: ContaboListOptions): Promise<T[]> {
    const { page, size, orderBy } = options ?? {};
    return JSON.parse(
      await this.exec(
        [
          command,
          page !== undefined && `--page "${page}"`,
          size !== undefined && `--size "${size}"`,
          orderBy && `--order-by "${orderBy}"`,
        ]
          .filter(Boolean)
          .join(" ")
      )
    );
  }

  listInstances(options: ContaboListOptions<{ name?: string }>): Promise<ContaboInstance[]> {
    return this.execList(
      ["cntb get instances --output json", options.name && `--name "${options.name}"`].filter(Boolean).join(" "),
      options
    );
  }

  async setInstanceDisplayName(instanceId: number, displayName: string): Promise<void> {
    await this.exec(`cntb update instance "${instanceId}" --displayName "${displayName}"`);
  }

  listSecrets(
    options?: ContaboListOptions<{
      type?: "ssh" | "password";
      name?: string;
    }>
  ): Promise<ContaboSecret[]> {
    return this.execList(
      [
        "cntb get secrets --output json",
        options?.type && `--type "${options.type}"`,
        options?.name && `--name "${options.name}"`,
      ]
        .filter(Boolean)
        .join(" "),
      options
    );
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
          cntb create instance --region EU --defaultUser root --imageId d64d5c6c-9dda-4e38-8174-0ee282474d8a ${sshKeys.length > 0 ? `--sshKeys ${sshKeys.join(",")}` : ""} --productId ${productId} --displayName "${displayName}" --output json
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
        cntb reinstall instance "${instanceId}" --defaultUser root --imageId d64d5c6c-9dda-4e38-8174-0ee282474d8a ${sshKeys.length > 0 ? `--sshKeys ${sshKeys.join(",")}` : ""} --output json
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

  listPrivateNetworks(options?: ContaboListOptions<{ name?: string }>): Promise<ContaboPrivateNetwork[]> {
    const { name } = options ?? {};
    return this.execList(
      ["cntb get privateNetworks --output json", name && `--name "${name}"`].filter(Boolean).join(" "),
      options
    );
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

  async createTag(options: { name: string; color?: string }): Promise<number> {
    return parseInt(
      await this.exec(`cntb create tag --name "${options.name}" ${options.color ? `--color "${options.color}"` : ""}`)
    );
  }

  async deleteTag(tagId: number): Promise<void> {
    await this.exec(`cntb delete tag "${tagId}"`);
  }

  listTags(options: ContaboListOptions<{ tagName?: string }>): Promise<ContaboTag[]> {
    return this.execList(
      ["cntb get tags --output json", options.tagName && `--tagName "${options.tagName}"`].filter(Boolean).join(" "),
      options
    );
  }

  async getTag(tagId: number): Promise<ContaboTag> {
    return JSON.parse(await this.exec(`cntb get tag --output json "${tagId}"`))[0] as ContaboTag;
  }

  async createTagAssignment(options: {
    tagId: number;
    resourceType: ContaboTagAssignmentResourceType;
    resourceId: number;
  }): Promise<void> {
    const { tagId, resourceType, resourceId } = options;
    await this.exec(`cntb create tagAssignment "${tagId}" "${resourceType}" "${resourceId}"`);
  }

  async deleteTagAssignment(options: {
    tagId: number;
    resourceType: ContaboTagAssignmentResourceType;
    resourceId: string;
  }): Promise<void> {
    const { tagId, resourceType, resourceId } = options;
    await this.exec(`cntb delete tagAssignment "${tagId}" "${resourceType}" "${resourceId}"`);
  }

  listTagAssignments(
    options: ContaboListOptions<{
      tagId?: number;
    }>
  ): Promise<ContaboTagAssignment[]> {
    return this.execList(
      ["cntb get tagAssignments --output json", options.tagId && `--tagId "${options.tagId}"`]
        .filter(Boolean)
        .join(" "),
      options
    );
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

  private async getAvailableInstance(options: {
    displayName: string;
    productId?: ContaboProductId;
    preferedDataCenter?: string;
  }): Promise<ContaboInstance | null> {
    for (let page = 1; page < Infinity; page++) {
      const instances = await this.listInstances({ page });
      if (instances.length === 0) {
        return null;
      }
      // find the first available instance, prefer with same datacenter
      let availableInstances = instances;
      if (options.preferedDataCenter) {
        availableInstances = availableInstances.sort(
          (a) => options.preferedDataCenter?.localeCompare(a.dataCenter ?? "") ?? 1
        );
      }
      const availableInstance = availableInstances.find(
        (instance) =>
          instance.displayName === "" &&
          (options.productId === undefined || instance.productId === options.productId) &&
          (instance.status === "stopped" || instance.status === "running")
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

  // async ensureTag(options: { name: string; color?: string }): Promise<number> {
  //   const { name, color } = options;
  //   const tags = await this.listTags({ tagName: name });
  //   if (tags.length === 0) {
  //     return await this.createTag({ name, color });
  //   }
  //   return tags[0].tagId;
  // }

  // async assignTag(options: {
  //   name: string;
  //   color?: string;
  //   resourceType: ContaboTagAssignmentResourceType;
  //   resourceId: number;
  // }): Promise<number> {
  //   const { name, color, resourceType, resourceId } = options;
  //   const tagId = await this.ensureTag({ name, color });
  //   const tagAssignments = await this.listTagAssignments({
  //     tagId,
  //   });
  //   if (tagAssignments.length === 0) {
  //     await this.createTagAssignment({ tagId, resourceType, resourceId });
  //   }
  //   return tagId;
  // }

  // async unassignTag(options: {
  //   name: string;
  //   resourceType: ContaboTagAssignmentResourceType;
  //   resourceId: string;
  // }): Promise<void> {
  //   const { name, resourceType, resourceId } = options;
  //   const tagId = await this.ensureTag({ name });
  //   const tagAssignments = await this.listTagAssignments({
  //     tagId,
  //   })
  //   if (tagAssignments.length > 0) {
  //     await this.deleteTagAssignment({ tagId, resourceType, resourceId });
  //   }
  // }

  // async listAssignedTags(options: ContaboListOptions<{ tag: string }>): Promise<ContaboTagAssignment[]> {
  //   const { tag } = options;
  //   const [{ tagId }] = (await this.listTags({ tagName: tag })) ?? [{}];
  //   if (tagId === undefined) {
  //     return [];
  //   }
  //   const tagAssignments = await this.listTagAssignments({ tagId, ...options });
  //   return tagAssignments;
  // }

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
    preferedDataCenter?: string;
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

    // reinstall instance
    const instanceId = await this.reinstallInstance({
      instanceId: instance.instanceId,
      sshKeys,
    });

    // assign private networks if any and if not
    await Promise.allSettled(
      privateNetworks.map((privateNetworkId) =>
        this.assignPrivateNetwork(privateNetworkId, instance.instanceId).catch(() => {})
      )
    );

    // restart instance
    await this.restartInstance(instanceId);

    if (instance.displayName !== displayName) {
      await this.setInstanceDisplayName(instanceId, displayName);
    }

    return instanceId;
  }
}
