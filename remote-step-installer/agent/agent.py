#!/usr/bin/env python3
"""
remote-step-installer — target agent (runs ON the Pi/DietPi box, as root).

The ONLY thing installed on the box. Pure Python 3 stdlib (no pip) so it runs on
a fresh DietPi with nothing else set up yet. Exposes a tiny HTTP+SSE API the
controller drives step-by-step:

  POST /pair {code}          -> {token}          (Jellyfin-style code pairing)
  GET  /status                                   (agent + running steps)
  POST /run  {id,cmd,timeout?} -> {run_id}        (start a command; own proc group)
  GET  /stream/{run_id}                          (SSE: one 'data:' per output line,
                                                  final 'event: done data:{"exit":N}')
  POST /abort/{run_id}                           (killpg SIGKILL — stops a hung step)
  POST /shutdown {remove?}                        (stop; optionally self-remove)

Every endpoint except /pair needs 'Authorization: Bearer <token>'.

Security: binds 127.0.0.1 by default -> reach it via an SSH tunnel. LAN bind is
opt-in (--host 0.0.0.0). It runs arbitrary commands as root by design; trust comes
from localhost+tunnel, the pair code, and self-termination after the install.
"""
import argparse, json, os, re, secrets, shlex, signal, socket, struct, subprocess, sys, threading, time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PAIR_CODE = f"{secrets.randbelow(1_000_000):06d}"

# ---- Pairing-Bremse -------------------------------------------------------
# WARUM ES SIE GIBT: Sechs Ziffern sind 1.000.000 Moeglichkeiten. Solange der
# Agent auf 127.0.0.1 lauscht und man ihn durch einen SSH-Tunnel erreicht, ist
# das genug — wer dort schon ist, hat ohnehin gewonnen. Der Einrichtungs-
# assistent bringt ihn aber ins LAN (--host 0.0.0.0), damit ein Handy ihn
# erreicht, und dann sind eine Million Versuche ohne Bremse in Minuten
# durchprobiert. Bei einem Programm, das beliebige Befehle als ROOT ausfuehrt.
#
# EIN ZEITSTRAFZUSCHLAG ALLEIN GENUEGT NICHT: der Server bedient jede Anfrage
# in einem eigenen Thread, ein Angreifer kann also parallel raten und wartet
# nur einmal. Was wirklich schuetzt, ist der HARTE DECKEL.
#
# Der Deckel ist absichtlich global und nicht je Absender: wer im selben Netz
# steht, kann seine Adresse wechseln. Preis dafuer ist, dass jemand den
# Assistenten lahmlegen kann — auf einer Kinderbox im Heimnetz ist ein
# blockierter Einrichtungsvorgang das kleinere Uebel als eine offene Wurzel.
PAIR_MAX_FEHLER = 8
PAIR_FEHLER = 0
PAIR_ZU = False

# ---- Einrichtungsassistent: NUR BENANNTE AKTIONEN -------------------------
# DER UNTERSCHIED ZU /run, und der Grund fuer diesen ganzen Abschnitt: `/run`
# nimmt eine beliebige Befehlszeile und schickt sie durch eine Shell. Das ist
# fuer den Controller richtig — wer im SSH-Tunnel sitzt, hat die Box ohnehin.
# Der Assistent laeuft aber in einem BROWSER auf einem Handy im WLAN. Gaebe man
# ihm `/run`, waere jedes Formularfeld eine Wurzelschale.
#
# Deshalb hier: der Browser nennt einen NAMEN aus dieser Tabelle. Was daraus
# wird, steht ausschliesslich hier. Werte aus dem Formular gehen einzeln durch
# einen Pruefer und landen als LISTENELEMENTE in argv — nie in einer
# Zeichenkette, nie in einer Shell.
def _pruefe_geraet(wert):
    """Ein Name aus /sys/class/net — und sonst gar nichts."""
    if not re.fullmatch(r"[a-z][a-z0-9_-]{1,14}", wert or ""):
        raise ValueError("kein gueltiger Schnittstellenname")
    if not os.path.isdir(f"/sys/class/net/{wert}"):
        raise ValueError(f"Schnittstelle '{wert}' gibt es auf dieser Box nicht")
    return wert


def _pruefe_ssid(wert):
    """Netzwerkname — Grenzen ABGESCHRIEBEN aus src/backend-api/src/netzwerk.ts.

    Dort stehen sie begruendet: hoechstens 32 BYTE (IEEE 802.11), keine
    Steuerzeichen, kein `"` und kein `\\`. Nicht aus Prinzip, sondern weil
    genau die aus einer Zeile in wpa_supplicant.conf ausbrechen koennten — und
    weil der Name gleich in Anfuehrungszeichen an `wpa_cli set_network` geht.

    DOPPELUNG MIT ANSAGE: Der Agent ist reines Python auf einer blanken Box und
    kann das TypeScript des Backends nicht einbinden. Wer dort die Grenzen
    aendert, muss hier nachziehen — deshalb steht die Fundstelle im Text.
    """
    if not isinstance(wert, str) or wert == "":
        raise ValueError("leer")
    if len(wert.encode("utf-8")) > 32:
        raise ValueError("laenger als 32 Byte")
    if re.search(r"[\x00-\x1f\x7f]", wert):
        raise ValueError("enthaelt Steuerzeichen")
    if re.search(r'["\\]', wert):
        raise ValueError('enthaelt " oder \\')
    return wert


def _pruefe_psk(wert):
    """Passwort. Leer ist erlaubt — ein offenes Netz hat keines.

    DER WERT WIRD NIE PROTOKOLLIERT, weder hier noch im Lauf-Datensatz.
    """
    if wert is None or wert == "":
        return ""
    if not isinstance(wert, str):
        raise ValueError("kein Text")
    if not 8 <= len(wert) <= 63:
        raise ValueError("muss 8 bis 63 Zeichen haben")
    if re.search(r"[\x00-\x1f\x7f]", wert):
        raise ValueError("enthaelt Steuerzeichen")
    if re.search(r'["\\]', wert):
        raise ValueError('enthaelt " oder \\')
    return wert


def _funkschnittstelle():
    """Die erste Schnittstelle mit Funk — ohne Fremdprogramm ermittelt."""
    try:
        for n in sorted(os.listdir("/sys/class/net")):
            if os.path.isdir(f"/sys/class/net/{n}/wireless"):
                return n
    except OSError:
        pass
    return None


def _wpa(iface, args, frist=15):
    r = subprocess.run(
        ["wpa_cli", "-i", iface, *args], capture_output=True, text=True, timeout=frist
    )
    return r.returncode, ((r.stdout or "") + (r.stderr or "")).strip()


def wlan_verbinden(p):
    """Ein WLAN einstellen — ABER NOCH NICHT FESTSCHREIBEN.

    Das ist der Kniff aus dem Backend (server.ts, /api/netzwerk/verbinden):
    `select_network` schaltet die uebrigen Netze nur IM SPEICHER ab. Solange
    niemand `save_config` ruft, steht auf der Platte weiterhin der alte Stand.
    Der Rueckweg ist damit ein Neustart — oder `wlan-verwerfen`.

    Fuer die Erstinbetriebnahme ist das genauso wichtig wie im Betrieb: wer
    sich beim Passwort vertippt, waere sonst dauerhaft aus dem eigenen Netz
    ausgesperrt und muesste die Karte ausbauen.
    """
    iface = _funkschnittstelle()
    if not iface:
        return {"ok": False, "fehler": "Keine Funkschnittstelle gefunden"}
    ssid, psk = p["ssid"], p["psk"]

    # IM EIGENEN NETZ DER BOX gilt ein anderer Ablauf: erst antworten, dann
    # wechseln — sonst stirbt die Seite, bevor sie etwas erfaehrt. Und der
    # Schirm der Box uebernimmt die Rueckmeldung, denn nur er ueberlebt den
    # Netzwechsel. Details: wechsel_aus_ap().
    if os.path.isfile(os.path.join(AP_ARBEIT, "ssid")):
        threading.Thread(target=wechsel_aus_ap, args=(ssid, psk, iface),
                         daemon=True).start()
        return {
            "ok": True,
            "wechsel": True,
            "hinweis": f"Die Box wechselt jetzt in \u201E{ssid}\u201C. Dein Handy "
                       "verliert dabei die Verbindung zu ihr — das ist richtig so. "
                       "Schau auf den BILDSCHIRM DER BOX: erscheint dort ein neuer "
                       "QR-Code, hat es geklappt. Kommt \u201EMixPi Start\u201C "
                       "zurueck, war das Passwort falsch — dann einfach noch einmal.",
        }

    rc, roh = _wpa(iface, ["add_network"])
    kennung = roh.strip().split("\n")[-1].strip() if rc == 0 else ""
    if not kennung.isdigit():
        return {"ok": False, "fehler": f"add_network lieferte keine Kennung: {roh[:120]}"}

    # Anfuehrungszeichen sind hier sicher, WEIL beide Werte oben geprueft
    # wurden (kein " und kein \). Genau in dieser Reihenfolge argumentiert es
    # auch das Backend.
    schritte = [["set_network", kennung, "ssid", f'"{ssid}"']]
    if psk:
        schritte.append(["set_network", kennung, "psk", f'"{psk}"'])
    else:
        schritte.append(["set_network", kennung, "key_mgmt", "NONE"])
    # Versteckte Netze finden sich nur mit gezielter Suche.
    schritte.append(["set_network", kennung, "scan_ssid", "1"])
    schritte.append(["select_network", kennung])

    for schritt in schritte:
        rc, roh = _wpa(iface, schritt)
        if rc != 0 or "FAIL" in roh:
            # Den Namen des Schrittes melden, NIE seine Werte — sonst stuende
            # das Passwort in der Antwort und damit womoeglich im Browserverlauf.
            return {"ok": False, "fehler": f"wpa_cli {schritt[0]} misslang", "kennung": kennung}
    return {
        "ok": True,
        "schnittstelle": iface,
        "kennung": kennung,
        "hinweis": "Noch nicht festgeschrieben. Erst 'wlan-bestaetigen' macht es dauerhaft; "
                   "ohne das gilt nach einem Neustart wieder der alte Stand.",
    }


