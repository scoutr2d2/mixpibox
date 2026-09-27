#!/usr/bin/env python3
"""Die Grundmessung der Box: wie lange bis zum Bild, wer frisst Speicher und Rechenzeit.

WOZU: Im Backlog haengt E5/B1 — die Entscheidung "booten optimieren ODER
durchlaufen lassen" — seit Ende Juli daran, dass niemand die Zahlen hat. Ohne
sie waere jede Boot-Arbeit geraten. Dieses Werkzeug misst die drei Punkte aus
E1 in EINEM Lauf und wiederholbar, damit man nach jeder Aenderung dieselbe
Messung erneut fahren kann:

  M1  Was systemd beim Start tut (critical-chain, blame, Gesamtzeit).
  M2  RAM und Rechenzeit je Prozess im Betrieb.
  M3  Zeit bis zum ersten Bild GEGEN Zeit bis zum brauchbaren Inhalt.

M3 ist die Zahl, die zaehlt. Ein Bild, das da ist, aber nichts zeigt, hilft
keinem Kind.

WAS DIE MESSUNG ERGAB (04.08.2026, vier Kaltstarts) — und die Erwartung war
FALSCH: Es gibt auf dieser Box gar kein leeres Bild. Der Verdacht war,
Chromiums `--default-background-color=44afe2ff` male sofort eine blaue Flaeche
und man freue sich zu frueh. Gemessen ist das Gegenteil: der Schirm ist
SCHWARZ (nicht-dunkler Anteil 0,000) bis 19,1 / 21,4 / 23,5 s und steht eine
Abtastung spaeter (+0,3 bis +0,4 s) fertig da, mit ueber 11 000 Farben. Erstes
Bild und brauchbarer Inhalt fallen ZUSAMMEN, der Abstand liegt unter der
Aufloesung der Messung. Das Panel geht erst an, wenn Chromium sein erstes
echtes Vollbild hat.

Damit ist die Frage aus E1/M3 anders beantwortet als gestellt: die Zahl, die
zaehlt, ist nicht der Abstand zwischen den beiden — sondern die 19 bis 24
Sekunden Schwarz davor. Ihre Zusammensetzung, vier Kaltstarts:

    ~5   s   Kernel + Dienste, bis das Backend auf :8200 hoert (4,9 / 5,0 / 5,6)
    4-9  s   WARTEN AUF DHCP UEBER WLAN — fuer den Kiosk passiert nichts
    ~1   s   getty-Autologin und chromium-autostart.sh
    ~9   s   Chromium vom Prozessstart bis zum fertigen Bild (8,4 / 8,8 / 9,3)
    ─────
    19-24 s  bis zum Bild

DER GROESSTE EINZELPOSTEN IST WARTEZEIT AUF NICHTS. `getty@tty1` — und damit
der ganze Kiosk — wird konsequent 0,07 s nach `ifup@wlan0.service` aktiv;
gemessen 8,83->8,90, 11,81->11,90, 14,13->14,21. ifup@wlan0 dauerte in den
vier Laeufen 5,5 bis 10,7 s, und genau diese Streuung IST die Streuung der
Bootzeit. Grund laut Protokoll: dhclient schickt seinen DHCPREQUEST bei 4,6 s
los, wpa_supplicant assoziiert erst bei 7,1 s — die Antwort kann nicht kommen,
also laeuft der Zeitablauf ab und es folgt DHCPDISCOVER mit Intervall 8, dann
21. Die Anwendung ist die ganze Zeit fertig und niemand sieht sie.

NEBENBEFUND fuer E5/B5: die 30-Runden-curl-Probeschleife in
chromium-autostart.sh kostet NICHTS. Sie prueft, ob :8200 antwortet — und das
tut es seit Sekunde 5, also lange bevor der Kiosk ueberhaupt startet. Als
Bootzeit-Hebel faellt sie aus. Auch das ist ein Ergebnis.

AUFRUF
    tools/grundmessung.py 192.168.178.169              # warm, ohne Neustart
    tools/grundmessung.py 192.168.178.169 --kalt       # mit Neustart, volle M3
    tools/grundmessung.py 192.168.178.169 --json       # dasselbe als JSON
    tools/grundmessung.py 192.168.178.169 --ohne-schirm  # RFB weglassen
    tools/grundmessung.py 192.168.178.169 --bilder /pfad  # Beweisbilder ablegen

WAS ES NICHT TUT
  * Es aendert NICHTS an der Box. Kein Paket, kein Dienst, keine Datei. Alles
    laeuft ueber Lesen aus /proc, systemd-analyze und den x11vnc, der ohnehin
    schon laeuft (siehe unten). --kalt startet neu und weist danach nach, dass
    die Box wieder oben ist — sonst nichts.
  * Es entscheidet nicht. Es liefert die Zahlen, mit denen man entscheidet.

────────────────────────────────────────────────────────────────────────────
DIE FALLEN, DIE HIER SCHON ZUGESCHNAPPT SIND (Messungen 03./04.08.2026, Pi 5,
DietPi Trixie, Kernel 6.18.34, 2 GB RAM):

1. `systemd-analyze` LUEGT UEBER DIESE BOX — nicht aus Bosheit, sondern weil
   der Kiosk gar nicht unter systemd haengt. Gemessen: "Startup finished …
   = 6.877s", graphical.target nach 6,08 s — das Bild kam bei 22,97 s. Der Weg
   dahin ist getty@tty1 -> agetty-Autologin dietpi -> chromium-autostart.sh ->
   startx. systemd ist da laengst "fertig". Wer nur `systemd-analyze`
   protokolliert, meldet ein Drittel der Wahrheit.
   UND: `systemd-analyze` rechnet in USERSPACE-Sekunden, ohne die 0,77 s
   Kernel. Alle anderen Zahlen hier (TimestampMonotonic, /proc/<pid>/stat
   Feld 22, `journalctl -o short-monotonic`) zaehlen ab Kernelstart. Wer beides
   nebeneinanderlegt, sucht 0,8 s, die es wirklich gibt.

2. `ps %CPU` IST DER DURCHSCHNITT UEBER DAS GANZE PROZESSLEBEN, nicht die Last
   jetzt. Bei einem Chromium, der seit neun Stunden laeuft, ist das eine Zahl
   ohne Aussage. Deshalb wird hier utime+stime aus /proc zweimal gelesen und
   die DIFFERENZ ueber ein Zeitfenster gerechnet.

3. RSS ZAEHLT GETEILTE SEITEN MEHRFACH. Chromium ist ein halbes Dutzend
   Prozesse, die sich sehr viel teilen: 204 MB RSS gegen 135 MB PSS beim
   Hauptprozess allein. Wer RSS aufsummiert, erfindet Speicher, den niemand
   hat. Hier wird Pss aus /proc/<pid>/smaps_rollup genommen (braucht root)
   und RSS nur zum Vergleich mitgefuehrt.

4. /dev/fb0 ZEIGT NICHT DEN SCHIRM, sobald Xorg laeuft. Unter KMS ist der
   Framebuffer danach durchgehend NULL — gemessen: 819200 Bytes gelesen,
   null davon ungleich 0, waehrend auf dem Panel die volle Oberflaeche stand.
   Der Weg aus dem Boot-Splash (llmwiki boot-animation-mit-echtem-fortschritt)
   traegt also NICHT in den laufenden Betrieb hinein.

5. DER AUSWEG IST DER x11vnc, DER OHNEHIN SCHON LAEUFT. chromium-autostart.sh
   startet ihn bei jedem Boot (`x11vnc -ncache 10 -forever -display :0`), ohne
   Passwort, auf 5900. Damit kommt man an die echten Pixel, ohne irgendetwas
   zu installieren — scrot, import und ffmpeg sind auf der Box NICHT da.
   ABER: `-ncache 10` macht den Serverpuffer ZEHN BILDSCHIRME HOCH. Gemeldet
   werden 800x5760 statt 800x480. Wer die gemeldete Groesse anfordert, zieht
   18 MB Cachemuell ueber das WLAN und wertet ihn auch noch aus. Hier wird
   immer nur das obere Rechteck 800x480 angefordert.

6. x11vnc SCHICKT CopyRect, OBWOHL NUR Raw ANGEMELDET IST. Mit `-ncache 10`
   verweist er auf seinen Cachebereich unterhalb Zeile 480 — den dieses
   Werkzeug bewusst nicht holt. Die erste Fassung warf darauf eine Ausnahme,
   baute die Verbindung neu auf und verlor 1,25 s. Ausgerechnet in diesen
   1,25 s sprang der Schirm von schwarz auf fertig: die Messung hatte genau
   die Stelle nicht, um die es ging. Jetzt werden die vier Bytes weggeworfen
   und es wird sofort neu angefordert, ohne die Verbindung anzufassen.

7. WORAN MAN DIE PHASEN ERKENNT: an der Zahl der VERSCHIEDENEN FARBEN und am
   Anteil nicht-dunkler Flaeche. Gemessen: schwarzer Schirm = 2 Farben,
   hell-Anteil 0,000. Fertige Oberflaeche = 11 154 Farben (16 bpp), hell 0,98.
   Dazwischen liegt nichts. Die erste Fassung nahm "mehr als eine Farbe" als
   erstes Bild — und meldete deshalb den schwarzen Schirm als Bild, denn er
   hat zwei. Es zaehlt, wieviel NICHT dunkel ist, nicht die blosse Zahl.

8. EIN PROZESS, DER LANGE NACH DEM BOOT GESTARTET WURDE, VERDIRBT DIE
   ZEITACHSE. Beim ersten Lauf standen die beiden Node-Dienste bei 32634 s
   "seit Boot" — sie waren zwischendurch neu gestartet worden. Deshalb wird
   jeder Eintrag mit `spaeter_gestartet` markiert, wenn er nach der
   Bootphase kam, statt ihn stumm mitzurechnen.

9. DER COVER-SPEICHER LIEGT NICHT UNTER /etc/mupibox. server.ts legt ihn unter
   `${configBasePath}/coverspeicher` an, und configBasePath ist RELATIV
   ('./server/config') — also relativ zum Arbeitsverzeichnis des Dienstes:
   /home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/
   coverspeicher (308 Dateien, 8,3 MB). `mupibox.configPath` in der
   mupiboxconfig.json steht auf null und fuehrt in die Irre — die erste
   Fassung meldete deshalb "nicht vorhanden" fuer einen vollen Speicher.

10. `systemctl is-active` GIBT BEI "inactive" DEN RUECKGABEWERT 3. Ein
   `|| echo -` dahinter druckt ZUSAETZLICH einen Strich; die erste Fassung
   hatte hinter jeder inaktiven Einheit eine Geisterzeile.

11. DER GROSSE SPEICHERPOSTEN ENTSTEHT ERST IM BETRIEB. Frisch gebootet:
   744 MB PSS zusammen, 1280 MB verfuegbar, Swap unbenutzt, keine Drosselung.
   Nach 9,7 Stunden: 1318 MB PSS, 590 MB verfuegbar, 91 MB ausgelagert, und
   `vcgencmd get_throttled` meldete 0xe0000 (Takt war gedeckelt, es wurde
   gedrosselt, weiche Temperaturgrenze erreicht). Der Unterschied ist fast
   vollstaendig EIN Prozess: der piper-Vorleseserver mit 698 MB PSS — 34,7 %
   des gesamten RAM, mehr als Chromium mit allen elf Prozessen. Er wird vom
   backend-api gestartet und bleibt danach stehen. Wer nur frisch gebootet
   misst, sieht ihn nie.
────────────────────────────────────────────────────────────────────────────
"""

