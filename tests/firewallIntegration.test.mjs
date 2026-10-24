/*
 * Проверяет порядок и границы Sheepfold-owned nftables интеграции статически
 * Читает package source без сети, записи конфигов или изменения состояния роутера
 * Тест ловит опасное изменение приоритетов и вмешательство в Podkop, но реальное
 * прохождение пакетов подтверждается только безопасным стендом на OpenWrt.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8');

const firewall = read('package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-firewall');
const tableSnippet = read('package/luci-app-sheepfold-family-internet-control/root/usr/share/nftables.d/table-pre/30-sheepfold.nft');
const earlySnippet = read('package/luci-app-sheepfold-family-internet-control/root/usr/share/nftables.d/table-pre/31-sheepfold-prerouting.nft');
const forwardSnippet = read('package/luci-app-sheepfold-family-internet-control/root/usr/share/nftables.d/chain-pre/forward/30-sheepfold.nft');
const inputSnippet = read('package/luci-app-sheepfold-family-internet-control/root/usr/share/nftables.d/chain-pre/input/30-sheepfold.nft');
const routerControl = read('package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-router-control-legacy');
const service = read('package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-service');
const pairDevice = read('package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-pair-device');
const policy = read('package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-lib-access-policy');
const clientStatus = read('package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-client-status-effective');
const installer = read('install.sh');
const makefile = read('package/luci-app-sheepfold-family-internet-control/Makefile');

describe('fw4 access enforcement and integration profiles', () => {
  it('checks the existing policy before Podkop TPROXY without intercepting local services', () => {
    assert.match(earlySnippet, /type filter hook prerouting priority -160; policy accept;/);
    assert.match(earlySnippet, /fib daddr type \{ local, broadcast, multicast \} return/);
    assert.match(earlySnippet, /jump sheepfold_forward_guard/);
    assert.ok(earlySnippet.indexOf('fib daddr') < earlySnippet.indexOf('jump sheepfold_forward_guard'));
    assert.doesNotMatch(earlySnippet, /\b(?:tproxy|redirect|dnat|snat)\b|meta mark set|PodkopTable|\baccept\s+comment/);
  });

  it('uses package-author fw4 hooks and only Sheepfold-owned sets and chains', () => {
    assert.match(tableSnippet, /set sheepfold_block_macs/);
    assert.match(tableSnippet, /set sheepfold_management_block_macs/);
    assert.match(tableSnippet, /set sheepfold_restricted_macs/);
    assert.match(tableSnippet, /set sheepfold_exempt_macs/);
    assert.match(tableSnippet, /set sheepfold_global_ifaces/);
    assert.match(tableSnippet, /chain sheepfold_forward_guard/);
    assert.match(tableSnippet, /chain sheepfold_input_guard/);
    assert.match(forwardSnippet, /^jump sheepfold_forward_guard\s*$/);
    assert.match(inputSnippet, /^jump sheepfold_input_guard\s*$/);

    const blockRule = tableSnippet.indexOf('ether saddr @sheepfold_block_macs');
    const restrictedRule = tableSnippet.indexOf('ether saddr @sheepfold_restricted_macs');
    const exemptionRule = tableSnippet.indexOf('ether saddr @sheepfold_exempt_macs');
    const globalDrop = tableSnippet.lastIndexOf('iifname @sheepfold_global_ifaces counter drop');
    assert.ok(blockRule >= 0 && blockRule < restrictedRule);
    assert.ok(restrictedRule < exemptionRule && exemptionRule < globalDrop);
    assert.doesNotMatch(inputSnippet, /sheepfold_restricted_macs/);
    assert.match(tableSnippet, /chain sheepfold_input_guard[\s\S]*@sheepfold_management_block_macs/);
  });

  it('does not touch Podkop routing, packet marks, or foreign nftables state', () => {
    const implementation = `${firewall}\n${tableSnippet}\n${forwardSnippet}\n${inputSnippet}`;
    assert.doesNotMatch(implementation, /flush\s+(?:ruleset|table)/i);
    assert.doesNotMatch(implementation, /delete\s+table/i);
    assert.doesNotMatch(implementation, /(?:meta|ct)\s+mark/i);
    assert.doesNotMatch(implementation, /\bip\s+(?:rule|route)\b/i);
    assert.doesNotMatch(implementation, /PodkopTable/);
    assert.match(firewall, /flush set inet fw4 sheepfold_block_macs/);
    assert.match(tableSnippet, /chain sheepfold_sync_marker/);
    assert.match(firewall, /runtime_matches_hash/);
  });

  it('syncs enforcement after UCI changes and restores sets after fw4 reload', () => {
    assert.match(routerControl, /sync_firewall\(\)/);
    assert.match(routerControl, /global_block_on\(\)[\s\S]*sync_firewall/);
    assert.match(routerControl, /global_internet_disable\(\)[\s\S]*sync_firewall/);
    assert.match(routerControl, /device_block\(\)[\s\S]*sync_firewall/);
    assert.match(pairDevice, /sheepfold-firewall sync/);
    assert.match(service, /"\$FIREWALL_HELPER" sync/);
    assert.match(firewall, /ensure_sets\(\)[\s\S]*\/etc\/init\.d\/firewall reload/);
  });

  it('keeps internet-only restrictions separate from the device blocklist', () => {
    assert.match(firewall, /append_unique "\$restricted_file" "\$mac"/);
    assert.match(policy, /new_device_policy/);
    assert.match(policy, /restricted\|scheduled/);
    assert.match(firewall, /policyStatus[\s\S]*restricted_file/);
    assert.doesNotMatch(inputSnippet, /internet restrictions/i);
    assert.match(service, /run_detector scan event "\$mac"/);
    assert.match(service, /run_detection_followups[\s\S]*"\$FIREWALL_HELPER" sync/);
  });

  it('applies identity quarantine before administrator, group, and allowlist exemptions', () => {
    const quarantine = policy.indexOf('case "$quarantine" in');
    const administrator = policy.indexOf('if [ "$policyAdmin" = 1 ]');
    const noRestrictions = policy.indexOf('policyReason=no_restrictions_group');
    const allowlist = policy.indexOf('policyReason=allowlist');
    assert.ok(quarantine >= 0 && quarantine < administrator);
    assert.ok(quarantine < noRestrictions && quarantine < allowlist);
    assert.match(firewall, /sheepfold_policy_evaluate/);
    assert.match(policy, /case "\$quarantine" in[\s\S]*policyManagementBlock=1/);
    assert.match(firewall, /blocklist\|identity_quarantine[\s\S]*restricted_file/);
  });

  it('keeps global block above temporary access but below explicit exemptions', () => {
    const admin = policy.indexOf('policyReason=administrator_device');
    const allowlist = policy.indexOf('policyReason=allowlist');
    const noRestrictions = policy.indexOf('policyReason=no_restrictions_group');
    const blocklist = policy.indexOf('policyReason=blocklist');
    const globalBlock = policy.indexOf('policyReason=global_block');
    const temporary = policy.indexOf('policyReason=temporary_access');
    assert.ok(noRestrictions >= 0 && noRestrictions < blocklist);
    assert.ok(blocklist < admin && admin < allowlist);
    assert.ok(allowlist < globalBlock && globalBlock < temporary);
    assert.match(clientStatus, /sheepfold_policy_evaluate/);
    assert.match(policy, /tempAdded/);
  });

  it('supports exactly four compatibility modes and preserves a manual choice', () => {
    assert.match(installer, /INTEGRATION_MODE="none"/);
    assert.match(installer, /INTEGRATION_MODE="adguard"/);
    assert.match(installer, /INTEGRATION_MODE="podkop"/);
    assert.match(installer, /INTEGRATION_MODE="adguard_podkop"/);
    assert.match(installer, /integration_mode_user_set[\s\S]*!= "1"/);
    assert.match(installer, /Keeping manually selected integration mode/);
    assert.match(firewall, /none\|adguard\|podkop\|adguard_podkop/);
  });

  it('ships migration defaults and a new package release', () => {
    const release = Number(makefile.match(/PKG_RELEASE:=(\d+)/)?.[1] || 0);
    assert.ok(release >= 252);
    assert.match(makefile, /ensure_global_option lan_firewall_zones 'lan'/);
    assert.match(makefile, /ensure_global_option integration_mode 'none'/);
    assert.doesNotMatch(makefile, /mv -f "\$\$tmp" "\$\$cron_file"[^\r\n]*\[ -x \/etc\/init\.d\/cron/);
    assert.match(makefile, /sheepfold-firewall clear/);
  });
});
