/*
 * Настоящий uploader в закрытом .build-стенде. curl — протокольный двойник
 * с журналом: без сети, аккаунта и реальных секретов. Модель jshn проверяет
 * JSON и get_var/get_type (включая unset под set -u), не заменяя native libubox.
 * В этом файле также проверяются обмен OAuth и привязанный к реквизитам RAM-кэш.
 * Дополнительно: поиск выбирает только однозначный ID, ошибка не равна отсутствию;
 * URL и права кэша проверяются по записанному следу, не по grep исходников.
 * r307: кэш папок связан с реквизитами/root; HTTP-модель меняет UCI в точных
 * точках запроса и фиксирует, были ли дальнейшие запись/удаление исходника.
 * r308: полный проверенный учёт квоты, отказ очистки до подтверждения списка,
 * остановка после ошибки DELETE. Все удаляемые объекты существуют только в HTTP-модели.
 * Подмена источника повторяет те же assertions на предыдущей версии.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { shellTestPath } from '../tools/quality/testEnvironment.mjs';

const repo = resolve(import.meta.dirname, '..');
const runtime = join(repo, 'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold');
const q = (v) => `'${String(v).replaceAll("'", "'\\''")}'`;
const native = process.platform === 'linux';
const payload = 'synthetic archive payload\n';
const payloadBytes = Buffer.byteLength(payload);
function fixture(t, options = {}) {
  const parent = join(repo, '.build', 'gdrive-fixtures'); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'case-')); t.after(() => {
    // Экспорт включается явно только для синтетического fixture, не production.
    const evidence = process.env.SHEEPFOLD_GDRIVE_EVIDENCE_DIR;
    if (evidence && existsSync(traceFile)) {
      mkdirSync(evidence, { recursive: true });
      const name = createHash('sha256').update(t.name).digest('hex').slice(0,16);
      writeFileSync(join(evidence, `${name}.json`), JSON.stringify({ scenario:t.name,
        trace:readFileSync(traceFile,'utf8').trim().split('\n').filter(Boolean).map((line)=>JSON.parse(line)),
        archiveExists:existsSync(archive) }, null, 2)+'\n');
    }
    rmSync(root, { recursive: true, force: true });
  });
  const bin = join(root, 'bin'), ram = join(root, 'ram'), config = join(root, 'config');
  const archiveDir = join(ram, '.private', 'archive');
  for (const p of [bin, ram, config, archiveDir]) mkdirSync(p, { recursive: true });
  const path = (p) => shellTestPath(p, { cwd: repo, allowedRoot: root });
  const put = (name, text) => { writeFileSync(join(bin, name), text); chmodSync(join(bin, name), 0o755); };
  const source = process.env.SHEEPFOLD_GDRIVE_TEST_SOURCE || runtime;
  put('sheepfold-google-drive', readFileSync(join(source, 'sheepfold-google-drive'), 'utf8')
    .replaceAll('/tmp/sheepfold', path(ram)).replaceAll('/etc/config', path(config))
    .replaceAll('DOWNLOAD_ROOT="/tmp"', `DOWNLOAD_ROOT=${q(path(root))}`)
    .replaceAll('/tmp/*', `${path(root)}/*`)
    .replaceAll('/usr/share/libubox/jshn.sh', path(join(bin, 'jshn.sh')))
    .replaceAll('/etc/init.d/sheepfold', path(join(root, 'no-service'))));
  const archive = join(archiveDir, 'synthetic.tar'); writeFileSync(archive, payload);
  // Новый config backup не создаётся: проверяется уже существующий архив.
  const defaults = { client_id: 'synthetic', client_secret: '', refresh_token: 'synthetic', root_folder: '/sheepfold', quota_mb: '500', authorized: '1' };
  const creds = { ...defaults, ...options.credentials };
  const authKey = (values) => createHash('sha256').update(['client_id','client_secret','refresh_token']
    .map((key) => `${Buffer.byteLength(values[key])}:${values[key]}`).join('')).digest('hex');
  const folderKey = (values) => {
    const name=(values.root_folder ?? '/sheepfold').replace(/^\//,'').replace(/\/$/,'') || 'sheepfold';
    return createHash('sha256').update('gdrive-folders-v1\n'+['client_id','client_secret','refresh_token','root_folder']
      .map((key)=>{ const value=key==='root_folder'?name:(values[key]??''); return `${Buffer.byteLength(value)}:${value}`; }).join('')).digest('hex');
  };
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
query=urllib.parse.parse_qs(urllib.parse.urlsplit(url).query,keep_blank_values=True)
if '-G' in args or '--get' in args:
 for i,option in enumerate(args):
  if option=='--data-urlencode':
   value=args[i+1]
   if '=' in value: key,value=value.split('=',1)
   else: key,filename=value.split('@',1); value=pathlib.Path(filename).read_text()
   query.setdefault(key,[]).append(value)
 url=urllib.parse.urlunsplit(urllib.parse.urlsplit(url)._replace(query=urllib.parse.urlencode(query,doseq=True)))
fields=query.get('fields',[''])[0]
search=query.get('q',[''])[0]
kind='other'
if 'oauth2' in url:
 kind='token'; body=opts.get('tokenBody','{"access_token":"synthetic-token","expires_in":3600,"token_type":"Bearer"}'); http=str(opts.get('tokenHttp',200)); exitcode=opts.get('tokenExit',0)
elif '/upload/' in url:
 kind='upload'; http=str(opts.get('uploadHttp',200)); exitcode=opts.get('uploadExit',0)
 body=json.dumps({'id':'file1','size':str(opts['remoteSize'])}, separators=(',',':'))
 if opts.get('createBody') is not None: body=opts['createBody']
elif method=='DELETE' and '/drive/v3/files/' in url:
 kind='delete'; file_id=urllib.parse.urlsplit(url).path.rsplit('/',1)[-1]
 http=str(opts.get('deleteHttp',204)); exitcode=opts.get('deleteExit',0); body='{}'
 if http in ('200','204') and exitcode==0:
  opts.setdefault('deletedIds',[]).append(file_id)
  for records in opts.get('inventoryFiles',{}).values(): records[:]=[v for v in records if v.get('id')!=file_id]
  pathlib.Path(os.environ['GDRIVE_OPTIONS']).write_text(json.dumps(opts))
elif '/drive/v3/files/' in url and query.get('alt')==['media']:
 kind='download'; body=opts.get('downloadBody','synthetic archive payload\\n'); http=str(opts.get('downloadHttp',200)); exitcode=opts.get('downloadExit',0)
 opts['downloaded']=True
 pathlib.Path(os.environ['GDRIVE_OPTIONS']).write_text(json.dumps(opts))
elif '/files/file1' in url:
 kind='metadata'; http=str(opts.get('metadataHttp',200)); exitcode=opts.get('metadataExit',0)
 body=opts.get('metadataBody',json.dumps({'id':opts.get('metadataId','file1'),'size':str(opts['remoteSize'])},indent=2))
 if opts.get('downloaded'):
  body=opts.get('postMetadataBody',body); http=str(opts.get('postMetadataHttp',http)); exitcode=opts.get('postMetadataExit',exitcode)
elif ' in parents' in search and not search.startswith('name='):
 kind='pruneList' if fields=='files(id,name,modifiedTime)' else 'inventory'
 folder_id=search.split("'")[1]
 body=json.dumps({'files':opts.get('inventoryFiles',{}).get(folder_id,[])},separators=(',',':'))
 body=opts.get('inventoryBodies',{}).get(folder_id,opts.get(kind+'Body',body))
 http=str(opts.get(kind+'Http',200)); exitcode=opts.get(kind+'Exit',0)
 if opts.get('deletedIds'):
  body=opts.get('afterDeleteBody',body); http=str(opts.get('afterDeleteHttp',http))

elif search.startswith("name="):
 folder="mimeType='application/vnd.google-apps.folder'" in search
 kind='folderLookup' if folder else 'lookup'
 folder_id='backup1' if search.startswith("name='backups'") else 'folder1' if search.startswith("name='logs'") else 'root1'
 default='{"files":[]}' if opts.get('emptyFolders' if folder else 'newFile') else (json.dumps({'files':[{'id':folder_id,'name':'folder'}]}) if folder else '{"files":[{"id":"file1","name":"synthetic.tar","size":"25"}]}')
 body=opts.get(kind+'Body',default).replace('@folderId@',folder_id); http=str(opts.get(kind+'Http',200)); exitcode=opts.get(kind+'Exit',0)
elif method=='POST' and '/drive/v3/files' in url:
 kind='folderCreate'
 data=arg('--data-binary',arg('-d')); metadata=json.loads(pathlib.Path(data[1:]).read_text()) if data.startswith('@') else json.loads(data)
 folder_id='backup1' if metadata.get('name')=='backups' else 'folder1' if metadata.get('name')=='logs' else 'root1'
 body=opts.get('folderCreateBody',json.dumps({'id':folder_id})).replace('@folderId@',folder_id); http=str(opts.get('folderCreateHttp',200)); exitcode=opts.get('folderCreateExit',0)
else: body='{"id":"folder1"}'
event={'kind':kind,'method':method,'url':url,'http':http,'exit':exitcode,'auth':arg('-H'),'query':query}
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

if kind in ('upload','folderCreate'):
 data=arg('--data-binary',arg('-d'))
 if data.startswith('@'):
  p=pathlib.Path(data[1:]); event['bytes']=p.read_bytes().hex(); event['mode']=stat.S_IMODE(p.stat().st_mode); event['parentMode']=stat.S_IMODE(p.parent.stat().st_mode)
if kind=='metadata' and opts.get('removeJshnAtMetadata'): pathlib.Path(opts['jshnFile']).unlink()
if kind=='metadata' and opts.get('changeSource'): pathlib.Path(opts['archive']).write_text('concurrent data\\n')
if opts.get('changeContextAt')==kind:
 opts['credentials'].update(opts.get('contextChange',{'refresh_token':'changed-during-drive'}))
 opts['changeContextAt']=None
 pathlib.Path(os.environ['GDRIVE_OPTIONS']).write_text(json.dumps(opts))
 event['contextChanged']=True
with open(trace,'a') as f: f.write(json.dumps(event)+'\\n')
out=arg('-o')
if out:
 if out!='/dev/null':
  p=pathlib.Path(out)
  if kind=='download':
   downloaded=bytes.fromhex(opts['downloadHex']) if 'downloadHex' in opts else body.encode()
   before=stat.S_IMODE(p.stat().st_mode) if p.exists() else None
   p.write_bytes(downloaded)
   with open(trace,'a') as f: f.write(json.dumps({'kind':'download-output','path':out,'bytes':downloaded.hex(),'beforeMode':before,'mode':stat.S_IMODE(p.stat().st_mode),'parentMode':stat.S_IMODE(p.parent.stat().st_mode),'maxFilesize':arg('--max-filesize')})+'\\n')
  else: p.write_text(body)
else: sys.stdout.write(body)
if '-w' in args: sys.stdout.write(http)
sys.exit(exitcode)
`);
  // Моделируется только платформенная зависимость, не правило production.
  put('jsonModel.py', `import sys,json,shlex
try:
 if len(sys.argv)>1 and sys.argv[1]=='script':
  obj=json.loads(sys.argv[3]); assert isinstance(obj,dict); print('jsonData='+shlex.quote(sys.argv[3])); sys.exit(0)
 obj=json.loads(sys.stdin.read()); assert isinstance(obj,(dict,list))
 if len(sys.argv)==1: sys.exit(0)
 if sys.argv[1]=='keys':
  print(shlex.quote(' '.join(str(i+1) for i in range(len(obj))) if isinstance(obj,list) else ' '.join(obj.keys()))); sys.exit(0)
 v=obj[int(sys.argv[2])-1] if isinstance(obj,list) else obj[sys.argv[2]]
 if sys.argv[1]=='select':
  assert isinstance(v,(dict,list)); print(shlex.quote(json.dumps(v))); sys.exit(0)
 if sys.argv[1]=='type': print('string' if isinstance(v,str) else 'boolean' if isinstance(v,bool) else 'int' if isinstance(v,int) else 'object' if isinstance(v,dict) else 'array' if isinstance(v,list) else 'null')
 else:
  assert isinstance(v,(str,int)); print(shlex.quote(str(int(v)) if isinstance(v,bool) else str(v)))
except (ValueError,KeyError,IndexError,AssertionError,TypeError): sys.exit(1)
`);
  put('jshn', `#!/bin/sh\nexec python3 -S ${q(path(join(bin,'jsonModel.py')))} script "$@"\n`);
  put('jshn.sh', `json_init() { jsonData='{}'; }\njson_load() { jsonData="$1"; printf '%s' "$jsonData" | python3 -S ${q(path(join(bin, 'jsonModel.py')))}; }\njson_get_var() { local jsonValue; jsonValue="$(printf '%s' "$jsonData" | python3 -S ${q(path(join(bin, 'jsonModel.py')))} value "$2")" || return 1; eval "$1=$jsonValue"; }\njson_get_type() { local jsonType; jsonType="$(printf '%s' "$jsonData" | python3 -S ${q(path(join(bin, 'jsonModel.py')))} type "$2")" || { unset nativeMissingType; eval "$1=\${nativeMissingType}"; return 1; }; eval "$1=$jsonType"; }\n`);
  put('jshn.sh',readFileSync(join(bin,'jshn.sh'),'utf8') +
    `json_select() { local jsonValue; jsonValue="$(printf '%s' "$jsonData" | python3 -S ${q(path(join(bin, 'jsonModel.py')))} select "$1")" || return 1; eval "jsonData=$jsonValue"; }\n` +
    `json_get_keys() { local jsonValue; jsonValue="$(printf '%s' "$jsonData" | python3 -S ${q(path(join(bin, 'jsonModel.py')))} keys)" || return 1; eval "$1=$jsonValue"; }\n`);
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
  const call = (name,args=[]) => {
    const main=readFileSync(join(bin,'sheepfold-google-drive'),'utf8');
    put('function-run',main.slice(0,main.indexOf('command_name="${1:-}"'))+'\n"$@"\n');
    return spawnSync('sh',[path(join(bin,'function-run')),name,...args],{cwd:repo,
      env:{...process.env,PATH:`${bin}:${process.env.PATH}`,GDRIVE_OPTIONS:path(settings),GDRIVE_TRACE:path(traceFile)},encoding:'utf8',timeout:20000});
  };
  return { root, bin, ram, archive, path, put, run, call, fault, cacheFile, authKey, folderKey, creds,
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

// r306: настоящий caller + записанный HTTP. Ошибка поиска должна остановить
// создание/перезапись, а не только поменять текст возвращаемого сообщения.
describe('Google Drive lookup and folder publication',()=>{
  const noMutation = (f) => assert.ok(!f.trace().some((v)=>v.kind==='upload'||v.kind==='folderCreate'),'lookup failure caused remote mutation');
  it('updates the existing file from a normally formatted JSON response', (t)=>{
    const f=fixture(t,{folderLookupBody:'{ "files": [ { "id": "@folderId@" } ] }',lookupBody:JSON.stringify({files:[{id:'file1',name:'synthetic.tar'}]},null,2)});
    succeeded(f.run()); assert.equal(existsSync(f.archive),false);
    assert.ok(!f.trace().some((v)=>v.kind==='folderCreate'));
    assert.equal(f.trace().find((v)=>v.kind==='upload').method,'PATCH');
  });
  for(const stage of ['folderLookup','lookup']) for(const opts of [{Http:500},{Http:403},{Exit:7}]) {
    it(`does not mutate after ${stage} ${JSON.stringify(opts)}`, (t)=>{
      const options=Object.fromEntries(Object.entries(opts).map(([key,value])=>[stage+key,value]));
      const f=fixture(t,options); failed(f.run()); assert.ok(f.trace().some((v)=>v.kind===stage));
      noMutation(f); assert.ok(existsSync(f.archive));
    });
  }
  for(const body of ['{broken','{}','{"files":{}}','{"files":[{"id":33}]}','{"files":[{"id":"bad/id"}]}',
    '{"files":[],"error":{"code":500}}','{"files":[],"nextPageToken":"more"}',
    '{"files":[{"id":"file1"}],"nextPageToken":"more"}',
    '{"files":[{"id":"file1"}],"incompleteSearch":true}',
    '{"files":[{"id":"file1"}],"incompleteSearch":"false"}',
    '{"files":[{"id":"file1"},{"id":"file2"}]}']) {
    it(`rejects an untrustworthy or ambiguous lookup ${body}`, (t)=>{
      const f=fixture(t,{lookupBody:body}); failed(f.run());
      assert.ok(f.trace().some((v)=>v.kind==='lookup')); noMutation(f); assert.ok(existsSync(f.archive));
    });
  }
  it('accepts exactly one result with explicit complete-search markers', (t)=>{
    const f=fixture(t,{lookupBody:'{"files":[{"id":"file1"}],"incompleteSearch":false,"nextPageToken":""}'});
    succeeded(f.run()); assert.equal(f.trace().find((v)=>v.kind==='upload').method,'PATCH');
  });
  it('creates only after a verified complete empty search', (t)=>{
    const f=fixture(t,{newFile:true}); succeeded(f.run());
    assert.equal(f.trace().find((v)=>v.kind==='upload').method,'POST');
  });
  it('does not choose an unrelated nested id from the lookup body', (t)=>{
    const f=fixture(t,{lookupBody:'{"files":[{"id":"file1","extra":{"id":"file2"}}]}'});
    succeeded(f.run()); assert.match(f.trace().find((v)=>v.kind==='upload').url,/\/files\/file1\?/);
  });
  it('escapes query literals separately from URL encoding', (t)=>{
    const rootName="Семья O'Reilly\\Backup & 100%+#";
    const f=fixture(t,{credentials:{root_folder:`/${rootName}`}}); succeeded(f.run());
    const request=f.trace().find((v)=>v.kind==='folderLookup');
    const escaped=rootName.replaceAll('\\','\\\\').replaceAll("'","\\'");
    assert.deepEqual(request.query.q,[`name='${escaped}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`]);
    assert.ok(!Object.keys(request.query).some((key)=>key.includes('100')));
  });
  it('preserves special archive names in the exact file search', (t)=>{
    const f=fixture(t); const name="O'Reilly\\100%+&#.tar"; const archive=join(f.ram,'.private','archive',name); renameSync(f.archive,archive);
    succeeded(f.run()); const request=f.trace().find((v)=>v.kind==='lookup');
    const escaped=name.replaceAll('\\','\\\\').replaceAll("'","\\'");
    assert.deepEqual(request.query.q,[`name='${escaped}' and mimeType!='application/vnd.google-apps.folder' and 'folder1' in parents and trashed=false`]);
    assert.equal(existsSync(archive),false);
  });
  for(const options of [{folderCreateHttp:500},{folderCreateExit:7},{folderCreateBody:'{"id":"bad/id"}'},{folderCreateBody:'{"id":"folder1"'}]) {
    it(`does not accept failed folder creation ${JSON.stringify(options)}`, (t)=>{
      const f=fixture(t,{emptyFolders:true,...options}); failed(f.run());
      assert.ok(f.trace().some((v)=>v.kind==='folderCreate'));
      assert.ok(!f.trace().some((v)=>v.kind==='upload')); assert.ok(existsSync(f.archive));
    });
  }
  // Родитель .build может наследовать setgid; проверяем именно права доступа,
  // как в существующем upload-тесте, не принимая harmless 2700 за открытый 0755.
  it('accepts a formatted creation response and uses a private request file', {skip:!native},(t)=>{
    const f=fixture(t,{emptyFolders:true,folderCreateBody:'{ "id": "@folderId@" }'}); succeeded(f.run());
    const event=f.trace().find((v)=>v.kind==='folderCreate'); assert.equal(event.mode&0o777,0o600); assert.equal(event.parentMode&0o777,0o700);
    assert.equal(JSON.parse(Buffer.from(event.bytes,'hex').toString()).mimeType,'application/vnd.google-apps.folder');
    assert.equal(statSync(join(f.ram,'.gdrive-folders.json')).mode&0o777,0o600);
  });
  for(const command of ['chmod','mv']) it(`preserves the old folder cache after failed ${command}`, (t)=>{
    const f=fixture(t); const cache=join(f.ram,'.gdrive-folders.json'), old='{"root":"old","logs":"oldLogs","backups":"oldBackups","root_name":"old"}\n'; writeFileSync(cache,old);
    f.fault(command,'case "${2:-}" in */folders|*/.gdrive-folders.json) true;; *) false;; esac','exit 7');
    failed(f.run()); assert.ok(f.trace().some((v)=>v.kind===`${command}-fault`));
    assert.equal(readFileSync(cache,'utf8'),old); assert.ok(existsSync(f.archive));
    assert.ok(!f.trace().some((v)=>v.kind==='upload')); assert.deepEqual(f.leftovers(),[]);
  });
  it('does not overwrite a symlink target used as the folder cache', {skip:!native},(t)=>{
    const f=fixture(t); const other=join(f.root,'other'); writeFileSync(other,'untouched'); symlinkSync(other,join(f.ram,'.gdrive-folders.json'));
    failed(f.run()); assert.equal(readFileSync(other,'utf8'),'untouched'); assert.ok(existsSync(f.archive));
    assert.ok(!f.trace().some((v)=>v.kind==='upload'));
  });
  it('rejects a directory in place of the folder cache', (t)=>{
    const f=fixture(t); mkdirSync(join(f.ram,'.gdrive-folders.json'));
    failed(f.run()); assert.ok(existsSync(f.archive)); assert.ok(!f.trace().some((v)=>v.kind==='upload'));
  });
  it('fails a cache read instead of returning a partial id', (t)=>{
    const f=fixture(t); const cache=join(f.ram,'.gdrive-folders.json'); writeFileSync(cache,'{"logs":"folder1"}');
    f.fault('cat','case "${1:-}" in */.gdrive-folders.json) true;; *) false;; esac',`printf '{"logs":"folder1"}'; exit 7`);
    failed(f.call('folder_id_from_cache',['logs'])); assert.ok(f.trace().some((v)=>v.kind==='cat-fault')); assert.deepEqual(f.trace().filter((v)=>v.kind==='upload'),[]);
  });
});

