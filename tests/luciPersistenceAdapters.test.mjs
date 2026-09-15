/* Runtime/source checks for narrow LuCI persistence adapters. §persist1 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const resources = resolve('package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources');
const source = (relative) => readFileSync(resolve(resources, relative), 'utf8');
function loadModule(relative, extras = {}) {
  const raw = source(relative).replace(/^'require .*?';\r?\n/gm, '');
  const context = { module: { exports: {} }, baseclass: { extend: (value) => value }, Promise, Object, Array,
    String, Number, Boolean, Math, Date, JSON, Error, RegExp, Map, Set, ...extras };
  vm.createContext(context);
  vm.runInContext(`(function () { ${raw.replace('return baseclass.extend(', 'module.exports = baseclass.extend(')} })()`, context, { filename: relative });
  return context.module.exports;
}
function fakeUci(initial = {}) {
  const values = structuredClone(initial);
  const state = { creates: {}, changes: {}, deletes: {}, reorder: {} };
  const calls = [];
  function sections(config, type) {
    return Object.values(values[config] || {}).concat(Object.values(state.creates[config] || {}))
      .filter((item) => !type || item['.type'] === type);
  }
  return {
    values, state, calls, sections,
    get(config, section, option) { return state.creates[config]?.[section]?.[option] ?? state.changes[config]?.[section]?.[option] ?? values[config]?.[section]?.[option] ?? null; },
    add(config, type, name) { state.creates[config] ||= {}; state.creates[config][name] = { '.name': name, '.type': type }; calls.push(['add', config, type, name]); return name; },
    set(config, section, option, value) { if (state.creates[config]?.[section]) state.creates[config][section][option] = value;
      else { state.changes[config] ||= {}; state.changes[config][section] ||= {}; state.changes[config][section][option] = value; } calls.push(['set', config, section, option, value]); },
    unset(config, section, option) { state.deletes[config] ||= {}; state.deletes[config][section] ||= {}; state.deletes[config][section][option] = true; calls.push(['unset', config, section, option]); },
    remove(config, section) { state.deletes[config] ||= {}; state.deletes[config][section] = true; calls.push(['remove', config, section]); },
    changes: async () => ({}),
    async save(...args) { calls.push(['save', args.length]); state.creates = {}; state.changes = {}; state.deletes = {}; state.reorder = {}; },
    async callApply(timeout, rollback) { calls.push(['apply', timeout, rollback]); return 0; },
    async callConfirm() { calls.push(['confirm']); return 0; },
    async apply() { throw new Error('native apply must not be used'); },
    unload(config) { calls.push(['unload', config]); }, async load(config) { calls.push(['load', config]); },
  };
}

describe('LuCI persistence adapters §persist1', () => {
  it('betaProfileUsesExplicitConfirmationAndOnlyStagesItsDocumentedSettings', () => {
    let consent = false;
    const drafts = [];
    let input;
    const model = loadModule('sheepfold/features/settings/general.js', {
      _: (text) => text,
      E: (tag, attrs, children) => ({ tag, attrs, children, addEventListener() {} }),
    });
    const view = model.render({
      value: (_key, fallback) => fallback,
      setOption() { assert.fail('must stage one explicit profile'); },
      setOptions() { assert.fail('unrelated automation must not change'); },
      setBetaOptions: (value) => drafts.push({ ...value }),
      confirm: () => consent,
      checkbox: (_label, checked, _hint, attrs) => {
        input = { checked, change: attrs.change };
        return { node: input };
      },
      divider: () => ({}), selectField: () => ({}), textareaField: () => ({}),
    });
    assert.equal(view.children.at(-1), input);
    assert.equal(input.checked, false);
    input.checked = true;
    input.change({ currentTarget: input });
    assert.equal(input.checked, false);
    assert.equal(drafts.length, 0);
    consent = true;
    input.checked = true;
    input.change({ currentTarget: input });
    assert.deepEqual(drafts[0], {
      beta_testing: '1', sim_change_notifications: 'all', child_wifi_network_notifications: 'network_only',
    });
    assert.equal(model.betaTestingDraft(true, 'with_location').child_wifi_network_notifications, 'with_location');
    input.checked = false;
    input.change({ currentTarget: input });
    assert.deepEqual(drafts[1], { beta_testing: '0' });
    const settings = loadModule('sheepfold/features/settings/persistence.js', { _: (text) => text }).create({});
    settings.validate({ beta_testing: '1' });
    settings.validate({ beta_testing: '0' });
    assert.throws(() => settings.validate({ beta_testing: 'yes' }), /Invalid beta testing/);
  });

  it('serializes one mutation, replaces lists atomically and performs zero-argument save/apply', async () => {
    const uci = fakeUci({ sheepfold: { allowlist: { '.name': 'allowlist', '.type': 'list', mac: ['OLD'] } } });
    const adapter = loadModule('sheepfold/core/persistence/uci.js').create({
      uci, revert: async () => {}, setTimeout: (callback) => { callback(); return 1; },
    });
    const result = await adapter.mutate(['sheepfold', 'sheepfold'], () => {
      adapter.replaceList('sheepfold', 'allowlist', 'mac', ['AA', 'BB']);
      return 'staged';
    });
    assert.equal(result.stageResult, 'staged');
    assert.deepEqual(uci.calls.filter((call) => call[0] === 'save'), [['save', 0]]);
    assert.equal(uci.calls.filter((call) => call[0] === 'apply').length, 1);
    assert.ok(uci.calls.some((call) => call[0] === 'unset' && call[3] === 'mac'));
    assert.ok(uci.calls.some((call) => call[0] === 'set' && Array.isArray(call[4])));
  });

  it('rejects a named-section type collision before staging a different domain object', () => {
    const uci = fakeUci({ sheepfold: { usb: { '.name': 'usb', '.type': 'device' } } });
    const adapter = loadModule('sheepfold/core/persistence/uci.js').create({ uci, revert: async () => {} });
    assert.throws(() => adapter.ensureSection('sheepfold', 'usb', 'usb'), (error) => error.errorCode === 'uci_section_type_conflict');
    assert.equal(uci.calls.some((call) => call[0] === 'add'), false);
  });

  it('stages a device, access lists and static DHCP lease before ordered runtime sync', async () => {
    const uci = fakeUci({ sheepfold: { device_1: { '.name': 'device_1', '.type': 'device', mac: 'AA', group: 'Old' },
      allowlist: { '.name': 'allowlist', '.type': 'list', mac: [] }, blocklist: { '.name': 'blocklist', '.type': 'list', mac: [] } }, dhcp: {} });
    const events = [];
    const persistence = { sections: uci.sections, ensureSection: (_c, _t, name) => { if (!uci.get(_c, name)) uci.add(_c, _t, name); return name; },
      replaceList: (c, s, o, v) => { uci.unset(c, s, o); if (v.length) uci.set(c, s, o, v); },
      mutate: async (configs, stage) => { events.push(['mutate', [...configs]]); return { stageResult: stage() }; }, reload: async () => {}, discard: async () => {} };
    const adapter = loadModule('sheepfold/features/devices/persistence.js').create({
      uci, persistence, accessLists: { updatedValues: (_current, mac, enabled) => enabled ? [mac] : [] }, normalizeMac: (value) => String(value || '').toUpperCase(),
      generatedSectionName: (prefix) => `${prefix}_AA`, normalizeGroupName: (value) => value, notConfiguredGroup: 'Not configured', isAdminDevice: () => false,
      noRestrictionsGroupName: () => 'No restrictions', personalDevicesGroupName: () => 'Personal devices', markNoRestrictionsExcluded() {}, markPersonalDevicesExcluded() {},
      run: async (args) => { events.push(args.join(':')); return { code: 0 }; }, ensureOk() {}, refreshSiteStatus: async () => events.push('site-status'),
      invalidMacMessage: () => 'bad mac', accessRuntimeError: () => 'access failed', siteRuntimeError: () => 'site failed', action: async () => ({ result: {} }),
    });
    const result = await adapter.persistSettings({ id: '1', mac: 'AA', configSection: 'device_1', group: 'Old' },
      { name: 'Phone', ip: '192.168.1.10', group: 'Children', deviceType: 'phone', status: 'allow', staticLease: true });
    assert.equal(result.persisted, true);
    assert.equal(result.runtimeApplied, true);
    assert.deepEqual(events.slice(-3), ['schedule-sync', 'site-lists-apply', 'site-status']);
    assert.ok(uci.calls.some((call) => call[0] === 'set' && call[1] === 'dhcp' && call[3] === 'ip'));
  });

  it('labels access runtime failure as post-commit rather than a rolled-back save', async () => {
    const adapter = loadModule('sheepfold/features/devices/persistence.js').create({
      uci: { get: () => [], set() {}, unset() {}, remove() {} }, persistence: { ensureSection: (_c, _t, name) => name, replaceList() {}, sections: () => [],
        mutate: async (_c, stage) => ({ stageResult: stage() }), reload: async () => {}, discard: async () => {} },
      accessLists: { updatedValues: () => [] }, normalizeMac: (value) => value, generatedSectionName: () => 'device_1', normalizeGroupName: (value) => value,
      notConfiguredGroup: 'Not configured', isAdminDevice: () => false, noRestrictionsGroupName: () => '', personalDevicesGroupName: () => '',
      markNoRestrictionsExcluded() {}, markPersonalDevicesExcluded() {}, run: async () => ({ code: 9 }), ensureOk(_r, fallback) { throw new Error(fallback); },
      invalidMacMessage: () => 'bad mac', accessRuntimeError: () => 'runtime failed', siteRuntimeError: () => 'site failed', action: async () => ({ result: {} }),
    });
    await assert.rejects(adapter.saveAccess(['sheepfold'], () => ({ sectionName: 'device_1' })),
      (error) => error.persisted === true && error.runtimeApplied === false && error.persistenceResult.sectionName === 'device_1');
  });

  it('falls back to legacy Wi-Fi reload and labels a reload-only failure as persisted', async () => {
    const module = loadModule('sheepfold/features/wifi/persistence.js');
    const calls = [];
    const adapter = module.create({ uci: { set() {}, unset() {} }, persistence: { mutate: async (_c, stage) => ({ stageResult: stage() }), discard: async () => {} },
      exec: async (_path, args) => { calls.push(args); return args.length ? { code: 1 } : { code: 0 }; } });
    const ok = await adapter.persist(() => 'wifi-stage');
    assert.equal(ok.runtimeApplied, true);
    assert.deepEqual(calls.map((args) => Array.from(args)), [['reload'], []]);
    const failed = module.create({ uci: { set() {}, unset() {} }, persistence: { mutate: async (_c, stage) => ({ stageResult: stage() }), discard: async () => {} },
      exec: async () => ({ code: 1, stderr: 'reload failed' }) });
    await assert.rejects(failed.persist(() => 'wifi-stage'), (error) => error.persisted === true && error.runtimeApplied === false);
  });

  it('preserves masked secrets during import and reports service-refresh failure honestly', async () => {
    const writes = [];
    const current = { configs: { sheepfold: [{ name: 'global', type: 'sheepfold', options: { token: 'secret' } }], dhcp: [], wireless: [] } };
    const imported = { configs: { sheepfold: [{ name: 'global', type: 'sheepfold', options: { token: '[secret]', language: 'ru' } }], dhcp: [], wireless: [] } };
    const adapter = loadModule('sheepfold/features/settings/backup-persistence.js').create({
      model: { build: loadModule('sheepfold/features/settings/backup.js').build, secretPlaceholder: '[secret]', secretOption: (name) => /password|token|secret|key/i.test(name), validate: (value) => value, prepareRestore: (value) => ({ payload: value, routerTransfer: false }) },
      uci: { set: (...args) => writes.push(args), unset() {}, remove() {} },
      persistence: { sections: (config) => config === 'sheepfold' ? [{ '.name': 'global', '.type': 'sheepfold', token: 'secret' }] : [], ensureSection: (_c, _t, name) => name,
        mutate: async (_configs, stage) => ({ stageResult: stage() }) }, refreshRuntime: async () => { throw new Error('refresh failed'); },
    });
    const result = await adapter.apply(imported, current);
    assert.equal(result.persisted, true);
    assert.equal(result.servicesRefreshed, false);
    assert.ok(writes.some((entry) => entry[2] === 'token' && entry[3] === 'secret'));
  });

  it('rejects blocklisted administrator bindings before writes and keeps persistence owners DOM-free', async () => {
    let writes = 0;
    const adapter = loadModule('sheepfold/features/pairing/persistence.js').create({
      uci: { set() { writes++; }, get: () => '' }, persistence: { sections: () => [], ensureSection: (_c, _t, name) => name, replaceList() {} },
      devicePersistence: { ensureDeviceSection: () => 'device_1', updateMacList() {}, saveAccess: async (_c, stage) => ({ stageResult: stage() }) },
      normalizeMac: (value) => value, notConfiguredGroup: 'Not configured', deviceById: () => null, canBind: (device) => device.status !== 'blocked',
      listValues: (value) => value || [], action: async () => ({ result: {}, data: {} }), blocklistedError: () => 'blocked',
    });
    assert.throws(() => adapter.stageBindings({ login: 'parent' }, [{ id: '1', mac: 'AA', status: 'blocked' }], []),
      (error) => error.errorCode === 'device_blocklisted');
    assert.equal(writes, 0);
    for (const relative of ['sheepfold/core/persistence/uci.js', 'sheepfold/features/devices/persistence.js', 'sheepfold/features/wifi/persistence.js',
      'sheepfold/features/settings/backup-persistence.js', 'sheepfold/features/pairing/persistence.js']) {
      const executable = source(relative)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      assert.doesNotMatch(executable, /\bdocument\.|\bwindow\.|\bui\./, relative);
    }
  });
});
