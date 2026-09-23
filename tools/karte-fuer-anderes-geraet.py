#!/usr/bin/env python3
"""EINE MIXPI-KARTE GEGEN EIN ANDERES ZIELGERAET HALTEN — rein lesend, vor dem Einschalten.

WOZU ES DAS GIBT (31.08.2026)
Eine Karte, die auf dem Pi 5 grossgezogen wurde, wandert in den Pi 4. Oder ein
anderes Panel kommt an denselben Anschluss. Beides sieht aus wie „einstecken und
gut" — und beides hat in diesem Projekt schon einen schwarzen Schirm erzeugt, bei
dem NICHTS im Netz zu sehen war, weil das Geraet gar nicht so weit kam.

Der teure Teil ist nicht der Fehler, sondern die Reihenfolge: Ist die Karte erst
im Geraet und das Geraet zeigt nichts, hat man keine Tastatur, kein Bild und kein
SSH, um nachzusehen. Man muss die Karte wieder herausnehmen — also genau hierher
zurueck. Deshalb schaut dieses Werkzeug VORHER, solange die Karte im Leser liegt
und jede Datei einfach lesbar ist.

WAS ES NICHT TUT
Es schreibt NICHTS. Es mountet nichts selbst um, es setzt kein Overlay, es fasst
die Karte nicht an. Eine Karte ist der einzige Zustand, den es von einem Geraet
gibt; ein Werkzeug, das „nur schnell" hineinschreibt, nimmt einem den Rueckweg.
Wer die Befunde umsetzen will, bekommt am Ende die Zeilen ausgedruckt und
entscheidet selbst.

DIE BEFUNDE, NACH GEWICHT — die Einteilung ist die eigentliche Leistung
  HART      Das Geraet kommt nicht hoch oder bleibt schwarz. Vor dem Einschalten
            zu beheben, sonst faehrt man die Karte zweimal.
  WICHTIG   Es laeuft, aber etwas ist still falsch — der gefaehrlichere Fall.
            Der Namensgleichstand zweier Boxen gehoert hierher: die zweite Box
            wirkt bedienbar und schickt den Ton in den falschen Raum
            (ANGLEICH-PI4-PI5.md, „Ein Fehler, der sich nicht als Fehler meldet").
  HINWEIS   Ballast oder Alter. Stoert nicht, sollte man aber wissen.

WAS GEPRUEFT WIRD, und warum jedes Einzelne schon einmal wehgetan hat

1. PANEL-OVERLAY gegen das ZIELGERAET.
   Der Pi 5 hat ZWEI DSI-Anschluesse, der Pi 4 hat EINEN. Ein `,dsi1`-Zusatz, der
   auf dem Pi 5 richtig ist, zeigt auf dem Pi 4 auf einen Anschluss, den es nicht
   gibt -> schwarz. Umgekehrt laesst ein fehlender Zusatz auf dem Pi 5 den
   Overlay auf den Vorgabe-Anschluss gehen, was nur stimmt, wenn das Flachband
   auch dort steckt.
2. ZWEI PANEL-OVERLAYS gleichzeitig (llmwiki `mupi-dsi-overlay-conflict`) und die
   MISCHUNG aus `vc4-fkms-*` und `vc4-kms-dsi-*` — beides endet dunkel.
3. `waveshare-panel,5_0_inch` an einem 800x480-Panel. Dieser Parameter bedeutet
   laut `/boot/firmware/overlays/README` **720x1280**; ein 800x480-Panel bleibt
   damit komplett schwarz, ohne Touch-Geraet (llmwiki `achim-display`, am Geraet
   am 25.07.2026 bewiesen). Der richtige Overlay fuer 800x480 ueber die
   tc358762-Bruecke ist der offizielle 7-Zoll-Overlay — auch fuer 5-Zoll-Panels.
4. OFFENE MODELL-FILTER. `[pi5]`-Bloecke in config.txt sind STICKY: alles
   dahinter gilt nur noch fuer dieses Modell. Ein Block, der nicht mit `[all]`
   geschlossen wird, „vergiftet" den Rest der Datei — auf dem anderen Modell
   fehlt dann stillschweigend die halbe Konfiguration.
5. DTB fuers Ziel. Ohne `bcm2711-rpi-4-b.dtb` kommt ein Pi 4 nicht hoch.
6. WURZEL-KENNUNGEN. `cmdline.txt` zeigt per PARTUUID auf die Wurzel, `fstab`
   per UUID. Stimmt eine davon nicht mit der Karte ueberein, endet der Start im
   initramfs — und zwar ohne Netz.
7. KIOSK-BROWSER: was die Konfiguration verlangt (`mupibox.kioskBrowser`) gegen
   das, was auf der Karte liegt. Fehlt cog, faellt das Startskript auf Chromium
   zurueck (chromium-autostart.sh:239) — das ist ein HINWEIS, kein Ausfall. Fehlt
   auch Chromium, ist es hart.
8. AUFLOESUNG: `chromium.resX/resY` gegen die Panelgroesse.
9. NAMENSGLEICHSTAND gegen das laufende Netz (nur mit `--netz`).
10. ALTER des Standes auf der Karte.

AUFRUF
    tools/karte-fuer-anderes-geraet.py --ziel pi4
    tools/karte-fuer-anderes-geraet.py --ziel pi4 --netz
    tools/karte-fuer-anderes-geraet.py --ziel pi5 --panel 800x480
    tools/karte-fuer-anderes-geraet.py --boot /run/media/x/FCC6-0430 --wurzel /run/media/x/abc
    tools/karte-fuer-anderes-geraet.py --ziel pi4 --json

Ohne `--boot`/`--wurzel` sucht es die Karte selbst: unter den eingehaengten
Dateisystemen das vfat mit `config.txt` und das ext4 mit `etc/mupibox`. Findet es
mehr als eine, bricht es ab und nennt sie, statt zu raten — bei zwei Karten im
Leser waere die falsche genau der Fehler, den das Werkzeug verhindern soll.

RUECKGABEWERTE
    0  nichts Hartes gefunden (WICHTIG/HINWEIS koennen anstehen)
    1  Aufruf oder Umgebung — Karte nicht gefunden, nicht lesbar
    2  mindestens ein HARTER Befund — so nicht einschalten
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import socket
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

HART, WICHTIG, HINWEIS = "HART", "WICHTIG", "HINWEIS"
RANG = {HART: 0, WICHTIG: 1, HINWEIS: 2}

# Panel-Overlays, die ein DSI-Panel treiben. Auf SORTE geprueft, nicht auf einen
# festen Namen: was hier fehlt, faellt trotzdem unter „dsi" und wird gezaehlt.
PANEL_MERKMAL = re.compile(r"^dtoverlay=(vc4-[a-z]*kms-dsi-[a-z0-9-]+)", re.I)
GRAFIK_MERKMAL = re.compile(r"^dtoverlay=(vc4-(f?)kms-v3d)", re.I)
FILTER_MERKMAL = re.compile(r"^\[([a-z0-9+]+)\]\s*$", re.I)

# Was der jeweilige Anschlussname am Ziel bedeutet. Der Pi 4 hat EINEN DSI-Port,
# der Pi 5 hat zwei (llmwiki mupi-waveshare-dsi-config).
DSI_ANSCHLUESSE = {"pi4": 1, "pi3": 1, "pi5": 2}


@dataclass
class Befund:
    gewicht: str
    thema: str
    text: str
    tat: str = ""

    def zeile(self) -> str:
        return f"[{self.gewicht:7}] {self.thema}: {self.text}"


@dataclass
class Karte:
    boot: Path
    wurzel: Path
    befunde: list[Befund] = field(default_factory=list)

    def melde(self, gewicht: str, thema: str, text: str, tat: str = "") -> None:
        self.befunde.append(Befund(gewicht, thema, text, tat))


def lauf(befehl: list[str]) -> str:
    try:
        e = subprocess.run(befehl, capture_output=True, text=True, timeout=15)
        return e.stdout
    except (subprocess.SubprocessError, OSError):
        return ""


def karte_suchen() -> tuple[list[Path], list[Path]]:
    """Eingehaengte Dateisysteme durchsehen. Erkannt wird am INHALT, nicht am
    Einhaengepunkt: ein Pfad, der `/media/` heisst, ist kein Beweis, und eine
    Karte unter `/mnt/x` waere sonst unsichtbar."""
    boote, wurzeln = [], []
    for zeile in Path("/proc/mounts").read_text(errors="replace").splitlines():
        teile = zeile.split()
        if len(teile) < 3:
            continue
        punkt = Path(teile[1].replace("\\040", " "))
        art = teile[2]
        if art in ("proc", "sysfs", "devtmpfs", "cgroup2", "tmpfs", "devpts"):
            continue
        try:
            if art == "vfat" and (punkt / "config.txt").is_file():
                boote.append(punkt)
            elif art in ("ext4", "ext3", "btrfs") and (punkt / "etc/mupibox").is_dir():
                wurzeln.append(punkt)
        except (PermissionError, OSError):
            continue
    return boote, wurzeln


def config_lesen(boot: Path) -> list[tuple[int, str, str]]:
    """(Zeilennummer, aktiver Filter, Text) fuer jede WIRKSAME Zeile.

    Der Filter wird mitgefuehrt, weil er das eigentliche Missverstaendnis ist:
    eine Zeile unter `[pi5]` steht in der Datei, wirkt aber auf dem Pi 4 nicht."""
    aus = []
    filter_jetzt = "all"
    text = (boot / "config.txt").read_text(errors="replace")
    for nr, roh in enumerate(text.splitlines(), 1):
        s = roh.strip()
        if not s or s.startswith("#"):
            continue
        m = FILTER_MERKMAL.match(s)
        if m:
            filter_jetzt = m.group(1).lower()
            continue
        aus.append((nr, filter_jetzt, s))
    return aus


def wirksam(zeilen, ziel: str):
    """Nur die Zeilen, die auf dem ZIEL wirklich greifen."""
    return [(nr, f, t) for nr, f, t in zeilen if f in ("all", ziel, "none") and f != "none"]


def pruefe_config(k: Karte, ziel: str, panel_b: int, panel_h: int) -> None:
    zeilen = config_lesen(k.boot)
    aktiv = wirksam(zeilen, ziel)
    aktive_texte = [t for _, _, t in aktiv]

    # ── offene Modell-Filter ────────────────────────────────────────────────
    letzter = None
    for _, f, _ in zeilen:
        letzter = f
    if letzter and letzter not in ("all",):
        k.melde(
            HART, "config.txt",
            f"die Datei endet im Filter [{letzter}] — er ist STICKY und faengt jede "
            f"spaeter angehaengte Zeile ein",
            "am Dateiende `[all]` anhaengen",
        )
    # Zeilen, die auf dem Ziel NICHT greifen, aber nach Panel aussehen
    for nr, f, t in zeilen:
        if f not in ("all", ziel) and PANEL_MERKMAL.match(t):
            k.melde(
                WICHTIG, "config.txt",
                f"Zeile {nr} `{t}` steht unter [{f}] und wirkt auf {ziel} NICHT",
                f"fuer {ziel} eine eigene Zeile setzen oder den Filter oeffnen",
            )

    # ── Grafiktreiber ───────────────────────────────────────────────────────
    grafik = [(nr, m.group(1)) for nr, _, t in aktiv if (m := GRAFIK_MERKMAL.match(t))]
    panels = [(nr, m.group(1)) for nr, _, t in aktiv if (m := PANEL_MERKMAL.match(t))]

    if not grafik:
        k.melde(
            HART, "Grafik",
            "kein `dtoverlay=vc4-kms-v3d` wirksam — ohne KMS-Treiber bleibt das "
            "DSI-Panel dunkel (llmwiki: der autosetup-`rpi-opengl disable` hat genau "
            "das schon einmal erzeugt)",
            "dtoverlay=vc4-kms-v3d setzen",
        )
    fkms = [n for _, n in grafik if n.lower().startswith("vc4-fkms")]
    if fkms and panels:
        k.melde(
            HART, "Grafik",
            f"`{fkms[0]}` (fkms) zusammen mit einem KMS-Panel-Overlay — die beiden "
            "duerfen nicht gemischt werden, das Panel bleibt schwarz",
            "auf dtoverlay=vc4-kms-v3d wechseln",
        )

    # ── Panel-Overlays ──────────────────────────────────────────────────────
    if not panels:
        k.melde(
            WICHTIG, "Panel",
            "kein DSI-Panel-Overlay wirksam — dann muss die Firmware das Panel selbst "
            "erkennen; bei DietPi/KMS ist der ausdrueckliche Overlay der belegte Weg",
            "dtoverlay=vc4-kms-dsi-7inch setzen (gilt auch fuer 800x480-5-Zoll-Panels)",
        )
    elif len(panels) > 1:
        namen = ", ".join(n for _, n in panels)
        k.melde(
            HART, "Panel",
            f"ZWEI Panel-Overlays gleichzeitig wirksam ({namen}) — Konflikt, der Schirm "
            "bleibt dunkel oder flackert (llmwiki mupi-dsi-overlay-conflict)",
            "genau EINEN behalten",
        )

    # Parameter der Panel-Zeile(n) gegen Ziel und Panelgroesse
    for nr, _, t in aktiv:
        if not PANEL_MERKMAL.match(t):
            continue
        teile = t.split("=", 1)[1].split(",")
        name, parameter = teile[0], [p.strip().lower() for p in teile[1:]]

        if "5_0_inch" in parameter and (panel_b, panel_h) == (800, 480):
            k.melde(
                HART, "Panel",
                f"Zeile {nr}: `{name},5_0_inch` bedeutet laut overlays/README 720x1280 — "
                f"an einem {panel_b}x{panel_h}-Panel bleibt der Schirm KOMPLETT schwarz, "
                "auch ohne Touch-Geraet (am Geraet 25.07.2026 belegt)",
                "dtoverlay=vc4-kms-dsi-7inch statt dessen",
            )

        anschluesse = DSI_ANSCHLUESSE.get(ziel, 2)
        dsi_zusatz = [p for p in parameter if re.fullmatch(r"dsi[01]", p)]
        if anschluesse == 1 and dsi_zusatz:
            k.melde(
                HART, "Panel",
                f"Zeile {nr}: Zusatz `{dsi_zusatz[0]}` — {ziel} hat nur EINEN DSI-Anschluss; "
                "ein Anschlussname aus der Pi-5-Welt zeigt hier ins Leere",
                f"den Zusatz `,{dsi_zusatz[0]}` streichen",
            )
        elif anschluesse == 2 and not dsi_zusatz:
            k.melde(
                HINWEIS, "Panel",
                f"Zeile {nr}: kein `,dsi0`/`,dsi1` — auf {ziel} nimmt der Overlay den "
                "Vorgabe-Anschluss; das stimmt nur, wenn das Flachband auch dort steckt",
                "bei schwarzem Schirm `,dsi0` gegenprobieren",
            )

    # ── framebuffer-Reste ───────────────────────────────────────────────────
    fb = [(nr, t) for nr, _, t in aktiv if t.startswith(("framebuffer_width", "framebuffer_height"))]
    for nr, t in fb:
        k.melde(
            HINWEIS, "config.txt",
            f"Zeile {nr}: `{t}` — unter KMS wirkungslos, aber ein latenter Bug "
            "(llmwiki achim-config-gotchas)",
        )

    # ── DTB fuers Ziel ──────────────────────────────────────────────────────
    dtb_muster = {"pi4": "bcm2711-rpi-4-b.dtb", "pi5": "bcm2712-rpi-5-b.dtb"}
    noetig = dtb_muster.get(ziel)
    if noetig and not (k.boot / noetig).is_file():
        k.melde(
            HART, "Boot", f"`{noetig}` fehlt auf der Boot-Partition — {ziel} kommt nicht hoch",
            "Firmware/Kernel-Paket nachziehen",
        )

    # ── Firmware-Dateien fuer den Pi 4 ──────────────────────────────────────
    if ziel == "pi4" and not (k.boot / "start4.elf").is_file() and not (k.boot / "kernel8.img").is_file():
        k.melde(
            WICHTIG, "Boot",
            "weder `start4.elf` noch `kernel8.img` gefunden — auf einer reinen "
            "Pi-5-Karte fehlt die Pi-4-Startdatei mitunter",
        )
    return None


def pruefe_kennungen(k: Karte) -> None:
    """cmdline/fstab gegen die ECHTEN Kennungen der Karte. Ein Fehler hier endet
    im initramfs — ohne Netz, ohne Bild, ohne Tastatur am Kiosk."""
    # `lsblk -ln` NICHT spaltenweise auslesen: fehlt ein Feld (etwa die PARTUUID
    # bei zram0), rutschen die Spalten nach links und `split()[3]` liefert einen
    # NACHBARWERT statt eines leeren. Der Vergleich lief dann gegen Unsinn — und
    # zwar wortlos, weil ein Nichttreffer wie „stimmt ueberein" aussieht, sobald
    # der Schluessel gar nicht erst im Verzeichnis landet. Mit --json ist jedes
    # Feld benannt.
    echte = {}
    if shutil.which("lsblk"):
        try:
            baum = json.loads(lauf(["lsblk", "--json", "-o", "NAME,UUID,PARTUUID,MOUNTPOINT"]) or "{}")
        except json.JSONDecodeError:
            baum = {}

        def einsammeln(knoten):
            for n in knoten:
                punkt = n.get("mountpoint")
                if punkt:
                    echte[punkt] = {"uuid": n.get("uuid") or "", "partuuid": n.get("partuuid") or ""}
                einsammeln(n.get("children") or [])

        einsammeln(baum.get("blockdevices") or [])
    if not echte:
        k.melde(
            HINWEIS, "Wurzel",
            "keine Geraetekennungen auslesbar (lsblk) — cmdline/fstab wurden NICHT "
            "gegen die Karte gehalten",
        )
    boot_kenn = echte.get(str(k.boot), {})
    wurzel_kenn = echte.get(str(k.wurzel), {})
    # SAGEN, WENN NICHT GEPRUEFT WURDE. Liegt die Wurzel nicht als eigenes
    # Blockgeraet vor (Attrappe, Loop-Mount, Unterverzeichnis), findet der
    # Abgleich unten schlicht nicht statt — und ein Bericht ohne Befund liest
    # sich wie „stimmt". Diese Zeile ist der Unterschied zwischen „geprueft und
    # in Ordnung" und „gar nicht angesehen".
    if not wurzel_kenn:
        k.melde(
            HINWEIS, "Wurzel",
            f"zu `{k.wurzel}` gibt es keine Geraetekennung — cmdline.txt und fstab "
            "wurden NICHT gegen die Karte gehalten",
        )

    cmdline = (k.boot / "cmdline.txt")
    if cmdline.is_file():
        text = cmdline.read_text(errors="replace")
        m = re.search(r"root=PARTUUID=(\S+)", text)
        if m and wurzel_kenn.get("partuuid"):
            if m.group(1).lower() != wurzel_kenn["partuuid"].lower():
                k.melde(
                    HART, "Wurzel",
                    f"cmdline.txt zeigt auf PARTUUID={m.group(1)}, die Karte hat "
                    f"{wurzel_kenn['partuuid']} — der Start endet im initramfs",
                    f"root=PARTUUID={wurzel_kenn['partuuid']} eintragen",
                )

    fstab = (k.wurzel / "etc/fstab")
    if fstab.is_file():
        for zeile in fstab.read_text(errors="replace").splitlines():
            s = zeile.strip()
            if not s or s.startswith("#"):
                continue
            m = re.match(r"UUID=(\S+)\s+(\S+)", s)
            if not m:
                continue
            kennung, punkt = m.group(1), m.group(2)
            soll = wurzel_kenn if punkt == "/" else (boot_kenn if "boot" in punkt else None)
            if soll and soll.get("uuid") and kennung.lower() != soll["uuid"].lower():
                k.melde(
                    HART, "Wurzel",
                    f"fstab: {punkt} zeigt auf UUID={kennung}, die Karte hat {soll['uuid']}",
                    f"UUID={soll['uuid']} eintragen",
                )


def konfig_lesen(k: Karte) -> dict:
    p = k.wurzel / "etc/mupibox/mupiboxconfig.json"
    if not p.is_file():
        k.melde(WICHTIG, "Konfig", "etc/mupibox/mupiboxconfig.json fehlt auf der Karte")
        return {}
    try:
        return json.loads(p.read_text(errors="replace"))
    except json.JSONDecodeError as f:
        k.melde(HART, "Konfig", f"mupiboxconfig.json ist kein gueltiges JSON: {f}")
        return {}


def pruefe_kiosk(k: Karte, konfig: dict, ziel: str, panel_b: int, panel_h: int) -> None:
    chrom = konfig.get("chromium", {}) or {}
    mupi = konfig.get("mupibox", {}) or {}

    # Aufloesung gegen Panel
    try:
        res_x, res_y = int(chrom.get("resX", 0)), int(chrom.get("resY", 0))
    except (TypeError, ValueError):
        res_x = res_y = 0
    if res_x and (res_x, res_y) != (panel_b, panel_h):
        k.melde(
            WICHTIG, "Kiosk",
            f"chromium.resX/resY = {res_x}x{res_y}, das Panel ist {panel_b}x{panel_h} — "
            "das Kioskfenster passt nicht auf den Schirm "
            "(chromium-autostart.sh setzt daraus --window-size)",
            f'resX auf "{panel_b}", resY auf "{panel_h}" stellen',
        )

    # Verlangter Browser gegen das, was auf der Karte liegt
    verlangt = (mupi.get("kioskBrowser") or "chromium").lower()
    da = {n: (k.wurzel / f"usr/bin/{n}").exists() for n in ("cog", "chromium", "chromium-browser")}
    chromium_da = da["chromium"] or da["chromium-browser"]
    if verlangt == "cog" and not da["cog"]:
        gewicht = HINWEIS if chromium_da else HART
        k.melde(
            gewicht, "Kiosk",
            "mupibox.kioskBrowser = \"cog\", aber /usr/bin/cog liegt nicht auf der Karte"
            + (" — das Startskript faellt auf Chromium zurueck (chromium-autostart.sh:239)"
               if chromium_da else " UND kein Chromium da: es gibt keinen Kiosk"),
            "" if chromium_da else "kioskBrowser auf \"chromium\" stellen oder cog nachziehen",
        )
    if not chromium_da and verlangt != "cog":
        k.melde(HART, "Kiosk", "weder chromium noch chromium-browser auf der Karte")

    # Pi-5-Beigaben in der X-Konfiguration — nur dann ein Thema, wenn das ZIEL
    # kein Pi 5 ist. Auf dem Pi 5 gehoert die Datei dorthin; sie dort als Ballast
    # zu melden waere ein Fehlalarm, und ein Werkzeug, das auf dem Normalfall
    # meckert, wird zu Recht ignoriert.
    if ziel != "pi5":
        x_pfad = k.wurzel / "etc/X11/xorg.conf.d"
        if x_pfad.is_dir():
            for f in sorted(x_pfad.iterdir()):
                if "rpi5" in f.name.lower() or "pi5" in f.name.lower():
                    k.melde(
                        HINWEIS, "Kiosk",
                        f"`{f.name}` ist eine Pi-5-Beigabe (PRIME-Offload, weil DSI dort am RP1 "
                        f"als eigene DRM-Karte haengt). Am {ziel} haengt DSI an derselben Karte — "
                        "die Datei ist dort Ballast, kein Ausfall",
                    )


def pruefe_namen(k: Karte, konfig: dict, mit_netz: bool) -> None:
    rechner = (k.wurzel / "etc/hostname")
    name = rechner.read_text(errors="replace").strip() if rechner.is_file() else ""
    spotify = ((konfig.get("mupibox") or {}).get("host") or "").strip()

    if not mit_netz:
        if name or spotify:
            k.melde(
                HINWEIS, "Name",
                f"Karte meldet sich als `{name}` (Spotify-Geraetename `{spotify}`) — "
                "mit `--netz` wird geprueft, ob der Name schon vergeben ist",
            )
        return

    for art, wert in (("Rechnername", name), ("Spotify-Geraetename", spotify)):
        if not wert:
            continue
        adressen = set()
        for kandidat in (wert, f"{wert}.local", f"{wert}.fritz.box"):
            try:
                for eintrag in socket.getaddrinfo(kandidat, None):
                    adressen.add(eintrag[4][0])
            except (socket.gaierror, UnicodeError):
                continue
        if adressen:
            k.melde(
                WICHTIG, "Name",
                f"{art} `{wert}` antwortet BEREITS im Netz ({', '.join(sorted(adressen)[:3])}). "
                "Laufen beide Geraete gleichzeitig, treffen Werkzeuge mit MUPI_HOST das "
                "falsche — und die Spotify-Auswahl laeuft ueber den Namen, der Ton landet "
                "im falschen Raum (ANGLEICH-PI4-PI5.md, harter Ausfall 1)",
                f"vor dem Einschalten umbenennen, z. B. `{wert}2`",
            )


def pruefe_alter(k: Karte, konfig_da: bool) -> None:
    marken = []
    for p in ("etc/mupibox/mupiboxconfig.json", "var/lib/dietpi/dietpi-software/installed/chromium-autostart.sh"):
        f = k.wurzel / p
        if f.exists():
            marken.append((f.stat().st_mtime, p))
    if not marken:
        return
    jung = max(marken)
    tage = (time.time() - jung[0]) / 86400
    if tage > 7:
        k.melde(
            HINWEIS, "Stand",
            f"juengste Spur auf der Karte ist {tage:.0f} Tage alt "
            f"({time.strftime('%d.%m.%Y', time.localtime(jung[0]))}, {jung[1]}) — "
            "ein Lauf zeigt DIESEN Stand, nicht den des Arbeitsbaums",
        )


def main() -> int:
    p = argparse.ArgumentParser(description="MixPi-Karte gegen ein anderes Zielgeraet halten (rein lesend)")
    p.add_argument("--ziel", default="pi4", choices=sorted(DSI_ANSCHLUESSE), help="Geraet, in das die Karte soll")
    p.add_argument("--panel", default="800x480", help="Panelgroesse, Vorgabe 800x480")
    p.add_argument("--boot", help="Einhaengepunkt der Boot-Partition (sonst gesucht)")
    p.add_argument("--wurzel", help="Einhaengepunkt der Wurzel (sonst gesucht)")
    p.add_argument("--netz", action="store_true", help="Namen gegen das laufende Netz halten")
    p.add_argument("--json", action="store_true", help="Bericht als JSON")
    a = p.parse_args()

    try:
        panel_b, panel_h = (int(x) for x in a.panel.lower().split("x"))
    except ValueError:
        print(f"--panel erwartet BREITExHOEHE, bekam `{a.panel}`", file=sys.stderr)
        return 1

    if a.boot and a.wurzel:
        boot, wurzel = Path(a.boot), Path(a.wurzel)
    else:
        boote, wurzeln = karte_suchen()
        if not boote or not wurzeln:
            print(
                "Keine MixPi-Karte eingehaengt gefunden.\n"
                "Gesucht wurde ein vfat mit config.txt und ein ext4 mit etc/mupibox.\n"
                "Einhaengen (schreibgeschuetzt, ohne root):\n"
                "  udisksctl mount -b /dev/sdX1 --options ro\n"
                "  udisksctl mount -b /dev/sdX2 --options ro",
                file=sys.stderr,
            )
            return 1
        if len(boote) > 1 or len(wurzeln) > 1:
            print(
                "Mehr als eine Karte eingehaengt — ich rate nicht, welche gemeint ist:\n"
                f"  Boot:   {', '.join(str(x) for x in boote)}\n"
                f"  Wurzel: {', '.join(str(x) for x in wurzeln)}\n"
                "Mit --boot und --wurzel eine waehlen.",
                file=sys.stderr,
            )
            return 1
        boot, wurzel = boote[0], wurzeln[0]

    if not (boot / "config.txt").is_file():
        print(f"{boot}/config.txt nicht lesbar", file=sys.stderr)
        return 1

    k = Karte(boot=boot, wurzel=wurzel)
    pruefe_config(k, a.ziel, panel_b, panel_h)
    pruefe_kennungen(k)
    konfig = konfig_lesen(k)
    pruefe_kiosk(k, konfig, a.ziel, panel_b, panel_h)
    pruefe_namen(k, konfig, a.netz)
    pruefe_alter(k, bool(konfig))

    k.befunde.sort(key=lambda b: (RANG[b.gewicht], b.thema))
    harte = [b for b in k.befunde if b.gewicht == HART]

    if a.json:
        print(json.dumps({
            "boot": str(boot), "wurzel": str(wurzel), "ziel": a.ziel,
            "panel": f"{panel_b}x{panel_h}",
            "befunde": [{"gewicht": b.gewicht, "thema": b.thema, "text": b.text, "tat": b.tat}
                        for b in k.befunde],
            "hart": len(harte),
        }, ensure_ascii=False, indent=2))
        return 2 if harte else 0

    print(f"KARTE  Boot   {boot}")
    print(f"       Wurzel {wurzel}")
    print(f"ZIEL   {a.ziel}, Panel {panel_b}x{panel_h}\n")
    if not k.befunde:
        print("Nichts gefunden. Die Karte passt zum Ziel.")
        return 0
    for b in k.befunde:
        print(b.zeile())
        if b.tat:
            print(f"{'':10}-> {b.tat}")
    print()
    print(f"{len(harte)} hart, "
          f"{sum(1 for b in k.befunde if b.gewicht == WICHTIG)} wichtig, "
          f"{sum(1 for b in k.befunde if b.gewicht == HINWEIS)} Hinweis")
    return 2 if harte else 0


if __name__ == "__main__":
    sys.exit(main())
