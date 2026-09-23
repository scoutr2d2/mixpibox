#!/bin/sh
# Zeigt jeder Unit, die ein Installationsweg ANFASST, auch eine Datei gegenueber?
#
# WOZU: das ist die Fehlerklasse, die in diesem Repo mehrfach Geld gekostet hat
# und nie beim Bauen auffaellt, sondern erst auf einer frisch bespielten Karte:
#
#   * `systemctl enable X` auf eine Unit, die kein Ausrollweg auslegt
#     -> ein Schalter, der ins Leere zeigt (BACKLOG E12/X10, E12/X13(b))
#   * `mv config/services/X /etc/systemd/system/` auf eine Datei, die es im
#     Repo gar nicht gibt -> `mv` scheitert, und weil alles nach >&3 geht,
#     STILL
#   * eine Unit-DATEI, die niemand ausrollt -> tote Fracht
#
# Genau daran hing die pm2-Umstellung: mupibox-server.service und
# mupibox-player.service lagen NUR im remote-step-installer, nicht in
# config/services/. Deshalb konnte autosetup.sh sie nicht auslegen - und
# startete die App ersatzweise ueber pm2, waehrend jede laufende Box sie
# unter systemd fuhr (behoben 14.08.2026).
#
# REIN LESEND, rein statisch - keine Box noetig.
#
# AUFRUF
#     tools/units-decken-sich.sh
# Rueckgabe 0, wenn sich alles deckt; sonst 1 (fuer tools/pruefen.sh geeignet).

cd "$(dirname "$0")/.." || exit 2

SETUP="autosetup/autosetup.sh"
VORRAT="config/services"
# ZWEITER VORRAT seit E42 (22.08.2026): die Soloist-/MixPi-Units liegen unter
# scripts/systemd/ neben einrichten.sh - EINE Quelle fuer Rezept, Handweg und
# beide Schalen-Wege. Ohne diese Zeile meldete dieses Werkzeug jede davon als
# "OHNE DATEI", obwohl autosetup.sh sie sehr wohl auslegt - ein Werkzeug, das
# falschen Alarm gibt, wird nach dem dritten Mal nicht mehr gelesen.
VORRAT2="scripts/systemd"
fehler=0

# ── 1. Welche Unit-Dateien legt autosetup.sh aus den Vorraeten aus?
# Nur `mv`/`cp` aus config/services bzw. scripts/systemd.
ausgelegt=$(grep -oE "(config/services|scripts/systemd)/[A-Za-z0-9@._-]+\.(service|timer|path)" "$SETUP" \
            | sed 's|.*/||' | sort -u)

# ── 2. Welche Units schaltet autosetup.sh ein oder startet sie?
# `systemctl enable/start/enable --now <name>` - der Name kann mit oder ohne
# Endung dastehen. Die `for`-Schleife im Skript haengt ".service" selbst an;
# ihre Namen stehen deshalb ohne Endung in einer `for ... in`-Zeile und werden
# hier mit erfasst.
# DER NAME DARF NICHT MIT `-` ANFANGEN. Ohne diese Einschraenkung schluckte
# `[A-Za-z0-9@._-]+` das Wort `--now` selbst als Unit-Namen (der Bindestrich
# steht in der Zeichenklasse, und `( --now)?` ist optional, greift also nicht
# zwingend). Der erste Lauf am 14.08.2026 meldete prompt eine fehlende Unit
# namens `--now` - und `grep -qx "--now"` hielt sie dann fuer eine Option.
geschaltet=$(grep -oE "systemctl (enable|start|restart)( --now)? [A-Za-z0-9@._][A-Za-z0-9@._-]*" "$SETUP" \
             | awk '{print $NF}' | sort -u)
schleife=$(sed -n 's/^[[:space:]]*for service in \(.*\); do/\1/p' "$SETUP" | tr ' ' '\n' | sed 's/$/.service/' | sort -u)

echo "── Unit-Dateien, die autosetup.sh auslegt, aber nicht im Repo liegen"
for u in $ausgelegt; do
  if [ ! -f "$VORRAT/$u" ] && [ ! -f "$VORRAT2/$u" ]; then
    echo "  FEHLT: $u   (autosetup.sh will es auslegen; weder $VORRAT/ noch $VORRAT2/)"
    fehler=1
  fi
done
[ "$fehler" = 0 ] && echo "  (keine)"

echo
echo "── Units, die autosetup.sh schaltet, ohne dass ein Weg sie auslegt"
# ERLAUBT sind Units, die NICHT aus diesem Repo kommen: von dietpi, von
# Debian-Paketen oder vom remote-step-installer. Sie hier zu melden waere
# Laerm - die Liste benennt sie deshalb einzeln, damit jede Ausnahme eine
# Begruendung hat und nicht ein Muster alles verschluckt.
FREMD="lighttpd smbd nmbd bluetooth avahi-daemon ssh cron systemd-timesyncd
       dietpi-dashboard pulseaudio spotifyd mupibox-alsa-init"
for u in $geschaltet $schleife; do
  name=${u%.service}; name=${name%.timer}; name=${name%.path}
  # Endung ermitteln: was im Skript steht, gilt.
  case "$u" in
    *.service|*.timer|*.path) datei="$u" ;;
    *)                        datei="$u.service" ;;
  esac
  { [ -f "$VORRAT/$datei" ] || [ -f "$VORRAT2/$datei" ]; } && continue
  echo "$FREMD" | tr ' ' '\n' | grep -qx -- "$name" && continue
  echo "  OHNE DATEI: $u   (weder $VORRAT/ noch $VORRAT2/$datei, nicht als fremd vermerkt)"
  fehler=1
done

echo
echo "── Unit-Dateien im Repo, die autosetup.sh nicht ausrollt (nur HINWEIS)"
# BEWUSST KEIN FEHLER. Eine Unit-Datei ohne Ausrollweg ist nicht zwangslaeufig
# ein Versehen - sie kann der halbe RUECKWEG sein. Zwei belegte Beispiele:
#   * pulseaudio.service - bleibt liegen, wird aber nicht eingeschaltet
#     (BACKLOG E12/X6); die andere Haelfte ist `apt-get install pulseaudio`.
#   * mupi_change_checker.service - wird vom Update-Weg sogar aktiv ENTFERNT
#     (update/start_mupibox_update.sh:1466-1468), die Datei bleibt als
#     Rueckfall.
# Ein `exit 1` darauf haette das Werkzeug unbrauchbar gemacht: es hiesse, bei
# jedem Lauf eine Abweichung zu melden, die keine ist - und wer ein Werkzeug
# zweimal umsonst rot sieht, sieht beim dritten Mal nicht mehr hin.
for p in "$VORRAT"/*.service "$VORRAT"/*.timer "$VORRAT"/*.path; do
  [ -f "$p" ] || continue
  u=$(basename "$p")
  echo "$ausgelegt" | grep -qx -- "$u" && continue
  echo "  liegt nur da: $u"
done

echo
[ "$fehler" = 0 ] && echo "▸ alles deckt sich" || echo "▸ Abweichungen siehe oben"
exit $fehler
