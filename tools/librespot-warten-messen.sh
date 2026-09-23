#!/bin/sh
# Die Warteschleife von librespot nachmessen — im ECHTEN Dienstkontext.
#
# WOZU: librespot wartet vor dem Start, bis `pactl list short sinks` etwas
# ausgibt. Der Verdacht am 2026-08-02 war, diese Bedingung scheitere im
# Dienstkontext (User=dietpi, keine Sitzung, "Failed to load cookie file") und
# die Schleife laufe deshalb bei JEDEM Start voll durch — 90 s stumme Box.
#
# WAS DIE MESSUNG ERGAB: Der Verdacht war falsch. Die Bedingung gelingt im
# Dienstkontext in 27 ms, die ganze Schleife in 51 ms. Sie funktioniert, weil
# die Unit `Environment=XDG_RUNTIME_DIR=/run/user/1000` SELBST setzt — genau
# das, was beim Nachstellen von Hand fehlt. Die Cookie-Meldung war ein
# Messfehler, keine Boxstoerung. Der Deckel steht seitdem auf 20 s.
#
# DER FEHLER, DEN DIESES WERKZEUG VERHINDERT, ist also beidseitig: die
# Bedingung in der falschen Umgebung zu messen. `pactl` per sudo in einer
# SSH-Sitzung ist ein anderer Kontext als derselbe Aufruf unter `User=dietpi`
# — andere Umgebung, anderes Ergebnis, und zwar in BEIDE Richtungen (mal
# faelschlich Fehler, mal faelschlich Entwarnung). Deshalb laufen hier ALLE
# Proben in einer transienten Unit mit genau den Eigenschaften der echten
# (`systemd-run -p User=… -p Environment=…`), aus der laufenden Unit
# ausgelesen statt abgeschrieben.
#
# UND EINE ZWEITE, IN DIE DIESES WERKZEUG SELBST GETAPPT IST: Die Unit
# schreibt `2>/dev/null`. Wer beim Nachbauen `2>&1` schreibt, schiebt die
# FEHLERMELDUNGEN in die Roehre, `grep -q .` findet sie und meldet Erfolg.
# Die erste Fassung meldete so "auch ohne Tonserver alles gut". Eine Probe,
# die sich selbst zufriedenstellt — siehe llmwiki mupi-audio-guard-stumm.
#
# WAS ES MISST
#   1. Was WIRKLICH gilt — `systemctl cat`, nicht die Datei im Repo. Neben der
#      Ergaenzung koennen weitere liegen, und die spaeter sortierte gewinnt
#      (llmwiki drop-in-reihenfolge-ueberstimmt).
#   2. Den Dienstkontext: User, Umgebung.
#   3. Mehrere Bereitschaftsproben, jede EINZELN gestoppt (ms) und mit
#      Rueckgabewert — die heutige Bedingung und die Kandidaten daneben.
#   4. Den letzten Systemstart aus dem Protokoll: wann kam das
#      Benutzer-Laufzeitverzeichnis, wann PipeWire, wann librespot.
#
# WAS ES NICHT TUT
#   * Es AENDERT NICHTS. Keine Ergaenzung, kein Neustart von librespot, keine
#     Datei auf der Box. Nur Lesen und transiente Proben, die sich selbst
#     wieder abraeumen (--collect).
#   * Es spielt keinen Ton. Die ALSA-Probe schiebt Nullen aus /dev/zero durch
#     die Karte — digitale Stille, hoerbar ist nichts.
#   * Es sagt nicht, WELCHE Bedingung die richtige ist. Es liefert die Zahlen,
#     mit denen man das entscheidet.
#
# AUFRUF
#     tools/librespot-warten-messen.sh <box>
#     tools/librespot-warten-messen.sh 192.168.178.169
set -eu

BOX="${1:-}"
if [ -z "$BOX" ]; then
  echo "Aufruf: $(basename "$0") <box>" >&2
  echo "Beispiel: $(basename "$0") 192.168.178.169" >&2
  exit 2
fi

ssh -o BatchMode=yes -o ConnectTimeout=8 "dietpi@${BOX}" 'sudo -n sh -s' <<'FERN'
set -u

# Die Proben laufen als transiente Unit. ZEITLIMIT ist Absicht: eine Probe,
# die haengt, darf die Messung nicht aufhalten — sie soll als Fehlschlag mit
# ihrer Zeit in der Tabelle stehen.
GRENZE=8

echo "══ 1. WAS WIRKLICH GILT ═══════════════════════════════════════════"
echo "Ergaenzungen in Namensreihenfolge (die LETZTE gewinnt):"
ls -1 /etc/systemd/system/librespot.service.d/ 2>/dev/null | sed 's/^/    /' || echo "    (keine)"
echo ""
echo "Wirksame Startzeilen laut systemd:"
systemctl show librespot -p ExecStartPre -p ExecStart | sed 's/^/    /'

