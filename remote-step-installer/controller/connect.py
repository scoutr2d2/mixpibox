#!/usr/bin/env python3
"""
remote-step-installer — Box verbinden (Agent finden/installieren, Tunnel, Pairing).

Nimmt dir das Hantieren mit dem Pair-Code ab: per SSH auf die Box, den Code des
laufenden Agents abholen, den Tunnel aufmachen, pairen — danach laufen TUI/CLI/rsi
ohne weitere Eingabe.

Zwei Fälle, beide abgedeckt:
  * **SD mit sdprep vorbereitet** → der Agent läuft schon, der Code liegt bereit.
  * **bestehende Box** (z.B. eine laufende MuPiBox) → `--install` bringt den Agent
    per SSH hin und startet ihn. KEIN Neuflashen nötig.

Authentifizierung: ganz normales `ssh` (Schlüssel, sonst fragt ssh nach dem
Passwort). Es wird KEIN Passwort gespeichert oder in eine Kommandozeile geschrieben.

  python3 connect.py 192.168.178.165                 # verbinden + pairen
  python3 connect.py mupibox --install               # Agent erst installieren
  python3 connect.py 192.168.178.165 --tunnel-only   # nur den Tunnel
  python3 connect.py mupibox --watch                 # verbunden bleiben (Reboots überstehen)
"""
import argparse
import os
import re
import signal
import socket
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core import Agent, AgentError, repo_root, _token_file  # noqa: E402

DEF_USER = "dietpi"
DEF_PORT = 8099
C = {"ok": "\033[1;32m", "err": "\033[1;31m", "warn": "\033[1;33m",
     "h": "\033[1;36m", "dim": "\033[2m", "0": "\033[0m"}
if not sys.stdout.isatty() or os.environ.get("NO_COLOR"):
    C = {k: "" for k in C}


def say(k, s):
    print(f"{C[k]}{s}{C['0']}")


def _mux(user, host, port):
    """SSH-Verbindungsmultiplexing: die ERSTE Verbindung fragt nach dem Passwort,
    alle weiteren laufen über denselben Kanal — sonst tippt man es pro Aufruf neu."""
    sock = f"/tmp/rsi-ssh-{os.getuid()}-{user}@{host}:{port}"
    return ["-o", "ControlMaster=auto", "-o", f"ControlPath={sock}",
            "-o", "ControlPersist=300"]


def ssh_base(user, host, port=22):
    return (["ssh", "-p", str(port), "-o", "ConnectTimeout=10",
             "-o", "StrictHostKeyChecking=accept-new"]
            + _mux(user, host, port) + [f"{user}@{host}"])


def ssh_run(user, host, cmd, port=22, timeout=60, quiet=True):
    """Einen Befehl auf der Box ausführen. ssh regelt die Anmeldung selbst
    (Schlüssel oder interaktive Passwortabfrage) — wir fassen kein Passwort an."""
    p = subprocess.run(ssh_base(user, host, port) + [cmd],
                       capture_output=quiet, text=True, timeout=timeout)
    return p.returncode, (p.stdout or "") if quiet else "", (p.stderr or "") if quiet else ""


# ── Passwortfreie Anmeldung ────────────────────────────────────────────────
# Ohne Schluessel fragt JEDER Aufruf nach dem Passwort: das Multiplexing haelt
# den Kanal nur ControlPersist-Sekunden offen. Einmal hinterlegt, fragt nie
# wieder jemand — und `watch` kann sich nach einem Neustart der Box von selbst
# wiederverbinden, ohne dass jemand davorsitzt.


INSTALL_KEY = (
    "umask 077; mkdir -p ~/.ssh; K=$(cat); "
    "grep -qxF \"$K\" ~/.ssh/authorized_keys 2>/dev/null || echo \"$K\" >> ~/.ssh/authorized_keys; "
    "chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys; "
    "echo OK"
)


def key_works(user, host, port=22, timeout=8):
    """Kommt man OHNE Passwort rein? BatchMode verbietet jede Rueckfrage, und
    ohne den Mux-Kanal, damit eine offene Sitzung kein falsches Ja liefert."""
    try:
        p = subprocess.run(
            ["ssh", "-p", str(port), "-o", "BatchMode=yes", "-o", "ConnectTimeout=6",
             "-o", "PreferredAuthentications=publickey", "-o", "StrictHostKeyChecking=accept-new",
             f"{user}@{host}", "true"],
            capture_output=True, text=True, timeout=timeout)
        return p.returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return False


