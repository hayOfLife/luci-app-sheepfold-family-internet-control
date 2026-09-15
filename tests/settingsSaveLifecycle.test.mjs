/* §persist1 §ovfinal1
 * Настоящие draft/save-flow и управляемые Promise-барьеры проверяют сохранность
 * позднего ввода и завершение busy-состояния. Persistence/runtime/UI — модели;
 * меняется только память процесса. Успех не доказывает RPC, откат UCI, поведение
 * special savers, reload страницы или настоящий браузер. Все реквизиты синтетические.
 */
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { it } from 'node:test';
import vm from 'node:vm';

const directory = resolve('package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/features/settings');
const clone = value => JSON.parse(JSON.stringify(value));
function load(name) {
  const filename = resolve(process.env.SHEEPFOLD_SETTINGS_LIFECYCLE_SOURCE || directory, name + '.js');
  const source = readFileSync(filename, 'utf8').replace(/^'require .*?';\r?\n/gm, '');
  return vm.runInNewContext(`(function () { ${source} })()`, {
    baseclass: { extend: value => value }, Promise, Object, Array, String, Number, Boolean,
    Math, Date, JSON, Error, RegExp, _: text => text,
  }, { filename });
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function record(name, value) {
  const dir = process.env.SHEEPFOLD_SETTINGS_LIFECYCLE_EVIDENCE;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, name + '.json'), JSON.stringify(value, null, 2) + '\n');
}
function fixture() {
  const trace = [], packets = [], notifications = [];
  const control = {};
  const draft = load('draft').create(() => {
    trace.push(['change', draft.isSaving()]);
    if (control.onChange) control.onChange();
  });
  const flow = load('save-flow').create({
    draft,
    persistence: {
      validate(options) { trace.push(['validate', clone(options)]); if (control.validate) return control.validate(options); },
      save(options) {
        packets.push(clone(options)); trace.push(['save', clone(options)]);
        return control.save ? control.save(options) : Promise.resolve();
      },
    },
    applyRuntime(options) { trace.push(['runtime', clone(options)]); return control.runtime ? control.runtime(options) : Promise.resolve(); },
    applyPostSave(options) { trace.push(['post', clone(options)]); return control.post ? control.post(options) : Promise.resolve(); },
    value: (key, fallback) => control.values?.[key] ?? fallback,
    updateButtons() { trace.push(['buttons', draft.isSaving()]); if (control.buttons) control.buttons(); },
    notify(message, level) { notifications.push([message, level]); if (control.notify) control.notify(message, level); },
    notifyCentered(message) { notifications.push([message, 'success']); },
    errorText: error => error.message,
    confirmWifiAutoDisable(time) { trace.push(['confirm', time]); return control.confirm ? control.confirm(time) : Promise.resolve(true); },
  });
  return { draft, flow, control, trace, packets, notifications };
}

