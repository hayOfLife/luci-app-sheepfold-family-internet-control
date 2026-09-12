/*
 * Исполняет настоящий Yandex uploader/verify и архивный caller в .build.
 * HTTP/UCI синтетические; cp/cmp/wc, файлы и права реальные. Искусственный
 * отказ обязан оставить trace; все файлы удаляются после теста. Это не
 * доказательство поддержки HEAD Яндексом, checksum, native UCI, quota/restore.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { shellTestPath } from '../tools/quality/testEnvironment.mjs';

const repo=resolve(import.meta.dirname,'..');
const runtime=join(repo,'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold');
const quote=v=>`'${String(v).replaceAll("'","'\\''")}'`;
const pythonCmd=process.env.PYTHON_EXECUTABLE||(process.platform==='win32'?'python':'python3');
const python=/[\\/]/.test(pythonCmd)?shellTestPath(pythonCmd,{cwd:repo}):pythonCmd;
const posix=process.platform!=='win32';
const payload=Buffer.from('Synthetic archive: тест\n');

function fixture(t,opts={}) {
  const parent=join(repo,'.build','yandex-upload-fixtures'); mkdirSync(parent,{recursive:true});
  const root=mkdtempSync(join(parent,'case-')),bin=join(root,'bin'),ram=join(root,'ram'),config=join(root,'config');
  for(const dir of [bin,ram,config]) mkdirSync(dir);
  const path=p=>shellTestPath(p,{cwd:repo,allowedRoot:root});
  const queue=join(ram,'.private','archive'); mkdirSync(queue,{recursive:true});
  const sourceFile=join(queue,'pending.tar');
  const content=Object.hasOwn(opts,'content')?Buffer.from(opts.content,'hex'):payload;
  writeFileSync(sourceFile,content);
  writeFileSync(join(config,'sheepfold'),"config global 'global'\n\toption block_all '0'\n");
  const foreign=join(root,'foreign'); mkdirSync(foreign); writeFileSync(join(foreign,'keep'),'foreign data');
  if(opts.sourceLink){rmSync(sourceFile);writeFileSync(join(root,'original'),content);symlinkSync(join(root,'original'),sourceFile);}
  const tracePath=join(root,'trace.jsonl'),optsPath=join(root,'options.json'),statePath=join(root,'state.json');
  writeFileSync(tracePath,'');writeFileSync(optsPath,JSON.stringify(opts));writeFileSync(statePath,'{}');
  const text=readFileSync(join(process.env.SHEEPFOLD_YANDEX_TEST_SOURCE||runtime,'sheepfold-yandex-disk'),'utf8');
  const sourceDigest=createHash('sha256').update(text).digest('hex');
  const mapped=text.replaceAll('/tmp/sheepfold',path(ram)).replaceAll('/etc/config',path(config)).replaceAll('/usr/libexec/sheepfold/',path(bin)+'/');
  const put=(name,data)=>{writeFileSync(join(bin,name),data);chmodSync(join(bin,name),0o755);};
  put('entry',mapped);
  // На Windows эта модель только пропускает lock; его конкурентность проверяет Linux-suite.
  if (process.platform === 'win32') put('flock', '#!/bin/sh\nexit 0\n');
  // Экспортёр загружает настоящие общие readers/lock; пути остаются в fixture.
  for (const name of ['sheepfold-log-common', 'sheepfold-lock-common']) {
    put(name, readFileSync(join(runtime, name), 'utf8').replaceAll('/tmp/sheepfold', path(ram)));
  }
const boundary='\ncommand_name="${1:-}"';assert.ok(mapped.lastIndexOf(boundary)>0);
  put('library',mapped.slice(0,mapped.lastIndexOf(boundary))+'\n');
  const tools={};
  for(const name of ['cp','cmp','chmod','mktemp','wc','awk']){
    const r=spawnSync('sh',['-c','command -v "$1"','tool',name],{encoding:'utf8'});assert.equal(r.status,0);
    let native=r.stdout.trim();
    if(!posix){const n=spawnSync('sh',['-c','cygpath -w "$1"','tool',native],{encoding:'utf8'});assert.equal(n.status,0);native=n.stdout.trim();}
    tools[name]=native;
  }
  writeFileSync(join(root,'tools.json'),JSON.stringify(tools));
  const faultTool={copy:'cp',badcopy:'cp',cmp:'cmp','chmod-source':'chmod','chmod-work':'chmod',mktemp:'mktemp',wc:'wc','headers-parser':'awk'}[opts.fault];
  // Не запускаем Python вместо исправных файловых утилит: подмена нужна только
  // там, где сценарий действительно вносит отказ и проверяет его trace.
  for(const name of ['uci','curl',...(faultTool?[faultTool]:[])])put(name,`#!/bin/sh\nexec ${quote(python)} -S ${quote(path(join(bin,'tool.py')))} ${quote(name)} "$@"\n`);
  put('tool.py',`import sys,os,json,pathlib,subprocess,stat
kind=sys.argv[1]; args=sys.argv[2:]; opts=json.load(open(os.environ['YU_OPTIONS'])); statePath=pathlib.Path(os.environ['YU_STATE']); state=json.loads(statePath.read_text())
def record(**e):
 with open(os.environ['YU_TRACE'],'a') as f: f.write(json.dumps({'kind':kind,**e})+'\\n')
def fail(label):
 record(fault=label,args=args); sys.exit(1)
fault=opts.get('fault',''); record(args=args)
if kind=='uci':
 a=[v for v in args if v!='-q']; vals={'sheepfold.global.log_storage':'yandex_disk','sheepfold.cloud.login':'synthetic@example.invalid','sheepfold.cloud.password':'not-real','sheepfold.cloud.root_folder':'/sheepfold','sheepfold.cloud.quota_mb':'500'}
 if state.get('_changed'):vals['sheepfold.cloud.password']='other-password'
 if a[0]=='get':
  if opts.get('credentialFault') and a[1]=='sheepfold.cloud.password': print('partial',end=''); fail('credential')
  if a[1] not in vals: sys.exit(1)
  print(vals[a[1]],end='')
 elif a[0]=='show':
  print('sheepfold.cloud=cloud')
  for k,v in vals.items():
   if k.startswith('sheepfold.cloud.'): print(k+'='+repr(v))
 else: fail('uci-write')
 sys.exit(0)
if kind=='curl':
 values={}; urls=[]; i=0
 while i<len(args):
  a=args[i]
  if a in ['-m','-o','-w','-u','-X','-H','--proto','--url','-T','-D']:
   values[a]=args[i+1]
   if a=='--url':urls.append(args[i+1])
   i+=2
  elif a.startswith('-'):i+=1
  else:urls.append(a);i+=1
 method=values.get('-X','HEAD' if '--head' in args or '-I' in args else ('PUT' if '-T' in values else 'GET'));url=urls[-1] if urls else ''
 http='207';exitCode=0;body=''
 if method=='PUT':
  data=pathlib.Path(values['-T']).read_bytes();state[url]=data.hex();statePath.write_text(json.dumps(state))
  record(method=method,urls=urls,hex=data.hex(),fileMode=stat.S_IMODE(pathlib.Path(values['-T']).stat().st_mode)&0o777,parentMode=stat.S_IMODE(pathlib.Path(values['-T']).parent.stat().st_mode)&0o777)
  http=str(opts.get('putHttp',201));exitCode=opts.get('putExit',0)
  if opts.get('credentialChange')=='put':state['_changed']=True;statePath.write_text(json.dumps(state));record(credentialChange='put')
  if opts.get('change')=='put' and not state.get('_mutated') and pathlib.Path(os.environ['YU_SOURCE']).exists():pathlib.Path(os.environ['YU_SOURCE']).write_bytes(b'X'*len(pathlib.Path(os.environ['YU_SOURCE']).read_bytes()));state['_mutated']=True;statePath.write_text(json.dumps(state));record(changed='put')
 elif method=='HEAD':
  n=opts.get('remoteSize',len(bytes.fromhex(state[url])) if url in state else len(pathlib.Path(os.environ['YU_SOURCE']).read_bytes()))
  http=str(opts.get('headHttp',200));exitCode=opts.get('headExit',0)
  headers=opts.get('headHeaders','HTTP/1.1 200 OK\\r\\nContent-Length: '+str(n)+'\\r\\n\\r\\n')
  if '-D' in values:pathlib.Path(values['-D']).write_bytes(headers.encode())
  record(method=method,urls=urls,headers=headers,http=http,exit=exitCode)
  if opts.get('credentialChange')=='head':state['_changed']=True;statePath.write_text(json.dumps(state));record(credentialChange='head')
  if opts.get('change')=='head' and not state.get('_mutated') and pathlib.Path(os.environ['YU_SOURCE']).exists():pathlib.Path(os.environ['YU_SOURCE']).write_bytes(b'X'*len(pathlib.Path(os.environ['YU_SOURCE']).read_bytes()));state['_mutated']=True;statePath.write_text(json.dumps(state));record(changed='head')
 elif method=='MKCOL':http='201';record(method=method,urls=urls)
 elif method=='PROPFIND':
  n=opts.get('remoteSize',len(pathlib.Path(os.environ['YU_SOURCE']).read_bytes())) if pathlib.Path(os.environ['YU_SOURCE']).exists() else 0
  body='<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop><d:getcontentlength>'+str(n)+'</d:getcontentlength></d:prop></d:propstat></d:response></d:multistatus>' if 'logs/pending' in url else '<d:multistatus xmlns:d="DAV:"/>'
  record(method=method,urls=urls)
 else:http='500';record(method=method,urls=urls)
 if '-o' not in values:print(body,end='')
 elif values['-o']!='/dev/null':pathlib.Path(values['-o']).write_text(body)
 print(values.get('-w','').replace('%{http_code}',http).replace('\\\\n','\\n'),end='');sys.exit(exitCode)
real=json.load(open(os.environ['YU_TOOLS']))
if kind=='mktemp' and fault=='mktemp':print(os.environ['YU_FOREIGN'],end='');fail(fault)
if kind=='cp' and args[-1].endswith('/source'):
 if fault=='copy':pathlib.Path(args[-1]).write_bytes(b'partial');fail(fault)
 if fault=='badcopy':pathlib.Path(args[-1]).write_bytes(b'wrong');record(fault=fault);sys.exit(0)
if kind=='chmod':
 if fault=='chmod-source' and args[-1].endswith('/source'):fail(fault)
 if fault=='chmod-work' and '.yandex-transfer.' in args[-1] and not args[-1].endswith('/source'):fail(fault)
if kind=='cmp' and fault=='cmp':fail(fault)
if kind=='wc' and fault=='wc':print('123');fail(fault)
if kind=='awk' and fault=='headers-parser' and 'lengths = 0' in ' '.join(args):print('123',end='');fail(fault)
sys.exit(subprocess.run([real[kind],*args]).returncode)
`);
  const env={...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',YU_OPTIONS:path(optsPath),YU_TRACE:path(tracePath),YU_STATE:path(statePath),YU_SOURCE:path(sourceFile),YU_FOREIGN:path(foreign),YU_TOOLS:path(join(root,'tools.json'))};
  const results=[];
  const run=(action='upload',remote='/sheepfold/logs/pending.tar')=>{
    let command;
    if(action==='archive')command=`exec sh ${quote(path(join(bin,'entry')))} archive-push`;
    else if(action==='usage')command=`exec sh ${quote(path(join(bin,'entry')))} verify`;
    else if(action==='verify')command=`exec sh ${quote(path(join(bin,'entry')))} verify ${quote(path(sourceFile))} ${quote(remote)}`;
    else if(action==='metadata')command=`. ${quote(path(join(bin,'library')))}; remote_file_bytes ${quote(remote)}`;
    else command=`. ${quote(path(join(bin,'library')))}; ${action==='direct'?'upload_file':action==='metadata'?'remote_file_bytes':'upload_and_verify'} ${quote(path(sourceFile))} ${quote(remote)}`;
    const r=spawnSync('sh',['-c',`export PATH=${quote(path(bin))}:"$PATH"; ${command}`],{cwd:root,env,encoding:'utf8',timeout:20000});assert.ifError(r.error);
    results.push({action,remote,status:r.status,stdout:r.stdout,stderr:r.stderr});return r;
  };
  const trace=()=>readFileSync(tracePath,'utf8').split('\n').filter(Boolean).map(JSON.parse);
  t.after(()=>{
    if(process.env.SHEEPFOLD_YANDEX_UPLOAD_EVIDENCE_DIR){const dest=process.env.SHEEPFOLD_YANDEX_UPLOAD_EVIDENCE_DIR;mkdirSync(dest,{recursive:true});const name=createHash('sha256').update(t.name).digest('hex').slice(0,16);writeFileSync(join(dest,name+'.json'),JSON.stringify({name:t.name,opts,sourceDigest,results,trace:trace(),source:existsSync(sourceFile)?readFileSync(sourceFile).toString('hex'):null,leftovers:readdirSync(ram)},null,2));}
    rmSync(root,{recursive:true,force:true});
  });
  return{run,trace,sourceFile,content,ram,foreign};
}
const parsed=r=>JSON.parse(r.stdout);
const methods=f=>f.trace().filter(e=>e.method).map(e=>e.method);
const clean=f=>assert.deepEqual(readdirSync(f.ram).filter(n=>n.startsWith('.yandex-transfer.')),[]);

describe('Yandex upload and independent HEAD verification',()=>{
  for(const code of [200,201,204])it(`uploads bytes and verifies the saved object after HTTP ${code}`,t=>{
    const f=fixture(t,{putHttp:code}),r=f.run();assert.equal(r.status,0,r.stderr);assert.equal(parsed(r).ok,true);assert.equal(parsed(r).remote_bytes,f.content.length);assert.deepEqual(methods(f),['PUT','HEAD']);assert.equal(f.trace().find(e=>e.method==='PUT').hex,f.content.toString('hex'));assert.deepEqual(readFileSync(f.sourceFile),f.content);clean(f);
  });
  it('supports a confirmed empty file',t=>{const f=fixture(t,{content:''}),r=f.run();assert.equal(r.status,0,r.stderr);assert.equal(parsed(r).remote_bytes,0);clean(f);});
  it('supports binary bytes without transformation',t=>{const f=fixture(t,{content:'00fffe0a0102'}),r=f.run();assert.equal(r.status,0,r.stderr);assert.equal(f.trace().find(e=>e.method==='PUT').hex,'00fffe0a0102');});
  it('reads the exact remote byte count independently of the verify wrapper',t=>{const f=fixture(t),r=f.run('metadata');assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,String(f.content.length));});
  it('verify reads metadata without PUT and missing args return JSON',t=>{const f=fixture(t),r=f.run('verify');assert.equal(r.status,0,r.stderr);assert.deepEqual(methods(f),['HEAD']);const bad=f.run('usage');assert.notEqual(bad.status,0);assert.equal(parsed(bad).error,'usage');});
  it('uses one encoded HTTPS address without curlrc or redirect',t=>{
    const f=fixture(t),r=f.run('upload','/sheepfold/logs/тест #1%[x].tar');assert.equal(r.status,0,r.stderr);
    for(const e of f.trace().filter(e=>e.kind==='curl'&&e.args)){assert.equal(e.args[0],'-q');assert.ok(e.args.includes('-g'));assert.ok(e.args.includes('--url'));assert.ok(e.args.includes('=https'));assert.ok(!e.args.includes('-L'));}
    for(const e of f.trace().filter(e=>e.urls)){assert.equal(e.urls.length,1);assert.match(e.urls[0],/%20%231%25%5Bx%5D/);}
  });
  for(const code of [301,302,401,403,500,'000000'])it(`rejects PUT ${code} without confirming local deletion`,t=>{const f=fixture(t,{putHttp:code}),r=f.run();assert.notEqual(r.status,0);assert.equal(parsed(r).error,'upload_failed');assert.deepEqual(methods(f),['PUT']);assert.deepEqual(readFileSync(f.sourceFile),f.content);clean(f);});
  it('rejects curl failure even with PUT stdout 201',t=>{const f=fixture(t,{putExit:18}),r=f.run();assert.notEqual(r.status,0);assert.equal(parsed(r).error,'upload_failed');assert.deepEqual(methods(f),['PUT']);});
  it('direct PUT stops on partial credentials before network',t=>{const f=fixture(t,{credentialFault:true}),r=f.run('direct');assert.notEqual(r.status,0);assert.equal(methods(f).length,0);assert.ok(f.trace().some(e=>e.fault==='credential'));});
  it('direct PUT rejects redirects',t=>{const f=fixture(t,{putHttp:302}),r=f.run('direct');assert.notEqual(r.status,0);assert.equal(r.stdout,'');});
  it('rejects remote size mismatch and preserves source',t=>{const f=fixture(t,{remoteSize:5}),r=f.run();assert.notEqual(r.status,0);assert.equal(parsed(r).error,'size_mismatch');assert.equal(parsed(r).remote_bytes,5);assert.deepEqual(readFileSync(f.sourceFile),f.content);clean(f);});
});

describe('HEAD metadata is checked, never a default zero',()=>{
  const base='HTTP/1.1 200 OK\r\n';
  const badHeaders=[['missing length',base+'X-Test: 1\r\n\r\n'],['duplicate',base+'Content-Length: 27\r\nContent-Length: 27\r\n\r\n'],['comma list',base+'Content-Length: 27, 27\r\n\r\n'],['negative',base+'Content-Length: -1\r\n\r\n'],['garbage',base+'Content-Length: 2x\r\n\r\n'],['oversized number',base+'Content-Length: 999999999999999999999\r\n\r\n'],['partial block',base+'Content-Length: 27\r\n'],['wrong status','HTTP/1.1 404 Missing\r\nContent-Length: 27\r\n\r\n'],['compressed',base+'Content-Encoding: gzip\r\nContent-Length: 27\r\n\r\n'],['transfer encoding',base+'Transfer-Encoding: chunked\r\nContent-Length: 27\r\n\r\n'],['range',base+'Content-Range: bytes 0-26/100\r\nContent-Length: 27\r\n\r\n'],['folded field',base+'Content-Length: 27\r\n more\r\n\r\n'],['body',base+'Content-Length: 27\r\n\r\nbody\n'],['oversized header',base+'X-Fill: '+'x'.repeat(65536)+'\r\nContent-Length: 27\r\n\r\n']];
  for(const [name,headHeaders]of badHeaders)it(`rejects ${name}`,t=>{const f=fixture(t,{headHeaders}),r=f.run('verify');assert.notEqual(r.status,0);assert.equal(parsed(r).error,'remote_metadata_unavailable');assert.deepEqual(readFileSync(f.sourceFile),f.content);clean(f);});
  for(const http of [204,301,401,404,500])it(`rejects HEAD HTTP ${http}`,t=>{const f=fixture(t,{headHttp:http}),r=f.run();assert.notEqual(r.status,0);assert.equal(parsed(r).error,'remote_metadata_unavailable');clean(f);});
  it('discards headers from failed curl',t=>{const f=fixture(t,{headExit:18}),r=f.run();assert.notEqual(r.status,0);assert.equal(parsed(r).error,'remote_metadata_unavailable');clean(f);});
  it('uses final block and normalizes zeroes and case',t=>{const f=fixture(t,{headHeaders:`HTTP/1.1 200 Connection established\r\n\r\nHTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\ncOnTeNt-LeNgTh: 000${payload.length}\r\n\r\n`}),r=f.run('verify');assert.equal(r.status,0,r.stderr);assert.equal(parsed(r).remote_bytes,payload.length);});
});

describe('Snapshot ownership and complete archive caller',()=>{
  for(const fault of ['copy','badcopy','cmp','chmod-source','chmod-work','mktemp','wc'])it(`does not PUT after ${fault}`,t=>{const f=fixture(t,{fault}),r=f.run();assert.notEqual(r.status,0);assert.equal(parsed(r).error,'snapshot_failed');assert.ok(f.trace().some(e=>e.fault===fault),'fault reached');assert.equal(methods(f).length,0);assert.deepEqual(readFileSync(f.sourceFile),f.content);assert.equal(readFileSync(join(f.foreign,'keep'),'utf8'),'foreign data');clean(f);});
  it('discards failed header parser stdout',t=>{const f=fixture(t,{fault:'headers-parser'}),r=f.run();assert.notEqual(r.status,0);assert.equal(parsed(r).error,'remote_metadata_unavailable');assert.ok(f.trace().some(e=>e.fault==='headers-parser'));clean(f);});
  it('keeps snapshot private',{skip:!posix},t=>{const f=fixture(t),r=f.run();assert.equal(r.status,0);const e=f.trace().find(e=>e.method==='PUT');assert.equal(e.fileMode,0o600);assert.equal(e.parentMode,0o700);clean(f);});
  it('rejects symbolic source',{skip:!posix},t=>{const f=fixture(t,{sourceLink:true}),r=f.run();assert.notEqual(r.status,0);assert.equal(parsed(r).error,'local_missing');assert.deepEqual(methods(f),[]);});
  for(const change of ['put','head'])it(`keeps source changed during ${change}`,t=>{const f=fixture(t,{change}),r=f.run();assert.notEqual(r.status,0);assert.equal(parsed(r).error,'source_changed');assert.ok(f.trace().some(e=>e.changed===change));assert.deepEqual(readFileSync(f.sourceFile),Buffer.alloc(f.content.length,'X'));clean(f);});
  for(const credentialChange of ['put','head'])it(`does not confirm upload after credential change at ${credentialChange}`,t=>{const f=fixture(t,{credentialChange}),r=f.run();assert.notEqual(r.status,0);assert.equal(parsed(r).ok,false);assert.ok(f.trace().some(e=>e.credentialChange===credentialChange));assert.deepEqual(readFileSync(f.sourceFile),f.content);if(credentialChange==='put')assert.deepEqual(methods(f),['PUT']);clean(f);});
  it('archive-push removes queue only after complete verified upload',t=>{const f=fixture(t),r=f.run('archive');assert.equal(r.status,0,r.stderr);assert.equal(parsed(r).ok,true);assert.equal(parsed(r).pushed,2);assert.ok(!existsSync(f.sourceFile));assert.equal(methods(f).filter(v=>v==='PUT').length,2);assert.equal(methods(f).filter(v=>v==='HEAD').length,2);clean(f);});
  for(const opts of [{remoteSize:1},{putExit:18},{headHttp:500},{change:'head'}])it(`archive preserves queue on ${JSON.stringify(opts)}`,t=>{const f=fixture(t,opts),r=f.run('archive');assert.notEqual(r.status,0);assert.equal(parsed(r).ok,false);assert.ok(existsSync(f.sourceFile));clean(f);});
});
