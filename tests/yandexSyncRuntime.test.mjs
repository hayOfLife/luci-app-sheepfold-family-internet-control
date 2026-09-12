/* Real entry/rename/read in private fixtures; UCI, HTTP, jshn are explicit
 * models. Faults must leave a trace. No router settings or cloud files used. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { shellTestPath } from '../tools/quality/testEnvironment.mjs';
const repo = resolve(import.meta.dirname, '..');
const runtime = join(repo, 'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold');
const posix = process.platform !== 'win32';
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const oldRecord = { command: 'archive-push', ok: true, message: 'old completed operation', at: '2025-01-02T03:04:05+0000' };
const python = process.env.PYTHON_EXECUTABLE || (posix ? 'python3' : 'python');
function fixture(t, options = {}) {
  const parent = join(repo, '.build', 'yandex-sync-fixtures'); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'case-'));
  const bin = join(root, 'bin'), ram = join(root, 'ram'), config = join(root, 'config');
  for (const dir of [bin, ram, config]) mkdirSync(dir);
  const path = value => shellTestPath(value, { cwd: repo, allowedRoot: root });
  const put = (name, data) => { writeFileSync(join(bin, name), data); chmodSync(join(bin, name), 0o755); };
  writeFileSync(join(config, 'sheepfold'), "config global 'global'\n\toption block_all '0'\n");
  if (!options.noEvents) writeFileSync(join(ram, 'events.log'), 'synthetic event\n');
  const queue = join(ram, '.private', 'archive'); mkdirSync(queue, { recursive: true });
  const archive = join(queue, 'pending.tar'); writeFileSync(archive, 'synthetic archive');
  const statusFile = join(ram, '.yandex-sync-status.json');
  const initial = Object.hasOwn(options, 'statusText') ? options.statusText : JSON.stringify(oldRecord) + '\n';
  if (!options.noStatus) writeFileSync(statusFile, initial);
  const foreign = join(root, 'foreign'); mkdirSync(foreign); writeFileSync(join(foreign, 'keep'), 'foreign data');
  if (options.target === 'link') { rmSync(statusFile, { force: true }); symlinkSync(join(foreign, 'keep'), statusFile); }
  if (options.target === 'directory') { rmSync(statusFile, { force: true }); mkdirSync(statusFile); writeFileSync(join(statusFile, 'keep'), 'directory data'); }
  if (options.target === 'parentLink') { renameSync(ram, join(root, 'originalRam')); symlinkSync(join(root, 'originalRam'), ram, 'dir'); }
  const traceFile = join(root, 'trace.jsonl'), optionsFile = join(root, 'options.json'), stateFile = join(root, 'state.json');
  writeFileSync(traceFile, ''); writeFileSync(optionsFile, JSON.stringify(options)); writeFileSync(stateFile, '{}');
  const map = text => text.replaceAll('/tmp/sheepfold', path(ram)).replaceAll('/etc/config', path(config)).replaceAll('/usr/libexec/sheepfold/', path(bin) + '/').replaceAll('/usr/share/libubox/jshn.sh', path(join(bin, 'jshn.sh')));
  const original = readFileSync(join(process.env.SHEEPFOLD_YANDEX_TEST_SOURCE || runtime, 'sheepfold-yandex-disk'), 'utf8');
  const source = map(original), marker = '\ncommand_name="${1:-}"'; assert.ok(source.includes(marker));
  put('sheepfold-yandex-disk', source); put('library', source.slice(0, source.lastIndexOf(marker)) + '\n');
  for (const name of ['sheepfold-log-common', 'sheepfold-lock-common']) put(name, map(readFileSync(join(runtime, name), 'utf8')));
  const toolNames = ['mv', 'head', 'cat', 'date', 'chmod', 'mktemp', 'rm']; const tools = {};
  for (const name of toolNames) {
    const r = spawnSync('sh', ['-c', 'command -v "$1"', 'tool', name], { encoding: 'utf8' }); assert.equal(r.status, 0); tools[name] = r.stdout.trim();
    if (!posix) { const n = spawnSync('sh', ['-c', 'cygpath -w "$1"', 'tool', tools[name]], { encoding: 'utf8' }); assert.equal(n.status, 0); tools[name] = n.stdout.trim(); }
  }
  if (!posix) put('flock', '#!/bin/sh\nexit 0\n');
  writeFileSync(join(root, 'tools.json'), JSON.stringify(tools));
  // Minimal native-function-shaped jshn model; never executes cache contents.
  put('jshn.sh', `json_init() { :; }
json_get_keys() { eval "$1=\\\"\\$modelKeys\\\""; }
json_get_type() { eval "$1=\\\"\\\${modelType_$2-}\\\""; eval '[ -n "\\\${modelType_'"$2"'-}" ]'; }
json_get_var() { eval "$1=\\\"\\\${modelValue_$2-}\\\""; }
`);
  if (options.noJshn) rmSync(join(bin, 'jshn.sh'));
  for (const name of ['uci', 'curl', 'jshn', ...toolNames]) put(name, `#!/bin/sh\nexec ${quote(python)} -S ${quote(path(join(bin, 'model.py')))} ${name} "$@"\n`);
  put('model.py', `import json,os,sys,pathlib,subprocess,shlex,time,stat
kind=sys.argv[1]; args=sys.argv[2:]; opts=json.load(open(os.environ['YS_OPTIONS'])); fault=opts.get('fault',''); statePath=pathlib.Path(os.environ['YS_STATE']); state=json.loads(statePath.read_text())
def record(**e):
 with open(os.environ['YS_TRACE'],'a') as f:f.write(json.dumps(dict(tool=kind,**e))+'\\n')
def fail(label):record(fault=label);sys.exit(9)
status=os.environ['YS_STATUS']
if kind=='uci':
 a=[v for v in args if v!='-q']; values={'sheepfold.global.log_storage':opts.get('storage','yandex_disk'),'sheepfold.cloud.login':'synthetic','sheepfold.cloud.password':'synthetic-only','sheepfold.cloud.root_folder':'/sheepfold','sheepfold.cloud.quota_mb':'500'}
 if a[0]=='get':
  if a[1]=='sheepfold.global.log_storage' and opts.get('storageFault'):print('partial',end='');fail('storage-read')
  if a[1]=='sheepfold.global.log_storage' and opts.get('noStorage'):sys.exit(1)
  if opts.get('noCredentials') and a[1]=='sheepfold.cloud.password':fail('credentials')
  if opts.get('rootFail') and a[1]=='sheepfold.cloud.root_folder':print('/partial',end='');fail('root')
  if a[1] not in values:sys.exit(1)
  print(values[a[1]],end='');sys.exit(0)
 if a[0]=='show':
  print('sheepfold.cloud=cloud')
  for k,v in values.items():
   if k.startswith(a[1]+'.') and not(opts.get('noStorage') and k=='sheepfold.global.log_storage'):print(k+'='+repr(v))
  sys.exit(0)
 fail('unexpected-uci-write')
if kind=='curl':
 vals={};i=0
 while i<len(args):
  if args[i] in ('-X','-o','-w','-u','-m','-H','--url','--proto','-T','-D'):vals[args[i]]=args[i+1];i+=2
  else:i+=1
 method=vals.get('-X','HEAD' if '--head' in args else ('PUT' if '-T' in vals else 'GET'));url=vals.get('--url','');http='207';body='';rc=0
 if method=='PROPFIND':body='<d:multistatus xmlns:d="DAV:"/>';http=str(opts.get('probeHttp',207))
 if method=='MKCOL':http=str(opts.get('mkcolHttp',201))
 if method=='PUT':
  http=str(opts.get('putHttp',201));state[url]=pathlib.Path(vals['-T']).read_bytes().hex();statePath.write_text(json.dumps(state))
 if method=='HEAD':
  http='200';data=bytes.fromhex(state.get(url,''));pathlib.Path(vals['-D']).write_bytes(('HTTP/1.1 200 OK\\r\\nContent-Length: '+str(len(data))+'\\r\\n\\r\\n').encode())
 record(method=method,url=url,http=http)
 if '-o' not in vals:print(body,end='')
 elif vals['-o']!='/dev/null':pathlib.Path(vals['-o']).write_text(body)
 print(vals.get('-w','').replace('%{http_code}',http).replace('\\\\n','\\n'),end='');sys.exit(rc)
if kind=='jshn':
 record(parser=True)
 if fault=='parser':print('modelKeys=command',end='');fail(fault)
 try:obj=json.loads(args[1]);assert isinstance(obj,dict)
 except Exception:sys.exit(1)
 print('modelKeys='+shlex.quote(' '.join(obj)))
 for k,v in obj.items():
  if k not in ('command','ok','message','at'):continue
  ty='boolean' if isinstance(v,bool) else 'string' if isinstance(v,str) else 'int' if isinstance(v,int) else 'null' if v is None else 'object'
  print('modelType_'+k+'='+shlex.quote(ty));print('modelValue_'+k+'='+shlex.quote(str(int(v)) if isinstance(v,bool) else v if isinstance(v,str) else str(v)))
 sys.exit(0)
real=json.load(open(os.environ['YS_TOOLS']))
if kind=='rm' and fault=='remove-archive' and any(a.endswith('/pending.tar') for a in args):record(fault=fault);sys.exit(4)
if kind=='date' and args==['+%Y-%m-%dT%H:%M:%S%z']:
 if fault=='date':print('2026-09-12T00:00:00+0000',end='');fail(fault)
 if fault=='date-invalid':record(fault=fault);print('invalid time');sys.exit(0)
if kind in ('cat','head') and status in args and fault=='read':print('{"ok":true',end='');fail(fault)
if kind=='mktemp' and any('.yandex-sync.' in a for a in args) and fault=='mktemp':print(os.environ['YS_FOREIGN'],end='');fail(fault)
if kind=='mktemp' and any('.yandex-archive.' in a for a in args) and fault=='archive-work':fail(fault)
if kind=='chmod':
 target=args[-1]
 if fault=='chmod-file' and (target==status or target.endswith('/status.json')):fail(fault)
 if fault=='chmod-work' and '.yandex-sync.' in target and not target.endswith('.json'):fail(fault)
if kind=='mv' and args[-1]==status:
 record(publish=True,tempMode=stat.S_IMODE(pathlib.Path(args[-2]).stat().st_mode)&511,parentMode=stat.S_IMODE(pathlib.Path(args[-2]).parent.stat().st_mode)&511)
 if fault=='mv':fail(fault)
 if opts.get('pausePublish'):
  pathlib.Path(os.environ['YS_BARRIER']).write_text('reached');end=time.monotonic()+12
  while not pathlib.Path(os.environ['YS_RELEASE']).exists():
   if time.monotonic()>end:fail('barrier-timeout')
   time.sleep(.01)
if kind=='head' and status in args:record(readLimit=args[1] if args[0]=='-c' else None)
sys.exit(subprocess.run([real[kind],*args]).returncode)
`);
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', YS_OPTIONS: path(optionsFile), YS_STATE: path(stateFile), YS_TRACE: path(traceFile), YS_STATUS: path(statusFile), YS_FOREIGN: path(foreign), YS_TOOLS: path(join(root, 'tools.json')), YS_BARRIER: path(join(root, 'barrier')), YS_RELEASE: path(join(root, 'release')) };
  const results = [];
  const argsFor = (action, message = 'completed operation') => ['-c', `export PATH=${quote(path(bin))}:"$PATH"; ${action === 'write' ? `. ${quote(path(join(bin, 'library')))}; write_sync_status push-events false ${quote(message)}` : `exec sh ${quote(path(join(bin, 'sheepfold-yandex-disk')))} ${quote(action)}`}`];
  const run = (action, message) => { const r = spawnSync('sh', argsFor(action, message), { cwd: root, env, encoding: 'utf8', timeout: 25000 }); assert.ifError(r.error); results.push({ action, status: r.status, stdout: r.stdout, stderr: r.stderr }); return r; };
  const start = (action, message) => {
    const child = spawn('sh', argsFor(action, message), { cwd: root, env, detached: posix, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    const done = new Promise((res, rej) => { child.on('error', rej); child.on('close', status => { const r = { action, status, stdout, stderr }; results.push(r); res(r); }); });
    t.after(() => { if (child.exitCode === null) { try { if (posix) process.kill(-child.pid, 'SIGKILL'); else child.kill(); } catch { /* exited */ } } });
    return { child, done };
  };
  const trace = () => readFileSync(traceFile, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const cache = () => readFileSync(statusFile, 'utf8');
  t.after(() => {
    const dest = process.env.SHEEPFOLD_YANDEX_SYNC_EVIDENCE_DIR;
    if (dest) {
      mkdirSync(dest, { recursive: true }); const name = createHash('sha256').update(t.name).digest('hex').slice(0, 16);
      writeFileSync(join(dest, name + '.json'), JSON.stringify({ name: t.name, sourceDigest: createHash('sha256').update(original).digest('hex'), options, results, trace: trace(), statusText: existsSync(statusFile) && statSync(statusFile).isFile() ? cache() : null, archiveExists: existsSync(archive), foreignText: readFileSync(join(foreign, 'keep'), 'utf8') }, null, 2));
    }
    rmSync(root, { recursive: true, force: true });
  });
  return { run, start, trace, cache, initial, statusFile, foreign, archive, root, ram };
}
const parse = r => JSON.parse(r.stdout);
const clean = f => assert.deepEqual(readdirSync(f.ram).filter(n => n.startsWith('.yandex-sync.')), []);

