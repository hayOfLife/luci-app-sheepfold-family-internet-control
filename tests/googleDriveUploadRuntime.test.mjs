/*
 * Настоящий uploader в закрытом .build-стенде. curl — протокольный двойник
 * с журналом: без сети, аккаунта и реальных секретов. Минимальная модель jshn
 * покрывает только JSON load/get_var/get_type, не нативную libubox.
 * Подмена источника повторяет те же assertions на предыдущей версии.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { shellTestPath } from '../tools/quality/testEnvironment.mjs';

const repo = resolve(import.meta.dirname, '..');
const runtime = join(repo, 'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold');
const q = (v) => `'${String(v).replaceAll("'", "'\\''")}'`;
const native = process.platform === 'linux';
const payload = 'synthetic archive payload\n';
const payloadBytes = Buffer.byteLength(payload);
function fixture(t, options = {}) {
  const parent = join(repo, '.build', 'gdrive-fixtures'); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'case-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'), ram = join(root, 'ram'), config = join(root, 'config');
  const archiveDir = join(ram, '.private', 'archive');
  for (const p of [bin, ram, config, archiveDir]) mkdirSync(p, { recursive: true });
  const path = (p) => shellTestPath(p, { cwd: repo, allowedRoot: root });
  const put = (name, text) => { writeFileSync(join(bin, name), text); chmodSync(join(bin, name), 0o755); };
  const source = process.env.SHEEPFOLD_GDRIVE_TEST_SOURCE || runtime;
  put('sheepfold-google-drive', readFileSync(join(source, 'sheepfold-google-drive'), 'utf8')
    .replaceAll('/tmp/sheepfold', path(ram)).replaceAll('/etc/config', path(config))
    .replaceAll('/usr/share/libubox/jshn.sh', path(join(bin, 'jshn.sh')))
    .replaceAll('/etc/init.d/sheepfold', path(join(root, 'no-service'))));
  const archive = join(archiveDir, 'synthetic.tar'); writeFileSync(archive, payload);
  // Новый config backup не создаётся: проверяется уже существующий архив.
  writeFileSync(join(ram, '.gdrive-token.json'), '{"access_token":"synthetic-token","expires_at":4102444800}\n');
  put('uci', `#!/bin/sh\n[ "\${1:-}" != -q ] || shift\ncase "\${1:-}" in\nget) case "$2" in\n*.log_storage) printf google_drive;;\n*.authorized) printf 1;;\n*.client_id|*.refresh_token) printf synthetic;;\n*.root_folder) printf /sheepfold;;\n*.quota_mb) printf 500;;\n*) exit 1;;\nesac;;\nset|commit) :;;\n*) exit 1;;\nesac\n`);
  const traceFile = join(root, 'trace.jsonl'); writeFileSync(traceFile, '');
  const settings = join(root, 'response-options.json');
  writeFileSync(settings, JSON.stringify({ remoteSize: payloadBytes, ...options, archive: path(archive) }));
  put('curl', `#!/bin/sh\nexec python3 -S ${q(path(join(bin, 'curlDouble.py')))} "$@"\n`);
  put('curlDouble.py', `import sys,json,os,pathlib,urllib.parse,stat
args=sys.argv[1:]; opts=json.load(open(os.environ['GDRIVE_OPTIONS'])); trace=os.environ['GDRIVE_TRACE']
def arg(k,d=''):
 return args[args.index(k)+1] if k in args else d
url=next((a for a in args if a.startswith('https://')), '')
method=arg('-X','GET'); body=''; http='200'; exitcode=0
kind='other'
if 'oauth2' in url:
 kind='token'; body='{"access_token":"synthetic-token","expires_in":3600}'
elif '/upload/' in url:
 kind='upload'; http=str(opts.get('uploadHttp',200)); exitcode=opts.get('uploadExit',0)
 body=json.dumps({'id':'file1','size':str(opts['remoteSize'])}, separators=(',',':'))
 if opts.get('createBody') is not None: body=opts['createBody']
elif '/files/file1' in url:
 kind='metadata'; http=str(opts.get('metadataHttp',200)); exitcode=opts.get('metadataExit',0)
 body=opts.get('metadataBody',json.dumps({'id':opts.get('metadataId','file1'),'size':str(opts['remoteSize'])},indent=2))
elif 'fields=files(size)' in url: body='{"files":[]}'
elif 'fields=files(id,name,size,modifiedTime)' in url:
 kind='lookup'; body='{"files":[]}' if opts.get('newFile') else '{"files":[{"id":"file1","name":"synthetic.tar","size":"25"}]}'
elif 'fields=files(id,name)' in url:
 body='{"files":[{"id":"folder1","name":"folder"}]}'
else: body='{"id":"folder1"}'
event={'kind':kind,'method':method,'url':url,'http':http,'exit':exitcode}
if kind=='upload':
 data=arg('--data-binary')
 if data.startswith('@'):
  p=pathlib.Path(data[1:]); event['bytes']=p.read_bytes().hex(); event['mode']=stat.S_IMODE(p.stat().st_mode); event['parentMode']=stat.S_IMODE(p.parent.stat().st_mode)
if kind=='metadata' and opts.get('changeSource'): pathlib.Path(opts['archive']).write_text('concurrent data\\n')
with open(trace,'a') as f: f.write(json.dumps(event)+'\\n')
out=arg('-o')
if out:
 if out!='/dev/null': pathlib.Path(out).write_text(body)
else: sys.stdout.write(body)
if '-w' in args: sys.stdout.write(http)
sys.exit(exitcode)
`);
  // Моделируется только платформенная зависимость, не правило production.
  put('jsonModel.py', `import sys,json,shlex
try:
 obj=json.loads(sys.stdin.read()); assert isinstance(obj,dict)
 if len(sys.argv)==1: sys.exit(0)
 v=obj[sys.argv[2]]
 if sys.argv[1]=='type': print('string' if isinstance(v,str) else 'boolean' if isinstance(v,bool) else 'int' if isinstance(v,int) else 'object' if isinstance(v,dict) else 'array' if isinstance(v,list) else 'null')
 else:
  assert isinstance(v,(str,int)) and not isinstance(v,bool); print(shlex.quote(str(v)))
except (ValueError,KeyError,AssertionError,TypeError): sys.exit(1)
`);
  put('jshn.sh', `json_init() { jsonData='{}'; }\njson_load() { jsonData="$1"; printf '%s' "$jsonData" | python3 -S ${q(path(join(bin, 'jsonModel.py')))}; }\njson_get_var() { local jsonValue; jsonValue="$(printf '%s' "$jsonData" | python3 -S ${q(path(join(bin, 'jsonModel.py')))} value "$2")" || return 1; eval "$1=$jsonValue"; }\njson_get_type() { local jsonType; jsonType="$(printf '%s' "$jsonData" | python3 -S ${q(path(join(bin, 'jsonModel.py')))} type "$2")" || return 1; eval "$1=$jsonType"; }\n`);
  const run = (command = 'archive-push', args = []) => spawnSync(process.platform === 'win32' ? 'bash' : 'sh',
    ['-c', 'PATH="$1:$PATH"; export PATH; shift; exec sh "$@"', 'gdrive-fixture', path(bin), path(join(bin, 'sheepfold-google-drive')), command, ...args],
    { cwd: repo, env: { ...process.env, GDRIVE_OPTIONS: path(settings), GDRIVE_TRACE: path(traceFile) }, encoding: 'utf8', timeout: 20000 });
  const fault = (name, predicate, body) => {
    const real = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim(); assert.ok(real);
    put(name, `#!/bin/sh\nif ${predicate}; then printf '{"kind":"${name}-fault"}\\n' >> ${q(path(traceFile))}; ${body}; fi\nexec ${q(real)} "$@"\n`);
  };
  return { root, bin, ram, archive, path, put, run, fault, trace: () => readFileSync(traceFile,'utf8').trim().split('\n').filter(Boolean).map((s) => JSON.parse(s)),
    leftovers: () => readdirSync(ram).filter((s) => /^\.gdrive-(?:upload|multipart|create-response)/.test(s)) };
}
function failed(r) { assert.ifError(r.error); assert.notEqual(r.status, 0, `false success: ${r.stdout} ${r.stderr}`); }
function succeeded(r) { assert.ifError(r.error); assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`); }

describe('Google Drive independent upload evidence', () => {
  it('keeps the archive when Drive reports a different size', (t) => {
    const f=fixture(t,{remoteSize:1}); const r=f.run();
    assert.ok(f.trace().some((v)=>v.kind==='upload'),'did not reach upload');
    assert.ok(existsSync(f.archive),'original archive was lost'); failed(r);
  });
  it('checks Drive metadata before deleting a matching archive', (t) => {
    const f=fixture(t); const r=f.run(); succeeded(r);
    assert.ok(f.trace().some((v)=>v.kind==='metadata'),'no independent metadata read');
    assert.equal(existsSync(f.archive),false);
  });
  for (const options of [
    {metadataHttp:403},{metadataHttp:500},{metadataExit:7},
    {metadataBody:'{"id":"file1","size":"25"'}, {metadataBody:'{"id":"file1"}'},
    {metadataBody:'{"id":"file1","size":"unknown"}'},
    {metadataBody:'{"id":"file1","size":-1}'},{metadataId:'other-file'},
  ]) it(`preserves source after metadata failure ${JSON.stringify(options)}`, (t) => {
    const f=fixture(t,options); const r=f.run();
    assert.ok(f.trace().some((v)=>v.kind==='metadata'),'metadata check was never reached');
    assert.ok(existsSync(f.archive)); failed(r);
  });
  it('does not delete a source changed while waiting for metadata', (t) => {
    const f=fixture(t,{changeSource:true}); const r=f.run(); failed(r);
    assert.equal(readFileSync(f.archive,'utf8'),'concurrent data\n');
  });
  for (const options of [{uploadHttp:500},{uploadExit:7}]) it(`preserves source on upload failure ${JSON.stringify(options)}`, (t)=>{
    const f=fixture(t,options); const r=f.run();
    assert.ok(f.trace().some((v)=>v.kind==='upload'),'upload was never reached');
    failed(r); assert.ok(existsSync(f.archive));
  });
});

describe('Google Drive upload preparation',()=>{
  it('does not run variable names as commands in push-events', (t)=>{
    const f=fixture(t); rmSync(f.archive); writeFileSync(join(f.ram,'events.log'),'synthetic archive payload\n');
    const r=f.run('push-events'); succeeded(r); assert.equal(JSON.parse(r.stdout).ok,true); assert.doesNotMatch(r.stderr,/not found/);
  });
  it('accepts the explicit CLI size check without running local_bytes', (t)=>{
    const f=fixture(t); const r=f.run('verify',[f.path(f.archive),String(payloadBytes)]); succeeded(r); assert.equal(JSON.parse(r.stdout).ok,true);
  });
  it('prepares private multipart data for a new upload', {skip:!native},(t)=>{
    const f=fixture(t,{newFile:true}); const r=f.run(); succeeded(r);
    const upload=f.trace().find((v)=>v.kind==='upload'); assert.ok(upload); assert.equal(upload.mode & 0o777,0o600); assert.equal(upload.parentMode & 0o777,0o700);
    assert.deepEqual(f.leftovers(),[]);
  });
  it('does not send multipart data after an input read failure', (t)=>{
    const f=fixture(t,{newFile:true});
    f.fault('cat', 'case "${1:-}" in */synthetic.tar|*/content) true;; *) false;; esac', "printf partial; exit 7");
    const r=f.run(); assert.ok(f.trace().some((v)=>v.kind==='cat-fault'));
    // A later config backup can upload; the failed archive body must not.
    assert.ok(!f.trace().filter((v)=>v.kind==='upload').some((v)=>Buffer.from(v.bytes,'hex').toString().includes('partial')));
    assert.ok(existsSync(f.archive)); failed(r); assert.deepEqual(f.leftovers(),[]);
  });
});


