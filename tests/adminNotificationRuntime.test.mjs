/*
 * Регрессии общей очереди уведомлений: сохранность при отказах, HTTP/JSON,
 * дедупликация и строгий лимит после вставки. Исполняет helper/CGI, а не ищет
 * строки реализации. Fault injection подтверждается trace, конкуренция —
 * барьером с реальным flock. Только .build state; не проверяет uhttpd, flash,
 * отключение питания или получение Telegram/Android на физическом устройстве.
 */
import { describe, it } from 'node:test';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createNotificationFixture, notificationNow } from './helpers/adminNotificationFixture.mjs';
import { parseCgi } from './helpers/routerRuntimeFixture.mjs';
const native = { skip: process.platform !== 'linux' ? 'Requires native Linux utilities, permissions and flock' : false };
function withFixture(body) { const f = createNotificationFixture(); try { return body(f); } finally { f.close(); } }
const response = (f, env = {}) => parseCgi(f.request(env));
const preserved = (f, p, text) => { assert.ok(existsSync(p)); assert.equal(f.text(p), text); };
function fault(f, tool, pattern, before = '') {
  f.put(tool, `#!/bin/sh\ncase "$*" in ${pattern}) printf 'fault-${tool}\\n' >> "$TEST_NOTICE_ACTIONS"; ${before} exit 7 ;; esac\nexec /usr/bin/${tool} "$@"\n`);
}
async function until(check, message) {
  const limit = Date.now() + 7000;
  while (!check()) { assert.ok(Date.now() < limit, message); await delay(15); }
}

describe('Notification list is complete and truthful', () => {
  it('returns a real empty list successfully', () => withFixture((f) => {
    const r = response(f); assert.equal(r.status, 200); assert.deepEqual(r.body.notifications, []);
  }));
  it('keeps events for multiple reads, including a state path with spaces', () => withFixture((f) => {
    const p = f.seed(), before = f.text(p);
    for (let i = 0; i < 2; i++) { const r = response(f); assert.equal(r.status, 200); assert.equal(r.body.notifications.length, 1); }
    preserved(f, p, before);
  }));
  for (const mode of ['missing', 'empty failure', 'partial failure']) {
    it(`does not confirm a helper ${mode} as HTTP 200`, () => withFixture((f) => {
      if (mode === 'missing') rmSync(join(f.bin, 'sheepfold-admin-notification'));
      else f.put('sheepfold-admin-notification', `#!/bin/sh\nprintf 'fault-helper\\n' >> "$TEST_NOTICE_ACTIONS"\n${mode === 'partial failure' ? 'printf \'{"notifications":[\'' : ':'}\nexit 7\n`);
      const r = response(f); assert.equal(r.status, 503); assert.equal(r.body.error, 'notifications_unavailable');
      assert.equal(r.body.notifications, undefined);
      if (mode !== 'missing') assert.match(f.traces(), /fault-helper/);
    }));
  }
  for (const mode of ['list', 'enqueue']) {
    it(`preserves a valid record on actual reader failure: ${mode}`, native, () => withFixture((f) => {
      const p = f.seed(), before = f.text(p);
      for (const tool of ['awk', 'sed']) fault(f, tool, '*.notification*');
      const r = mode === 'list' ? response(f) : f.enqueue();
      assert.match(f.traces(), /fault-(awk|sed)/);
      if (mode === 'list') assert.equal(r.status, 503); else assert.notEqual(r.status, 0);
      preserved(f, p, before); assert.equal(f.records().length, 1);
    }));
  }
  it('recovers the same event when reader becomes available again', native, () => withFixture((f) => {
    const p = f.seed(), before = f.text(p);
    for (const tool of ['awk', 'sed']) fault(f, tool, '*.notification*');
    assert.equal(response(f).status, 503); assert.match(f.traces(), /fault-/);
    for (const tool of ['awk', 'sed']) rmSync(join(f.bin, tool));
    assert.equal(response(f).body.notifications.length, 1); preserved(f, p, before);
  }));
  it('preserves records when directory enumeration fails', native, () => withFixture((f) => {
    const p = f.seed(), before = f.text(p); fault(f, 'ls', '*');
    const r = response(f); assert.match(f.traces(), /fault-ls/); assert.equal(r.status, 503); preserved(f, p, before);
  }));
  it('rejects complete-looking data printed by a failed reader', native, () => withFixture((f) => {
    const p = f.seed(), before = f.text(p);
    for (const tool of ['awk', 'sed']) fault(f, tool, '*.notification*', 'for arg in "$@"; do case "$arg" in *.notification) /bin/cat "$arg" ;; esac; done;');
    assert.equal(response(f).status, 503); assert.match(f.traces(), /fault-/); preserved(f, p, before);
  }));
  for (const [label, mutate] of [
    ['missing time', (s) => s.replace(/^created_at=.*\n/m, '')],
    ['duplicate time', (s) => s + `created_at=${notificationNow - 3000000}\n`],
    ['invalid time', (s) => s.replace(/^created_at=.*$/m, 'created_at=broken')],
    ['oversized time', (s) => s.replace(/^created_at=.*$/m, 'created_at=999999999999999999999999')],
    ['duplicate key', (s) => s + 'dedupe_key=another\n'],
    ['missing message', (s) => s.replace(/^message=.*\n/m, '')],
    ['mismatching ID', (s) => s.replace(/^id=.*$/m, 'id=123-abc')],
  ]) {
    it(`does not delete or accept ${label}`, () => withFixture((f) => {
      const p = f.seed(); writeFileSync(p, mutate(f.text(p))); const before = f.text(p);
      assert.equal(response(f).status, 503); preserved(f, p, before);
    }));
  }
  it('normalizes leading zeros before JSON and arithmetic', () => withFixture((f) => {
    const p = f.seed(); writeFileSync(p, f.text(p).replace(/^created_at=(.*)$/m, 'created_at=000$1'));
    const r = response(f); assert.equal(r.status, 200); assert.equal(r.body.notifications[0].createdAt, notificationNow - 10);
  }));
  for (const clock of ['not-a-clock', '9999999999999999999999']) {
    it(`does not prune after invalid time ${clock}`, () => withFixture((f) => {
      const p = f.seed(), before = f.text(p); const r = response(f, { TEST_NOW: clock });
      assert.equal(r.status, 503); preserved(f, p, before);
    }));
  }
  it('checks the exit status of the clock even after plausible output', native, () => withFixture((f) => {
    const p = f.seed(), before = f.text(p); fault(f, 'date', '*', `printf '${notificationNow}\\n';`);
    assert.equal(response(f).status, 503); assert.match(f.traces(), /fault-date/); preserved(f, p, before);
  }));
  it('escapes supported controls, quotes and backslashes without corrupting UTF-8', () => withFixture((f) => {
    const chars = Array.from({ length: 31 }, (_, i) => String.fromCharCode(i + 1)).filter((s) => !['\n', '\r', '\t'].includes(s)).join('');
    const value = `Русский 🦊 "\\ ${chars}`; f.seed({ type: value, title: value, message: value });
    const r = response(f); assert.equal(r.status, 200);
    for (const key of ['type', 'title', 'message']) assert.equal(r.body.notifications[0][key], value);
  }));
});

