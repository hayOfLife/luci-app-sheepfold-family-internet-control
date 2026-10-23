/*
 * Строгий Node.js эталон текущего HTTPS/typed контракта, не клиент роутера
 * Вход: уже проверенное подписанное сообщение; выход: исходное сообщение либо отказ
 * Только RAM, без сети и исполнения recipes; runtime consent/replay проверяются отдельно
 * §rsup001 §rsuppeer
 */
import { validatePayload } from './signedEnvelope.mjs';
import { decodeBase64Url, fail, requireExactKeys, requireTime } from './protocolValues.mjs';

export const typedControlProfile = 'sheepfold-support-control-1';
export const typedCapabilities = Object.freeze([
  'claimV1', 'localRevokeV1', 'typedControlRelayV1', 'diagnosticRecipesV1',
  'localApprovalV1', 'restartResumeV1',
]);
export const typedRouterFields = Object.freeze({
  enrollProof: ['challenge', 'clientNonce'],
  capabilityReport: ['profile', 'capabilities'],
  claimOpen: ['sessionId', 'code', 'claimExpiresAt', 'diagnosticsAllowed'],
  sessionReady: ['sessionId', 'leaseId', 'bootId'],
  heartbeat: ['sessionId', 'leaseId', 'bootId'],
  sessionResume: ['sessionId', 'bootId'],
  commandPoll: ['sessionId', 'leaseId', 'bootId'],
  commandResult: ['sessionId', 'leaseId', 'bootId', 'operationId', 'status', 'result'],
  revokeRequest: ['sessionId'],
  statusQuery: ['sessionId'],
});
export const typedStatusFields = Object.freeze([
  'sessionId', 'state', 'claimExpiresAt', 'accessExpiresAt', 'leaseExpiresAt',
  'ticketId', 'leaseId', 'pollAfterSeconds', 'diagnosticsAllowed',
]);
const terminalStates = ['claimBlocked', 'claimExpired', 'revoked', 'sessionExpired', 'securityBlocked'];
const statusStates = ['claimOpen', 'sessionPreparing', 'sessionReady', 'sessionActive', 'reconnecting', ...terminalStates];
const recipes = ['systemOverview', 'networkHealth', 'serviceHealth'];
const changes = ['reloadSheepfold', 'reapplySheepfoldFirewall'];
const requireId = (value) => decodeBase64Url(value, 'id', 16);

function requireCapabilities(value) {
  requireExactKeys(value, ['profile', 'capabilities'], 'capabilities');
  if (value.profile !== typedControlProfile || !Array.isArray(value.capabilities) ||
      value.capabilities.length > typedCapabilities.length ||
      new Set(value.capabilities).size !== value.capabilities.length ||
      value.capabilities.some((entry) => !typedCapabilities.includes(entry))) fail('protocolUnsupported');
}

export function validateTypedRouterMessage(message) {
  validatePayload(message);
  const fields = typedRouterFields[message.messageType];
  if (!fields) fail('protocolUnsupported');
  const value = message.payload;
  requireExactKeys(value, fields, 'typed router payload');
  if ('sessionId' in value) {
    requireId(value.sessionId);
    if (message.messageType !== 'sessionResume' && message.streamId !== value.sessionId) fail('stateConflict');
  }
  if (message.messageType === 'enrollProof') {
    decodeBase64Url(value.challenge, 'challenge', 32); requireId(value.clientNonce);
  }
  if (message.messageType === 'capabilityReport') requireCapabilities(value);
  if (message.messageType === 'claimOpen') {
    if (typeof value.code !== 'string' || value.code.length !== 12 || !/^[0-9]{12}$/.test(value.code) ||
        typeof value.diagnosticsAllowed !== 'boolean') fail('messageMalformed');
    requireTime(value.claimExpiresAt, 'claimExpiresAt');
  }
  if ('leaseId' in value) { requireId(value.leaseId); requireId(value.bootId); }
  if (message.messageType === 'sessionResume') requireId(value.bootId);
  if (message.messageType === 'commandResult') {
    requireId(value.operationId);
    if (!['succeeded', 'failed', 'rejected'].includes(value.status) ||
        !value.result || Array.isArray(value.result) || typeof value.result !== 'object') fail('messageMalformed');
    const bytes = JSON.stringify(value.result);
    if (Buffer.byteLength(bytes) > 8192 || bytes.includes('\u0000')) fail('messageMalformed');
  }
  return message;
}

function validateCommand(command, accessExpiresAt, issuedAt, diagnosticsAllowed, now) {
  requireExactKeys(command, ['operationId', 'kind', 'recipeId', 'changeId', 'planHash', 'expiresAt'], 'typed command');
  requireId(command.operationId); requireTime(command.expiresAt, 'command expiresAt');
  if (accessExpiresAt === null || command.expiresAt > accessExpiresAt || command.expiresAt <= issuedAt ||
      command.expiresAt > issuedAt + 300) fail('stateConflict');
  if (now >= command.expiresAt) fail('messageExpired');
  if (command.kind === 'diagnostic') {
    if (!diagnosticsAllowed) fail('actionForbidden');
    if (!recipes.includes(command.recipeId) || command.changeId !== null || command.planHash !== null) fail('protocolUnsupported');
  } else if (['prepareChange', 'applyChange'].includes(command.kind)) {
    if (command.recipeId !== null || !changes.includes(command.changeId)) fail('protocolUnsupported');
    if (command.kind === 'prepareChange' ? command.planHash !== null :
      typeof command.planHash !== 'string' || command.planHash.length !== 64 ||
      !/^[a-f0-9]{64}$/.test(command.planHash)) fail('messageMalformed');
  } else fail('protocolUnsupported');
}

