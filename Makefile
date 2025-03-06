.PHONY: build
build:
	docker build -t kubespray -f Dockerfile .

.PHONY: upgrade
upgrade: build
	docker run -it -v .:/inventory kubespray upgrade-cluster.yml 

.PHONY: create
setup: build
	docker run -it -v .:/inventory kubespray cluster.yml

.PHONY: %/private-key
%/private-key: .FORCE
	chmod 400 $@

.PHONY: .FORCE
.FORCE:
