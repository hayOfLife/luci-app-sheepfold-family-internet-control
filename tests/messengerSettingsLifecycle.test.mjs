/* §persist1 §ovfinal1
 * Real messenger panel, Settings controller, draft/save-flow and action wrapper.
 * DOM, router commands and service exec are recording models with Promise barriers.
 * No live UCI, Telegram, credentials, browser, RPC or router changes are involved.
 */
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { it } from 'node:test';
import vm from 'node:vm';

const resourceRoot = resolve('package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold');
const copy = value => JSON.parse(JSON.stringify(value));
const tr = text => text;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function node(tag, attrs = {}, children = []) {
  const attributes = { ...attrs };
  const item = { tag, attrs: attributes, children: Array.isArray(children) ? children : [children],
    value: attrs.value ?? '', disabled: !!attrs.disabled, hidden: attrs.hidden || false,
    className: attrs.class || '', events: {}, classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(name, fn) { this.events[name] = fn; },
    setAttribute(name, value) { attributes[name] = value; },
    getAttribute(name) { return attributes[name] ?? null; },
    removeAttribute(name) { delete attributes[name]; },
    replaceChildren(...values) { this.children = values; },
  };
  Object.defineProperty(item, 'childNodes', { get() { return this.children; } });
  Object.defineProperty(item, 'textContent', { get() { return this.children.map(child => typeof child === 'object' ? child?.textContent || '' : String(child ?? '')).join(''); },
    set(value) { this.children = [String(value)]; } });
  if (tag === 'select') item.value = item.children.find(child => child.attrs?.selected)?.attrs.value ?? item.children[0]?.attrs.value ?? '';
  return item;
}
function walk(root, predicate) {
  if (!root || typeof root !== 'object') return [];
  return (predicate(root) ? [root] : []).concat(...root.children.map(child => walk(child, predicate)));
}
function record(name, value) {
  const directory = process.env.SHEEPFOLD_MESSENGER_EVIDENCE;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, name + '.json'), JSON.stringify(value, null, 2) + '\n');
}
function load(name, bindings = {}) {
  const overrides = {
    'features/messenger/settings': 'messenger-settings.js',
    'features/settings/controller': 'settings-controller.js',
  };
  const file = process.env.SHEEPFOLD_MESSENGER_SOURCE && overrides[name] ?
    resolve(process.env.SHEEPFOLD_MESSENGER_SOURCE, overrides[name]) : resolve(resourceRoot, name + '.js');
  const source = readFileSync(file, 'utf8').replace(/^'require .*?';\r?\n/gm, '');
  return vm.runInNewContext(`(function () { ${source} })()`, {
    baseclass: { extend: value => value }, E: node, _: tr,
    document: { querySelectorAll: () => [] }, Promise, Object, Array, String, Number,
    Boolean, Error, JSON, Math, Date, RegExp, ...bindings,
  }, { filename: file });
}
function fixture({ throughController = false, initial = {} } = {}) {
  const saved = { active_messenger: 'telegram', telegram_bot_token: 'synthetic-token-original',
    telegram_admin_chat_id: '100', vk_access_token: 'synthetic-vk-original',
    vk_community_id: '200', vk_admin_user_id: '300', ...initial };
  const trace = [], notes = [], faults = {}, buttons = [];
  let saver, capturedDeps, root;
  const raw = async args => {
    args = Array.from(args); trace.push(['router', args]);
    const stage = args[0].startsWith('messenger-save') || args[0] === 'messenger-disable' ? 'save' : args[0] === 'messenger-status' ? 'status' : 'check';
    if (faults[stage]) return faults[stage](args);
    if (args[0] === 'messenger-save-telegram') Object.assign(saved, { active_messenger: 'telegram', telegram_bot_token: args[1], telegram_admin_chat_id: args[2] });
    if (args[0] === 'messenger-save-vk') Object.assign(saved, { active_messenger: 'vk', vk_access_token: args[1], vk_community_id: args[2], vk_admin_user_id: args[3] });
    if (args[0] === 'messenger-disable') saved.active_messenger = 'none';
    return { code: 0, stdout: stage === 'status' ? 'active=' + saved.active_messenger + '\n' : stage === 'check' ? 'status=connected\nactive=' + saved.active_messenger + '\n' : 'OK\n', stderr: '' };
  };
  const filesystem = { exec: (file, args) => {
    trace.push(['exec', file, Array.from(args)]);
    const fn = args[0] === 'restart' ? faults.restart : faults.test;
    return Promise.resolve(fn ? fn(file, args) : { code: 0, stdout: 'OK\n', stderr: '' });
  } };
  const parseOutput = text => Object.fromEntries(String(text).split('\n').filter(line => line.includes('=')).map(line => { const n = line.indexOf('='); return [line.slice(0, n), line.slice(n + 1)]; }));
  const actions = load('core/backend/actions').create({ run: raw, parseKeyValues: parseOutput, notify: (...args) => notes.push(args) });
  const draftModel = load('features/settings/draft'), draft = draftModel.create(() => {});
  const panel = load('features/messenger/settings', { fs: filesystem });
  const dependencies = {
    get: (key, fallback) => saved[key] ?? fallback, icon: () => node('span'),
    routerControl: actions.run, command: spec => actions.execute(spec), ensureOk: actions.ensureOk,
    parseOutput, errorText: error => error.message || 'failure', notify: (...args) => notes.push(args),
    changed() {}, registerSaver(value) { saver = value; draft.registerSaver(value); }, sameValues: draftModel.sameValues,
  };
  if (!throughController) { capturedDeps = dependencies; root = panel.settingsBox(dependencies); }
  else {
    const empty = () => node('div');
    const controller = load('features/settings/controller', {
      settingsFieldsModel: { create: () => ({}) }, settingsMiscModel: { create: () => ({ render: empty, confirmWifiAutoDisable: () => true }) },
      settingsStorageModel: { create: () => ({ render: empty }) }, settingsAiModel: { create: () => ({ render: empty }) },
      homeNetworkModel: { render: empty }, settingsSaveFlowModel: { create: () => ({ bar: empty, save: () => Promise.resolve() }) },
    }).create({
      value: dependencies.get, globalValue: dependencies.get, forms: {}, icon: dependencies.icon,
      draft: { ...draft, registerSaver: dependencies.registerSaver }, persistence: {}, sideEffects: {},
      navigation: { snapshot: () => ({ activeSettingsTab: 'messenger' }), selectSettings() {} },
      navigationModel: { isKnownSettingsTab: () => true, settingsPrimaryTabs: () => [], settingsSecondaryTabs: () => [] },
      siteListStatus: {}, timeSettings: {}, generalModel: { render: empty }, integrationPanel: { render: empty },
      messengerSettings: { settingsBox(deps) { capturedDeps = deps; return panel.settingsBox(deps); } },
      notificationSettings: { render: empty }, feedbackPanel: { render: empty }, emergency: { render: empty },
      routerInfo: { panel: empty, status: () => 'ready' }, actions, run: actions.run, parseKeyValues: parseOutput,
      notify: dependencies.notify, sameValues: draftModel.sameValues,
    });
    root = controller.render();
  }
  const inputs = {};
  walk(root, element => !!element.sfOption).forEach(element => { inputs[element.sfOption] = element.sfInput; });
  const select = walk(root, element => element.tag === 'select')[0];
  const testButton = walk(root, element => element.tag === 'button' && element.textContent === 'Send test Telegram message')[0];
  buttons.push(testButton);
  const set = (key, value) => {
    const element = key === 'active_messenger' ? select : inputs[key]; element.value = value;
    const event = { currentTarget: element, preventDefault() {} };
    if (key === 'active_messenger') element.attrs.change(event);
    else element.events.input?.(event);
  };
  const click = () => {
    const event = { currentTarget: testButton, preventDefault() {} };
    const pending = testButton.attrs.click(event);
    event.currentTarget = null;
    return pending;
  };
  const flow = load('features/settings/save-flow').create({ draft, persistence: { validate() {}, save: () => Promise.resolve() },
    applyRuntime: () => Promise.resolve(), applyPostSave: () => Promise.resolve(), value: () => 'never',
    updateButtons() {}, notify: dependencies.notify, notifyCentered: message => notes.push([message, 'success']),
    errorText: error => error.message || 'failure', confirmWifiAutoDisable: () => true });
  const save = () => flow.save();
  const status = () => walk(root, element => element.className.startsWith('sf-messenger-status '))[0];
  return { saved, trace, notes, faults, inputs, select, root, capturedDeps, actions, draft, saver, set, click, save, testButton, status };
}
const sentTests = f => f.trace.filter(row => row[0] === 'exec' && row[2][0] === 'send-test');
const saveCalls = f => f.trace.filter(row => row[0] === 'router' && (row[1][0].startsWith('messenger-save') || row[1][0] === 'messenger-disable'));

