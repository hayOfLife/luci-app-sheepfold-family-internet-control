/*
 * HTTPS-адаптер только локального protocol-стенда §rsup001 §testwhy
 * Вход: synthetic CA/pin и JSON bytes; выход: signed envelope, без логирования bodies
 * Адрес жёстко loopback, два router routes, нет proxy/redirect/operator credentials
 */
import { createHash } from 'node:crypto';
import { request } from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { parseStrictJson } from './strictJson.mjs';
import { controlProfile } from './experimentalPayload.mjs';
import { typedControlProfile } from './typedPayload.mjs';
import { fail, ProtocolError, requireExactKeys } from './protocolValues.mjs';

const routes = {
  enrollment: '/experimental/support/enrollment/start',
  router: '/experimental/support/router',
};
const typedRoutes = { enrollment: '/v1/support/enrollment/start', router: '/v1/support/router' };
const serverErrors = new Set([
  'messageMalformed', 'rateLimited', 'signatureInvalid', 'routerUnknown', 'sequenceReplay',
  'sequenceGap', 'stateConflict', 'protocolUnsupported', 'messageNotYetValid', 'messageExpired',
  'claimExpired', 'claimNotOpen', 'claimAlreadyUsed', 'claimCodeInvalid', 'claimAttemptsExceeded',
  'sessionRevoked', 'sessionExpired', 'clockUntrusted', 'storageCapacityReached',
  'storageUnavailable', 'transportUnavailable', 'internalError',
  'operationUnknown', 'approvalRequired', 'actionForbidden',
]);

export function createLabChannel({ baseUrl, ca, certificateHash, timeoutMs = 5000, profile = typedControlProfile }) {
  const target = new URL(baseUrl);
  if (target.protocol !== 'https:' || target.hostname !== 'localhost' || !target.port ||
      target.username || target.password || target.pathname !== '/' || target.search || target.hash ||
      !Buffer.isBuffer(ca) || !ca.length || ca.length > 65536 ||
      !/^[a-f0-9]{64}$/.test(certificateHash) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 15000 ||
      ![controlProfile, typedControlProfile].includes(profile)) {
    fail('messageMalformed', 'invalid lab channel configuration');
  }
  return async function post(kind, wire) {
    if (!Object.hasOwn(routes, kind)) fail('protocolUnsupported');
    const body = Buffer.from(wire);
    parseStrictJson(body, 24576);
    return new Promise((resolve, reject) => {
      let settled = false; let timer;
      const finish = (error, result) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (error) reject(error); else resolve(result);
      };
      const outgoing = request(new URL((profile === typedControlProfile ? typedRoutes : routes)[kind], target), {
        method: 'POST', agent: false, ca, minVersion: 'TLSv1.2', rejectUnauthorized: true,
        family: 4, lookup: (_host, _options, done) => done(null, '127.0.0.1', 4),
        maxHeaderSize: 8192,
        checkServerIdentity(host, cert) {
          return checkServerIdentity(host, cert) ||
            (createHash('sha256').update(cert.raw).digest('hex') === certificateHash
              ? undefined : new ProtocolError('serverIdentityInvalid'));
        },
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
      }, (incoming) => {
        if (incoming.statusCode >= 300 && incoming.statusCode < 400 ||
            !/^application\/json(?:;\s*charset=utf-8)?$/i.test(incoming.headers['content-type'] ?? '') ||
            incoming.headers['content-encoding']) {
          finish(new ProtocolError('messageMalformed')); incoming.destroy(); return;
        }
        let size = 0; const chunks = [];
        incoming.on('data', (chunk) => {
          size += chunk.length;
          if (size > 24576) {
            finish(new ProtocolError('messageMalformed')); incoming.destroy();
          } else chunks.push(chunk);
        });
        incoming.on('error', () => finish(new ProtocolError('transportUnavailable')));
        incoming.on('aborted', () => finish(new ProtocolError('transportUnavailable')));
        incoming.on('end', () => {
          if (settled) return;
          try {
            const value = parseStrictJson(Buffer.concat(chunks), 24576);
            if (incoming.statusCode !== 200 || value.ok !== true) {
              requireExactKeys(value, ['ok', 'errorCode'], 'server error');
              if (value.ok !== false || !serverErrors.has(value.errorCode)) fail('messageMalformed');
              fail(value.errorCode);
            }
            requireExactKeys(value, ['ok', 'profile', 'result'], 'server response');
            if (value.profile !== profile) fail('protocolUnsupported');
            finish(null, JSON.stringify(value.result));
          } catch (error) { finish(error); }
        });
      });
      timer = setTimeout(() => {
        finish(new ProtocolError('transportUnavailable')); outgoing.destroy();
      }, timeoutMs);
      outgoing.on('error', (error) => finish(new ProtocolError(
        error.code === 'serverIdentityInvalid' || /^ERR_TLS|^CERT_|^DEPTH_|^SELF_SIGNED/.test(error.code ?? '')
          ? 'serverIdentityInvalid' : 'transportUnavailable',
      )));
      outgoing.end(body);
    });
  };
}
