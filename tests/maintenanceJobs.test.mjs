/*
 * Verifies the bounded background-maintenance contract: atomic RAM-log rotation,
 * conservative cleanup of only old unconfigured offline cards, and scheduled
 * update notification or explicitly enabled hourly beta updates. Runtime cases use temporary
 * files and command stubs, then remove all state; they do not touch a real router,
 * package manager, network, firewall, or owner configuration. §maintjob1 §testwhy
 */
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { shellTestPath } from '../tools/quality/testEnvironment.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8');
const helperPath = 'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-maintenance';
const helper = read(helperPath);
const service = read('package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-service');
const logWriter = read('package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-log');
const updater = read('package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-updater');
const routerControl = read('package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-router-control-legacy');
const adminConfig = read('package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-api-admin-config');
const adminConfigGroups = read('package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-lib-admin-config-groups');

const fixturePath = (path) => shellTestPath(path, { cwd: repoRoot });

function executable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function commonRoot(prefix) {
  mkdirSync(resolve('.build'), { recursive: true });
  const root = mkdtempSync(resolve(`.build/${prefix}-`));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  executable(join(bin, 'lock-common'), 'sheepfold_lock_acquire() { :; }\nsheepfold_lock_release() { :; }\n');
  return { root, bin };
}

function runHelper(command, env) {
  return spawnSync('sh', [resolve(helperPath), command], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function simpleUciSource() {
  return `#!/bin/sh
set -eu
while [ "\${1:-}" = -t ] || [ "\${1:-}" = -p ]; do shift 2; done
[ "\${1:-}" = -q ] && shift
cmd="\${1:-}"; arg="\${2:-}"
case "$cmd" in
  show) grep "^\${arg}\\." "$TEST_UCI" || true ;;
  get)
    value="$(sed -n "s|^\${arg}=||p" "$TEST_UCI" | sed -n '1p')"
    [ -n "$value" ] || exit 1
    printf '%s\\n' "$value"
    ;;
  delete)
    awk -v key="$arg" 'index($0,key "=") != 1 && index($0,key ".") != 1' "$TEST_UCI" > "$TEST_UCI.tmp"
    mv "$TEST_UCI.tmp" "$TEST_UCI"
    [ -z "\${TEST_DELETES:-}" ] || printf '%s\\n' "$arg" >> "$TEST_DELETES"
    ;;
  commit) : ;;
  *) exit 1 ;;
esac
`;
}

describe('background maintenance jobs §maintjob1', () => {
  it('betaUpdatesUseHourlyRamStateAndNeverTurnForceIntoRepeatedInstalls', () => {
    const { root, bin } = commonRoot('maintenance-beta');
    const runtime = join(root, 'runtime');
    const state = join(root, 'state');
    const uci = join(root, 'uci.txt');
    const calls = join(root, 'updater.log');
    writeFileSync(uci, 'sheepfold.global.beta_testing=1\nsheepfold.global.update_check_install_mode=never\n');
    writeFileSync(calls, '');
    executable(join(bin, 'uci'), simpleUciSource());
    executable(join(bin, 'updater'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_UPDATER_CALLS"\nexit "${TEST_START_CODE:-0}"\n');
    const env = {
      TEST_UCI: fixturePath(uci), TEST_UPDATER_CALLS: fixturePath(calls),
      SHEEPFOLD_UCI_BIN: fixturePath(join(bin, 'uci')),
      SHEEPFOLD_LOCK_COMMON: fixturePath(join(bin, 'lock-common')),
      SHEEPFOLD_UPDATER: fixturePath(join(bin, 'updater')),
      SHEEPFOLD_MAINTENANCE_RUNTIME_DIR: fixturePath(runtime),
      SHEEPFOLD_MAINTENANCE_STATE_DIR: fixturePath(state),
      SHEEPFOLD_MAINTENANCE_NOW_EPOCH: '1784678400',
      SHEEPFOLD_MAINTENANCE_TODAY: '2026-07-22',
    };
    const run = (uptime, extra = {}) => runHelper('check-updates', {
      ...env, SHEEPFOLD_MAINTENANCE_UPTIME: String(uptime), ...extra,
    });
    try {
      assert.equal(run(50, { SHEEPFOLD_MAINTENANCE_TODAY: '1970-01-01' }).status, 0);
      assert.equal(readFileSync(calls, 'utf8'), '');
      assert.equal(run(100).status, 0);
      assert.equal(run(3699, { SHEEPFOLD_MAINTENANCE_NOW_EPOCH: '1884678400' }).status, 0);
      assert.equal(readFileSync(calls, 'utf8'), 'start-beta\n');
      assert.equal(run(3700, { TEST_START_CODE: '1' }).status, 1);
      assert.match(readFileSync(join(runtime, 'beta-update.state'), 'utf8'), /last_result=start_failed/);
      assert.equal(run(3701).status, 0);
      assert.equal(readFileSync(calls, 'utf8'), 'start-beta\nstart-beta\n');
      assert.equal(existsSync(join(state, 'update-check.state')), false);
      rmSync(join(runtime, 'beta-update.state'));
      mkdirSync(join(runtime, 'beta-update.state'));
      assert.equal(run(8000).status, 1);
      assert.equal(readFileSync(calls, 'utf8'), 'start-beta\nstart-beta\n');
      writeFileSync(uci, 'sheepfold.global.beta_testing=0\nsheepfold.global.update_check_install_mode=never\n');
      assert.equal(run(8000).status, 0);
      assert.equal(readFileSync(calls, 'utf8'), 'start-beta\nstart-beta\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs from the service and probes releases without unattended installation', () => {
    assert.match(service, /MAINTENANCE_HELPER=.*sheepfold-maintenance/);
    assert.match(service, /handle_maintenance periodic/);
    assert.match(service, /handle_maintenance force/);
    assert.match(service, /interval=300/);
    assert.doesNotMatch(service, /maintenance_interval_seconds/);
    assert.match(helper, /"\$UPDATER" probe/);
    assert.match(helper, /"\$UPDATER" start-beta/);
    assert.match(helper, /sheepfold\.global\.beta_testing/);
    assert.match(updater, /print_probe\(\)/);
    assert.match(updater, /probe\)\s*\n\s*with_update_lock print_probe/);
  });

  it('serializes the writer with rotation and marks explicit device edits as preserved', () => {
    assert.match(logWriter, /LOG_LOCK=.*log-maintenance\.flock/);
    assert.match(logWriter, /sheepfold_lock_acquire "\$LOG_LOCK"/);
    assert.match(logWriter, /cut -c1-4096/);
    assert.match(helper, /sheepfold_lock_acquire "\$LOG_LOCK"/);
    assert.match(helper, /processing_limit=\$\(\(max_bytes \+ 65536\)\)/);
    assert.match(helper, /MAX_DEVICE_SCAN_PER_RUN=512/);
    assert.match(helper, /MAX_DEVICE_CLEANUP_PER_RUN=32/);
    assert.match(helper, /"\$NOTIFIER" enqueue update[\s\S]*9>&-/);
    assert.match(helper, /"\$LOG_HELPER"[\s\S]*9>&-/);
    assert.match(routerControl, /device_type=\$device_type"[\s\S]*user_configured=1/);
    assert.match(adminConfig, /sheepfold-lib-admin-config-groups/);
    assert.match(adminConfigGroups, /group_source=user[\s\S]*user_configured=1/);
  });

  it('rotates the RAM log by calendar retention and byte limit', () => {
    const { root, bin } = commonRoot('maintenance-log');
    const runtime = join(root, 'runtime');
    const state = join(root, 'state');
    const log = join(root, 'events.log');
    const uci = join(root, 'uci.txt');
    mkdirSync(runtime); mkdirSync(state);
    const large = 'x'.repeat(1400);
    writeFileSync(log, [
      `18.07.2026 10:00:00\told`,
      ...Array.from({ length: 70 }, (_, index) => `20.07.2026 10:${String(index % 60).padStart(2, '0')}:00\t${large}${index}`),
      '21.07.2026 10:00:00\tkeep-two',
      '22.07.2026 10:00:00\tkeep-three',
      '',
    ].join('\n'));
    writeFileSync(uci, [
      `sheepfold.global.log_cache_path=${log}`,
      'sheepfold.global.log_retention=3d',
      'sheepfold.global.log_max_size_kb=64',
    ].join('\n') + '\n');
    executable(join(bin, 'uci'), simpleUciSource());
    // Переносим лишь корень общей проверки пути в тот же изолированный fixture.
    const logCommon = join(bin, 'log-common');
    writeFileSync(logCommon, read('package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-log-common')
      .replaceAll('/tmp/sheepfold', fixturePath(root)));

    const result = runHelper('rotate-log', {
      TEST_UCI: fixturePath(uci),
      SHEEPFOLD_LOG_COMMON: fixturePath(logCommon),
      SHEEPFOLD_UCI_BIN: fixturePath(join(bin, 'uci')),
      SHEEPFOLD_LOCK_COMMON: fixturePath(join(bin, 'lock-common')),
      SHEEPFOLD_MAINTENANCE_RUNTIME_DIR: fixturePath(runtime),
      SHEEPFOLD_MAINTENANCE_STATE_DIR: fixturePath(state),
      SHEEPFOLD_MAINTENANCE_CONFIG_FILE: fixturePath(join(root, 'config')),
      SHEEPFOLD_MAINTENANCE_DEFAULT_LOG: fixturePath(log),
      SHEEPFOLD_MAINTENANCE_NOW_EPOCH: '1784678400',
      SHEEPFOLD_MAINTENANCE_TODAY: '2026-07-22',
    });
    try {
      assert.equal(result.status, 0, result.stderr);
      const rotated = readFileSync(log, 'utf8');
      assert.doesNotMatch(rotated, /18\.07\.2026/);
      assert.match(rotated, /22\.07\.2026/);
      assert.ok(Buffer.byteLength(rotated) <= 64 * 1024);
      assert.match(readFileSync(join(runtime, 'log-rotation.state'), 'utf8'), /last_result=ok/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('deletes only old offline cards with no family, security, DHCP, list, or schedule state', () => {
    const { root, bin } = commonRoot('maintenance-devices');
    const runtime = join(root, 'runtime');
    const state = join(root, 'state');
    const uci = join(root, 'uci.txt');
    const config = join(root, 'sheepfold.conf');
    const deletes = join(root, 'deletes.log');
    const logEvents = join(root, 'events.log');
    const firewallEvents = join(root, 'firewall.log');
    const childWifiHistory = join(root, 'child-wifi-history');
    mkdirSync(runtime); mkdirSync(state); mkdirSync(childWifiHistory);
    writeFileSync(uci, [
      'sheepfold.global=sheepfold',
      'sheepfold.global.offline_device_retention_days=90',
      'sheepfold.device_old=device',
      'sheepfold.device_old.mac=AA:AA:AA:AA:AA:01',
      'sheepfold.device_old.id=1',
      'sheepfold.device_old.group=Not configured',
      'sheepfold.device_old.status=new',
      'sheepfold.device_group=device',
      'sheepfold.device_group.mac=AA:AA:AA:AA:AA:02',
      'sheepfold.device_group.id=2',
      'sheepfold.device_group.group=Child',
      'sheepfold.device_group.status=new',
      'sheepfold.device_admin=device',
      'sheepfold.device_admin.mac=AA:AA:AA:AA:AA:03',
      'sheepfold.device_admin.id=3',
      'sheepfold.device_admin.group=Not configured',
      'sheepfold.device_admin.status=new',
      'sheepfold.device_admin.admin_device=1',
      'sheepfold.device_static=device',
      'sheepfold.device_static.mac=AA:AA:AA:AA:AA:04',
      'sheepfold.device_static.id=4',
      'sheepfold.device_static.group=Not configured',
      'sheepfold.device_static.status=new',
      'sheepfold.device_scheduled=device',
      'sheepfold.device_scheduled.mac=AA:AA:AA:AA:AA:05',
      'sheepfold.device_scheduled.id=5',
      'sheepfold.device_scheduled.group=Not configured',
      'sheepfold.device_scheduled.status=new',
      'sheepfold.device_manual=device',
      'sheepfold.device_manual.mac=AA:AA:AA:AA:AA:06',
      'sheepfold.device_manual.id=6',
      'sheepfold.device_manual.group=Not configured',
      'sheepfold.device_manual.status=new',
      'sheepfold.device_manual.user_configured=1',
      'sheepfold.device_decided=device',
      'sheepfold.device_decided.mac=AA:AA:AA:AA:AA:07',
      'sheepfold.device_decided.id=7',
      'sheepfold.device_decided.group=Not configured',
      'sheepfold.device_decided.status=restricted',
      'sheepfold.device_recent=device',
      'sheepfold.device_recent.mac=AA:AA:AA:AA:AA:08',
      'sheepfold.device_recent.id=8',
      'sheepfold.device_recent.group=Not configured',
      'sheepfold.device_recent.status=new',
      'sheepfold.device_online=device',
      'sheepfold.device_online.mac=AA:AA:AA:AA:AA:09',
      'sheepfold.device_online.id=9',
      'sheepfold.device_online.group=Not configured',
      'sheepfold.device_online.status=new',
      'sheepfold.device_history=device',
      'sheepfold.device_history.mac=AA:AA:AA:AA:AA:10',
      'sheepfold.device_history.id=10',
      'sheepfold.device_history.group=Not configured',
      'sheepfold.device_history.status=new',
      'sheepfold.global.next_device_id=11',
      'sheepfold.schedule_1=schedule',
      'sheepfold.schedule_1.target_type=device',
      'sheepfold.schedule_1.targets=5',
      'dhcp.host1=host',
      'dhcp.host1.mac=AA:AA:AA:AA:AA:04',
    ].join('\n') + '\n');
    writeFileSync(config, readFileSync(uci));
    writeFileSync(join(childWifiHistory, 'device-10.networks'), `${'a'.repeat(64)}\t1780000000\tSchool\t\t\t\n`);
    writeFileSync(deletes, ''); writeFileSync(logEvents, ''); writeFileSync(firewallEvents, '');
    executable(join(bin, 'uci'), simpleUciSource());
    executable(join(bin, 'presence'), `#!/bin/sh
cat <<'DATA'
AA:AA:AA:AA:AA:01\t1776038400\t0\t192.168.1.1
AA:AA:AA:AA:AA:02\t1776038400\t0\t192.168.1.2
AA:AA:AA:AA:AA:03\t1776038400\t0\t192.168.1.3
AA:AA:AA:AA:AA:04\t1776038400\t0\t192.168.1.4
AA:AA:AA:AA:AA:05\t1776038400\t0\t192.168.1.5
AA:AA:AA:AA:AA:06\t1776038400\t0\t192.168.1.6
AA:AA:AA:AA:AA:07\t1776038400\t0\t192.168.1.7
AA:AA:AA:AA:AA:08\t1784505600\t0\t192.168.1.8
AA:AA:AA:AA:AA:09\t1776038400\t1\t192.168.1.9
AA:AA:AA:AA:AA:10\t1776038400\t0\t192.168.1.10
DATA
`);
    executable(join(bin, 'log-helper'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_LOG_EVENTS"\n');
    executable(join(bin, 'firewall'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_FIREWALL_EVENTS"\n');

    const result = runHelper('cleanup-devices', {
      TEST_UCI: fixturePath(uci), TEST_DELETES: fixturePath(deletes),
      TEST_LOG_EVENTS: fixturePath(logEvents), TEST_FIREWALL_EVENTS: fixturePath(firewallEvents),
      SHEEPFOLD_UCI_BIN: fixturePath(join(bin, 'uci')),
      SHEEPFOLD_LOCK_COMMON: fixturePath(join(bin, 'lock-common')),
      SHEEPFOLD_DEVICE_PRESENCE: fixturePath(join(bin, 'presence')),
      SHEEPFOLD_LOG_HELPER: fixturePath(join(bin, 'log-helper')),
      SHEEPFOLD_FIREWALL_HELPER: fixturePath(join(bin, 'firewall')),
      SHEEPFOLD_MAINTENANCE_RUNTIME_DIR: fixturePath(runtime),
      SHEEPFOLD_MAINTENANCE_STATE_DIR: fixturePath(state),
      SHEEPFOLD_MAINTENANCE_CONFIG_FILE: fixturePath(config),
      SHEEPFOLD_CHILD_WIFI_STATE_DIR: fixturePath(childWifiHistory),
      SHEEPFOLD_MAINTENANCE_NOW_EPOCH: '1784678400',
      SHEEPFOLD_MAINTENANCE_TODAY: '2026-07-22',
    });
    try {
      assert.equal(result.status, 0, result.stderr);
      const remaining = readFileSync(uci, 'utf8');
      assert.doesNotMatch(remaining, /sheepfold\.device_old=/);
      for (const protectedName of [
        'device_group', 'device_admin', 'device_static', 'device_scheduled',
        'device_manual', 'device_decided', 'device_recent', 'device_online', 'device_history',
      ]) {
        assert.match(remaining, new RegExp(`sheepfold\\.${protectedName}=device`));
      }
      assert.equal(readFileSync(deletes, 'utf8').trim(), 'sheepfold.device_old');
      assert.match(remaining, /sheepfold\.global\.next_device_id=11/);
      assert.match(readFileSync(join(state, 'device-cleanup.state'), 'utf8'), /deleted_count=1/);
      assert.match(readFileSync(logEvents, 'utf8'), /#1/);
      assert.equal(readFileSync(firewallEvents, 'utf8').trim(), 'sync');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('restores the UCI snapshot when device cleanup commit fails', () => {
    const { root, bin } = commonRoot('maintenance-rollback');
    const runtime = join(root, 'runtime');
    const state = join(root, 'state');
    const config = join(root, 'sheepfold.conf');
    mkdirSync(runtime); mkdirSync(state);
    writeFileSync(config, [
      'sheepfold.global=sheepfold',
      'sheepfold.global.offline_device_retention_days=90',
      'sheepfold.device_old=device',
      'sheepfold.device_old.mac=AA:AA:AA:AA:BB:01',
      'sheepfold.device_old.id=31',
      'sheepfold.device_old.group=Not configured',
      'sheepfold.device_old.status=new',
    ].join('\n') + '\n');
    executable(join(bin, 'uci'), `#!/bin/sh
set -eu
while [ "\${1:-}" = -t ] || [ "\${1:-}" = -p ]; do shift 2; done
[ "\${1:-}" = -q ] && shift
cmd="\${1:-}"; arg="\${2:-}"
case "$cmd" in
  show) grep "^\${arg}\\." "$TEST_UCI" || true ;;
  get)
    value="$(sed -n "s|^\${arg}=||p" "$TEST_UCI" | sed -n '1p')"
    [ -n "$value" ] || exit 1
    printf '%s\\n' "$value"
    ;;
  delete)
    awk -v key="$arg" 'index($0,key "=") != 1 && index($0,key ".") != 1' "$TEST_UCI" > "$TEST_UCI.tmp"
    mv "$TEST_UCI.tmp" "$TEST_UCI"
    ;;
  commit) exit 23 ;;
  *) exit 1 ;;
esac
`);
    executable(join(bin, 'presence'), `#!/bin/sh
printf 'AA:AA:AA:AA:BB:01\\t1776038400\\t0\\t192.168.1.31\\n'
`);

    const before = readFileSync(config, 'utf8');
    const result = runHelper('cleanup-devices', {
      TEST_UCI: fixturePath(config),
      SHEEPFOLD_UCI_BIN: fixturePath(join(bin, 'uci')),
      SHEEPFOLD_LOCK_COMMON: fixturePath(join(bin, 'lock-common')),
      SHEEPFOLD_DEVICE_PRESENCE: fixturePath(join(bin, 'presence')),
      SHEEPFOLD_MAINTENANCE_RUNTIME_DIR: fixturePath(runtime),
      SHEEPFOLD_MAINTENANCE_STATE_DIR: fixturePath(state),
      SHEEPFOLD_MAINTENANCE_CONFIG_FILE: fixturePath(config),
      SHEEPFOLD_MAINTENANCE_NOW_EPOCH: '1784678400',
      SHEEPFOLD_MAINTENANCE_TODAY: '2026-07-22',
    });
    try {
      assert.notEqual(result.status, 0);
      assert.equal(readFileSync(config, 'utf8'), before);
      assert.match(readFileSync(join(state, 'device-cleanup.state'), 'utf8'), /last_result=commit_failed/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('records an available release and notifies without invoking an install command', () => {
    const { root, bin } = commonRoot('maintenance-update');
    const runtime = join(root, 'runtime');
    const state = join(root, 'state');
    const uci = join(root, 'uci.txt');
    const updaterCalls = join(root, 'updater.log');
    const notifications = join(root, 'notifications.log');
    mkdirSync(runtime); mkdirSync(state);
    writeFileSync(uci, [
      'sheepfold.global.update_check_install_mode=weekly',
      'sheepfold.global.language=ru',
    ].join('\n') + '\n');
    executable(join(bin, 'uci'), simpleUciSource());
    executable(join(bin, 'updater'), `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_UPDATER_CALLS"
[ "$1" = probe ] || exit 9
printf 'available=1\\ncurrent_version=0.1.0-r243\\nlatest_version=0.1.0-r244\\ntag=v0.1.0-r244\\n'
`);
    executable(join(bin, 'notifier'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_NOTIFICATIONS"\n');

    const result = runHelper('check-updates', {
      TEST_UCI: fixturePath(uci), TEST_UPDATER_CALLS: fixturePath(updaterCalls), TEST_NOTIFICATIONS: fixturePath(notifications),
      SHEEPFOLD_UCI_BIN: fixturePath(join(bin, 'uci')),
      SHEEPFOLD_LOCK_COMMON: fixturePath(join(bin, 'lock-common')),
      SHEEPFOLD_UPDATER: fixturePath(join(bin, 'updater')),
      SHEEPFOLD_NOTIFICATION_HELPER: fixturePath(join(bin, 'notifier')),
      SHEEPFOLD_MAINTENANCE_RUNTIME_DIR: fixturePath(runtime),
      SHEEPFOLD_MAINTENANCE_STATE_DIR: fixturePath(state),
      SHEEPFOLD_MAINTENANCE_CONFIG_FILE: fixturePath(join(root, 'config')),
      SHEEPFOLD_MAINTENANCE_NOW_EPOCH: '1784678400',
      SHEEPFOLD_MAINTENANCE_TODAY: '2026-07-22',
    });
    try {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(updaterCalls, 'utf8').trim(), 'probe');
      assert.match(readFileSync(notifications, 'utf8'), /update:0\.1\.0-r244/);
      const updateState = readFileSync(join(state, 'update-check.state'), 'utf8');
      assert.match(updateState, /last_result=update_available/);
      assert.match(updateState, /latest_version=0\.1\.0-r244/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('honors the never update mode without touching the network-facing updater', () => {
    const { root, bin } = commonRoot('maintenance-update-disabled');
    const runtime = join(root, 'runtime');
    const state = join(root, 'state');
    const uci = join(root, 'uci.txt');
    const updaterCalls = join(root, 'updater.log');
    mkdirSync(runtime); mkdirSync(state);
    writeFileSync(uci, 'sheepfold.global.update_check_install_mode=never\n');
    writeFileSync(updaterCalls, '');
    executable(join(bin, 'uci'), simpleUciSource());
    executable(join(bin, 'updater'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_UPDATER_CALLS"\nexit 99\n');

    const env = {
      TEST_UCI: fixturePath(uci), TEST_UPDATER_CALLS: fixturePath(updaterCalls),
      SHEEPFOLD_UCI_BIN: fixturePath(join(bin, 'uci')),
      SHEEPFOLD_LOCK_COMMON: fixturePath(join(bin, 'lock-common')),
      SHEEPFOLD_UPDATER: fixturePath(join(bin, 'updater')),
      SHEEPFOLD_MAINTENANCE_RUNTIME_DIR: fixturePath(runtime),
      SHEEPFOLD_MAINTENANCE_STATE_DIR: fixturePath(state),
      SHEEPFOLD_MAINTENANCE_CONFIG_FILE: fixturePath(join(root, 'config')),
      SHEEPFOLD_MAINTENANCE_NOW_EPOCH: '1784678400',
      SHEEPFOLD_MAINTENANCE_TODAY: '2026-07-22',
    };
    const result = runHelper('check-updates', env);
    try {
      assert.equal(result.status, 0, result.stderr);
      const stateFile = join(state, 'update-check.state');
      const firstMtime = statSync(stateFile, { bigint: true }).mtimeNs;
      spawnSync('sleep', ['0.05']);
      const second = runHelper('check-updates', env);
      assert.equal(second.status, 0, second.stderr);
      assert.equal(statSync(stateFile, { bigint: true }).mtimeNs, firstMtime);
      assert.equal(readFileSync(updaterCalls, 'utf8'), '');
      assert.match(readFileSync(stateFile, 'utf8'), /last_result=disabled/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
