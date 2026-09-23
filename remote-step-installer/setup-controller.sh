#!/usr/bin/env bash
# remote-step-installer — Controller startklar machen.
#
# Prüft alles, was die Laptop-Seite braucht, und zieht Fehlendes nach:
#   Python 3.9+, PyYAML (Recipes), textual (TUI), git (wiki fetch), ssh (Tunnel).
# Der AGENT auf der Box braucht NICHTS davon (pure stdlib) — hier geht es nur um
# den Controller.
#
#   ./setup-controller.sh              # prüfen, vor jeder Installation fragen
#   ./setup-controller.sh --yes        # ohne Rückfragen
#   ./setup-controller.sh --check      # NUR prüfen, nichts installieren
#   ./setup-controller.sh --venv       # bewusst ins .venv statt Systempakete (kein sudo)
#
# Installationsweg: zuerst das DISTRO-Paket (sauber, kein pip-Konflikt), sonst ein
# venv unter .venv/ — systemweites `pip install` ist auf Arch/CachyOS und Debian 12+
# ohnehin gesperrt (PEP 668).
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

ASSUME_YES=0; CHECK_ONLY=0; FORCE_VENV=0
for a in "$@"; do
  case "$a" in
    --yes|-y) ASSUME_YES=1 ;;
    --check|-n) CHECK_ONLY=1 ;;
    --venv) FORCE_VENV=1 ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unbekannte Option: $a  (--help)"; exit 2 ;;
  esac
done

G=$'\033[1;32m'; R=$'\033[1;31m'; Y=$'\033[1;33m'; C=$'\033[1;36m'; D=$'\033[2m'; N=$'\033[0m'
[ -t 1 ] || { G=""; R=""; Y=""; C=""; D=""; N=""; }
ok()   { echo "  ${G}✓${N} $*"; }
warn() { echo "  ${Y}!${N} $*"; }
bad()  { echo "  ${R}✗${N} $*"; }
info() { echo "  ${D}$*${N}"; }

MISSING=()       # was fehlt (Anzeigenamen)
FAILED=0
VENV="$HERE/.venv"
PY="python3"
[ -x "$VENV/bin/python" ] && PY="$VENV/bin/python"

ask() {  # ask "Frage" -> 0 = ja
  [ "$CHECK_ONLY" = 1 ] && return 1
  [ "$ASSUME_YES" = 1 ] && return 0
  [ -t 0 ] || return 1
  read -r -p "  ${C}→${N} $1 [J/n] " a
  case "${a,,}" in ""|j|ja|y|yes) return 0 ;; *) return 1 ;; esac
}

pkg_mgr() {
  for m in pacman apt-get dnf zypper; do command -v "$m" >/dev/null 2>&1 && { echo "$m"; return; }; done
  echo ""
}

distro_pkg() {  # $1 = python-modul -> Paketname für diesen Paketmanager
  case "$(pkg_mgr):$1" in
    pacman:yaml)     echo python-yaml ;;
    pacman:textual)  echo python-textual ;;
    apt-get:yaml)    echo python3-yaml ;;
    apt-get:textual) echo python3-textual ;;
    dnf:yaml)        echo python3-pyyaml ;;
    dnf:textual)     echo python3-textual ;;
    zypper:yaml)     echo python3-PyYAML ;;
    zypper:textual)  echo python3-textual ;;
    *) echo "" ;;
  esac
}

install_distro() {  # $1 = Paketname -> 0 bei Erfolg
  local p="$1" m; m="$(pkg_mgr)"; [ -n "$p" ] && [ -n "$m" ] || return 1
  local sudo=""; [ "$(id -u)" != 0 ] && sudo="sudo"
  command -v sudo >/dev/null 2>&1 || [ "$(id -u)" = 0 ] || return 1
  echo "  ${D}\$ $sudo $m ... $p${N}"
  case "$m" in
    pacman)  $sudo pacman -S --needed --noconfirm "$p" ;;
    apt-get) $sudo apt-get update -qq && $sudo apt-get install -y "$p" ;;
    dnf)     $sudo dnf install -y "$p" ;;
    zypper)  $sudo zypper --non-interactive install "$p" ;;
  esac
}

