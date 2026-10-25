/*
 * Выполняет транзакцию настоящего shell-установщика в удаляемом .build-fixture
 * Пакетный менеджер, UCI-подготовка и AGH моделируются: проверяются отказы, откат,
 * защита чужих изменений и bootstrap-профиль, но не procd/DNS на живом OpenWrt
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { shellTestPath } from '../tools/quality/testEnvironment.mjs';
import { completedProcess, runtimeTimeout } from './helpers/runtimeProcess.mjs';

const repo = resolve(import.meta.dirname, '..');
const packageRoot = join(repo, 'package/luci-app-sheepfold-family-internet-control');
const helper = readFileSync(join(packageRoot, 'root/usr/libexec/sheepfold/sheepfold-adguard-install'), 'utf8');
const declarations = helper.slice(0, helper.lastIndexOf('\ncase "${1:-status}"'));

function fixture(t, options = {}) {
  mkdirSync(join(repo, '.build'), { recursive: true });
  const root = mkdtempSync(join(repo, '.build/agh-install-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const local = (path) => shellTestPath(path, { cwd: repo });
  for (const directory of ['etc/config', 'etc/sheepfold', 'tmp', 'var/lock', 'bin', 'proc/sys/kernel/random', 'proc/sys/net/ipv6/conf/all'])
    mkdirSync(join(root, directory), { recursive: true });
  for (const config of ['dhcp', 'sheepfold', 'network']) writeFileSync(join(root, 'etc/config', config), `${config}-original\n`);
  writeFileSync(join(root, 'proc/sys/kernel/random/boot_id'), 'fixture-boot\n');
  writeFileSync(join(root, 'proc/sys/net/ipv6/conf/all/disable_ipv6'), '1\n');
  writeFileSync(join(root, 'proc/mounts'), 'tmpfs /tmp tmpfs rw 0 0\n');
  writeFileSync(join(root, 'proc/meminfo'), 'MemAvailable: 262144 kB\n');
  writeFileSync(join(root, 'etc/shadow'), 'root:$6$synthetic:1:0:99999:7:::\n');
  writeFileSync(join(root, 'trace'), '');
  const put = (name, body) => {
    const path = join(root, 'bin', name);
    writeFileSync(path, body);
    chmodSync(path, 0o755);
  };
  put('sheepfold-lock-common', 'sheepfold_lock_acquire() { return 0; }\nsheepfold_lock_release() { :; }\n');
  put('sheepfold-package-manager', `#!/bin/sh
echo "package:$1" >> "$FIXTURE/trace"
[ "$1" != installed ] || exit 1
[ "$1" != install ] || {
  [ "$FAIL_PACKAGE" != 1 ] || exit 1
  echo adguard-default > "$FIXTURE/etc/config/adguardhome"
}
`);
  put('timeout', '#!/bin/sh\nshift 3\nexec "$@"\n');
  put('chown', '#!/bin/sh\nexit 0\n');
  put('aghBinary', '#!/bin/sh\n[ "$1" != --version ] || echo "AdGuard Home, version v0.107.79"\nexit 0\n');
  if (!options.realPreflight)
    put('adguardhome', `#!/bin/sh\n# config_file:string:${local(join(root, 'etc/adguardhome/adguardhome.yaml'))}\n# procd_set_param user\necho "adguard:$1" >> "$FIXTURE/trace"\nexit 0\n`);
  put('pidof', '#!/bin/sh\nexit 1\n');
  put('id', '#!/bin/sh\nexit 0\n');
  put('dnsmasq', '#!/bin/sh\necho "dnsmasq:$1" >> "$FIXTURE/trace"\nexit 0\n');
  put('sheepfold-log', '#!/bin/sh\necho journal >> "$FIXTURE/trace"\n');
  put('uci', `#!/bin/sh
case "$*" in
 changes*) exit 0 ;; *network.lan.proto) echo static ;; *network.lan.ipaddr) echo 192.168.7.1 ;;
 'show dhcp') echo 'dhcp.main=dnsmasq' ;; *'].port') echo 53 ;; *dhcp.lan.interface) echo lan ;;
 *dhcp.lan.ignore) echo 0 ;; *'].server') echo 127.0.0.42 ;; *'].noresolv') echo 1 ;; *) exit 1 ;;
esac
`);
  put('readlink', '#!/bin/sh\necho /tmp\n');
  put('df', '#!/bin/sh\necho "overlay 100000 10000 90000 10% /etc"\n');
  put('netstat', '#!/bin/sh\nexit 0\n');
  put('ubus', '#!/bin/sh\nexit 0\n');
  put('ip', '#!/bin/sh\n[ "$LOCAL_ROUTE" != 1 ] || echo "local 192.168.7.1 dev lo src 192.168.7.1"\n');
  put('podkop', '#!/bin/sh\nexit 0\n');
  put('jshn', '');
  put('jsonfilter', '#!/bin/sh\ncase "$*" in *ipv4-address*) [ "$EMPTY_LAN" = 1 ] || echo 192.168.7.1 ;; *dns_port*) echo 53 ;; *rules_count*) printf "10\\n20\\n" ;; *) echo true ;; esac\n');
  put('curl', `#!/bin/sh
if [ "$CONCURRENT_CHANGE" = 1 ]; then echo user-change > "$FIXTURE/etc/config/dhcp"; fi
if [ "$LATE_SHEEPFOLD" = 1 ]; then echo user-change > "$FIXTURE/etc/config/sheepfold"; fi
printf '{}'
`);
  put('nslookup', `#!/bin/sh
if [ "$FAIL_DNS" = once ] && grep -q "dnsmasq:restart" "$FIXTURE/trace" && [ ! -f "$FIXTURE/failed-dns" ]; then
 touch "$FIXTURE/failed-dns"
 exit 1
fi
[ "$FAIL_DNS" != 1 ] || ! grep -q "dnsmasq:restart" "$FIXTURE/trace"
`);
  let source = declarations
    .replaceAll('/usr/libexec/sheepfold', local(join(root, 'bin')))
    .replaceAll('/usr/bin/AdGuardHome', local(join(root, options.realPreflight ? 'not-installed' : 'bin/aghBinary')))
    .replaceAll('/usr/share/libubox/jshn.sh', local(join(root, 'bin/jshn')))
    .replaceAll('/etc/init.d/', `${local(join(root, 'bin'))}/`)
    .replaceAll('/etc/', `${local(join(root, 'etc'))}/`)
    .replaceAll('/tmp/', `${local(join(root, 'tmp'))}/`)
    .replaceAll('/var/lock/', `${local(join(root, 'var/lock'))}/`)
    .replaceAll('/proc/', `${local(join(root, 'proc'))}/`);
  const overrides = `
preflight() { LAN_IP=192.168.7.1; PODKOP=1; }
make_profile() { printf '{"testProfile":true}'; }
prepare_uci() {
 mkdir "$WORK/config"
 for cfg in dhcp sheepfold adguardhome; do printf '%s-new\\n' "$cfg" > "$WORK/config/$cfg"; done
}
`;
  source += options.script || (options.realPreflight ? '\npreflight\n' : `${overrides}\nworker\n`);
  put('installer', source);
  return {
    root,
    read: (path) => readFileSync(join(root, path), 'utf8').trim(),
    run(extra = {}) {
      return completedProcess(spawnSync('bash', ['-c', 'export PATH="$FIXTURE/bin:$PATH"; exec sh "$FIXTURE/bin/installer"'], {
        cwd: repo, encoding: 'utf8', timeout: runtimeTimeout(20000),
        env: { ...process.env, FIXTURE: local(root), FAIL_PACKAGE: '0', FAIL_DNS: '0', CONCURRENT_CHANGE: '0', LATE_SHEEPFOLD: '0', LOCAL_ROUTE: '0', EMPTY_LAN: '0', ...extra },
      }), 'AdGuard installer fixture');
    },
  };
}

describe('AdGuard explicit installation', () => {
  it('keeps the unconfigured bootstrap private and cache-free', () => {
    const profile = JSON.parse(readFileSync(join(packageRoot, 'root/usr/share/sheepfold/adguard-install-profile.json'), 'utf8'));
    assert.equal(profile.http.address, '127.0.0.1:3000');
    assert.deepEqual(profile.users, [{ name: 'admin', password: '!' }]);
    assert.deepEqual(profile.dns.bind_hosts, ['127.0.0.1']);
    assert.equal(profile.dns.port, 5355);
    assert.deepEqual(profile.dns.upstream_dns, ['127.0.0.1:5354']);
    assert.deepEqual(profile.dns.fallback_dns, []);
    assert.equal(profile.dns.cache_enabled, false);
    assert.equal(profile.dns.cache_optimistic, false);
    assert.equal(profile.querylog.file_enabled, false);
    assert.equal(profile.querylog.size_memory, 1000);
    assert.equal(profile.filters.length, 2);
    assert.ok(profile.filters.every((filter) => filter.enabled && filter.url.startsWith('https://raw.githubusercontent.com/hagezi/')));
    assert.equal(profile.dhcp.enabled, false);
  });

  it('rejects an empty router password before package operations', (t) => {
    const f = fixture(t, { realPreflight: true });
    writeFileSync(join(f.root, 'etc/shadow'), 'root::1:0:99999:7:::\n');
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /reason=root_password/);
    assert.equal(f.read('trace'), '');
  });

  it('does not switch DNS after a package installation failure', (t) => {
    const f = fixture(t);
    const result = f.run({ FAIL_PACKAGE: '1' });
    assert.notEqual(result.status, 0, result.stderr);
    assert.equal(f.read('etc/config/dhcp'), 'dhcp-original');
    assert.equal(f.read('etc/config/sheepfold'), 'sheepfold-original');
    assert.equal(f.read('etc/sheepfold/adguard-install/status'), 'failed');
    assert.doesNotMatch(f.read('trace'), /dnsmasq:restart/);
    assert.equal(existsSync(join(f.root, 'etc/adguardhome.yaml')), false);
  });

  it('rejects existing configuration and a previous installation before any package change', (t) => {
    for (const name of ['etc/adguardhome', 'etc/sheepfold/adguard-install']) {
      const f = fixture(t, { realPreflight: true });
      mkdirSync(join(f.root, name));
      const result = f.run();
      assert.notEqual(result.status, 0);
      assert.match(result.stdout, /reason=(already_installed|previous_install)/);
      assert.doesNotMatch(f.read('trace'), /package:(update|install)\n/);
    }
  });

  it('rejects insufficient available RAM without starting installation', (t) => {
    const f = fixture(t, { realPreflight: true });
    writeFileSync(join(f.root, 'proc/meminfo'), 'MemAvailable: 32000 kB\n');
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /reason=low_memory/);
    assert.doesNotMatch(f.read('trace'), /package:(update|install)\n/);
  });

  it('rejects an empty LAN address instead of binding a wildcard listener', (t) => {
    const f = fixture(t, { realPreflight: true });
    const result = f.run({ EMPTY_LAN: '1' });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /reason=unsupported_lan/);
    assert.doesNotMatch(f.read('trace'), /package:(update|install)\n/);
  });

  it('publishes the integration only after DNS verification', (t) => {
    const f = fixture(t);
    const result = f.run();
    assert.equal(result.status, 0, result.stderr + result.stdout + (result.status ? f.read('etc/sheepfold/adguard-install/reason') : '') + f.read('trace'));
    assert.equal(f.read('etc/config/dhcp'), 'dhcp-new');
    assert.equal(f.read('etc/config/sheepfold'), 'sheepfold-new');
    assert.equal(f.read('etc/sheepfold/adguard-install/status'), 'installed');
    assert.equal(f.read('etc/sheepfold/adguard-install/dhcp.before'), 'dhcp-original');
    assert.match(f.read('trace'), /dnsmasq:restart\nadguard:enable\nadguard:start/);
    assert.ok(!existsSync(join(f.root, 'tmp', 'request')));
  });

  it('restores the exact original configs after an unsuccessful DNS check', (t) => {
    const f = fixture(t);
    const result = f.run({ FAIL_DNS: '1' });
    assert.notEqual(result.status, 0);
    assert.equal(f.read('etc/config/dhcp'), 'dhcp-original');
    assert.equal(f.read('etc/config/sheepfold'), 'sheepfold-original');
    // DNS остаётся недоступен и после возврата: нельзя сообщать об успешном восстановлении
    assert.equal(f.read('etc/sheepfold/adguard-install/status'), 'recovery_required');
    assert.match(f.read('trace'), /adguard:stop\nadguard:disable\ndnsmasq:restart/);
  });

  it('reports recovery only after the previous DNS path works again', (t) => {
    const f = fixture(t);
    const result = f.run({ FAIL_DNS: 'once' });
    assert.notEqual(result.status, 0);
    assert.equal(f.read('etc/config/dhcp'), 'dhcp-original');
    assert.equal(f.read('etc/config/sheepfold'), 'sheepfold-original');
    assert.equal(f.read('etc/sheepfold/adguard-install/status'), 'failed_restored');
  });

  it('preserves later user edits instead of overwriting them during rollback', (t) => {
    const f = fixture(t);
    const result = f.run({ FAIL_DNS: '1', CONCURRENT_CHANGE: '1' });
    assert.notEqual(result.status, 0);
    assert.equal(f.read('etc/config/dhcp'), 'user-change');
    assert.equal(f.read('etc/sheepfold/adguard-install/status'), 'recovery_required');
    assert.equal(f.read('etc/sheepfold/adguard-install/dhcp.before'), 'dhcp-original');
  });

  it('does not commit integration settings over a late Sheepfold edit', (t) => {
    const f = fixture(t);
    const result = f.run({ LATE_SHEEPFOLD: '1' });
    assert.notEqual(result.status, 0);
    assert.equal(f.read('etc/config/sheepfold'), 'user-change');
    assert.equal(f.read('etc/config/dhcp'), 'dhcp-original');
    assert.equal(f.read('etc/sheepfold/adguard-install/status'), 'recovery_required');
  });

  it('requires explicit consent and leaves the running-filter adapter narrow', () => {
    assert.match(helper, /\[ "\$\{2:-\}" = confirmed \] \|\| fail confirmation_required/);
    assert.doesNotMatch(helper, /(?:uci set|set) podkop\.|sysctl -w|apk add|opkg install/);
    const adapter = readFileSync(join(packageRoot, 'root/usr/libexec/sheepfold/sheepfold-adguard'), 'utf8');
    assert.doesNotMatch(adapter, /control\/dns_config|control\/filtering\/set_rules/);
    assert.match(adapter, /ip -4 route get "\$local_ip"/);
  });

  it('allows plain LAN HTTP only with an installation receipt and a current local route', (t) => {
    const adapter = readFileSync(join(packageRoot, 'root/usr/libexec/sheepfold/sheepfold-adguard'), 'utf8');
    const validation = adapter.slice(adapter.indexOf('valid_base_url()'), adapter.indexOf('ensure_feed_token()'))
      .replace('local_receipt=/etc/sheepfold/adguard-install/endpoint', 'local_receipt="$STATE/endpoint"');
    const f = fixture(t, { script: `\n${validation}\nvalid_base_url "$TEST_URL"\n` });
    mkdirSync(join(f.root, 'etc/sheepfold/adguard-install'));
    writeFileSync(join(f.root, 'etc/sheepfold/adguard-install/endpoint'), 'http://192.168.7.1:3000\n');
    assert.equal(f.run({ TEST_URL: 'http://192.168.7.1:3000', LOCAL_ROUTE: '1' }).status, 0);
    assert.notEqual(f.run({ TEST_URL: 'http://192.168.7.1:3000' }).status, 0);
    assert.notEqual(f.run({ TEST_URL: 'http://192.168.7.2:3000', LOCAL_ROUTE: '1' }).status, 0);
    assert.notEqual(f.run({ TEST_URL: 'http://example.org', LOCAL_ROUTE: '1' }).status, 0);
  });
});
