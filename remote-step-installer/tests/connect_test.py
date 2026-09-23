#!/usr/bin/env python3
"""
Tests für die Box-Suche (controller/connect.py, discover/finde_box) — KEIN Netz:
alles Netzwerkige wird nachgestellt.

Der Anlass war real: nach einem Netzwechsel bekam die Box eine andere IP, der
Name 'mupibox' löste nicht auf (DietPi hat kein avahi), und ./connect gab nur
auf. Die Suche erkennt die Box am HINTERLEGTEN SSH-SCHLÜSSEL — ein Gerät, bei
dem er greift, IST unsere Box.

  python3 tests/connect_test.py       # exit 0 = alles gruen
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "controller"))
import connect  # noqa: E402

ok = bad = 0


def chk(name, cond):
    global ok, bad
    print(("  \033[32mOK  \033[0m" if cond else "  \033[31mFAIL\033[0m") + "  " + name)
    ok += bool(cond)
    bad += (not cond)


# ── Netz-Erkennung aus `ip -4 -o addr` (pure) ──────────────────────────────
IP_O = """1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever
2: wlan0    inet 192.168.178.34/24 brd 192.168.178.255 scope global dynamic wlan0\\       valid_lft 863993sec
3: docker0    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0\\       valid_lft forever
"""
netze = connect.subnets_von(IP_O)
chk("eigenes Netz erkannt", ("192.168.178", "192.168.178.34") in netze)
chk("Schleife (127.x) fliegt raus", not any(p.startswith("127.") for p, _ in netze))
chk("/16 wird auf die nahe /24 gedeckelt", ("172.17.0", "172.17.0.1") in netze)
chk("leere Eingabe: leere Liste", connect.subnets_von("") == [])
chk("doppeltes Netz nur einmal",
    len(connect.subnets_von(IP_O + IP_O)) == len(netze))

# ── finde_box: Auswahllogik (Discovery nachgestellt) ───────────────────────
_echt = connect.discover
try:
    connect.discover = lambda *a, **k: [{"ip": "192.168.7.9", "hostname": "mupibox"},
                                        {"ip": "192.168.7.5", "hostname": "andere"}]
    ip, name = connect.finde_box("mupibox")
    chk("Namensgleichheit gewinnt", (ip, name) == ("192.168.7.9", "mupibox"))
    ip, info = connect.finde_box("gibtsnicht")
    chk("mehrere Boxen ohne Namenstreffer -> keine Wahl", ip is None)
    chk("... und alle Kandidaten werden genannt", "mupibox@192.168.7.9" in info and "andere@" in info)

    connect.discover = lambda *a, **k: [{"ip": "192.168.7.9", "hostname": "andersgetauft"}]
    ip, name = connect.finde_box("mupibox")
    chk("EINE Box -> wird trotz anderem Namen genommen", ip == "192.168.7.9")

    connect.discover = lambda *a, **k: []
    ip, info = connect.finde_box("mupibox")
    chk("nichts gefunden -> klare Meldung", ip is None and "keine Box" in info)
finally:
    connect.discover = _echt

# ── Hostschluessel-Heilung (Neuinstallation aendert die Box-Identitaet) ────
import subprocess as _sp
_echt_run = _sp.run
_aufrufe = []


def _fake_run(mismatch):
    def f(cmd, **kw):
        _aufrufe.append(cmd)

        class R:
            returncode = 255
            stdout = ""
            stderr = ("@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@"
                      if mismatch and cmd[0] == "ssh" else "Permission denied")
        return R()
    return f


try:
    _aufrufe.clear()
    connect.subprocess.run = _fake_run(mismatch=True)
    chk("Identitaetswechsel wird erkannt und geheilt", connect.heile_hostkey("dietpi", "mupibox") is True)
    chk("... per ssh-keygen -R", any(c[0] == "ssh-keygen" and "-R" in c for c in _aufrufe))

    _aufrufe.clear()
    connect.subprocess.run = _fake_run(mismatch=False)
    chk("normale Ablehnung heilt NICHT", connect.heile_hostkey("dietpi", "mupibox") is False)
    chk("... und fasst known_hosts nicht an", not any(c[0] == "ssh-keygen" for c in _aufrufe))
finally:
    connect.subprocess.run = _echt_run

# ── agent_state: darf NIE auf systemctl bauen (DietPi maskiert dbus) ───────
# Am Geraet: der frisch installierte, nachweislich laufende Agent wurde als
# 'missing' gemeldet, weil systemctl als normaler Benutzer am fehlenden dbus
# scheitert und die leere Antwort das Parsen umkippte.
_echt_sshrun = connect.ssh_run
try:
    _probe = []

    def _fake_ssh(user, host, cmd, port=22, timeout=60, quiet=True):
        _probe.append(cmd)
        return _fake_ssh.antwort

    connect.ssh_run = _fake_ssh
    _fake_ssh.antwort = (0, "active yes", "")
    chk("Port lauscht -> running", connect.agent_state("d", "h") == "running")
    chk("die Probe fragt Port/Prozess, nicht systemctl",
        "ss -tln" in _probe[0] and "pgrep" in _probe[0] and "systemctl" not in _probe[0])
    chk("die Probe kennt den Agent-Port", "8099" in _probe[0])
    _fake_ssh.antwort = (0, "inactive yes", "")
    chk("Datei da, nichts lauscht -> installed", connect.agent_state("d", "h") == "installed")
    _fake_ssh.antwort = (0, "inactive no", "")
    chk("nichts da -> missing", connect.agent_state("d", "h") == "missing")
    _fake_ssh.antwort = (255, "", "")
    chk("ssh scheitert -> unreachable", connect.agent_state("d", "h") == "unreachable")
    _fake_ssh.antwort = (0, " yes", "")
    chk("die alte Einfeld-Antwort kippt NICHT mehr zu 'running'",
        connect.agent_state("d", "h") != "running")
finally:
    connect.ssh_run = _echt_sshrun

print(f"\n{ok}/{ok + bad} bestanden")
sys.exit(1 if bad else 0)