function requireRouterKeyId(value) {
  if (typeof value !== 'string' || value.length !== 47 || !/^router-[a-f0-9]{40}$/.test(value)) fail('messageMalformed');
}

export function validateTypedServerMessage(message, now) {
  validatePayload(message);
  requireTime(now, 'receipt time');
  const value = message.payload;
  if (message.messageType === 'enrollChallenge') {
    requireExactKeys(value, ['challenge', 'clientNonce', 'candidateKeyId', 'profile'], 'typed challenge');
    decodeBase64Url(value.challenge, 'challenge', 32); requireId(value.clientNonce);
    requireRouterKeyId(value.candidateKeyId);
    if (value.profile !== typedControlProfile) fail('messageMalformed');
    return message;
  }
  if (message.messageType === 'enrollAccepted') {
    requireExactKeys(value, ['routerId', 'keyId', 'profile'], 'typed enrollment');
    requireRouterKeyId(value.keyId);
    if (value.routerId !== message.routerId || value.profile !== typedControlProfile) fail('stateConflict');
    return message;
  }
  if (message.messageType === 'statusQuery' && Object.hasOwn(value, 'capabilities')) {
    requireCapabilities(value); return message;
  }
  if (!['claimOpened', 'claimAccepted', 'sessionActive', 'sessionResumed', 'sessionCommand',
    'revokeConfirmed', 'statusQuery'].includes(message.messageType)) fail('protocolUnsupported');
  requireExactKeys(value, [...typedStatusFields, ...(message.messageType === 'sessionCommand' ? ['command'] : [])], 'typed status');
  requireId(value.sessionId);
  if (message.messageType !== 'sessionResumed' && message.streamId !== value.sessionId) fail('stateConflict');
  if (!statusStates.includes(value.state) || value.pollAfterSeconds !== 30 ||
      typeof value.diagnosticsAllowed !== 'boolean') fail('messageMalformed');
  requireTime(value.claimExpiresAt, 'claimExpiresAt');
  for (const field of ['accessExpiresAt', 'leaseExpiresAt']) {
    if (value[field] !== null) requireTime(value[field], field);
  }
  if (value.leaseId !== null) requireId(value.leaseId);
  if (value.ticketId !== null && (typeof value.ticketId !== 'string' || value.ticketId.trim() !== value.ticketId ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value.ticketId))) fail('messageMalformed');
  if (value.state === 'claimOpen' && [value.accessExpiresAt, value.leaseId, value.ticketId, value.leaseExpiresAt]
    .some((entry) => entry !== null)) fail('stateConflict');
  if (['sessionPreparing', 'sessionReady', 'sessionActive', 'reconnecting'].includes(value.state) &&
      (value.accessExpiresAt === null || value.ticketId === null)) fail('stateConflict');
  if (['sessionPreparing', 'sessionReady'].includes(value.state) &&
      (value.leaseId === null || value.leaseExpiresAt !== 0)) fail('stateConflict');
  if (value.state === 'reconnecting' && value.leaseExpiresAt !== 0) fail('stateConflict');
  if (terminalStates.includes(value.state) && (value.leaseId !== null || value.leaseExpiresAt !== 0)) fail('stateConflict');
  if ((value.accessExpiresAt === null) !== (value.ticketId === null)) fail('stateConflict');
  if (value.state === 'sessionActive' && (value.leaseId === null || value.leaseExpiresAt === null ||
      value.leaseExpiresAt > Math.min(value.accessExpiresAt, message.issuedAt + 120))) fail('stateConflict');
  // Срок lease проверяется при получении, иначе задержанный ответ выглядел бы ещё действующим
  if (value.state === 'sessionActive' && now >= value.leaseExpiresAt) fail('messageExpired');
  if (message.messageType === 'claimOpened' && value.state !== 'claimOpen' ||
      message.messageType === 'claimAccepted' && (!['sessionPreparing', 'sessionReady', 'sessionActive', 'reconnecting'].includes(value.state) ||
        value.leaseId === null) ||
      message.messageType === 'sessionActive' && value.state !== 'sessionActive' ||
      message.messageType === 'sessionResumed' && !['claimOpen', 'sessionReady'].includes(value.state) ||
      message.messageType === 'revokeConfirmed' && !terminalStates.includes(value.state)) fail('stateConflict');
  if (message.messageType === 'sessionCommand') {
    if (value.state !== 'sessionActive') fail('stateConflict');
    validateCommand(value.command, value.accessExpiresAt, message.issuedAt, value.diagnosticsAllowed, now);
  }
  return message;
}
