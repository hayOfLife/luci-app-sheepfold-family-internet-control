/*
 * Проверяет шифрование, валидацию и восстановление экспорта настроек в изолированном
 * VM-контексте Node. Реальные UCI/DHCP/Wi-Fi файлы не затрагиваются; зелёный результат
 * не заменяет backup/restore на тестовом роутере.
 */
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, it } from 'node:test';
import { readOverviewApplication } from '../tools/quality/overviewApplicationSource.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const resources = join(root, 'package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources');
const backupPath = join(resources, 'sheepfold/features/settings/backup.js');
const overview = readOverviewApplication(join(resources, 'view/sheepfold/overview.js'));
const application = readFileSync(join(resources, 'sheepfold/features/overview/application.js'), 'utf8');
const backupPanel = readFileSync(join(resources, 'sheepfold/features/settings/backup-panel.js'), 'utf8');
const backupController = readFileSync(join(resources, 'sheepfold/features/settings/backup-controller.js'), 'utf8');
const backupPersistence = readFileSync(join(resources, 'sheepfold/features/settings/backup-persistence.js'), 'utf8');
const routerControl = readFileSync(join(
  root,
  'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-router-control-legacy'
), 'utf8');
const makefile = readFileSync(join(
  root,
  'package/luci-app-sheepfold-family-internet-control/Makefile',
), 'utf8');
const defaultConfig = readFileSync(join(
  root,
  'package/luci-app-sheepfold-family-internet-control/root/usr/share/sheepfold/sheepfold.uci.defaults',
), 'utf8');

function loadBackupModel() {
  const source = readFileSync(backupPath, 'utf8').replace(/^'require .*?';\r?\n/gm, '');
  const context = {
    module: { exports: {} },
    baseclass: { extend: (value) => value },
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    Promise,
    Date,
    JSON,
    Object,
    Array,
    String,
    RegExp,
    Error
  };
  vm.runInNewContext(`(function () { ${source.replace('return baseclass.extend(', 'module.exports = baseclass.extend(')} })()`, context);
  return context.module.exports;
}

function sourceSections(secret = 'telegram-secret', routerId = 'a'.repeat(32)) {
  return {
    sheepfold: [
      {
        '.name': 'global',
        '.type': 'sheepfold',
        language: 'ru',
        router_install_id: routerId,
        telegram_bot_token: secret,
      },
      { '.name': 'allowlist', '.type': 'list', mac: ['00:11:22:33:44:55'] },
      { '.name': 'blocklist', '.type': 'list', mac: ['AA:BB:CC:DD:EE:FF'] },
      { '.name': 'messenger_global', '.type': 'messenger', active: 'telegram' },
      {
        '.name': 'device_phone',
        '.type': 'device',
        id: '1',
        mac: '00:11:22:33:44:55',
        sim_phone_history: `${'a'.repeat(64)}|+79991234567|250|01|1784332800`
      }
    ],
    dhcp: [{ '.name': 'phone', '.type': 'host', mac: '00:11:22:33:44:55', ip: '192.168.1.20' }],
    wireless: [
      { '.name': 'radio0', '.type': 'wifi-device', channel: 'auto' },
      { '.name': 'default_radio0', '.type': 'wifi-iface', ssid: 'Home', key: 'wifi-secret' }
    ]
  };
}

