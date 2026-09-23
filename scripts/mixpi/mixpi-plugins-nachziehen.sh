#!/bin/bash
#
# PLUGINS VERSIONIERT NACHZIEHEN (MixPi, 22.08.2026).
#
# ══ WARUM ES DIESES SKRIPT GIBT ═════════════════════════════════════════════
#
# In beiden Schalen-Wegen (autosetup.sh und update/start_mupibox_update.sh)
# stand bis heute `cp -rn` — no-clobber. Das klang wie Ruecksicht ("was da
# liegt, gehoert dem Betreiber"), war aber eine Falle mit Verfallsdatum:
# einmal ausgerollt wurde ein Plugin NIE WIEDER aktualisiert, waehrend Server
# und Plugin-Vertrag weiterwanderten. Ein Update haette irgendwann einen Wirt
# gebracht, der mit dem eingefrorenen Plugin von vor einem Jahr reden muss —
# und der Fehler saehe aus wie ein kaputtes Plugin, nicht wie ein Kopierbefehl.
#
# ══ DIE REGEL ═══════════════════════════════════════════════════════════════
#
#   Ziel fehlt                      -> kopieren        (Erstausrollung)
#   fassung(Quelle) NEUER als Ziel  -> ERSETZEN        (rm + cp: ein Plugin ist
#                                      ein Stand, kein Schichtkuchen — blosses
#                                      Drueberkopieren liesse Dateien des alten
#                                      Standes liegen, dieselbe Fehlerklasse
#                                      wie die chunk-<hash>.js beim Angular-Bau)
#   fassung gleich oder aelter      -> NICHTS tun      (Downgrade-Schutz: ein
#                                      altes Installationspaket darf ein
#                                      neueres Plugin nicht zurueckdrehen)
#   Ziel ohne plugin.json           -> ersetzen        (ein halber Stand ist
#                                      kein Betreiber-Eigentum, sondern Schutt)
#   Ordner NUR im Ziel              -> unangetastet    (gehoert dem Betreiber)
#
# Verglichen wird `fassung` aus plugin.json, numerisch je Stelle (sort -V):
# 0.10.0 ist NEUER als 0.9.0 — ein Textvergleich saehe das andersherum.
#
# ══ NAEHTE FUER DIE PROBE (tools/mixpi-plugins-nachziehen-probe.sh) ═════════
#
# Quelle und Ziel kommen als Argumente, chown laeuft nur als root — das
# Skript laesst sich damit gefahrlos gegen Wegwerfordner fahren.
#
# Aufruf:
#     mixpi-plugins-nachziehen.sh QUELLE [ZIEL]
# z. B. aus den Ausrollwegen:
#     /usr/local/bin/mupibox/mixpi-plugins-nachziehen.sh ${MUPI_SRC}/plugins
#
# Rueckgabe: 0, auch wenn einzelne Plugins scheitern (eine Box ohne frisches
# Plugin ist keine kaputte Box); 2 nur bei unbrauchbarem Aufruf.

set -u

QUELLE="${1:-}"
ZIEL="${2:-/home/dietpi/.mupibox/plugins}"
BESITZER="${MIXPI_PLUGIN_BESITZER:-dietpi:dietpi}"

sag() { echo "[mixpi-plugins-nachziehen] $*"; }

if [ -z "${QUELLE}" ]; then
    sag "Aufruf: $0 QUELLE [ZIEL]" >&2
    exit 2
fi
if [ ! -d "${QUELLE}" ]; then
    # Kein Fehler: ein Paket ohne plugins/ ist ein altes Paket, keine kaputte Box.
    sag "Quelle ${QUELLE} fehlt - nichts nachzuziehen"
    exit 0
fi

mkdir -p "${ZIEL}" || exit 2

fassung_von() {
    # plugin.json fehlt oder ist unlesbar -> "0" (aelter als alles Echte).
    local wert
    wert=$(jq -r '.fassung // "0"' "$1/plugin.json" 2>/dev/null) || wert="0"
    [ -n "${wert}" ] || wert="0"
    echo "${wert}"
}

for quelle in "${QUELLE}"/*/; do
    [ -d "${quelle}" ] || continue
    kennung=$(basename "${quelle}")
    ziel="${ZIEL}/${kennung}"

    if [ ! -f "${quelle}/plugin.json" ]; then
        # Kein Plugin (kein Vertrag) - wird nicht ausgerollt, aber benannt,
        # damit es nicht aussieht wie vergessen.
        sag "${kennung}: keine plugin.json in der Quelle - uebersprungen"
        continue
    fi

    neu=$(fassung_von "${quelle%/}")
    if [ ! -d "${ziel}" ]; then
        cp -r "${quelle%/}" "${ziel}" && sag "${kennung}: neu ausgerollt (${neu})" \
            || sag "${kennung}: Kopie GESCHEITERT"
        continue
    fi

    alt=$(fassung_von "${ziel}")
    if [ "${neu}" = "${alt}" ]; then
        sag "${kennung}: ${alt} bleibt (Gleichstand)"
        continue
    fi
    # sort -V nennt die NEUERE zuletzt. Ist das nicht die Quelle, waere die
    # Kopie ein Downgrade - und Nichtstun die richtige Handlung.
    if [ "$(printf '%s\n%s\n' "${alt}" "${neu}" | sort -V | tail -n 1)" != "${neu}" ]; then
        sag "${kennung}: Ziel ${alt} ist NEUER als Quelle ${neu} - bleibt unangetastet"
        continue
    fi
    rm -rf "${ziel}" && cp -r "${quelle%/}" "${ziel}" \
        && sag "${kennung}: ${alt} -> ${neu} ersetzt" \
        || sag "${kennung}: Ersetzen GESCHEITERT (${alt} -> ${neu})"
done

# Auf der Box laeuft das als root und der Wirt liest als dietpi; in der
# Probe laeuft es als Benutzer gegen Wegwerfordner - dort waere chown nur Laerm.
if [ "$(id -u)" -eq 0 ]; then
    chown -R "${BESITZER}" "${ZIEL}"
fi

exit 0