describe('Google Drive checks preparation before remote mutation',()=>{
  for (const name of ['cp','cmp','chmod','wc']) {
    it(`preserves input and does not upload after ${name} failure`, (t)=>{
      const f=fixture(t);
      const predicate = name === 'cp' ? '[ "${1:-}" = '+q(f.path(f.archive))+' ]' :
        name === 'cmp' ? 'case "${3:-}" in */content) true;; *) false;; esac' :
        name === 'chmod' ? 'case "${2:-}" in */content) true;; *) false;; esac' : '[ "${1:-}" = -c ]';
      f.fault(name,predicate,name === 'wc' ? 'printf 25; exit 7' : 'exit 7');
      const r=f.run(); assert.ok(f.trace().some((v)=>v.kind===`${name}-fault`),'fault not injected');
      failed(r); assert.ok(existsSync(f.archive));
      assert.ok(!f.trace().some((v)=>v.kind==='upload'),'unprepared data reached upload');
      assert.deepEqual(f.leftovers(),[]);
    });
  }
  it('does not remove another directory printed by failed mktemp', (t)=>{
    const f=fixture(t); const recovery=join(f.ram,'recovery'); mkdirSync(recovery); writeFileSync(join(recovery,'copy'),'retain');
    f.fault('mktemp',':',`printf '%s' ${q(f.path(recovery))}; exit 7`);
    const r=f.run(); failed(r); assert.ok(f.trace().some((v)=>v.kind==='mktemp-fault'));
    assert.equal(readFileSync(join(recovery,'copy'),'utf8'),'retain');
    assert.ok(!f.trace().some((v)=>v.kind==='upload'));
  });
  it('cleans its workspace after failed multipart POST', (t)=>{
    const f=fixture(t,{newFile:true,uploadHttp:500}); const r=f.run(); failed(r);
    assert.ok(f.trace().some((v)=>v.kind==='upload')); assert.ok(existsSync(f.archive)); assert.deepEqual(f.leftovers(),[]);
  });
  for (const createBody of ['{bad', '{"id":"bad/id"}', '{"id":"file1"']) {
    it(`preserves input after invalid creation response ${createBody}`, (t)=>{
      const f=fixture(t,{newFile:true,createBody}); const r=f.run(); failed(r);
      assert.ok(f.trace().some((v)=>v.kind==='upload')); assert.ok(existsSync(f.archive)); assert.deepEqual(f.leftovers(),[]);
    });
  }
  it('does not use metadata when jshn is missing', (t)=>{
    const f=fixture(t); rmSync(join(f.bin,'jshn.sh')); const r=f.run(); failed(r); assert.ok(existsSync(f.archive));
    assert.ok(f.trace().some((v)=>v.kind==='metadata')); assert.deepEqual(f.leftovers(),[]);
  });
  it('normalizes a quoted decimal remote size', (t)=>{
    const f=fixture(t,{metadataBody:'{ "id": "file1", "size": "00026" }'}); succeeded(f.run()); assert.equal(existsSync(f.archive),false);
  });
  it('accepts a zero-byte journal when the remote size is zero', (t)=>{
    const f=fixture(t,{remoteSize:0}); rmSync(f.archive); writeFileSync(join(f.ram,'events.log'),'');
    const r=f.run('push-events'); succeeded(r); assert.equal(JSON.parse(r.stdout).remote_bytes,0);
  });
  it('keeps the explicit local verify failure separate from transport', (t)=>{
    const f=fixture(t); const r=f.run('verify',[f.path(f.archive),'not-a-number']); failed(r);
    assert.equal(JSON.parse(r.stdout).error,'remote_metadata_invalid'); assert.deepEqual(f.trace(),[]);
  });
});
