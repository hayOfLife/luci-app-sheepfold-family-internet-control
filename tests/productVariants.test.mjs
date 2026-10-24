/*
 * Защищает границу Standard/AI Support на уровне настоящего IPK-архива. Тест
 * проверяет состав, но не установку opkg и не runtime LuCI; это отдельно делает
 * безопасный контур живого роутера.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { describe, it } from 'node:test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function tarEntries(compressed) {
  const tar = gunzipSync(compressed);
  const entries = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const nul = header.indexOf(0);
    const name = header.subarray(0, nul < 0 ? 100 : nul).toString('utf8');
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeText || '0', 8);
    const dataStart = offset + 512;
    entries.set(name.replace(/^\.\//, ''), tar.subarray(dataStart, dataStart + size));
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function nestedIpkEntries(ipkPath) {
  const outer = tarEntries(readFileSync(ipkPath));
  return {
    control: tarEntries(outer.get('control.tar.gz')),
    data: tarEntries(outer.get('data.tar.gz')),
  };
}

describe('product variant boundary §prodvar', () => {
  it('keeps two unified Android APKs behind router capabilities', () => {
    const parentMain = readFileSync(join(root, 'android/app/src/main/java/app/sheepfold/android/ui/main/OperationalMainScreen.kt'), 'utf8');
    const childMain = readFileSync(join(root, 'android-child/app/src/main/java/com/example/sheepfoldchild/ui/MainNavigation.kt'), 'utf8');
    const parentFeature = readFileSync(join(root, 'android/app/src/main/java/app/sheepfold/android/ui/main/ProductFeature.kt'), 'utf8');
    const childFeature = readFileSync(join(root, 'android-child/app/src/main/java/com/example/sheepfoldchild/ui/ProductFeature.kt'), 'utf8');
    const childStatus = readFileSync(join(root, 'android-child/app/src/main/java/com/example/sheepfoldchild/data/ProductStatus.kt'), 'utf8');
    const parentClient = readFileSync(join(root, 'android/app/src/main/java/app/sheepfold/android/router/RouterAdminClient.kt'), 'utf8');
    const routerApi = readFileSync(join(root, 'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-api-legacy'), 'utf8');
    const childApi = readFileSync(join(root, 'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-api-client-status'), 'utf8');
    const parentGradle = readFileSync(join(root, 'android/app/build.gradle.kts'), 'utf8');
    const childGradle = readFileSync(join(root, 'android-child/app/build.gradle.kts'), 'utf8');

    assert.match(parentMain, /snapshot\?\.aiAvailable == true/);
    assert.doesNotMatch(childMain, /AiRepository|AiChatViewModel|AiChatScreen/);
    assert.match(parentFeature, /if \(!aiAvailable\) return null/);
    assert.match(childFeature, /productStatus\?\.aiAvailable != true/);
    assert.match(childStatus, /optBoolean\("childAiAvailable", false\)/);
    assert.match(parentClient, /flexibleBoolean\("aiAssistant"\)/);
    assert.match(routerApi, /ai_feature_available/);
    assert.match(childApi, /child_ai_available/);
    assert.doesNotMatch(parentGradle, /productFlavors|sheepfoldAi/);
    assert.doesNotMatch(childGradle, /productFlavors|sheepfoldAi/);
    assert.match(parentGradle, /applicationId = "app\.sheepfold\.android"/);
    assert.match(childGradle, /applicationId = "app\.sheepfold\.child"/);
  });

  it('builds standalone Standard and AI Support IPKs with opposite payloads', () => {
    const preparedOutput = process.env.SHEEPFOLD_TEST_IPK_DIR || '';
    const output = preparedOutput || mkdtempSync(join(tmpdir(), 'sheepfold-variants-'));
    try {
      if (!preparedOutput) {
        const result = spawnSync(
          process.platform === 'win32' ? 'python' : 'python3',
          ['scripts/build-test-ipk.py', '--variant', 'all', '--out-dir', output],
          { cwd: root, encoding: 'utf8' },
        );
        assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
      }

      const makefile = readFileSync(join(root, 'package/luci-app-sheepfold-family-internet-control/Makefile'), 'utf8');
      const version = makefile.match(/^PKG_VERSION:=(.+)$/m)?.[1];
      const release = makefile.match(/^PKG_RELEASE:=(.+)$/m)?.[1];
      assert.ok(version && release, 'PKG_VERSION and PKG_RELEASE must be present');
      const standardPath = join(output, `luci-app-sheepfold-family-internet-control_${version}-${release}_all.ipk`);
      const aiPath = join(output, `luci-app-sheepfold-ai-support_${version}-${release}_all.ipk`);
      const standard = nestedIpkEntries(standardPath);
      const ai = nestedIpkEntries(aiPath);
      const standardNames = [...standard.data.keys()].join('\n');
      const aiNames = [...ai.data.keys()].join('\n');

      assert.doesNotMatch(standardNames, /sheepfold-ai-(?:gate|handler)|sheepfold-activity-log|share\/sheepfold\/prompts|view\/sheepfold\/ai\.js/);
      assert.match(aiNames, /sheepfold-ai-gate/);
      assert.match(aiNames, /sheepfold-ai-handler/);
      assert.match(aiNames, /sheepfold-activity-log/);
      assert.match(aiNames, /share\/sheepfold\/prompts\/parent\/v2\/system\.txt/);
      assert.match(aiNames, /view\/sheepfold\/ai\.js/);

      const standardApi = standard.data.get('www/cgi-bin/sheepfold-api').toString('utf8');
      const standardLegacy = standard.data.get('usr/libexec/sheepfold/sheepfold-api-legacy').toString('utf8');
      const standardDefaults = standard.data.get('usr/share/sheepfold/sheepfold.uci.defaults').toString('utf8');
      const aiDefaults = ai.data.get('usr/share/sheepfold/sheepfold.uci.defaults').toString('utf8');
      const standardOverview = standard.data.get('www/luci-static/resources/view/sheepfold/overview.js').toString('utf8');
      const aiOverview = ai.data.get('www/luci-static/resources/view/sheepfold/overview.js').toString('utf8');
      const standardOverviewApplication = standard.data.get('www/luci-static/resources/sheepfold/features/overview/application.js').toString('utf8');
      const aiOverviewApplication = ai.data.get('www/luci-static/resources/sheepfold/features/overview/application.js').toString('utf8');
      const aiApi = ai.data.get('www/cgi-bin/sheepfold-api').toString('utf8');
      const aiLegacy = ai.data.get('usr/libexec/sheepfold/sheepfold-api-legacy').toString('utf8');
      const updater = ai.data.get('usr/libexec/sheepfold/sheepfold-updater').toString('utf8');
      const standardPostinst = standard.control.get('postinst').toString('utf8');
      const aiPostinst = ai.control.get('postinst').toString('utf8');

      // Оба варианта формируют собственный postinst. Синтаксис проверяем для
      // каждого архива, иначе ошибка установки проявится только на роутере.
      for (const [variantName, postinst] of [
        ['Standard', standardPostinst],
        ['AI Support', aiPostinst],
      ]) {
        // Проверяется фрагмент реально собранного postinst, но UCI заменён функцией:
        // никаких записей /etc и установки пакета в этом процессе нет.
        assert.match(postinst, /sheepfold-lib-access-policy/);
        assert.match(postinst, /chmod 0644/);
        const migration = postinst.match(/legacy_access_priority=[\s\S]*?ensure_global_option access_priority [^\n]+/);
        assert.ok(migration, `${variantName}: access-priority migration is absent`);
        const expectedOrder = 'no_restrictions blocklist admin_devices allowlist global_block temp_access device_schedule group_schedule default_access';
        const oldOrders = [
          'emergency_sites no_restrictions blocklist allowlist global_block temp_access device_schedule group_schedule default_access',
          'blocklist admin_devices no_restrictions allowlist global_block temp_access device_schedule group_schedule default_access',
        ];
        for (const initial of ['', ...oldOrders, expectedOrder, 'custom-order-for-future']) {
          const script = `mockPriority='${initial}'
uci() {
  case "$2" in get) printf '%s' "$mockPriority" ;; set) mockPriority="\${3#*=}" ;; *) return 1 ;; esac
}
ensure_global_option() { [ -n "$mockPriority" ] || mockPriority="$2"; }
${migration[0]}
printf '%s' "$mockPriority"
`;
          const outcome = spawnSync('bash', ['-s'], { cwd: root, input: script, encoding: 'utf8' });
          assert.equal(outcome.status, 0, outcome.stderr);
          assert.equal(outcome.stdout, initial === 'custom-order-for-future' ? initial : expectedOrder,
            `${variantName}: migration from ${initial}`);
        }
        const syntaxCheck = spawnSync('bash', ['-n'], {
          cwd: root,
          input: postinst,
          encoding: 'utf8',
        });
        assert.equal(
          syntaxCheck.status,
          0,
          `${variantName} postinst syntax error:\n${syntaxCheck.stderr || syntaxCheck.stdout}`,
        );
      }

      assert.doesNotMatch(standardApi, /\/ai-assistant\)|AI_HANDLER|AI_GATE/);
      assert.doesNotMatch(standardLegacy, /deepseek_request|gemini_request|ai_assistant_json|aiContextPreview/);
      assert.doesNotMatch(standardDefaults, /ai_provider|deepseek_|gemini_|grok_|activity_log_enabled/);
      assert.match(standardDefaults, /option product_variant 'sheepfold'/);
      assert.doesNotMatch(standardDefaults, /option product_variant 'sheepfoldAi'/);
      assert.match(aiDefaults, /option product_variant 'sheepfoldAi'/);
      assert.doesNotMatch(aiDefaults, /option product_variant 'sheepfold'/);
      assert.doesNotMatch(standardOverviewApplication, /AI assistant|deepseek_|gemini_|grok_|activity_log_enabled/);
      assert.match(standardOverview, /features\.overview\.application as overviewApplication/);
      assert.match(aiOverview, /features\.overview\.application as overviewApplication/);
      assert.match(standardOverview, /return overviewApplication\.create\(\)/);
      assert.match(aiOverview, /return overviewApplication\.create\(\)/);
      assert.ok(standard.data.has('www/luci-static/resources/sheepfold/features/overview/application.js'));
      assert.ok(ai.data.has('www/luci-static/resources/sheepfold/features/overview/application.js'));
      assert.match(standardOverviewApplication, /require sheepfold\.features\.schedules\.editor as scheduleEditor/);
      assert.match(aiOverviewApplication, /require sheepfold\.features\.schedules\.editor as scheduleEditor/);
      assert.match(standardOverviewApplication, /require sheepfold\.features\.groups\.editor as groupEditor/);
      assert.match(aiOverviewApplication, /require sheepfold\.features\.groups\.editor as groupEditor/);
      assert.match(standardOverviewApplication, /require sheepfold\.features\.administrators\.editor as administratorEditor/);
      assert.match(aiOverviewApplication, /require sheepfold\.features\.administrators\.editor as administratorEditor/);
      assert.match(standardOverviewApplication, /require sheepfold\.features\.devices\.editor as deviceEditor/);
      assert.match(aiOverviewApplication, /require sheepfold\.features\.devices\.editor as deviceEditor/);
      assert.ok(standard.data.has('www/luci-static/resources/sheepfold/features/schedules/editor.js'));
      assert.ok(ai.data.has('www/luci-static/resources/sheepfold/features/schedules/editor.js'));
      assert.ok(standard.data.has('www/luci-static/resources/sheepfold/features/settings/general.js'));
      assert.ok(ai.data.has('www/luci-static/resources/sheepfold/features/settings/general.js'));
      assert.ok(standard.data.has('www/luci-static/resources/sheepfold/features/settings/persistence.js'));
      assert.ok(ai.data.has('www/luci-static/resources/sheepfold/features/settings/persistence.js'));
      assert.ok(standard.data.has('www/luci-static/resources/sheepfold/features/groups/editor.js'));
      assert.ok(ai.data.has('www/luci-static/resources/sheepfold/features/groups/editor.js'));
      assert.ok(standard.data.has('www/luci-static/resources/sheepfold/features/administrators/editor.js'));
      assert.ok(ai.data.has('www/luci-static/resources/sheepfold/features/administrators/editor.js'));
      assert.ok(standard.data.has('www/luci-static/resources/sheepfold/features/devices/editor.js'));
      assert.ok(ai.data.has('www/luci-static/resources/sheepfold/features/devices/editor.js'));
      assert.ok(standard.data.has('www/luci-static/resources/sheepfold/features/devices/responsive.css'));
      assert.ok(ai.data.has('www/luci-static/resources/sheepfold/features/devices/responsive.css'));
      assert.ok(standard.data.has('usr/libexec/sheepfold/sheepfold-lib-form'));
      assert.ok(ai.data.has('usr/libexec/sheepfold/sheepfold-lib-form'));
      for (const moduleName of [
        'model', 'common', 'schedules', 'groups', 'wifi', 'notifications', 'devices',
      ]) {
        const modulePath = `usr/libexec/sheepfold/sheepfold-lib-admin-config-${moduleName}`;
        assert.ok(standard.data.has(modulePath), `${modulePath} отсутствует в Standard IPK`);
        assert.ok(ai.data.has(modulePath), `${modulePath} отсутствует в AI Support IPK`);
      }
      assert.ok(!standard.data.has('usr/libexec/sheepfold/sheepfold-lib-json'));
      assert.ok(ai.data.has('usr/libexec/sheepfold/sheepfold-lib-json'));
      assert.doesNotMatch(standard.data.get('www/luci-static/resources/sheepfold/features/devices/editor.js').toString('utf8'), /activity_log_enabled|activityLogEnabled|activityLogField/);
      assert.doesNotMatch(standard.data.get('www/luci-static/resources/sheepfold/features/groups/editor.js').toString('utf8'), /activity_log_enabled|activityLogEnabled|activityLogField/);
      assert.doesNotMatch([...standard.data.values()].map((value) => value.toString('utf8')).join('\n'), /SHEEPFOLD_(?:AI|STANDARD)_(?:BEGIN|END)/);
      assert.match(aiApi, /\/ai-assistant\)/);
      assert.match(standardLegacy, /"capabilities":\{"aiAssistant":%s\}/);
      assert.match(aiLegacy, /"capabilities":\{"aiAssistant":%s\}/);
      assert.match(updater, /product_variant/);
      assert.match(updater, /luci-app-sheepfold-ai-support/);
      assert.doesNotMatch(standardPostinst, /sheepfold-activity-log rotate/);
      assert.match(aiPostinst, /sheepfold-activity-log rotate/);
      for (const aiOnlyOption of [
        'private_logs',
        'log_days',
        'log_max_dir_kb',
        'log_max_device_kb',
      ]) {
        assert.doesNotMatch(
          standardPostinst,
          new RegExp(`ensure_global_option\\s+${aiOnlyOption}(?:\\s|$)`),
          `${aiOnlyOption} leaked into the Standard postinst`,
        );
        assert.match(
          aiPostinst,
          new RegExp(`ensure_global_option\\s+${aiOnlyOption}(?:\\s|$)`),
          `${aiOnlyOption} is missing from the AI Support postinst`,
        );
      }

      assert.match(standard.control.get('control').toString('utf8'), /Package: luci-app-sheepfold-family-internet-control/);
      const standardControl = standard.control.get('control').toString('utf8');
      const aiControl = ai.control.get('control').toString('utf8');
      assert.match(aiControl, /Package: luci-app-sheepfold-family-internet-control/);
      assert.match(standardControl, /Replaces: luci-app-sheepfold-ai-support/);
      assert.match(aiControl, /Replaces: luci-app-sheepfold-ai-support/);
      assert.doesNotMatch(standardControl, /Conflicts: luci-app-sheepfold-family-internet-control/);
      assert.doesNotMatch(aiControl, /Conflicts: luci-app-sheepfold-family-internet-control/);
      assert.match(standard.control.get('control').toString('utf8'), /Depends:.*uhttpd, luci-ssl, curl/);
      assert.match(ai.control.get('control').toString('utf8'), /Depends:.*uhttpd, luci-ssl, curl/);
      assert.match(standardControl, /^Depends:.*(?:, )coreutils-timeout(?:,|$)/m);
      assert.match(aiControl, /^Depends:.*(?:, )coreutils-timeout(?:,|$)/m);

      const installer = readFileSync(join(root, 'install.sh'), 'utf8');
      assert.match(installer, /sheepfold_package_install_file "\$PACKAGE_FILE" 1/);
      assert.match(installer, /CURRENT_PACKAGE_VERSION.*TARGET_PACKAGE_VERSION/s);
      assert.match(installer, /"\$CURRENT_PACKAGE_VERSION" = "\$TARGET_PACKAGE_VERSION"/);
      assert.match(installer, /sheepfold\.config\.before-install/);
      assert.doesNotMatch(installer, /opkg remove.*(?:sheepfold|SHEEPFOLD)/i);
    } finally {
      if (!preparedOutput) {
        rmSync(output, { recursive: true, force: true });
      }
    }
  });
});
