/*
 * Yandex journal export: the real entry, snapshot, uploader and verifier run in
 * isolated .build directories. UCI/HTTP are models; bytes, tar, cp/cmp and flock
 * are real. No account or remote files are used. Faults require an explicit trace.
 * Baseline mode optionally removes ONLY the old push-events declaration typo;
 * evidence labels that intermediate source, never as unchanged production.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { shellTestPath } from '../tools/quality/testEnvironment.mjs';

const repo = resolve(import.meta.dirname, '..');
const runtime = join(repo, 'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold');
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const posix = process.platform !== 'win32';
const selectedBytes = Buffer.from('selected journal\n');
const staleBytes = Buffer.from('obsolete journal\n'); // same size, different bytes
const pythonCmd = process.env.PYTHON_EXECUTABLE || (posix ? 'python3' : 'python');
const python = /[\\/]/.test(pythonCmd) ? shellTestPath(pythonCmd, { cwd: repo }) : pythonCmd;

function fixture(t, options = {}) {
  const parent = join(repo, '.build', 'yandex-events-fixtures'); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'case-'));
  const bin = join(root, 'bin'), ram = join(root, 'ram'), config = join(root, 'config');
  for (const dir of [bin, ram, config]) mkdirSync(dir);
  const path = p => shellTestPath(p, { cwd: repo, allowedRoot: root });
  const queue = join(ram, '.private', 'archive'); mkdirSync(queue, { recursive: true });
  const archive = join(queue, 'pending.tar'); writeFileSync(archive, 'pending archive');
  const fallback = join(ram, 'events.log'), selected = join(ram, 'journal space', 'Журнал.log');
  mkdirSync(join(ram, 'journal space'));
  const content = Object.hasOwn(options, 'content') ? Buffer.from(options.content, 'hex') : selectedBytes;
  if (!options.noFallback) writeFileSync(fallback, options.defaultPath ? content : staleBytes);
  if (!options.noSelected) writeFileSync(selected, content);
  writeFileSync(join(config, 'sheepfold'), "config global 'global'\n\toption block_all '0'\n");
  const foreign = join(root, 'foreign.log'); writeFileSync(foreign, 'foreign data');
  let configured = options.defaultPath ? null : path(selected);
  if (options.invalid === 'outside') configured = path(foreign);
  if (options.invalid === 'dotdot') configured = path(ram) + '/../foreign.log';
  if (options.invalid === 'directory') configured = path(join(ram, 'journal space'));
  if (options.invalid === 'leafLink') { const link = join(ram, 'link'); symlinkSync(foreign, link); configured = path(link); }
  if (options.invalid === 'parentLink') { const link = join(ram, 'alias'); symlinkSync(join(ram, 'journal space'), link, 'dir'); configured = path(join(link, 'Журнал.log')); }
  const tracePath = join(root, 'trace.jsonl'), optionsPath = join(root, 'options.json'), statePath = join(root, 'state.json');
  writeFileSync(tracePath, ''); writeFileSync(optionsPath, JSON.stringify(options));
  writeFileSync(statePath, JSON.stringify({ configured, uploads: {}, appended: false }));
  let text = readFileSync(join(process.env.SHEEPFOLD_YANDEX_TEST_SOURCE || runtime, 'sheepfold-yandex-disk'), 'utf8');
  const originalDigest = createHash('sha256').update(text).digest('hex');
  const intermediate = process.env.SHEEPFOLD_YANDEX_EVENTS_OPEN_PUSH === '1';
  if (intermediate) {
    assert.ok(text.includes('cmd_push_events() {\n\tremote_path verify_json'));
    text = text.replace('cmd_push_events() {\n\tremote_path verify_json', 'cmd_push_events() {\n\tlocal remote_path verify_json');
  }
  const map = s => s.replaceAll('/tmp/sheepfold', path(ram)).replaceAll('/etc/config', path(config)).replaceAll('/usr/libexec/sheepfold/', path(bin) + '/');
  const put = (name, data) => { writeFileSync(join(bin, name), data); chmodSync(join(bin, name), 0o755); };
  put('sheepfold-yandex-disk', map(text));
  for (const name of ['sheepfold-log-common', 'sheepfold-lock-common']) put(name, map(readFileSync(join(runtime, name), 'utf8')));
  if (options.missingLibrary) rmSync(join(bin, options.missingLibrary));
  const tools = {};
  for (const name of ['cp', 'cmp', 'chmod', ...(posix ? ['flock'] : [])]) {
    const found = spawnSync('sh', ['-c', 'command -v "$1"', 'tool', name], { encoding: 'utf8' });
    assert.equal(found.status, 0); tools[name] = found.stdout.trim();
    if (!posix) {
      const native = spawnSync('sh', ['-c', 'cygpath -w "$1"', 'tool', tools[name]], { encoding: 'utf8' });
      assert.equal(native.status, 0); tools[name] = native.stdout.trim();
    }
  }
  writeFileSync(join(root, 'tools.json'), JSON.stringify(tools));
  // Windows non-concurrent cases use a declared lock model, never evidence of flock.
  if (!posix) put('flock', '#!/bin/sh\nexit 0\n');
  const wrappers = ['uci', 'curl'];
  if (options.fault?.startsWith('cp') || options.changePathOnCopy) wrappers.push('cp');
  if (options.fault === 'cmp') wrappers.push('cmp');
  if (options.fault === 'chmod-events') wrappers.push('chmod');
  if (options.lockTrace || options.fault === 'flock') wrappers.push('flock');
  for (const name of wrappers) put(name, `#!/bin/sh\nexec ${quote(python)} -S ${quote(path(join(bin, 'model.py')))} ${name} "$@"\n`);
  put('model.py', `import json,os,sys,pathlib,subprocess,stat
kind=sys.argv[1]; args=sys.argv[2:]; opts=json.load(open(os.environ['YE_OPTIONS'])); statePath=pathlib.Path(os.environ['YE_STATE']); state=json.loads(statePath.read_text()); fault=opts.get('fault')
def record(**event):
 with open(os.environ['YE_TRACE'],'a') as f: f.write(json.dumps(event)+'\\n')
def save(): statePath.write_text(json.dumps(state))
def fail(name): record(fault=name,tool=kind); sys.exit(9)
if kind=='uci':
 args=[a for a in args if a!='-q']; record(tool=kind,args=args)
 if args[0]=='get':
  key=args[1]
  values={'sheepfold.global.log_storage':opts.get('storage','yandex_disk'),'sheepfold.cloud.login':'synthetic','sheepfold.cloud.password':'synthetic-only','sheepfold.cloud.root_folder':'/sheepfold','sheepfold.cloud.quota_mb':'500'}
  if key=='sheepfold.global.log_cache_path':
   if fault=='uci-path': print('/partial',end=''); fail(fault)
   if state['configured'] is None: sys.exit(1)
   print(state['configured'],end=''); sys.exit(0)
  if key not in values: sys.exit(1)
  print(values[key],end=''); sys.exit(0)
 if args[0]=='show':
  if fault=='uci-show' and args[1]=='sheepfold': print('sheepfold.global=global'); fail(fault)
  print('sheepfold.cloud=yandex_disk\\nsheepfold.cloud.login=synthetic\\nsheepfold.cloud.password=synthetic-only\\nsheepfold.cloud.root_folder=/sheepfold')
  if args[1]=='sheepfold' and state['configured'] is not None: print('sheepfold.global.log_cache_path='+state['configured'])
  sys.exit(0)
 sys.exit(1)
if kind=='curl':
 vals={}; i=0
 while i<len(args):
  if args[i] in ('-X','-o','-w','-u','-m','-H','--url','--proto','-T','-D'): vals[args[i]]=args[i+1]; i+=2
  else: i+=1
 method=vals.get('-X','HEAD' if '--head' in args else ('PUT' if '-T' in vals else 'GET')); url=vals.get('--url',''); code='207'; body=''
 event={'tool':kind,'method':method,'url':url}
 if method=='MKCOL': code=str(opts.get('mkcolHttp',201))
 elif method=='PUT':
  code='201'; p=pathlib.Path(vals['-T']); data=p.read_bytes(); state['uploads'][url]=data.hex(); save()
  event.update(hex=data.hex(),fileMode=stat.S_IMODE(p.stat().st_mode)&511,parentMode=stat.S_IMODE(p.parent.stat().st_mode)&511)
 elif method=='HEAD':
  code='200'; data=bytes.fromhex(state['uploads'].get(url,'')); pathlib.Path(vals['-D']).write_bytes(('HTTP/1.1 200 OK\\r\\nContent-Length: '+str(len(data))+'\\r\\n\\r\\n').encode())
 elif method=='PROPFIND': body='<d:multistatus xmlns:d="DAV:"/>'
 else: code='500'
 if opts.get('probeLock') and method=='PUT':
  import fcntl
  with open(os.environ['YE_LOCK'],'a') as lf:
   try: fcntl.flock(lf,fcntl.LOCK_EX|fcntl.LOCK_NB); event['lockFree']=True; fcntl.flock(lf,fcntl.LOCK_UN)
   except BlockingIOError: event['lockFree']=False
 if opts.get('appendAt')==method and not state['appended'] and '/logs/events' in url:
  p=pathlib.Path(state['configured'] or os.environ['YE_DEFAULT']); p.write_bytes(p.read_bytes()+b'new event\\n'); state['appended']=True; save(); event['appended']=True
 record(**event)
 if '-o' not in vals: print(body,end='')
 elif vals['-o']!='/dev/null': pathlib.Path(vals['-o']).write_text(body)
 print(vals.get('-w','').replace('%{http_code}',code).replace('\\\\n','\\n'),end=''); sys.exit(0)
real=json.load(open(os.environ['YE_TOOLS']))
if kind=='cp' and args[-2] in (os.environ['YE_SELECTED'],os.environ['YE_DEFAULT']):
 record(tool='cp-events',source=args[-2],destination=args[-1])
 if fault=='cp-error': pathlib.Path(args[-1]).write_bytes(b'partial'); fail(fault)
 if fault=='cp-wrong': pathlib.Path(args[-1]).write_bytes(b'incorrect'); record(fault=fault); sys.exit(0)
 r=subprocess.run([real[kind],*args])
 if opts.get('changePathOnCopy'): state['configured']=os.environ['YE_DEFAULT']; save(); record(pathChanged=True)
 sys.exit(r.returncode)
if kind=='cmp' and args[-2] in (os.environ['YE_SELECTED'],os.environ['YE_DEFAULT']) and fault=='cmp': fail(fault)
if kind=='chmod' and '/.yandex-archive.' in args[-1] and pathlib.Path(args[-1]).name.startswith('events') and fault=='chmod-events': fail(fault)
if kind=='flock':
 if fault=='flock': record(fault=fault); sys.exit(127)
 # Python closes FDs by default. Pass through descriptor 9 to real flock.
 fd=int(args[-1]); r=subprocess.run([real[kind],*args],pass_fds=(fd,)); record(tool='flock',status=r.returncode); sys.exit(r.returncode)
sys.exit(subprocess.run([real[kind],*args]).returncode)
`);
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', YE_OPTIONS: path(optionsPath), YE_STATE: path(statePath), YE_TRACE: path(tracePath), YE_TOOLS: path(join(root, 'tools.json')), YE_SELECTED: path(selected), YE_DEFAULT: path(fallback), YE_LOCK: path(join(ram, 'log-maintenance.flock')) };
  const args = action => ['-c', `export PATH=${quote(path(bin))}:"$PATH"; exec sh "$@"`, 'fixture', path(join(bin, 'sheepfold-yandex-disk')), action];
  const results = [];
  const recordResult = (action, r) => { assert.ifError(r.error); results.push({ action, status: r.status, stdout: r.stdout, stderr: r.stderr }); return r; };
  const run = action => recordResult(action, spawnSync('sh', args(action), { cwd: repo, env, encoding: 'utf8', timeout: 25000 }));
  const start = action => {
    const child = spawn('sh', args(action), { cwd: repo, env, detached: posix, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    const done = new Promise((res, rej) => { child.on('error', rej); child.on('close', status => res(recordResult(action, { status, stdout, stderr }))); });
    t.after(() => { if (child.exitCode === null) { try { if (posix) process.kill(-child.pid, 'SIGKILL'); else child.kill(); } catch { /* already exited */ } } });
    return { child, done };
  };
  const trace = () => readFileSync(tracePath, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  t.after(() => {
    const destination = process.env.SHEEPFOLD_YANDEX_EVENTS_EVIDENCE_DIR;
    if (destination) {
      mkdirSync(destination, { recursive: true });
      const id = createHash('sha256').update(t.name).digest('hex').slice(0, 16);
      writeFileSync(join(destination, id + '.json'), JSON.stringify({ name: t.name, originalDigest, intermediate, options, results, trace: trace(), selectedHex: existsSync(selected) ? readFileSync(selected).toString('hex') : null, fallbackHex: existsSync(fallback) ? readFileSync(fallback).toString('hex') : null, archiveExists: existsSync(archive), leftovers: readdirSync(ram) }, null, 2));
    }
    rmSync(root, { recursive: true, force: true });
  });
  return { run, start, trace, root, ram, selected, fallback, archive, statePath, content, foreign, path, tools };
}
const puts = f => f.trace().filter(e => e.method === 'PUT');
const logPuts = f => puts(f).filter(e => e.url.includes('/logs/events'));
const noMutation = f => assert.ok(!f.trace().some(e => ['PUT', 'MKCOL', 'DELETE'].includes(e.method)));
const clean = f => assert.deepEqual(readdirSync(f.ram).filter(n => n.startsWith('.yandex-archive.') || n.startsWith('.yandex-transfer.')), []);
const json = r => JSON.parse(r.stdout);

