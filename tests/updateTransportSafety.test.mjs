/*
 * Проверяет обновлятор с настоящим тестовым IPK и подменёнными HTTP/UCI/package manager
 * Меняет только fixture в .build/test-tmp; сеть и установленный роутер не затрагивает
 * Успех подтверждает URL/ошибки/откат модели, но не подпись выпуска или живой OpenWrt
 */
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const updater = resolve(
  repoRoot,
  'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-updater',
);
const telegram = resolve(
  repoRoot,
  'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-telegram-bot',
);
const testTmp = join(repoRoot, '.build', 'test-tmp');
mkdirSync(testTmp, { recursive: true });
const flockAvailable = spawnSync('sh', ['-c', 'command -v flock >/dev/null 2>&1']).status === 0;
const lockShim = join(testTmp, 'update-lock-shim.sh');
// Git Bash не поставляет flock: transport-тесты подменяют только lock, отдельный lock-тест требует Linux
if (!flockAvailable) writeFileSync(lockShim, 'sheepfold_lock_acquire() { exec 9>"$1"; }\nsheepfold_lock_release() { exec 9>&-; }\n');

const posix = (path) => path
  .replaceAll('\\', '/')
  .replace(/^([A-Za-z]):\//, (_, drive) => `/${drive.toLowerCase()}/`);

const lockEnv = flockAvailable ? {} : { SHEEPFOLD_LOCK_COMMON: posix(relative(repoRoot, lockShim)) };

function executable(path, body) {
  writeFileSync(path, body.replace(/^\n/, ''), 'utf8');
  chmodSync(path, 0o755);
}

let cachedTestIpk = '';

function testIpk() {
  if (cachedTestIpk) return cachedTestIpk;
  if (process.env.SHEEPFOLD_TEST_IPK) {
    assert.ok(existsSync(process.env.SHEEPFOLD_TEST_IPK));
    cachedTestIpk = process.env.SHEEPFOLD_TEST_IPK;
    return cachedTestIpk;
  }

  const outDir = mkdtempSync(join(testTmp, 'sheepfold-updater-ipk-'));
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const result = spawnSync(python, [
    resolve(repoRoot, 'scripts/build-test-ipk.py'),
    '--variant', 'sheepfold',
    '--out-dir', outDir,
  ], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  cachedTestIpk = result.stdout.trim().split(/\r?\n/).find((line) => line.endsWith('.ipk')) || '';
  assert.ok(cachedTestIpk && existsSync(cachedTestIpk));
  return cachedTestIpk;
}

function runInstallScenario({
  packageSource = testIpk(),
  assetName = basename(packageSource),
  installExit = 23,
  confirmInstalledVersion = false,
  packageUrl,
  command = 'install',
  beta = '0',
  newer = true,
  fetchExit = 0,
  cancelAfterDownload = false,
  lockHeld = false,
} = {}) {
  const root = mkdtempSync(join(testTmp, 'sheepfold-updater-install-'));
  const bin = join(root, 'bin');
  const runtime = join(root, 'runtime');
  const work = join(root, 'work');
  const config = join(root, 'sheepfold.config');
  const release = join(root, 'release.json');
  const opkgLog = join(root, 'opkg.log');
  const opkgState = join(root, 'opkg.state');
  const betaState = join(root, 'beta.state');
  const fetchLog = join(root, 'fetch.log');
  mkdirSync(bin, { recursive: true });
  mkdirSync(runtime, { recursive: true });
  writeFileSync(betaState, beta);
  writeFileSync(fetchLog, '');
  writeFileSync(config, 'config original\n', 'utf8');
  const releasePackageUrl = packageUrl
    || `https://github.com/hayOfLife/luci-app-sheepfold-family-internet-control/releases/download/test/${assetName}`;
  writeFileSync(release, JSON.stringify({
    tag_name: 'test',
    browser_download_url: releasePackageUrl,
  }) + '\n', 'utf8');
  const expectedVersion = assetName.match(/_([^_]+)_all\.ipk$/)?.[1] || 'unknown';

  executable(join(bin, 'uci'), `
#!/bin/sh
case "$*" in
  *beta_testing*) cat "$BETA_STATE" ;;
  *product_variant*) printf sheepfold ;;
  *language*) printf ru ;;
  *) exit 1 ;;
esac
`);
  executable(join(bin, 'uclient-fetch'), `
#!/bin/sh
output=''
url=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -O) shift; output="$1" ;;
    http://*|https://*) url="$1" ;;
  esac
  shift
done
printf '%s\\n' "$url" >> "$FETCH_LOG"
[ "$FETCH_EXIT" = 0 ] || exit "$FETCH_EXIT"
case "$url" in
  "$UPDATE_API_URL") cp "$RELEASE_SOURCE" "$output" ;;
  "$RELEASE_PACKAGE_URL")
    cp "$PACKAGE_SOURCE" "$output"
    [ "$CANCEL_AFTER_DOWNLOAD" != 1 ] || printf 0 > "$BETA_STATE"
    ;;
  *) exit 9 ;;
esac
`);
  executable(join(bin, 'opkg'), `
#!/bin/sh
case "$1" in
  status)
    version='0.0.0-1'
    [ ! -s "$OPKG_STATE" ] || version="$(cat "$OPKG_STATE")"
    printf 'Package: luci-app-sheepfold-family-internet-control\nVersion: %s\nStatus: install user installed\n' "$version"
    ;;
  compare-versions) [ "$NEWER" = 1 ] ;;
  install)
    printf 'install %s\n' "$2" >> "$OPKG_LOG"
    printf 'config changed by failed package\n' > "$CONFIG_FILE"
    if [ "$INSTALL_EXIT" = 0 ] && [ "$CONFIRM_INSTALLED_VERSION" = 1 ]; then
      printf '%s\n' "$EXPECTED_VERSION" > "$OPKG_STATE"
    fi
    exit "$INSTALL_EXIT"
    ;;
  *) exit 2 ;;
esac
`);

  const path = process.platform === 'win32'
    ? `${bin};C:\\Program Files\\Git\\usr\\bin;C:\\Program Files\\Git\\bin;${process.env.PATH}`
    : `${bin}:${process.env.PATH}`;
  const bash = process.platform === 'win32'
    ? 'C:\\Program Files\\Git\\bin\\bash.exe'
    : 'bash';
  const updateApiUrl = 'https://api.github.com/repos/hayOfLife/luci-app-sheepfold-family-internet-control/releases/latest';
  const args = lockHeld ? ['-c', 'exec 9>"$UPDATE_LOCK"; flock -n 9 || exit 90; bash "$TEST_UPDATER" "$TEST_COMMAND" 9>&-']
    : [posix(relative(repoRoot, updater)), command];
  const result = spawnSync(bash, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...lockEnv,
      PATH: path,
      UPDATE_API_URL: updateApiUrl,
      RELEASE_SOURCE: posix(relative(repoRoot, release)),
      RELEASE_PACKAGE_URL: releasePackageUrl,
      PACKAGE_SOURCE: posix(relative(repoRoot, packageSource)),
      OPKG_LOG: posix(relative(repoRoot, opkgLog)),
      OPKG_STATE: posix(relative(repoRoot, opkgState)),
      CONFIG_FILE: posix(relative(repoRoot, config)),
      INSTALL_EXIT: String(installExit),
      CONFIRM_INSTALLED_VERSION: confirmInstalledVersion ? '1' : '0',
      EXPECTED_VERSION: expectedVersion,
      TEST_UPDATER: posix(relative(repoRoot, updater)), TEST_COMMAND: command,
      UPDATE_LOCK: posix(relative(repoRoot, join(runtime, 'update.flock'))),
      BETA_STATE: posix(relative(repoRoot, betaState)),
      FETCH_LOG: posix(relative(repoRoot, fetchLog)), FETCH_EXIT: String(fetchExit),
      NEWER: newer ? '1' : '0', CANCEL_AFTER_DOWNLOAD: cancelAfterDownload ? '1' : '0',
      SHEEPFOLD_LOG_HELPER: posix(relative(repoRoot, join(root, 'missing-log'))),
      SHEEPFOLD_NOTIFICATION_HELPER: posix(relative(repoRoot, join(root, 'missing-notifier'))),
      SHEEPFOLD_UPDATE_RUNTIME_DIR: posix(relative(repoRoot, runtime)),
      SHEEPFOLD_UPDATE_WORK_DIR: posix(relative(repoRoot, work)),
      SHEEPFOLD_UPDATE_CONFIG_FILE: posix(relative(repoRoot, config)),
      SHEEPFOLD_UPDATE_MIGRATION_BACKUP: posix(relative(repoRoot, join(root, 'missing-migration'))),
      SHEEPFOLD_UPDATE_SERVICE_INIT: posix(relative(repoRoot, join(root, 'missing-service'))),
      SHEEPFOLD_UPDATE_RPCD_INIT: posix(relative(repoRoot, join(root, 'missing-rpcd'))),
    },
    encoding: 'utf8',
  });
  return { config, opkgLog, fetchLog, result, runtime };
}

