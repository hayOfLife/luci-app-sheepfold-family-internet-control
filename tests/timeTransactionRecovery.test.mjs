/* §country1 §persist1
 * Настоящий time-control, файловые снимки/копирование/rename и flock. UCI —
 * узкая модель с отдельными config-файлами и private delta, не native libuci.
 * Инъекции отмечают достигнутый отказ; часы/службы хоста не изменяются.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, chmodSync, rmSync, readdirSync, existsSync, lstatSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { it } from 'node:test';
import vm from 'node:vm';
import { shellTestPath } from '../tools/quality/testEnvironment.mjs';
import { completedProcess, runtimeTimeout, prepareFixtureFlock } from './helpers/runtimeProcess.mjs';

const repo = process.cwd();
const native = process.platform !== 'win32';
const lib = resolve('package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold');
const uiPath = resolve('package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/features/settings/time.js');
const prior = process.env.SHEEPFOLD_TIME_RECOVERY_SOURCE;
const input = ['save', '1', '1', 'Europe/Minsk', '+03-3', 'new.example.test', 'by'];
const systemBefore = 'system.@system[0]=system\nsystem.@system[0].zonename=UTC\nsystem.@system[0].timezone=UTC0\nsystem.ntp=timeserver\nsystem.ntp.server=old.example.test\nsystem.ntp.enabled=1\nsystem.ntp.enable_server=0\n';
const appBefore = 'sheepfold.global=sheepfold\nsheepfold.global.country_profile=ru\nsheepfold.global.note=synthetic-only\n';
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";

const uci = `#!/bin/sh
staged=0; savedir=""
while [ "$#" -gt 0 ]; do
 case "$1" in -q) shift ;; -t) staged=1; savedir="$2"; shift 2 ;; -p) shift 2 ;; *) break ;; esac
done
cmd="$1"; shift
key="\${1:-}"; cfg="\${key%%.*}"
file="$TIME_FILES/$cfg"; delta="$savedir/$cfg"
printf 'uci %s %s\\n' "$cmd" "$*" >> "$TIME_TRACE"
case "$cmd" in
 get)
  if [ "$TIME_VERIFY_FAIL" = 1 ] && [ -f "$TIME_FILES/committed" ] && [ "$staged" = 0 ] && [ "$key" = 'system.@system[0].zonename' ]; then printf 'fault verify\\n' >> "$TIME_TRACE"; exit 1; fi
  { [ ! -f "$file" ] || cat "$file"; [ "$staged" = 0 ] || [ ! -f "$delta" ] || cat "$delta"; } |
   awk -v key="$key" 'index($0,key "=")==1 { value=substr($0,length(key)+2); found=1 } END { if(found) print value; else exit 1 }'
  ;;
 set|add_list|delete)
  if [ "$TIME_STAGE_FAIL" = 1 ] && [ "$key" = 'system.@system[0].zonename=Europe/Minsk' ]; then
   printf 'fault stage\\n' >> "$TIME_TRACE"
   [ "$TIME_FOREIGN_WRITE" != 1 ] || printf 'system.foreign=newer\\n' >> "$TIME_FILES/system"
   exit 1
  fi
  [ -n "$savedir" ] && [ -d "$savedir" ] || exit 2
  name="\${key%%=*}"; value="\${key#*=}"
  [ "$cmd" != delete ] || value=""
  printf '%s=%s\\n' "$name" "$value" >> "$delta"
  ;;
 commit)
  if [ "$TIME_COMMIT_FAIL" = before-system ] && [ "$cfg" = system ]; then
   printf 'fault commit before-system\\n' >> "$TIME_TRACE"
   [ "$TIME_FOREIGN_WRITE" != 1 ] || printf 'sheepfold.global.foreign=newer\\n' >> "$TIME_FILES/sheepfold"
   exit 1
  fi
  { [ ! -f "$file" ] || cat "$file"; [ ! -f "$delta" ] || cat "$delta"; } |
   awk '{ n=index($0,"="); if(n) v[substr($0,1,n-1)]=substr($0,n+1) } END { for(k in v) print k "=" v[k] }' > "$file.tmp" || exit 1
  "$TIME_REAL_MV" "$file.tmp" "$file" || exit 1
  : > "$TIME_FILES/committed"
  if [ "$TIME_COMMIT_FAIL" = signal ] && [ "$cfg" = sheepfold ]; then printf 'fault signal\\n' >> "$TIME_TRACE"; kill -TERM "$PPID"; exit 1; fi
  if [ "$cfg" = sheepfold ] && [ "$TIME_COMMIT_FAIL" = after-sheepfold ]; then printf 'fault commit after-sheepfold\\n' >> "$TIME_TRACE"; exit 1; fi
  [ ! -f "$delta" ] || : > "$delta"
  ;;
 add) printf 'system.@system[0]=system\\n' >> "$savedir/system"; printf '@system[0]\\n' ;;
 *) exit 2 ;;
esac
`;

function fixture(t, options = {}) {
  const build = resolve('.build/time-recovery'); mkdirSync(build, { recursive: true });
  const root = mkdtempSync(join(build, 'case-')); const bin = join(root, 'bin'); const files = join(root, 'files');
  mkdirSync(bin); mkdirSync(files);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = value => shellTestPath(value, { cwd: repo });
  const put = (name, content) => { const file = join(bin, name); writeFileSync(file, content); chmodSync(file, 0o755); return file; };
  const real = Object.fromEntries(['cp', 'mv', 'rm', 'cmp', 'chmod', 'mkdir', 'mktemp', 'cat'].map(name => {
    const p = completedProcess(spawnSync(native ? 'sh' : 'bash', ['-c', `command -v ${name}`], { encoding: 'utf8', timeout: 10000 }), `resolve ${name}`);
    assert.equal(p.status, 0); return [name, p.stdout.trim()];
  }));
  writeFileSync(join(files, 'system'), systemBefore);
  if (!options.appMissing) writeFileSync(join(files, 'sheepfold'), appBefore);
  writeFileSync(join(files, 'foreign'), 'PRECIOUS FOREIGN SNAPSHOT\n');
  if (options.configLink) { rmSync(join(files, 'system')); symlinkSync(join(files, 'foreign'), join(files, 'system')); }
  if (options.configDirectory) { rmSync(join(files, 'system')); mkdirSync(join(files, 'system')); }
  const txRoot = join(root, 'transactions'); mkdirSync(txRoot);
  const foreignDir = join(root, 'foreign-dir'); mkdirSync(foreignDir); writeFileSync(join(foreignDir, 'sentinel'), 'keep me');
  put('uci', uci); prepareFixtureFlock(put);
  put('log', '#!/bin/sh\nprintf "log\\n" >> "$TIME_TRACE"\nexit 0\n');
  put('logger', '#!/bin/sh\nprintf "logger\\n" >> "$TIME_TRACE"\nexit 0\n');
  put('init', '#!/bin/sh\nprintf "init %s\\n" "$*" >> "$TIME_TRACE"\nexit "$TIME_INIT_CODE"\n');
  put('cp', `#!/bin/sh
last=""; src=""
for arg do case "$arg" in -*) ;; *) [ -n "$src" ] || src="$arg"; last="$arg" ;; esac; done
case "$last" in *.before)
 case "$TIME_FAULT" in prepare-cp-error|prepare-cp-corrupt)
  printf 'fault %s\\n' "$TIME_FAULT" >> "$TIME_TRACE"; printf 'BROKEN SNAPSHOT\\n' > "$last"; [ "$TIME_FAULT" = prepare-cp-corrupt ]; exit $? ;;
 esac ;;
esac
case "$src" in */system.before|*/sheepfold.before)
 printf 'restore cp %s -> %s\\n' "$src" "$last" >> "$TIME_TRACE"
 case "$TIME_FAULT:$src" in restore-cp-error:*/system.before|restore-cp-corrupt:*/system.before)
  printf 'fault %s\\n' "$TIME_FAULT" >> "$TIME_TRACE"; printf 'BROKEN RECOVERY\\n' > "$last"; [ "$TIME_FAULT" = restore-cp-corrupt ]; exit $? ;;
 esac ;;
