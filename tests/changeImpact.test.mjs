/*
 * Проверяет, что советник blast radius не пропускает общие API/UCI/firewall
 * границы и не требует полного product suite от одной ADR-правки. Он не доказывает
 * полноту карты для будущих путей: неизвестные файлы специально остаются видимыми. §impact1 §testwhy
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { formatImpact, inspectChanges, parseNameStatus } from '../scripts/inspectChangeImpact.mjs';
import { recommendedCommands } from '../tools/quality/changeImpact.mjs';

function fixtureConsumers(helperName) {
  return readdirSync(import.meta.dirname)
    .filter((name) => name.endsWith('.test.mjs'))
    .filter((name) => readFileSync(join(import.meta.dirname, name), 'utf8').includes(`helpers/${helperName}`))
    .sort();
}

describe('change impact advisor §impact1', () => {
  it('maps update wrappers and the installed updater to direct preservation checks', () => {
    for (const path of ['install.sh', 'update.sh', 'uninstall.sh',
      'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-updater']) {
      const report = inspectChanges([path]);
      assert.deepEqual(report.unknown, [], path);
      assert.equal(report.risk, 'critical', path);
      for (const name of ['updateTransportSafety.test.mjs', 'installSettingsPreservation.test.mjs', 'installLanguage.test.mjs'])
        assert.ok(report.directTests.includes(name), `${path}: missing ${name}`);
    }
    assert.deepEqual(inspectChanges(['unknownUpdater.sh']).unknown, ['unknownUpdater.sh']);
  });

  it('selects time panel, action adapter and backend result checks together', () => {
    for (const file of [
      'package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/features/settings/time.js',
      'package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/features/overview/application.js',
      'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-time-control',
    ]) {
      const report = inspectChanges([file]);
      for (const name of ['timeSettingsLifecycle.test.mjs', 'timeTransactionRecovery.test.mjs', 'timeSaveConfirmation.test.mjs', 'timeAndDetectionSetup.test.mjs', 'luciCommandActions.test.mjs', 'cloudArchiveSafety.test.mjs'])
        assert.ok(report.directTests.includes(name), `${file}: missing ${name}`);
      assert.deepEqual(report.unknown, []);
      for (const name of report.directTests)
        assert.ok(readdirSync(import.meta.dirname).includes(name), `missing test file ${name}`);
    }
  });
  it('selects messenger action wiring, Save lifecycle and translations without a full suite', () => {
    for (const path of ['messenger/settings', 'settings/controller', 'settings/draft', 'settings/save-flow']) {
      const report = inspectChanges([`package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/features/${path}.js`]);
      assert.ok(report.directTests.includes('messengerSettingsLifecycle.test.mjs'), path);
      assert.ok(report.directTests.includes('settingsSaveLifecycle.test.mjs'), path);
      assert.deepEqual(report.unknown, []);
      if (path !== 'settings/save-flow') assert.equal(report.fullTest, false);
    }
  });

  it('selects direct settings draft and save lifecycle consumers', () => {
    for (const module of ['draft', 'save-flow']) {
      const report = inspectChanges([`package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/features/settings/${module}.js`]);
      for (const file of ['settingsSaveLifecycle.test.mjs', 'frontendDomainModels.test.mjs',
        'frontendModules.test.mjs', 'overviewFinalRuntime.test.mjs', 'overviewFinalRefreshSemantics.test.mjs',
        'overviewFinalDecomposition.test.mjs', 'overviewLocalization.test.mjs', 'countryProfiles.test.mjs',
        'auditCorrections.test.mjs', 'finalAuditHardening.test.mjs'])
        assert.ok(report.directTests.includes(file), `${module}: missing ${file}`);
      assert.deepEqual(report.unknown, []);
      if (module === 'draft') assert.equal(report.fullTest, false);
    }
  });
  it('selects all direct UCI adapter consumers without requiring unrelated full suites', () => {
    const report = inspectChanges(['package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/core/persistence/uci.js']);
    for (const name of ['backupMutationConsistency.test.mjs', 'backupImportUiSafety.test.mjs',
      'backupRecoveryRegression.test.mjs', 'luciPersistenceAdapters.test.mjs', 'frontendModules.test.mjs',
      'finalAuditHardening.test.mjs', 'auditRuntimeCorrections.test.mjs', 'overviewFinalRuntime.test.mjs',
      'overviewFinalExperimentalR252.test.mjs', 'overviewFinalRefreshSemantics.test.mjs',
      'overviewFinalAudit.test.mjs', 'luciFinalAuditTool.test.mjs'])
      assert.ok(report.directTests.includes(name), `missing UCI consumer ${name}`);
    assert.deepEqual(report.unknown, []); assert.equal(report.fullTest, false);
  });
  it('selects backup export privacy, UI and restore consumers together', () => {
    for (const name of ['backup', 'backup-panel', 'backup-controller', 'backup-persistence']) {
      const report = inspectChanges([`package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/features/settings/${name}.js`]);
      assert.deepEqual(report.unknown, []);
      for (const test of ['backupMutationConsistency.test.mjs', 'backupImportUiSafety.test.mjs', 'backupExportSafety.test.mjs', 'settingsBackup.test.mjs', 'backupRecoveryRegression.test.mjs', 'luciPersistenceAdapters.test.mjs', 'frontendModules.test.mjs', 'overviewLocalization.test.mjs'])
        assert.ok(report.directTests.includes(test), `${name} requires ${test}`);
      assert.ok(report.categories.includes('security')); assert.ok(report.categories.includes('luci'));
    }
  });
  it('selects Yandex transport, storage callers and package checks', () => {
    const report = inspectChanges(['package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-yandex-disk']);
    assert.deepEqual(report.unknown, []);
    for (const name of ['yandexDiskRuntime.test.mjs', 'yandexBackupRuntime.test.mjs', 'yandexUploadRuntime.test.mjs', 'yandexEventsRuntime.test.mjs', 'yandexSyncRuntime.test.mjs', 'yandexDownloadRuntime.test.mjs', 'yandexContextRuntime.test.mjs', 'logStorage.test.mjs', 'logWriterRuntime.test.mjs', 'portableShellAndStatus.test.mjs', 'packageHardeningRuntime.test.mjs', 'testIpkPermissions.test.mjs']) {
      assert.ok(report.directTests.includes(name), `missing Yandex consumer ${name}`);
    }
  });
  it('selects upload behavior and storage callers for Google Drive', () => {
    const report = inspectChanges(['package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-google-drive']);
    for (const name of ['googleDriveUploadRuntime.test.mjs', 'logStorage.test.mjs', 'logWriterRuntime.test.mjs', 'packageHardeningRuntime.test.mjs', 'testIpkPermissions.test.mjs']) {
      assert.ok(report.directTests.includes(name), `missing upload consumer ${name}`);
    }
    assert.deepEqual(report.unknown, []);
  });
  it('requires security and full verification for the experimental support credential profile', () => {
    const report = inspectChanges(['tools/remoteSupport/transportClient.mjs']);
    assert.deepEqual(report.unknown, []);
    assert.ok(report.categories.includes('security')); assert.ok(report.categories.includes('tooling'));
    assert.equal(report.fullTest, true); assert.equal(report.risk, 'critical');
  });
  it('requires a separate native gate for the SFMR1 helper and executable wire model', () => {
    const report = inspectChanges([
      'package/sheepfold-message-relay-crypto/src/relayJson.c',
      'package/sheepfold-message-relay-crypto/README.ru.md',
      'tools/messageRelay/relayEnvelope.mjs',
    ]);
    assert.deepEqual(report.unknown, []);
    assert.equal(report.risk, 'critical');
    assert.equal(report.fullTest, true);
    const command = 'sh tools/messageRelay/runNativeCryptoTests.sh --sanitize';
    assert.ok(recommendedCommands(report).manual.includes(command));
    assert.ok(!recommendedCommands(report).automatic.includes(command));
  });

  it('selects writer, API, maintenance, cloud exports and packaging for the shared journal path', () => {
    const report = inspectChanges(['package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-log-common']);
    assert.deepEqual(report.unknown, []);
    for (const name of ['logWriterRuntime.test.mjs', 'legacyLogRuntime.test.mjs', 'maintenanceJobs.test.mjs', 'maintenanceRotationRuntime.test.mjs', 'googleDriveUploadRuntime.test.mjs', 'yandexEventsRuntime.test.mjs', 'packageHardeningRuntime.test.mjs', 'testIpkPermissions.test.mjs']) {
      assert.ok(report.directTests.includes(name), `missing direct consumer ${name}`);
    }
  });

  it('selects maintenance behavior and the shared journal consumers', () => {
    const report = inspectChanges(['package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-maintenance']);
    for (const name of ['maintenanceJobs.test.mjs', 'maintenanceRotationRuntime.test.mjs', 'legacyLogRuntime.test.mjs', 'logWriterRuntime.test.mjs']) {
      assert.ok(report.directTests.includes(name), `missing direct consumer ${name}`);
    }
  });

  it('maps a shared API change to backend, Android, security and a full run', () => {
    const report = inspectChanges([
      'package/luci-app-sheepfold-family-internet-control/root/www/cgi-bin/sheepfold-api',
    ]);
    assert.deepEqual(report.categories, ['android', 'backendFast', 'security']);
    assert.equal(report.fullTest, true);
    assert.equal(report.risk, 'critical');
    assert.match(formatImpact(report), /npm\.cmd test/);
    assert.ok(recommendedCommands(report).manual.includes('npm.cmd run router:readOnly'));
  });

  it('keeps isolated home-network helper edits on the critical network boundary', () => {
    for (const path of [
      'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-home-network',
      'package/luci-app-sheepfold-family-internet-control/root/etc/hotplug.d/iface/90-sheepfold-home-network',
      'android/app/src/main/java/app/sheepfold/android/router/HomeRouterEndpoints.kt',
    ]) {
      const report = inspectChanges([path]);
      assert.deepEqual(report.unknown, []);
      assert.equal(report.risk, 'critical');
      assert.equal(report.fullTest, true);
      assert.ok(report.categories.includes('networkIntegration'));
      assert.ok(recommendedCommands(report).manual.includes('npm.cmd run router:fullSafe'));
    }
  });

  it('combines overlapping device frontend and access areas without duplicate categories', () => {
    const report = inspectChanges([
      'package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/features/devices/editor.js',
    ]);
    assert.deepEqual(report.categories, ['access', 'devices', 'luci', 'security']);
    assert.equal(new Set(report.categories).size, report.categories.length);
  });

  it('keeps presentation-only device files out of identity and access tests', () => {
    const report = inspectChanges([
      'package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/features/devices/table.js',
      'package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/features/devices/responsive.css',
    ]);
    assert.deepEqual(report.categories, ['luci']);
    assert.deepEqual(report.areas.map((area) => area.name), ['LuCI frontend', 'Таблица устройств в LuCI']);
  });

  it('narrows a proven release-only Makefile change but keeps an unknown Makefile edit conservative', () => {
    const release = inspectChanges([{
      status: 'M',
      path: 'package/luci-app-sheepfold-family-internet-control/Makefile',
      kind: 'packageReleaseOnly',
    }]);
    assert.deepEqual(release.categories, ['packaging', 'tooling']);
    assert.equal(release.fullTest, true);

    const general = inspectChanges(['package/luci-app-sheepfold-family-internet-control/Makefile']);
    assert.ok(general.categories.includes('security'));
  });

  it('keeps an ADR-only edit lightweight and reports unknown paths explicitly', () => {
    const docs = inspectChanges(['docs/architecture/decisions/0001-product-variants.ru.md']);
    assert.deepEqual(docs.categories, ['tooling']);
    assert.equal(docs.fullTest, false);

    const unknown = inspectChanges(['experimental/unknown.file']);
    assert.deepEqual(unknown.unknown, ['experimental/unknown.file']);
    assert.deepEqual(unknown.categories, []);
    assert.equal(unknown.risk, 'medium');
  });

  it('separates source validation CI from the OpenWrt package build workflow', () => {
    const validation = inspectChanges(['.github/workflows/placeholder.yml']);
    assert.deepEqual(validation.categories, ['tooling']);
    assert.equal(validation.fullTest, false);
    assert.deepEqual(validation.directTests, [
      'deviceDetectorSafety.test.mjs',
      'openWrtBuildWorkflow.test.mjs',
      'staticAnalysisTooling.test.mjs',
      'windowsToolchain.test.mjs',
    ]);

    const packages = inspectChanges(['.github/workflows/build-openwrt-packages.yml']);
    assert.ok(packages.categories.includes('packaging'));
    assert.equal(packages.fullTest, true);

    const android = inspectChanges(['.github/workflows/validate-android.yml']);
    assert.deepEqual(android.categories, ['android', 'tooling']);
    assert.equal(android.fullTest, false);
    assert.deepEqual(android.directTests, [
      'openWrtBuildWorkflow.test.mjs',
      'staticAnalysisTooling.test.mjs',
      'windowsToolchain.test.mjs',
    ]);
  });

  it('maps the isolated AI server experiment to AI and security checks', () => {
    const report = inspectChanges([
      'experimental/ai-server-core/src/sheepfold_ai_core/pipeline.py',
      'experimental/ai-server-core/modules/memory-and-visibility.ru.md',
    ]);

    assert.deepEqual(report.categories, ['ai', 'security']);
    assert.deepEqual(report.unknown, []);
    assert.equal(report.risk, 'high');
    assert.ok(report.areas.some((area) => area.name === 'Экспериментальное серверное ядро ИИ'));
  });

  it('recognizes repository entry points instead of reporting avoidable unknown paths', () => {
    const report = inspectChanges([
      '.gitignore',
      '.gitattributes',
      'package.json',
      'README.md',
      'README.ru.md',
      'docs/current-implementation-status.md',
      'docs/developer-task.ru.md',
      'docs/project-development-roadmap.ru.md',
      'docs/new-profile-document.ru.md',
	  '.agents/skills/sheepfold-documentation/SKILL.md',
	  'utilities/README.ru.md',
	  'utilities/guides/example.ru.md',
    ]);
    assert.deepEqual(report.categories, ['tooling']);
    assert.deepEqual(report.unknown, []);
    assert.ok(report.areas.some((area) => area.name === 'Архитектура и правила агентов'));
    assert.ok(recommendedCommands(report).automatic.includes('npm.cmd run quality:docs'));
  });

  it('maps the shared icon catalog to LuCI, Android and generation checks', () => {
    const report = inspectChanges([
      'icons/catalog.json',
      'scripts/generateIconCatalog.mjs',
    ]);

    assert.deepEqual(report.categories, ['android', 'luci', 'tooling']);
    assert.deepEqual(report.unknown, []);
    assert.ok(report.areas.some((area) => area.name === 'Единый каталог значков'));
    assert.ok(recommendedCommands(report).automatic.includes('npm.cmd run icons:check'));
  });

  it('treats rpcd ACL changes as a critical LuCI security boundary', () => {
    const report = inspectChanges([
      'package/luci-app-sheepfold-family-internet-control/root/usr/share/rpcd/acl.d/luci-app-sheepfold-family-internet-control.json',
    ]);

    assert.deepEqual(report.categories, ['backendFast', 'luci', 'security']);
    assert.deepEqual(report.unknown, []);
    assert.equal(report.risk, 'critical');
    assert.equal(report.fullTest, true);
    assert.ok(recommendedCommands(report).manual.includes('npm.cmd run router:frontend'));
    assert.ok(recommendedCommands(report).manual.includes('npm.cmd run router:readOnly'));
  });

  it('treats the OpenWrt init service as a critical lifecycle boundary', () => {
    const report = inspectChanges([
      'package/luci-app-sheepfold-family-internet-control/root/etc/init.d/sheepfold',
    ]);

    assert.deepEqual(report.categories, ['backendFast', 'packaging', 'security']);
    assert.deepEqual(report.unknown, []);
    assert.equal(report.risk, 'critical');
    assert.equal(report.fullTest, true);
    assert.ok(recommendedCommands(report).manual.includes('npm.cmd run router:readOnly'));
    assert.ok(recommendedCommands(report).manual.includes('npm.cmd run router:fullSafe'));
  });

  it('maps PO, POT and client JSON catalogs to localization checks', () => {
    const report = inspectChanges([
      'package/luci-app-sheepfold-family-internet-control/po/ru/sheepfold.po',
      'package/luci-app-sheepfold-family-internet-control/po/templates/sheepfold.pot',
      'po/zh_Hans/sheepfold.po',
      'package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/i18n/ru.json',
    ]);

    assert.deepEqual(report.categories, ['luci', 'packaging']);
    assert.deepEqual(report.unknown, []);
    assert.ok(report.areas.some((area) => area.name === 'Локализация интерфейса'));
    assert.ok(recommendedCommands(report).manual.includes('npm.cmd run router:frontend'));
  });

  it('maps country profile data to backend, package and site-policy checks', () => {
    const report = inspectChanges([
      'package/luci-app-sheepfold-family-internet-control/root/usr/share/sheepfold/country-profiles/other.json',
    ]);

    assert.deepEqual(report.categories, ['backendFast', 'packaging', 'sites']);
    assert.deepEqual(report.unknown, []);
    assert.ok(report.areas.some((area) => area.name === 'Профили стран'));
    assert.ok(recommendedCommands(report).manual.includes('npm.cmd run router:readOnly'));
  });

  it('keeps both sides of a rename and runs an edited test directly', () => {
    const parsed = parseNameStatus('R100\0package/app/htdocs/luci-static/resources/features/devices/old.js\0archive/old.js\0M\0tests/changeImpact.test.mjs\0');
    assert.deepEqual(parsed[0], {
      status: 'R',
      previousPath: 'package/app/htdocs/luci-static/resources/features/devices/old.js',
      path: 'archive/old.js',
    });
    const report = inspectChanges(parsed);
    assert.ok(report.areas.some((area) => area.name === 'Устройства и их паспорт'));
    assert.deepEqual(report.directTests, ['changeImpact.test.mjs']);
  });

  it('runs every direct consumer of a changed shared runtime fixture', () => {
    for (const helperName of [
      'adminNotificationFixture.mjs',
      'adminConfigRuntimeFixture.mjs',
      'apiRateLimitFixture.mjs',
      'childAccessRequestFixture.mjs',
      'controlRuntimeFixture.mjs',
      'pairingRuntimeFixture.mjs',
      'routerRuntimeFixture.mjs',
      'tokenAuthenticationFixture.mjs',
    ]) {
      const report = inspectChanges([`tests/helpers/${helperName}`]);
      assert.deepEqual(report.unknown, []);
      assert.deepEqual(report.directTests, fixtureConsumers(helperName), helperName);
    }
  });
});

// Новый helper затрагивает и импортирующие его fixture, не только прямой unit.
it('selects privacy guard and indirect runtime process consumers', () => {
  const result = inspectChanges(['tests/helpers/runtimeProcess.mjs']);
  for (const name of ['runtimeProcess.test.mjs', 'cloudArchiveSafety.test.mjs', 'adminNotificationRuntime.test.mjs', 'legacyLogRuntime.test.mjs', 'maintenanceRotationRuntime.test.mjs', 'googleDriveUploadRuntime.test.mjs', 'yandexContextRuntime.test.mjs', 'timeSaveConfirmation.test.mjs', 'timeTransactionRecovery.test.mjs', 'yandexDiskRuntime.test.mjs', 'yandexSyncRuntime.test.mjs', 'yandexUploadRuntime.test.mjs', 'yandexDownloadRuntime.test.mjs', 'yandexEventsRuntime.test.mjs', 'packageHardeningRuntime.test.mjs'])
    assert.ok(result.directTests.includes(name), `missing ${name}`);
});