describe('Notification storage and retention', () => {
  it('retains the exact TTL boundary and prunes only older records', () => withFixture((f) => {
    const edge = f.seed({ dedupe_key: 'edge', created_at: notificationNow - 2592000 });
    const old = f.seed({ dedupe_key: 'old', created_at: notificationNow - 2592001 });
    const r = response(f); assert.equal(r.status, 200); assert.ok(existsSync(edge)); assert.ok(!existsSync(old));
    assert.equal(r.body.notifications.length, 1);
  }));
  it('keeps exactly 100 records after publishing number 101', () => withFixture((f) => {
    let oldest;
    for (let i = 0; i < 100; i++) { const p = f.seed({ dedupe_key: `key-${i}`, created_at: notificationNow - 1000 + i }); if (!i) oldest = p; }
    const r = f.enqueue(); assert.equal(r.status, 0, r.stderr); const body = JSON.parse(r.stdout);
    assert.equal(body.duplicate, false); assert.equal(f.records().length, 100);
    assert.ok(existsSync(join(f.queue, `${body.id}.notification`))); assert.ok(!existsSync(oldest));
  }));
  it('does not evict a valid old record to make room for a failed publication', native, () => withFixture((f) => {
    for (let i = 0; i < 100; i++) f.seed({ dedupe_key: `key-${i}`, created_at: notificationNow - 1000 + i });
    const before = f.records(); fault(f, 'mv', '*'); const r = f.enqueue();
    assert.notEqual(r.status, 0); assert.match(f.traces(), /fault-mv/); assert.deepEqual(f.records(), before);
    assert.equal(readdirSync(f.queue).filter((s) => s.includes('.tmp.') || s.startsWith('.notification.')).length, 0);
  }));
  it('returns the existing ID without sending another notification', () => withFixture((f) => {
    f.seed({ dedupe_key: 'same' }); const r = f.enqueue('same'); assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).duplicate, true); assert.equal(f.records().length, 1);
    assert.doesNotMatch(f.traces(), /telegram/);
  }));
  for (const tool of ['chmod', 'mktemp', 'mv']) {
    it(`does not confirm publication when ${tool} fails`, native, () => withFixture((f) => {
      if (tool === 'chmod') {
        // Отказывает chmod именно нового события, не более раннего lock-файла.
        f.put('chmod', `#!/bin/sh
mode="$1"; for target in "$@"; do :; done
case "$mode:${'${target##*/}'}" in
  600:.notification.*|600:*.notification.tmp.*) printf 'fault-chmod-file\n' >> "$TEST_NOTICE_ACTIONS"; exit 7 ;;
esac
exec /usr/bin/chmod "$@"
`);
      } else fault(f, tool, '*');
      const r = f.enqueue();
      assert.notEqual(r.status, 0); assert.match(f.traces(), new RegExp(`fault-${tool}`));
      assert.equal(f.records().length, 0); assert.doesNotMatch(f.traces(), /telegram/);
      assert.equal(readdirSync(f.queue).filter((s) => s.includes('.tmp.') || s.startsWith('.notification.')).length, 0);
    }));
  }
  it('requires private directory permissions before reading', native, () => withFixture((f) => {
    const p = f.seed(), before = f.text(p); fault(f, 'chmod', '*700*');
    assert.equal(response(f).status, 503); assert.match(f.traces(), /fault-chmod/); preserved(f, p, before);
  }));
  it('keeps a 0700 directory and 0600 published record', native, () => withFixture((f) => {
    const r = f.enqueue(); assert.equal(r.status, 0, r.stderr);
    assert.equal(statSync(f.queue).mode & 0o777, 0o700);
    assert.equal(statSync(join(f.queue, f.records()[0])).mode & 0o777, 0o600);
  }));
  it('never follows a notification symlink to another file', native, () => withFixture((f) => {
    const p = f.seed(), saved = readFileSync(p); const target = join(f.root, 'outside'); writeFileSync(target, saved);
    rmSync(p); symlinkSync(target, p); assert.equal(response(f).status, 503);
    assert.deepEqual(readFileSync(target), saved); assert.ok(existsSync(p));
  }));
  it('reports deletion failure instead of a false complete cleanup', native, () => withFixture((f) => {
    const p = f.seed({ created_at: notificationNow - 3000000 }), before = f.text(p);
    fault(f, 'rm', '*.notification*'); assert.equal(response(f).status, 503);
    assert.match(f.traces(), /fault-rm/); preserved(f, p, before);
  }));
  it('preserves a different existing record on an internal ID collision', native, () => withFixture((f) => {
    const p = f.seed({ id: `${notificationNow}-aaaaaaaaaaaaaaaa` }), before = f.text(p);
    f.put('sha256sum', '#!/bin/sh\ncat >/dev/null\nprintf "aaaaaaaaaaaaaaaa000000000000000000000000000000000000000000000000  -\\n"\n');
    const r = f.enqueue('different-key'); assert.notEqual(r.status, 0); preserved(f, p, before);
  }));
});

