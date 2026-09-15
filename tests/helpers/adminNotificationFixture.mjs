/*
 * Настоящий helper уведомлений и CGI исполняются в удаляемой .build-папке.
 * Авторизация/IP и часы — модели, файловые операции и flock на Linux настоящие.
 * Fault-tool обязан оставить trace. Системный sh не обходит PATH-подстановки;
 * Windows проверяет только последовательную модель, не POSIX-права/конкуренцию.
 * Не меняет роутер, не отправляет Telegram и не доказывает физическую доставку.
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { runtimeTimeout, completedProcess } from './runtimeProcess.mjs';
import { shellTestPath } from '../../tools/quality/testEnvironment.mjs';
const repoRoot = resolve(import.meta.dirname, '../..');
const sourceRoot = process.env.SHEEPFOLD_NOTIFICATION_TEST_SOURCE || repoRoot;
const packageRoot = join(sourceRoot, 'package/luci-app-sheepfold-family-internet-control/root');
export const notificationNow = 1789016400;
export function createNotificationFixture() {
  const parent = join(repoRoot, '.build/test-fixtures');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'admin-notification-'));
  const bin = join(root, 'bin'), queue = join(root, 'queue with spaces'), actions = join(root, 'actions');
  for (const p of [bin, queue]) mkdirSync(p);
  writeFileSync(actions, '');
  const pathForShell = (p) => shellTestPath(p, { cwd: repoRoot });
  function put(name, body) { const p = join(bin, name); writeFileSync(p, body); chmodSync(p, 0o755); }
  const relocate = (text) => text.replaceAll('/usr/libexec/sheepfold', pathForShell(bin));
  for (const name of ['sheepfold-admin-notification', 'sheepfold-hash-common', 'sheepfold-lock-common'])
    put(name, relocate(readFileSync(join(packageRoot, 'usr/libexec/sheepfold', name), 'utf8')));
  put('test-cgi', relocate(readFileSync(join(packageRoot, 'www/cgi-bin/sheepfold-api'), 'utf8')));
  put('sheepfold-token-common', '# Auth is intentionally outside this fixture.\n');
  put('sheepfold-api-rate-limit', '#!/bin/sh\nexit 0\n');
  put('sheepfold-home-network', '#!/bin/sh\nexit 0\n');
  put('sheepfold-router-control', '#!/bin/sh\nprintf "login=TestParent\\ndevice_id=1\\nmac=02:00:00:00:00:01\\n"\n');
  put('date', '#!/bin/sh\nprintf "%s\\n" "${TEST_NOW:-1789016400}"\n');
  put('telegram', '#!/bin/sh\nprintf "telegram\\n" >> "$TEST_NOTICE_ACTIONS"\n');
  if (process.platform === 'win32') put('flock', '#!/bin/sh\nexit 0\n');
  function command(name, args = [], extra = {}) {
    return { shell: process.platform === 'win32' ? 'bash' : 'sh', args: ['-c',
      'PATH="$1:$PATH"; export PATH; shift; exec "$@"', 'notification-fixture', pathForShell(bin),
      pathForShell(join(bin, name)), ...args], options: {
      cwd: repoRoot, encoding: 'utf8', timeout: runtimeTimeout(15000),
      env: { ...process.env, SHEEPFOLD_NOTIFICATION_DIR: pathForShell(queue),
        SHEEPFOLD_TELEGRAM_HELPER: pathForShell(join(bin, 'telegram')),
        TEST_NOTICE_ACTIONS: pathForShell(actions), TEST_BARRIER: pathForShell(join(root, 'release')),
        REQUEST_METHOD: 'GET', PATH_INFO: '/notifications', REMOTE_ADDR: '192.168.7.20',
        HTTP_AUTHORIZATION: 'Bearer synthetic', CONTENT_LENGTH: '0', ...extra },
    } };
  }
  function run(name, args = [], extra = {}) { const c = command(name, args, extra); return completedProcess(spawnSync(c.shell, c.args, c.options), 'notification fixture'); }
  function start(args = [], extra = {}) {
    const c = command('sheepfold-admin-notification', args, extra);
    const child = spawn(c.shell, c.args, c.options);
    let stdout = '', stderr = '';
    child.stdout.on('data', (x) => { stdout += x; }); child.stderr.on('data', (x) => { stderr += x; });
    const done = new Promise((res, rej) => { child.once('error', rej); child.once('close', (status) => res({ status, stdout, stderr })); });
    return { child, done };
  }
  function seed(fields = {}) {
    const key = fields.dedupe_key ?? 'key-1', time = fields.created_at ?? notificationNow - 10;
    const id = fields.id ?? `${time}-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
    const data = { id, type: 'system', dedupe_key: key, title: 'Семейный роутер 🦊',
      message: 'Список временно недоступен', created_at: time, ...fields };
    const path = join(queue, `${id}.notification`);
    writeFileSync(path, Object.entries(data).map(([k, v]) => `${k}=${v}\n`).join(''), { mode: 0o600 });
    if (Number.isFinite(Number(time))) utimesSync(path, Number(time), Number(time));
    return path;
  }
  return { root, bin, queue, actions, put, run, start, seed, pathForShell,
    enqueue: (key = 'new-key', title = 'Название', message = 'Новое событие', extra = {}) =>
      run('sheepfold-admin-notification', ['enqueue', 'system', key, title, message], extra),
    list: (extra = {}) => run('sheepfold-admin-notification', ['list'], extra),
    request: (extra = {}) => run('test-cgi', [], extra),
    traces: () => readFileSync(actions, 'utf8'),
    records: () => readdirSync(queue).filter((p) => p.endsWith('.notification')),
    text: (p) => existsSync(p) ? readFileSync(p, 'utf8') : '',
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}
