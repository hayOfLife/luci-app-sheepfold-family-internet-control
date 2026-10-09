#!/usr/bin/env python3
"""Собирает воспроизводимый тестовый IPK с Unix-правами без OpenWrt SDK.

Скрипт нужен для быстрых Windows- и live-router проходов; он пишет только в .build
или явно заданный out-dir. Успешная сборка проверяет контейнер/права пакета, но не
заменяет установку на OpenWrt и официальную сборку release в OpenWrt toolchain.
"""
import argparse
import gzip
import io
import json
import shutil
import sys
import tarfile
import tempfile
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from po2lmo import compile_po
from po2json import parse_po_entries
from sheepfold_variants import (
    PACKAGE_DIR,
    ROOT_DIR,
    SOURCE_PACKAGE_NAME,
    VARIANTS,
    artifact_name,
    filter_standard_po,
    is_ai_only_path,
    package_name,
    transform_ai_payload,
    transform_standard_payload,
)


SOURCE_PKG_NAME = SOURCE_PACKAGE_NAME
PKG_DIR = PACKAGE_DIR


def read_make_value(name: str) -> str:
    prefix = f"{name}:="
    for line in (PKG_DIR / "Makefile").read_text(encoding="utf-8").splitlines():
        if line.startswith(prefix):
            return line[len(prefix):].strip()
    raise RuntimeError(f"Cannot find {name} in package Makefile.")


def read_postinst_fragment(start_prefix: str, end_prefix: str) -> str:
    """Берёт общую миграцию/права библиотек из Makefile без второй расходящейся копии."""
    lines = (PKG_DIR / "Makefile").read_text(encoding="utf-8").splitlines()
    for start, line in enumerate(lines):
        if not line.strip().startswith(start_prefix):
            continue
        for end in range(start + 1, len(lines)):
            if lines[end].strip().startswith(end_prefix):
                return "\n".join(lines[start:end + 1]).replace("$$", "$")
        break
    raise RuntimeError(f"Cannot find complete postinst fragment: {start_prefix}")


def read_luci_dependencies() -> str:
    """Переносит зависимости из Makefile без второго расходящегося списка."""
    dependencies = []
    for token in read_make_value("LUCI_DEPENDS").split():
        dependency = token.removeprefix("+")
        if ":" in dependency:
            dependency = dependency.split(":", 1)[1]
        if dependency and not dependency.startswith("@"):
            dependencies.append(dependency)
    if not dependencies:
        raise RuntimeError("LUCI_DEPENDS does not contain package dependencies.")
    return ", ".join(dependencies)


def add_bytes(tar: tarfile.TarFile, name: str, data: bytes, mode: int = 0o644) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mode = mode
    info.uid = 0
    info.gid = 0
    info.uname = "root"
    info.gname = "root"
    info.mtime = int(time.time())
    tar.addfile(info, io.BytesIO(data))


def add_directory(tar: tarfile.TarFile, name: str) -> None:
    info = tarfile.TarInfo(name.rstrip("/") + "/")
    info.type = tarfile.DIRTYPE
    info.mode = 0o755
    info.uid = 0
    info.gid = 0
    info.uname = "root"
    info.gname = "root"
    info.mtime = int(time.time())
    tar.addfile(info)


def ensure_tar_directories(tar: tarfile.TarFile, target_path: str) -> None:
    parts = target_path.strip("./").split("/")
    current = "."
    for part in parts[:-1]:
        current = f"{current}/{part}"
        add_directory(tar, current)


def is_executable_ipk_target(target: str) -> bool:
    executable_prefixes = (
        "./etc/init.d/",
        "./etc/uci-defaults/",
        "./etc/hotplug.d/",
        "./usr/libexec/sheepfold/",
        "./www/cgi-bin/",
    )
    if any(target.startswith(prefix) for prefix in executable_prefixes):
        return True
    return target == "./www/.well-known/sheepfold.json.sh"