// Full real entries, no patched uploader and no real remote service.
describe('Yandex configured journal snapshot', () => {
  for (const action of ['push-events', 'archive-push']) {
    it(`${action} sends the configured journal, not equal-size stale default`, t => {
      const f = fixture(t); assert.equal(selectedBytes.length, staleBytes.length);
      const r = f.run(action); assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.equal(json(r).ok, true); assert.equal(logPuts(f).length, 1);
      assert.equal(logPuts(f)[0].hex, selectedBytes.toString('hex')); clean(f);
      assert.deepEqual(readFileSync(f.fallback), staleBytes);
    });
    it(`${action} exports custom journal even when default is absent`, t => {
      const f = fixture(t, { noFallback: true }), r = f.run(action);
      assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(logPuts(f).length, 1);
      assert.equal(logPuts(f)[0].hex, selectedBytes.toString('hex')); clean(f);
    });
    it(`${action} ignores obsolete default when selected file is absent`, t => {
      const f = fixture(t, { noSelected: true }), r = f.run(action);
      assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(logPuts(f).length, 0); clean(f);
      if (action === 'push-events') { assert.equal(r.stdout, ''); noMutation(f); }
    });
    it(`${action} keeps ordinary default-path compatibility`, t => {
      const f = fixture(t, { defaultPath: true }), r = f.run(action);
      assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(logPuts(f)[0].hex, selectedBytes.toString('hex')); clean(f);
    });
    it(`${action} does nothing for another selected backend`, t => {
      const f = fixture(t, { storage: 'ram' }), r = f.run(action);
      assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, ''); noMutation(f);
      assert.ok(existsSync(f.archive)); clean(f);
    });
    for (const invalid of ['outside', 'dotdot', 'directory', 'leafLink', 'parentLink']) {
      it(`${action} refuses unsafe configured path: ${invalid}`, { skip: !posix && invalid.endsWith('Link') }, t => {
        const f = fixture(t, { invalid }), r = f.run(action);
        assert.notEqual(r.status, 0); assert.equal(json(r).error, 'events_snapshot_failed');
        noMutation(f); assert.ok(existsSync(f.archive)); assert.equal(readFileSync(f.foreign, 'utf8'), 'foreign data'); clean(f);
      });
    }
    for (const fault of ['uci-path', 'uci-show', 'cp-error', 'cp-wrong', 'cmp', 'chmod-events']) {
      it(`${action} fails before mutations on ${fault}`, t => {
        const f = fixture(t, { fault, ...(fault === 'uci-show' ? { defaultPath: true } : {}) }), r = f.run(action);
        assert.ok(f.trace().some(e => e.fault === fault), 'injected fault reached');
        assert.notEqual(r.status, 0); assert.equal(json(r).error, 'events_snapshot_failed');
        noMutation(f); assert.ok(existsSync(f.archive)); clean(f);
      });
    }
    it(`${action} detects configured path changed during copying`, t => {
      const f = fixture(t, { changePathOnCopy: true }), r = f.run(action);
      assert.ok(f.trace().some(e => e.pathChanged)); assert.notEqual(r.status, 0);
      assert.equal(json(r).error, 'events_snapshot_failed'); noMutation(f); clean(f);
    });
    it(`${action} releases log lock before PUT and keeps newly appended events`, { skip: !posix }, t => {
      const f = fixture(t, { probeLock: true, appendAt: 'PUT' }), r = f.run(action);
      assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(json(r).ok, true);
      assert.ok(puts(f).length); assert.ok(puts(f).every(e => e.lockFree));
      assert.ok(logPuts(f).some(e => e.appended)); assert.equal(logPuts(f)[0].hex, selectedBytes.toString('hex'));
      assert.deepEqual(readFileSync(f.selected), Buffer.concat([selectedBytes, Buffer.from('new event\n')])); clean(f);
    });
  }
  for (const content of ['', '00ff0a68656c6c6f']) it(`supports ${content ? 'binary' : 'empty'} snapshots`, t => {
    const f = fixture(t, { content }), r = f.run('push-events');
    assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(logPuts(f)[0].hex, content); clean(f);
  });
  for (const appendAt of ['PUT', 'HEAD']) it(`push-events permits default journal growth during ${appendAt}`, { skip: !posix }, t => {
    const f = fixture(t, { defaultPath: true, probeLock: true, appendAt }), r = f.run('push-events');
    assert.ok(f.trace().some(e => e.appended), 'live journal actually changed');
    assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(json(r).ok, true);
    assert.equal(logPuts(f)[0].hex, selectedBytes.toString('hex'));
    assert.deepEqual(readFileSync(f.fallback), Buffer.concat([selectedBytes, Buffer.from('new event\n')])); clean(f);
  });
  it('snapshot and transfer files stay private', { skip: !posix }, t => {
    const f = fixture(t), r = f.run('push-events'); assert.equal(r.status, 0, r.stderr);
    for (const e of puts(f)) { assert.equal(e.fileMode, 0o600); assert.equal(e.parentMode, 0o700); } clean(f);
  });
  it('refuses export when the lock cannot be acquired', { skip: !posix }, t => {
    const f = fixture(t, { fault: 'flock' }), r = f.run('push-events');
    assert.ok(f.trace().some(e => e.fault === 'flock'), 'lock fault reached');
    assert.notEqual(r.status, 0); assert.equal(json(r).error, 'events_snapshot_failed');
    noMutation(f); assert.ok(existsSync(f.archive)); clean(f);
  });
  for (const missingLibrary of ['sheepfold-log-common', 'sheepfold-lock-common']) it(`does not export without ${missingLibrary}`, t => {
    const f = fixture(t, { missingLibrary }), r = f.run('push-events');
    assert.notEqual(r.status, 0); assert.equal(json(r).error, 'events_snapshot_failed'); noMutation(f); clean(f);
  });
});

