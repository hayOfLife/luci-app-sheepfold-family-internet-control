/*
 * Исполняет существующие LuCI-модули export/persistence и реальный WebCrypto.
 * DOM и UCI — записывающие модели; конфиги, PIN и ключи синтетические.
 * Проверяет выдаваемые байты, восстановление [secret] и предел файла, не облако.
 */
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { it } from 'node:test';

const resources = resolve('package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/features/settings');
const limit = 5 * 1024 * 1024;
function load(name, deps = {}) {
  const text = readFileSync(resolve(process.env.SHEEPFOLD_BACKUP_SOURCE || resources, name + '.js'), 'utf8')
    .replace(/^'require .*?';\r?\n/gm, '');
  return vm.runInNewContext(`(function () { ${text} })()`, {
    baseclass: { extend: v => v }, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array,
    btoa: v => Buffer.from(v, 'binary').toString('base64'), atob: v => atob(v),
    Promise, Object, Array, String, Number, Date, JSON, Error, RegExp, ...deps,
  }, { filename: name + '.js' });
}
function sections() {
  return { sheepfold: [
    { '.name': 'global', '.type': 'sheepfold', router_install_id: 'a'.repeat(32) },
    { '.name': 'allowlist', '.type': 'list' }, { '.name': 'blocklist', '.type': 'list' },
    { '.name': 'owner', '.type': 'administrator', pairing_code: 'DO-NOT-EXPORT-QR', pairing_code_expires: '123' },
  ], dhcp: [], wireless: [{ '.name': 'wifi0', '.type': 'wifi-iface', ssid: 'Семья',
    key: 'synthetic-wifi-password', wps_pin: '48261937',
    r0kh: ['02:00:00:00:00:01,nas-test,' + 'ab'.repeat(32)],
    r1kh: ['02:00:00:00:00:02,02:00:00:00:00:03,' + 'cd'.repeat(32)],
  }] };
}
function wifi(payload) { return payload.configs.wireless[0].options; }
function panelHarness(model = load('backup'), supplied = sections(), options = {}) {
  const nodes = [], downloads = [], notices = [], modals = [];
  const E = (tag, attrs = {}, children) => {
    const node = { tag, attrs, children, value: '', disabled: false, textContent: '',
      click() { return attrs.click?.(); } };
    nodes.push(node); return node;
  };
  const view = load('backup-panel', { backupModel: model, E, _: s => s,
    ui: { showModal: (...args) => modals.push(args), hideModal: () => {} },
    downloads: { textFile: (name, text) => {
      if (options.failDownload) throw new Error('synthetic_download_failure');
      downloads.push({ name, text });
    } },
  });
  let mode = 'plain';
  const panel = view.create({ payload: includeSecrets => model.build(supplied, includeSecrets),
    exportMode: () => mode, notify: (...args) => notices.push(args) });
  return { panel, nodes, downloads, notices, modals,
    encrypted() { mode = 'encrypted'; panel.exportAll();
      for (const node of nodes.filter(n => n.tag === 'input')) node.value = 'Synthetic password 123!';
      return nodes.find(n => n.children === 'Create encrypted backup');
    },
  };
}
for (const option of ['wps_pin', 'r0kh', 'r1kh']) {
  it(`readable export masks ${option} in the downloaded JSON`, () => {
    const source = sections(), f = panelHarness(load('backup'), source);
    f.panel.exportAll(); assert.equal(f.downloads.length, 1);
    const text = f.downloads[0].text, decoded = JSON.parse(text);
    assert.equal(wifi(decoded)[option], '[secret]');
    for (const value of [source.wireless[0][option]].flat()) assert.ok(!text.includes(value));
    assert.equal(wifi(decoded).ssid, 'Семья');
    assert.equal(source.wireless[0].wps_pin, '48261937', 'source object not rewritten');
  });
  it(`readable import rejects a literal unencrypted ${option}`, () => {
    const model = load('backup'), input = model.build(sections(), false);
    wifi(input)[option] = sections().wireless[0][option];
    assert.throws(() => model.validate(input), /unencrypted_secrets_forbidden/);
  });
  it(`readable restore preserves the existing ${option}, not the marker`, async () => {
    const model = load('backup'), current = sections(), input = model.build(sections(), false), calls = [];
    wifi(input)[option] = '[secret]';
    const writer = load('backup-persistence').create({ model,
      persistence: { sections: c => current[c], ensureSection: (_c, _t, n) => n,
        mutate: async (_c, stage) => ({ stageResult: stage() }) },
      uci: { remove() {}, unset() {}, set: (...args) => calls.push(args) }, refreshRuntime: async () => {},
    });
    await writer.apply(input, model.build(current, true));
    const saved = calls.find(c => c[0] === 'wireless' && c[2] === option);
    assert.ok(saved); assert.deepEqual(JSON.parse(JSON.stringify(saved[3])), current.wireless[0][option]);
  });
  it(`readable restore leaves missing ${option} unset`, async () => {
    const model = load('backup'), current = sections(), input = model.build(sections(), false), calls = [];
    wifi(input)[option] = '[secret]'; delete current.wireless[0][option];
    const writer = load('backup-persistence').create({ model,
      persistence: { sections: c => current[c], ensureSection: (_c, _t, n) => n,
        mutate: async (_c, stage) => ({ stageResult: stage() }) },
      uci: { remove() {}, unset() {}, set: (...args) => calls.push(args) }, refreshRuntime: async () => {},
    });
    await writer.apply(input, model.build(current, true));
    assert.equal(calls.some(c => c[0] === 'wireless' && c[2] === option), false);
  });
}
it('real encrypted backup retains Wi-Fi credentials and excludes the one-time pairing code', async () => {
  const model = load('backup'), payload = model.build(sections(), true);
  const envelope = await model.encrypt(payload, 'Synthetic password 123!');
  const text = JSON.stringify(envelope), restored = await model.decrypt(envelope, 'Synthetic password 123!');
  for (const option of ['wps_pin', 'r0kh', 'r1kh']) {
    assert.deepEqual(JSON.parse(JSON.stringify(wifi(restored)[option])), sections().wireless[0][option]);
    for (const value of [sections().wireless[0][option]].flat()) assert.ok(!text.includes(value));
  }
  assert.equal(restored.configs.sheepfold.find(s => s.name === 'owner').options.pairing_code, undefined);
  await assert.rejects(model.decrypt(envelope, 'wrong password'));
});
it('noncredential names containing pin or r0kh are not over-masked', () => {
  const model = load('backup'), data = sections();
  Object.assign(data.wireless[0], { pinning_enabled: '1', r0kh_description: 'test', wps_pushbutton: '1' });
  const values = wifi(model.build(data, false));
  assert.equal(values.pinning_enabled, '1'); assert.equal(values.r0kh_description, 'test'); assert.equal(values.wps_pushbutton, '1');
});
it('readable export refuses a file that its own importer would reject by byte size', () => {
  const model = load('backup'), data = sections();
  for (let i = 0; i < 24; i++) data.sheepfold[0]['note_' + i] = 'я'.repeat(110000);
  const raw = JSON.stringify(model.build(data, false), null, 2) + '\n';
  assert.ok(raw.length < limit); assert.ok(Buffer.byteLength(raw) > limit, 'character count is insufficient');
  const f = panelHarness(model, data); f.panel.exportAll();
  assert.equal(f.downloads.length, 0); assert.ok(f.notices.some(n => n[1] === 'warning'));
  assert.ok(!f.notices.some(n => n[0] === 'Settings export saved.'));
});
it('file serializer accepts exactly the limit and rejects the next byte', () => {
  const model = load('backup');
  const emptyBytes = Buffer.byteLength(JSON.stringify({ note: '' }, null, 2) + '\n');
  const text = model.fileText({ note: 'x'.repeat(limit - emptyBytes) });
  assert.equal(Buffer.byteLength(text), limit);
  assert.throws(() => model.fileText({ note: 'x'.repeat(limit - emptyBytes + 1) }), /backup_file_too_large/);
});
it('encrypted export checks the final envelope including base64 overhead', async () => {
  const model = load('backup'), data = sections();
  for (let i = 0; i < 32; i++) data.sheepfold[0]['note_' + i] = 'x'.repeat(125000);
  assert.ok(Buffer.byteLength(JSON.stringify(model.build(data, true))) < limit);
  const f = panelHarness(model, data), button = f.encrypted();
  await button.click();
  assert.equal(f.downloads.length, 0); assert.equal(button.disabled, false);
  assert.ok(button.disabled === false && f.nodes.some(n => n.textContent === 'The backup file is too large.'));
});
it('readable export reports a synchronous model failure without claiming success', () => {
  const model = { ...load('backup'), build: () => { throw new Error('invalid_section_identifier'); } };
  const f = panelHarness(model);
  assert.doesNotThrow(() => f.panel.exportAll());
  assert.equal(f.downloads.length, 0); assert.ok(f.notices.some(n => n[1] === 'warning'));
});
for (const failure of ['payload', 'encrypt']) it(`encrypted export recovers the button after a synchronous ${failure} failure`, async () => {
  const real = load('backup'), model = { ...real };
  if (failure === 'payload') model.build = () => { throw new Error('invalid_section_identifier'); };
  else model.encrypt = () => { throw new Error('invalid_config_sections'); };
  const f = panelHarness(model), button = f.encrypted();
  let result; assert.doesNotThrow(() => { result = button.click(); }); await result;
  assert.equal(button.disabled, false); assert.equal(f.downloads.length, 0);
  assert.ok(f.nodes.some(n => n.textContent && n.textContent !== 'Encrypting backup...'));
});
it('normal encrypted UI export produces a file accepted by the same decryptor', async () => {
  const model = load('backup'), f = panelHarness(model), button = f.encrypted();
  await button.click();
  assert.equal(f.downloads.length, 1); assert.ok(Buffer.byteLength(f.downloads[0].text) < limit);
  const payload = await model.decrypt(JSON.parse(f.downloads[0].text), 'Synthetic password 123!');
  assert.equal(wifi(payload).wps_pin, '48261937');
});