describe('Google Drive lookup supplemental boundaries',()=>{
  for(const folderLookupBody of ['{"files":[{"id":"root1"},{"id":"root2"}]}','{"files":[],"nextPageToken":"more"}']) {
    it(`does not create folders after incomplete or ambiguous search ${folderLookupBody}`, (t)=>{
      const f=fixture(t,{folderLookupBody}); failed(f.run());
      assert.ok(f.trace().some((v)=>v.kind==='folderLookup'));
      assert.ok(!f.trace().some((v)=>v.kind==='folderCreate'||v.kind==='upload')); assert.ok(existsSync(f.archive));
    });
  }
  it('rejects a failed search-body read even when it prints an empty list', (t)=>{
    const f=fixture(t); f.fault('cat','case "${1:-}" in */search) true;; *) false;; esac',`printf '{"files":[]}'; exit 7`);
    failed(f.run()); assert.ok(f.trace().some((v)=>v.kind==='cat-fault'));
    assert.ok(!f.trace().some((v)=>v.kind==='folderCreate'||v.kind==='upload')); assert.ok(existsSync(f.archive));
  });
  it('does not choose the default folder after a configured root read fails', (t)=>{
    const f=fixture(t,{credentials:{root_folder:'/Chosen'}});
    f.fault('uci','[ "${2:-}" = get ] && [ "${3:-}" = sheepfold.gdrive.root_folder ]','exit 7');
    failed(f.run()); assert.ok(f.trace().some((v)=>v.kind==='uci-fault'));
    assert.ok(!f.trace().some((v)=>v.kind==='folderLookup'||v.kind==='folderCreate'||v.kind==='upload')); assert.ok(existsSync(f.archive));
  });
  it('keeps the default root when UCI confirms that the option is absent', (t)=>{
    const f=fixture(t,{credentials:{root_folder:null}}); succeeded(f.run());
    assert.ok(f.trace().find((v)=>v.kind==='folderLookup').query.q[0].startsWith("name='sheepfold'"));
  });
  it('reads a formatted complete folder cache without doing HTTP', (t)=>{
    const f=fixture(t); writeFileSync(join(f.ram,'.gdrive-folders.json'),JSON.stringify({root:'root1',logs:'logs1',backups:'backups1',root_name:'sheepfold',context_key:f.folderKey(f.creds)},null,2));
    const r=f.call('folder_id_from_cache',['logs']); succeeded(r); assert.equal(r.stdout,'logs1'); assert.deepEqual(f.trace(),[]);
  });
  for(const cache of ['{"root":"root1","logs":"logs1","backups":"backups1","root_name":"sheepfold"',
    '{"root":33,"logs":"logs1","backups":"backups1","root_name":"sheepfold"}']) {
    it(`rejects an invalid full cache record ${cache}`, (t)=>{
      const f=fixture(t); writeFileSync(join(f.ram,'.gdrive-folders.json'),cache); const r=f.call('folder_id_from_cache',['logs']); failed(r);
      assert.equal(r.stdout,''); assert.deepEqual(f.trace(),[]);
    });
  }
  it('does not treat an oversized search response as permission to create', (t)=>{
    const f=fixture(t,{lookupBody:JSON.stringify({files:[],padding:'x'.repeat(65536)})}); failed(f.run());
    assert.ok(f.trace().some((v)=>v.kind==='lookup')); assert.ok(!f.trace().some((v)=>v.kind==='upload')); assert.ok(existsSync(f.archive));
  });
});


