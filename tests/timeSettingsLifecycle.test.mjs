/* §country1 §persist1
 * Real time panel, application adapter, Settings draft/save-flow and shell helper.
 * DOM, UCI and init/log endpoints are isolated recording models; no real clock,
 * network, host configuration, router, NTP service or cloud account is changed.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { it } from 'node:test';
import vm from 'node:vm';
import { shellTestPath } from '../tools/quality/testEnvironment.mjs';
import { completedProcess, runtimeTimeout, prepareFixtureFlock } from './helpers/runtimeProcess.mjs';

const repo = process.cwd();
const resources = resolve('package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold');
const helpers = resolve('package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold');
const copy = value => JSON.parse(JSON.stringify(value));
const oldRoot = process.env.SHEEPFOLD_TIME_SOURCE;
const sourceFile = (name, standard) => oldRoot ? resolve(oldRoot, name) : standard;
function record(name, value) {
  const dir = process.env.SHEEPFOLD_TIME_EVIDENCE;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name + '.json'), JSON.stringify(value, null, 2) + '\n');
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function element(tag, attrs = {}, children = []) {
  const node = { tag, attrs, children: Array.isArray(children) ? children : [children],
    value: attrs.value ?? '', checked: !!attrs.checked, disabled: !!attrs.disabled,
    hidden: !!attrs.hidden, events: {}, classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(name, fn) { this.events[name] = fn; },
  };
  Object.defineProperty(node, 'textContent', { get() { return this.children.map(child => typeof child === 'object' ? child?.textContent || '' : String(child ?? '')).join(''); }, set(value) { this.children = [String(value)]; } });
  if (tag === 'select') node.value = node.children.find(item => item.attrs?.selected)?.attrs.value || node.children[0]?.attrs.value || '';
  if (tag === 'textarea') node.value = node.textContent;
  return node;
}
function walk(node, test) {
  if (!node || typeof node !== 'object') return [];
  return (test(node) ? [node] : []).concat(...node.children.map(child => walk(child, test)));
}
function load(name, bindings = {}) {
  let file = join(resources, name + '.js');
  if (name === 'features/settings/time') file = sourceFile('time.js', file);
  const text = readFileSync(file, 'utf8').replace(/^'require .*?';\r?\n/gm, '');
  return vm.runInNewContext(`(function () { ${text} })()`, { baseclass: { extend: value => value }, E: element, _: text => text, Promise, Object, Array, String, Number, Error, JSON, ...bindings }, { filename: file });
}
const initialTime = { server_enabled: '0', client_enabled: '1', timezone_name: 'UTC', timezone: 'UTC0', servers: 'old.example.test', country_profile: 'ru' };
const success = options => ({ code: 0, stdout: 'status=ok\npersisted=1\nruntime_applied=1\ntimezone_name=' + options.timezone_name + '\n', stderr: '' });
function uiFixture() {
  const draftModel = load('features/settings/draft'), draft = draftModel.create(() => {});
  const notes = [], calls = [], stored = copy(initialTime), faults = {};
  const router = load('core/backend/router');
  const panel = load('features/settings/time');
  const application = readFileSync(sourceFile('application.js', join(resources, 'features/overview/application.js')), 'utf8');
  const start = application.indexOf('var timeSettings = settingsTimeModel.create({');
  const end = application.indexOf('\nvar emergencyPanel =', start);
  assert.ok(start >= 0 && end > start, 'real application time adapter found');
  let saver;
  const registerSaver = value => { saver = value; draft.registerSaver(value); };
  const get = (config, section, option, fallback) => {
    const values = { 'system.@system[0].zonename': 'UTC', 'system.@system[0].timezone': 'UTC0',
      'system.ntp.enabled': '1', 'system.ntp.enable_server': '0', 'system.ntp.server': 'old.example.test' };
    return values[[config, section, option].join('.')] ?? fallback;
  };
  const rawCommand = (args) => {
    if (args[0] === 'time-status') return Promise.resolve({ code: 0, stdout: 'system_configured=1\nclock_sane=1\n' });
    assert.equal(args[0], 'time-save');
    const keys = ['server_enabled', 'client_enabled', 'timezone_name', 'timezone', 'servers', 'country_profile'];
    const options = Object.fromEntries(keys.map((key, index) => [key, args[index + 1]]));
    calls.push(copy(options));
    if (faults.save) return faults.save(options);
    Object.assign(stored, options); return Promise.resolve(success(options));
  };
  // Use the real action wrapper: nonzero exits reject before the caller's .then.
  const actions = load('core/backend/actions').create({ run: rawCommand,
    withTimeout: args => rawCommand(args), parseKeyValues: router.parseKeyValues,
    actionMetadata: router.actionMetadata, errorText: router.errorText,
    notify: (...args) => notes.push(args) });
  const runCommand = (args, options) => actions.run(args, options);
  const time = vm.runInNewContext(`(function () { ${application.slice(start, end)}; return timeSettings; })()`, {
    settingsTimeModel: panel, environment: { get, ensureOk: router.ensureOk }, settingsDraft: { ...draft, registerSaver },
    settingsDraftModel: draftModel, settingValue: (option, fallback) => option === 'country_profile' ? 'ru' : fallback,
    deviceInventory: { listValues: value => String(value || '').split(/\s+/).filter(Boolean) },
    sharedForms: { checkboxControl(label, checked) { const input = element('input', { type: 'checkbox', checked }); return { input, node: element('label', {}, [label, input]) }; } },
    settingsController: { updateSaveButtons() {} }, runCommand, routerBackend: router,
    _: text => text, Promise, Error, Object,
  }, { filename: 'application.time-adapter.js' });
  const root = time.render();
  const checks = walk(root, node => node.tag === 'input');
  const inputs = { server_enabled: checks[0], client_enabled: checks[1], servers: walk(root, node => node.tag === 'textarea')[0], timezone: walk(root, node => node.tag === 'select')[0] };
  const set = (key, value) => { const input = inputs[key]; if (key.endsWith('_enabled')) input.checked = value === '1'; else input.value = value; input.events.input?.({ currentTarget: input }); };
  const flow = load('features/settings/save-flow').create({ draft, persistence: { validate() {}, save: () => Promise.resolve() },
    value: () => 'never', applyRuntime: () => Promise.resolve(), applyPostSave: () => Promise.resolve(),
    updateButtons() {}, notify: (...args) => notes.push(args), notifyCentered: text => notes.push([text, 'success']),
    errorText: error => error.message, confirmWifiAutoDisable: () => true });
  return { draft, notes, calls, stored, faults, saver, set, root, time, save: flow.save };
}

const uciModel = `#!/bin/sh
staged=0
while [ "$#" -gt 0 ]; do
 case "$1" in -q) shift ;; -t) staged=1; shift 2 ;; -p) shift 2 ;; *) break ;; esac
done
cmd="$1"; shift
state="$TIME_TEST_STATE"; delta="$state.delta"
[ -f "$delta" ] || : > "$delta"
printf 'uci %s %s\\n' "$cmd" "$*" >> "$TIME_TEST_TRACE"
case "$cmd" in
 get)
   if [ "$staged" = 1 ]; then files="$delta"; else files=/dev/null; fi
   awk -v key="$1" 'index($0,key "=")==1 { value=substr($0,length(key)+2); found=1 } END { if(found) print value; else exit 1 }' "$state" "$files"
   ;;
 set|add_list)
   key="\${1%%=*}"; value="\${1#*=}"
   awk -v key="$key" -v value="$value" -v add="$cmd" 'index($0,key "=")!=1 { print; next } { if(add=="add_list") old=substr($0,length(key)+2) } END { print key "=" (old!=""?old " ":"") value }' "$delta" > "$delta.tmp" && mv "$delta.tmp" "$delta"
   ;;
 delete)
   # Fixtures only delete the old NTP server list, represented as an empty staged list.
   awk -v key="$1" 'index($0,key "=")!=1 { print } END { print key "=" }' "$delta" > "$delta.tmp" && mv "$delta.tmp" "$delta"
   ;;
 commit)
   awk -v prefix="$1." 'FNR==NR { n=index($0,"="); if(n) values[substr($0,1,n-1)]=substr($0,n+1); next } index($0,prefix)==1 { n=index($0,"="); values[substr($0,1,n-1)]=substr($0,n+1) } END { for(key in values) print key "=" values[key] }' "$state" "$delta" > "$state.tmp" && mv "$state.tmp" "$state" || exit 1
   awk -v prefix="$1." 'index($0,prefix)!=1' "$delta" > "$delta.tmp" && mv "$delta.tmp" "$delta"
   ;;
 *) exit 2 ;;
esac
`;
function shellRun({ restartCode = 0, logCode = 0, loggerCode = 0, logOutput = '', loggerOutput = '', hasInit = true, hasLog = true, invalid = false, throughLuci = false, options = null } = {}) {
  const build = resolve('.build/time-lifecycle'); mkdirSync(build, { recursive: true });
  const root = mkdtempSync(join(build, 'case-')), bin = join(root, 'bin'); mkdirSync(bin);
  const path = value => shellTestPath(value, { cwd: repo });
  const put = (name, body) => { const file = join(bin, name); writeFileSync(file, body); chmodSync(file, 0o755); return file; };
  const statePath = join(root, 'state.txt'), tracePath = join(root, 'trace');
  writeFileSync(statePath, Object.entries({ 'system.@system[0]': 'system', 'system.@system[0].zonename': 'UTC', 'system.@system[0].timezone': 'UTC0', 'system.ntp': 'timeserver', 'system.ntp.server': 'old.example.test', 'system.ntp.enabled': '1', 'system.ntp.enable_server': '0', 'sheepfold.global': 'sheepfold', 'sheepfold.global.country_profile': 'ru' }).map(([key, value]) => key + '=' + value).join('\n') + '\n');
  writeFileSync(join(root, 'system'), 'synthetic system snapshot\n'); writeFileSync(join(root, 'sheepfold'), 'synthetic app snapshot\n');
  put('uci', uciModel); prepareFixtureFlock(put);
  put('logger', '#!/bin/sh\nprintf "logger\\n" >> "$TIME_TEST_TRACE"\nprintf "%s" "$TIME_LOGGER_OUTPUT"\nexit "$TIME_LOGGER_CODE"\n');
  const logFile = put('log', '#!/bin/sh\nprintf "log\\n" >> "$TIME_TEST_TRACE"\nprintf "%s" "$TIME_LOG_OUTPUT"\nexit "$TIME_LOG_CODE"\n');
  const initFile = put('sysntpd', '#!/bin/sh\nprintf "sysntpd %s\\n" "$*" >> "$TIME_TEST_TRACE"\nexit "$TIME_RESTART_CODE"\n');
  const entry = put('entry', readFileSync(sourceFile('sheepfold-time-control', join(helpers, 'sheepfold-time-control')), 'utf8'));
  const control = put('control', '#!/bin/sh\n[ "${1:-}" != --luci ] || shift\n[ "$1" = time-save ] || exit 2\nshift\nexec sh "$TIME_ENTRY" save "$@"\n');
  const launcher = put('launch', `#!/bin/sh\nPATH='${path(bin)}':"$PATH"\nexport PATH\nexec sh "$@"\n`);
  const env = { ...process.env, PYTHONUTF8: '1', TIME_TEST_STATE: path(statePath), TIME_TEST_TRACE: path(tracePath), TIME_RESTART_CODE: String(restartCode), TIME_LOG_CODE: String(logCode), TIME_LOGGER_CODE: String(loggerCode), TIME_LOG_OUTPUT: logOutput, TIME_LOGGER_OUTPUT: loggerOutput,
    SHEEPFOLD_LOCK_COMMON: path(join(helpers, 'sheepfold-lock-common')), SHEEPFOLD_TIME_LOCK: path(join(root, 'time.lock')),
    SHEEPFOLD_TIME_TRANSACTION_ROOT: path(join(root, 'transactions')), SHEEPFOLD_TIME_SYSTEM_CONFIG: path(join(root, 'system')), SHEEPFOLD_TIME_APP_CONFIG: path(join(root, 'sheepfold')),
    SHEEPFOLD_SYSNTPD_INIT: path(hasInit ? initFile : join(root, 'missing-init')), SHEEPFOLD_LOG_HELPER: path(hasLog ? logFile : join(root, 'missing-log')),
    SHEEPFOLD_ROUTER_CONTROL: path(control), SHEEPFOLD_LUCI_ACTION_RUNTIME_DIR: path(join(root, 'luci-actions')), TIME_ENTRY: path(entry) };
  const input = options || { server_enabled: '1', client_enabled: '1', timezone_name: 'Europe/Minsk', timezone: '+03-3', servers: 'new.example.test', country_profile: 'by' };
  const result = completedProcess(spawnSync(process.platform === 'win32' ? 'bash' : 'sh', [path(launcher), path(throughLuci ? join(helpers, 'sheepfold-luci-action') : entry), throughLuci ? 'time-save' : 'save', input.server_enabled, input.client_enabled, input.timezone_name, input.timezone, invalid ? 'bad/host' : input.servers, input.country_profile], { cwd: repo, env, encoding: 'utf8', timeout: runtimeTimeout(20000) }), 'time helper');
  const output = { result: { code: result.status, stdout: result.stdout, stderr: result.stderr }, state: Object.fromEntries(readFileSync(statePath, 'utf8').trim().split('\n').map(line => { const n = line.indexOf('='); return [line.slice(0, n), line.slice(n + 1)]; })), trace: existsSync(tracePath) ? readFileSync(tracePath, 'utf8').split('\n').filter(Boolean) : [] };
  rmSync(root, { recursive: true, force: true }); return output;
}

for (const [key, first, later] of [['servers', 'first.example.test', 'later.example.test'], ['server_enabled', '1', '0'], ['client_enabled', '0', '1'], ['timezone', 'Europe/Minsk|+03-3', 'UTC|UTC0']]) {
  it(`time Save preserves late ${key} and explicit repeat saves it`, async () => {
    const f = uiFixture(), entered = deferred(), done = deferred(); f.set(key, first);
    f.faults.save = async options => { Object.assign(f.stored, options); entered.resolve(); await done.promise; return success(options); };
    const saving = f.save(); await entered.promise; f.set(key, later); done.resolve(); await saving;
    record('late-' + key, { calls: f.calls, stored: f.stored, dirty: f.saver.isChanged() });
    assert.equal(f.saver.isChanged(), true, 'later edit was not sent');
    delete f.faults.save; await f.save(); assert.equal(f.saver.isChanged(), false);
    assert.equal(f.calls.length, 2); assert.equal(f.stored[key === 'timezone' ? 'timezone_name' : key], key === 'timezone' ? 'UTC' : later);
  });
}
it('time Save keeps a newly added field dirty, accepting only the sent options', async () => {
  const f = uiFixture(), entered = deferred(), done = deferred(); f.set('servers', 'first.example.test');
  f.faults.save = async options => { Object.assign(f.stored, options); entered.resolve(); await done.promise; return success(options); };
  const saving = f.save(); await entered.promise; f.set('server_enabled', '1'); done.resolve(); await saving;
  assert.equal(f.stored.server_enabled, '0'); assert.equal(f.saver.isChanged(), true);
});
it('unchanged successful time Save becomes clean and keeps explicit country recommendation', async () => {
  const f = uiFixture(); f.time.setCountry('by');
  walk(f.root, node => node.tag === 'button' && node.textContent === 'Use country recommendation')[0].attrs.click({ preventDefault() {} });
  await f.save(); assert.equal(f.saver.isChanged(), false); assert.equal(f.stored.timezone_name, 'Europe/Minsk'); assert.equal(f.stored.country_profile, 'by');
});
for (const phase of ['sync', 'reject', 'exit']) {
  it(`unconfirmed time ${phase} failure keeps the draft and permits manual retry`, async () => {
    const f = uiFixture(); f.set('servers', 'first.example.test');
    f.faults.save = () => { if (phase === 'sync') throw new Error('synthetic'); if (phase === 'reject') return Promise.reject(new Error('synthetic')); return Promise.resolve({ code: 4, stdout: '', stderr: 'synthetic' }); };
    await assert.rejects(f.save()); assert.equal(f.saver.isChanged(), true); assert.equal(f.draft.isSaving(), false);
    delete f.faults.save; await f.save(); assert.equal(f.saver.isChanged(), false);
  });
}
it('time double click during the same save does not duplicate the command', async () => {
  const f = uiFixture(), entered = deferred(), done = deferred(); f.set('servers', 'first.example.test');
  f.faults.save = async options => { entered.resolve(); await done.promise; return success(options); };
  const first = f.save(); await entered.promise; const second = f.save(); assert.equal(first, second); done.resolve(); await first; assert.equal(f.calls.length, 1);
});
it('actual time helper reports failed sysntpd restart after committed settings', () => {
  const run = shellRun({ restartCode: 9 }); record('restart-exit', run);
  assert.ok(run.trace.includes('sysntpd restart')); assert.equal(run.state['system.@system[0].zonename'], 'Europe/Minsk');
  assert.notEqual(run.result.code, 0); assert.match(run.result.stdout, /^persisted=1$/m); assert.match(run.result.stdout, /^runtime_applied=0$/m); assert.match(run.result.stdout, /^error=ntp_restart_failed$/m);
});
it('actual failed-restart response reaches the time UI as a persisted warning, not a second save', async () => {
  let run; const f = uiFixture(); f.set('servers', 'first.example.test');
  f.faults.save = options => { run = shellRun({ restartCode: 9, throughLuci: true, options }); return Promise.resolve(run.result); };
  const error = await f.save().then(() => null, value => value); record('restart-ui', { run, error: error?.message, persisted: error?.persisted, dirty: f.saver.isChanged(), notes: f.notes });
  assert.equal(run.state['system.ntp.server'], 'first.example.test');
  assert.match(run.result.stderr, /^actionExitCode=5$/m);
  assert.ok(error); assert.equal(error.persisted, true); assert.equal(error.runtimeApplied, false); assert.equal(f.saver.isChanged(), false);
  assert.equal(f.notes.some(([, kind]) => kind === 'success'), false); assert.equal(f.notes.some(([text]) => /were saved/.test(text)), true);
  await f.save(); assert.equal(f.calls.length, 1);
});
it('confirmed time restart failure accepts only its own snapshot, keeping later edits dirty', async () => {
  const run = shellRun({ restartCode: 9 }), f = uiFixture(), entered = deferred(), done = deferred(); f.set('servers', 'first.example.test');
  f.faults.save = async () => { entered.resolve(); await done.promise; return run.result; };
  const saving = f.save().then(() => null, error => error); await entered.promise; f.set('servers', 'later.example.test'); done.resolve();
  const error = await saving; assert.ok(error); assert.equal(error.persisted, true); assert.equal(f.saver.isChanged(), true);
  delete f.faults.save; await f.save(); assert.equal(f.stored.servers, 'later.example.test'); assert.equal(f.saver.isChanged(), false);
});
it('plain validation or commit failure is not inferred to be a persisted result', async () => {
  const f = uiFixture(); f.set('servers', 'first.example.test'); f.faults.save = () => Promise.resolve({ code: 4, stdout: 'status=error\n', stderr: 'synthetic' });
  const error = await f.save().then(() => null, value => value); assert.ok(error); assert.notEqual(error.persisted, true); assert.equal(f.saver.isChanged(), true);
});
for (const [label, options] of [
  ['noisy-success', { logOutput: 'unrelated-output\n' }],
  ['failed-helper', { logCode: 7 }],
  ['failed-helper-noisy-fallback', { logCode: 7, loggerOutput: 'fallback-noise\n' }],
  ['both-failed', { logCode: 7, loggerCode: 8 }],
  ['missing-helper', { hasLog: false, loggerOutput: 'fallback-noise\n' }],
]) {
  it(`time ${label} diagnostic does not replace the committed outcome or pollute stdout`, () => {
    const run = shellRun(options); record(label, run);
    assert.equal(run.state['system.ntp.server'], 'new.example.test'); assert.ok(run.trace.includes('sysntpd restart'));
    assert.equal(run.result.code, 0, run.result.stderr); assert.match(run.result.stdout, /^status=ok$/m); assert.doesNotMatch(run.result.stdout, /unrelated-output|fallback-noise/);
    if (options.logCode || options.hasLog === false) assert.ok(run.trace.includes('logger'), 'fallback actually invoked');
    if (options.loggerCode) assert.match(run.result.stderr, /log|journal/i);
  });
}
it('log failure does not hide failed restart after settings are already saved', () => {
  const run = shellRun({ restartCode: 9, logCode: 7, loggerCode: 8 }); record('restart-and-log-failed', run);
  assert.notEqual(run.result.code, 0); assert.match(run.result.stdout, /^error=ntp_restart_failed$/m); assert.match(run.result.stdout, /^persisted=1$/m);
});
it('missing optional sysntpd preserves the previous supported no-restart path', () => {
  const run = shellRun({ hasInit: false }); assert.equal(run.result.code, 0, run.result.stderr); assert.equal(run.trace.includes('sysntpd restart'), false); assert.match(run.result.stdout, /^status=ok$/m);
});
it('invalid time input still stops before mutation, restart and diagnostics', () => {
  const run = shellRun({ invalid: true }); assert.notEqual(run.result.code, 0); assert.equal(run.state['system.@system[0].zonename'], 'UTC'); assert.equal(run.trace.some(row => /^(?:sysntpd|log|logger) /.test(row)), false); assert.doesNotMatch(run.result.stdout, /persisted=1/);
});

for (const code of [4, 124]) {
  it(`partial persisted fields with exit ${code} do not falsely acknowledge the time draft`, async () => {
    const f = uiFixture(); f.set('servers', 'first.example.test');
    f.faults.save = () => Promise.resolve({ code, stdout: 'status=error\nerror=ntp_restart_failed\npersisted=1\nruntime_applied=0\n', stderr: 'synthetic interrupted result' });
    const error = await f.save().then(() => null, value => value);
    assert.ok(error); assert.notEqual(error.persisted, true); assert.equal(f.saver.isChanged(), true);
  });
}
it('an unconfirmed later time save cannot reuse the previous acknowledged snapshot', async () => {
  const f = uiFixture(); f.set('servers', 'first.example.test'); await f.save();
  f.set('servers', 'later.example.test'); f.faults.save = () => Promise.reject(new Error('synthetic transport failure'));
  await assert.rejects(f.save()); f.saver.accept(); assert.equal(f.saver.isChanged(), true);
  assert.equal(f.stored.servers, 'first.example.test');
});
it('time restart warning has a Russian catalogue entry', () => {
  const messages = JSON.parse(readFileSync(sourceFile('ru.json', join(resources, 'i18n/ru.json')), 'utf8'));
  assert.equal(messages['Router time settings were saved, but NTP could not be restarted. Check the time service before relying on schedules.'],
    'Настройки времени сохранены, но службу синхронизации не удалось перезапустить. Проверьте время на роутере перед использованием расписаний.');
});
