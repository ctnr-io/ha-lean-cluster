FROM quay.io/kubespray/kubespray:v2.27.0

ENV DOMAIN_NAME=

VOLUME /inventory

ENTRYPOINT [ "ansible-playbook", "--private-key=/inventory/${DOMAIN_NAME}-private.key", "-i=/inventory/inventory.ini", "--forks=10" ] 

CMD [ "cluster.yml" ]