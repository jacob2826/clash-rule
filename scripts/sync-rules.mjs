import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(ROOT, 'rules/sources.json');
const STATE_PATH = path.join(ROOT, 'rules/state/upstreams.json');
const GENERATED_DIR = path.join(ROOT, 'rules/generated');
const STATUS_JSON_PATH = path.join(ROOT, 'rules/status/latest.json');
const STATUS_MD_PATH = path.join(ROOT, 'rules/status/latest.md');
const MIHOMO_PATH = path.join(ROOT, 'Mihomo.yml');
const MIHOMO_V2_PATH = path.join(ROOT, 'mihomo_v2.yml');
const SHADOWROCKET_TEMPLATE_PATH = path.join(ROOT, 'Shadowrocket.template.conf');
const SHADOWROCKET_GENERATED_DIR = path.join(GENERATED_DIR, 'shadowrocket');
const SHADOWROCKET_SUBSCRIPTION_PLACEHOLDER = '__SUBSCRIPTION_NAME__';
const PUBLIC_RAW_BASE = 'https://raw.githubusercontent.com/jacob2826/clash-rule/main';
const LOG_DIR = process.env.RULE_SYNC_LOG_DIR || path.join(os.tmpdir(), 'clash-rule-sync');
const FORCE = process.argv.includes('--force');
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const GITHUB_API_VERSION = '2022-11-28';
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

const startedAt = new Date().toISOString();
const runLog = {
  version: 1,
  status: 'running',
  result: null,
  startedAt,
  finishedAt: null,
  force: FORCE,
  sources: [],
  providers: [],
  shadowrocket: null,
  error: null
};

let exitCode = 0;

try {
  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
  validateManifest(manifest);
  const previousState = await readJsonIfPresent(STATE_PATH, { version: 1, sources: {} });
  const allSources = uniqueSources(manifest);
  const detection = await detectChanges(allSources, previousState);
  runLog.sources = detection.logEntries;

  if (!FORCE && detection.changedSourceIds.length === 0 && !detection.stateChanged) {
    runLog.status = 'success';
    runLog.result = 'no_changes';
    writeGithubOutput('changed', 'false');
  } else if (!FORCE && detection.changedSourceIds.length === 0) {
    await writeJson(STATE_PATH, detection.nextState);
    runLog.status = 'success';
    runLog.result = 'metadata_updated';
    writeGithubOutput('changed', 'true');
  } else {
    const sourceTexts = await loadAllSources(allSources, detection.contentCache);
    const build = await rebuildProviders(manifest, sourceTexts);
    const shadowrocket = await rebuildShadowrocketGeosites(manifest, sourceTexts);
    if (shadowrocket.filesChanged) build.filesChanged = true;
    runLog.providers = build.providers;
    runLog.shadowrocket = shadowrocket.summary;

    const status = {
      version: 1,
      status: 'success',
      generatedAt: new Date().toISOString(),
      sourceManifestVersion: manifest.version,
      totals: build.totals,
      providers: build.providers,
      shadowrocket: shadowrocket.summary
    };
    await writeJson(STATE_PATH, detection.nextState);
    await writeJson(STATUS_JSON_PATH, status);
    await fs.writeFile(STATUS_MD_PATH, renderStatusMarkdown(status), 'utf8');
    if (await renderV2Template(status)) build.filesChanged = true;
    if (await renderShadowrocketTemplate(status)) build.filesChanged = true;

    runLog.status = 'success';
    runLog.result = build.filesChanged ? 'rules_updated' : 'rules_verified';
    writeGithubOutput('changed', 'true');
  }
} catch (error) {
  exitCode = 1;
  runLog.status = 'failure';
  runLog.result = 'failed';
  runLog.error = {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    stack: error?.stack || null
  };
  writeGithubOutput('changed', 'false');
} finally {
  runLog.finishedAt = new Date().toISOString();
  await fs.mkdir(LOG_DIR, { recursive: true });
  await fs.writeFile(path.join(LOG_DIR, 'rule-sync-log.json'), JSON.stringify(runLog, null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(LOG_DIR, 'rule-sync-log.txt'), renderRunLog(runLog), 'utf8');
}

if (exitCode) process.exit(exitCode);

function validateManifest(manifest) {
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.providers) || manifest.providers.length === 0) {
    throw new Error('rules/sources.json must contain a non-empty version 1 providers array');
  }
  const providerIds = new Set();
  const sourceIds = new Set();
  for (const provider of manifest.providers) {
    if (!/^[a-z0-9-]+$/.test(provider.id || '')) throw new Error(`Invalid provider id: ${provider.id}`);
    if (providerIds.has(provider.id)) throw new Error(`Duplicate provider id: ${provider.id}`);
    providerIds.add(provider.id);
    if (!provider.policy || !Array.isArray(provider.sources) || provider.sources.length === 0) {
      throw new Error(`Provider ${provider.id} must define policy and sources`);
    }
    for (const source of [...provider.sources, ...(provider.candidates || [])]) {
      if (!source.id || sourceIds.has(source.id)) throw new Error(`Duplicate or empty source id: ${source.id}`);
      sourceIds.add(source.id);
      if (!['classical', 'domain', 'ipcidr'].includes(source.behavior)) {
        throw new Error(`Unsupported behavior for ${source.id}: ${source.behavior}`);
      }
      if (source.type === 'github') {
        if (!/^[^/]+\/[^/]+$/.test(source.repo || '') || !source.ref || !source.path) {
          throw new Error(`GitHub source ${source.id} must define repo, ref and path`);
        }
      } else if (source.type === 'local') {
        if (!source.path || path.isAbsolute(source.path) || source.path.includes('..')) {
          throw new Error(`Invalid local source path for ${source.id}`);
        }
      } else {
        throw new Error(`Unsupported source type for ${source.id}: ${source.type}`);
      }
      if (source.mode && !['union', 'audit'].includes(source.mode)) {
        throw new Error(`Unsupported candidate mode for ${source.id}: ${source.mode}`);
      }
    }
  }
  const geosites = manifest.shadowrocket?.geosites;
  if (!Array.isArray(geosites) || geosites.length === 0) {
    throw new Error('rules/sources.json must contain shadowrocket.geosites');
  }
  const geositeNames = new Set();
  for (const source of geosites) {
    if (!source.id || sourceIds.has(source.id)) throw new Error(`Duplicate or empty source id: ${source.id}`);
    sourceIds.add(source.id);
    if (!source.name || geositeNames.has(source.name)) throw new Error(`Duplicate or empty Shadowrocket geosite: ${source.name}`);
    geositeNames.add(source.name);
    if (!source.policy || source.type !== 'github' || source.behavior !== 'domain') {
      throw new Error(`Shadowrocket geosite ${source.id} must be a GitHub domain source with a policy`);
    }
    if (!/^[^/]+\/[^/]+$/.test(source.repo || '') || !source.ref || !source.path) {
      throw new Error(`GitHub source ${source.id} must define repo, ref and path`);
    }
  }
}

