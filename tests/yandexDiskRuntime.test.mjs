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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  const bin = join(root, 'bin'), ram = join(root, 'ram'), config = join(root, 'config'), work = join(root, 'work');
  for (const dir of [bin, ram, config, work]) mkdirSync(dir);
  // r317 проверяет backup до MKCOL. Реальный синтетический config сохраняет
  // достижимость прежних assertions транспорта; условие production не ослабляется.
  writeFileSync(join(config, 'sheepfold'), "config global 'global'\n\toption block_all '0'\n");
  for (const name of opts.localNames || []) writeFileSync(join(work, name), 'local fixture');
  if (opts.events !== undefined) writeFileSync(join(ram, 'events.log'), opts.events);
  const archiveDir = join(ram, '.private', 'archive');
  mkdirSync(archiveDir, { recursive: true });
  const archive = join(archiveDir, 'fixture.tar');
  writeFileSync(archive, 'synthetic archive to preserve');
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
  const initialState = JSON.parse(readFileSync(state, 'utf8'));
  for (const key of opts.removeSaved || []) delete initialState.saved[key];
  writeFileSync(state, JSON.stringify(initialState));
  writeFileSync(trace, '');
  let original = readFileSync(join(process.env.SHEEPFOLD_YANDEX_TEST_SOURCE || runtime, 'sheepfold-yandex-disk'), 'utf8');
  const inputDigest = createHash('sha256').update(original).digest('hex');
  const source = original.replaceAll('/tmp/sheepfold', path(ram))
    .replaceAll('/etc/config', path(config)).replaceAll('/usr/libexec/sheepfold/', path(bin) + '/').replaceAll('/etc/init.d/sheepfold', path(join(root, 'no-service')));
  put('sheepfold-yandex-disk', source);
  // На Windows эта модель только пропускает lock; его конкурентность проверяет Linux-suite.
  if (process.platform === 'win32') put('flock', '#!/bin/sh\nexit 0\n');
  // Экспортёр загружает настоящие общие readers/lock; пути остаются в fixture.
  for (const name of ['sheepfold-log-common', 'sheepfold-lock-common']) {
    put(name, readFileSync(join(runtime, name), 'utf8').replaceAll('/tmp/sheepfold', path(ram)));
  }

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
  if key=='sheepfold.cloud.root_folder' and 'rootChangesOnGet' in opts:
   state['saved'][key]=opts['rootChangesOnGet']; pathlib.Path(state_path).write_text(json.dumps(state))
   record({'kind':'rootChanged','value':opts['rootChangesOnGet']})
  print(value,end=''); sys.exit(0)
 if args[0]=='show':
  shows=sum(1 for line in open(os.environ['YANDEX_TRACE']) if json.loads(line).get('args')==args)
  if opts.get('showFailAt')==shows:
   record({'kind':'showFault','call':shows}); print(opts.get('partialShow',''),end=''); sys.exit(1)
  prefix=args[1]; merged={**state['saved'],**state['pending']}
  print(prefix+'=yandex_disk')
  for key in sorted(merged):
   if key.startswith(prefix+'.'): print(key+'='+json.dumps(merged[key]))
  sys.exit(0)
 if args[0]=='set':
  key,value=args[1].split('=',1); state['pending'][key]=value
 elif args[0]=='commit':
  state['saved'].update(state['pending']); state['pending']={}
 else: sys.exit(1)
 pathlib.Path(state_path).write_text(json.dumps(state)); sys.exit(0)
values={}; headers=[]; urls=[]; i=0
while i<len(args):
 arg=args[i]
 if arg in ('-m','--max-time','-o','--output','-w','--write-out','-u','--user','-X','--request','-H','--header','--url','--proto','--proto-redir','-T','-D'):
  value=args[i+1]; values[arg]=value; i+=2
  if arg in ('-H','--header'): headers.append(value)
  if arg=='--url': urls.append(value)
 elif arg.startswith('-'): i+=1
 else: urls.append(arg); i+=1