AP_ARBEIT = "/run/mixpibox-einrichtung"


def wpa_persist_text(ssid, psk, land="DE"):
    """Der Inhalt fuer /etc/wpa_supplicant/wpa_supplicant.conf. Pure.

    WOZU: Die Verbindung aus der Einrichtung lebt nur im Speicher des gerade
    laufenden wpa_supplicant. Ohne diese Datei kennt der naechste Start das
    Netz nicht — die Box waere nach jedem Stromziehen wieder taub. ifupdown
    zieht die Datei ueber die wpa-conf-Zeile der interfaces heran.
    """
    kopf = [
        "ctrl_interface=DIR=/run/wpa_supplicant GROUP=netdev",
        "update_config=1",
        f"country={land}",
        "",
        "network={",
        f'    ssid="{ssid}"',
    ]
    if psk:
        kopf.append(f'    psk="{psk}"')
    else:
        kopf.append("    key_mgmt=NONE")
    kopf += ["    scan_ssid=1", "}", ""]
    return "\n".join(kopf)


def interfaces_wlan_an(text, iface="wlan0"):
    """/etc/network/interfaces so umschreiben, dass WLAN kuenftig startet. Pure.

    DietPis Erstboot hat mit WIFI_ENABLED=0 genau eine Zeile auskommentiert:
    `#allow-hotplug wlan0`. Dieselbe Zeile wird hier wieder scharf gemacht —
    exakt der sed, den DietPi selbst bei WIFI_ENABLED=1 gefahren haette.
    Fehlt jede wlan-Zeile, wird ein vollstaendiger Block angehaengt.
    """
    import re as _re
    neu_zeile = f"allow-hotplug {iface}"
    if _re.search(r"^#?\s*(allow-hotplug|auto)\s+wlan", text, _re.M):
        return _re.sub(r"^#?\s*(allow-hotplug|auto)\s+wlan\S*\s*$",
                       neu_zeile, text, count=1, flags=_re.M)
    return (text.rstrip() + "\n\n" + neu_zeile + "\n"
            + f"iface {iface} inet dhcp\n"
            + "wpa-conf /etc/wpa_supplicant/wpa_supplicant.conf\n")


def _hinweis_schreiben(text):
    """Eine Zeile fuer den Schirm der Box — er liest sie im Sekundentakt.

    ZUSAETZLICH ins Boot-Protokoll: /run ist tmpfs und nach dem Ausschalten
    leer — ausgerechnet die Zeilen, die einen gescheiterten Wechsel erklaeren,
    waren weg. Die Boot-Partition ueberlebt."""
    try:
        with open(os.path.join(AP_ARBEIT, "hinweis"), "w", encoding="utf-8") as f:
            f.write(text + "\n")
    except OSError:
        pass
    if text:
        _wechsel_log(f"[schirm] {text}")


def _wechsel_log(text):
    """Zeitgestempelt ins selbe Protokoll wie der Vorstart — es ueberlebt."""
    zeile = f"{time.strftime('%H:%M:%S')} {text}"
    print(zeile, flush=True)
    for b in ("/boot/firmware", "/boot"):
        try:
            with open(os.path.join(b, "mixpibox-vorstart.log"), "a",
                      encoding="utf-8") as f:
                f.write(zeile + "\n")
            break
        except OSError:
            continue


def wechsel_aus_ap(ssid, psk, iface):
    """Vom eigenen Netz ins Heimnetz — der Teil NACH der Antwort ans Handy.

    WARUM ERST ANTWORTEN, DANN HANDELN: `select_network` reisst den AP ab,
    und mit ihm die Verbindung zum Handy. Wer erst schaltet und dann
    antwortet, antwortet niemandem — am Geraet gesehen: WLAN gewaehlt,
    Passwort getippt, "danach passiert nichts erkennbares".

    DER RUECKWEG IST DER KERN: Klappt die Verbindung nicht (falsches
    Passwort), kehrt die Box ZUM EIGENEN NETZ ZURUECK. Das Handy verbindet
    sich von selbst wieder (offenes, gespeichertes Netz), die Seite oeffnet
    sich neu, und der Schirm sagt, woran es lag. Ohne diesen Rueckweg
    straendete jeder Tippfehler die Einrichtung.
    """
    time.sleep(1.5)                    # die Antwort ans Handy erst hinauslassen
    _hinweis_schreiben(f"Verbinde mit {ssid} ...")

    rc, roh = _wpa(iface, ["add_network"])
    kennung = roh.strip().split("\n")[-1].strip() if rc == 0 else ""
    if not kennung.isdigit():
        _hinweis_schreiben("Wechsel fehlgeschlagen - noch einmal versuchen.")
        return
    # AP_SCAN UMSCHALTEN, und zwar VOR dem Wechsel: die laufende Instanz
    # steht auf ap_scan=2 (noetig fuer den AP-Betrieb) — im Client-Betrieb
    # verhindert genau das die Netzsuche, und die Verbindung scheitert auch
    # mit RICHTIGEM Passwort. Am Geraet genau so erlebt. Auf dem Rueckweg
    # wird ap_scan=2 wiederhergestellt, sonst kaeme der AP nicht zurueck.
    _wechsel_log(f"[wechsel] beginne: ziel={ssid!r} iface={iface}")
    rc_aps, roh_aps = _wpa(iface, ["ap_scan", "1"])
    _wechsel_log(f"[wechsel] ap_scan 1 -> {roh_aps.strip()[:40]}")
    for schritt in ([["set_network", kennung, "ssid", f'"{ssid}"']]
                    + ([["set_network", kennung, "psk", f'"{psk}"']] if psk
                       else [["set_network", kennung, "key_mgmt", "NONE"]])
                    + [["set_network", kennung, "scan_ssid", "1"],
                       ["select_network", kennung]]):
        rc_s, roh_s = _wpa(iface, schritt)
        if schritt[0] != "set_network" or schritt[3] != f'"{psk}"':
            _wechsel_log(f"[wechsel] {schritt[0]} -> {roh_s.strip()[:40]}")

    # Warten, bis der Handschlag steht — MIT DEM RICHTIGEN NETZ. Nur auf
    # COMPLETED zu schauen waere ein Wettlauf: unmittelbar nach dem
    # Umschalten meldet der Status noch das COMPLETED des eigenen AP.
    # Erst wpa_state=COMPLETED UND ssid=Zielnetz ist ein Erfolg.
    verbunden = False
    for runde in range(35):
        time.sleep(1)
        stand = _wpa_stand(iface)
        if runde % 5 == 0:
            _wechsel_log(f"[wechsel] {runde}s: state={stand.get('wpa_state')} "
                         f"ssid={stand.get('ssid')!r}")
        if (stand.get("wpa_state") == "COMPLETED"
                and stand.get("ssid") == ssid):
            verbunden = True
            break
    if not verbunden:
        # RUECKWEG: Client-Netz weg, ap_scan zurueck, AP-Netz (Kennung 0) an.
        _wpa(iface, ["remove_network", kennung])
        _wpa(iface, ["ap_scan", "2"])
        _wpa(iface, ["select_network", "0"])
        subprocess.run(["ip", "addr", "add", "192.168.4.1/24", "dev", iface],
                       capture_output=True)
        _hinweis_schreiben("Passwort stimmte wohl nicht - bitte noch einmal.")
        return

    # Verbunden: Adresse holen. Die AP-Adresse zuerst weg, sonst antwortet
    # dhclient-Routing in ein Netz, das es nicht mehr gibt.
    subprocess.run(["ip", "addr", "del", "192.168.4.1/24", "dev", iface],
                   capture_output=True)
    _hinweis_schreiben(f"Mit {ssid} verbunden - hole Adresse ...")
    _wechsel_log("[wechsel] verbunden - dhclient laeuft")
    dh = subprocess.run(["dhclient", "-1", iface], capture_output=True,
                        text=True, timeout=40)
    _wechsel_log(f"[wechsel] dhclient rc={dh.returncode} "
                 f"{(dh.stderr or '').strip()[:80]}")

    # Festschreiben — die Box soll das Netz auch nach dem Neustart kennen.
    try:
        with open("/etc/wpa_supplicant/wpa_supplicant.conf", "w",
                  encoding="utf-8") as f:
            f.write(wpa_persist_text(ssid, psk))
        os.chmod("/etc/wpa_supplicant/wpa_supplicant.conf", 0o600)
        pfad = "/etc/network/interfaces"
        with open(pfad, encoding="utf-8", errors="replace") as f:
            alt_text = f.read()
        with open(pfad, "w", encoding="utf-8") as f:
            f.write(interfaces_wlan_an(alt_text))
    except OSError as e:
        _hinweis_schreiben(f"Verbunden, aber nicht gespeichert: {e}")

    # Die Uebergabe-Marke: `stoppen` laesst den laufenden wpa_supplicant dann
    # IN RUHE — er traegt jetzt die Heimnetz-Verbindung. Die AP-Reste
    # (DHCP/DNS, Portal, Markerdateien) raeumen wir selbst ab.
    try:
        open(os.path.join(AP_ARBEIT, "uebergeben"), "w").close()
    except OSError:
        pass
    subprocess.run(["pkill", "-f", "kleiner-dhcp.py"], capture_output=True)
    subprocess.run(["pkill", "-f", "einrichtung-ap.py portal"], capture_output=True)
    for name in ("ssid", "wlan-passwort", "netze.json"):
        try:
            os.remove(os.path.join(AP_ARBEIT, name))
        except OSError:
            pass
    _wechsel_log(f"[wechsel] {ssid} verbunden und festgeschrieben")

    # DER NEUSTART IST DER SCHLUSSSTEIN — und der Grund ist die Tastatur, die
    # es nicht gibt: schlug DietPis Erstinstallation frueher einmal fehl (etwa
    # weil es da noch kein Netz gab), verlangt sie beim naechsten Versuch eine
    # BESTAETIGUNG auf tty1. Die Box hat aber nur einen Touchscreen. Der
    # Fehlschlag-Merker lebt in /tmp — ein Neustart raeumt ihn ab, und mit
    # Netz + AUTO_SETUP_AUTOMATED=1 laeuft die Erstinstallation dann VON
    # SELBST weiter. QR -> Handy -> WLAN -> Neustart -> Installation: keine
    # Taste, kein PC.
    _hinweis_schreiben("Verbunden! Die Box startet neu und installiert sich ...")
    time.sleep(4)                      # der Schirm soll die Zeile noch zeigen
    subprocess.run(["sync"])
    subprocess.run(["reboot"])