describe('Yandex completed sync status', () => {
  for (const action of ['push-events', 'archive-push']) {
    for (const [reason, options] of [['credentials', { noCredentials: true }], ['root', { rootFail: true }], ['MKCOL', { mkcolHttp: 423 }], ['work directory', { fault: 'archive-work' }], ['PUT', { putHttp: 500 }]]) {
      it(`${action} replaces old success after ${reason} failure`, t => {
        const f = fixture(t, options), r = f.run(action); assert.notEqual(r.status, 0); assert.equal(parse(r).ok, false);
        const saved = JSON.parse(f.cache()); assert.equal(saved.ok, false); assert.equal(saved.command, action); assert.notEqual(saved.at, oldRecord.at); clean(f);
        if (options.fault) assert.ok(f.trace().some(e => e.fault === options.fault));
        if (options.mkcolHttp) assert.ok(f.trace().some(e => e.method === 'MKCOL' && e.http === '423'));
      });
    }
    it(`${action} keeps successful operation JSON when status cannot be written`, { skip: !posix }, t => {
      const f = fixture(t, { target: 'directory' }), r = f.run(action);
      assert.equal(r.status, 0, r.stderr); assert.equal(parse(r).ok, true); assert.match(r.stderr, /sync status could not be saved/);
      assert.equal(readFileSync(join(f.statusFile, 'keep'), 'utf8'), 'directory data'); assert.ok(f.trace().some(e => e.method === 'PUT'));
    });
    it(`${action} keeps the original error when status cannot be written`, { skip: !posix }, t => {
      const f = fixture(t, { target: 'directory', putHttp: 500 }), r = f.run(action);
      assert.notEqual(r.status, 0); assert.equal(parse(r).ok, false); assert.match(r.stderr, /sync status could not be saved/);
    });
    it(`${action} records a successful completed operation`, t => {
      const f = fixture(t), r = f.run(action); assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(parse(r).ok, true);
      const saved = JSON.parse(f.cache()); assert.equal(saved.command, action); assert.equal(saved.ok, true); assert.notEqual(saved.at, oldRecord.at); clean(f);
    });
    it(`${action} does not change history for another selected backend`, t => {
      const f = fixture(t, { storage: 'ram' }), r = f.run(action); assert.equal(r.status, 0); assert.equal(r.stdout, ''); assert.equal(f.cache(), f.initial);
    });
  }
  for (const action of ['push-events', 'archive-push']) {
    it(`${action} treats failed storage-setting read as an error, not a skipped sync`, t => {
      const f = fixture(t, { storageFault: true }), r = f.run(action);
      assert.notEqual(r.status, 0); assert.equal(parse(r).error, 'storage_unavailable');
      assert.equal(JSON.parse(f.cache()).ok, false); assert.ok(f.trace().some(e => e.fault === 'storage-read'));
      assert.ok(!f.trace().some(e => e.method)); assert.ok(existsSync(f.archive));
    });
    it(`${action} still skips a confirmed absent storage setting`, t => {
      const f = fixture(t, { noStorage: true }), r = f.run(action);
      assert.equal(r.status, 0); assert.equal(r.stdout, ''); assert.equal(f.cache(), f.initial);
      assert.ok(!f.trace().some(e => e.method));
    });
  }
  it('archive error code 4 is not confused with the empty-journal skip', t => {
    const f = fixture(t, { fault: 'remove-archive' }), r = f.run('archive-push');
    assert.notEqual(r.status, 0); assert.ok(f.trace().some(e => e.fault === 'remove-archive'));
    assert.equal(JSON.parse(f.cache()).ok, false); assert.ok(existsSync(f.archive));
  });
  it('archive-push records a failed authorization probe', t => {
    const f = fixture(t, { probeHttp: 401 }), r = f.run('archive-push'); assert.notEqual(r.status, 0); assert.equal(JSON.parse(f.cache()).ok, false);
    assert.ok(!f.trace().some(e => ['PUT', 'MKCOL', 'DELETE'].includes(e.method)));
  });
  it('absent selected journal does not claim a new successful sync', t => {
    const f = fixture(t, { noEvents: true }), r = f.run('push-events'); assert.equal(r.status, 0); assert.equal(r.stdout, ''); assert.equal(f.cache(), f.initial);
  });
});

