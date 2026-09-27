#!/bin/bash
# SHELLCHECK-RATSCHE — der Bestand darf schlecht sein, er darf nur nicht
# SCHLECHTER werden.
#
# WARUM EINE RATSCHE UND KEIN VERBOT (29.08.2026, AUDIT-29 §4.1)
# Die 118 .sh-Dateien dieses Baums tragen hunderte Bestandsbefunde; ein Hook,
# der sie alle meldet, waere vom ersten Tag an dauerrot — und eine dauerrote
# Wache ist keine (llmwiki: dauerrote-wache-ist-keine). Deshalb wird der
# Bestand EINGEFROREN (tools/shellcheck-baseline.txt) und nur die
# VERSCHLECHTERUNG blockt: mehr Befunde in einer Datei als eingefroren, oder
# Befunde in einer Datei, die die Baseline nicht kennt (neue Skripte muessen
# sauber sein).
#
# WAS ES FAENGT — die Fehlerklasse ist belegt: check_network.sh:83 fuehrte
# in einer Subshell das KOMMANDO `true == online` aus statt zu vergleichen;
# es funktionierte nur, weil `true` ein Programm ist, das seine Argumente
# ignoriert. Genau solche Zeilen meldet shellcheck als Fehler.
#
# GEZAEHLT wird ab --severity=warning (error+warning). info/style bleiben
# draussen: sie sind zu zahlreich, und die Ratsche soll Fehler fangen, nicht
# Geschmack durchsetzen.
#
# AUFRUF
#   tools/shellcheck-ratsche.sh --pruefen              alle Dateien gegen die
#                                                      Baseline; still, Exit 1
#                                                      bei Verschlechterung
#   tools/shellcheck-ratsche.sh --pruefen DATEI...     nur diese Dateien
#   tools/shellcheck-ratsche.sh --index                die GESTAGTEN .sh-Dateien,
#                                                      gemessen am INDEX-Inhalt
#                                                      (fuer den pre-commit-Hook:
#                                                      eine im Baum gerichtete,
#                                                      aber nicht gestagte Datei
#                                                      waere sonst gruen und der
#                                                      Commit trotzdem schlecht)
#   tools/shellcheck-ratsche.sh --einfrieren           Baseline neu schreiben
#                                                      (nach bewusster
#                                                      Verbesserung)
#   tools/shellcheck-ratsche.sh                        Bericht je Datei
#
# OHNE INSTALLIERTES shellcheck bricht die Pruefung mit Anleitung ab statt
# still durchzuwinken — eine Wache, die bei fehlendem Werkzeug gruen ist,
# prueft nichts und sieht dabei aus, als pruefte sie.

set -u
cd "$(dirname "$0")/.." || exit 1

BASELINE="tools/shellcheck-baseline.txt"
SEVERITY="warning"

if ! command -v shellcheck >/dev/null 2>&1; then
    echo "shellcheck fehlt. Installation ohne root:" >&2
    echo "  curl -sL https://github.com/koalaman/shellcheck/releases/download/v0.11.0/shellcheck-v0.11.0.linux.x86_64.tar.xz | tar xJ -O shellcheck-v0.11.0/shellcheck > ~/.local/bin/shellcheck && chmod +x ~/.local/bin/shellcheck" >&2
    exit 1
fi

MODUS="bericht"
DATEIEN=()
for a in "$@"; do
    case "$a" in
        --pruefen)    MODUS="pruefen" ;;
        --einfrieren) MODUS="einfrieren" ;;
        --index)      MODUS="index" ;;
        *)            DATEIEN+=("$a") ;;
    esac
done

