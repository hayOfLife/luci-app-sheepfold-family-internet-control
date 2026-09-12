include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-sheepfold-family-internet-control
PKG_VERSION:=0.1.0
PKG_RELEASE:=320
PKG_LICENSE:=MIT
PKG_MAINTAINER:=kva4991
SHEEPFOLD_UI_ASSET_VERSION:=$(PKG_VERSION)-$(PKG_RELEASE)
SHEEPFOLD_PRODUCT_VARIANT:=sheepfoldAi

LUCI_TITLE:=Sheepfold Family Internet Control
LUCI_DESCRIPTION:=Family internet access control for OpenWRT with LuCI, Android, and bot support.
# luci-ssl остаётся общим HTTPS-метапакетом для OpenWrt 24.10 и 25.12.
# Отдельного uhttpd-mod-tls в feed 25.12 уже нет, поэтому он ломает установку APK.
# QR v2 вычисляет SPKI SHA-256 штатным openssl и не доверяет сети до проверки ключа.
LUCI_DEPENDS:=+luci-base +firewall4 +rpcd +uci +jshn +uclient-fetch +ca-bundle +uhttpd +luci-ssl +curl +flock +openssl-util +ucode-mod-socket

# Supported LuCI languages (gettext)
LUCI_LANGUAGES:=en ru zh_Hans
LUCI_LANG.zh_Hans:=中文 (简体)

define Package/$(PKG_NAME)/preinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
# OpenWrt apk вызывает pre-install/pre-upgrade без позиционного действия. Нельзя
# проверять первый аргумент: барьер не создастся именно при реальной установке. §pkgstart1
mkdir -p /tmp/sheepfold
date +%s > /tmp/sheepfold/package-installing
chmod 600 /tmp/sheepfold/package-installing 2>/dev/null || true
if [ -s /etc/config/sheepfold ]; then
	mkdir -p /etc/sheepfold/migrations
	cp /etc/config/sheepfold /etc/sheepfold/migrations/sheepfold.config.pre-upgrade
	chmod 600 /etc/sheepfold/migrations/sheepfold.config.pre-upgrade 2>/dev/null || true
fi
exit 0
endef

define Package/$(PKG_NAME)/postinst
#!/bin/sh
install_marker='/tmp/sheepfold/package-installing'
cleanup_install_marker() {
	rm -f "$$install_marker"
}
if [ -z "$${IPKG_INSTROOT}" ]; then
	# apk может автоматически запустить init.d сразу после распаковки, пока
	# postinst ещё мигрирует конфиг и права. Маркер снимается и при ошибке. §pkgstart1
	trap cleanup_install_marker 0 1 2 3 15
fi
hardener="$${IPKG_INSTROOT}/usr/libexec/sheepfold/sheepfold-runtime-hardening"
if [ -f "$$hardener" ]; then
	/bin/sh "$$hardener" "$${IPKG_INSTROOT}" || exit 1
