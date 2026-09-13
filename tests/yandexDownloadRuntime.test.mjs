/*
 * Настоящий download с изолированными путями. HTTP/UCI — записывающие модели,
 * файлы и rename — реальные. Искусственный отказ обязан оставить trace.
 * Не доказывает XML/restore, native UCI, сервис Яндекса или checksum.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { shellTestPath } from '../tools/quality/testEnvironment.mjs';

const repo = resolve(import.meta.dirname, '..');
const runtime = join(repo, 'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold');
const posix = process.platform !== 'win32';
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const oldBytes = Buffer.from('KEEP previous local copy\n');
const newBytes = Buffer.from('Downloaded copy: тест\n');
const pythonCmd = process.env.PYTHON_EXECUTABLE || (posix ? 'python3' : 'python');
const python = /[\\/]/.test(pythonCmd) ? shellTestPath(pythonCmd, { cwd: repo }) : pythonCmd;

function fixture(t, options = {}) {
  const base = join(repo, '.build', 'yandex-download-fixtures'); mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'case-')), bin = join(root, 'bin'), tmp = join(root, 'tmp');
  const foreign = join(root, 'foreign');
  for (const dir of [bin, tmp, foreign]) mkdirSync(dir);
  writeFileSync(join(foreign, 'keep'), oldBytes);
  const path = p => shellTestPath(p, { cwd: repo, allowedRoot: root });
  const traceFile = join(root, 'trace.jsonl'), stateFile = join(root, 'state.json'), optsFile = join(root, 'options.json');
  writeFileSync(traceFile, ''); writeFileSync(stateFile, '{}');
  let target = join(tmp, 'downloads', options.localName || 'copy.tar');
  mkdirSync(join(tmp, 'downloads'));
  if (options.target === 'traversal') target = path(tmp) + '/../foreign/keep';
  else if (options.target === 'outside') target = join(foreign, 'keep');
  else if (options.target === 'link') symlinkSync(join(foreign, 'keep'), target);
  else if (options.target === 'parentLink') { symlinkSync(foreign, join(tmp, 'alias')); target = join(tmp, 'alias', 'keep'); }
  else if (options.target === 'directory') mkdirSync(target);
  else if (options.target === 'fifo') { const p = spawnSync('mkfifo', [target]); assert.equal(p.status, 0); }
  else if (options.target === 'trailing') target = path(tmp) + '/downloads/';
  else if (options.target === 'doubleSlash') target = path(tmp) + '//downloads/copy.tar';
  else if (options.target === 'nested') target = join(tmp, 'new', 'nested', 'copy.tar');
  else if (!options.missing) writeFileSync(target, oldBytes);
  const sourcePath = join(process.env.SHEEPFOLD_YANDEX_TEST_SOURCE || runtime, 'sheepfold-yandex-disk');
  const source = readFileSync(sourcePath, 'utf8');
  const mapped = source.replaceAll('/tmp', path(tmp)).replaceAll('/usr/libexec/sheepfold/', path(bin) + '/');
  const put = (name, value) => { writeFileSync(join(bin, name), value); chmodSync(join(bin, name), 0o755); };
  put('entry', mapped);
  const marker = '\ncommand_name="${1:-}"'; assert.ok(mapped.lastIndexOf(marker) > 0);
  put('library', mapped.slice(0, mapped.lastIndexOf(marker)) + '\n');
  const real = {};
  for (const name of ['chmod', 'mkdir', 'mktemp', 'mv', 'wc', 'awk']) {
    const r = spawnSync('sh', ['-c', 'command -v "$1"', 'tool', name], { encoding: 'utf8' });
    assert.equal(r.status, 0); let tool = r.stdout.trim();
    if (!posix) { const p = spawnSync('sh', ['-c', 'cygpath -w "$1"', 'tool', tool], { encoding: 'utf8' }); assert.equal(p.status, 0); tool = p.stdout.trim(); }
    real[name] = tool;
  }
  writeFileSync(join(root, 'tools.json'), JSON.stringify(real));
  writeFileSync(optsFile, JSON.stringify({ content: newBytes.toString('hex'), ...options }));
  const faultTool = { mktemp: 'mktemp', mkdir: 'mkdir', 'chmod-work': 'chmod', 'chmod-content': 'chmod', mv: 'mv', 'wc-content': 'wc', 'json-quote': 'awk' }[options.fault];
  for (const name of ['uci', 'curl', ...(faultTool ? [faultTool] : [])]) put(name, `#!/bin/sh\nexec ${quote(python)} -S ${quote(path(join(bin, 'tool.py')))} ${quote(name)} "$@"\n`);
  put('tool.py', `import sys,os,json,pathlib,subprocess,stat
kind=sys.argv[1]; args=sys.argv[2:]; opts=json.load(open(os.environ['YD_OPTIONS'])); stateFile=pathlib.Path(os.environ['YD_STATE']); state=json.loads(stateFile.read_text())
def record(**data):
 with open(os.environ['YD_TRACE'],'a') as f: f.write(json.dumps(dict(kind=kind,**data))+'\\n')
def fault(name): record(fault=name,args=args); sys.exit(1)
def save(): stateFile.write_text(json.dumps(state))
if kind=='uci':
 a=[v for v in args if v!='-q']; record(args=a)
 vals={'sheepfold.cloud.login':'synthetic@example.invalid','sheepfold.cloud.password':'not-real','sheepfold.cloud.root_folder':'/sheepfold','sheepfold.cloud.quota_mb':'500'}
 if state.get('changed'): vals[opts.get('changeKey','sheepfold.cloud.password')]='changed-setting'
 if a[0]=='get':
  if a[1]==opts.get('getFault'): print('partial',end=''); fault('uci-get')
  if a[1] not in vals: sys.exit(1)
  print(vals[a[1]],end=''); sys.exit(0)
 if a[0]=='show':
  state['shows']=state.get('shows',0)+1;save()
  if state['shows']==opts.get('showFaultAt'): print('partial',end='');fault('uci-show')
  print('sheepfold.cloud=yandex_disk')
  for k,v in sorted(vals.items()):print(k+'='+repr(v))
  sys.exit(0)
 fault('uci-write')
if kind=='curl':
 values={};urls=[];headers=[];i=0
 while i<len(args):
  a=args[i]
  if a in ['-m','-o','-w','-u','-X','-H','--proto','--url','--max-filesize','-D']:
   values[a]=args[i+1]
   if a=='--url':urls.append(args[i+1])
   if a=='-H':headers.append(args[i+1])
   i+=2
  elif a.startswith('-'):i+=1
  else:urls.append(a);i+=1
 method=values.get('-X','HEAD' if '--head' in args else 'GET'); data=bytes.fromhex(opts['content']); body=b''
 code='200';exitCode=0
 if method=='HEAD':
  state['heads']=state.get('heads',0)+1;save();n=state['heads'];sizes=opts.get('sizes',[len(data)]);size=sizes[min(n-1,len(sizes)-1)]
  code=str(opts.get('headHttp',200));exitCode=opts.get('headExit',0)
  if opts.get('headFailAt')==n:code='500'
  hs=opts.get('headers','HTTP/1.1 200 OK\\r\\nContent-Length: '+str(size)+'\\r\\n\\r\\n')
  if '-D' in values:pathlib.Path(values['-D']).write_bytes(hs.encode())
 elif method=='GET':
  body=bytes.fromhex(opts.get('getContent',opts['content']));code=str(opts.get('getHttp',200));exitCode=opts.get('getExit',0)
  if '-o' in values and values['-o']!='/dev/null':pathlib.Path(values['-o']).write_bytes(body)
  else:sys.stdout.buffer.write(body)
 else:code='500'
 mode=None;parentMode=None
 if method=='GET' and '-o' in values and pathlib.Path(values['-o']).is_file():
  mode=stat.S_IMODE(pathlib.Path(values['-o']).stat().st_mode)&0o777;parentMode=stat.S_IMODE(pathlib.Path(values['-o']).parent.stat().st_mode)&0o777
 stage=('head'+str(state.get('heads',0))) if method=='HEAD' else 'get'
 if stage==opts.get('changeAt'):state['changed']=True;save();record(changeAt=stage)
 if stage==opts.get('replaceTargetAt'):
  target=pathlib.Path(os.environ['YD_TARGET']);target.unlink();target.mkdir();record(replacedTarget=True)
 record(method=method,args=args,urls=urls,headers=headers,code=code,exit=exitCode,output=values.get('-o'),hex=body.hex(),mode=mode,parentMode=parentMode)
 sys.stdout.write(values.get('-w','').replace('%{http_code}',code).replace('\\\\n','\\n'));sys.exit(exitCode)
fail=opts.get('fault')
if kind=='mktemp' and fail=='mktemp' and '.yandex-download.' in ' '.join(args):print(os.environ['YD_FOREIGN'],end='');fault(fail)
if kind=='mkdir' and fail=='mkdir' and args[-1].endswith('/downloads'):fault(fail)
if kind=='chmod':
 if fail=='chmod-work' and '.yandex-download.' in args[-1] and not args[-1].endswith('/content'):fault(fail)
 if fail=='chmod-content' and args[-1].endswith('/content'):fault(fail)
if kind=='mv' and fail=='mv':fault(fail)
if kind=='wc':
 data=sys.stdin.buffer.read()
 if fail=='wc-content' and len(data)==len(bytes.fromhex(opts.get('getContent',opts['content']))):print('999',end='');fault(fail)
 real=json.load(open(os.environ['YD_TOOLS']));sys.exit(subprocess.run([real[kind],*args],input=data).returncode)
if kind=='awk' and fail=='json-quote' and 'printf' in ' '.join(args) and 'lengths' not in ' '.join(args) and 'codes' not in ' '.join(args) and 'sub(/^0+/' not in ' '.join(args): print('partial',end='');fault(fail)
real=json.load(open(os.environ['YD_TOOLS']));sys.exit(subprocess.run([real[kind],*args]).returncode)
`);
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', YD_OPTIONS: path(optsFile), YD_STATE: path(stateFile), YD_TRACE: path(traceFile), YD_TOOLS: path(join(root, 'tools.json')), YD_TARGET: path(target), YD_FOREIGN: path(foreign) };
  const results = [];
  const capture = r => { results.push({ status: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error?.message }); assert.ifError(r.error); return r; };
  // shellTestPath нормализует '..' и '//'; тестовый ввод сохраняем буквально,
  // иначе это проверяло бы другой путь, уже исправленный самим стендом.
  const rawTarget = { traversal: path(tmp) + '/../foreign/keep', doubleSlash: path(tmp) + '//downloads/copy.tar', trailing: path(tmp) + '/downloads/' }[options.target];
  const run = (remote = 'backups/copy.tar', dest = target) => capture(spawnSync('sh', ['-c', `export PATH=${quote(path(bin))}:"$PATH"; exec sh "$@"`, 'fixture', path(join(bin, 'entry')), 'download', remote, dest === target && rawTarget ? rawTarget : path(dest)], { cwd: root, env, encoding: 'utf8', timeout: 20000 }));
  const args = values => capture(spawnSync('sh', ['-c', `export PATH=${quote(path(bin))}:"$PATH"; exec sh "$@"`, 'fixture', path(join(bin, 'entry')), 'download', ...values], { cwd: root, env, encoding: 'utf8', timeout: 20000 }));
  const events = () => readFileSync(traceFile, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const curls = () => events().filter(e => e.method);
  const leftovers = () => {
    const found = [];
    function walk(dir) { for (const item of readdirSync(dir, { withFileTypes: true })) { if (item.name.startsWith('.yandex-download.') || item.name.startsWith('.yandex-transfer.')) found.push(join(dir, item.name)); else if (item.isDirectory()) walk(join(dir, item.name)); } }
    walk(tmp); return found;
  };
  const preserved = () => { assert.ok(existsSync(target), 'previous file still exists'); assert.deepEqual(readFileSync(target), oldBytes); assert.deepEqual(readFileSync(join(foreign, 'keep')), oldBytes); assert.deepEqual(leftovers(), []); };
  t.after(() => {
    if (process.env.SHEEPFOLD_YANDEX_DOWNLOAD_EVIDENCE_DIR) {
      const dest = process.env.SHEEPFOLD_YANDEX_DOWNLOAD_EVIDENCE_DIR; mkdirSync(dest, { recursive: true });
      writeFileSync(join(dest, createHash('sha256').update(t.name).digest('hex').slice(0, 16) + '.json'), JSON.stringify({ scenario: t.name, sourceDigest: createHash('sha256').update(source).digest('hex'), options, results, events: events(), targetExists: existsSync(target), targetHex: existsSync(target) && statSync(target).isFile() ? readFileSync(target).toString('hex') : null, foreignHex: readFileSync(join(foreign, 'keep')).toString('hex'), leftovers: leftovers() }, null, 2) + '\n');
    }
    rmSync(root, { recursive: true, force: true });
  });
  return { run, args, target, tmp, foreign, events, curls, preserved, leftovers };
}
const json = r => JSON.parse(r.stdout);
const failed = (r, code) => { assert.notEqual(r.status, 0, r.stdout); assert.equal(json(r).ok, false); if (code) assert.equal(json(r).error, code); };

describe('Yandex download: complete read before publishing local copy', () => {
  for (const [label, remote] of [['backup', 'copy.tar'], ['logs', 'logs/events.log'], ['absolute', '/sheepfold/backups/copy.tar'], ['encoded name', 'logs/тест #?%2F&+.log']]) it(`downloads ${label} through HEAD GET HEAD`, t => {
    const f = fixture(t); const r = f.run(remote); assert.equal(r.status, 0, r.stderr); assert.equal(json(r).ok, true); assert.deepEqual(readFileSync(f.target), newBytes); assert.equal(json(r).bytes, newBytes.length);
    assert.deepEqual(f.curls().map(e => e.method), ['HEAD', 'GET', 'HEAD']); assert.equal(new Set(f.curls().map(e => e.urls[0])).size, 1); assert.deepEqual(f.leftovers(), []);
    const get = f.curls()[1]; assert.equal(get.urls.length, 1); assert.equal(get.args[0], '-q'); assert.ok(get.args.includes('-g')); assert.ok(get.args.includes('--max-filesize')); assert.ok(!get.args.includes('-L')); assert.ok(!get.args.includes('-k'));
    if (posix) { assert.equal(get.mode, 0o600); assert.equal(get.parentMode, 0o700); assert.equal(statSync(f.target).mode & 0o777, 0o600); }
    if (label === 'encoded name') assert.ok(get.urls[0].includes('%252F'));
  });
  for (const content of ['', '0001ff0080410d0a']) it(`retains binary or empty bytes ${content || 'empty'}`, t => {
    const f = fixture(t, { content }); const r = f.run(); assert.equal(r.status, 0, r.stderr); assert.deepEqual(readFileSync(f.target), Buffer.from(content, 'hex')); assert.equal(json(r).bytes, content.length / 2);
  });
  it('creates missing nested directories and quotes names in JSON', t => {
    const f = fixture(t, { target: 'nested' }); const r = f.run('logs/name"\\x.log'); assert.equal(r.status, 0, r.stderr); assert.equal(json(r).remote, '/sheepfold/logs/name"\\x.log'); assert.deepEqual(readFileSync(f.target), newBytes);
  });
  for (const argv of [[], ['logs/file'], ['', ''], ['a', 'b', 'extra']]) it(`rejects arguments ${JSON.stringify(argv)} without side effects`, t => {
    const f = fixture(t); failed(f.args(argv), 'usage'); f.preserved(); assert.equal(f.curls().length, 0);
  });
  for (const remote of ['/elsewhere/file', 'logs/../other', 'logs/bad\nfile']) it(`rejects remote path ${JSON.stringify(remote)}`, t => {
    const f = fixture(t); failed(f.run(remote), 'path_not_allowed'); f.preserved(); assert.equal(f.curls().length, 0);
  });
  for (const target of ['outside', 'traversal', 'link', 'parentLink', 'directory', 'fifo', 'trailing', 'doubleSlash']) it(`rejects local target ${target}`, { skip: !posix && ['link', 'parentLink', 'fifo'].includes(target) }, t => {
    const f = fixture(t, { target }); failed(f.run(), 'local_path_not_allowed'); assert.deepEqual(readFileSync(join(f.foreign, 'keep')), oldBytes); assert.equal(f.curls().length, 0); assert.deepEqual(f.leftovers(), []);
  });
  for (const getHttp of [201, 204, 206, 301, 401, 403, 404, 500, '000', 'garbage']) it(`preserves old copy for GET HTTP ${getHttp}`, t => {
    const f = fixture(t, { getHttp }); failed(f.run(), 'download_failed'); f.preserved(); assert.equal(f.curls().filter(e => e.method === 'GET').length, 1);
  });
  it('preserves old copy when curl writes a partial body and exits 18', t => {
    const f = fixture(t, { getContent: Buffer.from('short').toString('hex'), getExit: 18 }); const r = f.run(); failed(r, 'download_failed'); assert.equal(json(r).http, 0); f.preserved(); assert.equal(f.curls().find(e => e.method === 'GET').exit, 18);
  });
  it('rejects short body even when GET returned 200 successfully', t => {
    const f = fixture(t, { getContent: Buffer.from('short').toString('hex') }); failed(f.run(), 'download_size_mismatch'); f.preserved(); assert.ok(f.curls().some(e => e.method === 'GET'));
  });
  for (const options of [{ headHttp: 404 }, { headExit: 18 }, { headers: 'HTTP/1.1 200 OK\r\n\r\n' }, { headers: 'HTTP/1.1 200 OK\r\nContent-Length: 10\r\nContent-Length: 10\r\n\r\n' }]) it(`does not start GET after bad initial metadata ${JSON.stringify(options)}`, t => {
    const f = fixture(t, options); failed(f.run(), 'download_metadata_failed'); f.preserved(); assert.deepEqual(f.curls().map(e => e.method), ['HEAD']);
  });
  for (const options of [{ headFailAt: 2 }, { sizes: [newBytes.length, newBytes.length + 1] }]) it(`preserves old copy on changed final metadata ${JSON.stringify(options)}`, t => {
    const f = fixture(t, options); failed(f.run(), options.headFailAt ? 'download_metadata_failed' : 'download_remote_changed'); f.preserved(); assert.deepEqual(f.curls().map(e => e.method), ['HEAD', 'GET', 'HEAD']);
  });
  for (const changeAt of ['head1', 'get', 'head2']) it(`stops after settings change at ${changeAt}`, t => {
    const f = fixture(t, { changeAt }); failed(f.run()); f.preserved(); assert.ok(f.events().some(e => e.changeAt === changeAt)); const later = f.curls(); assert.equal(later.length, { head1: 1, get: 2, head2: 3 }[changeAt]);
  });
  for (const opts of [{ getFault: 'sheepfold.cloud.password' }, { getFault: 'sheepfold.cloud.root_folder' }, { showFaultAt: 1 }]) it(`does not send partial settings ${JSON.stringify(opts)}`, t => {
    const f = fixture(t, opts); failed(f.run()); f.preserved(); assert.ok(f.events().some(e => e.fault?.startsWith('uci-'))); assert.equal(f.curls().length, 0);
  });
  for (const fault of ['mkdir', 'mktemp', 'chmod-work', 'chmod-content', 'mv', 'wc-content', 'json-quote']) it(`preserves old copy after reached ${fault} failure`, t => {
    const f = fixture(t, { fault }); failed(f.run(), 'download_local_failed'); f.preserved(); assert.ok(f.events().some(e => e.fault === fault), JSON.stringify(f.events()));
  });
  it('does not move payload inside a directory replacing the final target', { skip: !posix }, t => {
    const f = fixture(t, { replaceTargetAt: 'head2' }); failed(f.run(), 'local_path_not_allowed'); assert.ok(statSync(f.target).isDirectory()); assert.deepEqual(readdirSync(f.target), []); assert.ok(f.events().some(e => e.replacedTarget)); assert.deepEqual(f.leftovers(), []);
  });
});
