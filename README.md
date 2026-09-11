<p align="center">
  <img src="docs/assets/sheepfold-logo.png" alt="Sheepfold logo" width="160">
</p>

# Sheepfold Family Internet Control

[Русский](README.ru.md) | English

[Project presentation](docs/project-presentation.md)

[Encrypted parent-app bug reports](docs/support-report-transport.ru.md) · [Legacy LuCI channel: Yandex Cloud + YDB](docs/yandex-cloud-ydb-feedback.ru.md)

[How official IPK and OpenWrt APK packages are built](docs/github-actions-openwrt-build.ru.md)

Sheepfold is a family internet access control system for an OpenWRT router.

It is being built as an OpenWRT router application with a LuCI web interface, backend service, Android companion app named **Sheepfold**, and messenger bot integration for managing household internet access.

## Installation

The installer performs the first-run questions, detects AdGuard Home/Podkop, downloads the matching package from the latest stable release, and installs it with the native OpenWrt package manager: `.ipk` through `opkg` on 24.10 and older, or an OpenWrt `.apk` through apk v3 on 25.12 and newer.
It first asks for application language (`ru` by default, `en` for English), country profile, the Sheepfold product, user-agreement consent, and automation mode. `Maximum automation` is the default and applies the coherent recommended profile for new-device access, full detection, automatic system groups, and identity monitoring. `Selective automation` exposes the individual choices in LuCI and starts with reduced device detection.

```sh
wget -O /tmp/sheepfold-install.sh https://raw.githubusercontent.com/kva4991/luci-app-sheepfold-family-internet-control/main/install.sh &&
sh /tmp/sheepfold-install.sh
```

## Update

The parent Android app has a separate **Information → App update** button.
It checks published parent APK releases and asks Android to confirm installation.
See the [update and release guide](docs/android-app-updates.ru.md) for signing requirements
and current availability. This does not update the router package.

After the OpenWrt package is installed, the update script delegates to the installed Sheepfold updater. The updater checks the latest stable GitHub Release, compares versions, downloads the package format used by the current OpenWrt release, validates its internal metadata, and installs it only when a newer version is available.

Optional **Participate in beta testing** at the bottom of General settings enables hourly automatic updates from those published releases after confirmation and Save. It also enables SIM/new child Wi-Fi notifications, without enabling new location collection. It is off by default. See the [beta-testing contract](docs/maintenance-jobs.ru.md).

```sh
wget -O /tmp/sheepfold-update.sh https://raw.githubusercontent.com/kva4991/luci-app-sheepfold-family-internet-control/main/update.sh &&
sh /tmp/sheepfold-update.sh
```

## Uninstall From OpenWRT

The uninstaller removes the OpenWRT package, keeps Sheepfold settings and client lists, and prints a report of remaining router settings.

```sh
wget -O /tmp/sheepfold-uninstall.sh https://raw.githubusercontent.com/kva4991/luci-app-sheepfold-family-internet-control/main/uninstall.sh &&
sh /tmp/sheepfold-uninstall.sh
```

## Project Names

- GitHub repository: `luci-app-sheepfold-family-internet-control`
- OpenWRT package: `luci-app-sheepfold-family-internet-control`
- LuCI EN: `Sheepfold Family Internet Control`
- LuCI RU: `Sheepfold : контроль доступа в интернет для семьи`
- Android app: `Sheepfold`
- Android package: `app.sheepfold.android`

## Goals

- Manage internet access for home devices through an OpenWRT router and its LuCI web interface.
- Provide an Android companion app with quick actions and widgets.
- Support Telegram/VK messenger bot controls, with VK as the default first-run choice and MAX as an experimental adapter.
- Keep device allowlists, blocklists, schedules, temporary access tokens, and access to emergency-useful sites.
- Sync device names and static IP addresses with the OpenWRT router DHCP static leases.
- Work safely with `fw4` / `nftables`.
- Coexist with AdGuard Home and Podkop.

## Target Android Scope

Both Android applications target Android 9.0 Pie / API 28 and newer.

Older Android versions are intentionally out of scope.

## Target OpenWRT Scope

