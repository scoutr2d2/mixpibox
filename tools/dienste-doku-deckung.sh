#!/usr/bin/env bash
# DIENSTE-DOKU-DECKUNG — welche Unit auf einer Box laeuft, ohne dass ein
# Handbuch sie nennt.
#
# ══ WARUM ES DAS GIBT (23.08.2026) ═════════════════════════════════════════
#
# `tools/doku-luecken-probe.sh` prueft inzwischen sechs Dinge, und sie haben
# alle dasselbe gemeinsam: Plugins, Rechte, Ereignisse, Konfigurationsfelder,
# Menuepunkte, Seiten — das ist die OBERFLAECHE und ihre Schnittstelle. Selbst
# die REST-Pruefung vom selben Tag bleibt in der Anwendung.
#
# Was auf der Box LAEUFT, stand in keiner Probe. Und `dokumentation/mixpibox.md`
# hat dafuer ein eigenes Kapitel — 4.1 „Die laufenden Dienste" — mit einer
# Tabelle, die sich „Auf einer eingerichteten Box:" nennt und damit
# Vollstaendigkeit behauptet. Sie fuehrte SIEBEN Units. Die Ausrollwege
# schalten ZWANZIG scharf. `mupi_offtrigger` — der weiche Ausschalter am
# Knopf, dessen Fehlen ein Jahr lang niemand gemerkt hat und der genau darum
# eine eigene Unit bekam — kam in KEINEM Handbuch und auch im WIKI mit null
# Treffern vor. Wer die Box ausschaltet, benutzt ihn taeglich.
#
# ══ WAS GEZAEHLT WIRD, UND WARUM NICHT ALLES ═══════════════════════════════
#
# NICHT `config/services/*.service`. Dort liegen 42 Dateien, und ein guter
# Teil davon ist Bestand, der auf keiner heutigen Box scharf ist (`mupi_vnc`,
# `mupi_telegram`, `mupi_novnc`, der alte `mupi_startstop`). Eine Probe, die
# fuer jede Datei einen Handbucheintrag verlangt, meldet auf Dauer rot und
# wird zu Recht ignoriert — dieselbe Falle, die in `doku-luecken-probe.sh`
# schon zweimal beschrieben steht.
#
# SONDERN: jede Unit, die ein AUSROLLWEG mit `systemctl enable` scharf
# schaltet. Das ist die ehrliche Antwort auf „was laeuft auf einer
# eingerichteten Box" — und genau das ist die Ueberschrift der Tabelle, die
# hier geprueft wird.
#
# GESUCHT WIRD DER BASISNAME OHNE ENDUNG: aus `librespot-waechter.timer` wird
# `librespot-waechter`. Das Handbuch nennt die Unit mal als `.service`, mal
# als `.timer`, mal ohne — und ein Leser, der `mupi_fan` sucht, hat das Ding
# gefunden, egal welche Endung dransteht. Eine Probe auf den vollen Namen
# meldete rot, obwohl die Zeile dasteht.
#
# NUR DAS ARCHITEKTURHANDBUCH, nicht das Benutzerhandbuch: `pipewire.socket`
# gehoert in kein Handbuch fuer Betreiber. Wer die Einheit auf beiden
# einfordert, baut die Falle von oben nach.
#
# Aufruf aus dem Wurzelverzeichnis:  bash tools/dienste-doku-deckung.sh
# Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.

set -u
cd "$(dirname "$0")/.." || exit 2

DOKU=dokumentation/mixpibox.md
WIKI=llmwiki/pack.yaml

# Die Wege, die eine Box einrichten. Aendert sich einer, faellt das hier auf,
# weil die Liste der scharfen Units mitwandert.
#
# ══ EIN AUSROLLWEG MUSS KEIN SKRIPT SEIN (25.08.2026) ──────────────────────
#
# Diese Liste hiess fuenf Dateien lang „die Wege, die eine Box einrichten" und
# fuehrte fuenf *.sh. Der Weg, ueber den die heutigen Boxen gebaut werden, ist
# aber ein REZEPT: `remote-step-installer/recipes/*.yaml`, Schritt fuer Schritt
# eingebetteter Shell-Code. Er schaltet an 22 Stellen scharf — und stand hier
# nicht drin, weil beim Bauen nach Skripten gesucht wurde, nicht nach
# `systemctl enable`. Acht Units waren dadurch unsichtbar, darunter
# `mupi_hat`/`mupi_hat_control` (Akkuanzeige; der EINZIGE Weg, der sie
# einschaltet) und `mupi_change_checker` (die Unit hinter dem Feld „Medien
# pruefen alle N Sekunden" der Verwaltung).
#
# Die Erweiterung vom 24.08. hat die SCHLEIFENFORM nachgezogen und die
# WEGELISTE nie befragt. Eine Wache liest man an ihren Ausschluessen — aber
# zuerst an ihren EINGAENGEN.
WEGE=(
  autosetup/autosetup.sh
  update/start_mupibox_update.sh
  update/conf_update.sh
  scripts/systemd/einrichten.sh
  scripts/mupibox/fehlerbild-anhaengen.sh
  remote-step-installer/recipes/mupibox.yaml
  remote-step-installer/recipes/mupibox-app.yaml
)

