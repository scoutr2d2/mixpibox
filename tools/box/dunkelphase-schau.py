#!/usr/bin/env python3
"""WIE LANGE IST DER SCHIRM DUNKEL? — und was koennte ein Splash-Programm daran ueberhaupt aendern.

WOZU ES DAS GIBT
----------------
Am 05.09.2026 kam die Frage: "liefert Plymouth mehr bzw. schneller Infos?
Jetzt ist der Screen sehr lange dunkel." Die Frage klingt nach einer
Programmwahl, ist aber eine MESSFRAGE — und ohne Messung beantwortet man sie
falsch, weil zwei Zahlen fehlen:

  1. Ab WANN kann ueberhaupt ein Pixel erscheinen? Vorher ist jede Diskussion
     ueber Splash-Programme gegenstandslos. Auf dem Pi 5 sind `drm`, `vc4` und
     `drm_rp1_dsi` MODULE aus dem Root-Dateisystem (in /proc/modules
     nachgesehen, 05.09.2026) — der Schirm kann also fruehestens dann etwas
     zeigen, wenn das Root-FS steht und systemd sie geladen hat. Gemessen:
     11,6 s. KEIN Splash-Programm der Welt kommt davor, auch Plymouth nicht.
  2. Wann hoert die Anzeige wieder auf, BEVOR der Kiosk uebernimmt? Genau da
     lag auf dieser Box die zweite, groessere dunkle Luecke — und die sieht
     niemand, der nur "wie lange bis zum Bild" misst.

`tools/bootkette-schau.py` beantwortet WER AUF WEN WARTET (die Dienstkette).
Dieses Werkzeug beantwortet WAS DER MENSCH WANN SIEHT. Das ist nicht dasselbe:
die Bootkette war auf .62 unauffaellig erklaerbar, und der Schirm trotzdem
zweimal lange schwarz.

WAS ES AUSRECHNET
-----------------
Eine Zeitachse aus vier Marken und die dunklen Bloecke DAZWISCHEN:

    [0 s]           Strom an — nichts, physikalisch unvermeidbar
    [DRM da]        frueheste Moeglichkeit fuer irgendein Bild
    [Splash an/aus] was die Box tatsaechlich zeigt
    [Kiosk malt]    ab hier gehoert der Schirm der Oberflaeche

Und daraus die EINE Zahl, die die Plymouth-Frage entscheidet:
UNTERGRENZE = der DRM-Zeitpunkt. Ein Splash-Programm kann hoechstens die
Spanne zwischen Untergrenze und Kiosk fuellen — nie mehr.

WARUM NICHT `systemd-analyze` ALLEIN
------------------------------------
`systemd-analyze` meldet 33,5 s und nennt als groessten Posten ifup@wlan1.
Das stimmt und fuehrt trotzdem in die Irre: die Animation lief da laengst und
war schon wieder weg. Die Bootzeit ist nicht die Dunkelzeit.

FALLE, die hier eingebaut ist
-----------------------------
`journalctl`/`dmesg` liefern dem Benutzer dietpi OHNE sudo eine LEERE Ausgabe
statt eines Fehlers (siehe Wissenspaket `mupi-journal-leer-ist-keine-antwort`).
Wer darauf "keine Marke gefunden -> alles gut" baut, misst die Berechtigung
statt der Box. Deshalb wird `sudo -n` benutzt UND geprueft, ob es trug.

AUFRUF
------
    python3 tools/box/dunkelphase-schau.py
    python3 tools/box/dunkelphase-schau.py --box 192.168.178.62
    python3 tools/box/dunkelphase-schau.py --json

Rein lesend. Es startet nichts neu und aendert nichts.
"""

from __future__ import annotations

import argparse
import json
import re
import shlex
import subprocess
import sys

BOX_VORGABE = "192.168.178.62"
BENUTZER_VORGABE = "dietpi"

# Die Marken, an denen sich Sichtbarkeit entscheidet. Reihenfolge = Zeitachse.
# Jede Marke wird EINZELN belegt; eine fehlende Marke macht die Zeile "?" und
# nicht die ganze Messung ungueltig.
DRM_MUSTER = re.compile(r"\[\s*([0-9.]+)\].*\[drm\] Initialized (drm-rp1-dsi|vc4)")
FBCON_MUSTER = re.compile(r"\[\s*([0-9.]+)\].*Console: switching to colour frame buffer")
LUECKE_AB = 0.4  # Sekunden; darunter ist eine Kernel-Luecke kein Posten


def fern(box: str, benutzer: str, befehl: str, zeit: int = 25) -> tuple[int, str]:
    """Einen Befehl auf der Box ausfuehren. Gibt (rueckgabe, ausgabe) zurueck."""
    ssh = [
        "ssh", "-o", "ConnectTimeout=6", "-o", "BatchMode=yes",
        f"{benutzer}@{box}", befehl,
    ]
    try:
        f = subprocess.run(ssh, capture_output=True, text=True, timeout=zeit)
        return f.returncode, (f.stdout or "") + (f.stderr or "")
    except subprocess.TimeoutExpired:
        return 124, ""


