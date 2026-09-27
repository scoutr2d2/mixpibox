#!/bin/bash
# GENAU EINE STUFE REGELT — am echten mupi-lautstaerke.sh geprueft.
#
# WAS GEPRUEFT WIRD (Befund vom 23.08.2026, am Geraet gemessen): der Regler der
# Box zeigte 100 %, und trotzdem war sie leise. Dahinter lagen ZWEI Stufen mit
# Altlast — der Entzerrer auf 60 % (-13 dB) und die Tonkarte auf 7 % (-69 dB).
# Beide waren einmal die Vorgabe-Senke gewesen; als eine neue Stufe davorwuchs,
# blieb ihr Wert liegen, und der Regler kam nie wieder hin.
#
# `einheit_nachziehen` zieht deshalb bei jedem `set` alle NICHT-regelnden
# Senken auf 100 %. Diese Probe haelt die zwei Haelften der Aussage fest:
#   * die gestrandeten Stufen WERDEN angefasst, und
#   * die regelnde Senke wird es NICHT — sonst uebertoente das Nachziehen
#     genau den Wert, den der Aufrufer gerade setzen wollte.
#
# ══ WELCHE STUFE REGELT, HAT SICH AM 04.09.2026 GEDREHT (2d368af1) ═══════
#
# HIER STAND „die Vorgabe-Senke regelt". Das galt bis zum 04.09.2026. Seither
# regelt die HARDWARE-Senke — die letzte Stufe, hinter der nichts mehr kommt
# (`regelnde_senke_name` waehlt `bluez_output`/`alsa_output`, nicht mehr
# `pactl get-default-sink`). Grund: die Vorgabe-Senke WECHSELT im Betrieb,
# und mit ihr wanderte der Regler; ausserdem plaettete das Nachziehen die im
# TON-Abschnitt einzeln eingemessenen Hardware-Ausgaben.
#
# DIE PROBE IST DABEI STEHENGEBLIEBEN und meldete seit dem 04.09. rot — drei
# ihrer sechs Messungen beschrieben eine Fassung, die es nicht mehr gibt.
# Sie behauptete, die Tonkarte muesse auf Einheit gezogen werden (heute
# absichtlich NICHT), das Klangwerk duerfe nicht angefasst werden (heute ist
# es eine Durchreiche wie jede andere) und der Wunschwert komme bei
# `@DEFAULT_AUDIO_SINK@` an (heute bei der ID der Hardware-Senke). Rot war
# also die WACHE, nicht das Skript. Gerichtet am 19.09.2026, mitsamt dem
# Grund, warum sie es nicht von selbst merkte: sie prueft die AUSGABE des
# Skripts, nicht seine ABSICHT — und eine Ausgabe, die sich aendern DARF,
# braucht einen Text daneben, der sagt, warum sie so aussieht.
#
# WIE: das echte Skript laeuft. `pw-dump`, `pactl` und `wpctl` sind Attrappen
# ganz vorne im PATH — `jq` ist ECHT, denn die Auswahl der Stufen steckt in
# einem jq-Ausdruck, und den nachzubauen hiesse, die Probe gegen sich selbst
# zu pruefen.
#
#   Aufruf:  bash tools/lautstaerke-einheit-probe.sh
set -u

WURZEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKRIPT="$WURZEL/scripts/mupibox/mupi-lautstaerke.sh"
command -v jq >/dev/null 2>&1 || { echo "jq fehlt"; exit 2; }

WERK="$(mktemp -d)"
trap 'rm -rf "$WERK"' EXIT
mkdir -p "$WERK/attrappen"

