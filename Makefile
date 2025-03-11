get-input = $(shell read -p "$(1): " input; echo $$input)
get-secret = $(shell read -s -p "$(1): " secret; echo $$secret; echo 1>&0)

.PHONY: build
build:
	docker build -t kubespray -f Dockerfile .

.PHONY: upgrade
upgrade: ## Upgrade the kubernetes cluster
upgrade: generate private.key build
	docker run -it -v .:/inventory kubespray upgrade-cluster.yml 

.PHONY: install 
install: ## Install the kubernetes cluster
install: generate private.key build
	docker run -it -v .:/inventory kubespray cluster.yml

.PHONY: reset
reset: ## Reset the kubernetes cluster
reset: generate private.key build
	docker run -it -v .:/inventory kubespray reset.yml

.PHONY: private.key
private.key: .FORCE
	@chmod 400 $@

.PHONY: .FORCE
.FORCE:

.PHONY: ssh
ssh: ## SSH into the control plane node
ssh: private.key
	ssh -i private.key root@62.171.183.141

.PHONY: add-node
add-node: ## Provision a new node to the cluster
add-node: name ?= $(call get-input,name)
add-node: type ?= $(call get-input,type)
add-node: private.key
# check type is valid
ifeq ($(type),control-plane)
	type=control-plane
else ifeq ($(type),worker)
	type=worker
else ifeq ($(type),etcd)
	type=etcd
else
	$(error invalid type: $(type))
endif
	# cntb instance create --name $(name) --image ubuntu-18.04 --flavor m1.small --key-name kube --network-name kube --security-group-name kube --count 1 --type $(type)

.PHONY: remove-node
remove-node: ## Remove a node from the cluster
remove-node: name= ## Node name (e.g., node-0, node-1)
remove-node: private.key

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
		--oauth2-clientid=$(oauth2-clientid) \
		--oauth2-client-secret=$(oauth2-client-secret) \
		--oauth2-user=$(oauth2-user) \
		--oauth2-password=$(oauth2-password)

.PHONY: nodes
list-nodes: ## List the nodes in the cluster
list-nodes: 
	cntb get instances

.PHONY: generate
generate: ## Generate the ansible inventory
generate: .cntb .cntb/private-networks.json .cntb/instances.json
	@deno -A ./templates/_generate.ts
.cntb:
	@mkdir -p .cntb
.cntb/private-networks.json: .FORCE
	@cntb get privateNetworks --output json > .cntb/private-networks.json
.cntb/instances.json: .FORCE
	@cntb get instances --output json > .cntb/instances.json

