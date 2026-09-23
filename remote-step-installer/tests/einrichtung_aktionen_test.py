#!/usr/bin/env python3
"""
Tests fuer die benannten Aktionen des Einrichtungsassistenten — gegen einen
ECHTEN Agenten.

WORUM ES GEHT: `/run` nimmt eine beliebige Befehlszeile und schickt sie durch
eine Shell. Fuer den Controller ist das richtig — wer im SSH-Tunnel sitzt, hat
die Box ohnehin. Der Assistent laeuft aber in einem BROWSER auf einem Handy im
WLAN. Bekaeme der `/run`, waere jedes Formularfeld eine Wurzelschale.

Deshalb `/einrichtung/aktion`: der Browser nennt einen NAMEN, und was daraus
wird, steht ausschliesslich in der Tabelle im Agenten. Geprueft wird hier
genau das — und zwar nicht, dass es „funktioniert", sondern dass es sich NICHT
umgehen laesst:

  * ein unbekannter Name startet gar nichts,
  * ein Wert, der wie ein Befehl aussieht, wird abgewiesen statt ausgefuehrt,
  * Felder, die nicht in der Tabelle stehen, werden weggeworfen.

  python3 tests/einrichtung_aktionen_test.py
"""
import atexit
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ok = bad = 0


def pruefe(bedingung, was, hinweis=""):
    global ok, bad
    if bedingung:
        ok += 1
        print(f"  ok    {was}")
    else:
        bad += 1
        print(f"  FEHL  {was}")
        if hinweis:
            print(f"        {hinweis}")


def freier_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


PORT = freier_port()
proc = subprocess.Popen(
    [sys.executable, REPO + "/agent/agent.py", "--port", str(PORT)],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
)
atexit.register(lambda: proc.poll() is None and proc.terminate())
CODE = None
_t0 = time.time()
while time.time() - _t0 < 10:
    m = re.search(r"PAIR CODE:\s+(\d{6})", proc.stdout.readline() or "")
    if m:
        CODE = m.group(1)
        break
if not CODE:
    sys.exit("kein Pair-Code — kam der Agent hoch?")

BASIS = f"http://127.0.0.1:{PORT}"


def hole(pfad, rumpf=None, token=None, roh=False):
    daten = json.dumps(rumpf).encode() if rumpf is not None else None
    kopf = {"Content-Type": "application/json"}
    if token:
        kopf["Authorization"] = f"Bearer {token}"
    a = urllib.request.Request(BASIS + pfad, data=daten, headers=kopf)
    try:
        with urllib.request.urlopen(a, timeout=20) as r:
            inhalt = r.read()
            return r.status, (inhalt if roh else json.loads(inhalt or b"{}"))
    except urllib.error.HTTPError as e:
        inhalt = e.read()
        return e.code, (inhalt if roh else json.loads(inhalt or b"{}"))


TOKEN = hole("/pair", {"code": CODE})[1]["token"]

print("── 1. Die Seite kommt OHNE Token, alles andere nicht")
status, inhalt = hole("/einrichtung", roh=True)
pruefe(status == 200, f"/einrichtung ohne Token -> 200 (war {status})")
pruefe(b"<" in inhalt, "es kommt HTML zurueck")
status, _ = hole("/einrichtung/aktionen")
pruefe(status == 401, f"/einrichtung/aktionen ohne Token -> 401 (war {status})")
status, antwort = hole("/einrichtung/aktionen", token=TOKEN)
pruefe(status == 200 and antwort.get("aktionen"), "mit Token kommt die Liste")

print("── 2. Ein unbekannter Name startet GAR NICHTS")
vorher = len(hole("/status", token=TOKEN)[1]["runs"])
status, antwort = hole("/einrichtung/aktion", {"aktion": "gibt-es-nicht"}, TOKEN)
pruefe(status == 400, f"unbekannte Aktion -> 400 (war {status})")
nachher = len(hole("/status", token=TOKEN)[1]["runs"])
pruefe(vorher == nachher, "und es wurde kein Lauf angelegt", f"{vorher} -> {nachher}")

print("── 3. Eine bekannte Aktion laeuft")
status, antwort = hole("/einrichtung/aktion", {"aktion": "netz-geraete"}, TOKEN)
pruefe(status == 200 and antwort.get("run_id"), f"netz-geraete -> 200 (war {status})")
pruefe(
    isinstance(antwort.get("argv"), list),
    "die Antwort nennt eine ARGUMENTLISTE, keine Befehlszeile",
    f"argv: {antwort.get('argv')!r}",
)

