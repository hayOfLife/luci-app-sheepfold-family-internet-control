/*
 * Реальный writer и RAM-файлы в изолированной .build-папке, без роутера/облака.
 * Fault-команды обязаны оставить trace; Linux-проверки используют настоящий
 * flock и отказ записи RLIMIT_FSIZE. Барьеры управляют временем фоновых задач.
 * Cleanup удаляет только fixture. Успех не доказывает flash/USB/cloud delivery.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRouterFixture, runtimeRoot, parseCgi } from './helpers/routerRuntimeFixture.mjs';

const quote = (v) => `'${String(v).replaceAll("'", "'\\''")}'`;
const native = process.platform === 'linux';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await delay(10);
  }
  assert.fail(message);
}
function fixture(t, values = {}) {
  const f = createRouterFixture(values);
  t.after(() => f.close());
  const tracePath = join(f.root, 'faults');
  writeFileSync(tracePath, '');
  const put = (name, text) => { const p = join(f.bin, name); writeFileSync(p, text); chmodSync(p, 0o755); };
  const source = process.env.SHEEPFOLD_WRITER_TEST_SOURCE || runtimeRoot;
  put('sheepfold-log', readFileSync(join(source, 'sheepfold-log'), 'utf8')
    .replaceAll('/usr/libexec/sheepfold', f.shellPath(f.bin))
    .replaceAll('/tmp/sheepfold', f.shellPath(f.runtime))
    // Старый writer разрешал весь /tmp: его родитель тоже переносится внутрь fixture.
    // Иначе baseline ошибочно выбирал бы default только из-за /mnt-пути стенда.
    .replaceAll('/tmp/*)', `${f.shellPath(f.root)}/*)`));
  const fault = (name, body) => put(name, `#!/bin/sh\nprintf '${name}-fault\\n' >> ${quote(f.shellPath(tracePath))}\n${body}\n`);
  return { ...f, put, fault, tracePath, trace: () => readFileSync(tracePath, 'utf8'),
    log: join(f.runtime, 'events.log'),
    write: (message = 'synthetic event') => f.run('sheepfold-log', [message]),
    select: (path, extra = {}) => f.setValues({ 'sheepfold.global.log_cache_path': f.shellPath(path), ...extra }),
  };
}
function success(result) { assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, ''); }
function failure(result) { assert.notEqual(result.status, 0, `false success: ${result.stdout} ${result.stderr}`); }

describe('RAM writer path ownership', () => {
  it('writes a UTF-8 event readable by the actual log API', (t) => {
    const f = fixture(t); success(f.write('Семья 🦊\nновое\tсобытие'));
    const r = parseCgi(f.run('sheepfold-api-legacy', [], { env: { PATH_INFO: '/log' } }));
    assert.equal(r.status, 200); assert.equal(r.body.entries.length, 1);
    assert.match(r.body.entries[0], /Семья 🦊 новое событие$/);
  });
  it('appends without truncating existing events', (t) => {
    const f = fixture(t); writeFileSync(f.log, 'previous event\n'); success(f.write());
    assert.match(readFileSync(f.log, 'utf8'), /^previous event\n[^\n]+synthetic event\n$/);
  });
  it('does nothing for an empty message', (t) => {
    const f = fixture(t); success(f.write('')); assert.equal(existsSync(f.log), false);
  });
  it('creates a new nested custom directory with spaces', (t) => {
    const f = fixture(t); const log = join(f.runtime, 'new folder', 'inner', 'custom.log');
    f.select(log); success(f.write()); assert.match(readFileSync(log, 'utf8'), /synthetic event/);
    assert.equal(existsSync(f.log), false);
  });
  for (const kind of ['traversal', 'outside', 'file-link', 'parent-link', 'directory']) {
    it(`refuses ${kind} without changing the target`, { skip: !native && kind.includes('link') }, (t) => {
      const f = fixture(t); const target = join(f.state, 'protected'); writeFileSync(target, 'original\n');
      const beforeMode = statSync(f.state).mode & 0o777;
      let path;
      if (kind === 'traversal') path = `${f.runtime}/../state/protected`;
      if (kind === 'outside') path = target;
      if (kind === 'file-link') { path = f.log; symlinkSync(target, path); }
      if (kind === 'parent-link') { const dir = join(f.runtime, 'alias'); symlinkSync(f.state, dir); path = join(dir, 'protected'); }
      if (kind === 'directory') { path = join(f.runtime, 'directory'); mkdirSync(path); }
      if (kind === 'traversal') f.setValues({ 'sheepfold.global.log_cache_path': `${f.shellPath(f.runtime)}/../state/protected` });
      else f.select(path);
      const r = f.write(); assert.equal(readFileSync(target, 'utf8'), 'original\n'); failure(r);
      if (native) assert.equal(statSync(f.state).mode & 0o777, beforeMode);
      if (kind === 'outside') assert.equal(existsSync(f.log), false);
    });
  }
  it('rejects a substituted runtime root before touching its lock', { skip: !native }, (t) => {
    const f = fixture(t); renameSync(f.runtime, join(f.root, 'old-runtime')); symlinkSync(f.state, f.runtime);
    const lock = join(f.state, 'log-maintenance.flock'); writeFileSync(lock, 'sentinel\n');
    failure(f.write()); assert.equal(readFileSync(lock, 'utf8'), 'sentinel\n');
    assert.equal(existsSync(join(f.state, 'events.log')), false);
  });
  for (const part of ['.', '..', '', 'last/']) {
    it(`rejects an invalid path component ${JSON.stringify(part)}`, (t) => {
      const f = fixture(t); f.setValues({ 'sheepfold.global.log_cache_path': `${f.shellPath(f.runtime)}/${part}/events.log` }); failure(f.write());
      assert.equal(existsSync(f.log), false);
    });
  }
  for (const configFails of [false, true]) {
    it(`does not fall back after UCI failure (${configFails ? 'whole config' : 'key only'})`, (t) => {
      const f = fixture(t); const custom = join(f.runtime, 'custom.log');
      writeFileSync(f.log, 'default\n'); writeFileSync(custom, 'custom\n'); f.select(custom);
      renameSync(join(f.bin, 'uci'), join(f.bin, 'uci-real'));
      f.put('uci', `#!/bin/sh
if [ "$*" = '-q get sheepfold.global.log_cache_path' ]${configFails ? ' || [ "$*" = \'-q show sheepfold\' ]' : ''}; then
printf 'uci-fault\\n' >> ${quote(f.shellPath(f.tracePath))}; exit 9; fi
exec ${quote(f.shellPath(join(f.bin, 'uci-real')))} "$@"
`);
      const r = f.write(); assert.match(f.trace(), /uci-fault/); failure(r);
      assert.equal(readFileSync(f.log, 'utf8'), 'default\n'); assert.equal(readFileSync(custom, 'utf8'), 'custom\n');
    });
  }
});

describe('Writer confirms the primary record', () => {
  it('creates a private journal from the first write', { skip: !native }, (t) => {
    const f = fixture(t); success(f.write());
    assert.equal(statSync(f.log).mode & 0o777, 0o600); assert.equal(statSync(f.runtime).mode & 0o777, 0o700);
  });
  for (const mode of ['600', '700']) {
    it(`preserves the record on chmod ${mode} failure`, (t) => {
      const f = fixture(t); writeFileSync(f.log, 'before\n');
      const chmod = spawnSync('sh', ['-c', 'command -v chmod'], { encoding: 'utf8' }).stdout.trim();
      f.put('chmod', `#!/bin/sh
if [ "$1" = ${quote(mode)} ]; then printf 'chmod-fault\\n' >> ${quote(f.shellPath(f.tracePath))}; exit 7; fi
exec ${quote(chmod)} "$@"
`);
      const r = f.write(); assert.match(f.trace(), /chmod-fault/); failure(r); assert.equal(readFileSync(f.log, 'utf8'), 'before\n');
    });
  }
  for (const [name, output] of [['tr', 'PARTIAL'], ['cut', 'PARTIAL'], ['date', '10.09.2026 12:00:00']]) {
    it(`discards the plausible output of failed ${name}`, (t) => {
      const f = fixture(t); writeFileSync(f.log, 'before\n'); f.fault(name, `printf '%s' ${quote(output)}; exit 7`);
      const r = f.write(); assert.match(f.trace(), new RegExp(`${name}-fault`)); failure(r);
      assert.equal(readFileSync(f.log, 'utf8'), 'before\n');
    });
  }
  it('refuses an unavailable flock before writing', { skip: !native }, (t) => {
    const f = fixture(t); writeFileSync(f.log, 'before\n'); f.fault('flock', 'exit 1'); f.put('sleep', '#!/bin/sh\nexit 0\n');
    const r = f.write(); assert.match(f.trace(), /flock-fault/); failure(r); assert.equal(readFileSync(f.log, 'utf8'), 'before\n');
  });
  it('reports a real kernel write refusal instead of a successful USB no-op', { skip: !native }, (t) => {
    const f = fixture(t); writeFileSync(f.log, '');
    const r = spawnSync('sh', ['-c', 'PATH="$1:$PATH"; export PATH; trap "" XFSZ; ulimit -f 0; exec sh "$2" event', 'writer-limit', f.bin, join(f.bin, 'sheepfold-log')],
      { encoding: 'utf8', timeout: 10000 });
    assert.match(r.stderr, /File too large|I\/O error/i, 'kernel refusal was not reached');
    failure(r); assert.equal(readFileSync(f.log, 'utf8'), '');
  });
  it('isolates noisy syslog output', (t) => {
    const f = fixture(t); f.put('logger', '#!/bin/sh\nprintf "not a reply\\n"\nexit 0\n'); success(f.write());
  });
  it('does not undo the RAM result if syslog is unavailable', (t) => {
    const f = fixture(t); f.fault('logger', 'exit 7'); success(f.write()); assert.match(f.trace(), /logger-fault/);
    assert.match(readFileSync(f.log, 'utf8'), /synthetic event/);
  });
});

function cloudFixture(t, backend, holdParent = false) {
  const f = fixture(t, { 'sheepfold.global.log_storage': backend });
  const started = join(f.root, 'cloud-started'), release = join(f.root, 'cloud-release');
  const parentExit = join(f.root, 'parent-exit');
  const parentRelease = join(f.root, 'parent-release');
  const name = backend === 'yandex_disk' ? 'sheepfold-yandex-disk' : 'sheepfold-google-drive';
  f.put(name, `#!/bin/sh
printf 'started\\n' > ${quote(f.shellPath(started))}
n=0
while [ ! -e ${quote(f.shellPath(release))} ] && [ "$n" -lt 250 ]; do n=$((n+1)); sleep 0.02; done
exit 0
`);
  const parentLock = join(f.root, 'parent.lock');
  const child = spawn('sh', ['-c', `PATH=${quote(f.bin)}:$PATH; export PATH
exec 9>${quote(parentLock)}; flock -x 9
sh ${quote(join(f.bin, 'sheepfold-log'))} event
rc=$?
printf 'parent-returned\\n' > ${quote(parentExit)}
${holdParent ? `n=0; while [ ! -e ${quote(parentRelease)} ] && [ "$n" -lt 250 ]; do n=$((n+1)); sleep 0.02; done` : ''}
exit "$rc"`], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(); let stdout = '', stderr = '', closed = false, exited = false;
  child.stdout.on('data', (x) => { stdout += x; }); child.stderr.on('data', (x) => { stderr += x; });
  child.once('exit', () => { exited = true; });
  const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (status) => { closed = true; resolve({ status, stdout, stderr }); }); });
  return { ...f, started, release, parentLock, parentExit, parentRelease, child, done, closed: () => closed, exited: () => exited };
}

describe('Cloud copies do not own the parent request', () => {
  for (const backend of ['yandex_disk', 'google_drive']) {
    it(`${backend} releases the response pipe while its transport is waiting`, { skip: !native }, async (t) => {
      const f = cloudFixture(t, backend);
      try {
        await until(() => existsSync(f.started) && f.exited(), 'writer/cloud did not start and return');
        await until(f.closed, 'cloud retained stdout/stderr after the parent exited');
        success(await f.done);
      } finally { writeFileSync(f.release, ''); await f.done; await delay(100); }
    });
    it(`${backend} does not retain an inherited parent lock`, { skip: !native }, async (t) => {
      const f = cloudFixture(t, backend);
      try {
        await until(() => existsSync(f.started) && f.exited(), 'writer/cloud did not start and return');
        const r = spawnSync('flock', ['-n', f.parentLock, 'true'], { encoding: 'utf8' });
        assert.equal(r.status, 0, 'cloud retained the parent FD 9 lock');
        assert.match(readFileSync(f.log, 'utf8'), /event/);
      } finally { writeFileSync(f.release, ''); await f.done; await delay(100); }
    });
    it(`${backend} closes its copy without unlocking a live parent`, { skip: !native }, async (t) => {
      const f = cloudFixture(t, backend, true);
      try {
        await until(() => existsSync(f.started) && existsSync(f.parentExit), 'cloud/parent did not reach the barrier');
        assert.equal(spawnSync('flock', ['-n', f.parentLock, 'true']).status, 1, 'background released the live parent lock');
        writeFileSync(f.parentRelease, '');
        await until(f.exited, 'parent did not exit');
        assert.equal(spawnSync('flock', ['-n', f.parentLock, 'true']).status, 0, 'background retained the lock after parent exit');
      } finally { writeFileSync(f.parentRelease, ''); writeFileSync(f.release, ''); await f.done; await delay(100); }
    });
    it(`${backend} keeps the RAM result if scheduling cannot write its flag`, (t) => {
      const f = fixture(t, { 'sheepfold.global.log_storage': backend });
      const name = backend === 'yandex_disk' ? 'sheepfold-yandex-disk' : 'sheepfold-google-drive';
      f.put(name, '#!/bin/sh\nexit 0\n');
      mkdirSync(join(f.runtime, backend === 'yandex_disk' ? '.yandex-push.scheduled' : '.google-push.scheduled'));
      success(f.write()); assert.match(readFileSync(f.log, 'utf8'), /synthetic event/);
    });
  }
});
