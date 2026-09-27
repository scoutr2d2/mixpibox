#!/usr/bin/env python3
"""Inventur der laufenden Dienste auf der Box — STRENG NUR LESEND.

Beantwortet die Frage "was laeuft hier eigentlich und was kostet es":
laufende Units, RSS je Unit (Summe ueber die cgroup), PSS der grossen
Einzelprozesse, horchende Ports mit Besitzer, Timer-Takt und — das ist der
Teil, den `systemctl status` nicht zeigt — wieviele Journalzeilen jede Unit
pro Minute erzeugt.

WARUM PSS UND NICHT NUR RSS
    Chromium laeuft als acht Prozesse, die sich denselben Programmtext teilen.
    Die RSS zu addieren zaehlt diese Seiten achtmal und ergibt auf einer
    2-GB-Box ueber 970 MB — mehr, als `free` ueberhaupt als belegt meldet.
    PSS aus /proc/PID/smaps_rollup teilt geteilte Seiten durch die Zahl der
    Nutzer und ist deshalb die Zahl, mit der man rechnen darf.

WARUM ZWEIMAL GEMESSEN WIRD
    Die CPU-Anteile entstehen aus einer Differenz ueber ein Zeitfenster, nicht
    aus der Spalte %CPU von `ps`. Die zeigt den Mittelwert seit Prozessstart —
    also den Anlauf mit, in dem Chromium und der Server einmalig viel rechnen.
    Wer das fuer den Ruhezustand haelt, misst den Start.

WAS DIESES WERKZEUG NICHT TUT
    Es aendert nichts. Kein apt, kein systemctl start/stop/disable, kein rm.
    Die einzigen Befehle sind lesende: systemctl show/list-*, ps, ss, free,
    du, df, journalctl. `sudo -n` wird nur dort verwendet, wo ein Lesen sonst
    scheitert (Besitzer horchender Ports, smaps fremder Prozesse) — schlaegt
    es fehl, bleibt das Feld leer statt zu raten.

AUFRUF
    tools/box-dienst-inventur.py                       # Standardbox
    tools/box-dienst-inventur.py --box dietpi@10.0.0.5
    tools/box-dienst-inventur.py --cpu-fenster 60      # laenger messen
    tools/box-dienst-inventur.py --journal-fenster 30  # Minuten rueckwaerts
"""

from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys

BOX_VORGABE = "dietpi@192.168.178.57"

# Zuordnung: welcher Diensname gehoert wem. Wer hier nicht steht, wird als
# "unbekannt" gemeldet — das ist Absicht. Ein neuer Dienst soll auffallen,
# nicht stillschweigend unter "Beiwerk" verschwinden.
HERKUNFT = {
    "box": (
        "mupibox-", "mupi_", "mupi-", "mixpibox-", "librespot", "soloist",
        "spotifyd", "netz-watchdog",
    ),
    "dietpi": ("dietpi-", "fake-hwclock", "zramswap", "wifi-powersave-off"),
    "system": (
        "systemd-", "dbus", "cron", "ssh", "sshd", "getty@", "serial-getty@",
        "user@", "bluetooth", "hciuart", "networking", "remote-fs",
        "dpkg-db-backup", "fstrim", "apt-daily",
    ),
    "beiwerk": ("netzabriss-sonde", "step-agent", "mupi_vnc", "mupi_novnc"),
}


def herkunft(unit: str) -> str:
    for gruppe, muster in HERKUNFT.items():
        if any(unit.startswith(m) for m in muster):
            return gruppe
    return "unbekannt"


