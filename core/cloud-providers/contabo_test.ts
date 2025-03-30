import { describe, it } from "@std/testing/bdd";
import { ContaboPrivateNetwork, ContaboProvider, ContaboSecret, ContaboInstance} from "./contabo.ts";
import { assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { randomUUID } from "node:crypto";

describe("Contabo Cloud Provider", () => {
  const provider = new ContaboProvider();


  it("Should be able to create, list, get instances and cancel it", async () => {
  let instanceId: number | undefined = undefined;
	let instance: ContaboInstance | undefined = undefined;

    // Create test instance if it doesn't exist
    const instances = await provider.listInstances({ page: 0 });
  	instance = await provider.getInstance(instances[0].instanceId);
    assertEquals(instance.instanceId, instances[0].instanceId);

    instance = instances.find((instance) => instance.displayName.startsWith("test-") && instance.status === "running");
    // create test instance if it doesn't exist
    if (!instance) {
      instanceId = await provider.createInstance({
  			productId: "V76",
        displayName: "test-" + randomUUID(),
        sshKeys: [],
      });
  		instance = await provider.getInstance(instanceId);
    } else {
  		instanceId = instance.instanceId;
  	}
  	assertEquals(instance.instanceId, instanceId);
  	assertStringIncludes(instance.displayName, "test-");

  	// Reinstall test instance
  	await provider.reinstallInstance({
  		instanceId,
  		sshKeys: [],
  	});

  	// Change display name
  	const newDisplayName = "test-" + randomUUID();
  	await provider.setInstanceDisplayName(instanceId, newDisplayName);
  	instance = await provider.getInstance(instanceId);
  	assertStringIncludes(instance.displayName, "test-");

  	// Cancel test instance
  	// await provider.cancelInstance(instanceId);
  	// instance = await provider.getInstance(instanceId);
  	// assertFalse(instance.cancelDate.length > 0);
  });


  it("Should be able to create, get and delete secrets", async () => {
		let secretId: number | undefined = undefined;
		let secret: ContaboSecret | null = null;
    try {
      const name = "test-" + randomUUID();
      secretId = await provider.createSecret({ type: "password", name, value: "0123456789" });
      const secrets = await provider.listSecrets({ type: "password", name });
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
      const name = "test-" + randomUUID();
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
});
