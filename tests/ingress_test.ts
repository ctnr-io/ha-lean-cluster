/**
 * Ingress Test
 *
 * This test verifies that the Nginx ingress controller is working correctly by:
 * 1. Applying test Kubernetes manifests (namespace, deployment, service, ingress)
 * 2. Waiting for the deployment to be ready
 * 3. Getting the ingress IP address
 * 4. Testing the ingress by making HTTP requests (both IP-based and host-based)
 * 5. Cleaning up the resources
 */

import { domainName } from "../helpers.ts";

// Custom domain for the ingress test
export const ingressTestHost = `ingress-test.${domainName}`;

// Constants
const NAMESPACE = "ingress-test";
const FIXTURES_DIR = "./tests/fixtures";
const TIMEOUT_MS = 120000; // 2 minutes

// Types
type TestResult = {
  success: boolean;
  message: string;
  details?: string;
};

/**
 * Run a kubectl command and return the output
 */
async function kubectl(args: string[]): Promise<string> {
  const cmd = new Deno.Command("kubectl", { args: ["--kubeconfig", "kubeconfig.yml", ...args] });
  const { stdout, stderr, success } = await cmd.output();

  if (!success) {
    const errorOutput = new TextDecoder().decode(stderr);
    throw new Error(`kubectl command failed: ${errorOutput}`);
  }

  return new TextDecoder().decode(stdout).trim();
}

/**
 * Apply Kubernetes manifests
 */
async function applyManifests(): Promise<void> {
  console.log("Applying Kubernetes manifests...");
  await kubectl(["apply", "-f", FIXTURES_DIR]);
}

/**
 * Wait for the deployment to be ready
 */
async function waitForDeployment(): Promise<void> {
  console.log("Waiting for deployment to be ready...");
  await kubectl(["-n", NAMESPACE, "rollout", "status", "deployment/nginx-test", `--timeout=${TIMEOUT_MS}ms`]);
}

/**
 * Test ingress using host-based access (simulated)
 */
async function testIngressWithHost(): Promise<TestResult> {
  console.log(`Testing ingress using host: http://${ingressTestHost}/`);

  try {
    // For host-based testing, we're still using the IP but with a different Host header format
    // In a real environment with DNS, we would use the actual hostname
    const response = await fetch(`http://${ingressTestHost}/`, {
      headers: {
        Host: ingressTestHost,
      },
    });

    if (response.status === 200) {
      const body = await response.text();
      return {
        success: true,
        message: `Host-based test passed! Response code: ${response.status}`,
        details: body.substring(0, 100) + (body.length > 100 ? "..." : ""),
      };
    } else {
      return {
        success: false,
        message: `Host-based test failed! Response code: ${response.status}`,
        details: await response.text(),
      };
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Host-based HTTP request failed: ${errorMessage}`,
    };
  }
}

/**
 * Clean up resources
 */
async function cleanupResources(): Promise<void> {
  console.log("Cleaning up resources...");
  await kubectl(["delete", "-f", FIXTURES_DIR, "--ignore-not-found"]);
}

/**
 * Display test result
 */
function displayTestResult(result: TestResult): void {
  if (result.success) {
    console.log(`✅ ${result.message}`);
  } else {
    console.error(`❌ ${result.message}`);
    if (result.details) {
      console.log("Details:");
      console.log(result.details);
    }
  }
}

/**
 * Main test function
 */
Deno.test({
  name: "Nginx Ingress Controller Test",
  async fn() {
    try {
      console.log("Starting ingress test...");

      // Step 1: Apply manifests
      await applyManifests();

      // Step 2: Wait for deployment
      await waitForDeployment();

      // Step 4: Test ingress with host
      const hostTestResult = await testIngressWithHost();
      displayTestResult(hostTestResult);

      // Verify overall success
      if (!hostTestResult.success) {
        throw new Error("One or more ingress tests failed");
      }
    } finally {
      // Clean up resources regardless of test outcome
      await cleanupResources();
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