print("── 4. Ein Wert, der wie ein Befehl aussieht, wird abgewiesen")
# DER FALL, um den es wirklich geht. In einer Zeichenkette waere das ein
# zweiter Befehl; als Listenelement waere es nur ein Wort — abgewiesen wird es
# trotzdem, weil ein Schnittstellenname so nicht aussieht. Zwei Schranken.
for boese in ("wlan0; rm -rf /", "wlan0 && reboot", "$(reboot)", "../../etc/passwd", ""):
    status, antwort = hole(
        "/einrichtung/aktion", {"aktion": "wlan-suchen", "geraet": boese}, TOKEN
    )
    pruefe(status == 400, f"abgewiesen: {boese!r} (war {status})", f"Antwort: {antwort}")

print("── 5. Auch ein ECHTER, aber nicht vorhandener Name wird abgewiesen")
status, antwort = hole(
    "/einrichtung/aktion", {"aktion": "wlan-suchen", "geraet": "wlan99"}, TOKEN
)
pruefe(status == 400, f"wlan99 gibt es nicht -> 400 (war {status})")
pruefe(
    "wlan99" in json.dumps(antwort),
    "und die Meldung sagt, welche Schnittstelle gemeint war",
    f"Antwort: {antwort}",
)

print("── 6. Felder, die nicht in der Tabelle stehen, werden WEGGEWORFEN")
# Sonst waere die Tabelle nur eine Empfehlung: wer `cmd` mitschickt, haette
# wieder /run — nur durch die Hintertuer.
status, antwort = hole(
    "/einrichtung/aktion",
    {"aktion": "netz-geraete", "cmd": "touch /tmp/durchgerutscht", "geraet": "; reboot"},
    TOKEN,
)
pruefe(status == 200, f"die bekannte Aktion laeuft trotzdem (war {status})")
lauf = antwort.get("run_id")
time.sleep(0.6)
_, diag = hole("/diagnose", {"run_id": lauf}, TOKEN)
befehl = diag.get("diag", {}).get("run", {}).get("cmd", "")
pruefe(
    "durchgerutscht" not in befehl and "reboot" not in befehl,
    "nichts davon steht im ausgefuehrten Befehl",
    f"cmd war: {befehl!r}",
)
pruefe(
    not os.path.exists("/tmp/durchgerutscht"),
    "und die Datei aus dem Schmuggelfeld gibt es nicht",
)

print("── 7. WLAN: geprueft wird VOR wpa_cli, nicht danach")
# ACHTUNG, UND DESHALB STEHT HIER NUR DIE ABWEISUNG: Dieser Rechner hat eine
# echte Funkschnittstelle. Ein GUELTIGER Verbindungsversuch wuerde `wpa_cli`
# wirklich aufrufen und das WLAN des Entwicklungsrechners umstellen. Ein Test
# darf die Maschine nicht umkonfigurieren, auf der er laeuft.
#
# Was hier geprueft wird, ist genau die Schranke davor: ungueltige Werte enden
# mit 400, BEVOR irgendein wpa_cli-Aufruf passiert. Die Grenzen selbst
# (32 Byte, 8..63 Zeichen) sind in tests/... nicht doppelt zu pruefen — sie
# stehen in agent.py und stammen aus src/backend-api/src/netzwerk.ts.
boese_ssid = [
    ("", "leer"),
    ("a" * 33, "zu lang"),
    ('netz"; reboot', "Anfuehrungszeichen"),
    ("netz\\pfad", "Rueckstrich"),
    ("mit\nZeile", "Steuerzeichen"),
    ("ä" * 17, "34 Byte trotz 17 Zeichen"),
]
for wert, warum in boese_ssid:
    status, antwort = hole(
        "/einrichtung/aktion",
        {"aktion": "wlan-verbinden", "ssid": wert, "psk": "geheim123"},
        TOKEN,
    )
    pruefe(status == 400, f"SSID abgewiesen ({warum})", f"war {status}: {antwort}")

for wert, warum in [("kurz", "unter 8 Zeichen"), ("x" * 64, "ueber 63"), ('hat"zitat!', "Zitat")]:
    status, antwort = hole(
        "/einrichtung/aktion",
        {"aktion": "wlan-verbinden", "ssid": "EinNetz", "psk": wert},
        TOKEN,
    )
    pruefe(status == 400, f"Passwort abgewiesen ({warum})", f"war {status}: {antwort}")

print("── 8. Das Passwort taucht in KEINER Antwort auf")
# Sonst stuende es im Browserverlauf des Handys und in jedem Mitschnitt.
GEHEIM = "streng-geheim-42"
status, antwort = hole(
    "/einrichtung/aktion",
    {"aktion": "wlan-verbinden", "ssid": "a" * 33, "psk": GEHEIM},
    TOKEN,
)
pruefe(GEHEIM not in json.dumps(antwort), "nicht in der Fehlerantwort", f"Antwort: {antwort}")
_, alle = hole("/status", token=TOKEN)
pruefe(GEHEIM not in json.dumps(alle), "nicht in der Laufliste")

