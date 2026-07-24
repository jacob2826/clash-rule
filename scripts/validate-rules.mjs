import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import YAML from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const current = YAML.parse(await fs.readFile(path.join(ROOT, 'Mihomo.yml'), 'utf8'));
const v2 = YAML.parse(await fs.readFile(path.join(ROOT, 'mihomo_v2.yml'), 'utf8'));
const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'rules/sources.json'), 'utf8'));
const status = JSON.parse(await fs.readFile(path.join(ROOT, 'rules/status/latest.json'), 'utf8'));

for (const key of Object.keys(current)) {
  if (key === 'rule-providers' || key === 'rules') continue;
  assert.deepEqual(v2[key], current[key], `mihomo_v2.yml changed shared top-level key: ${key}`);
}
assert.deepEqual(
  v2['proxy-groups'].map((group) => group.name),
  current['proxy-groups'].map((group) => group.name),
  'User-visible proxy group names or order changed'
);

const ruleProviders = v2['rule-providers'];
assert.ok(ruleProviders && typeof ruleProviders === 'object', 'mihomo_v2.yml must contain rule-providers');
const referenced = new Set();
for (const rule of v2.rules || []) {
  const [type, providerId] = String(rule).split(',');
  if (type === 'RULE-SET') referenced.add(providerId);
}

for (const providerId of referenced) {
  assert.ok(ruleProviders[providerId], `RULE-SET references missing provider: ${providerId}`);
}

for (const [providerId, provider] of Object.entries(ruleProviders)) {
  assert.ok(referenced.has(providerId), `Unused rule-provider in mihomo_v2.yml: ${providerId}`);
  const url = new URL(provider.url);
  const expectedPrefix = '/jacob2826/clash-rule/';
  assert.ok(url.pathname.includes(expectedPrefix), `Unexpected generated provider repository: ${provider.url}`);
  const marker = '/rules/generated/';
  const markerIndex = url.pathname.indexOf(marker);
  assert.ok(markerIndex >= 0, `Provider does not reference generated rules: ${provider.url}`);
  const relativePath = `rules/generated/${url.pathname.slice(markerIndex + marker.length)}`;
  const absolutePath = path.join(ROOT, relativePath);
  const text = await fs.readFile(absolutePath, 'utf8');
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  assert.ok(lines.length > 0, `Generated provider is empty: ${relativePath}`);
  if (provider.behavior === 'domain') {
    assert.ok(lines.every((line) => !line.includes(',') && !/\s/.test(line)), `Invalid domain provider: ${providerId}`);
  } else if (provider.behavior === 'ipcidr') {
    assert.ok(lines.every((line) => line.includes('/') && !line.includes(',')), `Invalid ipcidr provider: ${providerId}`);
  } else if (provider.behavior === 'classical') {
    assert.ok(lines.every((line) => line.includes(',')), `Invalid classical provider: ${providerId}`);
  } else {
    assert.fail(`Unsupported behavior in mihomo_v2.yml: ${provider.behavior}`);
  }
  if (providerId.endsWith('-process')) {
    assert.equal(provider.behavior, 'classical', `Process provider must be classical: ${providerId}`);
  }
}

const manifestPolicies = new Map(manifest.providers.map((provider) => [provider.id, provider.policy]));
for (const provider of status.providers) {
  assert.equal(provider.policy, manifestPolicies.get(provider.id), `Status policy mismatch for ${provider.id}`);
  for (const [kind, relativePath] of Object.entries(provider.outputs)) {
    await fs.access(path.join(ROOT, relativePath));
    const expectedId = `${provider.id}-${kind}`;
    assert.ok(ruleProviders[expectedId], `mihomo_v2.yml is missing generated provider ${expectedId}`);
  }
}

console.log(`Validated ${Object.keys(ruleProviders).length} V2 rule providers across ${status.providers.length} policies.`);