/* r307: public upload commands and real cache reader; all credentials are synthetic.
 * The model mutates UCI exactly when a HTTP response is delivered. Assertions check
 * the reached stage, later HTTP calls and preservation of cache/source, not text.
 * This does not prove atomic UCI, Drive transactions or live account permissions.
 */
describe('Google Drive folder context',()=>{
  const folderFile=(f)=>join(f.ram,'.gdrive-folders.json');
  const oldRecord={root:'oldRoot',logs:'oldLogs',backups:'oldBackups',root_name:'sheepfold'};
  const boundRecord=(f)=>({...oldRecord,context_key:f.folderKey(f.creds)});
  for(const field of ['client_id','client_secret','refresh_token','root_folder']) {
    it(`does not reuse cached folders after ${field} changes`,(t)=>{
      const f=fixture(t); succeeded(f.call('cache_folder_ids'));
      f.update({credentials:{...f.creds,[field]:field==='root_folder'?'/Other family':'other-synthetic'},folderLookupBody:'{"files":[{"id":"newFolder"}]}'});
      const r=f.call('folder_id_from_cache',['logs']); succeeded(r); assert.equal(r.stdout,'newFolder');
      assert.ok(f.trace().some((v)=>v.kind==='folderLookup' && v.query.q[0].includes(field==='root_folder'?"name='Other family'":"name='logs'")));
      assert.notEqual(JSON.parse(readFileSync(folderFile(f),'utf8')).context_key,f.folderKey(f.creds));
    });
  }
  it('migrates a complete legacy cache by lookup instead of guessing its owner',(t)=>{
    const f=fixture(t); writeFileSync(folderFile(f),JSON.stringify(oldRecord));
    const r=f.call('folder_id_from_cache',['logs']); succeeded(r); assert.equal(r.stdout,'folder1');
    assert.equal(f.trace().filter((v)=>v.kind==='folderLookup').length,3);
    assert.equal(JSON.parse(readFileSync(folderFile(f),'utf8')).context_key,f.folderKey(f.creds));
  });
  it('does not fall back to obsolete ids when the replacement search fails',(t)=>{
    const f=fixture(t,{folderLookupHttp:500}); const before=JSON.stringify(oldRecord); writeFileSync(folderFile(f),before);
    const r=f.call('folder_id_from_cache',['logs']); failed(r); assert.equal(r.stdout,'');
    assert.ok(f.trace().some((v)=>v.kind==='folderLookup')); assert.equal(readFileSync(folderFile(f),'utf8'),before);
    assert.ok(!f.trace().some((v)=>v.kind==='upload'||v.kind==='folderCreate'));
  });
  it('reuses a matching cache after an unrelated quota change',(t)=>{
    const f=fixture(t); writeFileSync(folderFile(f),JSON.stringify(boundRecord(f)));
    f.update({credentials:{...f.creds,quota_mb:'250'}});
    const r=f.call('folder_id_from_cache',['backups']); succeeded(r); assert.equal(r.stdout,'oldBackups'); assert.deepEqual(f.trace(),[]);
  });
  it('normalizes root slashes without invalidating the same logical destination',(t)=>{
    const f=fixture(t); writeFileSync(folderFile(f),JSON.stringify(boundRecord(f)));
    f.update({credentials:{...f.creds,root_folder:'/sheepfold/'}});
    const r=f.call('folder_id_from_cache',['logs']); succeeded(r); assert.equal(r.stdout,'oldLogs'); assert.deepEqual(f.trace(),[]);
  });
  it('does not accept a root name inconsistent with the stored context',(t)=>{
    const f=fixture(t); writeFileSync(folderFile(f),JSON.stringify({...boundRecord(f),root_name:'anotherRoot'}));
    const r=f.call('folder_id_from_cache',['logs']); succeeded(r); assert.equal(r.stdout,'folder1');
    assert.ok(f.trace().some((v)=>v.kind==='folderLookup'));
  });
  for(const context_key of [null,42,'not-a-digest']) it(`rejects a malformed context key ${JSON.stringify(context_key)}`,(t)=>{
    const f=fixture(t); const before=JSON.stringify({...oldRecord,context_key}); writeFileSync(folderFile(f),before);
    const r=f.call('folder_id_from_cache',['logs']); failed(r); assert.equal(r.stdout,''); assert.deepEqual(f.trace(),[]);
    assert.equal(readFileSync(folderFile(f),'utf8'),before);
  });
  it('stores a domain-separated key but no credential values in the folder cache',(t)=>{
    const f=fixture(t,{credentials:{client_id:'unique-client',client_secret:'unique-secret',refresh_token:'unique-refresh'}});
    succeeded(f.call('cache_folder_ids')); const text=readFileSync(folderFile(f),'utf8'),record=JSON.parse(text);
    assert.equal(record.context_key,f.folderKey(f.creds)); assert.notEqual(record.context_key,f.authKey(f.creds));
    for(const key of ['client_id','client_secret','refresh_token']) assert.ok(!text.includes(f.creds[key]));
  });
  for(const option of ['root_folder','refresh_token']) it(`does not use a cached id after failed ${option} read`,(t)=>{
    const f=fixture(t); writeFileSync(folderFile(f),JSON.stringify(boundRecord(f)));
    f.fault('uci',`[ "$*" = "-q get sheepfold.gdrive.${option}" ]`,'printf partial; exit 7');
    const r=f.call('folder_id_from_cache',['logs']); failed(r); assert.equal(r.stdout,'');
    assert.ok(f.trace().some((v)=>v.kind==='uci-fault')); assert.ok(!f.trace().some((v)=>v.kind==='folderLookup'));
  });
  it('does not accept a digest printed by a failed hash process',(t)=>{
    const f=fixture(t); writeFileSync(folderFile(f),JSON.stringify(boundRecord(f)));
    f.fault('sha256sum',':',`printf '%s  identity\n' '${f.folderKey(f.creds)}'; exit 7`);
    const r=f.call('folder_id_from_cache',['logs']); failed(r); assert.equal(r.stdout,'');
    assert.ok(f.trace().some((v)=>v.kind==='sha256sum-fault')); assert.ok(!f.trace().some((v)=>v.kind==='folderLookup'));
  });
  for(const field of ['refresh_token','root_folder']) for(const stage of ['folderLookup','folderCreate','lookup','upload','metadata']) {
    it(`stops the current upload when ${field} changes at ${stage}`,(t)=>{
      const f=fixture(t,{emptyFolders:stage==='folderCreate',changeContextAt:stage,
        contextChange:{[field]:field==='root_folder'?'/New destination':'new-account'},tokenBody:'{"access_token":"new-account-token","expires_in":3600,"token_type":"Bearer"}'});
      const before=JSON.stringify(boundRecord(f)); writeFileSync(folderFile(f),before);
      const r=f.run(); const trace=f.trace(),index=trace.findIndex((v)=>v.contextChanged);
      assert.ok(index>=0,'deterministic context change was not reached');
      failed(r); assert.ok(existsSync(f.archive),'archive removed after context switch');
      assert.deepEqual(trace.slice(index+1).filter((v)=>!v.kind.endsWith('-fault')),[],'continued HTTP after noticed context change');
      if(stage==='folderLookup'||stage==='folderCreate') assert.equal(readFileSync(folderFile(f),'utf8'),before);
    });
  }
  it('does not create a new file after context changes in an empty lookup',(t)=>{
    const f=fixture(t,{newFile:true,changeContextAt:'lookup',contextChange:{root_folder:'/Changed'}});
    const r=f.run(); assert.ok(f.trace().some((v)=>v.contextChanged)); failed(r);
    assert.ok(!f.trace().some((v)=>v.kind==='upload')); assert.ok(existsSync(f.archive));
  });
  it('stops push-events at a detected context change without deleting the live journal',(t)=>{
    const f=fixture(t,{changeContextAt:'lookup',contextChange:{root_folder:'/Changed'}}); rmSync(f.archive);
    const events=join(f.ram,'events.log'); writeFileSync(events,payload);
    const r=f.run('push-events'); assert.ok(f.trace().some((v)=>v.contextChanged)); failed(r);
    assert.equal(readFileSync(events,'utf8'),payload); assert.ok(!f.trace().some((v)=>v.kind==='upload'));
  });
  it('invalidates the next read after a concurrent publisher replaced the cache identity',(t)=>{
    const f=fixture(t); writeFileSync(folderFile(f),JSON.stringify({...boundRecord(f),context_key:'a'.repeat(64)}));
    const r=f.call('folder_id_from_cache',['logs']); succeeded(r); assert.equal(r.stdout,'folder1');
    assert.ok(f.trace().some((v)=>v.kind==='folderLookup'));
  });
});