function uniqueSources(manifest) {
  const result = [];
  const seen = new Set();
  for (const provider of manifest.providers) {
    for (const source of [...provider.sources, ...(provider.candidates || [])]) {
      if (!seen.has(source.id)) {
        seen.add(source.id);
        result.push(source);
      }
    }
  }
  for (const source of manifest.shadowrocket.geosites) {
    if (!seen.has(source.id)) {
      seen.add(source.id);
      result.push(source);
    }
  }
  return result;
}

async function detectChanges(sources, previousState) {
  const previousSources = previousState.sources || {};
  const activeSourceIds = new Set(sources.map((source) => source.id));
  const nextState = { version: 1, sources: {} };
  const changedSourceIds = [];
  const logEntries = [];
  const contentCache = new Map();
  let stateChanged = Object.keys(previousSources).some((id) => !activeSourceIds.has(id));

  for (const source of sources) {
    const previous = previousState.sources?.[source.id] || null;
    let result;
    if (source.type === 'local') {
      const text = await readLocalSource(source);
      const sha256 = digest(text);
      result = {
        status: previous?.sha256 === sha256 ? 304 : 200,
        text,
        sha256,
        etag: null,
        githubSha: null,
        bytes: Buffer.byteLength(text)
      };
      contentCache.set(source.id, text);
    } else {
      result = await fetchGithubSource(source, FORCE ? null : previous?.etag);
      if (result.text !== undefined) contentCache.set(source.id, result.text);
    }

    if (result.status === 304) {
      nextState.sources[source.id] = previous;
      logEntries.push({
        id: source.id,
        status: 304,
        result: 'not_modified',
        sha256: previous?.sha256 || null
      });
      continue;
    }

    const contentChanged = !previous || previous.sha256 !== result.sha256;
    const nextEntry = {
      type: source.type,
      repo: source.repo || null,
      ref: source.ref || null,
      path: source.path,
      behavior: source.behavior,
      etag: result.etag || previous?.etag || null,
      githubSha: result.githubSha || null,
      sha256: result.sha256,
      bytes: result.bytes
    };
    if (JSON.stringify(previous) !== JSON.stringify(nextEntry)) stateChanged = true;
    nextState.sources[source.id] = nextEntry;
    if (contentChanged || FORCE) changedSourceIds.push(source.id);
    logEntries.push({
      id: source.id,
      status: result.status,
      result: contentChanged ? 'changed' : 'metadata_changed',
      sha256: result.sha256,
      bytes: result.bytes
    });
  }

  return { nextState, changedSourceIds, stateChanged, logEntries, contentCache };
}

