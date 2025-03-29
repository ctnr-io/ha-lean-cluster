import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import { caller } from "../caller.ts";

// Test configuration
const TEST_DOMAIN = "e2e-test.ctnr.io";

describe("Cluster API E2E Tests", () => {
  // This test creates a cluster and should run first
  it("1. createCluster - should create a new cluster", async () => {
    const result = await caller.createCluster({
      domainName: TEST_DOMAIN,
      k8sVersion: "1.31.4",
      cni: "calico",
      podCidr: "10.244.0.0/16",
      serviceCidr: "10.96.0.0/12",
    });

    console.log("Create cluster result:", result);
    assertEquals(result.success, true);
    assertStringIncludes(result.message, "Cluster created successfully");
  });

  // This test should run after createCluster
  it("2. createCluster - should fail if cluster already exists", async () => {
    const result = await caller.createCluster({
      domainName: TEST_DOMAIN,
      k8sVersion: "1.31.4",
      cni: "calico",
      podCidr: "10.244.0.0/16",
      serviceCidr: "10.96.0.0/12",
    });

    console.log("Create duplicate cluster result:", result);
    assertEquals(result.success, false);
    assertStringIncludes(result.message, "already exists");
  });
});
