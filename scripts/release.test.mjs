import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildRelease } from './release.mjs';

test('release changes only with delivered contents, including rule-only and icon-only changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sub-release-'));
  try {
    await mkdir(path.join(root, 'icons'));
    await writeFile(path.join(root, 'Mihomo.yml'), 'icon: https://raw.githubusercontent.com/jacob2826/clash-rule/main/icons/Test.png\n');
    await writeFile(path.join(root, 'mihomo_v2.yml'), 'rule: https://raw.githubusercontent.com/jacob2826/clash-rule/main/UnBan.list\n');
    await writeFile(path.join(root, 'Shadowrocket.template.conf'), '[General]\n');
    await writeFile(path.join(root, 'UnBan.list'), 'DOMAIN-SUFFIX,example.com\n');
    await writeFile(path.join(root, 'icons/Test.png'), new Uint8Array([1,2,3]));
    const first = await buildRelease(root);
    assert.equal((await buildRelease(root)).releaseId, first.releaseId);
    assert.equal(first.files.length, 5);
    await mkdir(path.join(root, 'rules/status'), { recursive: true });
    await writeFile(path.join(root, 'rules/status/latest.json'), '{"generatedAt":"tomorrow"}');
    assert.equal((await buildRelease(root)).releaseId, first.releaseId);
    await writeFile(path.join(root, 'UnBan.list'), 'DOMAIN-SUFFIX,new.example.com\n');
    const second = await buildRelease(root); assert.notEqual(second.releaseId, first.releaseId);
    await writeFile(path.join(root, 'icons/Test.png'), new Uint8Array([4,5,6]));
    assert.notEqual((await buildRelease(root)).releaseId, second.releaseId);
  } finally { await rm(root, { recursive: true, force: true }); }
});
