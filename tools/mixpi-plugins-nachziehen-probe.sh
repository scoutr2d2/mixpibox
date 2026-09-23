#!/bin/bash
#
# PROBE fuer scripts/mixpi/mixpi-plugins-nachziehen.sh — jede Regel einmal,
# gegen Wegwerfordner, ohne Box.
#
# WAS HIER GEPRUEFT WIRD (die Regeln stehen im Skript selbst):
#   1. Erstausrollung: fehlendes Ziel wird kopiert.
#   2. Hoehere fassung ersetzt — und zwar GANZ (Altlast-Datei verschwindet).
#   3. Gleichstand bleibt unangetastet (Betreiber-Aenderung ueberlebt).
#   4. Downgrade-Schutz: aeltere Quelle laesst ein neueres Ziel in Ruhe.
#   5. Betreiber-Plugin nur im Ziel bleibt liegen.
#   6. Ziel ohne plugin.json (halber Stand) wird ersetzt.
#   7. sort -V rechnet numerisch: 0.10.0 schlaegt 0.9.0 (Text saehe es andersrum).
#
# AUFRUF: bash tools/mixpi-plugins-nachziehen-probe.sh
# Rueckgabe 0 = alle Regeln halten, 1 = mindestens ein FUND.

set -u

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKRIPT="${HIER}/scripts/mixpi/mixpi-plugins-nachziehen.sh"
WERK=$(mktemp -d)
trap 'rm -rf "${WERK}"' EXIT
QUELLE="${WERK}/quelle"
ZIEL="${WERK}/ziel"
funde=0

fund() { echo "  FUND  $*"; funde=1; }
ok()   { echo "  ok    $*"; }

plugin_bauen() { # ORT KENNUNG FASSUNG
    mkdir -p "$1/$2"
    printf '{"kennung":"%s","fassung":"%s"}\n' "$2" "$3" > "$1/$2/plugin.json"
    echo "fassung $3" > "$1/$2/index.mjs"
}

# ── Aufbau: eine Quelle, ein gewachsenes Ziel ────────────────────────────────
plugin_bauen "${QUELLE}" "mixpi-neu"        "0.1.0"   # (1) nur in der Quelle
plugin_bauen "${QUELLE}" "mixpi-hoeher"     "0.2.0"   # (2) Quelle neuer
plugin_bauen "${QUELLE}" "mixpi-gleich"     "1.0.0"   # (3) Gleichstand
plugin_bauen "${QUELLE}" "mixpi-aelter"     "0.2.0"   # (4) Quelle AELTER
plugin_bauen "${QUELLE}" "mixpi-schutt"     "0.3.0"   # (6) Ziel ohne plugin.json
plugin_bauen "${QUELLE}" "mixpi-zehn"       "0.10.0"  # (7) numerisch vs. Text

plugin_bauen "${ZIEL}" "mixpi-hoeher"  "0.1.0"
echo altlast > "${ZIEL}/mixpi-hoeher/nur-im-alten-stand.txt"
plugin_bauen "${ZIEL}" "mixpi-gleich"  "1.0.0"
echo betreiber > "${ZIEL}/mixpi-gleich/eigene-anpassung.txt"
plugin_bauen "${ZIEL}" "mixpi-aelter"  "2.0.0"
plugin_bauen "${ZIEL}" "mixpi-eigen"   "9.9.9"   # (5) nur im Ziel
mkdir -p "${ZIEL}/mixpi-schutt"; echo halb > "${ZIEL}/mixpi-schutt/rest.txt"
plugin_bauen "${ZIEL}" "mixpi-zehn"    "0.9.0"

bash "${SKRIPT}" "${QUELLE}" "${ZIEL}" >/dev/null || { echo "FUND: Skript stieg mit Fehler aus"; exit 1; }

f() { jq -r .fassung "${ZIEL}/$1/plugin.json" 2>/dev/null; }

# 1. Erstausrollung
[ "$(f mixpi-neu)" = "0.1.0" ] && ok "Erstausrollung kommt an" || fund "mixpi-neu fehlt im Ziel"
# 2. Hoehere fassung ersetzt ganz
[ "$(f mixpi-hoeher)" = "0.2.0" ] && ok "hoehere fassung ersetzt" || fund "mixpi-hoeher blieb auf $(f mixpi-hoeher)"
[ ! -f "${ZIEL}/mixpi-hoeher/nur-im-alten-stand.txt" ] && ok "Altlast verschwindet mit (rm+cp, kein Schichtkuchen)" \
    || fund "Altlast-Datei ueberlebte das Ersetzen"
# 3. Gleichstand unangetastet
[ -f "${ZIEL}/mixpi-gleich/eigene-anpassung.txt" ] && ok "Gleichstand laesst Betreiber-Aenderung leben" \
    || fund "Gleichstand wurde ueberschrieben"
# 4. Downgrade-Schutz
[ "$(f mixpi-aelter)" = "2.0.0" ] && ok "Downgrade-Schutz haelt" || fund "mixpi-aelter wurde auf $(f mixpi-aelter) zurueckgedreht"
# 5. Betreiber-Plugin nur im Ziel
[ "$(f mixpi-eigen)" = "9.9.9" ] && ok "Betreiber-Plugin bleibt liegen" || fund "mixpi-eigen wurde angefasst"
# 6. Halber Stand wird ersetzt
[ "$(f mixpi-schutt)" = "0.3.0" ] && ok "Ziel ohne plugin.json wird ersetzt" || fund "mixpi-schutt blieb Schutt"
# 7. Numerischer Vergleich
[ "$(f mixpi-zehn)" = "0.10.0" ] && ok "0.10.0 schlaegt 0.9.0 (sort -V)" || fund "Textvergleich: 0.9.0 blieb stehen"

# ── Zweiter Lauf: nichts darf sich mehr aendern (wiederholbar) ───────────────
vorher=$(find "${ZIEL}" -type f -newer "${SKRIPT}" | sort | md5sum)
bash "${SKRIPT}" "${QUELLE}" "${ZIEL}" >/dev/null
nachher=$(find "${ZIEL}" -type f -newer "${SKRIPT}" | sort | md5sum)
[ "${vorher}" = "${nachher}" ] && ok "zweiter Lauf aendert nichts" || fund "zweiter Lauf hat Dateien bewegt"

echo
if [ "${funde}" -eq 0 ]; then
    echo "Alle Regeln halten."
else
    echo "Mindestens eine Regel haelt NICHT - siehe FUND-Zeilen."
fi
exit "${funde}"
