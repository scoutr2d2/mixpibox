#!/bin/sh
# hwdetect.sh — detect the host platform and whether a MuPiHAT is physically
# present (the TI BQ25792 charger answers on I2C @ 0x6b).
#
# REPORTING ONLY — no side effects, changes nothing. It replaces the guesswork
# behind the manual `mupihat.hat_active` flag with an auto-default, and makes
# the software portable across Raspberry Pi (4/5/CM4/CM5), Odroid and x86
# (dev/sim, where it degrades gracefully to "no HAT"). See MODERNIZATION.md B10.
#
# Output: one JSON object on stdout.
# Env:
#   MUPIHAT_ADDR       I2C address to probe            (default 0x6b)
#   MUPIBOX_FORCE_HAT=1  pretend a HAT is present      (sim/demo)
set -eu

HAT_ADDR="${MUPIHAT_ADDR:-0x6b}"

# --- platform / arch --------------------------------------------------------
model=""
if [ -r /proc/device-tree/model ]; then
  model=$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || true)
fi
[ -n "$model" ] || model=$(awk -F': ' '/^Model/{print $2; exit}' /proc/cpuinfo 2>/dev/null || true)
[ -n "$model" ] || model=$(uname -srm)
arch=$(uname -m)

# --- i2c buses --------------------------------------------------------------
buses=""
for dev in /dev/i2c-*; do
  [ -e "$dev" ] || continue
  buses="$buses ${dev#/dev/i2c-}"
done
buses=$(echo "$buses" | sed 's/^ *//;s/ *$//')

# --- probe for the MuPiHAT charger -----------------------------------------
present="unknown"; hbus=""; method="none"
if [ "${MUPIBOX_FORCE_HAT:-}" = "1" ]; then
  present="true"; method="forced"
elif [ -z "$buses" ]; then
  present="false"; method="no-i2c"                       # x86 dev / container / sim
elif command -v i2cget >/dev/null 2>&1; then
  method="i2cget"; present="false"
  for b in $buses; do
    if i2cget -y "$b" "$HAT_ADDR" 0x00 >/dev/null 2>&1; then present="true"; hbus="$b"; break; fi
  done
elif command -v i2cdetect >/dev/null 2>&1; then
  method="i2cdetect"; present="false"
  short=$(printf '%s' "$HAT_ADDR" | sed 's/^0x//')
  for b in $buses; do
    if i2cdetect -y "$b" "$HAT_ADDR" "$HAT_ADDR" 2>/dev/null | grep -qiE "(^| )$short( |\$)"; then
      present="true"; hbus="$b"; break
    fi
  done
else
  method="tools-missing"                                 # buses exist but no i2c-tools
fi

# --- recommended hat_active (drives the auto-default; see hat-apply.sh) -----
rec="false"; [ "$present" = "true" ] && rec="true"

# --- source: is this real hardware or a dev/sim host? ----------------------
src="real"
case "$arch" in aarch64|armv7l|armv6l) : ;; *) src="sim" ;; esac
[ "${MUPIBOX_FORCE_HAT:-}" = "1" ] && src="sim"

printf '{"platform":"%s","arch":"%s","i2c_buses":"%s","mupihat":{"present":"%s","address":"%s","bus":"%s","method":"%s"},"hat_active_recommended":%s,"source":"%s"}\n' \
  "$model" "$arch" "$buses" "$present" "$HAT_ADDR" "$hbus" "$method" "$rec" "$src"