WATCHDOG = "/usr/local/bin/mupibox/mupibox-netz-watchdog.py"


def gateway_lesen(text):
    """Das Standardgateway aus dem Inhalt von /proc/net/route. Pure.

    Die Datei nennt die Adresse als LITTLE-ENDIAN-Hexzahl — `0100A8C0` ist
    192.168.0.1, nicht 1.0.168.192. Wer die Bytes nicht dreht, pingt eine
    Adresse, die es nicht gibt, und haelt das Netz fuer kaputt.
    """
    for zeile in text.splitlines()[1:]:
        teile = zeile.split()
        if len(teile) < 3:
            continue
        if teile[1] != "00000000":  # nur die Standardroute
            continue
        roh = teile[2]
        try:
            zahl = int(roh, 16)
        except ValueError:
            continue
        return ".".join(str((zahl >> (8 * i)) & 0xFF) for i in range(4))
    return None


def netz_pruefen(melde=None, ziel=("api.spotify.com", 443), frist=6):
    """Ist die Box WIRKLICH online? — in drei Stufen, jede einzeln gemeldet.

    WOFUER: Nach einem WLAN-Wechsel ist die Seite auf dem Handy tot. Die
    Entwarnung fuer den Totmannschalter kann also NICHT mehr von einem Menschen
    kommen (so ist mupibox-netz-watchdog.py sonst gedacht) — die Box muss sich
    selbst pruefen.

    DREI STUFEN, WEIL EINE NICHTS SAGT:
      1. Adresse da?      -> DHCP hat geantwortet
      2. Gateway pingbar? -> das oertliche Netz traegt
      3. Name aufloesen + Verbindung nach draussen -> es geht ins Internet
    Bliebe es bei einer einzigen Pruefung, hiesse ein Fehlschlag nur „irgendwo
    klemmt es". So steht da, WO es klemmt — und genau das braucht jemand, der
    vor einer stummen Box steht.

    Stufe 3 zielt auf Spotify, weil das der Dienst ist, um den es hier geht:
    ein Netz, das alles kann ausser Spotify, ist fuer diese Box kein Netz.
    """
    sag = melde or (lambda z: None)
    ergebnis = {"adresse": None, "gateway": None, "draussen": False}

    try:
        with open("/proc/net/route", encoding="ascii") as f:
            gw = gateway_lesen(f.read())
    except OSError:
        gw = None

    for name in sorted(os.listdir("/sys/class/net")):
        if name == "lo":
            continue
        try:
            import fcntl

            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            r = fcntl.ioctl(s.fileno(), 0x8915, struct.pack("256s", name[:15].encode()))
            s.close()
            adresse = socket.inet_ntoa(r[20:24])
            if adresse not in ("", "0.0.0.0"):
                ergebnis["adresse"] = f"{name} {adresse}"
                break
        except OSError:
            continue

    if not ergebnis["adresse"]:
        sag("1. Adresse:  KEINE — der Router hat keine vergeben.")
        return ergebnis
    sag(f"1. Adresse:  {ergebnis['adresse']}")

    if gw:
        try:
            r = subprocess.run(
                ["ping", "-c", "1", "-W", "2", gw], capture_output=True, timeout=8
            )
            ergebnis["gateway"] = gw if r.returncode == 0 else None
        except (OSError, subprocess.SubprocessError):
            ergebnis["gateway"] = None
        sag(f"2. Gateway:  {gw} {'erreichbar' if ergebnis['gateway'] else 'ANTWORTET NICHT'}")
    else:
        sag("2. Gateway:  keines eingetragen")

    try:
        with socket.create_connection(ziel, timeout=frist):
            ergebnis["draussen"] = True
        sag(f"3. Internet: {ziel[0]} erreichbar")
    except OSError as e:
        sag(f"3. Internet: {ziel[0]} NICHT erreichbar ({e.__class__.__name__})")
    return ergebnis


def _watchdog(args):
    """Den Totmannschalter rufen, WENN es ihn gibt.

    Auf einer frisch aufgesetzten Box ist er noch nicht ausgerollt — dann laeuft
    die Einrichtung ohne Sicherheitsnetz weiter, sagt das aber. Ein fehlendes
    Netz darf den Wechsel nicht verhindern (so haelt es auch das Backend).
    """
    if not os.path.exists(WATCHDOG):
        return False, "kein Watchdog auf der Box"
    try:
        r = subprocess.run(
            ["python3", WATCHDOG, *args], capture_output=True, text=True, timeout=20
        )
        return r.returncode == 0, (r.stdout or r.stderr or "").strip()[:200]
    except (OSError, subprocess.SubprocessError) as e:
        return False, str(e)


def _wpa_stand(iface):
    """`wpa_cli status` als Woerterbuch."""
    rc, roh = _wpa(iface, ["status"])
    aus = {}
    for zeile in roh.splitlines():
        if "=" in zeile:
            k, _, v = zeile.partition("=")
            aus[k.strip()] = v.strip()
    return aus


def wlan_wps(p, melde=None):
    """WPS per Knopfdruck — und danach sagen, wo die Box jetzt zu finden ist.

    ABLAUF: `wps_pbc` oeffnet ein Fenster von rund zwei Minuten, in dem der
    Router nach SEINEM Knopfdruck die Zugangsdaten uebergibt. Danach schreibt
    wpa_supplicant sie SELBST in seine Konfiguration.

    DESHALB GIBT ES HIER KEIN 'VERWERFEN' wie bei der Eingabe von Hand: der
    Zwei-Stufen-Rueckweg (select_network ohne save_config) greift nicht, weil
    nicht wir es speichern, sondern wpa_supplicant. Misslingt es, wird der
    gespeicherte Stand mit `reconfigure` zurueckgeholt — mehr ist nicht noetig,
    denn ohne Erfolg hat sich auf der Platte auch nichts geaendert.

    DIE NEUE ADRESSE IST DER SPRINGENDE PUNKT: Nach erfolgreichem WPS haengt
    die Box in einem ANDEREN Netz und hat eine ANDERE Adresse — die Seite, auf
    der man gerade steht, ist damit tot. Sie erfaehrt sie hier noch (letzte
    Zeile des Stroms), und zusaetzlich zeigt der Bildschirm der Box von selbst
    den neuen QR-Code: `einrichtung-schirm.py` liest seine Adresse alle zwei
    Sekunden neu. Man muss also nur noch einmal hinsehen und abfotografieren.
    """
    sag = melde or (lambda z: None)
    iface = _funkschnittstelle()
    if not iface:
        sag("Keine Funkschnittstelle gefunden.")
        return {"ok": False}

    # ERST DAS SICHERHEITSNETZ, DANN DER SPRUNG. Der Totmannschalter sichert
    # die wpa_supplicant.conf und stellt einen Wecker; feuert er, ist der alte
    # Stand wieder da. Fehlt er (frisch aufgesetzte Box), laeuft es ohne — das
    # wird gesagt, aber nicht verhindert.
    gesichert, wort = _watchdog(["scharf", "300", "--grund", "WPS im Assistenten"])
    sag("Sicherheitsnetz gespannt (5 min)." if gesichert
        else f"OHNE Sicherheitsnetz: {wort}")

    rc, roh = _wpa(iface, ["wps_pbc"])
    if rc != 0 or "FAIL" in roh:
        sag(f"wps_pbc misslang: {roh[:160]}")
        return {"ok": False}

    sag("Jetzt die WPS-Taste am Router druecken.")
    sag("Die Box wartet bis zu zwei Minuten ...")

    frist = time.time() + 120
    zuletzt = ""
    while time.time() < frist:
        time.sleep(3)
        stand = _wpa_stand(iface)
        zustand = stand.get("wpa_state", "?")
        if zustand != zuletzt:
            sag(f"  Zustand: {zustand}")
            zuletzt = zustand
        if zustand == "COMPLETED":
            ssid = stand.get("ssid", "?")
            adresse = stand.get("ip_address", "")
            sag(f"Verbunden mit '{ssid}'.")
            # Die Adresse kommt oft erst ein paar Sekunden spaeter per DHCP.
            for _ in range(10):
                if adresse:
                    break
                time.sleep(2)
                adresse = _wpa_stand(iface).get("ip_address", "")
            if adresse:
                sag(f"Neue Adresse: http://{adresse}:8099")
            sag("")
            sag("Pruefe, ob die Box wirklich hinauskommt:")
            lage = netz_pruefen(sag)
            sag("")
            if lage["draussen"]:
                # DIE ENTWARNUNG GIBT DIE BOX SICH SELBST — und nur, weil sie
                # es BEWIESEN hat. Sonst waere sie ein Knopf, den man aus
                # Versehen drueckt, statt eines Beweises.
                frei, wort = _watchdog(["entwarnung"])
                sag("Geschafft. Sicherheitsnetz abgebaut." if frei
                    else f"Geschafft. (Sicherheitsnetz: {wort})")
                sag("Die Adresse steht als QR-Code auf dem Bildschirm der Box,")
                sag("zusammen mit dem Netz, mit dem sie verbunden ist.")
                return {"ok": True}
            sag("Das Netz traegt nicht bis nach draussen.")
            sag("Das Sicherheitsnetz bleibt gespannt: laeuft es ab, gilt wieder")
            sag("der alte Stand. Bis dahin kann man es hier noch einmal versuchen.")
            return {"ok": False}

    sag("Kein Erfolg innerhalb der zwei Minuten.")
    sag("Moegliche Gruende: WPS am Router abgeschaltet (bei neueren Geraeten")
    sag("die Voreinstellung), Knopf nicht gedrueckt, oder zu weit entfernt.")
    _wpa(iface, ["reconfigure"])
    _watchdog(["entwarnung"])  # nichts geaendert -> kein Wecker noetig
    sag("Der gespeicherte Stand gilt wieder. Der Name laesst sich auch von Hand eingeben.")
    return {"ok": False}