fehlende_wege=0
for w in "${WEGE[@]}"; do
  if [ ! -f "$w" ]; then
    echo "  WARNUNG: Ausrollweg $w nicht gefunden — umgezogen?"
    fehlende_wege=$((fehlende_wege + 1))
  fi
done

# `--now` ist ein Schalter, keine Unit. Er faellt raus.
#
# UND ER STEHT HINTER `enable`, NICHT DAVOR (25.08.2026). Das Muster fing
# `systemctl --user enable X`, also die Schreibweise, die im Baum NULLMAL
# vorkommt; die echte — `systemctl enable --now X` — steht achtmal allein in
# den fuenf urspruenglichen Wegen und wurde vom `grep -v '^--'` als vermeintlicher
# Schalter weggeworfen. Dieselbe Klasse wie die Wegeliste eine Ebene hoeher:
# das Muster wurde an einer erdachten Zeile geprueft statt an den echten.
#
# WAS DIE VERBREITERUNG SOFORT MITBRACHTE, gemessen in derselben Stunde:
# `pulseaudio`. Zwei Treffer, beide KEIN Einschalten — eine auskommentierte
# Zeile (autosetup:915) und ein `echo`, das einem Betreiber den RUECKWEG von
# PipeWire diktiert (start_mupibox_update.sh:1339). Ausgerechnet der Dienst,
# den dieser Weg abschaltet, waere als „laeuft auf einer eingerichteten Box"
# gemeldet worden. Darum liest `code()` vor: Kommentarzeilen fallen weg, und
# eine Zeile endet dort, wo ein `echo` beginnt — was hinter `echo` steht, ist
# Text fuer einen Menschen, kein Befehl an systemd. Der Ruf VOR dem echo
# (`systemctl enable --now $s … && echo "  ein: $s"`, Rezept:613) bleibt
# dadurch erhalten; das ist die haeufigste Form im Rezept.
code() { sed -E 's/^[[:space:]]*#.*$//; s/[[:space:]]#[[:space:]].*$//; s/\becho\b.*$//' "$@" 2>/dev/null; }

woertlich=$(code "${WEGE[@]}" | grep -oP "systemctl\s+(--\S+\s+)*enable\s+(--\S+\s+)*\K[\w@.\$-]+" |
  grep -v '^--' | grep -v '\$' |
  sed -E 's/\.(service|timer|path|socket|target)$//' |
  sort -u)

# ── DIE SCHLEIFENFORM (24.08.2026) ─────────────────────────────────────────
#
# Hier stand: „`$VARIABLE` waere geraten statt gemessen" — und damit fiel
# `systemctl enable "${d}.service"` heraus. `scripts/systemd/einrichten.sh`
# schaltet aber GENAU SO scharf, ueber `DIENSTE=(mupi_offtrigger mupi_powerled
# netzabriss-sonde soloist mixpi-wlan-adapter)` (Stand 29.08.2026; damals
# hiessen die ersten beiden mupi_taster/mupi_knopflicht). Fuenf Units waren fuer diese
# Wache unsichtbar; `netzabriss-sonde` — ein Dauerlaeufer mit
# `Restart=always` — stand deshalb in KEINER Zeile des Handbuchs, und die
# Wache meldete daneben „KEINE LUECKE (20 Units geprueft)".
#
# GERATEN wird trotzdem nichts: aufgeloest wird nur, was als Feld-Zuweisung
# `NAME=( … )` IM SELBEN Weg woertlich dasteht. Findet sich zu einer benutzten
# Variablen kein solches Feld, gibt es eine WARNUNG statt stillen Wegfalls —
# sonst waere die Erweiterung nur eine neue Blindstelle mit mehr Zeilen.
# Alle woertlichen Werte, die eine Liste im selben Weg bekommt — als Feld
# `NAME=( a b c )` ODER als Zeichenkette `NAME="a b c"`. Das Rezept schreibt
# die zweite Form und LEGT NACH (`AN="$AN mupi_hat mupi_hat_control"`), darum
# werden ALLE Zuweisungen gelesen, nicht nur die erste. Der Selbstbezug
# `$NAME` faellt raus — er ist kein Unitname, sondern das Nachlegen selbst.
# Jedes ANDERE `$` bleibt stehen: darueber warnt der Aufrufer, und genau so
# soll es sein ([[wache-sieht-die-schleife-nicht-die-scharf-schaltet]]).
listeAus() {
  local datei="$1" name="$2" roh
  roh=$( { code "$datei" | grep -oP "^\s*${name}=\(\K[^)]*"
           code "$datei" | grep -oP "^\s*${name}=\"\K[^\"]*"
           code "$datei" | grep -oP "^\s*${name}=(?![\"(])\K\S*"; } 2>/dev/null )
  printf '%s' "$roh" | tr ' \t' '\n\n' | grep -v '^$' |
    grep -vx -e "\\\$${name}" -e "\\\${${name}}" | tr '\n' ' '
}