def add_tree(tar: tarfile.TarFile, source: Path, target_prefix: str, variant: str) -> None:
    for path in sorted(source.rglob("*")):
        rel = path.relative_to(source).as_posix()
        package_relative = f"{source.name}/{rel}"
        if package_relative.startswith("htdocs/luci-static/resources/sheepfold/i18n/"):
            continue
        if variant == "sheepfold" and is_ai_only_path(package_relative):
            continue
        target = f"./{target_prefix.rstrip('/')}/{rel}" if target_prefix else f"./{rel}"
        target = target.replace("//", "/")

        if path.is_dir():
            add_directory(tar, target)
            continue

        mode = 0o755 if is_executable_ipk_target(target) else 0o644
        data = path.read_bytes()
        if variant == "sheepfold":
            data = transform_standard_payload(package_relative, data)
        else:
            data = transform_ai_payload(package_relative, data)
        add_bytes(tar, target, data, mode)


def open_gzip_tar(path: Path) -> tarfile.TarFile:
    raw = path.open("wb")
    gz = gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0)
    tar = tarfile.open(fileobj=gz, mode="w", format=tarfile.GNU_FORMAT)
    original_close = tar.close

    def close_all() -> None:
        original_close()
        gz.close()
        raw.close()

    tar.close = close_all
    return tar


