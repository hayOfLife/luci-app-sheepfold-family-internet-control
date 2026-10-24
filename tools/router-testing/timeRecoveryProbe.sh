#!/bin/sh
# Ручной тест настоящего helper на OpenWrt: подставные часы/UCI и частный RAM-каталог
# позволяют проверить ash, flock, symlink и GNU timeout без смены даты или настроек
# Только явный --restart-ntp перезапускает уже включённый и работающий NTP
# EXIT удаляет свой fixture и сверяет хеши конфигов; успех не доказывает recovery после boot
set -eu

fail() { printf 'FAIL|%s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS|%s\n' "$1"; }

[ "$#" -ge 1 ] && [ "$#" -le 2 ] || fail 'usage: timeRecoveryProbe.sh SOURCE_DIR [--restart-ntp]'
mode="${2:-fixture}"
case "$mode" in fixture|--restart-ntp) ;; *) fail invalid_mode ;; esac
[ -f /etc/openwrt_release ] || fail openwrt_required
source_dir="$(cd "$1" && pwd -P)" || fail source_directory
for name in sheepfold-time-control sheepfold-lock-common; do
    [ -f "$source_dir/$name" ] && [ ! -L "$source_dir/$name" ] || fail "source_$name"
done
for name in timeout flock sha256sum mktemp cmp; do
    command -v "$name" >/dev/null 2>&1 || fail "missing_$name"
done
timeout --version | grep -q 'GNU coreutils' || fail gnu_timeout_required
if [ "$mode" = --restart-ntp ]; then
    [ "$(uci -q get system.ntp.enabled)" = 1 ] || fail real_ntp_not_enabled
    /etc/init.d/sysntpd running >/dev/null 2>&1 || fail real_ntp_not_running
fi

umask 077
work="$(mktemp -d /tmp/sheepfold-time-probe.XXXXXX)" || exit 1
real_started=0
cleanup() {
    code=$?
    trap - EXIT HUP INT TERM
    if [ -f "$work/configs.sha256" ] && ! sha256sum -c "$work/configs.sha256" >/dev/null 2>&1; then
        printf 'FAIL|configuration_changed_during_probe\n' >&2
        code=1
    fi
    if [ "$real_started" = 1 ] && ! /etc/init.d/sysntpd running >/dev/null 2>&1; then
        timeout -k 2 15 /etc/init.d/sysntpd restart >/dev/null 2>&1 || code=1
        /etc/init.d/sysntpd running >/dev/null 2>&1 || code=1
    fi
    case "$work" in /tmp/sheepfold-time-probe.*) rm -rf "$work" ;; *) code=1 ;; esac
    exit "$code"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
sha256sum /etc/config/system /etc/config/sheepfold > "$work/configs.sha256"
mkdir "$work/bin"
cat > "$work/bin/date" <<'EOF'
#!/bin/sh
[ "$1" = +%Y ] || exit 2
printf '%s\n' "$PROBE_YEAR"
EOF
cat > "$work/bin/uci" <<'EOF'
#!/bin/sh
case "$*" in
    '-q get system.ntp.enabled') printf '%s\n' "$PROBE_ENABLED" ;;
    '-q get sheepfold.global.language') echo ru ;;
    *) exit 2 ;;
esac
EOF
cat > "$work/init" <<'EOF'
#!/bin/sh
printf '%s\n' "$1" >> "$PROBE_WORK/restarts"
if [ "$PROBE_REAL_NTP" = 1 ]; then
    # Штатный init не должен наследовать подставные date/uci из PATH helper
    PATH="$PROBE_BASE_PATH"
    export PATH
    exec /etc/init.d/sysntpd "$@"
fi
if [ "$PROBE_STUCK" = 1 ]; then
    trap '' TERM
    while :; do sleep 1; done
fi
EOF
cat > "$work/notify" <<'EOF'
#!/bin/sh
printf '%s:%s:%s\n' "$1" "$2" "$3" >> "$PROBE_WORK/notices"
EOF
printf '#!/bin/sh\nexit 0\n' > "$work/log"
chmod 700 "$work/bin/date" "$work/bin/uci" "$work/init" "$work/notify" "$work/log"
base_path="$PATH"
: > "$work/restarts"
: > "$work/notices"

