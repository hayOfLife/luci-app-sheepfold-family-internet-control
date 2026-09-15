/*
 * Настоящие backup model/controller/persistence/panel и WebCrypto в Node VM.
 * DOM, FileReader и UCI — управляемые модели. UCI различает pending и сохранённое
 * состояние; отказ confirm/revert не выдаётся за опыт на физическом роутере.
 * Проверяется путь файл → диалог → применение → сообщение и возможность повтора.
 */
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { it } from 'node:test';

const resources = resolve('package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold');
const settings = resolve(resources, 'features/settings');
function load(name, extras = {}) {
  const path = name.startsWith('core/') ? resolve(resources, name + '.js') :
    resolve(process.env.SHEEPFOLD_BACKUP_SOURCE || settings, name + '.js');
  const source = readFileSync(path, 'utf8').replace(/^'require .*?';\r?\n/gm, '');
  return vm.runInNewContext(`(function () { ${source} })()`, {
    baseclass: { extend: value => value }, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array,
    btoa: value => Buffer.from(value, 'binary').toString('base64'), atob: value => atob(value),
    Promise, Object, Array, String, Number, Boolean, Date, JSON, Error, RegExp, ...extras,
  }, { filename: path });
}
function record(name, value) {
  if (!process.env.SHEEPFOLD_IMPORT_EVIDENCE_DIR) return;
  const root = resolve(process.env.SHEEPFOLD_IMPORT_EVIDENCE_DIR);
  mkdirSync(root, { recursive: true });
  writeFileSync(resolve(root, name + '.json'), JSON.stringify(value, null, 2) + '\n');
}
function sourceSections() {
  return { sheepfold: [
    { '.name': 'global', '.type': 'sheepfold', router_install_id: 'a'.repeat(32), note: 'before' },
    { '.name': 'allowlist', '.type': 'list' }, { '.name': 'blocklist', '.type': 'list' },
  ], dhcp: [], wireless: [{ '.name': 'wifi0', '.type': 'wifi-iface', ssid: 'До импорта', key: 'synthetic-wifi-secret' }] };
}
function monitor(promise, failures) {
  // Наблюдаем также отброшенный Promise прежнего event handler без глобального
  // unhandledRejection. Семантика then сохраняется, ошибки остаются в assertions.
  return { then(...args) { const next = Promise.resolve(promise).then(...args); next.catch(e => failures.push(e)); return next; } };
}
function fixture(options = {}) {
  const model = load('backup'), current = sourceSections(), trace = [], modals = [], nodes = [],
    notices = [], discarded = [], errors = [], timers = [], tasks = [];
  const decrypt = model.decrypt;
  model.decrypt = (...args) => {
    const result = decrypt(...args); tasks.push(Promise.resolve(result).catch(() => {}));
    return monitor(result, errors);
  };
  const control = { failSnapshot: false, failReset: false, failNotify: false, failHide: false,
    failTimer: false, failRefresh: false, failApply: false, failRevert: false,
    applyOverride: null, ...options };
  const state = { creates: {}, changes: {}, deletes: {}, reorder: {} };
  let pending = null, clock = 0, activeModal = null;
  const uci = {
    state,
    sections: config => current[config],
    add(config, type, name) { state.creates[config] ||= {}; state.creates[config][name] = { '.name': name, '.type': type }; return name; },
    remove(config, name) { state.deletes[config] ||= {}; state.deletes[config][name] = true; trace.push(['remove', config, name]); },
    unset(config, name, key) { state.deletes[config] ||= {}; state.deletes[config][name] ||= {}; state.deletes[config][name][key] = true; },
    set(config, name, key, value) { state.changes[config] ||= {}; state.changes[config][name] ||= {}; state.changes[config][name][key] = value; },
    changes: async () => ({}),
    save() { trace.push(['save']); pending = structuredClone(state);
      for (const bucket of ['creates', 'changes', 'deletes', 'reorder']) state[bucket] = {};
      return Promise.resolve(); },
    callApply() { trace.push(['apply']);
      for (const config of Object.keys(current)) {
        current[config] = current[config].filter(s => pending.deletes[config]?.[s['.name']] !== true);
        for (const section of current[config]) for (const key of Object.keys(pending.deletes[config]?.[section['.name']] || {})) delete section[key];
        current[config].push(...Object.values(pending.creates[config] || {}));
        for (const section of current[config]) Object.assign(section, pending.changes[config]?.[section['.name']] || {});
      }
      return Promise.resolve(0);
    },
    callConfirm() { trace.push(['confirm']); return control.failApply ? Promise.reject(new Error('synthetic_confirm_error')) : Promise.resolve(0); },
    unload(config) { for (const bucket of ['creates', 'changes', 'deletes', 'reorder']) delete state[bucket][config]; },
    load: async () => {},
  };
  const persistence = load('core/persistence/uci', { Date: { now: () => { clock += 20000; return clock; } } }).create({
    uci, setTimeout: callback => { callback(); return 1; },
    revert: async () => { trace.push(['revert']); if (control.failRevert) throw new Error('synthetic_revert_error'); },
  });
  const writer = load('backup-persistence').create({ model, persistence, uci,
    refreshRuntime: async () => { trace.push(['refresh']); if (control.failRefresh) throw new Error('synthetic_refresh_error'); },
  });
  const E = (tag, attrs = {}, children) => {
    const node = { tag, attrs, children, value: '', disabled: false, textContent: '', click: () => attrs.click?.() };
    nodes.push(node); return node;
  };
  class FileReader {
    readAsText(file) { this.result = file.text; this.onload(); }
  }
  const panelModel = load('backup-panel', { backupModel: model, E, _: value => value, FileReader,
    ui: { showModal: (title, content) => { activeModal = { title, content }; modals.push(activeModal); },
      hideModal: () => { if (control.failHide) throw new Error('synthetic_hide_error'); activeModal = null; } },
    window: { setTimeout: callback => { if (control.failTimer) throw new Error('synthetic_timer_error'); timers.push(callback); },
      location: { reload: () => trace.push(['reload']) } },
    downloads: { textFile: () => assert.fail('import does not download an export') },
  });
  const controller = load('backup-controller').create({ model,
    sections: (config, type) => { if (control.failSnapshot) throw new Error('synthetic_snapshot_error');
      return current[config].filter(s => !type || s['.type'] === type); },
    persistence: { apply: (payload, previous) => {
      trace.push(['attempt']);
      const result = control.applyOverride ? control.applyOverride(payload, previous) : writer.apply(payload, previous);
      tasks.push(Promise.resolve(result).catch(() => {}));
      return monitor(result, errors);
    } },
    panel: panelModel, exportMode: () => 'plain',
    resetDraft: () => { trace.push(['resetDraft']); if (control.failReset) throw new Error('synthetic_reset_error'); discarded.push(true); },
    notify: (message, level) => { if (control.failNotify) throw new Error('synthetic_notify_error'); notices.push([message, level]); },
    notifyCentered: message => { if (control.failNotify) throw new Error('synthetic_notify_error'); notices.push([message, 'centered']); },
  });
  const payload = model.build(sourceSections(), false);
  payload.configs.sheepfold[0].options.note = 'after';
  payload.configs.wireless[0].options.ssid = 'После импорта';
  function open(file = payload) {
    controller.panel().importAll();
    const input = nodes.filter(n => n.attrs.type === 'file').at(-1);
    const text = JSON.stringify(file); input.files = [{ text, size: Buffer.byteLength(text) }]; input.attrs.change();
  }
  const button = label => nodes.filter(n => n.tag === 'button' && n.children === label).at(-1);
  async function click(node) {
    let thrown;
    try { await node.attrs.click(); } catch (error) { thrown = error; }
    await Promise.all(tasks);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(thrown, undefined, 'event handler must not throw');
    assert.deepEqual(errors, [], 'no rejected UI continuation may be discarded');
  }
  return { model, current, trace, nodes, notices, modals, discarded, errors, timers, control, open, button, click,
    modal: () => activeModal,
    status: () => {
      // Только реально показанный диалог: новый E('p') до ошибки preview
      // ещё не виден пользователю и не является доказательством сообщения.
      const content = (activeModal || modals.at(-1))?.content || [];
      return content.find(n => n?.tag === 'p' && n.attrs.class === 'sf-muted');
    },
  };
}