async function loadAllSources(sources, contentCache) {
  const result = new Map(contentCache);
  for (const source of sources) {
    if (result.has(source.id)) continue;
    const text = source.type === 'local'
      ? await readLocalSource(source)
      : (await fetchGithubSource(source, null)).text;
    result.set(source.id, text);
  }
  return result;
}

async function rebuildProviders(manifest, sourceTexts) {
  await fs.mkdir(GENERATED_DIR, { recursive: true });
  const providers = [];
  const totals = { domain: 0, ipcidr: 0, residual: 0, process: 0, all: 0 };
  let filesChanged = false;

  for (const provider of manifest.providers) {
    const base = emptyBuckets();
    for (const source of provider.sources) {
      mergeBuckets(base, parseSource(sourceTexts.get(source.id), source));
    }

    const target = cloneBuckets(base);
    const candidateDiffs = [];
    for (const candidate of provider.candidates || []) {
      const parsed = parseSource(sourceTexts.get(candidate.id), candidate);
      const diff = compareBuckets(base, parsed, candidate.behavior);
      candidateDiffs.push({
        id: candidate.id,
        mode: candidate.mode,
        added: diff.added,
        missingFromCandidate: diff.missing,
        addedSample: diff.addedSample,
        missingSample: diff.missingSample
      });
      if (candidate.mode === 'union') mergeBuckets(target, parsed);
    }

    const outputs = {};
    const inlineRules = {};
    for (const kind of ['domain', 'ipcidr', 'residual', 'process']) {
      const values = [...target[kind]].sort();

      if (kind === 'residual' || kind === 'process') {
        const obsoletePath = generatedPath(provider.id, kind);
        if (await fileExists(obsoletePath)) {
          await fs.rm(obsoletePath);
          filesChanged = true;
        }
        if (values.length === 0) continue;
        inlineRules[kind] = values;
        totals[kind] += values.length;
        totals.all += values.length;
        continue;
      }

      if (values.length === 0) {
        const stalePath = generatedPath(provider.id, kind);
        if (await fileExists(stalePath)) {
          await fs.rm(stalePath);
          filesChanged = true;
        }
        continue;
      }

      const outputPath = generatedPath(provider.id, kind);
      const content = renderGeneratedRules(provider, kind, values);
      if (await writeIfChanged(outputPath, content)) filesChanged = true;
      outputs[kind] = path.relative(ROOT, outputPath);
      totals[kind] += values.length;
      totals.all += values.length;
    }

    const shadowrocketRules = shadowrocketRulesFromBuckets(target);
    const shadowrocketOutputPath = path.join(SHADOWROCKET_GENERATED_DIR, `${provider.id}.list`);
    const shadowrocketContent = renderShadowrocketRuleList(provider.id, provider.policy, shadowrocketRules);
    if (await writeIfChanged(shadowrocketOutputPath, shadowrocketContent)) filesChanged = true;

    providers.push({
      id: provider.id,
      policy: provider.policy,
      baseCounts: bucketCounts(base),
      outputCounts: bucketCounts(target),
      outputs,
      inlineRules,
      shadowrocketOutput: path.relative(ROOT, shadowrocketOutputPath),
      shadowrocketRuleCount: shadowrocketRules.length,
      shadowrocketSkippedProcessCount: target.process.size,
      candidates: candidateDiffs
    });
  }

  return { providers, totals, filesChanged };
}

