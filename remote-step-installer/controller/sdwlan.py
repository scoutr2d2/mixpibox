#!/usr/bin/env python3
"""
WLAN einer BEREITS GEBOOTETEN MuPiBox-Karte umstellen — am Kartenleser.

WOFUER DAS *NICHT* IST
Eine frische, nie gebootete Karte richtet sdprep.py ein (dietpi-wifi.txt).
Sobald die Karte einmal gelaufen ist, ist jene Datei wirkungslos — und genau
darin liegt die Falle, die dieses Modul aufloest.

DREI DATEIEN, ZWEI ATTRAPPEN
Auf einer gebooteten Karte sehen drei Stellen nach der richtigen aus:

  /boot/firmware/dietpi-wifi.txt  FAT, frei beschreibbar — aber NUR beim
                                  allerersten Start ausgewertet. Attrappe.
  /boot/add_wifi.json             liest mupi_wifi.service bei JEDEM Start,
                                  steht aber auf dem Vorlagentext
                                  "Your Wifi-Name" und ist damit inaktiv;
                                  ausserdem root:root auf ext4. Attrappe.
  /etc/wpa_supplicant/…conf       das hier. root:root, 0600.

Ausgerechnet die einzige frei beschreibbare ist die wirkungslose. Ohne einen
privilegierten Schreibvorgang geht es also nicht — dafuer sdprep.root_helper().

WARUM DAS ALTE NETZ STEHEN BLEIBT
In /etc/network/interfaces ist eth0 auskommentiert (`#allow-hotplug eth0`) —
WLAN ist der EINZIGE Weg in die Box. Waere der neue Schluessel falsch, waere
sie unerreichbar und die Karte muesste wieder in den Leser. Zwei Netzbloecke
nebeneinander kosten nichts: wpa_supplicant nimmt, was da ist, und `priority`
laesst das neue gewinnen, solange beide sichtbar sind.

WARUM NUR DER HASH IN DIE DATEI GEHT
wpa_supplicant akzeptiert auch Klartext. Der Hash reicht zum Verbinden
vollstaendig, und die Box macht es in startup.sh selbst so (sie verwirft die
`#psk="…"`-Zeile von wpa_passphrase). Ein Klartext weniger auf einer Karte,
die jeder in einen Leser stecken kann.
"""
import argparse
import hashlib
import os
import re
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sdprep  # noqa: E402

WPA_PFAD = "etc/wpa_supplicant/wpa_supplicant.conf"
MARKER = "etc/mupibox"          # daran erkennen wir eine MuPiBox-Wurzel
# Nur eingehaengte Datentraeger. Der teuerste denkbare Fehler waere, die Datei
# des LAUFENDEN Rechners zu veraendern und ihn selbst aus dem Netz zu werfen.
ERLAUBTE_ORTE = ("/run/media/", "/media/", "/mnt/")


# ── reine Rechnung ────────────────────────────────────────────────────────

def psk_hash(ssid, passphrase):
    """WPA-PSK aus Passphrase + SSID -> 64 Hex-Zeichen. Pure.

    Das ist woertlich, was WPA-PSK ist: PBKDF2-HMAC-SHA1, 4096 Runden, 32 Byte
    (IEEE 802.11i, Anhang H.4). Die SSID ist das Salz — derselbe Schluessel
    ergibt in einem anders benannten Netz einen anderen PSK.

    Warum nicht einfach `wpa_passphrase` aufrufen: das Werkzeug will die
    Passphrase von einem TTY lesen und bricht ohne eines ab ("tcgetattr:
    Inappropriate ioctl for device"); als Argument stuende sie in der
    Prozessliste. Die Tests pruefen diese Rechnung gegen wpa_passphrase mit
    den IEEE-Testvektoren — falsch waere sie erst aufgefallen, wenn die Box
    stumm bleibt, und dann ist die Karte schon wieder verbaut.
    """
    return hashlib.pbkdf2_hmac("sha1", passphrase.encode("utf-8"),
                               ssid.encode("utf-8"), 4096, 32).hex()


def psk_aus(wert, ssid):
    """Wert aus dem Schluesselbund -> PSK. Pure.

    NetworkManager speichert je nach Netz die Passphrase ODER den fertigen
    64-stelligen PSK. Letzteren noch einmal zu hashen ergaebe stillen Unsinn.
    """
    w = (wert or "").strip()
    if re.fullmatch(r"[0-9a-fA-F]{64}", w):
        return w.lower()
    return psk_hash(ssid, w)


def netzblock(ssid, psk, priority=2):
    """Ein wpa_supplicant-Netzblock. Pure."""
    zeilen = ["network={", f'\tssid="{ssid}"', f"\tpsk={psk}"]
    if priority:
        zeilen.append(f"\tpriority={priority}")
    zeilen.append("}")
    return "\n".join(zeilen) + "\n"


