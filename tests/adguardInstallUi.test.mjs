/* Проверяет согласие, draft и polling установщика в LuCI-модели без реального роутера */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { it } from 'node:test';

const source = readFileSync(new URL('../package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/features/integrations/install.js', import.meta.url), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness(states) {
  let modal;
  let dirty = false;
  const calls = [];
  const timers = new Map();
  const responses = states || ['status=ready', 'status=starting', 'status=ready', 'status=installed_filters_pending'];
  const E = (tag, attrs = {}, children = []) => ({ tag, ...attrs, children, isConnected: true,
    addEventListener(name, callback) { this[name] = callback; } });
  const model = vm.runInNewContext(`(function () { ${source} })()`, {
    baseclass: { extend: (value) => value }, E, _: (text) => text,
    ui: { showModal: (_title, content) => { modal = content; }, hideModal: () => { modal = null; } },
    window: { setTimeout: (callback) => { const id = timers.size + 1; timers.set(id, callback); return id; }, clearTimeout: (id) => timers.delete(id) },
  });
  const actionSource = readFileSync(new URL('../package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/core/backend/actions.js', import.meta.url), 'utf8');
  const actions = vm.runInNewContext(`(function () { ${actionSource} })()`, {
    baseclass: { extend: (value) => value },
  }).create({ run: async (args) => { calls.push([...args]); return { code: 0, stdout: responses.shift() }; } });
  const root = model.render({ icon: () => E('svg'), isDirty: () => dirty, run: actions.run });
  return { root, calls, timers, modal: () => modal, dirty: () => { dirty = true; },
    tick: () => { const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); } };
}

it('shows the warning and starts only after a second explicit confirmation', async () => {
  const h = harness();
  await flush();
  h.root.children[0].click();
  assert.equal(h.calls.length, 1);
  assert.match(JSON.stringify(h.modal()), /Password: password/);
  const start = h.modal().at(-1).children[2];
  start.click();
  start.click();
  await flush();
  assert.deepEqual(h.calls.at(-1), ['adguard-install-start', 'confirmed']);
  assert.equal(h.calls.length, 2);
  assert.equal(start.disabled, true);
  h.tick();
  await flush();
  assert.equal(h.root.children[0].disabled, true);
  assert.equal(h.timers.size, 1);
  h.tick();
  await flush();
  assert.match(h.root.children[1].textContent, /Filter downloads/);
  assert.equal(h.timers.size, 0);
});

it('does not install while settings have an unsaved draft', async () => {
  const h = harness();
  await flush();
  h.dirty();
  h.root.children[0].click();
  assert.equal(h.modal(), undefined);
  assert.equal(h.calls.length, 1);
  assert.match(h.root.children[1].textContent, /Save or discard/);
});

it('stops polling when the dialog closes without cancelling the router worker', async () => {
  const h = harness();
  await flush();
  h.root.children[0].click();
  h.modal().at(-1).children[2].click();
  await flush();
  h.modal().at(-1).children[0].click();
  assert.equal(h.timers.size, 0);
  assert.equal(h.calls.length, 2);
});

it('shows the failed operation and backup through the real action adapter', async () => {
  const h = harness(['status=failed\nbackup=/etc/sheepfold/adguard-install\nreason=package_failed']);
  await flush();
  assert.match(h.root.children[1].textContent, /stopped before switching DNS/);
  assert.match(h.root.children[1].textContent, /\/etc\/sheepfold\/adguard-install/);
  assert.equal(h.root.children[0].disabled, true);
});