# Der gemessene Zustand der Box, als Vorlage: klangwerk regelt (1.0),
# entzerrer und Tonkarte sind gestrandet, mixpi-mitschnitt steht schon richtig.
cat > "$WERK/lage.json" <<'JSON'
[
 {"id":77,"type":"PipeWire:Interface:Node","info":{"props":{"media.class":"Audio/Sink","node.name":"klangwerk"},"params":{"Props":[{"channelVolumes":[0.5,0.5]}]}}},
 {"id":38,"type":"PipeWire:Interface:Node","info":{"props":{"media.class":"Audio/Sink","node.name":"entzerrer"},"params":{"Props":[{"channelVolumes":[0.216,0.216]}]}}},
 {"id":62,"type":"PipeWire:Interface:Node","info":{"props":{"media.class":"Audio/Sink","node.name":"alsa_output.stereo-fallback"},"params":{"Props":[{"channelVolumes":[0.000343,0.000343]}]}}},
 {"id":33,"type":"PipeWire:Interface:Node","info":{"props":{"media.class":"Audio/Sink","node.name":"mixpi-mitschnitt"},"params":{"Props":[{"channelVolumes":[1.0,1.0]}]}}},
 {"id":83,"type":"PipeWire:Interface:Node","info":{"props":{"media.class":"Stream/Output/Audio","node.name":"klangwerk.ausgang"},"params":{"Props":[{"channelVolumes":[0.5,0.5]}]}}}
]
JSON

printf '#!/bin/bash\ncat "%s"\n' "$WERK/lage.json" > "$WERK/attrappen/pw-dump"
printf '#!/bin/bash\n[ "$1" = "get-default-sink" ] && echo klangwerk\nexit 0\n' > "$WERK/attrappen/pactl"
# DIE ATTRAPPE MUSS ZURUECKGEBEN, WAS SIE ANGENOMMEN HAT.
#
# Hier antwortete `get-volume` fest „Volume: 1.00". Damit lief das Skript bei
# JEDEM Lauf in seine Notbremse („der Stellbefehl wurde ignoriert") — die
# Ruecklese aus E94, die eine stillschweigend nicht gestellte Senke aufdecken
# soll. Eine Gegenstelle, die immer dasselbe sagt, prueft diesen Weg nicht,
# sie umgeht ihn: die Probe war gruen fuer ein Skript, das dauerhaft in den
# Panikpfad faellt. Jetzt merkt sich die Attrappe den zuletzt gesetzten Wert
# je Ziel und gibt ihn zurueck — so misst der Lauf den NORMALFALL, und der
# Sonderfall wird weiter unten eigens angesteuert (MUPI_PROBE_STUR=1).
cat > "$WERK/attrappen/wpctl" <<EOF
#!/bin/bash
stand="$WERK/stand"
[ "\$1" = "status" ] && exit 0
if [ "\$1" = "get-volume" ]; then
  # Ohne gemerkten Wert: Einheit. Mit: der zuletzt angenommene, auf der
  # echten Skala (wpctl druckt Bruch, nicht Prozent).
  p="\$(grep -E "^\$2 " "\$stand" 2>/dev/null | tail -1 | cut -d' ' -f2)"
  [ -z "\$p" ] && { echo "Volume: 1.00"; exit 0; }
  awk -v p="\$p" 'BEGIN{ printf "Volume: %.2f\\n", p/100 }'
  exit 0
fi
echo "\$*" >> "$WERK/gesetzt"
# STUR=1: annehmen, aber nicht uebernehmen — genau das Verhalten, das die
# Ruecklese aufdecken soll.
if [ "\$1" = "set-volume" ] && [ -z "\${MUPI_PROBE_STUR:-}" ]; then
  echo "\$2 \${3%\%}" >> "\$stand"