def bekannte_netze(text):
    """Alle SSIDs einer wpa_supplicant.conf. Pure."""
    return re.findall(r'^\s*ssid="(.*)"\s*$', text or "", re.M)


def ergaenzen(text, ssid, psk, priority=2):
    """Netz anhaengen, falls es fehlt -> (neuer_text, geaendert). Pure.

    Bewusst anhaengen statt ersetzen (siehe Modulkopf), und bewusst
    idempotent: ein zweiter Lauf soll nicht denselben Block verdoppeln —
    doppelte Bloecke sind kein Fehler fuer wpa_supplicant, aber sie machen
    die Datei mit jedem Umzug unleserlicher.
    """
    if ssid in bekannte_netze(text):
        return text, False
    rumpf = text if text.endswith("\n") or not text else text + "\n"
    return rumpf + "\n" + netzblock(ssid, psk, priority), True


def maskiert(text):
    """Zum Anzeigen: Schluessel unkenntlich. Pure.

    Ein PSK-Hash ist zum Verbinden so gut wie das Passwort — er darf nicht in
    Protokolle, Bildschirmfotos oder Sitzungsmitschnitte geraten.
    """
    t = re.sub(r"(psk=)[0-9a-fA-F]{16,}", r"\1<hash>", text or "")
    return re.sub(r'(psk=)"[^"]*"', r'\1"<klartext>"', t)


def ist_kartenwurzel(pfad):
    """Sieht das nach einer eingehaengten MuPiBox-Karte aus? Halbrein."""
    p = os.path.abspath(pfad or "")
    if not any(p.startswith(o) for o in ERLAUBTE_ORTE):
        return False
    return os.path.isdir(os.path.join(p, MARKER))


# ── Karte finden ──────────────────────────────────────────────────────────

def karten_wurzeln():
    """Eingehaengte MuPiBox-Wurzeln -> Liste von Pfaden."""
    gefunden = []
    try:
        r = subprocess.run(["findmnt", "-rno", "TARGET"], capture_output=True,
                           text=True, timeout=10)
        ziele = (r.stdout or "").splitlines()
    except (OSError, subprocess.SubprocessError):
        ziele = []
    for z in ziele:
        z = z.strip()
        if z and ist_kartenwurzel(z) and z not in gefunden:
            gefunden.append(z)
    return gefunden


# ── schreiben ─────────────────────────────────────────────────────────────

