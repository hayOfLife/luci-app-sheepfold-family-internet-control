/*
 * Проверяет сохранность RAM-очереди просьб при отказе reader/часов/публикации и
 * параллельных create/list. Реальные shell/CGI, модельные UCI/IP и часы. Fault-tool
 * обязан оставить trace; конкурентные тесты используют явные барьеры, не sleep
 * в надежде попасть в гонку. Меняется только удаляемый fixture в .build.
 * Linux flock/права/ссылки не эмулируются на Windows; live uhttpd не проверяется.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequestFixture, requestNow, requestIp } from './helpers/childAccessRequestFixture.mjs';
import { parseCgi } from './helpers/routerRuntimeFixture.mjs';

const posixOnly = { skip: process.platform !== 'linux' ? 'Requires native Linux flock and filesystem semantics' : false };
function fixtureTest(body) {
  const f = createRequestFixture();
  try { return body(f); } finally { f.close(); }
}
const createEnv = { REQUEST_METHOD: 'POST', PATH_INFO: '/access-request' };
const response = (f, extra = {}) => parseCgi(f.request(extra));
const keepRecord = (f, path, text) => { assert.ok(existsSync(path)); assert.equal(f.text(path), text); };
function readerFault(f, output = '') {
  // Старый reader — sed; новый должен читать файл целиком, поэтому охвачены оба.
  for (const tool of ['sed', 'awk']) f.put(tool, `#!/bin/sh
case "$*" in *.request*) printf 'read-fault ${tool}\\n' >> "$TEST_REQUEST_ACTIONS"; printf '%s' '${output}'; exit 7 ;; esac
exec /usr/bin/${tool} "$@"
`);
}

describe('Request queue preserves records when verification fails', () => {
  for (const mode of ['list', 'create']) {
    it(`does not delete a valid record on reader failure: ${mode}`, posixOnly, () => fixtureTest((f) => {
      f.stubId(); const path = f.seed(), before = f.text(path); readerFault(f);
      const result = response(f, mode === 'create' ? createEnv : {});
      assert.match(f.traces(), /read-fault/); assert.equal(result.status, 503);
      keepRecord(f, path, before); assert.equal(f.records().length, 1);
    }));
  }
  it('recovers the same request after a transient read failure', posixOnly, () => fixtureTest((f) => {
    const path = f.seed(), before = f.text(path); readerFault(f);
    assert.equal(response(f).status, 503); assert.match(f.traces(), /read-fault/);
    for (const tool of ['sed', 'awk']) rmSync(join(f.bin, tool));
    const result = response(f); assert.equal(result.status, 200); assert.equal(result.body.requests.length, 1);
    keepRecord(f, path, before);
  }));
  it('rejects partial reader output even when it looks like a complete record', posixOnly, () => fixtureTest((f) => {
    const path = f.seed(), before = f.text(path); readerFault(f, before);
    const result = response(f); assert.match(f.traces(), /read-fault/); assert.equal(result.status, 503);
    keepRecord(f, path, before);
  }));
  for (const [label, mutate] of [
    ['missing time', (text) => text.replace(/^created_at=.*\n/m, '')],
    ['duplicate time', (text) => text + `created_at=${requestNow - 90000}\n`],
    ['duplicate device ID', (text) => text + 'device_id=999\n'],
    ['missing request ID', (text) => text.replace(/^id=.*\n/m, '')],
    ['non-numeric time', (text) => text.replace(`created_at=${requestNow}`, 'created_at=broken')],
    ['oversized time', (text) => text.replace(`created_at=${requestNow}`, 'created_at=9999999999999999999999999999')],
  ]) {
    it(`reports ${label} without silently removing the record`, () => fixtureTest((f) => {
      const path = f.seed(); writeFileSync(path, mutate(f.text(path))); const before = f.text(path);
      const result = response(f); assert.equal(result.status, 503); keepRecord(f, path, before);
      assert.equal(result.body.requests, undefined);
    }));
  }
  it('discards the entire HTTP list if a later verified read fails', posixOnly, () => fixtureTest((f) => {
    const first = f.seed({}, 'a.request'), second = f.seed({ device_id: '43' }, 'b.request');
    const before = [f.text(first), f.text(second)];
    for (const tool of ['sed', 'awk']) f.put(tool, `#!/bin/sh
case "$*" in *.request*)
  count=0; [ ! -f "$TEST_REQUEST_ACTIONS.count" ] || read -r count < "$TEST_REQUEST_ACTIONS.count"
  count=$((count + 1)); printf '%s\\n' "$count" > "$TEST_REQUEST_ACTIONS.count"
  if [ "$count" = 4 ]; then printf 'late-read-fault\\n' >> "$TEST_REQUEST_ACTIONS"; exit 7; fi
;; esac
exec /usr/bin/${tool} "$@"
`);
    const result = response(f); assert.match(f.traces(), /late-read-fault/);
    assert.equal(result.status, 503); assert.equal(result.body.requests, undefined);
    keepRecord(f, first, before[0]); keepRecord(f, second, before[1]);
  }));
  it('normalizes leading zeros before age arithmetic and JSON output', () => fixtureTest((f) => {
    f.seed({ created_at: `00${requestNow}` }); const result = response(f);
    assert.equal(result.status, 200); assert.equal(result.body.requests[0].createdAt, requestNow);
  }));
  it('accepts a record whose final line has no newline', () => fixtureTest((f) => {
    const path = f.seed(); writeFileSync(path, f.text(path).trimEnd());
    assert.equal(response(f).body.requests[0].deviceId, '42');
  }));
  for (const output of ['broken', '9999999999999999999999999']) {
    it(`does not prune or publish with invalid successful date output: ${output}`, () => fixtureTest((f) => {
      const path = f.seed(), before = f.text(path);
      f.put('date', `#!/bin/sh\nprintf 'clock-fault\\n' >> "$TEST_REQUEST_ACTIONS"\nprintf '%s\\n' '${output}'\n`);
      const result = response(f); assert.match(f.traces(), /clock-fault/); assert.equal(result.status, 503);
      keepRecord(f, path, before);
    }));
  }
  it('does not use plausible clock output when date reports failure', () => fixtureTest((f) => {
    const path = f.seed(), before = f.text(path);
    f.put('date', `#!/bin/sh\nprintf 'clock-fault\\n' >> "$TEST_REQUEST_ACTIONS"\nprintf '${requestNow}\\n'\nexit 7\n`);
    assert.equal(response(f).status, 503); assert.match(f.traces(), /clock-fault/); keepRecord(f, path, before);
  }));
  it('retains the exact one-day boundary and removes only known-expired records', () => fixtureTest((f) => {
    f.seed({ created_at: requestNow - 86401 }, 'old.request');
    f.seed({ created_at: requestNow - 86400 }, 'boundary.request');
    const result = response(f); assert.equal(result.status, 200); assert.equal(result.body.requests.length, 1);
    assert.deepEqual(f.records(), ['boundary.request']);
  }));
  it('refuses a request symlink without reading or changing the target', posixOnly, () => fixtureTest((f) => {
    const path = f.seed(), text = f.text(path); const target = join(f.root, 'outside');
    writeFileSync(target, text); rmSync(path); symlinkSync(target, path);
    assert.equal(response(f).status, 503); assert.equal(readFileSync(target, 'utf8'), text);
  }));
});

describe('Request queue publication owns its temporary files and permissions', () => {
  it('creates a private directory even when list is the first operation', posixOnly, () => fixtureTest((f) => {
    rmSync(f.queue, { recursive: true }); assert.equal(response(f).status, 200);
    assert.equal(statSync(f.queue).mode & 0o777, 0o700);
  }));
  for (const mode of ['list', 'create']) {
    it(`refuses a queue chmod failure before reading or publishing: ${mode}`, posixOnly, () => fixtureTest((f) => {
      f.stubId(); const path = f.seed(), before = f.text(path);
      f.put('chmod', '#!/bin/sh\nprintf "chmod-fault\\n" >> "$TEST_REQUEST_ACTIONS"\nexit 7\n');
      const result = response(f, mode === 'create' ? createEnv : {});
      assert.match(f.traces(), /chmod-fault/); assert.equal(result.status, 503); keepRecord(f, path, before);
    }));
  }
  it('cleans only its own temporary file after a failed publish', posixOnly, () => fixtureTest((f) => {
    f.stubId(); const foreign = join(f.queue, '.previous-temporary'); writeFileSync(foreign, 'do not remove');
    f.put('mv', '#!/bin/sh\nprintf "publish-fault\\n" >> "$TEST_REQUEST_ACTIONS"\nexit 7\n');
    assert.equal(response(f, createEnv).status, 500); assert.match(f.traces(), /publish-fault/);
    assert.equal(f.records().length, 0);
    assert.deepEqual(readdirSync(f.queue).filter((name) => name !== '.queue.lock'), ['.previous-temporary']);
    assert.equal(readFileSync(foreign, 'utf8'), 'do not remove');
  }));
  it('does not publish when chmod on the prepared record fails', posixOnly, () => fixtureTest((f) => {
    f.stubId(); f.put('chmod', `#!/bin/sh
case "$1" in 600) printf 'file-mode-fault\\n' >> "$TEST_REQUEST_ACTIONS"; exit 7 ;; esac
exec /usr/bin/chmod "$@"
`);
    assert.equal(response(f, createEnv).status, 500); assert.match(f.traces(), /file-mode-fault/);
    assert.equal(f.records().length, 0); assert.deepEqual(readdirSync(f.queue).filter((n) => n !== '.queue.lock'), []);
  }));
  it('never owns or deletes output from an unsuccessful mktemp', posixOnly, () => fixtureTest((f) => {
    f.stubId(); const foreign = join(f.queue, '.previous-temporary'); writeFileSync(foreign, 'preserve');
    f.put('mktemp', `#!/bin/sh\nprintf 'mktemp-fault\\n' >> "$TEST_REQUEST_ACTIONS"\nprintf '%s\\n' '${f.pathForShell(foreign)}'\nexit 7\n`);
    const result = response(f, createEnv); assert.match(f.traces(), /mktemp-fault/);
    assert.equal(result.status, 500); assert.equal(readFileSync(foreign, 'utf8'), 'preserve');
    assert.equal(f.records().length, 0);
  }));
  it('does not follow a symlinked queue directory', posixOnly, () => fixtureTest((f) => {
    const outside = join(f.root, 'outside');
    // root already exists; aliasing it must not create request files beside fixtures.
    rmSync(f.queue, { recursive: true }); symlinkSync(f.root, f.queue);
    assert.equal(response(f).status, 503); assert.equal(existsSync(outside), false);
    assert.equal(existsSync(join(f.root, '.queue.lock')), false);
  }));
  it('keeps saved request permissions at 0600', posixOnly, () => fixtureTest((f) => {
    f.stubId(); assert.equal(response(f, createEnv).status, 200);
    assert.equal(statSync(join(f.queue, f.records()[0])).mode & 0o777, 0o600);
  }));
});

function start(f, args, extra = {}) {
  const child = spawn('sh', ['-c', 'PATH="$1:$PATH"; export PATH; shift; exec "$@"', 'request-race',
    f.pathForShell(f.bin), f.pathForShell(join(f.bin, 'sheepfold-access-request')), ...args], {
    cwd: process.cwd(), env: { ...process.env, TEST_REQUEST_ACTIONS: f.pathForShell(f.actions),
      TEST_BARRIER: f.pathForShell(join(f.root, 'release')), ...extra }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', (data) => { stdout += data; }); child.stderr.on('data', (data) => { stderr += data; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
  const done = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, stdout, stderr }); });
  });
  return { child, done };
}
async function until(predicate, label) {
  const deadline = Date.now() + 6000;
  while (!predicate()) { if (Date.now() > deadline) assert.fail(`Barrier not reached: ${label}`); await delay(10); }
}
function traceLocks(f) {
  f.put('flock', '#!/bin/sh\nprintf "lock-%s %s\\n" "${TEST_PROCESS:-none}" "$*" >> "$TEST_REQUEST_ACTIONS"\nexec /usr/bin/flock "$@"\n');
}

describe('Native request queue coordination', posixOnly, () => {
  it('deduplicates two overlapping creates, with one publication and one log event', async () => {
    const f = createRequestFixture(); const tasks = [];
    try {
      f.stubId(); traceLocks(f);
      f.put('mv', `#!/bin/sh
printf 'publish-%s\\n' "$TEST_PROCESS" >> "$TEST_REQUEST_ACTIONS"
if [ "$TEST_PROCESS" = A ]; then
  while [ ! -f "$TEST_BARRIER" ]; do sleep 0.02; done
fi
exec /usr/bin/mv "$@"
`);
      tasks.push(start(f, ['create', requestIp], { TEST_PROCESS: 'A' }));
      await until(() => f.traces().includes('publish-A'), 'first create preparing publication');
      tasks.push(start(f, ['create', requestIp], { TEST_PROCESS: 'B' }));
      await until(() => /publish-B|lock-B -n/.test(f.traces()), 'second create at competing boundary');
      writeFileSync(join(f.root, 'release'), 'go');
      const results = await Promise.all(tasks.map((task) => task.done));
      for (const result of results) assert.equal(result.status, 0, result.stderr);
      const bodies = results.map((result) => JSON.parse(result.stdout));
      assert.deepEqual(bodies.map((body) => body.duplicate).sort(), [false, true]);
      assert.equal(bodies[0].requestId, bodies[1].requestId); assert.equal(f.records().length, 1);
      assert.equal(f.traces().split('\n').filter((line) => line === 'log').length, 1);
    } finally {
      writeFileSync(join(f.root, 'release'), 'go'); tasks.forEach((task) => { task.child.stdin?.end(); task.child.kill('SIGKILL'); });
      await Promise.allSettled(tasks.map((task) => task.done)); f.close();
    }
  });
  it('waits for the same queue lock before list pruning, without unlinking its inode', async () => {
    const f = createRequestFixture(); const tasks = [];
    try {
      f.seed({ created_at: requestNow - 86401 }); traceLocks(f);
      const lock = join(f.queue, '.queue.lock'); writeFileSync(lock, ''); const inode = statSync(lock).ino;
      const holder = spawn('flock', [lock, 'sh', '-c', 'echo ready; read answer'], { stdio: ['pipe', 'pipe', 'pipe'] });
      tasks.push({ child: holder, done: new Promise((res) => holder.once('close', res)) });
      let ready = false; holder.stdout.on('data', () => { ready = true; }); await until(() => ready, 'external lock');
      tasks.push(start(f, ['list', 'TestParent'], { TEST_PROCESS: 'L' }));
      // Old code exits without even trying a lock; do not wait on a nonexistent fault forever.
      let finished = false; tasks[1].done.then(() => { finished = true; });
      await until(() => f.traces().includes('lock-L -n') || finished, 'list contention or old completion');
      assert.match(f.traces(), /lock-L -n/); assert.equal(f.records().length, 1);
      holder.stdin.end('release\n'); const result = await tasks[1].done;
      assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout).requests, []);
      assert.equal(statSync(lock).ino, inode);
    } finally {
      tasks.forEach((task) => { task.child.stdin?.end(); task.child.kill('SIGKILL'); });
      await Promise.allSettled(tasks.map((task) => task.done)); f.close();
    }
  });
  it('returns a temporary failure when the queue lock cannot be acquired', () => fixtureTest((f) => {
    const path = f.seed(), before = f.text(path);
    f.put('flock', '#!/bin/sh\nprintf "flock-fault\\n" >> "$TEST_REQUEST_ACTIONS"\nexit 7\n');
    const result = response(f); assert.match(f.traces(), /flock-fault/); assert.equal(result.status, 503);
    keepRecord(f, path, before);
  }));
});
