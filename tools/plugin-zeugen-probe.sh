#!/usr/bin/env bash
# PLUGIN-ZEUGEN-PROBE — laufen die Zeugen ALLER Plugins noch?
#
# ══ WARUM ES DIESE DATEI GIBT ═══════════════════════════════════════════════
#
# Am 06.09.2026 beim Bau von `mixpi-similar` aufgefallen: zwoelf Plugins im
# Baum bringen je eine `index.spec.mjs` mit, und KEIN Laeufer rief sie. Sie
# liefen nur, wenn jemand von Hand daran dachte — also genau so lange, wie
# jemand an diesem Plugin arbeitete.
#
# Das ist die Falle „eine Wache, die niemand ruft, ist keine Wache"
# (AGENTS.md, Schritt 4). Sie beisst hier besonders leise: die Zeugen eines
# Plugins pruefen den VERTRAG mit dem Kern, und der Kern wandert weiter. Ein
# Plugin rostet damit nicht durch eigene Aenderungen fest, sondern durch
# fremde — und der Bruch faellt erst auf der Box auf, wo er wie ein kaputtes
# Plugin aussieht und nicht wie eine Vertragsaenderung.
#
# WAS DIESE PROBE NICHT IST: das Urteil des echten Kerns. Die Zeugen laufen
# gegen den Pruefstand, und der ist eine NACHBILDUNG — sie kann irren.
# Massgeblich bleibt `npx tsx tools/plugin-pruefen.mjs <ordner>`; diese Probe
# faengt nur ab, dass ein Plugin gar nicht mehr laeuft.
#
# Aufruf:  bash tools/plugin-zeugen-probe.sh
set -u

cd "$(dirname "$0")/.." || exit 1
FRIST=120
FEHLER=0
GELAUFEN=0
OHNE_ZEUGEN=()

echo "── Zeugen aller Plugins (tools/plugin-zeugen-probe.sh) ──"

for ordner in plugins/*/; do
  kennung="$(basename "$ordner")"
  # Nur ECHTE Plugins: ein Ordner ohne Manifest ist keins (`pruefstand.mjs`
  # und `README.md` liegen daneben und sind keine Plugins).
  [ -f "$ordner/plugin.json" ] || continue

  # ALLE `*.spec.mjs`, NICHT NUR `index.spec.mjs`. Die erste Fassung dieser
  # Wache suchte nur die eine Datei — und lief damit genau in die Falle, gegen
  # die sie gebaut ist: `mixpi-similar/wachliste.spec.mjs` entstand einen Tag
  # spaeter, war 39 Zeugen stark und waere von keinem Laeufer je gerufen
  # worden. Eine Wache, die nur den erwarteten Dateinamen kennt, waechst mit
  # dem Baum nicht mit.
  zeugen=()
  while IFS= read -r datei; do zeugen+=("$datei"); done < <(find "$ordner" -maxdepth 2 -name '*.spec.mjs' | sort)

  if [ "${#zeugen[@]}" -eq 0 ]; then
    # KEIN FEHLER, ABER EINE AUSKUNFT. Zeugen sind freiwillig, wie alle
    # Methoden des Vertrags. Still uebergehen wuerde aber verdecken, dass ein
    # Plugin ungeprueft mitfaehrt — und genau das soll man sehen.
    OHNE_ZEUGEN+=("$kennung")
    continue
  fi

  GELAUFEN=$((GELAUFEN + 1))
  if ausgabe=$(timeout "$FRIST" node --test "${zeugen[@]}" 2>&1); then
    anzahl=$(printf '%s\n' "$ausgabe" | sed -n 's/^. pass \([0-9]*\)$/\1/p' | tail -1)
    dateien=""
    [ "${#zeugen[@]}" -gt 1 ] && dateien=" in ${#zeugen[@]} Dateien"
    echo "  ok   $kennung (${anzahl:-?} Zeugen${dateien})"
  else
    ausgang=$?
    if [ "$ausgang" -eq 124 ]; then
      echo " FEHL  $kennung — der Lauf haengt (${FRIST}s)"
    else
      echo " FEHL  $kennung"
      printf '%s\n' "$ausgabe" | sed -n 's/^ *✖/       ✖/p' | head -5
    fi
    FEHLER=$((FEHLER + 1))
  fi
done

if [ "${#OHNE_ZEUGEN[@]}" -gt 0 ]; then
  echo "  ——   ohne eigene Zeugen: ${OHNE_ZEUGEN[*]}"
fi

echo
if [ "$FEHLER" -eq 0 ]; then
  echo "KEINE LUECKE. $GELAUFEN Plugins mit Zeugen, alle gruen."
  exit 0
fi
echo "$FEHLER von $GELAUFEN Plugins haben rote Zeugen."
exit 1