async function until(predicate) {
  for (let i = 0; i < 150; i++) { if (predicate()) return; await delay(20); }
  assert.fail('expected deterministic barrier was not reached');
}
async function holdLock(t, f) {
  const ready = join(f.root, 'ready'), release = join(f.root, 'release');
  const child = spawn('sh', ['-c', `exec 9>${quote(f.path(join(f.ram, 'log-maintenance.flock')))}; ${quote(f.tools.flock)} -x 9 || exit; touch ${quote(f.path(ready))}; while [ ! -e ${quote(f.path(release))} ]; do sleep 0.02; done`], { stdio: 'ignore' });
  const done = new Promise(res => child.on('close', res));
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  await until(() => existsSync(ready));
  return async () => { writeFileSync(release, 'go'); assert.equal(await done, 0); };
}
describe('Yandex journal lock protocol with real flock', () => {
  for (const action of ['push-events', 'archive-push']) it(`${action} waits for writer and reloads source after lock`, { skip: !posix, timeout: 20000 }, async t => {
    const f = fixture(t, { lockTrace: true }), release = await holdLock(t, f), run = f.start(action);
    try {
      await until(() => f.trace().some(e => e.tool === 'flock' && e.status !== 0) || run.child.exitCode !== null);
      assert.ok(f.trace().some(e => e.tool === 'flock' && e.status !== 0), 'real lock contention reached');
      assert.equal(run.child.exitCode, null); assert.equal(puts(f).length, 0);
      const state = JSON.parse(readFileSync(f.statePath, 'utf8')); state.configured = f.path(f.fallback); writeFileSync(f.statePath, JSON.stringify(state));
    } finally { await release(); }
    const r = await run.done; assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(logPuts(f)[0].hex, staleBytes.toString('hex')); clean(f);
  });
});
