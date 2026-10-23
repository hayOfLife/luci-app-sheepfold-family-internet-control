/*
 * Проверяет сетевую границу и отсутствие fallback между старым и typed профилями стенда
 * Только случайный loopback port, synthetic certificates/temp с очисткой, без private repo
 * Успех не доказывает OpenWrt runtime или production TLS §rsup001 §testwhy
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createLabChannel } from '../tools/remoteSupport/labChannel.mjs';
import { controlProfile } from '../tools/remoteSupport/experimentalPayload.mjs';
import { typedControlProfile } from '../tools/remoteSupport/typedPayload.mjs';

test('labChannelRejectsRemoteEndpointsBeforeNetwork', () => {
  for (const baseUrl of ['http://localhost:8791/', 'https://example.org:443/',
    'https://localhost:8791/extra', 'https://localhost:8791/?token=x', 'https://user@localhost:8791/']) {
    assert.throws(() => createLabChannel({ baseUrl, ca: Buffer.from('test'), certificateHash: 'a'.repeat(64) }),
      { code: 'messageMalformed' });
  }
  assert.throws(() => createLabChannel({ baseUrl: 'https://localhost:8791/', ca: Buffer.from('test'),
    certificateHash: 'a'.repeat(64), profile: 'unknown-profile' }), { code: 'messageMalformed' });
});

test('labChannelRejectsPinRedirectMalformedLargeAndSlowResponses', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sheepfold-control-http-'));
  const certPath = join(root, 'test.crt'); const keyPath = join(root, 'test.key');
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'ed25519', '-nodes',
    '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost'], { windowsHide: true, timeout: 10000, maxBuffer: 4096 });
  const cert = await readFile(certPath); const key = await readFile(keyPath);
  const hash = createHash('sha256').update(new X509Certificate(cert).raw).digest('hex');
  let action = 'ok'; let requests = 0; let profile = controlProfile; let lastPath;
  const server = createServer({ cert, key }, (request, response) => {
    requests += 1; lastPath = request.url; request.resume();
    response.setHeader('Content-Type', 'application/json');
    if (action === 'timeout') return;
    if (action === 'abort') { response.destroy(); return; }
    if (action === 'redirect') {
      response.writeHead(307, { Location: 'https://example.org/' }); response.end('{}'); return;
    }
    if (action === 'content') { response.setHeader('Content-Type', 'text/html'); response.end('{}'); return; }
    if (action === 'large') { response.end(' '.repeat(24577)); return; }
    if (action === 'duplicate') { response.end('{"ok":true,"ok":false}'); return; }
    if (action === 'unknown') { response.writeHead(503); response.end('{"ok":false,"errorCode":"arbitrary"}'); return; }
    if (action === 'busy') { response.writeHead(429); response.end('{"ok":false,"errorCode":"rateLimited"}'); return; }
    if (action === 'operation') { response.writeHead(400); response.end('{"ok":false,"errorCode":"operationUnknown"}'); return; }
    response.end(JSON.stringify({ ok: true, profile, result: { synthetic: true } }));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => {
    server.closeAllConnections(); await new Promise((done) => server.close(done));
  });
  const options = { baseUrl: 'https://localhost:' + server.address().port + '/', ca: cert, certificateHash: hash,
    profile: controlProfile };
  const post = createLabChannel(options);
  assert.deepEqual(JSON.parse(await post('enrollment', '{}')), { synthetic: true });
  assert.equal(lastPath, '/experimental/support/enrollment/start');
  profile = typedControlProfile;
  assert.deepEqual(JSON.parse(await createLabChannel({ ...options, profile: undefined })('router', '{}')), { synthetic: true });
  assert.equal(lastPath, '/v1/support/router');
  const typedPost = createLabChannel({ ...options, profile });
  assert.deepEqual(JSON.parse(await typedPost('router', '{}')), { synthetic: true });
  assert.equal(lastPath, '/v1/support/router');
  await assert.rejects(post('router', '{}'), { code: 'protocolUnsupported' });
  profile = controlProfile;
  await assert.rejects(typedPost('enrollment', '{}'), { code: 'protocolUnsupported' });
  assert.equal(lastPath, '/v1/support/enrollment/start');
  await assert.rejects(post('operator', '{}'), { code: 'protocolUnsupported' });
  const beforePin = requests;
  await assert.rejects(createLabChannel({ ...options, certificateHash: '0'.repeat(64) })('enrollment', '{}'),
    { code: 'serverIdentityInvalid' });
  assert.equal(requests, beforePin);
  for (const mode of ['redirect', 'content', 'large', 'duplicate', 'unknown']) {
    action = mode;
    await assert.rejects(post('router', '{}'), { code: 'messageMalformed' });
  }
  action = 'busy'; await assert.rejects(post('router', '{}'), { code: 'rateLimited' });
  action = 'operation'; await assert.rejects(post('router', '{}'), { code: 'operationUnknown' });
  action = 'abort'; await assert.rejects(post('router', '{}'), { code: 'transportUnavailable' });
  action = 'timeout';
  await assert.rejects(createLabChannel({ ...options, timeoutMs: 100 })('router', '{}'),
    { code: 'transportUnavailable' });
});
