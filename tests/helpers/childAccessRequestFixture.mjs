/*
 * Изолирует очередь просьб и настоящий CGI/генератор ID в .build. UCI/DHCP,
 * часы и авторизация синтетические; shell-код переносится только по путям.
 * Системный sh (Git Bash на Windows) не обходит fault-tools встроенными applet.
 * Отказ подтверждается журналом вызова, все файлы удаляются close(). Не проверяет
 * native UCI, uhttpd, доставку Android-уведомлений или разрешение реального трафика.
 * Windows использует только последовательную модель flock; настоящая конкуренция
 * и Unix-права проверяются отдельными Linux-сценариями, без подмены результата.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { shellTestPath } from '../../tools/quality/testEnvironment.mjs';

const repoRoot = resolve(import.meta.dirname, '../..');
const sourceRoot = process.env.SHEEPFOLD_REQUEST_TEST_SOURCE || repoRoot;
const packageRoot = join(sourceRoot, 'package/luci-app-sheepfold-family-internet-control/root');
export const requestNow = 1788955200;
export const requestIp = '192.168.7.20';
export const requestMac = '02:00:00:00:00:42';
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
export const requestValues = {
  'sheepfold.global': 'sheepfold', 'sheepfold.global.next_device_id': '43',
  'sheepfold.child': 'device', 'sheepfold.child.mac': requestMac,
  'sheepfold.child.id': '42', 'sheepfold.child.name': 'Учебный телефон 🦊',
  'sheepfold.child.admin_device': '0', 'sheepfold.parent': 'administrator',
  'sheepfold.parent.login': 'TestParent', 'sheepfold.parent.allow_child_access_requests': '1',
};
export function createRequestFixture(values = {}) {
  const parent = join(repoRoot, '.build/test-fixtures');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'child-request-'));
  const bin = join(root, 'bin');
  const runtime = join(root, 'runtime');
  const queue = join(runtime, 'access-requests');
  for (const path of [bin, queue]) mkdirSync(path, { recursive: true });
  const pathForShell = (value) => shellTestPath(value, { cwd: repoRoot });
  const actions = join(root, 'actions');
  const leases = join(root, 'leases');
  const arp = join(root, 'arp');
  writeFileSync(actions, '');
  writeFileSync(leases, `${requestNow + 1000} ${requestMac} ${requestIp} child *\n`);
  writeFileSync(arp, '');
  const put = (name, text) => {
    writeFileSync(join(bin, name), text); chmodSync(join(bin, name), 0o755);
  };
  const relocate = (text) => text.replaceAll('/usr/libexec/sheepfold', pathForShell(bin))
    .replaceAll('/tmp/sheepfold', pathForShell(runtime))
    .replaceAll('/tmp/dhcp.leases', pathForShell(leases)).replaceAll('/proc/net/arp', pathForShell(arp));
  for (const name of ['sheepfold-access-request', 'sheepfold-device-id', 'sheepfold-lock-common'])
    put(name, relocate(readFileSync(join(packageRoot, 'usr/libexec/sheepfold', name), 'utf8')));
  put('test-cgi', relocate(readFileSync(join(packageRoot, 'www/cgi-bin/sheepfold-api'), 'utf8')));
  put('sheepfold-token-common', '# Auth is outside this fixture; the CGI gate still runs.\n');
  put('sheepfold-api-rate-limit', '#!/bin/sh\nexit 0\n');
  put('sheepfold-home-network', '#!/bin/sh\nexit 0\n');
  put('sheepfold-router-control', '#!/bin/sh\nprintf "login=TestParent\\ndevice_id=1\\nmac=02:00:00:00:00:01\\n"\n');
  put('date', '#!/bin/sh\nprintf "%s\\n" "${TEST_NOW:-1788955200}"\n');
  put('logger', '#!/bin/sh\nprintf "syslog\\n" >> "$TEST_REQUEST_ACTIONS"\nexit 0\n');
  put('sheepfold-log', '#!/bin/sh\nprintf "log\\n" >> "$TEST_REQUEST_ACTIONS"\nexit 0\n');
  function setValues(next) {
    const state = { ...requestValues, ...next };
    const get = Object.entries(state).filter(([, value]) => value !== null).map(([key, value]) =>
      `    ${quote(key)}) printf '%s' ${quote(value)} ;;`).join('\n');
    const show = Object.entries(state).filter(([, value]) => value !== null)
      .map(([key, value]) => `${key}=${value}`).join('\n');
    put('uci', `#!/bin/sh
[ "$1" != -q ] || shift
case "$1" in
get) case "$2" in
${get}
*) exit 1 ;; esac ;;
show) printf '%s\\n' ${quote(show)} ;;
set|commit|add_list|delete) printf 'uci %s\\n' "$*" >> "$TEST_REQUEST_ACTIONS" ;;
*) exit 2 ;;
esac\n`);
  }
  setValues(values);
  if (process.platform === 'win32') put('flock', '#!/bin/sh\nexit 0\n');
  function run(name, args = [], extra = {}) {
    return spawnSync(process.platform === 'win32' ? 'bash' : 'sh', ['-c',
      'PATH="$1:$PATH"; export PATH; shift; exec "$@"', 'child-request-fixture',
      pathForShell(bin), pathForShell(join(bin, name)), ...args], {
      cwd: repoRoot, encoding: 'utf8', timeout: 12000,
      env: { ...process.env, TEST_REQUEST_ACTIONS: pathForShell(actions),
        REQUEST_METHOD: 'GET', PATH_INFO: '/access-requests', REMOTE_ADDR: requestIp,
        HTTP_AUTHORIZATION: 'Bearer synthetic', CONTENT_LENGTH: '0', ...extra },
    });
  }
  function seed(fields = {}, filename = `${requestNow}-42.request`) {
    const data = { id: `${requestNow}-42`, created_at: requestNow, device_id: '42',
      device_name: 'Учебный телефон 🦊', ip: requestIp, mac: requestMac, ...fields };
    const path = join(queue, filename);
    writeFileSync(path, Object.entries(data).map(([key, value]) => `${key}=${value}\n`).join(''));
    return path;
  }
  return { root, bin, runtime, queue, actions, leases, arp, put, run, seed, setValues, pathForShell,
    create: (extra = {}) => run('sheepfold-access-request', ['create', requestIp], extra),
    list: () => run('sheepfold-access-request', ['list', 'TestParent']),
    request: (extra = {}) => run('test-cgi', [], extra),
    traces: () => readFileSync(actions, 'utf8'),
    records: () => readdirSync(queue).filter((name) => name.endsWith('.request')),
    // Downstream fault tests isolate logging/storage from ID registration.
    stubId: (status = 0) => put('sheepfold-device-id', `#!/bin/sh\nprintf 'id %s\\n' "$*" >> "$TEST_REQUEST_ACTIONS"\nprintf '42\\n'\nexit ${status}\n`),
    text: (path) => existsSync(path) ? readFileSync(path, 'utf8') : '',
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}
