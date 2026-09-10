/*
 * Настоящий legacy CGI, временный журнал и подменённая авторизация/UCI.
 * Проверяет HTTP, сохранность файлов и обработанные отказы, не живой роутер.
 * Каждый fault оставляет trace; sh на POSIX не обходит подмены через applets.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRouterFixture, parseCgi } from './helpers/routerRuntimeFixture.mjs';

const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const native = process.platform === 'linux';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function fixture(t) {
  const f = createRouterFixture();
  t.after(() => f.close());
  if (process.env.SHEEPFOLD_LOG_TEST_SOURCE) {
    const src = join(process.env.SHEEPFOLD_LOG_TEST_SOURCE,
      'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-api-legacy');
    writeFileSync(join(f.bin, 'sheepfold-api-legacy'), readFileSync(src, 'utf8')
      .replaceAll('/usr/libexec/sheepfold', f.shellPath(f.bin))
      .replaceAll('/tmp/sheepfold', f.shellPath(f.runtime)));
  }
  const actions = join(f.root, 'fault-trace');
  writeFileSync(actions, '');
  function put(name, body) {
    const path = join(f.bin, name); writeFileSync(path, body); chmodSync(path, 0o755);
  }
  function request(path = '/log', env = {}) {
    return f.run('sheepfold-api-legacy', [], { input: path === '/log/clear' ? 'confirm=1' : '', env: {
      REQUEST_METHOD: path === '/log/clear' ? 'POST' : 'GET', PATH_INFO: path,
      CONTENT_LENGTH: path === '/log/clear' ? '9' : '0', ...env,
    } });
  }
  return { ...f, actions, put, request, log: join(f.runtime, 'events.log'),
    trace: () => readFileSync(actions, 'utf8'),
    fault: (name, body) => put(name, `#!/bin/sh\nprintf '${name}-fault\\n' >> ${quote(f.shellPath(actions))}\n${body}\n`),
    select: (path) => f.setValues({ 'sheepfold.global.log_cache_path': f.shellPath(path) }),
  };
}
function response(result) {
  assert.equal((result.stdout.match(/^Status:/gm) || []).length, 1, result.stdout);
  return parseCgi(result);
}

describe('Administrative log read failures', () => {
  it('returns a real empty journal when no event has been written', (t) => {
    const f = fixture(t); const r = response(f.request());
    assert.equal(r.status, 200); assert.deepEqual(r.body.entries, []);
  });
  it('returns only the requested most recent lines and preserves redaction', (t) => {
    const f = fixture(t);
    writeFileSync(f.log, 'first\nsecond\nparent 192.168.7.20 02:00:00:00:00:11 token=SYNTHETIC\n');
    const r = response(f.request('/log', { QUERY_STRING: 'lines=2' }));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.entries, ['second', 'parent [ip] [mac] token=[secret]']);
  });
  for (const output of ['', 'partial record\n']) {
    it(`discards failed tail output ${JSON.stringify(output)}`, (t) => {
      const f = fixture(t); writeFileSync(f.log, 'preserved\n');
      f.fault('tail', `printf '%s' ${quote(output)}\nexit 7`);
      const result = f.request();
      assert.match(f.trace(), /tail-fault/);
      const r = response(result); assert.equal(r.status, 503); assert.equal(r.body.error, 'log_unavailable');
      assert.equal(readFileSync(f.log, 'utf8'), 'preserved\n');
      assert.doesNotMatch(result.stdout, /partial record/);
    });
  }
  for (const output of ['', 'SYNTHETIC-UNMASKED\n']) {
    it(`discards failed privacy filter output ${JSON.stringify(output)}`, (t) => {
      const f = fixture(t); writeFileSync(f.log, 'private material\n');
      const sed = spawnSync('sh', ['-c', 'command -v sed'], { encoding: 'utf8' }).stdout.trim();
      f.put('sed', `#!/bin/sh
case "$*" in *'[mac]'*) printf 'mask-fault\\n' >> ${quote(f.shellPath(f.actions))}
printf '%s' ${quote(output)}
exit 8 ;; esac
exec ${quote(sed)} "$@"
`);
      const result = f.request(); assert.match(f.trace(), /mask-fault/);
      const r = response(result); assert.equal(r.status, 503); assert.equal(r.body.error, 'log_unavailable');
      assert.doesNotMatch(result.stdout, /SYNTHETIC-UNMASKED/);
    });
  }
  it('rejects a directory masquerading as the journal', (t) => {
    const f = fixture(t); mkdirSync(f.log);
    const r = response(f.request()); assert.equal(r.status, 503);
  });
  for (const lines of ['0', '0002', '1001', '99999999999999999999999']) {
    it(`bounds a decimal line count ${lines}`, (t) => {
      const f = fixture(t); writeFileSync(f.log, Array.from({ length: 1002 }, (_, i) => `event-${i}`).join('\n') + '\n');
      const r = response(f.request('/log', { QUERY_STRING: `lines=${lines}` }));
      assert.equal(r.status, 200);
      assert.equal(r.body.entries.length, lines === '0' ? 0 : lines === '0002' ? 2 : 1000);
    });
  }
});

describe('Log JSON representation', () => {
  for (const [label, line] of [
    ['tab and carriage return', 'first\tsecond\rthird'],
    ['backspace and form feed', 'A\bB\fC'],
    ['other controls', `a\u0001b\u000bc\u001bd\u001fe`],
    ['UTF-8 and quotes', 'Семейный роутер 🦊: "Wi-Fi" \\ сеть'],
  ]) {
    it(`preserves ${label} as valid JSON`, (t) => {
      const f = fixture(t); writeFileSync(f.log, line + '\n');
      const r = response(f.request()); assert.equal(r.status, 200); assert.deepEqual(r.body.entries, [line]);
    });
  }
  it('uses the same escaping in a legacy command error', (t) => {
    const f = fixture(t);
    f.put('sheepfold-router-control', '#!/bin/sh\nprintf "failed\\010operation\\twith\\rcontext\\n"\nexit 1\n');
    const result = f.run('sheepfold-api-legacy', [], { input: 'enable=1&confirm=1', env: {
      REQUEST_METHOD: 'POST', PATH_INFO: '/global-block', CONTENT_LENGTH: '18',
    } });
    const r = response(result); assert.equal(r.status, 500);
    assert.equal(r.body.message, 'failed\boperation\twith\rcontext');
  });
});

describe('Log path boundaries', () => {
  for (const path of ['/log', '/log/clear']) {
    it(`${path} refuses parent traversal and does not touch the target`, (t) => {
      const f = fixture(t); const target = join(f.state, 'protected');
      writeFileSync(target, 'SYNTHETIC-PROTECTED-DATA\n');
      f.select(`${f.runtime}/../state/protected`);
      const result = f.request(path); const r = response(result);
      assert.equal(r.status, path === '/log' ? 503 : 500);
      assert.doesNotMatch(result.stdout, /SYNTHETIC-PROTECTED-DATA/);
      assert.equal(readFileSync(target, 'utf8'), 'SYNTHETIC-PROTECTED-DATA\n');
    });
    for (const parentLink of [false, true]) {
      it(`${path} refuses ${parentLink ? 'directory' : 'file'} symlinks`, { skip: !native }, (t) => {
        const f = fixture(t); const target = join(f.state, 'protected');
        writeFileSync(target, 'SYNTHETIC-PROTECTED-DATA\n');
        const link = join(f.runtime, 'alias');
        symlinkSync(parentLink ? f.state : target, link);
        f.select(parentLink ? join(link, 'protected') : link);
        const result = f.request(path); const r = response(result);
        assert.equal(r.status, path === '/log' ? 503 : 500);
        assert.doesNotMatch(result.stdout, /SYNTHETIC-PROTECTED-DATA/);
        assert.equal(readFileSync(target, 'utf8'), 'SYNTHETIC-PROTECTED-DATA\n');
      });
    }
  }
  it('preserves the default log rather than silently clearing it for an invalid configured path', (t) => {
    const f = fixture(t); writeFileSync(f.log, 'default must survive\n');
    f.select(join(f.state, 'outside-log'));
    const r = response(f.request('/log/clear')); assert.equal(r.status, 500);
    assert.equal(readFileSync(f.log, 'utf8'), 'default must survive\n');
  });
  it('accepts a regular custom journal in a nested directory with spaces', (t) => {
    const f = fixture(t); const dir = join(f.runtime, 'journal folder'); mkdirSync(dir);
    const path = join(dir, 'event records.log'); writeFileSync(path, 'custom\n'); f.select(path);
    assert.deepEqual(response(f.request()).body.entries, ['custom']);
    assert.equal(response(f.request('/log/clear')).status, 200); assert.equal(readFileSync(path, 'utf8'), '');
  });
  it('does not create the journal without explicit confirmation', (t) => {
    const f = fixture(t); const r = response(f.request('/log/clear', { CONTENT_LENGTH: '0' }));
    assert.equal(r.status, 403); assert.equal(existsSync(f.log), false);
  });
});

describe('Log clear ownership and locking', () => {
  it('creates a private empty journal', { skip: !native }, (t) => {
    const f = fixture(t); const r = response(f.request('/log/clear'));
    assert.equal(r.status, 200); assert.equal(statSync(f.log).mode & 0o777, 0o600);
  });
  it('preserves content on a chmod refusal', { skip: !native }, (t) => {
    const f = fixture(t); writeFileSync(f.log, 'do not lose this\n');
    f.fault('chmod', 'exit 9'); const r = response(f.request('/log/clear'));
    assert.match(f.trace(), /chmod-fault/); assert.equal(r.status, 500);
    assert.equal(readFileSync(f.log, 'utf8'), 'do not lose this\n');
  });
  for (const path of ['/log', '/log/clear']) {
    it(`${path} refuses a failed lock without reading or truncating`, { skip: !native }, (t) => {
      const f = fixture(t); writeFileSync(f.log, 'keep\n');
      f.fault('flock', 'exit 1'); f.put('sleep', '#!/bin/sh\nexit 0\n');
      const r = response(f.request(path)); assert.match(f.trace(), /flock-fault/);
      assert.equal(r.status, path === '/log' ? 503 : 500); assert.equal(readFileSync(f.log, 'utf8'), 'keep\n');
    });
  }
  for (const path of ['/log', '/log/clear']) {
    it(`${path} waits on the writer and maintenance lock`, { skip: !native }, async (t) => {
      const f = fixture(t); writeFileSync(f.log, 'before\n');
      const held = join(f.root, 'held'), release = join(f.root, 'release');
      const lock = join(f.runtime, 'log-maintenance.flock');
      const holder = spawn('sh', ['-c', `exec 9>${quote(lock)}; flock -x 9; : >${quote(held)}; while [ ! -e ${quote(release)} ]; do sleep 0.02; done`]);
      t.after(() => holder.kill('SIGKILL'));
      for (let i = 0; i < 200 && !existsSync(held); i++) await delay(10);
      assert.equal(existsSync(held), true, 'real flock holder did not start');
      const flock = spawnSync('sh', ['-c', 'command -v flock'], { encoding: 'utf8' }).stdout.trim();
      f.put('flock', `#!/bin/sh\nprintf 'lock-attempt\\n' >> ${quote(f.shellPath(f.actions))}\nexec ${quote(flock)} "$@"\n`);
      const processEnv = { ...process.env, SHEEPFOLD_AUTHENTICATED_ADMIN_LOGIN: 'synthetic-parent',
        PATH: `${f.bin}:${process.env.PATH}`, PATH_INFO: path, QUERY_STRING: '',
        REQUEST_METHOD: path === '/log' ? 'GET' : 'POST', CONTENT_LENGTH: path === '/log' ? '0' : '9' };
      const child = spawn('sh', [join(f.bin, 'sheepfold-api-legacy')], { env: processEnv });
      t.after(() => child.kill('SIGKILL')); child.stdin.end(path === '/log' ? '' : 'confirm=1');
      let stdout = '', stderr = ''; child.stdout.on('data', (v) => { stdout += v; }); child.stderr.on('data', (v) => { stderr += v; });
      let done = false;
      const result = new Promise((res, rej) => { child.once('error', rej); child.once('close', (status) => { done = true; res({ status, stdout, stderr }); }); });
      for (let i = 0; i < 150 && !f.trace().includes('lock-attempt') && !done; i++) await delay(10);
      assert.match(f.trace(), /lock-attempt/, 'CGI never reached the shared lock');
      assert.equal(done, false, 'response completed while the maintenance lock was held');
      assert.equal(readFileSync(f.log, 'utf8'), 'before\n');
      writeFileSync(f.log, 'after rotation\n'); writeFileSync(release, '');
      const r = response(await result); assert.equal(r.status, 200);
      if (path === '/log') assert.deepEqual(r.body.entries, ['after rotation']);
      else assert.equal(readFileSync(f.log, 'utf8'), '');
    });
  }
});


describe('Log shared callers and root guard', () => {
  for (const path of ['/log', '/log/clear']) {
    it(`${path} rejects a replaced root before touching the lock file`, { skip: !native }, (t) => {
      const f = fixture(t); const displaced = join(f.root, 'original-runtime');
      renameSync(f.runtime, displaced); symlinkSync(f.state, f.runtime);
      const sentinel = join(f.state, 'log-maintenance.flock');
      writeFileSync(sentinel, 'must-not-be-truncated\n');
      const r = response(f.request(path)); assert.equal(r.status, path === '/log' ? 503 : 500);
      assert.equal(readFileSync(sentinel, 'utf8'), 'must-not-be-truncated\n');
    });
  }
  for (const scenario of ['valid', 'traversal', 'read-failure']) {
    it(`checks log context in the optional legacy AI branch: ${scenario}`, (t) => {
      const f = fixture(t); writeFileSync(f.log, 'parent 192.168.7.20 token=SYNTHETIC\n');
      const values = { 'sheepfold.global.deepseek_api_key': 'synthetic-only' };
      if (scenario === 'traversal') {
        writeFileSync(join(f.state, 'sensitive'), 'SYNTHETIC-PROTECTED-DATA\n');
        values['sheepfold.global.log_cache_path'] = `${f.shellPath(f.runtime)}/../state/sensitive`;
      }
      f.setValues(values);
      if (scenario === 'read-failure') f.fault('tail', 'printf "incomplete data\\n"; exit 7');
      const outgoing = join(f.root, 'outgoing');
      // Ни одна реальная сеть не используется: первый доступный transport заменён trace-утилитой.
      f.put('uclient-fetch', `#!/bin/sh\nprintf '%s\\n' "$@" > ${quote(f.shellPath(outgoing))}\nprintf '{"ok":true}\\n'\n`);
      const body = 'provider=deepseek&message=diagnose&includeLogs=1';
      const raw = f.run('sheepfold-api-legacy', [], { input: body, env: {
        REQUEST_METHOD: 'POST', PATH_INFO: '/ai-assistant', CONTENT_LENGTH: String(body.length),
      } });
      const r = response(raw);
      assert.equal(r.status, scenario === 'valid' ? 200 : 503);
      assert.equal(existsSync(outgoing), scenario === 'valid');
      if (scenario === 'valid') {
        const text = readFileSync(outgoing, 'utf8');
        assert.match(text, /parent \[ip\] token=\[secret\]/); assert.doesNotMatch(text, /SYNTHETIC/);
      }
      if (scenario === 'read-failure') assert.match(f.trace(), /tail-fault/);
    });
  }
  for (const [authorization, readFailure, status] of [[false, false, 401], [true, false, 200], [true, true, 503]]) {
    it(`public CGI keeps auth and forwards log status ${status}`, (t) => {
      const f = fixture(t); writeFileSync(f.log, 'public route\n');
      const base = new URL('../package/luci-app-sheepfold-family-internet-control/root/www/cgi-bin/sheepfold-api', import.meta.url);
      f.put('test-log-cgi', readFileSync(base, 'utf8').replaceAll('/usr/libexec/sheepfold', f.shellPath(f.bin)));
      f.put('sheepfold-home-network', '#!/bin/sh\nexit 0\n');
      f.put('sheepfold-api-rate-limit', '#!/bin/sh\nexit 0\n');
      f.put('sheepfold-router-control', '#!/bin/sh\nprintf "login=parent\\ndevice_id=1\\nmac=02:00:00:00:00:01\\n"\n');
      if (readFailure) f.fault('tail', 'exit 7');
      const r = response(f.run('test-log-cgi', [], { env: {
        PATH_INFO: '/log', HTTP_AUTHORIZATION: authorization ? 'Bearer synthetic' : '',
      } }));
      assert.equal(r.status, status);
      if (status === 200) assert.deepEqual(r.body.entries, ['public route']);
      if (readFailure) assert.match(f.trace(), /tail-fault/);
    });
  }
});


describe('Log path lookup failures', () => {
  for (const unreadableConfig of [false, true]) {
    for (const path of ['/log', '/log/clear']) {
      it(`${path} does not substitute the default after ${unreadableConfig ? 'config' : 'configured key'} read failure`, (t) => {
        const f = fixture(t); writeFileSync(f.log, 'default must survive\n');
        const selected = join(f.runtime, 'custom.log'); writeFileSync(selected, 'custom must survive\n');
        if (unreadableConfig) f.setValues({}); else f.select(selected);
        renameSync(join(f.bin, 'uci'), join(f.bin, 'uci-original'));
        f.put('uci', `#!/bin/sh
if [ "$*" = '-q get sheepfold.global.log_cache_path' ]${unreadableConfig ? " || [ \"$*\" = '-q show sheepfold' ]" : ''}; then
  printf 'uci-fault:%s\\n' "$*" >> ${quote(f.shellPath(f.actions))}
  exit 1
fi
exec ${quote(f.shellPath(join(f.bin, 'uci-original')))} "$@"
`);
        const r = response(f.request(path)); assert.match(f.trace(), /uci-fault/);
        if (unreadableConfig) assert.match(f.trace(), /uci-fault:-q show sheepfold/);
        assert.equal(r.status, path === '/log' ? 503 : 500);
        assert.equal(readFileSync(f.log, 'utf8'), 'default must survive\n');
        assert.equal(readFileSync(selected, 'utf8'), 'custom must survive\n');
      });
    }
  }
});