/* Quota tests execute the real reader/pruner and archive-push. The HTTP double is
 * the only owner of synthetic remote files; a DELETE changes that model and is
 * traced. No account, real cloud deletion, native UCI or libubox is exercised. */
function quotaFile(id, size, folder = 'folder1', extra = {}) {
  return { id, name: `${id}.log`, size, mimeType: 'text/plain', parents: [folder],
    trashed: false, modifiedTime: '2026-09-10T10:00:00.000Z', ...extra };
}
const deleteTrace = (f) => f.trace().filter((v) => v.kind === 'delete');
const noDelete = (f) => assert.deepEqual(deleteTrace(f), [], 'unconfirmed quota/list reached DELETE');

describe('Google Drive quota accounting', () => {
  for (const numeric of [false, true]) it(`counts all entries including backups (numeric=${numeric})`, (t) => {
    const n = (v) => numeric ? v : String(v);
    const f = fixture(t, { inventoryFiles: { folder1: [quotaFile('a',n(10)),quotaFile('b',n(20))], backup1: [quotaFile('backup',n(7),'backup1')] } });
    const r = f.call('folder_used_bytes'); succeeded(r); assert.equal(r.stdout, '37'); noDelete(f);
    assert.equal(f.trace().filter((v)=>v.kind==='inventory').length,2);
  });
  it('counts a real empty result as zero', (t)=>{
    const f=fixture(t); const r=f.call('folder_used_bytes'); succeeded(r); assert.equal(r.stdout,'0'); noDelete(f);
  });
  it('normalizes leading zero sizes as decimal', (t)=>{
    const f=fixture(t,{inventoryFiles:{folder1:[quotaFile('a','000008'),quotaFile('b','000010')]}});
    const r=f.call('folder_used_bytes'); succeeded(r); assert.equal(r.stdout,'18');
  });
  it('accepts formatted JSON and full unrelated file names without splitting fields', (t)=>{
    const f=fixture(t,{inventoryBodies:{folder1:JSON.stringify({files:[quotaFile('a','9','folder1',{name:'Текст\tс пробелами😀.txt'})]},null,2)}});
    const r=f.call('folder_used_bytes'); succeeded(r); assert.equal(r.stdout,'9');
  });
  for(const body of [
    '{"files":[', '{"error":{"code":500}}', '{}', '{"files":{}}',
    JSON.stringify({files:[quotaFile('a','oops')]}),
    JSON.stringify({files:[quotaFile('a',true)]}),
    JSON.stringify({files:[quotaFile('a','-1')]}),
    JSON.stringify({files:[quotaFile('a','9223372036854775808')]}),
    JSON.stringify({files:[quotaFile('a','999999999999999'),quotaFile('b','1')]}),
    JSON.stringify({files:[quotaFile('a','1','other-folder')]}),
    JSON.stringify({files:[quotaFile('a','1','folder1',{mimeType:'application/vnd.google-apps.folder'})]}),
    JSON.stringify({files:[quotaFile('a','1','folder1',{trashed:true})]}),
    JSON.stringify({files:[quotaFile('a','1'),quotaFile('a','2')]}),
    JSON.stringify({files:[],nextPageToken:'second-page'}),
    JSON.stringify({files:[],incompleteSearch:true}),
    JSON.stringify({files:[],incompleteSearch:'false'}),
  ]) it(`rejects unconfirmed usage ${body.slice(0,120)}`, (t)=>{
    const f=fixture(t,{inventoryBodies:{folder1:body}}); const r=f.call('folder_used_bytes');
    assert.ok(f.trace().some((v)=>v.kind==='inventory'),'inventory request not reached');
    failed(r); assert.equal(r.stdout,'','partial usage leaked'); noDelete(f);
  });
  for(const options of [{inventoryHttp:500},{inventoryExit:7}]) it(`does not replace quota read failure with zero ${JSON.stringify(options)}`, (t)=>{
    const f=fixture(t,options); const r=f.call('folder_used_bytes');
    assert.ok(f.trace().some((v)=>v.kind==='inventory')); failed(r); assert.equal(r.stdout,''); noDelete(f);
  });
  it('rejects a response over the record limit rather than computing a partial total', (t)=>{
    const f=fixture(t,{inventoryFiles:{folder1:Array.from({length:201},(_,i)=>quotaFile(`f${i}`,'1'))}});
    failed(f.call('folder_used_bytes')); noDelete(f);
  });
  it('status reports unavailable usage, not healthy 100 percent free', (t)=>{
    const f=fixture(t,{inventoryHttp:403}); const r=f.run('status'); succeeded(r);
    const status=JSON.parse(r.stdout); assert.equal(status.state,'error'); assert.equal(status.free_pct,0);
    assert.equal(status.message,'Could not read storage status.'); noDelete(f);
  });
  it('status counts quoted bytes in both folders', (t)=>{
    const f=fixture(t,{inventoryFiles:{folder1:[quotaFile('a',String(2*1024*1024))],backup1:[quotaFile('b',String(3*1024*1024),'backup1')]}});
    const r=f.run('status'); succeeded(r); const status=JSON.parse(r.stdout);
    assert.equal(status.state,'ok'); assert.equal(status.used_mb,5); assert.equal(status.free_pct,99);
  });
  it('does not read a failed configured quota as 500 MB', (t)=>{
    const f=fixture(t,{credentials:{quota_mb:'50'}});
    f.fault('uci','[ "${2:-}" = get ] && [ "${3:-}" = sheepfold.gdrive.quota_mb ]','exit 7');
    failed(f.call('quota_mb')); assert.ok(f.trace().some((v)=>v.kind==='uci-fault')); noDelete(f);
  });
  it('uses default quota only when the setting is confirmed absent', (t)=>{
    const f=fixture(t,{credentials:{quota_mb:null}}); const r=f.call('quota_mb'); succeeded(r); assert.equal(r.stdout,'500');
  });
});

