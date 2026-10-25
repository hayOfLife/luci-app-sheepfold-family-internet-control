/*
 * Ручная проверка настоящего AGH: закрытый bootstrap, начальный пароль и профиль
 * Использует только временные файлы .build и случайные loopback-порты, останавливает
 * свои процессы; не устанавливает службы и не доказывает OpenWrt procd или DNS LAN
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const executable = process.argv[2];
if (!executable) throw new Error('Usage: node tools/router-testing/adguardNativeProbe.mjs ABSOLUTE_AGH_BINARY');
const repo = resolve(import.meta.dirname, '../..');
const source = join(repo, 'package/luci-app-sheepfold-family-internet-control/root/usr/share/sheepfold/adguard-install-profile.json');
mkdirSync(join(repo, '.build'), { recursive: true });
const root = mkdtempSync(join(repo, '.build/agh-native-'));
let child;
let stopped;
let output = '';

async function port() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const value = server.address().port;
  await new Promise((done) => server.close(done));
  return value;
}

async function stop() {
  if (!child) return;
  child.kill();
  await stopped;
  child = null;
}

async function start(config, work, webPort) {
  mkdirSync(work, { recursive: true });
  mkdirSync(join(work, 'data'), { recursive: true });
  // На Windows Go создаёт закрытые ACL для новых БД, поэтому fixture создаёт свои файлы заранее
  for (const name of ['sessions.db', 'stats.db']) {
    const path = join(work, 'data', name);
    if (!existsSync(path)) writeFileSync(path, '');
  }
  output = '';
  child = spawn(resolve(executable), ['--config', config, '--work-dir', work,
    '--web-addr', `127.0.0.1:${webPort}`, '--no-check-update'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  stopped = once(child, 'close');
  child.stdout.on('data', (data) => { output = (output + data).slice(-8000); });
  child.stderr.on('data', (data) => { output = (output + data).slice(-8000); });
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null) throw new Error(`AGH stopped: ${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${webPort}/control/status`,
        { signal: AbortSignal.timeout(1000), redirect: 'error' });
      if (response.status === 401) return;
    } catch { /* Процесс ещё может открывать свой loopback-сокет */ }
    await delay(100);
  }
  throw new Error(`AGH did not become ready: ${output}`);
}

try {
  const profile = JSON.parse(readFileSync(source, 'utf8'));
  const webPort = await port();
  const dnsPort = await port();
  profile.http.address = `127.0.0.1:${webPort}`;
  profile.dns.port = dnsPort;
  // Ручной стенд не скачивает фильтры и не принимает запросы реальных клиентов
  profile.filters = [];
  const config = join(root, 'guard.json');
  writeFileSync(config, JSON.stringify(profile));
  const work = join(root, 'guard-work');
  mkdirSync(work);
  const check = spawnSync(resolve(executable), ['--check-config', '--config', config, '--work-dir', work],
    { encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(check.status, 0, check.error?.message || check.stderr);
  console.log('PASS profileSchema');
  await start(config, work, webPort);
  const denied = await fetch(`http://127.0.0.1:${webPort}/control/status`, {
    headers: { Authorization: `Basic ${Buffer.from('admin:password').toString('base64')}` },
    signal: AbortSignal.timeout(2000), redirect: 'error',
  });
  assert.equal(denied.status, 401);
  console.log('PASS bootstrapAuthClosed');
  await stop();

  const installer = readFileSync(join(repo, 'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-adguard-install'), 'utf8');
  const hash = installer.match(/^HASH='(\$2[aby]\$10\$[./A-Za-z0-9]{53})'/m)?.[1];
  assert.ok(hash, 'Expected the checked-in default password hash');

  profile.users[0].password = hash;
  writeFileSync(config, JSON.stringify(profile));
  await start(config, join(root, 'configured-work'), webPort);
  const authorized = await fetch(`http://127.0.0.1:${webPort}/control/status`, {
    headers: { Authorization: `Basic ${Buffer.from('admin:password').toString('base64')}` },
    signal: AbortSignal.timeout(2000), redirect: 'error',
  });
  assert.equal(authorized.status, 200);
  assert.equal((await authorized.json()).dns_port, dnsPort);
  console.log('PASS configuredAuth');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await stop();
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.error(`Fixture cleanup failed (${error.code}): ${root}`);
    process.exitCode = 1;
  }
}
