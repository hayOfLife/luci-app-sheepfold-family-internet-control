/*
 * Изолирует настоящий shell backend от роутера: UCI, nft, авторизация и DHCP
 * заменяются локальными fixtures; логика helper-скриптов не переписывается
 * Изменяет только временную папку .build и удаляет её после теста
 * Проверяет команды и сгенерированные правила, но не реальный сетевой трафик
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runtimeTimeout, completedProcess } from './runtimeProcess.mjs';
import { shellTestPath } from '../../tools/quality/testEnvironment.mjs';

export const repoRoot = resolve(import.meta.dirname, '../..');
export const runtimeRoot = join(repoRoot, 'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold');
export const testMac = '02:00:00:00:00:11';
export const testIp = '192.168.7.20';
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
export const hostHasFlock = spawnSync('sh', ['-c', 'command -v flock >/dev/null 2>&1']).status === 0;

export function createRouterFixture(values = {}) {
  const parent = join(repoRoot, '.build', 'test-fixtures');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'access-regression-'));
  const bin = join(root, 'bin');
  const state = join(root, 'state');
  const runtime = join(root, 'runtime');
  const shellPath = (value) => shellTestPath(value, { cwd: repoRoot, allowedRoot: root });
  for (const directory of [bin, state, runtime]) mkdirSync(directory);
  const nftLog = join(root, 'nft.log');
  const callLog = join(root, 'calls.log');
  const leases = join(root, 'leases');
  const arp = join(root, 'arp');
  writeFileSync(leases, `2000000000 ${testMac} ${testIp} synthetic *\n`);
  writeFileSync(arp, '');
  writeFileSync(callLog, '');
  const executable = (name, body) => {
    const path = join(bin, name);
    writeFileSync(path, body);
    chmodSync(path, 0o755);
  };
  const names = ['sheepfold-firewall', 'sheepfold-client-status-effective', 'sheepfold-api-client-status',
    'sheepfold-api-legacy', 'sheepfold-schedule-evaluator', 'sheepfold-lib-access-policy',
    'sheepfold-lib-form', 'sheepfold-hash-common', 'sheepfold-lock-common', 'sheepfold-log-common'];
  for (const name of names) {
    let body = readFileSync(join(runtimeRoot, name), 'utf8')
      .replaceAll('/usr/libexec/sheepfold', shellPath(bin))
      .replaceAll('/tmp/sheepfold', shellPath(runtime))
      .replaceAll('/tmp/dhcp.leases', shellPath(leases))
      .replaceAll('/proc/net/arp', shellPath(arp));
    executable(name, body);
  }
  executable('sheepfold-token-common', '# Проверяется обработчик после авторизации\n');
  executable('logger', '#!/bin/sh\nexit 0\n');
  if (!hostHasFlock) executable('flock', '#!/bin/sh\nexit 0\n');
  executable('sheepfold-device-id', '#!/bin/sh\nprintf 1\n');
  executable('nft', `#!/bin/sh
case "$1" in
  list) exit 0 ;;
  -f) cp "$2" "$TEST_NFT_LOG" ;;
  *) exit 2 ;;
esac
`);
  executable('sheepfold-router-control', `#!/bin/sh
if [ "$1" = client-status ]; then
  exec ${quote(shellPath(join(bin, 'sheepfold-client-status-effective')))} "$2"
fi
printf '%s\\n' "$*" >> "$TEST_CALL_LOG"
printf 'OK\\n'
`);
  function setValues(nextValues) {
    const getCases = Object.entries(nextValues).map(([key, value]) =>
      `      ${quote(key)}) printf '%s' ${quote(value)} ;;`).join('\n');
    const showCases = ['sheepfold', 'firewall', 'network'].map((config) => {
      const lines = Object.entries(nextValues).filter(([key]) => key.startsWith(`${config}.`))
        .map(([key, value]) => `${key}=${value}`).join('\n');
      return `      ${quote(config)}) printf '%s\\n' ${quote(lines)} ;;`;
    }).join('\n');
    executable('uci', `#!/bin/sh
[ "$1" != -q ] || shift
case "$1" in
  get) case "$2" in
${getCases}
      *) exit 1 ;;
    esac ;;
  show) case "$2" in
${showCases}
      *) exit 1 ;;
    esac ;;
  *) exit 2 ;;
esac
`);
  }
  setValues(values);
  function run(name, args = [], options = {}) {
    const command = process.platform === 'win32' ? 'bash' : 'sh';
    const commandArgs = ['-c',
      'PATH="$1:$PATH"; export PATH; shift; exec "$@"', 'sheepfold-router-fixture',
      shellPath(bin), shellPath(join(bin, name)), ...args];
    return completedProcess(spawnSync(command, commandArgs, {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: runtimeTimeout(20000),
      input: options.input || '',
      env: {
        ...process.env,
        PATH: process.env.PATH || '',
        TEST_NFT_LOG: shellPath(nftLog), TEST_CALL_LOG: shellPath(callLog),
        SHEEPFOLD_AUTHENTICATED_ADMIN_LOGIN: 'synthetic-parent',
        SHEEPFOLD_FIREWALL_LOCK_HELD: '1',
        SHEEPFOLD_FIREWALL_STATE_DIR: shellPath(state),
        SHEEPFOLD_DOMAIN_POLICY_ACTIVE: shellPath(join(root, 'missing-domain-policy')),
        SHEEPFOLD_HOME_NETWORK: shellPath(join(root, 'missing-home-network')),
        SHEEPFOLD_SCHEDULE_EVALUATOR: shellPath(join(bin, 'sheepfold-schedule-evaluator')),
        SHEEPFOLD_NOW_WEEKDAY: 'mon', SHEEPFOLD_NOW_MINUTES: '600',
        REMOTE_ADDR: testIp, REQUEST_METHOD: 'GET', QUERY_STRING: '', CONTENT_LENGTH: '0',
        ...options.env,
      },
    }), `router fixture ${name}`);
  }
  return {
    root, bin, state, runtime, run, setValues, shellPath,
    calls: () => readFileSync(callLog, 'utf8').trim().split('\n').filter(Boolean),
    batch: () => existsSync(nftLog) ? readFileSync(nftLog, 'utf8') : '',
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

export function parseCgi(result) {
  completedProcess(result, 'CGI fixture');
  if (result.status !== 0) throw new Error(`CGI exit ${result.status}: ${result.stderr}`);
  const header = result.stdout.split(/\r?\n\r?\n/)[0];
  const text = result.stdout.slice(result.stdout.search(/\r?\n\r?\n/) + (result.stdout.includes('\r\n\r\n') ? 4 : 2));
  return { status: Number(header.match(/^Status: (\d+)/m)?.[1]), body: JSON.parse(text), header };
}

export const basePolicy = {
  'sheepfold.global': 'sheepfold', 'sheepfold.global.new_device_policy': 'allow',
  'sheepfold.global.block_on_boot': '0', 'sheepfold.global.lan_firewall_zones': 'lan',
  'firewall.lan': 'zone', 'firewall.lan.name': 'lan', 'firewall.lan.network': 'lan',
  'network.lan.device': 'br-lan', 'sheepfold.no_restrictions.name': 'No restrictions',
};
export const childPolicy = {
  'sheepfold.child': 'device', 'sheepfold.child.mac': testMac, 'sheepfold.child.id': '1',
  'sheepfold.child.name': 'Synthetic child', 'sheepfold.child.status': 'restricted',
};