# ── Box im Netz FINDEN (Discovery) ─────────────────────────────────────────
# Der Router vergibt die Adresse; nach einem Netzwechsel stimmt weder die alte
# IP noch loest der Name auf (DietPi hat kein avahi — 'mupibox.local' gibt es
# nicht). Statt zu raten wird das eigene Netz abgesucht, und die Box wird an
# UNSEREM SSH-SCHLUESSEL erkannt: der steckt auf jeder von uns geschriebenen
# Karte. Ein Geraet, bei dem er greift, IST unsere Box — egal unter welcher IP.

def subnets_von(ip_o_text):
    """`ip -4 -o addr`-Ausgabe -> [(praefix, eigene_ip)] je Netz. Pure.

    Bewusst auf /24 gedeckelt: ein /16 waere 65534 Adressen — abgesucht wird
    die NAHE Umgebung der eigenen Adresse, dort sitzt der DHCP-Bereich.
    """
    raus, gesehen = [], set()
    for zeile in (ip_o_text or "").splitlines():
        m = re.search(r"\binet (\d+\.\d+\.\d+)\.(\d+)/(\d+)", zeile)
        if not m or " lo " in f" {zeile} ":
            continue
        praefix, selbst = m.group(1), int(m.group(2))
        if praefix.startswith("127.") or praefix in gesehen:
            continue
        gesehen.add(praefix)
        raus.append((praefix, f"{praefix}.{selbst}"))
    return raus


def _hostname_per_key(user, ip, port=22, timeout=8):
    """Hostname holen, NUR wenn unser Schluessel greift -> '' sonst.
    BatchMode: niemals eine Passwortfrage aus einem Scan heraus."""
    try:
        p = subprocess.run(
            ["ssh", "-p", str(port), "-o", "BatchMode=yes", "-o", "ConnectTimeout=4",
             "-o", "PreferredAuthentications=publickey",
             "-o", "StrictHostKeyChecking=accept-new",
             f"{user}@{ip}", "hostname"],
            capture_output=True, text=True, timeout=timeout)
        return (p.stdout or "").strip() if p.returncode == 0 else ""
    except (subprocess.TimeoutExpired, OSError):
        return ""


def discover(user=DEF_USER, port=22, on_status=None):
    """Das eigene Netz absuchen -> [{"ip","hostname"}] aller OUR-KEY-Boxen.

    Zwei Stufen, damit es schnell bleibt: (1) TCP-Tuersteher — wer Port 22
    binnen 0,4 s nicht oeffnet, faellt raus (256 parallele Versuche, ein /24
    dauert so 1-3 s); (2) nur bei offenen Tueren der teure Schluesseltest.
    """
    import socket
    from concurrent.futures import ThreadPoolExecutor
    sag = on_status or (lambda s: None)
    try:
        r = subprocess.run(["ip", "-4", "-o", "addr"], capture_output=True, text=True, timeout=10)
        netze = subnets_von(r.stdout or "")
    except (OSError, subprocess.SubprocessError):
        netze = []
    if not netze:
        sag("keine Netzadresse gefunden")
        return []
    treffer = []
    for praefix, selbst in netze:
        sag(f"suche in {praefix}.0/24 …")
        kandidaten = [f"{praefix}.{i}" for i in range(1, 255) if f"{praefix}.{i}" != selbst]

        def tuer_offen(ip):
            try:
                with socket.create_connection((ip, port), timeout=0.4):
                    return ip
            except OSError:
                return None
        with ThreadPoolExecutor(max_workers=256) as pool:
            offen = [ip for ip in pool.map(tuer_offen, kandidaten) if ip]
        sag(f"  {len(offen)} Geraet(e) mit offenem SSH — pruefe den Schluessel …")
        with ThreadPoolExecutor(max_workers=8) as pool:
            for ip, name in zip(offen, pool.map(lambda i: _hostname_per_key(user, i, port), offen)):
                if name:
                    treffer.append({"ip": ip, "hostname": name})
                    sag(f"  ✓ {ip} = {name}")
    return treffer