import argparse
import json
import os
import socket
import struct
import subprocess
import sys
import time
import zlib
from collections import Counter

# Der Bildschirm der Box ist fest 800x480 (E8). Nicht die vom x11vnc gemeldete
# Groesse nehmen — siehe Falle 5 im Kopf.
SCHIRM_BREITE = 800
SCHIRM_HOEHE = 480
VNC_PORT = 5900

# Prozesse, die fuer M2/M3 zaehlen. Muster wird gegen die Kommandozeile
# geprueft, `gruppe` fasst die Chromium-Kinder zu einem Posten zusammen.
BEOBACHTET = [
    ("Chromium (Kiosk)", "chromium", "chromium"),
    ("Xorg", "Xorg", None),
    ("backend-api (server.js)", "Sonos-Kids-Controller-master/server.js", None),
    ("backend-player (spotify-control.js)", "spotifycontroller-main/spotify-control.js", None),
    ("piper (Vorlesestimme)", "piper.http_server", None),
    ("librespot", "librespot", None),
    ("x11vnc", "x11vnc", None),
    ("mupihat.py", "mupihat", None),
    ("mpv", "/usr/bin/mpv", None),
    ("pipewire/wireplumber", "pipewire", "ton"),
    ("pipewire/wireplumber", "wireplumber", "ton"),
]


# ══════════════════════════════════════════════════════════════════════════
# Ferne Ausfuehrung
# ══════════════════════════════════════════════════════════════════════════

def fern(box, befehl, eingabe=None, zeitlimit=60, als_root=True):
    """Fuehrt einen Befehl auf der Box aus. Gibt (rc, stdout, stderr) zurueck.

    BatchMode: eine Messung darf nie nach einem Passwort fragen und dann
    stehenbleiben — sie soll ehrlich scheitern.
    """
    huelle = "sudo -n sh -c " if als_root else "sh -c "
    ssh = [
        "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
        "-o", "StrictHostKeyChecking=accept-new",
        f"dietpi@{box}", huelle + json_shellwort(befehl),
    ]
    try:
        e = subprocess.run(ssh, input=eingabe, capture_output=True, text=True, timeout=zeitlimit)
        return e.returncode, e.stdout, e.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "Zeitlimit"


def json_shellwort(s):
    """Ein Shell-Wort in einfachen Anfuehrungszeichen, sicher gegen ' im Text."""
    return "'" + s.replace("'", "'\\''") + "'"


