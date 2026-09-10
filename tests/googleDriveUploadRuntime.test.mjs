/*
 * Настоящий uploader в закрытом .build-стенде. curl — протокольный двойник
 * с журналом: без сети, аккаунта и реальных секретов. Модель jshn проверяет
 * JSON и get_var/get_type (включая unset под set -u), не заменяя native libubox.
 * В этом файле также проверяются обмен OAuth и привязанный к реквизитам RAM-кэш.
 * Подмена источника повторяет те же assertions на предыдущей версии.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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
  const defaults = { client_id: 'synthetic', client_secret: '', refresh_token: 'synthetic', root_folder: '/sheepfold', quota_mb: '500', authorized: '1' };
  const creds = { ...defaults, ...options.credentials };
  const authKey = (values) => createHash('sha256').update(['client_id','client_secret','refresh_token']
    .map((key) => `${Buffer.byteLength(values[key])}:${values[key]}`).join('')).digest('hex');
  const cacheFile = join(ram, '.gdrive-token.json');
  if (!options.noTokenCache) writeFileSync(cacheFile, JSON.stringify({ access_token:'synthetic-token', issued_at:1800000000,
    expires_at:1800003600, cache_key:authKey(creds) })+'\n');
  const traceFile = join(root, 'trace.jsonl'); writeFileSync(traceFile, '');
  const settings = join(root, 'response-options.json');
  writeFileSync(settings, JSON.stringify({ remoteSize: payloadBytes, ...options, credentials:creds, archive:path(archive), jshnFile:path(join(bin,'jshn.sh')) }));
  put('uci', `#!/bin/sh\nexec python3 -S ${q(path(join(bin, 'uciDouble.py')))} "$@"\n`);
  put('uciDouble.py', `import sys,json
args=[x for x in sys.argv[1:] if x!='-q']; opts=json.load(open(${JSON.stringify(settings)})); values=opts['credentials']
if args[0]=='get':
 key=args[1].split('.')[-1]
 if key=='log_storage': print('google_drive')
 elif key in values and values[key] is not None: print(values[key],end='')
 else: sys.exit(1)
elif args[0]=='show':
 print('sheepfold.gdrive=gdrive')
 for key,value in sorted(values.items()):
  if value is not None: print('sheepfold.gdrive.'+key+'='+repr(value))
elif args[0] not in ('set','commit'): sys.exit(1)
`);
  put('date', `#!/bin/sh\nif [ "$*" = +%s ]; then exec python3 -S -c 'import json,os;print(json.load(open(os.environ["GDRIVE_OPTIONS"])).get("now",1800000000))'; fi\nexec /bin/date "$@"\n`);
  put('curl', `#!/bin/sh\nexec python3 -S ${q(path(join(bin, 'curlDouble.py')))} "$@"\n`);
  put('curlDouble.py', `import sys,json,os,pathlib,urllib.parse,stat
args=sys.argv[1:]; opts=json.load(open(os.environ['GDRIVE_OPTIONS'])); trace=os.environ['GDRIVE_TRACE']
def arg(k,d=''):
 return args[args.index(k)+1] if k in args else d
url=next((a for a in args if a.startswith('https://')), '')
method=arg('-X','GET'); body=''; http='200'; exitcode=0
kind='other'
if 'oauth2' in url:
 kind='token'; body=opts.get('tokenBody','{"access_token":"synthetic-token","expires_in":3600,"token_type":"Bearer"}'); http=str(opts.get('tokenHttp',200)); exitcode=opts.get('tokenExit',0)
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
event={'kind':kind,'method':method,'url':url,'http':http,'exit':exitcode,'auth':arg('-H')}
if kind=='token':
 parts=[]
 for i,option in enumerate(args):
  if option in ('-d','--data','--data-urlencode'):
   value=args[i+1]
   if option=='--data-urlencode':
    if '=' in value: key,value=value.split('=',1)
    else:
     key,filename=value.split('@',1); p=pathlib.Path(filename); value=p.read_text(); event.setdefault('credentialModes',[]).append(stat.S_IMODE(p.stat().st_mode))
    value=urllib.parse.quote(key,safe='')+'='+urllib.parse.quote(value,safe='')
   parts.append(value)
 event['form']=urllib.parse.parse_qs('&'.join(parts),keep_blank_values=True)
 if opts.get('changeCredentialsDuringToken'):
  opts['credentials']['refresh_token']='changed-during-request'
  pathlib.Path(os.environ['GDRIVE_OPTIONS']).write_text(json.dumps(opts))

if kind=='upload':
 data=arg('--data-binary')
 if data.startswith('@'):
  p=pathlib.Path(data[1:]); event['bytes']=p.read_bytes().hex(); event['mode']=stat.S_IMODE(p.stat().st_mode); event['parentMode']=stat.S_IMODE(p.parent.stat().st_mode)
if kind=='metadata' and opts.get('removeJshnAtMetadata'): pathlib.Path(opts['jshnFile']).unlink()
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
 if len(sys.argv)>1 and sys.argv[1]=='script':
  obj=json.loads(sys.argv[3]); assert isinstance(obj,dict); print('jsonData='+shlex.quote(sys.argv[3])); sys.exit(0)
 obj=json.loads(sys.stdin.read()); assert isinstance(obj,dict)
 if len(sys.argv)==1: sys.exit(0)
 v=obj[sys.argv[2]]
 if sys.argv[1]=='type': print('string' if isinstance(v,str) else 'boolean' if isinstance(v,bool) else 'int' if isinstance(v,int) else 'object' if isinstance(v,dict) else 'array' if isinstance(v,list) else 'null')
 else:
  assert isinstance(v,(str,int)) and not isinstance(v,bool); print(shlex.quote(str(v)))
except (ValueError,KeyError,AssertionError,TypeError): sys.exit(1)
`);
  put('jshn', `#!/bin/sh\nexec python3 -S ${q(path(join(bin,'jsonModel.py')))} script "$@"\n`);
  put('jshn.sh', `json_init() { jsonData='{}'; }\njson_load() { jsonData="$1"; printf '%s' "$jsonData" | python3 -S ${q(path(join(bin, 'jsonModel.py')))}; }\njson_get_var() { local jsonValue; jsonValue="$(printf '%s' "$jsonData" | python3 -S ${q(path(join(bin, 'jsonModel.py')))} value "$2")" || return 1; eval "$1=$jsonValue"; }\njson_get_type() { local jsonType; jsonType="$(printf '%s' "$jsonData" | python3 -S ${q(path(join(bin, 'jsonModel.py')))} type "$2")" || { unset nativeMissingType; eval "$1=\${nativeMissingType}"; return 1; }; eval "$1=$jsonType"; }\n`);
  const run = (command = 'archive-push', args = []) => spawnSync(process.platform === 'win32' ? 'bash' : 'sh',
    ['-c', 'PATH="$1:$PATH"; export PATH; shift; exec sh "$@"', 'gdrive-fixture', path(bin), path(join(bin, 'sheepfold-google-drive')), command, ...args],
    { cwd: repo, env: { ...process.env, GDRIVE_OPTIONS: path(settings), GDRIVE_TRACE: path(traceFile) }, encoding: 'utf8', timeout: 20000 });
  const fault = (name, predicate, body) => {
    let real;
    if (existsSync(join(bin,name))) {
      const original=join(bin,`${name}-original`); renameSync(join(bin,name),original); real=path(original);
    } else real=spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
    assert.ok(real);
    put(name, `#!/bin/sh\nif ${predicate}; then printf '{"kind":"${name}-fault"}\\n' >> ${q(path(traceFile))}; ${body}; fi\nexec ${q(real)} "$@"\n`);
  };
  return { root, bin, ram, archive, path, put, run, fault, cacheFile, authKey, creds,
    update: (changes) => writeFileSync(settings, JSON.stringify({...JSON.parse(readFileSync(settings,'utf8')), ...changes})), trace: () => readFileSync(traceFile,'utf8').trim().split('\n').filter(Boolean).map((s) => JSON.parse(s)),
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
  it('does not use metadata when jshn disappears after the HTTP read', (t)=>{
    const f=fixture(t,{removeJshnAtMetadata:true}); const r=f.run(); failed(r); assert.ok(existsSync(f.archive));
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

/* OAuth: реальные функции uploader, синтетические реквизиты и протокольный curl.
 * Проверяются HTTP/exit/JSON, decoded form и cache на диске; ни одного запроса
 * в интернет. POSIX chmod/symlink требуют Linux, успех не доказывает Google OAuth.
 */