def monoton(box: str, benutzer: str, unit: str, feld: str) -> float | None:
    """Einen systemd-Zeitstempel in Sekunden seit Bootbeginn holen."""
    rc, aus = fern(box, benutzer, f"systemctl show {shlex.quote(unit)} -p {feld} --value")
    if rc != 0:
        return None
    text = aus.strip().splitlines()
    if not text or not text[0].strip().isdigit():
        return None
    wert = int(text[0].strip())
    # 0 heisst bei systemd "nie passiert", nicht "bei Sekunde 0".
    return wert / 1_000_000 if wert > 0 else None


def zahl(x: float | None, einheit: str = " s") -> str:
    return "?" if x is None else f"{x:.3f}{einheit}"


def main() -> int:
    p = argparse.ArgumentParser(
        description="Wie lange ist der Schirm beim Start dunkel — und was koennte ein Splash-Programm daran aendern.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--box", default=BOX_VORGABE, help=f"Adresse der Box (Vorgabe {BOX_VORGABE})")
    p.add_argument("--benutzer", default=BENUTZER_VORGABE, help="SSH-Benutzer")
    p.add_argument("--json", action="store_true", help="Rohwerte als JSON statt als Bericht")
    a = p.parse_args()

    rc, _ = fern(a.box, a.benutzer, "true", zeit=12)
    if rc != 0:
        print(f"Box {a.box} nicht erreichbar (ssh gab {rc}).", file=sys.stderr)
        return 2

    # DIE SUDO-PRUEFUNG IST KEIN SCHMUCK: ohne sie liest man leere Ausgaben als
    # "nichts gefunden". Siehe mupi-journal-leer-ist-keine-antwort.
    rc_sudo, _ = fern(a.box, a.benutzer, "sudo -n true")
    darf_lesen = rc_sudo == 0

    befund: dict = {"box": a.box, "sudo": darf_lesen}

    # ── Marke 1: ab wann kann ueberhaupt ein Pixel erscheinen ──────────────
    drm_s = None
    fbcon_s = None
    luecken: list[tuple[float, float, str]] = []
    if darf_lesen:
        _, roh = fern(a.box, a.benutzer, "sudo -n dmesg", zeit=40)
        vorige = None
        for zeile in roh.splitlines():
            t = re.match(r"\[\s*([0-9.]+)\]", zeile)
            if t:
                jetzt = float(t.group(1))
                if vorige is not None and jetzt - vorige > LUECKE_AB:
                    luecken.append((vorige, jetzt, zeile.split("] ", 1)[-1][:70]))
                vorige = jetzt
            m = DRM_MUSTER.search(zeile)
            if m and drm_s is None:
                drm_s = float(m.group(1))
            m2 = FBCON_MUSTER.search(zeile)
            if m2 and fbcon_s is None:
                fbcon_s = float(m2.group(1))
    befund["drm_bereit_s"] = drm_s
    befund["fbcon_s"] = fbcon_s
    befund["kernel_luecken"] = [{"von": v, "bis": b, "danach": d} for v, b, d in luecken[:6]]

    # ── Marke 2: was die Box tatsaechlich zeigt ────────────────────────────
    splash_an = monoton(a.box, a.benutzer, "mupibox-boot-splash.service", "ExecMainStartTimestampMonotonic")
    splash_aus = monoton(a.box, a.benutzer, "mupibox-boot-splash.service", "ActiveExitTimestampMonotonic")
    befund["splash_an_s"] = splash_an
    befund["splash_aus_s"] = splash_aus

    # ── Marke 3: ab wann gehoert der Schirm dem Kiosk ──────────────────────
    # getty@tty1 traegt den Autologin, aus dem der Kiosk startet. ACHTUNG: der
    # Wert ist der LETZTE Start — wurde der Kiosk zur Laufzeit neu gestartet
    # (Browserwechsel!), steht hier eine Zahl weit jenseits des Bootens. Das
    # wird unten benannt statt stillschweigend verrechnet.
    getty_s = monoton(a.box, a.benutzer, "getty@tty1.service", "ActiveEnterTimestampMonotonic")
    graphical_s = monoton(a.box, a.benutzer, "graphical.target", "ActiveEnterTimestampMonotonic")
    befund["getty_s"] = getty_s
    befund["graphical_s"] = graphical_s

    _, uptime_roh = fern(a.box, a.benutzer, "cut -d. -f1 /proc/uptime")
    uptime = int(uptime_roh.strip().splitlines()[0]) if uptime_roh.strip().splitlines() else 0
    getty_frisch = getty_s is not None and graphical_s is not None and getty_s <= graphical_s + 60
    befund["getty_ist_vom_booten"] = getty_frisch

    # Ende der Anzeige = wann der Kiosk uebernimmt. Ist getty nachtraeglich neu
    # gestartet worden, ist graphical.target die ehrlichere Naht.
    kiosk_s = getty_s if getty_frisch else graphical_s

    if a.json:
        print(json.dumps(befund, indent=2, ensure_ascii=False))
        return 0

    print("═══ DUNKELPHASE DES SCHIRMS ═════════════════════════════════════")
    print(f"    Box: {a.box}   (wach seit {uptime} s)")
    if not darf_lesen:
        print("    WARNUNG: sudo -n ging nicht. dmesg-Marken fehlen — das ist")
        print("             KEIN Freispruch, sondern eine fehlende Messung.")

    print("\n  ── Zeitachse: was der Mensch wann sieht ──────────────────────")
    print(f"    {'Strom an':<34} {0.0:>9.3f} s   nichts — physikalisch unvermeidbar")
    print(f"    {'DRM-Treiber bereit':<34} {zahl(drm_s):>11}   FRUEHESTE Moeglichkeit fuer ein Bild")
    print(f"    {'Boot-Animation an':<34} {zahl(splash_an):>11}   ab hier steht etwas")
    print(f"    {'Boot-Animation aus':<34} {zahl(splash_aus):>11}   ab hier wieder schwarz")
    print(f"    {'Kiosk uebernimmt':<34} {zahl(kiosk_s):>11}   " +
          ("getty@tty1" if getty_frisch else "graphical.target (getty wurde spaeter neu gestartet)"))

    print("\n  ── Die dunklen Bloecke ───────────────────────────────────────")
    dunkel_gesamt = 0.0
    if splash_an is not None:
        vorn = splash_an
        dunkel_gesamt += vorn
        unvermeidbar = drm_s if drm_s is not None else 0.0
        print(f"    VORN   0,000 -> {splash_an:6.3f} s  = {vorn:5.2f} s dunkel")
        print(f"           davon {unvermeidbar:5.2f} s unvermeidbar (kein DRM-Treiber),")
        print(f"           holbar hoechstens {max(0.0, vorn - unvermeidbar):5.2f} s")
    if splash_aus is not None and kiosk_s is not None and kiosk_s > splash_aus:
        hinten = kiosk_s - splash_aus
        dunkel_gesamt += hinten
        print(f"    HINTEN {splash_aus:6.3f} -> {kiosk_s:6.3f} s  = {hinten:5.2f} s dunkel")
        print("           Die Animation ist WEG, der Kiosk noch nicht da.")
        print("           Voll holbar — es muss nur laenger etwas stehen.")
    if dunkel_gesamt:
        print(f"    ────────────────────────────────────────────────────────")
        print(f"    SUMME  {dunkel_gesamt:5.2f} s Schwarz, die der Mensch sieht")

    # NUR Luecken VOR der Uebernahme durch den Kiosk. Danach laeuft die Box
    # einfach weiter, und die Pause bis zur naechsten Kernelmeldung ist keine
    # Bootzeit — beim ersten Lauf stand hier eine "+2047 s"-Zeile, die nichts
    # bedeutete ausser "die Box lief eine halbe Stunde ruhig".
    grenze = kiosk_s if kiosk_s is not None else float("inf")
    fruehe = [(v, b, d) for v, b, d in luecken if b <= grenze]
    if fruehe:
        print("\n  ── Groesste Kernel-Luecken (wo die Zeit vorn hingeht) ────────")
        for v, b, d in sorted(fruehe, key=lambda x: x[1] - x[0], reverse=True)[:4]:
            print(f"    {v:7.3f} -> {b:7.3f} s  (+{b - v:5.2f} s)  danach: {d}")

    print("\n  ── Was ein Splash-Programm hoechstens aendern kann ───────────")
    if drm_s is not None and kiosk_s is not None:
        spanne = kiosk_s - drm_s
        print(f"    UNTERGRENZE  {drm_s:.2f} s — kein Programm zeigt frueher etwas.")
        print(f"    OBERGRENZE   {kiosk_s:.2f} s — ab da gehoert der Schirm dem Kiosk.")
        print(f"    SPANNE       {spanne:.2f} s ist ueberhaupt fuellbar.")
        if splash_an is not None and splash_aus is not None:
            gefuellt = splash_aus - splash_an
            print(f"    GEFUELLT     {gefuellt:.2f} s davon fuellt die Animation heute")
            print(f"                 -> {spanne - gefuellt:.2f} s liegen brach.")
            print("    Ein ANDERES Programm holt davon nichts, was dieses nicht")
            print("    auch holen kann: beide starten aus systemd, nach demselben")
            print("    DRM-Treiber. Der Unterschied liegt in der LAUFZEIT, nicht")
            print("    in der Startzeit.")
    else:
        print("    Nicht berechenbar — Marken fehlen (sudo? Dienst umbenannt?).")

    return 0


if __name__ == "__main__":
    sys.exit(main())
