#!/usr/bin/env python3
"""Protokolle der Box lesen und ZAEHLEN - rein lesend, nichts wird veraendert.

Gruppiert Meldungen nach Wortlaut (Zahlen/PIDs/Zeiten werden zu Platzhaltern),
zaehlt sie und nennt den Zeitraum. Damit wird aus "es gibt Warnungen" ein Befund
wie "137-mal dieselbe Warnung in 6 Stunden".

Beispiele:
    python3 tools/protokolle-lesen.py                      # Ueberblick
    python3 tools/protokolle-lesen.py --dienst mupibox-server
    python3 tools/protokolle-lesen.py --strom              # Unterspannung/Temperatur
    python3 tools/protokolle-lesen.py --dateien            # /var/log/... statt journal
    python3 tools/protokolle-lesen.py --roh 'mupihat'      # Volltextsuche

Die Box wird NUR gelesen: journalctl, dmesg, cat. Kein Loeschen, kein Rotieren,
kein Neustart.
"""

from __future__ import annotations

import argparse
import re
import shlex
import subprocess
import sys
from collections import Counter, defaultdict

BOX = "dietpi@192.168.178.169"

# Reihenfolge zaehlt: das Speziellere zuerst.
MUSTER: list[tuple[str, str]] = [
    (r"\b[0-9a-f]{2}(:[0-9a-f]{2}){5}\b", "<MAC>"),
    (r"\b(?:\d{1,3}\.){3}\d{1,3}\b", "<IP>"),
    (r"\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}\S*", "<ZEIT>"),
    (r"\b\d{2}:\d{2}:\d{2}\b", "<ZEIT>"),
    (r"\[\s*\d+\.\d+\]", "[<T>]"),
    (r"\b0x[0-9a-fA-F]+\b", "<HEX>"),
    (r"/dev/\S+", "<GERAET>"),
    (r"\b\d+\b", "<N>"),
]

DIENST_NAMEN = [
    "mupibox-server",
    "mupibox-player",
    "mupibox-touch-bridge",
    "mupibox-bt-reconnect",
    "mupi_hat",
    "mupi_hat_control",
    "mupi_powerled",
    "mupi_check_internet",
    "mupi_check_monitor",
    "mupi_change_checker",
    "librespot",
    "librespot-waechter",
    "mupibox-alsa-init",
    "mupibox-netz-watchdog-boot",
    "wifi-powersave-off",
]

STROM_WORTE = [
    "undervoltage",
    "under-voltage",
    "Unterspannung",
    "throttl",
    "temperature",
    "thermal",
    "overheat",
    "hwmon",
    "brownout",
    "voltage",
]


