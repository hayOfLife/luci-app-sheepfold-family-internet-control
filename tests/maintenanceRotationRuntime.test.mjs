/*
 * Настоящий rotator в закрытой .build-папке. Отказы должны оставить trace;
 * ссылки, права и flock проверяются только на Linux. Никаких системных UCI,
 * роутера, облака или реального журнала. Сравнение baseline меняет только
 * исходник maintenance, не assertions и не файловую модель. §maintjob1 §logio1
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runtimeTimeout, completedProcess, prepareFixtureFlock } from './helpers/runtimeProcess.mjs';
import { shellTestPath } from '../tools/quality/testEnvironment.mjs';

const repo = resolve(import.meta.dirname, '..');
const runtime = join(repo, 'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold');
const native = process.platform === 'linux';
const q = (v) => `'${String(v).replaceAll("'", "'\\''")}'`;
const recent = '10.09.2026 12:00:00\tСемья 🦊 recent\n';
const old = '01.01.2026 12:00:00\told\n';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, message) {
  for (let i = 0; i < 300; i++) { if (check()) return; await delay(10); }
  assert.fail(message);
}
function fixture(t) {
  const parent = join(repo, '.build', 'rotation-fixtures'); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'case-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'), ram = join(root, 'ram'), state = join(root, 'state');
  for (const p of [bin, ram, state]) mkdirSync(p);
  const path = (p) => shellTestPath(p, { cwd: repo, allowedRoot: root });
  const put = (name, source) => { writeFileSync(join(bin, name), source); chmodSync(join(bin, name), 0o755); };
  const sourceRoot = process.env.SHEEPFOLD_ROTATION_TEST_SOURCE || runtime;
  for (const name of ['sheepfold-maintenance', 'sheepfold-log-common', 'sheepfold-lock-common']) {
    const source = name === 'sheepfold-maintenance' ? sourceRoot : runtime;
    put(name, readFileSync(join(source, name), 'utf8')
      .replaceAll('/usr/libexec/sheepfold', path(bin)).replaceAll('/tmp/sheepfold', path(ram)));
  }
  const traceFile = join(root, 'trace'); writeFileSync(traceFile, '');
  const config = join(root, 'values');
  const log = join(ram, 'events.log'); writeFileSync(log, old + recent);
  const settings = { 'sheepfold.global.log_cache_path': path(log), 'sheepfold.global.log_retention': '3d', 'sheepfold.global.log_max_size_kb': '64' };
  function configure(extra = {}) {
    Object.assign(settings, extra);
    const cases = Object.entries(settings).filter(([, v]) => v !== null).map(([k, v]) => `${q(k)}) printf '%s\\n' ${q(v)} ;;`).join('\n');
    const lines = Object.entries(settings).filter(([, v]) => v !== null).map(([k, v]) => `${k}=${v}`).join('\n');
    writeFileSync(config, lines);
    put('uci', `#!/bin/sh\n[ "\${1:-}" != -q ] || shift\ncase "\${1:-}" in\nget) case "\${2:-}" in\n${cases}\n*) exit 1;; esac;;\nshow) printf '%s\\n' ${q(lines)};;\n*) exit 1;; esac\n`);
  }
  configure();
  prepareFixtureFlock(put);
  put('logger', '#!/bin/sh\nexit 0\n');
  const env = {
    ...process.env, SHEEPFOLD_UCI_BIN: path(join(bin, 'uci')),
    SHEEPFOLD_MAINTENANCE_RUNTIME_DIR: path(join(ram, 'maintenance')),
    SHEEPFOLD_MAINTENANCE_STATE_DIR: path(state), SHEEPFOLD_MAINTENANCE_CONFIG_FILE: path(config),
    SHEEPFOLD_MAINTENANCE_NOW_EPOCH: '1789034400', SHEEPFOLD_MAINTENANCE_TODAY: '2026-09-10',
    SHEEPFOLD_MAINTENANCE_DEFAULT_LOG: path(log),
  };
  const command = process.platform === 'win32' ? 'bash' : 'sh';
  const args = ['-c', 'PATH="$1:$PATH"; export PATH; shift; exec sh "$@"', 'rotation-fixture', path(bin), path(join(bin, 'sheepfold-maintenance')), 'rotate-log'];
  const run = (extra = {}, task = 'rotate-log') => completedProcess(spawnSync(command, [...args.slice(0, -1), task], { cwd: repo, env: { ...env, ...extra }, encoding: 'utf8', timeout: runtimeTimeout(15000) }), 'rotation fixture');
  const fault = (name, predicate, body = 'exit 7') => {
    const real = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
    assert.ok(real, `missing host ${name}`);
    put(name, `#!/bin/sh\nif ${predicate}; then printf '${name}-fault\\n' >> ${q(path(traceFile))}; ${body}; fi\nexec ${q(real)} "$@"\n`);
  };
  return { root, bin, ram, state, log, path, env, args, command, configure, settings, put, fault, run,
    trace: () => readFileSync(traceFile, 'utf8'), text: () => readFileSync(log, 'utf8'),
    status: () => readFileSync(join(ram, 'maintenance', 'log-rotation.state'), 'utf8'),
    leftovers: () => readdirSync(ram).filter((s) => /\.(?:source|bounded|age|tail|new)\.|\.rotate-/.test(s)),
  };
}
function ok(r) { assert.ifError(r.error); assert.equal(r.status, 0, r.stderr); }
function failed(r) { assert.ifError(r.error); assert.notEqual(r.status, 0, `false success: ${r.stdout} ${r.stderr}`); }

describe('Rotation file ownership and configuration', () => {
  it('retains recent UTF-8 lines and drops old dates', (t) => {
    const f = fixture(t); ok(f.run()); assert.equal(f.text(), recent); assert.match(f.status(), /last_result=ok/);
  });
  it('supports a nested ordinary path with spaces', (t) => {
    const f = fixture(t), file = join(f.ram, 'with spaces', 'custom.log'); mkdirSync(join(f.ram, 'with spaces'));
    writeFileSync(file, old + recent); f.configure({ 'sheepfold.global.log_cache_path': f.path(file) });
    ok(f.run()); assert.equal(readFileSync(file, 'utf8'), recent); assert.equal(f.text(), old + recent);
  });
  it('accepts an absent log and missing optional settings', (t) => {
    const f = fixture(t); rmSync(f.log); f.configure({ 'sheepfold.global.log_cache_path': null, 'sheepfold.global.log_retention': null, 'sheepfold.global.log_max_size_kb': null });
    ok(f.run()); assert.equal(f.text(), '');
  });
  for (const kind of ['traversal', 'outside', 'file-link', 'parent-link', 'directory']) {
    it(`rejects ${kind} without modifying another file or the default`, { skip: !native && kind.includes('link') }, (t) => {
      const f = fixture(t); const target = join(f.state, 'protected'); writeFileSync(target, old + recent); chmodSync(target, 0o640);
      let file;
      if (kind === 'traversal') file = `${f.path(f.ram)}/../state/protected`;
      if (kind === 'outside') file = f.path(target);
      if (kind === 'file-link') { file = join(f.ram, 'alias'); symlinkSync(target, file); file = f.path(file); }
      if (kind === 'parent-link') { const alias = join(f.ram, 'alias'); symlinkSync(f.state, alias); file = `${f.path(alias)}/protected`; }
      if (kind === 'directory') { file = join(f.ram, 'not-a-file'); mkdirSync(file); file = f.path(file); }
      f.configure({ 'sheepfold.global.log_cache_path': file });
      const r = f.run(); assert.equal(readFileSync(target, 'utf8'), old + recent); assert.equal(f.text(), old + recent); failed(r);
      if (native) assert.equal(statSync(target).mode & 0o777, 0o640);
    });
  }
  for (const key of ['log_cache_path', 'log_retention', 'log_max_size_kb']) {
    it(`refuses a failed UCI ${key} read instead of applying defaults`, (t) => {
      const f = fixture(t); const real = join(f.bin, 'uci-real'); writeFileSync(real, readFileSync(join(f.bin, 'uci'))); chmodSync(real, 0o755);
      f.put('uci', `#!/bin/sh\nif [ "$*" = '-q get sheepfold.global.${key}' ]; then printf 'uci-fault\\n' >> ${q(f.path(join(f.root, 'trace')))}; exit 7; fi\nexec ${q(f.path(real))} "$@"\n`);
      const r = f.run(); assert.match(f.trace(), /uci-fault/); assert.equal(f.text(), old + recent); failed(r);
    });
  }
});

describe('Rotation preserves the original on processing and publication failure', () => {
  for (const step of ['source-copy', 'partial-copy', 'age-filter', 'final-copy', 'wc', 'publish', 'chmod', 'workspace']) {
    it(`does not replace the journal after ${step} failure`, (t) => {
      const f = fixture(t); let command;
      if (step === 'source-copy' || step === 'partial-copy') {
        command = 'cp'; f.fault(command, `[ "\${1:-}" = ${q(f.path(f.log))} ]`, step === 'partial-copy' ? `printf 'partial\\n' > "$2"; exit 7` : 'exit 7');
      }
      if (step === 'age-filter') { command = 'awk'; f.fault(command, `case "$*" in *civil_days*) true;; *) false;; esac`, `printf '10.09.2026 12:00:00\\tpartial\\n'; exit 7`); }
      if (step === 'final-copy') { command = 'cp'; f.fault(command, `case "$1" in *.age.*|*/age) true;; *) false;; esac`); }
      if (step === 'wc') { command = 'wc'; f.fault(command, 'true', `printf '0\\n'; exit 7`); }
      if (step === 'publish') { command = 'mv'; f.fault(command, `[ "\${3:-}" = ${q(f.path(f.log))} ] || [ "\${2:-}" = ${q(f.path(f.log))} ]`); }
      if (step === 'chmod') { command = 'chmod'; f.fault(command, '[ "$1" = 600 ]'); }
      if (step === 'workspace') { command = 'mktemp'; f.fault(command, 'true'); }
      const r = f.run(); assert.match(f.trace(), new RegExp(`${command}-fault`), 'the failure must be reached');
      assert.equal(f.text(), old + recent, 'the original must survive'); failed(r); assert.match(f.status(), /last_result=failed/); assert.deepEqual(f.leftovers(), []);
    });
  }
  for (const step of ['source-copy', 'age-filter', 'publish']) {
    it(`periodic run records ${step} failure without replacing the original`, (t) => {
      const f = fixture(t); f.configure({ 'sheepfold.global.update_check_install_mode': 'never' });
      if (step === 'source-copy') f.fault('cp', `[ "$1" = ${q(f.path(f.log))} ]`, `printf partial > "$2"; exit 7`);
      if (step === 'age-filter') f.fault('awk', `case "$*" in *civil_days*) true;; *) false;; esac`, `printf '10.09.2026 12:00:00\\tpartial\\n'; exit 7`);
      if (step === 'publish') f.fault('mv', `[ "\${3:-}" = ${q(f.path(f.log))} ] || [ "\${2:-}" = ${q(f.path(f.log))} ]`);
      const r = f.run({}, 'force'); assert.ifError(r.error);
      assert.notEqual(f.trace(), '', 'the failure must be reached'); assert.equal(f.text(), old + recent);
      assert.match(f.status(), /last_result=failed/); assert.deepEqual(f.leftovers(), []);
    });
  }
  it('preserves the original when the bounded tail fails', (t) => {
    const f = fixture(t); const input = old + recent.repeat(5000); writeFileSync(f.log, input);
    f.fault('tail', 'true', `printf partial; exit 7`); const r = f.run(); assert.match(f.trace(), /tail-fault/); failed(r); assert.equal(f.text(), input);
  });
  it('creates private temporary files even under permissive umask', { skip: !native }, (t) => {
    const f = fixture(t); const captured = join(f.root, 'mode');
    const cp = spawnSync('sh', ['-c', 'command -v cp'], { encoding: 'utf8' }).stdout.trim();
    f.put('cp', `#!/bin/sh\n${q(cp)} "$@" || exit $?\nif [ "$1" = ${q(f.path(f.log))} ]; then stat -c '%a' "$2" > ${q(f.path(captured))}; fi\n`);
    ok(f.run()); assert.equal(readFileSync(captured, 'utf8').trim(), '600'); assert.equal(statSync(f.log).mode & 0o777, 0o600);
  });
  it('does not clean an unowned path printed by failed mktemp', (t) => {
    const f = fixture(t), saved = join(f.ram, '.rotate-saved'); mkdirSync(saved); writeFileSync(join(saved, 'recovery'), 'keep');
    f.fault('mktemp', 'true', `printf '%s\\n' ${q(f.path(saved))}; exit 7`);
    const r = f.run(); assert.match(f.trace(), /mktemp-fault/); failed(r);
    assert.equal(readFileSync(join(saved, 'recovery'), 'utf8'), 'keep'); assert.equal(f.text(), old + recent);
  });
  it('protects the filter output from the moment it is opened', { skip: !native }, (t) => {
    const f = fixture(t), captured = join(f.root, 'filter-mode');
    const awk = spawnSync('sh', ['-c', 'command -v awk'], { encoding: 'utf8' }).stdout.trim();
    f.put('awk', `#!/bin/sh\ncase "$*" in *civil_days*) stat -Lc '%a' /proc/$$/fd/1 > ${q(f.path(captured))};; esac\nexec ${q(awk)} "$@"\n`);
    ok(f.run()); assert.equal(readFileSync(captured, 'utf8').trim(), '600');
  });
  it('cleans up its own workspace after successful rotation', (t) => {
    const f = fixture(t); ok(f.run()); assert.deepEqual(f.leftovers(), []);
  });
});

