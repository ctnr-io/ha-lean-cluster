get-input = $(shell read -p "$(1): " input; echo $$input)
get-secret = $(shell read -s -p "$(1): " secret; echo $$secret; echo 1>&0)

export DOMAIN_NAME ?= ${domain}

SSH_OPTS := -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null

# Default Kubernetes version
K8S_VERSION ?= 1.31.4

# Default CNI
CNI ?= calico

# Default pod CIDR
POD_CIDR ?= 10.244.0.0/16

# Default service CIDR
SERVICE_CIDR ?= 10.96.0.0/12

# Default control plane endpoint
CONTROL_PLANE_ENDPOINT ?= $(shell cat .cntb/instances.json | jq -r '.[] | select(.displayName | startswith("$(DOMAIN_NAME)_control-plane-0")) | .ipv4')

.PHONY: create-cluster
create-cluster: ## Create a new Kubernetes cluster based on available Contabo nodes
create-cluster: generate
	@echo "Creating Kubernetes cluster with kubeadm..."
	@echo "Initializing control plane on $(CONTROL_PLANE_ENDPOINT)..."
	@ssh $(SSH_OPTS) root@$(CONTROL_PLANE_ENDPOINT) "kubeadm init --kubernetes-version=$(K8S_VERSION) \
		--pod-network-cidr=$(POD_CIDR) \
		--service-cidr=$(SERVICE_CIDR) \
		--control-plane-endpoint=$(CONTROL_PLANE_ENDPOINT):6443 \
		--upload-certs"
	@echo "Installing CNI ($(CNI))..."
	@if [ "$(CNI)" = "calico" ]; then \
		ssh $(SSH_OPTS) root@$(CONTROL_PLANE_ENDPOINT) "kubectl --kubeconfig=/etc/kubernetes/admin.conf apply -f https://docs.projectcalico.org/manifests/calico.yaml"; \
	elif [ "$(CNI)" = "flannel" ]; then \
		ssh $(SSH_OPTS) root@$(CONTROL_PLANE_ENDPOINT) "kubectl --kubeconfig=/etc/kubernetes/admin.conf apply -f https://raw.githubusercontent.com/flannel-io/flannel/master/Documentation/kube-flannel.yml"; \
	fi
	@echo "Fetching kubeconfig..."
	@ssh $(SSH_OPTS) root@$(CONTROL_PLANE_ENDPOINT) "cat /etc/kubernetes/admin.conf" > kubeconfig.yml
	@echo "Cluster created successfully! Kubeconfig saved to kubeconfig.yml"

.PHONY: add-control-plane
add-control-plane: ## Add a control plane node to the cluster
add-control-plane: node ?= $(call get-input,Node name (e.g. $(DOMAIN_NAME)_control-plane-1))
add-control-plane: generate
	@echo "Adding control plane node $(node)..."
	@NODE_IP=$(shell cat .cntb/instances.json | jq -r '.[] | select(.displayName == "$(node)") | .ipv4') && \
	JOIN_CMD=$$(ssh $(SSH_OPTS) root@$(CONTROL_PLANE_ENDPOINT) "kubeadm token create --print-join-command") && \
	CERTIFICATE_KEY=$$(ssh $(SSH_OPTS) root@$(CONTROL_PLANE_ENDPOINT) "kubeadm init phase upload-certs --upload-certs | tail -1") && \
	ssh $(SSH_OPTS) root@$$NODE_IP "$$JOIN_CMD --control-plane --certificate-key $$CERTIFICATE_KEY"
	@echo "Control plane node $(node) added successfully!"

.PHONY: add-worker
add-worker: ## Add a worker node to the cluster
add-worker: node ?= $(call get-input,Node name (e.g. $(DOMAIN_NAME)_worker-0))
add-worker: generate
	@echo "Adding worker node $(node)..."
	@NODE_IP=$(shell cat .cntb/instances.json | jq -r '.[] | select(.displayName == "$(node)") | .ipv4') && \
	JOIN_CMD=$$(ssh $(SSH_OPTS) root@$(CONTROL_PLANE_ENDPOINT) "kubeadm token create --print-join-command") && \
	ssh $(SSH_OPTS) root@$$NODE_IP "$$JOIN_CMD"
	@echo "Worker node $(node) added successfully!"

.PHONY: add-etcd
add-etcd: ## Add an etcd node to the cluster (requires manual configuration)
add-etcd: node ?= $(call get-input,Node name (e.g. $(DOMAIN_NAME)_etcd-0))
add-etcd: generate
	@echo "Adding etcd node $(node)..."
	@echo "Note: Adding external etcd nodes requires manual configuration."
	@echo "Please follow the kubeadm documentation for setting up an external etcd cluster."
	@NODE_IP=$(shell cat .cntb/instances.json | jq -r '.[] | select(.displayName == "$(node)") | .ipv4')
	@echo "Node IP: $$NODE_IP"

.PHONY: remove-node
remove-node: ## Remove a node from the cluster
remove-node: node ?= $(call get-input,Node name to remove)
remove-node: generate
	@echo "Removing node $(node)..."
	@NODE_IP=$(shell cat .cntb/instances.json | jq -r '.[] | select(.displayName == "$(node)") | .ipv4') && \
	ssh $(SSH_OPTS) root@$(CONTROL_PLANE_ENDPOINT) "kubectl --kubeconfig=/etc/kubernetes/admin.conf drain $(node) --ignore-daemonsets --delete-emptydir-data" && \
	ssh $(SSH_OPTS) root@$(CONTROL_PLANE_ENDPOINT) "kubectl --kubeconfig=/etc/kubernetes/admin.conf delete node $(node)" && \
	ssh $(SSH_OPTS) root@$$NODE_IP "kubeadm reset -f"
	@echo "Node $(node) removed successfully!"

