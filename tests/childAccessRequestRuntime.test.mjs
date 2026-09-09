/*
 * Защищает добровольную просьбу ребёнка: верное устройство, подтверждённый ID,
 * независимость результата от журнала, полный JSON и честный HTTP при отказе.
 * Выполняет реальные helper/CGI в удаляемом .build-fixture; UCI и сеть модельные.
 * Инъекции обязаны оставить trace: зелёный exit без сработавшего отказа не годится.
 * Не выдаёт интернет, не проверяет радио, Android WorkManager или живой uhttpd.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequestFixture, requestNow, requestIp, requestMac } from './helpers/childAccessRequestFixture.mjs';
import { parseCgi } from './helpers/routerRuntimeFixture.mjs';
const withFixture = (body, values = {}) => {
  const f = createRequestFixture(values);
  try { return body(f); } finally { f.close(); }
};
const ok = (result) => { assert.ifError(result.error); assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); };

describe('Child request uses the child identity through the opt-in check', () => {
  it('creates a request with the real ID helper, not the administrator section', () => withFixture((f) => {
    const body = ok(f.create());
    assert.equal(body.duplicate, false);
    const record = readFileSync(join(f.queue, f.records()[0]), 'utf8');
    assert.match(record, /device_id=42\n/); assert.match(record, /device_name=Учебный телефон 🦊\n/);
    assert.doesNotMatch(f.traces(), /uci set sheepfold\.parent\./);
  }));
  it('returns a valid success through the real CGI', () => withFixture((f) => {
    const result = parseCgi(f.request({ REQUEST_METHOD: 'POST', PATH_INFO: '/access-request' }));
    assert.equal(result.status, 200); assert.equal(result.body.duplicate, false);
  }));
  it('deduplicates sequential button presses without another log event', () => withFixture((f) => {
    const first = ok(f.create()), second = ok(f.create());
    assert.equal(first.requestId, second.requestId); assert.equal(second.duplicate, true);
    assert.equal(f.records().length, 1); assert.equal(f.traces().split('\n').filter((line) => line === 'log').length, 1);
  }));
  it('still denies children when every administrator opted out', () => withFixture((f) => {
    assert.equal(f.create().status, 3); assert.equal(f.records().length, 0);
  }, { 'sheepfold.parent.allow_child_access_requests': '0' }));
  it('still denies administrator devices before creating a request', () => withFixture((f) => {
    assert.equal(f.create().status, 4); assert.equal(f.records().length, 0);
  }, { 'sheepfold.child.admin_device': '1' }));
  it('rejects partial ID output when its helper reports failure', () => withFixture((f) => {
    f.stubId(7);
    const result = parseCgi(f.request({ REQUEST_METHOD: 'POST', PATH_INFO: '/access-request' }));
    assert.match(f.traces(), /id ensure /);
    assert.equal(result.status, 503); assert.equal(result.body.error, 'access_request_unavailable');
    assert.equal(f.records().length, 0);
  }));
});

describe('Committed child request is independent of diagnostics', () => {
  for (const exitCode of [0, 9]) {
    it(`does not mix noisy logger output into success, logger exit ${exitCode}`, () => withFixture((f) => {
      f.stubId();
      f.put('sheepfold-log', `#!/bin/sh\nprintf 'log-fault\\n' >> "$TEST_REQUEST_ACTIONS"\nprintf 'private logger output\\n'\nexit ${exitCode}\n`);
      const result = parseCgi(f.request({ REQUEST_METHOD: 'POST', PATH_INFO: '/access-request' }));
      assert.match(f.traces(), /log-fault/); assert.equal(result.status, 200); assert.equal(result.body.ok, true);
      assert.equal(f.records().length, 1);
    }));
  }
  it('keeps success even if both logging channels fail', () => withFixture((f) => {
    f.stubId();
    f.put('sheepfold-log', '#!/bin/sh\nprintf "log-fault\\n" >> "$TEST_REQUEST_ACTIONS"\nexit 9\n');
    f.put('logger', '#!/bin/sh\nprintf "syslog-fault\\n" >> "$TEST_REQUEST_ACTIONS"\nprintf "noise\\n"\nexit 9\n');
    assert.equal(ok(f.create()).ok, true);
    assert.match(f.traces(), /log-fault/); assert.match(f.traces(), /syslog-fault/);
  }));
});

describe('Parent request list is a complete result or a temporary failure', () => {
  it('retains a genuinely empty successful list', () => withFixture((f) => {
    const result = parseCgi(f.request()); assert.equal(result.status, 200); assert.deepEqual(result.body.requests, []);
  }));
  it('reads a valid request for an opted-in parent', () => withFixture((f) => {
    f.seed(); const result = parseCgi(f.request()); assert.equal(result.status, 200);
    assert.equal(result.body.requests[0].deviceId, '42'); assert.equal(result.body.requests[0].createdAt, requestNow);
  }));
  it('does not expose a partial failed helper output as HTTP 200', () => withFixture((f) => {
    f.put('sheepfold-access-request', '#!/bin/sh\nprintf "list-fault\\n" >> "$TEST_REQUEST_ACTIONS"\nprintf \'{"requests":[\'\nexit 5\n');
    const result = parseCgi(f.request());
    assert.match(f.traces(), /list-fault/); assert.equal(result.status, 503);
    assert.equal(result.body.error, 'access_requests_unavailable'); assert.equal(result.body.requests, undefined);
  }));
  it('reports an unavailable helper instead of returning an empty HTTP 200 body', () => withFixture((f) => {
    rmSync(join(f.bin, 'sheepfold-access-request'));
    const result = parseCgi(f.request()); assert.equal(result.status, 503); assert.equal(result.body.error, 'access_requests_unavailable');
  }));
  it('escapes every stored control byte without destroying UTF-8 text', () => withFixture((f) => {
    const name = 'Русский 🦊 " \\ ' + Array.from({ length: 31 }, (_, index) => index + 1)
      .filter((code) => code !== 10).map((code) => String.fromCharCode(code)).join('');
    f.seed({ device_name: name });
    const result = parseCgi(f.request()); assert.equal(result.status, 200); assert.equal(result.body.requests[0].deviceName, name);
  }));
});

describe('Request controls stay compatible with existing clients', () => {
  it('finds a later opted-in administrator without losing the child', () => withFixture((f) => {
    assert.equal(ok(f.create()).ok, true);
  }, { 'sheepfold.parent.allow_child_access_requests': '0', 'sheepfold.second': 'administrator',
    'sheepfold.second.login': 'SecondParent', 'sheepfold.second.allow_child_access_requests': '1' }));
  it('still returns 404 for an actually unregistered source', () => withFixture((f) => {
    const result = parseCgi(f.request({ REQUEST_METHOD: 'POST', PATH_INFO: '/access-request', REMOTE_ADDR: '192.168.7.99' }));
    assert.equal(result.status, 404); assert.equal(result.body.error, 'device_not_registered');
    assert.equal(f.records().length, 0);
  }));
  it('does not expose the parent queue without a Bearer token', () => withFixture((f) => {
    f.seed(); const result = parseCgi(f.request({ HTTP_AUTHORIZATION: '' }));
    assert.equal(result.status, 401); assert.equal(result.body.requests, undefined); assert.equal(f.records().length, 1);
  }));
  it('does not consume a stored request for a parent who opted out', () => withFixture((f) => {
    const record = f.seed(), before = f.text(record); const result = parseCgi(f.request());
    assert.equal(result.status, 200); assert.deepEqual(result.body.requests, []); assert.equal(f.text(record), before);
  }, { 'sheepfold.parent.allow_child_access_requests': '0' }));
  it('keeps the established one-day queue lifetime', () => withFixture((f) => {
    f.seed({ created_at: requestNow - 86401 }, 'old.request');
    f.seed({ created_at: requestNow - 86400 }, 'boundary.request');
    const result = parseCgi(f.request()); assert.equal(result.status, 200);
    assert.equal(result.body.requests.length, 1); assert.deepEqual(f.records(), ['boundary.request']);
  }));
  it('keeps the endpoint methods unchanged', () => withFixture((f) => {
    assert.equal(parseCgi(f.request({ PATH_INFO: '/access-request' })).status, 405);
    assert.equal(parseCgi(f.request({ REQUEST_METHOD: 'POST' })).status, 405);
  }));
  it('returns success and logs to syslog when the primary logger is missing', () => withFixture((f) => {
    f.stubId(); rmSync(join(f.bin, 'sheepfold-log'));
    assert.equal(ok(f.create()).ok, true); assert.match(f.traces(), /syslog/);
  }));
  it('still fails if publishing the request file fails', () => withFixture((f) => {
    f.stubId();
    f.put('mv', '#!/bin/sh\nprintf "mv-fault\\n" >> "$TEST_REQUEST_ACTIONS"\nexit 7\n');
    const result = parseCgi(f.request({ REQUEST_METHOD: 'POST', PATH_INFO: '/access-request' }));
    assert.match(f.traces(), /mv-fault/); assert.equal(result.status, 500); assert.equal(result.body.error, 'request_failed');
    assert.equal(f.records().length, 0); assert.doesNotMatch(f.traces(), /^log$/m);
  }));
  it('reports a real list preparation failure before sending success', () => withFixture((f) => {
    f.put('mkdir', '#!/bin/sh\nprintf "mkdir-fault\\n" >> "$TEST_REQUEST_ACTIONS"\nexit 7\n');
    const result = parseCgi(f.request()); assert.match(f.traces(), /mkdir-fault/);
    assert.equal(result.status, 503); assert.equal(result.body.error, 'access_requests_unavailable');
  }));
  it('rejects the actual ID helper result after a failed commit', () => withFixture((f) => {
    const original = readFileSync(join(f.bin, 'uci'), 'utf8');
    f.put('uci', original.replace('set|commit|add_list|delete)',
      'commit) printf "commit-fault\\n" >> "$TEST_REQUEST_ACTIONS"; exit 7 ;;\nset|add_list|delete)'));
    const result = parseCgi(f.request({ REQUEST_METHOD: 'POST', PATH_INFO: '/access-request' }));
    assert.match(f.traces(), /commit-fault/); assert.equal(result.status, 503); assert.equal(f.records().length, 0);
  }));
  it('keeps the router-side ARP fallback when no DHCP lease matches', () => withFixture((f) => {
    writeFileSync(f.leases, '');
    writeFileSync(f.arp, `${requestIp} 0x1 0x2 ${requestMac} * br-lan\n`);
    const result = parseCgi(f.request({ REQUEST_METHOD: 'POST', PATH_INFO: '/access-request' }));
    assert.equal(result.status, 200); assert.equal(result.body.ok, true);
  }));
  it('does not inject code or JSON fields from a stored device name', () => withFixture((f) => {
    const name = '"},"ok":false,"injected":"$(exit 19)';
    f.seed({ device_name: name }); const result = parseCgi(f.request());
    assert.equal(result.body.ok, true); assert.equal(result.body.requests[0].deviceName, name);
    assert.equal(result.body.injected, undefined);
  }));
});