describe('Notification queue concurrency', native, () => {
  it('serializes two enqueues of the same key and sends only one event', async () => {
    const f = createNotificationFixture(), tasks = [];
    try {
      f.put('flock', '#!/bin/sh\nprintf "lock-%s %s\\n" "$TEST_PROCESS" "$*" >> "$TEST_NOTICE_ACTIONS"\nexec /usr/bin/flock "$@"\n');
      f.put('mv', `#!/bin/sh
printf 'publish-%s\\n' "$TEST_PROCESS" >> "$TEST_NOTICE_ACTIONS"
if [ "$TEST_PROCESS" = A ]; then while [ ! -f "$TEST_BARRIER" ]; do sleep 0.02; done; fi
exec /usr/bin/mv "$@"
`);
      const args = ['enqueue', 'system', 'same-key', 'Title', 'Message'];
      tasks.push(f.start(args, { TEST_PROCESS: 'A' }));
      await until(() => /publish-A/.test(f.traces()), 'first producer at publication');
      tasks.push(f.start(args, { TEST_PROCESS: 'B' }));
      await until(() => /publish-B|lock-B -n/.test(f.traces()), 'second producer at contention');
      writeFileSync(join(f.root, 'release'), 'go');
      const results = await Promise.all(tasks.map((t) => t.done));
      for (const r of results) assert.equal(r.status, 0, r.stderr);
      const bodies = results.map((r) => JSON.parse(r.stdout));
      assert.deepEqual(bodies.map((b) => b.duplicate).sort(), [false, true]); assert.equal(bodies[0].id, bodies[1].id);
      assert.equal(f.records().length, 1);
      await until(() => f.traces().includes('telegram'), 'notification handoff');
      assert.equal(f.traces().split('\n').filter((s) => s === 'telegram').length, 1);
    } finally {
      writeFileSync(join(f.root, 'release'), 'go');
      tasks.forEach((t) => t.child.kill('SIGKILL')); await Promise.allSettled(tasks.map((t) => t.done)); f.close();
    }
  });
  it('refuses list when the common lock is unavailable', () => withFixture((f) => {
    const p = f.seed(), before = f.text(p); fault(f, 'flock', '*');
    assert.equal(response(f).status, 503); assert.match(f.traces(), /fault-flock/); preserved(f, p, before);
  }));
});


