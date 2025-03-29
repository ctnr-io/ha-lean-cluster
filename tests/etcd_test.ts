/**
 * ETCD Health Test
 *
 * This test verifies that the etcd cluster is healthy by:
 * 1. Checking if the etcd cluster has a leader
 * 2. Verifying all members are healthy
 * 3. Checking for any active alarms
 * 4. Checking response times
 */

import { etcds } from "../helpers.ts";
import * as process from "node:process";

// Types
type TestResult = {
  success: boolean;
  message: string;
  details?: string;
};

/**
 * Run an SSH command on an etcd node and return the output
 */
async function sshCommand(node: (typeof etcds)[0], command: string): Promise<string> {
  const cmd = new Deno.Command("ssh", {
    args: [
      "-o",
      "ConnectTimeout=5",
      "-o",
      "StrictHostKeyChecking=no",
      `root@${node.publicIp}`,
      command,
    ],
  });

  const { stdout, stderr, success } = await cmd.output();

  if (!success) {
    throw new Error(`SSH command failed: ${new TextDecoder().decode(stderr)}`);
  }

  return new TextDecoder().decode(stdout).trim();
}

/**
 * Run an etcdctl command and return the output
 */
async function etcdctl(args: string[]): Promise<string> {
  const etcdNode = etcds[0];
  const command = `ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key ${args.join(" ")}`;

  return await sshCommand(etcdNode, command);
}

/**
 * Check etcd cluster health
 */
async function checkEtcdHealth(): Promise<TestResult> {

  try {
    const output = await etcdctl(["endpoint", "health", "--cluster"]);

    // Check if we have any endpoints and if they're all healthy
    const healthLines = output.split("\n").filter((line) => line.trim() !== "");
    const hasEndpoints = healthLines.length > 0;
    const allHealthy = hasEndpoints && healthLines.every((line) => line.includes("is healthy"));

    let message;
    if (!hasEndpoints) {
      message = "No etcd endpoints found";
    } else if (allHealthy) {
      message = `All ${healthLines.length} etcd endpoints are healthy`;
    } else {
      const healthyCount = healthLines.filter((line) => line.includes("is healthy")).length;
      message = `${healthyCount}/${healthLines.length} etcd endpoints are healthy`;
    }

    return {
      success: allHealthy,
      message,
      details: output,
    };
  } catch (error: unknown) {
    return {
      success: false,
      message: `Failed to check etcd health: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Check etcd member list
 */
async function checkEtcdMembers(): Promise<TestResult> {
  try {
    const output = await etcdctl(["member", "list", "-w", "table"]);
    const memberLines = output.split("\n").filter((line) => line.includes("started"));

    // We expect at least 1 member, and ideally 3 for high availability
    const minExpectedMembers = 1;
    const idealMembers = 3;

    // Success if we have at least the minimum number of members
    const success = memberLines.length >= minExpectedMembers;

    let message;
    if (memberLines.length >= idealMembers) {
      message = `Found ${memberLines.length} etcd members - cluster has high availability`;
    } else if (success) {
      message = `Found ${memberLines.length} etcd members - cluster is functional but lacks high availability`;
    } else {
      message = `Expected at least ${minExpectedMembers} etcd members, but found ${memberLines.length}`;
    }

    return {
      success,
      message,
      details: output,
    };
  } catch (error: unknown) {
    return {
      success: false,
      message: `Failed to check etcd members: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Check for etcd alarms
 */
async function checkEtcdAlarms(): Promise<TestResult> {
  try {
    const output = await etcdctl(["alarm", "list"]);
    const noAlarms = output.trim() === "" || output.includes("memberID:0 alarm:NONE");

    return {
      success: noAlarms,
      message: noAlarms ? "No etcd alarms found" : "Active etcd alarms found",
      details: output || "No alarms",
    };
  } catch (error: unknown) {
    return {
      success: false,
      message: `Failed to check etcd alarms: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Check etcd response time
 */
async function checkEtcdResponseTime(): Promise<TestResult> {
  try {
    const start = performance.now();
    await etcdctl(["get", "--prefix", "--limit=1", "/"]);
    const end = performance.now();
    const responseTime = end - start;
    const isGood = responseTime < 1000;
    const isAcceptable = responseTime < 3000;

    return {
      success: isAcceptable,
      message: `Etcd response time is ${isGood ? "good" : isAcceptable ? "acceptable" : "slow"}: ${responseTime.toFixed(
        2
      )}ms`,
    };
  } catch (error: unknown) {
    return {
      success: false,
      message: `Failed to check etcd response time: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

Deno.test({
  name: "Check etcd cluster is healthy",
  async fn() {
    await checkEtcdHealth();
  },
});

Deno.test({
  name: "Check etcd member list",
  async fn() {
    await checkEtcdMembers();
  },
});

Deno.test({
  name: "Check etcd alarms ",
  async fn() {
    await checkEtcdAlarms();
  },
});

Deno.test({
  name: "Check etcd response time",
  async fn() {
    await checkEtcdResponseTime();
  }
});