def schreiben(wurzel, ssid, psk, priority=2, trocken=False, interactive=True,
              on_line=None):
    """Netz in die wpa_supplicant.conf der Karte eintragen -> Ergebnis-dict.

    Liest ebenfalls privilegiert: die Datei ist 0600 root, also kommt auch der
    IST-Zustand nur ueber den Helfer. sudo merkt sich die Freigabe einige
    Minuten, es fragt also hoechstens einmal.
    """
    say = on_line or (lambda s: None)
    if not ist_kartenwurzel(wurzel):
        return {"ok": False, "grund": f"'{wurzel}' ist keine eingehaengte MuPiBox-Karte"}
    ziel = os.path.join(wurzel, WPA_PFAD)
    if not os.path.exists(ziel):
        return {"ok": False, "grund": f"{ziel} fehlt"}

    sudo, umgebung, hinweis = sdprep.root_helper(interactive)
    if sudo is None:
        return {"ok": False, "grund": hinweis}
    if hinweis:
        say(hinweis)
    umg = dict(os.environ, **umgebung) if umgebung else None

    def als_root(*args):
        return subprocess.run(sudo + list(args), capture_output=True, text=True, env=umg)

    r = als_root("cat", ziel)
    if r.returncode != 0:
        return {"ok": False, "grund": (r.stderr or "").strip() or "Lesen fehlgeschlagen"}
    alt = r.stdout or ""

    neu, geaendert = ergaenzen(alt, ssid, psk, priority)
    if not geaendert:
        return {"ok": True, "geaendert": False, "netze": bekannte_netze(alt),
                "grund": f"'{ssid}' steht bereits in der Datei"}
    if trocken:
        return {"ok": True, "geaendert": False, "trocken": True,
                "netze": bekannte_netze(neu), "vorschau": maskiert(neu)}

    sicherung = ziel + time.strftime(".vor-%Y%m%d-%H%M%S")
    r = als_root("cp", "-a", ziel, sicherung)
    if r.returncode != 0:
        return {"ok": False, "grund": "Sicherung fehlgeschlagen: "
                                      + ((r.stderr or "").strip() or "?")}

    # Ueber eine Zwischendatei mit `install`: setzt Inhalt, Rechte und
    # Eigentuemer in EINEM Schritt. Ein `tee` liesse die Datei zwischendurch
    # mit Standardrechten liegen — bei einem Schluessel keine gute Idee.
    d = tempfile.mkdtemp(prefix="sdwlan-")
    tmp = os.path.join(d, "wpa_supplicant.conf")
    with open(tmp, "w") as f:
        f.write(neu)
    os.chmod(tmp, 0o600)
    try:
        r = als_root("install", "-m", "600", tmp, ziel)
        rc, fehler = r.returncode, (r.stderr or "").strip()
    finally:
        os.remove(tmp)
        os.rmdir(d)
    if rc != 0:
        return {"ok": False, "grund": fehler or "Schreiben fehlgeschlagen",
                "sicherung": os.path.basename(sicherung)}

    # Eigentuemer BEWUSST als eigener Schritt. Zusammen mit `install -o root`
    # sah ein Fehlschlag wie "nichts passiert" aus — dabei war der Inhalt
    # laengst geschrieben und nur das chown gescheitert. Eine Rueckmeldung, die
    # in diese Richtung luegt, ist schlimmer als gar keine.
    warnung = ""
    r = als_root("chown", "root:root", ziel)
    if r.returncode != 0:
        warnung = ("Inhalt geschrieben, aber Eigentuemer nicht auf root gesetzt: "
                   + ((r.stderr or "").strip() or "?"))
    als_root("sync")

    # Gegenprobe am ZUSTAND statt am Rueckgabewert — dieselbe Regel wie bei
    # bluetoothctl: erst was die Datei hinterher sagt, zaehlt.
    nach = als_root("cat", ziel)
    netze = bekannte_netze(nach.stdout or "") if nach.returncode == 0 else bekannte_netze(neu)
    if nach.returncode == 0 and ssid not in netze:
        return {"ok": False, "grund": f"'{ssid}' steht nach dem Schreiben nicht in der Datei",
                "sicherung": os.path.basename(sicherung), "netze": netze}

    return {"ok": True, "geaendert": True, "sicherung": os.path.basename(sicherung),
            "warnung": warnung, "netze": netze, "vorschau": maskiert(neu)}


# ── Aufruf von Hand ───────────────────────────────────────────────────────

def main(argv=None):
    p = argparse.ArgumentParser(
        description="WLAN einer bereits gebooteten MuPiBox-Karte umstellen.")
    p.add_argument("--ssid", default="", help="Zielnetz (Vorgabe: das aktive WLAN dieses Rechners)")
    p.add_argument("--karte", default="", help="Wurzel der Karte (Vorgabe: automatisch)")
    p.add_argument("--priority", type=int, default=2, help="Vorrang des neuen Netzes (0 = keiner)")
    p.add_argument("--trocken", action="store_true", help="nur zeigen, nichts schreiben")
    a = p.parse_args(argv)

    ssid = a.ssid or sdprep.wifi_active()
    if not ssid:
        print("Kein aktives WLAN gefunden — bitte --ssid angeben.")
        return 1

    wurzeln = [a.karte] if a.karte else karten_wurzeln()
    if not wurzeln:
        print("Keine eingehaengte MuPiBox-Karte gefunden.\n"
              "  udisksctl mount -b /dev/sdX2   (die ext4-Partition)")
        return 1
    if len(wurzeln) > 1:
        print("Mehrere Karten gefunden — bitte --karte angeben:")
        for w in wurzeln:
            print("  " + w)
        return 1

    schluessel = sdprep.wifi_secret(ssid)
    if not schluessel:
        print(f"Passwort fuer '{ssid}' nicht abrufbar (Schluesselbund gesperrt?).")
        return 1
    psk = psk_aus(schluessel, ssid)
    del schluessel

    erg = schreiben(wurzeln[0], ssid, psk, priority=a.priority,
                    trocken=a.trocken, on_line=print)
    if not erg.get("ok"):
        print("Fehlgeschlagen: " + erg.get("grund", "?"))
        return 1
    if erg.get("trocken"):
        print(f"TROCKENLAUF — wuerde '{ssid}' eintragen:\n")
        print(erg["vorschau"])
    elif not erg.get("geaendert"):
        print(erg.get("grund", "nichts zu tun"))
    else:
        print(f"'{ssid}' eingetragen. Sicherung: {erg['sicherung']}")
        if erg.get("warnung"):
            print("ACHTUNG: " + erg["warnung"])
    print("\nBekannte Netze auf der Karte:")
    for n in erg.get("netze", []):
        print("  - " + n)
    return 0


if __name__ == "__main__":
    sys.exit(main())
