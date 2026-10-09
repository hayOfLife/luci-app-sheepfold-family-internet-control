/*
 * Проверяет границу APK -> роутер -> support server по исходникам и public defaults
 * Только чтение; не отправляет данные и не заменяет Android HPKE или живой HTTPS-тест
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = resolve(root, 'package/luci-app-sheepfold-family-internet-control');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const readPkg = (path) => readFileSync(resolve(pkg, path), 'utf8');

describe('encrypted support report transport', () => {
  it('keeps report endpoints authenticated and separately rate limited', () => {
    const api = readPkg('root/www/cgi-bin/sheepfold-api');
    assert.match(api, /\/support-report\/config\)[\s\S]*require_admin[\s\S]*enforce_rate_limit admin_read 120 60/);
    assert.match(api, /\/support-report\)[\s\S]*require_admin[\s\S]*enforce_rate_limit support_report 3 3600/);
  });

  it('signs only canonical ciphertext envelopes and posts through HTTPS without redirects', () => {
    const helper = readPkg('root/usr/libexec/sheepfold/sheepfold-support-report');
    const expectedOrder = [
      'schemaVersion=1',
      'reportId=$report_id',
      'routerId=$router_id_value',
      'routerPublicKey=$router_public_key_value',
      'createdAt=$created_at',
      'expiresAt=$expires_at',
      'recipientKeyId=$recipient_key_id',
      'cryptoSuite=$CRYPTO_SUITE',
      'ciphertext=$ciphertext',
    ];
    let previous = -1;
    for (const line of expectedOrder) {
      const offset = helper.indexOf(line);
      assert.ok(offset > previous, `${line} must remain in canonical signing order`);
      previous = offset;
    }
    assert.match(helper, /openssl pkeyutl -sign -rawin/);
    assert.match(helper, /--proto '=https'/);
    assert.doesNotMatch(helper, /curl[^\n]*(?:--location|-L(?:\s|$))/);
    assert.doesNotMatch(helper, /logger[^\n]*\$ciphertext/);
  });

  it('uses only a signed rollback-protected GitHub endpoint fallback', () => {
    const helper = readPkg('root/usr/libexec/sheepfold/sheepfold-support-report');
    const discovery = readPkg('root/usr/libexec/sheepfold/sheepfold-support-endpoint-discovery');
    assert.match(discovery, /raw\.githubusercontent\.com\/hayOfLife\/luci-app-sheepfold-family-internet-control\/main\/docs\/runtime-manifests\/support-report-endpoint-v1\.txt/);
    assert.match(discovery, /openssl pkeyutl -verify -rawin -pubin -keyform DER/);
    assert.match(discovery, /manifest_sequence[^\n]*-ge[^\n]*accepted_sequence/);
    assert.match(discovery, /manifest_sequence[^\n]*-eq[^\n]*accepted_sequence/);
    assert.match(discovery, /support_report_discovery_public_key/);
    assert.doesNotMatch(discovery, /uci_get support_report_(?:recipient_public_keyset|recipient_key_id)/);
    assert.match(helper, /000\|301\|302\|307\|308\|404\|408\|410\|500\|502\|503\|504/);
    assert.match(helper, /post_envelope "\$discovered_endpoint"/);
    assert.match(helper, /\/bin\/sh "\$ENDPOINT_DISCOVERY" accept "\$discovered_endpoint"/);
    assert.doesNotMatch(helper, /should_discover_endpoint[\s\S]{0,500}401\|403\|429/);
  });

  it('preserves the server-maintenance refusal through router and Android layers', () => {
    const helper = readPkg('root/usr/libexec/sheepfold/sheepfold-support-report');
    const api = readPkg('root/usr/libexec/sheepfold/sheepfold-api-legacy');
    const client = read('android/app/src/main/java/app/sheepfold/android/router/RouterAdminClient.kt');
    assert.match(helper, /serverMaintenance[\s\S]*error=server_maintenance/);
    assert.match(helper, /server_response_error[^\n]*!= 'serverMaintenance'/);
    assert.match(api, /support_report_server_maintenance[\s\S]*Отказано, ведутся работы на сервере\./);
    assert.match(client, /support_report_server_maintenance[^\n]*Отказано, ведутся работы на сервере\./);
  });

  it('encrypts the exact Android preview with a public-only HPKE keyset', () => {
    const crypto = read('android/app/src/main/java/app/sheepfold/android/support/SupportReportCrypto.kt');
    const payload = read('android/app/src/main/java/app/sheepfold/android/support/SupportReportPayload.kt');
    const screen = read('android/app/src/main/java/app/sheepfold/android/ui/main/FeedbackTab.kt');
    const client = read('android/app/src/main/java/app/sheepfold/android/router/RouterAdminClient.kt');
    assert.match(crypto, /HPKE-X25519-HKDF-SHA256-CHACHA20POLY1305/);
    assert.match(crypto, /ASYMMETRIC_PUBLIC/);
    assert.match(crypto, /google\.crypto\.tink\.HpkePublicKey/);
    assert.match(crypto, /parseKeysetWithoutSecret/);
    assert.match(payload, /payload\.toString\(2\)/);
    assert.match(screen, /pendingReport\.report\.payloadJson/);
    assert.match(screen, /SupportReportCrypto\.encrypt/);
    assert.match(client, /path = "\/support-report"/);
    assert.doesNotMatch(client, /fun submitFeedback|path = "\/feedback"/);
  });

  it('never includes household identifiers in automatic diagnostics', () => {
    const payload = read('android/app/src/main/java/app/sheepfold/android/support/SupportReportPayload.kt');
    assert.doesNotMatch(payload, /diagnostics\[(?:"|')?(?:mac|ip|ssid|deviceName|adminName|log|history)/i);
    assert.doesNotMatch(payload, /module\.(?:name|path|device)/);
    assert.match(payload, /safeDiagnosticKeys/);
  });

  it('ships empty server settings in every package installation path', () => {
    const defaults = readPkg('root/usr/share/sheepfold/sheepfold.uci.defaults');
    const makefile = readPkg('Makefile');
    const testBuilder = read('scripts/build-test-ipk.py');
    for (const option of [
      'support_report_endpoint',
      'support_report_recipient_key_id',
      'support_report_recipient_public_keyset',
      'support_report_discovery_public_key',
    ]) {
      assert.match(defaults, new RegExp(`option ${option} ''`));
      assert.match(makefile, new RegExp(`ensure_global_option ${option} ''`));
      assert.match(testBuilder, new RegExp(`ensure_global_option ${option} ''`));
    }
  });

  it('keeps the child APK outside the support-report channel', () => {
    const childSource = read('android-child/app/src/main/java/com/example/sheepfoldchild/ui/MainNavigation.kt');
    assert.doesNotMatch(childSource, /support-report|feedback|bug.report/i);
  });

  it('describes the encrypted APK route separately from the legacy LuCI route', () => {
    const agreement = read('docs/user-agreement.ru.md');
    const privacy = read('docs/privacy.ru.md');
    assert.match(agreement, /закрытый сервер поддержки Sheepfold[\s\S]*шифрует его на телефоне/);
    assert.match(agreement, /Yandex Cloud и YDB[\s\S]*переходной формы[^\n]*LuCI/);
    assert.match(privacy, /родительском APK[\s\S]*получает только ciphertext/i);
  });
});