async function rebuildShadowrocketGeosites(manifest, sourceTexts) {
  const geosites = [];
  let filesChanged = false;
  for (const source of manifest.shadowrocket.geosites) {
    const buckets = parseSource(sourceTexts.get(source.id), source);
    const rules = shadowrocketRulesFromBuckets(buckets);
    const outputPath = path.join(SHADOWROCKET_GENERATED_DIR, 'geosite', `${shadowrocketFileId(source.name)}.list`);
    const content = renderShadowrocketRuleList(`geosite:${source.name}`, source.policy, rules);
    if (await writeIfChanged(outputPath, content)) filesChanged = true;
    geosites.push({
      id: source.id,
      name: source.name,
      policy: source.policy,
      output: path.relative(ROOT, outputPath),
      ruleCount: rules.length
    });
  }
  return {
    filesChanged,
    summary: {
      template: path.relative(ROOT, SHADOWROCKET_TEMPLATE_PATH),
      subscriptionPlaceholder: SHADOWROCKET_SUBSCRIPTION_PLACEHOLDER,
      geosites
    }
  };
}

function parseSource(text, source) {
  if (typeof text !== 'string') throw new Error(`Missing content for source ${source.id}`);
  rejectUnsafeSource(text, source.id);
  const items = parsePayload(text, source);
  if (items.length === 0) throw new Error(`Source ${source.id} has no rules`);
  const buckets = emptyBuckets();

  for (const item of items) {
    if (source.behavior === 'domain') {
      buckets.domain.add(normalizeDomainProviderValue(item, source.id));
      continue;
    }
    if (source.behavior === 'ipcidr') {
      buckets.ipcidr.add(normalizeIpValue(item, source.id));
      continue;
    }

    const parts = String(item).split(',').map((part) => part.trim());
    const type = parts[0]?.toUpperCase();
    const value = parts[1];
    if (!type || !value) throw new Error(`Malformed classical rule in ${source.id}: ${item}`);
    if (type === 'DOMAIN') buckets.domain.add(normalizeDomainProviderValue(value, source.id));
    else if (type === 'DOMAIN-SUFFIX') buckets.domain.add(normalizeDomainProviderValue(`+.${value}`, source.id));
    else if (type === 'IP-CIDR' || type === 'IP-CIDR6') buckets.ipcidr.add(normalizeIpValue(value, source.id));
    else if (PROCESS_RULE_TYPES.has(type)) buckets.process.add(`${type},${value}`);
    else if (RESIDUAL_RULE_TYPES.has(type)) buckets.residual.add(`${type},${value}`);
    else throw new Error(`Unsupported classical rule type ${type} in ${source.id}`);
  }
  return buckets;
}

