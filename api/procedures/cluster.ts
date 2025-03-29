import { z } from "zod";
import { trpc } from "../trpc.ts";
import {
  executeSSH,
  getControlPlaneEndpoint,
  getNodeIP,
  getNodes,
  getAvailableContaboInstances,
  writeFile,
  generateNodeInfo,
  clusterExists,
  claimAvailableVPS,
  assignRoleToVPS,
  resetContaboNode
} from "../utils.ts";

export const cniOptions = ["calico", "flannel"] as const;
export const nodeRoles = ["control-plane", "etcd", "worker"] as const;
export type NodeRole = typeof nodeRoles[number];

// Define input schemas for each procedure
const createClusterSchema = z.object({
  domainName: z.string(),
  k8sVersion: z.string().optional().default("1.31.4"),
  cni: z.enum(cniOptions).optional().default("calico"),
  podCidr: z.string().optional().default("10.244.0.0/16"),
  serviceCidr: z.string().optional().default("10.96.0.0/12"),
});

const addNodeSchema = z.object({
  domainName: z.string(),
  nodeName: z.string().optional(),
  role: z.enum(nodeRoles).default("worker"),
});

const removeNodeSchema = z.object({
  domainName: z.string(),
  nodeName: z.string(),
});

const scaleNodeSchema = z.object({
  domainName: z.string(),
  nodeName: z.string(),
  resources: z.object({
    cpu: z.number().optional(),
    memory: z.number().optional(),
    disk: z.number().optional(),
  }),
});

const scaleClusterSchema = z.object({
  domainName: z.string(),
  controlPlaneNodes: z.number().optional(),
  workerNodes: z.number().optional(),
  etcdNodes: z.number().optional(),
});

const deleteClusterSchema = z.object({
  domainName: z.string(),
  confirm: z.boolean(),
});

const sh = String.raw;

// Create cluster procedure
export const createCluster = trpc.procedure.input(createClusterSchema).mutation(async ({ input }) => {
  try {
    // Generate node information
    await generateNodeInfo();

    // Check if cluster already exists
    const exists = await clusterExists(input.domainName);
    if (exists) {
      throw new Error(
        `A cluster with domain name ${input.domainName} already exists. Please use a different domain name.`
      );
    }

    // Claim an available VPS
    const claimedInstance = await claimAvailableVPS(input.domainName);
    if (!claimedInstance) {
      throw new Error("No available instances found. Please provision instances in Contabo first.");
    }

    console.log(`Claimed instance ${claimedInstance.instanceId} with domain ${claimedInstance.displayName}`);

    // Assign control-plane role to the claimed instance
    const controlPlaneInstance = await assignRoleToVPS(claimedInstance, "control-plane");
    if (!controlPlaneInstance) {
      throw new Error("Failed to assign control-plane role to the claimed instance.");
    }

    console.log(`Assigned control-plane role to instance: ${controlPlaneInstance.displayName}`);

    // Regenerate node information after claiming the instance
    await generateNodeInfo();

    // Get control plane endpoint
    const controlPlaneEndpoint = controlPlaneInstance.ipv4;

    // Set default values
    const k8sVersion = input.k8sVersion || "1.31.4";
    const cni = input.cni || "calico";
    const podCidr = input.podCidr || "10.244.0.0/16";
    const serviceCidr = input.serviceCidr || "10.96.0.0/12";

    // Initialize control plane
    console.log(`Initializing control plane on ${controlPlaneEndpoint}...`);
    await executeSSH(
      controlPlaneEndpoint,
      sh`kubeadm init --kubernetes-version=${k8sVersion} \
        --pod-network-cidr=${podCidr} \
        --service-cidr=${serviceCidr} \
        --control-plane-endpoint=${controlPlaneEndpoint}:6443 \
        --upload-cert
        `
    );

    // Install CNI
    console.log(`Installing CNI (${cni})...`);
    if (cni === "calico") {
      await executeSSH(
        controlPlaneEndpoint,
        sh`kubectl --kubeconfig=/etc/kubernetes/admin.conf apply -f https://docs.projectcalico.org/manifests/calico.yaml`
      );
    } else if (cni === "flannel") {
      await executeSSH(
        controlPlaneEndpoint,
        sh`kubectl --kubeconfig=/etc/kubernetes/admin.conf apply -f https://raw.githubusercontent.com/flannel-io/flannel/master/Documentation/kube-flannel.yml`
      );
    }

    // Fetch kubeconfig
    console.log("Fetching kubeconfig...");
    const kubeconfig = await executeSSH(controlPlaneEndpoint, "cat /etc/kubernetes/admin.conf");
    await writeFile("kubeconfig.yml", kubeconfig);

    return {
      success: true,
      message: "Cluster created successfully! Kubeconfig saved to kubeconfig.yml",
      controlPlaneEndpoint,
      kubeconfig,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to create cluster: ${errorMessage}`);
    return {
      success: false,
      message: `Failed to create cluster: ${errorMessage}`,
    };
  }
});