# ── INDEX-MODUS: die gestagten .sh-Dateien, mit ihrem Index-Inhalt ─────────
if [ "$MODUS" = "index" ]; then
    fehler=0
    while IFS= read -r f; do
        case "$f" in *.sh) ;; *) continue ;; esac
        tmp=$(mktemp)
        git show ":$f" > "$tmp" 2>/dev/null || { rm -f "$tmp"; continue; }
        ist=$(shellcheck --severity="$SEVERITY" --format=gcc "$tmp" 2>/dev/null | wc -l)
        soll=$(awk -v p="$f" '$2 == p { print $1 }' "$BASELINE" 2>/dev/null)
        soll=${soll:-0}
        if [ "$ist" -gt "$soll" ]; then
            fehler=1
            echo "SCHLECHTER (Index): $f — $ist Befund(e), eingefroren sind $soll:"
            shellcheck --severity="$SEVERITY" --format=gcc "$tmp" 2>/dev/null \
                | sed "s|$tmp|$f|" | tail -n "$((ist - soll))" | sed 's/^/    /'
        fi
        rm -f "$tmp"
    done < <(git diff --cached --name-only --diff-filter=ACMR)
    exit "$fehler"
fi

# Der Bestand: alles Getrackte mit .sh-Endung. node_modules/deploy sind nicht
# getrackt und fallen damit von selbst heraus; git ist hier die Wahrheit,
# nicht find — ein untracktes Probeskript soll den Commit nicht aufhalten.
alle_dateien() {
    git ls-files '*.sh'
}

# Befunde einer Datei zaehlen. shellcheck endet mit 1 bei Befunden — die
# Zahl kommt aus den gezaehlten Meldungszeilen (gcc-Format: eine je Befund).
zaehle() {
    shellcheck --severity="$SEVERITY" --format=gcc "$1" 2>/dev/null | wc -l
}

baseline_wert() {
    # "anzahl pfad" — der Pfad kann Leerzeichen nicht enthalten (git ls-files
    # dieses Repos liefert keine), das Format bleibt bewusst simpel.
    awk -v p="$1" '$2 == p { print $1 }' "$BASELINE" 2>/dev/null
}

if [ "$MODUS" = "einfrieren" ]; then
    { echo "# shellcheck-Baseline — je Zeile: <befunde ab --severity=$SEVERITY> <datei>"
      echo "# Eingefroren am $(date +%Y-%m-%d). Neu einfrieren: tools/shellcheck-ratsche.sh --einfrieren"
      while IFS= read -r f; do
          echo "$(zaehle "$f") $f"
      done < <(alle_dateien)
    } > "$BASELINE"
    echo "Baseline eingefroren: $(grep -vc '^#' "$BASELINE") Dateien, $(grep -v '^#' "$BASELINE" | awk '{s+=$1} END {print s}') Befunde."
    exit 0
fi

if [ ${#DATEIEN[@]} -eq 0 ]; then
    mapfile -t DATEIEN < <(alle_dateien)
fi

fehler=0
for f in "${DATEIEN[@]}"; do
    [ -f "$f" ] || continue
    case "$f" in *.sh) ;; *) continue ;; esac
    ist=$(zaehle "$f")
    soll=$(baseline_wert "$f")
    soll=${soll:-0}
    if [ "$ist" -gt "$soll" ]; then
        fehler=1
        echo "SCHLECHTER: $f — $ist Befund(e), eingefroren sind $soll:"
        shellcheck --severity="$SEVERITY" --format=gcc "$f" 2>/dev/null | tail -n "$((ist - soll))" | sed 's/^/    /'
    elif [ "$MODUS" = "bericht" ]; then
        if [ "$ist" -lt "$soll" ]; then
            echo "besser:     $f — $ist statt $soll (Baseline nachziehen: --einfrieren)"
        elif [ "$ist" -gt 0 ]; then
            echo "bestand:    $f — $ist Befund(e), eingefroren"
        fi
    fi
done

if [ "$fehler" -eq 1 ]; then
    echo
    echo "Die Ratsche blockt: neue shellcheck-Befunde gegenueber $BASELINE."
    echo "Beheben — oder, wenn der Befund BEWUSST bleibt, mit einem"
    echo "shellcheck-disable-Kommentar samt Begruendung an der Zeile markieren."
fi
exit "$fehler"