describe('Rotation keeps every complete line within the byte budget', () => {
  it('keeps the first full line when the retained suffix begins at a line boundary', (t) => {
    const f = fixture(t); const line = '10.09.2026 12:00:00\t' + 'x'.repeat(491) + '\n';
    assert.equal(Buffer.byteLength(line), 512); const expected = line.repeat(128);
    writeFileSync(f.log, 'prefix that exceeds budget\n' + expected); ok(f.run()); assert.equal(f.text(), expected);
  });
  it('drops only the partial first line when the byte limit cuts through a UTF-8 line', (t) => {
    const f = fixture(t); const line = recent; const expected = line.repeat(Math.floor(65536 / Buffer.byteLength(line)));
    writeFileSync(f.log, 'x'.repeat(4096) + '\n' + expected); ok(f.run()); assert.equal(f.text(), expected);
  });
  it('keeps a journal already exactly at the byte budget', (t) => {
    const f = fixture(t); const line = 'x'.repeat(511) + '\n', input = line.repeat(128); writeFileSync(f.log, input);
    ok(f.run()); assert.equal(f.text(), input);
  });
  it('does not drop a full line from the initial bounded input tail', (t) => {
    const f = fixture(t); const keep = recent;
    const expired = '01.01.2026 12:00:00\t' + 'x'.repeat(131072 - Buffer.byteLength(keep) - 21) + '\n';
    assert.equal(Buffer.byteLength(expired + keep), 131072);
    const input = 'extra prefix\n' + keep + expired; writeFileSync(f.log, input);
    ok(f.run()); assert.equal(f.text(), keep);
  });
  it('preserves malformed and legacy lines when the calendar clock is untrusted', (t) => {
    const f = fixture(t); const input = old + 'legacy line\n' + recent; writeFileSync(f.log, input);
    ok(f.run({ SHEEPFOLD_MAINTENANCE_TODAY: '1970-01-01' })); assert.equal(f.text(), input);
  });
  it('normalizes the byte limit as decimal instead of octal', (t) => {
    const f = fixture(t); const input = ('x'.repeat(511) + '\n').repeat(120); writeFileSync(f.log, input);
    f.configure({ 'sheepfold.global.log_max_size_kb': '00064' }); ok(f.run()); assert.equal(f.text(), input);
  });
});

