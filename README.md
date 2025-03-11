# Kubernetes Cluster Setup

This repository contains the configuration for a Kubernetes cluster deployed using [Kubespray](https://github.com/kubernetes-sigs/kubespray). The setup is managed through configuration files and templates that are used to generate the final deployment files.

## Cluster Overview

- **Kubernetes Version**: v1.31.4
- **Container Runtime**: containerd
- **Network Plugin**: Calico
- **DNS Mode**: CoreDNS with NodeLocal DNS Cache enabled

## Cluster Architecture

The cluster consists of 3 nodes with the following roles:

| Node        | IP              | Internal IP | Roles                           |
|-------------|-----------------|------------|--------------------------------|
| vmi2497289  | 62.171.183.141  | 10.0.0.2   | control-plane, etcd, worker    |
| vmi2497221  | 164.68.102.184  | 10.0.0.1   | worker                         |
| vmi2501149  | 167.86.74.90    | 10.0.0.4   | worker                         |

### Network Configuration

- **Service CIDR**: 10.233.0.0/18
- **Pod CIDR**: 10.233.64.0/18
- **Node Prefix**: /24 (allows up to 254 pods per node)
- **Proxy Mode**: IPVS with strict ARP enabled

## Enabled Addons

The cluster has the following addons enabled:

### MetalLB (Load Balancer)

- **Status**: Enabled
- **Mode**: Layer 2
- **IP Range**: 10.0.0.0/22
- **Auto Assign**: Enabled
- **Tolerations**: Configured to run on control plane nodes

### Kube-VIP

- **Status**: Enabled
- **VIP Address**: 62.171.183.141
- **Interface**: eth0
- **Features**:
  - Control plane high availability
  - ARP mode enabled

### Gateway API CRDs

- **Status**: Enabled
- **Purpose**: Provides modern service networking APIs

## DNS Configuration

- **Cluster Domain**: cluster.local
- **NodeLocal DNS Cache**: Enabled (IP: 169.254.25.10)
- **CoreDNS**: Primary DNS provider

## Security Configuration

- **API Server Anonymous Auth**: Enabled
- **Encryption at Rest**: Disabled
- **SSL Addresses**: Includes 62.171.183.141, 10.0.0.2

## Usage

### Accessing the Cluster

The cluster can be accessed using the generated kubeconfig file. The API server is available at:

- **API Server Address**: 62.171.183.141
- **API Server Port**: 6443

### Cluster Management

This cluster is managed using configuration files that are processed through a template system. The workflow is:

1. Edit template files in the `templates/` directory
2. Run `make generate` to create the actual configuration files
3. Apply changes using Kubespray's Ansible playbooks

### Important Files

- `inventory.ini`: Defines the cluster nodes and their roles
- `group_vars/k8s_cluster/k8s-cluster.yml`: Main Kubernetes configuration
- `group_vars/k8s_cluster/addons.yml`: Addon configurations
- `kubeconfig.yml`: Credentials for accessing the cluster

## Deployment Workflow

The cluster uses a template-based approach for configuration management:

1. TypeScript templates in the `templates/` directory define the configuration
2. The `_generate.ts` script processes these templates
3. Running `make generate` creates the actual configuration files
4. These generated files are then used by Kubespray to deploy or update the cluster

## Use Cases

This cluster is suitable for:

- Production workloads requiring high availability
- Applications that need load balancing capabilities (via MetalLB)
- Services that require stable access to the control plane (via Kube-VIP)
- Modern service networking with Gateway API

## Notes

- The cluster uses a single control plane node but is configured for high availability using Kube-VIP
- MetalLB is configured in Layer 2 mode for load balancing services
- The configuration is generated from templates, so direct edits to the configuration files will be overwritten when `make generate` is run

## Maintenance

To update the cluster configuration:

1. Modify the template files in the `templates/` directory
2. Run `make generate` to update the configuration files
3. Apply the changes using Kubespray

Remember to update this README when making significant changes to the cluster architecture or configuration.
