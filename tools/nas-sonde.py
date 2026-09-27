#!/usr/bin/env python3
"""Was kann dieses NAS, und haelt sein Wegfall die Box an? (BACKLOG E28/N6-N9, E29/B4)

WARUM ES DAS GIBT
Am 05.08.2026 stand im Wissenspaket zu NAS/Samba/NFS nichts, auf der Box war
kein Netzlaufwerk eingehaengt, und in der fstab stand keine Zeile dafuer —
neues Land. E28/N6 sagt dazu den einen Satz, der zaehlt: „Pruefen, nicht
annehmen." Ein CIFS-Zugriff auf eine weggefallene Freigabe blockiert hart;
liegt er im Tonweg, friert die Wiedergabe ein. Das ist keine Meinung, das ist
eine MESSUNG — und diese Datei macht sie wiederholbar, statt sie einmal von
Hand zu tippen.

ES SCHREIBT NICHTS AUF DIE BOX UND NICHTS AUF DAS NAS, ausser bei --messen:
dort entsteht GENAU EINE Datei mit dem Namen `.nas-sonde-probe-<pid>` im
angegebenen Ordner, und sie wird im selben Lauf wieder entfernt (auch bei
Abbruch, ueber finally).

KEINE ZUGANGSDATEN IN DER BEFEHLSZEILE. `--freigaben` fragt das Passwort ueber
getpass ab oder nimmt es aus der Umgebungsvariablen NAS_PASSWORT; ein Passwort
in `ps` waere fuer jeden Nutzer der Box lesbar (dieselbe Regel wie in
mupibox-sicherung.py, Abschnitt „NIE AUS DER BEFEHLSZEILE").

AUFRUF
    python3 tools/nas-sonde.py --zustand
    python3 tools/nas-sonde.py --suchen [--netz 192.168.178.0/24]
    python3 tools/nas-sonde.py --freigaben 192.168.178.199 [--nutzer dietpi]
    python3 tools/nas-sonde.py --webdav https://nas/remote.php/dav/files/achim
    python3 tools/nas-sonde.py --messen /mnt/nas [--mb 8]
    python3 tools/nas-sonde.py --haengen /mnt/nas [--sekunden 60]

Ende 0 = gemessen, 1 = die Messung konnte nicht stattfinden (fehlendes
Werkzeug, Pfad weg). Ein SCHLECHTES Ergebnis ist kein Ende 1 — es steht im
Bericht. Wer den Rueckgabewert als Urteil liest, liest falsch.
"""

import argparse
import ipaddress
import os
import shutil
import socket
import subprocess
import sys
import time

# Die Ports, an denen eine Dateifreigabe horcht. Mehr aufzunehmen waere
# billig und falsch: ein Treffer auf einem beliebigen Port beweist nichts
# ueber den Dienst dahinter ([[box-ip-wechselt]]: „Ein Portscan-Treffer auf
# 8200 beweist nichts").
PORTE = {445: "SMB", 2049: "NFS", 139: "NetBIOS", 548: "AFP"}

FRIST = 0.4        # Sekunden je Verbindungsversuch beim Suchen
PROBE_NAME = ".nas-sonde-probe"


def sagen(text=""):
    print(text, flush=True)


def offen(host, port, frist=FRIST):
    """True, wenn sich eine TCP-Verbindung aufbauen laesst."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(frist)
    try:
        return s.connect_ex((host, port)) == 0
    except OSError:
        return False
    finally:
        s.close()


def eigenes_netz():
    """Das /24 der eigenen Adresse — ohne ein Paket dafuer zu brauchen."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 9))   # TEST-NET-1, es fliesst nichts
        eigen = s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()
    return f"{eigen.rsplit('.', 1)[0]}.0/24"