def finde_box(wunsch, user=DEF_USER, port=22, on_status=None):
    """-> (ip, hostname) der besten Fundstelle oder (None, Meldung).
    Namensgleichheit gewinnt; sonst nur bei EINDEUTIG einer Box deren IP."""
    gefunden = discover(user, port, on_status)
    if not gefunden:
        return None, "keine Box mit unserem Schluessel im Netz gefunden"
    passend = [g for g in gefunden if g["hostname"] == wunsch]
    if passend:
        return passend[0]["ip"], passend[0]["hostname"]
    if len(gefunden) == 1:
        return gefunden[0]["ip"], gefunden[0]["hostname"]
    namen = ", ".join(f"{g['hostname']}@{g['ip']}" for g in gefunden)
    return None, f"mehrere Boxen gefunden ({namen}) — bitte die IP direkt angeben"


def heile_hostkey(user, host, port=22):
    """Veralteten Hostschluessel erkennen und entfernen -> True wenn geheilt.

    Nach einer NEUINSTALLATION hat die Box eine neue SSH-Identitaet; in
    known_hosts steht unter dem Namen noch die alte, und ssh verweigert ALLES —
    auch die Schluessel-Anmeldung. Das sieht dann faelschlich aus wie "kein
    SSH-Schluessel hinterlegt" (am Geraet: TUI verweigerte, waehrend die
    Konsole zufaellig ueber die frische IP lief, die keinen Alteintrag hatte).

    Reagiert NUR auf die eindeutige Meldung REMOTE HOST IDENTIFICATION HAS
    CHANGED — ein unbekannter neuer Host wird von accept-new ohnehin genommen.
    Fuer diesen Werkzeugkasten ist das Entfernen richtig: Neuinstallationen
    sind hier der Normalfall, und die Identitaet sichert danach der eigene
    Anmeldeschluessel ab.
    """
    try:
        p = subprocess.run(
            ["ssh", "-p", str(port), "-o", "BatchMode=yes", "-o", "ConnectTimeout=6",
             "-o", "PreferredAuthentications=publickey",
             f"{user}@{host}", "true"],
            capture_output=True, text=True, timeout=15)
    except (subprocess.TimeoutExpired, OSError):
        return False
    if "REMOTE HOST IDENTIFICATION HAS CHANGED" not in (p.stderr or ""):
        return False
    subprocess.run(["ssh-keygen", "-R", host], capture_output=True, text=True)
    return True


def ensure_local_key():
    """→ (pubkey_text, neu_erzeugt). Die Umsetzung liegt in sdprep, damit es nur
    EINE Stelle gibt, die Schlüssel anlegt (der SD-Assistent backt denselben
    Schlüssel auf eine frische Karte). Lazy importiert: connect muss auch dann
    laufen, wenn sonst nichts vorhanden ist."""
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from sdprep import ensure_local_key as _ensure
    except ImportError:
        return "", False
    return _ensure()


def setup_key(user, host, port=22):
    """Den oeffentlichen Schluessel auf der Box hinterlegen. Laeuft ueber den
    BESTEHENDEN Mux-Kanal, kostet also keine zusaetzliche Passworteingabe."""
    if key_works(user, host, port):
        return "vorhanden"
    key, made = ensure_local_key()
    if not key:
        return "kein-schluessel"
    try:
        p = subprocess.run(ssh_base(user, host, port) + [INSTALL_KEY],
                           input=key + "\n", capture_output=True, text=True, timeout=30)
    except (subprocess.TimeoutExpired, OSError):
        return "fehlgeschlagen"
    if p.returncode != 0 or "OK" not in (p.stdout or ""):
        return "fehlgeschlagen"
    return "neu+erzeugt" if made else "neu"


# ALLE Kandidaten holen, AUTORITATIVES ZUERST: /opt/step-agent/paircode schreibt der
# Agent bei JEDEM Start neu; die Home-Kopie legt der Installer nur EINMAL an und ist
# nach einem Neustart veraltet (genau das ergab ein "bad code" nach dem Reboot).
FETCH_CODE = (
    "sudo -n cat /opt/step-agent/paircode 2>/dev/null; "
    "cat ~/.step-agent-paircode 2>/dev/null; "
    "sudo -n journalctl -u step-agent -n 60 --no-pager 2>/dev/null "
    "| grep -oE 'PAIR CODE:[[:space:]]+[0-9]{6}' | grep -oE '[0-9]{6}' | tail -1"
)


def fetch_paircodes(user, host, port=22):
    """→ Liste moeglicher Codes (ohne Dubletten, autoritatives zuerst)."""
    rc, out, _ = ssh_run(user, host, FETCH_CODE, port, quiet=True)
    seen, codes = set(), []
    for m in re.finditer(r"\b(\d{6})\b", out or ""):
        c = m.group(1)
        if c not in seen:
            seen.add(c)
            codes.append(c)
    return codes


