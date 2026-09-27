#!/usr/bin/env bash
#
# KOMM TROTZDEM DURCH — der Update-Bestand unter Beschuss.
#
# `tools/update-bestand-probe.py` prueft den gewoehnlichen Lauf, 74
# Abbruchstellen und die Deckung. Dieses Werkzeug fragt nach dem, was DAZWISCHEN
# nicht vorkommt: was liegt im Hort, wenn er NICHT so aussieht, wie der letzte
# Lauf ihn hinterlassen haette?
#
# ══ DER BEFUND, DER DAS AUSGELOEST HAT ═════════════════════════════════════
# Die beiden Haelften pruefen VERSCHIEDEN:
#
#     mupi_bestand_beiseite:   if [ -e "${MUPI_HORT}/config" ]; then :  # nicht anfassen
#     mupi_bestand_zurueck:    if [ -d "${MUPI_HORT}/config" ]; then ... zurueckstellen
#
# `-e` ist wahr fuer ALLES, was existiert — auch fuer eine gewoehnliche Datei
# und fuer einen Verweis. `-d` ist nur fuer ein Verzeichnis wahr. Steht an
# ${MUPI_HORT}/config etwas, das kein Verzeichnis ist, dann
#
#     1. legt `beiseite` den Bestand NICHT beiseite (es glaubt, er liege schon
#        im Hort),
#     2. loescht das Update den Baum mit `rm -R`,
#     3. stellt `zurueck` nichts zurueck (es findet kein Verzeichnis).
#
# Der Bestand ist dann weg — und zwar still, mit Rueckgabewert 0 an beiden
# Stellen. Genau die Bauart, gegen die die ganze Reparatur gebaut ist.
#
# ES WIRD KEIN UPDATE GEFAHREN. Aufgerufen werden nur die beiden markierten
# Bloecke aus dem echten Skript, gegen einen Baum unter $TMPDIR. Das `rm -R`
# des Updates wird an der Stelle, an der es stuende, NACHGESTELLT — sonst
# liesse sich der Verlust nicht zeigen. Die Box wird nicht beruehrt.
#
# AUFRUF:  bash tools/durchkommen-update.sh
# Rueckgabewert 0, wenn kein Fall den Bestand verliert.

set -u

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKRIPT="${MUPI_UPDATE_SKRIPT:-$HIER/../update/start_mupibox_update.sh}"

gruen=0
rot=0
melde() {
  if [ "$1" = 0 ]; then
    gruen=$((gruen + 1)); printf '  OK    %s — %s\n' "$2" "$3"
  else
    rot=$((rot + 1));    printf '  ROT   %s — %s\n' "$2" "$3"
  fi
}

