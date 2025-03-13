import { apiserverIp, apiserverPort, domainName } from "./_helpers.ts";
import * as util from "node:util";
import * as childProcess from "node:child_process";
import { encodeBase64 } from "jsr:@std/encoding/base64";

const exec = util.promisify(childProcess.exec);

const yaml = String.raw;
const sh = String.raw;

const [ca, clientCert, clientKey] = await Promise.all(
  [
    exec(sh`ssh root@${apiserverIp} -i ${domainName}-private.key -- "cat /etc/kubernetes/ssl/ca.crt"`),
    exec(sh`ssh root@${apiserverIp} -i ${domainName}-private.key -- "cat /etc/kubernetes/ssl/apiserver-kubelet-client.crt"`),
    exec(sh`ssh root@${apiserverIp} -i ${domainName}-private.key -- "cat /etc/kubernetes/ssl/apiserver-kubelet-client.key"`),
  ]
)
  .then((res) => res.map(({ stdout }) => encodeBase64(stdout)))
  .catch(() => {
    console.warn("Regenerate kubeconfig after kubernetes cluster is up and running");
    return ['', '', ''];
  });

export default yaml`
apiVersion: v1
kind: Config
clusters:
- cluster:
    certificate-authority-data: ${ca}
    server: https://${apiserverIp}:${apiserverPort} 
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
