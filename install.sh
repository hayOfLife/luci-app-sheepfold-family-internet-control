#!/bin/sh
set -eu

OWNER="hayOfLife"
REPO="luci-app-sheepfold-family-internet-control"
INSTALLED_PACKAGE="luci-app-sheepfold-family-internet-control"
LEGACY_AI_PACKAGE="luci-app-sheepfold-ai-support"
ASSET_PACKAGE="luci-app-sheepfold-family-internet-control"
AGREEMENT_URL="https://github.com/${OWNER}/${REPO}/blob/main/docs/user-agreement.ru.md"
RELEASE_API="https://api.github.com/repos/${OWNER}/${REPO}/releases/latest"
INSTALL_DIR="/tmp/sheepfold-install"
PACKAGE_FILE=''
PACKAGE_MANAGER_HELPER="/usr/libexec/sheepfold/sheepfold-package-manager"

echo "Sheepfold Family Internet Control installer"
echo "Repository: ${OWNER}/${REPO}"

if [ ! -r /etc/openwrt_release ]; then
    echo "ERROR: This installer must be run on OpenWRT." >&2
    exit 1
fi

. /etc/openwrt_release

echo "Detected OpenWRT: ${DISTRIB_DESCRIPTION:-unknown}"

# Повторный запуск установщика не должен молча возвращать настройки к заводским:
# Enter означает «оставить текущее значение», а при первой установке берётся default.
DEFAULT_APP_LANGUAGE="$(uci -q get sheepfold.global.language 2>/dev/null || printf ru)"
case "$DEFAULT_APP_LANGUAGE" in
    ru|en|zh_Hans) ;;
    *) DEFAULT_APP_LANGUAGE='ru' ;;
esac
echo ""
echo "Choose application language / Выберите язык приложения:"
echo "  Русский: ru"
echo "  English: en"
echo "  简体中文: zh_Hans"
printf "Language [%s]: " "$DEFAULT_APP_LANGUAGE"
if ! read -r APP_LANGUAGE; then
    APP_LANGUAGE=""
fi

case "${APP_LANGUAGE}" in
    "")
        APP_LANGUAGE="$DEFAULT_APP_LANGUAGE"
        ;;
    ru|RU|Ru)
        APP_LANGUAGE="ru"
        ;;
    en|EN|En)
        APP_LANGUAGE="en"
        ;;
    zh_Hans|zh_hans|zh|ZH)
        APP_LANGUAGE="zh_Hans"
        ;;
    *)
        echo "Unknown language. Keeping ${DEFAULT_APP_LANGUAGE} / Неизвестный язык. Сохраняется ${DEFAULT_APP_LANGUAGE}." >&2
        APP_LANGUAGE="$DEFAULT_APP_LANGUAGE"
        ;;
esac

DEFAULT_COUNTRY="$(uci -q get sheepfold.global.country_profile 2>/dev/null || printf ru)"
case "$DEFAULT_COUNTRY" in ru|by|cn|other) ;; *) DEFAULT_COUNTRY='ru' ;; esac
echo ""
echo "Choose router country / Выберите страну нахождения роутера:"
echo "  Россия: ru"
echo "  Беларусь: by"
echo "  中国 / China: cn"
echo "  Другая страна / Other country: other"
printf "Country [%s]: " "$DEFAULT_COUNTRY"
if ! read -r ROUTER_COUNTRY; then
    ROUTER_COUNTRY=""
fi

case "${ROUTER_COUNTRY}" in
    "") ROUTER_COUNTRY="$DEFAULT_COUNTRY" ;;
    ru|RU|Ru) ROUTER_COUNTRY='ru' ;;
    by|BY|By) ROUTER_COUNTRY='by' ;;
    cn|CN|Cn) ROUTER_COUNTRY='cn' ;;
    other|OTHER|Other) ROUTER_COUNTRY='other' ;;
    *)
        echo "Unknown country profile. Installation cancelled / Неизвестный профиль страны." >&2
        exit 1
        ;;
esac