def wlan_bestaetigen(p):
    """Jetzt festschreiben. Erst hiernach ueberlebt die Einstellung den Neustart."""
    iface = _funkschnittstelle()
    if not iface:
        return {"ok": False, "fehler": "Keine Funkschnittstelle gefunden"}
    rc, roh = _wpa(iface, ["save_config"])
    if rc != 0 or "FAIL" in roh:
        return {"ok": False, "fehler": f"save_config misslang: {roh[:120]}"}
    return {"ok": True, "hinweis": "WLAN festgeschrieben."}


def wlan_verwerfen(p):
    """Zurueck auf den Stand, der auf der Platte steht."""
    iface = _funkschnittstelle()
    if not iface:
        return {"ok": False, "fehler": "Keine Funkschnittstelle gefunden"}
    rc, roh = _wpa(iface, ["reconfigure"])
    if rc != 0 or "FAIL" in roh:
        return {"ok": False, "fehler": f"reconfigure misslang: {roh[:120]}"}
    return {"ok": True, "hinweis": "Der alte Stand gilt wieder."}


# ── Anmeldefrei ueber das EIGENE Netz der Box ───────────────────────────────
# WOZU: Wer mit dem Einrichtungs-WLAN der Box verbunden ist, steht vor dem
# Geraet — die Verbindung selbst ist der Beweis der Naehe, den sonst der
# Pair-Code erbringt. Ihn dann noch einmal abzutippen ist dieselbe Tuer
# zweimal. Der Betreiber hat es beim Einrichten genau so empfunden.
#
# WAS DER AUTOMATISCHE SCHLUESSEL KANN — UND WAS NICHT: Er oeffnet NUR die
# Einrichtung (benannte Aktionen, deren Ausgabestrom, Abbruch). /run, /exec,
# /put und /shutdown verlangen weiter den VOLLEN Schluessel vom Pair-Code.
# Ein Nachbar in Funkreichweite koennte waehrend der Minuten der Einrichtung
# also schlimmstenfalls ein WLAN eintragen — nie Befehle als root ausfuehren.
EINRICHT_TOKEN = None          # der beschraenkte Schluessel (auto vergeben)
AP_SSID_DATEI = "/run/mixpibox-einrichtung/ssid"   # existiert nur, solange der AP laeuft
AP_NETZ = "192.168.4."         # ADRESSE aus einrichtung-ap.py, /24


def auto_pair_erlaubt(client_ip, ap_laeuft):
    """Darf dieser Absender OHNE Code den Einrichtungs-Schluessel bekommen?

    Pure — die beiden Fakten kommen von aussen, damit das pruefbar ist.
    Bedingungen, BEIDE noetig:
      * der eigene Zugangspunkt laeuft gerade (sonst gibt es das Netz nicht,
        und eine Adresse aus 192.168.4.x waere eine Behauptung), und
      * der Absender kommt AUS diesem Netz. localhost zaehlt nicht — wer auf
        der Box selbst ist, braucht keinen Schluessel mehr.
    """
    return bool(ap_laeuft) and str(client_ip).startswith(AP_NETZ)


def _wlan_liste_lesen():
    """Die vorab gescannte Netzliste -> {ok, netze}. Leer ist KEIN Fehler:
    dann tippt man den Namen eben selbst — wie bisher."""
    import json
    pfad = "/run/mixpibox-einrichtung/netze.json"
    try:
        with open(pfad, encoding="utf-8") as f:
            netze = json.load(f)
    except (OSError, ValueError):
        netze = []
    return {"ok": True, "netze": netze if isinstance(netze, list) else []}


EINRICHT_AKTIONEN = {
    "netz-lage": {
        "titel": "Netzwerklage",
        "felder": {},
        "argv": lambda p: ["ip", "-o", "addr", "show"],
        "timeout": 20,
    },
    "netz-geraete": {
        "titel": "Netzwerkschnittstellen",
        "felder": {},
        "argv": lambda p: ["ls", "-1", "/sys/class/net"],
        "timeout": 20,
    },
    "wlan-suchen": {
        "titel": "WLAN-Netze suchen",
        "felder": {"geraet": _pruefe_geraet},
        "argv": lambda p: ["iw", "dev", p["geraet"], "scan"],
        "timeout": 60,
    },
    "dienste-gestoert": {
        "titel": "Gestoerte Dienste",
        "felder": {},
        "argv": lambda p: ["systemctl", "list-units", "--failed", "--no-pager", "--plain"],
        "timeout": 30,
    },
    # Die drei WLAN-Aktionen laufen NICHT ueber einen einzelnen Befehl: sie
    # brauchen mehrere wpa_cli-Aufrufe, und der zweite haengt an der Kennung,
    # die der erste zurueckgibt. Statt daraus eine Shell-Zeile zu bauen — wovon
    # dieser ganze Abschnitt wegfuehrt — steckt die Abfolge in Python.
    # Sie sind schnell und liefern ihr Ergebnis sofort; ein Ausgabestrom waere
    # hier nur Umstand.
    "wlan-verbinden": {
        "titel": "Mit WLAN verbinden",
        "felder": {"ssid": _pruefe_ssid, "psk": _pruefe_psk},
        "python": wlan_verbinden,
        "geheim": ["psk"],
    },
    "wlan-bestaetigen": {
        "titel": "WLAN festschreiben",
        "felder": {},
        "python": wlan_bestaetigen,
    },
    "wlan-verwerfen": {
        "titel": "WLAN verwerfen",
        "felder": {},
        "python": wlan_verwerfen,
    },
    # WPS dauert bis zu zwei Minuten und soll dabei reden — deshalb die dritte
    # Sorte: Python MIT Ausgabestrom.
    "wlan-wps": {
        "titel": "WLAN per WPS-Knopf",
        "felder": {},
        "python_strom": wlan_wps,
    },
    "wlan-liste": {
        # Die Liste entsteht VOR dem AP-Start (einrichtung-ap.py,
        # vorab_scannen): im AP-Betrieb kann der Funkbaustein nicht suchen.
        # Hier wird nur die abgelegte Datei gelesen — schnell, ohne Funk.
        "titel": "Netze in der Naehe (vorab gescannt)",
        "felder": {},
        "python": lambda p: _wlan_liste_lesen(),
    },
    "netz-pruefen": {
        "titel": "Kommt die Box ins Internet?",
        "felder": {},
        "python_strom": lambda p, melde: {"ok": netz_pruefen(melde)["draussen"]},
    },
    # DIE EINZIGE AKTION, DIE ETWAS EINRICHTET — und deshalb die einzige, die
    # eine Rueckfrage im Browser bekommt. Sie startet keinen Befehl aus einem
    # Formular, sondern EIN festes Programm mit festem Rezept: das Paket wurde
    # beim Vorbereiten der Karte mitgegeben, hier wird nichts gewaehlt.
    #
    # Sie laeuft NICHT als Unterprozess dieses Aufrufs: die Installation dauert
    # 10 bis 20 Minuten und ueberlebt mehrere Neustarts — auch den des Agenten.
    # Deshalb uebernimmt systemd, und der Fortschritt kommt ueber die Datei,
    # die Schirm und Handy-Seite ohnehin lesen.
    "installation-starten": {
        "titel": "Installation starten (dauert 10-20 min)",
        "felder": {},
        "python": lambda p: installation_starten(),
    },
}


INSTALL_LAUF = "/opt/mixpibox-lauf"
INSTALL_STAND = "/var/lib/mixpibox-lauf/stand.json"