describe('Yandex status file publication', () => {
  for (const fault of ['date', 'date-invalid', 'mktemp', 'chmod-work', 'chmod-file', 'mv']) {
    it(`preserves previous status on ${fault} failure`, { skip: !posix }, t => {
      const f = fixture(t, { fault }), r = f.run('write'); assert.notEqual(r.status, 0); assert.equal(f.cache(), f.initial);
      assert.ok(f.trace().some(e => e.fault === fault), 'fault reached'); assert.equal(readFileSync(join(f.foreign, 'keep'), 'utf8'), 'foreign data'); clean(f);
    });
  }
  for (const target of ['link', 'directory', 'parentLink']) it(`does not publish through ${target}`, { skip: !posix }, t => {
    const f = fixture(t, { target }), r = f.run('write'); assert.notEqual(r.status, 0); assert.equal(readFileSync(join(f.foreign, 'keep'), 'utf8'), 'foreign data');
    if (target === 'parentLink') assert.equal(f.cache(), f.initial);
  });
  it('creates a closed complete status and preserves special text', { skip: !posix }, t => {
    const f = fixture(t, { noStatus: true }), message = 'Статус "копии" \\ \b\t\nновая строка\n', r = f.run('write', message);
    assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(f.cache()).message, message);
    assert.equal(statSync(f.statusFile).mode & 0o777, 0o600); assert.equal(statSync(f.ram).mode & 0o777, 0o700);
    assert.ok(f.trace().some(e => e.publish && e.tempMode === 0o600 && e.parentMode === 0o700)); clean(f);
  });
  it('reader sees old complete status until atomic publication', { skip: !posix }, async t => {
    const f = fixture(t, { pausePublish: true }), child = f.start('write', 'new result');
    const deadline = Date.now() + 8000;
    while (!existsSync(join(f.root, 'barrier')) && Date.now() < deadline) await delay(10);
    assert.ok(existsSync(join(f.root, 'barrier')), 'rename barrier reached');
    assert.deepEqual(parse(f.run('sync-status')), oldRecord); assert.equal(f.cache(), f.initial);
    writeFileSync(join(f.root, 'release'), 'continue'); const r = await child.done;
    assert.equal(r.status, 0, r.stderr); assert.equal(parse(f.run('sync-status')).message, 'new result'); clean(f);
  });
});