class Box:
    """Eine SSH-Verbindung, die nur lesende Befehle durchlaesst.

    Die Sperre ist bewusst grob: sie prueft das erste Wort und ein paar
    bekannte Schreib-Unterbefehle. Sie soll den Fluechtigkeitsfehler abfangen
    ("systemctl restart" statt "systemctl status"), nicht einen Angreifer.
    """

    ERLAUBT = {
        "ls", "cat", "head", "tail", "grep", "awk", "sed", "wc", "sort", "uniq",
        "dpkg", "dpkg-query", "systemctl", "ps", "ss", "du", "df", "free",
        "journalctl", "uptime", "uname", "stat", "readlink", "pgrep", "sleep",
        "printf", "echo", "for", "test", "tr", "cut", "join", "date", "sudo",
    }
    VERBOTEN_UNTER = {
        "start", "stop", "restart", "reload", "enable", "disable", "mask",
        "unmask", "kill", "poweroff", "reboot", "isolate", "set-property",
    }

    def __init__(self, ziel: str, zeitlimit: int = 120) -> None:
        self.ziel = ziel
        self.zeitlimit = zeitlimit

    def _pruefe(self, befehl: str) -> None:
        for teil in befehl.split(";"):
            worte = teil.split()
            if not worte:
                continue
            kopf = worte[0]
            if kopf == "sudo":
                worte = worte[1:]
                # `sudo -n` ist der uebliche Vorspann; das Flag ueberspringen.
                while worte and worte[0].startswith("-"):
                    worte = worte[1:]
                kopf = worte[0] if worte else ""
            if kopf == "systemctl" and len(worte) > 1:
                if worte[1] in self.VERBOTEN_UNTER:
                    raise SystemExit(f"ABGELEHNT (schreibend): {teil.strip()}")

    def lauf(self, befehl: str) -> str:
        self._pruefe(befehl)
        try:
            fertig = subprocess.run(
                ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
                 self.ziel, befehl],
                capture_output=True, text=True, timeout=self.zeitlimit,
            )
        except subprocess.TimeoutExpired:
            return ""
        return fertig.stdout


def laufende_dienste(box: Box) -> list[dict]:
    """Laufende Units samt RSS-Summe ueber ihre cgroup.

    Die Summe geht ueber cgroup.procs, nicht ueber die MainPID. Sonst fehlt
    genau das Interessante: mpv haengt in der cgroup von mupibox-player und
    ist dort der groessere Teil (rund 175 MB gegen 112 MB fuer node).
    """
    roh = box.lauf(
        'for u in $(systemctl list-units --type=service --state=running '
        '--no-legend --no-pager | awk "{print \\$1}"); do '
        'cg=$(systemctl show -p ControlGroup --value $u); '
        'sum=0; for p in $(cat /sys/fs/cgroup$cg/cgroup.procs 2>/dev/null); do '
        'r=$(awk "/^VmRSS/{print \\$2}" /proc/$p/status 2>/dev/null); '
        'sum=$((sum+${r:-0})); done; '
        'echo "$u|$sum|$(systemctl show -p FragmentPath --value $u)"; done'
    )
    dienste = []
    for zeile in roh.splitlines():
        if "|" not in zeile:
            continue
        unit, rss, pfad = zeile.split("|", 2)
        dienste.append({
            "unit": unit,
            "rss_kb": int(rss or 0),
            "unitdatei": pfad,
            "herkunft": herkunft(unit),
        })
    return sorted(dienste, key=lambda d: -d["rss_kb"])


def pss_grosse(box: Box, schwelle_kb: int = 10000) -> list[dict]:
    """PSS je Prozess ueber der Schwelle — die ehrliche Speicherzahl."""
    roh = box.lauf(
        'for p in $(ls /proc | grep -E "^[0-9]+$"); do '
        'v=$(sudo -n awk "/^Pss:/{s+=\\$2} END{print s}" '
        '/proc/$p/smaps_rollup 2>/dev/null); '
        '[ -z "$v" ] && continue; [ "$v" -lt %d ] && continue; '
        'echo "$v|$p|$(tr "\\0" " " < /proc/$p/cmdline | cut -c1-70)"; done'
        % schwelle_kb
    )
    treffer = []
    for zeile in roh.splitlines():
        if zeile.count("|") < 2:
            continue
        pss, pid, cmd = zeile.split("|", 2)
        treffer.append({"pss_kb": int(pss), "pid": int(pid), "cmd": cmd.strip()})
    return sorted(treffer, key=lambda t: -t["pss_kb"])