describe('settings backup and restore', () => {
  it('exports every Sheepfold section type while masking secrets in readable JSON', () => {
    const backup = loadBackupModel();
    const payload = backup.build(sourceSections(), false, '2026-07-16T00:00:00Z');
    const global = payload.configs.sheepfold.find((section) => section.name === 'global');
    const wifi = payload.configs.wireless.find((section) => section.type === 'wifi-iface');
    const phone = payload.configs.sheepfold.find((section) => section.name === 'device_phone');

    assert.equal(payload.format, 'sheepfold-settings-export-v2');
    assert.ok(payload.configs.sheepfold.some((section) => section.type === 'messenger'));
    assert.equal(global.options.telegram_bot_token, '[secret]');
    assert.equal(wifi.options.key, '[secret]');
    assert.equal(phone.options.sim_phone_history, '[secret]');
    assert.equal(backup.validate(payload).configs.dhcp.length, 1);
  });

  it('rejects a backup that puts one MAC in both device access lists', () => {
    const backup = loadBackupModel();
    const sections = sourceSections();
    sections.sheepfold.find((section) => section['.name'] === 'blocklist').mac = ['00:11:22:33:44:55'];
    const payload = backup.build(sections, false);

    assert.throws(() => backup.validate(payload), /conflicting_device_lists/);
  });

  it('rejects a DHCP hostname that would stop dnsmasq', () => {
    const backup = loadBackupModel();
    const payload = backup.build(sourceSections(), false);
    payload.configs.dhcp[0].options.name = 'Телефон ребёнка';
    assert.throws(() => backup.validate(payload), /invalid_dhcp_hostname/);
    payload.configs.dhcp[0].options.name = 'ChildPhone';
    assert.equal(backup.validate(payload).configs.dhcp[0].options.name, 'ChildPhone');
  });

  it('does not allow readable JSON to smuggle unencrypted secrets', () => {
    const backup = loadBackupModel();
    const payload = backup.build(sourceSections(), false);
    const global = payload.configs.sheepfold.find((section) => section.name === 'global');
    global.options.telegram_bot_token = 'plain-text-token';

    assert.throws(() => backup.validate(payload), /unencrypted_secrets_forbidden/);
  });

  it('round-trips full secrets only inside a password-encrypted envelope', async () => {
    const backup = loadBackupModel();
    const full = backup.build(sourceSections(), true);
    const envelope = await backup.encrypt(full, 'correct horse battery staple');
    const restored = await backup.decrypt(envelope, 'correct horse battery staple');
    const global = restored.configs.sheepfold.find((section) => section.name === 'global');

    assert.equal(envelope.format, 'sheepfold-settings-encrypted-v1');
    assert.equal(envelope.cipher, 'AES-256-GCM');
    assert.equal(global.options.telegram_bot_token, 'telegram-secret');
    await assert.rejects(backup.decrypt(envelope, 'wrong password'), /OperationError|decrypt/i);
  });

  it('never exports a live one-time pairing code', () => {
    const backup = loadBackupModel();
    const sections = sourceSections();
    sections.sheepfold.push({
      '.name': 'owner',
      '.type': 'administrator',
      login: 'SuperParent',
      pairing_code: 'Temporary1+',
      pairing_code_expires: '1784333400',
    });

    const readable = backup.build(sections, false);
    const encrypted = backup.build(sections, true);
    const readableAdmin = readable.configs.sheepfold.find((section) => section.name === 'owner');
    const encryptedAdmin = encrypted.configs.sheepfold.find((section) => section.name === 'owner');

    assert.equal(readableAdmin.options.pairing_code, undefined);
    assert.equal(readableAdmin.options.pairing_code_expires, undefined);
    assert.equal(encryptedAdmin.options.pairing_code, undefined);
    assert.equal(encryptedAdmin.options.pairing_code_expires, undefined);
  });

  it('keeps trusted identity state when restoring onto the same router', () => {
    const backup = loadBackupModel();
    const source = sourceSections();
    const phone = source.sheepfold.find((section) => section['.type'] === 'device');
    phone.admin_device = '1';
    phone.trusted_identity_keys = ['uuid:trusted'];
    phone.detection_fingerprint = 'stable-classification';

    const payload = backup.build(source, true);
    const prepared = backup.prepareRestore(payload, backup.build(source, true));
    const restoredPhone = prepared.payload.configs.sheepfold.find((section) => section.type === 'device');

    assert.equal(prepared.routerTransfer, false);
    assert.equal(restoredPhone.options.admin_device, '1');
    assert.deepEqual(Array.from(restoredPhone.options.trusted_identity_keys), ['uuid:trusted']);
    assert.equal(restoredPhone.options.detection_fingerprint, 'stable-classification');
  });

  it('requires fresh home-network consent after any backup restore', () => {
    const backup = loadBackupModel();
    const source = sourceSections();
    source.sheepfold.push({ '.name': 'home_network_global', '.type': 'home_network', enabled: '1', fingerprint: 'a'.repeat(64) });
    const payload = backup.build(source, true);
    const restored = backup.prepareRestore(payload, payload).payload.configs.sheepfold.find((section) => section.type === 'home_network');
    assert.equal(restored.options.enabled, '0');
    assert.equal(restored.options.fingerprint, undefined);
  });

  it('preserves rules but resets router-bound identity and pairing on a new router', () => {
    const backup = loadBackupModel();
    const importedSections = sourceSections('old-secret', 'a'.repeat(32));
    const currentSections = sourceSections('new-secret', 'b'.repeat(32));
    const phone = importedSections.sheepfold.find((section) => section['.type'] === 'device');
    phone.group = 'Первый ребёнок';
    phone.status = 'allow';
    phone.admin_device = '1';
    phone.admin_login = 'SuperParent';
    phone.paired_from = 'android';
    phone.trusted_identity_keys = ['uuid:old-hmac'];
    phone.trusted_identity_version = '2';
    phone.detection_identity_keys = ['uuid:old-hmac'];
    phone.detection_fingerprint = 'old-router-cache';
    phone.detection_snapshot_1 = '1784332800|phone|90|uuid|none|0123456789abcdef';
    phone.identity_quarantine_mode = 'block';

    const imported = backup.build(importedSections, true);
    const prepared = backup.prepareRestore(imported, backup.build(currentSections, true));
    const global = prepared.payload.configs.sheepfold.find((section) => section.name === 'global');
    const restoredPhone = prepared.payload.configs.sheepfold.find((section) => section.type === 'device');

    assert.equal(prepared.routerTransfer, true);
    assert.equal(global.options.router_install_id, 'b'.repeat(32));
    assert.equal(restoredPhone.options.id, '1');
    assert.equal(restoredPhone.options.group, 'Первый ребёнок');
    assert.equal(restoredPhone.options.status, 'allow');
    assert.equal(restoredPhone.options.detection_snapshot_1, phone.detection_snapshot_1);
    assert.equal(restoredPhone.options.admin_device, undefined);
    assert.equal(restoredPhone.options.admin_login, undefined);
    assert.equal(restoredPhone.options.trusted_identity_keys, undefined);
    assert.equal(restoredPhone.options.detection_identity_keys, undefined);
    assert.equal(restoredPhone.options.detection_fingerprint, undefined);
    assert.equal(restoredPhone.options.identity_quarantine_mode, undefined);
    assert.deepEqual(Array.from(
      imported.configs.sheepfold.find((section) => section.type === 'device').options.trusted_identity_keys,
    ), ['uuid:old-hmac']);
  });

  it('applies managed UCI configs, preserves placeholders and refreshes router services', () => {
    assert.match(overview, /require sheepfold\.features\.settings\.backup as settingsBackupModel/);
    assert.match(overview, /require sheepfold\.features\.settings\.backup-panel as settingsBackupPanelModel/);
    assert.match(overview, /require sheepfold\.features\.settings\.backup-persistence as backupPersistenceModel/);
    assert.doesNotMatch(application, /function stageImportedConfig|function stageImportedPayload|function importedSectionByName/);
    assert.match(backupPersistence, /function stageConfig\(config, importedSections, currentSections, managedTypes, containsSecrets\)/);
    assert.match(backupPersistence, /value === deps\.model\.secretPlaceholder/);
    assert.match(backupPanel, /payload\.containsSecrets[\s\S]*unencrypted_secrets_forbidden/);
    assert.match(backupPanel, /backupModel\.prepareRestore\([\s\S]*backupModel\.validate\(deps\.payload\(true\)\)/);
    assert.match(backupController, /deps\.persistence\.apply\(imported, payload\(true\)\)/);
    assert.match(backupPersistence, /deps\.persistence\.mutate\(configs/);
    assert.match(backupPersistence, /deps\.refreshRuntime\(\)/);
    assert.match(application, /runCommand\(\['settings-import-applied'\]\)/);
    assert.doesNotMatch(backupPanel, /\buci\.(get|set|unset|remove)|saveUciChanges|routerControl/);
    assert.doesNotMatch(backupPersistence, /\bdocument\b|\bwindow\b|ui\.showModal|\bE\s*\(/);
    assert.doesNotMatch(application, /Applying imported settings will be added after backend/);
    assert.match(routerControl, /settings_import_applied\(\)/);
    assert.match(routerControl, /settings-import-applied\)/);
    assert.match(routerControl, /settings_import_applied\(\)[\s\S]*sheepfold-ipv6-control apply/);
    assert.match(routerControl, /settings_import_applied\(\)[\s\S]*delete "sheepfold\.\$device_section\.just_detected"/);
    assert.match(routerControl, /sleep 3[\s\S]*dnsmasq reload[\s\S]*wifi reload/);
  });

  it('creates one persistent non-secret router installation id during package setup', () => {
    assert.match(defaultConfig, /option router_install_id ''/);
    assert.match(makefile, /ensure_router_install_id\(\)/);
    assert.match(makefile, /openssl rand -hex 16/);
    assert.match(makefile, /uci -q set sheepfold\.global\.router_install_id/);
    assert.match(makefile, /§cfgbak1/);
  });
});
