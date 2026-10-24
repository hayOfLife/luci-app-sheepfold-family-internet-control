/*
 * Защищает контракт панели «Информация»: backend обязан вернуть непустой
 * диагностический снимок, а стандартные цели проверки связи не должны
 * зависеть от иностранных сервисов, которые могут быть недоступны в России.
 * Проверяет исходники и синтетический снимок без изменения роутера
 * Статический тест не подтверждает реальный ICMP-ответ или работу proxy
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readOverviewApplication } from '../tools/quality/overviewApplicationSource.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const legacyPath = resolve(
  repoRoot,
  'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-router-control-legacy',
);
const overviewPath = resolve(
  repoRoot,
  'package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/view/sheepfold/overview.js',
);
const infoModulePath = resolve(
  repoRoot,
  'package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/features/router/info.js',
);

function readProjectFile(path) {
  return readFileSync(path, 'utf8');
}

function parseKeyValueOutput(text) {
  const values = {};

  String(text || '').split(/\r?\n/).forEach((line) => {
    const index = line.indexOf('=');
    if (index > 0)
      values[line.slice(0, index)] = line.slice(index + 1);
  });

  return values;
}

describe('Router information panel', () => {
  it('collects router-info without failing on missing wireless config', () => {
    const source = readProjectFile(legacyPath);

    assert.match(source, /wifi_radios="\$\(uci -q show wireless/);
    assert.match(source, /\|\| true\)/);
    assert.match(source, /for radio in \$wifi_radios/);
    assert.match(source, /ping_quick_ms/);
    assert.match(source, /ping_ya_ru_ms/);
    assert.match(source, /ping_gosuslugi_ru_ms/);
    assert.match(source, /ping_ntp_vniiftri_ru_ms/);
    assert.doesNotMatch(source, /ping_google_com_ms|ping_youtube_com_ms|1\.1\.1\.1|8\.8\.8\.8/);
    assert.match(source, /print_kv storage_space/);
  });

  it('parses router-info output for the LuCI information panel', () => {
    const sample = [
      'current_time=10.07.2026 12:00:00 MSK',
      'sheepfold_version=0.1.0-129',
      'internet_status=online',
      'internet_reason=ya.ru отвечает',
      'ping_yandex_ms=14.2',
      'storage_space=/overlay: 12 MB free / 64 MB total (81% used)',
      'wifi_count=1',
      'wifi_1_name=radio0',
      'wifi_1_status=enabled',
    ].join('\n');

    const values = parseKeyValueOutput(sample);

    assert.equal(values.sheepfold_version, '0.1.0-129');
    assert.equal(values.storage_space, '/overlay: 12 MB free / 64 MB total (81% used)');
    assert.equal(values.wifi_count, '1');
  });

  it('renders storage and tolerates empty router-info output in LuCI', () => {
    const overview = readOverviewApplication(overviewPath);
    const source = readProjectFile(infoModulePath);

    assert.match(source, /function formatPingMs/);
    assert.match(source, /function hasData/);
    assert.match(source, /function load\(force\)/);
    assert.match(source, /routerBackend\.withTimeout/);
    assert.match(source, /function internetDetails/);
    assert.match(source, /probeLine\('ya\.ru'/);
    assert.match(source, /probeLine\('gosuslugi\.ru'/);
    assert.match(source, /probeLine\('ntp1\.vniiftri\.ru'/);
    assert.doesNotMatch(source, /probeLine\('google\.com'|probeLine\('youtube\.com'/);
    assert.match(source, /row\(_\('Router storage'\), infoValue\(values\.storage_space\)\)/);
    assert.match(source, /if \(!hasData\(values\)\)/);
    assert.match(source, /state\.status = 'error'/);
    assert.match(overview, /tab === 'info'/);
  });

  it('does not abort router-info on shell errexit', () => {
    const source = readProjectFile(legacyPath);

    assert.match(source, /router_info\(\)/);
    assert.match(source, /set \+e/);
  });

  it('has OpenWrt system-board fallbacks for model and firmware', () => {
    const source = readProjectFile(legacyPath);

    assert.match(source, /router_board_json\(\)/);
    assert.match(source, /ubus -S call system board/);
    assert.match(source, /router_model_text\(\)/);
    assert.match(source, /router_firmware_description\(\)/);
    assert.match(source, /model="\$\(router_model_text\)"/);
  });

  it('reports Podkop package freshness for the information panel', () => {
    const legacy = readProjectFile(legacyPath);
    const overview = readOverviewApplication(overviewPath);
    const infoModule = readProjectFile(infoModulePath);

    assert.match(legacy, /package_upgradable_any/);
    assert.match(legacy, /print_kv podkop_version_status/);
    assert.match(overview, /require sheepfold\.features\.router\.info as routerInfo/);
    assert.doesNotMatch(overview, /function formatInstalledPackageInfo|function packageVersionStatusLabel/);
    assert.match(infoModule, /values\.podkop_version_status/);
    assert.match(infoModule, /function packageInfo/);
  });

  it('detects stable and experimental Podkop backends before LuCI-only packages', () => {
    const source = readProjectFile(legacyPath);
    const packages = ['podkop', 'podkop-exp', 'luci-app-podkop', 'luci-app-podkop-exp'];
    const version = source.match(/podkop_version="\$\(package_version_any ([^|]+)\|\| true\)"/);
    const freshness = source.match(/if package_upgradable_any ([^;]+); then/);

    assert.deepEqual(version?.[1].trim().split(/\s+/), packages);
    assert.deepEqual(freshness?.[1].trim().split(/\s+/), packages);
  });
});
