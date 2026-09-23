#!/usr/bin/env python3
"""
remote-step-installer — SD-Karte vorbereiten (Schritt 0).

Macht aus einer leeren SD-Karte ein **nacktes DietPi mit NUR unserem Agent**:
Board wählen → DietPi-Variante wählen → Image laden (mit SHA256-Prüfung) → auf die
Karte schreiben → Boot-Partition mounten → WLAN + SSH + Auto-Install des Agents
eintragen. Alles Weitere kommt danach über den Controller — hier wird bewusst
NICHTS zusätzlich installiert.

Aufbau wie im Rest des Projekts: die **entscheidenden Teile sind pure Funktionen**
(Index parsen, dietpi.txt patchen, Geräte filtern) und damit testbar; die
gefährlichen I/O-Teile sind an einer Stelle gebündelt und mehrfach abgesichert.

SICHERHEIT beim Schreiben (ein falsches Gerät zerstört Daten):
  * nur WECHSELDATENTRÄGER (removable / USB / MMC) werden überhaupt angeboten,
  * Geräte, auf denen /, /home oder /boot liegen, werden hart ausgeschlossen,
  * geschrieben wird nur mit --write bzw. nach einer zweiten Bestätigung.

  python3 sdprep.py --list-images RPi5        # was gibt es?
  python3 sdprep.py --list-devices            # welche Karten sieht das System?
  python3 sdprep.py                           # geführter Ablauf (fragt alles)
"""
import argparse
import hashlib
import json
import os
import re
import shlex
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core import repo_root  # noqa: E402

INDEX_URL = "https://dietpi.com/downloads/images/"
UA = "Mozilla/5.0 (X11; Linux x86_64) remote-step-installer/sdprep"
# Wozu die Board-Kürzel von DietPi gehören (nur zur Anzeige/Auswahlhilfe)
BOARD_HINT = {
    "RPi5": "Raspberry Pi 5",
    "RPi234": "Raspberry Pi 2/3/4 + Zero 2 (64-Bit)",
    "RPi2": "Raspberry Pi 2/3 (32-Bit)",
    "RPi1": "Raspberry Pi 1 / Zero (32-Bit)",
}
CODENAMES = ["Trixie", "Bookworm", "Forky"]      # Trixie = DietPi-Standard

# ══ WIE DER MENSCH SEIN BRETT NENNT -> WIE DIETPI ES NENNT ══════════════════
# DietPi liefert EIN 64-Bit-Abbild fuer Pi 2, 3, 4 und Zero 2 und nennt es
# `RPi234`. Ein `RPi4` gibt es auf dietpi.com NICHT — die Boards heissen dort
# RPi1, RPi2, RPi234, RPi5.
#
# Die Oberflaechen boten trotzdem „RPi4" an (sdstart.py, Board-Seite) bzw.
# fuehrten „RPi4" und „RPi3" in ihrer Liste (sdgui.py BOARDS). `select()`
# vergleicht auf Gleichheit, also traf das nie etwas, und der Lauf endete mit
# „Kein Abbild für RPi4 gefunden." — am 31.08.2026 vom Betreiber beim ersten
# echten Pi-4-Versuch erlebt.
#
# WARUM ES NIE AUFFIEL: der Pi-5-Weg stimmt zufaellig, weil DietPi das Board
# dort wirklich `RPi5` nennt. Alles, was hier je gefahren wurde, war ein Pi 5;
# ANGLEICH-PI4-PI5.md haelt seit dem 30.07.2026 ausdruecklich fest, dass der
# Probelauf gegen den Pi 4 aussteht. Eine Kennung, die nur auf einem Geraet
# stimmt, sieht auf diesem Geraet wie eine richtige aus.
#
# Der Alias steht HIER und nicht in den Oberflaechen, weil alle drei
# (sdgui, sdtui, sdstart) durch `select()` gehen — eine Tabelle statt drei.
BOARD_ALIAS = {
    "RPi4": "RPi234",   # Pi 4 = 64-Bit-Abbild fuer 2/3/4
    "RPi3": "RPi234",   # Pi 3 ist 64-Bit-faehig; RPi2 waere das 32-Bit-Abbild
}


def board_aufloesen(board):
    """Menschliche Board-Kennung -> DietPis Kennung. Gibt (kennung, hinweis).

    Der Hinweis ist der Text, den eine Oberflaeche ANZEIGEN soll, wenn sie
    etwas anderes bekommt als das, worauf geklickt wurde. Diese Werkzeuge
    weichen an keiner Stelle still aus (siehe die Codename-Ersetzung in
    sdstart.py) — wer statt `RPi4` ein `RPi234` bekommt, soll lesen koennen,
    warum, sonst sucht er den Unterschied spaeter am laufenden System."""
    if not board:
        return board, None
    echt = BOARD_ALIAS.get(board)
    if not echt:
        return board, None
    return echt, (f"{board} heisst bei DietPi {echt} "
                  f"({BOARD_HINT.get(echt, '')}) — nehme das.")


# ══ PURE: Index ═════════════════════════════════════════════════════════════
def parse_index(html):
    """HTML-Verzeichnis → Liste von Images. Pure (kein Netz)."""
    out, seen = [], set()
    for fn in re.findall(r"DietPi_[A-Za-z0-9._-]+\.img\.xz", html):
        if fn in seen:
            continue
        seen.add(fn)
        m = re.match(r"DietPi_([A-Za-z0-9]+)-([A-Za-z0-9]+)-([A-Za-z]+)(?:_([A-Za-z0-9]+))?\.img\.xz$", fn)
        if not m:
            continue
        board, arch, code, variant = m.groups()
        out.append({"file": fn, "board": board, "arch": arch,
                    "codename": code, "variant": variant or "", "url": INDEX_URL + fn})
    return sorted(out, key=lambda e: (e["board"], e["codename"], e["variant"]))


def boards(entries):
    return sorted({e["board"] for e in entries})


def select(entries, board=None, codename=None, plain_only=True):
    """Passende Images filtern. `plain_only` = ohne Sonder-Varianten (AlloGUI/Amiberry)
    — wir wollen ein NACKTES System."""
    r = entries
    if board:
        # ALIAS ZUERST: „RPi4" gibt es bei DietPi nicht, siehe BOARD_ALIAS.
        board, _ = board_aufloesen(board)
        r = [e for e in r if e["board"].lower() == board.lower()]
    if codename:
        r = [e for e in r if e["codename"].lower() == codename.lower()]
    if plain_only:
        r = [e for e in r if not e["variant"]]
    return r


# ══ PURE: Boot-Partition vorbereiten ════════════════════════════════════════
def patch_dietpi_txt(text, cfg):
    """Bestehende dietpi.txt zeilenweise umsetzen (Kommentare/Reihenfolge bleiben).
    Unbekannte Schlüssel werden angehängt. Pure."""
    want = dict(cfg)
    out, done = [], set()
    for line in text.splitlines():
        m = re.match(r"^\s*([A-Za-z0-9_]+)=", line)
        if m and m.group(1) in want:
            k = m.group(1)
            out.append(f"{k}={want[k]}")
            done.add(k)
        else:
            out.append(line)
    rest = [k for k in want if k not in done]
    if rest:
        out += ["", "# --- vom remote-step-installer ergänzt ---"]
        out += [f"{k}={want[k]}" for k in rest]
    return "\n".join(out) + "\n"


def dietpi_cfg(password, hostname="DietPi", wifi=False, locale="C.UTF-8",
               keyboard="de", timezone="Europe/Berlin", ssh="openssh", country="DE"):
    """Die Schlüssel für ein NACKTES, automatisch aufgesetztes DietPi mit SSH.
    Bewusst KEINE Zusatzsoftware (AUTO_SETUP_INSTALL_SOFTWARE_ID leer) — alles
    Weitere fährt später der Controller."""
    # ══ DIE LIZENZZUSTIMMUNG — HIER STAND SIE ABSICHTLICH NICHT ═════════════
    #
    # Betreiber, 10.08.2026: „also blauer bildschirm install gestoppt von
    # dietpi."
    #
    # Ein blauer Schirm ist ein whiptail-Dialog, und bei
    # AUTO_SETUP_AUTOMATED=1 darf nie einer kommen. Kommt doch einer, wartet
    # er auf eine Taste — an einer Box ohne Tastatur also FUER IMMER. Genau so
    # sah es aus: Karte lief an, Netz war da, dann stand alles.
    #
    # HIER STAND DIE BEGRUENDUNG, WARUM DER SCHLUESSEL FEHLT:
    #   „die Fassung auf der Karte kennt den Schluessel nicht (null Vorkommen,
    #    nicht mal als Kommentar)."
    # Das war GEMESSEN und stimmte — an dem Abbild, das damals benutzt wurde.
    # Seit heute schreibt der Assistent TRIXIE (sdstart.py, CODENAME), und
    # neuere DietPi-Fassungen fragen beim Erstlauf nach der Zustimmung. Eine
    # Messung an einem alten Abbild hat ein neues nicht gebunden.
    #
    # WARUM ES NICHTS KAPUTTMACHT, wenn ein Abbild den Schluessel doch nicht
    # kennt: `patch_dietpi_txt` haengt Unbekanntes unten an (nachgemessen), und
    # DietPi ueberliest Schluessel, die es nicht auswertet. Der Preis fuer
    # „steht da, wird ignoriert" ist eine Zeile; der Preis fuer „fehlt" ist
    # eine Box, die vor einem blauen Kasten steht und auf eine Tastatur wartet,
    # die es nicht gibt.
    return {
        "AUTO_SETUP_ACCEPT_LICENSE": "1",
        "AUTO_SETUP_AUTOMATED": "1",
        "AUTO_SETUP_GLOBAL_PASSWORD": password,
        "AUTO_SETUP_SSH_SERVER_INDEX": "-2" if ssh == "openssh" else "-1",
        "AUTO_SETUP_NET_HOSTNAME": hostname,
        "AUTO_SETUP_NET_WIFI_ENABLED": "1" if wifi else "0",
        # Der Assistent fragt bewusst ENTWEDER-ODER ("WLAN-SSID (leer = LAN)"),
        # also muss das auch auf der Karte stehen. Ohne diese Zeile bliebe
        # Ethernet auf DietPis Standard 1: ein vorhandener, aber defekter
        # LAN-Adapter (Link ja, DHCP nein) laesst den Erstlauf dann haengen,
        # obwohl WLAN eingerichtet ist.
        "AUTO_SETUP_NET_ETHERNET_ENABLED": "0" if wifi else "1",
        # Der Ländercode steht NICHT in dietpi-wifi.txt (dort gibt es ihn gar
        # nicht), sondern hier — und DietPis Standard ist GB. Mit britischen
        # Kanalregeln kann ein deutsches 5-GHz-Netz unerreichbar bleiben.
        "AUTO_SETUP_NET_WIFI_COUNTRY_CODE": country,
        "AUTO_SETUP_LOCALE": locale,
        "AUTO_SETUP_KEYBOARD_LAYOUT": keyboard,
        "AUTO_SETUP_TIMEZONE": timezone,
        "AUTO_SETUP_DESKTOP": "none",
        "AUTO_SETUP_INSTALL_SOFTWARE_ID": "",      # NICHTS extra
        "AUTO_SETUP_CUSTOM_SCRIPT_EXEC": "1",      # SSH-Schluessel bzw. Agent-Installer
        "SURVEY_OPTED_IN": "0",
        "CONFIG_SERIAL_CONSOLE_ENABLE": "1",
    }


def _wifi_esc(s):
    """DietPi verlangt es genau so: "replace single quote characters ' with '\\''"."""
    return str(s).replace("'", "'\\''")


def patch_wifi_txt(text, ssid, key, keymgr="WPA-PSK"):
    """Vorhandene dietpi-wifi.txt umsetzen statt ersetzen. Pure.

    WARUM NICHT NEU SCHREIBEN (am Gerät bezahlt): DietPi liest diese Datei als
    Bash-Skript ein und greift auf einen FESTEN Satz Array-Variablen zu —
    aWIFI_EAP, aWIFI_IDENTITY, aWIFI_PASSWORD, aWIFI_PHASE1/2, aWIFI_CERT und
    fünf Einträge 0..4. Eine selbst gebaute Minimaldatei ließ die Hälfte davon
    weg (und erfand aWIFI_EAPID/aWIFI_EAPPHASE, die es gar nicht gibt) — die
    Box kam nicht ins WLAN, und weil der automatische Erstlauf Internet braucht,
    endete das im Bildschirm mit "first run setup failed".

    Umgesetzt wird ausschließlich Eintrag 0; alles andere bleibt unberührt.
    """
    ersatz = {
        "aWIFI_SSID[0]": _wifi_esc(ssid),
        "aWIFI_KEY[0]": _wifi_esc(key),
        "aWIFI_KEYMGR[0]": keymgr if key else "NONE",   # ohne Schlüssel = offenes Netz
    }
    raus, erledigt = [], set()
    for zeile in (text or "").splitlines():
        m = re.match(r"^\s*(aWIFI_[A-Z]+\[\d+\])\s*=", zeile)
        if m and m.group(1) in ersatz:
            raus.append(f"{m.group(1)}='{ersatz[m.group(1)]}'")
            erledigt.add(m.group(1))
        else:
            raus.append(zeile)
    fehlt = [k for k in ersatz if k not in erledigt]
    if fehlt:
        raus += ["", "# --- vom remote-step-installer ergänzt ---"]
        raus += [f"{k}='{ersatz[k]}'" for k in fehlt]
    return "\n".join(raus) + "\n"


def wifi_file(ssid, key, keymgr="WPA-PSK"):
    """Rückfall, falls die Karte gar keine dietpi-wifi.txt mitbringt. Pure.

    Enthält bewusst DietPis VOLLSTÄNDIGEN Variablensatz für Eintrag 0 — ein
    fehlender Name ist kein leeres Feld, sondern eine Variable, die DietPis
    Skript dann nicht findet.
    """
    return (
        "# vom remote-step-installer erzeugt\n"
        f"aWIFI_SSID[0]='{_wifi_esc(ssid)}'\n"
        f"aWIFI_KEY[0]='{_wifi_esc(key)}'\n"
        f"aWIFI_KEYMGR[0]='{keymgr if key else 'NONE'}'\n"
        "aWIFI_PROTO[0]=''\n"
        "aWIFI_PAIRWISE[0]=''\n"
        "aWIFI_AUTH_ALG[0]=''\n"
        "aWIFI_EAP[0]=''\n"
        "aWIFI_IDENTITY[0]=''\n"
        "aWIFI_PASSWORD[0]=''\n"
        "aWIFI_PHASE1[0]=''\n"
        "aWIFI_PHASE2[0]=''\n"
        "aWIFI_CERT[0]=''\n"
    )


def cmdline_debug(text):
    """cmdline.txt so umschreiben, dass der Erstboot SICHTBAR ist. Pure.

    Ohne das ist eine Box, deren WLAN nicht kommt, gleichzeitig stumm UND blind:
    man sieht nirgends, woran es scheitert. Deshalb `quiet` raus, Ausgabe auf
    die erste Konsole, und der Bildschirm darf nicht nach zehn Minuten
    abschalten (das sieht sonst aus wie ein totes Panel).
    """
    teile = [w for w in (text or "").split() if w not in ("quiet", "logo.nologo", "splash")]
    teile = [w for w in teile if not w.startswith("loglevel=")]
    teile = [w for w in teile if not w.startswith("consoleblank=")]
    # Ein bereits vorhandenes console=tty… bleibt; sonst auf tty1 legen.
    if not any(w.startswith("console=tty") for w in teile):
        teile.append("console=tty1")
    teile.append("consoleblank=0")
    return " ".join(teile) + "\n"


def config_debug(text, panel="vc4-kms-dsi-7inch"):
    """config.txt um die Anzeige ergänzen, damit das DSI-Panel VON ANFANG AN läuft. Pure.

    Sonst richtet erst der Controller das Display ein — und genau dahin kommt man
    ja nicht, wenn die Box nicht ins Netz findet. Bewusst nur ANHÄNGEN und nichts
    Bestehendes wegwerfen: die Karte gehört DietPi, wir hängen uns nur an.
    """
    vorhanden = text or ""
    # NUR AKTIVE Zeilen zählen. Ein simpler Textvergleich fiel auf DietPis
    # auskommentiertes "#dtoverlay=vc4-kms-v3d,noaudio" herein, hielt den
    # Treiber für vorhanden und ergänzte nur das Panel — das aber ausdrücklich
    # vc4-kms-v3d voraussetzt. Ergebnis: Bildschirm blieb schwarz.
    aktiv = set()
    for zeile in vorhanden.splitlines():
        z = zeile.strip()
        if not z or z.startswith("#"):
            continue
        m = re.match(r"dtoverlay=([A-Za-z0-9_.-]+)", z)
        if m:
            aktiv.add(m.group(1))
    neu = []
    if "vc4-kms-v3d" not in aktiv:
        neu.append("dtoverlay=vc4-kms-v3d")
    if panel and panel not in aktiv:
        neu.append(f"dtoverlay={panel}")
    if not neu:
        return vorhanden
    kopf = "" if vorhanden.endswith("\n") or not vorhanden else "\n"
    return (vorhanden + kopf
            + "\n# --- vom remote-step-installer: Anzeige zum Mitschauen beim Erstboot ---\n"
            + "\n".join(neu) + "\n")


def sshkey_script(ssh_pubkey):
    """Minimales Erstboot-Skript: NUR den SSH-Schluessel hinterlegen. Der Agent kommt
    danach mit `./connect <box> --install` — dann ist er garantiert aktuell."""
    k = ssh_pubkey.strip().replace("'", "")
    return f"""#!/bin/bash
# Vom remote-step-installer erzeugt: hinterlegt nur den SSH-Schluessel des Controllers.
# Der Agent wird NICHT mitgebacken — `./connect <box> --install` bringt ihn spaeter hin.
for u in dietpi root; do
  h=$(getent passwd "$u" | cut -d: -f6); [ -n "$h" ] || continue
  mkdir -p "$h/.ssh" && chmod 700 "$h/.ssh"
  grep -qF '{k}' "$h/.ssh/authorized_keys" 2>/dev/null || echo '{k}' >> "$h/.ssh/authorized_keys"
  chmod 600 "$h/.ssh/authorized_keys"; chown -R "$u" "$h/.ssh"
done
exit 0
"""


