#!/usr/bin/env bash
# Install the remote-step-installer AGENT on a DietPi/Pi box (run as root).
# The agent is the ONLY thing installed automatically; everything else is driven
# step-by-step from the controller on your laptop.
#
#   sudo bash install-agent.sh              # uses ./agent.py next to this script
#   curl -fsSL <host>/install-agent.sh | sudo AGENT_URL=<host>/agent.py bash
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "als root/sudo starten"; exit 1; }

DIR=/opt/step-agent
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$DIR"

if [ -f "$HERE/agent.py" ]; then
  cp "$HERE/agent.py" "$DIR/agent.py"
elif [ -n "${AGENT_URL:-}" ]; then
  curl -fsSL "$AGENT_URL" -o "$DIR/agent.py"
else
  echo "agent.py nicht gefunden und kein AGENT_URL gesetzt"; exit 1
fi
chmod 700 "$DIR/agent.py"

# ── Der Einrichtungsassistent, falls er danebenliegt ────────────────────────
# OPTIONAL, und das mit Absicht: der Agent laeuft auch ohne. Fehlt die Seite,
# liefert er unter /einrichtung eine kurze Notiz, was fehlt — statt einer
# weissen Seite, an der man raetselt. Wer den Agenten per `curl | bash` aus der
# Ferne einspielt, hat diese Dateien nicht und braucht sie auch nicht.
#
# Das Maskottchen kommt aus dateien/ und wird NICHT im agent-Ordner doppelt
# gehalten — ein 54-kB-Binaerabbild zweimal im Repo ist eine Fehlerquelle
# (welches ist das aktuelle?), kein Vorteil.
if [ -f "$HERE/einrichtung.html" ]; then
  cp "$HERE/einrichtung.html" "$DIR/einrichtung.html"
  chmod 644 "$DIR/einrichtung.html"
  echo "Assistentenseite: mitkopiert"
fi
for BILD in "$HERE/../dateien/mixpi-hoert.png" "$HERE/mixpi-hoert.png"; do
  if [ -f "$BILD" ]; then
    cp "$BILD" "$DIR/einrichtung-mixpi.png"
    chmod 644 "$DIR/einrichtung-mixpi.png"
    echo "Maskottchen: mitkopiert"
    break
  fi
done

# Python nicht voraussetzen (minimales DietPi hat keins) und den Pfad ERMITTELN,
# statt /usr/bin/python3 anzunehmen.
PY="$(command -v python3 || true)"
if [ -z "$PY" ]; then
  echo "Python 3 fehlt — installiere es (einzige Voraussetzung des Agents)"
  apt-get update -qq && apt-get install -y --no-install-recommends python3
  PY="$(command -v python3 || true)"
fi
[ -n "$PY" ] || { echo "FEHLER: kein python3 gefunden"; exit 1; }
echo "Python: $PY"

# minimal systemd unit so it survives an SSH drop; the agent removes it on /shutdown
cat > /etc/systemd/system/step-agent.service <<EOF
[Unit]
Description=remote-step-installer agent
[Service]
ExecStart=$PY $DIR/agent.py --host 127.0.0.1 --port 8099 --paircode-file $DIR/paircode
Restart=no
[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl restart step-agent.service
sleep 1

echo "============================================================"
journalctl -u step-agent.service -n 15 --no-pager | grep -E "PAIR CODE|AGENT on" || true
echo "------------------------------------------------------------"
echo "Der Agent lauscht auf 127.0.0.1:8099 (nur lokal)."
echo "Vom Laptop:  ssh -N -L 8099:localhost:8099 dietpi@$(hostname -I | awk '{print $1}')"
echo "dann:        cd controller && python3 stepctl.py --recipe ../recipes/mupibox.yaml --pair <CODE>"
echo "============================================================"