def box_wartet(box, zeitlimit=180):
    """Wartet, bis die Box wieder per SSH antwortet. Rueckgabe: Wartezeit in s."""
    t0 = time.monotonic()
    while time.monotonic() - t0 < zeitlimit:
        rc, aus, _ = fern(box, "cat /proc/uptime", zeitlimit=10, als_root=False)
        if rc == 0 and aus.strip():
            return time.monotonic() - t0
        time.sleep(1.0)
    return None


# ══════════════════════════════════════════════════════════════════════════
# Die Sonde, die auf der Box laeuft — sie schreibt EIN JSON
# ══════════════════════════════════════════════════════════════════════════

SONDE = r'''
import json, os, re, subprocess, sys, time

TAKT = os.sysconf("SC_CLK_TCK")
FENSTER = float(sys.argv[1]) if len(sys.argv) > 1 else 3.0

def lauf(b, zeitlimit=30):
    try:
        e = subprocess.run(b, shell=True, capture_output=True, text=True, timeout=zeitlimit)
        return e.stdout.strip()
    except Exception as f:
        return f"(fehlgeschlagen: {f})"

def lies(p):
    try:
        with open(p) as d:
            return d.read()
    except Exception:
        return ""

erg = {}

# ── Uhr und Bootzeitpunkt ──────────────────────────────────────────────────
erg["uptime"] = float(lies("/proc/uptime").split()[0])
for z in lies("/proc/stat").splitlines():
    if z.startswith("btime "):
        erg["btime"] = int(z.split()[1])
erg["jetzt_epoch"] = time.time()
erg["takt"] = TAKT

# ── M1: systemd ────────────────────────────────────────────────────────────
erg["m1"] = {
    "gesamt": lauf("systemd-analyze"),
    "critical_chain": lauf("systemd-analyze critical-chain"),
    "blame": lauf("systemd-analyze blame | head -30"),
}

# ── Prozesse einsammeln ────────────────────────────────────────────────────
def prozesse():
    aus = {}
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        st = lies(f"/proc/{pid}/stat")
        if not st:
            continue
        # comm kann Leerzeichen und Klammern enthalten -> hinter der LETZTEN ")"
        # zerlegen. Ein naives split() zerreisst sonst die Felder.
        try:
            rest = st[st.rindex(")") + 2:].split()
            utime, stime = int(rest[11]), int(rest[12])
            starttime = int(rest[19])
        except Exception:
            continue
        cmd = lies(f"/proc/{pid}/cmdline").replace("\x00", " ").strip()
        if not cmd:
            continue
        aus[int(pid)] = {"cmd": cmd, "cpu": utime + stime, "start_jiffies": starttime}
    return aus

p0 = prozesse()
t0 = time.time()
time.sleep(FENSTER)
p1 = prozesse()
t1 = time.time()
spanne = t1 - t0

# ── Speicher (Pss!) und Rechenzeit-DIFFERENZ ───────────────────────────────
liste = []
for pid, b in p1.items():
    if pid not in p0:
        continue
    dcpu = (b["cpu"] - p0[pid]["cpu"]) / TAKT
    pss = rss = None
    roll = lies(f"/proc/{pid}/smaps_rollup")
    for z in roll.splitlines():
        if z.startswith("Pss:"):
            pss = int(z.split()[1])
        elif z.startswith("Rss:"):
            rss = int(z.split()[1])
    liste.append({
        "pid": pid,
        "cmd": b["cmd"][:400],
        "pss_kb": pss,
        "rss_kb": rss,
        "cpu_prozent": round(dcpu / spanne * 100, 2),
        "start_s_nach_boot": round(b["start_jiffies"] / TAKT, 2),
    })
erg["fenster_s"] = round(spanne, 2)
erg["prozesse"] = liste
erg["kerne"] = os.cpu_count()

# ── Speicher gesamt ────────────────────────────────────────────────────────
mem = {}
for z in lies("/proc/meminfo").splitlines():
    t = z.split(":")
    if len(t) == 2:
        mem[t[0]] = t[1].strip()
erg["speicher"] = {k: mem.get(k) for k in
                   ("MemTotal", "MemFree", "MemAvailable", "Buffers", "Cached",
                    "SwapTotal", "SwapFree", "Shmem")}
erg["swaps"] = lies("/proc/swaps")

# ── Temperatur und Drosselung: eine gedrosselte Box misst falsch ───────────
# get_throttled ist eine BITMASKE, keine Zahl. Die unteren vier Bits sagen
# "jetzt gerade", die Bits 16-19 "seit dem letzten Boot mindestens einmal".
# 0xe0000 sieht harmlos aus, heisst aber: Takt war gedeckelt, es WURDE
# gedrosselt, und die weiche Temperaturgrenze war erreicht. Eine Messung auf
# einer gedrosselten Box misst nicht die Box, sondern die Drosselung.
erg["throttled_roh"] = lauf("vcgencmd get_throttled")
erg["temperatur"] = lauf("vcgencmd measure_temp")

# ── Cover-Speicher: NICHT unter /etc/mupibox ───────────────────────────────
# server.ts legt ihn unter `${configBasePath}/coverspeicher` an, und
# configBasePath ist ein RELATIVER Pfad ('./server/config') — also relativ zum
# Arbeitsverzeichnis des Dienstes. `mupibox.configPath` in der
# mupiboxconfig.json steht auf null und fuehrt in die Irre; die erste Fassung
# dieses Werkzeugs meldete deshalb faelschlich "nicht vorhanden".
KONF = "/etc/mupibox/mupiboxconfig.json"

def verzeichnis_bericht(d):
    if not d or not os.path.isdir(d):
        return f"nicht vorhanden ({d or 'kein Pfad ermittelt'})"
    n = int(lauf(f"find '{d}' -type f | wc -l") or 0)
    kb = int((lauf(f"du -sk '{d}' | cut -f1") or "0").split()[0])
    return f"{n} Dateien, {kb} kB  ({d})"

pid_api = lauf("pgrep -f 'Sonos-Kids-Controller-master/server.js' | head -1")
basis = ""
if pid_api.isdigit():
    try:
        cwd_api = os.readlink(f"/proc/{pid_api}/cwd")
    except Exception:
        cwd_api = ""
    umg = dict(z.split("=", 1) for z in lies(f"/proc/{pid_api}/environ").split("\0") if "=" in z)
    basis = umg.get("MUPIBOX_CONFIG_DIR") or (os.path.join(cwd_api, "server/config") if cwd_api else "")
erg["cover_cache"] = verzeichnis_bericht(os.path.join(basis, "coverspeicher") if basis else "")
erg["chromium_cache"] = verzeichnis_bericht(lauf(
    "jq -r '.chromium.cachepath // \"/home/dietpi/.mupibox/chromium_cache\"' " + KONF))

# ── DIE KETTE BIS ZUM BILD ─────────────────────────────────────────────────
# Der wichtigste Teil dieses Werkzeugs. Alles hier liegt auf EINER Uhr —
# CLOCK_MONOTONIC ab Kernelstart. `systemctl show -p …TimestampMonotonic`
# liefert Mikrosekunden, /proc/<pid>/stat Feld 22 Jiffies, und die
# Journal-Ausgabe `-o short-monotonic` Sekunden. Alle drei meinen dasselbe.
# ACHTUNG: `systemd-analyze` rechnet in USERSPACE-Sekunden, also OHNE die
# Kernelzeit. "graphical.target reached after 13.500s" sind monoton 14.278 s.
# Wer beides nebeneinanderlegt, ohne das zu wissen, sucht 0,8 s, die es gibt.
def monoton(einheit, feld="ActiveEnterTimestampMonotonic"):
    w = lauf(f"systemctl show {einheit} -p {feld} --value")
    try:
        return round(int(w) / 1e6, 2)
    except Exception:
        return None

def journal_treffer(muster):
    """Erster Monotonie-Zeitstempel im Protokoll dieses Boots, der passt."""
    z = lauf(f"journalctl -b -o short-monotonic --no-pager 2>/dev/null "
             f"| grep -m1 -E {muster!r}")
    m = re.match(r"\s*\[\s*([0-9.]+)\]", z)
    return round(float(m.group(1)), 2) if m else None

erg["kette"] = {
    "netz_ifup_fertig": monoton("ifup@wlan0"),
    "netz_ifup_start": monoton("ifup@wlan0", "InactiveExitTimestampMonotonic"),
    "backend_unit": monoton("mupibox-server"),
    "backend_hoert": journal_treffer("Server started at http"),
    "user_sessions": monoton("systemd-user-sessions.service"),
    "getty_tty1": monoton("getty@tty1"),
    "graphical": monoton("graphical.target"),
    "chromium_scope": journal_treffer("Started app-org.chromium"),
}
# Der Beleg, WORAN das Netz haengt: dhclient fragt los, bevor der Funk steht.
erg["dhcp"] = lauf(
    "journalctl -b -o short-monotonic --no-pager 2>/dev/null "
    "| grep -E 'DHCPREQUEST|DHCPDISCOVER|DHCPACK|bound to|Associated with' "
    "| sed 's/mupibox [a-z_]*\\[[0-9]*\\]: //' | head -8")
# Was getty@tty1 laut systemd abwarten muss — die Antwort auf "warum so spaet".
erg["getty_wartet_auf"] = lauf(
    "systemctl list-dependencies --after getty@tty1.service --no-pager 2>/dev/null "
    "| sed -n '2,12p'")
erg["probeschleife_runden"] = lauf(
    "sed -n 's/.*while \\[ \"$i\" -lt \\([0-9]*\\) \\].*/\\1/p' "
    "/var/lib/dietpi/dietpi-software/installed/chromium-autostart.sh 2>/dev/null | head -1")
erg["oberflaeche"] = lauf("jq -r '.mupibox.oberflaeche // \"klassisch\"' " + KONF)

# ── Dienste, die im Backlog unter Verdacht stehen (E5/B2, B8) ─────────────
# `systemctl is-active` gibt bei "inactive" den Rueckgabewert 3. Ein
# `|| echo -` dahinter druckt deshalb ZUSAETZLICH einen Strich — die erste
# Fassung hatte hinter jeder inaktiven Einheit eine leere Zeile stehen.
erg["verdaechtige"] = lauf(
    "for u in x11vnc mupi_vnc mupi_novnc dietpi-dashboard mupi_telegram mupi_mqtt mupi_wled "
    "mupi_check_internet mupi_check_monitor mupi_change_checker mupi_hat mupi_hat_control "
    "mupibox-server mupibox-player librespot; do "
    "z=$(systemctl is-active $u 2>/dev/null); e=$(systemctl is-enabled $u 2>/dev/null); "
    "printf '%-24s %-10s %s\\n' \"$u\" \"${z:-unbekannt}\" \"${e:-—}\"; done")
erg["crontab"] = lauf("crontab -l 2>/dev/null; cat /etc/cron.d/* 2>/dev/null | grep -v '^#' | grep .")

print(json.dumps(erg))
'''