run() {
    printf '%s.00 0.00\n' "$1" > "$work/uptime"
    PATH="$work/bin:$base_path" PROBE_BASE_PATH="$base_path" PROBE_WORK="$work" \
        PROBE_YEAR="$2" PROBE_ENABLED="${3:-1}" PROBE_STUCK="${4:-0}" PROBE_REAL_NTP="${5:-0}" \
        SHEEPFOLD_LOCK_COMMON="$source_dir/sheepfold-lock-common" SHEEPFOLD_TIME_LOCK="$work/time.lock" \
        SHEEPFOLD_TIME_RECOVERY_DIR="$work/recovery" SHEEPFOLD_TIME_UPTIME_FILE="$work/uptime" \
        SHEEPFOLD_SYSNTPD_INIT="$work/init" SHEEPFOLD_NOTIFICATION_HELPER="$work/notify" \
        SHEEPFOLD_LOG_HELPER="$work/log" sh "$source_dir/sheepfold-time-control" recover
}
expect() {
    wanted="$1"
    shift
    output="$(run "$@")" || fail "runtime_$wanted"
    [ "$output" = "recovery_status=$wanted" ] || fail "status_$wanted"
}
reject() {
    if output="$(run "$@")"; then
        fail unexpected_success
    else
        [ "$?" = 1 ] || fail unexpected_failure_code
    fi
}
reset_fixture() {
    expect healthy 180 2026
    : > "$work/restarts"
    : > "$work/notices"
}

expect healthy 180 2026
expect boot_grace 179 1970
[ ! -s "$work/restarts" ] && [ ! -s "$work/notices" ] || fail healthy_side_effect
pass healthy_and_boot_grace

for uptime in 180 479 480 779; do expect syncing "$uptime" 1970; done
expect exhausted 780 1970
expect exhausted 1200 1970
[ "$(wc -l < "$work/restarts")" -eq 2 ] || fail retry_budget
[ "$(wc -l < "$work/notices")" -eq 1 ] || fail notification_deduplication
# stat может отсутствовать в минимальном BusyBox, но ls доступен штатно
case "$(LC_ALL=C ls -ld "$work/recovery/state")" in '-rw------- '*) ;; *) fail state_permissions ;; esac
case "$(LC_ALL=C ls -ld "$work/recovery")" in 'drwx------ '*) ;; *) fail directory_permissions ;; esac
pass retry_budget_and_private_state

reset_fixture
expect disabled 180 1970 0
[ ! -s "$work/restarts" ] || fail disabled_ntp_restarted
reset_fixture
pass disabled_ntp

exec 8> "$work/time.lock"
flock -n 8 || fail probe_lock
reject 180 1970
flock -u 8
exec 8>&-
[ ! -s "$work/restarts" ] || fail restart_under_foreign_lock
pass native_lock_contention

printf 'foreign\n' > "$work/foreign"
ln -s "$work/foreign" "$work/recovery/state"
reject 180 1970
[ "$(cat "$work/foreign")" = foreign ] || fail symlink_target_changed
rm "$work/recovery/state"
pass native_symlink_guard

for sample in record tail blank nul; do
    case "$sample" in
        record) printf '0 0 0 0 waiting\n0 0 0 0 waiting\n' ;;
        tail) printf '0 0 0 0 waiting\ntail' ;;
        blank) printf '0 0 0 0 waiting\n\n' ;;
        nul) printf '0 0 0 0 wai\000ting\n' ;;
    esac > "$work/recovery/state"
    before="$(sha256sum "$work/recovery/state")"
    reject 180 1970
    [ "$(sha256sum "$work/recovery/state")" = "$before" ] || fail corrupt_state_changed
done
[ ! -s "$work/restarts" ] && [ ! -s "$work/notices" ] || fail corrupt_state_side_effect
rm "$work/recovery/state"
pass native_state_payload

start="$(cut -d. -f1 /proc/uptime)"
expect failed 180 1970 1 1
elapsed=$(( $(cut -d. -f1 /proc/uptime) - start ))
[ "$elapsed" -ge 15 ] && [ "$elapsed" -lt 30 ] || fail timeout_duration
reset_fixture
printf 'PASS|native_timeout|seconds=%s\n' "$elapsed"

if [ "$mode" = --restart-ntp ]; then
    real_started=1
    expect syncing 180 1970 1 0 1
    /etc/init.d/sysntpd running >/dev/null 2>&1 || fail real_ntp_not_running_after_restart
    year="$(date +%Y)"
    [ "$year" -ge 2024 ] && [ "$year" -le 2100 ] || fail real_clock_implausible
    expect healthy 480 "$year"
    [ ! -e "$work/recovery/state" ] || fail healthy_state_retained
    pass real_enabled_ntp_restart
fi
sha256sum -c "$work/configs.sha256" >/dev/null 2>&1 || fail configuration_changed
pass configuration_unchanged