ensure_venv() {
  if [ ! -x "$VENV/bin/python" ]; then
    info "lege ein venv an: $VENV"
    # --system-site-packages: bereits vorhandene Systempakete (z.B. PyYAML) bleiben
    # sichtbar — sonst wäre das venv isoliert und das Fehlende doppelt zu installieren
    python3 -m venv --system-site-packages "$VENV" || return 1
  fi
  PY="$VENV/bin/python"
  "$PY" -m pip install -q --upgrade pip >/dev/null 2>&1
  return 0
}

install_pymod() {  # $1 = modul, $2 = pip-name, $3 = "pflicht"|"optional"
  local mod="$1" pip="$2" kind="$3" dp
  if [ "$CHECK_ONLY" = 1 ]; then
    dp="$(distro_pkg "$mod")"
    [ -n "$dp" ] && info "installierbar mit: $(pkg_mgr) … $dp   (oder --venv)" \
                 || info "installierbar mit: ./setup-controller.sh --venv"
    return 1
  fi
  dp="$(distro_pkg "$mod")"
  if [ "$FORCE_VENV" = 0 ] && [ -n "$dp" ]; then
    if ask "$pip fehlt — als Systempaket '$dp' installieren?"; then
      install_distro "$dp" && return 0
      warn "Distro-Installation fehlgeschlagen — versuche ein venv"
    else
      info "übersprungen (Distro-Paket)"
    fi
  fi
  if ask "$pip in ein lokales venv (.venv) installieren? (kein sudo nötig)"; then
    ensure_venv && "$PY" -m pip install -q "$pip" && return 0
  fi
  return 1
}

have_mod() { "$PY" -c "import $1" >/dev/null 2>&1; }
have_sys() { python3 -c "import $1" >/dev/null 2>&1; }   # NUR der System-Python
# Wo liegt das Modul? Wichtig, weil ein `python tui.py` den System-Python nimmt,
# das venv aber ein anderes ist — genau die Falle, die dieses Skript vermeiden soll.
where_mod() {
  if have_sys "$1"; then echo "System-Python"
  elif have_mod "$1"; then echo "nur im .venv"
  else echo ""; fi
}

echo
echo "${C}remote-step-installer — Controller-Setup${N}   ${D}($HERE)${N}"
[ "$CHECK_ONLY" = 1 ] && info "NUR PRÜFEN (--check) — es wird nichts installiert"
[ "$PY" != "python3" ] && info "gefundenes venv wird benutzt: $PY"
echo
echo "${C}1) Grundlage${N}"

# --- Python ---------------------------------------------------------------
if ! command -v python3 >/dev/null 2>&1; then
  bad "python3 fehlt — bitte über die Paketverwaltung installieren"; exit 1
fi
PV="$(python3 -c 'import sys;print("%d.%d"%sys.version_info[:2])')"
if python3 -c 'import sys;sys.exit(0 if sys.version_info>=(3,9) else 1)'; then
  ok "Python $PV"
else
  bad "Python $PV ist zu alt (3.9+ nötig)"; FAILED=1
fi

# --- Repo-Dateien ---------------------------------------------------------
for f in controller/core.py controller/rsi.py controller/stepctl.py agent/agent.py; do
  [ -f "$f" ] || { bad "fehlt im Repo: $f"; FAILED=1; }
