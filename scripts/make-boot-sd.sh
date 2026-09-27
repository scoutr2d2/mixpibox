#!/usr/bin/env bash
# ============================================================================
#  make-boot-sd.sh — stage THIS MuPiBox fork onto a DietPi boot SD (fork-free)
# ----------------------------------------------------------------------------
#  Turns a freshly-flashed DietPi SD into a self-contained MuPiBox installer:
#  it bakes this repo (as the release tarball autosetup expects) + the autosetup
#  + a DietPi first-boot script onto the SD's boot (FAT) partition. On first
#  boot the Pi installs THIS code with no fork, no clone, no GitHub download of
#  MuPiBox — only the usual distro/apt/node deps are still fetched online.
#
#  It does NOT flash the SD — you flash DietPi first (Raspberry Pi Imager /
#  balenaEtcher / dd). This script only writes files onto the already-mounted
#  boot partition, so it can never touch the wrong disk.
#
#  Usage:
#     scripts/make-boot-sd.sh <boot-partition-mountpoint> [--yes]
#                             [--wifi <SSID>] [--wifi-country <CC>]
#
#  Example (SD auto-mounted by the desktop):
#     scripts/make-boot-sd.sh /media/$USER/bootfs
#     scripts/make-boot-sd.sh /media/$USER/bootfs --wifi 'MyNetwork'
#         -> prompts for the Wi-Fi passphrase HIDDEN and writes dietpi-wifi.txt
#            onto the SD (the key never appears in argv/history/chat/git).
#
#  Prereqs on THIS machine: git, tar, and jq OR python3 (to read version.json).
# ============================================================================
set -euo pipefail

die() { echo "ERROR: $*" >&2; exit 1; }
note() { echo " -> $*"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOOT=""
ASSUME_YES=0
WIFI_SSID=""
WIFI_COUNTRY="DE"
while [ $# -gt 0 ]; do
  case "$1" in
    --yes)          ASSUME_YES=1 ;;
    --wifi)         shift; WIFI_SSID="${1:-}"; [ -n "${WIFI_SSID}" ] || die "--wifi needs an SSID" ;;
    --wifi-country) shift; WIFI_COUNTRY="${1:-DE}" ;;
    -*)             die "unknown option: $1 (see the header for usage)" ;;
    *)              if [ -z "${BOOT}" ]; then BOOT="$1"; else die "unexpected argument: $1"; fi ;;
  esac
  shift
done

# --- validate the target ----------------------------------------------------
[ -n "${BOOT}" ] || die "give the DietPi boot-partition mountpoint, e.g. /media/$USER/bootfs"
BOOT_IN="${BOOT}"
BOOT="$(cd "${BOOT}" 2>/dev/null && pwd)" || die "mountpoint '${BOOT_IN}' not found — is the SD flashed + inserted? (check: lsblk -f / ls /media/$USER)"
case "${BOOT}" in
  / | /boot | /boot/firmware ) die "refusing to write to '${BOOT}' (that is THIS machine's system, not the SD)";;
esac
[ -w "${BOOT}" ] || die "'${BOOT}' is not writable (mount it read-write / check permissions)"
# A DietPi (or any RPi) boot partition carries these — a sanity guard so we
# don't splatter files onto a random folder the user pointed us at.
if [ ! -f "${BOOT}/dietpi.txt" ] && [ ! -f "${BOOT}/config.txt" ] && [ ! -f "${BOOT}/cmdline.txt" ]; then
  die "'${BOOT}' has no dietpi.txt/config.txt/cmdline.txt — that does not look like a DietPi/RPi boot partition. Flash DietPi first."
fi