describe('Google Drive quota cleanup',()=>{
  it('deletes the oldest log first and stops once quota is satisfied', (t)=>{
    const f=fixture(t,{inventoryFiles:{folder1:[quotaFile('oldLog','60'),quotaFile('newLog','40')]}});
    const r=f.call('prune_remote_logs',['50']); succeeded(r);
    assert.deepEqual(deleteTrace(f).map((v)=>v.url.split('/').pop()),['oldLog']);
    const first=f.trace().find((v)=>v.kind==='inventory'); assert.deepEqual(first.query.orderBy,['modifiedTime,name']);
  });
  it('counts backups but never deletes them to meet quota', (t)=>{
    const f=fixture(t,{inventoryFiles:{folder1:[quotaFile('oldLog','60')],backup1:[quotaFile('backup','80','backup1')]}});
    failed(f.call('prune_remote_logs',['50']));
    assert.deepEqual(deleteTrace(f).map((v)=>v.url.split('/').pop()),['oldLog']);
  });
  it('does not delete unrelated files in the logs folder', (t)=>{
    const f=fixture(t,{inventoryFiles:{folder1:[quotaFile('notes','100','folder1',{name:'notes.txt'})]}});
    failed(f.call('prune_remote_logs',['50'])); noDelete(f);
  });
  for(const options of [{inventoryHttp:500},{inventoryExit:7},{inventoryBody:'{"files":[],"nextPageToken":"more"}'}]) {
    it(`does not delete with an unverified list ${JSON.stringify(options)}`, (t)=>{
      const f=fixture(t,options); failed(f.call('prune_remote_logs',['50'])); noDelete(f);
    });
  }
  it('checks every entry before the first DELETE', (t)=>{
    const f=fixture(t,{inventoryFiles:{folder1:[quotaFile('good','100'),quotaFile('bad','1','folder1',{parents:['unrelated']})]}});
    failed(f.call('prune_remote_logs',['50'])); noDelete(f);
  });
  for(const options of [{deleteHttp:500},{deleteHttp:429},{deleteExit:7}]) it(`stops at the first unconfirmed DELETE ${JSON.stringify(options)}`,(t)=>{
    const f=fixture(t,{...options,inventoryFiles:{folder1:[quotaFile('oldLog','60'),quotaFile('newLog','60')]}});
    failed(f.call('prune_remote_logs',['50'])); assert.equal(deleteTrace(f).length,1,'did not reach one controlled DELETE');
  });
  it('does not continue after quota reread fails following one deletion', (t)=>{
    const f=fixture(t,{afterDeleteHttp:500,inventoryFiles:{folder1:[quotaFile('oldLog','60'),quotaFile('newLog','60')]}});
    failed(f.call('prune_remote_logs',['50'])); assert.equal(deleteTrace(f).length,1);
    assert.ok(f.trace().some((v)=>v.kind==='inventory' && v.http==='500'));
  });
  it('stops if a successful DELETE has not reduced the observed total', (t)=>{
    const files=[quotaFile('oldLog','60'),quotaFile('newLog','60')];
    const f=fixture(t,{afterDeleteBody:JSON.stringify({files}),inventoryFiles:{folder1:files}});
    failed(f.call('prune_remote_logs',['50'])); assert.equal(deleteTrace(f).length,1);
  });
  it('does not use a malformed ID to construct a DELETE URL', (t)=>{
    const f=fixture(t); failed(f.call('drive_delete_file',['../other?alt=media'])); noDelete(f);
  });
  it('archive-push reports cleanup failure instead of success after a verified upload', (t)=>{
    const f=fixture(t,{inventoryHttp:500}); const r=f.run();
    assert.ok(f.trace().some((v)=>v.kind==='metadata')); failed(r);
    assert.equal(JSON.parse(r.stdout).ok,false);
    assert.equal(JSON.parse(readFileSync(join(f.ram,'.gdrive-sync-status.json'),'utf8')).ok,false);
    // A previously verified upload is not rolled back by a subsequent cleanup error.
    assert.equal(existsSync(f.archive),false); noDelete(f);
  });
  it('context change during inventory prevents the first deletion', (t)=>{
    const f=fixture(t,{changeContextAt:'inventory',inventoryFiles:{folder1:[quotaFile('a','100')]}});
    failed(f.call('prune_remote_logs',['50'])); assert.ok(f.trace().some((v)=>v.contextChanged)); noDelete(f);
  });
});

