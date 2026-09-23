#!/bin/sh
# hat-apply.sh — reconcile the detected MuPiHAT presence with the configured
# `mupihat.hat_active` flag in mupiboxconfig.json (B10).
#
# Policy (safe by design):
#   * A MANUAL value ("true"/"false") always WINS — the user's explicit choice
#     is respected. Auto-detection only decides when the flag is the sentinel
#     "auto" (or when MUPIBOX_HAT_AUTO=1 is set).
#   * DRY-RUN by default — it only prints what it would do. Pass --apply to
#     actually write the flag.
#   * It writes ONLY the config flag. It deliberately does NOT run
#     enable_mupihat.sh or touch the I2C / MAX98357A audio device-tree overlays
#     — enabling the HAT's audio path is an install/boot concern (a reboot), and
#     that hard-constraint flow stays where it is. A note is printed when a
#     newly-detected HAT still needs that step.
#
# Env:
#   MUPIBOX_CONFIG     path to mupiboxconfig.json  (default /etc/mupibox/mupiboxconfig.json)
#   MUPIBOX_HAT_AUTO=1 treat any current value as "auto"
#   MUPIBOX_FORCE_HAT=1 (passed through to hwdetect.sh) pretend a HAT is present
set -eu

DIR=$(cd "$(dirname "$0")" && pwd)
CFG="${MUPIBOX_CONFIG:-/etc/mupibox/mupiboxconfig.json}"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

command -v node >/dev/null 2>&1 || { echo "hat-apply: node is required" >&2; exit 2; }

det=$("$DIR/hwdetect.sh")
rec=$(printf '%s' "$det" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).hat_active_recommended))}catch(e){process.stdout.write("false")}})')

# current value ("MISSING" if the file/key is absent)
cur=$(node -e 'try{const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=c&&c.mupihat?c.mupihat.hat_active:undefined;process.stdout.write(v===undefined?"MISSING":String(v))}catch(e){process.stdout.write("MISSING")}' "$CFG" 2>/dev/null || echo MISSING)

auto=0
[ "${MUPIBOX_HAT_AUTO:-}" = "1" ] && auto=1
[ "$cur" = "auto" ] && auto=1
[ "$cur" = "MISSING" ] && auto=1   # unconfigured -> let detection seed it

if [ "$auto" = "1" ]; then eff="$rec"; else eff="$cur"; fi

echo "config          : $CFG"
echo "detected HAT    : $(printf '%s' "$det" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s).mupihat;process.stdout.write(m.present+(m.bus?" (bus "+m.bus+", "+m.method+")":" ("+m.method+")"))})')"
echo "recommended     : $rec"
echo "current flag    : $cur"
echo "mode            : $( [ "$auto" = 1 ] && echo 'auto (detection decides)' || echo 'manual (respected, detection ignored)')"
echo "effective value : $eff"

if [ "$auto" != "1" ]; then
  echo "-> manual value kept; nothing to do."
  exit 0
fi

if [ "$eff" = "$cur" ]; then
  echo "-> already correct; nothing to change."
  exit 0
fi

if [ "$APPLY" != "1" ]; then
  echo "-> DRY-RUN: would set mupihat.hat_active = $eff  (re-run with --apply to write)"
  exit 0
fi

node -e '
  const fs=require("fs"); const p=process.argv[1]; const val=process.argv[2]==="true";
  const c=JSON.parse(fs.readFileSync(p,"utf8"));
  c.mupihat=c.mupihat||{}; c.mupihat.hat_active=val;
  fs.writeFileSync(p, JSON.stringify(c,null,2)+"\n");
' "$CFG" "$eff"
echo "-> applied: mupihat.hat_active = $eff"
[ "$eff" = "true" ] && echo "   NOTE: audio via the HAT (MAX98357A I2S) still needs enable_mupihat.sh + a reboot."