def fetch_paircode(user, host, port=22):
    codes = fetch_paircodes(user, host, port)
    return codes[0] if codes else ""


def agent_state(user, host, port=22, agent_port=DEF_PORT):
    """→ 'running' | 'installed' | 'missing' | 'unreachable'

    DREI Fallen, die hier schon zugeschnappt sind:
    * `/opt/step-agent` ist 0700 und gehoert root — ein `test -f` als normaler
      Benutzer scheitert, obwohl der Agent da ist. Deshalb per `sudo -n`.
    * `systemctl is-active` DARF hier gar nicht benutzt werden: DietPi maskiert
      dbus/logind, als normaler Benutzer scheitert systemctl mit "Failed to
      connect to system scope bus" — der frisch installierte, nachweislich
      laufende Agent wurde als 'missing' gemeldet (die leere Antwort liess
      printf nur EIN Feld ausgeben, und das Parsen kippte um). Laufend heisst
      hier deshalb: der Agent-Port wird belauscht ODER der Prozess lebt —
      beides braucht weder root noch dbus.
    * Ausgabe IMMER als zwei Felder ('inactive' statt leer), damit das Parsen
      nie wieder verrutschen kann."""
    probe = ("a=inactive; "
             f"ss -tln 2>/dev/null | grep -qE '127\\.0\\.0\\.1:{agent_port}[[:space:]]' && a=active; "
             "[ \"$a\" = active ] || {{ pgrep -f /opt/step-agent/agent.py >/dev/null 2>&1 && a=active; }}; "
             "f=no; sudo -n test -f /opt/step-agent/agent.py 2>/dev/null && f=yes; "
             "printf '%s %s' \"$a\" \"$f\"")
    rc, out, _ = ssh_run(user, host, probe, port, quiet=True)
    if rc not in (0, 1, 3):
        return "unreachable"
    parts = (out or "").strip().split()
    active = parts[0] if parts else ""
    have = parts[-1] if len(parts) > 1 else "no"
    if active == "active":
        return "running"
    return "installed" if have == "yes" else "missing"


# Wird als root auf der Box ausgefuehrt. BEWUSST als Skript (statt langer ssh-Einzeiler):
# lesbar, kein Quoting-Chaos, und sudo darf am Terminal nach dem Passwort fragen.
INSTALL_SH = r"""#!/bin/bash
set -u
PORT="${1:-8099}"
DIR=/opt/step-agent

# Python NICHT voraussetzen: ein minimales DietPi bringt keines mit, und der Pfad ist
# nicht immer /usr/bin/python3 (genau daran ist der erste Versuch gescheitert:
# "Unable to locate executable '/usr/bin/python3'").
PY="$(command -v python3 || true)"
if [ -z "$PY" ]; then
  for c in /usr/bin/python3 /usr/local/bin/python3 /usr/bin/python3.13 /usr/bin/python3.12 /usr/bin/python3.11; do
    [ -x "$c" ] && { PY="$c"; break; }
  done
fi
if [ -z "$PY" ]; then
  echo "Python 3 fehlt auf der Box — installiere es (einzige Voraussetzung des Agents)"
  (apt-get update -qq && apt-get install -y --no-install-recommends python3) >/dev/null 2>&1 \
    || { echo "FEHLER: python3 liess sich nicht installieren"; exit 1; }
  PY="$(command -v python3 || true)"
fi
[ -n "$PY" ] || { echo "FEHLER: kein python3 gefunden"; exit 1; }
echo "Python: $PY  ($("$PY" -V 2>&1))"

install -d -m 700 "$DIR"
install -m 700 /tmp/agent.py "$DIR/agent.py"

cat > /etc/systemd/system/step-agent.service <<UNIT
[Unit]
Description=remote-step-installer agent
After=network-online.target
[Service]
ExecStart=$PY $DIR/agent.py --host 127.0.0.1 --port $PORT --paircode-file $DIR/paircode
Restart=no
[Install]
WantedBy=multi-user.target
UNIT

OWNER="${SUDO_USER:-dietpi}"
H="$(getent passwd "$OWNER" | cut -d: -f6)"

# ALTEN Code loeschen, bevor neu gestartet wird. Sonst ist die Wartebedingung eine
# Luege: die Datei ist noch vom letzten Lauf da, wir lesen einen VERALTETEN Code und
# das Pairing scheitert mit "bad code". Ausserdem verwaiste Agenten beenden, die
# sonst den Port halten und den neuen Start verhindern.
systemctl stop step-agent 2>/dev/null || true
pkill -f "[a]gent\.py --host" 2>/dev/null || true
rm -f "$DIR/paircode" ${H:+"$H/.step-agent-paircode"}
sleep 0.5

systemctl daemon-reload
systemctl enable step-agent >/dev/null 2>&1
systemctl start step-agent || { echo "FEHLER: Dienst startet nicht"; systemctl status step-agent --no-pager -l | tail -20; exit 1; }

for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  [ -s "$DIR/paircode" ] && break
  sleep 0.5
done
if [ ! -s "$DIR/paircode" ]; then
  echo "FEHLER: kein FRISCHER Pair-Code"; systemctl status step-agent --no-pager -l | tail -25; exit 1
fi
if [ "$(systemctl is-active step-agent)" != "active" ]; then
  echo "FEHLER: Dienst laeuft nicht"; systemctl status step-agent --no-pager -l | tail -25; exit 1
fi

# Kopie fuer den SSH-Benutzer, damit das Abholen ohne sudo klappt
if [ -n "$H" ]; then
  cp "$DIR/paircode" "$H/.step-agent-paircode"
  chown "$OWNER" "$H/.step-agent-paircode"
  chmod 600 "$H/.step-agent-paircode"
fi
rm -f /tmp/agent.py /tmp/step-agent-install.sh
echo INSTALLIERT
"""