echo ""
echo "══ 2. DIENSTKONTEXT ═══════════════════════════════════════════════"
NUTZER=$(systemctl show librespot -p User --value)
[ -n "$NUTZER" ] || NUTZER=root
UMGEBUNG=$(systemctl show librespot -p Environment --value)
echo "    User        = ${NUTZER}"
echo "    Environment = ${UMGEBUNG:-(leer)}"
echo "    Zustand     = $(systemctl is-active librespot) / $(systemctl show librespot -p NRestarts --value) Neustarts"
echo ""
echo "Laufzeitverzeichnis und Tonserver, wie sie JETZT dastehen:"
ls -ld /run/user/1000 2>&1 | sed 's/^/    /'
ls -l /run/user/1000/pulse/native 2>&1 | sed 's/^/    /'
echo "    Linger      = $(loginctl show-user dietpi -p Linger --value 2>/dev/null || echo '?')"
echo "    pipewire    = $(systemctl --user -M dietpi@ is-active pipewire 2>/dev/null || echo '?')"

# Baut die systemd-run-Eigenschaften aus der ECHTEN Unit zusammen.
eigenschaften="-p User=${NUTZER}"
for paar in ${UMGEBUNG}; do
  eigenschaften="${eigenschaften} -p Environment=${paar}"
done

# probe <name> <shell-befehl>  — im Dienstkontext, gestoppt in ms.
probe() {
  name="$1"; befehl="$2"
  start=$(date +%s%N)
  # shellcheck disable=SC2086
  systemd-run --quiet --pipe --wait --collect --service-type=oneshot \
      ${eigenschaften} /bin/sh -c "${befehl}" >/tmp/probe.aus 2>/tmp/probe.fehler
  rc=$?
  ende=$(date +%s%N)
  ms=$(( (ende - start) / 1000000 ))
  if [ "$rc" -eq 0 ]; then urteil="OK     "; else urteil="FEHLER "; fi
  printf '    %s rc=%-3s %6s ms  %s\n' "$urteil" "$rc" "$ms" "$name"
  # Bei Fehlschlag die erste Meldung zeigen — sie ist die eigentliche Auskunft.
  if [ "$rc" -ne 0 ]; then
    meldung=$(head -c 300 /tmp/probe.fehler | tr '\n' ' ' | sed 's/  */ /g')
    [ -n "$meldung" ] && echo "              └─ $meldung"
  else
    ausgabe=$(head -3 /tmp/probe.aus | tr '\n' '|' | sed 's/|$//')
    [ -n "$ausgabe" ] && echo "              └─ $ausgabe"
  fi
}

echo ""
echo "══ 3. BEREITSCHAFTSPROBEN IM DIENSTKONTEXT ════════════════════════"
echo "(transiente Unit, User und Environment aus der echten Unit uebernommen)"
echo ""
echo "  -- die HEUTIGE Bedingung --"
# ACHTUNG, hier steckt eine Falle, in die dieses Werkzeug selbst getappt ist:
# Die Unit schreibt `2>/dev/null`. Wer stattdessen `2>&1` misst, schiebt die
# FEHLERMELDUNGEN in die Roehre, `grep -q .` findet sie und meldet Erfolg —
# eine Probe, die sich selbst zufriedenstellt (llmwiki mupi-audio-guard-stumm).
# Also ueberall exakt `2>/dev/null` wie in der Unit.
probe "pactl list short sinks | grep -q ." \
      "timeout ${GRENZE} pactl list short sinks 2>/dev/null | grep -q ."

echo ""
echo "  -- zum Vergleich: dieselbe Bedingung MIT Sitzungsumgebung --"
probe "…, dazu PULSE_RUNTIME_PATH gesetzt" \
      "PULSE_RUNTIME_PATH=/run/user/1000/pulse timeout ${GRENZE} pactl list short sinks 2>/dev/null | grep -q ."
probe "…, dazu HOME=/home/dietpi (Cookie-Datei)" \
      "HOME=/home/dietpi timeout ${GRENZE} pactl list short sinks 2>/dev/null | grep -q ."

echo ""
echo "  -- Kandidaten ohne PulseAudio-Protokoll --"
probe "Socket da: test -S /run/user/1000/pulse/native" \
      "test -S /run/user/1000/pulse/native"
probe "wpctl status (PipeWire selbst)" \
      "timeout ${GRENZE} wpctl status >/dev/null 2>&1"
probe "ALSA kennt eine Karte: aplay -l" \
      "timeout ${GRENZE} aplay -l 2>&1 | grep -q '^card'"
probe "ALSA laesst sich OEFFNEN (Stille aus /dev/zero)" \
      "timeout ${GRENZE} aplay -D default -f S16_LE -r 44100 -c 2 -d 1 /dev/zero >/dev/null 2>&1"