describe('Google Drive OAuth exchange and cache', () => {
  const goodToken = {access_token:'new-synthetic-token',expires_in:3600,token_type:'Bearer'};
  const refreshes = (f) => f.trace().filter((v)=>v.kind==='token');
  for (const [label,body] of [
    ['pretty JSON', JSON.stringify(goodToken,null,2)],
    ['compact JSON', JSON.stringify(goodToken)],
    ['different field order', '{ "token_type": "Bearer", "expires_in": 3600, "access_token": "new-synthetic-token" }'],
  ]) it(`accepts ${label} and reuses a valid identity-bound cache`, (t)=>{
    const f=fixture(t,{noTokenCache:true,tokenBody:body}); succeeded(f.run('test'));
    succeeded(f.run('test')); assert.equal(refreshes(f).length,1);
    const cache=JSON.parse(readFileSync(f.cacheFile,'utf8'));
    assert.equal(cache.access_token,goodToken.access_token);
    assert.equal(cache.cache_key,f.authKey(f.creds)); assert.equal(cache.issued_at,1800000000);
    assert.equal(cache.expires_at,1800003540);
  });
  it('preserves opaque credential characters in URL-encoded form fields', (t)=>{
    const credentials={client_id:'client+special&field=x',client_secret:'secret +%&= синтетика',refresh_token:'refresh+/%&x=y'};
    const f=fixture(t,{noTokenCache:true,credentials}); succeeded(f.run('test'));
    const event=refreshes(f)[0]; assert.ok(event,'refresh never executed');
    for(const [key,value] of Object.entries(credentials)) assert.deepEqual(event.form[key],[value]);
    assert.deepEqual(event.form.grant_type,['refresh_token']); assert.equal(Object.keys(event.form).length,4);
  });
  for(const opts of [{tokenHttp:400},{tokenHttp:500},{tokenExit:7},{tokenExit:28}]) it(`rejects token-shaped data from a failed exchange ${JSON.stringify(opts)}`,(t)=>{
    const f=fixture(t,{noTokenCache:true,...opts}); const r=f.run('test');
    assert.ok(refreshes(f).length,'fault not reached'); failed(r);
    assert.equal(existsSync(f.cacheFile),false); assert.ok(!r.stdout.includes('synthetic-token'));
  });
  for(const [label,body] of [
    ['truncated JSON','{"access_token":"new-synthetic-token","expires_in":3600,"token_type":"Bearer"'],
    ['missing lifetime',JSON.stringify({access_token:'new-synthetic-token',token_type:'Bearer'})],
    ['zero lifetime',JSON.stringify({...goodToken,expires_in:0})],
    ['negative lifetime',JSON.stringify({...goodToken,expires_in:-1})],
    ['text lifetime',JSON.stringify({...goodToken,expires_in:'3600'})],
    ['overflow lifetime',JSON.stringify({...goodToken,expires_in:1e20})],
    ['wrong token type',JSON.stringify({...goodToken,token_type:'MAC'})],
    ['missing token type',JSON.stringify({access_token:'new-synthetic-token',expires_in:3600})],
    ['line break in token',JSON.stringify({...goodToken,access_token:'bad\nheader'})],
    ['error alongside token',JSON.stringify({...goodToken,error:'invalid_grant'})],
  ]) it(`rejects ${label} without publishing a token`,(t)=>{
    const f=fixture(t,{noTokenCache:true,tokenBody:body}); failed(f.run('test'));
    assert.ok(refreshes(f).length); assert.equal(existsSync(f.cacheFile),false);
  });
  for(const key of ['client_id','client_secret','refresh_token']) it(`refreshes rather than using another ${key} context`,(t)=>{
    const f=fixture(t,{tokenBody:JSON.stringify(goodToken)});
    f.update({credentials:{...f.creds,[key]:'changed-synthetic'}});
    succeeded(f.run('test')); assert.ok(refreshes(f).length,'stale credential cache used');
    assert.equal(JSON.parse(readFileSync(f.cacheFile,'utf8')).access_token,goodToken.access_token);
  });
  it('does not fall back to the old account after new credentials fail', (t)=>{
    const f=fixture(t,{tokenHttp:400}); const before=readFileSync(f.cacheFile,'utf8');
    f.update({credentials:{...f.creds,refresh_token:'revoked-new-synthetic'}});
    failed(f.run('test')); assert.ok(refreshes(f).length);
    assert.equal(readFileSync(f.cacheFile,'utf8'),before); // Не удаляем старую запись ради отказа новой операции.
    assert.equal(f.trace().filter((v)=>v.kind!=='token').length,0);
  });
  it('refreshes a legacy cache without a credential identity', (t)=>{
    const f=fixture(t); writeFileSync(f.cacheFile,'{"access_token":"old-account","expires_at":1800009999}');
    succeeded(f.run('test')); assert.ok(refreshes(f).length,'unbound legacy cache accepted');
  });
  it('refreshes after the wall clock moves behind the token issue time', (t)=>{
    const f=fixture(t,{now:1799999000}); succeeded(f.run('test')); assert.ok(refreshes(f).length);
  });
  it('refuses an unknown clock rather than using a cached token', (t)=>{
    const f=fixture(t); f.fault('date','[ "$*" = +%s ]','printf 1800000000; exit 1');
    failed(f.run('test')); assert.ok(f.trace().some((v)=>v.kind==='date-fault'));
    assert.equal(refreshes(f).length,0);
  });
  it('does not authenticate from a partial UCI credential read', (t)=>{
    const f=fixture(t); f.fault('uci','[ "$*" = "-q get sheepfold.gdrive.refresh_token" ]','printf synthetic; exit 1');
    failed(f.run('test')); assert.ok(f.trace().some((v)=>v.kind==='uci-fault'));
    assert.equal(refreshes(f).length,0);
  });
  it('does not treat a failed SHA-256 with valid output as the credential identity', (t)=>{
    const f=fixture(t); f.fault('sha256sum',':',`printf '%s  file\\n' '${f.authKey(f.creds)}'; exit 1`);
    failed(f.run('test')); assert.ok(f.trace().some((v)=>v.kind==='sha256sum-fault'));
    assert.equal(refreshes(f).length,0);
  });
  it('preserves the previous cache if atomic publication fails', {skip:!native},(t)=>{
    const f=fixture(t); const before=readFileSync(f.cacheFile,'utf8');
    f.update({credentials:{...f.creds,refresh_token:'different'}});
    f.fault('mv',`[ "$2" = ${q(f.path(f.cacheFile))} ]`,'exit 1');
    failed(f.run('test')); assert.ok(f.trace().some((v)=>v.kind==='mv-fault'));
    assert.equal(readFileSync(f.cacheFile,'utf8'),before);
    assert.deepEqual(f.leftovers(),[]);
  });
  it('rejects an existing cache symlink without touching its target', {skip:!native},(t)=>{
    const f=fixture(t); const outside=join(f.root,'outside'); const before=readFileSync(f.cacheFile,'utf8');
    writeFileSync(outside,before); rmSync(f.cacheFile); symlinkSync(outside,f.cacheFile);
    failed(f.run('test')); assert.equal(readFileSync(outside,'utf8'),before); assert.equal(refreshes(f).length,0);
  });
  it('does not report authorization success when a directory occupies the cache path', {skip:!native},(t)=>{
    const f=fixture(t); rmSync(f.cacheFile); mkdirSync(f.cacheFile,{mode:0o755});
    failed(f.run('test')); assert.equal(statSync(f.cacheFile).mode&0o777,0o755); assert.equal(refreshes(f).length,0);
  });
  it('uses private files for credentials and cache without leaking tokens to the test response', {skip:!native},(t)=>{
    const f=fixture(t,{noTokenCache:true}); const r=f.run('test'); succeeded(r);
    assert.equal(statSync(f.cacheFile).mode&0o777,0o600); assert.equal(statSync(f.ram).mode&0o777,0o700);
    assert.deepEqual(refreshes(f)[0].credentialModes,[0o600,0o600,0o600]);
    assert.ok(!r.stdout.includes('synthetic-token')); assert.deepEqual(f.leftovers(),[]);
  });
  it('stops before returning a token when private-file permissions fail', {skip:!native},(t)=>{
    const f=fixture(t,{noTokenCache:true}); f.fault('chmod','[ "$1" = 600 ]','exit 1');
    failed(f.run('test')); assert.ok(f.trace().some((v)=>v.kind==='chmod-fault'));
    assert.equal(existsSync(f.cacheFile),false); assert.deepEqual(f.leftovers(),[]);
  });
  it('does not reach Drive when the JSON dependency is absent initially', (t)=>{
    const f=fixture(t); rmSync(join(f.bin,'jshn.sh')); failed(f.run('test'));
    assert.ok(!f.trace().some((v)=>v.kind==='upload'||v.kind==='metadata'));
  });
  it('accepts an omitted optional client secret', (t)=>{
    const f=fixture(t,{noTokenCache:true,credentials:{client_secret:null}}); succeeded(f.run('test'));
    assert.deepEqual(refreshes(f)[0].form.client_secret,['']);
  });
  it('accepts a short positive lifetime without inventing a longer cache', (t)=>{
    const f=fixture(t,{noTokenCache:true,tokenBody:JSON.stringify({...goodToken,expires_in:30})});
    succeeded(f.run('test')); assert.equal(existsSync(f.cacheFile),false);
  });
  it('rejects partial output from the JSON parser even when it describes a token', (t)=>{
    const f=fixture(t,{noTokenCache:true});
    f.fault('jshn',':',`printf '%s\\n' ${q('jsonData='+q(JSON.stringify(goodToken)))}; exit 1`);
    failed(f.run('test')); assert.ok(f.trace().some((v)=>v.kind==='jshn-fault')); assert.equal(existsSync(f.cacheFile),false);
  });
  it('does not replace the cache with a token for credentials changed during exchange', (t)=>{
    const f=fixture(t,{noTokenCache:true});
    // Протокольный двойник меняет fixture UCI после получения HTTP-запроса.
    f.update({changeCredentialsDuringToken:true}); failed(f.run('test'));
    assert.ok(refreshes(f).length); assert.equal(existsSync(f.cacheFile),false);
  });
  it('uses the newly selected credential token for the actual upload', (t)=>{
    const f=fixture(t,{tokenBody:JSON.stringify(goodToken)});
    f.update({credentials:{...f.creds,refresh_token:'new-account'}});
    succeeded(f.run()); const uploaded=f.trace().find((v)=>v.kind==='upload'); assert.ok(uploaded);
    assert.equal(uploaded.auth,`Authorization: Bearer ${goodToken.access_token}`);
  });
  it('preserves the cache on an existing-cache read failure', (t)=>{
    const f=fixture(t); const before=readFileSync(f.cacheFile,'utf8');
    f.fault('cat',`[ "$1" = ${q(f.path(f.cacheFile))} ]`, 'printf partial; exit 1');
    failed(f.run('test')); assert.ok(f.trace().some((v)=>v.kind==='cat-fault'));
    assert.equal(readFileSync(f.cacheFile,'utf8'),before); assert.equal(refreshes(f).length,0);
  });
  it('does not reuse an expired cache', (t)=>{
    const f=fixture(t,{now:1800003600}); succeeded(f.run('test')); assert.ok(refreshes(f).length);
  });
});
