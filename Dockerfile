ARG cluster=

FROM quay.io/kubespray/kubespray:v2.27.0

VOLUME /inventory

ENTRYPOINT [ "ansible-playbook", "--private-key=/inventory/private-key", "-i=/inventory/inventory.ini" ] 

CMD [ "cluster.yml" ]