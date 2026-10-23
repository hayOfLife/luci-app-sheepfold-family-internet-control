export const protocolVersion = 1;
export const maxSafeSequence = Number.MAX_SAFE_INTEGER;
export const maxMessageBytes = 16 * 1024;
export const maxMessageLifeSec = 5 * 60;
export const claimLifeSec = 72 * 60 * 60;
export const accessLifeSec = 24 * 60 * 60;

export const messageTypes = Object.freeze([
  'enrollChallenge',
  'enrollProof',
  'enrollAccepted',
  'capabilityReport',
  'relayMap',
  'claimOpen',
  'claimOpened',
  'claimAccepted',
  'sessionReady',
  'sessionActive',
  'sessionResume',
  'sessionResumed',
  'heartbeat',
  'commandPoll',
  'sessionCommand',
  'commandResult',
  'revokeRequest',
  'revokeConfirmed',
  'statusQuery',
  'transportRequest',
  'transportGrant',
]);

export const sessionStates = Object.freeze([
  'disabled',
  'moduleReady',
  'waitingForWan',
  'claimOpening',
  'claimOpen',
  'claimBlocked',
  'claimExpired',
  'sessionPreparing',
  'sessionReady',
  'sessionActive',
  'reconnecting',
  'failingOver',
  'revoking',
  'revoked',
  'sessionExpired',
  'securityBlocked',
]);

export const envelopeFields = Object.freeze([
  'protocolVersion',
  'keyId',
  'signedPayload',
  'signature',
]);

export const payloadFields = Object.freeze([
  'messageType',
  'routerId',
  'streamId',
  'messageId',
  'sequence',
  'issuedAt',
  'notBefore',
  'expiresAt',
  'payload',
]);

export const idPattern = /^[A-Za-z0-9_-]{22}$/;
export const keyIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const b64Pattern = /^[A-Za-z0-9_-]+$/;

export class ProtocolError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

export function fail(code, detail) {
  throw new ProtocolError(code, detail);
}

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function requireRecord(value, label) {
  if (!isRecord(value)) {
    fail('messageMalformed', `${label} must be an object`);
  }
}

export function requireExactKeys(value, expected, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail('messageMalformed', `${label} has unknown or missing fields`);
  }
}

export function requireTime(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    fail('messageMalformed', `${label} is outside the interoperable JSON integer range`);
  }
}

export function decodeBase64Url(value, label, expectedBytes = null) {
  if (typeof value !== 'string' || !b64Pattern.test(value) || value.includes('=')) {
    fail('messageMalformed', `${label} is not canonical base64url`);
  }

  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) {
    fail('messageMalformed', `${label} is not canonical base64url`);
  }
  if (expectedBytes !== null && decoded.length !== expectedBytes) {
    fail('messageMalformed', `${label} has the wrong byte length`);
  }
  return decoded;
}