it('readable import previews without writes and waits for the explicit apply action', async () => {
  const f = fixture(); f.open(); assert.equal(f.modal().title, 'Import all settings and user list');
  assert.equal(f.trace.length, 0); assert.equal(f.current.sheepfold[0].note, 'before');
  await f.click(f.button('Import and apply'));
  assert.equal(f.current.sheepfold[0].note, 'after'); assert.equal(f.current.wireless[0].key, 'synthetic-wifi-secret');
  assert.equal(f.trace.filter(t => t[0] === 'save').length, 1); assert.equal(f.timers.length, 1);
  assert.ok(f.notices.some(n => n[0] === 'Settings imported successfully. The page will reload.'));
});
it('synchronous failure of the current snapshot releases the import button and permits a deliberate retry', async () => {
  const f = fixture(); f.open(); const button = f.button('Import and apply'); f.control.failSnapshot = true;
  await f.click(button); assert.equal(button.disabled, false); assert.equal(f.current.sheepfold[0].note, 'before');
  assert.equal(f.trace.filter(t => t[0] === 'save').length, 0); assert.notEqual(f.status().textContent, 'Applying backup...');
  f.control.failSnapshot = false; await f.click(button); assert.equal(f.current.sheepfold[0].note, 'after');
  assert.equal(f.trace.filter(t => t[0] === 'save').length, 1);
});
it('synchronous failure from the persistence entry point is handled without a frozen button', async () => {
  const f = fixture(); f.open(); f.control.applyOverride = () => { throw new Error('synthetic_persistence_error'); };
  await f.click(f.button('Import and apply')); assert.equal(f.button('Import and apply').disabled, false);
  assert.equal(f.current.sheepfold[0].note, 'before'); assert.equal(f.timers.length, 0);
});
it('a rejected persistence promise keeps the dialog usable without claiming successful import', async () => {
  const f = fixture(); f.open(); f.control.applyOverride = () => Promise.reject(new Error('synthetic_preflight_error'));
  await f.click(f.button('Import and apply')); assert.equal(f.button('Import and apply').disabled, false);
  assert.equal(f.timers.length, 0); assert.equal(f.discarded.length, 0); assert.equal(f.current.sheepfold[0].note, 'before');
});
it('failed apply confirmation plus failed rollback never claims the old settings were kept', async () => {
  const f = fixture({ failApply: true, failRevert: true }); f.open(); await f.click(f.button('Import and apply'));
  record('rollback', { savedNote: f.current.sheepfold[0].note, status: f.status().textContent,
    trace: f.trace, autoReloads: f.timers.length, resetDraftCalls: f.discarded.length });
  assert.equal(f.current.sheepfold[0].note, 'after', 'the simulated backend already changed state');
  assert.ok(f.trace.some(t => t[0] === 'revert'), 'real UCI adapter attempted cleanup');
  assert.doesNotMatch(f.status().textContent, /previous settings were kept/i);
  assert.match(f.status().textContent, /could not be confirmed/i);
  assert.match(f.status().textContent, /check|reload/i);
  assert.equal(f.timers.length, 0); assert.equal(f.discarded.length, 0);
});
for (const code of ['synthetic_network_error', 'uci_apply_failed', 'uci_confirm_failed']) {
  it(`unconfirmed ${code} does not promise automatic rollback`, async () => {
    const f = fixture(); f.open(); f.control.applyOverride = () => Promise.reject(new Error(code));
    await f.click(f.button('Import and apply'));
    assert.doesNotMatch(f.status().textContent, /previous settings were kept/i);
    assert.match(f.status().textContent, /check|reload/i); assert.equal(f.timers.length, 0);
  });
}
for (const point of ['failReset', 'failHide', 'failNotify', 'failTimer']) {
  it(`failure at ${point} after confirmed save stays distinct from failed import`, async () => {
    const f = fixture(); f.open(); f.control[point] = true; const button = f.button('Import and apply');
    await f.click(button); assert.equal(f.current.sheepfold[0].note, 'after');
    assert.equal(button.disabled, true, 'cannot repeat confirmed mutation from the failed feedback dialog');
    assert.match(f.status().textContent, /Settings were imported/);
    assert.ok(f.modal() || f.notices.some(n => /page could not be refreshed/.test(n[0])), 'feedback must remain visible');
    assert.doesNotMatch(f.status().textContent, /previous settings were kept|Could not import settings/);
    assert.equal(f.trace.filter(t => t[0] === 'save').length, 1);
  });
}
it('a service refresh failure remains a saved import with an explicit warning', async () => {
  const f = fixture({ failRefresh: true }); f.open(); await f.click(f.button('Import and apply'));
  assert.equal(f.current.sheepfold[0].note, 'after');
  assert.ok(f.notices.some(n => /services could not be refreshed/.test(n[0]))); assert.equal(f.timers.length, 1);
});
for (const result of [undefined, { persisted: false }, { persisted: 'true' }]) {
  it(`unconfirmed result ${JSON.stringify(result)} cannot emit success or clear the draft`, async () => {
    const f = fixture(); f.open(); f.control.applyOverride = () => Promise.resolve(result);
    await f.click(f.button('Import and apply')); assert.equal(f.discarded.length, 0); assert.equal(f.timers.length, 0);
    assert.ok(!f.notices.some(n => /successfully/.test(n[0]))); assert.match(f.status().textContent, /confirm|check/i);
  });
}
it('pending import ignores a second activation and submits only once', async () => {
  const f = fixture(); f.open(); let finish;
  const pending = new Promise(resolve => { finish = resolve; }); f.control.applyOverride = () => pending;
  const button = f.button('Import and apply'); const first = button.attrs.click(); const second = button.attrs.click();
  await Promise.resolve(); await Promise.resolve();
  finish({ persisted: true, servicesRefreshed: true }); await Promise.all([first, second]);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.trace.filter(t => t[0] === 'attempt').length, 1);
});
it('a malformed readable backup is rejected before confirmation and staging', () => {
  const f = fixture(); f.open({ format: 'invalid' }); assert.equal(f.modal(), null);
  assert.equal(f.trace.length, 0); assert.ok(f.notices.some(n => n[1] === 'warning'));
});
it('encrypted import uses real WebCrypto and never applies before confirmation', async () => {
  const f = fixture(), password = 'Synthetic password 123!';
  const envelope = await f.model.encrypt(f.model.build(sourceSections(), true), password); f.open(envelope);
  assert.equal(f.modal().title, 'Open encrypted backup');
  f.nodes.filter(n => n.attrs.type === 'password').at(-1).value = password;
  await f.click(f.button('Decrypt and check'));
  assert.equal(f.modal().title, 'Import all settings and user list'); assert.equal(f.trace.length, 0);
  await f.click(f.button('Import and apply')); assert.equal(f.trace.filter(t => t[0] === 'save').length, 1);
});
it('synchronous decrypt failure releases the button without an unhandled event exception', async () => {
  const f = fixture(); f.open({ format: f.model.encryptedFormat });
  f.model.decrypt = () => { throw new Error('synthetic_crypto_error'); };
  const button = f.button('Decrypt and check'); await f.click(button); assert.equal(button.disabled, false);
  assert.match(f.status().textContent, /Could not decrypt/); assert.equal(f.trace.length, 0);
});
it('wrong password leaves the decrypt button available for a successful retry', async () => {
  const f = fixture(), password = 'Synthetic password 123!';
  const envelope = await f.model.encrypt(f.model.build(sourceSections(), true), password); f.open(envelope);
  const input = f.nodes.filter(n => n.attrs.type === 'password').at(-1), button = f.button('Decrypt and check');
  input.value = 'wrong password'; await f.click(button); assert.equal(button.disabled, false);
  input.value = password; await f.click(button); assert.equal(f.modal().title, 'Import all settings and user list');
  assert.equal(f.trace.length, 0);
});
it('failed current-snapshot check after decryption is not misreported as a wrong password', async () => {
  const f = fixture(), password = 'Synthetic password 123!';
  const envelope = await f.model.encrypt(f.model.build(sourceSections(), true), password); f.open(envelope);
  f.nodes.filter(n => n.attrs.type === 'password').at(-1).value = password; f.control.failSnapshot = true;
  const button = f.button('Decrypt and check'); await f.click(button);
  assert.equal(button.disabled, false); assert.notEqual(f.status().textContent, 'Decrypting backup...');
  assert.doesNotMatch(f.status().textContent, /Check the password/); assert.equal(f.trace.length, 0);
});

