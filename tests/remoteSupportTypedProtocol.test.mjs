/*
 * Проверяет текущий typed HTTPS wire независимо от private checkout и старого FRP-эксперимента
 * Только synthetic RAM/чтение schemas; не исполняет recipes и не меняет роутер или сервер
 * Успех не доказывает локальное consent, durable replay, OpenWrt runtime или deployment
 * §rsup001 §rsuppeer §testwhy
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { typedCapabilities, typedControlProfile, typedRouterFields, typedStatusFields,
  validateTypedRouterMessage, validateTypedServerMessage } from '../tools/remoteSupport/typedPayload.mjs';

const id = (byte) => Buffer.alloc(16, byte).toString('base64url');
const now = 1788000000;
const sessionId = id(1);
const message = (messageType, payload, changes = {}) => ({
  messageType, routerId: messageType === 'enrollProof' ? null : id(2), streamId: sessionId,
  messageId: id(3), sequence: 0, issuedAt: now, notBefore: now, expiresAt: now + 60,
  payload, ...changes,
});
const status = () => ({ sessionId, state: 'sessionActive', claimExpiresAt: now + 72 * 3600,
  accessExpiresAt: now + 86400, leaseExpiresAt: now + 120, ticketId: 'SYNTHETIC-1',
  leaseId: id(4), pollAfterSeconds: 30, diagnosticsAllowed: true });
const values = {
  enrollProof: { challenge: Buffer.alloc(32, 7).toString('base64url'), clientNonce: id(5) },
  capabilityReport: { profile: typedControlProfile, capabilities: [...typedCapabilities] },
  claimOpen: { sessionId, code: '012345678901', claimExpiresAt: now + 72 * 3600, diagnosticsAllowed: false },
  sessionReady: { sessionId, leaseId: id(4), bootId: id(6) },
  heartbeat: { sessionId, leaseId: id(4), bootId: id(6) },
  sessionResume: { sessionId, bootId: id(6) },
  commandPoll: { sessionId, leaseId: id(4), bootId: id(6) },
  commandResult: { sessionId, leaseId: id(4), bootId: id(6), operationId: id(7), status: 'failed',
    result: { errorCode: 'diagnosticFailed', message: 'Synthetic failure' } },
  revokeRequest: { sessionId }, statusQuery: { sessionId },
};
const readSchema = (name) => JSON.parse(readFileSync(new URL('../tools/remoteSupport/schemas/' + name, import.meta.url)));

test('typedRouterSchemaMatchesAllTenStrictMessageFieldSets', () => {
  const schema = readSchema('typed-router-message-v1.schema.json');
  const branches = schema.allOf[1].oneOf;
  assert.deepEqual(branches.map((entry) => entry.properties.messageType.const), Object.keys(typedRouterFields));
  for (const entry of branches) {
    const type = entry.properties.messageType.const;
    assert.equal(entry.properties.payload.additionalProperties, false);
    assert.deepEqual(entry.properties.payload.required, typedRouterFields[type]);
    assert.deepEqual(Object.keys(entry.properties.payload.properties), typedRouterFields[type]);
    const input = message(type, values[type]);
    assert.equal(validateTypedRouterMessage(input), input);
    assert.throws(() => validateTypedRouterMessage({ ...input, payload: { ...input.payload, unknown: true } }));
    for (const field of typedRouterFields[type]) {
      const payload = { ...input.payload }; delete payload[field];
      assert.throws(() => validateTypedRouterMessage({ ...input, payload }));
    }
  }
  assert.equal(schema.allOf[1].oneOf[1].properties.payload.properties.profile.const, typedControlProfile);
  assert.deepEqual(schema.allOf[1].oneOf[1].properties.payload.properties.capabilities.items.enum, typedCapabilities);
});

test('typedRouterRejectsLegacySshFieldsProfilesAndCapabilities', () => {
  assert.throws(() => validateTypedRouterMessage(message('claimOpen', { ...values.claimOpen, routerHostKey: 'synthetic' })));
  assert.throws(() => validateTypedRouterMessage(message('claimOpen', { ...values.claimOpen, code: '012345678901\n' })));
  for (const payload of [
    { profile: 'sheepfold-support-server-experimental-1', capabilities: ['claimV1'] },
    { profile: typedControlProfile, capabilities: ['transportCredentialsV1'] },
    { profile: typedControlProfile, capabilities: ['claimV1', 'claimV1'] },
  ]) assert.throws(() => validateTypedRouterMessage(message('capabilityReport', payload)));
});

test('typedResumeUsesControlStreamWhileOtherSessionMessagesRemainBound', () => {
  validateTypedRouterMessage(message('sessionResume', values.sessionResume, { streamId: id(8) }));
  assert.throws(() => validateTypedRouterMessage(message('heartbeat', values.heartbeat, { streamId: id(8) })), { code: 'stateConflict' });
  assert.throws(() => validateTypedRouterMessage(message('commandResult', {
    ...values.commandResult, result: { message: 'x'.repeat(8192) },
  })), { code: 'messageMalformed' });
  assert.throws(() => validateTypedRouterMessage(message('sessionResume', { sessionId, bootId: 'invalid' })));
});

test('typedServerSchemaContainsCurrentStatusAndCommandFields', () => {
  const schema = readSchema('typed-server-message-v1.schema.json');
  const branches = schema.allOf[1].oneOf;
  const active = branches.find((entry) => entry.properties.messageType.const === 'sessionActive');
  assert.equal(active.properties.payload.$ref, '#/$defs/status');
  assert.deepEqual(schema.$defs.status.required, typedStatusFields);
  const command = branches.find((entry) => entry.properties.messageType.const === 'sessionCommand');
  assert.equal(command.properties.payload.$ref, '#/$defs/commandStatus');
  assert.deepEqual(schema.$defs.commandStatus.required, [...typedStatusFields, 'command']);
  const input = message('sessionActive', status());
  assert.equal(validateTypedServerMessage(input, now), input);
  for (const field of typedStatusFields) {
    const payload = status(); delete payload[field];
    assert.throws(() => validateTypedServerMessage(message('sessionActive', payload), now));
  }
  for (const change of [{ pollAfterSeconds: 1 }, { leaseExpiresAt: now },
    { leaseExpiresAt: now + 121 }, { leaseId: null }, { state: 'claimOpen' }, { ticketId: 'SYNTHETIC-1\n' }, { unknown: true }]) {
    assert.throws(() => validateTypedServerMessage(message('sessionActive', { ...status(), ...change }), now));
  }
});

test('typedServerRejectsUnknownRecipesShellAndUnboundPlanHashes', () => {
  const command = { operationId: id(7), kind: 'diagnostic', recipeId: 'networkHealth',
    changeId: null, planHash: null, expiresAt: now + 300 };
  validateTypedServerMessage(message('sessionCommand', { ...status(), command }), now);
  for (const change of [{ kind: 'runShell' }, { recipeId: 'shell' }, { shell: 'not executable' },
    { expiresAt: now + 86401 }, { expiresAt: now }, { expiresAt: now + 301 },
    { changeId: 'reloadSheepfold' }]) {
    assert.throws(() => validateTypedServerMessage(message('sessionCommand', { ...status(), command: { ...command, ...change } }), now));
  }
  assert.throws(() => validateTypedServerMessage(message('sessionCommand', {
    ...status(), diagnosticsAllowed: false, command,
  }), now), { code: 'actionForbidden' });
  const apply = { ...command, kind: 'applyChange', recipeId: null, changeId: 'reloadSheepfold', planHash: 'a'.repeat(64) };
  validateTypedServerMessage(message('sessionCommand', { ...status(), command: apply }), now);
  assert.throws(() => validateTypedServerMessage(message('sessionCommand', { ...status(), command: { ...apply, planHash: null } }), now));
  assert.throws(() => validateTypedServerMessage(message('sessionCommand', { ...status(), command: { ...apply, planHash: 'a'.repeat(64) + '\n' } }), now));
});

test('typedServerUsesReceiptTimeForCommandAndLeaseExpiry', () => {
  const command = { operationId: id(7), kind: 'diagnostic', recipeId: 'networkHealth',
    changeId: null, planHash: null, expiresAt: now + 10 };
  const input = message('sessionCommand', { ...status(), command });
  assert.throws(() => validateTypedServerMessage(input, now + 10), { code: 'messageExpired' });
  assert.throws(() => validateTypedServerMessage(message('sessionActive', {
    ...status(), leaseExpiresAt: now + 10,
  }), now + 10), { code: 'messageExpired' });
});

test('typedServerRejectsContradictoryLeaseStates', () => {
  const closed = { ...status(), state: 'revoked', leaseId: null, leaseExpiresAt: 0 };
  const unclaimed = { ...closed, state: 'claimOpen', accessExpiresAt: null, ticketId: null, leaseExpiresAt: null };
  for (const payload of [closed, unclaimed,
    { ...status(), state: 'sessionPreparing', leaseExpiresAt: 0 },
    { ...status(), state: 'sessionReady', leaseExpiresAt: 0 },
    { ...status(), state: 'reconnecting', leaseId: null, leaseExpiresAt: 0 },
  ]) validateTypedServerMessage(message('statusQuery', payload), now);
  for (const payload of [
    { ...status(), state: 'revoked' },
    { ...status(), state: 'sessionPreparing', leaseId: null, leaseExpiresAt: 0 },
    { ...status(), state: 'sessionReady', leaseExpiresAt: null },
    { ...status(), state: 'claimOpen', accessExpiresAt: null, ticketId: null, leaseId: null },
  ]) assert.throws(() => validateTypedServerMessage(message('statusQuery', payload), now), { code: 'stateConflict' });
  assert.throws(() => validateTypedServerMessage(message('claimAccepted', {
    ...status(), state: 'revoked', leaseId: null, leaseExpiresAt: 0,
  }), now), { code: 'stateConflict' });
});

test('typedEnrollmentRequiresPrimitiveCanonicalKeyIds', () => {
  const profile = typedControlProfile; const keyId = 'router-' + 'a'.repeat(40);
  validateTypedServerMessage(message('enrollAccepted', { routerId: id(2), keyId, profile }), now);
  assert.throws(() => validateTypedServerMessage(message('sessionActive', status())), { code: 'messageMalformed' });
  for (const invalid of [[keyId], keyId + '\n', null, 1]) {
    assert.throws(() => validateTypedServerMessage(message('enrollAccepted', {
      routerId: id(2), keyId: invalid, profile,
    }), now));
    assert.throws(() => validateTypedServerMessage(message('enrollChallenge', {
      candidateKeyId: invalid, profile, challenge: Buffer.alloc(32, 7).toString('base64url'), clientNonce: id(5),
    }, { routerId: null }), now));
  }
});