fi
[ -n "$${IPKG_INSTROOT}" ] && exit 0
cleanup_opkg_conffile_artifacts() {
	for leftover in /etc/config/sheepfold-opkg /etc/config/sheepfold-opkg.old; do
		[ -e "$$leftover" ] || continue
		rm -f "$$leftover"
	done
}
cleanup_stale_update_artifacts() {
	# Временную копию конфига updater удаляет только после проверки результата
	# системного package manager: opkg на 24.10 или apk на 25.12 (§updsafe).
	rm -f /tmp/sheepfold/update/*.ipk /tmp/sheepfold/update/*.apk 2>/dev/null || true
}
recover_sheepfold_config() {
	mkdir -p /etc/config /etc/sheepfold/migrations
	if [ -s /etc/config/sheepfold ]; then
		return 0
	fi
	for candidate in \
		/etc/sheepfold/migrations/sheepfold.config.pre-upgrade \
		/etc/config/sheepfold-opkg \
		/etc/config/sheepfold-opkg.old \
		/tmp/sheepfold/update/sheepfold-config-before-update; do
		if [ -s "$$candidate" ]; then
			cp "$$candidate" /etc/config/sheepfold
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
}
recover_sheepfold_config
cleanup_stale_update_artifacts
repair_sheepfold_uci_sections() {
	mkdir -p /etc/config
	[ -e /etc/config/sheepfold ] || : > /etc/config/sheepfold
	chmod 600 /etc/config/sheepfold 2>/dev/null || true
	for pair in messenger:messenger_global export:export_global wifi_control:wifi_control_global pairing:pairing_global; do
		type="$${pair%%:*}"
		name="$${pair#*:}"
		if [ "$$(uci -q get sheepfold.global 2>/dev/null)" = "$$type" ]; then
			uci -q rename sheepfold.global="$$name" 2>/dev/null || {
				uci -q delete sheepfold.global 2>/dev/null || true
				uci -q set "sheepfold.$$name=$$type"
			}
		fi
		uci -q rename "sheepfold.@$$type[0]=$$name" 2>/dev/null || true
	done
	if [ "$$(uci -q get sheepfold.global 2>/dev/null)" != "sheepfold" ]; then
		uci -q rename sheepfold.global=legacy_global 2>/dev/null || uci -q delete sheepfold.global 2>/dev/null || true
		uci -q rename sheepfold.@sheepfold[0]=global 2>/dev/null || uci -q set sheepfold.global='sheepfold'
	fi
	uci -q commit sheepfold 2>/dev/null || true
}
repair_sheepfold_uci_sections
uci -q get sheepfold.global >/dev/null || uci -q set sheepfold.global='sheepfold'
ensure_global_option() {
	option="$$1"
	value="$$2"
	[ -n "$$(uci -q get sheepfold.global.$$option 2>/dev/null)" ] || uci -q set sheepfold.global.$$option="$$value"
}
ensure_global_option enabled '0'
ensure_global_option language 'ru'
install_country='ru'
if [ -r /etc/sheepfold/install.country ]; then
	install_country="$$(sed -n '1p' /etc/sheepfold/install.country | tr -d '\r\n')"
	case "$$install_country" in ru|by|cn|other) ;; *) install_country='ru' ;; esac
fi
ensure_global_option country_profile "$$install_country"
ensure_global_option country_profile_schema '1'
ensure_global_option block_on_boot '0'
legacy_access_priority='emergency_sites no_restrictions blocklist allowlist global_block temp_access device_schedule group_schedule default_access'
previous_access_priority='blocklist admin_devices no_restrictions allowlist global_block temp_access device_schedule group_schedule default_access'
safe_access_priority='no_restrictions blocklist admin_devices allowlist global_block temp_access device_schedule group_schedule default_access'
current_access_priority="$$(uci -q get sheepfold.global.access_priority 2>/dev/null || true)"
# Меняем только прежний заводской порядок. Неизвестное пользовательское значение
# сохраняем для диагностики и будущей явной миграции, а не переписываем молча.
if [ "$$current_access_priority" = "$$legacy_access_priority" ] || [ "$$current_access_priority" = "$$previous_access_priority" ]; then
	uci -q set sheepfold.global.access_priority="$$safe_access_priority"
fi
ensure_global_option access_priority "$$safe_access_priority"
ensure_global_option schedule_conflict_internet 'off'
ensure_global_option lan_firewall_zones 'lan'
ensure_global_option integration_mode 'none'
ensure_global_option integration_mode_source 'default'
ensure_global_option integration_mode_user_set '0'
ensure_global_option router_ipv6_disabled '0'
ensure_global_option router_ipv6_mode_source 'default'
ensure_global_option site_filter_backend 'auto'
ensure_global_option adguard_auto_manage '1'
ensure_global_option adguard_health_interval_seconds '300'
ensure_global_option new_device_policy 'allow'
ensure_global_option auto_configure '1'
ensure_global_option detection_mode 'full'
ensure_global_option device_monitoring_mode 'automatic'
ensure_global_option no_restrictions_auto_assign '1'
ensure_global_option personal_devices_auto_assign '1'
# Старое значение UI приводим к контракту, который одинаково понимают LuCI,
# effective-status и firewall. §autoact1
[ "$$(uci -q get sheepfold.global.new_device_policy 2>/dev/null || true)" != 'restrict' ] || \
	uci -q set sheepfold.global.new_device_policy='restrict_until_configured'
automation_mode="$$(uci -q get sheepfold.global.automation_mode 2>/dev/null || true)"
if [ -z "$$automation_mode" ]; then
	if [ "$$(uci -q get sheepfold.global.new_device_policy 2>/dev/null || printf allow)" = 'allow' ] && \
	   [ "$$(uci -q get sheepfold.global.auto_configure 2>/dev/null || printf 1)" = '1' ] && \
	   [ "$$(uci -q get sheepfold.global.detection_mode 2>/dev/null || printf full)" = 'full' ] && \
	   [ "$$(uci -q get sheepfold.global.device_monitoring_mode 2>/dev/null || printf automatic)" = 'automatic' ] && \
	   [ "$$(uci -q get sheepfold.global.no_restrictions_auto_assign 2>/dev/null || printf 1)" = '1' ] && \
	   [ "$$(uci -q get sheepfold.global.personal_devices_auto_assign 2>/dev/null || printf 1)" = '1' ]; then
		automation_mode='maximum'
	else
		automation_mode='selective'
	fi
	uci -q set sheepfold.global.automation_mode="$$automation_mode"
fi
case "$$automation_mode" in
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
current_detector_interval="$$(uci -q get sheepfold.global.detector_interval_seconds 2>/dev/null || true)"
[ "$$current_detector_interval" != '900' ] || uci -q set sheepfold.global.detector_interval_seconds='86400'
ensure_global_option detector_interval_seconds '86400'
ensure_global_option detector_connection_delay_seconds '20'
ensure_global_option detector_offline_grace_seconds '90'
ensure_global_option detector_max_event_scans_per_tick '4'
ensure_global_option detector_min_device_type_confidence '70'
ensure_global_option detector_min_no_restrictions_confidence '80'
ensure_global_option detector_nmap_host_timeout_seconds '20'
current_full_rescan="$$(uci -q get sheepfold.global.detector_full_rescan_seconds 2>/dev/null || true)"
[ "$$current_full_rescan" != '21600' ] || uci -q set sheepfold.global.detector_full_rescan_seconds='86400'
ensure_global_option detector_full_rescan_seconds '86400'
ensure_global_option detector_low_confidence_retry_seconds '86400'
ensure_global_option detector_ssdp_rescan_seconds '3600'
ensure_global_option detector_wsd_rescan_seconds '3600'
ensure_global_option detector_max_upnp_fetches_per_scan '4'
ensure_global_option identity_quarantine_reminder_seconds '86400'
ensure_global_option service_control_interval_seconds '30'
ensure_global_option update_check_install_mode 'weekly'
ensure_global_option beta_testing '0'
ensure_global_option active_messenger 'none'
# SHEEPFOLD_AI_BEGIN
ensure_global_option ai_enabled '0'
ensure_global_option ai_provider 'none'
ensure_global_option ai_rate_limit_requests '20'
ensure_global_option ai_rate_limit_window_seconds '3600'
ensure_global_option ai_individual_logs '0'
ensure_global_option child_ai_parental_consent '0'
ensure_global_option child_ai_consent_version 'child-ai-v1'
ensure_global_option parent_ai_prompt_version 'v2'
ensure_global_option child_ai_prompt_version 'v1'
ensure_global_option deepseek_model 'deepseek-chat'
ensure_global_option deepseek_api_url 'https://api.deepseek.com/chat/completions'
ensure_global_option deepseek_api_key ''
ensure_global_option gemini_model 'gemini-2.5-flash'
ensure_global_option gemini_api_url 'https://generativelanguage.googleapis.com/v1beta/models'
ensure_global_option gemini_api_key ''
ensure_global_option grok_model 'grok-3-mini'
ensure_global_option grok_api_url 'https://api.x.ai/v1/chat/completions'
ensure_global_option grok_api_key ''
# SHEEPFOLD_AI_END
ensure_global_option vk_access_token ''
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
ensure_global_option router_time_configured '0'
ensure_global_option router_time_country_profile ''
ensure_global_option router_time_configured_at '0'
ensure_global_option wps_short_press_action 'router_default'
ensure_global_option wps_long_press_action 'router_default'
ensure_global_option router_led_control 'router_default'
ensure_global_option router_led_repair '0'
ensure_global_option blocked_page_enabled '1'
ensure_global_option blocked_page_text 'Интернет временно недоступен по семейным правилам. Если это ошибка, обратитесь к родителю.'
ensure_global_option blocked_page_port '5202'
ensure_global_option domain_allowlist_for_blocklist '1'
old_site_allowlist_sources='UT1 child | https://dsi.ut-capitole.fr/blacklists/index_en.php#child'
default_site_allowlist_sources='UT1 child | https://dsi.ut-capitole.fr/blacklists/download/child.tar.gz'
current_site_allowlist_sources="$$(uci -q get sheepfold.global.site_allowlist_sources 2>/dev/null || true)"
if [ -z "$$current_site_allowlist_sources" ] || [ "$$current_site_allowlist_sources" = "$$old_site_allowlist_sources" ]; then
	# Старый URL открывал страницу описания, а не сам список. Пользовательские значения не трогаем.
	uci -q set sheepfold.global.site_allowlist_sources="$$default_site_allowlist_sources"
fi
ensure_global_option site_blocklist_mode 'except_allowlist_admins'
old_site_blocklist_sources='UT1 adult, malware, phishing, gambling, games, vpn | https://dsi.ut-capitole.fr/blacklists/index_en.php; StevenBlack hosts gambling-porn | https://github.com/StevenBlack/hosts; HaGeZi Threat Intelligence Feeds | https://github.com/hagezi/dns-blocklists; URLhaus malware URLs | https://urlhaus.abuse.ch/api/'
default_site_blocklist_sources='HaGeZi NSFW | https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/nsfw.txt; HaGeZi Gambling mini | https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/gambling.mini.txt; HaGeZi Threat Intelligence mini | https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/tif.mini.txt; URLhaus malware domains | https://urlhaus.abuse.ch/downloads/hostfile/'
current_site_blocklist_sources="$$(uci -q get sheepfold.global.site_blocklist_sources 2>/dev/null || true)"
if [ -z "$$current_site_blocklist_sources" ] || [ "$$current_site_blocklist_sources" = "$$old_site_blocklist_sources" ]; then
	uci -q set sheepfold.global.site_blocklist_sources="$$default_site_blocklist_sources"
fi
ensure_global_option site_lists_update_interval 'weekly'
ensure_global_option sim_change_notifications 'new_only'
ensure_global_option child_wifi_network_notifications 'off'
# SHEEPFOLD_AI_BEGIN
ensure_global_option private_logs '0'
ensure_global_option log_days '7'
ensure_global_option log_max_dir_kb '0'
ensure_global_option log_max_device_kb '0'
# Один видимый opt-in управляет и разрешением AI, и фактическим локальным сборщиком.
if [ "$$(uci -q get sheepfold.global.ai_individual_logs 2>/dev/null)" = "1" ]; then
	uci -q set sheepfold.global.private_logs='1'
else
	uci -q set sheepfold.global.private_logs='0'
fi
# SHEEPFOLD_AI_END
if [ "$$(uci -q get sheepfold.global.domain_allowlist_for_blocklist_default_migrated 2>/dev/null)" != "1" ]; then
	uci -q set sheepfold.global.domain_allowlist_for_blocklist='1'
	uci -q set sheepfold.global.domain_allowlist_for_blocklist_default_migrated='1'
fi
ensure_global_option log_retention '3d'
ensure_global_option offline_device_retention_days '90'
ensure_global_option app_port '5201'
uci -q get sheepfold.home_network_global >/dev/null || uci -q set sheepfold.home_network_global='home_network'
[ -n "$$(uci -q get sheepfold.home_network_global.enabled)" ] || uci -q set sheepfold.home_network_global.enabled='0'
# fw4 выполняет include после сборки правил; helper не делает рекурсивный reload
uci -q set firewall.sheepfold_home_network='include'
uci -q set firewall.sheepfold_home_network.type='script'
uci -q set firewall.sheepfold_home_network.path='/usr/libexec/sheepfold/sheepfold-home-firewall'
uci -q set firewall.sheepfold_home_network.fw4_compatible='1'
uci commit firewall
ensure_global_option pairing_diagnostics '0'
ensure_global_option feedback_endpoint ''
ensure_global_option feedback_install_id ''
ensure_global_option support_report_endpoint ''
ensure_global_option support_report_recipient_key_id ''
ensure_global_option support_report_recipient_public_keyset ''
ensure_global_option support_report_discovery_public_key ''
ensure_router_install_id() {
	install_id="$$(uci -q get sheepfold.global.router_install_id 2>/dev/null || true)"
	if printf '%s\n' "$$install_id" | grep -Eq '^[a-f0-9]{32,64}$$'; then
		return 0
	fi
	install_id="$$(openssl rand -hex 16 2>/dev/null || true)"
	if ! printf '%s\n' "$$install_id" | grep -Eq '^[a-f0-9]{32}$$'; then
		install_id="$$(dd if=/dev/urandom bs=32 count=1 2>/dev/null | sha256sum 2>/dev/null | awk '{ print $$1 }')"
	fi
	printf '%s\n' "$$install_id" | grep -Eq '^[a-f0-9]{32,64}$$' || return 1
	uci -q set sheepfold.global.router_install_id="$$install_id"
}
# ID не является паролем: он позволяет отличить восстановление на этом же
# роутере от переноса, где старые HMAC-отпечатки использовать нельзя. §cfgbak1
ensure_router_install_id || {
	echo 'Could not create Sheepfold router installation id.' >&2
	exit 1
}
uci -q delete sheepfold.global.app_https_port 2>/dev/null || true
ensure_global_option log_storage 'ram'
ensure_global_option log_cache_path '/tmp/sheepfold/events.log'
uci -q get sheepfold.pairing_global >/dev/null || uci -q set sheepfold.pairing_global='pairing'
ensure_pairing_option() {
	option="$$1"
	value="$$2"
	[ -n "$$(uci -q get sheepfold.pairing_global.$$option 2>/dev/null)" ] || uci -q set sheepfold.pairing_global.$$option="$$value"
}
ensure_pairing_option max_attempts '10'
ensure_pairing_option attempt_window_seconds '600'
ensure_named_section() {
	name="$$1"
	type="$$2"
	uci -q get "sheepfold.$$name" >/dev/null 2>&1 || uci -q set "sheepfold.$$name=$$type"
}
ensure_named_section allowlist list
ensure_named_section blocklist list
ensure_named_section domain_allowlist list
add_emergency_site() {
	section="$$1"
	domain="$$2"
	name="$$3"
	description="$$4"
	order="$$5"
	source="$${6:-}"
	profile_country="$${7:-}"
	profile_id="$${8:-}"
	uci -q set "sheepfold.$$section=emergency_site"
	uci -q set "sheepfold.$$section.domain=$$domain"
	uci -q set "sheepfold.$$section.name=$$name"
	uci -q set "sheepfold.$$section.description=$$description"
	uci -q set "sheepfold.$$section.enabled=1"
	uci -q set "sheepfold.$$section.order=$$order"
	if [ "$$source" = country_profile ]; then
		uci -q set "sheepfold.$$section.source=$$source"
		uci -q set "sheepfold.$$section.profile_country=$$profile_country"
		uci -q set "sheepfold.$$section.profile_id=$$profile_id"
	fi
}
if [ "$$(uci -q get sheepfold.global.emergency_sites_initialized 2>/dev/null || printf 0)" != 1 ] && \
		! uci -q show sheepfold 2>/dev/null | grep -q '=emergency_site$$'; then
	legacy_order=0
	for legacy_domain in $$(uci -q get sheepfold.domain_allowlist.domain 2>/dev/null || true); do
		printf '%s' "$$legacy_domain" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$$' || continue
		legacy_order=$$((legacy_order + 1))
		add_emergency_site "emergency_legacy_$$legacy_order" "$$legacy_domain" "$$legacy_domain" '' "$$legacy_order"
	done
	if [ "$$legacy_order" = 0 ]; then
		# Стартовый набор создаём только при отсутствии пользовательских записей.
		# Обновление пакета не должно возвращать удалённые родителем домены. §emerg1
		add_emergency_site emergency_gosuslugi_ru gosuslugi.ru 'Госуслуги' 'Государственные услуги' 1 country_profile ru gosuslugi
		add_emergency_site emergency_esia_gosuslugi_ru esia.gosuslugi.ru 'ЕСИА' 'Вход в государственную учётную запись' 2 country_profile ru esia
		add_emergency_site emergency_mos_ru mos.ru 'Услуги Москвы' 'Городские сервисы' 3 country_profile ru mos
		add_emergency_site emergency_school_mos_ru school.mos.ru 'Московская школа' 'Доступ к школе' 4 country_profile ru school_mos
		add_emergency_site emergency_dnevnik_ru dnevnik.ru 'Дневник.ру' 'Школьный дневник' 5 country_profile ru dnevnik
		add_emergency_site emergency_2gis_ru 2gis.ru '2ГИС' 'Карты и организации' 6 country_profile ru 2gis
		add_emergency_site emergency_mchs_ru mchs.gov.ru 'МЧС России' 'Официальная информация о чрезвычайных ситуациях и безопасности.' 7 country_profile ru mchs
		add_emergency_site emergency_mchs_psychology_ru psi.mchs.gov.ru 'Экстренная психологическая помощь МЧС' 'Информация и контакты психологической помощи в кризисной ситуации.' 8 country_profile ru mchs_psychology
		add_emergency_site emergency_minzdrav_ru minzdrav.gov.ru 'Минздрав России' 'Официальная информация здравоохранения.' 9 country_profile ru minzdrav
		add_emergency_site emergency_rzd_ru rzd.ru 'Российские железные дороги' 'Расписание поездов и информация о железнодорожных поездках.' 10 country_profile ru rzd
	fi
fi
uci -q set sheepfold.global.emergency_sites_initialized='1'
ensure_named_section adguard integration
ensure_named_section podkop integration
ensure_adguard_option() {
	option="$$1"
	value="$$2"
	[ -n "$$(uci -q get sheepfold.adguard.$$option 2>/dev/null)" ] || uci -q set sheepfold.adguard.$$option="$$value"
}
ensure_adguard_option enabled '0'
ensure_adguard_option url 'http://127.0.0.1:3000'
ensure_adguard_option username ''
ensure_adguard_option password ''
ensure_named_section messenger_global messenger
ensure_named_section export_global export
ensure_named_section wifi_control_global wifi_control
ensure_named_section usb usb
ensure_named_section cloud yandex_disk
ensure_yandex_option() {
	option="$$1"
	value="$$2"
	[ -n "$$(uci -q get sheepfold.cloud.$$option 2>/dev/null)" ] || uci -q set sheepfold.cloud.$$option="$$value"
}
ensure_yandex_option login ''
ensure_yandex_option password ''
ensure_yandex_option root_folder '/sheepfold'
ensure_yandex_option quota_mb '500'
ensure_yandex_option authorized '0'
ensure_named_section gdrive google_drive
ensure_gdrive_option() {
	option="$$1"
	value="$$2"
	[ -n "$$(uci -q get sheepfold.gdrive.$$option 2>/dev/null)" ] || uci -q set sheepfold.gdrive.$$option="$$value"
}
ensure_gdrive_option client_id ''
ensure_gdrive_option client_secret ''
ensure_gdrive_option refresh_token ''
ensure_gdrive_option root_folder '/sheepfold'
ensure_gdrive_option quota_mb '500'
ensure_gdrive_option authorized '0'
uci -q get sheepfold.owner >/dev/null || uci -q set sheepfold.owner=administrator
[ -n "$$(uci -q get sheepfold.owner.id 2>/dev/null)" ] || uci -q set sheepfold.owner.id='1'
[ -n "$$(uci -q get sheepfold.owner.login 2>/dev/null)" ] || uci -q set sheepfold.owner.login='SuperParent'
[ -n "$$(uci -q get sheepfold.owner.role 2>/dev/null)" ] || uci -q set sheepfold.owner.role='owner'
[ -n "$$(uci -q get sheepfold.owner.password_setup_required 2>/dev/null)" ] || uci -q set sheepfold.owner.password_setup_required='1'
[ -n "$$(uci -q get sheepfold.owner.allow_child_access_requests 2>/dev/null)" ] || uci -q set sheepfold.owner.allow_child_access_requests='0'
for section in $$(uci -q show sheepfold 2>/dev/null | sed -n 's/^sheepfold\.\([^.=]*\)=administrator$$/\1/p'); do
	[ -n "$$(uci -q get sheepfold.$$section.allow_child_access_requests 2>/dev/null)" ] || uci -q set sheepfold.$$section.allow_child_access_requests='0'
done
# Администраторы используют ту же понятную числовую схему ID, что и устройства.
used_admin_ids=' 1 '
next_admin_id=2
for section in $$(uci -q show sheepfold 2>/dev/null | sed -n 's/^sheepfold\.\([^.=]*\)=administrator$$/\1/p'); do
	[ "$$section" = owner ] && continue
	current="$$(uci -q get sheepfold.$$section.id 2>/dev/null || true)"
	current="$$(printf '%s' "$$current" | sed 's/[^0-9][^0-9]*/ /g' | awk '{print $$NF}' | sed 's/^0*//')"
	case "$$current" in ''|*[!0-9]*|0) current='' ;; esac
	case "$$used_admin_ids" in *" $$current "*) current='' ;; esac
	if [ -z "$$current" ]; then
		while case "$$used_admin_ids" in *" $$next_admin_id "*) true ;; *) false ;; esac; do next_admin_id=$$((next_admin_id + 1)); done
		current="$$next_admin_id"
	fi
	uci -q set sheepfold.$$section.id="$$current"
	used_admin_ids="$$used_admin_ids$$current "
	[ "$$next_admin_id" -gt "$$current" ] || next_admin_id=$$((current + 1))