# --- read the version this repo ships --------------------------------------
VJSON="${REPO_ROOT}/version.json"
[ -f "${VJSON}" ] || die "version.json missing at repo root"
# The card is named after the version THIS TREE ships (`.version`), not after
# the last published one. Until 31.08.2026 this read `.release.stable[-1]`,
# which tied the card's name to a release — and MixPiBox has published none:
# its channels are empty on purpose. With the old read this script died at
# `null` on a tree that is perfectly fine to bake.
# The fallback keeps an old-shaped version.json (upstream's, or a checkout from
# before) working instead of failing on a missing key.
if command -v jq >/dev/null 2>&1; then
  VER="$(jq -r '.version // .release.stable[-1].version' "${VJSON}")"
elif command -v python3 >/dev/null 2>&1; then
  VER="$(python3 -c "import json;d=json.load(open('${VJSON}'));print(d.get('version') or d['release']['stable'][-1]['version'])")"
else
  die "need jq or python3 to read version.json"
fi
[ -n "${VER}" ] && [ "${VER}" != "null" ] || die "could not read the version from version.json"

# --- warn on a dirty tree (git archive ships HEAD, not uncommitted edits) ----
if [ -n "$(git -C "${REPO_ROOT}" status --porcelain 2>/dev/null)" ]; then
  echo "WARNING: working tree has uncommitted changes — the SD will carry the last COMMIT (HEAD), not them."
  echo "         Commit first if you want those changes on the box."
fi

TARBALL_NAME="MuPiBox-${VER}.tgz"
echo
echo "About to stage MuPiBox ${VER} onto:  ${BOOT}"
echo "  - ${TARBALL_NAME}           (this repo @ HEAD, incl. bin/nodejs/deploy.zip)"
echo "  - autosetup.sh              (with the local-source patch)"
echo "  - Automation_Custom_Script.sh (DietPi first-boot installer)"
echo "  - dietpi.txt: enable AUTO_SETUP_CUSTOM_SCRIPT_EXEC=1 (if present)"
echo "  - dietpi.txt: swap as zram, not /var/swap on the SD (BACKLOG E5/B7)"
[ -n "${WIFI_SSID}" ] && echo "  - dietpi-wifi.txt for SSID '${WIFI_SSID}' (passphrase prompted, hidden)"
if [ "${ASSUME_YES}" -ne 1 ]; then
  read -r -p "Proceed? [y/N] " ans
  case "${ans}" in y|Y|yes|Yes) ;; *) die "aborted by user";; esac
fi

# --- build the release tarball (only what autosetup actually installs) ------
# Excludes heavy trees autosetup never reads from the local source, so the
# tarball stays small enough for a FAT boot partition:
#   bin/librespot/<alte Staende> — nur der EINE, den autosetup kopiert, kommt mit
#   3D-Design / screenshots / homeassistant / .github — docs/assets, not installed
#
# ══ HIER STAND `:(exclude)bin/librespot` — UND DAS WAR SEIT MONATEN FALSCH ═══
#
# Die Begruendung daneben lautete „autosetup wget's the librespot binary from
# GitHub itself". Diesen Rueckfall gibt es nicht mehr: autosetup/autosetup.sh
# BRICHT HART AB, wenn das Binaer im Paket fehlt („FEHLER:
# bin/librespot/0.8.0/librespot-arm64 fehlt im Paket", exit 1). Eine mit diesem
# Skript gebaute Karte lief also garantiert in den Abbruch — gefunden am
# 23.09.2026 beim Gegenlesen der README, nicht an der Karte.
#
# WELCHER STAND MITKOMMT, WIRD NICHT HIER GEPFLEGT, SONDERN AUS autosetup.sh
# GELESEN. Zwei Listen derselben Sache laufen auseinander; wechselt autosetup
# auf 0.9.0, folgt dieses Skript von selbst.
LIBRESPOT_REL="$(grep -oE 'bin/librespot/[0-9A-Za-z._-]+/librespot-[a-z0-9]+' \
                   "${REPO_ROOT}/autosetup/autosetup.sh" | head -n 1 || true)"
[ -n "${LIBRESPOT_REL}" ] \
  || die "autosetup.sh nennt keinen librespot-Pfad mehr — dieses Skript muss nachziehen"
