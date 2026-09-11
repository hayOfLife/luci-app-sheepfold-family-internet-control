/*
 * Разбирает собранный тестовый IPK и защищает Unix executable-права package hooks,
 * CGI и backend-файлов. Работает только во временном каталоге; успешный разбор не
 * доказывает, что opkg конкретной прошивки установит и запустит пакет.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildScript = resolve(repoRoot, 'scripts/build-test-ipk.py');
let cachedIpkPath = '';

function buildTestIpk() {
  if (cachedIpkPath) {
    return cachedIpkPath;
  }
  const preparedIpk = process.env.SHEEPFOLD_TEST_IPK || '';
  if (preparedIpk) {
    assert.ok(existsSync(preparedIpk), `SHEEPFOLD_TEST_IPK does not exist: ${preparedIpk}`);
    cachedIpkPath = preparedIpk;
    return cachedIpkPath;
  }
  const testOutDir = mkdtempSync(join(tmpdir(), 'sheepfold-ipk-'));
  const result = spawnSync('python', [buildScript, '--out-dir', testOutDir], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  const line = String(result.stdout).trim().split(/\r?\n/).find((entry) => entry.endsWith('.ipk'));
  assert.ok(line, 'build-test-ipk.py must print the generated .ipk path');
  cachedIpkPath = line.trim();
  return cachedIpkPath;
}

function tarEntries(buffer) {
  const entries = new Map();
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (start, length) => header.subarray(start, start + length)
      .toString('utf8').replace(/\0.*$/s, '').trim();
    const name = text(0, 100);
    const mode = Number.parseInt(text(100, 8) || '0', 8);
    const size = Number.parseInt(text(124, 12) || '0', 8);
    const dataStart = offset + 512;
    entries.set(name, { mode, data: buffer.subarray(dataStart, dataStart + size) });
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function tarMode(ipkPath, memberPath) {
  // Читаем тестовый gzip-tar IPK прямо в Node: так проверка не зависит от
  // разрешения Windows sandbox на запуск вложенного процесса Python.
  const outer = tarEntries(gunzipSync(readFileSync(ipkPath)));
  const dataArchive = outer.get('./data.tar.gz');
  assert.ok(dataArchive, 'IPK does not contain ./data.tar.gz');
  const inner = tarEntries(gunzipSync(dataArchive.data));
  const member = inner.get(memberPath);
  assert.ok(member, `IPK does not contain ${memberPath}`);
  return `0o${(member.mode & 0o777).toString(8)}`;
}

function dataText(ipkPath, memberPath) {
  const outer = tarEntries(gunzipSync(readFileSync(ipkPath)));
  const dataArchive = outer.get('./data.tar.gz');
  assert.ok(dataArchive, 'IPK does not contain ./data.tar.gz');
  const member = tarEntries(gunzipSync(dataArchive.data)).get(memberPath);
  assert.ok(member, `IPK does not contain ${memberPath}`);
  return member.data.toString('utf8');
}

function controlMode(ipkPath, memberPath) {
  const outer = tarEntries(gunzipSync(readFileSync(ipkPath)));
  const controlArchive = outer.get('./control.tar.gz');
  assert.ok(controlArchive, 'IPK does not contain ./control.tar.gz');
  const member = tarEntries(gunzipSync(controlArchive.data)).get(memberPath);
  assert.ok(member, `IPK does not contain control member ${memberPath}`);
  return `0o${(member.mode & 0o777).toString(8)}`;
}

function controlText(ipkPath, memberPath) {
  const outer = tarEntries(gunzipSync(readFileSync(ipkPath)));
  const controlArchive = outer.get('./control.tar.gz');
  assert.ok(controlArchive, 'IPK does not contain ./control.tar.gz');
  const member = tarEntries(gunzipSync(controlArchive.data)).get(memberPath);
  assert.ok(member, `IPK does not contain control member ${memberPath}`);
  return member.data.toString('utf8');
}

describe('test IPK executable permissions', () => {
  it('ships the common journal boundary and connects both consumers', () => {
    const ipk = buildTestIpk();
    const base = './usr/libexec/sheepfold/';
    assert.match(dataText(ipk, `${base}sheepfold-log-common`), /sheepfold_log_path_check\(\)/);
    assert.match(dataText(ipk, `${base}sheepfold-log`), /\. "\$LOG_COMMON"/);
    assert.match(dataText(ipk, `${base}sheepfold-api-legacy`), /sheepfold-log-common/);
    assert.match(controlText(ipk, './postinst'), /sheepfold-log-common/);
    const uploader = dataText(ipk, `${base}sheepfold-google-drive`);
    assert.match(uploader, /sheepfold-log-common/);
    assert.match(uploader, /sheepfold-lock-common/);
    assert.match(uploader, /drive_events_snapshot\(\)/);
  });

  it('ships router-control-legacy as executable in data.tar.gz', () => {
    const ipkPath = buildTestIpk();
    const mode = tarMode(
      ipkPath,
      './usr/libexec/sheepfold/sheepfold-router-control-legacy',
    );

    assert.equal(mode, '0o755');
  });

  it('ships the IPv6 compatibility helper as executable in data.tar.gz', () => {
    const ipkPath = buildTestIpk();
    const mode = tarMode(
      ipkPath,
      './usr/libexec/sheepfold/sheepfold-ipv6-control',
      './usr/libexec/sheepfold/sheepfold-package-manager',
    );

    assert.equal(mode, '0o755');
  });

  it('ships the fw4 synchronizer as executable in data.tar.gz', () => {
    const ipkPath = buildTestIpk();
    const mode = tarMode(
      ipkPath,
      './usr/libexec/sheepfold/sheepfold-firewall',
    );

    assert.equal(mode, '0o755');
  });

  it('ships the centralized state-hash helper as executable in data.tar.gz', () => {
    const ipkPath = buildTestIpk();
    const mode = tarMode(
      ipkPath,
      './usr/libexec/sheepfold/sheepfold-hash-common',
    );

    assert.equal(mode, '0o755');
  });

  it('ships the shared device-detection lock helper in data.tar.gz', () => {
    const ipkPath = buildTestIpk();
    const mode = tarMode(
      ipkPath,
      './usr/libexec/sheepfold/sheepfold-lock-common',
    );

    assert.equal(mode, '0o755');
  });

  it('ships logical-device discovery helpers and their socket dependency', () => {
    const ipkPath = buildTestIpk();
    const ssdpMode = tarMode(
      ipkPath,
      './usr/libexec/sheepfold/sheepfold-device-ssdp',
    );
    const upnpMode = tarMode(
      ipkPath,
      './usr/libexec/sheepfold/sheepfold-device-upnp-description',
    );
    const wsdMode = tarMode(
      ipkPath,
      './usr/libexec/sheepfold/sheepfold-device-ws-discovery',
    );
    const identityMode = tarMode(
      ipkPath,
      './usr/libexec/sheepfold/sheepfold-device-identity',
    );
    const ssdpSource = dataText(
      ipkPath,
      './usr/share/sheepfold/device-ssdp.uc',
    );
    const wsdSource = dataText(
      ipkPath,
      './usr/share/sheepfold/device-ws-discovery.uc',
    );
    const control = controlText(ipkPath, './control');

    assert.equal(ssdpMode, '0o755');
    assert.equal(upnpMode, '0o755');
    assert.equal(wsdMode, '0o755');
    assert.equal(identityMode, '0o755');
    assert.match(ssdpSource, /SO_BINDTODEVICE/);
    assert.match(wsdSource, /SO_BINDTODEVICE/);
    assert.match(wsdSource, /IP_ADD_MEMBERSHIP/);
    assert.match(control, /^Depends:.*(?:^|, )ucode-mod-socket(?:,|$)/m);
  });

  it('ships the pairing diagnostic helper as executable in data.tar.gz', () => {
    const mode = tarMode(
      buildTestIpk(),
      './usr/libexec/sheepfold/sheepfold-pair-diagnostics',
    );

    assert.equal(mode, '0o755');
  });

  it('declares flock for the shared device-detection lock contract', () => {
    const control = controlText(buildTestIpk(), './control');

    assert.match(control, /^Depends:.*(?:^|, )flock(?:,|$)/m);
  });

  it('ships the emergency-site synchronizer as executable in data.tar.gz', () => {
    const ipkPath = buildTestIpk();
    const mode = tarMode(
      ipkPath,
      './usr/libexec/sheepfold/sheepfold-emergency-sites',
    );

    assert.equal(mode, '0o755');
  });

  it('ships the country-profile synchronizer and profile data', () => {
    const ipkPath = buildTestIpk();

    assert.equal(tarMode(ipkPath, './usr/libexec/sheepfold/sheepfold-country-profile'), '0o755');
    for (const country of ['ru', 'by', 'cn', 'other'])
      assert.equal(tarMode(ipkPath, `./usr/share/sheepfold/country-profiles/${country}.json`), '0o644');
  });

  it('ships the site-list runtime policy as executable in data.tar.gz', () => {
    const ipkPath = buildTestIpk();
    const mode = tarMode(
      ipkPath,
      './usr/libexec/sheepfold/sheepfold-domain-policy',
    );

    assert.equal(mode, '0o755');
  });

  it('ships the AdGuard adapter and its loopback feed as executable files', () => {
    const ipkPath = buildTestIpk();
    assert.equal(tarMode(
      ipkPath,
      './usr/libexec/sheepfold/sheepfold-adguard',
    ), '0o755');
    assert.equal(tarMode(
      ipkPath,
      './www/cgi-bin/sheepfold-adguard-list',
    ), '0o755');
  });

  it('declares jshn for the AdGuard Home API JSON parser', () => {
    const control = controlText(buildTestIpk(), './control');

    assert.match(control, /^Depends:.*(?:^|, )jshn(?:,|$)/m);
  });

  it('ships the schedule evaluator as executable in data.tar.gz', () => {
    const ipkPath = buildTestIpk();
    const mode = tarMode(
      ipkPath,
      './usr/libexec/sheepfold/sheepfold-schedule-evaluator',
    );

    assert.equal(mode, '0o755');
  });

  it('ships the child access request helper as executable in data.tar.gz', () => {
    const ipkPath = buildTestIpk();
    const mode = tarMode(
      ipkPath,
      './usr/libexec/sheepfold/sheepfold-access-request',
    );

    assert.equal(mode, '0o755');
  });

  it('ships the API rate-limit helper as executable in data.tar.gz', () => {
    const ipkPath = buildTestIpk();
    const mode = tarMode(
      ipkPath,
      './usr/libexec/sheepfold/sheepfold-api-rate-limit',
    );

    assert.equal(mode, '0o755');
  });

  it('ships the feedback helper as executable in data.tar.gz', () => {
    const ipkPath = buildTestIpk();
    const mode = tarMode(
      ipkPath,
      './usr/libexec/sheepfold/sheepfold-feedback',
    );

    assert.equal(mode, '0o755');
  });

  it('ships the administrator notification queue as executable in data.tar.gz', () => {
    const ipkPath = buildTestIpk();
    const mode = tarMode(
      ipkPath,
      './usr/libexec/sheepfold/sheepfold-admin-notification',
    );

    assert.equal(mode, '0o755');
  });

  it('ships the child SIM monitor as executable in data.tar.gz', () => {
    const ipkPath = buildTestIpk();
    const mode = tarMode(
      ipkPath,
      './usr/libexec/sheepfold/sheepfold-sim-monitor',
    );

    assert.equal(mode, '0o755');
  });

  it('ships the child Wi-Fi monitor as executable in data.tar.gz', () => {
    const ipkPath = buildTestIpk();
    const mode = tarMode(
      ipkPath,
      './usr/libexec/sheepfold/sheepfold-child-wifi-monitor',
    );

    assert.equal(mode, '0o755');
  });

  it('requires the administrator notification helper in Standard runtime hardening', () => {
    const ipkPath = buildTestIpk();
    const hardening = dataText(
      ipkPath,
      './usr/libexec/sheepfold/sheepfold-runtime-hardening',
    );

    assert.match(hardening, /sheepfold-admin-notification/);
    assert.match(hardening, /sheepfold-sim-monitor/);
    assert.match(hardening, /sheepfold-child-wifi-monitor/);
    assert.match(hardening, /sheepfold-hash-common/);
    assert.match(hardening, /sheepfold-lock-common/);
    assert.match(hardening, /sheepfold-ipv6-control/);
    assert.match(hardening, /sheepfold-domain-policy/);
    assert.match(hardening, /sheepfold-adguard/);
    assert.match(hardening, /sheepfold-adguard-list/);
  });

  it('ships an executable uninstall hook that removes Sheepfold cron jobs', () => {
    const ipkPath = buildTestIpk();
    assert.equal(controlMode(ipkPath, './prerm'), '0o755');
    const packagedPrerm = controlText(ipkPath, './prerm');
    const buildPy = readFileSync(buildScript, 'utf8');
    const makefile = readFileSync(
      resolve(repoRoot, 'package/luci-app-sheepfold-family-internet-control/Makefile'),
      'utf8',
    );
    assert.match(buildPy, /sheepfold-site-lists cron-remove/);
    assert.match(buildPy, /sheepfold-domain-policy clear/);
    assert.match(buildPy, /\$\{1:-remove\}" != upgrade[\s\S]*sheepfold-ipv6-control release/);
    assert.match(makefile, /sheepfold-site-lists cron-remove/);
    assert.match(makefile, /sheepfold-domain-policy clear/);
    assert.match(makefile, /\$\$\{1:-remove\}" != upgrade[\s\S]*sheepfold-ipv6-control release/);
    assert.match(packagedPrerm, /\$\{1:-remove\}" != upgrade[\s\S]*sheepfold-ipv6-control release/);
    assert.match(packagedPrerm, /logger -t sheepfold[\s\S]*IPv6/);

    const syntax = spawnSync('sh', ['-n'], {
      cwd: repoRoot,
      input: packagedPrerm,
      encoding: 'utf8',
    });
    assert.equal(syntax.status, 0, syntax.error?.message || syntax.stderr || syntax.stdout);
  });

  it('postinst chmods all libexec helpers after install', () => {
    const buildPy = readFileSync(buildScript, 'utf8');
    const buildSh = readFileSync(resolve(repoRoot, 'scripts/build-test-ipk.sh'), 'utf8');
    const makefile = readFileSync(
      resolve(repoRoot, 'package/luci-app-sheepfold-family-internet-control/Makefile'),
      'utf8',
    );

    assert.match(buildPy, /find \/usr\/libexec\/sheepfold -type f -exec chmod 0755/);
    assert.match(buildSh, /build-test-ipk\.py/);
    assert.match(makefile, /find \/usr\/libexec\/sheepfold -type f -exec chmod 0755/);
  });

  it('keeps the updater config backup until opkg returns control', () => {
    const postinst = controlText(buildTestIpk(), './postinst');
    assert.doesNotMatch(postinst, /rm -f[^\n]*sheepfold-config-before-update/);
  });
});