echo ""
echo "Choose Sheepfold product / Выберите вариант Sheepfold:"
echo "  1: Sheepfold (without AI / без ИИ)"
echo "  2: Sheepfold - AI Support"
# Особенно важно сохранить AI Support: выбор Standard по пустому ответу фактически
# заменил бы редакцию пакета, хотя пользователь ожидает обычное обновление.
DEFAULT_PRODUCT_VARIANT="$(uci -q get sheepfold.global.product_variant 2>/dev/null || true)"
if [ -z "$DEFAULT_PRODUCT_VARIANT" ]; then
    if [ -x /usr/libexec/sheepfold/sheepfold-ai-handler ] ||
        { command -v opkg >/dev/null 2>&1 && opkg status "$LEGACY_AI_PACKAGE" >/dev/null 2>&1; } ||
        { command -v apk >/dev/null 2>&1 && apk info -e "$LEGACY_AI_PACKAGE" >/dev/null 2>&1; }; then
        DEFAULT_PRODUCT_VARIANT='sheepfoldAi'
    fi
fi
case "$DEFAULT_PRODUCT_VARIANT" in
    sheepfoldAi) DEFAULT_PRODUCT_CHOICE='2' ;;
    *) DEFAULT_PRODUCT_CHOICE='1' ;;
esac
printf "Product [%s]: " "$DEFAULT_PRODUCT_CHOICE"
if ! read -r PRODUCT_CHOICE; then
    PRODUCT_CHOICE=""
fi

[ -n "$PRODUCT_CHOICE" ] || PRODUCT_CHOICE="$DEFAULT_PRODUCT_CHOICE"

case "${PRODUCT_CHOICE}" in
    1|sheepfold)
        PRODUCT_VARIANT="sheepfold"
        ASSET_PACKAGE="luci-app-sheepfold-family-internet-control"
        ;;
    2|sheepfoldAi|ai|AI)
        PRODUCT_VARIANT="sheepfoldAi"
        ASSET_PACKAGE="luci-app-sheepfold-ai-support"
        ;;
    *)
        echo "Installation cancelled: unknown Sheepfold product." >&2
        exit 1
        ;;
esac
echo "Release artifact: ${ASSET_PACKAGE}"

# При первой установке общий адаптер ещё не лежит на роутере. Этот bootstrap
# повторяет только минимальный публичный контракт, нужный для установки самого
# пакета; все дальнейшие операции выполняет установленный единый адаптер.
if [ -r "$PACKAGE_MANAGER_HELPER" ]; then
    . "$PACKAGE_MANAGER_HELPER"
else
    sheepfold_package_manager() {
        if command -v opkg >/dev/null 2>&1; then
            printf '%s\n' opkg
        elif command -v apk >/dev/null 2>&1; then
            printf '%s\n' apk
        else
            return 127
        fi
    }

    sheepfold_package_is_installed() {
        bootstrap_manager="$(sheepfold_package_manager)" || return $?
        case "$bootstrap_manager" in
            opkg) opkg status "$1" >/dev/null 2>&1 ;;
            apk) apk info -e "$1" >/dev/null 2>&1 ;;
        esac
    }

    sheepfold_package_version() {
        bootstrap_name="$1"
        bootstrap_manager="$(sheepfold_package_manager)" || return $?
        case "$bootstrap_manager" in
            opkg)
                opkg status "$bootstrap_name" 2>/dev/null |
                    sed -n 's/^Version: //p' |
                    sed -n '1p'
                ;;
            apk)
                apk info -e "$bootstrap_name" >/dev/null 2>&1 || return 1
                apk info --from installed --fields version --format json "$bootstrap_name" 2>/dev/null |
                    sed -n 's/^[[:space:]]*"version": "\([^"]*\)".*/\1/p' |
                    sed -n '1p'
                ;;
        esac
    }

    sheepfold_package_install_file() {
        bootstrap_file="${1:-}"
        bootstrap_force="${2:-0}"
        [ -n "$bootstrap_file" ] && [ -f "$bootstrap_file" ] || return 2
        bootstrap_manager="$(sheepfold_package_manager)" || return $?
        case "$bootstrap_manager" in
            opkg)
                if [ "$bootstrap_force" = 1 ]; then
                    opkg --force-reinstall install "$bootstrap_file"
                else
                    opkg install "$bootstrap_file"
                fi
                ;;
            apk)
                if [ "$bootstrap_force" = 1 ]; then
                    apk add --allow-untrusted --force-reinstall "$bootstrap_file"
                else
                    apk add --allow-untrusted "$bootstrap_file"
                fi
                ;;
        esac
    }