def custom_script(agent_port=8099, ssh_pubkey="", handy=False, sofort_starten=False):
    """Automation_Custom_Script.sh — läuft EINMAL am Ende der DietPi-Erstinstallation
    als root. Installiert NUR unseren Agent und legt den Pair-Code so ab, dass der
    Controller ihn später per SSH abholen kann. Pure (gibt nur Text zurück).

    `handy=True` schaltet den EINRICHTUNGSWEG OHNE LAPTOP frei. Zwei Dinge
    ändern sich dadurch, und beide muss man bewusst wollen:

      1. DER AGENT LAUSCHT IM LAN (0.0.0.0) statt nur auf 127.0.0.1. Ohne das
         erreicht ihn kein Handy — der SSH-Tunnel, der sonst der Schutz ist,
         lässt sich vom Telefon nun einmal nicht aufbauen. Was dann noch
         schützt: der 6-stellige Pair-Code MIT hartem Fehlerdeckel
         (PAIR_MAX_FEHLER im Agenten, global, nicht je Absender), und dass der
         Agent sich nach `/shutdown --remove` restlos entfernt. Beides ist im
         Agenten längst gebaut — es wurde bloß nie scharf.
      2. DER EINRICHTUNGSBILDSCHIRM startet und zeigt QR + Adresse + Pair-Code
         auf dem Schirm der Box. Ohne ihn müsste jemand die IP raten.

    Wer den Laptop-Weg fährt, lässt das aus: dann bleibt alles auf localhost.
    """
    lauscht = "0.0.0.0" if handy else "127.0.0.1"
    # Der Einrichtungsbildschirm ist OPTIONAL — fehlt er auf der Boot-Partition,
    # läuft der Rest unverändert weiter. Eine Box ohne QR-Code ist unbequem;
    # eine Box, deren Erstboot an einem fehlenden Bild abbricht, ist kaputt.
    # ══ DIE ZUSTIMMUNG KOMMT VOM ASSISTENTEN ════════════════════════════════
    #
    # `mixpibox-selbstlauf.service` startet mit `--nur-wenn-angefangen`, und
    # selbstlauf.py endet dann still, solange `/var/lib/mixpibox-lauf/stand.json`
    # fehlt. Das ist ABSICHT und bleibt es: die Unit laeuft bei JEDEM Start, um
    # einen von einem Neustart unterbrochenen Lauf fortzusetzen — von allein
    # anfangen darf sie nicht, sonst richtete sich jede bespielte Karte ein,
    # ohne dass jemand zugestimmt haette.
    #
    # NUR: WER IM ASSISTENTEN „Karte löschen und schreiben" GEDRUECKT HAT, HAT
    # ZUGESTIMMT. Er hat eine rote Rueckfrage mit dem Geraetenamen bestaetigt;
    # ihn danach noch einmal am Telefon fragen zu lassen, waere dieselbe Frage
    # zum zweiten Mal. Deshalb legt der Erstboot die Standdatei gleich an —
    # leer, also „begonnen, noch nichts erledigt", was `stand_lesen()` genau so
    # versteht.
    #
    # DER RIEGEL BLEIBT FUER ALLE ANDEREN WEGE. Wer die Karte mit `sdgui` oder
    # `sdtui` ohne diesen Schalter schreibt, bekommt weiter den Weg ueber den
    # Einrichtungsbildschirm — dort ist die Zustimmung noch nicht gegeben.
    sofort_block = ""
    if sofort_starten:
        sofort_block = """
  # --- Der Lauf ist im Assistenten bestaetigt worden: Standdatei anlegen ---
  install -d -m 755 /var/lib/mixpibox-lauf
  if [ ! -f /var/lib/mixpibox-lauf/stand.json ]; then
    printf '{"fertig": [], "gescheitert": null}\\n' > /var/lib/mixpibox-lauf/stand.json
  fi
  # UND IHN JETZT STARTEN. `systemctl enable` setzt nur den Link fuer den
  # NAECHSTEN Start — dieses Skript laeuft aber mitten in der
  # DietPi-Erstinstallation, also lange nachdem multi-user.target erreicht war.
  #
  # AM GERAET GEMESSEN (10.08.2026, Testbox .77): Boot um 18:19:56, die
  # Unit-Datei kam um 18:22:14 dazu — zwei Minuten zu spaet, und DietPi startete
  # danach nicht neu (ein einziger Boot im Journal). Ergebnis: die Unit stand
  # auf „enabled", `ExecMainStartTimestamp` war LEER, und der Schirm zeigte
  # weiter den Pair-Code, weil niemand etwas installierte.
  #
  # `--no-block`, weil der Lauf 10 bis 20 Minuten dauert: die Erstinstallation
  # darf darauf nicht warten, sie muss selbst zu Ende kommen.
  systemctl start --no-block mixpibox-selbstlauf.service 2>/dev/null \\
    && echo "Selbstlauf: im Assistenten bestaetigt — laeuft ab jetzt" \\
    || echo "Selbstlauf: liess sich nicht starten — faengt beim naechsten Start an\""""

    schirm_block = ""
    if handy:
        schirm_block = """
# --- Einrichtungsbildschirm: QR + Adresse + Pair-Code auf den Schirm der Box ---
# Alle Teile liegen FLACH in einem Ordner: einrichtung-schirm.py laedt seine
# Nachbarn (Boot-Animation fuer Framebuffer+Farben, qr.py, einrichtung-ap.py)
# ueber den eigenen Verzeichnispfad.
if [ -d "$BOOTW/einrichtung" ]; then
  install -d -m 755 /opt/mixpibox-einrichtung
  install -m 755 "$BOOTW/einrichtung/"*.py /opt/mixpibox-einrichtung/ 2>/dev/null
  install -m 644 "$BOOTW/einrichtung/mixpi-hoert.png" /opt/mixpibox-einrichtung/ 2>/dev/null
  # --- Das Installationspaket, wenn es mitgegeben wurde -------------------
  # Ein Archiv, KEIN Ordner: die Boot-Partition ist FAT32 und kennt keine
  # Unix-Rechte. Ein scripts/-Verzeichnis kaeme dort ohne +x an, und die
  # Fehlersuche begaenne bei "Permission denied" mitten im Lauf.
  if [ -f "$BOOTW/einrichtung/lauf.tar.gz" ]; then
    install -d -m 755 /opt/mixpibox-lauf
    if tar -xzf "$BOOTW/einrichtung/lauf.tar.gz" -C /opt/mixpibox-lauf; then
      chmod 755 /opt/mixpibox-lauf/selbstlauf.py 2>/dev/null
      echo "Installationspaket: ausgepackt ($(ls /opt/mixpibox-lauf/dateien | wc -l) Dateien)"
    else
      echo "WARNUNG: Installationspaket liess sich nicht auspacken"
    fi
  fi

  for U in mixpibox-einrichtung mixpibox-einrichtung-ap mixpibox-selbstlauf; do
    if [ -f "$BOOTW/einrichtung/$U.service" ]; then
      install -m 644 "$BOOTW/einrichtung/$U.service" "/etc/systemd/system/$U.service"
      systemctl enable "$U.service"
      echo "Unit: $U an"
    fi
  done
  systemctl daemon-reload
  # Den Bildschirm SOFORT: er soll zeigen, was gerade passiert. Den
  # Zugangspunkt NICHT — er wartet erst 45 s auf ein Netz, und das laeuft beim
  # naechsten Start von selbst an. Ihn hier zu starten hiesse, ihn mitten in
  # der DietPi-Erstinstallation aufzumachen, die gerade ueber das Netz laedt,
  # das er abschalten wuerde.
  systemctl start mixpibox-einrichtung.service 2>/dev/null || true
SOFORT_BLOCK
else
  echo "Einrichtungsbildschirm: nicht mitgegeben (kein Beinbruch)"
fi
"""
    key_block = ""
    if ssh_pubkey:
        k = ssh_pubkey.strip().replace("'", "")
        key_block = f"""
# --- SSH-Schlüssel des Controllers hinterlegen (dann kein Passwort nötig) ---
for u in dietpi root; do
  h=$(getent passwd "$u" | cut -d: -f6)
  [ -n "$h" ] || continue
  mkdir -p "$h/.ssh" && chmod 700 "$h/.ssh"
  grep -qF '{k}' "$h/.ssh/authorized_keys" 2>/dev/null || echo '{k}' >> "$h/.ssh/authorized_keys"
  chmod 600 "$h/.ssh/authorized_keys"; chown -R "$u" "$h/.ssh"
done
"""
    return f"""#!/bin/bash
# Vom remote-step-installer erzeugt. Läuft EINMAL beim ersten Boot (als root).
# Absicht: NUR den Agent einrichten — alles andere macht später der Controller.
set -u
LOG=/var/tmp/step-agent-firstboot.log
exec >>"$LOG" 2>&1
echo "=== $(date -Is) Agent-Einrichtung ==="

# Agent-Dateien liegen auf der Boot-Partition (Pfad je nach Image/Debian-Stand)
SRC=""
for d in /boot/firmware/step-agent /boot/step-agent /boot/firmware /boot; do
  [ -f "$d/agent.py" ] && {{ SRC="$d"; break; }}
done
[ -n "$SRC" ] || {{ echo "agent.py nicht gefunden — abgebrochen"; exit 0; }}
echo "Quelle: $SRC"

install -d -m 700 /opt/step-agent
install -m 700 "$SRC/agent.py" /opt/step-agent/agent.py

# DIE BOOT-WURZEL IST NICHT $SRC. $SRC ist der Ordner, in dem agent.py lag —
# meist /boot/firmware/step-agent. Der Einrichtungsordner liegt aber eine
# Ebene HOEHER (/boot/firmware/einrichtung). Am Geraet gesehen: die
# Erstinstallation lief endlich durch, meldete "Einrichtungsbildschirm: nicht
# mitgegeben" und liess Laufpaket wie Selbstlauf-Unit liegen — die Box blieb
# ein nacktes DietPi, obwohl alles auf der Karte lag. Eine Ebene daneben.
BOOTW=/boot; [ -d /boot/firmware ] && BOOTW=/boot/firmware

# Python NICHT voraussetzen: ein minimales DietPi bringt keines mit, und der Pfad ist
# nicht zwingend /usr/bin/python3.
PY="$(command -v python3 || true)"
if [ -z "$PY" ]; then
  echo "Python 3 fehlt — installiere es (einzige Voraussetzung des Agents)"
  apt-get update -qq && apt-get install -y --no-install-recommends python3
  PY="$(command -v python3 || true)"
fi
[ -n "$PY" ] || {{ echo "FEHLER: kein python3 — Agent kann nicht starten"; exit 0; }}
echo "Python: $PY"

cat > /etc/systemd/system/step-agent.service <<UNIT
[Unit]
Description=remote-step-installer agent
# NICHT auf network-online warten, wenn er im LAN lauschen soll: genau der
# Fall ohne Netz ist der, in dem das Handy uebernehmen soll. Bindet er an
# 0.0.0.0, gilt das auch fuer Schnittstellen, die spaeter dazukommen.
After=network.target
[Service]
ExecStart=$PY /opt/step-agent/agent.py --host {lauscht} --port {agent_port} --paircode-file /opt/step-agent/paircode
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now step-agent.service
sleep 2

# Der Agent schreibt den Pair-Code selbst (--paircode-file) — zuverlaessiger als aus
# dem Journal zu fischen (DietPi nutzt RAMlog). Kopie fuer den SSH-Benutzer anlegen.
if [ -s /opt/step-agent/paircode ]; then
  chmod 600 /opt/step-agent/paircode
  h=$(getent passwd dietpi | cut -d: -f6)
  [ -n "$h" ] && {{ cp /opt/step-agent/paircode "$h/.step-agent-paircode"; chmod 600 "$h/.step-agent-paircode"; chown dietpi "$h/.step-agent-paircode"; }}
  echo "Pair-Code hinterlegt."
else
  echo "WARNUNG: kein Pair-Code — 'systemctl status step-agent' auf der Box ansehen."
fi
{schirm_block.replace('SOFORT_BLOCK', sofort_block)}{key_block}
echo "=== fertig ==="
exit 0
"""


# ══ PURE: Geräte-Auswahl (die gefährliche Stelle) ═══════════════════════════
def _mountpoints(dev):
    mps = list(dev.get("mountpoints") or [])
    if dev.get("mountpoint"):
        mps.append(dev["mountpoint"])
    for ch in dev.get("children") or []:
        mps += _mountpoints(ch)
    return [m for m in mps if m]


SYSTEM_MOUNTS = ("/", "/home", "/boot", "/boot/efi", "/boot/firmware", "/var", "[SWAP]")


def safe_devices(lsblk):
    """Aus `lsblk -J` klassifizieren, wohin man GEFAHRLOS schreiben darf.
    → (beschreibbar, ausgeschlossen-mit-Grund). Regeln bewusst streng: nur Typ
    'disk'; angeboten wird nur, was wechselbar ist (rm/hotplug) ODER per usb/mmc/sd
    hängt — und NIEMALS ein Gerät, auf dem das laufende System liegt.
    Pure: nimmt das geparste JSON, macht kein I/O."""
    ok, blocked = [], []
    for d in (lsblk or {}).get("blockdevices", []):
        if d.get("type") != "disk":
            continue
        mps = _mountpoints(d)
        info = {
            "name": d.get("name", ""), "path": d.get("path") or f"/dev/{d.get('name','')}",
            "size": d.get("size", "?"), "model": (d.get("model") or "").strip(),
            "tran": (d.get("tran") or "").lower(),
            "removable": bool(d.get("rm")) or bool(d.get("hotplug")),
            "mounts": mps,
        }
        if any(m in SYSTEM_MOUNTS for m in mps):
            info["reason"] = "System liegt darauf"           # hart ausgeschlossen
            blocked.append(info)
        elif not (info["removable"] or info["tran"] in ("usb", "mmc", "sd")):
            info["reason"] = "kein Wechseldatenträger"       # interne Platte
            blocked.append(info)
        else:
            ok.append(info)
    return ok, blocked


# ══ I/O: Netz ═══════════════════════════════════════════════════════════════
#
# WARUM HIER EINE STILLSTANDS-ERKENNUNG STEHT (31.08.2026)
# Betreiber, nach einem Lauf, der eine halbe Stunde bei 7 % stand: „ich habe
# gemerkt das wir keine rueckmeldung das kein netz besteht".
#
# Er hat recht, und der Grund ist eine Zeile: `download()` holte sich die
# Verbindung mit `timeout=120`. Reisst das Netz MITTEN im Laden ab, blockiert
# `r.read()` bis zu zwei Minuten — und weil die Schleife nicht zurueckkommt,
# gibt es keine Stelle, an der ein Hinweis entstehen KOENNTE. Der Balken steht,
# und niemand sagt warum. Bei einem halb offenen TCP dauert es noch laenger.
#
# Ein grosses Timeout ist also nicht robust, sondern das Gegenteil: es macht
# den Stillstand unsichtbar. Deshalb jetzt ein KLEINES Lesefenster
# (LESEFENSTER_S) und Geduld durch WIEDERHOLUNG — nach jedem leeren Fenster
# kommt die Schleife zurueck, kann melden und weitermachen. Aufgegeben wird
# erst nach GEDULD_S ohne ein einziges Byte.
LESEFENSTER_S = 15      # so lange darf EIN read() blockieren
GEDULD_S = 120          # so lange ohne ein einziges Byte, dann Abbruch


class KeinNetz(OSError):
    """Netz weg oder Gegenstelle stumm — mit einem Satz, den man zeigen kann."""


def _get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": UA})   # ohne UA: HTTP 403
    return urllib.request.urlopen(req, timeout=timeout)


def netz_pruefen(host="dietpi.com", port=443, timeout=5):
    """Steht die Strecke ueberhaupt? Gibt (True, '') oder (False, Grund).

    VOR dem Laden gefragt, nicht danach: zwei Minuten in ein totes Netz zu
    warten und DANN zu melden, ist dieselbe Auskunft — nur zwei Minuten
    spaeter. Getrennt wird dabei zwischen „Name nicht aufloesbar" (DNS/kein
    Netz) und „niemand nimmt ab" (Strecke da, Gegenstelle weg), weil das zwei
    verschiedene Handgriffe sind."""
    try:
        adressen = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        return False, (f"Der Name {host} laesst sich nicht aufloesen - keine "
                       "Netzverbindung oder kein DNS.")
    except OSError as f:
        return False, f"Netzfehler beim Aufloesen von {host}: {f}"
    fehler = "unbekannt"
    for fam, art, proto, _, adresse in adressen:
        s = socket.socket(fam, art, proto)
        s.settimeout(timeout)
        try:
            s.connect(adresse)
            return True, ""
        except OSError as f:
            fehler = str(f)
        finally:
            s.close()
    return False, f"{host}:{port} ist nicht erreichbar ({fehler})."


def fetch_index():
    """Bild-Liste LIVE von dietpi.com holen (nichts hartkodiert → veraltet nie).

    Wirft `KeinNetz` mit einem anzeigbaren Satz, statt eine nackte URLError
    durchzureichen — die Oberflaechen zeigen sonst „<urlopen error [Errno -3]>"
    und der Mensch davor weiss immer noch nicht, dass sein WLAN weg ist."""
    try:
        return parse_index(_get(INDEX_URL).read().decode("utf-8", "replace"))
    except (urllib.error.URLError, socket.timeout, OSError) as f:
        steht, grund = netz_pruefen()
        raise KeinNetz(grund if not steht else
                       f"dietpi.com antwortet nicht wie erwartet: {f}") from f


def fetch_sha256(entry):
    try:
        txt = _get(entry["url"] + ".sha256", timeout=30).read().decode()
        m = re.search(r"\b([0-9a-f]{64})\b", txt)
        return m.group(1) if m else ""
    except (urllib.error.HTTPError, urllib.error.URLError, OSError):
        return ""


