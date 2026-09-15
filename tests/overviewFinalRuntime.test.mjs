/* Исполняет настоящие LuCI-модули с моделями UCI/DOM и локальными shell-стендами.
 * Проверяет очереди, подтверждение и отказ, меняет только временные данные теста.
 * Не заменяет настоящий браузер, RPC и физический роутер. */
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const resources = resolve('package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources');
const pkg = resolve('package/luci-app-sheepfold-family-internet-control');

function source(relative) { return readFileSync(resolve(resources, relative), 'utf8'); }
function loadModule(relative, extras = {}) {
  const raw = source(relative).replace(/^'require .*?';\r?\n/gm, '');
  const executable = raw.replace('return baseclass.extend(', 'module.exports = baseclass.extend(');
  const context = {
    module: { exports: {} }, baseclass: { extend: (value) => value }, Promise, Object, Array,
    String, Number, Boolean, Math, Date, JSON, Error, RegExp, Map, Set, encodeURIComponent,
    setTimeout, clearTimeout, setInterval, clearInterval,
    _: (value) => value,
    E: (tag, attrs, children) => ({ tag, attrs: attrs || {}, children, disabled: false,
      getAttribute(name) { return this.attrs[name] ?? null; },
      setAttribute(name, value) { this.attrs[name] = String(value); },
      removeAttribute(name) { delete this.attrs[name]; },
      classList: { add() {}, remove() {}, toggle() {} },
    }),
    ui: { hideModal() {}, showModal() {} },
    window: { confirm: () => true, setTimeout, clearTimeout, setInterval, clearInterval },
    document: { querySelectorAll: () => [] },
    ...extras,
  };
  vm.createContext(context);
  vm.runInContext(`(function () { ${executable} })()`, context, { filename: relative });
  return context.module.exports;
}

function fakeUci() {
  const state = { creates: {}, changes: {}, deletes: {}, reorder: {} };
  const values = {
    sheepfold: { global: { '.name': 'global', '.type': 'sheepfold', '.index': 0 } },
    dhcp: {}, wireless: {},
  };
  const events = [];
  function bucket(name, config, section) {
    state[name][config] ||= {};
    state[name][config][section] ||= {};
    return state[name][config][section];
  }
  return {
    state, values, events,
    sections(config, type) {
      return Object.values(values[config] || {}).filter((section) => !type || section['.type'] === type)
        .concat(Object.values(state.creates[config] || {})).filter((section) => !type || section['.type'] === type);
    },
    get(config, section, option) {
      return state.creates[config]?.[section]?.[option] ?? state.changes[config]?.[section]?.[option] ?? values[config]?.[section]?.[option] ?? null;
    },
    add(config, type, name) {
      state.creates[config] ||= {};
      state.creates[config][name] = { '.name': name, '.type': type, '.index': 1000 };
      return name;
    },
    set(config, section, option, value) {
      if (state.creates[config]?.[section]) state.creates[config][section][option] = value;
      else bucket('changes', config, section)[option] = value;
    },
    unset(config, section, option) { bucket('deletes', config, section)[option] = true; },
    remove(config, section) { state.deletes[config] ||= {}; state.deletes[config][section] = true; },
    changes: async () => ({}),
    async save(...args) { events.push(['save', args.length]); state.creates = {}; state.changes = {}; state.deletes = {}; state.reorder = {}; },
    async callApply(timeout, rollback) { events.push(['apply', timeout, rollback]); return 0; },
    async callConfirm() { events.push(['confirm']); return 0; },
    async apply() { throw new Error('native uci.apply() must not be used by the audited adapter'); },
    unload(config) { events.push(['unload', config]); },
    async load(config) { events.push(['load', config]); },
  };
}

