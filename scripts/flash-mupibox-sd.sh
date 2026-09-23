#!/usr/bin/env bash
# ============================================================================
#  flash-mupibox-sd.sh — one-command laptop-side SD prep for a fresh MuPiBox.
#
#  Do FIRST: flash DietPi onto the SD with Raspberry Pi Imager, then re-insert.
#  Then run THIS. It:
#    1. AUTO-FINDS the DietPi boot partition (no /run/media vs /media guessing),
#    2. bakes THIS MuPiBox version onto it (make-boot-sd.sh),
#    3. sets Wi-Fi (hidden passphrase prompt),
#    4. pre-configures the Waveshare 5" DSI display on DSI1 (full KMS) so the
#       Pi 5 comes up WITH a picture on first boot — no post-boot SSH fix,
#    5. flushes and prints how to eject + the next steps on the Pi.
#
#  Usage:
#    scripts/flash-mupibox-sd.sh
#    scripts/flash-mupibox-sd.sh --wifi 'MyNetwork'
#    scripts/flash-mupibox-sd.sh --wifi 'MyNetwork' --no-waveshare
# ============================================================================
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"     # survive 'sh flash-mupibox-sd.sh'
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIFI_SSID=""
WAVESHARE=1
while [ $# -gt 0 ]; do
  case "${1:-}" in
    --wifi)         shift; WIFI_SSID="${1:-}" ;;
    --no-waveshare) WAVESHARE=0 ;;
    -h|--help)      sed -n '2,26p' "$0"; exit 0 ;;
    *)              echo "Unbekannte Option: $1"; exit 1 ;;
  esac
  shift
done

c(){ printf '\033[1;36m%s\033[0m\n' "$*"; }
w(){ printf '\033[1;33m%s\033[0m\n' "$*"; }
die(){ printf '\033[1;31mFEHLER: %s\033[0m\n' "$*" >&2; exit 1; }

# --- 1) find the DietPi boot partition (vfat mount that contains dietpi.txt) --
c "Suche die DietPi-Boot-Partition (SD) ..."
CANDS=()
while read -r tgt fst; do
  [ "$fst" = vfat ] || [ "$fst" = msdos ] || continue
  case "$tgt" in /|/boot|/boot/*|/run|/proc|/sys|/dev) continue ;; esac
  [ -f "$tgt/dietpi.txt" ] && CANDS+=("$tgt")
done < <(findmnt -rno TARGET,FSTYPE 2>/dev/null)

[ "${#CANDS[@]}" -ge 1 ] || die "Keine DietPi-SD gefunden. Erst DietPi mit dem Raspberry Pi Imager flashen, SD neu einstecken, dann nochmal."
[ "${#CANDS[@]}" -eq 1 ] || { w "Mehrere DietPi-SDs gefunden:"; printf '  %s\n' "${CANDS[@]}"; die "Bitte nur EINE SD stecken lassen."; }
BOOT="${CANDS[0]}"
DEV="$(findmnt -rno SOURCE "$BOOT" 2>/dev/null | sed -E 's/p?[0-9]+$//')"
c "Gefunden: $BOOT   (Gerät ${DEV:-?})"

# --- 2) confirm ---------------------------------------------------------------
# `.version` ist die Fassung DIESES Baums; die Kanaele sind leer, solange
# MixPiBox nichts veroeffentlicht hat (Begruendung in version.json). Der
# Rueckfall haelt ein altes version.json lesbar.
VER="$(jq -r '.version // .release.stable[-1].version' "$REPO/version.json" 2>/dev/null || \
       python3 -c "import json;d=json.load(open('$REPO/version.json'));print(d.get('version') or d['release']['stable'][-1]['version'])" 2>/dev/null || echo '?')"
echo
echo "   MuPiBox $VER   ->   $BOOT"
if [ -n "$WIFI_SSID" ]; then echo "   WLAN:     $WIFI_SSID  (Passwort wird gleich versteckt abgefragt)"
else                         echo "   WLAN:     (keins — mit --wifi 'SSID' setzen, oder Ethernet)"; fi
if [ "$WAVESHARE" = 1 ]; then echo "   Display:  Waveshare 5\" DSI auf DSI1 (wird vorkonfiguriert)"
else                          echo "   Display:  (nicht vorkonfiguriert)"; fi
echo
read -rp "   Weiter? [j/N] " a; case "${a:-}" in j|J|y|Y) : ;; *) die "Abgebrochen." ;; esac

# --- 3) stage this repo onto the SD (bakes deploy.zip + autosetup + installer) -
c "Backe MuPiBox $VER auf die SD ..."
if [ -n "$WIFI_SSID" ]; then
  "$REPO/scripts/make-boot-sd.sh" "$BOOT" --wifi "$WIFI_SSID" --yes
else
  "$REPO/scripts/make-boot-sd.sh" "$BOOT" --yes
fi

# --- 4) pre-configure the Waveshare 5" DSI display (Pi 5 boots WITH a picture) -
if [ "$WAVESHARE" = 1 ]; then
  CFG="$BOOT/config.txt"
  if [ -f "$CFG" ]; then
    c "Trage Waveshare 5\" DSI (DSI1, volles KMS) in config.txt ein ..."
    # drop conflicting legacy/other-panel lines, then add KMS + the panel (once)
    sed -i -E '/vc4-fkms-v3d/d; /vc4-kms-dsi-7inch/d' "$CFG"
    grep -q '^dtoverlay=vc4-kms-v3d'               "$CFG" || printf 'dtoverlay=vc4-kms-v3d\n'                          >> "$CFG"
    grep -q 'vc4-kms-dsi-waveshare-panel,5_0_inch' "$CFG" || printf 'dtoverlay=vc4-kms-dsi-waveshare-panel,5_0_inch\n' >> "$CFG"
  else
    w "config.txt auf der SD nicht gefunden ($CFG) — Display dann per SSH (Doku Schritt 6)."
  fi
fi

# --- 5) flush + next steps ----------------------------------------------------
c "sync ..."; sync
echo
c "FERTIG — SD ist bespielt."
echo "   Auswerfen:  udisksctl power-off -b ${DEV:-/dev/sdX}"
echo
c "Am Pi weiter:"
cat <<'EOF'
   1) SD in den Pi 5, Display-FPC an DSI1, Strom dran, einschalten.
   2) Erster Boot installiert alles automatisch (10-20 min).
      Mitlesen:  ssh dietpi@<box-ip>   (Passwort dietpi)
                 tail -f /var/tmp/mupibox-firstboot.log
   3) Nach dem Reboot kommt der Schirm (Display ist vorkonfiguriert).
      Falls doch schwarz -> documentation/pi5-fresh-setup.md, Abschnitt 6.
   4) Spotify-Login vom Laptop:  https://<box-ip>:8200
EOF