def install_agent(user, host, port=22, agent_port=DEF_PORT):
    """Agent auf eine BESTEHENDE Box bringen — ohne Neuflashen."""
    src = os.path.join(repo_root(), "agent", "agent.py")
    if not os.path.isfile(src):
        say("err", f"agent.py nicht gefunden: {src}")
        return False
    say("h", "→ Agent auf die Box kopieren")
    # BEWUSST kein scp: DietPi nutzt standardmäßig **Dropbear**, und der hat kein
    # sftp-server — modernes scp spricht aber SFTP ("/usr/lib/sftp-server: No such
    # file or directory"). Über die Standardeingabe zu schieben klappt mit JEDEM
    # SSH-Server (Dropbear wie OpenSSH) und braucht kein Zusatzpaket.
    with open(src, "rb") as f:
        r = subprocess.run(ssh_base(user, host, port) + ["cat > /tmp/agent.py"], stdin=f)
    if r.returncode != 0:
        say("err", "Kopieren fehlgeschlagen (SSH/Passwort korrekt?)")
        return False
    # Installer-Skript hinueberschieben (gleiche stdin-Methode wie oben — Dropbear-tauglich)
    r = subprocess.run(ssh_base(user, host, port) + ["cat > /tmp/step-agent-install.sh"],
                       input=INSTALL_SH.encode())
    if r.returncode != 0:
        say("err", "Installer-Skript liess sich nicht ablegen")
        return False
    say("h", "→ installieren + starten (sudo auf der Box)")
    # interaktiv: sudo darf am Terminal nach dem Passwort fragen
    p = subprocess.run(ssh_base(user, host, port)
                       + [f"sudo bash /tmp/step-agent-install.sh {agent_port}"])
    return p.returncode == 0


def port_free(port):
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


def agent_answers(local, timeout=4):
    """Antwortet hinter dem Port WIRKLICH ein Agent? Ein belegter Port beweist das
    nicht (er kann von einem toten Tunnel oder etwas ganz anderem stammen). Ein
    HTTP 401 auf /status ist der Beweis: der Agent lebt und verlangt einen Token."""
    import urllib.error
    import urllib.request
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{local}/status", timeout=timeout)
        return True
    except urllib.error.HTTPError:
        return True               # 401/403 = da ist ein Agent
    except Exception:
        return False


def wait_agent(local, seconds=20):
    """Auf Bereitschaft warten — nach einem Dienst-Neustart lauscht der Agent nicht
    sofort (genau daran ist ein Lauf mit 'Connection reset by peer' gescheitert)."""
    end = time.time() + seconds
    while time.time() < end:
        if agent_answers(local, timeout=3):
            return True
        time.sleep(0.5)
    return False