fi

if ! PACKAGE_MANAGER="$(sheepfold_package_manager)"; then
    echo "ERROR: OpenWrt package manager was not found (opkg or apk)." >&2
    exit 1
fi

case "$PACKAGE_MANAGER" in
    opkg) PACKAGE_EXTENSION='ipk' ;;
    apk) PACKAGE_EXTENSION='apk' ;;
    *)
        echo "ERROR: Unsupported OpenWrt package manager: ${PACKAGE_MANAGER}." >&2
        exit 1
        ;;
esac
PACKAGE_FILE="${INSTALL_DIR}/${ASSET_PACKAGE}.${PACKAGE_EXTENSION}"
echo "Package manager: ${PACKAGE_MANAGER}"

echo ""
echo "Before installation, read the user agreement and data processing consent:"
echo "${AGREEMENT_URL}"
echo ""
echo "By continuing, you confirm that you accept the agreement and are responsible for lawful use of Sheepfold."
printf "Type yes, y, or да to continue: "
if ! read -r AGREEMENT_ACCEPTED; then
    echo "Installation cancelled: agreement was not accepted." >&2
    exit 1
fi

case "${AGREEMENT_ACCEPTED}" in
    yes|YES|Yes|y|Y|да|Да|ДА)
        echo "Agreement accepted."
        ;;
    *)
        echo "Installation cancelled: agreement was not accepted." >&2
        exit 1
        ;;
esac

echo ""
echo "Choose Sheepfold automation mode:"
echo "If enabled, Sheepfold may automatically configure safe defaults and put confidently detected home infrastructure devices"
echo "such as NAS, Home Assistant, AdGuard Home, Proxmox, video recorders, and smart-home hubs into the No restrictions group."
echo "The blocklist will still override this group."
AUTO_CONFIGURE="$(uci -q get sheepfold.global.auto_configure 2>/dev/null || printf 1)"
DETECTION_MODE="$(uci -q get sheepfold.global.detection_mode 2>/dev/null || printf full)"
NO_RESTRICTIONS_AUTO_ASSIGN="$(uci -q get sheepfold.global.no_restrictions_auto_assign 2>/dev/null || printf 1)"
PERSONAL_DEVICES_AUTO_ASSIGN="$(uci -q get sheepfold.global.personal_devices_auto_assign 2>/dev/null || printf 1)"
NEW_DEVICE_POLICY="$(uci -q get sheepfold.global.new_device_policy 2>/dev/null || printf allow)"
DEVICE_MONITORING_MODE="$(uci -q get sheepfold.global.device_monitoring_mode 2>/dev/null || printf automatic)"
case "$AUTO_CONFIGURE" in 0|1) ;; *) AUTO_CONFIGURE=1 ;; esac
case "$DETECTION_MODE" in full|reduced) ;; *) DETECTION_MODE='full' ;; esac
case "$NO_RESTRICTIONS_AUTO_ASSIGN" in 0|1) ;; *) NO_RESTRICTIONS_AUTO_ASSIGN=1 ;; esac
case "$PERSONAL_DEVICES_AUTO_ASSIGN" in 0|1) ;; *) PERSONAL_DEVICES_AUTO_ASSIGN=1 ;; esac
# Старые релизы писали короткое `restrict`. Нормализуем его до вычисления
# automation_mode, иначе обновление ошибочно сочтёт профиль максимальным.
case "$NEW_DEVICE_POLICY" in
    restrict) NEW_DEVICE_POLICY='restrict_until_configured' ;;
    allow|restrict_until_configured) ;;
    *) NEW_DEVICE_POLICY='allow' ;;