.PHONY: upgrade-cluster
upgrade-cluster: ## Upgrade the Kubernetes cluster
upgrade-cluster: version ?= $(call get-input,Kubernetes version to upgrade to)
upgrade-cluster: generate
	@echo "Upgrading control plane nodes to version $(version)..."
	@for node in $$(cat .cntb/instances.json | jq -r '.[] | select(.displayName | contains("control-plane")) | .ipv4'); do \
		echo "Upgrading control plane node $$node..."; \
		ssh $(SSH_OPTS) root@$$node "apt-get update && apt-get install -y kubeadm=$(version)-00 && kubeadm upgrade apply $(version) -y && apt-get install -y kubelet=$(version)-00 kubectl=$(version)-00 && systemctl restart kubelet"; \
	done
	@echo "Upgrading worker nodes to version $(version)..."
	@for node in $$(cat .cntb/instances.json | jq -r '.[] | select(.displayName | contains("worker")) | .ipv4'); do \
		echo "Upgrading worker node $$node..."; \
		ssh $(SSH_OPTS) root@$$node "apt-get update && apt-get install -y kubeadm=$(version)-00 && kubeadm upgrade node && apt-get install -y kubelet=$(version)-00 kubectl=$(version)-00 && systemctl restart kubelet"; \
	done
	@echo "Cluster upgraded to version $(version) successfully!"

.PHONY: reset-cluster
reset-cluster: ## Reset the entire Kubernetes cluster
reset-cluster: generate
	@echo "Resetting the entire Kubernetes cluster..."
	@echo "This will remove all nodes from the cluster and reset kubeadm on each node."
	@read -p "Are you sure you want to continue? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	@for node in $$(cat .cntb/instances.json | jq -r '.[] | select(.displayName | startswith("$(DOMAIN_NAME)_")) | .ipv4'); do \
		echo "Resetting node $$node..."; \
		ssh $(SSH_OPTS) root@$$node "kubeadm reset -f"; \
	done
	@echo "Cluster reset successfully!"

.PHONY: .FORCE
.FORCE:

.PHONY: login 
login: ## Configure the provider credentials 
login: oauth2-clientid ?= $(call get-input,oauth2-clientid)
login: oauth2-client-secret ?= $(call get-secret,oauth2-client-secret)
login: oauth2-user ?= $(call get-input,oauth2-user)
login: oauth2-password ?= $(call get-secret,oauth2-password)
login: ${HOME}/.cntb.yaml
	@echo "Logged in"
${HOME}/.cntb.yaml:
	@cntb config set-credentials \
		--oauth2-clientid='${oauth2-clientid}' \
		--oauth2-client-secret='${oauth2-client-secret}' \
		--oauth2-user='${oauth2-user}' \
		--oauth2-password='${oauth2-password}'

.PHONY: generate
generate: ## Generate the node information
generate: .cntb .cntb/private-networks.json .cntb/instances.json
	@deno -A ./generate.ts
.cntb: .FORCE
	@mkdir -p .cntb
.cntb/private-networks.json: .FORCE
	@cntb get privateNetworks --output json > .cntb/private-networks.json
.cntb/instances.json: .FORCE
	@cntb get instances --output json > .cntb/instances.json

.PHONY: list-nodes
list-nodes: ## List all nodes in the cluster
list-nodes: generate
	@echo "Nodes:"
	@cat .cntb/instances.json | jq -r '.[] | .displayName' | grep '^${DOMAIN_NAME}_'

.PHONY: get-join-command
get-join-command: ## Get the kubeadm join command for adding new nodes
get-join-command: generate
	@ssh $(SSH_OPTS) root@$(CONTROL_PLANE_ENDPOINT) "kubeadm token create --print-join-command"

.PHONY: install-metallb
install-metallb: ## Install MetalLB for load balancing
install-metallb: generate
	@echo "Installing MetalLB..."
	@ssh $(SSH_OPTS) root@$(CONTROL_PLANE_ENDPOINT) "kubectl --kubeconfig=/etc/kubernetes/admin.conf apply -f https://raw.githubusercontent.com/metallb/metallb/v0.13.7/config/manifests/metallb-native.yaml"
	@echo "Waiting for MetalLB to be ready..."
	@ssh $(SSH_OPTS) root@$(CONTROL_PLANE_ENDPOINT) "kubectl --kubeconfig=/etc/kubernetes/admin.conf wait --namespace metallb-system --for=condition=ready pod --selector=app=metallb --timeout=90s"
	@echo "MetalLB installed successfully!"

.PHONY: install-kube-vip
install-kube-vip: ## Install Kube-VIP for control plane high availability
install-kube-vip: generate
	@echo "Installing Kube-VIP..."
	@ssh $(SSH_OPTS) root@$(CONTROL_PLANE_ENDPOINT) "kubectl --kubeconfig=/etc/kubernetes/admin.conf apply -f https://kube-vip.io/manifests/kube-vip-rbac.yaml"
	@echo "Kube-VIP installed successfully!"

.PHONY: test
test: ## Test basic cluster functionalities
test: generate
	@echo "Test basic cluster functionalities..."
	@deno test -A
