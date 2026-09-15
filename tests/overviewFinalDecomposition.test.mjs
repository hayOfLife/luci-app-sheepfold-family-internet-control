/* Загружает композицию LuCI в VM с явными моделями зависимостей, без роутера.
 * Проверяет подключения и контракты модулей; DOM-модель не доказывает отрисовку
 * браузера, сетевые операции или сохранение данных настоящим UCI. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const root = resolve(process.cwd());
const resources = join(root, 'package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources');
const overviewPath = join(resources, 'view/sheepfold/overview.js');
const securePath = join(resources, 'view/sheepfold/overview-secure.js');
const featureRoot = join(resources, 'sheepfold/features');
const applicationPath = join(featureRoot, 'overview/application.js');

const finalModules = [
  'overview/application.js',
  'overview/store.js',
  'overview/environment.js',
  'page/shell.js',
  'page/refresh.js',
  'devices/controller.js',
  'devices/quick-allowlist.js',
  'devices/type-control.js',
  'administrators/controller.js',
  'groups/controller.js',
  'groups/naming.js',
  'schedules/controller.js',
  'settings/controller.js',
  'settings/fields.js',
  'settings/misc.js',
  'settings/storage.js',
  'settings/ai.js',
  'settings/backup-controller.js',
  'wifi/controller.js',
  'emergency/panel.js',
];

function read(path) {
  return readFileSync(path, 'utf8');
}

function stripAiBlocks(source) {
  return source.replace(/\/\* SHEEPFOLD_AI_BEGIN \*\/[\s\S]*?\/\* SHEEPFOLD_AI_END \*\//g, '');
}

function domNode(tag = 'div', attrs = {}, children = []) {
  if (!Array.isArray(children)) children = [children];
  const node = {
    tag,
    attrs: attrs || {},
    children,
    childNodes: children,
    disabled: !!(attrs && attrs.disabled),
    hidden: !!(attrs && attrs.hidden),
    textContent: '',
    innerHTML: '',
    value: attrs && attrs.value != null ? attrs.value : '',
    checked: !!(attrs && attrs.checked),
    dataset: {},
    style: {},
    parentNode: null,
    firstChild: children[0] || null,
    className: attrs && attrs.class || '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute(name, value) { this.attrs[name] = value; },
    getAttribute(name) { return this.attrs[name] ?? null; },
    removeAttribute(name) { delete this.attrs[name]; },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    removeChild(child) { this.children = this.children.filter((item) => item !== child); },
    insertBefore(child) { this.children.push(child); child.parentNode = this; return child; },
    replaceChildren(...next) { this.children = next; this.childNodes = next; },
    replaceWith() {},
    click() {},
    dispatchEvent() {},
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    contains() { return false; },
  };
  for (const child of children) {
    if (child && typeof child === 'object') child.parentNode = node;
  }
  return node;
}

function originalModuleStubs() {
  const control = (value = '') => ({ input: domNode('input', { value }), node: domNode('label') });
  const draft = {
    reset() {}, has() { return false; }, get() { return ''; }, set() {}, setSection() {}, setMany() {},
    registerSaver() {}, dirtySavers() { return []; }, isDirty() { return false; }, snapshot() { return {}; },
    clearOptions() {}, acceptOptions() {}, setSaving() {}, isSaving() { return false; },
  };
  return {
    'sheepfold.i18n': {
      normalizeApplicationLanguage: (value) => value || 'ru',
      installApplicationTranslator: () => Promise.resolve('ru'),
    },
    'sheepfold.core.security.random': { pairingCode: () => '123456', urlToken: () => 'token' },
    'sheepfold.features.administrators.model': { nextId: () => '1', loginExists: () => false, fromSections: () => [] },
    'sheepfold.features.administrators.view': { render: () => domNode('div') },
    'sheepfold.features.devices.access-lists': { updatedValues: () => [], conflictingList: () => '' },
    'sheepfold.features.devices.inventory': {
      normalizeMac: (value) => String(value || '').toUpperCase(), listValues: (value) => Array.isArray(value) ? value : value ? [value] : [],
      generatedSectionName: (prefix) => prefix + '_fixture', reservedListSection: () => false, macInList: () => false, build: () => [],
    },
    'sheepfold.features.devices.selection': { create: () => ({ node: domNode('div'), selectedDevices: () => [], selectedIds: () => [] }) },
    'sheepfold.features.devices.table': { sortHeader: () => domNode('button'), filter() {}, stylesheet: () => domNode('link') },
    'sheepfold.features.devices.types': {
      definitions: () => [{ value: 'unknown', label: 'Unknown' }], byValue: (value) => ({ value: value || 'unknown', label: 'Unknown' }),
      displayedType: () => 'unknown', icon: () => domNode('span'),
    },
    'sheepfold.features.emergency.sites': {
      sectionType: 'emergency_site', fromSections: () => [], clone: (value) => JSON.parse(JSON.stringify(value || [])), same: () => true,
      stage: (_uci, _config, value) => value || [], normalizeDomain: (value) => String(value || ''),
    },
    'sheepfold.features.groups.model': {
      hash: () => 1, palette: () => ['#ffffff'], validColor: () => true, automaticColor: () => '#ffffff', nextColor: () => '#ffffff',
      membershipChanges: () => [], deletionBlockReason: () => '',
    },
    'sheepfold.features.integrations.panel': { render: () => domNode('div'), ipv6Field: () => domNode('div') },
    'sheepfold.features.logs.panel': { create: () => ({ setText() {}, render: () => domNode('div') }) },
    'sheepfold.features.messenger.settings': { settingsBox: () => domNode('div') },
    'sheepfold.features.pairing.qr': { render: () => domNode('div') },
    'sheepfold.features.router.info': { status: () => 'ready', load: () => Promise.resolve({}), panel: () => domNode('div'), infoValue: (value, fallback) => value || fallback || '-' },
    'sheepfold.features.router.maintenance': { updateRow: () => domNode('div'), rebootButton: () => domNode('button') },
    'sheepfold.features.schedules.model': { ranges: () => [], timeToMinutes: () => 0, windows: () => [], windowsOverlap: () => false },
    'sheepfold.features.settings.backup': {
      secretPlaceholder: '[secret]', build: () => ({ configs: { sheepfold: [], dhcp: [], wireless: [] } }),
      validate: (value) => value, prepareRestore: (value) => ({ payload: value, routerTransfer: false }), summary: () => ({ devices: 0, groups: 0, schedules: 0, administrators: 0, dhcpHosts: 0, wifiSections: 0 }),
      encrypt: async (value) => value, decrypt: async (value) => value,
    },
    'sheepfold.features.settings.draft': { create: () => draft, sameValues: () => true },
    'sheepfold.features.sites.status': { load: () => Promise.resolve({}), compactPanel: () => domNode('div'), panel: () => domNode('div') },
    'sheepfold.features.storage.panel': { create: () => ({ render: () => domNode('div') }) },
    'sheepfold.features.wifi.cards': { readNetworks: () => [], networkBox: () => domNode('div'), editorSnapshot: () => ({}), editorIsDirty: () => false },
    'sheepfold.features.wifi.payload': { build: () => '' },
    'sheepfold.shared.downloads': { textFile() {} },
    'sheepfold.shared.forms': { inputControl: control, selectControl: control, checkboxControl: () => ({ input: domNode('input'), node: domNode('label') }) },
  };
}

function createLoader({ rootPasswordSet = true } = {}) {
  const cache = new Map();
  const uciValues = new Map();
  const builtins = {
    ...originalModuleStubs(),
    baseclass: { extend: (value) => value },
    view: { extend: (value) => value },
    ui: {
      addNotification() {}, hideModal() {}, showModal() {},
      changes: { apply: () => Promise.resolve() },
    },
    uci: {
      get(config, section, option) { return uciValues.get(`${config}.${section}.${option}`) ?? null; },
      sections(_config, _type, callback) { if (typeof callback === 'function') return; return []; },
      load() { return Promise.resolve(); },
      save() { return Promise.resolve(); },
      apply() { return Promise.resolve(); },
      unload() {},
      set(config, section, option, value) { uciValues.set(`${config}.${section}.${option}`, value); },
      unset(config, section, option) { uciValues.delete(`${config}.${section}.${option}`); },
      remove() {},
      add(_config, _type, name) { return name || 'section'; },
    },
    fs: {
      exec(_path, args) {
        const values = Array.isArray(args) ? args : [];
        return Promise.resolve({
          code: 0,
          stdout: rootPasswordSet && values.includes('root-password-status') ? 'set\n' : '',
          stderr: '',
        });
      },
      read() { return Promise.resolve(''); },
      write() { return Promise.resolve(); },
      stat() { return Promise.resolve({}); },
      list() { return Promise.resolve([]); },
    },
    request: {
      get() { return Promise.resolve({ ok: true, status: 200, json: () => ({}) }); },
      post() { return Promise.resolve({ ok: true, status: 200, json: () => ({}) }); },
      request() { return Promise.resolve({ ok: true, status: 200, json: () => ({}) }); },
    },
    rpc: {
      declare() { return function () { return Promise.resolve({}); }; },
    },
  };

  function modulePath(name) {
    if (name.startsWith('sheepfold.'))
      return join(resources, 'sheepfold', ...name.slice('sheepfold.'.length).split('.')) + '.js';
    if (name.startsWith('view.'))
      return join(resources, 'view', ...name.slice('view.'.length).split('.')) + '.js';
    throw new Error(`Unknown LuCI module ${name}`);
  }

  function load(nameOrPath) {
    if (builtins[nameOrPath]) return builtins[nameOrPath];
    const path = nameOrPath.endsWith('.js') ? nameOrPath : modulePath(nameOrPath);
    if (cache.has(path)) return cache.get(path);

    const source = read(path);
    const requirements = [...source.matchAll(/'require\s+([^'\s]+)(?:\s+as\s+([^']+))?';/g)];
    const context = {
      console, Promise, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Math,
      URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval,
      Event: class Event {},
      E: domNode,
      _: (value) => String(value),
      L: {
        url: (value) => value,
        resource: (value) => value,
        resolveDefault: (promise, fallback) => Promise.resolve(promise).catch(() => fallback),
        bind: (fn, self, ...args) => fn.bind(self, ...args),
      },
      window: {
        location: {
          hostname: '192.168.1.1', host: '192.168.1.1', protocol: 'https:', search: '',
          reload() {},
        },
        setTimeout, clearTimeout, setInterval, clearInterval,
        confirm() { return true; },
        crypto: globalThis.crypto,
      },
      document: {
        body: { appendChild() {} },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        createElement() { return domNode('element'); },
        createElementNS() { return domNode('svg'); },
        addEventListener() {}, removeEventListener() {},
      },
      FileReader: function FileReader() {},
      TextEncoder, TextDecoder, Uint8Array,
      crypto: globalThis.crypto,
      Blob: function Blob() {},
      URL: class URL {
        static createObjectURL() { return ''; }
        static revokeObjectURL() {}
        constructor(value) { this.href = value; }
      },
      atob: (value) => Buffer.from(value, 'base64').toString('binary'),
      btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    };

    for (const requirement of requirements) {
      const dependency = requirement[1];
      const alias = requirement[2] || dependency.split('.').at(-1);
      context[alias] = builtins[dependency] || load(dependency);
    }

    const body = source.replace(/'require\s+[^']+';/g, '');
    const result = new vm.Script(`(function () { ${body}\n})()`, { filename: path }).runInNewContext(context);
    cache.set(path, result);
    return result;
  }

  return { load, cache };
}

describe('final overview.js decomposition §ovfinal1', () => {
  it('keeps overview.js as a tiny stable LuCI bootstrap', () => {
    const overview = read(overviewPath);
    const lines = overview.trimEnd().split(/\r?\n/);

    assert.ok(lines.length <= 4, `overview.js has ${lines.length} lines`);
    assert.ok(Buffer.byteLength(overview, 'utf8') < 256);
    assert.match(overview, /require sheepfold\.features\.overview\.application as overviewApplication/);
    assert.match(overview, /return overviewApplication\.create\(\)/);
    assert.doesNotMatch(overview, /return overviewApplication;/);
    assert.doesNotMatch(overview, /uci\.|ui\.|fs\.|function\s+|pageShellModel/);
  });

  it('keeps application.js as the bounded explicit composition root', () => {
    const application = read(applicationPath);
    const lines = application.trimEnd().split(/\r?\n/);

    assert.ok(lines.length < 700, `application.js has ${lines.length} lines`);
    assert.ok(Buffer.byteLength(application, 'utf8') < 30_000);
    assert.match(application, /var overviewView = pageShellModel\.create\(/);
    assert.match(application, /return baseclass\.extend\(/);
    assert.doesNotMatch(application, /return view\.extend\(/);
    assert.doesNotMatch(application, /\buci\.(?:set|unset|remove|add|save|apply)\s*\(/);
    assert.doesNotMatch(application, /\bui\.(?:showModal|hideModal|addNotification)\s*\(/);
    assert.doesNotMatch(application, /\bfs\.exec\s*\(/);
  });

  it('splits the former monolith into bounded focused owners', () => {
    for (const relative of finalModules) {
      const source = read(join(featureRoot, relative));
      const lines = source.split(/\r?\n/).length;
      assert.ok(lines < 700, `${relative} has ${lines} lines`);
    }

    const application = read(applicationPath);
    const shell = read(join(featureRoot, 'page/shell.js'));
    for (const alias of [
      'deviceControllerModel', 'administratorControllerModel', 'scheduleControllerModel',
      'groupControllerModel', 'settingsControllerModel', 'wifiControllerModel',
    ]) assert.match(application, new RegExp(`as ${alias}`));
    assert.match(shell, /this\.renderSettings\(\)/);
    assert.match(shell, /this\.renderAdmins\(true\)/);
  });

  it('loads and renders the complete LuCI module graph', async () => {
    const loader = createLoader({ rootPasswordSet: true });
    const overview = loader.load(overviewPath);

    for (const method of ['load', 'render', 'renderSettings', 'renderAdmins', 'renderDevices', 'renderSchedules', 'renderGroups'])
      assert.equal(typeof overview[method], 'function', `${method} must remain exposed`);

    await overview.load();
    const rendered = overview.render();
    assert.ok(rendered);
    assert.ok(loader.cache.size >= 45, `only ${loader.cache.size} local modules loaded`);
  });

  it('keeps overview-secure monkey patches effective through virtual dispatch', async () => {
    const loader = createLoader({ rootPasswordSet: true });
    const secure = loader.load(securePath);
    await secure.load();
    assert.ok(secure.render());

    const shell = read(join(featureRoot, 'page/shell.js'));
    assert.match(shell, /renderSettings: function \(\) \{ return deps\.settings\.render\(\); \}/);
    assert.match(shell, /this\.renderSettings\(\)/);
    assert.match(shell, /this\.renderAdmins\(true\)/);
  });

  it('preserves selected child tabs when the parent tab is reopened', () => {
    const shell = read(join(featureRoot, 'page/shell.js'));
    const navigation = read(join(featureRoot, 'navigation/state.js'));

    assert.match(shell, /deps\.navigation\.selectTop\(tab\)/);
    assert.doesNotMatch(shell, /selectSettings\('general'\)/);
    assert.doesNotMatch(shell, /selectUserList\('devices'\)/);
    assert.doesNotMatch(shell, /selectManagement\('schedules'\)/);
    assert.match(navigation, /activeSettingsTab/);
    assert.match(navigation, /activeUserListTab/);
    assert.match(navigation, /activeManagementTab/);
  });

  it('performs the global internet toggle on the router before updating the header', () => {
    const shell = read(join(featureRoot, 'page/shell.js'));
    const commandAt = shell.indexOf("args: [command]");
    const reloadAt = shell.indexOf("deps.reloadConfig(['sheepfold'])", commandAt);
    const uiAt = shell.indexOf('updateInternetButtons(document.querySelector', reloadAt);

    assert.ok(commandAt >= 0 && reloadAt > commandAt && uiAt > reloadAt);
    assert.match(shell, /data-sf-action-key': 'global-internet-toggle'/);
  });

  it('keeps the Standard variant syntactically valid after AI blocks are removed', () => {
    const paths = [
      applicationPath,
      join(featureRoot, 'settings/controller.js'),
      join(featureRoot, 'settings/ai.js'),
      join(featureRoot, 'devices/controller.js'),
      join(featureRoot, 'devices/persistence.js'),
      join(featureRoot, 'groups/persistence.js'),
      join(featureRoot, 'pairing/persistence.js'),
    ];

    for (const path of paths) {
      const stripped = stripAiBlocks(read(path));
      assert.doesNotThrow(() => new Function(stripped), path);
    }
    const strippedAi = stripAiBlocks(read(join(featureRoot, 'settings/ai.js')));
    assert.match(strippedAi, /render: function \(\) \{ return ''; \}/);
    assert.doesNotMatch(strippedAi, /DeepSeek|Gemini|Grok|ai_provider/);
  });
  it('ships the requested detailed file-by-file change rationale', () => {
    const path = join(root, 'docs/chatgpt-final-overview-refactoring.ru.md');
    const source = read(path);
    assert.ok(source.length > 30_000, `detailed document has only ${source.length} characters`);
    assert.match(source, /Почему изменён этот файл/);
    assert.match(source, /Почему выбран именно такой способ/);
    assert.match(source, /features\/overview\/application\.js/);
    assert.match(source, /view\/sheepfold\/overview\.js/);
  });

});