done
[ "$FAILED" = 0 ] && ok "Repo vollständig (agent + controller)"
if python3 -m py_compile controller/*.py agent/agent.py 2>/dev/null; then
  ok "alle Python-Dateien fehlerfrei kompilierbar"
else
  bad "Syntaxfehler im Repo — py_compile schlug fehl"; FAILED=1
fi

echo
echo "${C}2) Python-Pakete${N}"

# --- PyYAML (Pflicht: Recipes) -------------------------------------------
if have_mod yaml; then
  ok "PyYAML  $("$PY" -c 'import yaml;print(yaml.__version__)')   ${D}(Recipes · $(where_mod yaml))${N}"
else
  warn "PyYAML fehlt — ohne das laufen Recipes nicht (CLI/TUI)"
  MISSING+=("PyYAML")
  if install_pymod yaml PyYAML pflicht && have_mod yaml; then
    ok "PyYAML installiert"
  else
    bad "PyYAML weiterhin nicht verfügbar"; FAILED=1
  fi
fi

# --- textual (optional: TUI) ---------------------------------------------
if have_mod textual; then
  ok "textual $("$PY" -c 'import textual;print(textual.__version__)')   ${D}(TUI · $(where_mod textual))${N}"
else
  warn "textual fehlt — die TUI (tui.py) braucht es; CLI + rsi.py laufen auch ohne"
  MISSING+=("textual")
  if install_pymod textual textual optional && have_mod textual; then
    ok "textual installiert"
  else
    info "ohne TUI weitermachen ist ok — nutze stepctl.py (CLI, mit Live-Anzeige)"
  fi
fi

echo
echo "${C}3) Werkzeuge${N}"
command -v ssh >/dev/null 2>&1 && ok "ssh   ${D}(Tunnel zur Box)${N}" \
  || { warn "ssh fehlt — ohne Tunnel keine Verbindung zur Box"; MISSING+=("ssh"); }
command -v git >/dev/null 2>&1 && ok "git   ${D}(wiki fetch)${N}" \
  || warn "git fehlt — 'wiki fetch' kann keine Wissenspakete holen"
if [ -t 1 ] && [ "${TERM:-}" != "" ] && [ "${TERM:-}" != "dumb" ]; then
  ok "Terminal ${TERM}   ${D}(bunte Live-Anzeige aktiv)${N}"
else
  info "kein farbfähiges Terminal erkannt — Ausgabe bleibt roh (das ist Absicht)"
fi

echo
echo "${C}4) Wissen (llmwiki)${N}"
# ══ DAS WISSEN KOMMT AUS DEM BAUM ═══════════════════════════════════════════
#
# Hier stand "http://git.local:3000/achim/llmwiki_mupibox.git" — das Repo
# daneben. Seit dem 08.08.2026 liegt das Paket IM Baum (llmwiki/pack.yaml,
# siehe ZUGEZOGEN.md), und die Herkunftsrepos sind stillgelegt.
#
# WAS DIE ALTE ZEILE GEKOSTET HAT, gemessen am selben Tag: der
# Zwischenspeicher trug v12 mit 53 Eintraegen, der Baum v160 mit 583. Beide
# Zwischenspeicher waren echte TEILMENGEN des Baums — es fehlten 530
# Eintraege, und keiner davon war dort neu. Wer damit diagnostiziert, sucht
# in einem Elftel des Wissens und bekommt „nichts bekannt" zurueck.
#
# DER RUECKFALL BLEIBT: Wer diesen Controller ohne den Baum benutzt (eigenes
# Auschecken, anderer Rechner), bekommt weiter das Repo angeboten.
WIKI_BAUM="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/llmwiki/pack.yaml"
if [ -f "$WIKI_BAUM" ]; then
  WIKI_URL="$WIKI_BAUM"
  WIKI_WOHER="aus dem Baum"
else
  WIKI_URL="http://git.local:3000/achim/llmwiki_mupibox.git"
  WIKI_WOHER="aus dem (stillgelegten) Repo — der Baum liegt hier nicht"
fi
wiki_info() {  # -> "version entries" oder leer
  "$PY" - <<'PY' 2>/dev/null
import sys
sys.path.insert(0, "controller")
try:
    import wiki
    p = wiki.resolve("mupibox")
    print(p["version"], len(p["entries"]))
except Exception:
    pass
PY
}
if have_mod yaml; then
  GEN="$("$PY" -c "import sys;sys.path.insert(0,'controller');import wiki;p=wiki.resolve('generic');print(p['version'],len(p['entries']))" 2>/dev/null)"
  [ -n "$GEN" ] && ok "generic-Paket v${GEN%% *} (${GEN##* } Einträge)   ${D}(immer dabei)${N}"
  WI="$(wiki_info)"
  if [ -n "$WI" ]; then
    ok "MuPiBox-Paket v${WI%% *} (${WI##* } Einträge)"
    # KEIN `command -v git` MEHR ALS BEDINGUNG: Liegt die Quelle im Baum, ist
    # es ein Dateikopiervorgang — an git haengt daran nichts. Genau diese
    # Bedingung liess das Aktualisieren auf einem Rechner ohne git still aus.
    if ask "auf den neuesten Stand bringen ($WIKI_WOHER)?"; then
      "$PY" controller/wiki.py fetch "$WIKI_URL" --as mupibox >/dev/null 2>&1 \
        && { WI="$(wiki_info)"; ok "aktualisiert → v${WI%% *} (${WI##* } Einträge)"; } \
        || warn "Aktualisieren fehlgeschlagen (git.local erreichbar?) — der alte Stand bleibt nutzbar"
    fi
  elif command -v git >/dev/null 2>&1; then
    warn "MuPiBox-Wissen noch nicht geholt (Diagnose nutzt dann nur das generic-Paket)"
    if ask "jetzt holen? ($WIKI_WOHER)"; then
      "$PY" controller/wiki.py fetch "$WIKI_URL" --as mupibox \
        && ok "geholt — nutzbar mit --wiki mupibox" \
        || warn "Holen fehlgeschlagen (erreichbar? offline?) — kein Beinbruch"
    else
      info "später: $PY controller/wiki.py fetch $WIKI_URL --as mupibox"
    fi
  fi
fi

# --- Ergebnis -------------------------------------------------------------
echo
if [ "$FAILED" != 0 ]; then
  echo "${R}✗ Controller ist NICHT startklar${N} — siehe die Punkte oben."
  exit 1
fi
echo "${G}✓ Controller ist startklar.${N}"
have_mod textual || echo "  ${D}(ohne TUI — CLI + rsi stehen bereit)${N}"
# Wenn etwas NUR im venv liegt, ist ein `python tui.py` mit dem System-Python zum
# Scheitern verurteilt → die Starter ./tui ./stepctl ./rsi wählen den Python selbst.
if [ "$(where_mod textual)" = "nur im .venv" ] || [ "$(where_mod yaml)" = "nur im .venv" ]; then
  echo "  ${Y}Wichtig:${N} die Pakete liegen im ${C}.venv${N}, nicht im System-Python."
  echo "  ${D}Deshalb IMMER die Starter unten benutzen (${N}./tui${D}, ${N}./stepctl${D}, ${N}./rsi${D}) —${N}"
  echo "  ${D}ein blankes '${N}python tui.py${D}' nähme den System-Python und scheiterte.${N}"
fi
cat <<EOF

${C}So geht's weiter${N}   ${D}(aus dem Repo-Root; die Starter wählen den richtigen Python selbst)${N}
  ${D}# 1) ohne Box ausprobieren (gefahrlos, nichts wird installiert):${N}
  python3 agent/agent.py --port 8099          ${D}# Terminal 1 → zeigt den PAIR CODE${N}
  ./stepctl --recipe recipes/demo.yaml --pair <CODE>       ${D}# Terminal 2${N}

  ${D}# 2) echte Box:${N}
  scp -r agent dietpi@<box-ip>:/tmp/                        ${D}# Agent hinbringen${N}
  ssh dietpi@<box-ip> 'sudo bash /tmp/agent/install-agent.sh'   ${D}# zeigt den PAIR CODE${N}
  ssh -N -L 8099:localhost:8099 dietpi@<box-ip> &           ${D}# Tunnel offen lassen${N}
  ./stepctl --recipe recipes/mupibox.yaml --pair <CODE>
EOF
have_mod textual && echo "  ${D}# schöner: ${N}./tui --recipe recipes/mupibox.yaml --pair <CODE>"
echo