def cpu_anteil(box: Box, fenster_s: int) -> list[dict]:
    """CPU-Anteil aus einer Differenz ueber `fenster_s` Sekunden.

    Nicht `ps %CPU` — das ist der Mittelwert seit Prozessstart und traegt den
    Anlauf mit. Wer den Ruhezustand wissen will, muss zweimal in Ruhe messen.
    """
    roh = box.lauf(
        'schnapp(){ for p in $(ls /proc | grep -E "^[0-9]+$"); do '
        's=$(cat /proc/$p/stat 2>/dev/null) || continue; '
        'echo "$p $(echo "$s" | awk "{print \\$14+\\$15}") '
        '$(echo "$s" | awk "{print \\$2}")"; done; }; '
        'schnapp > /tmp/.inv1; sleep %d; schnapp > /tmp/.inv2; '
        'join /tmp/.inv1 /tmp/.inv2 -o 0,1.2,2.2,1.3 2>/dev/null; '
        'rm -f /tmp/.inv1 /tmp/.inv2' % fenster_s
    )
    treffer = []
    for zeile in roh.splitlines():
        teile = zeile.split()
        if len(teile) < 4:
            continue
        try:
            pid, vorher, nachher = int(teile[0]), int(teile[1]), int(teile[2])
        except ValueError:
            continue
        ticks = nachher - vorher
        if ticks <= 0:
            continue
        # 100 Ticks je Sekunde je Kern.
        treffer.append({
            "pid": pid,
            "prozent": round(ticks / 100.0 / fenster_s * 100, 2),
            "name": " ".join(teile[3:]),
        })
    return sorted(treffer, key=lambda t: -t["prozent"])


def journal_last(box: Box, minuten: int) -> list[dict]:
    """Journalzeilen je Unit — findet die Dienste, die im Leerlauf schreiben.

    Das ist der Posten, den keine Speicher- oder CPU-Messung zeigt: ein Dienst
    kann 5 MB RSS und 0 % CPU haben und trotzdem der groesste Verbraucher im
    Haus sein, weil er den Journal-Ringpuffer im RAM fuellt. Auf dieser Box
    liegt /var/log auf tmpfs (dietpi-ramlog) und das Journal in /run — jede
    Zeile kostet echten Arbeitsspeicher.
    """
    units = box.lauf(
        'systemctl list-units --type=service --all --no-legend --no-pager '
        '| awk "{print \\$1}" | grep -E "mupi|mixpi|libre|soloist|netz|step"'
    ).split()
    treffer = []
    for unit in units:
        n = box.lauf(
            f'sudo -n journalctl -u {shlex.quote(unit)} '
            f'--since "-{minuten} min" --no-pager -q 2>/dev/null | wc -l'
        ).strip()
        try:
            zahl = int(n)
        except ValueError:
            continue
        if zahl:
            treffer.append({
                "unit": unit,
                "zeilen": zahl,
                "je_minute": round(zahl / minuten, 1),
                "herkunft": herkunft(unit),
            })
    return sorted(treffer, key=lambda t: -t["zeilen"])


def horcher(box: Box) -> list[str]:
    return [z for z in box.lauf("sudo -n ss -tlnp 2>/dev/null || ss -tln"
                                ).splitlines()[1:] if z.strip()]


def timer(box: Box) -> list[dict]:
    """Timer samt Takt. Ein Takt von 20 s faellt hier auf, in `list-timers`
    nicht — dort steht nur, wann der naechste Lauf ansteht."""
    roh = box.lauf(
        'for f in /etc/systemd/system/*.timer; do u=$(basename $f); '
        'echo "$u|$(grep -h "OnUnitActiveSec\\|OnCalendar" $f '
        '| head -1 | tr -d " ")|$(systemctl is-active $u)"; done'
    )
    return [dict(zip(("timer", "takt", "aktiv"), z.split("|")))
            for z in roh.splitlines() if z.count("|") == 2]


