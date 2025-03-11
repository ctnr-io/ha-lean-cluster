# Low-Cost Kubernetes Cluster

This repository provides configuration for deploying a cost-effective Kubernetes cluster using [Kubespray](https://github.com/kubernetes-sigs/kubespray) on Contabo's affordable VPS offerings. The setup uses a configuration generation approach that allows for efficient deployment.

## Cluster Overview

This low-cost Kubernetes setup provides:

- **Latest Kubernetes** (configurable version)
- **Container Runtime**: containerd (default)
- **Network Plugin**: Calico (configurable)
- **DNS**: CoreDNS with NodeLocal DNS Cache

## Cluster Architecture

This cost-optimized cluster supports efficient architectures:

- Single control-plane with multiple workers (optimal cost-to-performance ratio)
- Dual-purpose nodes (control-plane + worker) to maximize resource utilization
- Minimal high availability with strategic component placement

The architecture is defined in the `templates/inventory.ini.ts` file and generated to `inventory.ini`.

### Default Network Configuration

- **Service CIDR**: 10.233.0.0/18
- **Pod CIDR**: 10.233.64.0/18
- **Node Prefix**: /24 (allows up to 254 pods per node)
- **Proxy Mode**: IPVS with strict ARP enabled

## Cost-Effective Addons

The cluster includes carefully selected addons that provide enterprise features without high resource consumption:

### MetalLB (Load Balancer)

- Eliminates need for expensive cloud load balancers
- Layer 2 mode requires no additional infrastructure
- Provides enterprise-grade service exposure on commodity hardware

### Kube-VIP

- High availability without dedicated load balancer hardware
- Minimal resource footprint (runs as DaemonSet)
- Enables control-plane redundancy at minimal cost

### Gateway API CRDs

- Future-proof networking APIs
- Efficient routing capabilities
- No additional resource overhead (CRDs only)

## DNS Configuration Options

- Configurable cluster domain (default: cluster.local)
- NodeLocal DNS Cache for improved performance
- CoreDNS as the primary DNS provider

## Security Options

- Configurable API server authentication
- Optional encryption at rest
- SSL certificate configuration

## Getting Started

### Hardware Recommendations

- **Minimal Setup**: 1 Contabo VPS S with 4 vCPU cores, 8GB RAM (control-plane + worker)
- **Recommended Setup**: 3 Contabo VPS S instances with 4 vCPU cores, 8GB RAM each
- **Storage**: Contabo's default 50GB SSD storage per VPS is sufficient
- **Network**: Contabo's standard 32TB traffic allocation is more than adequate

This configuration is specifically optimized for Contabo's "frugal" cloud resources, which offer an excellent price-to-performance ratio for Kubernetes deployments.

### Quick Start

1. **Clone this repository**
   ```bash
   git clone https://github.com/ctnr.io/cluster.git
   cd cluster
   ```

2. **Configure your cluster**
   - Edit the template files in the `templates/` directory
   - Customize node information in `templates/inventory.ini.ts`
   - Configure Kubernetes settings in `templates/group_vars/k8s_cluster/k8s-cluster.yml.ts`
   - Enable/disable addons in `templates/group_vars/k8s_cluster/addons.yml.ts`

3. **Generate configuration files**
   ```bash
   make generate
   ```

4. **Deploy the cluster using Kubespray**
   ```bash
   make deploy
   ```

### Important Files

- `templates/inventory.ini.ts`: Define your cluster nodes and their roles
- `templates/group_vars/k8s_cluster/k8s-cluster.yml.ts`: Main Kubernetes configuration
- `templates/group_vars/k8s_cluster/addons.yml.ts`: Addon configurations
- `templates/_generate.ts`: Template processing script

## Configuration Generation Approach

This repository uses a configuration generation approach for efficient management:

1. TypeScript templates in the `templates/` directory define the configuration
2. The `_generate.ts` script processes these templates
3. Running `make generate` creates the actual configuration files
4. These generated files are then used by Kubespray to deploy or update the cluster

This approach provides:
- Consistent, reproducible deployments
- Resource-optimized configurations
- Easy adaptation to different hardware constraints

## Use Cases

This low-cost Kubernetes cluster is ideal for:

- Small to medium production workloads
- Self-hosted applications and services
- Learning Kubernetes without expensive cloud costs
- Edge deployments with limited resources
- Startups and small businesses needing Kubernetes capabilities

## Resource Optimization

### Efficient Node Configuration

Edit `templates/inventory.ini.ts` to match your available hardware:

```typescript
// Example of a cost-effective 3-node setup
export default `
[kube_control_plane]
node1 ansible_host=192.168.1.10 ip=192.168.1.10

[etcd]
node1 ansible_host=192.168.1.10 ip=192.168.1.10

[kube_node]
node1 ansible_host=192.168.1.10 ip=192.168.1.10
node2 ansible_host=192.168.1.11 ip=192.168.1.11
node3 ansible_host=192.168.1.12 ip=192.168.1.12
`;
```

### Selective Addon Enablement

Enable only the addons you need to minimize resource usage:

```typescript
// Example of enabling only essential addons
export default `
# MetalLB for load balancing without additional costs
metallb_enabled: true
metallb_speaker_enabled: true
metallb_namespace: "metallb-system"
metallb_protocol: "layer2"

# Kube-VIP for control plane HA without additional hardware
kube_vip_enabled: true
kube_vip_arp_enabled: true
kube_vip_controlplane_enabled: true

# Disable resource-intensive addons
ingress_nginx_enabled: false
cert_manager_enabled: false
dashboard_enabled: false
`;
```

## Performance Tuning

For optimal performance on limited hardware:

1. **Resource Limits**: Configure appropriate CPU and memory limits for workloads
2. **Node Affinity**: Distribute workloads efficiently across nodes
3. **Taints and Tolerations**: Reserve resources for critical system components

## Maintenance

To update your low-cost cluster:

1. Modify the template files in the `templates/` directory
2. Run `make generate` to update the configuration files
3. Apply the changes using Kubespray

Regular updates help maintain security while keeping resource usage efficient.

## Cost Comparison

| Setup        | This Solution on Contabo | Managed K8s (3 nodes) | DIY without optimizations |
|--------------|--------------------------|-----------------------|---------------------------|
| Monthly Cost | €15-20 (3x VPS S)        | €150-300              | €50-100                   |
| Setup Time   | 30 minutes               | 10 minutes            | 2-3 hours                 |
| Maintenance  | Minimal                  | Managed               | Moderate                  |
| Features     | Full K8s                 | Full K8s              | Full K8s                  |
| CPU          | 12 vCPU cores total      | 6-12 cores total      | 6-12 cores total          |
| RAM          | 24GB total               | 12-24GB total         | 12-24GB total             |

*Costs are based on Contabo VPS S pricing (€4.99/month) as of 2025. Managed Kubernetes costs are based on typical cloud provider pricing.

## Troubleshooting

### Common Issues

#### Network Connectivity Problems

If nodes cannot communicate with each other:
- Verify Contabo firewall settings allow traffic between nodes
- Check that the correct IP ranges are configured in MetalLB
- Ensure kube-vip is properly configured for your network

#### Resource Constraints

If pods are being evicted or failing to schedule:
- Consider reducing resource requests in your workloads
- Verify that system services aren't consuming too many resources
- Check if kubelet reserved resources are appropriately configured

#### Template Generation Issues

If `make generate` fails:
- Ensure Node.js and TypeScript are properly installed
- Check for syntax errors in your template files
- Verify that all required dependencies are installed

### Logs and Debugging

Key log locations:
- Kubelet: `/var/log/kubelet.log`
- Container runtime: `journalctl -u containerd`
- Control plane components: `/var/log/containers/`

## Contributing

Contributions to improve this low-cost Kubernetes setup are welcome! Here's how you can contribute:

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test your changes thoroughly
5. Commit your changes (`git commit -m 'Add some amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Guidelines

- Focus on maintaining or improving the cost-effectiveness of the setup
- Keep resource requirements minimal
- Document any changes thoroughly
- Test changes on actual Contabo VPS instances when possible
- Follow existing code style and conventions

### Areas for Contribution

- Additional cost-effective addons
- Performance optimizations for limited hardware
- Documentation improvements
- Template enhancements
- Automation scripts

## Community and Support

### Getting Help

- **GitHub Issues**: For bug reports and feature requests
- **Discussions**: For questions and community support

### Sharing Your Experience

We encourage users to share their experiences running this setup on Contabo VPS:
- Performance benchmarks
- Cost optimizations
- Workload examples
- Scaling strategies

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Kubespray](https://github.com/kubernetes-sigs/kubespray) for providing the foundation for Kubernetes deployment
- [MetalLB](https://metallb.universe.tf/) for enabling load balancing without expensive cloud services
- [Kube-VIP](https://kube-vip.io/) for control plane high availability
- [Contabo](https://contabo.com) for providing affordable VPS options that make this low-cost setup possible

## Roadmap

Future plans for this project include:

- Automated deployment scripts specifically for Contabo VPS
- Additional cost-optimized addons
- Performance benchmarks and tuning guides
- Multi-region cluster support
- Backup and disaster recovery solutions optimized for low-cost deployments