def download(url, dest, on_progress=None, on_hinweis=None):
    """Image laden, mit Fortschritt UND Rueckmeldung bei Stillstand.

    `on_hinweis(text)` wird gerufen, sobald ein Lesefenster leer bleibt — das
    ist die Rueckmeldung, die bis zum 31.08.2026 fehlte. Sie kommt nach
    LESEFENSTER_S, nicht erst nach dem Abbruch: wer zusieht, soll waehrend des
    Wartens erfahren, WORAUF gewartet wird, und selbst entscheiden koennen, ob
    er das WLAN richtet oder abbricht.

    Nach GEDULD_S ohne ein einziges Byte fliegt `KeinNetz` — mit einem Satz,
    der sagt, was los ist, statt eines nackten Errno."""
    tmp = dest + ".part"
    steht, grund = netz_pruefen()
    if not steht:
        raise KeinNetz(grund)

    try:
        verbindung = _get(url, timeout=LESEFENSTER_S)
    except (urllib.error.URLError, socket.timeout, OSError) as f:
        steht, grund = netz_pruefen()
        raise KeinNetz(grund if not steht else f"Laden nicht gestartet: {f}") from f

    with verbindung as r, open(tmp, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        got = 0
        # WANN kam das letzte Byte — nicht: wie oft lief die Schleife. Ein
        # Zaehler fuer Fehlversuche waere bei schwankendem Netz falsch: dort
        # wechseln sich leere und volle Fenster ab, und solange Bytes kommen,
        # ist das kein Stillstand, sondern langsam.
        letztes_byte = time.monotonic()
        gemeldet = False
        while True:
            try:
                chunk = r.read(1 << 20)
            except (socket.timeout, TimeoutError):
                chunk = None
            except (urllib.error.URLError, OSError) as fehler:
                steht, grund = netz_pruefen()
                raise KeinNetz(grund if not steht
                               else f"Verbindung abgerissen: {fehler}") from fehler

            if chunk:
                f.write(chunk)
                got += len(chunk)
                letztes_byte = time.monotonic()
                if gemeldet:            # es geht wieder weiter — auch das sagen
                    gemeldet = False
                    if on_hinweis:
                        on_hinweis("Verbindung wieder da, laedt weiter.")
                if on_progress:
                    on_progress(got, total)
                continue

            if chunk == b"":            # sauberes Ende der Uebertragung
                break

            # Leeres Fenster: nichts gekommen, Verbindung aber noch offen.
            still = time.monotonic() - letztes_byte
            if still >= GEDULD_S:
                steht, grund = netz_pruefen()
                raise KeinNetz(
                    grund if not steht else
                    f"Seit {int(still)} s kein Byte mehr von dietpi.com — abgebrochen.")
            if on_hinweis and not gemeldet:
                gemeldet = True
                on_hinweis(f"Seit {int(still)} s kommt nichts an — Netzverbindung prüfen. "
                           f"Ich warte noch bis {GEDULD_S} s.")

    if total and got < total:
        raise KeinNetz(f"Abbild unvollstaendig: {got} von {total} Bytes. Nichts uebernommen.")
    os.replace(tmp, dest)
    return dest


def sha256_file(path, on_progress=None):
    h = hashlib.sha256()
    size = os.path.getsize(path)
    done = 0
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
            done += len(chunk)
            if on_progress:
                on_progress(done, size)
    return h.hexdigest()


# ══ I/O: Geräte + Schreiben ═════════════════════════════════════════════════
def list_block_devices():
    try:
        out = subprocess.run(
            ["lsblk", "-J", "-o", "NAME,PATH,SIZE,MODEL,TRAN,RM,HOTPLUG,TYPE,MOUNTPOINTS"],
            capture_output=True, text=True, timeout=20)
        return json.loads(out.stdout or "{}")
    except (OSError, ValueError, subprocess.SubprocessError):
        return {}


def faillock_lage(ausgabe=None, deny=None, unlock_time=None):
    """Sperrt pam_faillock gerade? -> {gesperrt, versuche, frei_ab, deny}.

    Nach einigen Fehlversuchen weist PAM auch das RICHTIGE Passwort ab — und
    sagt das nirgends. Man sucht den Fehler dann im Programm statt in der Sperre
    (am Gerät genau so passiert: drei Fehlversuche über polkit, danach war jedes
    Passwort "falsch"). Deshalb wird das hier ausgelesen und benannt.

    `ausgabe` nur für Tests; sonst wird `faillock` gefragt — das darf jeder für
    sein EIGENES Konto, ohne Rechte.
    """
    if deny is None or unlock_time is None:
        d, u = 3, 600                                   # PAM-Standardwerte
        try:
            with open("/etc/security/faillock.conf") as f:
                for ln in f:
                    ln = ln.strip()
                    if ln.startswith("deny"):
                        d = int(ln.split("=")[-1].strip())
                    elif ln.startswith("unlock_time"):
                        u = int(ln.split("=")[-1].strip())
        except (OSError, ValueError):
            pass
        deny = d if deny is None else deny
        unlock_time = u if unlock_time is None else unlock_time

    if ausgabe is None:
        if not shutil.which("faillock"):
            return {"gesperrt": False, "versuche": 0, "frei_ab": None, "deny": deny}
        try:
            ausgabe = subprocess.run(["faillock"], capture_output=True, text=True,
                                     timeout=10).stdout or ""
        except (OSError, subprocess.SubprocessError):
            return {"gesperrt": False, "versuche": 0, "frei_ab": None, "deny": deny}

    gueltig = []
    for ln in ausgabe.splitlines():
        m = re.match(r"\s*(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\s+\S+\s+\S+\s+([VI])\s*$", ln)
        if m and m.group(2) == "V":
            gueltig.append(m.group(1))
    frei, noch_zu = None, False
    if gueltig:
        try:
            letzter = max(time.mktime(time.strptime(t, "%Y-%m-%d %H:%M:%S")) for t in gueltig)
            frei_ts = letzter + unlock_time
            frei = time.strftime("%H:%M:%S", time.localtime(frei_ts))
            # Die Eintraege bleiben stehen, auch wenn die Sperre laengst abgelaufen
            # ist — nur zaehlen reicht also nicht, sonst warnt das Programm noch
            # Stunden spaeter vor einer Sperre, die es nicht mehr gibt.
            noch_zu = time.time() < frei_ts
        except ValueError:
            noch_zu = True                     # Zeit unlesbar: lieber warnen
    return {"gesperrt": len(gueltig) >= deny and noch_zu, "versuche": len(gueltig),
            "frei_ab": frei, "deny": deny}


_ASKPASS = []          # gemerkter Pfad, damit der Helfer nur einmal entsteht


def askpass_script():
    """Winziger Helfer, mit dem `sudo -A` grafisch nach dem Passwort fragt.

    Warum nicht einfach pkexec: polkit entscheidet selbst, WESSEN Passwort es
    haben will. Je nach Konfiguration ist das nicht das eigene, sondern das von
    root — dann wird das richtige Passwort abgewiesen, ohne dass der Dialog das
    erklärt (am Gerät genau so erlebt). `sudo` dagegen fragt immer nach dem
    Passwort des AUFRUFENDEN Benutzers und merkt es sich anschliessend einige
    Minuten, sodass Folgeaufrufe nichts mehr fragen.
    """
    if _ASKPASS:
        return _ASKPASS[0]
    werkzeug = shutil.which("kdialog") or shutil.which("zenity")
    if not werkzeug:
        return None
    titel = "SD-Karte schreiben"
    if werkzeug.endswith("kdialog"):
        rumpf = f'#!/bin/sh\nexec {werkzeug} --password "$1" --title {titel!r}\n'
    else:
        rumpf = f'#!/bin/sh\nexec {werkzeug} --password --title {titel!r}\n'
    # Eigenes Verzeichnis (0700) statt fester /tmp-Name: ein vorhersagbarer Pfad
    # liesse sich von aussen vorbelegen, und dieses Skript laeuft mit Rechten.
    d = tempfile.mkdtemp(prefix="rsi-askpass-")
    p = os.path.join(d, "askpass.sh")
    with open(p, "w") as f:
        f.write(rumpf)
    os.chmod(p, 0o700)
    _ASKPASS.append(p)
    return p


def ist_root():
    """Laeuft dieses Programm mit vollen Rechten? — auf JEDEM System.

    ══ WARUM NICHT `os.geteuid() == 0` ═══════════════════════════════════════
    `os.geteuid` GIBT ES AUF WINDOWS NICHT. Der Aufruf endet dort mit
    `AttributeError: module 'os' has no attribute 'geteuid'` — und zwar an
    vier Stellen dieser Datei, von denen drei auf dem Weg zum Schreiben
    liegen. Der Ein-Knopf-Installer waere auf Windows also abgestuerzt, bevor
    er die erste Karte anfasst (Betreiber, 08.08.2026: „wichtig ist das es
    auch auf windows funktioniert").

    Auf Windows heisst die Frage „bin ich Administrator?", und die beantwortet
    `IsUserAnAdmin()` aus der shell32. Faellt auch das aus (aeltere Fassungen,
    fremde Laufzeit), lautet die Antwort NEIN — das ist die sichere Seite:
    dann wird nach Rechten gefragt, statt sie anzunehmen.
    """
    if hasattr(os, "geteuid"):
        return os.geteuid() == 0
    try:
        import ctypes
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def root_helper(interactive=True):
    """Wie kommen wir an Root-Rechte? -> (Präfix, Umgebung, Hinweis); Präfix None = gar nicht.

    `interactive=False` ist der TUI-Fall und der eigentliche Grund für diese
    Funktion: dort gehört das Terminal Textual. Ein `sudo`, das nach dem
    Passwort fragen will, findet kein nutzbares Terminal und bricht ab — der
    Anwender sah nur "Schreiben fehlgeschlagen" ohne jeden Grund.
    """
    if ist_root():
        return [], {}, ""
    # AUF WINDOWS GIBT ES KEIN sudo UND KEIN pkexec. Wer dort ohne
    # Administratorrechte schreibt, bekommt vom Betriebssystem ein „Zugriff
    # verweigert" — und dagegen hilft nur ein Neustart des Programms als
    # Administrator, nicht ein Passwortfenster.
    if os.name == "nt":
        return (None, {}, "Ohne Administratorrechte kann unter Windows keine Karte "
                          "beschrieben werden. Das Programm bitte mit der rechten "
                          "Maustaste als Administrator starten.")
    have_sudo = bool(shutil.which("sudo"))
    if interactive and have_sudo:
        return ["sudo"], {}, ""                  # Terminal gehört uns: darf fragen
    if have_sudo and subprocess.run(["sudo", "-n", "true"],
                                    capture_output=True).returncode == 0:
        return ["sudo"], {}, ""                  # Freigabe ist noch gemerkt
    ap = askpass_script() if have_sudo else None
    if ap:
        return (["sudo", "-A", "--"], {"SUDO_ASKPASS": ap},
                "Passwortabfrage über sudo — es zählt DEIN Benutzerpasswort")
    if shutil.which("pkexec") and (os.environ.get("DISPLAY")
                                   or os.environ.get("WAYLAND_DISPLAY")):
        return (["pkexec"], {},
                "Rechte über pkexec — Achtung: polkit fragt je nach Einstellung "
                "nach dem root-Passwort, nicht nach deinem")
    return None, {}, ("Root-Rechte fehlen — und hier kann nicht nach dem Passwort "
                      "gefragt werden. In einem ZWEITEN Terminal einmal 'sudo -v' "
                      "ausführen (merkt die Freigabe einige Minuten) und dann hier "
                      "erneut bestätigen.")


def image_size(img_xz):
    """Entpackte Größe des Abbilds in Bytes -> 0, wenn nicht ermittelbar.

    Braucht man für einen ECHTEN Fortschrittsbalken: dd meldet nur die
    geschriebenen Bytes, nicht wie viele es werden.
    """
    try:
        r = subprocess.run(["xz", "--robot", "-l", img_xz],
                           capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return 0
    for ln in (r.stdout or "").splitlines():
        teile = ln.split("\t")
        if teile and teile[0] == "totals" and len(teile) > 4:
            try:
                return int(teile[4])
            except ValueError:
                return 0
    return 0


def parse_dd_progress(zeile):
    """Aus einer dd-Fortschrittszeile die geschriebenen Bytes lesen. Pure.

    dd schreibt je nach Spracheinstellung anders:
        englisch: "1234567 bytes (1,2 MB, …) copied, 1 s, 1,2 MB/s"
        deutsch:  "209715200 Byte (210 MB, …) kopiert, 0,004 s, 52,0 GB/s"
    Also GROSS/klein egal und Einzahl wie Mehrzahl — genau daran scheiterte der
    Balken zuerst: auf einem deutschen System stand dort "Byte", gesucht wurde
    "bytes". Die Zahl steht immer vorn; "512+0 Datensätze ein" darf NICHT
    passen, deshalb muss ein Leerzeichen und ein Byte-Wort folgen.
    """
    m = re.match(r"^\s*(\d+)\s+bytes?\b", zeile or "", re.IGNORECASE)
    return int(m.group(1)) if m else None


def parse_percent(zeile):
    """Prozentangabe + Abschnitt aus einer Werkzeugzeile lesen. Pure.

    -> (prozent, 'verify'|'write'|None) oder (None, None)

    Nötig, weil NICHT immer dd schreibt: ist rpi-imager vorhanden, wird der
    genommen (er prüft nach dem Schreiben nach) — und der meldet Prozente statt
    Bytes. Genau daran stand der Balken still: gesucht wurden nur dd-Bytes.
    Zahl und Prozentzeichen dürfen zusammen- oder auseinanderstehen.
    """
    m = re.search(r"(\d{1,3}(?:[.,]\d+)?)\s*%", zeile or "")
    if not m:
        return None, None
    try:
        p = float(m.group(1).replace(",", "."))
    except ValueError:
        return None, None
    if not 0 <= p <= 100:
        return None, None
    t = (zeile or "").lower()
    abschnitt = None
    if "verif" in t or "prüf" in t or "pruef" in t:
        abschnitt = "verify"
    elif "writ" in t or "schreib" in t:
        abschnitt = "write"
    return p, abschnitt


def run_streaming(cmd, say, env=None):
    """Ausgabe MITLESEN statt sie ins Terminal unter der Oberfläche zu schütten.

    Ohne das bleibt von einem Fehlschlag nur der Rückgabecode übrig, während der
    eigentliche Satz ("no space left", "Permission denied", "device is busy")
    unsichtbar hinter der TUI landet. dd trennt seinen Fortschritt mit \\r,
    Fehler mit \\n — deshalb wird an beidem geteilt.
    """
    umgebung = dict(os.environ, **(env or {})) if env else None
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         env=umgebung)
    rest = b""
    fd = p.stdout.fileno()
    while True:
        # os.read statt p.stdout.read(n): letzteres WARTET, bis n Bytes beisammen
        # sind. Bei einer Fortschrittsmeldung pro Sekunde stand die Anzeige
        # dadurch sekundenlang still. os.read gibt zurueck, sobald etwas da ist.
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        teile = re.split(rb"[\r\n]", rest + chunk)
        rest = teile.pop()
        for ln in teile:
            t = ln.decode("utf-8", "replace").strip()
            if t:
                say(t)
    if rest.strip():
        say(rest.decode("utf-8", "replace").strip())
    return p.wait()


def _nmcli(args, timeout=12):
    """nmcli maschinenlesbar aufrufen -> Zeilen. Leer, wenn es nicht da ist."""
    if not shutil.which("nmcli"):
        return []
    try:
        r = subprocess.run(["nmcli", "-t"] + args, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return []
    return [ln for ln in (r.stdout or "").splitlines() if ln.strip()] if r.returncode == 0 else []


def wifi_networks():
    """Sichtbare WLANs des Rechners -> [{ssid, signal, security, gespeichert}].

    Reine Bequemlichkeit, aber eine wirksame: eine von Hand getippte SSID ist
    eine der haeufigsten Ursachen dafuer, dass die Box spaeter stumm bleibt —
    der Fehler faellt erst auf, wenn sie sich nach dem Erstboot nicht meldet,
    und dann ist die Karte schon geschrieben.

    Laeuft im Benutzerkontext (nmcli), braucht also KEINE Rechte und liest
    KEINE Passwoerter aus — nur Namen. Gespeicherte Netze werden markiert,
    damit man sein eigenes wiedererkennt.
    """
    gespeichert = {ln.split(":", 1)[0]
                   for ln in _nmcli(["-f", "NAME,TYPE", "connection", "show"])
                   if ln.rsplit(":", 1)[-1].endswith("wireless")}
    netze = {}
    for ln in _nmcli(["-f", "SSID,SIGNAL,SECURITY", "device", "wifi", "list"]):
        teile = ln.split(":")
        if len(teile) < 3:
            continue
        ssid = ":".join(teile[:-2]).strip()          # Doppelpunkt in der SSID ist erlaubt
        if not ssid:
            continue                                  # verstecktes Netz -> nichts anzuzeigen
        try:
            signal = int(teile[-2])
        except ValueError:
            signal = 0
        # Dasselbe Netz sendet oft mehrfach (2,4 + 5 GHz): staerkstes Signal gewinnt.
        if ssid not in netze or signal > netze[ssid]["signal"]:
            netze[ssid] = {"ssid": ssid, "signal": signal, "security": teile[-1].strip(),
                           "gespeichert": ssid in gespeichert}
    return sorted(netze.values(), key=lambda n: (-n["gespeichert"], -n["signal"], n["ssid"].lower()))


def wifi_active():
    """SSID, mit der DIESER Rechner gerade verbunden ist -> '' wenn keine.

    Der Unterschied traegt eine bittere Lehre: nur der Schluessel des AKTIVEN
    Netzes ist BEWIESEN richtig. Ein gespeichertes Profil kann Jahre alt sein —
    am Geraet uebernahm der Assistent voller Ueberzeugung einen veralteten
    Schluessel ('WRONG_KEY' auf der Box, waehrend der Laptop im Schwesternetz
    mit demselben gespeicherten Wert online war).
    """
    for ln in _nmcli(["-f", "ACTIVE,SSID", "device", "wifi", "list"]):
        teile = ln.split(":", 1)
        if len(teile) == 2 and teile[0].strip().lower() in ("yes", "ja"):
            return teile[1].strip()
    return ""


def wifi_secret(ssid):
    """Gespeichertes WLAN-Passwort dieses Rechners holen -> '' wenn nicht möglich.

    Der Rechner kennt das Passwort ja bereits (in KDE genügt ein Klick, um es
    anzuzeigen), also muss es niemand abtippen — ein Tippfehler im Schlüssel
    fällt sonst erst auf, wenn die Box nach dem Erstboot stumm bleibt.

    Bewusst NICHT protokolliert und nirgends angezeigt: der Wert geht direkt ins
    Passwortfeld. Ist er nicht ohne Rückfrage zu haben (fremdes Netz, andere
    Rechteeinstellung), kommt '' zurück und es wird wie bisher getippt.
    """
    if not ssid or not shutil.which("nmcli"):
        return ""
    try:
        # `-e no` ist NICHT kosmetisch: -g bedeutet Terse-Modus, und dort
        # maskiert nmcli ':' und '\' mit einem Backslash (Vorgabe --escape yes,
        # siehe man nmcli). Ein Passwort mit Doppelpunkt kaeme also als 'a\:b'
        # zurueck und landete falsch auf der Karte — ein Fehler, der erst
        # auffaellt, wenn die Box nach dem Erstboot stumm bleibt.
        r = subprocess.run(["nmcli", "-s", "-e", "no",
                            "-g", "802-11-wireless-security.psk",
                            "connection", "show", ssid],
                           capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return ""
    return (r.stdout or "").strip() if r.returncode == 0 else ""


def unmount_all(device, on_line=None):
    """Alle Partitionen der Karte aushängen, BEVOR geschrieben wird.

    Ein Desktop hängt eine eingesteckte Karte selbsttätig ein; schreibt man dann
    quer darüber, scheitert dd ("device is busy") oder — schlimmer — der Kernel
    hält noch den alten Dateisystem-Zwischenspeicher und die frisch geschriebene
    Karte ist kaputt. `udisksctl` läuft dabei im Benutzerkontext, braucht also
    kein Root.
    """
    say = on_line or (lambda s: None)
    if not shutil.which("udisksctl"):
        return
    for d in list_block_devices().get("blockdevices", []) or []:
        if d.get("path") != device:
            continue
        for kind in (d.get("children") or []):
            if not (kind.get("mountpoints") or []):
                continue
            if any(m for m in kind["mountpoints"] if m):
                r = subprocess.run(["udisksctl", "unmount", "-b", kind["path"]],
                                   capture_output=True, text=True)
                say(f"{kind['path']} ausgehängt" if r.returncode == 0
                    else f"{kind['path']} liess sich nicht aushängen: {(r.stderr or '').strip()}")


def write_image(img_xz, device, dry_run=True, on_line=None, interactive=True):
    """Image auf die Karte schreiben. `dry_run` zeigt nur den Befehl.
    Bevorzugt rpi-imager (prüft nach dem Schreiben), sonst xz|dd."""
    say = on_line or (lambda s: print("  " + s))
    # ALLES, was Rechte braucht, steckt in DIESEM EINEN Befehl. Jeder weitere
    # Aufruf waere eine zusaetzliche Passwortabfrage — pkexec merkt sich nichts.
    # Deshalb hier auch das Neueinlesen der Partitionstabelle: direkt nach dd
    # kennt der Kernel noch die ALTE Aufteilung, udisksctl findet die frische
    # Boot-Partition dann nicht und mount_boot muesste mit Rechten einspringen
    # (zweite Abfrage) — und haette die Partition anschliessend als root
    # eingehaengt, sodass das Schreiben der Dateien scheitert.
    dd_cmd = ["bash", "-c",
              f"xz -dc {img_xz!r} | dd of={device!r} bs=4M status=progress conv=fsync"
              f" && sync"
              f" && (partprobe {device!r} 2>/dev/null"
              f"     || blockdev --rereadpt {device!r} 2>/dev/null || true)"
              f" && (udevadm settle 2>/dev/null || true)"]
    if dry_run:
        vorschau = ([] if ist_root() else ["sudo"]) + (
            ["rpi-imager", "--cli", img_xz, device] if shutil.which("rpi-imager") else dd_cmd)
        say("TROCKENLAUF — es wird NICHT geschrieben. Befehl wäre:")
        say("  " + " ".join(vorschau))
        return None
    sudo, umgebung, hinweis = root_helper(interactive)
    if sudo is None:
        say(hinweis)
        return 126                               # wie die Shell: nicht ausführbar
    if hinweis:
        say(hinweis)
    # Immer sagen, WORÜBER die Rechte kommen — ohne das ist ein "das Passwort
    # klappt nicht" nicht auseinanderzuhalten (fragt gar nichts? fragt das
    # Falsche? fragt zweimal?).
    say("Rechte über: " + (" ".join(sudo) if sudo else "bereits root"))
    unmount_all(device, say)

    # ══ AUF WINDOWS SCHREIBT DAS PROGRAMM SELBST ════════════════════════════
    #
    # Der Befehl unten ist `bash -c "xz -dc … | dd of=…"`. Windows hat weder
    # bash noch xz noch dd, und `{img_xz!r}` verdoppelt dort ausserdem jeden
    # Schraegstrich (aus C:\Users\… wird 'C:\\Users\\…').
    #
    # DER ZWEIG STAND BISHER NUR IN sdgui.py — und ausgerechnet der
    # Ein-Knopf-Installer (sdstart.py), der Windows-Nutzern empfohlen wird,
    # rief `write_image` unbedingt und lief damit in den bash-Aufruf.
    # Gefunden von einer Sichtung am 10.08.2026, die den ganzen Weg Schritt
    # fuer Schritt gegen den Quelltext gelesen hat.
    #
    # ER STEHT JETZT HIER und nicht in den Oberflaechen: Drei Fenster, die
    # jedes fuer sich an Windows denken muessen, sind drei Gelegenheiten, es
    # zu vergessen — eine davon hatte schon zugeschlagen.
    if os.name == "nt":
        try:
            import geraete
        except ImportError as e:                          # pragma: no cover
            say(f"geraete.py nicht gefunden: {e}")
            return 1
        say(f"$ (eingebaut) roh schreiben nach {device}")
        try:
            geraete.windows_schreiben(img_xz, device, melden=say)
            return 0
        except OSError as e:
            say(f"Schreiben fehlgeschlagen: {e}")
            say("Ohne Administratorrechte laesst sich ein Rohgeraet nicht oeffnen.")
            return 1
    # rpi-imager prüft nach dem Schreiben nach und ist deshalb erste Wahl —
    # ABER es ist ein Qt-Programm, und pkexec räumt die Umgebung leer
    # (XDG_RUNTIME_DIR, DBus). Auf diesem Weg ist das schlichte xz|dd das
    # verlässlichere Werkzeug, weil es nichts davon braucht.
    if shutil.which("rpi-imager") and sudo != ["pkexec"]:
        cmd = ["rpi-imager", "--cli", img_xz, device]
    else:
        cmd = dd_cmd
    full = sudo + cmd
    say("$ " + " ".join(full))
    rc = run_streaming(full, say, umgebung)
    if rc == 0 and not sudo:
        subprocess.run(["sync"], capture_output=True)   # als root: kostet nichts
    if rc != 0 and sudo:
        lage = faillock_lage()
        if lage["gesperrt"]:
            say(f"ACHTUNG: das Konto ist wegen {lage['versuche']} Fehlversuchen gesperrt "
                f"(ab {lage['deny']} sperrt PAM). Ab dann wird auch das RICHTIGE "
                f"Passwort abgewiesen."
                + (f" Wieder frei ab {lage['frei_ab']}." if lage["frei_ab"] else ""))
            say("Einfach abwarten — nicht weiter probieren, das verlängert die Sperre.")
    return rc


def mount_boot(device, dry_run=True, interactive=True, on_line=None):
    """Boot-Partition (FAT, meist Partition 1) mounten → Mountpoint zurück.

    ══ AUF WINDOWS UEBERNIMMT geraete.boot_mounten ═════════════════════════
    Der Weg darunter ist reines Linux: `udisksctl`, `mount`, und weiter unten
    `os.getuid()` — Letzteres gibt es auf Windows gar nicht. geraete.py hat
    fuer diesen Schritt laengst einen eigenen Zweig (dort bekommt die
    FAT-Partition einen Laufwerksbuchstaben, statt eingehaengt zu werden).

    Dieselbe Ueberlegung wie bei `write_image`: Der Zweig gehoert HIERHER und
    nicht in die Oberflaechen — sonst muss jede fuer sich daran denken.
    """
    if os.name == "nt":
        try:
            import geraete
        except ImportError:                               # pragma: no cover
            return None
        if dry_run:
            (on_line or (lambda s: None))("TROCKENLAUF — Boot-Partition bliebe unberuehrt")
            return None
        return geraete.boot_mounten(device, melden=on_line)
    say = on_line or (lambda s: None)
    part = device + ("p1" if re.search(r"\d$", device) else "1")
    if dry_run:
        print(f"  TROCKENLAUF — würde {part} mounten")
        return None
    # udisksctl zuerst: läuft im Benutzerkontext, braucht also gar kein Root —
    # in einer Desktop-Sitzung ist das der reibungslose Weg, und die Partition
    # gehört danach dem Anwender (sonst könnte prepare_boot nichts schreiben).
    # Mehrere Anläufe, weil udev nach dem Schreiben einen Moment braucht, bis
    # die frische Partition da ist.
    if shutil.which("udisksctl"):
        letzte = ""
        for versuch in range(10):
            if not os.path.exists(part):
                time.sleep(1.0)
                continue
            r = subprocess.run(["udisksctl", "mount", "-b", part], capture_output=True, text=True)
            m = re.search(r"at (\S+)\.?$", (r.stdout or "").strip())
            if m:
                return m.group(1).rstrip(".")
            letzte = (r.stderr or "").strip()
            if "AlreadyMounted" in letzte or "already mounted" in letzte.lower():
                m2 = re.search(r"at [`']?(/\S+?)[`']?\.?$", letzte)
                if m2:
                    return m2.group(1)
            time.sleep(1.0)
        if letzte:
            say(f"udisksctl: {letzte}")
    mp = tempfile.mkdtemp(prefix="sdboot-")
    sudo, umgebung, hinweis = root_helper(interactive)
    if sudo is None:
        say(hinweis)
        return None
    say("Einhängen braucht noch einmal Rechte (udisksctl kam nicht durch).")
    # uid/gid mitgeben: eine als root eingehängte FAT-Partition wäre für den
    # Anwender nicht beschreibbar, und genau das kommt als Nächstes.
    _u = dict(os.environ, **umgebung) if umgebung else None
    r = subprocess.run(sudo + ["mount", "-o", f"uid={os.getuid()},gid={os.getgid()}", part, mp],
                       capture_output=True, text=True, env=_u)
    if r.returncode != 0:                      # ältere mount-Fassungen mögen die Optionen nicht
        r = subprocess.run(sudo + ["mount", part, mp], capture_output=True, text=True, env=_u)
    if r.returncode == 0:
        return mp
    if (r.stderr or "").strip():
        say(f"mount: {r.stderr.strip()}")
    return None


# WO LIEGT DER FORK? Das steht jetzt in core.py — gemeinsam mit `repo_root()`,
# an dem es haengt, und weil NICHT NUR die Kartenwerkzeuge es brauchen: seit dem
# 23.09.2026 loest auch `expand_path()` `${MUPI_REPO:-…}` darueber auf, damit ein
# ferngesteuerter Lauf dieselbe Antwort bekommt wie eine geschriebene Karte.
# Die Namen bleiben hier erreichbar (`sdprep.fork_wurzel`), damit kein Aufrufer
# und kein Test umziehen muss.
from core import FORK_MERKMALE, fork_wurzel, ist_fork  # noqa: E402,F401

def prepare_boot(boot_dir, *, password, hostname="DietPi", wifi=None, ssh_pubkey="",
                 agent_port=8099, keyboard="de", timezone="Europe/Berlin", bake_agent=False,
                 debug_display=False, diagnose=False, panel="vc4-kms-dsi-7inch",
                 handy=False, lauf_paket=False, fork=None, bildname="",
                 sofort_starten=False):
    """Die eigentliche Vorbereitung auf der gemounteten Boot-Partition:
    dietpi.txt patchen, WLAN eintragen, Agent + Auto-Install-Skript ablegen.
    Gibt zurück, was geschrieben wurde (für die Ausgabe/Tests).

    `handy=True` legt zusätzlich den Einrichtungsweg ohne Laptop an. Das ZIEHT
    `bake_agent` NACH SICH, und zwar zwingend: der Agent ist das Einzige, mit
    dem das Telefon reden kann. Ihn wie sonst per `./connect --install`
    nachzuschieben ginge nur vom Laptop aus — also genau von dem Gerät, das man
    hier nicht braucht.
    """
    if handy:
        bake_agent = True
    # Ein Installationspaket ohne den Handy-Weg waere ein Lauf, den niemand
    # starten kann: der Knopf dafuer sitzt im Assistenten.
    if lauf_paket:
        handy = bake_agent = True
    written = []
    dtxt = os.path.join(boot_dir, "dietpi.txt")
    cfg = dietpi_cfg(password, hostname=hostname, wifi=bool(wifi),
                     keyboard=keyboard, timezone=timezone,
                     country=(wifi or {}).get("country", "DE"))
    old = ""
    if os.path.isfile(dtxt):
        with open(dtxt, encoding="utf-8", errors="replace") as f:
            old = f.read()
    with open(dtxt, "w", encoding="utf-8") as f:
        f.write(patch_dietpi_txt(old, cfg))
    written.append("dietpi.txt")

    if wifi:
        wtxt = os.path.join(boot_dir, "dietpi-wifi.txt")
        alt = ""
        if os.path.isfile(wtxt):
            with open(wtxt, encoding="utf-8", errors="replace") as f:
                alt = f.read()
        neu = (patch_wifi_txt(alt, wifi["ssid"], wifi["key"]) if alt
               else wifi_file(wifi["ssid"], wifi["key"]))
        with open(wtxt, "w", encoding="utf-8") as f:
            f.write(neu)
        written.append("dietpi-wifi.txt")

    # Den Agent NICHT mitbacken (Standard): `./connect <box> --install` bringt ihn in
    # Sekunden per SSH hin — und zwar immer die AKTUELLE Fassung statt der, die beim
    # Schreiben der Karte zufaellig aktuell war. Auf der Karte muss dafuer nur stehen,
    # was ohnehin noetig ist: Netz + SSH + automatisches Setup.
    if bake_agent:
        dst = os.path.join(boot_dir, "step-agent")
        os.makedirs(dst, exist_ok=True)
        shutil.copy2(os.path.join(repo_root(), "agent", "agent.py"),
                     os.path.join(dst, "agent.py"))
        written.append("step-agent/agent.py")
        # Die Assistentenseite reist MIT dem Agenten — sie ist das, was das
        # Handy zu sehen bekommt. Ohne sie antwortet /einrichtung nur mit einer
        # Notiz, was fehlt.
        html = os.path.join(repo_root(), "agent", "einrichtung.html")
        if os.path.isfile(html):
            shutil.copy2(html, os.path.join(dst, "einrichtung.html"))
            written.append("step-agent/einrichtung.html")

        if handy:
            # Alles, was der Einrichtungsbildschirm braucht, FLACH in einen
            # Ordner: er laedt seine Nachbarn ueber den eigenen Verzeichnis-
            # pfad, nicht ueber Systempfade. Fehlt einer, faellt er still aus —
            # deshalb wird hier gezaehlt und nicht gehofft.
            edst = os.path.join(boot_dir, "einrichtung")
            os.makedirs(edst, exist_ok=True)
            teile = [
                ("tools", "einrichtung-schirm.py"),
                # Legt die Phase fest, BEVOR der Schirm startet — sonst
                # blitzt bei jedem Boot kurz der QR-Zustand auf.
                ("tools", "phase-vorab.sh"),
                ("tools", "einrichtung-ap.py"),
                ("tools", "kleiner-dhcp.py"),          # DHCP+DNS ohne dnsmasq
                ("tools", "qr.py"),
                ("tools", "mupibox-boot-splash.py"),   # Framebuffer + Farben + Schriften
                ("tools", "mixpibox-einrichtung.service"),
                ("tools", "mixpibox-einrichtung-ap.service"),
                ("tools", "mixpibox-selbstlauf.service"),
                ("dateien", "mixpi-hoert.png"),
            ]
            fehlt = []
            for ordner, datei in teile:
                q = os.path.join(repo_root(), ordner, datei)
                if os.path.isfile(q):
                    shutil.copy2(q, os.path.join(edst, datei))
                else:
                    fehlt.append(datei)
            if fehlt:
                written.append("einrichtung/ UNVOLLSTAENDIG: " + ", ".join(fehlt))
            else:
                written.append(f"einrichtung/ ({len(teile)} Teile, Schirm + eigenes WLAN)")

            # PYTHON MIT AUF DIE KARTE — ohne das traegt der Weg ohne Netz
            # nicht: das Image bringt keines mit, und alles von uns ist Python.
            # Der Stand kommt aus dem BILDNAMEN, nicht von diesem Rechner: die
            # Karte bekommt Trixie, der Laptop ist etwas anderes.
            try:
                import pythonpaket
                stand = pythonpaket.codename_aus_bild(bildname or "")
                arch = pythonpaket.arch_aus_bild(bildname or "")
                namen = pythonpaket.herunterladen(stand, edst, arch)
                written.append(f"Python fuer {stand}/{arch}: {len(namen)} Pakete "
                               f"(Start ohne Netz)")
            except Exception as e:                           # noqa: BLE001
                # KEIN Abbruch: ohne die Pakete fehlt nur der netzlose Start.
                # Mit Kabel oder WLAN auf der Karte laeuft alles wie bisher.
                written.append(f"Python NICHT mitgegeben ({e}) — erster Start "
                               f"braucht dann Kabel oder WLAN")

            # KEIN PreScript mehr. Der Haken `Automation_Custom_PreScript.sh`
            # existiert im echten DietPi-Abbild NICHT — nachgesehen in allen
            # dietpi-Skripten. Was dort landete, hat nie jemand aufgerufen.
            # Der Vorstart ist stattdessen ein systemd-Dienst auf der
            # ROOT-Partition; er wird von `root_bestuecken()` gelegt, und die
            # dafuer noetigen Dateien liegen im Unterordner `vorstart/`.
            vdst = os.path.join(edst, "vorstart")
            vnamen = vorstart_dateien_sammeln(vdst, agent_port=agent_port)
            # Die Python-Pakete braucht der Vorstart genauso — dort liegen sie
            # neben dem Skript, das sie setzt.
            for d in os.listdir(edst):
                if d.endswith(".deb"):
                    shutil.copy2(os.path.join(edst, d), os.path.join(vdst, d))
            written.append(f"vorstart/ ({len(vnamen)} Teile) — auf die "
                           f"Root-Partition, per root_bestuecken()")

            # Das Installationspaket: erst damit faehrt die Box OHNE Laptop.
            # Ohne es funktioniert alles andere weiter — dann fehlt eben nur
            # der Startknopf im Assistenten, und der Lauf geht wie bisher vom
            # Rechner aus.
            if lauf_paket:
                try:
                    import laufpaket
                    rezepte = [os.path.join(repo_root(), "recipes", r)
                               for r in ("mupibox.yaml", "mupibox-app.yaml")]
                    rezepte = [r for r in rezepte if os.path.isfile(r)]
                    fork_dir, woher = fork_wurzel(fork)
                    written.append(f"Fork fuer die Rezeptquellen: {fork_dir}  ({woher})")
                    n, dz, fehlend = laufpaket.paket_bauen(
                        os.path.join(edst, "lauf.tar.gz"), rezepte,
                        repo_root(), fork_dir)
                    groesse = os.path.getsize(os.path.join(edst, "lauf.tar.gz")) / 1e6
                    written.append(f"lauf.tar.gz ({n} Schritte, {dz} Dateien, "
                                   f"{groesse:.0f} MB) — Lauf ohne PC")
                    if fehlend:
                        written.append(f"  ACHTUNG: {len(fehlend)} Rezept-Quelle(n) fehlten "
                                       f"— diese Schritte laufen ins Leere")
                except Exception as e:                       # noqa: BLE001
                    written.append(f"lauf.tar.gz NICHT gebaut: {e}")

        sc = os.path.join(boot_dir, "Automation_Custom_Script.sh")
        with open(sc, "w", encoding="utf-8") as f:
            f.write(custom_script(agent_port=agent_port, ssh_pubkey=ssh_pubkey,
                                  handy=handy, sofort_starten=sofort_starten))
        os.chmod(sc, 0o755)
        written.append("Automation_Custom_Script.sh"
                       + (" (Agent im LAN — Handy-Weg)" if handy else ""))
    elif ssh_pubkey:
        # ohne Agent trotzdem den SSH-Schluessel hinterlegen -> `./connect` ohne Passwort
        sc = os.path.join(boot_dir, "Automation_Custom_Script.sh")
        with open(sc, "w", encoding="utf-8") as f:
            f.write(sshkey_script(ssh_pubkey))
        os.chmod(sc, 0o755)
        written.append("Automation_Custom_Script.sh (nur SSH-Schluessel)")

    # Anzeige zum MITSCHAUEN: nur auf Wunsch, denn im Normalbetrieb richtet der
    # Controller das Display ein. Zum Suchen eines Netzproblems ist es aber das
    # einzige Fenster in die Box, solange sie nicht ins Netz kommt.
    # DIE KONSOLE nur auf Wunsch — sie ist Fehlersuche, und ihr Text ist genau
    # das, was auf einer Kinderbox NICHT zu sehen sein soll.
    if debug_display:
        cl = os.path.join(boot_dir, "cmdline.txt")
        if os.path.isfile(cl):
            with open(cl, encoding="utf-8", errors="replace") as f:
                alt = f.read()
            with open(cl, "w", encoding="utf-8") as f:
                f.write(cmdline_debug(alt))
            written.append("cmdline.txt (Konsole sichtbar)")

    # DAS PANEL DAGEGEN GEHOERT ZUM HANDY-WEG, und zwar zwingend: der QR-Code
    # wird in den Framebuffer gemalt, und den gibt es ohne eingeschaltetes
    # DSI-Panel gar nicht. Sonst richtet erst der Controller das Display ein —
    # aber genau dorthin kommt man ja nicht, wenn die Box nicht ins Netz
    # findet. Am Geraet erlebt: Karte ohne diesen Haken geschrieben, Box
    # gestartet, kein QR — und der Betreiber suchte den Fehler bei sich.
    # Es ist KEINE Wahl, die man treffen kann; es ist eine Voraussetzung.
    if debug_display or handy:
        cf = os.path.join(boot_dir, "config.txt")
        alt = ""
        if os.path.isfile(cf):
            with open(cf, encoding="utf-8", errors="replace") as f:
                alt = f.read()
        neu = config_debug(alt, panel)
        if neu != alt:
            with open(cf, "w", encoding="utf-8") as f:
                f.write(neu)
            written.append("config.txt (DSI-Panel an — noetig fuer den QR)")
    # Selbstdiagnose: EIGENER Schalter, unabhaengig vom Bildschirm — man will
    # auch mal nur zuschauen (Bildschirm an, keine Schreiberei auf die Karte)
    # oder nur messen (Diagnose ohne angeschlossenes Panel).
    if diagnose:
        ps = os.path.join(boot_dir, "Automation_Custom_PreScript.sh")
        with open(ps, "w", encoding="utf-8") as f:
            f.write(diagnose_prescript())
        os.chmod(ps, 0o755)
        written.append("Automation_Custom_PreScript.sh (WLAN-Selbstdiagnose)")
    return written


DIAGNOSE_DATEI = "wifi-diagnose.txt"


def vorstart_skript(agent_port=8099, wartezeit=1200):
    """Das Skript, das der Vorstart-Dienst auf der Box ausfuehrt.

    WARUM ES NICHT MEHR `Automation_Custom_PreScript.sh` HEISST — und das ist
    der teuerste Umweg dieses Projekts: Es gibt diesen Haken nicht. Im echten
    DietPi-Abbild kommt der Name in KEINEM Skript vor; nachgesehen in
    dietpi-software, dietpi-login, dietpi-update und allen func/-Dateien.
    Zwei Anlaeufe scheiterten daran, dass eine Datei brav geschrieben wurde,
    die niemand je aufruft. (Dasselbe gilt fuer die aeltere
    WLAN-Selbstdiagnose — auch die lief nie.)

    WAS STATTDESSEN TRAEGT: ein eigener systemd-Dienst auf der ROOT-Partition.
    Systemd fragt DietPi nicht um Erlaubnis. DietPis eigene Reihenfolge zeigt
    die Luecke:

        dietpi-preboot.service    Before=network-pre.target
        dietpi-postboot.service   After=dietpi-preboot.service
        dietpi-login (auf tty1)   startet den First-Run-Setup  <- knallt ohne Netz

    Unser Dienst laeuft `After=dietpi-preboot` und `Before=dietpi-postboot`
    und `Before=getty@tty1` — also genau dazwischen.

    Pure: gibt nur Text zurueck.
    """
    return f"""#!/bin/bash
# Vom remote-step-installer erzeugt. Laeuft als systemd-Dienst VOR der Stelle,
# an der DietPi ohne Netz abbricht. Siehe sdprep.vorstart_skript().
set -u
# DAS PROTOKOLL GEHOERT AUF DIE BOOT-PARTITION, und das ist keine
# Bequemlichkeit: /var/log ist bei DietPi ein tmpfs (siehe fstab:
# "tmpfs /var/log tmpfs size=50M"). Alles dort liegt im RAM und ist nach dem
# Ausschalten WEG — ausgerechnet nach einem gescheiterten Start, wo man es
# braucht. Am 08.08.2026 genau so verloren gegangen.
# Die Boot-Partition ist FAT: sie ueberlebt, und man liest sie an jedem
# Rechner ohne root und ohne die Root-Partition einzuhaengen.
BOOTP=/boot; [ -d /boot/firmware ] && BOOTP=/boot/firmware
LOG="$BOOTP/mixpibox-vorstart.log"
# LOGGEN DARF NIE TOETEN. Ein `exec >>datei`, dessen Ziel nicht beschreibbar
# ist, beendet die Shell — und eine FAT-Partition, die nach hartem Ausschalten
# dreckig ist, haengt Linux beim ersten Schreibfehler auf NUR-LESEN um. Genau
# so starb ein kompletter Boot wortlos an dieser Zeile: kein Schirm, kein AP,
# kein Log, und /opt trug trotzdem den neuen Stand (die Kopie LIEST ja nur).
# Der Rueckfall /tmp verliert das Log beim Ausschalten — aber die Box LAEUFT.
if ! touch "$LOG" 2>/dev/null; then
  LOG=/tmp/mixpibox-vorstart.log
fi
exec >>"$LOG" 2>&1
echo "=== $(date -Is) Vorstart ==="

E=/opt/mixpibox-einrichtung
melde() {{ echo "$*"; echo "$*" > /dev/tty1 2>/dev/null; sync; }}

# ── SELBSTABGLEICH: die Boot-Partition ist die Quelle der Wahrheit ─────────
# WARUM: Jede Verbesserung musste bisher in ZWEI Schritten auf die Karte —
# auf die FAT-Partition (kann jeder Rechner) und per root auf die
# Root-Partition (braucht sudo und wurde DREIMAL vergessen oder brach ab;
# die Box lief dann mit der alten Fassung und scheiterte identisch).
# Deshalb: der Vorstart holt sich seine Dateien SELBST von der
# Boot-Partition, bei jedem Start. Der Rechner schreibt nur noch FAT.
Q="$BOOTP/einrichtung/vorstart"
if [ -d "$Q" ]; then
  # IMMER ALLES ABGLEICHEN — nicht nur, wenn sich vorstart.sh selbst aendert.
  # Die erste Fassung verglich NUR das Skript: wer bloss einen Nachbarn
  # erneuerte (Schirm, AP, Agent, Seite), liess die Box mit der alten Fassung
  # weiterlaufen. Am Geraet passiert: die Karte trug laengst das offene Netz,
  # die Box spannte weiter das alte mit Passwort auf — und am Handy wurde ein
  # Passwort verlangt, das es gar nicht mehr gab.
  # Das Kopieren von ~25 MB FAT kostet je Start etwa eine Sekunde. Ein Start
  # mit veralteten Teilen kostet einen ganzen Fehlersuchlauf.
  # OB SICH DER VORSTART SELBST ERNEUERT, MUSS VOR DEM KOPIEREN FESTSTEHEN.
  # Der Vergleich stand frueher DAHINTER — und verglich $0 mit der Datei, die
  # das `cp` gerade ueber $0 gelegt hatte, also mit sich selbst. `cmp` sagte
  # folglich immer "gleich", das `exec` feuerte NIE, und jede Behebung auf
  # der Karte wirkte erst einen Boot spaeter. Wer die Karte auffrischt und
  # sie zurueckschiebt, erwartet zu Recht, dass sie GLEICH gilt.
  NEUER=nein
  [ -f "$Q/vorstart.sh" ] && ! cmp -s "$Q/vorstart.sh" "$0" && NEUER=ja
  mkdir -p "$E"
  # Die laufende (funktionierende) Fassung beiseitelegen, bevor sie
  # ueberschrieben wird — eine abgerissene Kopie von der Karte darf die Box
  # nicht lahmlegen.
  SICHER=$(mktemp 2>/dev/null || echo /tmp/vorstart.sicher)
  cp "$0" "$SICHER" 2>/dev/null
  cp -a "$Q"/. "$E"/ 2>/dev/null
  chmod 755 "$E"/*.sh "$E"/*.py 2>/dev/null
  # AUCH DIE UNITS: bisher erneuerte der Abgleich nur /opt — die Unit-Dateien
  # unter /etc/systemd blieben stehen, und jede Unit-Aenderung brauchte einen
  # sudo-Nachtrag VOM PC. Das widerspricht dem Ziel "alles von der Karte".
  # systemd liest die Datei beim naechsten Boot ohnehin neu.
  for U in mixpibox-vorstart mixpibox-einrichtung mixpibox-einrichtung-ap mixpibox-selbstlauf; do
    if [ -f "$E/$U.service" ] && ! cmp -s "$E/$U.service" "/etc/systemd/system/$U.service" 2>/dev/null; then
      cp "$E/$U.service" "/etc/systemd/system/$U.service" && echo "Unit erneuert: $U"
    fi
  done
  systemctl daemon-reload 2>/dev/null || true
  if [ "$NEUER" = ja ]; then
    if bash -n "$E/vorstart.sh" 2>/dev/null; then
      echo "Neue Fassung des Vorstarts — uebernehme sie."
      rm -f "$SICHER" 2>/dev/null
      exec "$E/vorstart.sh"
    else
      echo "Neue Fassung ist KAPUTT (Syntax) — bleibe bei der alten."
      cp "$SICHER" "$E/vorstart.sh" 2>/dev/null
      chmod 755 "$E/vorstart.sh" 2>/dev/null
    fi
  fi
  rm -f "$SICHER" 2>/dev/null
fi
# EINE ADRESSE ZAEHLT NUR MIT TRAEGER DAHINTER. Am Geraet: eine Adresse aus
# DietPis interfaces-Vorlage stand auf der Schnittstelle, OHNE dass ein Kabel
# steckte — der Vorstart trat beiseite ("Netz vorhanden"), und DietPi lief in
# "ping: Network is unreachable". Eine Adresse ohne carrier=1 ist eine
# Behauptung, kein Netz. Die gefundene Schnittstelle wird GENANNT — beim
# naechsten Geist steht dann im Log, wer ihn gerufen hat.
# ── DER SCHIRM GEHOERT UEBER ALLES ──────────────────────────────────────────
# Der Betreiber: "man sieht nichts ausser beginn qr fuer wlan -> reboot screen
# info dietpi -> mixpibox vorbereitung -> spotify, jellyfin, profil -> start".
# Also darf DietPis Textwand nie durchschlagen. `phase` sagt dem Schirm, was
# gerade laeuft; `schirm_sicherstellen` startet ihn auch dann, wenn wir wegen
# vorhandenem Netz sonst gar nichts taeten.
phase() {{
  mkdir -p /run/mixpibox-einrichtung
  printf "%s\\n" "$1" > /run/mixpibox-einrichtung/phase
}}

# DIE PHASE GEHOERT VOR DEN SCHIRM.
# Die Phasendatei liegt in /run — nach JEDEM Neustart ist sie weg. Startet
# der Schirm, bevor ihm jemand gesagt hat, was laeuft, zeigt er seinen
# Grundzustand: die Einrichtungsseite mit QR-Code. Am Geraet als kurzes
# Aufblitzen zu sehen, bei jedem Boot aufs Neue ("es wird immer noch kurz der
# qr screen angezeigt ... und auch nach dem neustart"). Der Schirm hat dabei
# nichts falsch gemacht — ihm fehlte die Auskunft.
# Sie steht schon fest, bevor irgendetwas laeuft: die Stufendatei sagt, ob
# DietPi noch sein Grundsystem baut oder ob danach unser Lauf drankommt.
phase_vorab() {{
  PST=/boot/dietpi/.install_stage
  [ -f "$PST" ] || PST=/boot/firmware/dietpi/.install_stage
  PS=$(tr -dc "0-9-" < "$PST" 2>/dev/null)
  if [ "$PS" = "2" ]; then
    phase vorbereitung
  else
    phase grundsystem
  fi
}}

schirm_sicherstellen() {{
  # IST DIE BOX FERTIG, SCHWEIGT DIESER SCHIRM.
  # Der Vorstart laeuft bei JEDEM Boot. Ohne diese Zeile malte der
  # Einrichtungsschirm auch auf einer laengst fertigen Box weiter — in
  # denselben Bildspeicher wie MuPiBox' eigener Startbildschirm. Am Geraet
  # gesehen: "nach dem neustart rueckt der install boot screen durch den mupi
  # bootscreen". Zwei Zeichner auf /dev/fb0 ergeben genau das Durchrutschen.
  # Die Marke schreibt der Selbstlauf, wenn ALLE Schritte durch sind.
  [ -f /var/lib/mixpibox-lauf/fertig ] && return 0
  pgrep -f einrichtung-schirm.py >/dev/null 2>&1 && return 0
  [ -f "$E/einrichtung-schirm.py" ] || return 0
  # PYTHON HIER SELBST SUCHEN, NICHT $PY BORGEN. $PY wird erst weiter unten
  # gesetzt (nach dem Nachruesten der Pakete) — diese Funktion laeuft aber
  # frueher, naemlich im Zweig MIT Netz. Am 09.08.2026 stand deshalb im Log
  #   vorstart.sh: line 88: PY: unbound variable
  # und der Schirm kam auf dem ganzen Boot NICHT hoch: die Box zeigte DietPis
  # Textwand statt der MixPiBox. `${{PY:-...}}` ist auch unter `set -u` erlaubt.
  P=${{PY:-$(command -v python3 || command -v python3.13 || true)}}
  [ -n "$P" ] || return 0
  setsid "$P" "$E/einrichtung-schirm.py" --port {agent_port} \\
      --paircode /opt/step-agent/paircode >/dev/null 2>&1 &
  sleep 1
}}

hat_netz() {{
  for pfad in /sys/class/net/*; do
    n=$(basename "$pfad")
    [ "$n" = lo ] && continue
    [ "$(cat "$pfad/carrier" 2>/dev/null)" = "1" ] || continue
    if [ -n "$(ip -o -4 addr show dev "$n" scope global 2>/dev/null)" ]; then
      echo "$n"
      return 0
    fi
  done
  return 1
}}

# Kabel oder WLAN von der Karte? Dann ist hier nichts zu tun, und es darf auch
# nichts kosten — das ist der haeufigste Fall.
# LAENGER WARTEN, WENN SCHON EIN NETZ FESTGESCHRIEBEN IST: nach einer
# gelungenen Handy-Einrichtung kennt /etc/wpa_supplicant/wpa_supplicant.conf
# das Heimnetz, und ifupdown verbindet beim Start von selbst — nur eben erst
# nach 20 bis 40 Sekunden. Wer da schon den AP aufspannt, nimmt der Box die
# Verbindung weg, die gerade entsteht.
# ── SSH-Schluessel des Controllers hinterlegen ──────────────────────────────
# Damit ist die Box ab dem ERSTEN Start uebers Netz erreichbar — nicht erst,
# wenn DietPis Erstinstallation ihr Ende erreicht (die hing hier tagelang
# davor). Idempotent: vorhandene Zeile wird nicht verdoppelt.
if [ -f "$E/controller.pub" ]; then
  K=$(cat "$E/controller.pub")
  for u in root dietpi; do
    h=$(getent passwd "$u" | cut -d: -f6)
    [ -n "$h" ] || continue
    mkdir -p "$h/.ssh" && chmod 700 "$h/.ssh"
    grep -qF "$K" "$h/.ssh/authorized_keys" 2>/dev/null || echo "$K" >> "$h/.ssh/authorized_keys"
    chmod 600 "$h/.ssh/authorized_keys"; chown -R "$u" "$h/.ssh" 2>/dev/null
  done
  echo "Controller-Schluessel hinterlegt (root, dietpi)."
fi

# ── DietPi OHNE ANMELDUNG weiterfuehren ─────────────────────────────────────
# Schlug die Erstinstallation frueher fehl (kein Netz), verlangt DietPi beim
# naechsten Anlauf eine Anmeldung samt Bestaetigung auf tty1 — die Box hat
# aber nur einen Touchscreen, und selbst ein Neustart raeumt diesen Zustand
# NICHT ab (am Geraet zweimal belegt). Die Stufenmechanik ist zum Glueck
# schlicht (aus dietpi-login gelesen): 0 -> dietpi-update 1 -> Stufe 1 ->
# dietpi-software -> Stufe 2 = fertig. Beide sind mit
# AUTO_SETUP_AUTOMATED=1 anmeldungsfrei fahrbar. Am Ende von dietpi-software
# laeuft unser Automation_Custom_Script: Agent, Units, Selbstlauf — die Box
# baut sich danach SELBST zur MuPiBox.
# GEDULD FUER APT. Gemessen am 09.08.2026 im Log der Karte:
#   Fetched 674 kB in 4min 30s (2498 B/s)
# Das Netz war also DA und hat geladen — nur quaelend langsam. Einige Quellen
# kamen im selben Lauf durch (Get:6, Get:7), die meisten starben an
# "Temporary failure resolving". Das ist kein fehlendes DNS, sondern ein
# junger, wackliger Funk, dem apts kurze Standardfristen nicht gewachsen sind.
# Die Datei wirkt auch auf DietPis EIGENE apt-Aufrufe — deshalb hier und
# nicht als Schalter am Befehl.
apt_geduld() {{
  mkdir -p /etc/apt/apt.conf.d
  cat > /etc/apt/apt.conf.d/99mixpibox-geduld <<'GEDULD'
Acquire::Retries "6";
Acquire::http::Timeout "60";
Acquire::https::Timeout "60";
GEDULD

  # ══ WOHIN DIE ZEIT GEHT: LADEN ODER AUSPACKEN ═══════════════════════════
  #
  # Betreiber, 10.08.2026, nach dem ersten geglueckten Lauf: „kann man die
  # installation parallelisieren es ist schon sehr langsam auf dem pi" — und
  # spaeter, auf den Vorschlag zu trennen: „ja machen wir die trennung."
  #
  # Die Zeiten JE SCHRITT misst selbstlauf.py bereits (53 Schritte, 22
  # Minuten, davon 83 % in drei apt-Installationen). Was daraus NICHT
  # hervorgeht: ob die Minuten im Herunterladen stecken oder im Auspacken.
  # Genau daran haengt die Wahl des Werkzeugs — nala beschleunigt das Laden,
  # eatmydata das Auspacken, und wer das verwechselt, baut um und gewinnt
  # nichts.
  #
  # WARUM NICHT AUS /var/log/apt: DietPi raeumt seine Protokolle am Ende der
  # Einrichtung weg. Am 10.08.2026 an der frisch fertigen Box nachgesehen:
  # history.log und term.log waren 0 Byte, datiert auf die Minute, in der die
  # Installation fertig wurde. Was wir messen wollen, war da schon geloescht.
  #
  # ZWEI HAKEN VON apt SELBST, und sie erwischen JEDEN apt-Aufruf — auch die
  # von DietPi, nicht nur unsere. Zwischen `apt-start` und `dpkg-start` liegt
  # das Laden, zwischen `dpkg-start` und `dpkg-ende` das Auspacken.
  install -d -m 755 /var/lib/mixpibox-lauf
  cat > /etc/apt/apt.conf.d/99mixpibox-zeiten <<'ZEITEN'
APT::Update::Pre-Invoke {{"date +'%s apt-start update' >> /var/lib/mixpibox-lauf/apt-zeiten.log || true";}};
DPkg::Pre-Invoke  {{"date +'%s dpkg-start' >> /var/lib/mixpibox-lauf/apt-zeiten.log || true";}};
DPkg::Post-Invoke {{"date +'%s dpkg-ende'  >> /var/lib/mixpibox-lauf/apt-zeiten.log || true";}};
ZEITEN
}}

# ZWEI BEINE FUER DEN NAMENSDIENST. dhclient schrieb resolv.conf am
# 09.08.2026 erst um 21:17:44 — 18 Sekunden NACH unserem Start. Wer vorher
# fragt, fragt ins Leere. Und der Router allein antwortete im frischen Funk
# unzuverlaessig, deshalb kommt ein oeffentlicher Server als zweites Bein
# dazu (9.9.9.9 ist auch DietPis eigene Voreinstellung).
namensdienst_richten() {{
  for i in $(seq 1 30); do
    grep -q "^nameserver" /etc/resolv.conf 2>/dev/null && break
    sleep 2
  done
  grep -q "^nameserver 9.9.9.9" /etc/resolv.conf 2>/dev/null ||
    echo "nameserver 9.9.9.9" >> /etc/resolv.conf
  grep -q "^options " /etc/resolv.conf 2>/dev/null ||
    echo "options timeout:3 attempts:4" >> /etc/resolv.conf
}}

# DREI NAMEN PRUEFEN, NICHT EINEN. Genau die drei, an denen es scheiterte.
# Ein einzelnes getent kann zufaellig durchkommen, waehrend die Leitung fuer
# alles andere zu schwach ist — dann meldet der Vorstart "DNS ok" und faehrt
# in sein Verderben. Zwei von dreien muessen antworten.
dns_wirklich_da() {{
  # ══ EINER DER DREI IST NICHT VERHANDELBAR ═════════════════════════════
  #
  # Hier hiess es `[ "$n" -ge 2 ]` — zwei von dreien genuegten. Die
  # Begruendung darueber stimmt weiter (ein einzelnes getent kann zufaellig
  # durchkommen), aber sie hat GENAU DEN NAMEN durchgelassen, an dem alles
  # haengt.
  #
  # AM 10.08.2026 IM PROTOKOLL DER BOX GELESEN:
  #   curl: (6) Could not resolve host: raw.githubusercontent.com
  #   [FAILED] DietPi-Update | Unable to get latest version.
  # und DREI ZEILEN SPAETER holte derselbe Rechner 11,2 MB von
  # deb.debian.org, dietpi.com und archive.raspberrypi.com. Also: zwei von
  # drei loesten auf, die Pruefung sagte „DNS ok", der Vorstart gab frei —
  # und DietPis Erstlauf starb an dem dritten.
  #
  # DIETPI HOLT SEINE VERSIONSNUMMER VON GITHUB, und ein Fehlschlag dabei
  # reisst die GANZE Erstinstallation ab (blauer Kasten „Unknown install
  # state"). Der Name ist damit kein Mehrheitsentscheid, sondern eine
  # Bedingung. Wahrscheinlich hat er es besonders schwer, weil er KEINE
  # IPv6-Adresse hat und ein junger Funk gern zuerst ueber IPv6 fragt.
  #
  # Der Mehrheitsgedanke bleibt fuer den REST: mindestens eine der beiden
  # Paketquellen muss auch antworten, sonst ist die Leitung insgesamt zu
  # schwach und wir laufen ins naechste Verderben.
  getent hosts raw.githubusercontent.com >/dev/null 2>&1 || return 1
  n=0
  for h in deb.debian.org dietpi.com; do
    getent hosts "$h" >/dev/null 2>&1 && n=$((n+1))
  done
  [ "$n" -ge 1 ]
}}

# DIE PAKETLISTEN MUESSEN VOLLSTAENDIG SEIN, BEVOR dietpi-software LAEUFT.
# Am 09.08.2026 auf der Box nachgesehen: der erste Lauf holte im schwachen
# Funk nur security und backports, das Haupt-Repo scheiterte. Danach kannte
# apt `openssh-client` nicht mehr — "Package 'openssh-client' has no
# installation candidate" — und DietPi brach ab (Ausgang 130).
# Das Bittere daran: DietPi ueberspringt sein EIGENES apt-update eine Stunde
# lang (dietpi-globals, G_AGUP) und fragt dabei nur, WANN der letzte Aufruf
# war — nicht, ob er GELANG. Ein gescheiterter Lauf sperrt also die Behebung
# aus. Ohne diesen Schritt lief jeder Wiederholungsversuch in denselben
# Fehler, und die sechs Anlaeufe waren sechsmal dasselbe Nichts.
paketlisten_da() {{
  apt-cache policy openssh-client 2>/dev/null | grep -q "Candidate: [0-9]"
}}

paketlisten_holen() {{
  paketlisten_da && return 0
  for i in 1 2 3; do
    melde "Paketlisten sind unvollstaendig — hole sie neu (Versuch $i) ..."
    apt-get update >/dev/null 2>&1
    paketlisten_da && return 0
    sleep 15
  done
  return 1
}}

dietpi_weiterfuehren() {{
  ST=/boot/dietpi/.install_stage
  [ -f "$ST" ] || ST=/boot/firmware/dietpi/.install_stage
  [ -f "$ST" ] || {{ echo "Keine DietPi-Stufendatei — nichts weiterzufuehren."; return 0; }}
  S=$(tr -dc "0-9-" < "$ST" 2>/dev/null)
  [ "$S" = "2" ] && return 0
  melde "DietPi-Erstinstallation unvollstaendig (Stufe $S) — fuehre sie jetzt selbst weiter ..."
  # DEN AUTOMATIKSCHALTER ZURUECKSTELLEN — ohne ihn ist alles Weitere umsonst.
  # DietPi setzt AUTO_SETUP_AUTOMATED nach dem ERSTEN Automatiklauf auf 0,
  # damit er nicht erneut startet. Scheiterte dieser Lauf (bei uns: kein Netz),
  # steht der Schalter trotzdem auf 0 — und `dietpi-software` will ab da fuer
  # immer ins MENUE. Am Geraet gesehen: es wiederholte minutenlang
  #   "DietPi has not fully been installed ... - Install : Go >> Start"
  # und kam nie weiter. Mit G_INTERACTIVE=0 sieht man nicht einmal das Menue,
  # auf das es wartet.
  # ZWEI ORTE, und beide muessen stimmen: /boot/dietpi.txt liegt auf der
  # ROOT-Partition (die liest DietPi im Betrieb), /boot/firmware/dietpi.txt
  # ist die Karte (die liest der Erstboot).
  for DT in /boot/dietpi.txt /boot/firmware/dietpi.txt; do
    [ -f "$DT" ] || continue
    grep -q "^AUTO_SETUP_AUTOMATED=1" "$DT" || {{
      sed -i "s/^AUTO_SETUP_AUTOMATED=.*/AUTO_SETUP_AUTOMATED=1/" "$DT"
      echo "Automatikschalter in $DT auf 1 gesetzt."
    }}
  done
  export G_INTERACTIVE=0
  apt_geduld
  namensdienst_richten
  # BIS ES STEHT — NICHT BIS ES EINMAL SCHIEFGING.
  # Am 09.08.2026 lief alles davor zum ersten Mal sauber durch (Handy, WLAN,
  # Neustart), und dann gab dietpi-update auf, weil das frische WLAN zu
  # wacklig war. Der Vorstart sagte "fertig" und ging — die Box landete auf
  # DietPis Login-Maske. Genau das darf nicht passieren: ein schwaches Netz
  # ist ein NORMALER Zustand, kein Grund aufzuhoeren. Jeder weitere Versuch
  # wartet erst, damit sich der Funk faengt.
  for VERSUCH in 1 2 3 4 5 6; do
    S=$(tr -dc "0-9-" < "$ST" 2>/dev/null)
    [ "$S" = "2" ] && break
    if [ "$VERSUCH" -gt 1 ]; then
      melde "Netz war zu schwach — neuer Anlauf ($VERSUCH von 6) ..."
      sleep 30
      namensdienst_richten
    fi
    if ! dns_wirklich_da; then
      melde "Warte auf verlaessliche Namensaufloesung ..."
      sleep 20
    fi
    if [ "$S" = "0" ] || [ -z "$S" ]; then
      phase grundsystem
      melde "DietPi-Update laeuft (dauert einige Minuten) ..."
      /boot/dietpi/dietpi-update 1; echo "dietpi-update Ausgang: $?"
      S=$(tr -dc "0-9-" < "$ST" 2>/dev/null)
    fi
    if [ "$S" = "1" ]; then
      phase grundsystem
      # OHNE VOLLSTAENDIGE LISTEN BRAUCHT dietpi-software gar nicht erst zu
      # starten — es stirbt am ersten Paket, das apt nicht kennt.
      paketlisten_holen || melde "Paketlisten bleiben unvollstaendig — versuche es trotzdem."
      melde "DietPi-Software laeuft (10-20 Minuten, Geduld) ..."
      # ══ TERM SETZEN, SONST RECHNET DIETPI MIT NICHTS ═══════════════════
      #
      # Dieses Skript laeuft als systemd-Dienst — kein TTY, also kein $TERM.
      # DietPis dietpi-globals rechnet ungeprueft mit `$(tput cols)`:
      #   tput: No value for $TERM and no -T specified
      #   dietpi-globals: line 527: ((: <= 120 : syntax error (token "<= 120")
      # Danach laeuft dietpi-login in einer Endlosschleife.
      #
      # AM 10.08.2026 GESEHEN, und zwar an mir selbst: derselbe Aufruf ueber
      # `ssh box '/boot/dietpi/dietpi-login'` (auch ohne TTY) lief endlos, bis
      # der Betreiber abbrach. Was einem Menschen an der Tastatur passiert,
      # passiert diesem Dienst genauso — nur sieht es dort niemand.
      #
      # `linux` ist der Terminaltyp der Konsole, auf der die Box ohnehin
      # laeuft; er ist in ncurses-base enthalten und braucht nichts weiter.
      export TERM="${{TERM:-linux}}"
      /boot/dietpi/dietpi-software; echo "dietpi-software Ausgang: $?"
      S=$(tr -dc "0-9-" < "$ST" 2>/dev/null)
    fi
  done
  melde "DietPi-Stufe jetzt: $S"
  if [ "$S" = "2" ]; then
    # DER STARTSCHUSS FUER DEN SELBSTLAUF — ohne Handy, ohne PC. Die
    # ZUSTIMMUNG kam beim Kartenschreiben: der Haken "Lauf ohne PC" hat das
    # Paket ueberhaupt erst auf die Karte gelegt. Die Standdatei ist exakt
    # der Knopf, den sonst die Handy-Seite drueckt (installation_starten im
    # Agenten); die Selbstlauf-Unit laeuft bei jedem Boot und legt los,
    # sobald es sie gibt. Existiert schon eine, laeuft bereits etwas — dann
    # NICHT anfassen, sonst begaenne ein halber Lauf von vorn.
    if [ -f /opt/mixpibox-lauf/rezept.json ] && [ ! -f /var/lib/mixpibox-lauf/stand.json ]; then
      mkdir -p /var/lib/mixpibox-lauf
      printf '{{"fertig": [], "gescheitert": null}}\\n' > /var/lib/mixpibox-lauf/stand.json
      phase vorbereitung
      phase neustart
      melde "Grundsystem steht. Neustart - danach installiert sich die MuPiBox selbst."
    else
      phase neustart
      melde "Grundsystem steht. Neustart."
    fi
    sync
    sleep 3
    reboot
  fi
  # NICHT FERTIG — und das sagen wir dem Aufrufer auch. Er wartet dann und
  # ruft uns erneut, statt die Box der Login-Maske zu ueberlassen.
  return 1
}}

RUNDEN=20
grep -q "network=" /etc/wpa_supplicant/wpa_supplicant.conf 2>/dev/null && RUNDEN=45
for i in $(seq 1 "$RUNDEN"); do
  TRAEGER=$(hat_netz) && {{
    echo "Netz vorhanden ($TRAEGER, mit Traeger)."
    # Auch MIT Netz gehoert der Schirm hoch — sonst sieht man beim Bauen des
    # Grundsystems DietPis Textwand statt der Box.
    # ERST SAGEN, WAS LAEUFT — DANN ZEIGEN. Umgekehrt blitzt der QR-Schirm auf.
    phase_vorab
    schirm_sicherstellen
    # KEIN DURCHFALLEN ZUR LOGIN-MASKE. Kommt `dietpi_weiterfuehren` mit
    # einer 1 zurueck, steht das Grundsystem noch nicht. Frueher endete der
    # Vorstart hier trotzdem mit "fertig", getty uebernahm, und am Geraet
    # stand "MixPiBox login:" — mit nur einem Touchscreen eine Sackgasse
    # (09.08.2026 genau so gesehen). Stattdessen bleibt der Schirm stehen
    # und die Box versucht es weiter. Wird das Netz besser, richtet sie
    # sich VON SELBST fertig ein; niemand muss etwas tun.
    until dietpi_weiterfuehren; do
      phase netzschwach
      melde "Netz zu schwach — neuer Anlauf in zwei Minuten."
      sleep 120
      schirm_sicherstellen
    done
    echo "Vorstart fertig."
    exit 0
  }}
  sleep 1
done

melde "Kein Netz. MixPiBox-Einrichtung wird vorbereitet ..."

# --- 1) Python, ohne Netz -------------------------------------------------
# Auf dem DietPi-Abbild ist KEIN Python (nachgezaehlt: 1254 Dateien in
# /usr/bin, bash und perl dabei, python3 nicht). Alles Weitere haengt daran.
PY=$(command -v python3 || command -v python3.13 || true)
# TAUGT ES, ODER EXISTIERT ES NUR? Der Unterschied hat einen Lauf gekostet:
# python3.13-minimal war installiert, der Interpreter startete — aber die
# STANDARDBIBLIOTHEK fehlte ("No module named 'secrets'"), und Agent wie
# Einrichtungs-AP starben beim Import. Die blosse Existenz liess dpkg
# ueberspringen, und die stdlib-Pakete blieben liegen.
# `secrets` und `http.server` sind die Kanarienvoegel: braucht der Agent beide,
# und beide liegen in der stdlib, nicht im Minimalpaket.
tauglich() {{ [ -n "$PY" ] && "$PY" -c "import secrets, http.server" 2>/dev/null; }}
if ! tauglich; then
  if ls "$E"/*.deb >/dev/null 2>&1; then
    # ALLE ZUSAMMEN, und ZWEIMAL. Beides hat einen Grund:
    #   * zusammen, weil dpkg die Abhaengigkeiten sonst nicht aufloest;
    #   * zweimal, weil `python3-minimal` eine PRE-Depends auf
    #     `python3.13-minimal` hat — die muss beim Entpacken schon
    #     KONFIGURIERT sein. Die Shell sortiert `*.deb` nach Bytes, und
    #     "python3-" kommt vor "python3." (Bindestrich 45, Punkt 46), also
    #     genau falsch herum. Am Geraet gesehen:
    #       "python3.13-minimal is unpacked, but has never been configured"
    #     Beim zweiten Lauf ist es konfiguriert und der Wrapper geht durch.
    dpkg -i "$E"/*.deb 2>&1 || true
    dpkg -i "$E"/*.deb 2>&1 || true
    dpkg --configure -a 2>&1 || true
  else
    melde "FEHLT: Python-Pakete — ohne sie geht es nicht ohne Netz."
  fi
  PY=$(command -v python3 || command -v python3.13 || true)
fi
# NICHT AUF DEN NAMEN `python3` BESTEHEN: den Symlink legt erst der Wrapper.
# Ist der aus irgendeinem Grund nicht durchgekommen, taugt `python3.13`
# genauso — der Interpreter ist derselbe. Daran den ganzen Rueckfall
# scheitern zu lassen waere Kleinlichkeit an der falschen Stelle.
tauglich || {{ echo "Python da, aber ohne Standardbibliothek — Vorstart endet."; exit 0; }}
melde "Python: $PY"

# --- 2) Agent im LAN, damit ein Handy ihn erreicht ------------------------
if [ -f "$E/agent.py" ]; then
  install -d -m 700 /opt/step-agent
  install -m 700 "$E/agent.py" /opt/step-agent/agent.py
  [ -f "$E/einrichtung.html" ] && install -m 644 "$E/einrichtung.html" /opt/step-agent/einrichtung.html
  # Die Agent-Ausgabe GEHOERT INS PROTOKOLL: der WLAN-Wechsel laeuft im
  # Agenten, und mit >/dev/null war ein kompletter 20-Minuten-Lauf
  # hinterher nicht zu deuten - kein einziger Wechsel-Schritt stand irgendwo.
  setsid "$PY" /opt/step-agent/agent.py --host 0.0.0.0 --port {agent_port} \
      --paircode-file /opt/step-agent/paircode >>"$LOG" 2>&1 &
  # AUF DIE DATEI WARTEN, nicht auf die Uhr. Der Agent schreibt den Code erst,
  # wenn sein Socket steht; zwei Sekunden reichten am Geraet nicht, und dann
  # stand auf dem Schirm "Agent laeuft. Code:" — ohne Code. Wer das liest, hat
  # einen Assistenten vor sich, bei dem er sich nicht anmelden kann.
  for i in $(seq 1 30); do
    [ -s /opt/step-agent/paircode ] && break
    sleep 1
  done
  CODE=$(cat /opt/step-agent/paircode 2>/dev/null)
  if [ -n "$CODE" ]; then
    melde "Agent laeuft. Code: $CODE"
  else
    melde "Agent antwortet nicht — ohne ihn hilft das Handy nicht weiter."
  fi
fi

# --- 3) Schirm und eigenes WLAN ------------------------------------------
[ -f "$E/einrichtung-schirm.py" ] && \
  setsid "$PY" "$E/einrichtung-schirm.py" --port {agent_port} \
      --paircode /opt/step-agent/paircode >/dev/null 2>&1 &
[ -f "$E/einrichtung-ap.py" ] && \
  {{ "$PY" "$E/einrichtung-ap.py" starten || melde "Eigenes WLAN kam nicht hoch."; }}

# --- 4) Warten, bis jemand die Box ins Netz gebracht hat -----------------
# NICHT MIT hat_netz: der Zugangspunkt hat sich gerade selbst die Adresse
# 192.168.4.1 gegeben, und die zaehlte dort als "Netz da". Genau das hat den
# ersten erfolgreichen AP nach Sekunden wieder abgerissen — der Code war kurz
# auf dem Schirm, dann raeumte die eigene Warteschleife alles ab. Ein FREMDES
# Netz ist eine Adresse, die nicht die des Zugangspunkts ist (die Konstante
# kommt aus einrichtung-ap.py, ADRESSE).
hat_fremdnetz() {{
  for pfad in /sys/class/net/*; do
    n=$(basename "$pfad")
    [ "$n" = lo ] && continue
    [ "$(cat "$pfad/carrier" 2>/dev/null)" = "1" ] || continue
    if [ -n "$(ip -o -4 addr show dev "$n" scope global 2>/dev/null | grep -v ' 192[.]168[.]4[.]1/')" ]; then
      return 0
    fi
  done
  return 1
}}
melde "Warte auf ein Netz (bis {wartezeit // 60} min). Handy: QR-Code am Schirm."
ENDE=$(( $(date +%s) + {wartezeit} ))
while [ "$(date +%s)" -lt "$ENDE" ]; do
  if hat_fremdnetz; then
    melde "Netz da — die Einrichtung geht weiter."
    "$PY" "$E/einrichtung-ap.py" stoppen >/dev/null 2>&1
    sleep 3
    echo "=== Vorstart fertig, Netz vorhanden ==="
    exit 0
  fi
  sleep 5
done

# DECKEL: danach laeuft DietPi weiter und scheitert wie bisher. Schlechter als
# ohne uns wird es nie — aber die Box haengt auch nicht bis zum Stromausfall.
melde "Kein Netz nach {wartezeit // 60} min — es geht ohne weiter."
"$PY" "$E/einrichtung-ap.py" stoppen >/dev/null 2>&1
echo "=== Vorstart abgelaufen ==="
exit 0
"""


def diagnose_prescript():
    """Automation_Custom_PreScript.sh: WLAN-Selbstdiagnose der Box. Pure.

    DietPi fuehrt dieses Skript beim ERSTEN Boot aus, noch VOR dem Netz — es
    laeuft also auch dann, wenn das WLAN nie zustande kommt. Es richtet einen
    Dienst ein, der fuenf Minuten lang alle 15 s den Funkzustand einsammelt
    (Verbindungszustand, Laendercode, sichtbare Netze, Protokoll) und auf die
    BOOT-PARTITION zurueckschreibt. Karte danach in den Rechner stecken und
    wifi-diagnose.txt lesen: damit endet das Blindraten, bei dem jeder Fehler
    erst Minuten spaeter am Bildschirm der Box erschien.

    Der WLAN-SCHLUESSEL wird bewusst NICHT in die Datei uebernommen (nur SSID
    und Verfahren) — die Diagnose landet im Klartext auf einer FAT-Partition.
    """
    return """#!/bin/bash
# Vom remote-step-installer (Fehlersuche-Modus). Laeuft beim ersten Boot, vor
# dem Netz. Details im Werkzeug: controller/sdprep.py, diagnose_prescript().
cat > /usr/local/bin/wifi-diagnose.sh <<'DIAG'
#!/bin/bash
B=/boot; [ -f "$B/dietpi.txt" ] || B=/boot/firmware
OUT="$B/""" + DIAGNOSE_DATEI + """"
{
  echo "==== Diagnose gestartet: $(date)  Kernel $(uname -r) ===="
  echo "-- was die Box von der Karte gelesen hat (Schluessel bewusst NICHT dabei) --"
  grep -E "^aWIFI_(SSID|KEYMGR)\\[0\\]" "$B/dietpi-wifi.txt" 2>/dev/null
  grep -E "^AUTO_SETUP_NET_(WIFI|ETHERNET)" "$B/dietpi.txt" 2>/dev/null
} >> "$OUT"
for i in $(seq 1 20); do
  {
    echo "---- Runde $i  $(date +%T) ----"
    rfkill list 2>&1 | head -8
    iw reg get 2>&1 | head -4
    ip -4 addr 2>&1
    echo "-- Funkverbindung --"
    iw dev wlan0 link 2>&1
    wpa_cli -i wlan0 status 2>&1 | head -12
    echo "-- sichtbare Netze --"
    iw dev wlan0 scan dump 2>/dev/null | grep -E "^BSS|SSID:|signal:|freq:" | head -40
    echo "-- Protokoll (wpa/dhcp/Treiber) --"
    journalctl -b --no-pager 2>/dev/null | grep -iE "wpa_supplicant|brcmf|dhclient|dhcp|wlan0" | tail -30
  } >> "$OUT" 2>&1
  sync
  echo "WLAN-Diagnose Runde $i/20 -> $OUT" > /dev/tty1 2>/dev/null
  sleep 15
done
echo "==== Diagnose beendet: $(date) ====" >> "$OUT"; sync
DIAG
chmod 755 /usr/local/bin/wifi-diagnose.sh
cat > /etc/systemd/system/wifi-diagnose.service <<'UNIT'
[Unit]
Description=WLAN-Selbstdiagnose (remote-step-installer, Fehlersuche)
# BEWUSST keine Ordnung auf das Netzziel: dieses Skript laeuft im
# Erstboot-Dienst, also VOR dem Netz. Eine Netz-Ordnung plus ein wartender
# Start ergaben eine Verklemmung — der Schirm blieb bei "please wait" stehen,
# weil der Erstboot auf den Dienst wartete und der Dienst auf das Netz. Frueh
# zu messen ist ohnehin richtig: die ersten Runden zeigen den Funk-Anlauf.

[Service]
Type=simple
ExecStart=/usr/local/bin/wifi-diagnose.sh

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload 2>/dev/null || true
# enable OHNE --now (nur der Haken fuer kuenftige Boots), der Sofortstart
# separat und OHNE ZU WARTEN: systemd-run legt eine eigene Einheit an (lebt
# ausserhalb des Erstboot-Dienstes weiter), --no-block ist der Rueckfall.
systemctl enable wifi-diagnose 2>/dev/null || {
  mkdir -p /etc/systemd/system/multi-user.target.wants
  ln -sf ../wifi-diagnose.service /etc/systemd/system/multi-user.target.wants/wifi-diagnose.service
}
systemd-run --unit=wifi-diagnose-jetzt /usr/local/bin/wifi-diagnose.sh 2>/dev/null \
  || systemctl start --no-block wifi-diagnose 2>/dev/null || true
exit 0
"""


def verify_boot(boot_dir, *, wifi=None, debug_display=False, diagnose=False, hostname=None):
    """Nachlesen, was WIRKLICH auf der Karte steht -> [(ok, Text), …].

    Der Grund für diese Funktion ist bitter erarbeitet: mehrere Läufe scheiterten
    still, und der Fehler zeigte sich erst Minuten später beim Booten der Box —
    einmal eine WLAN-Datei mit erfundenen Variablennamen, einmal ein Panel-
    Overlay ohne den Treiber, den es voraussetzt. Beides hätte ein Blick auf die
    fertige Karte sofort verraten. Also schaut das Werkzeug jetzt selbst hin,
    statt zu hoffen.

    Pure genug zum Testen: es liest nur Dateien aus einem Verzeichnis.
    """
    pruef = []

    def lies(name):
        p = os.path.join(boot_dir, name)
        if not os.path.isfile(p):
            return None
        with open(p, encoding="utf-8", errors="replace") as f:
            return f.read()

    dt = lies("dietpi.txt")
    if dt is None:
        pruef.append((False, "dietpi.txt fehlt"))
    else:
        pruef.append(("AUTO_SETUP_AUTOMATED=1" in dt, "Automatischer Erstlauf eingeschaltet"))
        if hostname:
            pruef.append((f"AUTO_SETUP_NET_HOSTNAME={hostname}" in dt, f"Name der Box: {hostname}"))
        pruef.append(("AUTO_SETUP_SSH_SERVER_INDEX=-2" in dt, "SSH-Server (OpenSSH) vorgesehen"))

    if wifi:
        w = lies("dietpi-wifi.txt")
        if w is None:
            pruef.append((False, "dietpi-wifi.txt fehlt"))
        else:
            pruef.append((f"aWIFI_SSID[0]='{_wifi_esc(wifi['ssid'])}'" in w,
                          f"WLAN eingetragen: {wifi['ssid']}"))
            pruef.append((bool(re.search(r"^aWIFI_KEY\[0\]='.+'", w, re.M)),
                          "WLAN-Passwort gesetzt"))
            # Genau hier lag der Fehler, der die Box stumm bleiben liess.
            fehlend = [v for v in ("aWIFI_EAP[0]", "aWIFI_IDENTITY[0]", "aWIFI_PASSWORD[0]",
                                   "aWIFI_PHASE1[0]", "aWIFI_PHASE2[0]", "aWIFI_CERT[0]")
                       if v not in w]
            pruef.append((not fehlend,
                          "DietPis WLAN-Variablen vollständig"
                          + (f" (fehlt: {', '.join(fehlend)})" if fehlend else "")))
        if dt is not None:
            pruef.append((bool(re.search(r"^AUTO_SETUP_NET_WIFI_ENABLED=1", dt, re.M)),
                          "WLAN eingeschaltet"))
            m = re.search(r"^AUTO_SETUP_NET_WIFI_COUNTRY_CODE=(\S+)", dt, re.M)
            pruef.append((bool(m and m.group(1) not in ("", "GB")),
                          f"Ländercode: {m.group(1) if m else 'fehlt'}"))

    if debug_display:
        cl = lies("cmdline.txt") or ""
        pruef.append(("quiet" not in cl.split(), "Bootmeldungen sichtbar (kein 'quiet')"))
        pruef.append(("consoleblank=0" in cl, "Bildschirm schaltet nicht ab"))
        cf = lies("config.txt") or ""
        aktiv = {m.group(1) for m in re.finditer(r"^\s*dtoverlay=([A-Za-z0-9_.-]+)", cf, re.M)}
        # Das Panel-Overlay ALLEIN reicht nicht — es setzt den Treiber voraus.
        pruef.append(("vc4-kms-v3d" in aktiv, "Grafiktreiber vc4-kms-v3d aktiv"))
        pruef.append((any(x.startswith("vc4-kms-dsi") for x in aktiv), "DSI-Panel-Overlay aktiv"))
    if diagnose:
        ps = lies("Automation_Custom_PreScript.sh") or ""
        pruef.append(("wifi-diagnose" in ps, "WLAN-Selbstdiagnose eingerichtet"))

    return pruef


def deute_diagnose(text):
    """wifi-diagnose.txt der Box DEUTEN -> (befund, belege). Pure.

    Die Rohdatei ist lang; hier wird sie auf die eine Frage eingedampft:
    WO reisst die Kette Funk -> Anmeldung -> Adresse? Befunde:
      'kein-funk'      wlan0 fehlt/rfkill — Treiber- oder Hardwarefrage
      'netz-unsichtbar' die Ziel-SSID taucht in keinem Scan auf
      'anmeldung'      Netz sichtbar, aber nie COMPLETED — Schluessel/Filter
      'keine-adresse'  verbunden, aber DHCP bleibt unbeantwortet — Routerseite
      'ok'             IPv4 auf wlan0 vorhanden
      'leer'           Datei leer/nicht beschrieben — Diagnose lief nie
    """
    t = text or ""
    if not t.strip():
        return "leer", ["Datei ist leer — die Selbstdiagnose ist nie gelaufen"]
    belege = []
    m = re.search(r"^aWIFI_SSID\[0\]='(.*)'", t, re.M)
    ssid = m.group(1) if m else ""
    if ssid:
        belege.append(f"Ziel-Netz laut Karte: {ssid}")

    # `ip -4 addr` listet die Adresse in der FOLGEZEILE unter der Schnittstelle
    # — ein einzeiliges Muster uebersieht sie. Also blockweise lesen.
    schnittstelle = ""
    for zeile in t.splitlines():
        m2 = re.match(r"^(\d+): ([A-Za-z0-9@._-]+)[:@]", zeile)
        if m2:
            schnittstelle = m2.group(2)
        elif "inet " in zeile and schnittstelle.startswith("wlan"):
            return "ok", belege + [f"{schnittstelle} hat eine IPv4-Adresse"]
    if "wlan0" not in t:
        return "kein-funk", belege + ["wlan0 taucht nirgends auf — Funkgeraet fehlt"]
    if re.search(r"Soft blocked: yes|Hard blocked: yes", t):
        return "kein-funk", belege + ["rfkill: Funk ist blockiert"]

    verbunden = ("wpa_state=COMPLETED" in t) or re.search(r"^Connected to ", t, re.M)
    if verbunden:
        belege.append("Funkverbindung kam zustande (COMPLETED)")
        if "DHCPOFFER" in t or "DHCPACK" in t:
            belege.append("DHCP-Antwort gesehen, aber keine Adresse gesetzt")
        else:
            belege.append("DHCPDISCOVER blieb unbeantwortet")
        return "keine-adresse", belege

    if ssid and re.search(r"SSID: " + re.escape(ssid), t):
        belege.append(f"'{ssid}' ist im Scan SICHTBAR")
        for grund in ("WRONG_KEY", "4WAY_HANDSHAKE", "auth", "denied", "CTRL-EVENT-ASSOC-REJECT"):
            if grund.lower() in t.lower():
                belege.append(f"Protokoll nennt: {grund}")
        return "anmeldung", belege
    if ssid:
        andere = len(set(re.findall(r"^\s*SSID: (.+)$", t, re.M)))
        belege.append(f"'{ssid}' in KEINEM Scan zu sehen ({andere} andere Netze schon)")
        return "netz-unsichtbar", belege
    return "anmeldung", belege + ["keine SSID aus der Karte gelesen — dietpi-wifi.txt pruefen"]


KEY_PATH = os.path.expanduser("~/.ssh/id_ed25519")


def ensure_local_key():
    """→ (pubkey_text, neu_erzeugt). EINZIGE Stelle, die einen SSH-Schlüssel
    anlegt — connect.py greift hierauf zurück, damit es nicht zwei Fassungen
    gibt, die auseinanderlaufen. ed25519 ohne Passphrase: er dient allein dem
    Zugang zur Box, und eine Passphrase würde die automatische Wiederverbindung
    (`--watch` nach einem Neustart) wieder von einer Eingabe abhängig machen."""
    have = default_pubkey()
    if have:
        return have, False
    try:
        os.makedirs(os.path.dirname(KEY_PATH), mode=0o700, exist_ok=True)
        r = subprocess.run(["ssh-keygen", "-t", "ed25519", "-N", "", "-f", KEY_PATH,
                            "-C", "remote-step-installer"], capture_output=True, text=True)
    except OSError:
        return "", False
    if r.returncode != 0:
        return "", False
    return default_pubkey(), True


def default_pubkey(create=False):
    """Öffentlichen SSH-Schlüssel des Nutzers finden (für passwortloses Login).
    Mit create=True wird bei Bedarf einer erzeugt."""
    for n in ("id_ed25519.pub", "id_rsa.pub", "id_ecdsa.pub"):
        p = os.path.expanduser(f"~/.ssh/{n}")
        if os.path.isfile(p):
            try:
                return open(p).read().strip()
            except OSError:
                pass
    return ensure_local_key()[0] if create else ""


def human(n):
    for u in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or u == "TB":
            return f"{n:.0f} {u}" if u == "B" else f"{n:.1f} {u}"
        n /= 1024.0


# ══ CLI ═════════════════════════════════════════════════════════════════════
def cmd_list_images(board=None, codename=None, all_variants=False):
    ents = fetch_index()
    if not board:
        print("Boards (Auswahl der bekannten):")
        for b in boards(ents):
            hint = BOARD_HINT.get(b)
            if hint:
                print(f"  {b:<12} {hint}")
        print(f"\n  … insgesamt {len(boards(ents))} Boards, {len(ents)} Images.")
        print("  z.B.:  --list-images RPi5")
        return
    sel = select(ents, board, codename, plain_only=not all_variants)
    if not sel:
        print(f"nichts gefunden für '{board}'" + (f" / {codename}" if codename else ""))
        return
    print(f"Images für {board}" + (f" ({BOARD_HINT[board]})" if board in BOARD_HINT else "") + ":")
    for e in sel:
        star = "  ←  DietPi-Standard" if e["codename"] == "Trixie" else ""
        print(f"  {e['codename']:<9} {e['arch']:<7} {e['file']}{star}")


def cmd_list_devices():
    ok, blocked = safe_devices(list_block_devices())
    if not ok and not blocked:
        print("Keine Blockgeräte gefunden (läuft lsblk?).")
        return
    print("Wechseldatenträger (beschreibbar):")
    for d in ok or []:
        mp = f"  gemountet: {', '.join(d['mounts'])}" if d["mounts"] else ""
        print(f"  {d['path']:<12} {d['size']:>8}  {d['model'] or '—':<22} {d['tran'] or '?':<5}{mp}")
    if not ok:
        print("  (keine — SD-Karte eingesteckt?)")
    if blocked:
        print("\nAusgeschlossen:")
        for d in blocked:
            mp = f"  [{', '.join(d['mounts'])}]" if d["mounts"] else ""
            print(f"  {d['path']:<14} {d['size']:>8}  {d['model'] or '—':<26} {d['reason']}{mp}")


def cmd_diagnose(pfad=None):
    """wifi-diagnose.txt der Box finden, deuten und den Befund aussprechen."""
    kandidaten = [pfad] if pfad else []
    if not kandidaten:
        # Die Karte steckt im Leser: eingehaengte Boot-Partitionen absuchen.
        for wurzel in ("/run/media", "/media", "/mnt"):
            if os.path.isdir(wurzel):
                for a, _dirs, dateien in os.walk(wurzel):
                    if DIAGNOSE_DATEI in dateien:
                        kandidaten.append(os.path.join(a, DIAGNOSE_DATEI))
                    if a.count(os.sep) - wurzel.count(os.sep) > 3:
                        _dirs.clear()
    if not kandidaten:
        print(f"Keine {DIAGNOSE_DATEI} gefunden — Karte eingehängt? "
              f"(sonst: --diagnose /pfad/zur/{DIAGNOSE_DATEI})")
        return 2
    with open(kandidaten[0], encoding="utf-8", errors="replace") as f:
        text = f.read()
    befund, belege = deute_diagnose(text)
    KLARTEXT = {
        "ok": "Die Box HAT eine IPv4-Adresse bekommen — das Netz stand.",
        "leer": "Die Diagnose ist nie gelaufen (Datei leer) — Box überhaupt gebootet?",
        "kein-funk": "Das Funkgerät selbst fehlt oder ist blockiert — Treiber-/Hardwarefrage.",
        "netz-unsichtbar": "Die Box SIEHT das gewählte Netz nicht — Band (nur 5 GHz?), "
                           "Reichweite oder verstecktes Netz.",
        "anmeldung": "Das Netz ist sichtbar, aber die Anmeldung kommt nie zustande — "
                     "Schlüssel oder ein Filter am Router (MAC-Filter).",
        "keine-adresse": "Funkverbindung steht, aber der Router vergibt keine Adresse — "
                         "Routerseite (DHCP, Gastnetz-Isolation, Adresspool).",
    }
    print(f"Datei: {kandidaten[0]}")
    print(f"BEFUND: {befund} — {KLARTEXT.get(befund, '')}")
    for b in belege:
        print(f"  · {b}")
    return 0 if befund == "ok" else 1


def main():
    ap = argparse.ArgumentParser(description="SD-Karte für ein nacktes DietPi + Agent vorbereiten")
    ap.add_argument("--list-images", nargs="?", const="", metavar="BOARD")
    ap.add_argument("--list-devices", action="store_true")
    ap.add_argument("--codename", help="Trixie (Standard) | Bookworm | Forky")
    ap.add_argument("--all-variants", action="store_true", help="auch AlloGUI/Amiberry zeigen")
    ap.add_argument("--diagnose", nargs="?", const="", metavar="DATEI",
                    help="wifi-diagnose.txt der Box deuten (Karte wieder im Leser)")
    a = ap.parse_args()

    if a.list_devices:
        return cmd_list_devices()
    if a.list_images is not None:
        return cmd_list_images(a.list_images or None, a.codename, a.all_variants)
    if a.diagnose is not None:
        return cmd_diagnose(a.diagnose or None)
    print("Geführter Ablauf: siehe ./sdprep (Assistent).  Übersicht: --list-images / --list-devices")


if __name__ == "__main__":
    sys.exit(main())


# ══ Die ROOT-Partition bestuecken (der Vorstart-Dienst) ═════════════════════
def root_bestuecken(geraet, quell_ordner, interactive=True, on_line=None):
    """Den Vorstart-Dienst auf die Root-Partition der Karte legen.

    WARUM ES DIE BOOT-PARTITION NICHT TUT: Dort liegen nur Dateien, die DietPi
    von sich aus liest — und einen Haken VOR dem Netz gibt es dort nicht.
    `Automation_Custom_PreScript.sh` existiert im echten Abbild nirgends;
    zwei Anlaeufe sind daran gescheitert, dass eine Datei geschrieben wurde,
    die niemand aufruft. Ein systemd-Dienst auf der Root-Partition dagegen
    laeuft, weil systemd ihn kennt — ohne DietPi zu fragen.

    ALLES IN EINEM ROOT-AUFRUF, aus demselben Grund wie beim Schreiben des
    Abbilds: jede weitere Rechte-Anfrage waere eine weitere Passwortabfrage,
    und `pkexec` merkt sich nichts. Mounten, kopieren, Rechte setzen,
    einschalten, aushaengen — ein Skript.

    DER SYMLINK IST DAS EINSCHALTEN. `systemctl enable` geht auf einer fremden
    Wurzel nicht; was es tut, ist aber genau ein Symlink in
    multi-user.target.wants/ — und den kann man von hier aus legen.
    """
    sag = on_line or (lambda s: None)
    teil = geraet + ("p2" if re.search(r"\d$", geraet) else "2")
    if not os.path.exists(teil):
        sag(f"Root-Partition {teil} nicht da — Karte neu einstecken.")
        return False

    praefix, umgebung, hinweis = root_helper(interactive)
    if praefix is None:
        sag(hinweis or "Keine Rechte fuer die Root-Partition.")
        return False

    skript = f"""#!/bin/bash
set -e
M=$(mktemp -d)
mount {shlex.quote(teil)} "$M"
trap 'umount "$M" 2>/dev/null; rmdir "$M" 2>/dev/null' EXIT

install -d -m 755 "$M/opt/mixpibox-einrichtung"
cp -a {shlex.quote(quell_ordner)}/. "$M/opt/mixpibox-einrichtung/"
chown -R 0:0 "$M/opt/mixpibox-einrichtung"
chmod 755 "$M/opt/mixpibox-einrichtung"/*.py "$M/opt/mixpibox-einrichtung"/*.sh 2>/dev/null || true

# Die Unit an ihren Platz und einschalten — der Symlink IST das Einschalten.
if [ -f "$M/opt/mixpibox-einrichtung/mixpibox-vorstart.service" ]; then
  install -m 644 "$M/opt/mixpibox-einrichtung/mixpibox-vorstart.service" \\
      "$M/etc/systemd/system/mixpibox-vorstart.service"
  install -d -m 755 "$M/etc/systemd/system/multi-user.target.wants"
  ln -sf ../mixpibox-vorstart.service \\
      "$M/etc/systemd/system/multi-user.target.wants/mixpibox-vorstart.service"
fi
sync
echo "ROOT-BESTUECKT"
"""
    try:
        r = subprocess.run(praefix + ["bash", "-c", skript],
                           capture_output=True, text=True, timeout=300,
                           env={**os.environ, **umgebung})
    except (OSError, subprocess.SubprocessError) as e:
        sag(f"Root-Partition nicht bestueckbar: {e}")
        return False
    if "ROOT-BESTUECKT" not in (r.stdout or ""):
        sag((r.stderr or r.stdout or "ohne Meldung").strip()[:300])
        return False
    sag("  Vorstart-Dienst auf der Root-Partition eingerichtet und eingeschaltet.")
    return True


def vorstart_dateien_sammeln(ziel_ordner, agent_port=8099):
    """Alles zusammentragen, was der Vorstart-Dienst braucht -> Liste der Namen.

    Ein eigener Ordner, weil auf die Root-Partition ANDERES gehoert als auf
    die Boot-Partition: dort das, was DietPi liest, hier das, was unser Dienst
    ausfuehrt. Wer beides mischt, kopiert 18 MB Laufpaket zweimal.
    """
    os.makedirs(ziel_ordner, exist_ok=True)
    namen = []
    teile = [
        ("tools", "einrichtung-schirm.py"),
        # Legt die Phase fest, BEVOR der Schirm startet — sonst blitzt
        # bei jedem Boot kurz der QR-Zustand auf (siehe das Skript).
        ("tools", "phase-vorab.sh"),
        ("tools", "einrichtung-ap.py"),
        ("tools", "kleiner-dhcp.py"),
        ("tools", "qr.py"),
        ("tools", "mupibox-boot-splash.py"),
        ("tools", "mixpibox-vorstart.service"),
        ("dateien", "mixpi-hoert.png"),
        ("agent", "agent.py"),
        ("agent", "einrichtung.html"),
    ]
    for ordner, datei in teile:
        q = os.path.join(repo_root(), ordner, datei)
        if os.path.isfile(q):
            shutil.copy2(q, os.path.join(ziel_ordner, datei))
            namen.append(datei)
    # DER SCHLUESSEL DES CONTROLLERS: normalerweise hinterlegt ihn das Ende
    # der DietPi-Installation — genau die kam aber nie ans Ende, und ohne
    # Schluessel gibt es keinen Netzzugang zum Reparieren (Henne und Ei).
    # Der Vorstart installiert ihn selbst, beim ersten Start.
    pub = default_pubkey(create=True)
    if pub:
        with open(os.path.join(ziel_ordner, "controller.pub"), "w",
                  encoding="ascii") as f:
            f.write(pub.strip() + "\n")
        namen.append("controller.pub")
    vs = os.path.join(ziel_ordner, "vorstart.sh")
    with open(vs, "w", encoding="utf-8") as f:
        f.write(vorstart_skript(agent_port=agent_port))
    os.chmod(vs, 0o755)
    namen.append("vorstart.sh")
    return namen


def rechte_vorab_holen(interactive=False, on_line=None):
    """EINMAL nach dem Passwort fragen, ganz am Anfang. -> True/False.

    WARUM AM ANFANG UND NICHT MITTENDRIN: Ein Kartenlauf braucht die Rechte an
    ZWEI Stellen — beim Schreiben des Abbilds und beim Bestuecken der
    Root-Partition. Fragt man erst dort, wo sie gebraucht werden, kommt die
    zweite Abfrage nach zwanzig Minuten Warten, und dann sitzt niemand mehr
    davor. Am Geraet genau so passiert: die Karte war fertig, der Vorstart
    fehlte, und die Meldung darueber ging im Protokoll unter.

    `sudo -v` merkt sich die Freigabe (ueblich 15 Minuten) — danach laufen
    beide Schritte ohne weitere Frage durch.
    """
    sag = on_line or (lambda s: None)
    if ist_root():
        return True
    praefix, umgebung, hinweis = root_helper(interactive)
    if praefix is None:
        sag(hinweis)
        return False
    if hinweis:
        sag(hinweis)
    # `sudo -v` allein; pkexec kennt kein -v, dort tut es ein billiges `true`.
    befehl = (["sudo", "-A", "-v"] if "-A" in praefix
              else (["sudo", "-v"] if praefix and praefix[0] == "sudo"
                    else praefix + ["true"]))
    try:
        r = subprocess.run(befehl, capture_output=True, text=True, timeout=180,
                           env={**os.environ, **umgebung})
    except (OSError, subprocess.SubprocessError) as e:
        sag(f"Rechte nicht zu bekommen: {e}")
        return False
    if r.returncode != 0:
        sag((r.stderr or "Passwortabfrage abgebrochen.").strip()[:200])
        return False
    return True


def paketbuendel_ablegen(geraet, buendel, interactive=True, on_line=None):
    """Vorgeladene .deb-Pakete auf die Root-Partition legen.

    WOZU (31.08.2026): Betreiber — „das wlan im pi ist ja schnarch langsam".
    Der Installer laedt auf der Box rund 33 Pakete samt Abhaengigkeiten ueber
    genau dieses WLAN. Liegen sie schon in `/var/cache/apt/archives/`, nimmt
    apt sie von dort und laedt nichts nach.

    WARUM DORT UND NICHT AUF DER BOOT-PARTITION: `/var/cache/apt/archives/` ist
    der Ort, an dem apt VON SELBST nachsieht. Es braucht also weder einen
    Erstboot-Schritt, der etwas verschiebt, noch eine Marke, die jemand lesen
    muss — nichts kann dabei ausfallen, weil nichts laufen muss. Die
    128-MB-Bootpartition waere fuer ~500 MB ohnehin zu klein.

    LINUX ZUERST. Diese Funktion schreibt in ein ext4-Dateisystem und braucht
    dafuer root — unter Windows geht das nicht ohne Fremdtreiber. Der
    Windows-Weg braucht eine eigene FAT-Partition und kommt spaeter; bis dahin
    bleibt die Option dort einfach aus.

    ALLES IN EINEM ROOT-AUFRUF, aus demselben Grund wie in `root_bestuecken`:
    jede weitere Rechte-Anfrage waere eine weitere Passwortabfrage, und
    `pkexec` merkt sich nichts.

    Gibt (True, Anzahl) oder (False, Grund).
    """
    sag = on_line or (lambda s: None)
    if not buendel or not os.path.isfile(buendel):
        return False, f"Buendel {buendel} gibt es nicht"

    teil = geraet + ("p2" if re.search(r"\d$", geraet) else "2")
    if not os.path.exists(teil):
        return False, f"Root-Partition {teil} nicht da"

    praefix, umgebung, hinweis = root_helper(interactive)
    if praefix is None:
        return False, hinweis or "Keine Rechte fuer die Root-Partition."

    # `--keep-newer-files` NICHT: das Ziel ist auf einer frischen Karte leer,
    # und bei einem Wiederholungslauf sollen die Dateien des Buendels gelten.
    # `--no-same-owner` waere falsch — apt will root:root, deshalb chown.
    skript = f"""#!/bin/bash
set -e
M=$(mktemp -d)
mount {shlex.quote(teil)} "$M"
trap 'umount "$M" 2>/dev/null; rmdir "$M" 2>/dev/null' EXIT

install -d -m 755 "$M/var/cache/apt/archives"
tar xzf {shlex.quote(buendel)} -C "$M/var/cache/apt/archives"
chown -R 0:0 "$M/var/cache/apt/archives"
chmod 644 "$M/var/cache/apt/archives"/*.deb 2>/dev/null || true
ls -1 "$M/var/cache/apt/archives"/*.deb | wc -l
sync
"""
    with tempfile.NamedTemporaryFile("w", suffix=".sh", delete=False) as f:
        f.write(skript)
        pfad = f.name
    os.chmod(pfad, 0o755)
    try:
        e = subprocess.run(praefix + [pfad], capture_output=True, text=True,
                           timeout=900, env=umgebung)
        if e.returncode != 0:
            return False, (e.stderr or e.stdout or "unbekannt").strip()[-300:]
        zahl = 0
        for z in reversed(e.stdout.strip().splitlines()):
            if z.strip().isdigit():
                zahl = int(z.strip())
                break
        if zahl == 0:
            return False, "Es kam kein einziges .deb an."
        sag(f"{zahl} Pakete nach /var/cache/apt/archives/ gelegt")
        return True, zahl
    except subprocess.TimeoutExpired:
        return False, "Zeitueberschreitung beim Entpacken"
    finally:
        os.unlink(pfad)


def karte_fertig(boot_mp, geraet):
    """NACHLESEN statt hoffen: ist die Karte wirklich komplett? -> (ok, zeilen).

    Der teuerste Fehler dieses Projekts war eine Karte, die fertig AUSSAH: die
    Boot-Partition vollstaendig, die Root-Partition leer, und die Box startete
    trotzdem nicht ohne Netz. Wer nur meldet, was er geschrieben HAT, meldet
    nicht, was auf der Karte STEHT.
    """
    zeilen, ok = [], True

    def sag(gut, text):
        nonlocal ok
        ok = ok and gut
        zeilen.append((gut, text))

    sag(os.path.isfile(os.path.join(boot_mp, "dietpi.txt")), "dietpi.txt")
    handy = os.path.isdir(os.path.join(boot_mp, "einrichtung"))
    if not handy:
        return ok, zeilen                      # ohne Handy-Weg ist hier Schluss
    sag(True, "einrichtung/ (Handy-Weg)")
    vorstart = os.path.join(boot_mp, "einrichtung", "vorstart")
    sag(os.path.isdir(vorstart), "einrichtung/vorstart/ (Dateien fuer den Vorstart)")
    debs = [d for d in os.listdir(os.path.join(boot_mp, "einrichtung"))
            if d.endswith(".deb")] if handy else []
    sag(len(debs) >= 3, f"Python-Pakete ({len(debs)}/3) — ohne sie kein Start ohne Netz")

    # Und jetzt die Stelle, an der es wirklich haengt: die Root-Partition.
    teil = geraet + ("p2" if re.search(r"\d$", geraet) else "2")
    r = subprocess.run(["findmnt", "-n", "-o", "TARGET", teil],
                       capture_output=True, text=True)
    wurzel = (r.stdout or "").strip().splitlines()
    if not wurzel:
        # Nicht eingehaengt -> mit Rechten nachsehen, ohne zu mounten waere es
        # geraten. Ein einziger Aufruf, und nur lesend.
        pr, um, _ = root_helper(False)
        if pr is not None:
            skript = (f'M=$(mktemp -d); mount -o ro {shlex.quote(teil)} "$M" 2>/dev/null && '
                      f'{{ [ -L "$M/etc/systemd/system/multi-user.target.wants/'
                      f'mixpibox-vorstart.service" ] && echo AN; '
                      f'[ -f "$M/opt/mixpibox-einrichtung/vorstart.sh" ] && echo SKRIPT; '
                      f'umount "$M"; }}; rmdir "$M" 2>/dev/null')
            rr = subprocess.run(pr + ["bash", "-c", skript], capture_output=True,
                                text=True, env={**os.environ, **um}, timeout=120)
            aus = rr.stdout or ""
            sag("SKRIPT" in aus, "vorstart.sh auf der Root-Partition")
            sag("AN" in aus, "Vorstart-Dienst EINGESCHALTET")
            return ok, zeilen
        sag(False, "Root-Partition nicht pruefbar (keine Rechte)")
        return ok, zeilen

    w = wurzel[0]
    sag(os.path.isfile(os.path.join(w, "opt/mixpibox-einrichtung/vorstart.sh")),
        "vorstart.sh auf der Root-Partition")
    sag(os.path.islink(os.path.join(
        w, "etc/systemd/system/multi-user.target.wants/mixpibox-vorstart.service")),
        "Vorstart-Dienst EINGESCHALTET")
    return ok, zeilen