[ -f "${REPO_ROOT}/${LIBRESPOT_REL}" ] \
  || die "autosetup.sh will ${LIBRESPOT_REL}, aber die Datei fehlt im Repo"
LIBRESPOT_DIR="$(dirname "${LIBRESPOT_REL}")"
note "librespot from autosetup.sh: ${LIBRESPOT_REL}"
LIBRESPOT_EXCL=()
for d in "${REPO_ROOT}"/bin/librespot/*/; do
  rel="bin/librespot/$(basename "${d}")"
  [ "${rel}" = "${LIBRESPOT_DIR}" ] || LIBRESPOT_EXCL+=(":(exclude)${rel}")
done

# ══ WAS IN DAS PAKET GEHOERT, SAGT autosetup.sh — NICHT EINE LISTE HIER ═════
#
# Bis zum 23.09.2026 packte dieses Skript den GANZEN Baum und zaehlte auf, was
# NICHT mitsoll. Eine Ausschlussliste altert schlecht: `NewDesign/bilder/quellen`
# (126 MB KI-Rohrender) kam spaeter dazu, stand in keiner Zeile, und das Paket
# wuchs von rund 11 MB auf 164 MB — mehr, als eine FAT-Boot-Partition traegt
# (auf der Karte des Betreibers sind 94 MB frei). Gemerkt haette man es erst
# beim Schreiben, und die Begruendung „~11 MB" stand die ganze Zeit daneben.
#
# UMGEDREHT: autosetup liest aus dem entpackten Paket AUSSCHLIESSLICH ueber
# `${MUPI_SRC}/<ordner>/…`. Genau diese Ordner werden hier eingesammelt und nur
# sie gepackt. Wer autosetup einen neuen Ordner beibringt, bekommt ihn hier von
# selbst — und wer 126 MB Rohrender ins Repo legt, nicht.
mapfile -t SRC_TOPS < <(grep -oE '\$\{MUPI_SRC\}/[A-Za-z0-9_./-]+' \
                          "${REPO_ROOT}/autosetup/autosetup.sh" \
                        | sed 's|\${MUPI_SRC}/||' | cut -d/ -f1 | sort -u)
[ "${#SRC_TOPS[@]}" -gt 0 ] \
  || die "autosetup.sh liest nichts mehr ueber \${MUPI_SRC} — dieses Skript muss nachziehen"
for top in "${SRC_TOPS[@]}"; do
  [ -e "${REPO_ROOT}/${top}" ] || die "autosetup.sh liest '${top}', das es im Repo nicht gibt"
done
note "packing what autosetup reads: ${SRC_TOPS[*]}"

TMP="$(mktemp -d)"; trap 'rm -rf "${TMP}"' EXIT
note "building ${TARBALL_NAME} from HEAD ..."
git -C "${REPO_ROOT}" archive --format=tar --prefix="MuPiBox-${VER}/" HEAD \
  -- "${SRC_TOPS[@]}" "${LIBRESPOT_EXCL[@]}" \
  | gzip -n > "${TMP}/${TARBALL_NAME}"
# sanity: the whole install hinges on two prebuilt files being inside — the app
# bundle and the librespot binary. Beides einzeln nachsehen, denn beides bricht
# den Erstlauf, und zwar erst auf der Box.
# (List to a file first — piping tar into `grep -q` races SIGPIPE under pipefail.)
tar tzf "${TMP}/${TARBALL_NAME}" > "${TMP}/contents.txt"
grep -q "MuPiBox-${VER}/bin/nodejs/deploy.zip" "${TMP}/contents.txt" \
  || die "the built tarball is missing bin/nodejs/deploy.zip — did you commit it? (git ls-files bin/nodejs/deploy.zip)"
grep -q "MuPiBox-${VER}/${LIBRESPOT_REL}" "${TMP}/contents.txt" \
  || die "the built tarball is missing ${LIBRESPOT_REL} — autosetup would abort on the box"
# GROESSENWACHE: die Boot-Partition ist FAT und klein (auf der Karte des
# Betreibers 94 MB frei). Ein Paket, das nicht draufpasst, faellt sonst erst
# beim Kopieren auf — nach dem langen Bau und mit halb beschriebener Karte.
TAR_MB=$(( $(stat -c%s "${TMP}/${TARBALL_NAME}") / 1000000 ))
[ "${TAR_MB}" -le 80 ] || die "the tarball is ${TAR_MB} MB — that will not fit a FAT boot partition.
  Something large slipped into a folder autosetup reads (${SRC_TOPS[*]}).
  Check with:  git -C ${REPO_ROOT} ls-files -s ${SRC_TOPS[*]} | …"
note "tarball OK ($(du -h "${TMP}/${TARBALL_NAME}" | cut -f1), ${TAR_MB} MB, Deckel 80 MB)"

# --- generate the DietPi first-boot script ---------------------------------
cat > "${TMP}/Automation_Custom_Script.sh" <<EOF
#!/bin/bash
# ============================================================================
#  MuPiBox — self-contained first-boot installer (fork-free SD)
#  Generated by scripts/make-boot-sd.sh for MuPiBox ${VER}.
#  DietPi runs this ONCE, as root, at the end of its first-run setup.
# ============================================================================
BOOT_DIR="/boot"; [ -d /boot/firmware ] && BOOT_DIR="/boot/firmware"
LOG="/var/tmp/mupibox-firstboot.log"
{
  echo "[mupibox] first-boot install starting \$(date)"
  export MUPI_LOCAL_SRC="\${BOOT_DIR}/${TARBALL_NAME}"
  export MUPI_VERSION="${VER}"
  if [ ! -f "\${MUPI_LOCAL_SRC}" ]; then
    echo "[mupibox] ERROR: baked source \${MUPI_LOCAL_SRC} not found — aborting." >&2
    exit 1
  fi
  cp "\${BOOT_DIR}/autosetup.sh" /root/mupibox-autosetup.sh
  echo "[mupibox] running autosetup (local source: \${MUPI_LOCAL_SRC}) ..."
  bash /root/mupibox-autosetup.sh
  echo "[mupibox] autosetup finished with code \$? at \$(date)"
} 2>&1 | tee -a "\${LOG}"
EOF

# --- copy everything onto the boot partition -------------------------------
# ERST DIE ALTEN PAKETE WEG, DANN DEN PLATZ MESSEN — an der KARTE, nicht an einer
# geratenen Zahl. Bis zum 23.09.2026 blieben aeltere MuPiBox-*.tgz liegen, und
# scheiterte das Kopieren am vollen FAT, stand das alte Erstboot-Skript schon
# da und zeigte auf ein Paket, das es nicht mehr gab (Befund der gegnerischen
# Nachpruefung). Deshalb: aufraeumen, messen, und erst dann schreiben.
for alt in "${BOOT}"/MuPiBox-*.tgz; do
  [ -e "${alt}" ] || continue
  note "removing old package $(basename "${alt}")"
  rm -f "${alt}"
done
FREI_KB="$(df -Pk "${BOOT}" 2>/dev/null | awk 'NR==2 {print $4}')"
BRAUCHT_KB=$(( $(stat -c%s "${TMP}/${TARBALL_NAME}") / 1024 + 2048 ))
if [ -n "${FREI_KB}" ] && [ "${FREI_KB}" -lt "${BRAUCHT_KB}" ]; then
  die "only ${FREI_KB} KB free on ${BOOT}, the package needs ${BRAUCHT_KB} KB — free space on the card first"
fi
note "space on card: ${FREI_KB:-?} KB free, ${BRAUCHT_KB} KB needed"
note "copying files to ${BOOT} ..."
cp "${TMP}/${TARBALL_NAME}"               "${BOOT}/${TARBALL_NAME}"
cp "${REPO_ROOT}/autosetup/autosetup.sh"  "${BOOT}/autosetup.sh"
cp "${TMP}/Automation_Custom_Script.sh"   "${BOOT}/Automation_Custom_Script.sh"

# --- make DietPi actually run our first-boot script ------------------------
if [ -f "${BOOT}/dietpi.txt" ]; then
  if grep -q '^[#[:space:]]*AUTO_SETUP_CUSTOM_SCRIPT_EXEC=' "${BOOT}/dietpi.txt"; then
    sed -i 's/^[#[:space:]]*AUTO_SETUP_CUSTOM_SCRIPT_EXEC=.*/AUTO_SETUP_CUSTOM_SCRIPT_EXEC=1/' "${BOOT}/dietpi.txt"
  else
    printf '\nAUTO_SETUP_CUSTOM_SCRIPT_EXEC=1\n' >> "${BOOT}/dietpi.txt"
  fi
  note "dietpi.txt: AUTO_SETUP_CUSTOM_SCRIPT_EXEC=1"

  # SWAP ALS ZRAM — und der Grund, warum das HIER stehen muss.
  #
  # config/templates/dietpi.txt traegt seit dem 04.08.2026
  # AUTO_SETUP_SWAPFILE_LOCATION=zram (BACKLOG E5/B7). Nur: DIESE VORLAGE
  # KOMMT AUF KEINEM WEG DIESES REPOS AUF EINE KARTE. Beim Gegenlesen am
  # 04.08.2026 nachgesehen: make-boot-sd.sh legt Tarball, autosetup.sh und
  # Automation_Custom_Script.sh ab und aendert an der dietpi.txt der Karte
  # genau zwei Schluessel (CUSTOM_SCRIPT_EXEC, WLAN) — die Vorlage wird nie
  # kopiert; flash-mupibox-sd.sh sucht dietpi.txt nur, um die Partition zu
  # erkennen; autosetup.sh laeuft ohnehin erst NACH DietPis Erstlauf, wenn
  # der Swap laengst angelegt ist. Ohne diesen Block waere B7 im Backlog
  # FERTIG und auf einer frischen Karte trotzdem /var/swap.
  #
  # WARUM ZRAM: eine 2-GB-Box ohne Swap wird unter Chromium unerreichbar
  # (dreimal erlebt, Wiki: zram-statt-swap-auf-der-box). Der Bedarf entsteht
  # im BETRIEB, nicht beim Booten — nach 9,7 h waren 1318 statt 744 MB belegt
  # und 91 MB ausgelagert, fast alles ein Prozess (piper, 698 MB PSS;
  # gemessen 04.08.2026 an Box .169, Wiki: speicher-waechst-erst-im-betrieb).
  # zram ist komprimierter Swap IM RAM, kostet also keine SD-Schreibzyklen.
  # Box .169 faehrt bereits so (1005 MB zram in /proc/swaps) — bewiesen auf
  # genau dieser Hardware, nur eben nicht aus diesem Repo heraus.
  #
  # SIZE=1 heisst "auto", bei zram = 50 % des RAM. NICHT 0 setzen: das waere
  # gar kein Swap. (Die dietpi.txt der laufenden .169 sagt SIZE=0 und
  # LOCATION=/var/swap und hat trotzdem zram — dietpi.txt wirkt NUR beim
  # Erstlauf, spaetere Umstellungen stehen nicht darin. Wer den Zustand einer
  # laufenden Box aus ihrer dietpi.txt ablesen will, liest die falsche Datei.)
  #
  # ZURUECK: auf der Karte AUTO_SETUP_SWAPFILE_LOCATION=/var/swap setzen,
  # bevor der Pi das erste Mal startet. Danach: dietpi-config.
  for _paar in 'AUTO_SETUP_SWAPFILE_SIZE=1' 'AUTO_SETUP_SWAPFILE_LOCATION=zram'; do
    _schluessel="${_paar%%=*}"
    if grep -q "^[#[:space:]]*${_schluessel}=" "${BOOT}/dietpi.txt"; then
      sed -i "s/^[#[:space:]]*${_schluessel}=.*/${_paar}/" "${BOOT}/dietpi.txt"
    else
      printf '\n%s\n' "${_paar}" >> "${BOOT}/dietpi.txt"
    fi
  done
  unset _paar _schluessel
  note "dietpi.txt: AUTO_SETUP_SWAPFILE_SIZE=1, AUTO_SETUP_SWAPFILE_LOCATION=zram"