describe('experimental final overview runtime tests §ovaudit3', () => {
  it('serializes UCI mutations and performs one zero-argument save and one awaited apply', async () => {
    const module = loadModule('sheepfold/core/persistence/uci.js');
    const uci = fakeUci();
    const order = [];
    let release;
    let applyCount = 0;
    const gate = new Promise((resolveGate) => { release = resolveGate; });
    uci.callApply = async (timeout, rollback) => {
      uci.events.push(['apply', timeout, rollback]);
      applyCount += 1;
      if (applyCount === 1) await gate;
      return 0;
    };
    const adapter = module.create({ uci, revert: async () => {}, setTimeout: (callback) => { callback(); return 1; } });
    const first = adapter.mutate(['sheepfold'], () => {
      order.push('first-stage'); uci.set('sheepfold', 'global', 'language', 'ru'); return 'first';
    });
    const second = adapter.mutate(['sheepfold'], () => {
      order.push('second-stage'); uci.set('sheepfold', 'global', 'language', 'en'); return 'second';
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 0));
    assert.deepEqual(Array.from(order), ['first-stage']);
    release();
    assert.equal((await first).stageResult, 'first');
    assert.equal((await second).stageResult, 'second');
    assert.deepEqual(Array.from(order), ['first-stage', 'second-stage']);
    assert.deepEqual(uci.events.filter((event) => event[0] === 'save'), [['save', 0], ['save', 0]]);
    assert.equal(uci.events.filter((event) => event[0] === 'apply').length, 2);
    assert.equal(uci.events.filter((event) => event[0] === 'confirm').length, 2);
  });


  it('rejects asynchronous UCI staging before it can yield into the shared LuCI state', async () => {
    const module = loadModule('sheepfold/core/persistence/uci.js');
    const uci = fakeUci();
    const adapter = module.create({ uci, revert: async () => {}, setTimeout: (callback) => { callback(); return 1; } });
    await assert.rejects(adapter.mutate(['sheepfold'], () => Promise.resolve('late-stage')),
      (error) => error.errorCode === 'uci_async_stage_forbidden');
    assert.equal(uci.events.some((event) => event[0] === 'save'), false);
    assert.ok(uci.events.some((event) => event.join(':') === 'unload:sheepfold'));
  });

  it('preserves the original apply error while reverting and reloading owned UCI staging', async () => {
    const module = loadModule('sheepfold/core/persistence/uci.js');
    const uci = fakeUci();
    const reverted = [];
    const original = new Error('apply failed');
    uci.callApply = async () => { throw original; };
    const adapter = module.create({ uci, revert: async (configs) => reverted.push(...configs), setTimeout: (callback) => { callback(); return 1; } });
    await assert.rejects(adapter.mutate(['sheepfold'], () => {
      uci.set('sheepfold', 'global', 'language', 'ru');
    }), (error) => error === original && error.uciCleanupAttempted === true);
    assert.deepEqual(reverted, ['sheepfold']);
    assert.ok(uci.events.some((event) => event.join(':') === 'unload:sheepfold'));
  });

  it('accepts completed special savers and leaves later failed savers distinguishable', async () => {
    const module = loadModule('sheepfold/features/settings/save-flow.js');
    let optionClears = 0;
    let firstDirty = true;
    let secondDirty = true;
    const first = { isChanged: () => firstDirty, save: async () => {}, accept: () => { firstDirty = false; } };
    const second = { isChanged: () => secondDirty, save: async () => { throw new Error('second failed'); }, accept: () => { secondDirty = false; } };
    const draft = {
      snapshot: () => ({ language: 'ru' }), dirtySavers: () => [first, second],
      has: () => false, get: () => '', setSaving() {}, acceptOptions: (options) => { assert.deepEqual({ ...options }, { language: 'ru' }); optionClears++; },
    };
    const flow = module.create({
      draft, persistence: { validate() {}, save: async () => {} }, applyRuntime: async () => {}, applyPostSave: async () => {},
      value: () => 'never', updateButtons() {}, notify() {}, notifyCentered() {}, errorText: (error) => error.message,
      confirmWifiAutoDisable: async () => true,
    });
    await assert.rejects(flow.save(), (error) => error.persisted === true && error.completedSpecialSavers === 1);
    assert.equal(firstDirty, false);
    assert.equal(secondDirty, true);
    assert.equal(optionClears, 1, 'only the submitted options are acknowledged once');
  });

  it('checks every settings side effect and runs schedule-sync only once', async () => {
    const module = loadModule('sheepfold/features/settings/side-effects.js');
    const commands = [];
    const deps = {
      run: async (args) => { commands.push(args.join(' ')); return { code: 0 }; },
      ensureOk(result, fallback) { if (result.code) throw new Error(fallback); return result; },
      siteCronError: () => 'cron', sitePolicyError: () => 'site', ledError: () => 'led', ipv6Error: () => 'ipv6',
      scheduleError: () => 'schedule', emergencyError: () => 'emergency', discoveryError: () => 'discovery',
      restartError: () => 'restart', countryProfileError: () => 'country', refreshSiteStatus: async () => {},
      emergencySitesChanged: () => false, writeDiscovery: async () => {}, restartService: async () => ({ code: 0 }),
      reloadConfig: async () => {}, refreshEmergencySites: async () => {}, reloadPage: async () => {}, ensureAiLogs: async () => {},
    };
    await module.create(deps).apply({ schedule_conflict_internet: 'off', new_device_policy: 'restricted' });
    assert.deepEqual(commands, ['schedule-sync']);
    const failed = module.create({ ...deps, run: async () => ({ code: 9 }) });
    await assert.rejects(failed.apply({ router_led_control: 'off_forever' }), /led/);
    const discovery = module.create({ ...deps, writeDiscovery: async () => { throw new Error('write failed'); } });
    await assert.rejects(discovery.apply({ app_port: '5202' }), /write failed/);
  });

  it('restores exact action-button child nodes after a busy label', async () => {
    const module = loadModule('sheepfold/core/backend/actions.js');
    const icon = { id: 'icon' };
    const label = { id: 'label' };
    let children = [icon, label];
    let text = 'Save';
    const attrs = {};
    const node = {
      disabled: false,
      childNodes: children,
      classList: { add() {}, remove() {} },
      getAttribute: (name) => attrs[name] ?? null,
      setAttribute: (name, value) => { attrs[name] = String(value); },
      removeAttribute: (name) => { delete attrs[name]; },
      replaceChildren(...items) { children = items; this.childNodes = children; },
      get textContent() { return text; },
      set textContent(value) { text = String(value); children = []; this.childNodes = children; },
    };
    const actions = module.create({ run: async () => ({ code: 0 }), errorText: () => '', notify() {} });
    await actions.execute({ key: 'icon-test', button: node, busyText: 'Working', task: async () => true, silent: true });
    assert.strictEqual(children[0], icon);
    assert.strictEqual(children[1], label);
    assert.equal(node.disabled, false);
  });

  it('removes a disabled static DHCP lease and strips every AI identifier from Standard code', async () => {
    const module = loadModule('sheepfold/features/devices/persistence.js');
    const uci = fakeUci();
    uci.values.dhcp.old_host = { '.name': 'old_host', '.type': 'host', '.index': 0, mac: 'AA:BB:CC:DD:EE:FF' };
    const removed = [];
    const originalRemove = uci.remove.bind(uci);
    uci.remove = (config, section) => { removed.push([config, section]); originalRemove(config, section); };
    const adapter = module.create({
      uci,
      persistence: {
        sections: uci.sections.bind(uci), ensureSection: (config, type, name) => uci.add(config, type, name),
        replaceList(config, section, option, values) { uci.unset(config, section, option); if (values.length) uci.set(config, section, option, values); },
        mutate: async (_configs, stage) => ({ stageResult: stage() }), reload: async () => {}, discard: async () => {},
      },
      accessLists: { updatedValues: () => [] }, normalizeMac: (value) => String(value || '').toUpperCase(),
      generatedSectionName: () => 'device_1', normalizeGroupName: (value) => value,
      notConfiguredGroup: 'Not configured', isAdminDevice: () => false,
      noRestrictionsGroupName: () => 'No restrictions', personalDevicesGroupName: () => 'Personal devices',
      markNoRestrictionsExcluded() {}, markPersonalDevicesExcluded() {}, run: async () => ({ code: 0 }),
      action: async () => ({ result: {} }), ensureOk() {}, refreshSiteStatus: async () => {}, statusError: () => '',
    });
    adapter.stageSettings({ mac: 'aa:bb:cc:dd:ee:ff', group: '', staticSection: 'old_host' }, {
      name: 'Phone', ip: '192.168.1.2', group: 'Not configured', deviceType: 'phone', status: 'restricted', staticLease: false,
    });
    assert.deepEqual(removed, [['dhcp', 'old_host']]);
    const standard = source('sheepfold/features/devices/persistence.js').replace(/\/\* SHEEPFOLD_AI_BEGIN \*\/[\s\S]*?\/\* SHEEPFOLD_AI_END \*\//g, '');
    assert.doesNotMatch(standard, /activityLogEnabled|activity_log_enabled/);
  });

  it('uses collision-safe administrator names and removes bound device IDs from device schedules', async () => {
    const module = loadModule('sheepfold/features/pairing/persistence.js');
    const sets = [];
    const schedules = [{ '.name': 'school', '.type': 'schedule', target_type: 'device', targets: ['7', '8'] }];
    const sections = [{ '.name': 'admin_parent_deadbeef', '.type': 'administrator', login: 'other' }, ...schedules];
    const adapter = module.create({
      uci: { set: (...args) => sets.push(args), get: () => '' },
      persistence: {
        sections: (_config, type) => type ? sections.filter((item) => item['.type'] === type) : sections,
        ensureSection: (_config, _type, name) => { sections.push({ '.name': name, '.type': 'administrator' }); return name; },
        replaceList: (_config, section, option, values) => sets.push(['list', section, option, values]),
        mutate: async (_configs, stage) => ({ stageResult: stage() }),
      },
      devicePersistence: {
        ensureDeviceSection: (device) => `device_${device.id}`,
        updateMacList() {},
        saveAccess: async (_configs, stage) => ({ persisted: true, runtimeApplied: true, stageResult: stage() }),
      },
      normalizeMac: (value) => String(value || '').toUpperCase(), notConfiguredGroup: 'Not configured',
      deviceById: () => null, canBind: () => true, listValues: (value) => Array.isArray(value) ? value : [],
      action: async () => ({ result: {}, data: {} }),
    });
    assert.equal(adapter.validateLogin('parent.one+2'), true);
    assert.equal(adapter.validateLogin('bad login'), false);
    const first = adapter.sectionName({ id: '1', login: 'a.b' });
    const second = adapter.sectionName({ id: '2', login: 'a-b' });
    assert.notEqual(first, second);
    adapter.stageBindings({ login: 'parent', name: 'Parent' }, [{ id: '7', mac: 'aa:bb:cc:dd:ee:ff' }], []);
    const listWrite = sets.find((entry) => entry[0] === 'list' && entry[1] === 'school');
    assert.deepEqual(Array.from(listWrite[3]), ['8']);
  });

  it('refuses group deletion while a group-target schedule still references it', async () => {
    const module = loadModule('sheepfold/features/groups/persistence.js');
    const adapter = module.create({
      uci: { remove() {} }, groupModel: { hash: () => 1, membershipChanges: () => [] },
      persistence: {
        sections: (_config, type) => type === 'group' ? [{ '.name': 'child_1', '.type': 'group', name: 'Children' }] :
          type === 'schedule' ? [{ '.name': 'school', '.type': 'schedule', target_type: 'group', targets: ['child_1'] }] : [],
        mutate: async (_configs, stage) => ({ stageResult: stage() }), ensureSection: () => 'group_1', replaceList() {},
      },
      normalizeGroupName: (value) => value, listValues: (value) => value || [],
      normalizeMac: (value) => value, devicePersistence: {}, notConfiguredGroup: 'Not configured',
    });
    await assert.rejects(adapter.remove('child_1'), (error) => error.errorCode === 'group_referenced_by_schedule');
  });


  it('enforces protected and assigned group deletion invariants inside persistence', async () => {
    const module = loadModule('sheepfold/features/groups/persistence.js');
    function adapterFor(groups, devices = []) {
      return module.create({
        uci: { remove() {} }, groupModel: { hash: () => 1, membershipChanges: () => [] },
        persistence: {
          sections: (_config, type) => type === 'group' ? groups : type === 'device' ? devices : [],
          mutate: async (_configs, stage) => ({ stageResult: stage() }), ensureSection: () => 'group_1', replaceList() {},
        },
        normalizeGroupName: (value) => String(value || ''), listValues: (value) => value || [],
        normalizeMac: (value) => value, devicePersistence: {}, notConfiguredGroup: 'Not configured',
        noRestrictionsGroupName: () => 'No restrictions', personalDevicesGroupName: () => 'Personal devices',
      });
    }
    await assert.rejects(
      adapterFor([{ '.name': 'locked', '.type': 'group', name: 'Locked', protected: '1' }]).remove('locked'),
      (error) => error.errorCode === 'group_protected',
    );
    await assert.rejects(
      adapterFor(
        [{ '.name': 'children', '.type': 'group', name: 'Children' }],
        [{ '.name': 'device_1', '.type': 'device', group: 'Children' }],
      ).remove('children'),
      (error) => error.errorCode === 'group_has_devices' && error.deviceSections[0] === 'device_1',
    );
  });

  it('keeps schedule pre-commit failures on the Promise contract', async () => {
    const module = loadModule('sheepfold/features/schedules/controller.js');
    let persist;
    const notifications = [];
    const controller = module.create({
      model: { ranges: () => [], timeToMinutes: () => 0, windows: () => [], windowsOverlap: () => false },
      view: { render: () => ({}) },
      editor: { open: (deps) => { persist = deps.persist; return true; } },
      persistence: { persistDraft: async () => { throw new Error('commit failed'); }, reload: async () => {} },
      actions: { execute: (options) => Promise.resolve().then(options.task) },
      sections: () => [], get: () => '', listValues: (value) => value || [], devices: () => [], deviceById: () => null,
      displayDeviceId: () => '#1', groups: {}, conflictValue: () => 'off', refresh() {},
      notify: (message, level) => notifications.push([message, level]),
      errorText: (error, fallback) => error.message || fallback,
    });
    controller.openEditor(null, false);
    const result = persist({ name: 'test' }, '', null);
    assert.equal(typeof result.then, 'function');
    await result;
    assert.deepEqual(notifications, [['commit failed', 'warning']]);
  });

  it('reports stale LuCI state after an administrator mutation persisted but refresh failed', async () => {
    const module = loadModule('sheepfold/features/administrators/controller.js');
    let submit;
    const notifications = [];
    const persisted = Object.assign(new Error('runtime failed'), { persisted: true });
    const controller = module.create({
      administrators: () => [], replaceAdministrators() {}, devices: () => [], deviceById: () => null,
      model: { nextId: () => '1', loginExists: () => false, fromSections: () => [] },
      persistence: {
        validateLogin: () => true,
        persistBindings: async () => { throw persisted; },
      },
      actions: { execute: (options) => Promise.resolve().then(options.task) },
      editor: { openAdd: (_deps, callback) => { submit = callback; } },
      view: { render: () => ({}) }, sections: () => [], createDeviceSelector: () => ({}),
      displayDeviceId: () => '#1', normalizeMac: (value) => value, notConfigured: 'Not configured',
      reloadDevices: async () => { throw new Error('refresh failed'); }, refreshDevices() {},
      forms: { inputControl() {}, checkboxControl() {} }, table: { sortHeader() {} }, random: {}, discovery: {},
      qrCode() {}, passwordRevealField() {}, settingLine() {}, identityIcon() {}, iconButton() {},
      notify: (message, level) => notifications.push([message, level]), notifyCentered() {},
      errorText: (error, fallback) => error.message || fallback, run: async () => ({}), ensureOk() {}, parseKeyValues: () => ({}),
    });
    controller.render(false); // verifies construction before invoking the captured add path
    controller.reloadAndRefreshDevices().catch(() => null);
    // Capture the actual add callback through the controller-owned editor.
    module.create({
      administrators: () => [], replaceAdministrators() {}, devices: () => [], deviceById: () => null,
      model: { nextId: () => '1', loginExists: () => false, fromSections: () => [] },
      persistence: { validateLogin: () => true, persistBindings: async () => { throw persisted; } },
      actions: { execute: (options) => Promise.resolve().then(options.task) },
      editor: { openAdd: (_deps, callback) => { submit = callback; } }, view: { render: (deps) => { deps.add(); return {}; } },
      sections: () => [], createDeviceSelector: () => ({}), displayDeviceId: () => '#1', normalizeMac: (value) => value,
      notConfigured: 'Not configured', reloadDevices: async () => { throw new Error('refresh failed'); }, refreshDevices() {},
      forms: { inputControl() {}, checkboxControl() {} }, table: { sortHeader() {} }, random: {}, discovery: {}, qrCode() {},
      passwordRevealField() {}, settingLine() {}, identityIcon() {}, iconButton() {}, notify: (message, level) => notifications.push([message, level]),
      notifyCentered() {}, errorText: (error, fallback) => error.message || fallback, run: async () => ({}), ensureOk() {}, parseKeyValues: () => ({}),
    }).render(false);
    await assert.rejects(submit({ name: 'Parent', login: 'parent', selectedIds: [], selectedDevices: [] }, null));
    assert.ok(notifications.some(([message]) => /could not be refreshed in LuCI/.test(message)));
  });

  it('never exposes arbitrary failing backend output as actionMessage metadata', () => {
    const fixtureParent = resolve('.build/test-fixtures');
    mkdirSync(fixtureParent, { recursive: true });
    const temp = mkdtempSync(join(fixtureParent, 'sheepfold-action-'));
    const shellPath = (path) => relative(process.cwd(), path).replaceAll('\\', '/');
    try {
      const control = join(temp, 'control');
      writeFileSync(control, '#!/bin/sh\necho "token=super-secret"\necho "password=also-secret" >&2\nexit 9\n');
      chmodSync(control, 0o755);
      const wrapper = resolve(pkg, 'root/usr/libexec/sheepfold/sheepfold-luci-action');
      const result = spawnSync('sh', [shellPath(wrapper), 'test-command'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          SHEEPFOLD_ROUTER_CONTROL: shellPath(control),
          SHEEPFOLD_LUCI_ACTION_RUNTIME_DIR: shellPath(join(temp, 'run')),
        },
      });
      assert.equal(result.status, 9);
      const metadata = result.stderr.split(/\r?\n/).filter((line) => line.startsWith('action'));
      assert.ok(metadata.some((line) => line === 'actionMessage=The router action failed.'));
      assert.doesNotMatch(metadata.join('\n'), /super-secret|also-secret/);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });

  it('normalizes numeric UCI failures and awaits direct apply/confirm when available', async () => {
    const module = loadModule('sheepfold/core/persistence/uci.js');
    const failingUci = fakeUci();
    const reverted = [];
    failingUci.callApply = async () => { throw 7; };
    const failing = module.create({ uci: failingUci, revert: async (configs) => reverted.push(...configs), setTimeout: (callback) => { callback(); return 1; } });
    await assert.rejects(failing.mutate(['sheepfold'], () => {
      failingUci.set('sheepfold', 'global', 'language', 'ru');
    }), (error) => error instanceof Error && error.status === 7 && error.uciCleanupAttempted === true);
    assert.deepEqual(reverted, ['sheepfold']);

    const directUci = fakeUci();
    const calls = [];
    directUci.callApply = async (timeout, rollback) => { calls.push(['apply', timeout, rollback]); return 0; };
    directUci.callConfirm = async () => { calls.push(['confirm']); return 0; };
    directUci.apply = async () => { throw new Error('legacy apply must not be used'); };
    const direct = module.create({
      uci: directUci,
      revert: async () => {},
      setTimeout: (callback) => { callback(); return 1; },
    });
    await direct.mutate(['sheepfold'], () => {
      directUci.set('sheepfold', 'global', 'language', 'en');
    });
    assert.deepEqual(calls, [['apply', 10, true], ['confirm']]);
  });

  it('queues complete access runtime pairs so a later commit receives its own final sync', async () => {
    const module = loadModule('sheepfold/features/devices/persistence.js');
    const events = [];
    let releaseFirst;
    let scheduleCount = 0;
    const firstGate = new Promise((resolveGate) => { releaseFirst = resolveGate; });
    const adapter = module.create({
      uci: { get: () => [], set() {}, unset() {}, remove() {} },
      persistence: { sections: () => [], ensureSection: (_c, _t, name) => name, replaceList() {}, reload: async () => {}, discard: async () => {} },
      accessLists: { updatedValues: () => [] }, normalizeMac: (value) => value,
      generatedSectionName: () => 'device_1', normalizeGroupName: (value) => value,
      notConfiguredGroup: 'Not configured', isAdminDevice: () => false,
      noRestrictionsGroupName: () => '', personalDevicesGroupName: () => '',
      markNoRestrictionsExcluded() {}, markPersonalDevicesExcluded() {},
      run: async (args) => {
        if (args[0] === 'schedule-sync') {
          scheduleCount += 1;
          const number = scheduleCount;
          events.push(`schedule-${number}-start`);
          if (number === 1) await firstGate;
          events.push(`schedule-${number}-end`);
          return { code: 0 };
        }
        events.push(`sites-${scheduleCount}`);
        return { code: 0 };
      },
      ensureOk(result) { if (result.code) throw new Error('runtime failed'); },
      refreshSiteStatus: async () => {}, invalidMacMessage: () => 'bad mac',
      accessRuntimeError: () => 'access', siteRuntimeError: () => 'sites', action: async () => ({ result: {} }),
    });
    const first = adapter.applyRuntime();
    await new Promise((resolveWait) => setTimeout(resolveWait, 0));
    const second = adapter.applyRuntime();
    await new Promise((resolveWait) => setTimeout(resolveWait, 0));
    assert.equal(scheduleCount, 1);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(events, [
      'schedule-1-start', 'schedule-1-end', 'sites-1',
      'schedule-2-start', 'schedule-2-end', 'sites-2',
    ]);
  });

  it('normalizes primitive action task rejections before attaching structured metadata', async () => {
    const module = loadModule('sheepfold/core/backend/actions.js');
    const actions = module.create({ run: async () => ({}), errorText: () => '', notify() {} });
    await assert.rejects(actions.execute({ key: 'primitive-error', silent: true, task: async () => { throw 9; } }),
      (error) => error instanceof Error && error.exitCode === 9 && error.status === 'error');
  });


  it('rejects backup imports that reuse a named section with another UCI type', async () => {
    const module = loadModule('sheepfold/features/settings/backup-persistence.js');
    const adapter = module.create({
      model: {
        build: loadModule('sheepfold/features/settings/backup.js').build,
        secretPlaceholder: '[secret]', validate: (value) => value,
        prepareRestore: (value) => ({ payload: value, routerTransfer: false }),
      },
      uci: { remove() {}, set() {}, unset() {} },
      persistence: {
        sections: (config) => config === 'sheepfold' ? [{ '.name': 'cloud', '.type': 'device' }] : [],
        ensureSection: (_config, _type, name) => name,
        mutate: async (_configs, stage) => ({ stageResult: stage() }),
      },
      refreshRuntime: async () => {},
    });
    const current = { configs: { sheepfold: [{ name: 'cloud', type: 'device', options: {} }], dhcp: [], wireless: [] } };
    const imported = { configs: {
      sheepfold: [{ name: 'cloud', type: 'yandex_disk', options: {} }],
      dhcp: [], wireless: [],
    } };
    await assert.rejects(adapter.apply(imported, current),
      (error) => error.errorCode === 'backup_section_type_conflict' && error.actualType === 'device');
  });


  it('rejects administrator devices in ordinary group persistence even if UI filtering is bypassed', async () => {
    const module = loadModule('sheepfold/features/groups/persistence.js');
    let mutated = false;
    const adapter = module.create({
      uci: { set() {} }, groupModel: { hash: () => 1, membershipChanges: () => [] },
      persistence: {
        sections: () => [], ensureSection: () => 'group_1', replaceList() {},
        mutate: async (_configs, stage) => { mutated = true; return { stageResult: stage() }; },
      },
      devicePersistence: { ensureDeviceSection: () => 'device_1', applyRuntime: async () => {} },
      normalizeMac: (value) => value, normalizeGroupName: (value) => value,
      notConfiguredGroup: 'Not configured', noRestrictionsGroupName: () => 'No restrictions',
      personalDevicesGroupName: () => 'Personal devices', markNoRestrictionsExcluded() {}, markPersonalDevicesExcluded() {},
      listValues: (value) => value || [], isAdminDevice: (device) => !!device.adminDevice,
    });
    await assert.rejects(adapter.persistSettings({
      oldName: 'Children', newName: 'Children', selectedDevices: [{ id: '1', adminDevice: true }],
      selectedSchedules: [], color: '#ffffff', allowlistOnly: false,
    }, null, []), (error) => error.errorCode === 'administrator_device');
    assert.equal(mutated, true, 'the guard must execute inside the serialized mutation callback');
  });



  it('fails closed before staging when another LuCI tab has unapplied remote changes', async () => {
    const module = loadModule('sheepfold/core/persistence/uci.js');
    const uci = fakeUci();
    let staged = false;
    uci.changes = async () => ({ network: [['set', 'lan', 'ipaddr', '192.168.2.1']] });
    const adapter = module.create({ uci, revert: async () => {}, setTimeout: (callback) => { callback(); return 1; } });
    await assert.rejects(adapter.mutate(['sheepfold'], () => {
      staged = true;
      uci.set('sheepfold', 'global', 'language', 'en');
    }), (error) => error.errorCode === 'uci_unapplied_changes');
    assert.equal(staged, false);
    assert.equal(uci.events.some((event) => event[0] === 'save'), false);
  });

  it('retries direct UCI confirmation after a transient status without falling back to the legacy apply helper', async () => {
    const module = loadModule('sheepfold/core/persistence/uci.js');
    const uci = fakeUci();
    const calls = [];
    const confirmations = [6, 0];
    uci.callApply = async (timeout, rollback) => { calls.push(['apply', timeout, rollback]); return 0; };
    uci.callConfirm = async () => { const value = confirmations.shift(); calls.push(['confirm', value]); return value; };
    uci.apply = async () => { throw new Error('legacy apply must not run'); };
    const timers = [];
    const adapter = module.create({
      uci,
      revert: async () => {},
      setTimeout(callback, delay) { timers.push(delay); callback(); return timers.length; },
    });
    await adapter.mutate(['sheepfold'], () => uci.set('sheepfold', 'global', 'language', 'ru'));
    assert.deepEqual(calls, [['apply', 10, true], ['confirm', 6], ['confirm', 0]]);
    assert.deepEqual(timers, [1000, 250]);
  });

  it('guards the secure administrator account flow against duplicate submits and section collisions', async () => {
    const raw = source('view/sheepfold/overview-secure.js').replace(/^'require .*?';\r?\n/gm, '');
    const marker = 'return view.extend({';
    const finalAt = raw.lastIndexOf(marker);
    assert.ok(finalAt > 0);
    const executable = raw.slice(0, finalAt) + `module.exports = {
      showSafeAddAdministratorModal,
    };`;
    const writes = [];
    const added = [];
    const notifications = [];
    const occupied = [];
    let modal = null;
    let executions = 0;
    let mutations = 0;
    let reloads = 0;
    let releaseMutation;
    const gate = new Promise((resolveGate) => { releaseMutation = resolveGate; });

    function node(tag, attrs, children) {
      const childList = Array.isArray(children) ? children : children == null ? [] : [children];
      return {
        tag, attrs: attrs || {}, children: childList, childNodes: childList, disabled: !!attrs?.disabled,
        value: attrs?.value || '', dataset: {}, textContent: typeof children === 'string' ? children : '',
        setAttribute(name, value) { this.attrs[name] = String(value); },
        getAttribute(name) { return this.attrs[name] ?? null; },
        removeAttribute(name) { delete this.attrs[name]; },
        classList: { add() {}, remove() {}, contains() { return false; } },
      };
    }
    function walk(value, result = []) {
      if (!value || typeof value !== 'object') return result;
      if (value.tag) result.push(value);
      for (const child of value.children || []) walk(child, result);
      return result;
    }
    function fnv(text) {
      let result = 2166136261;
      for (const character of String(text)) {
        result ^= character.charCodeAt(0);
        result = Math.imul(result, 16777619) >>> 0;
      }
      return result.toString(16).padStart(8, '0');
    }
    const base = `admin_parent_${fnv('parent')}`;
    occupied.push({ '.name': base, '.type': 'device' });
    const persistence = {
      sections(_config, type) {
        return occupied.filter((entry) => !type || entry['.type'] === type);
      },
      ensureSection(_config, type, name) {
        added.push([type, name]);
        occupied.push({ '.name': name, '.type': type });
        return name;
      },
      mutate(_configs, stage) {
        mutations += 1;
        const stageResult = stage();
        return gate.then(() => ({ stageResult }));
      },
    };
    const uci = {
      get: () => null,
      set(config, section, option, value) { writes.push([config, section, option, value]); },
    };
    const pairingPersistence = loadModule('sheepfold/features/pairing/persistence.js');
    const context = {
      module: { exports: {} }, Promise, Object, Array, String, Number, Boolean, Math, Date, JSON, Error, RegExp,
      Map, Set, parseInt, isFinite, setTimeout, clearTimeout,
      _: (value) => value,
      E: node,
      Event: class Event {},
      document: { querySelectorAll: () => [] },
      window: {
        setTimeout, clearTimeout,
        location: { reload() { reloads += 1; } },
      },
      overview: { renderSettings() {}, renderAdmins() {}, load() {}, render() {} },
      view: { extend: (value) => value },
      uci,
      ui: {
        showModal(_title, nodes) { modal = nodes; }, hideModal() {},
        addNotification(_title, content, level) { notifications.push([content, level]); },
      },
      rpc: { declare: () => async () => 0 },
      routerBackend: {
        run: async () => ({ code: 0 }), withTimeout: async () => ({ code: 0 }), ensureOk: (value) => value,
        errorText: (error, fallback) => error?.message || fallback, actionMetadata: () => ({}), parseKeyValues: () => ({}),
      },
      uciPersistenceModel: { create: () => persistence },
      pairingPersistenceModel: {
        createAccountStore: () => pairingPersistence.createAccountStore({ persistence, uci }),
      },
      commandActionsModel: { create: () => ({
        run: async () => ({ code: 0 }), errorText: (error, fallback) => error?.message || fallback,
        ensureOk: (value) => value,
        execute(spec) { executions += 1; return Promise.resolve().then(spec.task); },
      }) },
    };
    vm.createContext(context);
    vm.runInContext(`(function () { ${executable} })()`, context, { filename: 'overview-secure.js' });
    context.module.exports.showSafeAddAdministratorModal();
    const nodes = walk({ children: modal });
    const inputs = nodes.filter((entry) => entry.tag === 'input');
    const createButtons = nodes.filter((entry) => entry.tag === 'button' && entry.children.includes('Create'));
    assert.equal(inputs.length, 2);
    assert.equal(createButtons.length, 2);
    inputs[0].value = 'Parent';
    inputs[1].value = 'Parent';
    createButtons[0].attrs.click({ preventDefault() {} });
    createButtons[1].attrs.click({ preventDefault() {} });
    await Promise.resolve();
    assert.equal(executions, 1);
    assert.equal(mutations, 1);
    assert.ok(createButtons.every((button) => button.disabled));
    releaseMutation();
    await gate;
    await new Promise((resolveWait) => setTimeout(resolveWait, 0));
    assert.equal(reloads, 1);
    assert.deepEqual(added, [['administrator', `${base}_2`]]);
    assert.ok(writes.some((entry) => entry[2] === 'role' && entry[3] === 'admin'));
    assert.ok(writes.some((entry) => entry[2] === 'allow_child_access_requests' && entry[3] === '0'));
    assert.ok(writes.some((entry) => entry[2] === 'id' && entry[3] === '1'));
    assert.ok(createButtons.every((button) => !button.disabled));
    assert.equal(notifications.length, 1);
  });

});