method=values.get('-X',values.get('--request','HEAD' if '--head' in args else ('PUT' if '-T' in values else 'GET')))
url=urls[-1] if urls else ''
probe=url=='https://webdav.yandex.ru/'
http=str(opts.get('probeHttp',207) if probe else opts.get('readHttp',207))
exit_code=int(opts.get('probeExit',0) if probe else opts.get('readExit',0))
body=opts.get('body','')
if method=='HEAD':
 http=str(opts.get('headHttp',200)); exit_code=int(opts.get('headExit',0)); body=''
 if '-D' in values: pathlib.Path(values['-D']).write_text('HTTP/1.1 200 OK\\r\\nContent-Length: 19\\r\\n\\r\\n')
if method=='PUT':
 http=str(opts.get('putHttp',201)); exit_code=int(opts.get('putExit',0)); body=''
if method=='MKCOL':
 index=sum(1 for line in open(os.environ['YANDEX_TRACE']) if json.loads(line).get('method')=='MKCOL')
 codes=opts.get('mkcolCodes', [opts.get('mkcolHttp',403)])
 http=str(codes[min(index,len(codes)-1)]); exit_code=int(opts.get('mkcolExit',0)); body=''
 if index==opts.get('failMkcolAt',-1): exit_code=28
upload=pathlib.Path(values['-T']).read_bytes().hex() if '-T' in values and pathlib.Path(values['-T']).is_file() else None
record({'kind':'curl','args':args,'headers':headers,'urls':urls,'method':method,'probe':probe,'http':http,'exit':exit_code,'uploadHex':upload})
output=values.get('-o',values.get('--output'))
if output and output!='/dev/null': pathlib.Path(output).write_text(body)
elif not output: print(body,end='')
writeout=values.get('-w',values.get('--write-out',''))
print(writeout.replace('%{http_code}',http).replace('\\\\n','\\n'),end='')
sys.exit(exit_code)
`);
  if (opts.failUrlEncoder) put('awk', `#!/bin/sh
case "$*" in
  *'codes[sprintf'*)
    printf '%s\\n' '{"kind":"encoderFault"}' >> "$YANDEX_TRACE"
    cat >/dev/null
    printf '/partial-result'
    exit 8 ;;