esac
case "$DEVICE_MONITORING_MODE" in automatic|manual) ;; *) DEVICE_MONITORING_MODE='automatic' ;; esac

automation_profile_matches_maximum() {
    [ "$AUTO_CONFIGURE" = 1 ] &&
        [ "$DETECTION_MODE" = full ] &&
        [ "$NO_RESTRICTIONS_AUTO_ASSIGN" = 1 ] &&
        [ "$PERSONAL_DEVICES_AUTO_ASSIGN" = 1 ] &&
        [ "$NEW_DEVICE_POLICY" = allow ] &&
        [ "$DEVICE_MONITORING_MODE" = automatic ]
}

# В старых конфигурациях главного поля ещё нет. Восстанавливаем его по реальным
# подчинённым значениям, иначе Enter при обновлении затрёт ручной выбор родителя.
DEFAULT_AUTOMATION_MODE="$(uci -q get sheepfold.global.automation_mode 2>/dev/null || true)"
case "$DEFAULT_AUTOMATION_MODE" in
    maximum|selective) ;;
    "")
        if automation_profile_matches_maximum; then
            DEFAULT_AUTOMATION_MODE='maximum'
        else
            DEFAULT_AUTOMATION_MODE='selective'
        fi
        ;;
    *) DEFAULT_AUTOMATION_MODE='selective' ;;
esac
printf "Automation [%s] (maximum/selective; yes/no and да/нет are accepted): " "$DEFAULT_AUTOMATION_MODE"
if ! read -r AUTO_CONFIGURE_ACCEPTED; then
    AUTO_CONFIGURE_ACCEPTED=""
fi

[ -n "$AUTO_CONFIGURE_ACCEPTED" ] || AUTO_CONFIGURE_ACCEPTED="$DEFAULT_AUTOMATION_MODE"
case "${AUTO_CONFIGURE_ACCEPTED}" in
    maximum|MAXIMUM|Maximum|yes|YES|Yes|y|Y|да|Да|ДА)
        AUTO_CONFIGURE=1
        DETECTION_MODE="full"
        NO_RESTRICTIONS_AUTO_ASSIGN=1
        PERSONAL_DEVICES_AUTO_ASSIGN=1
        AUTOMATION_MODE="maximum"
        NEW_DEVICE_POLICY="allow"
        DEVICE_MONITORING_MODE="automatic"
        echo "Maximum automation enabled."
        ;;
    selective|SELECTIVE|Selective|no|NO|No|n|N|нет|Нет|НЕТ)
        AUTOMATION_MODE="selective"
        echo "Selective automation enabled. Existing subordinate choices are preserved and can be changed in LuCI."
        ;;
    *)
        echo "Installation cancelled: automatic setup answer was not understood." >&2
        exit 1
        ;;
esac

package_installed() {
    sheepfold_package_is_installed "$1"
}

service_exists() {
    [ -x "/etc/init.d/$1" ]
}

ADGUARD_DETECTED=0
PODKOP_DETECTED=0

if package_installed adguardhome || package_installed luci-app-adguardhome || service_exists AdGuardHome || service_exists adguardhome; then
    ADGUARD_DETECTED=1
fi

if package_installed podkop || package_installed luci-app-podkop || service_exists podkop; then
    PODKOP_DETECTED=1
fi

INTEGRATION_MODE="none"
if [ "${ADGUARD_DETECTED}" -eq 1 ] && [ "${PODKOP_DETECTED}" -eq 1 ]; then
    INTEGRATION_MODE="adguard_podkop"
elif [ "${ADGUARD_DETECTED}" -eq 1 ]; then
    INTEGRATION_MODE="adguard"
elif [ "${PODKOP_DETECTED}" -eq 1 ]; then
    INTEGRATION_MODE="podkop"
fi

echo "Detected integrations:"
echo "  AdGuard Home: ${ADGUARD_DETECTED}"
echo "  Podkop: ${PODKOP_DETECTED}"
echo "Recommended Sheepfold integration mode: ${INTEGRATION_MODE}"