describe('Yandex sync status read boundary', () => {
  it('supports old valid status and true booleans without changing it', t => { const f = fixture(t), r = f.run('sync-status'); assert.equal(r.status, 0, r.stderr); assert.deepEqual(parse(r), oldRecord); assert.equal(f.cache(), f.initial); });
  it('returns a real false boolean and preserves multiline Russian status text', t => {
    const record = { ...oldRecord, ok: false, message: 'Копия \\"архива\\" \\ путь\n\tстрока\n' };
    const f = fixture(t, { statusText: JSON.stringify(record, null, 2) }), r = f.run('sync-status');
    assert.equal(r.status, 0, r.stderr); assert.deepEqual(parse(r), record); assert.equal(parse(r).ok, false);
  });
  it('absence remains no sync yet', t => { const f = fixture(t, { noStatus: true }), r = f.run('sync-status'); assert.equal(r.status, 0); assert.deepEqual(parse(r), { ok: false, message: 'no sync yet' }); });
  for (const [label, statusText] of [
    ['empty', ''], ['truncated', '{"ok":true'], ['missing fields', '{"ok":true}'],
    ['wrong boolean type', JSON.stringify({ ...oldRecord, ok: 'false' })],
    ['unexpected field', JSON.stringify({ ...oldRecord, password: 'must not leak' })],
    ['invalid command', JSON.stringify({ ...oldRecord, command: 'restore-config' })],
    ['invalid time', JSON.stringify({ ...oldRecord, at: 'not a timestamp' })],
    ['array', JSON.stringify([oldRecord])],
    ['oversize whitespace', JSON.stringify(oldRecord) + '\n'.repeat(9000)],
  ]) it(`rejects ${label} instead of returning a valid-looking or partial status`, t => {
    const f = fixture(t, { statusText }), r = f.run('sync-status'); assert.notEqual(r.status, 0); assert.equal(parse(r).error, 'sync_status_unavailable'); assert.equal(f.cache(), statusText);
  });
  for (const fault of ['read', 'parser']) it(`discards partial output after ${fault} error`, t => {
    const f = fixture(t, { fault }), r = f.run('sync-status'); assert.notEqual(r.status, 0); assert.equal(parse(r).error, 'sync_status_unavailable');
    assert.ok(f.trace().some(e => e.fault === fault), 'fault reached'); assert.equal(f.cache(), f.initial);
  });
  for (const target of ['link', 'directory', 'parentLink']) it(`does not read ${target} as a stored sync result`, { skip: !posix }, t => {
    const f = fixture(t, { target }), r = f.run('sync-status'); assert.notEqual(r.status, 0); assert.equal(parse(r).error, 'sync_status_unavailable'); assert.ok(!r.stdout.includes('foreign data'));
  });
  it('reports missing jshn instead of echoing the unchecked file', t => { const f = fixture(t, { noJshn: true }), r = f.run('sync-status'); assert.notEqual(r.status, 0); assert.equal(parse(r).error, 'sync_status_unavailable'); });
  it('reads at most 8193 bytes before rejecting an oversized record', t => {
    const f = fixture(t, { statusText: 'x'.repeat(50000) }), r = f.run('sync-status'); assert.notEqual(r.status, 0); assert.equal(parse(r).error, 'sync_status_unavailable');
    assert.ok(f.trace().some(e => e.readLimit === '8193')); assert.ok(!f.trace().some(e => e.parser));
  });
});
