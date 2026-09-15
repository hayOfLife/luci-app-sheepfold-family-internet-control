/* Проверяет границы сохранённого результата и последующего обновления LuCI.
 * Настоящие модули с моделями DOM/UCI, только память процесса. Не доказывает
 * работу радио, браузера или rpcd; ожидаемые отказы не заменяются успехом. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const resources = resolve('package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources');
const read = (relative) => readFileSync(resolve(resources, relative), 'utf8');

function element(tag, attrs = {}, children = []) {
  const list = Array.isArray(children) ? children : [children];
  return {
    tag, attrs, children: list, childNodes: list, disabled: !!attrs.disabled,
    value: attrs.value || '', hidden: !!attrs.hidden, textContent: typeof children === 'string' ? children : '',
    dataset: {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return this.attrs[name] ?? null; },
    removeAttribute(name) { delete this.attrs[name]; },
    replaceChildren(...values) { this.children = values; this.childNodes = values; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  };
}

function walk(value, result = []) {
  if (!value || typeof value !== 'object') return result;
  if (value.tag) result.push(value);
  for (const child of value.children || []) walk(child, result);
  return result;
}

function load(relative, extras = {}) {
  const raw = read(relative).replace(/^'require .*?';\r?\n/gm, '');
  const executable = raw.replace('return baseclass.extend(', 'module.exports = baseclass.extend(');
  const context = {
    module: { exports: {} }, baseclass: { extend: (value) => value },
    Promise, Object, Array, String, Number, Boolean, Math, Date, JSON, Error, RegExp, Map, Set,
    parseInt, isNaN, setTimeout, clearTimeout, setInterval, clearInterval,
    _: (value) => value,
    E: element,
    ui: { showModal() {}, hideModal() {} },
    document: { querySelectorAll: () => [] },
    window: { location: { hostname: 'router.lan', protocol: 'https:' }, setTimeout, clearTimeout },
    ...extras,
  };
  vm.createContext(context);
  vm.runInContext(`(function () { ${executable} })()`, context, { filename: relative });
  return { module: context.module.exports, context };
}

function extractFunction(relative, name) {
  const source = read(relative);
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let state = 'code';
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === 'line') { if (char === '\n') state = 'code'; continue; }
    if (state === 'block') { if (char === '*' && next === '/') { state = 'code'; index += 1; } continue; }
    if (state === 'string') {
      if (char === '\\') { index += 1; continue; }
      if (char === quote) state = 'code';
      continue;
    }
    if (char === '/' && next === '/') { state = 'line'; index += 1; continue; }
    if (char === '/' && next === '*') { state = 'block'; index += 1; continue; }
    if (char === '"' || char === "'" || char === '`') { state = 'string'; quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

function administratorDeps(overrides = {}) {
  const admins = [{ id: '1', name: 'Owner', login: 'Owner', deviceIds: [] }];
  const devices = [{ id: '1', mac: 'AA:BB:CC:DD:EE:FF', status: 'new', name: 'Phone' }];
  const notifications = [];
  let addSubmit = null;
  let bindingSubmit = null;
  let renderConfig = null;
  const deps = {
    administrators: () => admins,
    replaceAdministrators(values) { admins.splice(0, admins.length, ...values); },
    devices: () => devices,
    sections: () => [],
    model: {
      fromSections: () => admins,
      nextId: () => '2',
      loginExists: () => false,
    },
    persistence: {
      validateLogin: () => true,
      persistBindings: async () => ({ persisted: true, runtimeApplied: true }),
      activate: async () => {},
      status: async () => ({ paired: '0' }),
      saveAdministrator: async () => {},
    },
    actions: { execute: (spec) => Promise.resolve().then(spec.task).then((data) => ({ data })) },
    deviceById: (id) => devices.find((item) => item.id === id) || null,
    createDeviceSelector: () => ({ node: element('div'), selectedDevices: () => [], selectedIds: () => [] }),
    displayDeviceId: (device) => `#${device.id}`,
    normalizeMac: (value) => String(value || '').toUpperCase(),
    isBlocklisted: () => false,
    notConfigured: 'Not configured',
    get: () => '5201',
    run: async () => ({ code: 0, stdout: `algorithm=sha256-spki\nfingerprint=${'a'.repeat(64)}\n` }),
    ensureOk: (result) => result,
    parseKeyValues(text) {
      return Object.fromEntries(String(text).trim().split(/\r?\n/).map((line) => {
        const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
      }));
    },
    errorText: (error, fallback) => error?.message || fallback,
    notify: (message, level) => notifications.push({ message, level }),
    notifyCentered: (message) => notifications.push({ message, level: 'centered' }),
    reloadDevices: async () => {},
    refreshDevices: () => {},
    discovery: {
      routerAddress: () => '192.168.1.1', urlHost: (value) => value,
      pairingPayload: () => 'SF2|payload',
    },
    random: { pairingCode: () => '123456' },
    forms: { inputControl: () => ({ node: element('label'), input: element('input') }), checkboxControl: () => ({ node: element('label'), input: element('input') }) },
    table: { sortHeader: () => element('button') },
    iconButton: () => element('button'), identityIcon: () => element('span'), qrCode: () => element('div'),
    passwordRevealField: () => element('label'), settingLine: () => element('div'),
    editor: {
      openAdd(_deps, callback) { addSubmit = callback; },
      openBinding(_deps, _admin, callback) { bindingSubmit = callback; },
      openSettings() { return { markQrUsed() {} }; },
    },
    view: { render(config) { renderConfig = config; return config; } },
    ...overrides,
  };
  return {
    deps, admins, devices, notifications,
    getAddSubmit: () => addSubmit,
    getBindingSubmit: () => bindingSubmit,
    getRenderConfig: () => renderConfig,
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolveFlush) => setTimeout(resolveFlush, 0));
}

describe('final refresh and pairing semantics §ovaudit4', () => {
  it('distinguishes all-saved refresh failure from partial batch persistence', () => {
    const text = extractFunction('sheepfold/features/devices/controller.js', 'batchFailureMessage');
    const context = { _: (value) => value, Number, String };
    const fn = vm.runInNewContext(`(${text})`, context);
    assert.equal(
      fn({ persisted: true, runtimeApplied: true, refreshFailed: true, completedCount: 3, totalCount: 3 }),
      'All selected devices were saved, but the device list could not be refreshed. Reopen the page before making another change.',
    );
    assert.equal(
      fn({ persisted: true, runtimeApplied: false, completedCount: 3, totalCount: 3 }),
      'All selected devices were saved, but internet access rules could not be applied.',
    );
    assert.equal(
      fn({ persisted: true, completedCount: 1, totalCount: 3 }),
      'Only part of the selected device list was saved: 1 of 3 devices.',
    );
  });

  it('rejects a stale-status device that is still present in the UCI blocklist', () => {
    const { module } = load('sheepfold/features/administrators/controller.js');
    const fixture = administratorDeps({ isBlocklisted: () => true });
    const controller = module.create(fixture.deps);
    assert.equal(controller.canBind({ status: 'new', mac: 'AA:BB:CC:DD:EE:FF' }), false);
  });

  it('classifies administrator-create refresh failure as persisted instead of save failure', async () => {
    const hidden = [];
    const { module } = load('sheepfold/features/administrators/controller.js', {
      ui: { hideModal: () => hidden.push('hide'), showModal() {} },
    });
    const refreshError = new Error('inventory unavailable');
    const fixture = administratorDeps({ reloadDevices: async () => { throw refreshError; } });
    const controller = module.create(fixture.deps);
    controller.render(false).add();
    const submit = fixture.getAddSubmit();
    await assert.rejects(
      submit({ name: 'Second parent', login: 'Second', selectedDevices: [], selectedIds: [] }, element('button')),
      (error) => error === refreshError && error.persisted === true && error.runtimeApplied === true && error.refreshFailed === true,
    );
    assert.equal(hidden.length, 1);
    assert.ok(fixture.notifications.some(({ message }) => message ===
      'The administrator was saved, but the device list could not be refreshed. Reopen the page before making another change.'));
    assert.ok(!fixture.notifications.some(({ message }) => message === 'Could not save administrator.'));
  });

  it('classifies administrator-binding refresh failure without rolling back saved bindings', async () => {
    const hidden = [];
    const { module } = load('sheepfold/features/administrators/controller.js', {
      ui: { hideModal: () => hidden.push('hide'), showModal() {} },
    });
    const refreshError = new Error('inventory unavailable');
    const fixture = administratorDeps({ reloadDevices: async () => { throw refreshError; } });
    const controller = module.create(fixture.deps);
    controller.showBindings(fixture.admins[0], () => assert.fail('onSave must not receive stale inventory'));
    const submit = fixture.getBindingSubmit();
    await assert.rejects(
      submit({ selectedDevices: [], selectedIds: ['1'] }, element('button')),
      (error) => error === refreshError && error.persisted === true && error.runtimeApplied === true && error.refreshFailed === true,
    );
    assert.equal(hidden.length, 1);
    assert.ok(fixture.notifications.some(({ message }) => message ===
      'Device bindings were saved, but the device list could not be refreshed. Reopen the page before making another change.'));
    assert.ok(!fixture.notifications.some(({ message }) => message === 'Could not save device bindings.'));
  });

  it('waits for a real inventory card after pairing and never creates a synthetic device id', async () => {
    const timers = [];
    const hidden = [];
    const centered = [];
    const warnings = [];
    const windowObject = {
      location: { hostname: 'router.lan', protocol: 'https:' },
      setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
      clearTimeout() {},
    };
    const uiObject = { showModal() {}, hideModal: () => hidden.push('hide') };
    const { module } = load('sheepfold/features/administrators/controller.js', { window: windowObject, ui: uiObject });
    const fixture = administratorDeps({
      persistence: {
        validateLogin: () => true,
        persistBindings: async () => ({ persisted: true, runtimeApplied: true }),
        activate: async () => {},
        status: async () => ({ paired: '1', mac: 'AA:BB:CC:DD:EE:99', device_name: 'New phone' }),
        saveAdministrator: async () => {},
      },
      notify: (message, level) => warnings.push({ message, level }),
      notifyCentered: (message) => centered.push(message),
      reloadDevices: async () => {},
      refreshDevices: () => {},
    });
    fixture.devices.splice(0, fixture.devices.length);
    const controller = module.create(fixture.deps);
    controller.showSettings(fixture.admins[0]);
    await flush();
    const initial = timers.find((entry) => entry.delay === 1500);
    assert.ok(initial, 'pairing watcher must schedule its first check');
    initial.callback();
    await flush();
    const usedDelay = timers.find((entry) => entry.delay === 900);
    assert.ok(usedDelay, 'the consumed QR state must remain visible before refresh and close');
    usedDelay.callback();
    await flush();
    assert.equal(fixture.devices.length, 0, 'no synthetic inventory card may be inserted');
    assert.equal(hidden.length, 0, 'pairing modal stays open until the real card exists');
    assert.equal(centered.length, 0);
    assert.ok(warnings.some(({ message }) => message ===
      'The phone was paired, but the router has not published the device card yet. Retrying.'));
    assert.ok(timers.some((entry) => entry.delay === 3000));
    assert.doesNotMatch(read('sheepfold/features/administrators/controller.js'), /upsertPairedDevice/);
  });

  it('accepts a special saver whose UCI commit succeeded before its runtime refresh failed', async () => {
    const { module } = load('sheepfold/features/settings/save-flow.js');
    let dirty = true;
    let accepted = 0;
    const runtimeError = new Error('runtime failed');
    runtimeError.persisted = true;
    runtimeError.runtimeApplied = false;
    const saver = {
      isChanged: () => dirty,
      save: async () => { throw runtimeError; },
      accept() { dirty = false; accepted += 1; },
    };
    const draft = {
      snapshot: () => ({}), dirtySavers: () => [saver], has: () => false, get: () => '',
      setSaving() {}, acceptOptions() {},
    };
    const flow = module.create({
      draft,
      persistence: { validate() {}, save: async () => {} },
      applyRuntime: async () => {}, applyPostSave: async () => {},
      value: () => 'never', updateButtons() {}, notify() {}, notifyCentered() {},
      errorText: (error) => error.message,
      confirmWifiAutoDisable: async () => true,
    });
    await assert.rejects(flow.save(), (error) => error === runtimeError && error.completedSpecialSavers === 1);
    assert.equal(accepted, 1);
    assert.equal(dirty, false);
  });

  it('turns a synchronous UCI confirm exception into a retryable Promise rejection path', async () => {
    const { module } = load('sheepfold/core/persistence/uci.js');
    let attempts = 0;
    const uci = {
      state: { creates: {}, changes: {}, deletes: {}, reorder: {} },
      sections: () => [], changes: async () => ({}), save: async () => {},
      callApply: () => 0,
      callConfirm() {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary synchronous confirm failure');
        return 0;
      },
      unload() {}, load: async () => {},
    };
    const adapter = module.create({
      uci, revert: async () => {},
      setTimeout(callback) { callback(); return attempts; },
    });
    await adapter.applyAndConfirm();
    assert.equal(attempts, 2);
  });

  it('releases the administrator-settings save guard after a synchronous callback exception', async () => {
    let modal = null;
    const { module } = load('sheepfold/features/administrators/editor.js', {
      ui: { showModal(_title, nodes) { modal = nodes; }, hideModal() {} },
    });
    const input = element('input');
    module.openSettings({
      checkboxControl: () => ({ input, node: element('label') }),
      inputControl: () => ({ input: element('input'), node: element('label') }),
      passwordRevealField: () => element('label'), settingLine: () => element('div'),
    }, { name: 'Owner', login: 'Owner', allowChildAccessRequests: false }, {
      qrNode: element('div'), temporaryPassword: '123456', apiUrl: 'https://router', routerAddress: 'router', port: '5201',
    }, {
      close() {}, save() { throw new Error('synchronous failure'); },
    });
    const saveButton = walk({ children: modal }).find((node) => node.tag === 'button' && node.children.includes('Save'));
    assert.ok(saveButton);
    saveButton.attrs.click({ preventDefault() {}, currentTarget: saveButton });
    assert.equal(saveButton.disabled, true);
    await flush();
    assert.equal(saveButton.disabled, false);
    assert.equal(saveButton.attrs['aria-busy'], 'false');
  });

  it('exposes a pairing view that reveals the used QR status', () => {
    let modal = null;
    const { module } = load('sheepfold/features/administrators/editor.js', {
      ui: { showModal(_title, nodes) { modal = nodes; }, hideModal() {} },
    });
    const input = element('input');
    const pairingView = module.openSettings({
      checkboxControl: () => ({ input, node: element('label') }),
      inputControl: () => ({ input: element('input'), node: element('label') }),
      passwordRevealField: () => element('label'), settingLine: () => element('div'),
    }, { name: 'Owner', login: 'Owner', allowChildAccessRequests: false }, {
      qrNode: element('div'), temporaryPassword: '123456', apiUrl: 'https://router', routerAddress: 'router', port: '5201',
    }, {
      close() {}, save() { return Promise.resolve(); },
    });
    const overlay = walk({ children: modal }).find((node) => node.attrs?.class === 'sf-pairing-qr-used');

    assert.ok(overlay);
    assert.equal(overlay.hidden, true);
    pairingView.markQrUsed();
    assert.equal(overlay.hidden, false);
    assert.equal(overlay.attrs.hidden, undefined);
  });
});