apply_selected_settings() {
    command -v uci >/dev/null 2>&1 || return 0
    [ -r /etc/config/sheepfold ] || return 0

    echo "Applying selected Sheepfold settings to existing config."
    uci -q set sheepfold.global.language="${APP_LANGUAGE}"
    uci -q set sheepfold.global.country_profile="${ROUTER_COUNTRY}"
    uci -q set sheepfold.global.product_variant="${PRODUCT_VARIANT}"
    uci -q set sheepfold.global.luci_language_synced='1'
    # Тот же выбор применяем и к языку интерфейса LuCI, чтобы админка сразу
    # открывалась на выбранном языке, а не только внутренние строки Sheepfold.
    uci -q get luci.main >/dev/null 2>&1 || uci -q set luci.main=core
    uci -q set luci.main.lang="${APP_LANGUAGE}" 2>/dev/null || true
    # Повторная установка не должна отменять ручной выбор четырёх режимов совместимости.
    if [ "$(uci -q get sheepfold.global.integration_mode_user_set 2>/dev/null || printf 0)" != "1" ]; then
        uci -q set sheepfold.global.integration_mode="${INTEGRATION_MODE}"
        uci -q set sheepfold.global.integration_mode_source='detected'
        uci -q set sheepfold.global.integration_mode_user_set='0'
    else
        echo "Keeping manually selected integration mode: $(uci -q get sheepfold.global.integration_mode 2>/dev/null || printf none)"
    fi
    uci -q set sheepfold.global.adguard_integration="${ADGUARD_DETECTED}"
    uci -q set sheepfold.global.podkop_compatibility="${PODKOP_DETECTED}"
    current_integration="$(uci -q get sheepfold.global.integration_mode 2>/dev/null || printf none)"
    ipv6_source="$(uci -q get sheepfold.global.router_ipv6_mode_source 2>/dev/null || printf default)"
    case "${current_integration}" in
        podkop|adguard_podkop)
            if [ "$(uci -q get sheepfold.global.router_ipv6_disabled 2>/dev/null || printf 0)" != "1" ]; then
                uci -q set sheepfold.global.router_ipv6_disabled='1'
                uci -q set sheepfold.global.router_ipv6_mode_source='auto_podkop'
            elif [ "${ipv6_source}" = 'default' ]; then
                uci -q set sheepfold.global.router_ipv6_mode_source='auto_podkop'
            fi
            ;;
        *)
            if [ "${ipv6_source}" = 'auto_podkop' ]; then
                uci -q set sheepfold.global.router_ipv6_disabled='0'
                uci -q set sheepfold.global.router_ipv6_mode_source='default'
            fi
            ;;
    esac
    uci -q set sheepfold.global.auto_configure="${AUTO_CONFIGURE}"
    uci -q set sheepfold.global.detection_mode="${DETECTION_MODE}"
    uci -q set sheepfold.global.no_restrictions_auto_assign="${NO_RESTRICTIONS_AUTO_ASSIGN}"
    uci -q set sheepfold.global.personal_devices_auto_assign="${PERSONAL_DEVICES_AUTO_ASSIGN}"
    uci -q set sheepfold.global.automation_mode="${AUTOMATION_MODE}"
    uci -q set sheepfold.global.new_device_policy="${NEW_DEVICE_POLICY}"
    uci -q set sheepfold.global.device_monitoring_mode="${DEVICE_MONITORING_MODE}"
    uci -q set sheepfold.adguard.enabled="${ADGUARD_DETECTED}"
    uci -q set sheepfold.podkop.enabled="${PODKOP_DETECTED}"
    uci -q commit sheepfold
    uci -q commit luci 2>/dev/null || true
    if [ -x /usr/libexec/sheepfold/sheepfold-country-profile ]; then
        /usr/libexec/sheepfold/sheepfold-country-profile apply "${ROUTER_COUNTRY}"
    fi
    [ -x /usr/libexec/sheepfold/sheepfold-ipv6-control ] && \
        /usr/libexec/sheepfold/sheepfold-ipv6-control apply >/dev/null 2>&1 || true
}

