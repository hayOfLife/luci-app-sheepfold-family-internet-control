/*
 * Проверяет подготовку локального backup Яндекс Диска настоящими shell/cp/tar.
 * UCI/HTTP — синтетические модели; faults оставляют проверяемый trace. Несколько
 * orchestration-тестов явно заменяют только uploader: они доказывают порядок,
 * содержимое и владение staging, но не исправность PUT/XML/verify или restore.
 * Меняются только уникальные .build-каталоги; после теста они удаляются.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { shellTestPath } from '../tools/quality/testEnvironment.mjs';

const repo = resolve(import.meta.dirname, '..');
const runtime = join(repo, 'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold');
const pythonCommand = process.env.PYTHON_EXECUTABLE || (process.platform === 'win32' ? 'python' : 'python3');
const pythonShell = /[\\/]/.test(pythonCommand) ? shellTestPath(pythonCommand, { cwd: repo }) : pythonCommand;
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const stamp = '20260912-170000';
const configText = "config global 'global'\n\toption block_all '0'\n# UTF-8: тест\n";

function fixture(t, options = {}) {
  const parent = join(repo, '.build', 'yandex-backup-fixtures');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'case-'));
  const bin = join(root, 'bin'), ram = join(root, 'ram'), config = join(root, 'config');
  for (const dir of [bin, ram, config]) mkdirSync(dir);
  const archiveDir = join(ram, '.private', 'archive'); mkdirSync(archiveDir, { recursive: true });
  const archive = join(archiveDir, 'pending.tar');
  if (options.archive) writeFileSync(archive, 'original pending archive');
  if (options.events) writeFileSync(join(ram, 'events.log'), 'journal snapshot\n');
  if (!options.missingConfig) writeFileSync(join(config, 'sheepfold'), configText);
  const stage = join(ram, '.yandex-backup-staging');
  const foreign = join(root, 'foreign'); mkdirSync(foreign);
  writeFileSync(join(foreign, 'keep'), 'foreign data');
  if (options.stagingLink) symlinkSync(foreign, stage, 'dir');
  else mkdirSync(stage);
  const oldBackup = join(stage, `sheepfold-config-${stamp}.tar.gz`);
  const oldEvents = join(stage, `events-${stamp}.log`);
  writeFileSync(oldBackup, 'old backup must survive'); writeFileSync(oldEvents, 'old journal must survive');
  if (options.configLink) {
    rmSync(join(config, 'sheepfold')); writeFileSync(join(root, 'source'), configText);
    symlinkSync(join(root, 'source'), join(config, 'sheepfold'));
  }
  const path = value => shellTestPath(value, { cwd: repo, allowedRoot: root });
  const tracePath = join(root, 'trace.jsonl'); writeFileSync(tracePath, '');
  const optionsPath = join(root, 'options.json'); writeFileSync(optionsPath, JSON.stringify(options));
  const source = readFileSync(join(process.env.SHEEPFOLD_YANDEX_TEST_SOURCE || runtime, 'sheepfold-yandex-disk'), 'utf8');
  const digest = createHash('sha256').update(source).digest('hex');
  const mapped = source.replaceAll('/tmp/sheepfold', path(ram)).replaceAll('/etc/config', path(config)).replaceAll('/usr/libexec/sheepfold/', path(bin) + '/');
  const put = (name, text) => { writeFileSync(join(bin, name), text); chmodSync(join(bin, name), 0o755); };
  put('entry', mapped);
  // На Windows эта модель только пропускает lock; его конкурентность проверяет Linux-suite.
  if (process.platform === 'win32') put('flock', '#!/bin/sh\nexit 0\n');
  // Экспортёр загружает настоящие общие readers/lock; пути остаются в fixture.
  for (const name of ['sheepfold-log-common', 'sheepfold-lock-common']) {
    put(name, readFileSync(join(runtime, name), 'utf8').replaceAll('/tmp/sheepfold', path(ram)));
  }

  const boundary = '\ncommand_name="${1:-}"'; assert.ok(mapped.lastIndexOf(boundary) > 0);
  put('library', mapped.slice(0, mapped.lastIndexOf(boundary)) + '\n');
  const toolNames = ['uci', 'curl', 'tar', 'cp', 'cmp', 'chmod', 'mktemp', 'date'];
  const realTools = {};
  for (const name of toolNames.filter(n => !['uci', 'curl'].includes(n))) {
    const which = spawnSync('sh', ['-c', 'command -v "$1"', 'which', name], { encoding: 'utf8' });
    assert.equal(which.status, 0);
    if (process.platform === 'win32') {
      const nativePath=spawnSync('sh',['-c','cygpath -w "$1"','native-path',which.stdout.trim()],{encoding:'utf8'});
      assert.equal(nativePath.status,0); realTools[name]=nativePath.stdout.trim();
    } else realTools[name] = which.stdout.trim();
  }
  writeFileSync(join(root, 'tools.json'), JSON.stringify(realTools));
  for (const name of toolNames) put(name, `#!/bin/sh\nexec ${quote(pythonShell)} -S ${quote(path(join(bin, 'tool.py')))} ${quote(name)} "$@"\n`);
  put('upload-model', `#!/bin/sh\nexec ${quote(pythonShell)} -S ${quote(path(join(bin, 'tool.py')))} upload "$@"\n`);
  put('tool.py', `import os,sys,json,pathlib,subprocess,tarfile,io,stat
kind=sys.argv[1]; args=sys.argv[2:]; opts=json.load(open(os.environ['BACKUP_OPTIONS']))
real=json.load(open(os.environ['BACKUP_TOOLS']))
def record(**kw):
 with open(os.environ['BACKUP_TRACE'],'a') as f: f.write(json.dumps({'kind':kind,**kw})+'\\n')
def fail(label):
 record(fault=label,args=args); sys.exit(1)
def out_path():
 for i,arg in enumerate(args):
  if arg.startswith('-') and 'f' in arg and i+1<len(args): return pathlib.Path(args[i+1])
 return None
fault=opts.get('fault','')
record(args=args)
if kind=='uci':
 a=[v for v in args if v!='-q']
 vals={'sheepfold.global.log_storage':opts.get('storage','yandex_disk'),'sheepfold.cloud.login':'test@example.invalid', 'sheepfold.cloud.password':'synthetic', 'sheepfold.cloud.root_folder':'/sheepfold','sheepfold.cloud.quota_mb':'500'}
 if a[0]=='get':
  if a[1] not in vals: sys.exit(1)
  print(vals[a[1]],end='')
 elif a[0]=='show':
  print('sheepfold.cloud=cloud')
  for key,val in vals.items():
   if key.startswith('sheepfold.cloud.'): print(key+'='+repr(val))
 else: fail('unexpected-uci-write')
 sys.exit(0)
if kind=='curl':
 method=args[args.index('-X')+1] if '-X' in args else ('PUT' if '-T' in args else 'GET')
 record(method=method)
 if method=='MKCOL': print('201',end='')
 elif method=='PROPFIND':
  if '-o' in args: print('207',end='')
  else: print('<d:multistatus xmlns:d="DAV:"/>\\n207',end='')
 else: print('500',end='')
 sys.exit(0)
if kind=='upload':
 p=pathlib.Path(args[0]); data=p.read_bytes(); entry={'path':str(p),'remote':args[1], 'mode':stat.S_IMODE(p.stat().st_mode),'parentMode':stat.S_IMODE(p.parent.stat().st_mode),'hex':data.hex()}
 if p.name.startswith('sheepfold-config-'):
  with tarfile.open(p) as tf: entry.update(members=tf.getnames(),configHex=tf.extractfile('sheepfold').read().hex())
 record(upload=entry)
 print('{"ok":true}')
 sys.exit(1 if opts.get('uploadFail') else 0)
if kind=='date':
 if args==['+%Y%m%d-%H%M%S']:
  if fault=='date': print('${stamp}',end=''); fail(fault)
  if fault=='stamp': print('../escape',end=''); record(fault=fault); sys.exit(0)
  print('${stamp}',end=''); sys.exit(0)
if kind=='mktemp' and fault=='mktemp':
 print(os.environ['BACKUP_OLD_STAGE'],end=''); fail(fault)
if kind=='cp':
 src=args[-2]; dst=pathlib.Path(args[-1])
 subject='config' if src.endswith('/config/sheepfold') else ('events' if src.endswith('/events.log') else '')
 if fault=='cp-'+subject:
  dst.write_bytes(b'partial'); fail(fault)
 if fault=='badcopy-'+subject:
  dst.write_bytes(b'wrong-content'); record(fault=fault); sys.exit(0)
if kind=='chmod':
 target=args[-1]
 if fault=='chmod-work' and '/.yandex-archive.' in target and '/config-' not in target and not target.endswith('.log'):
  fail(fault)
 if fault=='chmod-config' and target.endswith('/config-source/sheepfold'): fail(fault)
 if fault=='chmod-archive' and target.endswith('.tar.gz'): fail(fault)
if kind=='cmp' and fault=='cmp': fail(fault)
if kind=='tar':
 create=any(a.startswith('-') and 'c' in a and 'f' in a for a in args)
 listing=any(a.startswith('-') and 't' in a and 'f' in a for a in args)
 extract=any(a.startswith('-') and 'x' in a and 'f' in a for a in args)
 p=out_path()
 if create and fault=='tar-create': p.write_bytes(b'partial'); fail(fault)
 if create and fault in ('tar-corrupt','tar-extra','tar-wrong'):
  record(fault=fault)
  if fault=='tar-corrupt': p.write_bytes(b'not a tar')
  else:
   data=b'wrong config' if fault=='tar-wrong' else pathlib.Path(args[args.index('-C')+1], 'sheepfold').read_bytes()
   with tarfile.open(p,'w:gz') as tf:
    info=tarfile.TarInfo('sheepfold'); info.size=len(data); tf.addfile(info,io.BytesIO(data))
    if fault=='tar-extra':
     extra=tarfile.TarInfo('unexpected'); extra.size=0; tf.addfile(extra,io.BytesIO())
  sys.exit(0)
 if listing and fault=='tar-list': print('sheepfold'); fail(fault)
 if extract and fault=='tar-extract': print('partial'); fail(fault)
 if opts.get('busyboxTar'): result=subprocess.run(['/usr/bin/busybox','tar',*args]); sys.exit(result.returncode)
result=subprocess.run([real[kind],*args])
if kind=='tar' and any(a.startswith('-') and 'c' in a and 'f' in a for a in args) and result.returncode==0:
 p=out_path(); record(createdMode=stat.S_IMODE(p.stat().st_mode))
 if fault=='config-changed': pathlib.Path(os.environ['BACKUP_CONFIG']).write_text('changed during tar'); record(fault=fault)
sys.exit(result.returncode)
`);
  const env = { ...process.env, PYTHONUTF8:'1', PYTHONIOENCODING:'utf-8', BACKUP_OPTIONS: path(optionsPath), BACKUP_TRACE: path(tracePath), BACKUP_TOOLS: path(join(root, 'tools.json')), BACKUP_OLD_STAGE: path(stage), BACKUP_CONFIG: path(join(config, 'sheepfold')) };
  if (options.noGzip) {
    for (const name of ['sh','flock','sleep','mkdir','rm','basename','awk','sed','head','grep','sort','cat','tr','wc',...(/[\\/]/.test(pythonShell)?[]:[pythonShell])]) {
      const found=spawnSync('sh',['-c','command -v "$1"','which',name],{encoding:'utf8'});
      assert.equal(found.status,0); symlinkSync(found.stdout.trim(),join(bin,name));
    }
  }
  const results = [];
  const run = (mode = 'native') => {
    const prefix = `export PATH=${quote(path(bin))}${options.noGzip ? '' : ':"$PATH"'}; `;
    const script = mode === 'native' ? `${prefix}exec sh ${quote(path(join(bin, 'entry')))} archive-push` :
      `${prefix}. ${quote(path(join(bin, 'library')))}; upload_and_verify() { ${quote(path(join(bin, 'upload-model')))} "$@"; }; cmd_archive_push`;
    const result = spawnSync('sh', ['-c', script], { cwd: repo, env, encoding: 'utf8', timeout: 20000 });
    assert.ifError(result.error); results.push({ mode, status: result.status, stdout: result.stdout, stderr: result.stderr });
    return result;
  };
  const trace = () => readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  t.after(() => {
    if (process.env.SHEEPFOLD_YANDEX_BACKUP_EVIDENCE_DIR) {
      const destination = process.env.SHEEPFOLD_YANDEX_BACKUP_EVIDENCE_DIR; mkdirSync(destination,{recursive:true});
      const name = createHash('sha256').update(t.name).digest('hex').slice(0,16);
      writeFileSync(join(destination, name+'.json'), JSON.stringify({ name:t.name, digest, options, results, trace:trace(), archiveExists:existsSync(archive), oldBackup:existsSync(oldBackup)?readFileSync(oldBackup,'utf8'):null, oldEvents:existsSync(oldEvents)?readFileSync(oldEvents,'utf8'):null, leftovers:readdirSync(ram) }, null, 2));
    }
    rmSync(root,{recursive:true,force:true});
  });
  return { run, trace, archive, stage, ram, oldBackup, oldEvents, foreign };
}
const parse = r => JSON.parse(r.stdout);
const posix = process.platform !== 'win32';
const freshStages = f => readdirSync(f.ram).filter(n=>n.startsWith('.yandex-archive.'));

// Транспорт и старый verify не подменяются в негативных preflight-сценариях.
describe('Yandex archive preparation before mutation', () => {
  for (const [fault,error] of [
    ['tar-create','backup_prepare_failed'], ['tar-corrupt','backup_prepare_failed'],
    ['tar-list','backup_prepare_failed'], ['tar-extract','backup_prepare_failed'],
    ['tar-extra','backup_prepare_failed'], ['tar-wrong','backup_prepare_failed'],
    ['cp-config','backup_prepare_failed'], ['badcopy-config','backup_prepare_failed'],
    ['cmp','backup_prepare_failed'], ['chmod-config','backup_prepare_failed'],
    ['chmod-archive','backup_prepare_failed'], ['date','backup_prepare_failed'],
    ['stamp','backup_prepare_failed'], ['config-changed','backup_prepare_failed'],
    ['cp-events','events_snapshot_failed'], ['badcopy-events','events_snapshot_failed'],
  ]) it(`preserves pending data and stops before cloud mutation on ${fault}`, t => {
    const f=fixture(t,{fault,archive:true,events:true}); const r=f.run();
    assert.ok(f.trace().some(e=>e.fault===fault),'requested fault actually ran');
    assert.notEqual(r.status,0); assert.equal(parse(r).error,error);
    assert.equal(readFileSync(f.archive,'utf8'),'original pending archive');
    assert.ok(!f.trace().some(e=>['MKCOL','PUT','DELETE'].includes(e.method)), 'no cloud mutation');
    assert.deepEqual(freshStages(f),[]);
  });
  it('does not report ok:true when tar fails and no other archives exist',t=>{
    const f=fixture(t,{fault:'tar-create'}), r=f.run();
    assert.ok(f.trace().some(e=>e.fault==='tar-create')); assert.notEqual(r.status,0);
    assert.equal(parse(r).error,'backup_prepare_failed');
  });
  it('rejects a missing config before any MKCOL', t=>{
    const f=fixture(t,{missingConfig:true,archive:true}), r=f.run();
    assert.notEqual(r.status,0); assert.equal(parse(r).error,'backup_prepare_failed');
    assert.ok(existsSync(f.archive)); assert.ok(!f.trace().some(e=>e.method==='MKCOL'));
  });
  it('rejects a symbolic config rather than backing up a link', {skip:!posix}, t=>{
    const f=fixture(t,{configLink:true}),r=f.run();
    assert.notEqual(r.status,0); assert.equal(parse(r).error,'backup_prepare_failed');
    assert.ok(!f.trace().some(e=>e.method==='MKCOL'));
  });
  it('keeps a foreign stage printed by failed mktemp',t=>{
    const f=fixture(t,{fault:'mktemp'}),r=f.run();
    assert.ok(f.trace().some(e=>e.fault==='mktemp')); assert.notEqual(r.status,0);
    assert.equal(parse(r).error,'backup_prepare_failed'); assert.equal(readFileSync(f.oldBackup,'utf8'),'old backup must survive');
  });
  it('cleans its own directory after failing chmod',t=>{
    const f=fixture(t,{fault:'chmod-work'}),r=f.run();
    assert.ok(f.trace().some(e=>e.fault==='chmod-work')); assert.notEqual(r.status,0);
    assert.deepEqual(freshStages(f),[]); assert.ok(existsSync(f.oldBackup));
  });
  it('does nothing when another storage is selected',t=>{
    const f=fixture(t,{storage:'ram',fault:'tar-create'}),r=f.run();
    assert.equal(r.status,0); assert.equal(r.stdout,'');
    assert.ok(!f.trace().some(e=>['curl','tar'].includes(e.kind))); assert.deepEqual(freshStages(f),[]);
  });
  it('preserves old copies even when the native uploader later fails',t=>{
    const f=fixture(t,{events:true}),r=f.run(); assert.notEqual(r.status,0);
    assert.equal(parse(r).ok,false);
    assert.equal(readFileSync(f.oldBackup,'utf8'),'old backup must survive');
    assert.equal(readFileSync(f.oldEvents,'utf8'),'old journal must survive');
  });
  it('still reports a later upload failure rather than claiming WebDAV is fixed',t=>{
    const f=fixture(t),r=f.run(); assert.notEqual(r.status,0);
    assert.equal(parse(r).ok,false); assert.ok(parse(r).errors>0);
    assert.deepEqual(freshStages(f),[]);
  });
});

// Только этот блок заменяет upload_and_verify, чтобы проверить подготовленные
// байты и удаление staging независимо от ещё не исправленного XML/verify.
describe('Yandex prepared files with an explicit uploader boundary model',()=>{
  for (const events of [false,true]) it(`supplies a verified config and ${events?'journal':'no journal'}`,t=>{
    const f=fixture(t,{events}),r=f.run('upload-model'); assert.equal(r.status,0,r.stderr);
    assert.equal(parse(r).pushed,events?2:1);
    const uploads=f.trace().filter(e=>e.upload).map(e=>e.upload);
    const backup=uploads.find(e=>e.remote.includes('/backups/')); assert.ok(backup);
    assert.deepEqual(backup.members,['sheepfold']); assert.equal(backup.configHex,Buffer.from(configText).toString('hex'));
    if(posix) { assert.equal(backup.mode,0o600); assert.equal(backup.parentMode & 0o777,0o700); }
    assert.deepEqual(freshStages(f),[]);
  });
  it('keeps pre-existing same-second backup and journal files',t=>{
    const f=fixture(t,{events:true}),r=f.run('upload-model'); assert.equal(r.status,0,r.stderr);
    assert.equal(readFileSync(f.oldBackup,'utf8'),'old backup must survive');
    assert.equal(readFileSync(f.oldEvents,'utf8'),'old journal must survive');
  });
  it('does not follow the old shared staging symlink', {skip:!posix},t=>{
    const f=fixture(t,{stagingLink:true,events:true}),r=f.run('upload-model'); assert.equal(r.status,0,r.stderr);
    assert.equal(readFileSync(f.oldBackup,'utf8'),'old backup must survive');
    assert.equal(readFileSync(join(f.foreign,'keep'),'utf8'),'foreign data');
  });
  it('creates the archive privately before any later chmod', {skip:!posix}, t=>{
    const f=fixture(t),r=f.run('upload-model'); assert.equal(r.status,0,r.stderr);
    const created=f.trace().filter(e=>e.createdMode!==undefined); assert.equal(created.length,1);
    assert.equal(created[0].createdMode,0o600);
  });
  it('isolates successive operations with the same timestamp',t=>{
    const f=fixture(t); assert.equal(f.run('upload-model').status,0); assert.equal(f.run('upload-model').status,0);
    const uploads=f.trace().filter(e=>e.upload).map(e=>e.upload.path); assert.equal(uploads.length,2);
    assert.notEqual(uploads[0],uploads[1]); assert.deepEqual(freshStages(f),[]);
  });
  it('keeps the pending archive after uploader rejection',t=>{
    const f=fixture(t,{archive:true,uploadFail:true}),r=f.run('upload-model'); assert.notEqual(r.status,0);
    assert.equal(parse(r).ok,false); assert.ok(existsSync(f.archive)); assert.deepEqual(freshStages(f),[]);
  });
  it('retains a verified uncompressed tar without gzip', {skip:!posix},t=>{
    const f=fixture(t,{noGzip:true}),r=f.run('upload-model'); assert.equal(r.status,0,r.stderr);
    const uploaded=f.trace().find(e=>e.upload); assert.ok(uploaded);
    assert.ok(uploaded.upload.path.endsWith('.tar')); assert.deepEqual(uploaded.upload.members,['sheepfold']);
  });
  it('validates the local tar with native BusyBox tar as well', {skip:!existsSync('/usr/bin/busybox')},t=>{
    const f=fixture(t,{busyboxTar:true}),r=f.run('upload-model'); assert.equal(r.status,0,r.stderr);
    assert.equal(parse(r).pushed,1);
  });
});