print("── 9. WPS ist da — aber wird hier NICHT ausgeloest")
# `wlan-wps` ruft `wpa_cli wps_pbc` auf der ECHTEN Funkschnittstelle auf. Auf
# dem Entwicklungsrechner wuerde das dessen WLAN-Verbindung anfassen. Geprueft
# wird deshalb nur, DASS es die Aktion gibt und dass sie hinter dem Tor liegt.
_, liste = hole("/einrichtung/aktionen", token=TOKEN)
namen = [a["name"] for a in liste["aktionen"]]
pruefe("wlan-wps" in namen, "wlan-wps steht in der Liste")
status, _ = hole("/einrichtung/aktion", {"aktion": "wlan-wps"})
pruefe(status == 401, f"ohne Token -> 401 (war {status})")

print("── 10. Die Streaming-Mechanik fuer lange Schritte (ohne WPS)")
# Direkt am Modul geprueft, nicht ueber HTTP: so laesst sich die Mechanik
# pruefen, ohne die Funkschnittstelle anzufassen.
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location("ag", REPO + "/agent/agent.py")
ag = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ag)

def arbeit(melde):
    melde("erste Zeile")
    melde("zweite Zeile")
    return {"ok": True}

rid = ag.start_lauf_python("probe", arbeit)
for _ in range(50):
    if ag.RUNS[rid]["done"]:
        break
    time.sleep(0.05)
satz = ag.RUNS[rid]
pruefe(satz["done"], "der Lauf endet")
pruefe(satz["lines"] == ["erste Zeile", "zweite Zeile"], "die Zeilen kommen an", f"{satz['lines']}")
pruefe(satz["exit"] == 0, f"Erfolg wird als Rueckgabewert 0 gemeldet (war {satz['exit']})")
pruefe(satz["abbrechbar"] is False, "als nicht abbrechbar markiert — es gibt keine Prozessgruppe")

def kaputt(melde):
    melde("los")
    raise RuntimeError("geplatzt")

rid2 = ag.start_lauf_python("probe2", kaputt)
for _ in range(50):
    if ag.RUNS[rid2]["done"]:
        break
    time.sleep(0.05)
satz2 = ag.RUNS[rid2]
pruefe(satz2["exit"] == 1, "ein Fehler endet mit Rueckgabewert 1")
pruefe(
    any("geplatzt" in z for z in satz2["lines"]),
    "und der Grund steht im Strom, statt still verlorenzugehen",
    f"{satz2['lines']}",
)

print("── 11. `wpa_cli status` wird richtig zerlegt")
ag._wpa = lambda iface, args, frist=15: (
    0, "bssid=aa:bb\nssid=MeinNetz\nwpa_state=COMPLETED\nip_address=192.168.1.42"
)
stand = ag._wpa_stand("wlan0")
pruefe(stand.get("wpa_state") == "COMPLETED", "wpa_state gelesen")
pruefe(stand.get("ip_address") == "192.168.1.42", "Adresse gelesen")
pruefe(stand.get("ssid") == "MeinNetz", "Netzname gelesen")

print("── 12. Das Gateway aus /proc/net/route — LITTLE ENDIAN")
# DIE FALLE: die Datei nennt die Adresse als Hexzahl in umgekehrter
# Byte-Reihenfolge. `0100A8C0` ist 192.168.0.1, NICHT 1.0.168.192. Wer nicht
# dreht, pingt eine Adresse, die es nicht gibt, und haelt das Netz fuer kaputt.
PROBE = (
    "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\n"
    "wlan0\t00000000\t0100A8C0\t0003\t0\t0\t600\t00000000\n"
    "wlan0\t0000A8C0\t00000000\t0001\t0\t0\t600\t00FFFFFF"
)
pruefe(ag.gateway_lesen(PROBE) == "192.168.0.1", "0100A8C0 -> 192.168.0.1")
pruefe(
    ag.gateway_lesen(PROBE.replace("0100A8C0", "FE01A8C0")) == "192.168.1.254",
    "FE01A8C0 -> 192.168.1.254",
)
pruefe(ag.gateway_lesen("Iface\tDestination\tGateway\n") is None, "ohne Standardroute: None")
pruefe(
    ag.gateway_lesen(PROBE.replace("00000000\t0100A8C0", "0000A8C0\t0100A8C0")) is None,
    "eine Route, die KEINE Standardroute ist, zaehlt nicht",
)

print("── 13. Die Selbstpruefung laeuft und meldet drei Stufen")
# Sie ist rein lesend (Adresse ablesen, Gateway pingen, eine Verbindung nach
# draussen versuchen) — die darf ein Test auch auf diesem Rechner ausfuehren.
status, antwort = hole("/einrichtung/aktion", {"aktion": "netz-pruefen"}, TOKEN)
pruefe(status == 200 and antwort.get("run_id"), f"netz-pruefen startet (war {status})")
lauf2 = antwort.get("run_id")
for _ in range(60):
    _, st = hole("/status", token=TOKEN)
    if st["runs"].get(lauf2, {}).get("done"):
        break
    time.sleep(0.5)