function parsePayload(text, source) {
  if (/\.ya?ml$/i.test(source.path)) {
    const parsed = YAML.parse(text);
    if (!parsed || !Array.isArray(parsed.payload)) throw new Error(`YAML source ${source.id} must contain payload array`);
    return parsed.payload.map(String);
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function rejectUnsafeSource(text, sourceId) {
  const bytes = Buffer.byteLength(text);
  if (bytes === 0 || bytes > MAX_SOURCE_BYTES) throw new Error(`Source ${sourceId} has invalid size: ${bytes}`);
  const prefix = text.trimStart().slice(0, 256).toLowerCase();
  if (prefix.startsWith('<!doctype html') || prefix.startsWith('<html') || prefix.includes('<body')) {
    throw new Error(`Source ${sourceId} returned HTML`);
  }
  if (/^error:/i.test(text.trimStart()) || /access denied/i.test(prefix)) {
    throw new Error(`Source ${sourceId} returned an error response`);
  }
  if (text.includes('\0')) throw new Error(`Source ${sourceId} contains NUL bytes`);
}

function normalizeDomainProviderValue(value, sourceId) {
  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized.includes(',') || /\s/.test(normalized)) {
    throw new Error(`Invalid domain provider value in ${sourceId}: ${value}`);
  }
  return normalized;
}

function normalizeIpValue(value, sourceId) {
  const normalized = String(value).trim();
  if (!normalized.includes('/') || normalized.includes(',') || /\s/.test(normalized)) {
    throw new Error(`Invalid CIDR value in ${sourceId}: ${value}`);
  }
  return normalized;
}

function emptyBuckets() {
  return { domain: new Set(), ipcidr: new Set(), residual: new Set(), process: new Set() };
}

function cloneBuckets(source) {
  return Object.fromEntries(Object.entries(source).map(([key, values]) => [key, new Set(values)]));
}

function mergeBuckets(target, source) {
  for (const kind of Object.keys(target)) {
    for (const value of source[kind]) target[kind].add(value);
  }
}

function compareBuckets(base, candidate, behavior) {
  const added = {};
  const missing = {};
  const addedSample = {};
  const missingSample = {};
  const relevantKinds = behavior === 'domain'
    ? new Set(['domain'])
    : behavior === 'ipcidr'
      ? new Set(['ipcidr'])
      : new Set(['domain', 'ipcidr', 'residual', 'process']);
  for (const kind of Object.keys(base)) {
    const addedValues = relevantKinds.has(kind)
      ? [...candidate[kind]].filter((value) => !base[kind].has(value))
      : [];
    const missingValues = relevantKinds.has(kind)
      ? [...base[kind]].filter((value) => !candidate[kind].has(value))
      : [];
    added[kind] = addedValues.length;
    missing[kind] = missingValues.length;
    addedSample[kind] = addedValues.slice(0, 10);
    missingSample[kind] = missingValues.slice(0, 10);
  }
  return { added, missing, addedSample, missingSample };
}

function bucketCounts(buckets) {
  const counts = Object.fromEntries(Object.entries(buckets).map(([key, values]) => [key, values.size]));
  counts.all = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return counts;
}

function generatedPath(providerId, kind) {
  const suffix = kind === 'residual' || kind === 'process' ? 'list' : 'txt';
  return path.join(GENERATED_DIR, `${providerId}-${kind}.${suffix}`);
}

function renderGeneratedRules(provider, kind, values) {
  const behavior = kind === 'domain' ? 'domain' : kind === 'ipcidr' ? 'ipcidr' : 'classical';
  return [
    '# Generated by scripts/sync-rules.mjs. Do not edit.',
    `# Provider: ${provider.id}`,
    `# Policy: ${provider.policy}`,
    `# Behavior: ${behavior}`,
    `# Rules: ${values.length}`,
    '',
    ...values,
    ''
  ].join('\n');
}

function shadowrocketRulesFromBuckets(buckets) {
  const rules = [];
  for (const value of [...buckets.domain].sort()) {
    if (value.startsWith('+.')) rules.push(`DOMAIN-SUFFIX,${value.slice(2)}`);
    else if (value.startsWith('.')) rules.push(`DOMAIN-SUFFIX,${value.slice(1)}`);
    else rules.push(`DOMAIN,${value}`);
  }
  for (const value of [...buckets.ipcidr].sort()) {
    rules.push(`${value.includes(':') ? 'IP-CIDR6' : 'IP-CIDR'},${value},no-resolve`);
  }
  for (const value of [...buckets.residual].sort()) rules.push(value);
  return [...new Set(rules)];
}

function renderShadowrocketRuleList(id, policy, rules) {
  if (rules.length === 0) throw new Error(`Shadowrocket rule list ${id} is empty`);
  return [
    '# Generated by scripts/sync-rules.mjs. Do not edit.',
    `# Source: ${id}`,
    `# Policy: ${policy}`,
    `# Rules: ${rules.length}`,
    '',
    ...rules,
    ''
  ].join('\n');
}

function shadowrocketFileId(value) {
  return String(value).toLowerCase().replace(/!/g, 'not-').replace(/@/g, '-at-').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function renderV2Template(status) {
  const originalText = await fs.readFile(MIHOMO_PATH, 'utf8');
  const marker = '\nrule-providers:\n';
  const markerIndex = originalText.indexOf(marker);
  if (markerIndex < 0) throw new Error('Mihomo.yml does not contain a top-level rule-providers section');
  const original = YAML.parse(originalText);
  if (!original || !original['rule-providers'] || !Array.isArray(original.rules)) {
    throw new Error('Mihomo.yml must contain rule-providers and rules');
  }

  const providersById = new Map(status.providers.map((provider) => [provider.id, provider]));
  const generatedProviders = {};
  for (const provider of status.providers) {
    for (const kind of ['domain', 'ipcidr']) {
      const relativePath = provider.outputs[kind];
      if (!relativePath) continue;
      const generatedId = `${provider.id}-${kind}`;
      generatedProviders[generatedId] = {
        type: 'http',
        behavior: kind,
        format: 'text',
        interval: 86400,
        path: `./providers/rules/v2/${path.basename(relativePath)}`,
        url: `https://raw.githubusercontent.com/jacob2826/clash-rule/main/${relativePath}`
      };
    }
  }

  const expandedProviders = new Set();
  const rules = [];
  for (const rule of original.rules) {
    const parts = String(rule).split(',');
    if (parts[0] !== 'RULE-SET') {
      rules.push(rule);
      continue;
    }
    const originalProviderId = parts[1];
    const policy = parts[2];
    const providerId = originalProviderId === 'anthropic' ? 'claude' : originalProviderId;
    const generated = providersById.get(providerId);
    if (!generated) throw new Error(`No V2 provider mapping for ${originalProviderId}`);
    if (expandedProviders.has(providerId)) continue;
    expandedProviders.add(providerId);
    if (generated.policy !== policy) {
      throw new Error(`Policy mismatch for ${providerId}: ${generated.policy} != ${policy}`);
    }
    for (const kind of ['domain', 'ipcidr']) {
      if (!generated.outputs[kind]) continue;
      const suffix = kind === 'ipcidr' ? ',no-resolve' : '';
      rules.push(`RULE-SET,${providerId}-${kind},${policy}${suffix}`);
    }
    for (const kind of ['residual', 'process']) {
      for (const inlineRule of generated.inlineRules[kind] || []) {
        rules.push(`${inlineRule},${policy}`);
      }
    }
  }

  if (expandedProviders.size !== providersById.size) {
    const missing = [...providersById.keys()].filter((id) => !expandedProviders.has(id));
    throw new Error(`V2 providers are not referenced by Mihomo.yml rules: ${missing.join(', ')}`);
  }

  const tail = YAML.stringify(
    { 'rule-providers': generatedProviders, rules },
    { aliasDuplicateObjects: false, lineWidth: 0 }
  );
  const content = originalText.slice(0, markerIndex + 1) + tail;
  return writeIfChanged(MIHOMO_V2_PATH, content);
}

async function renderShadowrocketTemplate(status) {
  const original = YAML.parse(await fs.readFile(MIHOMO_PATH, 'utf8'));
  if (!Array.isArray(original?.['proxy-groups']) || !Array.isArray(original?.rules)) {
    throw new Error('Mihomo.yml must contain proxy-groups and rules for Shadowrocket output');
  }
  const providersById = new Map(status.providers.map((provider) => [provider.id, provider]));
  const geositesByName = new Map((status.shadowrocket?.geosites || []).map((source) => [source.name, source]));
  const expandedProviders = new Set();
  const expandedGeosites = new Set();
  const rules = [];

  for (const rule of original.rules) {
    const parts = String(rule).split(',');
    const type = parts[0];
    if (type === 'RULE-SET') {
      const originalProviderId = parts[1];
      const policy = parts[2];
      const providerId = originalProviderId === 'anthropic' ? 'claude' : originalProviderId;
      const provider = providersById.get(providerId);
      if (!provider) throw new Error(`No Shadowrocket provider mapping for ${originalProviderId}`);
      if (expandedProviders.has(providerId)) continue;
      expandedProviders.add(providerId);
      if (provider.policy !== policy) throw new Error(`Shadowrocket policy mismatch for ${providerId}: ${provider.policy} != ${policy}`);
      rules.push(`RULE-SET,${PUBLIC_RAW_BASE}/${provider.shadowrocketOutput},${policy}`);
      continue;
    }
    if (type === 'GEOSITE') {
      const source = geositesByName.get(parts[1]);
      if (!source) throw new Error(`No Shadowrocket geosite mapping for ${parts[1]}`);
      if (source.policy !== parts[2]) throw new Error(`Shadowrocket geosite policy mismatch for ${parts[1]}`);
      expandedGeosites.add(source.name);
      rules.push(`RULE-SET,${PUBLIC_RAW_BASE}/${source.output},${parts[2]}`);
      continue;
    }
    if (type === 'MATCH') {
      rules.push(`FINAL,${parts[1]}`);
      continue;
    }
    if (!['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'IP-CIDR', 'IP-CIDR6', 'IP-ASN', 'GEOIP'].includes(type)) {
      throw new Error(`Unsupported Shadowrocket top-level rule: ${rule}`);
    }
    rules.push(String(rule));
  }

  if (expandedProviders.size !== providersById.size) {
    const missing = [...providersById.keys()].filter((id) => !expandedProviders.has(id));
    throw new Error(`Shadowrocket providers are not referenced by Mihomo.yml rules: ${missing.join(', ')}`);
  }
  if (expandedGeosites.size !== geositesByName.size) {
    const missing = [...geositesByName.keys()].filter((name) => !expandedGeosites.has(name));
    throw new Error(`Shadowrocket GEOSITE sources are not referenced by Mihomo.yml rules: ${missing.join(', ')}`);
  }

  const groups = original['proxy-groups'].map(renderShadowrocketGroup);
  const content = [
    '# Generated by scripts/sync-rules.mjs. Do not edit.',
    '# The Worker replaces the subscription placeholder per airport.',
    '',
    '[General]',
    'bypass-system = true',
    'skip-proxy = 127.0.0.1,localhost,*.local,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16',
    'tun-excluded-routes = 10.0.0.0/8,172.16.0.0/12,192.168.0.0/16',
    'dns-server = 119.29.29.29,223.5.5.5',
    'fallback-dns-server = system',
    'ipv6 = false',
    '',
    '[Proxy Group]',
    ...groups,
    '',
    '[Rule]',
    ...rules,
    ''
  ].join('\n');
  return writeIfChanged(SHADOWROCKET_TEMPLATE_PATH, content);
}

function renderShadowrocketGroup(group) {
  const name = shadowrocketField(group.name, 'proxy group name');
  if (!['select', 'url-test'].includes(group.type)) throw new Error(`Unsupported Shadowrocket proxy group type: ${group.type}`);
  const values = [group.type];
  if (Array.isArray(group.proxies) && group.proxies.length > 0) {
    values.push(...group.proxies.map((value) => shadowrocketField(value, `proxy group ${name}`)));
  } else if (Array.isArray(group.use) && group.use.length > 0) {
    values.push(SHADOWROCKET_SUBSCRIPTION_PLACEHOLDER, 'use=true');
    const filter = shadowrocketPolicyFilter(group);
    if (filter) values.push(`policy-regex-filter=${filter}`);
  } else {
    throw new Error(`Shadowrocket proxy group ${name} has no proxies or subscription`);
  }
  if (group.type === 'url-test') {
    if (group.interval) values.push(`interval=${Number(group.interval)}`);
    if (group.tolerance !== undefined) values.push(`tolerance=${Number(group.tolerance)}`);
    if (group.url) values.push(`url=${shadowrocketField(group.url, `health URL for ${name}`)}`);
  }
  return `${name} = ${values.join(',')}`;
}

function shadowrocketPolicyFilter(group) {
  if (group.filter && group['exclude-filter']) {
    const include = String(group.filter).replace(/^\(\?i\)/, '');
    const exclude = String(group['exclude-filter']).replace(/^\(\?i\)/, '');
    return shadowrocketField(`(?i)(?=.*(?:${include}))^((?!(?:${exclude})).)*$`, `filter for ${group.name}`);
  }
  if (group.filter) return shadowrocketField(group.filter, `filter for ${group.name}`);
  if (group['exclude-filter']) {
    const exclude = String(group['exclude-filter']).replace(/^\(\?i\)/, '');
    return shadowrocketField(`(?i)^((?!(?:${exclude})).)*$`, `filter for ${group.name}`);
  }
  return '';
}

function shadowrocketField(value, label) {
  const text = String(value || '').trim();
  if (!text || /[\r\n,]/.test(text)) throw new Error(`Invalid Shadowrocket ${label}`);
  return text;
}

async function fetchGithubSource(source, etag) {
  const url = `https://api.github.com/repos/${source.repo}/contents/${encodePath(source.path)}?ref=${encodeURIComponent(source.ref)}`;
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': GITHUB_API_VERSION,
    'user-agent': 'clash-rule-maintenance'
  };
  if (process.env.GH_TOKEN) headers.authorization = `Bearer ${process.env.GH_TOKEN}`;
  if (etag) headers['if-none-match'] = etag;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (response.status === 304) return { status: 304 };
  if (!response.ok) throw new Error(`GitHub source ${source.id} returned HTTP ${response.status}`);
  const body = await response.json();
  let text;
  if (body.content && body.encoding === 'base64') {
    text = Buffer.from(body.content.replace(/\n/g, ''), 'base64').toString('utf8');
  } else if (body.download_url) {
    const download = await fetch(body.download_url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!download.ok) throw new Error(`Download for ${source.id} returned HTTP ${download.status}`);
    text = await readLimitedText(download, source.id);
  } else {
    throw new Error(`GitHub source ${source.id} did not include content`);
  }
  rejectUnsafeSource(text, source.id);
  return {
    status: response.status,
    text,
    etag: response.headers.get('etag'),
    githubSha: body.sha || null,
    sha256: digest(text),
    bytes: Buffer.byteLength(text)
  };
}

async function readLimitedText(response, sourceId) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_SOURCE_BYTES) throw new Error(`Source ${sourceId} exceeds ${MAX_SOURCE_BYTES} bytes`);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SOURCE_BYTES) {
      await reader.cancel();
      throw new Error(`Source ${sourceId} exceeds ${MAX_SOURCE_BYTES} bytes`);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(merged);
}

