/* §persist1 §cfgbak1
 * Настоящие LuCI-модули и очередь Promise. UCI/RPC — модель с отдельными
 * staging, submitted и saved; это не испытание rpcd/роутера и не общий lock.
 * Управляемые барьеры, без sleep: при замеченном конфликте save не вызывается.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve('package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold');
const modules = { uci: 'core/persistence/uci', backup: 'features/settings/backup',
  'backup-persistence': 'features/settings/backup-persistence' };
const clone = value => JSON.parse(JSON.stringify(value));
function load(name) {
  const filename = process.env.SHEEPFOLD_CONSISTENCY_SOURCE
    ? resolve(process.env.SHEEPFOLD_CONSISTENCY_SOURCE, name + '.js') : resolve(root, modules[name] + '.js');
  const text = readFileSync(filename, 'utf8').replace(/^'require .*?';\r?\n/gm, '');
  return vm.runInNewContext(`(function () { ${text} })()`, {
    baseclass: { extend: value => value }, Promise, Object, Array, String, Number, Boolean,
    Math, Date, JSON, Error, RegExp, Map, Set, TextEncoder, TextDecoder,
  }, { filename });
}
function record(name, value) {
  const dir = process.env.SHEEPFOLD_CONSISTENCY_EVIDENCE;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, name + '.json'), JSON.stringify(value, null, 2) + '\n');
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function source() {
  return { sheepfold: [
    { '.name': 'global', '.type': 'sheepfold', router_install_id: 'a'.repeat(32), note: 'before' },
    { '.name': 'allowlist', '.type': 'list' }, { '.name': 'blocklist', '.type': 'list' },
  ], dhcp: [{ '.name': 'lease', '.type': 'host', ip: '192.0.2.1' }], wireless: [
    { '.name': 'wifi0', '.type': 'wifi-iface', ssid: 'Семья', key: 'old-synthetic-secret' },
  ] };
}
function fixture(options = {}) {
  const current = clone(options.current || source());
  const state = { creates: {}, changes: {}, deletes: {}, reorder: {} };
  const trace = [], submitted = [];
  let saveGate = null, saveFailure = null;
  const uci = { state,
    sections: config => current[config] || [],
    set(config, section, option, value) {
      state.changes[config] ||= {}; state.changes[config][section] ||= {};
      state.changes[config][section][option] = value; trace.push(['set', config, section, option]);
    },
    unset(config, section, option) {
      state.deletes[config] ||= {}; state.deletes[config][section] ||= {};
      state.deletes[config][section][option] = true; trace.push(['unset', config, section, option]);
    },
    add(config, type, name) {
      state.creates[config] ||= {}; state.creates[config][name] = { '.name': name, '.type': type };
      trace.push(['add', config, name]); return name;
    },
    remove(config, section) {
      state.deletes[config] ||= {}; state.deletes[config][section] = true;
      trace.push(['remove', config, section]);
    },
    changes: async () => ({}),
    save() {
      const packet = clone(state); submitted.push(packet); trace.push(['save']);
      const gate = saveGate; saveGate = null;
      const failure = saveFailure; saveFailure = null;
      return Promise.resolve(gate?.promise).then(() => {
        if (failure) throw failure;
        for (const config of Object.keys(current)) {
          current[config] = current[config].filter(s => packet.deletes[config]?.[s['.name']] !== true);
          for (const section of current[config]) {
            for (const key of Object.keys(packet.deletes[config]?.[section['.name']] || {})) delete section[key];
          }
          current[config].push(...Object.values(packet.creates[config] || {}));
          for (const section of current[config]) Object.assign(section, packet.changes[config]?.[section['.name']] || {});
        }
        // LuCI reload после RPC может очищать последующие правки. Мы не объявляем
        // это окно закрытым и здесь проверяем только уже отправленный packet.
        for (const bucket of Object.keys(state)) state[bucket] = {};
      });
    },
    callApply: async () => { trace.push(['apply']); return 0; },
    callConfirm: async () => { trace.push(['confirm']); return 0; },
    unload: config => { trace.push(['unload', config]); for (const bucket of Object.keys(state)) delete state[bucket][config]; },
    load: async config => { trace.push(['load', config]); },
  };
  const model = load('backup');
  const persistence = load('uci').create({ uci, setTimeout: callback => { callback(); return 1; },
    revert: async () => { trace.push(['revert']); } });
  const writer = load('backup-persistence').create({ model, uci, persistence,
    refreshRuntime: async () => { trace.push(['refresh']); } });
  return { current, state, trace, submitted, uci, model, persistence, writer,
    snapshot: () => model.build(current, true),
    holdSave: () => { saveGate = deferred(); return saveGate; },
    failSave: () => { saveFailure = new Error('synthetic_save_failure'); },
  };
}

for (const bucket of ['changes', 'creates', 'deletes', 'reorder']) {
  it(`rejects a later ${bucket} edit before save without deleting the mixed draft`, async () => {
    const f = fixture(); let later;
    const result = f.persistence.mutate(['sheepfold'], () => {
      f.uci.set('sheepfold', 'global', 'note', 'owner-change');
      later = Promise.resolve().then(() => {
        f.trace.push(['foreign', bucket]);
        if (bucket === 'changes') f.uci.set('sheepfold', 'global', 'foreignDraft', 'not-confirmed');
        if (bucket === 'creates') f.uci.add('sheepfold', 'device', 'foreignDevice');
        if (bucket === 'deletes') f.uci.remove('sheepfold', 'allowlist');
        if (bucket === 'reorder') f.state.reorder.sheepfold = true;
      });
      return 'owner-result';
    });
    const outcome = await result.then(value => ({ value }), error => ({ error })); await later;
    record('microtask-' + bucket, { submitted: f.submitted, trace: f.trace, state: f.state,
      error: outcome.error?.errorCode, result: outcome.value });
    assert.equal(outcome.error?.errorCode, 'uci_concurrent_local_changes');
    assert.equal(f.submitted.length, 0, 'no call to save, including deferred native RPC batching');
    assert.equal(f.trace.some(t => ['save','apply','confirm','revert','unload'].includes(t[0])), false);
    assert.equal(f.state.changes.sheepfold.global.note, 'owner-change');
    if (bucket === 'changes') assert.equal(f.state.changes.sheepfold.global.foreignDraft, 'not-confirmed');
    if (bucket === 'creates') assert.ok(f.state.creates.sheepfold.foreignDevice);
    if (bucket === 'deletes') assert.equal(f.state.deletes.sheepfold.allowlist, true);
    if (bucket === 'reorder') assert.equal(f.state.reorder.sheepfold, true);
    await assert.rejects(f.persistence.mutate(['sheepfold'], () => {}), /uci_foreign_local_changes/);
  });
}
it('still rejects asynchronous staging before save', async () => {
  const f = fixture();
  await assert.rejects(f.persistence.mutate(['sheepfold'], () => Promise.resolve('not-sync')), /uci_async_stage_forbidden/);
  assert.equal(f.submitted.length, 0);
});
it('still cleans own staging after a synchronous error and allows a later mutation', async () => {
  const f = fixture();
  await assert.rejects(f.persistence.mutate(['sheepfold'], () => {
    f.uci.set('sheepfold', 'global', 'note', 'partial'); throw new Error('own-stage-failure');
  }), /own-stage-failure/);
  assert.equal(f.submitted.length, 0);
  await f.persistence.mutate(['sheepfold'], () => f.uci.set('sheepfold', 'global', 'note', 'second'));
  assert.equal(f.current.sheepfold[0].note, 'second');
});
it('failed save retains the existing cleanup and queue recovery path', async () => {
  const f = fixture(); f.failSave();
  await assert.rejects(f.persistence.mutate(['sheepfold'], () => f.uci.set('sheepfold', 'global', 'note', 'first')), /synthetic_save_failure/);
  assert.equal(f.trace.filter(t => t[0] === 'revert').length, 1);
  await f.persistence.mutate(['sheepfold'], () => f.uci.set('sheepfold', 'global', 'note', 'second'));
  assert.equal(f.current.sheepfold[0].note, 'second');
});

for (const config of ['sheepfold', 'dhcp', 'wireless']) {
  for (const containsSecrets of [false, true]) {
    it(`queued ${containsSecrets ? 'full' : 'readable'} import rejects a stale ${config} snapshot before staging`, async () => {
      const f = fixture();
      const input = f.model.build(source(), containsSecrets), previous = f.snapshot();
      input.configs.sheepfold[0].options.note = 'imported';
      const reached = deferred(), gate = f.holdSave();
      const first = f.persistence.mutate([config], () => {
        const section = config === 'sheepfold' ? 'global' : config === 'dhcp' ? 'lease' : 'wifi0';
        const option = config === 'wireless' ? 'key' : config === 'dhcp' ? 'ip' : 'note';
        f.uci.set(config, section, option, 'new-synthetic-value'); reached.resolve();
      });
      await reached.promise;
      // Первый save ещё не завершён, а controller уже получил старый payload(true).
      const result = Promise.resolve().then(() => f.writer.apply(input, previous));
      const observed = result.then(value => ({ value }), error => ({ error }));
      gate.resolve(); await first; const outcome = await observed;
      record(`queued-${config}-${containsSecrets}`, { trace: f.trace, submitted: f.submitted,
        current: f.current, error: outcome.error?.message, result: outcome.value });
      assert.equal(outcome.error?.message, 'backup_current_settings_changed');
      assert.equal(f.submitted.length, 1, 'only the preceding explicitly saved mutation was submitted');
      assert.equal(f.trace.filter(t => t[0] === 'refresh').length, 0);
      const target = f.current[config][0];
      const option = config === 'wireless' ? 'key' : config === 'dhcp' ? 'ip' : 'note';
      assert.equal(target[option], 'new-synthetic-value');
      // Повтор разрешён только с заново полученным текущим снимком.
      const retry = await f.writer.apply(input, f.snapshot());
      assert.equal(retry.persisted, true);
      if (!containsSecrets && config === 'wireless') assert.equal(f.current.wireless[0].key, 'new-synthetic-value');
    });
  }
}
it('unchanged readable import keeps the matching secret and preserves unrelated DHCP types', async () => {
  const f = fixture(); f.current.dhcp.push({ '.name': 'dns', '.type': 'dnsmasq', domain: 'lan' });
  const previous = f.model.build({ ...f.current, dhcp: f.current.dhcp.filter(s => s['.type'] === 'host') }, true);
  const input = f.model.build(source(), false);
  const result = await f.writer.apply(input, previous);
  assert.equal(result.persisted, true); assert.equal(f.current.wireless[0].key, 'old-synthetic-secret');
  assert.ok(f.current.dhcp.some(s => s['.type'] === 'dnsmasq'));
});
it('equivalent option key order is not a change of settings', async () => {
  const f = fixture(), previous = f.snapshot(), input = f.model.build(source(), false);
  f.current.wireless[0] = Object.fromEntries(Object.entries(f.current.wireless[0]).reverse());
  const result = await f.writer.apply(input, previous);
  assert.equal(result.persisted, true);
});
it('an unreadable fresh snapshot cannot lead to import staging', async () => {
  const f = fixture(), previous = f.snapshot(), input = f.model.build(source(), false);
  f.uci.sections = () => { throw new Error('synthetic_current_read_failure'); };
  await assert.rejects(Promise.resolve().then(() => f.writer.apply(input, previous)), /synthetic_current_read_failure/);
  assert.equal(f.submitted.length, 0); assert.equal(f.trace.some(t => t[0] === 'set' || t[0] === 'remove'), false);
});


it('a loaded configuration changed during preflight is not overwritten by the earlier snapshot', async () => {
  const f = fixture(), previous = f.snapshot(), input = f.model.build(source(), false);
  const gate = deferred(), reached = deferred();
  f.uci.changes = () => { reached.resolve(); return gate.promise; };
  const result = f.writer.apply(input, previous);
  const outcome = result.then(value => ({ value }), error => ({ error }));
  await reached.promise; f.current.wireless[0].key = 'fresh-preflight-secret'; gate.resolve({});
  const completed = await outcome;
  record('preflight-change', { error: completed.error?.message, result: completed.value, submitted: f.submitted, current: f.current });
  assert.equal(completed.error?.message, 'backup_current_settings_changed');
  assert.equal(f.submitted.length, 0); assert.equal(f.current.wireless[0].key, 'fresh-preflight-secret');
});
it('unreadable wireless is found before staging any Sheepfold or DHCP changes', async () => {
  const f = fixture(), previous = f.snapshot(), input = f.model.build(source(), false);
  const read = f.uci.sections;
  f.uci.sections = config => { if (config === 'wireless') throw new Error('late-read-failure'); return read(config); };
  await assert.rejects(Promise.resolve().then(() => f.writer.apply(input, previous)), /late-read-failure/);
  record('late-read', { trace: f.trace, submitted: f.submitted });
  assert.equal(f.submitted.length, 0); assert.equal(f.trace.some(t => ['set','unset','add','remove'].includes(t[0])), false);
});
it('volatile pairing-code rotation does not produce a false settings conflict', async () => {
  const f = fixture(); f.current.sheepfold.push({ '.name': 'parent', '.type': 'administrator', pairing_code: 'old-code' });
  const previous = f.snapshot(), input = f.model.build(f.current, false);
  f.current.sheepfold.at(-1).pairing_code = 'new-code';
  const result = await f.writer.apply(input, previous); assert.equal(result.persisted, true);
});
it('changed current router identity cannot reuse the earlier restore decision', async () => {
  const f = fixture(), previous = f.snapshot(), input = f.model.build(source(), false);
  f.current.sheepfold[0].router_install_id = 'b'.repeat(32);
  await assert.rejects(Promise.resolve().then(() => f.writer.apply(input, previous)), /backup_current_settings_changed/);
  assert.equal(f.submitted.length, 0); assert.equal(f.current.sheepfold[0].router_install_id, 'b'.repeat(32));
});

// Модель сохраняет ссылку до следующей задачи так же, как batch RPC LuCI.
// Это не подмена всей libuci: контроль проверяет отсутствие вызова save вообще.
it('does not pass the detected mixed draft to a deferred RPC serializer', async () => {
  const f = fixture(), packets = [];
  f.uci.save = () => {
    f.trace.push(['save-deferred']); const values = f.state.changes.sheepfold.global;
    return new Promise(resolve => setImmediate(() => { packets.push(clone(values)); resolve(); }));
  };
  const outcome = await f.persistence.mutate(['sheepfold'], () => {
    f.uci.set('sheepfold', 'global', 'note', 'owner-change');
    Promise.resolve().then(() => f.uci.set('sheepfold', 'global', 'foreignDraft', 'not-confirmed'));
  }).then(value => ({ value }), error => ({ error }));
  record('deferred-rpc', { packets, trace: f.trace, state: f.state, error: outcome.error?.errorCode });
  assert.equal(outcome.error?.errorCode, 'uci_concurrent_local_changes');
  assert.equal(packets.length, 0); assert.equal(f.trace.some(t => t[0] === 'save-deferred'), false);
});