else
  echo "NOTE: no dietpi.txt on this SD — if this is NOT DietPi, ensure your OS"
  echo "      runs /boot/Automation_Custom_Script.sh once on first boot yourself."
fi

# --- optional Wi-Fi for headless first boot --------------------------------
# The passphrase is read HIDDEN from the terminal and written only into
# dietpi-wifi.txt ON THE SD (never argv/history/chat/git). DietPi stores the
# PSK in plaintext there by design — that boot partition is not in this repo.
if [ -n "${WIFI_SSID}" ]; then
  printf 'Wi-Fi passphrase for "%s" (hidden): ' "${WIFI_SSID}" >&2
  IFS= read -rs WIFI_KEY || die "no passphrase entered"
  echo >&2
  [ -n "${WIFI_KEY}" ] || die "empty Wi-Fi passphrase"
  {
    echo "aWIFI_SSID[0]='${WIFI_SSID}'"
    echo "aWIFI_KEY[0]='${WIFI_KEY}'"
    echo "aWIFI_KEYMGR[0]='WPA-PSK'"
  } > "${BOOT}/dietpi-wifi.txt"
  unset WIFI_KEY
  if [ -f "${BOOT}/dietpi.txt" ]; then
    if grep -q '^[#[:space:]]*AUTO_SETUP_NET_WIFI_ENABLED=' "${BOOT}/dietpi.txt"; then
      sed -i 's/^[#[:space:]]*AUTO_SETUP_NET_WIFI_ENABLED=.*/AUTO_SETUP_NET_WIFI_ENABLED=1/' "${BOOT}/dietpi.txt"
    else
      printf '\nAUTO_SETUP_NET_WIFI_ENABLED=1\n' >> "${BOOT}/dietpi.txt"
    fi
    if grep -q '^[#[:space:]]*AUTO_SETUP_NET_WIFI_COUNTRY_CODE=' "${BOOT}/dietpi.txt"; then
      sed -i "s/^[#[:space:]]*AUTO_SETUP_NET_WIFI_COUNTRY_CODE=.*/AUTO_SETUP_NET_WIFI_COUNTRY_CODE=${WIFI_COUNTRY}/" "${BOOT}/dietpi.txt"
    else
      printf 'AUTO_SETUP_NET_WIFI_COUNTRY_CODE=%s\n' "${WIFI_COUNTRY}" >> "${BOOT}/dietpi.txt"
    fi
  fi
  note "dietpi-wifi.txt written for SSID '${WIFI_SSID}' (key hidden); Wi-Fi enabled, country ${WIFI_COUNTRY}"
fi

sync
echo
echo "Done. SD staged for MuPiBox ${VER}."
echo
echo "Before you boot the Pi, on the SD's boot partition also set up (DietPi):"
echo "  - dietpi.txt          : AUTO_SETUP_AUTOMATED=1 (headless), locale/keyboard,"
echo "                          and — importantly — network so the Pi is online"
echo "                          (autosetup still apt-installs node/librespot/etc.)."
echo "  - dietpi-wifi.txt     : your Wi-Fi SSID + key (done already if you passed"
echo "                          --wifi; otherwise fill it in, or use Ethernet)."
echo
echo "Then: eject the SD, put it in the Pi, power on. First boot runs DietPi's"
echo "setup, then our installer (watch /var/tmp/mupibox-firstboot.log on the box)."
echo "After it reboots into the kiosk, open  https://<box-ip>:8200  from a laptop"
echo "to finish the Spotify login (see documentation/hardware-test.md)."