it('encrypted export handles a rejected encryption promise and permits retry', async () => {
  const real = load('backup'), model = { ...real, encrypt: () => Promise.reject(new Error('synthetic_crypto_failure')) };
  const f = panelHarness(model), button = f.encrypted();
  await button.click(); assert.equal(button.disabled, false); assert.equal(f.downloads.length, 0);
  model.encrypt = real.encrypt;
  await button.click(); assert.equal(f.downloads.length, 1);
  const payload = await real.decrypt(JSON.parse(f.downloads[0].text), 'Synthetic password 123!');
  assert.equal(wifi(payload).wps_pin, '48261937');
});
for (const mode of ['readable', 'encrypted']) it(`${mode} export does not claim success when file preparation throws`, async () => {
  const model = load('backup'), f = panelHarness(model, sections(), { failDownload: true });
  if (mode === 'encrypted') {
    const button = f.encrypted(); await button.click(); assert.equal(button.disabled, false);
    assert.ok(f.nodes.some(n => n.textContent === 'Could not create the backup file. Please try again.'));
  } else { f.panel.exportAll(); assert.ok(f.notices.some(n => n[1] === 'warning')); }
  assert.equal(f.downloads.length, 0);
  assert.ok(!f.notices.some(n => n[1] === 'info'));
});