Sheepfold targets modern OpenWRT routers with `firewall4` / `nftables`.

Legacy `firewall3` / `iptables` support is intentionally out of scope. The expected installation targets are reasonably recent routers and firmware builds, for example devices in the class of Xiaomi Mi Router AX3000T.

## Planned Traffic Flow

1. Sheepfold decides whether a device is allowed to access the network.
2. Allowed DNS traffic can continue through AdGuard Home.
3. Allowed and filtered traffic can then continue through Podkop routing.

The project should not break AdGuard Home, Dnsmasq, Podkop, sing-box, or standard OpenWRT firewall rules.

## Rule Priority

1. Blocklisted devices are always blocked.
2. Allowlisted devices are never blocked by global/schedule rules.
3. One device must not be present in both allowlist and blocklist.
4. Temporary access tokens must not bypass the blocklist.
5. Schedules apply only to devices that are not allowlisted or blocklisted.

## Repository Layout

```text
package/luci-app-sheepfold-family-internet-control/  OpenWRT package skeleton
android/                                             Android companion app
bot/                                                 Telegram/VK bot adapters, experimental MAX
docs/                                                Product and technical docs
install.sh                                           Router installer entrypoint
update.sh                                            Router updater entrypoint
uninstall.sh                                         Router uninstaller that preserves settings
```

## Status

This repository is an experimental build, not a stable release. LuCI and the router backend already implement device access control, schedules, secure Android pairing, site-list integration, and basic Telegram control. Before a stable release, the project still requires the documented live OpenWrt/integration matrix, physical Android validation, and an owner-controlled production signing key.

See:

- [Current implementation status](docs/current-implementation-status.md)
- [Detailed defect register and decision rationale](docs/bug-register.ru.md)
- [r306 exact Drive lookup and folder-cache audit](docs/audit-fixes-r306.ru.md)
- [r308 Drive quota accounting and cleanup audit](docs/audit-fixes-r308.ru.md)
- [r310 verified Google Drive file listing audit](docs/audit-fixes-r310.ru.md)
- [r309 verified download and destination preservation audit](docs/audit-fixes-r309.ru.md)
- [r307 Drive folder identity and upload-context audit](docs/audit-fixes-r307.ru.md)
- [r305 OAuth and token-cache audit report](docs/audit-fixes-r305.ru.md)
- [Current development roadmap (Russian)](docs/project-development-roadmap.ru.md)
- [Product requirements](docs/product-requirements.md)
- [Direct task for AI developers](docs/developer-task.md)
- [Android/OpenWRT API contract, Russian](docs/android-openwrt-api.ru.md)
- [Parent AI assistant](docs/ai-assistant.md)
- [AI context sharing](docs/ai-context-sharing.md)
- [Parent AI assistant prompt draft, Russian](docs/ai-assistant-prompt-for-support-parent/v1/ai-assistant-prompt.ru.md)
- [Age-based control scenarios](docs/age-scenarios.md)
- [Access schedules](docs/schedules.md)
- [Country profiles](docs/country-profiles.md)
- [Emergency-useful sites planning](docs/domain-allowlist.md)
- [Device passport, monitoring, and control, Russian](docs/device-passport-and-control.ru.md)
- [Device auto-detection notes, Russian](docs/device-detection.ru.md)
- [Integrations](docs/integrations.md)
- [Localization](docs/localization.md)
- [Messaging and notifications](docs/messaging.md)
- [LuCI browser cache and asset versioning](docs/luci-cache.md)
- [GitHub and installer plan](docs/github-install-setup.md)
- [Security model](docs/security.md)
- [User agreement](docs/user-agreement.md)
- [Privacy policy](docs/privacy.md)
- [Donation](docs/donation.md)
- [OpenWRT router comparison](https://hattabbi4.github.io/openwrt-router-compare/)
- [OpenWrt router buying guide for 2025 (Russian)](https://itdog.info/kakoj-router-dlya-openwrt-kupit-v-2025-godu/)

## Support

If you find Sheepfold useful and want to support development, see [Donation](docs/donation.md).

## License

MIT License.

[Local r297 audit and regression evidence](docs/audit-fixes-r297.ru.md).
