#!/usr/bin/env python3
"""Die Bootkette der Box aufmachen: wer wartet auf wen, und wieviel davon ist Warten auf NICHTS.

WOZU: tools/grundmessung.py sagt WIE LANGE es bis zum Bild dauert (19-24 s,
gemessen 04.08.2026). Dieses Werkzeug sagt WARUM — es legt die Ordnungskette
frei, die den Kiosk zurueckhaelt, und rechnet den EINEN Posten aus, der sich
ohne Ersatz von Chromium zurueckholen laesst.

DIE KETTE, an der Box nachgesehen (systemctl show -p After):

    ifup@wlan0.service  ->  network.target  ->  systemd-user-sessions.service
                                            ->  getty@tty1.service
                                            ->  Autologin dietpi
                                            ->  chromium-autostart.sh -> Kiosk

Nichts daran ist MuPiBox-eigen; es ist die normale Debian-Ordnung. Aber sie
bedeutet: der Kiosk startet erst, wenn das WLAN eine Adresse hat — fuer eine
Seite, die unter http://localhost:8200 liegt und keine Adresse braucht.

DAS GEMESSENE, das die Entscheidung E5/B1 traegt (Box .169, 04.08.2026):

    [ 4,120] DHCPDISCOVER auf wlan0, interval 8   <- ins Leere, nicht assoziiert
    [ 6,609] CTRL-EVENT-CONNECTED                 <- ab hier ginge alles
    [11,560] DHCPDISCOVER, interval 14            <- erst jetzt wieder gefragt
    [11,675] DHCPOFFER von 192.168.178.1          <- Antwort nach 115 ms
    [11,792] bound
    [11,809] ifup@wlan0 aktiv
    [11,896] getty@tty1 aktiv  (+0,087 s)         <- der Kiosk faengt an

    ZURUECKHOLBAR = 11,560 - 6,609 = 4,95 s Warten auf NICHTS.

Das ist keine Schaetzung. Das Netz stand bei 6,6 s, der Router antwortete in
115 ms — und dazwischen lagen fuenf Sekunden, in denen dhclient sein
Rueckfall-Intervall abwartete, weil sein erster Antrag 2,5 s VOR der
Assoziation rausging.

DIE ZAHL, DIE DIESES WERKZEUG AUSRECHNET, ist genau diese Differenz. Sie ist
je Start anders (das WLAN assoziiert mal schneller, mal langsamer), und GENAU
DIESE STREUUNG ist die Streuung der Bootzeit: systemd-analyze meldete ueber
vier Kaltstarts 6,9 s bis 14,3 s.

FALLE, die eine Runde gekostet hat: `journalctl -b` OHNE sudo liefert dem
Benutzer dietpi NICHTS — kein Fehler, keine Meldung, eine leere Ausgabe. Wer
darauf ein "keine DHCP-Zeilen gefunden -> alles gut" baut, misst die
Berechtigung statt der Box. Deshalb wird hier mit sudo gelesen UND geprueft,
ob ueberhaupt Zeilen ankamen.

ZWEITE FALLE: dieselbe DHCP-Zeile steht ZWEIMAL im Protokoll, einmal unter
"dhclient[730]" und einmal unter "ifup[730]" (derselbe Prozess, zwei
Kennungen). Wer zaehlt statt zu entdoppeln, bekommt doppelte Ereignisse.

AUFRUF
    tools/bootkette-schau.py 192.168.178.169
    tools/bootkette-schau.py 192.168.178.169 --json
    tools/bootkette-schau.py 192.168.178.169 --repo /home/achim/Downloads/MuPiBox

WAS ES NICHT TUT
    Es aendert NICHTS an der Box. Nur `systemctl show`, `systemd-analyze` und
    `sudo journalctl -b` — alles lesend. Kein Neustart, keine Datei, kein
    Dienst. Nach jeder Aenderung erneut laufen lassen und die Zahlen
    vergleichen; fuer die Zeit bis zum Bild bleibt tools/grundmessung.py
    zustaendig.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

# Die Ordnungskette, die den Kiosk zurueckhaelt. Reihenfolge ist Absicht: von
# der Wurzel des Wartens bis zu dem Dienst, der den Browser startet.
KETTE = [
    ("ifup@wlan0.service", "WLAN holt eine Adresse (DHCP)"),
    ("network.target", "Sammelpunkt — wartet auf ifup@wlan0"),
    ("systemd-user-sessions.service", "After=network.target (Debian-Vorgabe)"),
    ("getty@tty1.service", "Autologin dietpi -> chromium-autostart.sh"),
]

# Die Hebel aus BACKLOG E5. Je Hebel: wie man ihn an der Box sieht, und wo er
# im Repo stehen muesste. "erwartet" = das Muster, das den Hebel belegt.
HEBEL = [
    {
        "id": "dhclient-rueckfall",
        "punkt": "B1/B3",
        "titel": "dhclient faellt nach der Assoziation sofort zurueck",
        "box_befehl": "cat /etc/dhcp/dhclient.conf",
        "box_muster": r"backoff-cutoff",
        # Der Hebel liegt NICHT als Vorlage im Repo, sondern als Skript mit
        # Rueckweg: /etc/dhcp/dhclient.conf enthaelt die request-Liste mit den
        # DNS-Servern, eine Vorlage haette sie ueberschrieben.
        "repo_datei": "scripts/mupibox/dhcp-schneller.sh",
        "repo_muster": r"^\s*echo \"backoff-cutoff 2;\"",
    },
    {
        "id": "zram",
        "punkt": "B7",
        "titel": "Swap als zram statt Auslagerungsdatei auf der SD",
        "box_befehl": "cat /proc/swaps",
        "box_muster": r"zram",
        # NICHT config/templates/dietpi.txt fragen — das war der erste Stand
        # und er hat gelogen (Gegenlesen 04.08.2026): die Vorlage kommt auf
        # KEINEM Weg dieses Repos auf eine Karte. make-boot-sd.sh aendert die
        # dietpi.txt der Karte an Ort und Stelle, autosetup.sh laeuft erst
        # nach DietPis Erstlauf. Wer die Vorlage abfragt, misst eine Absicht;
        # dieses Werkzeug soll den AUSROLLWEG messen.
        "repo_datei": "scripts/make-boot-sd.sh",
        "repo_muster": r"AUTO_SETUP_SWAPFILE_LOCATION=zram",
    },
    {
        "id": "disable-splash",
        "punkt": "B3",
        "titel": "disable_splash=1 (Regenbogenbild der Firmware aus)",
        "box_befehl": "cat /boot/firmware/config.txt 2>/dev/null || cat /boot/config.txt",
        "box_muster": r"^\s*disable_splash=1",
        "repo_datei": None,
        "repo_muster": None,
    },
    {
        "id": "boot-delay",
        "punkt": "B3",
        "titel": "boot_delay=0 (ist die Vorgabe der Firmware — kein Hebel)",
        "box_befehl": "cat /boot/firmware/config.txt 2>/dev/null || cat /boot/config.txt",
        "box_muster": r"^\s*boot_delay",
        "repo_datei": None,
        "repo_muster": None,
    },
    {
        "id": "rollbalken-aus",
        "punkt": "B5",
        "titel": "--hide-scrollbars im Kiosk",
        "box_befehl": "cat /var/lib/dietpi/dietpi-software/installed/chromium-autostart.sh",
        "box_muster": r"--hide-scrollbars",
        "repo_datei": "scripts/chromium-autostart.sh",
        "repo_muster": r"--hide-scrollbars",
    },
    {
        "id": "log2ram",
        "punkt": "B7",
        "titel": "log2ram (soll NICHT da sein — DietPi-RAMlog tut dasselbe)",
        "box_befehl": "systemctl list-unit-files 'log2ram*' --no-pager 2>/dev/null; true",
        "box_muster": r"log2ram\.service",
        "repo_datei": None,
        "repo_muster": None,
    },
]


def ferne(box: str, befehl: str, zeitlimit: int = 30) -> tuple[int, str]:
    """Einen Befehl auf der Box ausfuehren. Rueckgabe: (Rueckgabewert, Ausgabe).

    Kein `check=True` — mehrere Abfragen duerfen fehlschlagen (eine Datei fehlt,
    ein Dienst ist unbekannt), und genau dieses Fehlschlagen ist das Ergebnis.
    """
    ssh = [
        "ssh",
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=8",
        "-o", "StrictHostKeyChecking=accept-new",
        f"dietpi@{box}",
        befehl,
    ]
    try:
        e = subprocess.run(ssh, capture_output=True, text=True, timeout=zeitlimit)
    except subprocess.TimeoutExpired:
        return 124, ""
    return e.returncode, (e.stdout or "") + (e.stderr or "")


def monotone_marken(box: str) -> dict[str, float | None]:
    """Wann wurde jede Einheit der Kette aktiv? Sekunden seit Kernelstart.

    systemd fuehrt diese Marken in Mikrosekunden; 0 heisst "nie aktiv geworden".
    """
    marken: dict[str, float | None] = {}
    for einheit, _ in KETTE:
        rc, aus = ferne(box, f"systemctl show {einheit} -p ActiveEnterTimestampMonotonic")
        treffer = re.search(r"ActiveEnterTimestampMonotonic=(\d+)", aus)
        wert = int(treffer.group(1)) if treffer else 0
        marken[einheit] = wert / 1_000_000 if wert > 0 else None
    return marken


def dhcp_verlauf(box: str) -> dict:
    """Die DHCP-/WLAN-Zeitleiste dieses Starts — und das Warten auf nichts.

    Gelesen wird `sudo journalctl -b -o short-monotonic`. Ohne sudo bekommt
    dietpi eine LEERE Ausgabe (kein Fehler!) — deshalb wird `zeilen_gelesen`
    mitgegeben, damit ein Berechtigungsproblem nicht wie ein sauberer Start
    aussieht.
    """
    rc, aus = ferne(
        box,
        "sudo -n journalctl -b -o short-monotonic --no-pager 2>/dev/null "
        "| grep -iE 'DHCPDISCOVER|DHCPOFFER|DHCPACK|bound to|CTRL-EVENT-CONNECTED|Associated with'",
        zeitlimit=60,
    )
    ereignisse: list[tuple[float, str]] = []
    gesehen: set[tuple[float, str]] = set()
    for zeile in aus.splitlines():
        m = re.match(r"\[\s*([\d.]+)\]\s+(.*)$", zeile)
        if not m:
            continue
        t = float(m.group(1))
        rest = m.group(2)
        # Entdoppeln: dieselbe Meldung steht unter "dhclient[730]" UND unter
        # "ifup[730]" — derselbe Prozess, zwei Kennungen. Die Kennung faellt
        # deshalb weg, bevor verglichen wird.
        kern = re.sub(r"^\S+\s+\S+\[\d+\]:\s*", "", rest).strip()
        schluessel = (round(t, 3), kern)
        if schluessel in gesehen:
            continue
        gesehen.add(schluessel)
        ereignisse.append((t, kern))
    ereignisse.sort()

    def erstes(muster: str) -> float | None:
        for t, text in ereignisse:
            if re.search(muster, text, re.I):
                return t
        return None

    verbunden = erstes(r"CTRL-EVENT-CONNECTED|Associated with")
    gebunden = erstes(r"bound to")
    # Der erste DHCP-Versuch NACH der Assoziation — das ist der, der geklappt
    # haette, wenn er frueher gekommen waere.
    nach_verbindung = None
    if verbunden is not None:
        for t, text in ereignisse:
            if t > verbunden and re.search(r"DHCPDISCOVER|DHCPREQUEST", text, re.I):
                nach_verbindung = t
                break

    zurueckholbar = None
    if verbunden is not None and nach_verbindung is not None:
        zurueckholbar = round(nach_verbindung - verbunden, 3)

    return {
        "zeilen_gelesen": len(aus.splitlines()),
        "sudo_verweigert": rc != 0 and not aus.strip(),
        "ereignisse": [{"t": t, "text": x} for t, x in ereignisse],
        "verbunden_s": verbunden,
        "erster_versuch_nach_verbindung_s": nach_verbindung,
        "gebunden_s": gebunden,
        "zurueckholbar_s": zurueckholbar,
    }


def hebel_pruefen(box: str, repo: Path | None) -> list[dict]:
    """Je Hebel: steht er auf der Box, und steht er im Repo?

    Der Unterschied ist der eigentliche Punkt. Die laufende Box hat Dinge, die
    ein frisch aus dem Repo aufgesetztes Geraet NICHT haette (Zwei-Repos-Delta,
    siehe BACKLOG E12) — wer nur die Box ansieht, haelt sie faelschlich fuer
    erledigt.
    """
    ergebnis = []
    for h in HEBEL:
        rc, aus = ferne(box, h["box_befehl"])
        auf_box = bool(re.search(h["box_muster"], aus, re.M | re.I)) if aus else False

        im_repo: bool | None = None
        if repo is not None and h["repo_datei"]:
            pfad = repo / h["repo_datei"]
            if pfad.is_file():
                im_repo = bool(
                    re.search(h["repo_muster"], pfad.read_text(errors="replace"), re.M)
                )
            else:
                im_repo = False

        ergebnis.append(
            {
                "id": h["id"],
                "punkt": h["punkt"],
                "titel": h["titel"],
                "auf_box": auf_box,
                "im_repo": im_repo,
                "repo_datei": h["repo_datei"],
            }
        )
    return ergebnis


def gesamtzeit(box: str) -> dict:
    rc, aus = ferne(box, "systemd-analyze 2>/dev/null; echo '---'; systemd-analyze blame --no-pager 2>/dev/null | head -8")
    kopf, _, schwanz = aus.partition("---")
    m = re.search(r"([\d.]+)s\s*\(kernel\).*?([\d.]+)s\s*\(userspace\).*?=\s*([\d.]+)s", kopf, re.S)
    return {
        "text": kopf.strip(),
        "kernel_s": float(m.group(1)) if m else None,
        "userspace_s": float(m.group(2)) if m else None,
        "gesamt_s": float(m.group(3)) if m else None,
        "groesste": [z.strip() for z in schwanz.strip().splitlines() if z.strip()],
    }


def bericht(daten: dict) -> None:
    print()
    print("═══ BOOTKETTE DER BOX ═══════════════════════════════════════════")
    print(f"    Box: {daten['box']}")
    print()

    g = daten["gesamtzeit"]
    print("  ── Gesamtzeit ────────────────────────────────────────────────")
    print(f"    {g['text'] or '(nicht ermittelbar)'}")
    if g["groesste"]:
        print("    Groesste Posten:")
        for z in g["groesste"]:
            print(f"      {z}")
    print()

    print("  ── Die Kette, die den Kiosk zurueckhaelt ─────────────────────")
    vorher = None
    for einheit, erklaerung in KETTE:
        t = daten["marken"].get(einheit)
        if t is None:
            print(f"    {einheit:<34} —        {erklaerung}")
            continue
        abstand = f"(+{t - vorher:.3f} s)" if vorher is not None else "         "
        print(f"    {einheit:<34} {t:7.3f} s {abstand}  {erklaerung}")
        vorher = t
    print()

    d = daten["dhcp"]
    print("  ── Warten auf NICHTS ─────────────────────────────────────────")
    if d["sudo_verweigert"] or d["zeilen_gelesen"] == 0:
        print("    Protokoll nicht lesbar (sudo journalctl). OHNE sudo ist die")
        print("    Ausgabe LEER statt fehlerhaft — das hier ist KEIN Freispruch.")
    else:
        for e in d["ereignisse"][:12]:
            print(f"    [{e['t']:8.3f}]  {e['text'][:66]}")
        print()
        if d["zurueckholbar_s"] is not None:
            print(f"    WLAN verbunden bei          {d['verbunden_s']:.3f} s")
            print(f"    naechster DHCP-Versuch bei  {d['erster_versuch_nach_verbindung_s']:.3f} s")
            if d["gebunden_s"] is not None:
                print(f"    Adresse da bei              {d['gebunden_s']:.3f} s")
            print()
            print(f"    ZURUECKHOLBAR: {d['zurueckholbar_s']:.3f} s — das Netz stand, der Router")
            print("    haette geantwortet, und dhclient wartete sein Rueckfall-Intervall ab.")
        else:
            print("    Keine vollstaendige DHCP-Folge in diesem Start gefunden.")
            print("    (Kabel statt WLAN? Feste Adresse? Dann ist hier nichts zu holen.)")
    print()

    print("  ── Hebel: Box gegen Repo ─────────────────────────────────────")
    print(f"    {'Punkt':<7}{'Hebel':<48}{'Box':<7}{'Repo'}")
    for h in daten["hebel"]:
        box_z = "ja" if h["auf_box"] else "nein"
        repo_z = "—" if h["im_repo"] is None else ("ja" if h["im_repo"] else "nein")
        print(f"    {h['punkt']:<7}{h['titel'][:46]:<48}{box_z:<7}{repo_z}")
    print()
    print("    'Box ja / Repo nein' ist das Zwei-Repos-Delta (BACKLOG E12): die")
    print("    laufende Box kann es, eine frisch aufgesetzte Box nicht.")
    print()


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("box", help="Adresse der Box, z.B. 192.168.178.169")
    p.add_argument("--json", action="store_true", help="Ergebnis als JSON statt als Bericht")
    p.add_argument(
        "--repo",
        default=str(Path(__file__).resolve().parent.parent),
        help="Wurzel des MuPiBox-Repos fuer den Soll-Ist-Vergleich",
    )
    a = p.parse_args()

    repo = Path(a.repo) if a.repo else None
    if repo is not None and not repo.is_dir():
        print(f"Repo nicht gefunden: {repo}", file=sys.stderr)
        repo = None

    rc, _ = ferne(a.box, "true", zeitlimit=15)
    if rc != 0:
        print(f"Box {a.box} antwortet nicht per SSH (dietpi@).", file=sys.stderr)
        return 2

    daten = {
        "box": a.box,
        "gesamtzeit": gesamtzeit(a.box),
        "marken": monotone_marken(a.box),
        "dhcp": dhcp_verlauf(a.box),
        "hebel": hebel_pruefen(a.box, repo),
    }

    if a.json:
        print(json.dumps(daten, indent=2, ensure_ascii=False))
    else:
        bericht(daten)
    return 0


if __name__ == "__main__":
    sys.exit(main())