schleifen=""
for w in "${WEGE[@]}"; do
  [ -f "$w" ] || continue
  # Welche Variablen werden in einem `enable` benutzt? `${d}.service`, `$d`
  for v in $(code "$w" | grep -oP "systemctl\s+(--\S+\s+)*enable\s+(--\S+\s+)*\"?\\\$\{?\K[A-Za-z_][A-Za-z0-9_]*" | sort -u); do
    # Die benutzte Variable ist die LAUFVARIABLE, nicht die Liste. Es gibt
    # zwei Schreibweisen im Baum, und beide muessen aufgeloest werden:
    #   for d in "${DIENSTE[@]}"   → das Feld DIENSTE=( … ) im selben Weg
    #   for service in a b c; do   → die Woerter stehen woertlich dahinter
    quelle=$(code "$w" | grep -oP "^\s*for\s+${v}\s+in\s+\"?\\\$\{?\K[A-Za-z_][A-Za-z0-9_]*" | head -1)
    if [ -n "$quelle" ]; then
      werte=$(listeAus "$w" "$quelle")
    else
      werte=$(code "$w" | grep -oP "^\s*for\s+${v}\s+in\s+\K[^;]*" | head -1)
      # Nur woertliche Namen. Bleibt ein `$` stehen, ist es nicht gemessen.
      case "$werte" in *'$'*) werte="" ;; esac
    fi
    # AUCH EIN EINZELNER EINTRAG kann eine Variable sein. Ihn als Unitnamen
    # durchzureichen hiesse, `$MUPI_TASTER` im Handbuch zu suchen — die Wache
    # meldete dann eine Luecke, die keine ist, statt zuzugeben, dass sie hier
    # nicht messen kann. Gemessen in der Gegenprobe am 24.08.2026.
    case "$werte" in *'$'*)
      echo "  WARNUNG: $w schaltet ueber \$$v scharf, und in der Liste steht"
      echo "           selbst eine Variable — die Units dahinter sind ungeprueft."
      fehlende_wege=$((fehlende_wege + 1))
      werte=$(printf '%s' "$werte" | tr ' ' '\n' | grep -v '\$' | tr '\n' ' ')
      ;;
    esac
    if [ -z "$werte" ]; then
      echo "  WARNUNG: $w schaltet ueber \$$v scharf, und die Liste dahinter"
      echo "           laesst sich nicht woertlich lesen — Units ungeprueft."
      fehlende_wege=$((fehlende_wege + 1))
      continue
    fi
    schleifen="$schleifen $werte"
  done
done

units=$(printf '%s\n%s\n' "$woertlich" "$(printf '%s' "$schleifen" | tr ' ' '\n')" |
  grep -v '^$' |
  sed -E 's/\.(service|timer|path|socket|target)$//' |
  sort -u)

if [ -z "$units" ]; then
  echo "  WARNUNG: kein 'systemctl enable' in den Ausrollwegen gefunden —"
  echo "           hat sich die Schreibweise geaendert?"
  exit 1
fi

luecken=0
echo "── Scharfgeschaltete Units, die $DOKU nicht nennt ──"
for u in $units; do
  if ! grep -qF "$u" "$DOKU"; then
    # Steht sie wenigstens im Wiki? Das aendert nichts am Befund, sagt aber,
    # ob Wissen fehlt oder nur nicht uebertragen wurde.
    if grep -qF "$u" "$WIKI"; then
      echo "  FEHLT: $u (das Wiki kennt sie — nur nicht uebertragen)"
    else
      echo "  FEHLT: $u (auch im Wiki nicht — echtes Loch)"
    fi
    luecken=$((luecken + 1))
  fi
done

luecken=$((luecken + fehlende_wege))

echo
if [ "$luecken" -eq 0 ]; then
  echo "KEINE LUECKE. ($(echo "$units" | wc -l) Units geprueft)"
  exit 0
fi
echo "$luecken LUECKE(N) von $(echo "$units" | wc -l) Units."
exit 1