// Старый while/read терял последнюю строку. Перенос перед закрывающей скобкой
// позволяет отдельно дойти до прежнего DELETE, не подменяя production-счётчик.
describe('Google Drive quota legacy cleanup controls',()=>{
  it('does not select the last compact candidate as the oldest', (t)=>{
    const f=fixture(t,{pruneListBody:'{"files":[{"id":"oldLog"},{"id":"newLog"}\n]}',
      inventoryFiles:{folder1:[quotaFile('oldLog','60'),quotaFile('newLog','40')]}});
    const r=f.call('prune_remote_logs',['50']);
    assert.ok(deleteTrace(f).length>0,'test must reach the deletion stage');
    succeeded(r); assert.deepEqual(deleteTrace(f).map((v)=>v.url.split('/').pop()),['oldLog']);
  });
  it('does not hide a reached DELETE failure behind the final loop success', (t)=>{
    const f=fixture(t,{deleteHttp:500,pruneListBody:'{"files":[{"id":"oldLog"}\n]}',
      inventoryFiles:{folder1:[quotaFile('oldLog','60')]}});
    const r=f.call('prune_remote_logs',['50']);
    assert.equal(deleteTrace(f).length,1,'fault injection must reach DELETE');
    assert.equal(deleteTrace(f)[0].http,'500'); failed(r);
  });
});