if [ ! -r /etc/config/sheepfold ]; then
    mkdir -p /etc/sheepfold
    printf '%s\n' "${APP_LANGUAGE}" > /etc/sheepfold/install.language
    printf '%s\n' "${ROUTER_COUNTRY}" > /etc/sheepfold/install.country
    chmod 600 /etc/sheepfold/install.language 2>/dev/null || true
    chmod 600 /etc/sheepfold/install.country 2>/dev/null || true
    echo "Sheepfold config is not installed yet; selected values will be applied after package installation."
    echo "Automatic setup choice:"
    echo "  language=${APP_LANGUAGE}"
    echo "  country_profile=${ROUTER_COUNTRY}"
    echo "  auto_configure=${AUTO_CONFIGURE}"
    echo "  detection_mode=${DETECTION_MODE}"
    echo "  no_restrictions_auto_assign=${NO_RESTRICTIONS_AUTO_ASSIGN}"
    echo "  personal_devices_auto_assign=${PERSONAL_DEVICES_AUTO_ASSIGN}"
    echo "  automation_mode=${AUTOMATION_MODE}"
else
    echo "Existing Sheepfold settings were found and will be preserved."
fi

# Bootstrap ещё не имеет установленного helper; копию URL-политики сверяют transport-тесты
trusted_package_url() {
        # Проверяем весь путь: один префикс не защищает от нормализации ../ загрузчиком
        candidate_url="$1"
        trusted_prefix="https://github.com/${OWNER}/${REPO}/releases/download/"
        case "$candidate_url" in
                "$trusted_prefix"*) ;;
                *) return 1 ;;
        esac

        release_path="${candidate_url#"$trusted_prefix"}"
        case "$release_path" in */*) ;; *) return 1 ;; esac
        release_tag="${release_path%%/*}"
        release_asset="${release_path#*/}"
        case "$release_tag" in
                ''|.|..|*[!a-zA-Z0-9._+-]*) return 1 ;;
        esac
        case "$release_asset" in
                ''|*[!a-zA-Z0-9._+~-]*) return 1 ;;
        esac

        case "$PACKAGE_MANAGER" in
                opkg)
                        case "$release_asset" in
                                "${ASSET_PACKAGE}_"*_all.ipk) return 0 ;;
                                *) return 1 ;;
                        esac
                        ;;
                apk)
                        case "$release_asset" in
                                "${ASSET_PACKAGE}-"*.apk) return 0 ;;
                                *) return 1 ;;
                        esac
                        ;;
                *) return 1 ;;
        esac
}

fetch_to_file() {
    url="$1"
    destination="$2"

    if command -v uclient-fetch >/dev/null 2>&1; then
        uclient-fetch -q -O "$destination" "$url"
    elif command -v wget >/dev/null 2>&1; then
        wget -q -O "$destination" "$url"
    elif command -v curl >/dev/null 2>&1; then
        curl -fL --connect-timeout 20 --max-time 300 -o "$destination" "$url"
    else
        echo "ERROR: uclient-fetch, wget, or curl is required." >&2
        return 1
    fi
}

mkdir -p "$INSTALL_DIR"
release_json="${INSTALL_DIR}/latest-release.json"

echo "Checking the latest stable GitHub release..."
if ! fetch_to_file "$RELEASE_API" "$release_json"; then
    echo "ERROR: Failed to download release metadata from GitHub." >&2
    exit 1
fi

