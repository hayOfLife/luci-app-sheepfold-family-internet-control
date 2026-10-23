/*
 * Ручной сквозной стенд typed HTTPS wire и private control service §rsuppeer §testwhy
 * Вход: --peer <доверенный checkout>, Node 20+, openssl; вывод: только счётчики проверок
 * Создаёт случайный temp store/однодневные test certificates и loopback listener, затем удаляет их
 * Не подключается к VPS/роутеру, результаты recipes синтетические, не является OpenWrt gate
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, X509Certificate } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createLabChannel } from './labChannel.mjs';
import { identityKeyId } from './experimentalPayload.mjs';
import { generateClaimCode } from './sessionState.mjs';
import { createEnvelope, ReplayWindow, verifyEnvelope } from './signedEnvelope.mjs';
import { parseStrictJson } from './strictJson.mjs';
import { typedCapabilities, typedControlProfile, validateTypedRouterMessage,
  validateTypedServerMessage } from './typedPayload.mjs';

const execute = promisify(execFile);
let root; let store; let listener; let stage = 'setup';
try {
  if (process.argv.length !== 4 || process.argv[2] !== '--peer') throw new Error('usage');
  const peer = resolve(process.argv[3]);
  const readModule = (name) => import(pathToFileURL(join(peer, 'src', name + '.mjs')));
  const { SupportStore } = await readModule('supportStore');
  const { SupportControlService } = await readModule('supportControlService');
  const { SupportOperatorAuth, supportTotp } = await readModule('supportOperatorAuth');
  const { SupportOperatorClient } = await readModule('supportOperatorClient');
  const { createSupportControlHttp } = await readModule('supportControlHttp');
  const { requireFilesystemCapacity } = await readModule('messageRelayFilesystem');
  root = await mkdtemp(join(tmpdir(), 'sheepfold-control-peer-'));
  const makeCert = async (name) => {
    const keyPath = join(root, name + '.key'); const certPath = join(root, name + '.crt');
    await execute('openssl', ['req', '-x509', '-newkey', 'ed25519', '-nodes',
      '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost'], { windowsHide: true, timeout: 10000, maxBuffer: 4096 });
    const cert = await readFile(certPath);
    return { cert, key: await readFile(keyPath),
      hash: createHash('sha256').update(new X509Certificate(cert).raw).digest('hex') };
  };
  const serverTls = await makeCert('server'); const operatorTls = await makeCert('operator');
  const serverKey = generateKeyPairSync('ed25519'); const identity = generateKeyPairSync('ed25519');
  const integrityKey = randomBytes(32); const pepper = randomBytes(32); const totpSecret = randomBytes(20);
  let now = 1788000000; let checks = 0;
  const stateRoot = join(root, 'state');
  // Свободное место synthetic: wire-стенд не зависит от заполнения диска разработчика
  const capacity = (directory, bytes) => requireFilesystemCapacity(directory, bytes,
    async () => ({ blocks: 1000000n, bavail: 900000n, bsize: 4096n }));
  store = await new SupportStore(stateRoot, { integrityKey, capacity }).start();
  const createService = () => new SupportControlService(store, { signingKey: serverKey.privateKey,
    signingKeyId: 'server-test', pepper, now: () => now });
  let service = await createService().start();
  let auth = new SupportOperatorAuth(store, { certificateHash: operatorTls.hash, totpSecret, now: () => now });
  const startListener = async () => {
    listener = createSupportControlHttp({ service, auth, tls: {
      cert: serverTls.cert, key: serverTls.key, ca: operatorTls.cert,
    } });
    await new Promise((done, reject) => {
      listener.once('error', reject); listener.listen(0, '127.0.0.1', done);
    });
    return 'https://localhost:' + listener.address().port + '/';
  };
  const baseUrl = await startListener();
  const channelOptions = { ca: serverTls.cert, certificateHash: serverTls.hash, profile: typedControlProfile };
  let post = createLabChannel({ baseUrl, ...channelOptions });
  const newId = () => randomBytes(16).toString('base64url');
  const rawKey = identity.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
  const keyId = identityKeyId(rawKey);
  const serverKeys = new Map([['server-test', serverKey.publicKey]]);
  let routerId = null; let controlId; let incoming = new ReplayWindow();
  const outgoing = new Map();
  const decode = (wire) => validateTypedServerMessage(verifyEnvelope({ envelope: parseStrictJson(wire),
    publicKeys: serverKeys, now, replayWindow: incoming }).payload, now);
  const build = (type, payload, streamId) => {
    const sequence = outgoing.get(streamId) ?? 0;
    const message = validateTypedRouterMessage({ messageType: type, routerId: type === 'enrollProof' ? null : routerId,
      streamId, messageId: newId(), sequence, issuedAt: now, notBefore: now, expiresAt: now + 60, payload });
    outgoing.set(streamId, sequence + 1);
    return JSON.stringify(createEnvelope({ keyId, privateKey: identity.privateKey,
      payloadBytes: Buffer.from(JSON.stringify(message)) }));
  };
  const send = async (type, payload, streamId) => {
    const response = decode(await post('router', build(type, payload, streamId)));
    assert.equal(response.routerId, routerId); assert.equal(response.streamId, streamId);
    return response;
  };
  const enroll = async (phase = 'enrollment') => {
    stage = phase + 'Challenge';
    const input = { identityPublicKey: rawKey, clientNonce: newId(), supportedVersions: [1] };
    const challenge = decode(await post('enrollment', JSON.stringify(input)));
    assert.equal(challenge.messageType, 'enrollChallenge');
    assert.equal(challenge.payload.clientNonce, input.clientNonce);
    assert.equal(challenge.payload.candidateKeyId, keyId);
    stage = phase + 'Proof';
    const accepted = decode(await post('router', build('enrollProof', {
      challenge: challenge.payload.challenge, clientNonce: input.clientNonce,
    }, challenge.streamId)));
    assert.equal(accepted.messageType, 'enrollAccepted'); assert.equal(accepted.payload.keyId, keyId);
    if (routerId !== null) assert.equal(accepted.routerId, routerId);
    routerId = accepted.routerId; controlId = accepted.streamId;
    stage = phase + 'Capabilities';
    await send('capabilityReport', { profile: typedControlProfile, capabilities: [...typedCapabilities] }, controlId);
  };
  stage = 'enrollment';
  await enroll(); checks += 1;
  stage = 'claim';
  const sessionId = newId(); const code = generateClaimCode();
  const request = build('claimOpen', { sessionId, code, claimExpiresAt: now + 72 * 3600,
    diagnosticsAllowed: true }, sessionId);
  const opened = await post('router', request);
  const retry = await post('router', request);
  assert.equal(retry, opened); assert.equal(decode(retry).payload.state, 'claimOpen'); checks += 1;
  const snapshot = await readFile(join(stateRoot, 'support-state.json'), 'utf8');
  assert.equal(snapshot.includes(code), false); checks += 1;
  const operator = new SupportOperatorClient({ baseUrl, ca: serverTls.cert,
    cert: operatorTls.cert, key: operatorTls.key, serverCertificateHash: serverTls.hash });
  stage = 'operatorMfa';
  const login = await operator.login({ totp: supportTotp(totpSecret, Math.floor(now / 30)) });
  const claimed = await operator.action('claim', {
    sessionId, code, ticketId: 'SYNTHETIC-1', operationId: randomBytes(16).toString('base64url'),
  }, login.token);
  assert.equal(claimed.state, 'sessionPreparing'); checks += 1;
  stage = 'status';
  const accepted = await send('statusQuery', { sessionId }, sessionId);
  const deadline = accepted.payload.accessExpiresAt;
  assert.equal(accepted.messageType, 'claimAccepted'); assert.equal(deadline, now + 86400); checks += 1;
  let leaseId = accepted.payload.leaseId; let bootId = newId();
  const sessionFields = () => ({ sessionId, leaseId, bootId });
  const ready = await send('sessionReady', sessionFields(), sessionId);
  assert.equal(ready.payload.state, 'sessionActive'); checks += 1;
  const operation = async (action, input, result) => {
    const operationId = newId();
    await operator.action(action, { sessionId, operationId, ...input }, login.token);
    const reply = await send('commandPoll', sessionFields(), sessionId);
    assert.equal(reply.messageType, 'sessionCommand'); assert.equal(reply.payload.command.operationId, operationId);
    const command = reply.payload.command;
    if (action === 'diagnostic') assert.equal(command.recipeId, input.recipeId);
    else assert.equal(command.changeId, input.changeId);
    if (action === 'apply-change') assert.equal(command.planHash, input.planHash);
    // Стенд передаёт synthetic результат, а не исполняет команды или меняет UCI
    const wire = build('commandResult', { ...sessionFields(), operationId, status: 'succeeded', result }, sessionId);
    const response = await post('router', wire);
    assert.equal(await post('router', wire), response);
    assert.equal(decode(response).payload.accessExpiresAt, deadline);
    const stored = await operator.action('operation', { sessionId, operationId }, login.token);
    assert.equal(stored.state, 'succeeded'); checks += 1;
  };
  stage = 'diagnostics';
  for (const recipeId of ['systemOverview', 'networkHealth', 'serviceHealth']) {
    await operation('diagnostic', { recipeId }, { summary: 'Synthetic diagnostic', details: [], truncated: false });
  }
  stage = 'typedRepairs';
  const planHash = createHash('sha256').update('synthetic exact local approval plan').digest('hex');
  await assert.rejects(operator.action('apply-change', { sessionId, operationId: newId(),
    changeId: 'reloadSheepfold', planHash }, login.token), { code: 'approvalRequired' }); checks += 1;
  for (const changeId of ['reloadSheepfold', 'reapplySheepfoldFirewall']) {
    await operation('prepare-change', { changeId },
      { planHash, summary: 'Synthetic preparation, no router mutation', approvalRequired: true });
    await operation('apply-change', { changeId, planHash },
      { summary: 'Synthetic local approval fixture, no router mutation', rollbackStatus: 'notNeeded' });
  }
  const impostor = new SupportOperatorClient({ baseUrl, ca: serverTls.cert, serverCertificateHash: serverTls.hash });
  await assert.rejects(impostor.action('list', {}, login.token), { code: 'operatorUnauthorized' }); checks += 1;
  const wrongPin = createLabChannel({ baseUrl, ...channelOptions, certificateHash: '0'.repeat(64) });
  stage = 'tlsPin';
  await assert.rejects(wrongPin('enrollment', '{}'), { code: 'serverIdentityInvalid' }); checks += 1;
  const resume = async () => {
    const previousLease = leaseId;
    now += 1; outgoing.clear(); incoming = new ReplayWindow();
    await enroll('reenrollment');
    bootId = newId();
    const resumed = await send('sessionResume', { sessionId, bootId }, controlId);
    assert.equal(resumed.messageType, 'sessionResumed'); assert.equal(resumed.payload.accessExpiresAt, deadline);
    assert.notEqual(resumed.payload.leaseId, previousLease); leaseId = resumed.payload.leaseId;
    const active = await send('sessionReady', sessionFields(), sessionId);
    assert.equal(active.payload.state, 'sessionActive'); checks += 1;
  };
  stage = 'routerReboot';
  await resume();
  stage = 'serverRestart';
  listener.closeAllConnections(); await new Promise((done) => listener.close(done));
  await store.close(); store = await new SupportStore(stateRoot, { integrityKey, capacity }).start();
  service = await createService().start();
  auth = new SupportOperatorAuth(store, { certificateHash: operatorTls.hash, totpSecret, now: () => now });
  const restartedUrl = await startListener();
  post = createLabChannel({ baseUrl: restartedUrl, ...channelOptions });
  const waiting = await send('statusQuery', { sessionId }, sessionId);
  assert.equal(waiting.payload.state, 'reconnecting'); assert.equal(waiting.payload.leaseId, null);
  assert.equal(waiting.payload.accessExpiresAt, deadline); checks += 1;
  // Новый login нужен новому RAM-auth экземпляру, прежние operator tokens не переносятся
  now += 30;
  const restartedOperator = new SupportOperatorClient({ baseUrl: restartedUrl, ca: serverTls.cert,
    cert: operatorTls.cert, key: operatorTls.key, serverCertificateHash: serverTls.hash });
  await restartedOperator.login({ totp: supportTotp(totpSecret, Math.floor(now / 30)) });
  await resume();
  stage = 'revoke';
  const revoked = build('revokeRequest', { sessionId }, sessionId);
  const closed = await post('router', revoked);
  assert.equal(await post('router', revoked), closed);
  assert.equal(decode(closed).payload.state, 'revoked'); checks += 1;
  assert.equal((await send('statusQuery', { sessionId }, sessionId)).payload.state, 'revoked'); checks += 1;
  process.stdout.write(JSON.stringify({ ok: true, profile: typedControlProfile, checks,
    tls: true, operatorMfa: true, syntheticFilesystem: true, routerRuntime: false, immutableRelease: false }) + '\n');
} catch (error) {
  const sourceLine = /runControlPeer\.mjs:(\d+):\d+/.exec(error.stack ?? '')?.[1];
  process.stderr.write(JSON.stringify({ ok: false, errorCode: 'supportPeerFailed',
    stage, sourceLine: sourceLine ? Number(sourceLine) : null,
    cause: typeof error.code === 'string' && /^[A-Za-z][A-Za-z_]{0,63}$/.test(error.code) ? error.code :
      ['TypeError', 'ReferenceError', 'RangeError'].includes(error.name) ? error.name : 'checkFailed' }) + '\n');
  process.exitCode = 1;
} finally {
  if (listener?.listening) {
    listener.closeAllConnections(); await new Promise((done) => listener.close(done));
  }
  await store?.close();
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