def zustand():
    """Was ist auf DIESER Maschine an Netzeinhaengungen da — und was waere es
    nach einem Neustart? Beides, denn das ist nicht dasselbe."""
    sagen("── EINGEHAENGT (findmnt) ───────────────────────────────")
    if shutil.which("findmnt"):
        aus = subprocess.run(
            ["findmnt", "-t", "cifs,nfs,nfs4,smb3", "-o", "TARGET,SOURCE,OPTIONS"],
            capture_output=True, text=True)
        sagen(aus.stdout.strip() or "  nichts — kein Netzlaufwerk eingehaengt")
    else:
        sagen("  findmnt fehlt")

    sagen()
    sagen("── IN DER FSTAB ────────────────────────────────────────")
    zeilen = []
    try:
        with open("/etc/fstab", encoding="utf-8") as f:
            for z in f:
                k = z.strip()
                if k and not k.startswith("#") and (" cifs " in z or " nfs" in z
                                                    or k.startswith("//")):
                    zeilen.append("  " + k)
    except OSError as e:
        zeilen.append(f"  /etc/fstab nicht lesbar: {e}")
    sagen("\n".join(zeilen) or "  keine Zeile fuer ein Netzlaufwerk")

    sagen()
    sagen("── SYSTEMD-EINHEITEN (.mount/.automount) ───────────────")
    if shutil.which("systemctl"):
        aus = subprocess.run(
            ["systemctl", "list-units", "--type=mount,automount", "--all",
             "--no-legend", "--no-pager"],
            capture_output=True, text=True)
        treffer = [z for z in aus.stdout.splitlines()
                   if any(w in z for w in ("cifs", "nfs", "nas", "media", "mnt"))]
        sagen("\n".join("  " + z.strip() for z in treffer)
              or "  keine, die nach einem Netzlaufwerk aussieht")
    else:
        sagen("  systemctl fehlt")

    sagen()
    sagen("── WERKZEUGE, DIE ES BRAUCHT ───────────────────────────")
    for name, wofuer in (("mount.cifs", "SMB einhaengen (Paket cifs-utils)"),
                         ("mount.davfs", "WebDAV einhaengen (Paket davfs2)"),
                         ("smbclient", "Freigaben auflisten (Paket smbclient)"),
                         ("mount.nfs", "NFS einhaengen (Paket nfs-common)"),
                         ("showmount", "NFS-Exporte auflisten (Paket nfs-common)")):
        wo = shutil.which(name) or shutil.which(name, path="/sbin:/usr/sbin")
        sagen(f"  {name:<12} {wo or 'FEHLT — ' + wofuer}")
    return 0


def suchen(netz):
    netz = netz or eigenes_netz()
    if not netz:
        sagen("kein eigenes Netz zu ermitteln — --netz angeben")
        return 1
    sagen(f"suche in {netz} nach {', '.join(PORTE.values())} …")
    from concurrent.futures import ThreadPoolExecutor

    adressen = [str(a) for a in ipaddress.ip_network(netz, strict=False).hosts()]

    def einer(host):
        return host, [p for p in PORTE if offen(host, p)]

    gefunden = 0
    with ThreadPoolExecutor(max_workers=128) as pool:
        for host, porte in pool.map(einer, adressen):
            if porte:
                gefunden += 1
                namen = ", ".join(f"{p}/{PORTE[p]}" for p in porte)
                sagen(f"  {host:<16} {namen}")
    sagen()
    sagen(f"{gefunden} Adresse(n) mit einer Dateifreigabe. ACHTUNG: ein offener "
          "Port sagt, dass dort etwas horcht — nicht, dass es das gesuchte NAS "
          "ist und nicht, dass die Anmeldung geht.")
    return 0