# GitHub latest excludes drafts and pre-releases. Выбираем только OpenWrt-артефакт
# активной редакции: строгий префикс не даёт принять Android APK за пакет роутера.
case "$PACKAGE_MANAGER" in
    opkg)
        package_url="$(sed -n 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"\([^"]*_all\.ipk\)".*/\1/p' "$release_json" | grep "/${ASSET_PACKAGE}_" | head -n 1)"
        ;;
    apk)
        package_url="$(sed -n 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"\([^"]*\.apk\)".*/\1/p' "$release_json" | grep "/${ASSET_PACKAGE}-" | head -n 1)"
        ;;
esac
if [ -z "$package_url" ]; then
    echo "ERROR: The latest stable release does not contain the Sheepfold OpenWrt .${PACKAGE_EXTENSION} package." >&2
    exit 1
fi

if ! trusted_package_url "$package_url"; then
    echo "ERROR: Package URL is outside the official Sheepfold release path." >&2
    exit 1
fi

echo "Downloading Sheepfold package..."
if ! fetch_to_file "$package_url" "$PACKAGE_FILE"; then
    echo "ERROR: Failed to download Sheepfold package." >&2
    exit 1
fi

if [ ! -s "$PACKAGE_FILE" ]; then
    echo "ERROR: Downloaded package is empty." >&2
    exit 1
fi

echo "Installing Sheepfold with ${PACKAGE_MANAGER}..."
CONFIG_BACKUP="${INSTALL_DIR}/sheepfold.config.before-install"
if [ -s /etc/config/sheepfold ]; then
    cp /etc/config/sheepfold "$CONFIG_BACKUP"
    chmod 600 "$CONFIG_BACKUP" 2>/dev/null || true
fi

CURRENT_PRODUCT_VARIANT="$(uci -q get sheepfold.global.product_variant 2>/dev/null || true)"
CURRENT_PACKAGE_VERSION="$(sheepfold_package_version "$INSTALLED_PACKAGE" 2>/dev/null || true)"
case "$PACKAGE_MANAGER" in
    opkg)
        TARGET_PACKAGE_VERSION="$(basename "$package_url" | sed -n "s/^${ASSET_PACKAGE}_\\([^_]*\\)_all\\.ipk$/\\1/p" | sed -n '1p')"
        ;;
    apk)
        TARGET_PACKAGE_VERSION="$(basename "$package_url" | sed -n "s/^${ASSET_PACKAGE}-\\(.*\\)\\.apk$/\\1/p" | sed -n '1p')"
        ;;
esac
if [ -z "$CURRENT_PRODUCT_VARIANT" ]; then
    if package_installed "$LEGACY_AI_PACKAGE"; then
        CURRENT_PRODUCT_VARIANT="sheepfoldAi"
    elif package_installed "$INSTALLED_PACKAGE"; then
        CURRENT_PRODUCT_VARIANT="sheepfold"
    fi
fi

# На одной версии менеджер пакетов иначе не заменит payload другой редакции.
# Конфиг вынесен в отдельную копию, потому что принудительная переустановка может
# удалить установленный payload перед немедленной установкой выбранного пакета. §prodvar
if package_installed "$INSTALLED_PACKAGE" && \
   [ "$CURRENT_PRODUCT_VARIANT" != "$PRODUCT_VARIANT" ] && \
   [ -n "$CURRENT_PACKAGE_VERSION" ] && \
   [ "$CURRENT_PACKAGE_VERSION" = "$TARGET_PACKAGE_VERSION" ]; then
    echo "Switching Sheepfold product while preserving the existing configuration..."
    if sheepfold_package_install_file "$PACKAGE_FILE" 1; then
        INSTALL_CODE=0
    else
        INSTALL_CODE="$?"
    fi
else
    if sheepfold_package_install_file "$PACKAGE_FILE" 0; then
        INSTALL_CODE=0
    else
        INSTALL_CODE="$?"
    fi
fi

if [ "$INSTALL_CODE" -ne 0 ]; then
    if [ -s "$CONFIG_BACKUP" ]; then
        cp "$CONFIG_BACKUP" /etc/config/sheepfold
        chmod 600 /etc/config/sheepfold 2>/dev/null || true
        echo "Previous Sheepfold settings were restored."
    fi
    echo "ERROR: Sheepfold installation failed with code ${INSTALL_CODE}." >&2
    exit "$INSTALL_CODE"
fi

apply_selected_settings

if [ "$(uci -q get sheepfold.global.product_variant 2>/dev/null || true)" != "$PRODUCT_VARIANT" ]; then
    [ ! -s "$CONFIG_BACKUP" ] || cp "$CONFIG_BACKUP" /etc/config/sheepfold
    echo "ERROR: The selected Sheepfold product was not activated; previous settings were restored." >&2
    exit 1
fi
rm -rf "$INSTALL_DIR"

echo "Sheepfold installation completed."

exit 0
