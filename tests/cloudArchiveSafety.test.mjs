/*
 * Review P1 containment, not a new backup format. Runs the real commands with
 * synthetic paths. Any network/archiver access leaves a trace; no real service
 * or router data is used. Existing encrypted LuCI export has its own tests.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { it } from 'node:test';
import { shellTestPath } from '../tools/quality/testEnvironment.mjs';
import { runtimeTimeout, completedProcess } from './helpers/runtimeProcess.mjs';
const repo = resolve(import.meta.dirname, '..');
const source = process.env.SHEEPFOLD_REVIEW_SOURCE || repo;
const runtime = 'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold';
const q = v => `'${String(v).replaceAll("'", "'\\''")}'`;
const configText = "config sheepfold 'global'\n option password 'REVIEW-PASSWORD-DO-NOT-SEND'\n option pairing_code 'REVIEW-ONE-TIME-DO-NOT-SEND'\nconfig gdrive 'gdrive'\n option refresh_token 'REVIEW-REFRESH-DO-NOT-SEND'\n";
function fixture(t, backend, selected = backend.replaceAll('-', '_')) {
  const parent = join(repo, '.build', 'review-safety'); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'case-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'), ram = join(root, 'ram'), config = join(root, 'config'), work = join(root, 'work');
  const queue = join(ram, '.private', 'archive');
  for (const dir of [bin, ram, config, work, queue]) mkdirSync(dir, { recursive: true });
  const sp = v => shellTestPath(v, { cwd: repo, allowedRoot: root });
  const put = (name, body) => { const file = join(bin, name); writeFileSync(file, body); chmodSync(file, 0o755); };
  const text = readFileSync(join(source, runtime, `sheepfold-${backend}`), 'utf8');
  const mapped = text.replaceAll('/usr/libexec/sheepfold', sp(bin)).replaceAll('/tmp/sheepfold', sp(ram)).replaceAll('/etc/config', sp(config));
  put('entry', mapped);
  const boundary = '\ncommand_name="${1:-}"'; assert.ok(mapped.includes(boundary));
  put('function', mapped.slice(0, mapped.lastIndexOf(boundary)) + '\ncreate_config_backup "$1"\n');
  writeFileSync(join(config, 'sheepfold'), configText);
  writeFileSync(join(ram, 'events.log'), 'synthetic journal\n');
  writeFileSync(join(root, 'trace'), '');
  const oldArchive = join(queue, 'sheepfold-config-old.tar');
  const tar = spawnSync('tar', ['-C', config, '-cf', oldArchive, 'sheepfold'], { encoding: 'utf8' });
  assert.equal(tar.status, 0, tar.stderr);
  const beforeArchive = readFileSync(oldArchive);
  put('uci', `#!/bin/sh\ncase "$*" in\n'-q get sheepfold.global.log_storage') printf '%s' ${q(selected)};;\n'-q show sheepfold.global') printf '%s\\n' 'sheepfold.global=sheepfold';;\n*) exit 1;;\nesac\n`);
  for (const name of ['curl', 'tar', 'cp']) put(name, `#!/bin/sh\nprintf '${name}\\n' >> ${q(sp(join(root, 'trace')))}\nexit 91\n`);
  const run = command => completedProcess(spawnSync(process.platform === 'win32' ? 'bash' : 'sh',
    ['-c', 'PATH="$1:$PATH"; export PATH; shift; exec sh "$@"', 'review-safety', sp(bin), sp(join(bin, command === 'create' ? 'function' : 'entry')), command === 'create' ? sp(work) : command],
    { cwd: repo, encoding: 'utf8', timeout: runtimeTimeout(15000) }), `safety ${backend}`);
  return { root, ram, work, run, oldArchive, beforeArchive, config, trace: () => readFileSync(join(root, 'trace'), 'utf8') };
}
for (const backend of ['google-drive', 'yandex-disk']) {
  it(`${backend}: raw configuration producer refuses before copying or archiving secrets`, t => {
    const f = fixture(t, backend), result = f.run('create');
    assert.equal(result.status, 78);
    assert.equal(result.stdout, '');
    assert.equal(f.trace(), '');
    assert.deepEqual(readdirSync(f.work), []);
    assert.equal(readFileSync(join(f.config, 'sheepfold'), 'utf8'), configText);
  });
  it(`${backend}: archive-push explicitly fails without sending existing raw backups or deleting them`, t => {
    const f = fixture(t, backend), result = f.run('archive-push');
    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { ok: false, error: 'config_backup_unavailable' });
    assert.equal(f.trace(), '', 'no network, copying or archive generation allowed');
    assert.deepEqual(readFileSync(f.oldArchive), f.beforeArchive);
    assert.equal(readFileSync(join(f.config, 'sheepfold'), 'utf8'), configText);
    assert.equal(readFileSync(join(f.ram, 'events.log'), 'utf8'), 'synthetic journal\n');
  });
  it(`${backend}: repeated blocked attempts do not consume a prior backup`, t => {
    const f = fixture(t, backend);
    for (let i = 0; i < 2; i++) assert.equal(f.run('archive-push').status, 1);
    assert.ok(existsSync(f.oldArchive));
    assert.deepEqual(readFileSync(f.oldArchive), f.beforeArchive);
    assert.equal(f.trace(), '');
  });
  it(`${backend}: confirmed RAM selection remains a no-op`, t => {
    const f = fixture(t, backend, 'ram'), result = f.run('archive-push');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(f.trace(), '');
    assert.deepEqual(readFileSync(f.oldArchive), f.beforeArchive);
  });
}
