/* §country1 §persist1
 * Real time-control and lock/restore files, narrow UCI model. No real clock,
 * router or network mutations. Every injected failure records a reached marker.
 * Fixture files are removed afterwards; passing does not prove live NTP sync.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, chmodSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { it } from 'node:test';
import vm from 'node:vm';
import { shellTestPath } from '../tools/quality/testEnvironment.mjs';
import { prepareFixtureFlock, completedProcess, runtimeTimeout } from './helpers/runtimeProcess.mjs';

const repo = process.cwd();
const native = process.platform !== 'win32';
const python = (process.env.PYTHON_EXECUTABLE || (native ? 'python3' : 'python')).replaceAll('\\', '/');
const lib = resolve('package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold');
const quote = value => `'${value.replace(/'/g, "'\\''")}'`;
const values = data => Object.fromEntries(data.trim().split('\n').filter(Boolean).map(line => { const p = line.indexOf('='); return [line.slice(0, p), line.slice(p + 1)]; }));
const encode = data => Object.entries(data).map(([k, v]) => k + '=' + v).join('\n') + '\n';
const system = {
  'system.@system[0]': 'system', 'system.@system[0].zonename': 'UTC', 'system.@system[0].timezone': 'UTC0',
  'system.ntp': 'timeserver', 'system.ntp.server': 'old.example.test second-old.example.test',
  'system.ntp.enabled': '1', 'system.ntp.enable_server': '0', 'system.ntp.custom': 'keep-this-option',
};
const app = { 'sheepfold.global': 'sheepfold', 'sheepfold.global.country_profile': 'ru', 'sheepfold.global.note': 'untouched' };
const input = ['save', '1', '0', 'Europe/Minsk', '+03-3', 'new1.example.test new2.example.test', 'by'];
const expected = {
  'system.@system[0]': 'system', 'system.@system[0].zonename': 'Europe/Minsk', 'system.@system[0].timezone': '+03-3',
  'system.ntp': 'timeserver', 'system.ntp.server': 'new1.example.test new2.example.test', 'system.ntp.enabled': '0', 'system.ntp.enable_server': '1',
  'sheepfold.global': 'sheepfold', 'sheepfold.global.router_ntp_server_enabled': '1',
  'sheepfold.global.router_ntp_client_auto_configure': '0', 'sheepfold.global.router_timezone_name': 'Europe/Minsk',
  'sheepfold.global.router_timezone': '+03-3', 'sheepfold.global.router_ntp_servers': 'new1.example.test new2.example.test',
  'sheepfold.global.router_time_configured': '1', 'sheepfold.global.router_time_country_profile': 'by',
  'sheepfold.global.router_time_configured_at': '1789430400',
};

// The native config files are synthetic key=value files, not real UCI syntax.
// Each invocation loads file + private delta. Commit modifies the SAME files
// that the real helper snapshots/restores; faults happen at named boundaries.
const model = String.raw`import json, os, sys
from pathlib import Path
args=sys.argv[1:]; savedir=None
while args and args[0].startswith('-'):
    a=args.pop(0)
    if a in ('-t','-p'):
        p=args.pop(0)
        if a=='-t': savedir=Path(p)
    elif a!='-q': raise SystemExit(2)
cmd=args.pop(0); key=args[0] if args else ''; cfg=key.split('.')[0]
root=Path(os.environ['TIME_CASE']); file=root/cfg; delta=savedir/(cfg+'.json') if savedir else None
trace=root/'trace'
def log(s):
    with trace.open('a') as h: h.write(s+'\n')
def load(p):
    if not p.exists(): return {}
    return dict(line.split('=',1) for line in p.read_text().splitlines() if '=' in line)
def write(p,d):
    p.write_text(''.join(k+'='+v+'\n' for k,v in d.items()), newline='\n')
d=load(file); changes=json.loads(delta.read_text()) if delta and delta.exists() else {}
view={**d, **changes}; view={k:v for k,v in view.items() if v is not None}
log('uci '+cmd+' '+('private ' if savedir else 'public ')+key)
if cmd=='get':
    if key in view:
        print(view[key])
    if (root/'both-committed').exists() and not savedir and key==os.environ.get('TIME_READ_ERROR'):
        log('fault read-error '+key); raise SystemExit(1)
    raise SystemExit(0 if key in view else 1)
if cmd in ('set','add_list','delete','add'):
    if cmd=='delete' and key=='system.ntp.server' and os.environ.get('TIME_DELETE_FAIL')=='1':
        log('fault delete-list'); raise SystemExit(1)
    if not delta: raise SystemExit(2)
    if cmd=='add': key=cfg+'.@system[0]'; value='system'; print('@system[0]')
    elif cmd=='delete': value=None
    else: key,value=key.split('=',1)
    if cmd=='add_list': value=(view.get(key,'')+' '+value).strip()
    changes[key]=value; delta.write_text(json.dumps(changes)); raise SystemExit(0)
if cmd=='commit':
    write(file,view)
    if delta: delta.write_text('{}')
    if cfg=='sheepfold':
        (root/'both-committed').write_text('yes')
        late=os.environ.get('TIME_LATE_KEY')
        if late:
            target=root/late.split('.')[0]; latest=load(target)
            if os.environ.get('TIME_LATE_DROP')=='1': latest.pop(late,None)
            else: latest[late]=os.environ.get('TIME_LATE_VALUE','different')
            write(target,latest); log('fault external-change '+late)
    raise SystemExit(0)
raise SystemExit(2)
`;

function fixture(t, opts = {}) {
  const build = resolve('.build/time-confirmation'); mkdirSync(build, { recursive: true });
  const root = mkdtempSync(join(build, 'case-')), bin = join(root, 'bin'); mkdirSync(bin);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = p => shellTestPath(p, { cwd: repo });
  const put = (name, code) => { const p = join(bin, name); writeFileSync(p, code); chmodSync(p, 0o755); return p; };
  writeFileSync(join(root, 'system'), encode(system)); writeFileSync(join(root, 'sheepfold'), encode(app));
  writeFileSync(join(root, 'model.py'), model);
  put('uci', `#!/bin/sh\nexec ${quote(python)} -S "$TIME_MODEL" "$@"\n`); prepareFixtureFlock(put);
  put('date', '#!/bin/sh\nprintf "clock %s\\n" "$*" >> "$TIME_CASE/trace"\ncase "$1" in +%s) printf "%s" "$TIME_CLOCK"; exit "$TIME_CLOCK_EXIT" ;; +%Y) printf "2026\\n" ;; *) exit 2 ;; esac\n');
  put('log', '#!/bin/sh\nprintf "log\\n" >> "$TIME_CASE/trace"\n');
  put('logger', '#!/bin/sh\nprintf "logger\\n" >> "$TIME_CASE/trace"\n');
  put('init', '#!/bin/sh\nprintf "init %s\\n" "$*" >> "$TIME_CASE/trace"\nexit "$TIME_INIT_EXIT"\n');
  const helper = opts.source || process.env.SHEEPFOLD_TIME_CONFIRM_SOURCE || join(lib, 'sheepfold-time-control');
  const entry = put('entry', readFileSync(helper, 'utf8'));
  const launch = put('launch', `#!/bin/sh\nPATH=${quote(path(bin))}:"$PATH"; export PATH\nexec sh "$@"\n`);
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', TIME_CASE: path(root), TIME_MODEL: path(join(root, 'model.py')),
    TIME_LATE_KEY: opts.lateKey || '', TIME_LATE_DROP: opts.drop ? '1' : '0', TIME_LATE_VALUE: opts.lateValue || 'different',
    TIME_READ_ERROR: opts.readError || '', TIME_CLOCK: opts.clock ?? '1789430400\n', TIME_CLOCK_EXIT: String(opts.clockExit || 0),
    TIME_INIT_EXIT: String(opts.initExit || 0), TIME_DELETE_FAIL: opts.deleteFail ? '1' : '0', SHEEPFOLD_TIME_LOCK: path(join(root, 'time.lock')),
    SHEEPFOLD_LOCK_COMMON: path(join(lib, 'sheepfold-lock-common')), SHEEPFOLD_TIME_TRANSACTION_ROOT: path(join(root, 'transactions')),
    SHEEPFOLD_TIME_SYSTEM_CONFIG: path(join(root, 'system')), SHEEPFOLD_TIME_APP_CONFIG: path(join(root, 'sheepfold')),
    SHEEPFOLD_SYSNTPD_INIT: path(join(bin, 'init')), SHEEPFOLD_LOG_HELPER: path(join(bin, 'log')) };
  const args = [path(launch), path(entry), ...(opts.args || input)];
  const result = r => {
    completedProcess(r, t.name);
    const out = { code: r.status, stdout: r.stdout, stderr: r.stderr,
      state: { ...values(readFileSync(join(root, 'system'), 'utf8')), ...values(readFileSync(join(root, 'sheepfold'), 'utf8')) },
      trace: existsSync(join(root, 'trace')) ? readFileSync(join(root, 'trace'), 'utf8') : '',
      snapshots: existsSync(join(root, 'transactions')) ? readdirSync(join(root, 'transactions')) : [] };
    if (process.env.SHEEPFOLD_TIME_CONFIRM_EVIDENCE) {
      mkdirSync(process.env.SHEEPFOLD_TIME_CONFIRM_EVIDENCE, { recursive: true });
      writeFileSync(join(process.env.SHEEPFOLD_TIME_CONFIRM_EVIDENCE, t.name.replace(/[^\w.-]/g, '_')+'.json'), JSON.stringify(out, null, 2)+'\n');
    }
    return out;
  };
  return { root, bin, env, args, result, put, path,
    run: () => result(spawnSync(native ? 'sh' : 'bash', args, { cwd: repo, env, encoding: 'utf8', timeout: runtimeTimeout(20000) })) };
}
function restored(out) {
  assert.equal(out.code, 4, out.stderr); assert.match(out.stdout, /error=time_save_failed/);
  assert.match(out.stdout, /config_files_restored=1/); assert.doesNotMatch(out.stdout, /status=ok|persisted=1/);
  assert.deepEqual(out.state, { ...system, ...app }); assert.doesNotMatch(out.trace, /init restart/);
  assert.deepEqual(out.snapshots, []);
}

for (const key of Object.keys(expected)) {
  it(`time confirmation rejects a changed saved field ${key}`, t => {
    const out = fixture(t, { lateKey: key }).run();
    assert.ok(out.trace.includes('fault external-change '+key), 'mutation reached'); restored(out);
  });
}
for (const key of ['system.@system[0].zonename', 'system.@system[0].timezone', 'sheepfold.global.router_time_configured', 'system.ntp.server']) {
  it(`time confirmation rejects matching output from a failed read ${key}`, t => {
    const out = fixture(t, { readError: key }).run();
    assert.ok(out.trace.includes('fault read-error '+key), 'injection reached'); restored(out);
  });
}
it('time confirmation rejects a missing saved NTP list', t => restored(fixture(t, { lateKey: 'system.ntp.server', drop: true }).run()));
it('time confirmation compares the whole ordered list instead of just the last server', t => restored(fixture(t, { lateKey: 'system.ntp.server', lateValue: 'new2.example.test new1.example.test' }).run()));
it('time confirmation detects the real list divergence after a suppressed delete failure', t => {
  const out = fixture(t, { deleteFail: true }).run(); assert.match(out.trace, /fault delete-list/); restored(out);
});
it('time confirmation accepts every saved value and preserves unrelated settings', t => {
  const out = fixture(t).run(); assert.equal(out.code, 0, out.stderr); assert.match(out.stdout, /status=ok/);
  for (const [key, value] of Object.entries(expected)) assert.equal(out.state[key], value, key);
  assert.equal(out.state['system.ntp.custom'], 'keep-this-option'); assert.equal(out.state['sheepfold.global.note'], 'untouched');
  assert.equal((out.trace.match(/init restart/g) || []).length, 1); assert.deepEqual(out.snapshots, []);
});
it('time confirmation does not reject an unrelated simultaneous option', t => {
  const out = fixture(t, { lateKey: 'sheepfold.global.note', lateValue: 'external' }).run();
  assert.equal(out.code, 0, out.stderr); assert.equal(out.state['sheepfold.global.note'], 'external');
});
it('time confirmation retains the persisted NTP restart failure contract', t => {
  const out = fixture(t, { initExit: 1 }).run(); assert.equal(out.code, 5, out.stderr);
  assert.match(out.stdout, /error=ntp_restart_failed/); assert.match(out.stdout, /persisted=1/);
});
for (const [label, clock, clockExit] of [['empty failure','',1], ['matching failure','1789430400\n',1], ['empty success','',0], ['malformed success','not-a-timestamp\n',0]]) {
  it(`time confirmation rejects ${label} before staging`, t => {
    const out = fixture(t, { clock, clockExit }).run();
    assert.match(out.trace, /clock \+%s/, 'date injection reached'); assert.equal(out.code, 4, out.stderr);
    assert.match(out.stdout, /error=time_clock_unavailable/); assert.doesNotMatch(out.trace, /uci (set|add|add_list|delete|commit) /);
    assert.deepEqual(out.state, { ...system, ...app }); assert.doesNotMatch(out.trace, /init restart/); assert.deepEqual(out.snapshots, []);
  });
}
it('time confirmation accepts zero as a metadata timestamp without claiming clock synchronization', t => {
  const out = fixture(t, { clock: '0\n' }).run(); assert.equal(out.code, 0, out.stderr);
  assert.equal(out.state['sheepfold.global.router_time_configured_at'], '0');
});

async function waitFor(test, label, predicate) {
  const end = Date.now() + 10000;
  while (!predicate() && Date.now() < end) await new Promise(done => setTimeout(done, 10));
  assert.ok(predicate(), `${test.name}: ${label}`);
}
function start(args, env, t) {
  const p = spawn('sh', args, { cwd: repo, env, stdio: ['ignore','pipe','pipe'] });
  let stdout='', stderr=''; p.stdout.on('data', x => { stdout+=x; }); p.stderr.on('data', x => { stderr+=x; });
  const done = new Promise((yes,no) => { p.once('error',no); p.once('close', (status,signal) => yes({ status, signal, stdout, stderr })); });
  t.after(() => { if(p.exitCode===null) p.kill('SIGKILL'); }); return { p, done };
}
for (const explicit of [false,true]) {
  it(`time confirmation reads inherited settings after the shared lock (explicit=${explicit})`, { skip: !native, timeout: 30000 }, async t => {
    const f = fixture(t, { args: explicit ? input : ['save'] });
    const real = completedProcess(spawnSync('sh',['-c','command -v flock'],{ encoding:'utf8',timeout:10000 }), 'find flock'); assert.equal(real.status,0);
    // Mark the actual waiter before exec, preserve the native descriptor and flock.
    f.put('flock',`#!/bin/sh\nprintf 'waiter\\n' > "$TIME_CASE/waiter"\nexec ${quote(real.stdout.trim())} "$@"\n`);
    const lockArgs=['-c',`exec 8> "$TIME_CASE/time.lock"; ${quote(real.stdout.trim())} -x 8 || exit 1; printf 'ready\\n' > "$TIME_CASE/held"; n=0; while [ ! -f "$TIME_CASE/release" ]; do sleep 0.01; n=$((n+1)); [ "$n" -lt 1000 ] || exit 1; done`];
    const holder=start(lockArgs,f.env,t); await waitFor(t,'holder acquired native lock',()=>existsSync(join(f.root,'held')));
    const save=start(f.args,f.env,t); await waitFor(t,'save reached native lock',()=>existsSync(join(f.root,'waiter')));
    try {
      const trace=existsSync(join(f.root,'trace'))?readFileSync(join(f.root,'trace'),'utf8'):'';
      assert.doesNotMatch(trace,/uci (set|commit)/,'save cannot write while another owner holds lock');
      const current={ ...system,'system.@system[0].zonename':'Asia/Shanghai','system.@system[0].timezone':'CST-8','system.ntp.enabled':'0','system.ntp.enable_server':'1','system.ntp.server':'current.example.test'};
      writeFileSync(join(f.root,'system'),encode(current)); writeFileSync(join(f.root,'sheepfold'),encode({...app,'sheepfold.global.country_profile':'cn'}));
    } finally { writeFileSync(join(f.root,'release'),'continue'); }
    assert.equal((await holder.done).status,0); const out=f.result(await save.done); assert.equal(out.code,0,out.stderr);
    assert.equal(out.state['system.@system[0].zonename'],explicit?'Europe/Minsk':'Asia/Shanghai');
    assert.equal(out.state['system.@system[0].timezone'],explicit?'+03-3':'CST-8');
    assert.equal(out.state['system.ntp.server'],explicit?'new1.example.test new2.example.test':'current.example.test');
    assert.equal(out.state['system.ntp.enabled'],'0'); assert.equal(out.state['system.ntp.enable_server'],'1');
    assert.equal(out.state['sheepfold.global.router_time_country_profile'],explicit?'by':'cn');
  });
}

const clockMessage = 'Could not read the router clock. Time settings were not changed. Check the router before trying again.';
it('time confirmation classifies only the exact pre-write clock failure in the real UI module', () => {
  const source = process.env.SHEEPFOLD_TIME_CONFIRM_UI || join(lib, '../../../../htdocs/luci-static/resources/sheepfold/features/settings/time.js');
  const time = vm.runInNewContext(`(function(){${readFileSync(source, 'utf8')}})()`, { baseclass: { extend: value => value }, _: text => text });
  const stdout = 'status=error\nerror=time_clock_unavailable\n';
  for (const code of [0, 1, 4, 5, 6, 124]) {
    const error = new Error('original error'); error.result = { code, stdout };
    const normalized = time.normalizeSaveError(error, values);
    assert.equal(normalized.message, code === 4 ? clockMessage : 'original error');
    assert.notEqual(normalized.persisted, true, 'early failure never accepts the draft');
  }
  const incomplete = new Error('original error'); incomplete.result = { code: 4, stdout: 'error=time_clock_unavailable\n' };
  assert.equal(time.normalizeSaveError(incomplete, values).message, 'original error');
});
it('time confirmation has a Russian translation for the early clock failure', () => {
  const file = join(lib, '../../../../htdocs/luci-static/resources/sheepfold/i18n/ru.json');
  const messages = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(messages[clockMessage], 'Не удалось прочитать часы роутера. Настройки времени не изменены. Проверьте роутер перед повторной попыткой.');
});