def sonde_laufen(box, fenster=3.0):
    rc, aus, fehler = fern(
        box, f"python3 - {fenster}", eingabe=SONDE, zeitlimit=180)
    if rc != 0:
        raise SystemExit(f"Sonde auf {box} fehlgeschlagen (rc={rc}): {fehler.strip()[:500]}")
    # journalctl-Rauschen kann vor dem JSON stehen — die letzte Zeile zaehlt.
    for zeile in reversed(aus.strip().splitlines()):
        if zeile.startswith("{"):
            return json.loads(zeile)
    raise SystemExit(f"Sonde lieferte kein JSON: {aus[:500]}")


# ══════════════════════════════════════════════════════════════════════════
# Der Schirm: RFB-Client, minimal, nur Raw
# ══════════════════════════════════════════════════════════════════════════

class Schirm:
    """Liest den echten Bildschirm ueber den x11vnc, der ohnehin laeuft.

    Absichtlich winzig gehalten: Handschlag, Sicherheitstyp None, Pixelformat
    setzen, Raw anfordern. Keine Bibliothek, kein Paket auf der Box.
    """

    def __init__(self, host, bpp=16, zeitlimit=15):
        self.bpp = bpp
        self.s = socket.create_connection((host, VNC_PORT), timeout=zeitlimit)
        self._handschlag()

    def _lies(self, n):
        b = b""
        while len(b) < n:
            t = self.s.recv(n - len(b))
            if not t:
                raise EOFError("VNC-Verbindung abgebrochen")
            b += t
        return b

    def _handschlag(self):
        self._lies(12)                       # "RFB 003.008\n"
        self.s.sendall(b"RFB 003.008\n")
        anzahl = self._lies(1)[0]
        if anzahl == 0:
            raise RuntimeError("VNC lehnt ab (Fehlerliste statt Sicherheitstypen)")
        typen = self._lies(anzahl)
        if 1 not in typen:
            raise RuntimeError(f"VNC will ein Passwort (Typen {list(typen)}) — "
                               "dieses Werkzeug spricht nur 'None'")
        self.s.sendall(bytes([1]))
        if struct.unpack(">I", self._lies(4))[0] != 0:
            raise RuntimeError("VNC-Anmeldung abgelehnt")
        self.s.sendall(bytes([1]))           # shared
        init = self._lies(24)
        self.gemeldet = struct.unpack(">HH", init[:4])
        namelaenge = struct.unpack(">I", init[20:24])[0]
        self.name = self._lies(namelaenge).decode("latin1")
        if self.bpp == 32:
            pf = struct.pack(">BBBBHHHBBBBBB", 32, 24, 0, 1, 255, 255, 255, 16, 8, 0, 0, 0, 0)
        else:
            pf = struct.pack(">BBBBHHHBBBBBB", 16, 16, 0, 1, 31, 63, 31, 11, 5, 0, 0, 0, 0)
        self.s.sendall(struct.pack(">BBBB", 0, 0, 0, 0) + pf)
        self.s.sendall(struct.pack(">BBHi", 2, 0, 1, 0))   # nur Raw

    def bild(self, versuche=4):
        """Holt das obere Rechteck 800x480. Rueckgabe: (bytes, schrittweite).

        WARUM DIE SCHLEIFE: x11vnc schickt mit `-ncache 10` CopyRect (Kodierung
        1), OBWOHL der Client in SetEncodings nur Raw angemeldet hat — das ist
        ein Verstoss gegen das Protokoll, aber gelebte Praxis. Die erste Fassung
        warf darauf eine Ausnahme, baute die Verbindung neu auf und verlor
        dabei 1,25 s — ausgerechnet in der Sekunde, in der der Schirm von
        schwarz auf fertig sprang. Die Messung hatte also genau die Stelle
        nicht, um die es geht.

        Die Quelle eines CopyRect liegt bei ncache meist UNTER Zeile 480, im
        Cachebereich, den dieses Werkzeug bewusst nicht holt. Rekonstruieren
        laesst sich das Bild daraus nicht. Also: die vier Bytes sauber
        wegwerfen und SOFORT neu anfordern, ohne die Verbindung anzufassen.
        """
        schritt = self.bpp // 8
        for _ in range(versuche):
            self.s.sendall(struct.pack(">BBHHHH", 3, 0, 0, 0, SCHIRM_BREITE, SCHIRM_HOEHE))
            typ, _, anzahl = struct.unpack(">BBH", self._lies(4))
            if typ != 0:                      # 1=Farbtafel, 2=Klingel, 3=Zwischenablage
                self._ueberspringen(typ)
                continue
            flaeche = bytearray(SCHIRM_BREITE * SCHIRM_HOEHE * schritt)
            vollstaendig = True
            for _r in range(anzahl):
                rx, ry, rw, rh, enc = struct.unpack(">HHHHi", self._lies(12))
                if enc == 1:                  # CopyRect: Quelle x,y
                    self._lies(4)
                    vollstaendig = False
                    continue
                if enc != 0:
                    raise RuntimeError(f"unerwartete Kodierung {enc} — nur Raw angefordert")
                daten = self._lies(rw * rh * schritt)
                for zeile in range(rh):
                    y = ry + zeile
                    if y >= SCHIRM_HOEHE:
                        break
                    ziel = (y * SCHIRM_BREITE + rx) * schritt
                    quelle = zeile * rw * schritt
                    flaeche[ziel:ziel + rw * schritt] = daten[quelle:quelle + rw * schritt]
            if vollstaendig:
                return bytes(flaeche), schritt
        raise RuntimeError("nur CopyRect erhalten — kein vollstaendiges Bild")

    def _ueberspringen(self, typ):
        if typ == 1:
            kopf = self._lies(5)
            self._lies(struct.unpack(">H", kopf[3:5])[0] * 6)
        elif typ == 3:
            self._lies(struct.unpack(">I", self._lies(7)[3:7])[0])

    def zu(self):
        try:
            self.s.close()
        except Exception:
            pass