def write_control_tar(path: Path, version: str, release: str, variant: str) -> None:
    current_package = package_name(variant)
    dependencies = read_luci_dependencies()
    access_priority_migration = read_postinst_fragment(
        "legacy_access_priority=", "ensure_global_option access_priority "
    )
    library_permissions = read_postinst_fragment("for library in ", "done")
    ai_postinst_defaults = ""
    ai_cron_jobs = ""
    if variant == "sheepfoldAi":
        ai_postinst_defaults = """ensure_global_option ai_enabled '0'
ensure_global_option ai_provider 'none'
ensure_global_option ai_rate_limit_requests '20'
ensure_global_option ai_rate_limit_window_seconds '3600'
ensure_global_option ai_individual_logs '0'
ensure_global_option child_ai_parental_consent '0'
ensure_global_option child_ai_consent_version 'child-ai-v1'
ensure_global_option parent_ai_prompt_version 'v2'
ensure_global_option child_ai_prompt_version 'v1'
ensure_global_option private_logs '0'
ensure_global_option log_days '7'
ensure_global_option log_max_dir_kb '0'
ensure_global_option log_max_device_kb '0'
ensure_global_option deepseek_model 'deepseek-chat'
ensure_global_option deepseek_api_url 'https://api.deepseek.com/chat/completions'
ensure_global_option deepseek_api_key ''
ensure_global_option gemini_model 'gemini-2.5-flash'
ensure_global_option gemini_api_url 'https://generativelanguage.googleapis.com/v1beta/models'
ensure_global_option gemini_api_key ''
ensure_global_option grok_model 'grok-3-mini'
ensure_global_option grok_api_url 'https://api.x.ai/v1/chat/completions'
ensure_global_option grok_api_key ''
"""
        # Эти задания нужны только AI Support: Standard не содержит sheepfold-activity-log.
        ai_cron_jobs = """5 2 * * * /usr/libexec/sheepfold/sheepfold-maintenance-window && /usr/libexec/sheepfold/sheepfold-activity-log rotate >/dev/null 2>&1
55 4 * * * /usr/libexec/sheepfold/sheepfold-activity-log rotate >/dev/null 2>&1
"""
    control = f"""Package: {current_package}
Version: {version}-{release}
Architecture: all
Maintainer: hayOfLife
Depends: {dependencies}
Conflicts: luci-app-sheepfold-ai-support
Replaces: luci-app-sheepfold-ai-support
Provides: sheepfold-family-internet-control
Section: luci
Priority: optional
Installed-Size: 10240
Description: {VARIANTS[variant]["description"]}
""".encode("utf-8")
    preinst = b"""#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] && exit 0
case "$1" in
        upgrade|install)
                if [ -s /etc/config/sheepfold ]; then
                        mkdir -p /etc/sheepfold/migrations
                        cp /etc/config/sheepfold /etc/sheepfold/migrations/sheepfold.config.pre-upgrade
                        chmod 600 /etc/sheepfold/migrations/sheepfold.config.pre-upgrade 2>/dev/null || true
                fi
                ;;
esac
exit 0
"""

    postinst = f"""#!/bin/sh
[ -n "${{IPKG_INSTROOT}}" ] && exit 0
cleanup_opkg_conffile_artifacts() {{
        for leftover in /etc/config/sheepfold-opkg /etc/config/sheepfold-opkg.old; do
                [ -e "$leftover" ] || continue
                rm -f "$leftover"
        done
}}
cleanup_stale_update_artifacts() {{
        # Временную копию конфига удаляет updater только после проверки результата opkg (§updsafe).
        rm -f /tmp/sheepfold/update/*.ipk 2>/dev/null || true
}}
recover_sheepfold_config() {{
        mkdir -p /etc/config /etc/sheepfold/migrations
        if [ -s /etc/config/sheepfold ]; then
                return 0
        fi
        for candidate in \\
                /etc/sheepfold/migrations/sheepfold.config.pre-upgrade \\
                /etc/config/sheepfold-opkg \\
                /etc/config/sheepfold-opkg.old \\
                /tmp/sheepfold/update/sheepfold-config-before-update; do
                if [ -s "$candidate" ]; then
                        cp "$candidate" /etc/config/sheepfold
                        chmod 600 /etc/config/sheepfold 2>/dev/null || true
                        return 0
                fi
        done
        if [ -r /usr/share/sheepfold/sheepfold.uci.defaults ]; then
                cp /usr/share/sheepfold/sheepfold.uci.defaults /etc/config/sheepfold
        else
                : > /etc/config/sheepfold
        fi
        chmod 600 /etc/config/sheepfold 2>/dev/null || true
}}
recover_sheepfold_config
cleanup_stale_update_artifacts
repair_sheepfold_uci_sections() {{
        mkdir -p /etc/config
        [ -e /etc/config/sheepfold ] || : > /etc/config/sheepfold
        chmod 600 /etc/config/sheepfold 2>/dev/null || true
        for pair in messenger:messenger_global export:export_global wifi_control:wifi_control_global pairing:pairing_global; do
                type="${{pair%%:*}}"
                name="${{pair#*:}}"
                if [ "$(uci -q get sheepfold.global 2>/dev/null)" = "$type" ]; then
                        uci -q rename sheepfold.global="$name" 2>/dev/null || {{
                                uci -q delete sheepfold.global 2>/dev/null || true
                                uci -q set "sheepfold.$name=$type"
                        }}
                fi
                uci -q rename "sheepfold.@$type[0]=$name" 2>/dev/null || true
        done
        if [ "$(uci -q get sheepfold.global 2>/dev/null)" != "sheepfold" ]; then
                uci -q rename sheepfold.global=legacy_global 2>/dev/null || uci -q delete sheepfold.global 2>/dev/null || true
                uci -q rename sheepfold.@sheepfold[0]=global 2>/dev/null || uci -q set sheepfold.global='sheepfold'
        fi
        uci -q commit sheepfold 2>/dev/null || true
}}
repair_sheepfold_uci_sections
uci -q get sheepfold.global >/dev/null || uci -q set sheepfold.global='sheepfold'
uci -q set sheepfold.global.product_variant='{variant}'
ensure_global_option() {{
        option="$1"
        value="$2"
        [ -n "$(uci -q get sheepfold.global.$option 2>/dev/null)" ] || uci -q set sheepfold.global.$option="$value"
}}
ensure_global_option enabled '0'
ensure_global_option language 'ru'
ensure_global_option block_on_boot '0'
{access_priority_migration}
ensure_global_option new_device_policy 'allow'
ensure_global_option auto_configure '1'
ensure_global_option detection_mode 'full'
ensure_global_option device_monitoring_mode 'automatic'
ensure_global_option no_restrictions_auto_assign '1'
ensure_global_option personal_devices_auto_assign '1'
[ "$(uci -q get sheepfold.global.new_device_policy 2>/dev/null || true)" != 'restrict' ] || \
        uci -q set sheepfold.global.new_device_policy='restrict_until_configured'
automation_mode="$(uci -q get sheepfold.global.automation_mode 2>/dev/null || true)"
if [ -z "$automation_mode" ]; then
        if [ "$(uci -q get sheepfold.global.new_device_policy 2>/dev/null || printf allow)" = 'allow' ] && \
           [ "$(uci -q get sheepfold.global.auto_configure 2>/dev/null || printf 1)" = '1' ] && \
           [ "$(uci -q get sheepfold.global.detection_mode 2>/dev/null || printf full)" = 'full' ] && \
           [ "$(uci -q get sheepfold.global.device_monitoring_mode 2>/dev/null || printf automatic)" = 'automatic' ] && \
           [ "$(uci -q get sheepfold.global.no_restrictions_auto_assign 2>/dev/null || printf 1)" = '1' ] && \
           [ "$(uci -q get sheepfold.global.personal_devices_auto_assign 2>/dev/null || printf 1)" = '1' ]; then
                automation_mode='maximum'
        else
                automation_mode='selective'
        fi
        uci -q set sheepfold.global.automation_mode="$automation_mode"
fi
case "$automation_mode" in
        maximum)
                uci -q set sheepfold.global.new_device_policy='allow'
                uci -q set sheepfold.global.auto_configure='1'
                uci -q set sheepfold.global.detection_mode='full'
                uci -q set sheepfold.global.device_monitoring_mode='automatic'
                uci -q set sheepfold.global.no_restrictions_auto_assign='1'
                uci -q set sheepfold.global.personal_devices_auto_assign='1'
                ;;
        selective) ;;
        *) uci -q set sheepfold.global.automation_mode='selective' ;;
esac
ensure_global_option detector_watch_interval_seconds '10'
ensure_global_option detector_interval_seconds '86400'
ensure_global_option detector_connection_delay_seconds '20'
ensure_global_option detector_max_event_scans_per_tick '4'
ensure_global_option detector_max_hosts_per_scan '16'
ensure_global_option detector_min_device_type_confidence '70'
ensure_global_option detector_min_no_restrictions_confidence '80'
ensure_global_option detector_nmap_host_timeout_seconds '20'
ensure_global_option detector_full_rescan_seconds '86400'
ensure_global_option detector_low_confidence_retry_seconds '86400'
ensure_global_option update_check_install_mode 'weekly'
ensure_global_option beta_testing '0'
ensure_global_option active_messenger 'none'
{ai_postinst_defaults}ensure_global_option vk_access_token ''
ensure_global_option vk_community_id ''
ensure_global_option vk_admin_user_id ''
ensure_global_option telegram_bot_token ''
ensure_global_option telegram_admin_chat_id ''
ensure_global_option wifi_auto_enable_mode 'never'
ensure_global_option wifi_auto_enable_time '07:00'
ensure_global_option wifi_auto_disable_mode 'never'
ensure_global_option wifi_auto_disable_time '23:00'
ensure_global_option router_ntp_server_enabled '1'
ensure_global_option router_ntp_client_auto_configure '1'
ensure_global_option router_timezone_name 'Europe/Moscow'
ensure_global_option router_timezone 'MSK-3'
ensure_global_option router_ntp_servers 'ntp1.vniiftri.ru ntp2.ntp-servers.net 3.openwrt.pool.ntp.org'
ensure_global_option router_ipv6_disabled '0'
ensure_global_option router_ipv6_mode_source 'default'
ensure_global_option wps_short_press_action 'router_default'
ensure_global_option wps_long_press_action 'router_default'
ensure_global_option router_led_control 'router_default'
ensure_global_option blocked_page_enabled '1'
ensure_global_option blocked_page_text 'Интернет временно недоступен по семейным правилам. Если это ошибка, обратитесь к родителю.'
ensure_global_option blocked_page_port '5202'
ensure_global_option domain_allowlist_for_blocklist '1'
old_site_allowlist_sources='UT1 child | https://dsi.ut-capitole.fr/blacklists/index_en.php#child'
default_site_allowlist_sources='UT1 child | https://dsi.ut-capitole.fr/blacklists/download/child.tar.gz'
current_site_allowlist_sources="$(uci -q get sheepfold.global.site_allowlist_sources 2>/dev/null || true)"
if [ -z "$current_site_allowlist_sources" ] || [ "$current_site_allowlist_sources" = "$old_site_allowlist_sources" ]; then
        uci -q set sheepfold.global.site_allowlist_sources="$default_site_allowlist_sources"
fi
ensure_global_option site_blocklist_mode 'except_allowlist_admins'
old_site_blocklist_sources='UT1 adult, malware, phishing, gambling, games, vpn | https://dsi.ut-capitole.fr/blacklists/index_en.php; StevenBlack hosts gambling-porn | https://github.com/StevenBlack/hosts; HaGeZi Threat Intelligence Feeds | https://github.com/hagezi/dns-blocklists; URLhaus malware URLs | https://urlhaus.abuse.ch/api/'
default_site_blocklist_sources='HaGeZi NSFW | https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/nsfw.txt; HaGeZi Gambling mini | https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/gambling.mini.txt; HaGeZi Threat Intelligence mini | https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/tif.mini.txt; URLhaus malware domains | https://urlhaus.abuse.ch/downloads/hostfile/'
current_site_blocklist_sources="$(uci -q get sheepfold.global.site_blocklist_sources 2>/dev/null || true)"
if [ -z "$current_site_blocklist_sources" ] || [ "$current_site_blocklist_sources" = "$old_site_blocklist_sources" ]; then
        uci -q set sheepfold.global.site_blocklist_sources="$default_site_blocklist_sources"
fi
ensure_global_option site_lists_update_interval 'weekly'
ensure_global_option log_retention '3d'
ensure_global_option offline_device_retention_days '90'
ensure_global_option app_port '5201'
ensure_global_option feedback_endpoint ''
ensure_global_option feedback_install_id ''
ensure_global_option support_report_endpoint ''
ensure_global_option support_report_recipient_key_id ''
ensure_global_option support_report_recipient_public_keyset ''
ensure_global_option support_report_discovery_public_key ''
ensure_global_option log_storage 'ram'
ensure_global_option log_cache_path '/tmp/sheepfold/events.log'
[ -x /usr/libexec/sheepfold/sheepfold-default-groups ] && /usr/libexec/sheepfold/sheepfold-default-groups apply
if [ "$(uci -q get sheepfold.global.luci_language_synced 2>/dev/null)" != "1" ]; then
        lang="$(uci -q get sheepfold.global.language 2>/dev/null || printf ru)"
        case "$lang" in
                en|ru) ;;
                *) lang=ru ;;
        esac
        uci -q get luci.main >/dev/null 2>&1 || uci -q set luci.main=core
        uci -q set luci.main.lang="$lang"
        uci -q set sheepfold.global.luci_language_synced='1'
        uci -q commit luci 2>/dev/null || true
fi
detect_installed() {{
        pkg="$1"
        init="$2"
        config="$3"
        opkg status "$pkg" 2>/dev/null | grep -q "Status:.* installed" && return 0
        [ -n "$init" ] && [ -x "/etc/init.d/$init" ] && return 0
        [ -n "$config" ] && [ -f "/etc/config/$config" ] && return 0
        return 1
}}
detect_installed AdGuardHome AdGuardHome AdGuardHome || detect_installed adguardhome adguardhome adguardhome
has_adguard="$?"
detect_installed podkop podkop podkop
has_podkop="$?"
if [ "$(uci -q get sheepfold.global.integration_mode_user_set 2>/dev/null)" != "1" ]; then
        if [ "$has_adguard" = "0" ] && [ "$has_podkop" = "0" ]; then
                uci -q set sheepfold.global.integration_mode='adguard_podkop'
        elif [ "$has_adguard" = "0" ]; then
                uci -q set sheepfold.global.integration_mode='adguard'
        elif [ "$has_podkop" = "0" ]; then
                uci -q set sheepfold.global.integration_mode='podkop'
        else
                uci -q set sheepfold.global.integration_mode='none'
        fi
        uci -q set sheepfold.global.integration_mode_source='auto'
        uci -q set sheepfold.global.adguard_integration="$([ "$has_adguard" = "0" ] && printf 1 || printf 0)"
        uci -q set sheepfold.global.podkop_compatibility="$([ "$has_podkop" = "0" ] && printf 1 || printf 0)"
fi
current_integration="$(uci -q get sheepfold.global.integration_mode 2>/dev/null || printf none)"
ipv6_source="$(uci -q get sheepfold.global.router_ipv6_mode_source 2>/dev/null || printf default)"
case "$current_integration" in
        podkop|adguard_podkop)
                if [ "$(uci -q get sheepfold.global.router_ipv6_disabled 2>/dev/null || printf 0)" != "1" ]; then
                        uci -q set sheepfold.global.router_ipv6_disabled='1'
                        uci -q set sheepfold.global.router_ipv6_mode_source='auto_podkop'
                elif [ "$ipv6_source" = 'default' ]; then
                        uci -q set sheepfold.global.router_ipv6_mode_source='auto_podkop'
                fi
                ;;
        *)
                if [ "$ipv6_source" = 'auto_podkop' ]; then
                        uci -q set sheepfold.global.router_ipv6_disabled='0'
                        uci -q set sheepfold.global.router_ipv6_mode_source='default'
                fi
                ;;
esac
uci -q set sheepfold.global.ui_asset_version='{version}-{release}'
uci -q commit sheepfold
find /usr/libexec/sheepfold -type f -exec chmod 0755 {{}} + 2>/dev/null || true
{library_permissions}
[ -x /usr/libexec/sheepfold/sheepfold-ipv6-control ] && \
        /usr/libexec/sheepfold/sheepfold-ipv6-control apply >/dev/null 2>&1 || true
for helper in \\
        /etc/hotplug.d/dhcp/90-sheepfold-device-signals \\
        /www/.well-known/sheepfold.json.sh \\
        /www/cgi-bin/sheepfold-api \\
        /www/cgi-bin/sheepfold-blocked; do
        [ -e "$helper" ] && chmod 0755 "$helper" 2>/dev/null || true
done
app_port="$(uci -q get sheepfold.global.app_port 2>/dev/null || printf 5201)"
case "$app_port" in ''|*[!0-9]*) app_port=5201 ;; esac
[ "$app_port" -ge 1 ] && [ "$app_port" -le 65535 ] || app_port=5201
mkdir -p /www/.well-known
cat > /www/.well-known/sheepfold.json <<EOF
{{
  "service": "sheepfold",
  "name": "Sheepfold Family Internet Control",
  "routerName": "OpenWRT Sheepfold",
  "appPort": "$app_port",
  "apiPath": "/cgi-bin/sheepfold-api",
  "apiBase": "/cgi-bin/sheepfold-api",
  "version": "{version}-{release}"
}}
EOF
install_sheepfold_cron() {{
        cron_file='/etc/crontabs/root'
        mkdir -p /etc/crontabs
        tmp="$cron_file.sheepfold.tmp"
        if [ -f "$cron_file" ]; then
                awk '
                /^# BEGIN SHEEPFOLD MANAGED JOBS$/ {{ skip=1; next }}
                /^# END SHEEPFOLD MANAGED JOBS$/   {{ skip=0; next }}
                !skip {{ print }}
                ' "$cron_file" > "$tmp"
        else
                : > "$tmp"
        fi
        cat >> "$tmp" <<'EOF'
# BEGIN SHEEPFOLD MANAGED JOBS
* * * * * /usr/libexec/sheepfold/sheepfold-firewall sync >/dev/null 2>&1
{ai_cron_jobs}10 2 * * * /usr/libexec/sheepfold/sheepfold-maintenance-window && /usr/libexec/sheepfold/sheepfold-log-storage archive-push >/dev/null 2>&1
0 5 * * * /usr/libexec/sheepfold/sheepfold-log-storage archive-push >/dev/null 2>&1
# END SHEEPFOLD MANAGED JOBS
EOF
        chmod 600 "$tmp"
        mv -f "$tmp" "$cron_file"
        [ -x /etc/init.d/cron ] && /etc/init.d/cron restart >/dev/null 2>&1 || true
}}
install_sheepfold_cron
rm -f /var/luci-indexcache* 2>/dev/null || true
rm -f /tmp/luci-indexcache* 2>/dev/null || true
rm -f /tmp/luci-modulecache/* 2>/dev/null || true
[ -x /etc/init.d/rpcd ] && /etc/init.d/rpcd reload || true
[ -x /etc/init.d/sheepfold ] && /etc/init.d/sheepfold enable || true
[ -x /etc/init.d/sheepfold ] && /etc/init.d/sheepfold restart || true
exit 0
""".encode("utf-8")

    prerm = """#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] && exit 0
[ -x /usr/libexec/sheepfold/sheepfold-site-lists ] && \
        /usr/libexec/sheepfold/sheepfold-site-lists cron-remove >/dev/null 2>&1 || true
[ -x /usr/libexec/sheepfold/sheepfold-domain-policy ] && \
        /usr/libexec/sheepfold/sheepfold-domain-policy clear >/dev/null 2>&1 || true
# При обновлении новый postinst сразу применит настройку заново, поэтому не создаём
# короткое окно с неожиданно включённым IPv6. При удалении возвращаем исходное состояние.
if [ "${1:-remove}" != upgrade ] && [ -x /usr/libexec/sheepfold/sheepfold-ipv6-control ]; then
        if ! /usr/libexec/sheepfold/sheepfold-ipv6-control release >/dev/null 2>&1; then
                logger -t sheepfold 'Не удалось восстановить прежнее состояние IPv6 при удалении пакета.'
                echo 'Sheepfold: не удалось восстановить прежнее состояние IPv6; проверьте системный журнал.' >&2
        fi
fi
# Удаляем только собственные firewall-объекты и cron-блок Sheepfold.
[ -x /usr/libexec/sheepfold/sheepfold-firewall ] && \
        /usr/libexec/sheepfold/sheepfold-firewall clear >/dev/null 2>&1 || true
cron_file='/etc/crontabs/root'
if [ -f "$cron_file" ]; then
        tmp="$cron_file.sheepfold.tmp"
        awk '
        /^# BEGIN SHEEPFOLD MANAGED JOBS$/ { skip=1; next }
        /^# END SHEEPFOLD MANAGED JOBS$/   { skip=0; next }
        !skip { print }
        ' "$cron_file" > "$tmp" && {
                chmod 600 "$tmp"
                mv -f "$tmp" "$cron_file"
        }
fi
[ -x /etc/init.d/cron ] && /etc/init.d/cron restart >/dev/null 2>&1 || true
exit 0
""".encode("utf-8")

    with open_gzip_tar(path) as tar:
        add_bytes(tar, "./control", control, 0o644)
        add_bytes(tar, "./preinst", preinst, 0o755)
        add_bytes(tar, "./postinst", postinst, 0o755)
        add_bytes(tar, "./prerm", prerm, 0o755)


