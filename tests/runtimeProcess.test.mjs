/* Test-only policies. Platform arguments exercise decisions, not Windows itself. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { runtimeTimeout, completedProcess, prepareFixtureFlock } from './helpers/runtimeProcess.mjs';
import { shellTestPath } from '../tools/quality/testEnvironment.mjs';

it('preserves the POSIX budget and raises only the Windows fixture budget', () => {
  assert.equal(runtimeTimeout(15000, { platform: 'linux', env: {} }), 15000);
  assert.equal(runtimeTimeout(20000, { platform: 'win32', env: {} }), 120000);
});
it('accepts an explicit bounded test budget', () => {
  assert.equal(runtimeTimeout(20000, { env: { SHEEPFOLD_TEST_PROCESS_TIMEOUT_MS: '150000' } }), 150000);
});
for (const value of ['0', '-1', 'Infinity', '600001', '5x', '']) {
  it(`rejects invalid fixture budget ${JSON.stringify(value)}`, () => {
    assert.throws(() => runtimeTimeout(20000, { env: { SHEEPFOLD_TEST_PROCESS_TIMEOUT_MS: value } }), /1\.\.600000/);
  });
}
it('does not turn an expected product exit into a harness exception', () => {
  const result = { status: 78, stdout: '{"ok":false}', stderr: '' };
  assert.equal(completedProcess(result), result);
});
it('reports the original ETIMEDOUT before any JSON parser is invoked', () => {
  const error = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
  assert.throws(() => completedProcess({ error, status: null, stderr: '' }, 'test CGI'),
    e => e.message.includes('test CGI: ETIMEDOUT') && e.cause === error);
});
it('reports spawn failure and an unexpected signal distinctly', () => {
  assert.throws(() => completedProcess({ error: { code: 'ENOENT' }, status: null }), /ENOENT/);
  assert.throws(() => completedProcess({ status: null, signal: 'SIGTERM' }), /SIGTERM/);
});
it('detects a real timed-out child without interpreting empty stdout as JSON', () => {
  const result = spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { timeout: 50, encoding: 'utf8' });
  assert.throws(() => completedProcess(result, 'delayed child'), /ETIMEDOUT/);
});
it('does not inject a lock model when the real utility is present', () => {
  assert.equal(prepareFixtureFlock(() => assert.fail('unexpected stub'), { platform: 'linux', probe: () => true }), 'native');
});
it('does not replace a missing Linux lock with a success stub', () => {
  assert.throws(() => prepareFixtureFlock(() => assert.fail('unexpected stub'), { platform: 'linux', probe: () => false }), /Missing flock/);
});
it('declares a sequential-only model for Windows without flock', () => {
  const written = [];
  assert.equal(prepareFixtureFlock((...args) => written.push(args), { platform: 'win32', probe: () => false }), 'sequential-model');
  assert.equal(written[0][0], 'flock');
  assert.match(written[0][1], /NOT a lock/);
});
it('resolves the Yandex fixture path against the same cwd on Windows', () => {
  const repo = 'C:\\work\\repo';
  const root = `${repo}\\.build\\yandex-context\\case-123`;
  const entry = `${root}\\bin\\entry`;
  const relative = shellTestPath(entry, { cwd: repo, allowedRoot: root, platform: 'win32' });
  assert.equal(path.win32.resolve(repo, relative), entry);
  assert.notEqual(path.win32.resolve(root, relative), entry, 'control reproduces old repeated prefix');
  const source = readFileSync(new URL('./yandexContextRuntime.test.mjs', import.meta.url), 'utf8');
  assert.match(source, /cwd: repo, env, encoding: 'utf8', timeout: runtimeTimeout/);
});
it('keeps Linux-only concurrency gates in both repaired standalone fixtures', () => {
  for (const file of ['maintenanceRotationRuntime.test.mjs', 'googleDriveUploadRuntime.test.mjs']) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.match(source, /prepareFixtureFlock\(put\)/);
    assert.ok(/skip:\s*!native/.test(source), `${file}: native gate removed`);
  }
});