def bild_auswerten(flaeche, schritt):
    """Zaehlt Farben, findet die dominante und misst, wie dunkel es noch ist.

    WARUM AUCH DER DUNKELANTEIL: ein schwarzer Schirm hat nicht exakt eine
    Farbe. Gemessen wurden ZWEI (ein paar Pixel Rest vom Textmodus). Die erste
    Fassung nahm "mehr als eine Farbe" als erstes Bild — und meldete deshalb
    einen schwarzen Schirm als Bild. Es zaehlt, wieviel NICHT dunkel ist.
    """
    zaehler = Counter()
    hell = 0
    for p in range(0, len(flaeche), schritt):
        roh = flaeche[p:p + schritt]
        zaehler[roh] += 1
        if schritt == 4:
            if roh[0] > 24 or roh[1] > 24 or roh[2] > 24:
                hell += 1
        else:
            w = roh[0] | (roh[1] << 8)
            if (w >> 11) > 3 or ((w >> 5) & 0x3F) > 6 or (w & 0x1F) > 3:
                hell += 1
    gesamt = len(flaeche) // schritt
    dominant, wieoft = zaehler.most_common(1)[0]
    return {
        "farben": len(zaehler),
        "dominant": rgb_text(dominant, schritt),
        "dominant_anteil": round(wieoft / gesamt, 3),
        "hell_anteil": round(hell / gesamt, 3),
    }


def rgb_text(roh, schritt):
    if schritt == 4:
        b, g, r = roh[0], roh[1], roh[2]
    else:
        w = roh[0] | (roh[1] << 8)
        r = ((w >> 11) & 0x1F) << 3
        g = ((w >> 5) & 0x3F) << 2
        b = (w & 0x1F) << 3
    return f"#{r:02X}{g:02X}{b:02X}"


def png_schreiben(pfad, flaeche, schritt):
    """Beweisbild ablegen. Ohne PIL — die ist auf keiner der Maschinen sicher da."""
    zeilen = bytearray()
    for y in range(SCHIRM_HOEHE):
        zeilen.append(0)                      # Filter: keiner
        z = y * SCHIRM_BREITE * schritt
        for x in range(SCHIRM_BREITE):
            roh = flaeche[z + x * schritt: z + (x + 1) * schritt]
            if schritt == 4:
                zeilen += bytes((roh[2], roh[1], roh[0]))
            else:
                w = roh[0] | (roh[1] << 8)
                zeilen += bytes((((w >> 11) & 0x1F) << 3, ((w >> 5) & 0x3F) << 2, (w & 0x1F) << 3))

    def block(art, inhalt):
        return (struct.pack(">I", len(inhalt)) + art + inhalt
                + struct.pack(">I", zlib.crc32(art + inhalt) & 0xFFFFFFFF))

    with open(pfad, "wb") as d:
        d.write(b"\x89PNG\r\n\x1a\n")
        d.write(block(b"IHDR", struct.pack(">IIBBBBB", SCHIRM_BREITE, SCHIRM_HOEHE, 8, 2, 0, 0, 0)))
        d.write(block(b"IDAT", zlib.compress(bytes(zeilen), 6)))
        d.write(block(b"IEND", b""))


# ══════════════════════════════════════════════════════════════════════════
# M3: den Schirmverlauf aufnehmen
# ══════════════════════════════════════════════════════════════════════════