def installation_starten():
    """Den Selbstlauf anwerfen. -> dict fuer die Handy-Seite.

    DIE STANDDATEI IST DIE ZUSTIMMUNG: die Unit laeuft bei jedem Boot, tut aber
    nichts, solange es sie nicht gibt. Sie hier anzulegen ist der Startknopf —
    und gleichzeitig das, was den Lauf nach einem Neustart weiterlaufen laesst.
    """
    if not os.path.isdir(INSTALL_LAUF):
        return {"ok": False, "fehler": "Kein Installationspaket auf dieser Box. "
                                      "Die Karte wurde ohne »Lauf ohne PC« geschrieben."}
    if not os.path.isfile(os.path.join(INSTALL_LAUF, "rezept.json")):
        return {"ok": False, "fehler": "Das Paket ist unvollstaendig (rezept.json fehlt)."}
    try:
        os.makedirs(os.path.dirname(INSTALL_STAND), exist_ok=True)
        if not os.path.exists(INSTALL_STAND):
            with open(INSTALL_STAND, "w", encoding="utf-8") as f:
                json.dump({"fertig": [], "gescheitert": None}, f)
    except OSError as e:
        return {"ok": False, "fehler": f"Stand nicht anlegbar: {e}"}
    r = subprocess.run(["systemctl", "start", "--no-block",
                        "mixpibox-selbstlauf.service"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return {"ok": False, "fehler": (r.stderr or r.stdout or "").strip()[:200]}
    return {"ok": True, "hinweis": "Der Lauf ist gestartet. Der Fortschritt steht "
                                   "auf dem Schirm der Box und hier."}
TOKEN = None                      # set on successful /pair
RUNS = {}                        # run_id -> run record
LOCK = threading.Lock()
SELF_PATH = os.path.abspath(__file__)


# ---- Fortschritt fuer den Schirm der Box ----------------------------------
# WOZU: Die Erstinstallation dauert 10 bis 20 Minuten, und am Bildschirm der
# Box war davon bisher NICHTS zu sehen — wer nicht per SSH mitlas, sass vor
# einem Geraet, das entweder arbeitet oder haengt, und konnte es nicht
# unterscheiden. Die Boot-Animation endet lange vorher.
#
# WARUM EINE DATEI UND KEIN ZWEITER PORT: Der Schirm laeuft auf DERSELBEN Box
# wie der Agent. Ein HTTP-Aufruf brauchte dort einen Token — also entweder ein
# Geheimnis in einer zweiten Unit oder eine Route ohne Tor. Eine Datei in einem
# tmpfs kostet nichts, ueberlebt keinen Neustart (soll sie auch nicht) und ist
# fuer den Schirm ein `open()`.
#
# GESCHRIEBEN WIRD BEIM START DES SCHRITTS, nicht bei seinem Ende: interessant
# ist ja gerade, WORAUF man gerade wartet.
FORTSCHRITT_ORDNER = "/run/mixpibox-einrichtung"
FORTSCHRITT_DATEI = os.path.join(FORTSCHRITT_ORDNER, "fortschritt.json")


def fortschritt_schreiben(daten):
    """Den Stand des Laufs hinterlegen. STILL bei jedem Fehler: ein Agent, der
    an seiner Anzeige scheitert, waere ein Werkzeug, das an seinem Zubehoer
    zerbricht."""
    try:
        os.makedirs(FORTSCHRITT_ORDNER, exist_ok=True)
        vorlaeufig = FORTSCHRITT_DATEI + ".neu"
        with open(vorlaeufig, "w", encoding="utf-8") as f:
            json.dump(daten, f)
        # Umbenennen ist unteilbar — der Schirm liest im Sekundentakt und darf
        # nie eine halb geschriebene Datei erwischen.
        os.replace(vorlaeufig, FORTSCHRITT_DATEI)
    except OSError:
        pass


def fortschritt_loeschen():
    try:
        os.remove(FORTSCHRITT_DATEI)
    except OSError:
        pass


def start_run(step_id, cmd, timeout=None, schritt=None):
    """Einen Schritt starten. `cmd` ist ENTWEDER eine Zeichenkette ODER eine
    Argumentliste.

    `schritt` ist optional und rein fuer die Anzeige auf dem Bildschirm der
    Box: {"nummer": 5, "gesamt": 30, "titel": "Node.js installieren"}. Der
    Controller kennt das Rezept und damit als Einziger die Gesamtzahl — der
    Agent bekommt sonst nur einzelne Befehle zu sehen und koennte hoechstens
    mitzaehlen, ohne je zu wissen, wie weit es noch ist.

    ZEICHENKETTE = durch die Shell. Das ist fuer die Rezepte gewollt (dort
    stehen Pipes, Umleitungen, `||`) und vertretbar, weil sie vom Controller
    kommen — jemandem, der ohnehin schon per SSH auf der Box ist.

    LISTE = OHNE Shell. Genau das braucht der Einrichtungsassistent: dort
    kommen Werte aus einem Browserformular, und ein Netzname wie
    `; rm -rf /` waere in einer Zeichenkette ein Befehl. Als Listenelement ist
    er nur ein Wort. Deshalb reicht der Assistent NIE eine Zeichenkette
    hierher.
    """
    run_id = secrets.token_hex(8)
    durch_shell = isinstance(cmd, str)
    proc = subprocess.Popen(
        cmd, shell=durch_shell, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        bufsize=1, universal_newlines=True, preexec_fn=os.setsid,  # own process group
    )
    lesbar = cmd if durch_shell else " ".join(shlex.quote(x) for x in cmd)
    rec = {"id": step_id, "cmd": lesbar, "proc": proc, "pgid": os.getpgid(proc.pid),
           "lines": [], "exit": None, "done": False, "aborted": False,
           "timedout": False, "started": time.time()}
    with LOCK:
        RUNS[run_id] = rec

    if schritt:
        fortschritt_schreiben({
            "id": step_id,
            "titel": str(schritt.get("titel") or step_id)[:60],
            "nummer": schritt.get("nummer"),
            "gesamt": schritt.get("gesamt"),
            "laeuft": True,
            "seit": time.time(),
        })

    def pump():
        for line in proc.stdout:
            rec["lines"].append(line.rstrip("\n"))
        proc.wait()
        # Nach JEDEM Schritt auf den Datentraeger schreiben, BEVOR er als fertig
        # gilt. Ein Schritt kann bootkritische Dateien geaendert haben
        # (config.txt, cmdline.txt, systemd-Units); bleiben die im Zwischen-
        # speicher und die Box haengt danach, ist der harte Stromausfall die
        # Regel — und genau die zuletzt geschriebene Datei ist dann zerstoert.
        # Am Geraet passiert: config.txt mit gekappter Cluster-Kette (Box startete
        # nicht mehr) und eine 0-Byte-systemd-Unit (galt als maskiert).
        # Kostet Millisekunden und schuetzt JEDES Rezept, nicht nur die, die
        # daran gedacht haben.
        try:
            os.sync()
        except OSError:
            pass
        rec["exit"] = proc.returncode
        rec["done"] = True
        # Den Stand nachziehen, damit der Schirm zwischen zwei Schritten nicht
        # weiter "laeuft gerade" behauptet. Ein gescheiterter Schritt bleibt
        # ausdruecklich STEHEN — er ist das, was jemand sehen muss.
        if schritt:
            fortschritt_schreiben({
                "id": step_id,
                "titel": str(schritt.get("titel") or step_id)[:60],
                "nummer": schritt.get("nummer"),
                "gesamt": schritt.get("gesamt"),
                "laeuft": False,
                "exit": rec["exit"],
                "abgebrochen": rec["aborted"] or rec["timedout"],
                "seit": time.time(),
            })

    threading.Thread(target=pump, daemon=True).start()

    if timeout:
        def watchdog():
            end = time.time() + float(timeout)
            while time.time() < end and not rec["done"]:
                time.sleep(0.5)
            if not rec["done"]:
                rec["timedout"] = True
                _kill(rec)
        threading.Thread(target=watchdog, daemon=True).start()

    return run_id


def start_lauf_python(step_id, arbeit, timeout=None):
    """Wie `start_run`, aber die Arbeit macht eine PYTHON-Funktion.

    WOFUER: WPS dauert bis zu zwei Minuten (das Zeitfenster des Routers). Als
    synchrone Antwort wuerde der Browser laengst aufgeben, und ein Assistent,
    der zwei Minuten schweigt, sieht aus wie einer, der haengt. Ueber diesen
    Weg haengt sich die Seite mit demselben `EventSource` an wie bei jedem
    anderen Schritt und sieht zu.

    Die Funktion bekommt `melde(zeile)` und schreibt damit in denselben
    Datensatz, den auch ein Unterprozess fuellen wuerde — der Ausgabestrom
    kennt keinen Unterschied.

    KEIN Unterprozess heisst auch: KEINE Prozessgruppe, also kann `/abort`
    hier nichts erschlagen. Deshalb traegt der Datensatz `abbrechbar: False`,
    und die Arbeit muss ihr Zeitlimit SELBST einhalten.
    """
    run_id = secrets.token_hex(8)
    rec = {"id": step_id, "cmd": f"(python) {step_id}", "proc": None, "pgid": None,
           "lines": [], "exit": None, "done": False, "aborted": False,
           "timedout": False, "started": time.time(), "abbrechbar": False}
    with LOCK:
        RUNS[run_id] = rec

    def melde(zeile):
        rec["lines"].append(str(zeile))

    def lauf():
        try:
            ergebnis = arbeit(melde)
            rec["exit"] = 0 if (ergebnis is None or ergebnis.get("ok")) else 1
        except Exception as e:  # noqa: BLE001 — eine Aktion darf den Agenten nie umwerfen
            melde(f"FEHLER {type(e).__name__}: {e}")
            rec["exit"] = 1
        finally:
            rec["done"] = True

    threading.Thread(target=lauf, daemon=True).start()
    return run_id


def _kill(rec):
    try:
        os.killpg(rec["pgid"], signal.SIGKILL)   # the whole subtree — kills any hang
    except ProcessLookupError:
        pass


def abort_run(run_id):
    with LOCK:
        rec = RUNS.get(run_id)
    if rec and not rec["done"]:
        rec["aborted"] = True
        _kill(rec)
        return True
    return False


def search_packages(query):
    """Package lookup — the answer to 'E: Unable to locate package'. Read-only apt
    queries so the controller can offer a real alternative (other name / version /
    suite)."""
    q = shlex.quote(query)
    out = {}
    for label, cmd in (("search", f"apt-cache search --names-only {q}"),
                       ("versions", f"apt-cache policy {q}"),
                       ("candidates", f"apt list -a {q} 2>/dev/null")):
        try:
            r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
            out[label] = ((r.stdout or r.stderr).strip()).splitlines()[:60]
        except Exception as e:
            out[label] = [f"error: {e}"]
    return out


PERF_CMDS = {
    "model": "tr -d '\\0' < /proc/device-tree/model 2>/dev/null || uname -m",
    "uptime": "uptime 2>/dev/null",
    "boot_total": "systemd-analyze 2>/dev/null",
    "boot_blame": "systemd-analyze blame --no-pager 2>/dev/null | head -25",
    "boot_critical": "systemd-analyze critical-chain --no-pager 2>/dev/null | head -30",
    "running": "systemctl list-units --type=service --state=running --no-legend --no-pager 2>/dev/null | awk '{print $1}'",
    "enabled": "systemctl list-unit-files --state=enabled --no-legend --no-pager 2>/dev/null | awk '{print $1}'",
    "timers": "systemctl list-timers --all --no-pager 2>/dev/null | head -20",
    "memory": "free -m 2>/dev/null",
    "top_rss": "ps -eo rss,comm --sort=-rss --no-headers 2>/dev/null | head -15",
    "disk": "df -h / 2>/dev/null",
    "swap": "swapon --show 2>/dev/null",
    "dpkg_big": "dpkg-query -Wf '${Installed-Size}\\t${Package}\\n' 2>/dev/null | sort -rn | head -20",
}


def collect_perf():
    """Read-only boot/runtime snapshot for the controller to analyze + optimize."""
    out = {}
    for k, cmd in PERF_CMDS.items():
        try:
            r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=45)
            out[k] = (r.stdout or "").strip().splitlines()
        except Exception as e:
            out[k] = [f"error: {e}"]
    return out


CONFIG_FILES = [
    "/boot/firmware/config.txt", "/boot/config.txt",
    "/boot/firmware/cmdline.txt", "/boot/cmdline.txt",
    "/boot/dietpi.txt", "/boot/firmware/dietpi.txt",
    "/etc/mupibox/mupiboxconfig.json",
    "/etc/asound.conf",
    "/var/lib/dietpi/dietpi-software/installed/chromium-autostart.sh",
    "/etc/apt/sources.list.d/nodesource.list",
    "/etc/os-release",
    "/proc/device-tree/model",
]
_SECRET = re.compile(
    r'("?(?:client[_-]?secret|password|passwd|token|secret|api[_-]?key|pat|enc)"?\s*[:=]\s*"?)([^"\s,}]+)', re.I)


def _redact(line):
    return _SECRET.sub(lambda m: m.group(1) + "***", line)


def _sh(cmd):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=15)
        return (r.stdout or "").strip()
    except Exception as e:
        return f"error: {e}"