function runApkInstallScenario({ metadataName = 'luci-app-sheepfold-family-internet-control' } = {}) {
  const root = mkdtempSync(join(testTmp, 'sheepfold-updater-apk-'));
  const bin = join(root, 'bin');
  const runtime = join(root, 'runtime');
  const work = join(root, 'work');
  const config = join(root, 'sheepfold.config');
  const release = join(root, 'release.json');
  const packageSource = join(root, 'router-package.apk');
  const apkLog = join(root, 'apk.log');
  const apkState = join(root, 'apk.state');
  const fetchLog = join(root, 'fetch.log');
  const jshn = join(root, 'jshn.sh');
  const expectedVersion = '9.9.9-r1';
  const routerAsset = `luci-app-sheepfold-family-internet-control-${expectedVersion}.apk`;
  const routerUrl = `https://github.com/hayOfLife/luci-app-sheepfold-family-internet-control/releases/download/test/${routerAsset}`;
  mkdirSync(bin, { recursive: true });
  writeFileSync(config, 'config original\n', 'utf8');
  writeFileSync(packageSource, 'fake OpenWrt apk container\n', 'utf8');
  writeFileSync(release, JSON.stringify({
    tag_name: 'test',
    assets: [
      { browser_download_url: 'https://github.com/hayOfLife/luci-app-sheepfold-family-internet-control/releases/download/test/sheepfold-v9.9.9.apk' },
      { browser_download_url: routerUrl },
    ],
  }, null, 2) + '\n', 'utf8');

  executable(join(bin, 'uci'), `
#!/bin/sh
case "$*" in
  *product_variant*) printf sheepfold ;;
  *language*) printf ru ;;
  *) exit 1 ;;
esac
`);
  executable(join(bin, 'uclient-fetch'), `
#!/bin/sh
output=''
url=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -O) shift; output="$1" ;;
    http://*|https://*) url="$1" ;;
  esac
  shift
done
printf '%s\n' "$url" >> "$FETCH_LOG"
case "$url" in
  "$UPDATE_API_URL") cp "$RELEASE_SOURCE" "$output" ;;
  "$RELEASE_PACKAGE_URL") cp "$PACKAGE_SOURCE" "$output" ;;
  *) exit 9 ;;
esac
`);
  executable(join(bin, 'apk'), `
#!/bin/sh
printf '%s\n' "$*" >> "$APK_LOG"
case "$1" in
  --print-arch) printf 'aarch64\n' ;;
  info)
    if [ "$2" = '-e' ]; then exit 0; fi
    version='0.1.0-r1'
    [ ! -s "$APK_STATE" ] || version="$(cat "$APK_STATE")"
    printf '[\n  {\n    "version": "%s"\n  }\n]\n' "$version"
    ;;
  version) printf '>\n' ;;
  verify) exit 0 ;;
  adbdump) printf '{"info":{"name":"%s","version":"%s","arch":"noarch"}}\n' "$APK_META_NAME" "$EXPECTED_VERSION" ;;
  add)
    printf 'config changed by apk package\n' > "$CONFIG_FILE"
    printf '%s\n' "$EXPECTED_VERSION" > "$APK_STATE"
    ;;
  *) exit 2 ;;
esac
`);
  executable(jshn, `
#!/bin/sh
json_init() { :; }
json_load_file() { [ -s "$1" ]; }
json_select() { return 0; }
json_get_var() {
  case "$2" in
    name) value="$APK_META_NAME" ;;
    version) value="$EXPECTED_VERSION" ;;
    arch) value='noarch' ;;
    *) value='' ;;
  esac
  eval "$1=\\"\\$value\\""
}
`);

  const path = process.platform === 'win32'
    ? `${bin};C:\\Program Files\\Git\\usr\\bin;C:\\Program Files\\Git\\bin;${process.env.PATH}`
    : `${bin}:${process.env.PATH}`;
  const bash = process.platform === 'win32'
    ? 'C:\\Program Files\\Git\\bin\\bash.exe'
    : 'bash';
  const updateApiUrl = 'https://api.github.com/repos/hayOfLife/luci-app-sheepfold-family-internet-control/releases/latest';
  const result = spawnSync(bash, [posix(relative(repoRoot, updater)), 'install'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: path,
      ...lockEnv,
      UPDATE_API_URL: updateApiUrl,
      RELEASE_SOURCE: posix(relative(repoRoot, release)),
      RELEASE_PACKAGE_URL: routerUrl,
      PACKAGE_SOURCE: posix(relative(repoRoot, packageSource)),
      APK_LOG: posix(relative(repoRoot, apkLog)),
      APK_STATE: posix(relative(repoRoot, apkState)),
      APK_META_NAME: metadataName,
      EXPECTED_VERSION: expectedVersion,
      FETCH_LOG: posix(relative(repoRoot, fetchLog)),
      CONFIG_FILE: posix(relative(repoRoot, config)),
      SHEEPFOLD_UPDATE_RUNTIME_DIR: posix(relative(repoRoot, runtime)),
      SHEEPFOLD_UPDATE_WORK_DIR: posix(relative(repoRoot, work)),
      SHEEPFOLD_UPDATE_CONFIG_FILE: posix(relative(repoRoot, config)),
      SHEEPFOLD_UPDATE_MIGRATION_BACKUP: posix(relative(repoRoot, join(root, 'missing-migration'))),
      SHEEPFOLD_UPDATE_SERVICE_INIT: posix(relative(repoRoot, join(root, 'missing-service'))),
      SHEEPFOLD_UPDATE_RPCD_INIT: posix(relative(repoRoot, join(root, 'missing-rpcd'))),
      SHEEPFOLD_UPDATE_JSHN_LIBRARY: posix(relative(repoRoot, jshn)),
    },
    encoding: 'utf8',
  });
  return { apkLog, config, fetchLog, result, routerUrl };
}