esac
exec ${quote(real.cp)} "$@"
`);
  put('cmp', `#!/bin/sh
case "$*" in *.before*)
 if [ "$TIME_FAULT" = prepare-cmp-error ] && [ ! -f "$TIME_FILES/committed" ]; then printf 'fault prepare-cmp-error\\n' >> "$TIME_TRACE"; exit 2; fi
 if [ "$TIME_FAULT" = restore-cmp-error ] && [ -f "$TIME_FILES/committed" ]; then printf 'fault restore-cmp-error\\n' >> "$TIME_TRACE"; exit 2; fi
 ;;
esac
exec ${quote(real.cmp)} "$@"
`);
  put('chmod', `#!/bin/sh
if [ "$TIME_FAULT" = prepare-chmod-error ] && [ "\${2:-}" = "$TIME_TXROOT" ]; then printf 'fault prepare-chmod-error\\n' >> "$TIME_TRACE"; exit 1; fi
exec ${quote(real.chmod)} "$@"
`);
  put('mktemp', `#!/bin/sh
case "$*" in "$TIME_TXROOT"/*|*"$TIME_TXROOT"/*)
 if [ "$TIME_FAULT" = prepare-mktemp-error ]; then printf 'fault prepare-mktemp-error\\n' >> "$TIME_TRACE"; printf '%s\\n' "$TIME_FOREIGN_DIR"; exit 1; fi ;;
esac
exec ${quote(real.mktemp)} "$@"
`);
  put('mv', `#!/bin/sh
case "$*" in *'.sheepfold-time-restore.'*)
 if [ "$TIME_FAULT" = restore-mv-error ]; then printf 'fault restore-mv-error\\n' >> "$TIME_TRACE"; exit 1; fi
 if [ "$TIME_FAULT" = restore-target-directory ]; then
  last=""; for arg do last="$arg"; done
  ${quote(real.rm)} -f "$last"; ${quote(real.mkdir)} "$last"; printf 'foreign\\n' > "$last/sentinel"
  printf 'fault restore-target-directory\\n' >> "$TIME_TRACE"
 fi
 if [ "$TIME_FAULT" = restore-barrier ] && [ ! -e "$TIME_FILES/barrier" ]; then
  : > "$TIME_FILES/barrier"; n=0
  while [ ! -f "$TIME_FILES/release" ]; do sleep 0.02; n=$((n+1)); [ "$n" -lt 500 ] || exit 1; done
 fi ;;
esac
exec ${quote(real.mv)} "$@"
`);
  put('rm', `#!/bin/sh
if [ "$TIME_FAULT" = cleanup-error ] && [ -f "$TIME_FILES/committed" ]; then
 case "$*" in *"$TIME_TXROOT"/*) printf 'fault cleanup-error\\n' >> "$TIME_TRACE"; exit 1 ;; esac
fi
if [ "$TIME_FAULT" = restore-remove-error ] && [ -f "$TIME_FILES/committed" ] && [ "\${2:-}" = "$TIME_FILES/sheepfold" ]; then printf 'fault restore-remove-error\\n' >> "$TIME_TRACE"; exit 1; fi
exec ${quote(real.rm)} "$@"
`);
  const code = readFileSync(prior ? join(prior, 'sheepfold-time-control') : join(lib, 'sheepfold-time-control'), 'utf8');
  put('entry', code);
  put('control', '#!/bin/sh\n[ "${1:-}" != --luci ] || shift\n[ "$1" = time-save ] || exit 2\nshift\nexec sh "$TIME_ENTRY" save "$@"\n');
  const launch = put('launch', `#!/bin/sh
PATH=${quote(path(bin))}:"$PATH"; export PATH
if [ "$TIME_OLD_DIR" = 1 ]; then
 mkdir -p "$TIME_TXROOT/transaction.$$"
 printf 'precious prior snapshot\\n' > "$TIME_TXROOT/transaction.$$/old.before"
fi
exec sh "$@"
`);
  const env = { ...process.env, TIME_FILES: path(files), TIME_TRACE: path(join(root, 'trace')),
    TIME_TXROOT: path(txRoot), TIME_FOREIGN_DIR: path(foreignDir), TIME_REAL_MV: real.mv,
    TIME_FAULT: options.fault || '', TIME_COMMIT_FAIL: options.commitFail || '', TIME_VERIFY_FAIL: options.verifyFail ? '1' : '0',
    TIME_STAGE_FAIL: options.stageFail ? '1' : '0', TIME_FOREIGN_WRITE: options.foreignWrite ? '1' : '0', TIME_OLD_DIR: options.oldDir ? '1' : '0',
    TIME_INIT_CODE: String(options.initCode || 0), TIME_ENTRY: path(join(bin, 'entry')),
    SHEEPFOLD_ROUTER_CONTROL: path(join(bin, 'control')), SHEEPFOLD_LUCI_ACTION_RUNTIME_DIR: path(join(root, 'luci-actions')),
    SHEEPFOLD_LOCK_COMMON: path(join(lib, 'sheepfold-lock-common')), SHEEPFOLD_TIME_LOCK: path(join(root, 'lock')),
    SHEEPFOLD_TIME_TRANSACTION_ROOT: path(txRoot), SHEEPFOLD_TIME_SYSTEM_CONFIG: path(join(files, 'system')),
    SHEEPFOLD_TIME_APP_CONFIG: path(join(files, 'sheepfold')), SHEEPFOLD_SYSNTPD_INIT: path(join(bin, 'init')), SHEEPFOLD_LOG_HELPER: path(join(bin, 'log')) };
  const command = [path(launch), path(options.throughLuci ? join(lib, 'sheepfold-luci-action') : join(bin, 'entry')), ...(options.throughLuci ? ['time-save', ...input.slice(1)] : input)];
  const snapshots = () => readdirSync(txRoot).filter(name => name.startsWith('transaction.')).map(name => ({ name,
    mode: lstatSync(join(txRoot, name)).mode & 0o777,
    files: Object.fromEntries(readdirSync(join(txRoot, name)).filter(n => lstatSync(join(txRoot, name, n)).isFile()).map(n => [n, readFileSync(join(txRoot, name, n), 'utf8')])) }));
  const state = result => {
    const out = { status: result.status, stdout: result.stdout, stderr: result.stderr, trace: existsSync(join(root, 'trace')) ? readFileSync(join(root, 'trace'), 'utf8') : '', snapshots: snapshots(),
      system: existsSync(join(files, 'system')) && lstatSync(join(files, 'system')).isFile() ? readFileSync(join(files, 'system'), 'utf8') : null,
      app: existsSync(join(files, 'sheepfold')) && lstatSync(join(files, 'sheepfold')).isFile() ? readFileSync(join(files, 'sheepfold'), 'utf8') : null };
    if (process.env.SHEEPFOLD_TIME_RECOVERY_EVIDENCE) {
      mkdirSync(process.env.SHEEPFOLD_TIME_RECOVERY_EVIDENCE, { recursive: true });
      writeFileSync(join(process.env.SHEEPFOLD_TIME_RECOVERY_EVIDENCE, t.name.replace(/[^\w.-]/g, '_') + '.json'), JSON.stringify(out, null, 2) + '\n');
    }
    return out;
  };
  return { root, files, txRoot, foreignDir, state, snapshots, command, env,
    run: () => state(completedProcess(spawnSync(native ? 'sh' : 'bash', command, { cwd: repo, env, encoding: 'utf8', timeout: runtimeTimeout(20000) }), t.name)) };
}

for (const fault of ['prepare-cp-error', 'prepare-cp-corrupt', 'prepare-cmp-error', 'prepare-chmod-error', 'prepare-mktemp-error']) {
  it(`time recovery stops before writes for ${fault}`, t => {
    const f = fixture(t, { fault }); const out = f.run();
    assert.match(out.trace, new RegExp('fault ' + fault), 'injected command reached');
    assert.equal(out.status, 4, out.stderr); assert.match(out.stdout, /error=time_snapshot_failed/);
    assert.doesNotMatch(out.trace, /uci (set|add_list|delete|commit)/); assert.equal(out.system, systemBefore); assert.equal(out.app, appBefore);
    assert.equal(readFileSync(join(f.foreignDir, 'sentinel'), 'utf8'), 'keep me'); assert.equal(out.snapshots.length, 0);
  });
}
it('time recovery never deletes a previous transaction with a reused PID', t => {
  const out = fixture(t, { oldDir: true }).run();
  assert.equal(out.status, 0, out.stderr); assert.equal(out.snapshots.length, 1);
  assert.equal(out.snapshots[0].files['old.before'], 'precious prior snapshot\n');
});
it('time recovery rejects a configuration directory before staging', t => {
  const out = fixture(t, { configDirectory: true }).run();
  assert.notEqual(out.status, 0); assert.match(out.stdout, /time_snapshot_failed/); assert.doesNotMatch(out.trace, /uci (set|commit)/);
});
it('time recovery rejects a configuration symlink without touching its target', { skip: !native }, t => {
  const f = fixture(t, { configLink: true }); const out = f.run();
  assert.match(out.stdout, /time_snapshot_failed/); assert.doesNotMatch(out.trace, /uci (set|commit)/);
  assert.equal(readFileSync(join(f.files, 'foreign'), 'utf8'), 'PRECIOUS FOREIGN SNAPSHOT\n');
});
for (const options of [{ commitFail: 'before-system' }, { commitFail: 'after-sheepfold' }, { verifyFail: true }]) {
  const label = options.commitFail || 'verification';
  it(`time recovery restores both original files after ${label}`, t => {
    const out = fixture(t, options).run(); assert.equal(out.status, 4, out.stderr);
    assert.equal(out.system, systemBefore); assert.equal(out.app, appBefore); assert.equal(out.snapshots.length, 0);
    assert.match(out.stdout, /config_files_restored=1/); assert.doesNotMatch(out.trace, /init restart/);
  });
}
for (const fault of ['restore-cp-error', 'restore-cp-corrupt', 'restore-cmp-error', 'restore-mv-error']) {
  it(`time recovery retains snapshots and reports uncertain state for ${fault}`, t => {
    const out = fixture(t, { fault, commitFail: 'after-sheepfold' }).run();
    assert.match(out.trace, new RegExp('fault ' + fault)); assert.equal(out.status, 6, out.stderr);
    assert.match(out.stdout, /error=time_rollback_failed/); assert.match(out.stdout, /recovery_required=1/);
    assert.doesNotMatch(out.stderr, /previous configuration was restored/);
    assert.doesNotMatch(out.system, /BROKEN/); assert.match(out.system, /zonename=Europe\/Minsk/);
    assert.equal(out.snapshots.length, 1); if (native) assert.equal(out.snapshots[0].mode, 0o700);
    assert.equal(out.snapshots[0].files['system.before'], systemBefore); assert.equal(out.snapshots[0].files['sheepfold.before'], appBefore);
    assert.match(out.trace, /restore cp .*sheepfold.before/, 'second recovery still attempted');
    if (fault.startsWith('restore-cp-')) assert.equal(out.app, appBefore);
    assert.doesNotMatch(out.trace, /init restart/);
  });
}
it('time recovery refuses a destination directory appearing at rename', { skip: !native }, t => {
  const f = fixture(t, { fault: 'restore-target-directory', commitFail: 'after-sheepfold' }); const out = f.run();
  assert.equal(out.status, 6); assert.equal(out.snapshots.length, 1);
  assert.equal(readFileSync(join(f.files, 'system', 'sentinel'), 'utf8'), 'foreign\n');
  assert.equal(existsSync(join(f.files, 'system', 'config')), false);
});
it('time recovery removes a newly created config only when its prior absence was recorded', t => {
  const out = fixture(t, { appMissing: true, commitFail: 'after-sheepfold' }).run();
  assert.equal(out.status, 4); assert.equal(out.system, systemBefore); assert.equal(out.app, null); assert.equal(out.snapshots.length, 0);
});
it('time recovery retains recovery state when removal of a previously absent file fails', t => {
  const out = fixture(t, { appMissing: true, commitFail: 'after-sheepfold', fault: 'restore-remove-error' }).run();
  assert.match(out.trace, /fault restore-remove-error/); assert.equal(out.status, 6);
  assert.equal(out.system, systemBefore); assert.ok(out.app); assert.equal(out.snapshots[0].files['sheepfold.state'], 'absent\n');
});
it('time recovery does not restore unchanged config files after a staging failure', t => {
  const out = fixture(t, { stageFail: true, foreignWrite: true }).run();
  assert.match(out.trace, /fault stage/); assert.notEqual(out.status, 0);
  assert.doesNotMatch(out.trace, /uci commit|restore cp/); assert.equal(out.system, systemBefore + 'system.foreign=newer\n');
  assert.equal(out.snapshots.length, 0);
});
it('time recovery keeps successful save and restart despite cleanup refusal', t => {
  const out = fixture(t, { fault: 'cleanup-error' }).run();
  assert.match(out.trace, /fault cleanup-error/); assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /status=ok/); assert.match(out.trace, /init restart/); assert.equal(out.snapshots.length, 1);
  assert.match(out.stderr, /temporary directory remains/);
});
it('time recovery preserves explicit NTP failure despite cleanup refusal', t => {
  const out = fixture(t, { fault: 'cleanup-error', initCode: 1 }).run();
  assert.equal(out.status, 5, out.stderr); assert.match(out.stdout, /error=ntp_restart_failed/); assert.match(out.stdout, /persisted=1/);
  assert.equal(out.snapshots.length, 1);
});
it('time recovery normal save cleans only its own snapshots and commits both configs', t => {
  const out = fixture(t).run(); assert.equal(out.status, 0, out.stderr);
  assert.match(out.system, /zonename=Europe\/Minsk/); assert.match(out.app, /router_time_configured=1/);
  assert.equal(out.snapshots.length, 0); assert.equal((out.trace.match(/init restart/g) || []).length, 1);
});
it('time recovery publishes each restored file as a complete rename', { skip: !native, timeout: 30000 }, async t => {
  const f = fixture(t, { fault: 'restore-barrier', commitFail: 'after-sheepfold' });
  const child = spawn('sh', f.command, { cwd: repo, env: f.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
  const done = new Promise((yes, no) => { child.on('error', no); child.on('close', (status, signal) => yes({ status, signal, stdout, stderr })); });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const deadline = Date.now() + 10000;
  while (!existsSync(join(f.files, 'barrier')) && child.exitCode === null && Date.now() < deadline) await new Promise(yes => setTimeout(yes, 20));
  try {
    assert.ok(existsSync(join(f.files, 'barrier')), 'rename barrier reached');
    assert.match(readFileSync(join(f.files, 'system'), 'utf8'), /zonename=Europe\/Minsk/);
    assert.equal(f.snapshots()[0].files['system.before'], systemBefore);
  } finally { writeFileSync(join(f.files, 'release'), 'continue'); }
  const out = f.state(completedProcess(await done, 'atomic recovery child'));
  assert.equal(out.status, 4); assert.equal(out.system, systemBefore); assert.equal(out.app, appBefore);
});

function normalize(error) {
  const source = readFileSync(prior ? join(prior, 'time.js') : uiPath, 'utf8');
  const model = vm.runInNewContext(`(function(){${source}})()`, { baseclass: { extend: value => value }, _: value => value });
  return model.normalizeSaveError(error, value => Object.fromEntries(value.trim().split('\n').map(line => { const pos = line.indexOf('='); return [line.slice(0, pos), line.slice(pos + 1)]; })));
}
it('time recovery UI explains incomplete recovery without declaring settings persisted', () => {
  const error = { result: { code: 6, stdout: 'status=error\nerror=time_rollback_failed\nconfig_files_restored=0\nrecovery_required=1\n' }, message: 'generic' };
  const out = normalize(error); assert.equal(out.errorCode, 'time_rollback_failed'); assert.notEqual(out.persisted, true);
  assert.match(out.message, /could not be restored/); assert.match(out.message, /before saving again/);
});
for (const code of [4, 5, 124]) {
  it(`time recovery UI does not accept partial recovery markers with code ${code}`, () => {
    const error = { result: { code, stdout: 'status=error\nerror=time_rollback_failed\nconfig_files_restored=0\nrecovery_required=1\n' }, message: 'generic' };
    const out = normalize(error); assert.equal(out.message, 'generic'); assert.notEqual(out.persisted, true);
  });
}
it('time recovery UI keeps NTP saved-but-not-applied contract', () => {
  const out = normalize({ result: { code: 5, stdout: 'status=error\nerror=ntp_restart_failed\npersisted=1\nruntime_applied=0\n' }, message: 'generic' });
  assert.equal(out.persisted, true); assert.equal(out.runtimeApplied, false);
});

it('time recovery does not overwrite an unattempted second config after first commit fails', t => {
  const out = fixture(t, { commitFail: 'before-system', foreignWrite: true }).run();
  assert.equal(out.status, 4); assert.equal(out.system, systemBefore);
  assert.equal(out.app, appBefore + 'sheepfold.global.foreign=newer\n');
  assert.doesNotMatch(out.trace, /restore cp .*sheepfold.before/);
});
for (const fault of ['', 'restore-cp-error']) {
  it(`time recovery handles TERM with ${fault || 'successful file restoration'}`, { skip: !native }, t => {
    const out = fixture(t, { commitFail: 'signal', fault }).run();
    assert.match(out.trace, /fault signal/); assert.equal(out.status, 143);
    if (fault) {
      assert.match(out.stdout, /time_rollback_failed/); assert.equal(out.snapshots.length, 1);
      assert.equal(out.snapshots[0].files['system.before'], systemBefore);
    } else {
      assert.equal(out.system, systemBefore); assert.equal(out.app, appBefore); assert.equal(out.snapshots.length, 0);
    }
  });
}
it('time recovery actual helper failure survives LuCI shell and action wrappers', async t => {
  const out = fixture(t, { fault: 'restore-cp-error', commitFail: 'after-sheepfold', throughLuci: true }).run();
  assert.equal(out.status, 6); assert.match(out.stderr, /^actionExitCode=6$/m);
  function load(name) {
    const text = readFileSync(resolve('package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/core/backend', name + '.js'), 'utf8');
    return vm.runInNewContext(`(function(){${text}})()`, { baseclass: { extend: value => value }, _: value => value, Promise, Error, fs: {} });
  }
  const router = load('router');
  let calls = 0;
  const actions = load('actions').create({ run: () => { calls++; return Promise.resolve({ code: out.status, stdout: out.stdout, stderr: out.stderr }); }, parseKeyValues: router.parseKeyValues, actionMetadata: router.actionMetadata, errorText: router.errorText });
  const error = await actions.run(['time-save', ...input.slice(1)]).then(() => null, error => normalize(error));
  assert.ok(error); assert.equal(error.errorCode, 'time_rollback_failed'); assert.notEqual(error.persisted, true);
  assert.match(error.message, /before saving again/); assert.equal(calls, 1); assert.equal(out.snapshots.length, 1);
});
it('time recovery warning is translated in the canonical Russian catalogue', () => {
  const catalog = JSON.parse(readFileSync(prior ? join(prior, 'ru.json') : resolve('package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/i18n/ru.json'), 'utf8'));
  assert.equal(catalog['Router time settings could not be restored completely. Check the router configuration and recovery snapshots before saving again.'],
    'Не удалось полностью восстановить настройки времени. Проверьте настройки роутера и сохранённые аварийные копии перед повторным сохранением.');
});
