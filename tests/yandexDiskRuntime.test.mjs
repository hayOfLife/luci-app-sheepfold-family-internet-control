/*
 * Настоящий Yandex shell в отдельном .build: curl никогда не обращается в сеть,
 * а записывает argv и выдаёт синтетический HTTP; UCI различает файл и черновик.
 * Проверяем запросы PROPFIND, отказ транспорта и отсутствие записи при status.
 * Выбранные helpers вызываются из неизменённого префикса production-скрипта.
 * Файлы удаляются после теста. Результат не доказывает XML-разбор, работу Яндекс
 * Диска, отправку/восстановление архивов, нативный UCI или поведение на роутере.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { shellTestPath } from '../tools/quality/testEnvironment.mjs';

const repo = resolve(import.meta.dirname, '..');
const runtime = join(repo, 'package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold');
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const xml = '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">\n<d:response>\n<d:href>/sheepfold/logs/test.log</d:href>\n<d:propstat><d:prop>\n<d:getcontentlength>19</d:getcontentlength>\n</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>\n</d:multistatus>\n';

function fixture(t, opts = {}) {
  const parent = join(repo, '.build', 'yandex-fixtures'); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'case-'));
  const bin = join(root, 'bin'), ram = join(root, 'ram'), config = join(root, 'config');
  for (const dir of [bin, ram, config]) mkdirSync(dir);
  const path = (value) => shellTestPath(value, { cwd: repo, allowedRoot: root });
  const put = (name, text) => { writeFileSync(join(bin, name), text); chmodSync(join(bin, name), 0o755); };
  const options = join(root, 'options.json'), state = join(root, 'state.json'), trace = join(root, 'trace.jsonl');
  writeFileSync(options, JSON.stringify({ body: xml, ...opts }));
  writeFileSync(state, JSON.stringify({ saved: {
    'sheepfold.global.log_storage': 'yandex_disk', 'sheepfold.global.block_all': '0',
    'sheepfold.cloud.login': 'synthetic@example.invalid', 'sheepfold.cloud.password': 'synthetic-only',
    'sheepfold.cloud.root_folder': '/sheepfold', 'sheepfold.cloud.quota_mb': '500',
    'sheepfold.cloud.authorized': '0', ...opts.saved,
  }, pending: { 'sheepfold.global.block_all': '1', ...opts.pending } }));
  writeFileSync(trace, '');
  const original = readFileSync(join(process.env.SHEEPFOLD_YANDEX_TEST_SOURCE || runtime, 'sheepfold-yandex-disk'), 'utf8');
  const source = original.replaceAll('/tmp/sheepfold', path(ram))
    .replaceAll('/etc/config', path(config)).replaceAll('/etc/init.d/sheepfold', path(join(root, 'no-service')));
  put('sheepfold-yandex-disk', source);
  const marker = '\ncommand_name="${1:-}"';
  assert.ok(source.lastIndexOf(marker) > 0, 'production dispatcher boundary');
  put('library.sh', source.slice(0, source.lastIndexOf(marker)) + '\n');
  put('uci', `#!/bin/sh\nexec python3 -S ${quote(path(join(bin, 'double.py')))} uci "$@"\n`);
  put('curl', `#!/bin/sh\nexec python3 -S ${quote(path(join(bin, 'double.py')))} curl "$@"\n`);
  put('double.py', `import json,os,sys,pathlib
kind=sys.argv[1]; args=sys.argv[2:]; opts=json.load(open(os.environ['YANDEX_OPTIONS']))
def record(obj):
 with open(os.environ['YANDEX_TRACE'],'a') as f: f.write(json.dumps(obj)+'\\n')
if kind=='uci':
 args=[v for v in args if v!='-q']; state_path=os.environ['YANDEX_STATE']; state=json.load(open(state_path))
 record({'kind':'uci','args':args})
 if args[0]=='get':
  key=args[1]
  if key==opts.get('failGet'):
   print(opts.get('partialGet',''),end=''); sys.exit(1)
  value=state['pending'].get(key,state['saved'].get(key))
  if value is None: sys.exit(1)
  print(value,end=''); sys.exit(0)
 if args[0]=='set':
  key,value=args[1].split('=',1); state['pending'][key]=value
 elif args[0]=='commit':
  state['saved'].update(state['pending']); state['pending']={}
 else: sys.exit(1)
 pathlib.Path(state_path).write_text(json.dumps(state)); sys.exit(0)
values={}; headers=[]; urls=[]; i=0
while i<len(args):
 arg=args[i]
 if arg in ('-m','--max-time','-o','--output','-w','--write-out','-u','--user','-X','--request','-H','--header','--url','--proto','--proto-redir','-T'):
  value=args[i+1]; values[arg]=value; i+=2
  if arg in ('-H','--header'): headers.append(value)
  if arg=='--url': urls.append(value)
 elif arg.startswith('-'): i+=1
 else: urls.append(arg); i+=1
method=values.get('-X',values.get('--request','GET'))
url=urls[-1] if urls else ''
probe=url=='https://webdav.yandex.ru/'
http=str(opts.get('probeHttp',207) if probe else opts.get('readHttp',207))
exit_code=int(opts.get('probeExit',0) if probe else opts.get('readExit',0))
body=opts.get('body','')
if method=='MKCOL': http='403'; exit_code=0; body=''
record({'kind':'curl','args':args,'headers':headers,'urls':urls,'method':method,'probe':probe,'http':http,'exit':exit_code})
output=values.get('-o',values.get('--output'))
if output and output!='/dev/null': pathlib.Path(output).write_text(body)
elif not output: print(body,end='')
writeout=values.get('-w',values.get('--write-out',''))
print(writeout.replace('%{http_code}',http).replace('\\\\n','\\n'),end='')
sys.exit(exit_code)
`);
  const env = { ...process.env, YANDEX_OPTIONS: options, YANDEX_STATE: state, YANDEX_TRACE: trace, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
  const results = [];
  const capture = (action, result) => { results.push({ action, status:result.status, stdout:result.stdout, stderr:result.stderr, error:result.error?.message }); return result; };
  const run = (args) => capture(args, spawnSync('sh', ['-c', `export PATH=${quote(path(bin))}:"$PATH"; exec sh "$@"`, 'fixture', path(join(bin, 'sheepfold-yandex-disk')), ...args], { cwd: repo, env, encoding: 'utf8', timeout: 10000 }));
  const helper = (command) => capture(command, spawnSync('sh', ['-c', `export PATH=${quote(path(bin))}:"$PATH"; . ${quote(path(join(bin, 'library.sh')))}; ${command}`], { cwd: repo, env, encoding: 'utf8', timeout: 10000 }));
  const events = () => readFileSync(trace,'utf8').split('\n').filter(Boolean).map((v) => JSON.parse(v));
  const readState = () => JSON.parse(readFileSync(state,'utf8'));
  t.after(() => {
    const evidence = process.env.SHEEPFOLD_YANDEX_EVIDENCE_DIR;
    if (evidence) {
      mkdirSync(evidence,{ recursive:true });
      const name = createHash('sha256').update(t.name).digest('hex').slice(0,16);
      writeFileSync(join(evidence, name+'.json'), JSON.stringify({ scenario:t.name, events:events(), results, state:readState() },null,2)+'\n');
    }
    rmSync(root,{recursive:true,force:true});
  });
  return { run, helper, events, readState };
}
const parse = (result) => { assert.ifError(result.error); return JSON.parse(result.stdout); };
const curls = (f) => f.events().filter((e)=>e.kind==='curl');

describe('Yandex WebDAV request boundary', () => {
  for (const [name, command, depth] of [
    ['folder size', 'folder_used_bytes /sheepfold', '1'],
    ['file size', 'remote_file_bytes /sheepfold/logs/test.log', '0'],
    ['folder list helper', 'propfind_folder_json_array /sheepfold/logs', '1'],
  ]) it(`passes a single Depth header and no extra URL for ${name}`, (t) => {
    const f=fixture(t); const result=f.helper(command);
    assert.equal(result.status,0,result.stderr);
    const requests=curls(f); assert.equal(requests.length,1);
    assert.equal(requests[0].urls.length,1,JSON.stringify(requests));
    assert.deepEqual(requests[0].headers,[`Depth: ${depth}`]);
    assert.equal(requests[0].method,'PROPFIND');
  });
  for (const http of [200,301,401,403,500,'garbage']) it(`rejects a non-Multi-Status read ${http}`, (t) => {
    const f=fixture(t,{readHttp:http}); const result=f.helper('folder_used_bytes /sheepfold');
    assert.notEqual(result.status,0); assert.equal(result.stdout,''); assert.equal(curls(f).length,1);
  });
  it('discards a partial body from failed curl even with HTTP 207', (t) => {
    const f=fixture(t,{readExit:18}); const result=f.helper('folder_used_bytes /sheepfold');
    assert.notEqual(result.status,0); assert.equal(result.stdout,''); assert.equal(curls(f)[0].exit,18);
  });
  it('retains the response body after a successful transport read', (t) => {
    // Проверяем транспорт, а не старый XML-reader: его greedy sed уже теряет размер.
    const f=fixture(t); const result=f.helper('webdav_request PROPFIND https://webdav.yandex.ru/sheepfold 0');
    assert.equal(result.status,0,result.stderr); assert.equal(result.stdout,xml);
  });
});

describe('Yandex connection probe outcomes', () => {
  it('accepts successful HTTP 207 and sends only one root request', (t) => {
    const f=fixture(t); const result=f.run(['test']); assert.equal(result.status,0,result.stderr);
    assert.equal(parse(result).ok,true); assert.equal(curls(f).length,1);
    assert.deepEqual(curls(f)[0].urls,['https://webdav.yandex.ru/']);
  });
  for (const http of [200,301,302,307,401,403,500,'bad']) it(`does not announce login success for HTTP ${http}`, (t) => {
    const f=fixture(t,{probeHttp:http}); const result=f.run(['test']);
    assert.notEqual(result.status,0); const body=parse(result); assert.equal(body.ok,false);
    assert.equal(body.error,([401,403].includes(http)?'auth_failed':'unreachable'));
    assert.equal(typeof body.http,'number'); assert.equal(curls(f).length,1);
  });
  for (const http of ['000','207']) it(`returns valid JSON when failed curl printed ${http}`, (t) => {
    const f=fixture(t,{probeHttp:http,probeExit:28}); const result=f.run(['test']);
    assert.notEqual(result.status,0); const body=parse(result); assert.equal(body.ok,false); assert.equal(body.http,0);
    assert.equal(curls(f)[0].exit,28);
  });
  for (const key of ['login','password']) it(`does not send a partial ${key} after UCI failure`, (t) => {
    const f=fixture(t,{failGet:`sheepfold.cloud.${key}`,partialGet:'synthetic-partial'});
    const result=f.run(['test']); assert.notEqual(result.status,0); assert.equal(parse(result).ok,false);
    assert.equal(curls(f).length,0); assert.ok(f.events().some((e)=>e.kind==='uci' && e.args[1]===`sheepfold.cloud.${key}`));
  });
  it('keeps curlrc from enabling redirects for the probe and metadata read', (t) => {
    const f=fixture(t); f.run(['test']); f.helper('folder_used_bytes /sheepfold');
    assert.equal(curls(f).length,2);
    for (const e of curls(f)) { assert.equal(e.args[0],'-q'); assert.ok(e.args.includes('-g')); assert.ok(!e.args.includes('-L')); }
  });
});

describe('Yandex status observation and archive preflight', () => {
  it('leaves saved config and the unrelated pending draft unchanged on success', (t) => {
    const f=fixture(t); const before=f.readState(); const result=f.run(['status']);
    assert.equal(result.status,0,result.stderr); assert.equal(parse(result).authorized,1);
    assert.deepEqual(f.readState(),before);
    assert.ok(!f.events().some((e)=>e.kind==='uci' && ['set','commit'].includes(e.args[0])));
  });
  for (const http of [301,302,401,500]) it(`does not authorize or change config on status HTTP ${http}`, (t) => {
    const f=fixture(t,{probeHttp:http}); const before=f.readState(); const result=f.run(['status']);
    assert.equal(result.status,0,result.stderr); const body=parse(result);
    assert.equal(body.authorized,0); assert.equal(body.state,'error'); assert.deepEqual(f.readState(),before);
    assert.equal(curls(f).length,1);
  });
  it('does not turn a failed quota HTTP request into confirmed free space', (t) => {
    const f=fixture(t,{readHttp:403}); const result=f.run(['status']);
    assert.equal(result.status,0,result.stderr); const body=parse(result);
    assert.equal(body.state,'error'); assert.equal(body.free_pct,0); assert.equal(curls(f).length,2);
  });
  for (const authorized of ['0','1']) it(`rejects current bad credentials before archive mutation with flag ${authorized}`, (t) => {
    const f=fixture(t,{probeHttp:401,saved:{'sheepfold.cloud.authorized':authorized}});
    const before=f.readState(); const result=f.run(['archive-push']);
    assert.notEqual(result.status,0); assert.equal(parse(result).error,'auth_failed');
    assert.equal(curls(f).length,1); assert.equal(curls(f)[0].method,'PROPFIND'); assert.deepEqual(f.readState(),before);
  });
  for (const authorized of ['0','1']) it(`reaches explicit archive preparation without writing a flag ${authorized}`, (t) => {
    // MKCOL намеренно отказывает: проверяем только preflight до подготовки,
    // не выдаём старый непроверенный uploader за рабочую отправку.
    const f=fixture(t,{saved:{'sheepfold.cloud.authorized':authorized}});
    const before=f.readState(); const result=f.run(['archive-push']);
    assert.notEqual(result.status,0);
    assert.deepEqual(curls(f).map((e)=>e.method),['PROPFIND','MKCOL']);
    assert.deepEqual(f.readState(),before);
  });
  it('keeps another selected storage backend network-free for status and archive', (t) => {
    const f=fixture(t,{saved:{'sheepfold.global.log_storage':'ram'}});
    assert.equal(f.run(['status']).status,0); assert.equal(f.run(['archive-push']).status,0);
    assert.equal(curls(f).length,0);
  });
});