it('test button stays disabled after browser dispatch clears currentTarget', async () => {
  const f = fixture(), gate = deferred();
  f.faults.test = () => gate.promise;
  const pending = f.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.testButton.disabled, true);
  gate.resolve({ code: 0, stdout: 'OK\n', stderr: '' });
  await pending;
  assert.equal(f.testButton.disabled, false);
  assert.equal(sentTests(f).length, 1);
});

it('real Settings controller wires the Telegram test action and runs only send-test', async () => {
  const f = fixture({ throughController: true });
  let error;
  try { await f.click(); } catch (value) { error = value; }
  await new Promise(resolve => setImmediate(resolve));
  record('controller-click', { error: error?.message, trace: f.trace, notes: f.notes });
  assert.equal(error, undefined);
  assert.equal(sentTests(f).length, 1);
  assert.equal(saveCalls(f).length, 0);
  assert.equal(f.testButton.disabled, false);
});
for (const [key, value] of [['telegram_bot_token', 'synthetic-unconfirmed'], ['telegram_admin_chat_id', '999'], ['active_messenger', 'none']]) {
  it(`test message refuses unsaved ${key} without saving or sending`, async () => {
    const f = fixture(); f.set(key, value); const before = copy(f.saved);
    await f.click(); await new Promise(resolve => setImmediate(resolve));
    record('unsaved-' + key, { before, after: f.saved, trace: f.trace, notes: f.notes });
    assert.equal(saveCalls(f).length, 0); assert.equal(sentTests(f).length, 0);
    assert.deepEqual(f.saved, before); assert.equal(f.saver.isChanged(), true);
    assert.ok(f.notes.some(([message]) => /save/i.test(message)));
  });
}
it('test message cannot silently switch a saved VK configuration to Telegram', async () => {
  const f = fixture({ initial: { active_messenger: 'vk' } }); const before = copy(f.saved);
  await f.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(saveCalls(f).length, 0); assert.equal(sentTests(f).length, 0);
  assert.deepEqual(f.saved, before); assert.equal(f.select.value, 'vk');
});
it('ordinary explicit Save persists Telegram, clears only submitted edits and permits test', async () => {
  const f = fixture(); f.set('telegram_admin_chat_id', '123');
  assert.equal((await f.save()).persisted, true); assert.equal(f.saved.telegram_admin_chat_id, '123');
  assert.equal(f.saver.isChanged(), false); assert.equal(saveCalls(f).length, 1);
  await f.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(sentTests(f).length, 1); assert.equal(saveCalls(f).length, 1);
});
for (const phase of ['restart', 'status', 'check']) {
  for (const key of ['telegram_admin_chat_id', 'active_messenger']) {
    it(`preserves late ${key} while ${phase} is pending`, async () => {
      const f = fixture(), entered = deferred(), release = deferred(); f.set('telegram_admin_chat_id', '123');
      f.faults[phase] = async () => { entered.resolve(); await release.promise; return { code: 0, stdout: phase === 'restart' ? '' : phase === 'status' ? 'active=telegram\n' : 'status=connected\nactive=telegram\n' }; };
      const running = f.save(); await entered.promise;
      f.set(key, key === 'active_messenger' ? 'none' : '456'); release.resolve(); await running;
      record('late-' + phase + '-' + key, { saved: f.saved, trace: f.trace, dirty: f.saver.isChanged(), input: key === 'active_messenger' ? f.select.value : f.inputs[key].value, plaque: f.status().textContent });
      assert.equal(f.saved.telegram_admin_chat_id, '123'); assert.equal(f.saved.active_messenger, 'telegram');
      assert.equal(f.saver.isChanged(), true); assert.equal(sentTests(f).length, 0);
      assert.notEqual(f.status().className, 'sf-messenger-status sf-messenger-status-ok');
      delete f.faults[phase]; await f.save(); assert.equal(f.saver.isChanged(), false);
      assert.equal(f.saved[key], key === 'active_messenger' ? 'none' : '456');
    });
  }
}
it('saving active Telegram does not accept modified VK fields it never submitted', async () => {
  const f = fixture(); f.set('vk_admin_user_id', '999'); f.set('telegram_admin_chat_id', '123');
  await f.save(); record('inactive-fields', { trace: f.trace, saved: f.saved, dirty: f.saver.isChanged() });
  assert.equal(f.saved.vk_admin_user_id, '300'); assert.equal(f.saver.isChanged(), true);
  f.set('active_messenger', 'vk'); await f.save();
  assert.equal(f.saved.vk_admin_user_id, '999'); assert.equal(f.saver.isChanged(), false);
});
it('disable only acknowledges active_messenger and preserves unsubmitted token', async () => {
  const f = fixture(); f.set('telegram_bot_token', 'synthetic-later'); f.set('active_messenger', 'none');
  await f.save(); assert.equal(f.saved.active_messenger, 'none'); assert.equal(f.saved.telegram_bot_token, 'synthetic-token-original');
  assert.equal(f.saver.isChanged(), true);
});
for (const failure of ['exit', 'reject', 'sync']) {
  it(`restart ${failure} is not hidden after confirmed messenger save`, async () => {
    const f = fixture(); f.set('telegram_admin_chat_id', '123');
    f.faults.restart = () => { if (failure === 'exit') return { code: 1, stdout: '', stderr: 'synthetic_restart_failure' }; if (failure === 'reject') return Promise.reject(new Error('synthetic_restart_failure')); throw new Error('synthetic_restart_failure'); };
    const result = await f.save().then(value => ({ value }), error => ({ error }));
    record('restart-' + failure, { trace: f.trace, saved: f.saved, notes: f.notes, error: result.error?.message, persisted: result.error?.persisted });
    assert.ok(result.error); assert.equal(result.error.persisted, true);
    assert.equal(f.saved.telegram_admin_chat_id, '123'); assert.equal(f.saver.isChanged(), false);
    assert.equal(f.notes.some(([, level]) => level === 'success'), false);
    assert.equal(f.trace.some(row => row[0] === 'router' && row[1][0] === 'messenger-check'), false);
  });
}
it('failed restart preserves edits entered during restart while accepting the submitted values', async () => {
  const f = fixture(), entered = deferred(), release = deferred(); f.set('telegram_admin_chat_id', '123');
  f.faults.restart = async () => { entered.resolve(); await release.promise; return { code: 1, stdout: '', stderr: 'synthetic_restart_failure' }; };
  const result = f.save().catch(error => error); await entered.promise; f.set('telegram_admin_chat_id', '456'); release.resolve();
  assert.equal((await result).persisted, true); assert.equal(f.saver.isChanged(), true); assert.equal(f.inputs.telegram_admin_chat_id.value, '456');
});
it('failed save is not accepted even if the old active messenger matches', async () => {
  const f = fixture(); f.set('telegram_admin_chat_id', '123'); f.faults.save = () => ({ code: 1, stdout: 'OK\n', stderr: 'synthetic_save_failure' });
  await assert.rejects(f.save()); assert.equal(f.saver.isChanged(), true); assert.equal(f.saved.telegram_admin_chat_id, '100');
  assert.equal(f.trace.some(row => row[0] === 'exec'), false);
});
it('failed or mismatched messenger readback is not a successful save notification', async () => {
  for (const stdout of ['', 'active=vk\n']) {
    const f = fixture(); f.set('telegram_admin_chat_id', '123'); f.faults.status = () => ({ code: 0, stdout });
    await assert.rejects(f.save()); assert.equal(f.notes.some(([, level]) => level === 'success'), false);
  }
});
it('connection failure stays a warning rather than connected after a successful config write', async () => {
  const f = fixture(); f.set('telegram_admin_chat_id', '123'); f.faults.check = () => ({ code: 1, stdout: 'status=connected\n', stderr: 'synthetic_network_failure' });
  await f.save(); assert.equal(f.saved.telegram_admin_chat_id, '123');
  assert.equal(f.saver.isChanged(), false); assert.notEqual(f.status().className, 'sf-messenger-status sf-messenger-status-ok');
});
it('overlapping test clicks result in one send-test and no config writes', async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  f.faults.test = async () => { entered.resolve(); await release.promise; return { code: 0, stdout: 'OK\n' }; };
  const first = f.click(); await entered.promise; const second = f.click(); release.resolve(); await Promise.all([first, second]);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(sentTests(f).length, 1); assert.equal(saveCalls(f).length, 0);
});
it('test during a pending Save is rejected without a second configuration write', async () => {
  const f = fixture(), entered = deferred(), release = deferred(); f.set('telegram_admin_chat_id', '123');
  f.faults.restart = async () => { entered.resolve(); await release.promise; return { code: 0, stdout: '' }; };
  const running = f.save(); await entered.promise; await f.click(); release.resolve(); await running;
  assert.equal(saveCalls(f).length, 1); assert.equal(sentTests(f).length, 0);
});
it('test send failure does not mark connected, releases button and permits a user retry', async () => {
  const f = fixture(); f.faults.test = () => ({ code: 1, stderr: 'synthetic_send_failure', stdout: '' });
  await f.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.testButton.disabled, false); assert.notEqual(f.status().className, 'sf-messenger-status sf-messenger-status-ok');
  delete f.faults.test; await f.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(sentTests(f).length, 2); assert.equal(saveCalls(f).length, 0);
});
for (const result of [null, {}, { code: '0', stdout: '' }]) {
  it(`malformed service reply ${JSON.stringify(result)} is not a confirmed refresh`, async () => {
    const f = fixture(); f.set('telegram_admin_chat_id', '123'); f.faults.restart = () => result;
    const failure = await f.save().catch(error => error);
    assert.equal(failure.persisted, true); assert.equal(failure.runtimeApplied, false);
    assert.equal(f.notes.some(([, level]) => level === 'success'), false);
  });
}
it('late input while send-test waits is kept and its status is not overwritten by connected', async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  f.faults.test = async () => { entered.resolve(); await release.promise; return { code: 0, stdout: '' }; };
  const running = f.click(); await entered.promise; f.set('telegram_admin_chat_id', '999'); release.resolve(); await running;
  assert.equal(f.saved.telegram_admin_chat_id, '100'); assert.equal(f.saver.isChanged(), true);
  assert.notEqual(f.status().className, 'sf-messenger-status sf-messenger-status-ok');
});
it('Save while send-test waits does not change the recipient and requires an explicit later retry', async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  f.faults.test = async () => { entered.resolve(); await release.promise; return { code: 0, stdout: '' }; };
  const running = f.click(); await entered.promise; f.set('telegram_admin_chat_id', '999');
  await assert.rejects(f.save(), /test message/); assert.equal(saveCalls(f).length, 0);
  release.resolve(); await running; delete f.faults.test;
  await f.save(); assert.equal(f.saved.telegram_admin_chat_id, '999'); assert.equal(f.saver.isChanged(), false);
});
it('re-entering the submitted value during restart does not create a false remaining draft', async () => {
  const f = fixture(), entered = deferred(), release = deferred(); f.set('telegram_admin_chat_id', '123');
  f.faults.restart = async () => { entered.resolve(); await release.promise; return { code: 0, stdout: '' }; };
  const running = f.save(); await entered.promise; f.set('telegram_admin_chat_id', '123'); release.resolve(); await running;
  assert.equal(f.saver.isChanged(), false); assert.equal(f.saved.telegram_admin_chat_id, '123');
});
it('Russian translations exist for all new messenger prompts', () => {
  const dictionary = JSON.parse(readFileSync(resolve(resourceRoot, 'i18n/ru.json'), 'utf8'));
  for (const text of [
    'Messenger settings have unsaved changes. Press Save before testing the connection.',
    'Could not read saved messenger settings. Refresh the page before trying again.',
    'Wait for the test message to finish, then save messenger settings.',
    'Could not restart Sheepfold after saving messenger settings.',
    'Save messenger settings and select Telegram before sending a test message.',
  ]) assert.ok(dictionary[text] && dictionary[text] !== text, text);
});