def bundled_i18n_files(variant: str) -> list[tuple[str, bytes, int]]:
    files: list[tuple[str, bytes, int]] = []
    po_catalogs = [
        ("ru", PKG_DIR / "po/ru/sheepfold.po"),
        ("zh_Hans", ROOT_DIR / "po/zh_Hans/sheepfold.po"),
    ]
    for lang, po_path in po_catalogs:
        if not po_path.is_file():
            continue
        source = po_path.read_text(encoding="utf-8")
        if variant == "sheepfold":
            source = filter_standard_po(source)
        with tempfile.NamedTemporaryFile("w", suffix=".po", encoding="utf-8", delete=False) as temp_po:
            temp_po.write(source)
            temp_po_path = Path(temp_po.name)
        try:
            lmo_data = compile_po(temp_po_path)
        finally:
            temp_po_path.unlink(missing_ok=True)
        files.append((f"./usr/lib/lua/luci/i18n/sheepfold.{lang}.lmo", lmo_data, 0o644))
        json_data = json.dumps(
            parse_po_entries(source), ensure_ascii=False, separators=(",", ":")
        ).encode("utf-8")
        files.append((
            f"./www/luci-static/resources/sheepfold/i18n/{lang}.json",
            json_data,
            0o644,
        ))
    return files