def freigaben(host, nutzer):
    import getpass
    gab_es = False
    smb = shutil.which("smbclient")
    if smb:
        gab_es = True
        sagen(f"── SMB-Freigaben auf {host} ────────────────────────────")
        befehl = [smb, "-L", host, "-g"]
        umgebung = dict(os.environ)
        if nutzer:
            befehl += ["-U", nutzer]
            pw = umgebung.get("NAS_PASSWORT")
            if pw is None:
                pw = getpass.getpass(f"Passwort fuer {nutzer}@{host} (leer = ohne): ")
            umgebung["PASSWD"] = pw     # NICHT in die Befehlszeile, siehe Kopf
        else:
            befehl += ["-N"]
        aus = subprocess.run(befehl, capture_output=True, text=True,
                             env=umgebung, timeout=20)
        sagen(aus.stdout.strip() or aus.stderr.strip() or "  nichts zurueck")
    else:
        sagen("smbclient fehlt (Paket smbclient) — SMB-Freigaben ungeprueft")

    show = shutil.which("showmount") or shutil.which("showmount", path="/sbin:/usr/sbin")
    sagen()
    if show:
        gab_es = True
        sagen(f"── NFS-Exporte auf {host} ──────────────────────────────")
        aus = subprocess.run([show, "-e", host], capture_output=True, text=True,
                             timeout=20)
        sagen(aus.stdout.strip() or aus.stderr.strip() or "  nichts zurueck")
    else:
        sagen("showmount fehlt (Paket nfs-common) — NFS-Exporte ungeprueft")
    return 0 if gab_es else 1


def webdav(adresse):
    """Spricht diese Adresse WebDAV — und zwar OHNE Zugangsdaten?

    DAS GEHT, UND DAS IST DER PUNKT: ein Server, der WebDAV kann, nennt sich
    im Kopf `DAV:` — auch in einer 401-Antwort, also noch BEVOR jemand sich
    anmeldet. Damit laesst sich vor dem Eintragen klaeren, ob die Adresse
    ueberhaupt die richtige ist, ohne ein Passwort durch die Kommandozeile zu
    schicken.

    EINE 401 IST HIER EIN GUTES ZEICHEN: die Freigabe ist da und verlangt
    eine Anmeldung. Eine 200 ohne `DAV:`-Kopf dagegen heisst meist, dass man
    auf der Weboberflaeche gelandet ist und nicht auf der Freigabe — der
    haeufigste Tippfehler bei Nextcloud (die Weboberflaeche antwortet
    freundlich, einhaengen laesst sie sich nicht).
    """
    import ssl
    import urllib.error
    import urllib.request

    if not adresse.startswith(("http://", "https://")):
        adresse = "https://" + adresse

    # DAS ZERTIFIKAT ZUERST, und zwar auch dann, wenn es nicht prueft: im
    # Heimnetz hat fast jedes NAS ein selbstsigniertes. `mount.davfs` scheitert
    # daran, und die Verwaltung braucht genau diesen Fingerabdruck, um zu
    # fragen „ist das dein Geraet?". Hier wird er ANGEZEIGT, nirgends
    # gespeichert und nichts damit vertraut.
    if adresse.startswith("https://"):
        teile = adresse[len("https://"):].split("/", 1)[0]
        wirt, _, hafen = teile.partition(":")
        try:
            roh = ssl.get_server_certificate((wirt, int(hafen or 443)))
            fp = ssl.PEM_cert_to_DER_cert(roh)
            import hashlib
            abdruck = ":".join(f"{b:02X}" for b in hashlib.sha256(fp).digest())
            sagen(f"  Zertifikat    SHA256 {abdruck}")
            pruef = ssl.create_default_context()
            try:
                with socket.create_connection((wirt, int(hafen or 443)), timeout=8) as roh_s:
                    with pruef.wrap_socket(roh_s, server_hostname=wirt):
                        sagen("  Zertifikat    prueft sich sauber gegen die Systemablage")
            except ssl.SSLError as e:
                sagen(f"  Zertifikat    PRUEFT NICHT: {e.reason if hasattr(e, 'reason') else e}")
                sagen("                (selbstsigniert? Dann braucht die Verwaltung ein")
                sagen("                 ausdrueckliches 'diesem Zertifikat vertrauen', und der")
                sagen("                 Fingerabdruck oben ist das, was man vergleicht.)")
            except OSError as e:
                sagen(f"  Zertifikat    nicht pruefbar: {e}")
        except (OSError, ssl.SSLError, ValueError) as e:
            sagen(f"  Zertifikat    nicht zu holen: {e}")
    anfrage = urllib.request.Request(adresse, method="OPTIONS")
    anfrage.add_header("User-Agent", "nas-sonde")
    # Fuer die DAV-Frage wird das Zertifikat NICHT geprueft — sonst bricht die
    # Diagnose genau bei den Geraeten ab, fuer die sie gedacht ist. Geurteilt
    # wurde darueber oben, sichtbar, mit Fingerabdruck.
    ohne_pruefung = ssl.create_default_context()
    ohne_pruefung.check_hostname = False
    ohne_pruefung.verify_mode = ssl.CERT_NONE
    kopf = None
    stand = None
    try:
        with urllib.request.urlopen(anfrage, timeout=10, context=ohne_pruefung) as antwort:
            stand = antwort.status
            kopf = antwort.headers
    except urllib.error.HTTPError as e:
        stand = e.code
        kopf = e.headers
    except (urllib.error.URLError, OSError, ValueError) as e:
        sagen(f"{adresse} antwortet nicht: {e}")
        return 1

    sagen(f"── {adresse} ──────────────────────────────────")
    sagen(f"  Rueckmeldung  {stand}")
    dav = kopf.get("DAV") if kopf else None
    erlaubt = (kopf.get("Allow") or kopf.get("allow")) if kopf else None
    auth = kopf.get("WWW-Authenticate") if kopf else None
    sagen(f"  DAV-Kopf      {dav or 'FEHLT'}")
    if erlaubt:
        sagen(f"  Allow         {erlaubt}")
    if auth:
        sagen(f"  Anmeldung     {auth.split(' ')[0]}")
    sagen()
    if dav:
        sagen("  → Hier spricht WebDAV." + (" Die Anmeldung fehlt noch — das ist "
              "an dieser Stelle richtig so." if stand in (401, 403) else ""))
        return 0
    if stand in (401, 403):
        sagen("  → Verlangt eine Anmeldung, nennt aber keinen DAV-Kopf. Kann "
              "trotzdem gehen; manche Server verraten ihn erst nach dem Anmelden.")
        return 0
    sagen("  → KEIN WebDAV an dieser Adresse. Bei Nextcloud steht die richtige "
          "unten links unter 'Einstellungen': "
          "https://<server>/remote.php/dav/files/<name>")
    return 1