_, diag2 = hole("/diagnose", {"run_id": lauf2}, TOKEN)
zeilen = diag2.get("diag", {}).get("run", {}).get("tail", [])
text = "\n".join(zeilen)
pruefe("1. Adresse" in text, "Stufe 1 gemeldet", text[:200])
pruefe("2. Gateway" in text, "Stufe 2 gemeldet", text[:200])
pruefe("3. Internet" in text, "Stufe 3 gemeldet", text[:200])


# ── Anmeldefrei NUR aus dem eigenen Netz der Box ───────────────────────────
# Wer im Einrichtungs-WLAN steht, hat seine Naehe bewiesen — der Code waere
# dieselbe Tuer zweimal. Aber die GRENZEN muessen halten: kein AP, kein
# Freifahrtschein; fremdes Netz, kein Freifahrtschein.
import importlib.util as _ilu
_spec = _ilu.spec_from_file_location("agmod", os.path.join(REPO, "agent", "agent.py"))
_ag = _ilu.module_from_spec(_spec); _spec.loader.exec_module(_ag)
pruefe(_ag.auto_pair_erlaubt("192.168.4.23", True) is True,
       "aus dem AP-Netz, AP laeuft: ohne Code hinein")
pruefe(_ag.auto_pair_erlaubt("192.168.4.23", False) is False,
       "AP laeuft NICHT: die Adresse allein ist eine Behauptung")
pruefe(_ag.auto_pair_erlaubt("192.168.178.44", True) is False,
       "aus dem Heimnetz: Code bleibt Pflicht (dort hoeren mehr mit)")
pruefe(_ag.auto_pair_erlaubt("127.0.0.1", True) is False,
       "localhost bekommt nichts geschenkt")


# ── Die Uebergabe ins Heimnetz: die puren Teile ────────────────────────────
# Der Ablauf selbst braucht Funk und root — aber was er SCHREIBT, entscheidet
# ueber jeden kuenftigen Start der Box, und das ist ohne beides pruefbar.
wp = _ag.wpa_persist_text("Heimnetz", "geheim123")
pruefe('ssid="Heimnetz"' in wp and 'psk="geheim123"' in wp,
       "wpa_supplicant.conf: Netz und Schluessel stehen drin")
pruefe("update_config=1" in wp and "country=" in wp,
       "  mit Kopf (update_config, country) — sonst meckert wpa_cli spaeter")
pruefe("key_mgmt=NONE" in _ag.wpa_persist_text("Offen", ""),
       "  offenes Heimnetz: key_mgmt=NONE statt leerem psk")

ifc = _ag.interfaces_wlan_an("# DietPi\n#allow-hotplug wlan0\niface wlan0 inet dhcp\n"
                             "wpa-conf /etc/wpa_supplicant/wpa_supplicant.conf\n")
pruefe("\n" + "allow-hotplug wlan0" in "\n" + ifc and "#allow-hotplug" not in ifc,
       "interfaces: die auskommentierte wlan-Zeile wird wieder scharf")
ifc2 = _ag.interfaces_wlan_an("auto eth0\niface eth0 inet dhcp\n")
pruefe("allow-hotplug wlan0" in ifc2 and "wpa-conf" in ifc2,
       "  fehlt jede wlan-Zeile, kommt ein ganzer Block dazu")


# ── Der Wechsel-Ablauf: zwei Fallen, beide vom Geraet ──────────────────────
import inspect as _insp2
_wsrc = _insp2.getsource(_ag.wechsel_aus_ap)
# 1) ap_scan=2 (AP-Betrieb) verhindert im Client-Betrieb die Netzsuche — die
#    Verbindung scheiterte mit RICHTIGEM Passwort.
pruefe(_wsrc.index('"ap_scan", "1"') < _wsrc.index('select_network", kennung'),
       "vor dem Wechsel wird ap_scan=1 gesetzt (sonst sucht der Client nie)")
pruefe('"ap_scan", "2"' in _wsrc,
       "  und der Rueckweg stellt ap_scan=2 wieder her (sonst kein AP mehr)")
# 2) Unmittelbar nach dem Umschalten meldet der Status noch das COMPLETED
#    des eigenen AP — Erfolg ist erst COMPLETED MIT dem Zielnetz.
pruefe('stand.get("ssid") == ssid' in _wsrc,
       "Erfolg nur, wenn das VERBUNDENE Netz auch das Zielnetz ist")

print()
print(f"{ok} in Ordnung, {bad} gebrochen")
proc.terminate()
sys.exit(1 if bad else 0)