def write_data_tar(path: Path, variant: str) -> None:
    with open_gzip_tar(path) as tar:
        add_tree(tar, PKG_DIR / "root", "", variant)
        add_tree(tar, PKG_DIR / "htdocs", "www", variant)
        for target, data, mode in bundled_i18n_files(variant):
            ensure_tar_directories(tar, target)
            add_bytes(tar, target, data, mode)


def write_ipk_tar(path: Path, members: list[tuple[str, bytes]]) -> None:
    with open_gzip_tar(path) as tar:
        for name, data in members:
            add_bytes(tar, f"./{name}", data, 0o644)


def resolve_default_out_dir(explicit: str | None) -> Path:
    if explicit:
        return Path(explicit)
    artifact_dir = ROOT_DIR / ".build" / "ipk-output"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    return artifact_dir


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--variant",
        choices=["sheepfold", "sheepfoldAi", "all"],
        default="sheepfold",
        help="Вариант продукта; all собирает оба IPK",
    )
    parser.add_argument(
        "--out-dir",
        default=None,
        help="Каталог для .ipk (по умолчанию: .build/ipk-output внутри репозитория)",
    )
    args = parser.parse_args()

    version = read_make_value("PKG_VERSION")
    release = read_make_value("PKG_RELEASE")
    out_dir = resolve_default_out_dir(args.out_dir)
    build_root = ROOT_DIR / ".build"
    build_root.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    selected_variants = list(VARIANTS) if args.variant == "all" else [args.variant]
    built = []
    for variant in selected_variants:
        build_dir = Path(tempfile.mkdtemp(prefix=f"sheepfold-{variant}-ipk-", dir=build_root))
        ipk = out_dir / f"{artifact_name(variant)}_{version}-{release}_all.ipk"
        if out_dir.name.casefold() == "pesochnica":
            # Пользовательский каталог содержит только актуальную сборку каждого
            # варианта; артефакты других вариантов и посторонние файлы не трогаем.
            for previous in out_dir.glob(f"{artifact_name(variant)}_*_all.ipk"):
                if previous != ipk:
                    previous.unlink(missing_ok=True)
        try:
            debian_binary = build_dir / "debian-binary"
            data_tar = build_dir / "data.tar.gz"
            control_tar = build_dir / "control.tar.gz"
            debian_binary.write_bytes(b"2.0\n")
            write_data_tar(data_tar, variant)
            write_control_tar(control_tar, version, release, variant)
            write_ipk_tar(ipk, [
                ("debian-binary", debian_binary.read_bytes()),
                ("data.tar.gz", data_tar.read_bytes()),
                ("control.tar.gz", control_tar.read_bytes()),
            ])
        finally:
            shutil.rmtree(build_dir, ignore_errors=True)
        built.append(ipk)

    for ipk in built:
        print(ipk)


if __name__ == "__main__":
    main()