esac
exec /usr/bin/awk "$@"
`);
  const env = { ...process.env, YANDEX_OPTIONS: options, YANDEX_STATE: state, YANDEX_TRACE: trace, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
  const results = [];
  const capture = (action, result) => { results.push({ action, status:result.status, stdout:result.stdout, stderr:result.stderr, error:result.error?.message }); return result; };
  const run = (args) => capture(args, spawnSync('sh', ['-c', `export PATH=${quote(path(bin))}:"$PATH"; exec sh "$@"`, 'fixture', path(join(bin, 'sheepfold-yandex-disk')), ...args], { cwd: work, env, encoding: 'utf8', timeout: 10000 }));
  const helper = (command) => capture(command, spawnSync('sh', ['-c', `export PATH=${quote(path(bin))}:"$PATH"; . ${quote(path(join(bin, 'library.sh')))}; ${command}`], { cwd: work, env, encoding: 'utf8', timeout: 10000 }));
  const events = () => readFileSync(trace,'utf8').split('\n').filter(Boolean).map((v) => JSON.parse(v));
  const readState = () => JSON.parse(readFileSync(state,'utf8'));
  t.after(() => {
    const evidence = process.env.SHEEPFOLD_YANDEX_EVIDENCE_DIR;
    if (evidence) {
      mkdirSync(evidence,{ recursive:true });
      const name = createHash('sha256').update(t.name).digest('hex').slice(0,16);
      writeFileSync(join(evidence, name+'.json'), JSON.stringify({ scenario:t.name, inputDigest, events:events(), results, state:readState(), archiveHex:existsSync(archive) ? readFileSync(archive).toString('hex') : null, journalHex:existsSync(join(ram, 'events.log')) ? readFileSync(join(ram, 'events.log')).toString('hex') : null, stagingExists:existsSync(join(ram, '.yandex-backup-staging')) },null,2)+'\n');
    }
    rmSync(root,{recursive:true,force:true});
  });
  return { run, helper, events, readState, ram, archive };
}
const parse = (result) => { assert.ifError(result.error); return JSON.parse(result.stdout); };
const curls = (f) => f.events().filter((e)=>e.kind==='curl');

describe('Yandex WebDAV request boundary', () => {
  for (const [name, command, depth] of [
    ['folder size', 'folder_used_bytes /sheepfold', '1'],
    // Размер одного файла с r318 проверяет HEAD-контракт yandexUploadRuntime.
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

// r315: реальные аргументы MKCOL, изменения shell-состояния и источник root.
// Коды HTTP и UCI искусственные. Мы не доказываем готовность upload/restore.
describe('Yandex collection preparation without local shell expansion', () => {
  it('does not treat a bracketed remote component as files in the working directory', (t) => {
    const f = fixture(t, { mkcolHttp: 201, localNames: ['a', 'b'] });
    const result = f.helper("ensure_webdav_path '/family/[ab]/logs'");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(curls(f).map((e) => e.urls.map(decodeURIComponent)), [
      ['https://webdav.yandex.ru/family'],
      ['https://webdav.yandex.ru/family/[ab]'],
      ['https://webdav.yandex.ru/family/[ab]/logs'],
    ]);
  });
  it('does not turn a literal star into local filenames', (t) => {
    const f = fixture(t, { mkcolHttp: 201, localNames: ['alpha', 'beta'] });
    const result = f.helper("ensure_webdav_path '/family/*'");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(curls(f).map((e) => decodeURIComponent(e.urls[0])), [
      'https://webdav.yandex.ru/family', 'https://webdav.yandex.ru/family/*',
    ]);
  });
  for (const code of [201, 403]) it(`preserves caller variables, arguments and IFS after MKCOL ${code}`, (t) => {
    const f = fixture(t, { mkcolHttp: code });
    const result = f.helper(`
      IFS='|'; target=callerTarget; current=callerCurrent; part=callerPart
      login=callerLogin; password=callerPassword; code=callerCode
      set -- 'original first' 'original/second'
      if ensure_webdav_path '/family/logs'; then result=0; else result=$?; fi
      printf '%s\\n' "$IFS" "$target" "$current" "$part" "$login" "$password" "$code" "$#" "$1" "$2" "$result"
    `);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trimEnd().split('\n'), [
      '|', 'callerTarget', 'callerCurrent', 'callerPart', 'callerLogin', 'callerPassword', 'callerCode',
      '2', 'original first', 'original/second', code === 201 ? '0' : '1',
    ]);
  });
  it('retains nested component order without splitting spaces or backslashes', (t) => {
    // Здесь проверяется разбиение пути: percent-encoding проверен отдельно в r316.
    const f = fixture(t, { mkcolHttp: 201 });
    const result = f.helper("ensure_webdav_path '/parent//a b\\c/logs/'");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(curls(f).map((e) => decodeURIComponent(e.urls[0])), [
      'https://webdav.yandex.ru/parent', 'https://webdav.yandex.ru/parent/a b\\c',
      'https://webdav.yandex.ru/parent/a b\\c/logs',
    ]);
  });
  it('requires a nonempty target before network work', (t) => {
    const f = fixture(t, { mkcolHttp: 201 }); const result = f.helper("ensure_webdav_path ''");
    assert.notEqual(result.status, 0); assert.equal(curls(f).length, 0);
  });
  it('does not issue MKCOL for the root slash itself', (t) => {
    const f = fixture(t, { mkcolHttp: 201 }); const result = f.helper("ensure_webdav_path '/'");
    assert.equal(result.status, 0, result.stderr); assert.equal(curls(f).length, 0);
  });
});

describe('Yandex MKCOL outcome and request boundaries', () => {
  for (const code of [200, 204, 301, 302, 307, 401, 403, 409, 423, 500, 507, '000', '201201', 'bad']) {
    it(`stops at the first unconfirmed parent with MKCOL ${code}`, (t) => {
      const f = fixture(t, { mkcolHttp: code }); const result = f.helper("ensure_webdav_path '/family/logs'");
      assert.notEqual(result.status, 0, result.stdout); assert.equal(result.stdout, '');
      assert.equal(curls(f).length, 1); assert.equal(curls(f)[0].http, String(code));
    });
  }
  it('accepts Created and retains the existing-resource 405 compatibility path', (t) => {
    const f = fixture(t, { mkcolCodes: [201, 405] }); const result = f.helper("ensure_webdav_path '/family/logs'");
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, '');
    assert.deepEqual(curls(f).map((e) => e.http), ['201', '405']);
  });
  it('discards a Created code from a failed curl and does not process a child', (t) => {
    const f = fixture(t, { mkcolHttp: 201, mkcolExit: 28 }); const result = f.helper("ensure_webdav_path '/family/logs'");
    assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
    assert.equal(curls(f).length, 1); assert.equal(curls(f)[0].exit, 28);
  });
  it('stops after a child fails without attempting deeper descendants or rollback', (t) => {
    const f = fixture(t, { mkcolCodes: [201, 423, 201] });
    const result = f.helper("ensure_webdav_path '/family/logs/sub'");
    assert.notEqual(result.status, 0);
    assert.deepEqual(curls(f).map((e) => [e.method, e.http]), [['MKCOL', '201'], ['MKCOL', '423']]);
  });
  it('disables curlrc and curl URL globbing and supplies exactly one HTTPS URL', (t) => {
    const f = fixture(t, { mkcolHttp: 201 }); f.helper("ensure_webdav_path '/family/logs'");
    assert.equal(curls(f).length, 2);
    for (const e of curls(f)) {
      assert.equal(e.args[0], '-q'); assert.ok(e.args.includes('-g')); assert.ok(e.args.includes('--url'));
      assert.equal(e.args[e.args.indexOf('--proto') + 1], '=https');
      assert.equal(e.urls.length, 1); assert.ok(!e.args.includes('-L')); assert.ok(!e.args.includes('-k'));
    }
  });
  for (const key of ['login', 'password']) it(`does not create a folder with partial ${key}`, (t) => {
    const f = fixture(t, { mkcolHttp: 201, failGet: `sheepfold.cloud.${key}`, partialGet: 'not-valid' });
    const result = f.helper("ensure_webdav_path '/family'");
    assert.notEqual(result.status, 0); assert.equal(curls(f).length, 0);
    assert.ok(f.events().some((e) => e.kind === 'uci' && e.args[1] === `sheepfold.cloud.${key}`));
  });
  for (const command of ['archive-push', 'push-events']) it(`returns a structured ${command} preflight failure without altering local data`, (t) => {
    const f = fixture(t, { mkcolHttp: 423, events: 'live journal\n' }); const before = f.readState();
    const result = f.run([command]);
    assert.notEqual(result.status, 0); assert.equal(parse(result).error, 'remote_prepare_failed');
    assert.deepEqual(f.readState(), before);
    assert.equal(readFileSync(f.archive, 'utf8'), 'synthetic archive to preserve');
    assert.equal(readFileSync(join(f.ram, 'events.log'), 'utf8'), 'live journal\n');
    assert.ok(!existsSync(join(f.ram, '.yandex-backup-staging')));
    assert.deepEqual(curls(f).map((e) => e.method), command === 'archive-push' ? ['PROPFIND', 'MKCOL'] : ['MKCOL']);
  });
});

describe('Yandex root selection is not replaced after failed UCI reads', () => {
  for (const partial of ['', '/partial']) it(`rejects a failed root get with ${partial ? 'partial' : 'empty'} output`, (t) => {
    const f = fixture(t, { failGet: 'sheepfold.cloud.root_folder', partialGet: partial, saved: { 'sheepfold.cloud.root_folder': '/chosen-root' } });
    const result = f.helper('normalize_root_folder');
    assert.notEqual(result.status, 0); assert.equal(result.stdout, ''); assert.equal(curls(f).length, 0);
    assert.ok(f.events().some((e) => e.kind === 'uci' && e.args[1] === 'sheepfold.cloud.root_folder'));
  });
  for (const at of [1, 2]) it(`rejects failed section snapshot ${at} even with plausible output`, (t) => {
    const f = fixture(t, { showFailAt: at, partialShow: 'sheepfold.cloud=yandex_disk\n' });
    const result = f.helper('normalize_root_folder');
    assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
    assert.ok(f.events().some((e) => e.kind === 'showFault' && e.call === at));
  });
  it('defaults only after a successful section read confirms an absent option', (t) => {
    const f = fixture(t, { removeSaved: ['sheepfold.cloud.root_folder'] });
    const result = f.helper('normalize_root_folder');
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, '/sheepfold');
  });
  for (const [value, expected] of [['', '/sheepfold'], ['/', '/sheepfold'], ['family/sub/', '/family/sub'], ['/family/sub', '/family/sub']]) {
    it(`retains normalization of ${JSON.stringify(value)}`, (t) => {
      const f = fixture(t, { saved: { 'sheepfold.cloud.root_folder': value } });
      const result = f.helper('normalize_root_folder');
      assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, expected);
    });
  }
  it('rejects a noticed root change between section snapshots', (t) => {
    const f = fixture(t, { rootChangesOnGet: '/new-destination' });
    const result = f.helper('normalize_root_folder');
    assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
    assert.ok(f.events().some((e) => e.kind === 'rootChanged'));
    assert.equal(f.readState().saved['sheepfold.cloud.root_folder'], '/new-destination');
  });
  for (const command of ['archive-push', 'push-events']) it(`stops ${command} before MKCOL when configured root is unreadable`, (t) => {
    const f = fixture(t, { failGet: 'sheepfold.cloud.root_folder', events: 'live\n', saved: { 'sheepfold.cloud.root_folder': '/chosen-root' } }); const before = f.readState();
    const result = f.run([command]);
    assert.notEqual(result.status, 0); assert.equal(parse(result).error, 'root_unavailable');
    assert.deepEqual(f.readState(), before);
    assert.equal(readFileSync(f.archive, 'utf8'), 'synthetic archive to preserve');
    assert.equal(readFileSync(join(f.ram, 'events.log'), 'utf8'), 'live\n');
    assert.ok(curls(f).every((e) => e.probe));
  });
  it('reports unknown storage rather than reading a different root on status', (t) => {
    const f = fixture(t, { failGet: 'sheepfold.cloud.root_folder', saved: { 'sheepfold.cloud.root_folder': '/chosen-root' } });
    const before = f.readState(); const result = f.run(['status']);
    assert.equal(result.status, 0, result.stderr); assert.equal(parse(result).state, 'error');
    assert.equal(parse(result).free_pct, 0); assert.deepEqual(f.readState(), before);
    assert.equal(curls(f).length, 1); assert.equal(curls(f)[0].probe, true);
  });
  it('propagates root failure through the path resolver called under a conditional', (t) => {
    const f = fixture(t, { failGet: 'sheepfold.cloud.root_folder', saved: { 'sheepfold.cloud.root_folder': '/chosen-root' } });
    const result = f.helper("if output=$(resolve_remote_path 'backups/test.tar'); then printf 'unexpected:%s' \"$output\"; exit 2; fi");
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, ''); assert.equal(curls(f).length, 0);
  });
});


// r316: logical path -> URI, до любого запроса. Облачные ответы остаются моделью.
const uriPath = (value) => value.split('/').map((part) => encodeURIComponent(part)
  .replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
const yandexBase = 'https://webdav.yandex.ru';

describe('Yandex logical paths are encoded once as URI paths', () => {
  for (const logical of [
    '/family#2026/logs', '/family?view=1/logs', '/a b/logs', '/Семья/журнал 🧡.log',
    '/literal%2F/literal%20.txt', '/100%/file.tar', '/[ab]/{one,two}/*',
    "/quotes'\"/plus+amp&eq=;@colon:.txt", '/back\\slash/logs', '/a~b/name-1_2.3.tar',
  ]) it(`encodes the exact bytes of ${JSON.stringify(logical)} without adding query or fragment`, (t) => {
    const f = fixture(t); const result = f.helper(`webdav_url ${quote(logical)}`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, yandexBase + uriPath(logical));
    const parsed = new URL(result.stdout);
    assert.equal(parsed.origin, yandexBase); assert.equal(parsed.search, ''); assert.equal(parsed.hash, '');
    assert.equal(decodeURIComponent(parsed.pathname), logical);
    assert.equal(curls(f).length, 0);
  });
  it('keeps the caller IFS variables and positional arguments intact', (t) => {
    const f = fixture(t); const result = f.helper(`
      path=callerPath; encoded=callerEncoded; IFS='|'; set -- first second
      webdav_url '/space #?%/logs'; printf '\n'; printf '%s\n' "$path" "$encoded" "$IFS" "$#" "$1" "$2"
    `);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trimEnd().split('\n'), [
      yandexBase + '/space%20%23%3F%25/logs', 'callerPath', 'callerEncoded', '|', '2', 'first', 'second',
    ]);
  });
  for (const root of ['/family#2026', '/a b', '/Семья', '/literal%2F', '/question?x=y']) {
    it(`sends successive MKCOLs for literal components of ${JSON.stringify(root)}`, (t) => {
      const f = fixture(t, { mkcolHttp: 201 }); const result = f.helper(`ensure_webdav_path ${quote(root + '/logs')}`);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(curls(f).map((e) => e.urls), [[yandexBase + uriPath(root)], [yandexBase + uriPath(root + '/logs')]]);
      assert.ok(curls(f).every((e) => e.method === 'MKCOL'));
    });
  }
  for (const [name, command] of [
    ['folder usage', "folder_used_bytes '/family#2026/logs'"],
    ['file metadata', "remote_file_bytes '/family#2026/logs/file%20.txt'"],
    ['list reader', "propfind_folder_json_array '/family#2026/logs'"],
  ]) it(`uses the same URI boundary in ${name} without claiming XML correctness`, (t) => {
    const f = fixture(t); const result = f.helper(command);
    assert.equal(result.status, 0, result.stderr); assert.equal(curls(f).length, 1);
    const url = curls(f)[0].urls[0];
    assert.equal(new URL(url).hash, ''); assert.ok(url.includes('family%232026'));
    if (name === 'file metadata') assert.ok(url.endsWith('file%2520.txt'));
  });
  it('retains the configured root in UCI while sending its encoded path during status', (t) => {
    const f = fixture(t, { saved: { 'sheepfold.cloud.root_folder': '/Family #2026' } });
    const before = f.readState(); const result = f.run(['status']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.readState(), before);
    assert.deepEqual(curls(f).map((e) => e.urls[0]), [yandexBase + '/', yandexBase + '/Family%20%232026']);
  });
  it('does not decode a literal percent path into traversal in root normalization', (t) => {
    const root = '/family/%2e%2e/literal%2Fname';
    const f = fixture(t, { saved: { 'sheepfold.cloud.root_folder': root } });
    const result = f.helper('normalize_root_folder');
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, root);
    const url = f.helper(`webdav_url ${quote(root)}`);
    assert.equal(url.status, 0, url.stderr); assert.equal(url.stdout, yandexBase + uriPath(root));
  });
});

describe('Yandex invalid destinations stop before changing cloud folders', () => {
  for (const path of ['/family/../outside', '/family/./logs', '../outside', '/family/..', '/family/.',
    '/family//../logs', '/family\nother/logs', '/family\rother/logs', '/family\tother/logs', '/family\x7f/logs']) {
    it(`rejects ${JSON.stringify(path)} before the first MKCOL`, (t) => {
      const f = fixture(t, { mkcolHttp: 201 }); const result = f.helper(`ensure_webdav_path ${quote(path)}`);
      assert.notEqual(result.status, 0); assert.equal(result.stdout, ''); assert.equal(curls(f).length, 0);
    });
  }
  for (const helper of ['folder_used_bytes', 'remote_file_bytes', 'propfind_folder_json_array']) {
    it(`does not pass an invalid path as an empty URL to ${helper}`, (t) => {
      const f = fixture(t); const result = f.helper(`${helper} '/family/../outside'`);
      assert.notEqual(result.status, 0); assert.equal(result.stdout, ''); assert.equal(curls(f).length, 0);
    });
  }
  it('stops archive preflight for a dotted root and preserves local archives and UCI', (t) => {
    const f = fixture(t, { saved: { 'sheepfold.cloud.root_folder': '/family/../outside' }, mkcolHttp: 423, events: 'keep\n' });
    const before = f.readState(); const result = f.run(['archive-push']);
    assert.notEqual(result.status, 0); assert.equal(parse(result).error, 'root_unavailable');
    assert.deepEqual(curls(f).map((e) => e.method), ['PROPFIND']);
    assert.deepEqual(f.readState(), before);
    assert.equal(readFileSync(f.archive, 'utf8'), 'synthetic archive to preserve');
    assert.equal(readFileSync(join(f.ram, 'events.log'), 'utf8'), 'keep\n');
    assert.ok(!existsSync(join(f.ram, '.yandex-backup-staging')));
  });
  it('does not query the substituted destination during status for a dotted root', (t) => {
    const f = fixture(t, { saved: { 'sheepfold.cloud.root_folder': '/family/../outside' } });
    const result = f.run(['status']); assert.equal(result.status, 0, result.stderr);
    assert.equal(parse(result).state, 'error'); assert.equal(parse(result).free_pct, 0);
    assert.deepEqual(curls(f).map((e) => e.urls[0]), [yandexBase + '/']);
  });
  it('rejects a dot component accepted by the legacy file-prefix gate', (t) => {
    const f = fixture(t); const result = f.helper("remote_path_allowed '/sheepfold/logs/./file.tar'");
    assert.notEqual(result.status, 0); assert.equal(result.stdout, ''); assert.equal(curls(f).length, 0);
  });
  for (const helper of ['ensure_webdav_path', 'folder_used_bytes', 'remote_file_bytes', 'propfind_folder_json_array']) {
    it(`discards partial encoder output before ${helper}`, (t) => {
      const f = fixture(t, { failUrlEncoder: true, mkcolHttp: 201 });
      const result = f.helper(`${helper} '/family/logs'`);
      assert.ok(f.events().some((e) => e.kind === 'encoderFault'), 'the injected encoder failure was reached');
      assert.notEqual(result.status, 0); assert.equal(result.stdout, ''); assert.equal(curls(f).length, 0);
    });
  }
  it('does not reject ordinary dot-prefixed names or doubled dots inside a name', (t) => {
    const f = fixture(t, { mkcolHttp: 201 }); const result = f.helper("ensure_webdav_path '/.family/v1..2/logs'");
    assert.equal(result.status, 0, result.stderr); assert.equal(curls(f).length, 3);
    assert.equal(curls(f)[2].urls[0], yandexBase + '/.family/v1..2/logs');
  });
});

describe('Yandex URI failure propagation in file consumers', () => {
  it('encodes a local archive basename without treating it as a URI fragment', (t) => {
    const f = fixture(t);
    const local = shellTestPath(f.archive, { cwd: repo, allowedRoot: f.ram });
    const result = f.helper(`upload_file ${quote(local)} '/sheepfold/logs/log#1%20.tar'`);
    assert.equal(result.status, 0, result.stderr); assert.equal(curls(f).length, 1);
    assert.equal(curls(f)[0].method, 'PUT');
    assert.deepEqual(curls(f)[0].urls, [yandexBase + '/sheepfold/logs/log%231%2520.tar']);
    assert.equal(curls(f)[0].uploadHex, Buffer.from('synthetic archive to preserve').toString('hex'));
    // Вызван только низкоуровневый PUT helper: verify/полный upload не подтверждены.
  });
  it('does not send PUT after rejecting a dotted path', (t) => {
    const f = fixture(t);
    const local = shellTestPath(f.archive, { cwd: repo, allowedRoot: f.ram });
    const result = f.helper(`upload_file ${quote(local)} '/sheepfold/logs/../file.tar'`);
    assert.notEqual(result.status, 0); assert.equal(result.stdout, ''); assert.equal(curls(f).length, 0);
    assert.equal(readFileSync(f.archive, 'utf8'), 'synthetic archive to preserve');
  });
  it('does not issue DELETE by interpreting an encoded href as a literal percent filename', (t) => {
    const f = fixture(t, { body: '<legacy href="/sheepfold/logs/log%20copy.tar" />\n' });
    const result = f.helper(`folder_used_bytes() { printf '2'; }; prune_remote_logs '/sheepfold' 1`);
    assert.notEqual(result.status, 0);
    assert.deepEqual(curls(f).map((e) => e.method), ['PROPFIND']);
    // Только защита границы старого reader: подставленный usage и форма href не
    // доказывают корректный WebDAV XML, общий prune либо правильность квоты.
  });
  for (const value of ['', '/family/logs\n']) it(`does not publish partial URL for ${JSON.stringify(value)}`, (t) => {
    const f = fixture(t); const result = f.helper(`webdav_url ${quote(value)}`);
    assert.notEqual(result.status, 0); assert.equal(result.stdout, ''); assert.equal(curls(f).length, 0);
  });
});