def messen(pfad, mb):
    """Schreib- und Leserate auf einem EINGEHAENGTEN Pfad. Ohne diese Zahl ist
    die Frage „reicht das NAS fuer die Bibliothek" eine Meinung."""
    if not os.path.isdir(pfad):
        sagen(f"{pfad} gibt es nicht (oder ist nicht eingehaengt)")
        return 1
    ziel = os.path.join(pfad, f"{PROBE_NAME}-{os.getpid()}")
    block = b"\0" * (1024 * 1024)
    try:
        t0 = time.monotonic()
        with open(ziel, "wb") as f:
            for _ in range(mb):
                f.write(block)
            f.flush()
            os.fsync(f.fileno())
        schreiben = time.monotonic() - t0

        # Seitenzwischenspeicher umgehen, sonst misst man den RAM und nicht
        # das Netz ([[einmal-hinsehen-ist-keine-messung]]).
        t0 = time.monotonic()
        fd = os.open(ziel, os.O_RDONLY)
        try:
            try:
                os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
            except (AttributeError, OSError):
                pass
            while os.read(fd, 1024 * 1024):
                pass
        finally:
            os.close(fd)
        lesen = time.monotonic() - t0

        t0 = time.monotonic()
        os.stat(ziel)
        stat_ms = (time.monotonic() - t0) * 1000
    except OSError as e:
        sagen(f"Messung gescheitert: {e}")
        return 1
    finally:
        try:
            os.unlink(ziel)
        except OSError:
            pass

    sagen(f"── {pfad} ({mb} MB) ───────────────────────────────────")
    sagen(f"  schreiben   {mb / schreiben:7.1f} MB/s   ({schreiben:.2f} s)")
    sagen(f"  lesen       {mb / lesen:7.1f} MB/s   ({lesen:.2f} s)")
    sagen(f"  stat        {stat_ms:7.1f} ms")
    sagen()
    sagen("  Zum Einordnen: eine Stunde FLAC aus dem Mitschnitt sind rund "
          "320 MB (E28/N3), ein Hoerspiel als MP3 rund 60 MB.")
    return 0


