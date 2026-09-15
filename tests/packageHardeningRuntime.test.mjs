/*
 * Runs the real installation hardener against an isolated rootfs copy. Protects
 * delegation-aware checks after shared policy/token refactors. It may chmod and
 * create directories only inside .build; finally removes the copy. Success is
 * not an opkg/apk install, package transaction or real firewall traffic test.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { shellTestPath } from '../tools/quality/testEnvironment.mjs';
import { runtimeTimeout } from './helpers/runtimeProcess.mjs';

const repo = resolve(import.meta.dirname, '..');
const rootSource = join(process.env.SHEEPFOLD_HARDENING_TEST_SOURCE || repo, 'package/luci-app-sheepfold-family-internet-control/root');
function check(mutate = () => {}) {
  const parent = join(repo, '.build/test-fixtures');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'hardening-'));
  try {
    cpSync(rootSource, root, { recursive: true });
    const runtime = join(root, 'usr/libexec/sheepfold');
    const edit = (name, change) => { const path = join(runtime, name); writeFileSync(path, change(readFileSync(path, 'utf8'))); };
    mutate({ root, runtime, edit });
    const shellPath = value => shellTestPath(value, { cwd: repo });
    const result = spawnSync('sh', [shellPath(join(runtime, 'sheepfold-runtime-hardening')), shellPath(root)], {
      cwd: repo, encoding: 'utf8', timeout: runtimeTimeout(15000),
    });
    assert.ifError(result.error);
    return result;
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe('Installed rootfs hardening after shared-helper refactors', () => {
  it('accepts the unmodified package root including the delegated access policy', () => {
    const result = check();
    assert.equal(result.status, 0, result.stderr);
  });
  for (const [name, mutate] of [
    ['missing log path library', ({ runtime }) => rmSync(join(runtime, 'sheepfold-log-common'))],
    ['broken log path library syntax', ({ edit }) => edit('sheepfold-log-common', (s) => s + '\nif then\n')],
    ['missing shared policy', ({ runtime }) => rmSync(join(runtime, 'sheepfold-lib-access-policy'))],
    ['disconnected policy import', ({ edit }) => edit('sheepfold-client-status-effective', (s) => s.replace('. "$POLICY_COMMON"', ':'))],
    ['disconnected policy evaluator', ({ edit }) => edit('sheepfold-client-status-effective', (s) => s.replace('sheepfold_policy_evaluate "$device_section" "$client_mac"', ':'))],
    ['lost global block branch', ({ edit }) => edit('sheepfold-lib-access-policy', (s) => s.replaceAll('global_block', 'missing_reason'))],
    ['broken policy shell syntax', ({ edit }) => edit('sheepfold-lib-access-policy', (s) => s + '\nif then\n')],
    ['disconnected bound token reader', ({ edit }) => edit('sheepfold-router-control', (s) => s.replace('token_load_bound_file "$token_file"', ':'))],
  ]) it(`still rejects ${name}`, () => {
    const result = check(mutate);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Sheepfold hardening check failed/);
  });
});

// Structural guards name the damaged boundary; runtime attempt tests separately
// prove concurrency/accounting. A static guard is not a security attestation.
describe('Installed pairing attempt reservation after r294 extraction', () => {
  for (const [name, mutate, message] of [
    ['missing library', ({ runtime }) => rmSync(join(runtime, 'sheepfold-pair-attempt-common')), /missing file.*sheepfold-pair-attempt-common/],
    ['broken library syntax', ({ edit }) => edit('sheepfold-pair-attempt-common', (s) => s + '\nif then\n'), /shell syntax error.*sheepfold-pair-attempt-common/],
    ['disconnected CGI import', ({ edit }) => edit('sheepfold-api-pair', (s) => s.replace('. /usr/libexec/sheepfold/sheepfold-pair-attempt-common', ':')), /pairing attempt library is not connected/],
    ['disconnected activation import', ({ edit }) => edit('sheepfold-pair-activate', (s) => s.replace('. /usr/libexec/sheepfold/sheepfold-pair-attempt-common', ':')), /pairing attempt library is not connected/],
    ['missing reservation call', ({ edit }) => edit('sheepfold-api-pair', (s) => s.replace('pair_attempt_reserve "$attempt_identity_value"', ':')), /pairing request does not reserve an attempt/],
    ['missing persistent reservation', ({ edit }) => edit('sheepfold-pair-attempt-common', (s) => s.replace('pair_attempt_write "$((PAIR_ATTEMPT_PREVIOUS + 1))"', ':')), /pairing attempt reservation is not persisted/],
    ['missing kernel lock', ({ edit }) => edit('sheepfold-pair-attempt-common', (s) => s.replace('sheepfold_lock_acquire "$path" 3', ':')), /pairing attempt kernel lock is missing/],
    ['disconnected reset', ({ edit }) => edit('sheepfold-pair-activate', (s) => s.replace('pair_attempt_reset || return 1', ':')), /new pairing code does not reset reserved attempts/],
  ]) it(`rejects ${name} for the correct reason`, () => {
    const result = check(mutate);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  });
});
