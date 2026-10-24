# Integrations

## LuCI Setting

Add a LuCI setting:

```text
Use together with
```

Russian label:

```text
Использование совместно с
```

Suggested values:

| Value | UI label | Meaning |
| --- | --- | --- |
| `none` | None | Sheepfold works alone. |
| `adguard` | AdGuard Home | Sheepfold allows/blocks devices first, then DNS filtering goes through AdGuard Home. |
| `podkop` | Podkop | Sheepfold allows/blocks devices first, then compatible traffic routing continues through Podkop. |
| `adguard_podkop` | AdGuard Home + Podkop | Preferred advanced chain: Sheepfold -> AdGuard Home -> Podkop. |

Do not use a simple mutually exclusive `none/adguard/podkop` model only. AdGuard Home and Podkop can be used together, and this is one of the target scenarios.

Since source r325, a Sheepfold-owned `prerouting` guard at priority `-160` evaluates
the existing device/site policy before Podkop TPROXY at `-150`. Checking only fw4
`forward` is insufficient: transparent proxy traffic is delivered to local `input`
instead. Local/broadcast/multicast destinations continue to the normal input path,
where the device-blocklist management guard still applies. Allowed traffic returns
to normal processing; Sheepfold does not set Podkop marks, alter its routes or
edit its nftables table. The forward guard remains for ordinary routed traffic.
The physical-phone regression and limitations are in
[the live test record](live-router-testing.ru.md#проверка-трафика-телефона-24102026).

Experimental Podkop `podkop-exp 0.8.1-r1` was also tested on OpenWrt 25.12.5.
Its `/usr/bin/podkop daemon` embeds the proxy engine: neither a separate `sing-box`
process nor `/etc/init.d/sing-box` is required. In this observed version Podkop
marks packets at `-150` and applies TPROXY at `-100`; Sheepfold's `-160` guard still
runs first. Do not infer future experimental compatibility from version numbering.
Router information now recognizes `podkop-exp` and `luci-app-podkop-exp` as well
as stable package names, preferring backend packages over LuCI-only packages.
The installer already detects the shared `/etc/init.d/podkop` service; it does not
need to install a separate engine or replace the owner's experimental package.
Package freshness means the system package manager's available update state,
not a check of the latest experimental GitHub release. See the
[0.8.1 physical test and limits](live-router-testing.ru.md#проверка-экспериментального-podkop-081-24102026).

The setting should be stored as:

```text
option integration_mode 'none'
```

Allowed values:

```text
none
adguard
podkop
adguard_podkop
```

## Configuration UX

When the user selects an integration mode, LuCI should show integration-specific notes before applying changes.

Saving the integration settings is the explicit confirmation for Sheepfold-owned changes. Routine refreshes may then update the owned filter without another modal. Broad third-party configuration changes still require a separate preview and confirmation.

This setting is needed. It is not a cosmetic label and it must not simply mean "AdGuard/Podkop is installed". It controls the compatibility plan Sheepfold should use when preparing firewall, DNS, domain allowlist, diagnostics, and troubleshooting notes.

Without this setting, Sheepfold cannot safely decide whether to:

- leave DNS/routing alone;
- expect AdGuard Home to be the DNS filtering layer after Sheepfold's device decision;
- avoid Podkop-managed routing/Dnsmasq/nftables/sing-box state;
- show the correct diagnostics when domain allowlisting or emergency-useful access does not work as expected.

Suggested confirmation copy:

```text
Sheepfold can adjust router settings for this integration. Review the planned changes before applying them. A backup/export should be created first.
```

For current Podkop releases, Sheepfold also enables `Disable IPv6 on the router`. The setting is visible in `Settings -> Misc`, is disabled by default without Podkop, and is forced on for `podkop` and `adguard_podkop`. Sheepfold owns only its sysctl file and restores the previous kernel values when automatic Podkop compatibility is no longer required. See [`podkop-ipv6.ru.md`](podkop-ipv6.ru.md) (§ipv6pod).

Russian:

```text
Sheepfold может изменить настройки роутера для этой интеграции. Перед применением проверьте список изменений. Сначала рекомендуется сделать экспорт/резервную копию настроек.
```

## Automatic Setup

Automatic setup should be conservative.

The installer must check the router before applying Sheepfold defaults:

- detect whether AdGuard Home is installed;
- detect whether Podkop is installed;
- set the recommended Sheepfold `integration_mode`;
- set only Sheepfold-owned integration flags automatically;
- show the detected state in the installer output and later in LuCI.

Recommended installation defaults:

| Detected state | Recommended `integration_mode` |
| --- | --- |
| Neither AdGuard Home nor Podkop | `none` |
| AdGuard Home only | `adguard` |
| Podkop only | `podkop` |
| AdGuard Home and Podkop | `adguard_podkop` |

Allowed automatic actions after the user saves the settings:

- check whether AdGuard Home is reachable;
- check whether Podkop is installed/enabled;
- detect Dnsmasq and firewall state;
- create a Sheepfold config export before changes;
- enable integration flags in Sheepfold config;
- add, refresh, enable, or disable the single AdGuard Home URL filter owned by Sheepfold;
- show commands/changes that still require manual action.

Suggested apply-time skeleton:

1. Read selected `integration_mode`.
2. Run detection checks for AdGuard Home, Podkop, Dnsmasq, firewall4/nftables, and Sheepfold-owned chains/sets.
3. Save the selected mode, site-filter backend, endpoint, and credentials only after normal LuCI Save.
4. Apply only Sheepfold-owned UCI options, firewall/nftables state, and the owned AdGuard Home URL filter.
5. Confirm the effective state by reading the API again; otherwise activate the built-in fallback.
6. Mark checks that need manual action instead of silently changing third-party configs.
7. Log the selected mode, checks, result, and warnings without credentials or the private feed token.

Avoid automatic destructive changes:

- do not edit AdGuardHome.yaml or replace custom filtering rules;
- do not remove, disable, rename, or rewrite filters that are not identified by Sheepfold's private feed URL;
- do not overwrite Podkop config blindly;
- do not reset firewall rules outside Sheepfold-owned chains/sets;
- do not restart major services without warning.

## Temporary Remote Support

Settings -> Integrations currently shows only a disabled preview for future temporary help from Sheepfold support. The preview is intentionally inert: it does not store a remote-support mode, install `frpc`, call a backend, contact a server, or change firewall, Podkop, AdGuard Home, DNS, routes, or IPv6. The common Save action therefore cannot activate it accidentally.

The planned function is a narrowly scoped, owner-initiated outgoing support channel, not general remote router management. A production relay needs a stable public IPv4; the home router does not. Enabling remote support must never automatically select `Disable IPv6 on the router`. That existing automatic setting remains exclusively tied to current Podkop compatibility.

The current design is outbound HTTPS with Ed25519-signed typed operations and operator mTLS/TOTP.
ADR-0031 replaces the FRP/SSH part of ADR-0022; port numbers are not secrets or part of the spoken
code. The installable OpenWrt client was deferred by the owner on 2026-10-23. Public schemas and
the Node loopback peer bench are not that client and do not activate the disabled controls.
See [`remote-support-access-plan.ru.md`](remote-support-access-plan.ru.md),
[`remote-support-threat-model.ru.md`](remote-support-threat-model.ru.md) and
[`remote-support-protocol.ru.md`](remote-support-protocol.ru.md) (§rsup001).

## AdGuard Home

Sheepfold should not replace AdGuard Home. The intended chain is:

1. Sheepfold device access decision.
2. AdGuard Home DNS filtering.
3. Podkop routing.

Implemented integration points:

- expose integration status in LuCI;
- read server/protection/version/DNS-port state and non-sensitive DNS configuration counts through the official read-only API;
- verify reserved `.test` control rules through `filtering/check_host`, matching both exact rule text and the Sheepfold-owned filter ID;
- fetch the private loopback feed through `uhttpd` and compare it byte-for-byte before asking AdGuard Home to refresh;
- publish one token-protected loopback feed;
- add, refresh, enable, and disable only the filter named `Sheepfold family site policy` through the official API;
- scope per-device rules to current IPv4 addresses observed by the OpenWrt router;
- fall back to built-in Sheepfold filtering when the API or managed filter cannot be confirmed.
- retry the active policy periodically, notify once after three consecutive failures, and notify once after recovery.

The private feed URL is ownership evidence. It is kept in a mode-`0600` file so a token rotation can disable the previous URL before enabling the new one. A filter name alone is never accepted as ownership evidence. Duplicate exact URLs are reported as a conflict instead of selecting one arbitrarily.

The existing automatic-management consent is intentionally limited to this owned filter. Read-only server and DNS diagnostics do not broaden that write permission. The staged plan for verified rule checks, separately confirmed repair actions, Podkop DNS-chain guidance, and settings that must remain untouched is recorded in [the AdGuard Home automatic-management roadmap](adguard-home-automatic-management-roadmap.ru.md) (§aghplan).

`integration_mode` describes the traffic topology. It is separate from `site_filter_backend=auto|adguard|sheepfold`, which selects the site-list executor. `adguard_auto_manage=1` is the default. When it is off, Sheepfold does not alter AdGuard Home and reports manual delegation as unverified.

LuCI should display AdGuard Home status when this mode is selected or detected:

- installed/not detected;
- service running/stopped when this can be checked locally;
- API reachable/not reachable;
- version if the API returns it;
- last check time;
- whether credentials/API endpoint are configured in Sheepfold.

Use the local AdGuard Home API only with credentials configured by the parent/admin. HTTP is accepted only for `127.0.0.1`, `localhost`, or `[::1]`; a remote AdGuard Home endpoint must use HTTPS. Curl receives Basic Auth through a mode-`0600` temporary config instead of command-line arguments. Status and logs never contain the password or private feed token. A safe backup masks the password; only the explicitly encrypted full backup may contain it.

LuCI notes for this mode:

- Sheepfold should block/allow devices before DNS filtering.
- AdGuard Home remains responsible for DNS filtering.
- Emergency-useful sites may need special care, because DNS filtering and domain allowlisting can overlap.
- If AdGuard Home is not reachable or has filtering disabled, show the reason and use built-in filtering rather than reporting a false successful state.
- A confirmed API and URL filter are not proof that LAN clients actually use AdGuard Home for DNS. Until an end-to-end check exists, LuCI must show `filter confirmed, client DNS path not checked` as a warning rather than full success.
- `filtering/check_host` confirms the AdGuard Home engine decision only. Its query is restricted to Sheepfold's fixed `.test` domains and, where needed, one router-observed IPv4 client; it must not become a generic host-check proxy.
- Do not use a MAC address in `$client` rules unless AdGuard Home itself is the DHCP server. Sheepfold therefore uses router-observed IPv4 addresses and refreshes its owned feed after lease changes.

Useful external reference:

- [Podkop: connecting AdGuard Home and Podkop](https://podkop.net/docs/adguard/)

## Podkop

Podkop should remain responsible for routing selected traffic through its configured path.

Sheepfold must avoid conflicting with Podkop-managed Dnsmasq, nftables, sing-box, and routing state.

LuCI notes for this mode:

- Podkop remains responsible for traffic routing after Sheepfold allows the device.
- Sheepfold must avoid modifying Podkop-managed Dnsmasq, nftables, sing-box, or routing state.
- If Podkop is installed but disabled, show a warning.
- If Podkop is not detected, do not enable Podkop compatibility silently.

Podkop currently should be treated as "local package/service/config detection" unless a stable Sheepfold-facing API appears later. LuCI status should therefore be conservative:

- package/config detected or not detected;
- service enabled/running if available through init/service state;
- compatibility mode selected;
- warning when Podkop is selected but not detected;
- warning that Sheepfold must not overwrite Podkop-managed routing, Dnsmasq, nftables, or sing-box state.

Useful external references:

- [Podkop documentation](https://github.com/itdoginfo/podkop)
- [Podkop: connecting AdGuard Home and Podkop](https://podkop.net/docs/adguard/)
- [Podkop: clearing browser cache after LuCI updates](https://podkop.net/docs/clear-browser-cache/)

## Router Selection

Sheepfold targets modern OpenWRT routers with `firewall4` / `nftables`.

For choosing compatible hardware, link users to:

- [OpenWRT router comparison](https://hattabbi4.github.io/openwrt-router-compare/)