def sysinfo():
    """Detect the environment so the controller/recipes adapt across DietPi/Debian
    versions (paths + codename differ: /boot vs /boot/firmware, DietPi base dir, …)."""
    boot = "/boot/firmware" if os.path.isfile("/boot/firmware/config.txt") else "/boot"
    dpdir = next((d for d in ("/boot/dietpi", "/boot/firmware/dietpi", "/DietPi/dietpi")
                  if os.path.isdir(d)), "")
    dpver = ""
    for vf in ("/boot/dietpi/.version", "/boot/firmware/dietpi/.version", "/DietPi/dietpi/.version"):
        if os.path.isfile(vf):
            try:
                dpver = open(vf).read().strip()
            except OSError:
                pass
            break
    return {
        "codename": _sh(". /etc/os-release 2>/dev/null; printf %s \"$VERSION_CODENAME\""),
        "distro": _sh(". /etc/os-release 2>/dev/null; printf %s \"$PRETTY_NAME\""),
        "debian_version": _sh("cat /etc/debian_version 2>/dev/null"),
        "dietpi_version": dpver.replace("\n", " "),
        "boot_dir": boot,
        "dietpi_dir": dpdir,
        "kernel": _sh("uname -r"),
        "arch": _sh("uname -m"),
        "model": _sh("tr -d '\\0' < /proc/device-tree/model 2>/dev/null || uname -m"),
    }


def read_configs(paths=None):
    """Return the (redacted) contents of key config files for targeted analysis.
    Secrets (Spotify clientSecret, tokens, *Enc, passwords) are masked before they
    leave the box."""
    out = {}
    for p in (paths or CONFIG_FILES):
        try:
            if os.path.isfile(p):
                with open(p, "r", errors="replace") as f:
                    lines = [_redact(x) for x in f.read().splitlines()[:400]]
                out[p] = {"exists": True, "lines": lines}
            else:
                out[p] = {"exists": False, "lines": []}
        except Exception as e:
            out[p] = {"exists": False, "error": str(e), "lines": []}
    return out


DIAG_CMDS = {
    "failed_units":  "systemctl --failed --no-legend --plain 2>/dev/null | head -40",
    "dpkg_audit":    "dpkg --audit 2>/dev/null | head -30",
    "dpkg_broken":   "dpkg -l 2>/dev/null | awk '/^.[^i ]/{print $1,$2}' | head -30",
    "apt_fix_check": "apt-get -s -f install 2>&1 | head -40",
    "disk":          "df -h / /boot /boot/firmware /var /tmp 2>/dev/null",
    "mem":           "free -m 2>/dev/null",
    "journal_err":   "journalctl -p err -b --no-pager 2>/dev/null | tail -40",
    "dmesg_bad":     "dmesg 2>/dev/null | grep -iE 'oom|killed process|segfault|i/o error|under-voltage|voltage|throttl|read-only' | tail -20",
    "apt_lock":      "fuser -v /var/lib/dpkg/lock-frontend /var/lib/apt/lists/lock 2>&1 | head -10",
    "dns":           "getent hosts deb.debian.org 2>/dev/null | head -3 || echo 'DNS: keine Aufloesung'",
}


MAX_PUT_BYTES = 64 * 1024 * 1024        # Deckel gegen versehentliche Riesen-Uploads


def put_file(path, b64, mode=None):
    """Eine Datei vom Controller entgegennehmen (base64) und atomar schreiben.
    Damit lassen sich eigene Pakete (z.B. deploy.zip) installieren, ohne dass die
    Box irgendetwas aus dem Netz holen muss. Der Agent laeuft als root — der Schutz
    ist derselbe wie bei /run (Tunnel + Pair-Code), plus Groessendeckel."""
    import base64
    if not path or not os.path.isabs(path):
        return {"error": "absoluter Pfad noetig"}
    try:
        data = base64.b64decode(b64 or "", validate=True)
    except Exception as e:
        return {"error": f"base64: {e}"}
    if len(data) > MAX_PUT_BYTES:
        return {"error": f"zu gross ({len(data)} > {MAX_PUT_BYTES})"}
    # Rechte VOR dem Schreiben pruefen, und zwar hier: `int(str(mode), 8)` warf
    # bei einem Python-Literal 0o755 eine ValueError ("493" ist kein Oktal), die
    # weiter unten NICHT gefangen wurde. Der Handler starb, und der Aufrufer sah
    # nur "Remote end closed connection without response" — man sucht dann den
    # Fehler im Tunnel statt im eigenen Aufruf. Zeichenkette = oktal ("755"),
    # int = fertiger Modus (0o755), alles andere ein sauberer Fehler.
    m = None
    if mode is not None and mode != "":
        try:
            m = mode if isinstance(mode, int) else int(str(mode), 8)
        except (ValueError, TypeError):
            return {"error": f"mode ungueltig: {mode!r} — oktal als Zeichenkette erwartet, z.B. \"755\""}
        if not 0 <= m <= 0o7777:
            return {"error": f"mode ausserhalb des Bereichs: {mode!r}"}
    try:
        d = os.path.dirname(path)
        if d:
            os.makedirs(d, exist_ok=True)
        tmp = path + ".part"
        with open(tmp, "wb") as f:
            f.write(data)
        if m is not None:
            os.chmod(tmp, m)
        os.replace(tmp, path)
    except (OSError, ValueError) as e:
        return {"error": str(e)}
    return {"ok": True, "path": path, "bytes": len(data)}


def collect_diag(run_id=None):
    """Read-only post-mortem evidence for diagnosing a failure — KNOWN or UNKNOWN.
    Gathers the failed run's output tail plus generic system probes (broken packages,
    failed units, disk/mem, kernel/journal errors, apt lock, DNS). This is what makes
    an unforeseen problem solvable: the controller/LLM reasons over the ACTUAL state,
    not a fixed rule table. Secret-redacted like /config."""
    out = {"probes": {}}
    if run_id:
        with LOCK:
            rec = RUNS.get(run_id)
        if rec:
            out["run"] = {
                "id": rec["id"], "cmd": rec["cmd"], "exit": rec["exit"],
                "aborted": rec["aborted"], "timedout": rec["timedout"],
                "tail": [_redact(x) for x in rec["lines"][-60:]],
            }
    for k, cmd in DIAG_CMDS.items():
        out["probes"][k] = "\n".join(_redact(x) for x in _sh(cmd).splitlines())
    return out