it('decryption ignores a second activation while the same operation is pending', async () => {
  const f = fixture(); f.open({ format: f.model.encryptedFormat });
  let finish, attempts = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  f.model.decrypt = () => { attempts++; return pending; };
  const button = f.button('Decrypt and check');
  const first = button.attrs.click(), second = button.attrs.click();
  await Promise.resolve(); await Promise.resolve(); finish(f.model.build(sourceSections(), true));
  await Promise.all([first, second]); await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 1); assert.equal(f.trace.length, 0);
  assert.equal(f.modal().title, 'Import all settings and user list');
});
it('readable preview failure is handled before any mutation', () => {
  const f = fixture(); f.control.failSnapshot = true;
  assert.doesNotThrow(() => f.open()); assert.equal(f.trace.length, 0);
  assert.equal(f.modal(), null); assert.ok(f.notices.some(n => n[1] === 'warning'));
});

it('uncertain and saved outcomes have distinct Russian and Chinese translations', () => {
  const messages = [
    'The import result could not be confirmed. Reload the page and check the router settings before trying again.',
    'Settings were imported, but the page could not be refreshed. Reload this page before making more changes.',
  ];
  for (const language of ['ru', 'zh_Hans']) {
    const catalog = JSON.parse(readFileSync(resolve(resources, 'i18n', language + '.json'), 'utf8'));
    for (const message of messages) {
      assert.equal(typeof catalog[message], 'string'); assert.ok(catalog[message].length > 10);
      assert.notEqual(catalog[message], message);
    }
    assert.notEqual(catalog[messages[0]], catalog[messages[1]]);
  }
});


it('a changed queued snapshot reports that no backup was applied and asks for a fresh review', async () => {
  const f = fixture(); f.open();
  f.control.applyOverride = () => Promise.reject(new Error('backup_current_settings_changed'));
  await f.click(f.button('Import and apply'));
  assert.equal(f.current.sheepfold[0].note, 'before');
  assert.equal(f.trace.filter(t => t[0] === 'save').length, 0);
  assert.match(f.status().textContent, /settings changed.*No backup was applied.*Reload/i);
  assert.equal(f.timers.length, 0); assert.equal(f.discarded.length, 0);
});
