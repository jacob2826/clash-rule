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
const PROCESS_RULE_TYPES = new Set([
  'PROCESS-NAME',
  'PROCESS-NAME-WILDCARD',
  'PROCESS-PATH',
  'PROCESS-PATH-REGEX'
]);
const RESIDUAL_RULE_TYPES = new Set([
  'DOMAIN-KEYWORD',
  'DOMAIN-REGEX',
  'DOMAIN-WILDCARD',
  'IP-ASN'
]);

for (const key of Object.keys(current)) {
  if (key === 'rule-providers' || key === 'rules') continue;
  assert.deepEqual(v2[key], current[key], `mihomo_v2.yml changed shared top-level key: ${key}`);
}
assert.equal(current['unified-delay'], true, 'Mihomo.yml must enable unified delay');
assert.deepEqual(
  current.sniffer?.['skip-domain'],
  ['Mijia Cloud', 'dlg.io.mi.com'],
  'Mihomo.yml must preserve sniffer exclusions'
);
for (const domain of ['+.lan', 'stun.*.*', 'swscan.apple.com', '+.push.apple.com', '+.msftconnecttest.com']) {
  assert.ok(current.dns?.['fake-ip-filter']?.includes(domain), `Mihomo.yml fake-ip-filter is missing ${domain}`);
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
  } else {
    assert.fail(`Unsupported behavior in mihomo_v2.yml: ${provider.behavior}`);
  }
}

const manifestPolicies = new Map(manifest.providers.map((provider) => [provider.id, provider.policy]));
const expectedProviderIds = [];
const expectedInlineRules = [];
for (const provider of status.providers) {
  assert.equal(provider.policy, manifestPolicies.get(provider.id), `Status policy mismatch for ${provider.id}`);
  for (const [kind, relativePath] of Object.entries(provider.outputs)) {
    assert.ok(kind === 'domain' || kind === 'ipcidr', `Unexpected external output kind for ${provider.id}: ${kind}`);
    await fs.access(path.join(ROOT, relativePath));
    const expectedId = `${provider.id}-${kind}`;
    expectedProviderIds.push(expectedId);
    assert.ok(ruleProviders[expectedId], `mihomo_v2.yml is missing generated provider ${expectedId}`);
  }
  for (const [kind, relativePath] of Object.entries(provider.compatibilityOutputs || {})) {
    assert.ok(kind === 'residual' || kind === 'process', `Unexpected compatibility output kind for ${provider.id}: ${kind}`);
    const text = await fs.readFile(path.join(ROOT, relativePath), 'utf8');
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
    assert.deepEqual(lines, provider.inlineRules?.[kind] || [], `Compatibility output differs from inline ${kind} rules for ${provider.id}`);
    assert.equal(ruleProviders[`${provider.id}-${kind}`], undefined, `Inline ${kind} rules must not have an active provider for ${provider.id}`);
  }
  for (const kind of ['residual', 'process']) {
    for (const rule of provider.inlineRules?.[kind] || []) {
      const type = String(rule).split(',')[0];
      const allowedTypes = kind === 'process' ? PROCESS_RULE_TYPES : RESIDUAL_RULE_TYPES;
      assert.ok(allowedTypes.has(type), `Unexpected ${kind} inline rule for ${provider.id}: ${rule}`);
      expectedInlineRules.push(`${rule},${provider.policy}`);
    }
  }
}

assert.deepEqual(Object.keys(ruleProviders), expectedProviderIds, 'V2 external provider order or scope changed');
const actualInlineRules = (v2.rules || []).filter((rule) => {
  const type = String(rule).split(',')[0];
  return PROCESS_RULE_TYPES.has(type) || RESIDUAL_RULE_TYPES.has(type);
});
assert.deepEqual(actualInlineRules, expectedInlineRules, 'V2 inline rule order or scope changed');

console.log(`Validated ${expectedProviderIds.length} external V2 rule providers and ${expectedInlineRules.length} inline rules across ${status.providers.length} policies.`);