def schirm_verlauf(box, dauer, bpp, bilder_pfad=None, ruhig_ab=3):
    """Nimmt den Schirm auf, bis er sich beruhigt hat oder die Zeit um ist.

    Die Zeitachse ist SEKUNDEN SEIT KERNELSTART, nicht Wanduhr — nur so passen
    die Werte zu /proc/<pid>/stat und zu systemd-analyze. Der Abgleich kostet
    einen SSH-Aufruf; dessen Umlaufzeit ist die Unschaerfe und wird
    mitgeschrieben, statt sie zu verschweigen.
    """
    vor = time.monotonic()
    rc, aus, _ = fern(box, "cat /proc/uptime", zeitlimit=10, als_root=False)
    nach = time.monotonic()
    if rc != 0:
        return {"fehler": "Uptime nicht lesbar", "proben": []}
    uptime0 = float(aus.split()[0])
    mono0 = nach
    unschaerfe = nach - vor

    proben = []
    letzte_bilder = {}
    s = None
    t_ende = time.monotonic() + dauer
    while time.monotonic() < t_ende:
        t_box = uptime0 + (time.monotonic() - mono0)
        try:
            if s is None:
                s = Schirm(box, bpp=bpp)
                proben.append({"t": round(t_box, 2), "ereignis": "x11vnc erreichbar"})
            flaeche, schritt = s.bild()
            probe = bild_auswerten(flaeche, schritt)
            probe["t"] = round(uptime0 + (time.monotonic() - mono0), 2)
            proben.append(probe)
            letzte_bilder[probe["farben"]] = (flaeche, schritt, probe["t"])
        except Exception as f:
            proben.append({"t": round(t_box, 2), "fehler": str(f)[:120]})
            if s is not None:
                s.zu()
            s = None
            time.sleep(0.3)
            continue
        # Ruhe erkannt: die letzten `ruhig_ab` Proben liegen dicht beieinander
        # UND es ist schon etwas zu sehen. Sonst haelt ein schwarzer Schirm
        # die Messung faelschlich fuer fertig.
        farbig = [p for p in proben[-ruhig_ab:] if "farben" in p]
        if len(farbig) == ruhig_ab and farbig[-1]["farben"] > 50:
            spanne = max(p["farben"] for p in farbig) - min(p["farben"] for p in farbig)
            if spanne <= max(5, farbig[-1]["farben"] * 0.02):
                break
        time.sleep(0.05)
    if s is not None:
        s.zu()

    if bilder_pfad and letzte_bilder:
        os.makedirs(bilder_pfad, exist_ok=True)
        for kennung, farben in (("leer", min(letzte_bilder)), ("voll", max(letzte_bilder))):
            flaeche, schritt, t = letzte_bilder[farben]
            ziel = os.path.join(bilder_pfad, f"schirm-{kennung}-{t:.1f}s-{farben}farben.png")
            png_schreiben(ziel, flaeche, schritt)

    return {"unschaerfe_s": round(unschaerfe, 3), "proben": proben}


def m3_auswerten(verlauf):
    """Die zwei Zahlen, um die es geht — und ehrlich benannt, woran sie haengen.

    ERSTES BILD    = mehr als 5 % der Flaeche ist nicht mehr dunkel. Bei dieser
                     Box ist das Chromiums einfarbige Startflaeche (#44AFE2 aus
                     --default-background-color). Sie zeigt NICHTS. Genau
                     deshalb steht sie hier getrennt.
    GERUEST        = mehr als eine Handvoll Farben: Text und Rahmen sind da.
    BRAUCHBAR      = die Farbzahl hat ihr Endniveau erreicht und bleibt dort.
                     Erst hier sind die Cover auf dem Schirm.

    Die Schwelle 5 % ist bewusst grob. Zwischen "schwarz" (gemessen: 0,000)
    und "Chromiums Flaeche" (1,000) liegt nichts — die Grenze muss nicht fein
    sein, sie muss nur auf der richtigen Seite von beiden liegen.
    """
    proben = [p for p in verlauf.get("proben", []) if "farben" in p]
    if not proben:
        return {}
    hoechst = max(p["farben"] for p in proben)
    erg = {"farben_endstand": hoechst}
    for p in proben:
        # KLAMMERN SIND HIER PFLICHT. Ohne sie bindet `and` staerker als `or`,
        # und `A and B or C` nimmt jede Probe als "erstes Bild" — auch die
        # letzte. Genau so stand es in der ersten Fassung.
        if "erstes_bild_s" not in erg and p["hell_anteil"] > 0.05:
            erg["erstes_bild_s"] = p["t"]
            erg["erstes_bild_farbe"] = p["dominant"]
            erg["erstes_bild_farben"] = p["farben"]
        if "geruest_s" not in erg and p["farben"] > 8:
            erg["geruest_s"] = p["t"]
        if "brauchbar_s" not in erg and hoechst > 50 and p["farben"] >= 0.9 * hoechst:
            erg["brauchbar_s"] = p["t"]
    # Die letzte schwarze Probe VOR dem ersten Bild — sie begrenzt den Fehler
    # nach unten. Ohne sie weiss man nicht, ob 15,4 s gemessen oder geraten ist.
    if "erstes_bild_s" in erg:
        davor = [p["t"] for p in proben
                 if p["t"] < erg["erstes_bild_s"] and p["hell_anteil"] <= 0.05]
        if davor:
            erg["schwarz_bis_s"] = max(davor)
    if "erstes_bild_s" in erg and "brauchbar_s" in erg:
        erg["leerlauf_s"] = round(erg["brauchbar_s"] - erg["erstes_bild_s"], 2)
    return erg


# ══════════════════════════════════════════════════════════════════════════
# Ausgabe
# ══════════════════════════════════════════════════════════════════════════

def balken(n, breite=30, hoechst=1.0):
    voll = int(min(1.0, n / hoechst) * breite) if hoechst else 0
    return "█" * voll + "·" * (breite - voll)


