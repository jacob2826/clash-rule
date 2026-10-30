import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templates = ['Mihomo.yml', 'mihomo_v2.yml', 'Shadowrocket.template.conf'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function buildRelease(root = ROOT) {
  const paths = new Set(templates);
  for (const file of templates) {
    const text = await fs.readFile(path.join(root, file), 'utf8');
    for (const match of text.matchAll(/https:\/\/raw\.githubusercontent\.com\/jacob2826\/clash-rule\/(?:refs\/heads\/)?main\/([^\s"'<>\[\],)]+)/g)) {
      const relative = decodeURIComponent(match[1]);
      if (relative.split('/').some(p => !p || p === '.' || p === '..') || !/^(?:(?:UnBan|AppleAI)\.list|icons\/[A-Za-z0-9_.-]+\.(?:png|svg)|rules\/generated\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:txt|list))$/.test(relative)) throw Error('Invalid public release path');
      paths.add(relative);
    }
  }
  const files = [];
  const rootReal = await fs.realpath(root);
  for (const relative of [...paths].sort()) {
    const real = await fs.realpath(path.join(root, relative));
    if (!real.startsWith(rootReal + path.sep)) throw Error('Release symlink outside repository');
    const bytes = await fs.readFile(real);
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw Error('Invalid release file size');
    files.push({ path: relative, sha256: hash(bytes), bytes: bytes.length });
  }
  if (files.length > 128 || files.reduce((n, f) => n + f.bytes, 0) > 16 * 1024 * 1024) throw Error('Release too large');
  return { version: 1, releaseId: hash(JSON.stringify(files)), files };
}
export async function writeManifest(root = ROOT) {
  const manifest = await buildRelease(root); const file = path.join(root, 'rules/release-manifest.json');
  const text = JSON.stringify(manifest, null, 2) + '\n';
  const previous = await fs.readFile(file, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (previous !== text) await fs.writeFile(file, text);
  return manifest;
}
export async function publishRelease(root = ROOT, env = process.env) {
  const endpoint = env.SUB_RELEASE_URL; const secret = env.SUB_RELEASE_SECRET;
  if (!endpoint || !secret) throw Error('Release publishing secrets missing');
  const url = new URL(endpoint); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('Invalid release endpoint');
  const manifest = await buildRelease(root);
  const headers = { authorization: `Bearer ${secret}`, 'content-type': 'application/json', 'user-agent': 'Sub-Release-Publisher/1.0' };
  async function call(suffix, options = {}) {
    const response = await fetch(endpoint + suffix, { ...options, headers, signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw Error(`Release endpoint HTTP ${response.status}`);
    return response.json();
  }
  const state = await call('/state');
  if (state.releaseId === manifest.releaseId && !state.missingFiles?.length) { console.log(JSON.stringify({ status: 'unchanged', releaseId: manifest.releaseId })); return; }
  const oldHashes = new Set((state.manifest?.files || []).map(f => f.sha256));
  const files = [];
  for (const f of manifest.files) if (!oldHashes.has(f.sha256) || state.missingFiles?.includes(f.path)) files.push({ path: f.path, contentBase64: (await fs.readFile(path.join(root, f.path))).toString('base64') });
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const body = JSON.stringify({ manifest, sourceCommit, expectedReleaseId: state.releaseId || null, files });
  if (Buffer.byteLength(body) > 16 * 1024 * 1024) throw Error('Release upload too large');
  const result = await call('', { method: 'POST', body });
  console.log(JSON.stringify({ status: result.status, releaseId: result.releaseId, uploadedFiles: files.length }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--publish')) await publishRelease();
    else { const manifest = await writeManifest(); console.log(JSON.stringify({ releaseId: manifest.releaseId, files: manifest.files.length })); }
  } catch (error) {
    console.error(error.message.startsWith('Release endpoint HTTP') ? error.message : 'Release operation failed; check artifacts, configuration and credentials.');
    process.exitCode = 1;
  }
}