describe('Notification cleanup boundaries', native, () => {
  for (const mode of ['list', 'cleanup']) {
    it(`uses the same lock for ${mode} and does not unlink it`, async () => {
      const f = createNotificationFixture(), tasks = [];
      try {
        const p = f.seed({ created_at: notificationNow - 3000000 });
        const lock = join(f.queue, '.queue.lock'); writeFileSync(lock, ''); const inode = statSync(lock).ino;
        f.put('flock', '#!/bin/sh\nprintf "lock-attempt %s\\n" "$*" >> "$TEST_NOTICE_ACTIONS"\nexec /usr/bin/flock "$@"\n');
        const holder = spawn('flock', [lock, 'sh', '-c', 'echo ready; read answer'], { stdio: ['pipe', 'pipe', 'pipe'] });
        tasks.push({ child: holder, done: new Promise((res) => holder.once('close', res)) });
        let ready = false; holder.stdout.on('data', () => { ready = true; });
        await until(() => ready, 'external queue holder');
        const task = f.start([mode]); tasks.push(task); let finished = false; task.done.then(() => { finished = true; });
        await until(() => f.traces().includes('lock-attempt -n') || finished, 'cleanup contention or old completion');
        assert.match(f.traces(), /lock-attempt -n/); assert.ok(existsSync(p));
        holder.stdin.end('go\n'); const r = await task.done; assert.equal(r.status, 0, r.stderr);
        assert.ok(!existsSync(p)); assert.equal(statSync(lock).ino, inode);
      } finally {
        for (const t of tasks) { t.child.stdin?.end(); t.child.kill('SIGKILL'); }
        await Promise.allSettled(tasks.map((t) => t.done)); f.close();
      }
    });
  }
  it('a slow Telegram child holds neither the queue lock nor response pipes', async () => {
    const f = createNotificationFixture(); let task;
    try {
      f.put('telegram', `#!/bin/sh
if /usr/bin/flock -n "$SHEEPFOLD_NOTIFICATION_DIR/.queue.lock" /bin/true; then
  printf 'telegram-unlocked\\n' >> "$TEST_NOTICE_ACTIONS"
else printf 'telegram-locked\\n' >> "$TEST_NOTICE_ACTIONS"; fi
while [ ! -f "$TEST_BARRIER" ]; do sleep 0.02; done
printf 'telegram-done\\n' >> "$TEST_NOTICE_ACTIONS"
`);
      task = f.start(['enqueue', 'system', 'slow', 'Title', 'Message']);
      let finished = false; task.done.then(() => { finished = true; });
      await until(() => /telegram-(unlocked|locked)/.test(f.traces()), 'Telegram began');
      assert.match(f.traces(), /telegram-unlocked/);
      await until(() => finished, 'queue response must not wait for Telegram');
      assert.equal((await task.done).status, 0); assert.doesNotMatch(f.traces(), /telegram-done/);
    } finally {
      writeFileSync(join(f.root, 'release'), 'go');
      await until(() => f.traces().includes('telegram-done'), 'Telegram finished after release');
      task?.child.kill('SIGKILL'); if (task) await task.done; f.close();
    }
  });
  it('does not remove another file printed by a failed mktemp', () => withFixture((f) => {
    const foreign = join(f.root, 'foreign'); writeFileSync(foreign, 'keep');
    f.put('mktemp', `#!/bin/sh\nprintf 'fault-mktemp\\n' >> "$TEST_NOTICE_ACTIONS"\nprintf '%s\\n' '${f.pathForShell(foreign)}'\nexit 7\n`);
    const r = f.enqueue(); assert.notEqual(r.status, 0); assert.match(f.traces(), /fault-mktemp/);
    assert.equal(f.text(foreign), 'keep'); assert.equal(f.records().length, 0);
  }));
  it('reports a failed post-publication trim without pretending the event is absent', () => withFixture((f) => {
    for (let i = 0; i < 100; i++) f.seed({ dedupe_key: `key-${i}`, created_at: notificationNow - 1000 + i });
    fault(f, 'rm', '*.notification*'); const r = f.enqueue();
    assert.notEqual(r.status, 0); assert.match(f.traces(), /fault-rm/);
    assert.equal(f.records().length, 101); assert.doesNotMatch(f.traces(), /telegram/);
    rmSync(join(f.bin, 'rm')); const retry = f.enqueue(); assert.equal(retry.status, 0, retry.stderr);
    assert.equal(JSON.parse(retry.stdout).duplicate, true); assert.equal(f.records().length, 100);
  }));
});