# ---- Die Uebergabe: wann ist der Assistent fertig? ------------------------
# WOZU DAS UEBERHAUPT: Der Assistent hier kann Netz, sonst nichts — und das
# mit Absicht (siehe der Abschnitt ueber benannte Aktionen). Profil,
# Akzentfarbe, Spotify, Jellyfin und die ersten Inhalte kann die BOX SELBST
# laengst, im Eltern-Bereich ihrer eigenen Oberflaeche. Was fehlte, war nur
# die Tuer dorthin: ohne sie endet der Assistent mit "Fertig." und laesst
# jemanden mit einem Handy in der Hand stehen, der nicht weiss, dass es
# weitergeht.
#
# WARUM DER AGENT DAS PRUEFT UND NICHT DIE SEITE: Der Browser des Handys darf
# nicht einfach auf einen anderen Port der Box greifen, um "mal zu schauen"
# (andere Herkunft, und ein Fehlschlag sieht in der Konsole aus wie ein
# Fehler). Der Agent liegt ohnehin auf der Box — fuer ihn ist es ein Verbindungs-
# versuch auf 127.0.0.1.
APP_PORT = 8200          # die Oberflaeche der Box (HTTP). 8443 ist dieselbe ueber TLS.


def app_laeuft(port=APP_PORT, frist=1.0):
    """Antwortet die Box-Oberflaeche schon? Nur ein Verbindungsversuch —
    kein HTTP, kein Inhalt. Mehr braucht die Frage nicht, und weniger koennte
    nicht zwischen "Dienst da" und "Dienst kommt noch" unterscheiden."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=frist):
            return True
    except OSError:
        return False


def eigene_adressen():
    """Die LAN-Adressen der Box, ohne Loopback — fuer den Fall, dass das Handy
    noch im Einrichtungs-WLAN haengt und die Box dort unter 192.168.4.1 kennt,
    im Heimnetz aber unter einer anderen. Dann steht die richtige hier."""
    roh = _sh("ip -o -4 addr show scope global")
    adressen = []
    for zeile in roh.splitlines():
        teile = zeile.split()
        if len(teile) >= 4 and "/" in teile[3]:
            a = teile[3].split("/")[0]
            if a not in adressen:
                adressen.append(a)
    return adressen


def weiter_stand(port=APP_PORT):
    """Was die Assistentenseite braucht, um die Tuer zur Box zu zeigen."""
    return {
        "bereit": app_laeuft(port),
        "port": port,
        "adressen": eigene_adressen(),
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # keep the console clean (the pair code is what matters)
        pass

    # ---- helpers -----------------------------------------------------------
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return {}

    def _authed(self):
        return TOKEN and self.headers.get("Authorization", "") == f"Bearer {TOKEN}"

    def _authed_einricht(self):
        """Voller ODER Einrichtungs-Schluessel — NUR fuer die Einrichtungswege.

        /run, /exec, /put, /shutdown und alles Weitere bleiben bei `_authed`:
        der automatische Schluessel darf einrichten, nie verwalten.
        """
        if self._authed():
            return True
        kopf = self.headers.get("Authorization", "")
        return bool(EINRICHT_TOKEN) and kopf == f"Bearer {EINRICHT_TOKEN}"

    def _authed_strom(self):
        """Wie `_authed`, nimmt aber auch `?token=` an — NUR fuer /stream/.

        WARUM DIE AUSNAHME: Die Assistentenseite haengt sich mit `EventSource`
        an den Ausgabestrom, und EventSource kann KEINE Kopfzeilen setzen — das
        ist eine Festlegung des Browsers, kein Versaeumnis. Ohne diesen Weg
        gaebe es am Handy keine Live-Ausgabe, also genau das, wofuer der
        Assistent da ist.

        WARUM ES VERTRETBAR IST: `/stream/` liefert nur die Ausgabe eines
        bereits gestarteten Laufs — es startet nichts und aendert nichts. Der
        Agent protokolliert keine Anfragen (log_message ist absichtlich leer),
        der Token landet also in keiner Datei. Und er gilt ohnehin nur, bis der
        Agent sich nach der Einrichtung selbst entfernt.

        AUSDRUECKLICH NICHT fuer /run, /put oder /einrichtung/aktion: dort
        bleibt es bei der Kopfzeile. Der Einrichtungs-Schluessel zaehlt hier
        auch — seine Laeufe (WPS, Netz-Pruefung) STREAMEN ja gerade.
        """
        if self._authed():
            return True
        if self._authed_einricht():
            return True
        frage = urllib.parse.urlparse(self.path).query
        gereicht = urllib.parse.parse_qs(frage).get("token", [""])[0]
        if TOKEN and secrets.compare_digest(gereicht, TOKEN):
            return True
        return bool(EINRICHT_TOKEN) and secrets.compare_digest(gereicht, EINRICHT_TOKEN)

    # ---- routing -----------------------------------------------------------
    def do_POST(self):
        p = self.path.rstrip("/")
        if p == "/pair":
            global TOKEN, PAIR_FEHLER, PAIR_ZU
            with LOCK:
                zu = PAIR_ZU
            if zu:
                return self._send(
                    429,
                    {
                        "error": "pairing gesperrt",
                        "hinweis": "Zu viele falsche Codes. Den Agenten neu starten, "
                                   "dann gilt ein neuer Code.",
                    },
                )
            rumpf = self._body()
            # DER ANMELDEFREIE WEG: aus dem eigenen Netz der Box, waehrend der
            # AP laeuft. Er zaehlt NICHT auf den Fehlerdeckel — hier wird kein
            # Code geraten, es gibt nichts zu bremsen.
            if rumpf.get("auto"):
                global EINRICHT_TOKEN
                if auto_pair_erlaubt(self.client_address[0],
                                     os.path.isfile(AP_SSID_DATEI)):
                    EINRICHT_TOKEN = EINRICHT_TOKEN or secrets.token_hex(24)
                    print(f"[agent] einrichtung auto-paired from {self.client_address[0]}")
                    return self._send(200, {"token": EINRICHT_TOKEN,
                                            "umfang": "einrichtung"})
                return self._send(401, {"error": "auto nur im Einrichtungs-WLAN"})
            # Konstante Laufzeit beim Vergleich: sonst verraet die Antwortzeit,
            # wie viele Ziffern schon stimmen.
            geraten = str(rumpf.get("code", ""))
            if secrets.compare_digest(geraten, PAIR_CODE):
                with LOCK:
                    PAIR_FEHLER = 0
                TOKEN = secrets.token_hex(24)
                print(f"[agent] paired OK from {self.client_address[0]}")
                return self._send(200, {"token": TOKEN})
            with LOCK:
                PAIR_FEHLER += 1
                stand = PAIR_FEHLER
                if stand >= PAIR_MAX_FEHLER:
                    PAIR_ZU = True
            print(f"[agent] FALSCHER Pair-Code von {self.client_address[0]} "
                  f"({stand}/{PAIR_MAX_FEHLER})")
            # Wachsende Wartezeit: haelt zwar keinen parallelen Angriff auf,
            # bremst aber das bequeme Durchprobieren und macht es sichtbar.
            time.sleep(min(2.0, 0.25 * stand))
            if stand >= PAIR_MAX_FEHLER:
                return self._send(429, {"error": "pairing gesperrt"})
            return self._send(
                403, {"error": "bad code", "verbleibend": PAIR_MAX_FEHLER - stand}
            )
        # DIE EINRICHTUNGSWEGE nehmen beide Schluessel — der automatische
        # (nur Einrichtung) reicht hier. Alles danach verlangt den vollen.
        if p == "/einrichtung/aktion" or p.startswith("/abort/"):
            if not self._authed_einricht():
                return self._send(401, {"error": "unauthorized"})
            if p.startswith("/abort/"):
                return self._send(200, {"aborted": abort_run(p.split("/", 2)[2])})
            return self._einricht_aktion()
        if not self._authed():
            return self._send(401, {"error": "unauthorized"})
        if p == "/run":
            b = self._body()
            cmd = b.get("cmd")
            if not cmd:
                return self._send(400, {"error": "no cmd"})
            # `schritt` ist reine Anzeige-Beigabe (Nummer/Gesamt/Titel fuer den
            # Bildschirm der Box). Sie darf NICHTS steuern — deshalb wird sie
            # nur weitergereicht und nirgends ausgewertet.
            schritt = b.get("schritt")
            if not isinstance(schritt, dict):
                schritt = None
            rid = start_run(b.get("id", "?"), cmd, b.get("timeout"), schritt=schritt)
            return self._send(200, {"run_id": rid})
        if p == "/search":
            q = (self._body().get("query") or "").strip()
            if not q:
                return self._send(400, {"error": "no query"})
            return self._send(200, {"query": q, "results": search_packages(q)})
        if p == "/config":
            return self._send(200, {"config": read_configs(self._body().get("paths"))})
        if p == "/diagnose":
            return self._send(200, {"diag": collect_diag(self._body().get("run_id"))})
        if p == "/put":
            b = self._body()
            r = put_file(b.get("path"), b.get("b64"), b.get("mode"))
            return self._send(400 if r.get("error") else 200, r)
        if p.startswith("/abort/"):
            return self._send(200, {"aborted": abort_run(p.split("/", 2)[2])})
        if p == "/shutdown":
            remove = bool(self._body().get("remove"))
            self._send(200, {"ok": True, "remove": remove})
            threading.Thread(target=lambda: _shutdown(remove), daemon=True).start()
            return
        self._send(404, {"error": "not found"})

    def _einricht_aktion(self):
        """Der Rumpf von POST /einrichtung/aktion — von der Weiche gerufen,
        die beide Schluessel annimmt."""
        b = self._body()
        name = str(b.get("aktion", ""))
        eintrag = EINRICHT_AKTIONEN.get(name)
        if not eintrag:
            # Kein Hinweis auf gueltige Namen im Fehlertext — die stehen in
            # /einrichtung/aktionen und brauchen hier nicht noch einmal.
            return self._send(400, {"error": f"unbekannte Aktion: {name!r}"})
        # NUR die deklarierten Felder. Alles andere im Rumpf wird
        # WEGGEWORFEN, nicht durchgereicht — sonst waere die Tabelle nur
        # eine Empfehlung.
        werte = {}
        for feld, pruefer in eintrag["felder"].items():
            try:
                werte[feld] = pruefer(str(b.get(feld, "")))
            except ValueError as e:
                return self._send(400, {"error": f"{feld}: {e}"})
        # Zwei Sorten Aktion: eine, die EIN Programm startet und dessen
        # Ausgabe streamt — und eine, die eine kurze Abfolge in Python
        # erledigt und sofort antwortet (die WLAN-Schritte).
        if "python_strom" in eintrag:
            arbeit = eintrag["python_strom"]
            rid = start_lauf_python(name, lambda melde: arbeit(werte, melde))
            return self._send(200, {"run_id": rid})
        if "python" in eintrag:
            try:
                ergebnis = eintrag["python"](werte)
            except Exception as e:  # noqa: BLE001 — eine Aktion darf den Agenten nie umwerfen
                ergebnis = {"ok": False, "fehler": f"{type(e).__name__}: {e}"}
            # Geheime Felder tauchen in der Antwort NIE auf. Sonst stuende
            # das WLAN-Passwort im Browserverlauf des Handys.
            return self._send(200 if ergebnis.get("ok") else 400, ergebnis)
        argv = eintrag["argv"](werte)
        if isinstance(argv, str):  # Bauunfall — nie durch die Shell lassen
            return self._send(500, {"error": "Aktion liefert keine Argumentliste"})
        rid = start_run(name, argv, eintrag.get("timeout"))
        return self._send(200, {"run_id": rid, "argv": argv})

    def do_GET(self):
        # Den Abfrageteil abtrennen: /stream/<id>?token=… ist derselbe Pfad wie
        # /stream/<id>. Ohne das lief die Anfrage der Assistentenseite in den
        # 404-Zweig.
        p = urllib.parse.urlparse(self.path).path.rstrip("/")
        # Die Assistentenseite kommt OHNE Token — sie ist das, was den Token
        # erst besorgt (sie fragt nach dem Code, der auf dem Schirm der Box
        # steht). Sie enthaelt nichts Geheimes; der Code steht nicht darin.
        if p in ("/einrichtung", ""):
            return self._einrichtungsseite()
        if p == "/einrichtung/mixpi.png":
            return self._einrichtungsbild()
        if p.startswith("/stream/"):
            if not self._authed_strom():
                return self._send(401, {"error": "unauthorized"})
            return self._stream(p.split("/", 2)[2])
        if p in ("/einrichtung/aktionen", "/einrichtung/weiter"):
            if not self._authed_einricht():
                return self._send(401, {"error": "unauthorized"})
            if p == "/einrichtung/weiter":
                return self._send(200, weiter_stand())
        if not self._authed() and not (p == "/einrichtung/aktionen"
                                       and self._authed_einricht()):
            return self._send(401, {"error": "unauthorized"})
        if p == "/einrichtung/aktionen":
            return self._send(
                200,
                {
                    # Felder in der REIHENFOLGE IHRER DEKLARATION, nicht
                    # alphabetisch: sonst fragt das Formular erst nach dem
                    # WLAN-Passwort und dann nach dem Namen (gesehen im
                    # Browser). Python behaelt die Einfuegereihenfolge bei.
                    "aktionen": [
                        {"name": k, "titel": v["titel"], "felder": list(v["felder"])}
                        for k, v in EINRICHT_AKTIONEN.items()
                    ]
                },
            )
        if p == "/einrichtung/weiter":
            return self._send(200, weiter_stand())
        if p == "/status":
            with LOCK:
                runs = {k: {"id": r["id"], "done": r["done"], "exit": r["exit"],
                            "aborted": r["aborted"], "timedout": r["timedout"],
                            "lines": len(r["lines"])} for k, r in RUNS.items()}
            return self._send(200, {"ok": True, "runs": runs})
        if p == "/perf":
            return self._send(200, {"perf": collect_perf()})
        if p == "/sysinfo":
            return self._send(200, {"sysinfo": sysinfo()})
        if p.startswith("/stream/"):
            return self._stream(p.split("/", 2)[2])
        self._send(404, {"error": "not found"})

    def _einrichtungsseite(self):
        """Die Seite fuers Handy — aus einer Datei neben dem Agenten.

        NICHT im Python-Quelltext eingebettet: eine Seite mit Stil und Skript
        als Zeichenkette in agent.py waere unlesbar und beim Aendern jedes Mal
        ein Ausflug ins Escaping. Fehlt die Datei, sagt der Agent das
        deutlich, statt eine leere Seite zu liefern.
        """
        pfad = os.path.join(os.path.dirname(os.path.abspath(__file__)), "einrichtung.html")
        try:
            with open(pfad, "rb") as f:
                inhalt = f.read()
        except OSError:
            inhalt = (
                "<!doctype html><meta charset=utf-8><title>Einrichtung</title>"
                "<body style='font-family:sans-serif;background:#121212;color:#eaf1f8;"
                "padding:2rem'><h1>Assistent fehlt</h1><p>Neben <code>agent.py</code> "
                "liegt keine <code>einrichtung.html</code>. Sie gehoert mit dem Agenten "
                "auf die Box (install-agent.sh kopiert sie mit, wenn sie da ist)."
            ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(inhalt)))
        # Der Assistent laeuft im Heimnetz, aber die Seite soll nichts von
        # aussen nachladen duerfen — sie ist vollstaendig in sich.
        self.send_header(
            "Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self'",
        )
        self.end_headers()
        self.wfile.write(inhalt)

    def _einrichtungsbild(self):
        """MixPi fuer die Handyseite. Fehlt das Bild, laeuft die Seite ohne —
        die Seite blendet es dann selbst aus."""
        pfad = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "einrichtung-mixpi.png"
        )
        try:
            with open(pfad, "rb") as f:
                inhalt = f.read()
        except OSError:
            return self._send(404, {"error": "kein Bild"})
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(inhalt)))
        self.send_header("Cache-Control", "max-age=3600")
        self.end_headers()
        self.wfile.write(inhalt)

    def _stream(self, run_id):
        with LOCK:
            rec = RUNS.get(run_id)
        if not rec:
            return self._send(404, {"error": "no such run"})
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        cursor = 0
        try:
            while True:
                lines = rec["lines"]
                while cursor < len(lines):
                    payload = json.dumps({"line": lines[cursor]})
                    self.wfile.write(f"data: {payload}\n\n".encode())
                    self.wfile.flush()
                    cursor += 1
                if rec["done"]:
                    end = json.dumps({"exit": rec["exit"], "aborted": rec["aborted"],
                                      "timedout": rec["timedout"]})
                    self.wfile.write(f"event: done\ndata: {end}\n\n".encode())
                    self.wfile.flush()
                    return
                time.sleep(0.2)
        except (BrokenPipeError, ConnectionResetError):
            return


def _shutdown(remove):
    time.sleep(0.4)
    if remove:
        try:
            os.remove(SELF_PATH)
        except OSError:
            pass
        # best-effort: drop a systemd unit if one was installed by install-agent.sh
        for unit in ("/etc/systemd/system/step-agent.service",):
            try:
                os.remove(unit)
            except OSError:
                pass
    print("[agent] shutting down" + (" + self-removed" if remove else ""))
    os._exit(0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1", help="127.0.0.1 (default, use SSH tunnel) or 0.0.0.0 (LAN)")
    ap.add_argument("--port", type=int, default=8099)
    ap.add_argument("--paircode-file", default="",
                    help="Pair-Code zusaetzlich hier ablegen (0600) — der Controller holt ihn "
                         "so zuverlaessig ab, statt ihn aus dem Journal zu fischen (DietPi=RAMlog)")
    args = ap.parse_args()

    try:
        srv = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as e:
        # Klartext statt Traceback — der häufigste Fall ist ein bereits laufender Agent.
        hint = (f"Port {args.port} ist belegt — läuft schon ein Agent?\n"
                f"  pruefen:  ss -ltnp | grep {args.port}\n"
                f"  beenden:  pkill -f 'agent.py --port {args.port}'\n"
                f"  oder einen anderen Port nehmen:  --port {args.port + 1}"
                if getattr(e, "errno", None) == 98 else str(e))
        sys.exit(f"[agent] Start nicht moeglich: {hint}")
    # Pair-Code ERST JETZT ablegen — der Socket steht bereits (server_bind lief im
    # Konstruktor). Vorher geschrieben waere die Datei ein LUEGENDES Bereitschafts-
    # signal: der Installer meldet "fertig", der Controller pairt sofort, und die
    # Verbindung wird zurueckgewiesen, weil noch niemand lauscht.
    if args.paircode_file:
        try:
            d = os.path.dirname(args.paircode_file)
            if d:
                os.makedirs(d, exist_ok=True)
            with open(args.paircode_file, "w") as f:
                f.write(PAIR_CODE + "\n")
            os.chmod(args.paircode_file, 0o600)
        except OSError as e:
            print(f"[agent] Pair-Code-Datei nicht schreibbar: {e}")

    print("=" * 48)
    print(f"  remote-step-installer AGENT on {args.host}:{args.port}")
    print(f"  PAIR CODE:  {PAIR_CODE}")
    print("  (enter this in the controller to connect)")
    print("=" * 48, flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
