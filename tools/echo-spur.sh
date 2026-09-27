#!/bin/bash
# ══ WER FUEHRT TON, WENN DER TITEL WECHSELT? ════════════════════════════════
#
#     ssh dietpi@<box> 'bash -s' < tools/echo-spur.sh          # 90 s mitschreiben
#     ssh dietpi@<box> 'bash -s' < tools/echo-spur.sh 300      # laenger
#
# ══ WOZU ═══════════════════════════════════════════════════════════════════
# Betreiber, 20.08.2026: „wenn man spotify spielt, dann den titel wechselt,
# gibt es ein paar sekunden echo vom start."
#
# GEFUNDEN wurde eine Struktur, die das erklaeren KOENNTE: An der
# Bluetooth-Senke enden drei Leitungen — Spotify direkt, der Equalizer und die
# Kombi-Senke „Ueberall". GEFUNDEN ist aber nicht BEWIESEN: zwei davon stehen
# im Ruhezustand auf `Corked: yes` und fuehren dann keinen Ton. Ob einer davon
# im Moment des Titelwechsels aufwacht, sieht man nur, wenn man WAEHREND des
# Wechsels hinsieht — und genau dafuer gibt es dieses Werkzeug.
#
# ══ WARUM NICHT EINFACH `journalctl -f` ODER EIN LANGER `pactl`-AUFRUF ══════
# Beides wurde am selben Tag probiert und lieferte nichts:
#   * `journalctl -f` in eine Pipe schreibt GEPUFFERT; wird der Lauf beendet,
#     sind die Zeilen weg. (Derselbe Fehler kostete beim Kiosk-Benchmark
#     zwei Laeufe.)
#   * Ein einzelner Aufruf trifft den Augenblick nicht: der Wechsel dauert
#     Millisekunden.
# Hier wird deshalb ZEHNMAL JE SEKUNDE gezaehlt und sofort in eine Datei
# geschrieben — und es wird protokolliert, WANN sich etwas aendert, nicht der
# Dauerzustand.
#
# ══ WAS ES BEWEIST ═════════════════════════════════════════════════════════
# Steht in der Ausgabe je eine Zeile mit ZWEI ODER MEHR spielenden Stroemen,
# ist das Echo erklaert: derselbe Ton lief ueber zwei Wege. Bleibt es bei
# genau einem, liegt die Ursache woanders — dann ist der naechste Verdaechtige
# der Bluetooth-Puffer selbst oder der Wiederaufbau des Quellknotens.
set -u
DAUER="${1:-90}"
ZIEL=/tmp/echo-spur.txt

{
  echo "=== Echo-Spur, ${DAUER} s, zehnmal je Sekunde ==="
  echo "=== Beginn $(date +%H:%M:%S) — jetzt bitte Titel wechseln ==="
  VORHER=""
  ENDE=$(( $(date +%s) + DAUER ))
  MEHRFACH=0
  while [ "$(date +%s)" -lt "$ENDE" ]; do
    # Nur die SPIELENDEN zaehlen: `Corked: no`. Ein pausierter Strom fuehrt
    # keinen Ton, auch wenn seine Leitung besteht.
    JETZT=$(pactl list sink-inputs 2>/dev/null \
      | awk '/^Sink Input #/{n=$3} /Corked: no/{c=1} /media.name = /{if(c){print n" "$0; c=0}}' \
      | sed 's/media.name = //' | tr -d '"' | sort | tr '\n' '|')
    # AUCH DEN TITEL ERFASSEN, und das fehlte im ersten Entwurf: Bei Spotify
    # Connect bleibt der Tonstrom BESTEHEN, wenn der Titel wechselt — dieselbe
    # Nummer, derselbe media.name. Ein Werkzeug, das nur auf die Stromnummer
    # sieht, bemerkt den Wechsel gar nicht und meldet am Ende „nichts
    # passiert", obwohl zehnmal gewechselt wurde. (Genau so lief der erste
    # Versuch am 20.08.2026 ins Leere.)
    # DIE ZAHL WIRD VOR DEM ANHAENGEN GEBILDET. Im ersten Entwurf wurde der
    # Titel an DENSELBEN String gehaengt, an dem danach die Stroeme gezaehlt
    # wurden — die Zaehlung trennt an "|", und so galt der Titel als zweiter
    # Strom. Das Werkzeug meldete daraufhin „zwei Stroeme gleichzeitig", wo
    # genau einer lief: ein erfundener Beweis fuer die Vermutung, die es
    # pruefen sollte. (20.08.2026, bemerkt beim Auswerten.)
    ANZAHL=$(printf '%s' "$JETZT" | tr '|' '\n' | grep -c . )
    TITEL=$(curl -s --max-time 2 http://localhost:8200/api/spotify/laeuft 2>/dev/null \
      | head -c 600 | tr -d '\n' | grep -oE '"(titel|title|name)":"[^"]*"' | head -1)
    JETZT="${ANZAHL} ${JETZT}${TITEL}"
    if [ "$JETZT" != "$VORHER" ]; then
      echo "$(date +%H:%M:%S.%2N)  spielende Stroeme: ${ANZAHL:-0}  ${JETZT:-<keiner>}"
      [ "${ANZAHL:-0}" -ge 2 ] && MEHRFACH=$((MEHRFACH+1))
      VORHER="$JETZT"
    fi
    sleep 0.1
  done
  echo "=== Ende $(date +%H:%M:%S) ==="
  echo
  if [ "$MEHRFACH" -gt 0 ]; then
    echo "BEFUND: ${MEHRFACH}-mal liefen ZWEI ODER MEHR Stroeme gleichzeitig."
    echo "        Das Echo ist damit erklaert — derselbe Ton nahm zwei Wege."
  else
    echo "BEFUND: Es lief immer hoechstens EIN Strom."
    echo "        Die drei Leitungen sind dann NICHT die Ursache. Naechste"
    echo "        Verdaechtige: der Bluetooth-Puffer selbst, oder der"
    echo "        Wiederaufbau des Quellknotens beim Wechsel."
  fi
} > "$ZIEL" 2>&1

cat "$ZIEL"