fi
exit 0
EOF
chmod +x "$WERK/attrappen"/*
: > "$WERK/gesetzt"
: > "$WERK/stand"

PFAD="$WERK/attrappen:$(dirname "$(command -v jq)"):/usr/bin:/bin"
for w in wpctl pw-dump pactl; do
  g="$(PATH="$PFAD" command -v $w)"
  [ "$g" = "$WERK/attrappen/$w" ] || { echo "ABBRUCH: $w waere das echte gewesen ($g)"; exit 2; }
done
[ -n "$(PATH="$PFAD" command -v jq)" ] || { echo "ABBRUCH: jq nicht im PATH der Probe"; exit 2; }

cat > "$WERK/konfig.json" <<'JSON'
{"mupibox":{"startVolume":"20","maxVolume":"100"}}
JSON

PATH="$PFAD" MUPIBOX_CONFIG="$WERK/konfig.json" bash "$SKRIPT" set 50 >/dev/null 2>"$WERK/err"

fehler=0
pruefe() { # name, muster, erwartet(ja/nein)
  if grep -qE "$2" "$WERK/gesetzt"; then da=ja; else da=nein; fi
  if [ "$da" = "$3" ]; then
    printf '  ok    %s\n' "$1"
  else
    printf '  FEHLT %s  (erwartet: %s, gefunden: %s)\n' "$1" "$3" "$da"; fehler=1
  fi
}

echo
echo "  GENAU EINE STUFE REGELT"
echo "  ─────────────────────────────────────────────────────────────"
# Die KETTEN-Stationen (virtuelle Senken) sind Durchreiche und gehoeren auf
# Einheit — egal, welche von ihnen gerade die Vorgabe-Senke ist.
pruefe "der Entzerrer (60 %) wird auf Einheit gezogen"        '^set-volume 38 100%$'  ja
pruefe "das Klangwerk (50 %) ebenso — auch als VORGABE-Senke" '^set-volume 77 100%$'  ja
pruefe "was schon auf Einheit steht, wird nicht angefasst"    '^set-volume 33 100%$'  nein
pruefe "ein Strom ist keine Stufe und bleibt liegen"          '^set-volume 83 100%$'  nein
# Und die HARDWARE-Senke traegt seit dem 04.09.2026 die Nutzerlautstaerke.
# Beide Haelften, denn einzeln sagt keine genug: sie wird NICHT geplaettet
# (sonst stellte der Regler sich bei jedem `set` selbst zurueck) UND der
# gewuenschte Wert kommt wirklich bei ihr an.
pruefe "die Tonkarte wird NICHT auf Einheit gezogen (sie regelt)" '^set-volume 62 100%$' nein
pruefe "und der gewuenschte Wert kommt bei ihr an"            '^set-volume 62 50%$'   ja

# ── DIE RUECKLESE AUS E94, IN BEIDE RICHTUNGEN ──────────────────────────
#
# `set` liest nach 0,3 s zurueck und warnt, wenn die Senke den Wert nicht
# angenommen hat. Ohne die zweite Richtung beweist die erste nichts: eine
# Warnung, die NIE kommt, sieht genauso aus wie eine, die zuverlaessig
# schweigt.
if grep -q "wurde ignoriert" "$WERK/err"; then
  printf '  FEHLT die Ruecklese SCHWEIGT, wenn die Senke den Wert annimmt  (Warnung kam trotzdem)\n'; fehler=1
else
  printf '  ok    die Ruecklese schweigt, wenn die Senke den Wert annimmt\n'
fi

: > "$WERK/gesetzt"; : > "$WERK/stand"
PATH="$PFAD" MUPIBOX_CONFIG="$WERK/konfig.json" MUPI_PROBE_STUR=1 \
  bash "$SKRIPT" set 50 >/dev/null 2>"$WERK/err2"
if grep -q "wurde ignoriert" "$WERK/err2"; then
  printf '  ok    und sie MELDET sich, wenn die Senke stur bleibt\n'
else
  printf '  FEHLT und sie MELDET sich, wenn die Senke stur bleibt  (keine Warnung)\n'; fehler=1
fi

echo
[ $fehler -eq 0 ] && { echo "  Alle acht halten."; echo; exit 0; }
echo "  Die Probe ist rot."; echo; exit 1