echo ""
echo "  -- die SCHLEIFE als Ganzes, so wie sie in der Unit steht --"
# NICHT abschreiben, sondern aus der wirksamen Startzeile HOLEN. Sonst misst
# das Werkzeug nach jeder Aenderung am Deckel noch die alte Schleife und
# behauptet Zahlen, die auf der Box niemand mehr hat.
SCHLEIFE=$(systemctl cat librespot 2>/dev/null | grep '^ExecStart=' | tail -1 \
           | sed -n 's/.*\(for i in .*done\);.*/\1/p')
if [ -n "$SCHLEIFE" ]; then
  probe "aus der Unit gelesen: ${SCHLEIFE}" "$SCHLEIFE"
else
  echo "    (keine Schleife in der wirksamen ExecStart-Zeile gefunden —"
  echo "     entweder wartet die Unit nicht mehr, oder die Zeile sieht anders aus)"
fi

echo ""
echo "  -- der BOOTFALL: Laufzeitverzeichnis gibt es noch nicht --"
echo "  (am Geraet ist librespot 0,55 s VOR /run/user/1000 da — dann sieht"
echo "   pactl genau das hier. Wichtig ist, ob es schnell scheitert oder haengt.)"
probe "pactl mit XDG_RUNTIME_DIR=/run/user/9999" \
      "XDG_RUNTIME_DIR=/run/user/9999 timeout ${GRENZE} pactl list short sinks 2>/dev/null | grep -q ."
echo "  Was kostet EIN Fehlversuch? Mal der Rundenzahl aus der Unit oben"
echo "  ergibt das die Wartezeit im Fehlerfall (Deckel: 40 Runden a 0,5 s):"
probe "drei Runden der Schleife ohne Tonserver" \
      'for i in 1 2 3; do XDG_RUNTIME_DIR=/run/user/9999 pactl list short sinks 2>/dev/null | grep -q . && break; sleep 1; done'
echo "  Zum Vergleich die Kandidaten im selben Fehlerfall — eine Bedingung,"
echo "  die HIER gelingt, waere eine falsche Entwarnung:"
probe "Socket da? (ohne Tonserver)" \
      "test -S /run/user/9999/pulse/native"
probe "ALSA kennt eine Karte (ohne Tonserver)" \
      "timeout ${GRENZE} aplay -l 2>/dev/null | grep -q '^card'"

echo ""
echo "  -- der ZWEITE Teil der Startzeile: die Umgebungsdatei --"
echo "  (sie ruft jq mehrfach auf mupiboxconfig.json auf — laeuft NACH der"
echo "   Schleife und zaehlt genauso zur Zeit bis zum ersten Ton.)"
probe "source /etc/librespot/env-librespot" \
      "set -a; . /etc/librespot/env-librespot >/dev/null 2>&1; true"

echo ""
echo "══ 4. DIE LAUFENDE INSTANZ: wartet sie GERADE? ════════════════════"
echo "(Die Startzeile endet auf 'exec /usr/bin/librespot'. exec ERSETZT die"
echo " bash — es gibt also nie einen Kindprozess, und die Prozessstartzeit"
echo " bleibt die der bash. Woran man den Zustand trotzdem erkennt: am"
echo " KOMMANDO hinter der ExecMainPID.)"
HAUPT=$(systemctl show librespot -p ExecMainPID --value)
if [ -n "$HAUPT" ] && [ "$HAUPT" != "0" ]; then
  ps -o pid,lstart,etimes,args -p "$HAUPT" 2>/dev/null | sed 's/^/    /'
  BEFEHL=$(ps -o args= -p "$HAUPT" 2>/dev/null)
  VERGANGEN=$(ps -o etimes= -p "$HAUPT" 2>/dev/null | tr -d ' ')
  echo ""
  case "$BEFEHL" in
    *librespot*) echo "    ►► librespot LAEUFT — die Uebergabe hat stattgefunden." ;;
    *bash*)      echo "    ►► WARTET NOCH: seit ${VERGANGEN}s in der Schleife, kein librespot." ;;
    *)           echo "    ►► unklarer Zustand: ${BEFEHL}" ;;
  esac
fi

echo ""
echo "══ 5. DER LETZTE SYSTEMSTART ══════════════════════════════════════"
echo "Wann kam was? (Sekunden seit Kernelstart)"
journalctl -b -o short-monotonic --no-pager 2>/dev/null \
  | grep -E "user@1000|user-runtime-dir@1000|Started.*[Ll]ibrespot|librespot\[|pipewire|Reached target Sound" \
  | head -25 | sed 's/^/    /'
echo ""
echo "librespots eigene ersten Zeilen dieses Starts:"
journalctl -b -u librespot -o short-monotonic --no-pager 2>/dev/null | head -12 | sed 's/^/    /'

rm -f /tmp/probe.aus /tmp/probe.fehler
FERN