def am_geraet(befehl: str, timeout: int = 60) -> str:
    """Einen rein lesenden Befehl auf der Box ausfuehren."""
    fertig = subprocess.run(
        ["ssh", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes", BOX, befehl],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if fertig.returncode != 0 and not fertig.stdout:
        return f"[FEHLER rc={fertig.returncode}] {fertig.stderr.strip()}"
    return fertig.stdout


def kern(zeile: str) -> str:
    """Den Wortlaut einer Meldung auf ihren Kern bringen."""
    # Syslog-Kopf (Datum Host Dienst[pid]:) abschneiden
    zeile = re.sub(r"^\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\S+\s+", "", zeile)
    zeile = re.sub(r"^\S+\s+\d{2}:\d{2}:\d{2}\s+\S+\s+", "", zeile)
    zeile = re.sub(r"^[a-zA-Z0-9_.@-]+\[\d+\]:\s*", "", zeile)
    for muster, ersatz in MUSTER:
        zeile = re.sub(muster, ersatz, zeile)
    return zeile.strip()[:200]


def zeitstempel(zeile: str) -> str | None:
    m = re.match(r"^(\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2})", zeile)
    if m:
        return m.group(1)
    m = re.match(r"^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})", zeile)
    return m.group(1) if m else None


def gruppieren(text: str) -> list[tuple[str, int, str | None, str | None]]:
    """(Wortlaut, Anzahl, erste Zeit, letzte Zeit), haeufigste zuerst."""
    zaehler: Counter[str] = Counter()
    zeiten: dict[str, list[str]] = defaultdict(list)
    for zeile in text.splitlines():
        zeile = zeile.rstrip()
        if not zeile.strip() or zeile.startswith("-- "):
            continue
        k = kern(zeile)
        if not k:
            continue
        zaehler[k] += 1
        z = zeitstempel(zeile)
        if z:
            zeiten[k].append(z)
    ergebnis = []
    for wortlaut, anzahl in zaehler.most_common():
        zs = zeiten.get(wortlaut) or []
        ergebnis.append((wortlaut, anzahl, zs[0] if zs else None, zs[-1] if zs else None))
    return ergebnis


_LAUFZEIT: float | None = None


def laufzeit_s() -> float | None:
    """Laufzeit der Box in Sekunden, aus /proc/uptime.

    NICHT aus dem ersten Journal-Eintrag rechnen. Die Uhr wird beim Booten
    erst NACH dem Journal gestellt ("Time jumped backwards, rotating"), der
    Start steht dann bis zu einer Dreiviertelstunde zu frueh. Am 07.08.2026
    behauptete das Journal 43 Minuten, wo 15 vergangen waren - jede Rate
    waere um den Faktor 2,8 zu niedrig herausgekommen.
    """
    global _LAUFZEIT
    if _LAUFZEIT is None:
        roh = am_geraet("cat /proc/uptime").split()
        try:
            _LAUFZEIT = float(roh[0])
        except (IndexError, ValueError):
            _LAUFZEIT = -1.0
    return None if _LAUFZEIT < 0 else _LAUFZEIT


def rate(anzahl: int) -> str:
    """Haeufigkeit als Rate - das macht aus einer Zahl einen Befund."""
    dauer = laufzeit_s()
    if not dauer or anzahl < 2:
        return ""
    je_s = anzahl / dauer
    # Tausenderpunkte NUR an der Tageszahl - ein pauschales replace(",", ".")
    # traefe auch das Komma zwischen den beiden Angaben.
    am_tag = f"{int(je_s * 86400):,}".replace(",", ".")
    if je_s >= 1:
        return f"  ({je_s:.1f}/s, ~{am_tag}/Tag)"
    if je_s * 60 >= 1:
        return f"  ({je_s * 60:.1f}/min, ~{am_tag}/Tag)"
    return f"  (alle {1 / je_s:.0f}s, ~{am_tag}/Tag)"


def ausgeben(titel: str, text: str, grenze: int = 15) -> None:
    print(f"\n=== {titel} ===")
    gruppen = gruppieren(text)
    if not gruppen:
        print("  (still)")
        return
    gesamt = sum(g[1] for g in gruppen)
    dauer = laufzeit_s()
    hinweis = f", Box laeuft seit {dauer:.0f}s" if dauer else ""
    print(f"  {gesamt} Zeilen, {len(gruppen)} verschiedene Wortlaute{hinweis}")
    for wortlaut, anzahl, erste, letzte in gruppen[:grenze]:
        spanne = f"  [{erste} .. {letzte}]" if erste and erste != letzte else (f"  [{erste}]" if erste else "")
        print(f"  {anzahl:5d}x{rate(anzahl)}  {wortlaut}{spanne}")


def ueberblick(seit: str) -> None:
    print(f"# Lage der Box ({BOX})")
    print(am_geraet("uptime; echo; sudo -n journalctl --list-boots --no-pager -q | tail -5"))

    ausgeben(
        "journalctl -p warning (dieser Start)",
        am_geraet("sudo -n journalctl -b -p warning --no-pager -q -o short-iso"),
        grenze=25,
    )
    ausgeben(
        f"journalctl -p err seit {seit}",
        am_geraet(f"sudo -n journalctl --since {shlex.quote(seit)} -p err --no-pager -q -o short-iso"),
    )
    ausgeben("dmesg (Kernel, dieser Start)", am_geraet("sudo -n dmesg -T 2>/dev/null | tail -400"), grenze=20)

    print("\n=== Dienste: Zustand und Neustarts ===")
    for name in DIENST_NAMEN:
        zeile = am_geraet(
            f"systemctl show {shlex.quote(name)} "
            "-p ActiveState -p SubState -p NRestarts -p ExecMainStatus --value --no-pager | tr '\\n' ' '"
        ).strip()
        print(f"  {name:32s} {zeile}")


def dienst(name: str, seit: str) -> None:
    ausgeben(
        f"journalctl -u {name} seit {seit}",
        am_geraet(f"sudo -n journalctl -u {shlex.quote(name)} --since {shlex.quote(seit)} --no-pager -q -o short-iso"),
        grenze=25,
    )


def strom() -> None:
    print("\n=== Strom, Drosselung, Temperatur ===")
    print(am_geraet(
        "vcgencmd get_throttled 2>/dev/null; vcgencmd measure_temp 2>/dev/null; "
        "vcgencmd measure_volts 2>/dev/null; "
        "cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null"
    ))
    print("  get_throttled: Bit0=jetzt unterspannt, Bit2=jetzt gedrosselt,")
    print("                 Bit16=seit Start unterspannt gewesen, Bit18=gedrosselt gewesen")
    suche = "|".join(STROM_WORTE)
    ausgeben(
        "Kernel/Journal zu Spannung und Waerme",
        am_geraet(
            f"(sudo -n dmesg -T 2>/dev/null; sudo -n journalctl -b --no-pager -q -o short-iso 2>/dev/null) "
            f"| grep -iE {shlex.quote(suche)}"
        ),
    )


def dateien() -> None:
    print("\n=== Protokolldateien ===")
    print(am_geraet(
        "ls -la /var/log/mupibox/ 2>/dev/null || echo '(kein /var/log/mupibox)'; echo; "
        "ls -la /var/log/*.log /var/log/syslog* /var/log/messages* 2>/dev/null | head -30; echo; "
        "ls -la /tmp/*.log /tmp/mupi* 2>/dev/null | head -20"
    ))
    for pfad in ("/var/log/syslog", "/var/log/mupibox/mupibox.log"):
        text = am_geraet(f"test -r {pfad} && tail -1500 {pfad} || true")
        if text.strip():
            ausgeben(f"{pfad} (letzte 1500 Zeilen)", text, grenze=20)


def roh(muster: str, seit: str) -> None:
    ausgeben(
        f"Volltextsuche '{muster}'",
        am_geraet(
            f"(sudo -n journalctl --since {shlex.quote(seit)} --no-pager -q -o short-iso; "
            f"sudo -n dmesg -T 2>/dev/null) | grep -iE {shlex.quote(muster)}"
        ),
        grenze=25,
    )


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--seit", default="-7 days", help="Zeitraum fuer journalctl --since (Vorgabe: -7 days)")
    p.add_argument("--dienst", help="nur diesen Dienst ansehen")
    p.add_argument("--strom", action="store_true", help="Unterspannung, Drosselung, Temperatur")
    p.add_argument("--dateien", action="store_true", help="Protokolldateien statt journal")
    p.add_argument("--roh", help="Volltextsuche (erweiterter regulaerer Ausdruck)")
    a = p.parse_args()

    getan = False
    if a.dienst:
        dienst(a.dienst, a.seit); getan = True
    if a.strom:
        strom(); getan = True
    if a.dateien:
        dateien(); getan = True
    if a.roh:
        roh(a.roh, a.seit); getan = True
    if not getan:
        ueberblick(a.seit)
    return 0


if __name__ == "__main__":
    sys.exit(main())