// r309: файлы получателя — синтетические. Модель HTTP записывает точные байты
// и режим временного файла; искусственный файловый отказ обязан оставить trace.
describe('Google Drive download safety', () => {
  const oldData = 'existing local backup\n';
  function target(f, name = 'saved.tar') {
    const dir = join(f.root, 'downloads'); mkdirSync(dir, { recursive: true });
    const file = join(dir, name); writeFileSync(file, oldData);
    return file;
  }
  function assertPreserved(f, file, result) {
    failed(result);
    assert.ok(existsSync(file), 'existing destination was deleted');
    assert.equal(readFileSync(file, 'utf8'), oldData, 'existing destination was changed');
    const reply = JSON.parse(result.stdout); assert.equal(reply.ok, false);
    assert.equal(readdirSync(join(f.root, 'downloads')).filter((v)=>v.startsWith('.gdrive-download.')).length, 0);
    return reply;
  }
  it('downloads verified bytes through the actual CLI', (t) => {
    const f=fixture(t), file=target(f); const result=f.run('download',['backups/synthetic.tar',f.path(file)]);
    succeeded(result); assert.deepEqual(readFileSync(file),Buffer.from(payload));
    const reply=JSON.parse(result.stdout); assert.equal(reply.ok,true); assert.equal(reply.bytes,payloadBytes);
    const order=f.trace().map((v)=>v.kind); assert.ok(order.indexOf('metadata')<order.indexOf('download'));
    assert.equal(order.filter((v)=>v==='metadata').length,2);
    assert.equal(readdirSync(join(f.root,'downloads')).length,1);
  });
  for (const args of [[], ['backups/test.tar']]) it(`returns one JSON usage error for ${args.length} arguments`, (t) => {
    const f=fixture(t), result=f.run('download',args); failed(result);
    assert.equal(JSON.parse(result.stdout).error,'usage'); assert.equal(f.trace().length,0);
  });
  for (const remote of ['logs/test.log','backups/test.tar','test.tar']) it(`retains supported remote selector ${remote}`, (t)=>{
    const f=fixture(t), file=target(f); succeeded(f.run('download',[remote,f.path(file)]));
    const lookup=f.trace().find((v)=>v.kind==='lookup');
    assert.ok(lookup.query.q[0].includes(`'${remote.startsWith('logs/')?'folder1':'backup1'}' in parents`));
  });
  for (const [label,opts,error] of [
    ['missing',{newFile:true},'remote_missing'],
    ['HTTP failure',{lookupHttp:500},'remote_lookup_failed'],
    ['partial lookup',{lookupExit:7},'remote_lookup_failed'],
    ['ambiguous',{lookupBody:'{"files":[{"id":"file1"},{"id":"file2"}]}'},'remote_lookup_failed'],
  ]) it(`distinguishes ${label} before touching destination`, (t)=>{
    const f=fixture(t,opts),file=target(f); const reply=assertPreserved(f,file,f.run('download',['test.tar',f.path(file)]));
    assert.equal(reply.error,error); assert.ok(f.trace().some((v)=>v.kind==='lookup'));
    assert.ok(!f.trace().some((v)=>v.kind==='download'));
  });
  for (const [label,opts] of [
    ['HTTP 403',{downloadHttp:403}],['HTTP 500',{downloadHttp:500}],
    ['HTTP 206',{downloadHttp:206}],['curl with partial body',{downloadExit:18,downloadBody:'partial'}],
    ['curl fails after printing 200',{downloadExit:7}],
  ]) it(`preserves old destination after ${label}`, (t)=>{
    const f=fixture(t,opts),file=target(f); const reply=assertPreserved(f,file,f.run('download',['test.tar',f.path(file)]));
    assert.equal(reply.error,'download_failed'); assert.ok(f.trace().some((v)=>v.kind==='download-output'));
  });
  it('does not publish or leave a new partial destination', (t)=>{
    const f=fixture(t,{downloadExit:18,downloadBody:'partial'}),file=target(f); rmSync(file);
    const result=f.run('download',['test.tar',f.path(file)]); failed(result); assert.ok(!existsSync(file));
    assert.ok(f.trace().some((v)=>v.kind==='download'));
    assert.deepEqual(readdirSync(join(f.root,'downloads')),[]);
  });
  for (const [label,opts] of [
    ['bad metadata HTTP',{metadataHttp:500}],['bad metadata process',{metadataExit:7}],
    ['wrong ID',{metadataId:'different'}],['bad JSON',{metadataBody:'{"id":"file1"'}],
    ['absent size',{metadataBody:'{"id":"file1"}'}],
  ]) it(`refuses ${label} before content download`, (t)=>{
    const f=fixture(t,opts),file=target(f); const reply=assertPreserved(f,file,f.run('download',['test.tar',f.path(file)]));
    assert.equal(reply.error,'download_metadata_failed'); assert.ok(f.trace().some((v)=>v.kind==='metadata'));
    assert.ok(!f.trace().some((v)=>v.kind==='download'));
  });
  it('does not publish truncated bytes with HTTP 200', (t)=>{
    const f=fixture(t,{downloadBody:'short'}),file=target(f);
    const reply=assertPreserved(f,file,f.run('download',['test.tar',f.path(file)]));
    assert.equal(reply.error,'download_size_mismatch'); assert.ok(f.trace().some((v)=>v.kind==='download'));
  });
  for (const [label,opts] of [
    ['changed size',{postMetadataBody:'{"id":"file1","size":"42"}'}],
    ['HTTP error',{postMetadataHttp:500}],['parser error',{postMetadataBody:'invalid'}],
  ]) it(`keeps old destination after post-download metadata ${label}`, (t)=>{
    const f=fixture(t,opts),file=target(f); assertPreserved(f,file,f.run('download',['test.tar',f.path(file)]));
    assert.equal(f.trace().filter((v)=>v.kind==='metadata').length,2);
  });
  for (const at of ['lookup','download']) it(`stops changed context at ${at} without publishing`, (t)=>{
    const f=fixture(t,{changeContextAt:at}),file=target(f);
    assertPreserved(f,file,f.run('download',['test.tar',f.path(file)]));
    assert.ok(f.trace().some((v)=>v.contextChanged));
    if(at==='lookup') assert.ok(!f.trace().some((v)=>v.kind==='download'));
  });
  it('checks decimal length and preserves binary content including NUL', (t)=>{
    const data=Buffer.from([0,255,13,10,42,0]),f=fixture(t,{remoteSize:'0006',downloadHex:data.toString('hex')}),file=target(f);
    const result=f.run('download',['test.tar',f.path(file)]); succeeded(result);
    assert.deepEqual(readFileSync(file),data); assert.equal(JSON.parse(result.stdout).bytes,6);
    assert.equal(f.trace().find((v)=>v.kind==='download-output').maxFilesize,'6');
  });
  it('permits a confirmed empty blob', (t)=>{
    const f=fixture(t,{remoteSize:0,downloadBody:''}),file=target(f); const result=f.run('download',['empty.log',f.path(file)]);
    succeeded(result); assert.equal(readFileSync(file).length,0); assert.equal(JSON.parse(result.stdout).bytes,0);
  });
  it('supports spaces quotes and UTF-8 in a nested destination', (t)=>{
    const f=fixture(t),dir=join(f.root,'new dir'),file=join(dir,native?'копия "семья".tar':'копия семьи.tar');
    const result=f.run('download',['backups/семья "test".tar',f.path(file)]); succeeded(result);
    assert.deepEqual(readFileSync(file),Buffer.from(payload)); assert.equal(JSON.parse(result.stdout).remote,'семья "test".tar');
  });
  for (const suffix of ['../escape.tar','./saved.tar','nested/../saved.tar','saved.tar/']) it(`rejects ambiguous local components ${suffix}`, (t)=>{
    const f=fixture(t),file=target(f); const result=f.run('download',['test.tar',`${f.path(join(f.root,'downloads'))}/${suffix}`]);
    failed(result); assert.equal(JSON.parse(result.stdout).error,'local_path_not_allowed');
    assert.equal(readFileSync(file,'utf8'),oldData); assert.ok(!f.trace().some((v)=>v.kind==='download'));
  });
  for (const type of ['final link','parent link','directory']) it(`rejects destination ${type}`, {skip:!native}, (t)=>{
    const f=fixture(t),file=target(f),outside=join(f.root,'other'); mkdirSync(outside);
    const saved=join(outside,'copy.tar');writeFileSync(saved,oldData);let dest=file;
    if(type==='final link'){rmSync(file);symlinkSync(saved,file);}
    if(type==='parent link'){dest=join(f.root,'alias','copy.tar');symlinkSync(outside,join(f.root,'alias'));}
    if(type==='directory'){rmSync(file);mkdirSync(file);}
    const result=f.run('download',['test.tar',f.path(dest)]);failed(result);
    assert.equal(JSON.parse(result.stdout).error,'local_path_not_allowed');assert.equal(readFileSync(saved,'utf8'),oldData);
    assert.ok(!f.trace().some((v)=>v.kind==='download'));
  });
  it('uses private staging and publishes mode 0600', {skip:!native}, (t)=>{
    const f=fixture(t),file=target(f);chmodSync(file,0o644);succeeded(f.run('download',['test.tar',f.path(file)]));
    // setgid может наследоваться от каталога sandbox; проверяем именно биты доступа.
    const event=f.trace().find((v)=>v.kind==='download-output');assert.equal(event.mode&0o777,0o600);assert.equal(event.parentMode&0o777,0o700);
    assert.notEqual(event.path,f.path(file));assert.equal(statSync(file).mode&0o777,0o600);
  });
  for (const tool of ['mkdir','mktemp','chmod','mv','wc']) it(`preserves destination after injected ${tool} failure`, {skip:!native}, (t)=>{
    const f=fixture(t),file=target(f);
    const predicate=tool==='mkdir'?`case "$*" in *downloads*) true;; *) false;; esac`
      :tool==='wc'?`[ -f ${q(f.path(join(f.root,'download-wc-ready')))} ]`
      :`case "$*" in *.gdrive-download.*) true;; *) false;; esac`;
    if(tool==='wc'){
      // Сбой только после передачи content, не во время OAuth/metadata.
      f.fault('curl',`case "$*" in *alt=media*) true;; *) false;; esac`,
        `"${f.path(join(f.bin,'curl-original'))}" "$@"; status=$?; touch ${q(f.path(join(f.root,'download-wc-ready')))}; exit "$status"`);
    }
    f.fault(tool,predicate,tool==='wc'?"printf '25\\n'; exit 1":"exit 1");
    assertPreserved(f,file,f.run('download',['test.tar',f.path(file)]));
    assert.ok(f.trace().some((v)=>v.kind===`${tool}-fault`),'fault not reached');
  });
  it('downloads a config archive without applying settings', (t)=>{
    const f=fixture(t),file=target(f),configFile=join(f.root,'config','sheepfold');writeFileSync(configFile,'original settings');
    succeeded(f.run('download',['backups/sheepfold-config-20260911.tar',f.path(file)]));
    assert.equal(readFileSync(configFile,'utf8'),'original settings');
  });
  it('blocks a traversal outside the permitted root without changing the neighbour', (t)=>{
    const f=fixture(t),neighbour=f.root+'-neighbour';mkdirSync(neighbour);t.after(()=>rmSync(neighbour,{recursive:true,force:true}));
    const file=join(neighbour,'saved.tar');writeFileSync(file,oldData);
    const destination=f.path(f.root)+'/../'+basename(neighbour)+'/saved.tar';
    const result=f.run('download',['test.tar',destination]);failed(result);
    assert.equal(JSON.parse(result.stdout).error,'local_path_not_allowed');assert.equal(readFileSync(file,'utf8'),oldData);
    assert.ok(!f.trace().some((v)=>v.kind==='download'));
  });
  it('rejects a control character in the remote name before HTTP', (t)=>{
    const f=fixture(t),file=target(f),reply=assertPreserved(f,file,f.run('download',['bad\nname.tar',f.path(file)]));
    assert.equal(reply.error,'path_not_allowed');assert.equal(f.trace().length,0);
  });
});