SAND="$(mktemp -d "${TMPDIR:-/tmp}/mupi-durchkommen-update-XXXXXX")"
trap 'rm -rf "$SAND"' EXIT
case "$SAND" in
  "${TMPDIR:-/tmp}"/*) ;;
  *) echo "Sandkasten liegt nicht im Temp-Verzeichnis: $SAND" >&2; exit 1 ;;
esac

# Die markierten Bloecke aus dem echten Skript herausschneiden — nicht
# nacherzaehlen. Faellt die Marke weg, bricht das hier ab statt gruen zu sein.
BLOCK="$SAND/bloecke.sh"
awk '/# >>> MUPI-BESTAND-WERKZEUG-ANFANG >>>/{an=1} an{print} /# <<< MUPI-BESTAND-WERKZEUG-ENDE <<</{an=0}' \
  "$SKRIPT" > "$BLOCK"
if ! grep -q 'mupi_bestand_zurueck' "$BLOCK" || ! grep -q 'mupi_bestand_beiseite' "$BLOCK"; then
  echo "Die Marken MUPI-BESTAND-WERKZEUG-* stehen nicht mehr in $SKRIPT — nichts gemessen." >&2
  exit 1
fi

# ── Einen benutzten Baum bauen ─────────────────────────────────────────────
baum_bauen() { # baum_bauen <wurzel>
  local w="$1"
  mkdir -p "$w/baum/server/config/profile/kalea" "$w/baum/www/themes"
  echo '{"aktiv":true}'      > "$w/baum/server/config/config.json"
  echo '[{"titel":"Bibi"}]'  > "$w/baum/server/config/data.json"
  echo '{"pos":42}'          > "$w/baum/server/config/profile/kalea/resume.json"
  ln -sf profile/kalea/resume.json "$w/baum/server/config/resume.json"
  echo 'body{}'              > "$w/baum/www/themes/blau.css"
  ln -sf themes/blau.css     "$w/baum/www/active_theme.css"
  mkdir -p "$w/baum/www/cover/audiobook/Bibi"
  echo 'bild'                > "$w/baum/www/cover/audiobook/Bibi/1.png"
  # Das, was deploy.zip mitbringt und was das Update ersetzen DARF.
  echo 'alt' > "$w/baum/server/server.js"
}

# Was von den Nutzdaten noch da ist.
bestand_zaehlen() { # bestand_zaehlen <wurzel>
  local w="$1" n=0
  for f in \
    "$w/baum/server/config/config.json" \
    "$w/baum/server/config/data.json" \
    "$w/baum/server/config/profile/kalea/resume.json" \
    "$w/baum/www/cover/audiobook/Bibi/1.png"; do
    [ -e "$f" ] && n=$((n + 1))
  done
  [ -L "$w/baum/www/active_theme.css" ] && n=$((n + 1))
  [ -L "$w/baum/server/config/resume.json" ] && n=$((n + 1))
  echo "$n"
}
VOLL=6

# ── Ein ganzer Update-Lauf, so weit er den Bestand betrifft ────────────────
#
# beiseite -> (das rm -R des Updates) -> auspacken -> zurueck
lauf() { # lauf <wurzel>  -> gibt "<beiseite-code> <zurueck-code>" aus
  local w="$1"
  env -i PATH="$PATH" HOME="$HOME" bash -c '
    set -u
    MUPI_BAUM="$1/baum"
    MUPI_HORT="$1/hort"
    . "$2"
    if mupi_bestand_beiseite; then b=0; else b=1; fi
    if [ $b = 0 ]; then
      # HIER STEHT IM ECHTEN SKRIPT DAS `rm -R`. Nachgestellt, weil sich der
      # Verlust sonst nicht zeigen laesst.
      rm -R "${MUPI_BAUM}" 2>/dev/null
      mkdir -p "${MUPI_BAUM}/server"
      echo neu > "${MUPI_BAUM}/server/server.js"     # das Auspacken
    fi
    if mupi_bestand_zurueck; then z=0; else z=1; fi
    echo "$b $z"
  ' _ "$w" "$BLOCK"
}

echo "KOMM TROTZDEM DURCH — Update-Bestand, Sandkasten $SAND"
echo

# ── 1. GEGENPROBE: der gewoehnliche Lauf verliert nichts ───────────────────
w="$SAND/normal"; mkdir -p "$w"; baum_bauen "$w"
erg="$(lauf "$w")"; n="$(bestand_zaehlen "$w")"
melde $([ "$n" = "$VOLL" ] && echo 0 || echo 1) \
  'GEGENPROBE: gewoehnlicher Lauf' \
  "$n von $VOLL Stuecken wieder da (beiseite/zurueck: $erg)"

# ── 2. ABGEBROCHENER LAUF: der Hort steht schon da, richtig ────────────────
w="$SAND/abbruch"; mkdir -p "$w"; baum_bauen "$w"
mkdir -p "$w/hort"
mv "$w/baum/server/config" "$w/hort/config"
erg="$(lauf "$w")"; n="$(bestand_zaehlen "$w")"
melde $([ "$n" = "$VOLL" ] && echo 0 || echo 1) \
  'nach Abbruch: Hort liegt schon richtig' \
  "$n von $VOLL Stuecken wieder da (beiseite/zurueck: $erg)"

# ── 3. IM HORT LIEGT EINE DATEI STATT EINES VERZEICHNISSES ─────────────────
# `-e` in beiseite ist wahr, `-d` in zurueck ist falsch. Das ist die Luecke.
w="$SAND/hortdatei"; mkdir -p "$w"; baum_bauen "$w"
mkdir -p "$w/hort"; echo 'kaputt' > "$w/hort/config"
erg="$(lauf "$w")"; n="$(bestand_zaehlen "$w")"
melde $([ "$n" = "$VOLL" ] && echo 0 || echo 1) \
  'im Hort liegt eine DATEI namens config' \
  "$n von $VOLL Stuecken wieder da (beiseite/zurueck: $erg)$([ "$n" != "$VOLL" ] && echo '  ← BESTAND WEG, und beide Haelften melden Erfolg')"

# ── 4. IM HORT LIEGT EIN TOTER VERWEIS ─────────────────────────────────────
w="$SAND/hortverweis"; mkdir -p "$w"; baum_bauen "$w"
mkdir -p "$w/hort"; ln -s /gibtesnicht "$w/hort/config"
erg="$(lauf "$w")"; n="$(bestand_zaehlen "$w")"
melde $([ "$n" = "$VOLL" ] && echo 0 || echo 1) \
  'im Hort liegt ein TOTER VERWEIS namens config' \
  "$n von $VOLL Stuecken wieder da (beiseite/zurueck: $erg)"

# ── 5. IM HORT LIEGT EIN VERWEIS AUF EIN VERZEICHNIS ───────────────────────
w="$SAND/hortlink"; mkdir -p "$w"; baum_bauen "$w"
mkdir -p "$w/hort" "$w/woanders"; echo 'fremd' > "$w/woanders/fremd.json"
ln -s "$w/woanders" "$w/hort/config"
erg="$(lauf "$w")"; n="$(bestand_zaehlen "$w")"
melde $([ "$n" = "$VOLL" ] && echo 0 || echo 1) \
  'im Hort liegt ein VERWEIS auf ein fremdes Verzeichnis' \
  "$n von $VOLL Stuecken wieder da (beiseite/zurueck: $erg)"

# ── 6. DER HORT SELBST IST EINE DATEI ──────────────────────────────────────
w="$SAND/hortistdatei"; mkdir -p "$w"; baum_bauen "$w"
echo 'kaputt' > "$w/hort"
erg="$(lauf "$w")"; n="$(bestand_zaehlen "$w")"
melde $([ "$n" = "$VOLL" ] && echo 0 || echo 1) \
  'der Hort selbst ist eine Datei (mkdir scheitert)' \
  "$n von $VOLL Stuecken wieder da (beiseite/zurueck: $erg)"

# ── 7. server/config FEHLT GANZ ────────────────────────────────────────────
w="$SAND/ohneconfig"; mkdir -p "$w"; baum_bauen "$w"
rm -rf "$w/baum/server/config"
erg="$(lauf "$w")"
melde $([ "${erg%% *}" = 1 ] && echo 0 || echo 1) \
  'ohne server/config wird NICHT geloescht' \
  "beiseite/zurueck: $erg (erwartet: beiseite meldet 1)"

# ── 8. ZWEIMAL ZURUECKSTELLEN AENDERT NICHTS ───────────────────────────────
w="$SAND/zweimal"; mkdir -p "$w"; baum_bauen "$w"
erg="$(lauf "$w")"
env -i PATH="$PATH" HOME="$HOME" bash -c '
  MUPI_BAUM="$1/baum"; MUPI_HORT="$1/hort"; . "$2"; mupi_bestand_zurueck
' _ "$w" "$BLOCK" >/dev/null 2>&1
n="$(bestand_zaehlen "$w")"
melde $([ "$n" = "$VOLL" ] && echo 0 || echo 1) \
  'zweimal zurueckstellen aendert nichts' \
  "$n von $VOLL Stuecken da"

echo
echo "$gruen gruen, $rot rot"
[ "$rot" = 0 ]