done
[ -x /usr/libexec/sheepfold/sheepfold-default-groups ] && /usr/libexec/sheepfold/sheepfold-default-groups apply
[ -x /usr/libexec/sheepfold/sheepfold-device-id ] && /usr/libexec/sheepfold/sheepfold-device-id migrate
migrate_group_schedule_links() {
	for group_section in $$(uci -q show sheepfold 2>/dev/null | sed -n 's/^sheepfold\.\([^.=]*\)=group$$/\1/p'); do
		group_name="$$(uci -q get "sheepfold.$$group_section.name" 2>/dev/null || true)"
		legacy_schedules="$$(uci -q get "sheepfold.$$group_section.schedules" 2>/dev/null || true)"
		for schedule_section in $$(uci -q show sheepfold 2>/dev/null | sed -n 's/^sheepfold\.\([^.=]*\)=schedule$$/\1/p'); do
			target_type="$$(uci -q get "sheepfold.$$schedule_section.target_type" 2>/dev/null || printf group)"
			[ "$$target_type" = group ] || continue
			linked=0
			if uci -q del_list "sheepfold.$$schedule_section.targets=$$group_section" 2>/dev/null; then
				linked=1
			fi
			if [ -n "$$group_name" ] && uci -q del_list "sheepfold.$$schedule_section.targets=$$group_name" 2>/dev/null; then
				linked=1
			fi
			for legacy_schedule in $$legacy_schedules; do
				[ "$$legacy_schedule" != "$$schedule_section" ] || linked=1
			done
			[ "$$linked" != 1 ] || uci -q add_list "sheepfold.$$schedule_section.targets=$$group_section"
		done
		# Единственный источник связи — targets самого расписания. Повторный
		# postinst остаётся безопасным и не создаёт дубликаты. §grpsch1
		uci -q delete "sheepfold.$$group_section.schedules" 2>/dev/null || true
	done
}
migrate_group_schedule_links
if [ "$$(uci -q get sheepfold.global.luci_language_synced 2>/dev/null)" != "1" ]; then
	lang="$$(uci -q get sheepfold.global.language 2>/dev/null || printf ru)"
	case "$$lang" in
		en|ru|zh_Hans) ;;
		*) lang=ru ;;