def bericht(daten, verlauf, m3, kalt):
    z = daten
    print("═" * 76)
    print(f"GRUNDMESSUNG  —  {time.strftime('%Y-%m-%d %H:%M', time.localtime())}"
          f"   Betriebsdauer {z['uptime'] / 3600:.1f} h"
          f"   {'KALTSTART' if kalt else 'warm, ohne Neustart'}")
    print("═" * 76)

    print("\n── M1  systemd ──────────────────────────────────────────────────────")
    print("   " + z["m1"]["gesamt"].replace("\n", "\n   "))
    print()
    for zeile in z["m1"]["critical_chain"].splitlines():
        print("   " + zeile)
    print("\n   Die teuersten Einheiten:")
    for zeile in z["m1"]["blame"].splitlines()[:12]:
        print("      " + zeile.strip())
    print("\n   ACHTUNG: der Kiosk haengt NICHT an systemd. graphical.target ist")
    print("   erreicht, lange bevor ein Bild da ist — siehe M3. Der Weg dahin ist")
    print("   getty@tty1 -> Autologin -> chromium-autostart.sh -> startx.")

    kette_ausgeben(z, m3, kalt)

    print("\n── M2  Speicher und Rechenzeit im Betrieb ───────────────────────────")
    gesamt_mb = int(z["speicher"]["MemTotal"].split()[0]) / 1024
    print(f"   Fenster {z['fenster_s']} s, {z['kerne']} Kerne, {z['temperatur']}")
    print(f"   Drosselung: {drossel_text(z['throttled_roh'])}")
    print(f"   RAM {gesamt_mb:.0f} MB gesamt, "
          f"{int(z['speicher']['MemAvailable'].split()[0]) / 1024:.0f} MB verfuegbar, "
          f"Swap {int(z['speicher']['SwapTotal'].split()[0]) / 1024:.0f} MB "
          f"(davon {(int(z['speicher']['SwapTotal'].split()[0]) - int(z['speicher']['SwapFree'].split()[0])) / 1024:.0f} MB belegt)")
    print()
    print(f"   {'Posten':<38}{'PSS':>9}{'Anteil':>8}  {'CPU':>7}   {'Start':>9}")
    print(f"   {'':38}{'MB':>9}{'RAM':>8}  {'%Kern':>7}   {'s n.Boot':>9}")
    print("   " + "─" * 72)
    summe = 0.0
    for name, pss, cpu, start, spaeter in m2_zeilen(z):
        summe += pss
        marke = " *" if spaeter else "  "
        startt = "—" if start is None else f"{start:.1f}"
        print(f"   {name:<38}{pss:9.0f}{pss / gesamt_mb * 100:7.1f}%  {cpu:6.1f}%   {startt:>7}{marke}")
    print("   " + "─" * 72)
    print(f"   {'zusammen':<38}{summe:9.0f}{summe / gesamt_mb * 100:7.1f}%")
    print("   " + "─" * 72)
    print("   PSS statt RSS — RSS zaehlt geteilte Seiten mehrfach und erfindet so")
    print("   Speicher, den niemand hat (Chromium: 204 MB RSS gegen 135 MB PSS).")
    print("   CPU ist die DIFFERENZ ueber das Fenster, nicht der Lebensdurchschnitt.")
    print("   * = nach der Bootphase gestartet, die Startzeit sagt hier nichts.")

    print(f"\n   Cover-Speicher   : {z['cover_cache']}")
    print(f"   Chromium-Cache   : {z['chromium_cache']}")
    print(f"   Oberflaeche      : {z['oberflaeche']}")

    print("\n   Dienste, die im Backlog unter Verdacht stehen (E5/B2):")
    print(f"      {'Einheit':<24}{'Zustand':<11}eingeschaltet")
    for zeile in z["verdaechtige"].splitlines():
        if zeile.strip():
            print("      " + zeile)

    print("\n── M3  erstes Bild GEGEN brauchbaren Inhalt ─────────────────────────")
    if not m3:
        print("   (kein Schirmverlauf — mit --kalt messen, ohne --ohne-schirm)")
    elif not kalt:
        # OHNE Neustart sind die drei Zeitpunkte alle gleich, weil der Schirm
        # beim ersten Blick schon fertig ist. Sie hier trotzdem auszugeben
        # waere eine Attrappe, die durch Weglassen luegt.
        print("   OHNE Neustart gibt es keine M3-Zeiten — beim ersten Blick steht die")
        print("   Oberflaeche laengst. Der Warmlauf liefert nur den ENDSTAND, an dem")
        print("   der Kaltstart spaeter gemessen wird:")
        print(f"      {m3['farben_endstand']} Farben, dominant "
              f"{verlauf['proben'][-1].get('dominant', '?')}")
        print("   Fuer die Zahlen aus E1/M3:  tools/grundmessung.py <box> --kalt")
    else:
        if "schwarz_bis_s" in m3:
            print(f"   schwarz noch bei  {m3['schwarz_bis_s']:8.2f} s")
        print(f"   erstes Bild       {fmt(m3.get('erstes_bild_s')):>8} s   "
              f"{m3.get('erstes_bild_farben', '?')} Farben, dominant "
              f"{m3.get('erstes_bild_farbe', '?')}  — eine Flaeche, die NICHTS zeigt")
        print(f"   Geruest sichtbar  {fmt(m3.get('geruest_s')):>8} s")
        print(f"   brauchbar (Cover) {fmt(m3.get('brauchbar_s')):>8} s   "
              f"{m3['farben_endstand']} Farben")
        if "leerlauf_s" in m3:
            print(f"\n   ►► DAZWISCHEN LIEGEN {m3['leerlauf_s']:.1f} SEKUNDEN, in denen das Kind")
            print("      auf ein Bild schaut, das noch nichts sagt.")
        print("\n   Verlauf (Farben je Probe; H = Anteil nicht-dunkler Flaeche):")
        hoechst = m3["farben_endstand"] or 1
        for p in verlauf["proben"]:
            if "farben" not in p:
                print(f"      {p['t']:7.2f}s  {p.get('ereignis') or p.get('fehler', '')}")
                continue
            print(f"      {p['t']:7.2f}s  {balken(p['farben'], 26, hoechst)} "
                  f"{p['farben']:5d}  {p['dominant']} {p['dominant_anteil'] * 100:3.0f}%"
                  f"  H{p['hell_anteil'] * 100:3.0f}%")
        print(f"\n   Unschaerfe der Zeitachse: {verlauf.get('unschaerfe_s', '?')} s (SSH-Umlauf).")
        print("   Der Schirm ist erst sichtbar, sobald der x11vnc oben ist — er startet")
        print("   aus chromium-autostart.sh, also KURZ NACH Chromium selbst. Alles davor")
        print("   ist per Definition schwarz und steht in der Zeitachse aus /proc.")

    print("\n── Zeitachse aus /proc (exakt, ohne Abtasten) ───────────────────────")
    for name, pss, cpu, start, spaeter in sorted(
            (r for r in m2_zeilen(z) if r[3] is not None and not r[4]), key=lambda r: r[3]):
        print(f"   {start:8.2f} s   {name}")
    print("   /proc/<pid>/stat Feld 22 durch CLK_TCK — die Startzeit jedes")
    print("   Prozesses in Sekunden seit Kernelstart. Braucht kein Abtasten.")
    print()


def kette_ausgeben(z, m3, kalt):
    """Die Kette bis zum Bild, mit den LUECKEN dazwischen.

    Die Luecken sind der Ertrag. Einzelne Zeitstempel sagen wenig; erst der
    Abstand zeigt, wo gewartet wird — und ob auf etwas gewartet wird, das
    laengst da ist.
    """
    k = z.get("kette", {})
    # Ohne Kaltstart ist "brauchbar" der Zeitpunkt des Hinsehens, nicht des
    # Fertigwerdens — dann gehoert er NICHT in die Kette.
    bild = m3.get("brauchbar_s") if (m3 and kalt) else None
    punkte = [
        ("wlan0 (ifup) fertig", k.get("netz_ifup_fertig")),
        ("backend hoert auf :8200", k.get("backend_hoert")),
        ("systemd-user-sessions", k.get("user_sessions")),
        ("getty@tty1 — hier startet der Kiosk", k.get("getty_tty1")),
        ("graphical.target", k.get("graphical")),
        ("Chromium-Prozess", chromium_start(z)),
        ("BILD MIT INHALT", bild),
    ]
    punkte = [(n, t) for n, t in punkte if t is not None]
    if len(punkte) < 2:
        return
    punkte.sort(key=lambda p: p[1])
    print("\n   DIE KETTE BIS ZUM BILD (Sekunden seit Kernelstart, EINE Uhr):")
    vorher = 0.0
    for name, t in punkte:
        luecke = t - vorher
        marke = "  ◄── " + "█" * min(24, int(luecke * 2)) if luecke >= 1.0 else ""
        print(f"      {t:7.2f} s  (+{luecke:5.2f})  {name}{marke}")
        vorher = t
    if k.get("backend_hoert") and k.get("getty_tty1"):
        wartezeit = k["getty_tty1"] - k["backend_hoert"]
        if wartezeit > 1.0:
            print(f"\n      ►► {wartezeit:.1f} s vergehen zwischen 'Backend bereit' und")
            print("         'Kiosk startet'. In dieser Zeit ist die Anwendung fertig und")
            print("         niemand sieht sie. Der Kiosk haengt an getty@tty1, und das")
            print("         wartet auf das NETZ — siehe die DHCP-Zeilen unten.")
    if z.get("dhcp"):
        print("\n   Warum das Netz so lange braucht:")
        for zeile in z["dhcp"].splitlines()[:8]:
            print("      " + zeile.strip())
        print("      (DHCPREQUEST geht raus, BEVOR der Funk assoziiert ist — die")
        print("       Antwort kann nicht kommen, und es folgt der Zeitablauf.)")
    if z.get("probeschleife_runden"):
        print(f"\n   Die curl-Probeschleife in chromium-autostart.sh: "
              f"{z['probeschleife_runden']} Runden Deckel.")
        if k.get("backend_hoert") and k.get("getty_tty1") and \
                k["backend_hoert"] < k["getty_tty1"]:
            print("      Sie hat NICHTS zu warten: das Backend hoert schon, bevor der")
            print("      Kiosk ueberhaupt startet. Als Bootzeit-Hebel (E5/B5) faellt sie aus.")


