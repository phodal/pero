// Trusted node-admin prerequisite; never consumed from an Agent/Run request.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const configMapName = 'pero-isolated-ipv4-only';
export const allowlist = '^net\\.ipv6\\.conf\\.all\\.disable_ipv6$\n^net\\.ipv6\\.conf\\.default\\.disable_ipv6$\n';
export function conflist() {
 return { cniVersion: '1.0.0', name: 'cilium', plugins: [
  { type: 'cilium-cni', 'enable-debug': false, 'log-file': '/var/run/cilium/cilium-cni.log' },
  { type: 'tuning', sysctl: { 'net.ipv6.conf.all.disable_ipv6': '1', 'net.ipv6.conf.default.disable_ipv6': '1' } },
 ] };
}
export function configMap() {
 return { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: configMapName, namespace: 'kube-system' },
  immutable: true, data: { 'cni-config': JSON.stringify(conflist(), null, 2) + '\n' } };
}
export function verifyInstalled(config, rules, files) {
 // Exact comparison excludes args, runtimeConfig, capabilities, extra plugins,
 // interface changes and broader sysctls, not just the two expected key names.
 assert.deepEqual(config, conflist(), 'unexpected installed CNI configuration');
 assert.equal(rules, allowlist, 'missing or changed tuning allowlist');
 assert.deepEqual(files.trim().split('\n'), ['05-cilium.conflist'], 'competing active CNI configuration');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const [mode, config, rules, files] = process.argv.slice(2);
 if (mode === 'manifest') process.stdout.write(JSON.stringify(configMap()) + '\n');
 else if (mode === 'allowlist') process.stdout.write(allowlist);
 else if (mode === 'verify') verifyInstalled(JSON.parse(readFileSync(config, 'utf8')), readFileSync(rules, 'utf8'), readFileSync(files, 'utf8'));
 else throw Error('expected manifest, allowlist, or verify');
}