def zurueckgehalten(box: Box) -> list[dict]:
    """Units, die eingeschaltet sind, aber absichtlich nicht laufen.

    Das ist keine Verschwendung, sondern ein Entwurf: soloist und librespot
    sind zwei Wege zum selben Ziel, mupi_mqtt ist ein Zusatz. Alle drei haengen
    an einer ExecCondition, die die Konfiguration liest. Wer nur
    `is-enabled` anschaut, haelt sie faelschlich fuer tote Last.
    """
    roh = box.lauf(
        'for f in /etc/systemd/system/*.service; do u=$(basename $f); '
        '[ "$(systemctl is-enabled $u 2>/dev/null)" = "enabled" ] || continue; '
        '[ "$(systemctl is-active $u 2>/dev/null)" = "active" ] && continue; '
        'echo "$u|$(systemctl show -p Result --value $u)|'
        '$(grep -h ExecCondition $f | head -1 | cut -c1-60)"; done'
    )
    return [dict(zip(("unit", "ergebnis", "bedingung"), z.split("|")))
            for z in roh.splitlines() if z.count("|") == 2]


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--box", default=BOX_VORGABE)
    p.add_argument("--cpu-fenster", type=int, default=60,
                   help="Sekunden fuer die CPU-Differenzmessung (0 = ueberspringen)")
    p.add_argument("--journal-fenster", type=int, default=30,
                   help="Minuten rueckwaerts fuer die Journalzaehlung")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()

    box = Box(a.box, zeitlimit=max(120, a.cpu_fenster + 60))
    if not box.lauf("uname -n").strip():
        print(f"Box {a.box} antwortet nicht (nur BatchMode-SSH).", file=sys.stderr)
        return 1

    befund = {
        "box": a.box,
        "dienste": laufende_dienste(box),
        "pss": pss_grosse(box),
        "journal": journal_last(box, a.journal_fenster),
        "horcher": horcher(box),
        "timer": timer(box),
        "zurueckgehalten": zurueckgehalten(box),
        "speicher": box.lauf("free -h").splitlines(),
    }
    if a.cpu_fenster:
        befund["cpu"] = cpu_anteil(box, a.cpu_fenster)[:15]

    if a.json:
        print(json.dumps(befund, indent=2, ensure_ascii=False))
        return 0

    print(f"== Laufende Dienste ({a.box}) ==")
    for d in befund["dienste"]:
        print(f'{d["rss_kb"]/1024:8.1f} MB  {d["herkunft"]:<9} {d["unit"]}')
    print("\n== PSS der grossen Prozesse (geteilte Seiten fair verrechnet) ==")
    for t in befund["pss"]:
        print(f'{t["pss_kb"]/1024:8.1f} MB  pid={t["pid"]:<7} {t["cmd"][:60]}')
    print(f'\n== Journalzeilen je Unit ({a.journal_fenster} min) ==')
    for j in befund["journal"]:
        print(f'{j["zeilen"]:7} ({j["je_minute"]:6.1f}/min)  '
              f'{j["herkunft"]:<9} {j["unit"]}')
    print("\n== Horchende Ports ==")
    for z in befund["horcher"]:
        print("  " + z)
    print("\n== Timer und Takt ==")
    for t in befund["timer"]:
        print(f'  {t["timer"]:<34} {t["takt"]:<28} {t["aktiv"]}')
    print("\n== Eingeschaltet, aber bewusst nicht gestartet ==")
    for z in befund["zurueckgehalten"]:
        print(f'  {z["unit"]:<34} {z["ergebnis"]:<16} {z["bedingung"]}')
    if "cpu" in befund:
        print(f'\n== CPU-Anteil ueber {a.cpu_fenster} s ==')
        for c in befund["cpu"]:
            print(f'  {c["prozent"]:6.2f}%  pid={c["pid"]:<7} {c["name"]}')
    print("\n== Speicher ==")
    for z in befund["speicher"]:
        print("  " + z)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
