# High Availability & Lean Kubernetes Cluster

A High Availability, frugal Kubernetes cluster using [Kubespray](https://github.com/kubernetes-sigs/kubespray) optimized for Contabo VPS. Deploy enterprise-grade Kubernetes at 1/10th the cost of managed solutions.

## Key Features

- **Cost-Optimized**: €15-20/month for a 3-node cluster (vs €150-300 for managed K8s)
- **Full Kubernetes**: Latest version with containerd runtime
- **Enterprise Addons**: MetalLB, Kube-VIP, Gateway API CRDs
- **Flexible Architecture**: Single or multi-node, control-plane + worker combinations
- **Template-Based**: TypeScript templates for consistent, reproducible deployments

## Quick Start

```bash
git clone https://github.com/ctnr.io/ha-lean-cluster.git
cd ha-lean-cluster
# Edit templates/inventory.ini.ts with your node IPs
make generate
make deploy
```

## Hardware Requirements

- **Minimal**: 1 Contabo VPS S (4 vCPU, 8GB RAM) - €4.99/month
- **Recommended**: 3 Contabo VPS S instances - €14.97/month

## Core Configuration Files

- `templates/inventory.ini.ts`: Node definitions and roles
- `templates/group_vars/k8s_cluster/k8s-cluster.yml.ts`: Kubernetes settings
- `templates/group_vars/k8s_cluster/addons.yml.ts`: Addon configurations

## Next Steps

1. **Validate Deployment**: Run `kubectl get nodes` to verify cluster health ✅
2. **Implement Volume Provisioning**: Configure storage using Contabo Object Storage and NFS (no block storage available)
3. **Configure Node Auto Scaling**: Set up cluster autoscaler for dynamic scaling
4. **Deploy Core Workloads**: Start with stateless applications to test cluster functionality
5. **Implement Monitoring**: Add lightweight monitoring (Prometheus + Grafana)
6. **Setup CI/CD Pipeline**: Integrate with GitHub Actions or similar
7. **Document Performance**: Measure and document resource usage for optimization

## Roadmap

- Automated Contabo VPS provisioning
- One-click deployment script
- Lightweight backup solution
- Multi-region support
- Performance benchmarks
- Advanced volume management with Object Storage and NFS integration
- Improved auto-scaling capabilities

## License

MIT License - see [LICENSE](LICENSE) file
