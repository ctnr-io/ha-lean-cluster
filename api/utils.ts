import * as util from "node:util";
import * as childProcess from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { nodeRoles } from "./procedures/cluster.ts";

export const NodeRoles = ["control-plane", "etcd", "worker"] as const;
export type NodeRoles = (typeof NodeRoles)[number][];
type NodeRole = typeof nodeRoles[number];

const _exec = util.promisify(childProcess.exec);

export const sh = String.raw
export const yaml = String.raw

// SSH options
const SSH_OPTS = "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null";

/**
 * Execute an SSH command on a remote host
 */
export async function executeSSH(host: string, command: string): Promise<string> {
  const sshCommand = `ssh ${SSH_OPTS} root@${host} "${command}"`;
  console.log(`Executing SSH: ${sshCommand}`);
  
  try {
    const { stdout, stderr } = await exec(sshCommand);
    if (stderr) {
      console.error(`SSH stderr: ${stderr}`);
    }
    return stdout.trim();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`SSH command failed: ${errorMessage}`);
    throw new Error(`Failed to execute SSH command on ${host}: ${errorMessage}`);
  }
}

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

// Types for Contabo instances
export interface ContaboInstance {
  instanceId: string;
  displayName: string;
  ipv4: string;
  status: string;
  // Add other properties as needed
}

/**
 * Get available instances from Contabo
 * Available instances are those with empty displayName and status == "running"
 */
export async function getAvailableContaboInstances(): Promise<ContaboInstance[]> {
  try {
    // Ensure .cntb directory exists
    await ensureDir('.cntb');
    
    // Get instances
    await executeCommand('cntb get instances --output json > .cntb/instances.json');
    
    // Read and parse instances
    const instancesJson = await readFile('.cntb/instances.json');
    const instances: ContaboInstance[] = JSON.parse(instancesJson);
    
    // Filter available instances
    return instances.filter(instance => 
      instance.displayName === "" && 
      instance.status.toLowerCase() === "running"
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to get available Contabo instances: ${errorMessage}`);
    throw new Error(`Failed to get available Contabo instances: ${errorMessage}`);
  }
}

/**
 * Check if a cluster with the given domain name already exists
 */
export async function clusterExists(domainName: string): Promise<boolean> {
  try {
    const nodes = await getNodes(domainName);
    return nodes.length > 0;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to check if cluster exists: ${errorMessage}`);
    return false;
  }
}

/**
 * Claim an available VPS
 * @param domainName The domain name to use as a prefix for the node name
 * @returns The claimed instance or null if no available instances
 */
export async function claimAvailableVPS(domainName: string): Promise<ContaboInstance | null> {
  try {
    // Get available instances
    const availableInstances = await getAvailableContaboInstances();
    if (availableInstances.length === 0) {
      return null;
    }
    
    // Get the first available instance
    const instance = availableInstances[0];
    
    // Rename the instance with the domain name
    await executeCommand(`cntb update instance ${instance.instanceId} --display-name="${domainName}"`);
    
    // Update the instance object with the new name
    instance.displayName = domainName;
    
    return instance;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to claim available VPS: ${errorMessage}`);
    return null;
  }
}

/**
 * Get all nodes for a domain
 */
export async function getNodes(domainName: string): Promise<Array<{ name: string, ip: string, role: string }>> {
  try {
    // Ensure .cntb directory exists
    await ensureDir('.cntb');
    
    // Get instances
    await executeCommand('cntb get instances --output json > .cntb/instances.json');
    
    // Read and parse instances
    const instancesJson = await readFile('.cntb/instances.json');
    const instances: ContaboInstance[] = JSON.parse(instancesJson);
    
    // Filter and transform nodes for the domain
    return instances
      .filter(instance => instance.displayName.startsWith(`${domainName}_`))
      .map(instance => {
        const name = instance.displayName;
        const ip = instance.ipv4;
        
        // Extract role from name
        let role = "unknown";
        if (name.includes("control-plane")) {
          role = "control-plane";
        } else if (name.includes("worker")) {
          role = "worker";
        } else if (name.includes("etcd")) {
          role = "etcd";
        }
        
        return { name, ip, role };
      });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to get nodes: ${errorMessage}`);
    throw new Error(`Failed to get nodes: ${errorMessage}`);
  }
}

/**
 * Get the control plane endpoint
 */
export async function getControlPlaneEndpoint(domainName: string): Promise<string> {
  const nodes = await getNodes(domainName);
  const controlPlane = nodes.find(node => 
    node.name === `${domainName}_control-plane` || 
    node.name.startsWith(`${domainName}_control-plane_`)
  );
  
  if (!controlPlane) {
    throw new Error(`No control plane endpoint found for domain ${domainName}`);
  }
  
  return controlPlane.ip;
}

/**
 * Get the IP address of a node by name
 */
export async function getNodeIP(nodeName: string): Promise<string> {
  // Extract domain name from node name
  const domainPrefix = nodeName.split('_')[0];
  
  const nodes = await getNodes(domainPrefix);
  const node = nodes.find(n => n.name === nodeName);
  
  if (!node) {
    throw new Error(`No IP found for node ${nodeName}`);
  }
  
  return node.ip;
}

/**
 * Generate node information
 */
export async function generateNodeInfo(): Promise<void> {
  try {
    // Ensure .cntb directory exists
    await ensureDir('.cntb');
    
    // Get private networks
    await executeCommand('cntb get privateNetworks --output json > .cntb/private-networks.json');
    
    // Get instances
    await executeCommand('cntb get instances --output json > .cntb/instances.json');
    
    // Run generate.ts
    // await executeCommand('deno -A ./generate.ts');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to generate node information: ${errorMessage}`);
    throw new Error(`Failed to generate node information: ${errorMessage}`);
  }
}

/**
 * Assign a role to a claimed VPS
 * @param instance The claimed instance
 * @param role The role to assign (control-plane, worker, etcd)
 * @returns The updated instance or null if assignment failed
 */
export async function assignRoleToVPS(
  instance: ContaboInstance, 
  role: NodeRole
): Promise<ContaboInstance | null> {
  try {
    // Extract domain name from current display name
    const domainName = instance.displayName;
    
    // Create new name with role (no index)
    const newName = `${domainName}_${role}`;
    
    // Update the instance name
    await executeCommand(`cntb update instance ${instance.instanceId} --display-name="${newName}"`);
    
    // Update the instance object with the new name
    instance.displayName = newName;
    
    return instance;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to assign role to VPS: ${errorMessage}`);
    return null;
  }
}


/**
 * Reset/disclaim a Contabo node by setting its display name to empty
 * This marks the node as available for future use
 * @param nodeName The name of the node to reset
 * @returns True if the node was successfully reset, false otherwise
 */
export async function resetContaboNode(nodeName: string): Promise<boolean> {
  try {
    // Ensure .cntb directory exists
    await ensureDir('.cntb');
    
    // Get instances
    await executeCommand('cntb get instances --output json > .cntb/instances.json');
    
    // Read and parse instances
    const instancesJson = await readFile('.cntb/instances.json');
    const instances: ContaboInstance[] = JSON.parse(instancesJson);
    
    // Find the instance with the given name
    const instance = instances.find(inst => inst.displayName === nodeName);
    
    if (!instance) {
      console.error(`No instance found with name ${nodeName}`);
      return false;
    }
    
    // Reset the instance name to empty string
    await executeCommand(`cntb update instance ${instance.instanceId} --display-name=""`);
    console.log(`Successfully reset node ${nodeName} (Instance ID: ${instance.instanceId})`);
    
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to reset Contabo node ${nodeName}: ${errorMessage}`);
    return false;
  }
}
