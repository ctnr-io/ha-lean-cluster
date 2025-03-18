get-input = $(shell read -p "$(1): " input; echo $$input)
get-secret = $(shell read -s -p "$(1): " secret; echo $$secret; echo 1>&0)

docker-run := docker run $(shell [ -t 0 ] && echo -it || echo -i) -e DOMAIN_NAME=${DOMAIN_NAME}

export DOMAIN_NAME ?= ${domain}

.PHONY: build
build:
	docker build -t kubespray -f Dockerfile .

.PHONY: apply 
apply: ## Apply the kubernetes cluster
apply: generate ${DOMAIN_NAME}-private.key build
	${docker-run} -v .:/inventory kubespray cluster.yml

.PHONY: reset
reset: ## Reset the kubernetes cluster
reset: generate ${DOMAIN_NAME}-private.key build
	${docker-run} -v .:/inventory kubespray reset.yml

.PHONY: ${DOMAIN_NAME}-private.key
${DOMAIN_NAME}-private.key: .FORCE
	@chmod 400 $@

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
generate: ## Generate the ansible inventory
generate: .cntb .cntb/private-networks.json .cntb/instances.json
	@deno -A ./generate.ts
.cntb:
	@mkdir -p .cntb
.cntb/private-networks.json:
	@cntb get privateNetworks --output json > .cntb/private-networks.json
.cntb/instances.json:
	@cntb get instances --output json > .cntb/instances.json

.PHONY: list-nodes
list-nodes: ## List all nodes in the cluster
list-nodes: generate
	@echo "Nodes:"
	@cat .cntb/instances.json | jq -r '.[] | .displayName' | grep '^${DOMAIN_NAME}-'

.PHONY: test
test: ## Test basic cluster functionalities
test: generate
	@echo "Test basic cluster functionalities..."
	@deno test -A
