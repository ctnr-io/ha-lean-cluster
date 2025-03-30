import * as util from "node:util";
import * as childProcess from "node:child_process";
import * as fs from "node:fs/promises";
import { nodeRoles } from "../api/procedures/cluster.ts";

export const NodeRoles = ["control-plane", "etcd", "worker"] as const;
export type NodeRoles = (typeof NodeRoles)[number][];
type NodeRole = typeof nodeRoles[number];

const _exec = util.promisify(childProcess.exec);

export const sh = String.raw
export const yaml = String.raw

/**
 * Ensure a directory exists
 */
export async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to create directory ${dir}: ${errorMessage}`);
    throw new Error(`Failed to create directory ${dir}: ${errorMessage}`);
  }
}

/**
 * Write content to a file
 */
export async function writeFile(filePath: string, content: string): Promise<void> {
  try {
    await fs.writeFile(filePath, content, 'utf8');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to write to file ${filePath}: ${errorMessage}`);
    throw new Error(`Failed to write to file ${filePath}: ${errorMessage}`);
  }
}

/**
 * Read content from a file
 */
export async function readFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to read file ${filePath}: ${errorMessage}`);
    throw new Error(`Failed to read file ${filePath}: ${errorMessage}`);
  }
}

/**
 * Execute a command and return the output
 */
export async function exec(command: string): Promise<string> {
  console.log(`Executing: ${command}`);
  
  try {
    const { stdout, stderr } = await _exec(command);
    if (stderr) {
      console.error(`Command stderr: ${stderr}`);
    }
    return stdout.trim();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Command failed: ${errorMessage}`);
    throw new Error(`Failed to execute command: ${errorMessage}`);
  }
}

/**
 * Execute an SSH command on a remote host
 */
export async function executeSSH(host: string, command: string): Promise<string> {
  return await exec(`ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@${host} '${command}'`);
}
