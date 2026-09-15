/*
 * Executes the real Yandex command in isolated .build directories. HTTP and UCI
 * are recording models; files, tar, cmp and flock are native (Windows lock is a
 * declared stub). Proves quota input and command-wide settings consistency, not
 * DAV XML/quota arithmetic, real accounts, native libuci or distributed rollback.
 * r323: смена выбранного backend и отказ повторного чтения останавливают sender;
 * несвязанный global.block_all не отменяет отправку. Проверяется точка изменения.
 * Fault/mutation assertions require trace evidence. All synthetic data is removed.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { runtimeTimeout, completedProcess } from './helpers/runtimeProcess.mjs';
import { shellTestPath } from '../tools/quality/testEnvironment.mjs';

const repo = resolve(import.meta.dirname, '..');
const runtime = join(repo, 'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold');
const quote = v => `'${String(v).replaceAll("'", "'\\''")}'`;
const pythonName = process.env.PYTHON_EXECUTABLE || (process.platform === 'win32' ? 'python' : 'python3');
const python = /[\\/]/.test(pythonName) ? shellTestPath(pythonName, { cwd: repo }) : pythonName;
const initialCloud = { login: 'synthetic-parent', password: 'synthetic-old-password', root_folder: '/old-root', quota_mb: '50' };

function fixture(t, options = {}) {
  const parent = join(repo, '.build', 'yandex-context'); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'case-'));
  const bin = join(root, 'bin'), ram = join(root, 'ram'), config = join(root, 'config');
  for (const dir of [bin, ram, config]) mkdirSync(dir);
  const path = v => shellTestPath(v, { cwd: repo, allowedRoot: root });
  const queue = join(ram, '.private', 'archive'); mkdirSync(queue, { recursive: true });
  const archives = ['pending-a.tar', 'pending-b.tar'].map(name => join(queue, name));
  for (const file of archives) writeFileSync(file, 'synthetic archive ' + file.split('/').at(-1));
  if (options.events) writeFileSync(join(ram, 'events.log'), 'synthetic journal\n');
  const configText = "config global 'global'\n\toption block_all '0'\n";
  writeFileSync(join(config, 'sheepfold'), configText);
  const cloud = { ...initialCloud };
  if (Object.hasOwn(options, 'quota')) cloud.quota_mb = options.quota;
  if (options.noQuota) delete cloud.quota_mb;
  const statePath = join(root, 'state.json'), optionsPath = join(root, 'options.json'), tracePath = join(root, 'trace.jsonl');
  writeFileSync(statePath, JSON.stringify({ cloud, storage: options.storage ?? 'yandex_disk', files: {}, counters: {}, mutated: false }));
  writeFileSync(optionsPath, JSON.stringify(options)); writeFileSync(tracePath, '');
  const text = readFileSync(join(process.env.SHEEPFOLD_YANDEX_TEST_SOURCE || runtime, 'sheepfold-yandex-disk'), 'utf8');
  const sourceDigest = createHash('sha256').update(text).digest('hex');
  const map = s => s.replaceAll('/tmp/sheepfold', path(ram)).replaceAll('/etc/config', path(config)).replaceAll('/usr/libexec/sheepfold/', path(bin) + '/');
  const put = (name, body) => { writeFileSync(join(bin, name), body); chmodSync(join(bin, name), 0o755); };
  put('entry', map(text));
  const boundary = '\ncommand_name="${1:-}"'; assert.ok(text.includes(boundary));
  put('library', map(text.slice(0, text.lastIndexOf(boundary))));
  for (const name of ['sheepfold-log-common', 'sheepfold-lock-common']) put(name, map(readFileSync(join(runtime, name), 'utf8')));
  if (process.platform === 'win32') put('flock', '#!/bin/sh\nexit 0\n');
  for (const name of ['uci', 'curl']) put(name, `#!/bin/sh\nexec ${quote(python)} -S ${quote(path(join(bin, 'model.py')))} ${name} "$@"\n`);
  put('model.py', `import sys,os,json,pathlib
kind=sys.argv[1];args=sys.argv[2:];opts=json.load(open(os.environ['YC_OPTIONS']));statePath=pathlib.Path(os.environ['YC_STATE']);state=json.loads(statePath.read_text())
def record(**event):
 with open(os.environ['YC_TRACE'],'a') as f:f.write(json.dumps(dict(tool=kind,**event))+'\\n')
def save():statePath.write_text(json.dumps(state))
def mutate(at):
 if state['mutated'] or opts.get('changeAt')!=at:return
 field=opts.get('changeField','password');value=opts.get('changeValue',{'password':'synthetic-new-password','login':'synthetic-new-parent','root_folder':'/new-root','quota_mb':'100','log_storage':'ram','block_all':'1'}[field])
 if field=='log_storage':state['storage']=value
 elif field=='block_all':state['block_all']=value
 else:state['cloud'][field]=value
 state['mutated']=True;save();record(changeAt=at,field=field,value=value)
def fail(name):record(fault=name);sys.exit(9)
if kind=='uci':
 a=[v for v in args if v!='-q'];record(args=a)
 if a[0]=='show':
  if a[1]=='sheepfold.cloud':
   if opts.get('showFault') or (opts.get('showFaultAfterMutation') and state['mutated']):print('sheepfold.cloud=cloud');fail('cloud-show')
   print('sheepfold.cloud=cloud')
   for k,v in state['cloud'].items():print('sheepfold.cloud.'+k+'='+repr(v))
  elif a[1] in ('sheepfold','sheepfold.global'):print('sheepfold.global=global')
  else:fail('unexpected-show')
  sys.exit(0)
 if a[0]=='get':
  key=a[1]
  if key=='sheepfold.global.log_storage':
   if opts.get('storageFaultAfterMutation') and state['mutated']:print(opts.get('storagePartial',''),end='');fail('storage-read')
   if state['storage'] is None:sys.exit(1)
   print(state['storage'],end='');sys.exit(0)
  if key.startswith('sheepfold.cloud.'):
   field=key.split('.')[-1]
   if field=='quota_mb' and opts.get('quotaFault'):print(opts.get('partial',''),end='');fail('quota-read')
   if field not in state['cloud']:sys.exit(1)
   value=state['cloud'][field]
   if field=='quota_mb':mutate('quota-read')
   print(value,end='');sys.exit(0)
  sys.exit(1)
 fail('unexpected-uci-write')
if kind=='curl':
 values={};i=0
 while i<len(args):
  if args[i] in ['-m','-o','-w','-u','-X','-H','--proto','--url','-T','-D']:
   values[args[i]]=args[i+1];i+=2
  else:i+=1
 method=values.get('-X','HEAD' if '--head' in args else ('PUT' if '-T' in values else 'GET'));url=values.get('--url','');http='207';body='';rc=0
 counter=state['counters'].get(method,0)+1;state['counters'][method]=counter;save()
 record(method=method,url=url,auth=values.get('-u'),number=counter)
 if method=='PROPFIND':
  body='<d:multistatus xmlns:d="DAV:"/>'
  if url.endswith('.ru/'):mutate('probe')
 if method=='MKCOL':
  http='201'
  if counter==1:mutate('mkcol-first')
  if counter==5:mutate('mkcol-last')
 if method=='PUT':
  http='201';data=pathlib.Path(values['-T']).read_bytes();state['files'][url]=data.hex();save();record(uploadHex=data.hex())
  if counter==1:mutate('put-first')
 if method=='HEAD':
  http='200';size=len(bytes.fromhex(state['files'].get(url,'')))
  pathlib.Path(values['-D']).write_bytes(('HTTP/1.1 200 OK\\r\\nContent-Length: '+str(size)+'\\r\\n\\r\\n').encode())
  if counter==1:mutate('head-first')
  if '/backups/' in url:mutate('head-final')
 if method=='DELETE':fail('unexpected-delete')
 if '-o' not in values:print(body,end='')
 elif values['-o']!='/dev/null':pathlib.Path(values['-o']).write_text(body)
 print(values.get('-w','').replace('%{http_code}',http).replace('\\\\n','\\n'),end='');sys.exit(rc)
fail('unknown-tool')
`);
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', YC_OPTIONS: path(optionsPath), YC_TRACE: path(tracePath), YC_STATE: path(statePath) };
  const results = [];
  const run = (action = 'archive-push') => {
    const cmd = action === 'quota' ? `. ${quote(path(join(bin, 'library')))}; quota_mb` : `exec sh ${quote(path(join(bin, 'entry')))} ${quote(action)}`;
    const r = spawnSync('sh', ['-c', `export PATH=${quote(path(bin))}:"$PATH"; ${cmd}`], { cwd: repo, env, encoding: 'utf8', timeout: runtimeTimeout(20000) });
    completedProcess(r, 'Yandex context fixture'); results.push({ action, status: r.status, stdout: r.stdout, stderr: r.stderr }); return r;
  };
  const events = () => readFileSync(tracePath, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const saved = () => JSON.parse(readFileSync(statePath, 'utf8'));
  t.after(() => {
    if (process.env.SHEEPFOLD_YANDEX_CONTEXT_EVIDENCE_DIR) {
      const dest = process.env.SHEEPFOLD_YANDEX_CONTEXT_EVIDENCE_DIR; mkdirSync(dest, { recursive: true });
      const id = createHash('sha256').update(t.name).digest('hex').slice(0, 16);
      writeFileSync(join(dest, id + '.json'), JSON.stringify({ name: t.name, options, sourceDigest, results, events: events(), state: saved(), archives: archives.map(p => ({ name: p.split('/').at(-1), exists: existsSync(p), hex: existsSync(p) ? readFileSync(p).toString('hex') : null })), configUnchanged: readFileSync(join(config, 'sheepfold'), 'utf8') === configText }, null, 2));
    }
    rmSync(root, { recursive: true, force: true });
  });
  return { run, events, archives, ram, saved };
}
const parsed = r => JSON.parse(r.stdout);
const requests = f => f.events().filter(e => e.method);
const noMutationRequests = f => assert.ok(!requests(f).some(e => ['MKCOL', 'PUT', 'DELETE'].includes(e.method)));

describe('Yandex quota setting boundary', () => {
  for (const quota of ['50', '100', '250', '500', '1024']) it(`accepts configured quota ${quota}`, t => {
    const f = fixture(t, { quota }), r = f.run('quota'); assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, quota);
  });
  it('defaults to 500 only on a confirmed absent quota', t => {
    const f = fixture(t, { noQuota: true }), r = f.run('quota'); assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, '500');
  });
  for (const quota of ['', 'other', '-50', '050', '50\n100']) it(`rejects invalid quota ${JSON.stringify(quota)}`, t => {
    const f = fixture(t, { quota }), r = f.run('quota'); assert.notEqual(r.status, 0); assert.equal(r.stdout, '');
  });
  for (const partial of ['', '50']) it(`rejects failed quota read with partial ${JSON.stringify(partial)}`, t => {
    const f = fixture(t, { quotaFault: true, partial }), r = f.run('quota'); assert.notEqual(r.status, 0); assert.equal(r.stdout, ''); assert.ok(f.events().some(e => e.fault === 'quota-read'));
  });
  it('rejects failed cloud read instead of using a default', t => {
    const f = fixture(t, { showFault: true }), r = f.run('quota'); assert.notEqual(r.status, 0); assert.equal(r.stdout, ''); assert.ok(f.events().some(e => e.fault === 'cloud-show'));
  });
  it('detects changed quota during its read', t => {
    const f = fixture(t, { changeAt: 'quota-read', changeField: 'quota_mb' }), r = f.run('quota'); assert.notEqual(r.status, 0); assert.equal(r.stdout, ''); assert.ok(f.saved().mutated);
  });
  for (const partial of ['', '50']) it(`status does not claim spare quota after read failure ${JSON.stringify(partial)}`, t => {
    const f = fixture(t, { quotaFault: true, partial }), r = f.run('status'); assert.equal(r.status, 0, r.stderr);
    assert.equal(parsed(r).state, 'error'); assert.equal(parsed(r).free_pct, 0); assert.equal(parsed(r).quota_mb, 0);
    assert.ok(f.events().some(e => e.fault === 'quota-read')); noMutationRequests(f);
  });
  it('quota read still fails independently while the privacy gate stops archive first', t => {
    const f = fixture(t, { quotaFault: true }), quota = f.run('quota');
    assert.notEqual(quota.status, 0); assert.equal(quota.stdout, '');
    assert.ok(f.events().some(e => e.fault === 'quota-read'), 'quota fault actually reached');
    const before = f.events().length, r = f.run();
    assert.notEqual(r.status, 0); assert.equal(parsed(r).error, 'config_backup_unavailable');
    assert.ok(!f.events().slice(before).some(e => e.fault === 'quota-read'), 'archive stops before quota');
    assert.equal(requests(f).length, 0); assert.ok(f.archives.every(existsSync));
  });
  it('absent quota keeps its default but does not authorize a raw archive', t => {
    const f = fixture(t, { noQuota: true }), quota = f.run('quota');
    assert.equal(quota.status, 0, quota.stderr); assert.equal(quota.stdout, '500');
    const r = f.run(); assert.notEqual(r.status, 0); assert.equal(parsed(r).error, 'config_backup_unavailable');
    assert.equal(f.saved().cloud.quota_mb, undefined); assert.equal(requests(f).length, 0);
    assert.ok(f.archives.every(existsSync));
  });
});

describe('Yandex command-wide destination context', () => {


  for (const changeAt of ['mkcol-first', 'put-first', 'head-first']) it(`push-events stops after root changes at ${changeAt}`, t => {
    const f = fixture(t, { events: true, changeAt, changeField: 'root_folder' }), r = f.run('push-events');
    assert.ok(f.saved().mutated); assert.notEqual(r.status, 0); assert.equal(parsed(r).ok, false);
    const es = f.events(), index = es.findIndex(e => e.changeAt === changeAt); assert.ok(!es.slice(index + 1).some(e => e.method));
    assert.equal(readFileSync(join(f.ram, 'events.log'), 'utf8'), 'synthetic journal\n');
  });

  it('a confirmed absent journal remains a skip', t => {
    const f = fixture(t, { showFault: true }), r = f.run('push-events'); assert.equal(r.status, 0); assert.equal(r.stdout, ''); assert.equal(requests(f).length, 0);
  });
});

// HTTP-модель меняет только global.log_storage; cloud-реквизиты остаются прежними.
describe('Yandex selected storage boundary', () => {


  for (const changeAt of ['mkcol-first', 'put-first', 'head-first']) it(`stops journal sender after backend switch at ${changeAt}`, t => {
    const f = fixture(t, { events: true, changeAt, changeField: 'log_storage' }), r = f.run('push-events');
    assert.ok(f.saved().mutated); assert.notEqual(r.status, 0); assert.equal(parsed(r).ok, false);
    const events = f.events(), at = events.findIndex(e => e.changeAt === changeAt);
    assert.ok(!events.slice(at + 1).some(e => e.method));
    assert.equal(readFileSync(join(f.ram, 'events.log'), 'utf8'), 'synthetic journal\n');
  });

});
