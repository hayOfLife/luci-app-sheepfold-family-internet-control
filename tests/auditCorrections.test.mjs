/* Проверяет связи модулей и точные структурные инварианты прежнего аудита.
 * Читает исходники без изменения состояния; наличие функции не доказывает её
 * runtime-поведение, которое отдельно проверяется профильными VM-тестами. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = resolve('package/luci-app-sheepfold-family-internet-control');
const read = (relative) => readFileSync(resolve(root, relative), 'utf8');

describe('post-audit corrections §ovaudit1', () => {
  it('ships the loader and save-flow modules that the first finalization omitted', () => {
    const application = read('htdocs/luci-static/resources/sheepfold/features/overview/application.js');
    const settings = read('htdocs/luci-static/resources/sheepfold/features/settings/controller.js');
    assert.match(application, /features\.page\.refresh as pageRefreshModel/);
    assert.match(settings, /features\.settings\.save-flow as settingsSaveFlowModel/);
    assert.match(read('htdocs/luci-static/resources/sheepfold/features/page/refresh.js'), /function userLists\(\)/);
    assert.match(read('htdocs/luci-static/resources/sheepfold/features/settings/save-flow.js'), /function executeSave\(options, savers\)/);
  });

  it('removes an existing DHCP host when a static lease is disabled', () => {
    const persistence = read('htdocs/luci-static/resources/sheepfold/features/devices/persistence.js');
    const controller = read('htdocs/luci-static/resources/sheepfold/features/devices/controller.js');
    assert.match(persistence, /oldStaticSection[\s\S]*else if \(oldStaticSection\)[\s\S]*deps\.uci\.remove\('dhcp', oldStaticSection\)/);
    assert.match(controller, /device\.staticSection = result\.staticSectionName \|\| ''/);
  });

  it('uses status and sorted MACs in a device-batch action key and reports partial progress', () => {
    const controller = read('htdocs/luci-static/resources/sheepfold/features/devices/controller.js');
    assert.match(controller, /keyMacs = normalized\.map[\s\S]*\.sort\(\)/);
    assert.match(controller, /'device-list-batch:' \+ targetStatus \+ ':' \+ keyMacs\.join\(','\)/);
    assert.match(controller, /completedCount/);
    assert.match(controller, /refreshFailed/);
  });

  it('keeps committed administrator state and labels a failed LuCI refresh honestly', () => {
    const controller = read('htdocs/luci-static/resources/sheepfold/features/administrators/controller.js');
    const persistence = read('htdocs/luci-static/resources/sheepfold/features/pairing/persistence.js');
    assert.match(controller, /function persistedMutationFailure/);
    assert.match(controller, /if \(!error \|\| !error\.persisted\)/);
    assert.match(controller, /The saved administrator state could not be refreshed in LuCI/);
    assert.match(controller, /if \(!error\.persisted\) admin\.deviceIds = previousIds/);
    assert.match(persistence, /devicePersistence\.saveAccess/);
    assert.match(persistence, /stageBindings/);
  });

  it('emits only fixed safe action metadata while preserving raw output separately', () => {
    const wrapper = read('root/usr/libexec/sheepfold/sheepfold-luci-action');
    assert.match(wrapper, /case "\$error_code" in/);
    assert.match(wrapper, /\*\) message='The router action failed\.' ;;/);
    assert.doesNotMatch(wrapper, /actionMessage=.*\$combined/);
    assert.match(wrapper, /cat "\$out_file"/);
    assert.match(wrapper, /cat "\$err_file" >&2/);
  });

  it('runs schedule-sync once when two settings require the same runtime refresh', () => {
    const effects = read('htdocs/luci-static/resources/sheepfold/features/settings/side-effects.js');
    assert.match(effects, /needsScheduleSync = hasOwn\(options, 'schedule_conflict_internet'\) \|\| hasOwn\(options, 'new_device_policy'\)/);
    assert.equal((effects.match(/checkedRun\(\['schedule-sync'\]/g) || []).length, 1);
  });
});