describe('Rotation coordinates with the existing journal lock', () => {
  it('waits for the real lock before changing the journal', { skip: !native }, async (t) => {
    const f = fixture(t), started = join(f.root, 'locked'), release = join(f.root, 'release');
    const lock = join(f.ram, 'log-maintenance.flock');
    const holder = spawn('sh', ['-c', `exec 9>${q(lock)}; flock -x 9; touch ${q(started)}; n=0; while [ ! -e ${q(release)} ] && [ "$n" -lt 400 ]; do n=$((n+1)); sleep 0.01; done`]);
    const holderDone = new Promise((r) => holder.on('close', r));
    let worker;
    try {
      await until(() => existsSync(started), 'holder did not lock');
      f.fault('flock', 'true', `touch ${q(f.path(join(f.root, 'lock-attempt')))}; exec /usr/bin/flock "$@"`);
      worker = spawn(f.command, f.args, { cwd: repo, env: f.env, stdio: ['ignore', 'pipe', 'pipe'] });
      let closed = false; const done = new Promise((r) => worker.on('close', (status) => { closed = true; r(status); }));
      await until(() => existsSync(join(f.root, 'lock-attempt')), 'rotation did not attempt lock');
      await delay(100); assert.equal(closed, false); assert.equal(f.text(), old + recent);
      writeFileSync(release, ''); assert.equal(await done, 0); assert.equal(f.text(), recent);
    } finally { writeFileSync(release, ''); if (worker && worker.exitCode === null) worker.kill(); await holderDone; }
  });
});