it('normal save acknowledges only its options and runs runtime exactly once', async () => {
  const f = fixture(); f.draft.set('note', 'submitted');
  const result = await f.flow.save();
  assert.equal(result.persisted, true); assert.equal(f.draft.isDirty(), false);
  assert.deepEqual(f.packets, [{ note: 'submitted' }]);
  assert.equal(f.trace.filter(t => t[0] === 'runtime').length, 1);
  assert.equal(f.draft.isSaving(), false); assert.equal(f.flow.isSaving(), false);
});
for (const point of ['save', 'runtime', 'post']) {
  for (const edit of ['new-option', 'changed-option', 'changed-back']) {
    it(`retains ${edit} entered while ${point} is pending after successful save`, async () => {
      const f = fixture(), entered = deferred(), release = deferred();
      f.draft.set('note', 'submitted');
      f.control[point] = () => { entered.resolve(); return release.promise; };
      const running = f.flow.save(); await entered.promise;
      if (edit === 'new-option') f.draft.set('extra', 'later');
      else if (edit === 'changed-option') f.draft.set('note', 'later');
      else f.draft.set('note', 'original');
      release.resolve(); const result = await running;
      record(`later-${point}-${edit}`, { packets: f.packets, remaining: f.draft.snapshot(), trace: f.trace, result });
      assert.equal(result.persisted, true);
      assert.deepEqual(f.packets, [{ note: 'submitted' }]);
      const expected = edit === 'new-option' ? { extra: 'later' } : { note: edit === 'changed-option' ? 'later' : 'original' };
      assert.deepEqual(clone(f.draft.snapshot()), expected);
      assert.equal(f.draft.isDirty(), true); assert.equal(f.draft.isSaving(), false);
      f.control[point] = null;
      await f.flow.save();
      assert.deepEqual(f.packets[1], expected); assert.equal(f.draft.isDirty(), false);
    });
  }
}
for (const point of ['runtime', 'post']) {
  it(`keeps later edits after ${point} rejects after confirmed settings save`, async () => {
    const f = fixture(), entered = deferred(), release = deferred(), failure = new Error('synthetic_runtime_failure');
    f.draft.set('note', 'submitted');
    f.control[point] = () => { entered.resolve(); return release.promise; };
    const outcome = f.flow.save().then(value => ({ value }), error => ({ error }));
    await entered.promise;
    f.draft.setMany({ note: 'later', extra: 'later-too' });
    release.reject(failure); const result = await outcome;
    record(`failed-${point}`, { packets: f.packets, remaining: f.draft.snapshot(), error: result.error?.message, trace: f.trace });
    assert.equal(result.error, failure); assert.equal(failure.persisted, true);
    assert.deepEqual(clone(f.draft.snapshot()), { note: 'later', extra: 'later-too' });
    assert.equal(f.draft.isSaving(), false);
  });
}
it('special-only failure cannot erase general options entered while the special saver waits', async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  const failure = Object.assign(new Error('special_runtime_failure'), { persisted: true });
  let accepted = 0;
  f.draft.registerSaver({ isChanged: () => accepted === 0,
    save: () => { entered.resolve(); return release.promise; }, accept: () => { accepted++; } });
  const outcome = f.flow.save().catch(error => error); await entered.promise;
  f.draft.set('extra', 'not-submitted'); release.reject(failure);
  assert.equal(await outcome, failure); assert.equal(accepted, 1);
  assert.deepEqual(clone(f.draft.snapshot()), { extra: 'not-submitted' });
  assert.equal(f.packets.length, 0);
});
it('failed general save preserves its own options as well as later edits', async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  f.draft.set('note', 'submitted');
  f.control.save = () => { entered.resolve(); return release.promise; };
  const outcome = f.flow.save().catch(error => error); await entered.promise;
  f.draft.set('extra', 'later'); release.reject(new Error('save_failure')); await outcome;
  assert.deepEqual(clone(f.draft.snapshot()), { note: 'submitted', extra: 'later' });
  assert.equal(f.trace.some(t => t[0] === 'runtime'), false); assert.equal(f.draft.isSaving(), false);
});
it('equal repeated value needs no second save after the submitted value is confirmed', async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  f.draft.set('note', 'submitted');
  f.control.save = () => { entered.resolve(); return release.promise; };
  const running = f.flow.save(); await entered.promise; f.draft.set('note', 'submitted'); release.resolve();
  await running; assert.equal(f.draft.isDirty(), false);
});
it('synchronous persistence exception releases draft and flow guards and permits explicit retry', async () => {
  const f = fixture(), failure = new Error('synthetic_sync_save');
  f.draft.set('note', 'submitted'); f.control.save = () => { throw failure; };
  assert.equal(await f.flow.save().catch(error => error), failure);
  record('sync-save', { packets: f.packets, trace: f.trace, saving: f.draft.isSaving(), flowSaving: f.flow.isSaving(), remaining: f.draft.snapshot() });
  assert.equal(f.draft.isSaving(), false); assert.equal(f.flow.isSaving(), false);
  assert.deepEqual(clone(f.draft.snapshot()), { note: 'submitted' });
  f.control.save = null; await f.flow.save(); assert.equal(f.draft.isDirty(), false);
});
for (const point of ['buttons', 'onChange']) {
  it(`synchronous ${point} failure on busy entry does not leave Save disabled`, async () => {
    const f = fixture(), failure = new Error('synthetic_' + point);
    f.draft.set('note', 'submitted');
    f.control[point] = () => { if (f.draft.isSaving()) throw failure; };
    const error = await f.flow.save().catch(value => value);
    assert.equal(error, failure); assert.equal(f.draft.isSaving(), false); assert.equal(f.flow.isSaving(), false);
    assert.equal(f.packets.length, 0); f.control[point] = null;
    await f.flow.save(); assert.equal(f.packets.length, 1);
  });
}
it('overlapping Save clicks share one operation and do not submit twice', async () => {
  const f = fixture(), entered = deferred(), release = deferred(); f.draft.set('note', 'submitted');
  f.control.save = () => { entered.resolve(); return release.promise; };
  const first = f.flow.save(), second = f.flow.save(); assert.equal(first, second);
  await entered.promise; assert.equal(f.packets.length, 1); release.resolve(); await first;
});
it('validation failure does not enter saving or call persistence', async () => {
  const f = fixture(); f.draft.set('note', 'submitted');
  f.control.validate = () => { throw new Error('synthetic_validation'); };
  await assert.rejects(f.flow.save(), /synthetic_validation/);
  assert.equal(f.packets.length, 0); assert.equal(f.draft.isSaving(), false);
});
it('no changes and cancelled confirmation are not successful writes', async () => {
  const f = fixture(); assert.equal((await f.flow.save()).changed, false);
  f.draft.setMany({ wifi_auto_disable_mode: 'time', wifi_auto_disable_time: '23:00' });
  f.control.confirm = () => Promise.resolve(false);
  assert.equal((await f.flow.save()).cancelled, true);
  assert.equal(f.packets.length, 0); assert.equal(f.draft.isDirty(), true);
});
it('confirmation authorizes the captured time, not a later time entered while the dialog waits', async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  f.draft.setMany({ wifi_auto_disable_mode: 'time', wifi_auto_disable_time: '23:00' });
  f.control.confirm = time => { entered.resolve(time); return release.promise; };
  const running = f.flow.save(); assert.equal(await entered.promise, '23:00');
  f.draft.setMany({ wifi_auto_disable_time: '20:00', note: 'later' });
  release.resolve(true); await running;
  record('confirmation', { packets: f.packets, remaining: f.draft.snapshot(), trace: f.trace });
  assert.deepEqual(f.packets, [{ wifi_auto_disable_mode: 'time', wifi_auto_disable_time: '23:00' }]);
  assert.deepEqual(clone(f.draft.snapshot()), { wifi_auto_disable_time: '20:00', note: 'later' });
});
it('synchronous confirmation exception makes no write and can be retried', async () => {
  const f = fixture(); f.draft.setMany({ wifi_auto_disable_mode: 'time', wifi_auto_disable_time: '23:00' });
  f.control.confirm = () => { throw new Error('synthetic_confirmation'); };
  await assert.rejects(f.flow.save(), /synthetic_confirmation/);
  assert.equal(f.draft.isSaving(), false); assert.equal(f.flow.isSaving(), false); assert.equal(f.packets.length, 0);
  f.control.confirm = null; await f.flow.save(); assert.equal(f.packets.length, 1);
});