def _kill_stale_tunnel(local, user, host, port):
    """Einen toten SSH-Tunnel auf diesem Port beenden. Nur EIGENE ssh-Prozesse, die
    genau diese Weiterleitung halten — und niemals der eigene Prozess (ein
    unvorsichtiges pkill -f trifft die eigene Kommandozeile)."""
    me = os.getpid()
    try:
        r = subprocess.run(["pgrep", "-a", "-u", str(os.getuid()), "ssh"],
                           capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return
    needle = f"-L {local}:localhost:"
    for line in (r.stdout or "").splitlines():
        pid, _, cmd = line.partition(" ")
        if needle in cmd and pid.isdigit() and int(pid) != me:
            try:
                os.kill(int(pid), signal.SIGTERM)
                say("dim", f"  toten Tunnel beendet (PID {pid})")
            except OSError:
                pass
    # auch die gemultiplexte Master-Verbindung schliessen, sonst haengt sie nach
    subprocess.run(["ssh", "-O", "exit"] + _mux(user, host, port) + [f"{user}@{host}"],
                   capture_output=True)
    time.sleep(0.5)


def open_tunnel(user, host, port=22, local=DEF_PORT, remote=DEF_PORT):
    """SSH-Tunnel im Hintergrund (-f). Der Agent lauscht nur auf 127.0.0.1 der Box —
    ohne Tunnel kommt niemand ran, auch wir nicht."""
    if not port_free(local):
        # NICHT blind annehmen, dass ein belegter Port ein funktionierender Tunnel ist
        if agent_answers(local):
            say("dim", f"  Port {local}: vorhandener Tunnel funktioniert — wird genutzt")
            return True
        say("warn", f"  Port {local} belegt, aber dahinter antwortet kein Agent — räume auf")
        _kill_stale_tunnel(local, user, host, port)
        if not port_free(local):
            say("err", f"  Port {local} bleibt belegt (fremder Prozess?). Anderer Port: --port 8100")
            return False
    cmd = (["ssh", "-p", str(port), "-f", "-N", "-o", "ExitOnForwardFailure=yes",
            "-o", "StrictHostKeyChecking=accept-new"] + _mux(user, host, port)
           + ["-L", f"{local}:localhost:{remote}", f"{user}@{host}"])
    say("h", f"→ Tunnel öffnen  (localhost:{local} → {host}:{remote})")
    if subprocess.run(cmd).returncode != 0:
        say("err", "Tunnel fehlgeschlagen")
        say("dim", "  Falls die Box Dropbear nutzt und Weiterleitung verweigert:")
        say("dim", "  auf der Box  dietpi-software install 105  (OpenSSH) — oder Agent mit --host 0.0.0.0 starten")
        return False
    for _ in range(20):
        if not port_free(local):
            return True
        time.sleep(0.2)
    return not port_free(local)


def pair(base, code):
    a = Agent(base)
    a.pair(code)
    tf = _token_file(base)
    with open(tf, "w") as f:
        f.write(a.token)
    os.chmod(tf, 0o600)
    return a


def run(host, user=DEF_USER, ssh_port=22, local=DEF_PORT, remote=DEF_PORT,
        install=False, tunnel_only=False, setup_key_on_connect=True):
    base = f"http://127.0.0.1:{local}"
    say("h", f"Box {user}@{host}")

    state = agent_state(user, host, ssh_port, remote)
    if state == "unreachable":
        say("err", f"Keine SSH-Verbindung zu {user}@{host}.")
        # Nach einem Netzwechsel stimmt weder die alte IP noch loest der Name
        # auf (kein avahi auf DietPi). Also selbst suchen: die Box wird an
        # unserem SSH-Schluessel erkannt, egal welche IP der Router vergab.
        if heile_hostkey(user, host, ssh_port):
            say("warn", "  Die Box wurde neu installiert — alten Hostschluessel entfernt, neuer Versuch")
            state = agent_state(user, host, ssh_port, remote)
    if state == "unreachable":
        say("h", "Suche die Box im eigenen Netz …")
        ip, info = finde_box(host, user, ssh_port, on_status=lambda t: say("dim", "  " + t))
        if not ip:
            say("err", f"  {info}")
            say("dim", "  Erreichbar? Richtiger Benutzer? (DietPi/MuPiBox: dietpi)")
            return 1
        say("ok", f"  Gefunden: {info} unter {ip} — mache damit weiter")
        host = ip
        state = agent_state(user, host, ssh_port, remote)
        if state == "unreachable":
            say("err", f"  {ip} antwortet ploetzlich nicht mehr")
            return 1
    say("ok" if state == "running" else "warn", f"  Agent: {state}")

    # Passwortfreie Anmeldung einrichten, solange der Kanal von agent_state()
    # noch offen ist — so kostet es KEINE zusaetzliche Passworteingabe.
    if setup_key_on_connect:
        st = setup_key(user, host, ssh_port)
        if st == "vorhanden":
            say("dim", "  Anmeldung: Schlüssel liegt bereits auf der Box")
        elif st.startswith("neu"):
            extra = " (lokales Schlüsselpaar neu erzeugt)" if "erzeugt" in st else ""
            say("ok", f"  Anmeldung: Schlüssel hinterlegt{extra} — ab jetzt ohne Passwort")
        elif st == "kein-schluessel":
            say("warn", "  Kein SSH-Schlüssel erzeugbar (ssh-keygen fehlt?) — es bleibt beim Passwort")
        else:
            say("warn", "  Schlüssel konnte nicht hinterlegt werden — es bleibt beim Passwort")

    if state != "running":
        if not install:
            say("warn", "  Der Agent läuft dort nicht.")
            say("dim", "  Mit --install bringe ich ihn per SSH hin (kein Neuflashen nötig).")
            return 2
        if not install_agent(user, host, ssh_port, remote):
            return 1
        say("ok", "  Agent installiert und gestartet")

    if not open_tunnel(user, host, ssh_port, local, remote):
        return 1
    if tunnel_only:
        say("ok", f"✓ Tunnel steht: {base}")
        return 0

    codes = fetch_paircodes(user, host, ssh_port)
    if not codes:
        say("err", "  Pair-Code nicht gefunden.")
        say("dim", "  Auf der Box:  sudo systemctl status step-agent")
        return 1
    say("ok", f"  Pair-Code abgeholt: {codes[0][:2]}****"
              + (f" ({len(codes)} Kandidaten)" if len(codes) > 1 else ""))

    # Nach einem Dienst-Neustart lauscht der Agent nicht sofort — warten statt
    # sofort zu pairen (sonst: "Connection reset by peer").
    if not wait_agent(local):
        say("err", "  Der Agent antwortet nicht über den Tunnel.")
        say("dim", "  Auf der Box prüfen:  sudo systemctl status step-agent")
        return 1

    last = None
    for i, code in enumerate(codes):        # veraltete Kopien einfach ueberspringen
        try:
            pair(base, code)
            last = None
            break
        except AgentError as e:
            last = e
            if i + 1 < len(codes):
                say("dim", "  (Code passte nicht — nächster Kandidat)")
    if last:
        say("err", f"  Pairing fehlgeschlagen: {last}")
        say("dim", "  Alle gefundenen Codes waren veraltet — auf der Box:")
        say("dim", "  sudo systemctl restart step-agent   (schreibt einen frischen Code)")
        return 1
    say("ok", "✓ verbunden + gepairt — der Token ist gespeichert.")
    print()
    say("h", "Weiter geht's (kein Pair-Code mehr nötig):")
    print(f"  ./connect {host} --watch      {C['dim']}# verbunden bleiben (nach Reboots automatisch){C['0']}")
    print(f"  ./tui     --recipe mupibox     {C['dim']}# oder demo{C['0']}")
    print("  ./stepctl --recipe mupibox")
    print(f"  ./rsi     sysinfo              {C['dim']}# was ist das für eine Box?{C['0']}")
    return 0


def ssh_reachable(host, port=22, timeout=4):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _stamp():
    return time.strftime("%H:%M:%S")


def watch(host, user=DEF_USER, ssh_port=22, local=DEF_PORT, remote=DEF_PORT, bell=True):
    """Verbindung ÜBERWACHEN und nach einem Neustart selbsttätig wiederherstellen.

    Der Ablauf hier steckt voller Reboots (DietPi-Erstinstallation, Display-Overlays,
    Kiosk) — jedes Mal von Hand neu zu verbinden nervt. Diese Schleife meldet den
    Verlust, wartet auf die Box, macht Tunnel + Pairing neu und meldet sich zurück.
    Es wird nur bei ZUSTANDSWECHSELN geschrieben, nicht bei jedem Test."""
    base = f"http://127.0.0.1:{local}"
    say("h", f"👁  Überwache {user}@{host} — Strg-C beendet nur die Überwachung")
    connected = agent_answers(local)
    say("ok" if connected else "warn",
        f"  [{_stamp()}] Start: {'verbunden' if connected else 'NICHT verbunden'}")
    fails = 0
    try:
        while True:
            time.sleep(5)
            if agent_answers(local, timeout=4):
                if not connected:
                    connected, fails = True, 0
                    say("ok", f"  [{_stamp()}] ✓ wieder verbunden" + ("\a" if bell else ""))
                continue
            if connected:                      # frisch verloren
                connected = False
                say("warn", f"  [{_stamp()}] ⚠ Verbindung weg (Neustart?) — warte auf die Box …"
                            + ("\a" if bell else ""))
            # Box zurück? Dann Tunnel + Pairing erneuern.
            if not ssh_reachable(host, ssh_port):
                continue
            say("dim", f"  [{_stamp()}] SSH ist wieder da — stelle Tunnel + Pairing her")
            _kill_stale_tunnel(local, user, host, ssh_port)
            if not open_tunnel(user, host, ssh_port, local, remote):
                fails += 1
            else:
                codes = fetch_paircodes(user, host, ssh_port)
                ok = False
                if codes and wait_agent(local, seconds=30):
                    for c in codes:
                        try:
                            pair(base, c)
                            ok = True
                            break
                        except AgentError:
                            pass
                if ok:
                    connected, fails = True, 0
                    say("ok", f"  [{_stamp()}] ✓ wieder verbunden (neu gepairt)" + ("\a" if bell else ""))
                else:
                    fails += 1
            if fails and fails % 3 == 0:
                say("dim", f"  [{_stamp()}] {fails} Versuche erfolglos — läuft der Agent? "
                           f"(auf der Box: systemctl status step-agent)")
    except KeyboardInterrupt:
        say("dim", "\n(Überwachung beendet — Tunnel und Pairing bleiben bestehen)")
        return 0


def main():
    ap = argparse.ArgumentParser(description="Box verbinden: Agent finden/installieren, Tunnel, Pairing")
    ap.add_argument("host", nargs="?", default=None,
                    help="IP oder Hostname der Box (weglassen + --find: nur suchen)")
    ap.add_argument("--user", default=DEF_USER, help=f"SSH-Benutzer (Standard: {DEF_USER})")
    ap.add_argument("--ssh-port", type=int, default=22)
    ap.add_argument("--port", type=int, default=DEF_PORT, help="lokaler Port für den Tunnel")
    ap.add_argument("--remote-port", type=int, default=DEF_PORT, help="Agent-Port auf der Box")
    ap.add_argument("--install", action="store_true", help="Agent per SSH installieren, falls er fehlt")
    ap.add_argument("--tunnel-only", action="store_true", help="nur den Tunnel öffnen, nicht pairen")
    ap.add_argument("--watch", action="store_true",
                    help="verbunden BLEIBEN: meldet Verbindungsverlust und verbindet nach einem Neustart selbst wieder")
    ap.add_argument("--no-bell", action="store_true", help="--watch: kein Signalton bei Zustandswechsel")
    ap.add_argument("--find", action="store_true",
                    help="Box im Netz suchen (erkannt am hinterlegten SSH-Schlüssel)")
    ap.add_argument("--no-key", action="store_true",
                    help="KEINEN SSH-Schlüssel hinterlegen (Standard: einmalig hinterlegen, danach passwortfrei)")
    a = ap.parse_args()
    if a.find and not a.host:
        gefunden = discover(a.user, a.ssh_port, on_status=lambda t: say("dim", "  " + t))
        if not gefunden:
            say("err", "keine Box mit unserem Schlüssel im Netz gefunden")
            return 1
        for g in gefunden:
            say("ok", f"  {g['hostname']}  unter  {g['ip']}")
        say("dim", f"  weiter mit:  ./connect {gefunden[0]['ip']} --install")
        return 0
    if not a.host:
        ap.error("Host angeben — oder mit --find suchen lassen")
    try:
        rc = run(a.host, a.user, a.ssh_port, a.port, a.remote_port, a.install, a.tunnel_only,
                 setup_key_on_connect=not a.no_key)
        if a.watch and rc == 0:
            rc = watch(a.host, a.user, a.ssh_port, a.port, a.remote_port, bell=not a.no_bell)
        sys.exit(rc)
    except KeyboardInterrupt:
        sys.exit(130)
    except subprocess.TimeoutExpired:
        sys.exit("Zeitüberschreitung — Box erreichbar?")


if __name__ == "__main__":
    main()
