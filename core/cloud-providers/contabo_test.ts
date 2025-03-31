import { after, describe, it } from "@std/testing/bdd";
import { ContaboPrivateNetwork, ContaboProvider, ContaboSecret, ContaboInstance } from "./contabo.ts";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { randomUUID } from "node:crypto";
import { AllowedTerminationSignals, executeSSH, handleTerminationSignals, TerminationSignals } from "../utils.ts";

const SSH_PUBLIC_KEY = Deno.readTextFileSync("public.key");

const testId = `test-${randomUUID()}`;
const provider = new ContaboProvider();

async function ensureTestInstance(): Promise<ContaboInstance> {
  let instance: ContaboInstance | undefined = undefined;
  const instances = await provider.listInstances({ page: 0 });
  instance = instances.find(
    (instance) =>
      instance.displayName === testId ||
      (instance.displayName.startsWith("test-") && instance.status === "stopped" && instance.productId === "V76")
  );
  // create test instance if it doesn't exist

  if (!instance) {
    const allTestsInstances = instances.filter((instance) => instance.displayName.startsWith("test-") && instance.status !== "installing");
    if (allTestsInstances.length <= 3) {
      console.info("No test instance found, creating a new one");
      const instanceId = await provider.createInstance({
        productId: "V76",
        displayName: testId,
        sshKeys: [],
      });
      return await provider.getInstance(instanceId);
    }
    console.info("Too many test instances, wait for available instance");
    let tries = 0;
    while (true) {
      const instances = await provider.listInstances({ page: 0 });
      instance = instances.find(
        (instance) =>
          instance.displayName === testId ||
          (instance.displayName.startsWith("test-") && instance.status === "stopped" && instance.productId === "V76")
      );
      if (instance) {
        break;
      }
      // After more than 3 tries (>50s), stop all instances
      if (tries++ > 10) {
        console.info("Stopping all test instances because we waited too much");
        await Promise.allSettled(allTestsInstances.map((instance) => provider.stopInstance(instance.instanceId)));
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  const instanceId = instance.instanceId;
  if (instance.status !== "running" && instance.status !== "installing") {
    await provider.startInstance(instanceId).catch(() => {});
  }
  await provider.setInstanceDisplayName(instanceId, testId);
  // wait for the instance to be running
  while (true) {
    const instance = await provider.getInstance(instanceId);
    if (instance.status === "running") {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return instance;
}

async function cleanup() {
  console.info("Stopping test instance");
  const instance = await ensureTestInstance();
  await provider.stopInstance(instance.instanceId);
}

handleTerminationSignals(async () => {
  await cleanup();
  Deno.exit(0);
});

// Make sure the test instance is stopped after tests

describe(
  "Contabo Cloud Provider: testId=" + testId,
  {
    afterAll: async () => {
      await cleanup();
    },
    sanitizeExit: true,
    sanitizeOps: true,
    sanitizeResources: true,
  },
  () => {
    it("Should be able to create, list, get instances and cancel it", async () => {
      // List instances and get first one
      {
        const instances = await provider.listInstances({ page: 0 });
        const instance = await provider.getInstance(instances[0].instanceId);
        assertEquals(instance.instanceId, instances[0].instanceId);
      }

      // Ensure test instance
      {
        const instance = await ensureTestInstance();
        assertStringIncludes(instance.displayName, "test-");
      }
    });

    it("Should be able to create, get and delete secrets and add it", async () => {
      let secretId: number | undefined = undefined;
      let secret: ContaboSecret | null = null;
      try {
        const name = testId;
        secretId = await provider.createSecret({ type: "ssh", name, value: SSH_PUBLIC_KEY });
        const secrets = await provider.listSecrets({ type: "ssh", name });
        secret = secrets[0];
        assertEquals(secret.secretId, secretId);
        secret = await provider.getSecret(secretId);
        assertEquals(secret.name, name);
      } finally {
        if (secretId !== undefined) {
          await provider.deleteSecret(secretId).catch((cause) => {
            throw new Error("The secret was not deleted, you must do it manually: id=" + secretId, {
              cause,
            });
          });
        }
      }
    });

    it("Should be able to create, get and delete privateNetworks", async () => {
      let privateNetworkId: number | undefined = undefined;
      let privateNetwork: ContaboPrivateNetwork | undefined = undefined;
      try {
        const name = testId;
        privateNetworkId = await provider.createPrivateNetwork({ name, region: "EU" });
        const privateNetworks = await provider.listPrivateNetworks({ name });
        privateNetwork = privateNetworks[0];
        assertEquals(privateNetwork.privateNetworkId, privateNetworkId);
        privateNetwork = await provider.getPrivateNetwork(privateNetworkId);
        assertEquals(privateNetwork.name, name);
      } finally {
        if (privateNetworkId !== undefined) {
          await provider.deletePrivateNetwork(privateNetworkId).catch((cause) => {
            throw new Error("The privateNetwork was not deleted, you must do it manually: id=" + privateNetworkId, {
              cause,
            });
          });
        }
      }
    });

    it("Assign secret and private network to instance", async () => {
      let instanceId: number | undefined = undefined;
      let secretId: number | undefined = undefined;
      let privateNetworkId: number | undefined = undefined;
      try {
        const instance = await ensureTestInstance();
        // check if the private network addons is enabled on instance
        if (!instance.addOns.some((addOn) => addOn.id === 1477)) {
          console.info("Private network addon is not enabled on instance, add it");
          await provider.upgradeInstance({
            instanceId: instance.instanceId,
            privateNetwork: true,
          });
        }
        instanceId = instance.instanceId;
        privateNetworkId = await provider.createPrivateNetwork({ name: testId, region: "EU" });
        const privateNetwork = await provider.getPrivateNetwork(privateNetworkId);
        secretId = await provider.createSecret({ type: "ssh", name: testId, value: SSH_PUBLIC_KEY });
        const secret = await provider.getSecret(secretId);

        await provider.assignPrivateNetwork(privateNetwork.privateNetworkId, instance.instanceId);
        await provider.reinstallInstance({
          instanceId: instance.instanceId,
          sshKeys: [secret.secretId],
        });
        // check that private network is assigned
        const stdout = await executeSSH(instance.ipv4, `ip a`);
        assertStringIncludes(stdout, `3: eth1`);
      } finally {
        // unassign private network
        if (privateNetworkId !== undefined && instanceId !== undefined) {
          await provider.unassignPrivateNetwork(privateNetworkId, instanceId).catch(() => {});
        }
        if (privateNetworkId !== undefined) {
          await provider.deletePrivateNetwork(privateNetworkId).catch(() => {});
        }
        if (secretId !== undefined) {
          await provider.deleteSecret(secretId).catch(() => {});
        }
      }
    });
  }
);
