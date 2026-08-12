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
const shadowrocketTemplate = await fs.readFile(path.join(ROOT, 'Shadowrocket.template.conf'), 'utf8');
const SHADOWROCKET_PLACEHOLDER = '__SUBSCRIPTION_NAME__';
const SHADOWROCKET_RULE_TYPES = new Set([
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'IP-CIDR',
  'IP-CIDR6',
  'IP-ASN'
]);
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
const PROVIDER_ALIASES = new Map([
  ['telegram-ip', 'telegram'],
  ['netflix-ip', 'netflix']
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
const statusProviders = new Map(status.providers.map((provider) => [provider.id, provider]));
const expectedProviderIds = [];
const expectedShadowrocketUrls = [];
for (const provider of status.providers) {
  assert.equal(provider.policy, manifestPolicies.get(provider.id), `Status policy mismatch for ${provider.id}`);
  for (const [kind, relativePath] of Object.entries(provider.outputs)) {
    assert.ok(kind === 'domain' || kind === 'ipcidr', `Unexpected external output kind for ${provider.id}: ${kind}`);
    await fs.access(path.join(ROOT, relativePath));
    const expectedId = `${provider.id}-${kind}`;
    expectedProviderIds.push(expectedId);
    assert.ok(ruleProviders[expectedId], `mihomo_v2.yml is missing generated provider ${expectedId}`);
  }
  for (const kind of ['residual', 'process']) {
    assert.equal(ruleProviders[`${provider.id}-${kind}`], undefined, `Inline ${kind} rules must not have an active provider for ${provider.id}`);
    for (const rule of provider.inlineRules?.[kind] || []) {
      const type = String(rule).split(',')[0];
      const allowedTypes = kind === 'process' ? PROCESS_RULE_TYPES : RESIDUAL_RULE_TYPES;
      assert.ok(allowedTypes.has(type), `Unexpected ${kind} inline rule for ${provider.id}: ${rule}`);
    }
  }
  assert.ok(provider.shadowrocketOutput, `Missing Shadowrocket output for ${provider.id}`);
  const shadowrocketRules = await validateShadowrocketRuleList(provider.shadowrocketOutput);
  assert.equal(shadowrocketRules.length, provider.shadowrocketRuleCount, `Shadowrocket count mismatch for ${provider.id}`);
  assert.equal(
    shadowrocketRules.length,
    provider.outputCounts.domain + provider.outputCounts.ipcidr + provider.outputCounts.residual,
    `Shadowrocket conversion changed supported scope for ${provider.id}`
  );
  assert.equal(provider.shadowrocketSkippedProcessCount, provider.outputCounts.process, `Shadowrocket process count mismatch for ${provider.id}`);
  expectedShadowrocketUrls.push(`https://raw.githubusercontent.com/jacob2826/clash-rule/main/${provider.shadowrocketOutput}`);
}

assert.deepEqual(Object.keys(ruleProviders), expectedProviderIds, 'V2 external provider order or scope changed');
const expectedInlineRules = [];
const expandedProviders = new Set();
for (const rule of current.rules || []) {
  const parts = String(rule).split(',');
  const type = parts[0];
  if (type === 'RULE-SET') {
    const providerId = PROVIDER_ALIASES.get(parts[1]) || parts[1];
    if (expandedProviders.has(providerId)) continue;
    expandedProviders.add(providerId);
    const provider = statusProviders.get(providerId);
    assert.ok(provider, `Current template references unknown generated provider: ${parts[1]}`);
    for (const kind of ['residual', 'process']) {
      for (const inlineRule of provider.inlineRules?.[kind] || []) {
        expectedInlineRules.push(`${inlineRule},${provider.policy}`);
      }
    }
    continue;
  }
  if (PROCESS_RULE_TYPES.has(type) || RESIDUAL_RULE_TYPES.has(type)) {
    expectedInlineRules.push(String(rule));
  }
}
const actualInlineRules = (v2.rules || []).filter((rule) => {
  const type = String(rule).split(',')[0];
  return PROCESS_RULE_TYPES.has(type) || RESIDUAL_RULE_TYPES.has(type);
});
assert.deepEqual(actualInlineRules, expectedInlineRules, 'V2 inline rule order or scope changed');

assert.equal(status.shadowrocket?.template, 'Shadowrocket.template.conf', 'Unexpected Shadowrocket template path');
assert.equal(status.shadowrocket?.subscriptionPlaceholder, SHADOWROCKET_PLACEHOLDER, 'Unexpected Shadowrocket subscription placeholder');
const geositeNames = new Set();
for (const source of status.shadowrocket?.geosites || []) {
  assert.ok(!geositeNames.has(source.name), `Duplicate Shadowrocket geosite: ${source.name}`);
  geositeNames.add(source.name);
  const rules = await validateShadowrocketRuleList(source.output);
  assert.equal(rules.length, source.ruleCount, `Shadowrocket GEOSITE count mismatch for ${source.name}`);
  expectedShadowrocketUrls.push(`https://raw.githubusercontent.com/jacob2826/clash-rule/main/${source.output}`);
}
const currentGeosites = (current.rules || [])
  .map((rule) => String(rule).split(','))
  .filter(([type]) => type === 'GEOSITE')
  .map(([, name, policy]) => ({ name, policy }));
assert.deepEqual(
  [...(status.shadowrocket?.geosites || [])].map(({ name, policy }) => ({ name, policy })),
  currentGeosites,
  'Shadowrocket GEOSITE source scope or order changed'
);

assert.match(shadowrocketTemplate, /^\[General\]$/m, 'Shadowrocket template is missing [General]');
assert.match(shadowrocketTemplate, /^\[Proxy Group\]$/m, 'Shadowrocket template is missing [Proxy Group]');
assert.match(shadowrocketTemplate, /^\[Rule\]$/m, 'Shadowrocket template is missing [Rule]');
assert.doesNotMatch(shadowrocketTemplate, /^\[Proxy\]$/m, 'Public Shadowrocket template must not contain nodes');
assert.ok((shadowrocketTemplate.match(new RegExp(SHADOWROCKET_PLACEHOLDER, 'g')) || []).length > 0, 'Shadowrocket template does not reference the subscription placeholder');
assert.doesNotMatch(shadowrocketTemplate, /(?:token|password|authorization|subscription-userinfo)\s*[=:]/i, 'Shadowrocket template contains a credential-like value');
for (const urlText of shadowrocketTemplate.match(/https:\/\/[^,\s]+/g) || []) {
  const url = new URL(urlText);
  assert.ok(['raw.githubusercontent.com', 'www.gstatic.com'].includes(url.hostname), `Unexpected Shadowrocket URL host: ${url.hostname}`);
  assert.equal(url.username, '', `Shadowrocket URL contains a username: ${urlText}`);
  assert.equal(url.password, '', `Shadowrocket URL contains a password: ${urlText}`);
  assert.equal(url.search, '', `Shadowrocket URL contains a query: ${urlText}`);
  assert.equal(url.hash, '', `Shadowrocket URL contains a fragment: ${urlText}`);
}
for (const url of expectedShadowrocketUrls) {
  assert.ok(shadowrocketTemplate.includes(`RULE-SET,${url},`), `Shadowrocket template is missing ${url}`);
}

const shadowrocketGroupNames = [...shadowrocketTemplate.matchAll(/^([^#\[\r\n][^=\r\n]+?)\s*=\s*(?:select|url-test),/gm)].map((match) => match[1].trim());
assert.deepEqual(
  shadowrocketGroupNames,
  current['proxy-groups'].map((group) => group.name),
  'Shadowrocket user-visible proxy group names or order changed'
);

console.log(`Validated ${expectedProviderIds.length} external V2 providers, ${expectedInlineRules.length} inline rules and ${expectedShadowrocketUrls.length} Shadowrocket rule lists across ${status.providers.length} policies.`);

async function validateShadowrocketRuleList(relativePath) {
  assert.match(relativePath, /^rules\/generated\/shadowrocket\/.+\.list$/, `Unexpected Shadowrocket output path: ${relativePath}`);
  const text = await fs.readFile(path.join(ROOT, relativePath), 'utf8');
  assert.doesNotMatch(text, /(?:token|password|authorization|subscription-userinfo)\s*[=:]/i, `Credential-like value in ${relativePath}`);
  const rules = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  assert.ok(rules.length > 0, `Empty Shadowrocket rule list: ${relativePath}`);
  for (const rule of rules) {
    const [type, value] = rule.split(',');
    assert.ok(SHADOWROCKET_RULE_TYPES.has(type), `Unsupported Shadowrocket rule type in ${relativePath}: ${type}`);
    assert.ok(value, `Missing Shadowrocket rule value in ${relativePath}: ${rule}`);
    assert.ok(!PROCESS_RULE_TYPES.has(type), `Process rule leaked into Shadowrocket output: ${rule}`);
  }
  return rules;
}
