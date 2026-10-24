/*
 * Проверяет ограниченное восстановление даты настоящим shell-helper с подставными
 * часами, uptime, NTP и очередью уведомлений; меняет только удаляемый fixture в .build
 * Последовательная модель lock не доказывает конкуренцию, синхронизацию NTP по сети
 * или доставку на телефон; штатные часы и настройки компьютера не меняются
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { shellTestPath } from '../tools/quality/testEnvironment.mjs';
import { completedProcess, runtimeTimeout } from './helpers/runtimeProcess.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const helperDir = 'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold';
const shellPath = (path) => shellTestPath(path, { cwd: repo });

function fixture(t) {
  mkdirSync(join(repo, '.build'), { recursive: true });
  const root = mkdtempSync(join(repo, '.build/timeRecovery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const recovery = join(root, 'recovery');
  mkdirSync(bin);
  const put = (name, source) => {
    const path = join(bin, name);
    writeFileSync(path, source);
    chmodSync(path, 0o755);
    return shellPath(path);
  };
  const lock = put('lock', `#!/bin/sh
sheepfold_lock_acquire() { return "\${TEST_LOCK_EXIT:-0}"; }
sheepfold_lock_release() { return 0; }
`);
  put('date', '#!/bin/sh\nprintf "%s\\n" "$TEST_YEAR"\nexit "${TEST_DATE_EXIT:-0}"\n');
  put('uci', `#!/bin/sh
case "$*" in
  '-q get system.ntp.enabled') printf '%s\\n' "$TEST_NTP"; exit "\${TEST_UCI_EXIT:-0}" ;;
  '-q get sheepfold.global.language') echo ru ;;
  *) echo unexpectedUci >> "$TEST_TRACE"; exit 2 ;;
esac
`);
  const init = put('sysntpd', `#!/bin/sh
printf 'ntp:%s\\n' "$1" >> "$TEST_TRACE"
exit "\${TEST_NTP_EXIT:-0}"
`);
  put('timeout', `#!/bin/sh
test "$1 $2 $3" = '-k 2 15' || exit 2
if [ "\${TEST_REAL_TIMEOUT:-0}" = 1 ]; then exec /usr/bin/timeout "$@"; fi
shift 3
exec "$@"
`);
  const notifier = put('notify', `#!/bin/sh
printf 'notice:%s:%s:%s\\n' "$1" "$2" "$3" >> "$TEST_TRACE"
exit "\${TEST_NOTICE_EXIT:-0}"
`);
  const logger = put('log', '#!/bin/sh\nexit 0\n');
  writeFileSync(join(root, 'trace'), '');
  return {
    root, recovery, put,
    trace: () => readFileSync(join(root, 'trace'), 'utf8'),
    state: () => readFileSync(join(recovery, 'state'), 'utf8').trim(),
    run(uptime = 180, extra = {}) {
      writeFileSync(join(root, 'uptime'), `${uptime}.00 0.00\n`);
      return completedProcess(spawnSync('sh', ['-c', 'export PATH="$TEST_BIN:$PATH"; exec sh "$TEST_HELPER" recover'], {
        cwd: repo, encoding: 'utf8', timeout: runtimeTimeout(30000),
        env: {
          ...process.env, TEST_BIN: shellPath(bin),
          TEST_HELPER: shellPath(join(repo, helperDir, 'sheepfold-time-control')),
          TEST_TRACE: shellPath(join(root, 'trace')), TEST_YEAR: '1970', TEST_NTP: '1',
          SHEEPFOLD_LOCK_COMMON: lock,
          SHEEPFOLD_TIME_LOCK: shellPath(join(root, 'time.lock')),
          SHEEPFOLD_TIME_RECOVERY_DIR: shellPath(recovery),
          SHEEPFOLD_TIME_UPTIME_FILE: shellPath(join(root, 'uptime')),
          SHEEPFOLD_SYSNTPD_INIT: init, SHEEPFOLD_NOTIFICATION_HELPER: notifier,
          SHEEPFOLD_LOG_HELPER: logger, ...extra,
        },
      }), 'time recovery fixture');
    },
  };
}

function expectStatus(result, status) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `recovery_status=${status}`);
}

describe('bounded router time recovery', () => {
  it('leaves healthy clocks and boot grace untouched', (t) => {
    const f = fixture(t);
    expectStatus(f.run(179), 'boot_grace');
    for (const year of ['2024', '2026', '2100'])
      expectStatus(f.run(900, { TEST_YEAR: year }), 'healthy');
    assert.equal(f.trace(), '');
    assert.equal(existsSync(f.recovery), false);
  });

  it('counts two restarts by uptime, waits for real recovery and notifies once', (t) => {
    const f = fixture(t);
    for (const uptime of [180, 180, 479, 480, 779]) expectStatus(f.run(uptime), 'syncing');
    for (const uptime of [780, 1200, 86400]) expectStatus(f.run(uptime), 'exhausted');
    assert.equal(f.trace(), 'ntp:restart\nntp:restart\nnotice:enqueue:system:clock:invalid\n');
    assert.match(f.state(), /^2 480 1 780 exhausted$/);
    expectStatus(f.run(86500, { TEST_YEAR: '2026' }), 'healthy');
    assert.equal(existsSync(join(f.recovery, 'state')), false);
    expectStatus(f.run(87000), 'syncing');
    assert.match(f.state(), /^1 87000 0 0 syncing$/);
  });

  it('detects an implausibly future year too', (t) => {
    const f = fixture(t);
    expectStatus(f.run(180, { TEST_YEAR: '2101' }), 'syncing');
    assert.equal(f.trace(), 'ntp:restart\n');
  });

  it('does not enable disabled NTP or trust a failed UCI read', (t) => {
    for (const [extra, status] of [
      [{ TEST_NTP: '0' }, 'disabled'],
      [{ TEST_NTP: '' }, 'unavailable'],
      [{ TEST_NTP: '1', TEST_UCI_EXIT: '1' }, 'unavailable'],
      [{ SHEEPFOLD_SYSNTPD_INIT: '/nonexistent/sheepfold-test-init' }, 'unavailable'],
    ]) {
      const f = fixture(t);
      expectStatus(f.run(180, extra), status);
      expectStatus(f.run(900, extra), status);
      assert.equal(f.trace(), 'notice:enqueue:system:clock:invalid\n');
    }
  });

  it('counts failed restart attempts without treating them as synchronization', (t) => {
    const f = fixture(t);
    const extra = { TEST_NTP_EXIT: '1' };
    for (const uptime of [180, 479, 480]) expectStatus(f.run(uptime, extra), 'failed');
    expectStatus(f.run(780, extra), 'exhausted');
    assert.equal((f.trace().match(/ntp:restart/g) || []).length, 2);
    assert.equal((f.trace().match(/notice:/g) || []).length, 1);
  });

  it('terminates a stuck init through real GNU timeout', (t) => {
    const f = fixture(t);
    const init = f.put('stuck-init', '#!/bin/sh\nprintf "ntp:restart\\n" >> "$TEST_TRACE"\ntrap "" TERM\nwhile :; do sleep 1; done\n');
    expectStatus(f.run(180, { SHEEPFOLD_SYSNTPD_INIT: init, TEST_REAL_TIMEOUT: '1' }), 'failed');
    assert.equal(f.trace(), 'ntp:restart\nnotice:enqueue:system:clock:invalid\n');
    assert.match(f.state(), /^1 180 1 180 failed$/);
  });

  it('stops recovery on TERM without losing the recorded retry budget', (t) => {
    const f = fixture(t);
    const init = f.put('interrupt-init', '#!/bin/sh\nprintf "ntp:restart\\n" >> "$TEST_TRACE"\nkill -TERM "$PPID"\n');
    const result = f.run(180, { SHEEPFOLD_SYSNTPD_INIT: init });
    assert.equal(result.status, 143, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(f.trace(), 'ntp:restart\n');
    assert.match(f.state(), /^1 180 0 0 starting$/);
    expectStatus(f.run(479), 'starting');
    assert.equal(f.trace(), 'ntp:restart\n');
    expectStatus(f.run(480), 'syncing');
    assert.match(f.state(), /^2 480 0 0 syncing$/);
  });

  it('retries failed notification enqueue at most once per five minutes', (t) => {
    const f = fixture(t);
    const extra = { TEST_NTP: '0', TEST_NOTICE_EXIT: '1' };
    for (const uptime of [180, 180, 479]) expectStatus(f.run(uptime, extra), 'disabled');
    assert.equal(f.trace(), 'notice:enqueue:system:clock:invalid\n');
    expectStatus(f.run(480, { TEST_NTP: '0' }), 'disabled');
    expectStatus(f.run(900, { TEST_NTP: '0' }), 'disabled');
    assert.equal((f.trace().match(/notice:/g) || []).length, 2);
  });

  it('does not act after a date, uptime or lock acquisition failure', (t) => {
    const f = fixture(t);
    for (const extra of [{ TEST_DATE_EXIT: '1' }, { TEST_YEAR: 'bad' }, { TEST_LOCK_EXIT: '1' }])
      assert.equal(f.run(180, extra).status, 1);
    assert.equal(f.run('bad').status, 1);
    assert.equal(f.trace(), '');
    assert.equal(existsSync(f.recovery), false);
  });

  it('does not reset corrupt or future-uptime retry state', (t) => {
    const f = fixture(t);
    mkdirSync(f.recovery);
    for (const state of ['invalid\n', '3 100 0 0 syncing\n', '1 1000 0 0 syncing\n', '1 100 0 0 unexpected\n']) {
      writeFileSync(join(f.recovery, 'state'), state);
      assert.equal(f.run(180).status, 1);
      assert.equal(f.state(), state.trim());
    }
    assert.equal(f.trace(), '');
  });

  it('rejects trailing state bytes instead of trusting only the first record', (t) => {
    const f = fixture(t);
    mkdirSync(f.recovery);
    const record = '0 0 0 0 waiting\n';
    for (const state of [record + record, record + 'tail', record + '\n', record.replace('waiting', 'wai\0ting')]) {
      writeFileSync(join(f.recovery, 'state'), state);
      assert.equal(f.run(180).status, 1, JSON.stringify(state));
      assert.equal(readFileSync(join(f.recovery, 'state'), 'utf8'), state);
    }
    assert.equal(f.trace(), '');
  });

  it('refuses a directory in place of the state file', (t) => {
    const f = fixture(t);
    mkdirSync(join(f.recovery, 'state'), { recursive: true });
    assert.equal(f.run(180).status, 1);
    assert.equal(f.run(180, { TEST_YEAR: '2026' }).status, 1);
    assert.equal(f.trace(), '');
  });

  it('does not restart if atomic state replacement fails', (t) => {
    const f = fixture(t);
    f.put('mv', '#!/bin/sh\nexit 1\n');
    assert.equal(f.run(180).status, 1);
    assert.equal(f.trace(), '');
    assert.equal(existsSync(join(f.recovery, 'state')), false);
  });

  it('refuses linked state without touching the link target', { skip: process.platform === 'win32' ? 'Native symlink gate requires POSIX' : false }, (t) => {
    const f = fixture(t);
    mkdirSync(f.recovery);
    const target = join(f.root, 'foreign');
    writeFileSync(target, 'foreign\n');
    symlinkSync(target, join(f.recovery, 'state'));
    assert.equal(f.run(180).status, 1);
    assert.equal(readFileSync(target, 'utf8'), 'foreign\n');
    assert.equal(f.trace(), '');
  });

  it('wires recovery into maintenance without a force bypass or inherited lock', () => {
    const makefile = readFileSync(join(repo, 'package/luci-app-sheepfold-family-internet-control/Makefile'), 'utf8');
    assert.match(makefile, /^LUCI_DEPENDS:=.*\+coreutils-timeout(?:\s|$)/m);
    const maintenance = readFileSync(join(repo, helperDir, 'sheepfold-maintenance'), 'utf8');
    assert.match(maintenance, /TIME_CONTROL="\$\{SHEEPFOLD_TIME_CONTROL:-\/usr\/libexec\/sheepfold\/sheepfold-time-control\}"/);
    assert.match(maintenance, /run_all\(\)[\s\S]*?"\$TIME_CONTROL" recover 9>&- >\/dev\/null 2>&1 \|\| true/);
    assert.doesNotMatch(maintenance, /"\$TIME_CONTROL" recover "?\$force/);
  });

  it('keeps the native probe isolated and the real NTP restart explicitly opt-in', () => {
    const probe = readFileSync(join(repo, 'tools/router-testing/timeRecoveryProbe.sh'), 'utf8');
    assert.match(probe, /\[ -f \/etc\/openwrt_release \]/);
    assert.match(probe, /mode="\$\{2:-fixture\}"/);
    assert.match(probe, /mktemp -d \/tmp\/sheepfold-time-probe\.XXXXXX/);
    assert.match(probe, /SHEEPFOLD_TIME_RECOVERY_DIR="\$work\/recovery"/);
    assert.match(probe, /PATH="\$PROBE_BASE_PATH"\s+export PATH\s+exec \/etc\/init.d\/sysntpd/);
    assert.match(probe, /if \[ "\$mode" = --restart-ntp \]; then\s+real_started=1/);
    assert.match(probe, /sha256sum -c "\$work\/configs.sha256"/);
    assert.doesNotMatch(probe, /\$\(stat\b/);
    assert.doesNotMatch(probe, /(?:uci\s+(?:set|commit)|date\s+-s|apk\s+add|opkg\s+install)/);
    for (const file of ['package.json', 'tools/router-testing/runAllRouterTests.ps1'])
      assert.doesNotMatch(readFileSync(join(repo, file), 'utf8'), /timeRecoveryProbe/);
  });

  it('schedules maintenance by uptime even when calendar time moves backwards', (t) => {
    const f = fixture(t);
    const service = readFileSync(join(repo, helperDir, 'sheepfold-service'), 'utf8');
    const start = service.indexOf('handle_maintenance() {');
    const end = service.indexOf('\nrun_detector()', start);
    assert.ok(start >= 0 && end > start);
    const maintenance = f.put('maintenance', '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_TRACE"\n');
    const uptimeFile = shellPath(join(f.root, 'uptime'));
    const traceFile = shellPath(join(f.root, 'trace'));
    const script = `${service.slice(start, end)}
LAST_MAINTENANCE_TICK=0
date() { echo 'date must not be called' >&2; exit 99; }
printf '180.00 0.00\\n' > "$SHEEPFOLD_TIME_UPTIME_FILE"
handle_maintenance force
printf '479.00 0.00\\n' > "$SHEEPFOLD_TIME_UPTIME_FILE"
handle_maintenance periodic
printf '480.00 0.00\\n' > "$SHEEPFOLD_TIME_UPTIME_FILE"
handle_maintenance periodic
printf 'bad\\n' > "$SHEEPFOLD_TIME_UPTIME_FILE"
if handle_maintenance force; then exit 99; fi
`;
    const result = completedProcess(spawnSync('sh', ['-s'], {
      cwd: repo, input: script, encoding: 'utf8', timeout: runtimeTimeout(15000),
      env: { ...process.env, SHEEPFOLD_TIME_UPTIME_FILE: uptimeFile, TEST_TRACE: traceFile, MAINTENANCE_HELPER: maintenance },
    }), 'maintenance uptime fixture');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(f.trace(), 'run\nrun\n');
  });
});