describe('network transport safety', () => {
  it('bootstrapAndUpdaterShareABoundedReleaseUrlPolicy', () => {
    const source = readFileSync(updater, 'utf8');
    const installer = readFileSync(join(repoRoot, 'install.sh'), 'utf8');
    const functionPattern = /^trusted_package_url\(\) \{\r?\n[\s\S]*?^\}/m;
    const policy = source.match(functionPattern)[0].replaceAll('\r\n', '\n');
    assert.equal(installer.match(functionPattern)[0].replaceAll('\r\n', '\n'), policy);
    assert.ok(installer.indexOf('if ! trusted_package_url "$package_url"') <
      installer.indexOf('if ! fetch_to_file "$package_url"'));

    const repository = 'hayOfLife/luci-app-sheepfold-family-internet-control';
    const prefix = `https://github.com/${repository}/releases/download/`;
    for (const [manager, assetName] of [
      ['opkg', 'luci-app-sheepfold-family-internet-control_1.2.3-4_all.ipk'],
      ['apk', 'luci-app-sheepfold-family-internet-control-1.2.3-r4.apk'],
      ['opkg', 'luci-app-sheepfold-ai-support_1.2.3-4_all.ipk'],
      ['apk', 'luci-app-sheepfold-ai-support-1.2.3-r4.apk'],
    ]) {
      const validUrl = `${prefix}v1.2.3+test/${assetName}`;
      const cases = [
        [validUrl, 0],
        [validUrl.replace('hayOfLife/', 'kva4991/'), 1],
        [validUrl.replace('github.com/', 'github.com.evil.invalid/'), 1],
        [validUrl.replace('https:', 'http:'), 1],
        [`${prefix}${assetName}`, 1],
        [`${prefix}./${assetName}`, 1],
        [`${prefix}../${assetName}`, 1],
        [`${prefix}%2e%2e/${assetName}`, 1],
        [`${prefix}tag/extra/${assetName}`, 1],
        [`${prefix}tag\\extra/${assetName}`, 1],
        [`${prefix}tag?x=/${assetName}`, 1],
        [`${prefix}tag#fragment/${assetName}`, 1],
        [`${prefix}tag\n/${assetName}`, 1],
        [validUrl.replace(assetName, 'sheepfold-parent-v1.2.3.apk'), 1],
      ];
      for (const [url, expected] of cases) {
        const result = spawnSync('sh', ['-s'], {
          cwd: repoRoot,
          env: { ...process.env, OWNER: 'hayOfLife', REPO: repository.split('/')[1],
            PACKAGE_MANAGER: manager, ASSET_PACKAGE: assetName.startsWith('luci-app-sheepfold-ai-support')
              ? 'luci-app-sheepfold-ai-support' : 'luci-app-sheepfold-family-internet-control', TEST_URL: url },
          input: `${policy}\ntrusted_package_url "$TEST_URL"\n`, encoding: 'utf8', timeout: 10000,
        });
        assert.equal(result.error, undefined, result.error?.message);
        assert.equal(result.status, expected, `${manager} ${url}: ${result.stderr}`);
      }
    }
  });

  it('acceptsTheRenamedRepositoryReleasePath', () => {
    const assetName = basename(testIpk());
    const run = runInstallScenario({
      packageUrl: `https://github.com/hayOfLife/luci-app-sheepfold-family-internet-control/releases/download/test/${assetName}`,
      installExit: 0,
      confirmInstalledVersion: true,
    });

    assert.equal(run.result.status, 0, run.result.stderr || run.result.stdout);
    assert.match(readFileSync(run.opkgLog, 'utf8'), /^install /m);
  });

  it('rejectsReleasePathTraversalBeforeDownloadingOrInstalling', () => {
    const assetName = basename(testIpk());
    const owner = readFileSync(updater, 'utf8').match(/^OWNER="([^"]+)"/m)[1];
    const prefix = `https://github.com/${owner}/luci-app-sheepfold-family-internet-control/releases/download/`;
    const run = runInstallScenario({
      packageUrl: `${prefix}../../../../other/project/releases/download/test/${assetName}`,
      installExit: 0,
      confirmInstalledVersion: true,
    });

    assert.equal(run.result.status, 1, run.result.stderr || run.result.stdout);
    assert.equal(readFileSync(run.fetchLog, 'utf8').trim().split('\n').length, 1);
    assert.equal(existsSync(run.opkgLog), false);
    assert.equal(readFileSync(run.config, 'utf8'), 'config original\n');
  });

  it('betaUpdaterRequiresOptInAndSkipsAnEqualOrOlderRelease', () => {
    const disabled = runInstallScenario({ command: 'install-beta-foreground' });
    assert.equal(disabled.result.status, 4, disabled.result.stderr);
    assert.equal(readFileSync(disabled.fetchLog, 'utf8'), '');
    assert.equal(existsSync(disabled.opkgLog), false);
    const current = runInstallScenario({ command: 'install-beta-foreground', beta: '1', newer: false });
    assert.equal(current.result.status, 2, current.result.stderr);
    assert.equal(readFileSync(current.fetchLog, 'utf8').trim().split('\n').length, 1);
    assert.equal(existsSync(current.opkgLog), false);
  });

  it('betaUpdaterRechecksConsentBeforeInstallAndStopsOnDownloadFailure', () => {
    const cancelled = runInstallScenario({ command: 'install-beta-foreground', beta: '1', cancelAfterDownload: true });
    assert.equal(cancelled.result.status, 4, cancelled.result.stderr);
    assert.equal(readFileSync(cancelled.config, 'utf8'), 'config original\n');
    assert.equal(existsSync(cancelled.opkgLog), false);
    const failed = runInstallScenario({ command: 'install-beta-foreground', beta: '1', fetchExit: 7 });
    assert.equal(failed.result.status, 7, failed.result.stderr);
    assert.equal(existsSync(failed.opkgLog), false);
  });

  it('manualAndBetaOperationsRespectTheSameLiveLock', { skip: !flockAvailable }, () => {
    for (const command of ['install', 'probe', 'start-beta']) {
      const busy = runInstallScenario({ command, beta: '1', lockHeld: true });
      assert.equal(busy.result.status, 3, busy.result.stderr);
      assert.equal(readFileSync(busy.fetchLog, 'utf8'), '');
      assert.equal(existsSync(busy.opkgLog), false);
    }
  });

  it('betaDownloadErrorsAreNotMistakenForCancellationOrAnUnchangedVersion', async () => {
    for (const fetchExit of [2, 4]) {
      const run = runInstallScenario({ command: 'start-beta', beta: '1', fetchExit });
      assert.equal(run.result.status, 0, run.result.stderr);
      const statusFile = join(run.runtime, 'update.status');
      const pidFile = join(run.runtime, 'update.pid');
      for (let attempt = 0; attempt < 200; attempt++) {
        if (existsSync(statusFile) && readFileSync(statusFile, 'utf8').trim() !== 'running' && !existsSync(pidFile)) break;
        await delay(100);
      }
      assert.equal(readFileSync(statusFile, 'utf8').trim(), `failed:${fetchExit}`);
      assert.equal(existsSync(pidFile), false);
      assert.equal(existsSync(run.opkgLog), false);
    }
    const manual = runInstallScenario({ fetchExit: 2 });
    assert.equal(manual.result.status, 2, manual.result.stderr);
  });

  it('betaBackgroundWorkerFinishesValidatedInstallAndReleasesItsLock', async () => {
    const run = runInstallScenario({ command: 'start-beta', beta: '1', installExit: 0, confirmInstalledVersion: true });
    assert.equal(run.result.status, 0, run.result.stderr || run.result.stdout);
    const statusFile = join(run.runtime, 'update.status');
    const pidFile = join(run.runtime, 'update.pid');
    for (let attempt = 0; attempt < 200; attempt++) {
      if (existsSync(statusFile) && readFileSync(statusFile, 'utf8').trim() !== 'running' && !existsSync(pidFile)) break;
      await delay(100);
    }
    assert.equal(readFileSync(statusFile, 'utf8').trim(), 'ok', readFileSync(join(run.runtime, 'update.log'), 'utf8'));
    assert.equal(existsSync(pidFile), false);
    if (flockAvailable) {
      const lock = spawnSync('flock', ['-n', posix(relative(repoRoot, join(run.runtime, 'update.flock'))), 'true'], {
        cwd: repoRoot, encoding: 'utf8',
      });
      assert.equal(lock.status, 0, lock.stderr);
    }
    assert.match(readFileSync(run.opkgLog, 'utf8'), /^install /);
  });

  it('preserves a downloader failure code instead of reporting success', () => {
    const root = mkdtempSync(join(testTmp, 'sheepfold-updater-transport-'));
    const bin = join(root, 'bin');
    const runtime = join(root, 'runtime');
    const work = join(root, 'work');
    mkdirSync(bin, { recursive: true });
    executable(join(bin, 'uci'), '#!/bin/sh\nexit 1\n');
    executable(join(bin, 'opkg'), '#!/bin/sh\nexit 1\n');
    executable(join(bin, 'uclient-fetch'), '#!/bin/sh\nexit 7\n');
    const path = process.platform === 'win32'
      ? `${bin};C:\\Program Files\\Git\\usr\\bin;C:\\Program Files\\Git\\bin;${process.env.PATH}`
      : `${bin}:${process.env.PATH}`;
    const bash = process.platform === 'win32'
      ? 'C:\\Program Files\\Git\\bin\\bash.exe'
      : 'bash';

    const result = spawnSync(bash, [posix(relative(repoRoot, updater)), 'check'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...lockEnv,
        PATH: path,
        SHEEPFOLD_UPDATE_RUNTIME_DIR: posix(relative(repoRoot, runtime)),
        SHEEPFOLD_UPDATE_WORK_DIR: posix(relative(repoRoot, work)),
        SHEEPFOLD_UPDATE_DOWNLOAD_TIMEOUT: '1',
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 7, result.stderr || result.stdout);
    assert.match(result.stderr, /uclient-fetch.*7/);
  });

  it('bounds updater and Telegram requests and keeps fallback clients', () => {
    const updaterSource = readFileSync(updater, 'utf8');
    const telegramSource = readFileSync(telegram, 'utf8');

    assert.match(updaterSource, /uclient-fetch -q -T "\$DOWNLOAD_TIMEOUT_SECONDS"/);
    assert.match(updaterSource, /curl -fsSL --connect-timeout 15 --max-time "\$DOWNLOAD_TIMEOUT_SECONDS"/);
    assert.match(updaterSource, /wget -q -T "\$DOWNLOAD_TIMEOUT_SECONDS"/);
    assert.match(updaterSource, /MAX_DOWNLOAD_BYTES=.*67108864/);
    assert.doesNotMatch(updaterSource, /fi\s*\n\s*code="\$\?"/);

    assert.match(telegramSource, /TELEGRAM_HTTP_TIMEOUT_SECONDS=.*35/);
    assert.match(telegramSource, /uclient-fetch -q -T "\$TELEGRAM_HTTP_TIMEOUT_SECONDS"/);
    assert.match(telegramSource, /curl -fsSL --connect-timeout 10 --max-time "\$TELEGRAM_HTTP_TIMEOUT_SECONDS"/);
    assert.match(telegramSource, /wget -q -T "\$TELEGRAM_HTTP_TIMEOUT_SECONDS"/);
  });

  it('validates a real IPK and restores settings when opkg fails', () => {
    const { config, opkgLog, result } = runInstallScenario({ installExit: 23 });

    assert.equal(result.status, 23, result.stderr || result.stdout);
    assert.match(result.stderr, /код 23/);
    assert.match(result.stdout, /Предыдущие настройки Sheepfold восстановлены/);
    assert.equal(readFileSync(config, 'utf8'), 'config original\n');
    assert.match(readFileSync(opkgLog, 'utf8'), /^install /m);
  });

  it('rejects a malformed IPK before invoking opkg', () => {
    const root = mkdtempSync(join(testTmp, 'sheepfold-updater-bad-ipk-'));
    const badPackage = join(root, 'bad.ipk');
    writeFileSync(badPackage, 'this is not an ipk\n', 'utf8');
    const { config, opkgLog, result } = runInstallScenario({
      packageSource: badPackage,
      assetName: 'luci-app-sheepfold-family-internet-control_9.9.9-1_all.ipk',
    });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /пакет OpenWrt не прошёл проверку/);
    assert.equal(readFileSync(config, 'utf8'), 'config original\n');
    assert.equal(existsSync(opkgLog), false);
  });

  it('rejects a package URL outside the Sheepfold GitHub release path', () => {
    const { config, opkgLog, result } = runInstallScenario({
      packageUrl: 'https://downloads.example.test/luci-app-sheepfold-family-internet-control_9.9.9-1_all.ipk',
    });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /вне официального раздела релизов Sheepfold/);
    assert.equal(readFileSync(config, 'utf8'), 'config original\n');
    assert.equal(existsSync(opkgLog), false);
  });

  it('restores settings when opkg succeeds but the installed version is not confirmed', () => {
    const { config, result } = runInstallScenario({ installExit: 0 });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /вместо ожидаемой/);
    assert.match(result.stdout, /Предыдущие настройки Sheepfold восстановлены/);
    assert.equal(readFileSync(config, 'utf8'), 'config original\n');
  });

  it('accepts a validated package only after opkg confirms the installed version', () => {
    const { config, result } = runInstallScenario({
      installExit: 0,
      confirmInstalledVersion: true,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Обновление завершено/);
    assert.equal(readFileSync(config, 'utf8'), 'config changed by failed package\n');
  });

  it('apkUpdaterAcceptsValidatedOpenWrtPackage', () => {
    const { apkLog, config, fetchLog, result, routerUrl } = runApkInstallScenario();

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Обновление завершено/);
    assert.equal(readFileSync(config, 'utf8'), 'config changed by apk package\n');
    assert.match(readFileSync(fetchLog, 'utf8'), new RegExp(routerUrl.replaceAll('.', '\\.')));
    assert.doesNotMatch(readFileSync(fetchLog, 'utf8'), /sheepfold-v9\.9\.9\.apk/);
    assert.match(readFileSync(apkLog, 'utf8'), /^verify --allow-untrusted /m);
    assert.match(readFileSync(apkLog, 'utf8'), /^adbdump --allow-untrusted --format json /m);
    assert.match(readFileSync(apkLog, 'utf8'), /^add --allow-untrusted /m);
  });

  it('apkUpdaterRejectsUnexpectedInternalPackageName', () => {
    const { apkLog, config, result } = runApkInstallScenario({ metadataName: 'not-sheepfold' });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /имя пакета не совпадает/);
    assert.equal(readFileSync(config, 'utf8'), 'config original\n');
    assert.doesNotMatch(readFileSync(apkLog, 'utf8'), /^add /m);
  });
});