def chromium_start(z):
    for name, pss, cpu, start, spaeter in m2_zeilen(z):
        if name.startswith("Chromium") and start is not None and not spaeter:
            return start
    return None


def fmt(v):
    return "—" if v is None else f"{v:.2f}"


# vcgencmd get_throttled ist eine Bitmaske. Ohne Uebersetzung liest man 0xe0000
# als "sieht klein aus, passt schon" — es heisst aber, dass die Box seit dem
# Boot gedrosselt WURDE. Eine Messung auf einer gedrosselten Box misst die
# Drosselung mit, ohne es zu sagen.
DROSSEL_BITS = [
    (0, "JETZT Unterspannung"),
    (1, "JETZT Takt gedeckelt"),
    (2, "JETZT gedrosselt"),
    (3, "JETZT an der weichen Temperaturgrenze"),
    (16, "seit Boot: Unterspannung aufgetreten"),
    (17, "seit Boot: Takt war gedeckelt"),
    (18, "seit Boot: es wurde gedrosselt"),
    (19, "seit Boot: weiche Temperaturgrenze erreicht"),
]


def drossel_text(roh):
    try:
        wert = int(roh.split("=")[1], 16)
    except Exception:
        return roh or "(nicht lesbar)"
    if wert == 0:
        return "0x0 — nichts gedrosselt, die Zahlen sind sauber"
    treffer = [t for bit, t in DROSSEL_BITS if wert & (1 << bit)]
    warnung = "  ⚠ AKUT" if wert & 0xF else ""
    return f"0x{wert:x} — " + "; ".join(treffer) + warnung


def m2_zeilen(z):
    """Fasst die Prozesse zu Posten zusammen. Rueckgabe je Zeile:
    (name, pss_mb, cpu_prozent, start_s_nach_boot, spaeter_gestartet)."""
    posten = {}
    boot_fenster = 120.0   # alles danach ist ein Neustart, kein Bootvorgang
    for p in z["prozesse"]:
        for name, muster, gruppe in BEOBACHTET:
            if muster not in p["cmd"]:
                continue
            schluessel = gruppe or name
            b = posten.setdefault(schluessel, {"name": name, "pss": 0, "cpu": 0.0,
                                               "start": None, "anzahl": 0})
            b["pss"] += (p["pss_kb"] or 0)
            b["cpu"] += p["cpu_prozent"]
            b["anzahl"] += 1
            if b["start"] is None or p["start_s_nach_boot"] < b["start"]:
                b["start"] = p["start_s_nach_boot"]
            break
    zeilen = []
    for schluessel, b in posten.items():
        name = b["name"] + (f" ({b['anzahl']} Prozesse)" if b["anzahl"] > 1 else "")
        spaeter = b["start"] is not None and b["start"] > boot_fenster
        zeilen.append((name, b["pss"] / 1024, b["cpu"], b["start"], spaeter))
    zeilen.sort(key=lambda r: -r[1])
    return zeilen


# ══════════════════════════════════════════════════════════════════════════

def main():
    a = argparse.ArgumentParser(
        description="Grundmessung der MuPiBox: Boot, Speicher, Zeit bis zum Inhalt")
    a.add_argument("box", help="Adresse der Box, z. B. 192.168.178.169")
    a.add_argument("--kalt", action="store_true",
                   help="Box neu starten und den Start von Anfang an messen")
    a.add_argument("--ohne-schirm", action="store_true",
                   help="keinen x11vnc-Verlauf aufnehmen (dann faellt M3 weg)")
    a.add_argument("--bpp", type=int, default=16, choices=(16, 32),
                   help="Farbtiefe der Schirmproben (16 halbiert die Netzlast)")
    a.add_argument("--dauer", type=float, default=90.0,
                   help="wie lange der Schirm hoechstens beobachtet wird")
    a.add_argument("--fenster", type=float, default=3.0,
                   help="Messfenster fuer die CPU-Differenz in Sekunden")
    a.add_argument("--bilder", metavar="PFAD",
                   help="Beweisbilder (PNG) dorthin ablegen")
    a.add_argument("--json", action="store_true", help="alles als JSON ausgeben")
    args = a.parse_args()

    verlauf, m3 = {}, {}

    if args.kalt:
        print(f"Starte {args.box} neu und messe von vorn …", file=sys.stderr)
        rc, _, fehler = fern(args.box, "systemctl reboot", zeitlimit=20)
        # Ein Neustart kappt die Verbindung — rc != 0 ist hier NORMAL und kein
        # Fehler. Nur wenn die Box gar nicht wiederkommt, ist etwas kaputt.
        time.sleep(4)
        gewartet = box_wartet(args.box, zeitlimit=180)
        if gewartet is None:
            raise SystemExit(f"Die Box {args.box} kam nach dem Neustart NICHT zurueck. "
                             f"(letzte Meldung: {fehler.strip()[:200]})")
        print(f"   SSH antwortet nach {gewartet:.1f} s — der Schirm wird jetzt beobachtet.",
              file=sys.stderr)
        if not args.ohne_schirm:
            verlauf = schirm_verlauf(args.box, args.dauer, args.bpp, args.bilder)
            m3 = m3_auswerten(verlauf)
    elif not args.ohne_schirm:
        # Warm: ein kurzer Blick genuegt, um den Endstand der Farbzahl zu haben.
        verlauf = schirm_verlauf(args.box, min(args.dauer, 12.0), args.bpp, args.bilder)
        m3 = m3_auswerten(verlauf)

    daten = sonde_laufen(args.box, args.fenster)

    if args.json:
        print(json.dumps({"sonde": daten, "schirm": verlauf, "m3": m3,
                          "kalt": args.kalt}, indent=2, ensure_ascii=False))
    else:
        bericht(daten, verlauf, m3, args.kalt)

    if args.kalt:
        # Der Nachweis geht bei --json auf die FEHLERAUSGABE. Sonst haengt er
        # hinter dem JSON und macht es unlesbar — genau das ist beim
        # Auswerten der Wiederholungslaeufe passiert ("Extra data: line 686").
        rc, aus, _ = fern(args.box, "systemctl is-system-running; uptime", zeitlimit=20)
        wohin = sys.stderr if args.json else sys.stdout
        print("── Nachweis, dass die Box wieder oben ist ───────────────────────────",
              file=wohin)
        print("   " + aus.strip().replace("\n", "\n   "), file=wohin)


if __name__ == "__main__":
    main()