def haengen(pfad, sekunden):
    """Die Frage aus E28/N6: wie lange haengt ein Zugriff, wenn die Freigabe
    weg ist? Das Werkzeug misst, der Mensch zieht den Stecker — anders ist ein
    echter Abriss nicht zu haben."""
    sagen(f"messe {sekunden} s lang jede Sekunde ein stat auf {pfad}.")
    sagen("JETZT das NAS trennen (Netzstecker, WLAN aus, Freigabe stoppen).")
    sagen("Die laengste Dauer unten ist die Zeit, die die Wiedergabe still "
          "stuende, laege dieser Pfad im Tonweg.")
    sagen()
    laengste = 0.0
    fehler = 0
    ende = time.monotonic() + sekunden
    while time.monotonic() < ende:
        t0 = time.monotonic()
        try:
            os.stat(pfad)
            dauer = time.monotonic() - t0
        except OSError as e:
            dauer = time.monotonic() - t0
            fehler += 1
            sagen(f"  {dauer:6.2f} s  FEHLER {e.__class__.__name__}: {e}")
        else:
            if dauer > 0.05:
                sagen(f"  {dauer:6.2f} s  langsam")
        laengste = max(laengste, dauer)
        time.sleep(1)
    sagen()
    sagen(f"laengster Zugriff: {laengste:.2f} s, {fehler} Fehler")
    if laengste > 1.0:
        sagen("→ DIESER PFAD DARF NICHT IM TONWEG LIEGEN (E28/N6).")
    return 0


def main():
    p = argparse.ArgumentParser(
        description="Netzlaufwerk messen: Zustand, Suche, Freigaben, Rate, Haengen.")
    p.add_argument("--zustand", action="store_true",
                   help="was ist hier eingehaengt, was steht in fstab, was fehlt")
    p.add_argument("--suchen", action="store_true", help="im Netz nach Freigaben sehen")
    p.add_argument("--netz", help="z.B. 192.168.178.0/24 (Vorgabe: eigenes /24)")
    p.add_argument("--freigaben", metavar="HOST", help="Freigaben/Exporte auflisten")
    p.add_argument("--webdav", metavar="ADRESSE",
                   help="spricht diese Adresse WebDAV? (ohne Zugangsdaten)")
    p.add_argument("--nutzer", help="Anmeldename fuer --freigaben (Passwort per Abfrage)")
    p.add_argument("--messen", metavar="PFAD", help="Schreib-/Leserate auf einem Pfad")
    p.add_argument("--mb", type=int, default=8, help="Probegroesse fuer --messen")
    p.add_argument("--haengen", metavar="PFAD", help="Abrissprobe: wie lange haengt es")
    p.add_argument("--sekunden", type=int, default=60, help="Dauer fuer --haengen")
    a = p.parse_args()

    if a.zustand:
        return zustand()
    if a.suchen:
        return suchen(a.netz)
    if a.freigaben:
        return freigaben(a.freigaben, a.nutzer)
    if a.webdav:
        return webdav(a.webdav)
    if a.messen:
        return messen(a.messen, a.mb)
    if a.haengen:
        return haengen(a.haengen, a.sekunden)
    p.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