esac
	uci -q get luci.main >/dev/null 2>&1 || uci -q set luci.main=core
	uci -q set luci.main.lang="$$lang"
	uci -q set sheepfold.global.luci_language_synced='1'
	uci -q commit luci 2>/dev/null || true
fi
log_cache_path="$$(uci -q get sheepfold.global.log_cache_path 2>/dev/null || printf '%s' /tmp/sheepfold/events.log)"
case "$$log_cache_path" in
	/tmp/sheepfold/*) ;;
	*) log_cache_path='/tmp/sheepfold/events.log' ;;
esac
mkdir -p "$${log_cache_path%/*}"
touch "$$log_cache_path"
chmod 600 "$$log_cache_path"
package_manager_helper='/usr/libexec/sheepfold/sheepfold-package-manager'
[ ! -r "$$package_manager_helper" ] || . "$$package_manager_helper"
detect_installed() {
	pkg="$$1"
	init="$$2"
	config="$$3"
	if command -v sheepfold_package_is_installed >/dev/null 2>&1 &&
	   sheepfold_package_is_installed "$$pkg"; then
		return 0
	fi
	[ -n "$$init" ] && [ -x "/etc/init.d/$$init" ] && return 0
	[ -n "$$config" ] && [ -f "/etc/config/$$config" ] && return 0
	return 1
}
detect_installed AdGuardHome AdGuardHome AdGuardHome || detect_installed adguardhome adguardhome adguardhome
has_adguard="$$?"
detect_installed podkop podkop podkop
has_podkop="$$?"
if [ "$$(uci -q get sheepfold.global.integration_mode_user_set 2>/dev/null)" != "1" ]; then
	if [ "$$has_adguard" = "0" ] && [ "$$has_podkop" = "0" ]; then
		uci -q set sheepfold.global.integration_mode='adguard_podkop'
	elif [ "$$has_adguard" = "0" ]; then
		uci -q set sheepfold.global.integration_mode='adguard'
	elif [ "$$has_podkop" = "0" ]; then
		uci -q set sheepfold.global.integration_mode='podkop'
	else
		uci -q set sheepfold.global.integration_mode='none'
	fi
	uci -q set sheepfold.global.integration_mode_source='auto'
	uci -q set sheepfold.global.adguard_integration="$$([ "$$has_adguard" = "0" ] && printf 1 || printf 0)"
	uci -q set sheepfold.global.podkop_compatibility="$$([ "$$has_podkop" = "0" ] && printf 1 || printf 0)"
fi
current_integration="$$(uci -q get sheepfold.global.integration_mode 2>/dev/null || printf none)"
ipv6_source="$$(uci -q get sheepfold.global.router_ipv6_mode_source 2>/dev/null || printf default)"
case "$$current_integration" in
	podkop|adguard_podkop)
		if [ "$$(uci -q get sheepfold.global.router_ipv6_disabled 2>/dev/null || printf 0)" != "1" ]; then
			uci -q set sheepfold.global.router_ipv6_disabled='1'
			uci -q set sheepfold.global.router_ipv6_mode_source='auto_podkop'
		elif [ "$$ipv6_source" = 'default' ]; then
			uci -q set sheepfold.global.router_ipv6_mode_source='auto_podkop'
		fi
		;;
	*)
		if [ "$$ipv6_source" = 'auto_podkop' ]; then
			uci -q set sheepfold.global.router_ipv6_disabled='0'
			uci -q set sheepfold.global.router_ipv6_mode_source='default'
		fi
		;;
esac
uci -q set sheepfold.global.product_variant='$(SHEEPFOLD_PRODUCT_VARIANT)'
uci -q set sheepfold.global.ui_asset_version='$(SHEEPFOLD_UI_ASSET_VERSION)'
uci -q commit sheepfold
[ -x /usr/libexec/sheepfold/sheepfold-country-profile ] && \
	/usr/libexec/sheepfold/sheepfold-country-profile migrate >/dev/null 2>&1 || true
find /usr/libexec/sheepfold -type f -exec chmod 0755 {} + 2>/dev/null || true
# Общие библиотеки только подключаются через точку и не являются самостоятельными командами.
for library in \
	/usr/libexec/sheepfold/sheepfold-pair-common \
	/usr/libexec/sheepfold/sheepfold-token-common \
	/usr/libexec/sheepfold/sheepfold-hash-common \
	/usr/libexec/sheepfold/sheepfold-lock-common \
	/usr/libexec/sheepfold/sheepfold-log-common \
	/usr/libexec/sheepfold/sheepfold-lib-form \
	/usr/libexec/sheepfold/sheepfold-lib-access-policy \
	/usr/libexec/sheepfold/sheepfold-lib-admin-config-common \
	/usr/libexec/sheepfold/sheepfold-lib-admin-config-devices \
	/usr/libexec/sheepfold/sheepfold-lib-admin-config-groups \
	/usr/libexec/sheepfold/sheepfold-lib-admin-config-model \
	/usr/libexec/sheepfold/sheepfold-lib-admin-config-notifications \
	/usr/libexec/sheepfold/sheepfold-lib-admin-config-schedules \
	/usr/libexec/sheepfold/sheepfold-lib-admin-config-wifi \
	/usr/libexec/sheepfold/sheepfold-lib-json; do
	[ -f "$$library" ] && chmod 0644 "$$library" 2>/dev/null || true
done
[ -x /usr/libexec/sheepfold/sheepfold-ipv6-control ] && \
	/usr/libexec/sheepfold/sheepfold-ipv6-control apply >/dev/null 2>&1 || true
for helper in \
	/etc/hotplug.d/dhcp/90-sheepfold-device-signals \
	/etc/hotplug.d/iface/90-sheepfold-home-network \
	/www/.well-known/sheepfold.json.sh \
	/www/cgi-bin/sheepfold-api \
	/www/cgi-bin/sheepfold-blocked \
	/www/cgi-bin/sheepfold-adguard-list; do
	[ -e "$$helper" ] && chmod 0755 "$$helper" 2>/dev/null || true
done
# SHEEPFOLD_AI_BEGIN
if [ "$$(uci -q get sheepfold.global.ai_individual_logs 2>/dev/null)" = "1" ]; then
	/usr/libexec/sheepfold/sheepfold-openssl-ensure >/dev/null 2>&1 || true
fi
# SHEEPFOLD_AI_END
/www/.well-known/sheepfold.json.sh || exit 1
install_sheepfold_cron() {
	cron_file='/etc/crontabs/root'
	mkdir -p /etc/crontabs
	tmp="$$cron_file.sheepfold.tmp"
	if [ -f "$$cron_file" ]; then
		awk '
		/^# BEGIN SHEEPFOLD MANAGED JOBS$$/ { skip=1; next }
		/^# END SHEEPFOLD MANAGED JOBS$$/   { skip=0; next }
		!skip { print }
		' "$$cron_file" > "$$tmp"
	else
		: > "$$tmp"
	fi
	cat >> "$$tmp" <<'EOF'
# BEGIN SHEEPFOLD MANAGED JOBS
* * * * * /usr/libexec/sheepfold/sheepfold-firewall sync >/dev/null 2>&1
# SHEEPFOLD_AI_BEGIN
5 2 * * * /usr/libexec/sheepfold/sheepfold-maintenance-window && /usr/libexec/sheepfold/sheepfold-activity-log rotate >/dev/null 2>&1
55 4 * * * /usr/libexec/sheepfold/sheepfold-activity-log rotate >/dev/null 2>&1
# SHEEPFOLD_AI_END
10 2 * * * /usr/libexec/sheepfold/sheepfold-maintenance-window && /usr/libexec/sheepfold/sheepfold-log-storage archive-push >/dev/null 2>&1
0 5 * * * /usr/libexec/sheepfold/sheepfold-log-storage archive-push >/dev/null 2>&1
# END SHEEPFOLD MANAGED JOBS
EOF
	chmod 600 "$$tmp"
	mv -f "$$tmp" "$$cron_file"
	[ -x /etc/init.d/cron ] && /etc/init.d/cron restart >/dev/null 2>&1 || true
}
install_sheepfold_cron
rm -f /var/luci-indexcache* 2>/dev/null || true
rm -f /tmp/luci-indexcache* 2>/dev/null || true
rm -f /tmp/luci-modulecache/* 2>/dev/null || true
[ -x /etc/init.d/rpcd ] && /etc/init.d/rpcd reload || true
[ -x /etc/init.d/sheepfold ] && /etc/init.d/sheepfold enable || true
cleanup_install_marker
trap - 0 1 2 3 15
[ -x /etc/init.d/sheepfold ] && /etc/init.d/sheepfold restart || true
cleanup_opkg_conffile_artifacts
cleanup_stale_update_artifacts
exit 0
endef

define Package/$(PKG_NAME)/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
[ -x /usr/libexec/sheepfold/sheepfold-home-network ] && \
	/usr/libexec/sheepfold/sheepfold-home-network stop >/dev/null 2>&1 || true
uci -q delete firewall.sheepfold_home_network || true
uci commit firewall
[ -x /usr/libexec/sheepfold/sheepfold-site-lists ] && \
	/usr/libexec/sheepfold/sheepfold-site-lists cron-remove >/dev/null 2>&1 || true
[ -x /usr/libexec/sheepfold/sheepfold-domain-policy ] && \
	/usr/libexec/sheepfold/sheepfold-domain-policy clear >/dev/null 2>&1 || true
# При обновлении новый postinst сразу применит настройку заново, поэтому не создаём
# короткое окно с неожиданно включённым IPv6. При удалении возвращаем исходное состояние.
if [ "$${1:-remove}" != upgrade ] && [ -x /usr/libexec/sheepfold/sheepfold-ipv6-control ]; then
	if ! /usr/libexec/sheepfold/sheepfold-ipv6-control release >/dev/null 2>&1; then
		logger -t sheepfold 'Не удалось восстановить прежнее состояние IPv6 при удалении пакета.'
		echo 'Sheepfold: не удалось восстановить прежнее состояние IPv6; проверьте системный журнал.' >&2
	fi
fi
# До удаления исполняемых файлов очищаем только собственные наборы Sheepfold.
# Чужие таблицы, правила и packet marks, включая Podkop, не изменяются. §v7x2k9p
[ -x /usr/libexec/sheepfold/sheepfold-firewall ] && \
	/usr/libexec/sheepfold/sheepfold-firewall clear >/dev/null 2>&1 || true
cron_file='/etc/crontabs/root'
if [ -f "$$cron_file" ]; then
	tmp="$$cron_file.sheepfold.tmp"
	awk '
		/^# BEGIN SHEEPFOLD MANAGED JOBS$$/ { skip=1; next }
		/^# END SHEEPFOLD MANAGED JOBS$$/   { skip=0; next }
		!skip { print }
		' "$$cron_file" > "$$tmp" && {
		chmod 600 "$$tmp"
		mv -f "$$tmp" "$$cron_file"
	}
fi
[ -x /etc/init.d/cron ] && /etc/init.d/cron restart >/dev/null 2>&1 || true
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWRT buildroot signature