async function readLocalSource(source) {
  const absolute = path.resolve(ROOT, source.path);
  if (!absolute.startsWith(`${ROOT}${path.sep}`)) throw new Error(`Local source escapes repository: ${source.path}`);
  const text = await fs.readFile(absolute, 'utf8');
  rejectUnsafeSource(text, source.id);
  return text;
}

function encodePath(value) {
  return value.split('/').map(encodeURIComponent).join('/');
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function writeIfChanged(filePath, content) {
  let previous = null;
  try {
    previous = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (previous === content) return false;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  return true;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function readJsonIfPresent(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function renderStatusMarkdown(status) {
  const lines = [
    '# Optimized rule status',
    '',
    `Generated: ${status.generatedAt}`,
    '',
    '| Provider | Policy | Domain | IP CIDR | Residual | Process | Total |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |'
  ];
  for (const provider of status.providers) {
    const count = provider.outputCounts;
    lines.push(`| ${provider.id} | ${provider.policy} | ${count.domain} | ${count.ipcidr} | ${count.residual} | ${count.process} | ${count.all} |`);
  }
  lines.push(
    `| **Total** |  | **${status.totals.domain}** | **${status.totals.ipcidr}** | **${status.totals.residual}** | **${status.totals.process}** | **${status.totals.all}** |`,
    '',
    '## MetaCubeX candidate differences',
    '',
    '| Provider | Candidate | Mode | Added | Missing from candidate |',
    '| --- | --- | --- | ---: | ---: |'
  );
  for (const provider of status.providers) {
    for (const candidate of provider.candidates) {
      const added = Object.values(candidate.added).reduce((sum, count) => sum + count, 0);
      const missing = Object.values(candidate.missingFromCandidate).reduce((sum, count) => sum + count, 0);
      lines.push(`| ${provider.id} | ${candidate.id} | ${candidate.mode} | ${added} | ${missing} |`);
    }
  }
  lines.push('');
  lines.push(
    '## Shadowrocket',
    '',
    `- Template: \`${status.shadowrocket.template}\``,
    `- Provider lists: ${status.providers.length}`,
    `- GEOSITE lists: ${status.shadowrocket.geosites.length}`,
    `- Rules: ${status.providers.reduce((sum, provider) => sum + provider.shadowrocketRuleCount, 0) + status.shadowrocket.geosites.reduce((sum, source) => sum + source.ruleCount, 0)}`,
    ''
  );
  return lines.join('\n');
}

function renderRunLog(log) {
  const lines = [
    '# Rule synchronization',
    '',
    `- Status: ${log.status}`,
    `- Result: ${log.result || 'unknown'}`,
    `- Started: ${log.startedAt}`,
    `- Finished: ${log.finishedAt}`,
    `- Force rebuild: ${log.force}`,
    `- Sources checked: ${log.sources.length}`,
    `- Providers rebuilt: ${log.providers.length}`,
    `- Shadowrocket GEOSITE lists rebuilt: ${log.shadowrocket?.geosites?.length || 0}`
  ];
  if (log.error) {
    lines.push('', '## Failure', '', `- ${log.error.name}: ${log.error.message}`, '', '```text', log.error.stack || log.error.message, '```');
  } else if (log.sources.length) {
    lines.push('', '## Source checks', '', '| Source | HTTP | Result |', '| --- | ---: | --- |');
    for (const source of log.sources) lines.push(`| ${source.id} | ${source.status} | ${source.result} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function writeGithubOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fsSync.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
