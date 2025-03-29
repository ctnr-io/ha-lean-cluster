import { apiserverPublicIp, apiserverPort, domainName } from "./helpers.ts";
import * as util from "node:util";
import * as childProcess from "node:child_process";
import { encodeBase64 } from "jsr:@std/encoding/base64";

const exec = util.promisify(childProcess.exec);

const yaml = String.raw;
const sh = String.raw;

console.log(domainName);

// In kubeadm, the certificates are stored in different locations
const [ca, clientCert, clientKey] = await Promise.all(
  [
    exec(sh`ssh root@${apiserverPublicIp} -o "StrictHostKeyChecking no" -- "cat /etc/kubernetes/pki/ca.crt"`),
    exec(sh`ssh root@${apiserverPublicIp} -o "StrictHostKeyChecking no" -- "cat /etc/kubernetes/pki/apiserver-kubelet-client.crt"`),
    exec(sh`ssh root@${apiserverPublicIp} -o "StrictHostKeyChecking no" -- "cat /etc/kubernetes/pki/apiserver-kubelet-client.key"`),
  ]
)
  .then((res) => res.map(({ stdout }) => encodeBase64(stdout)))
  .catch((error) => {
    console.warn("Regenerate kubeconfig after kubernetes cluster is up and running");
    console.error("Error fetching certificates:", error);
    return ['', '', ''];
  });

export default yaml`
apiVersion: v1
kind: Config
clusters:
- cluster:
    certificate-authority-data: ${ca}
    server: https://${apiserverPublicIp}:${apiserverPort} 
  name: ${domainName}
contexts:
- context:
    cluster: ${domainName} 
    user: admin
  name: admin@${domainName} 
current-context: admin@${domainName} 
users:
- name: admin 
  user:
    client-certificate-data: ${clientCert}
    client-key-data: ${clientKey}
`;
