#!/usr/bin/env python3
"""
Tests fuer controller/sdwlan.py — pure Teile, KEIN Schreiben auf Datentraeger.

Der wichtigste Block ist die PSK-Rechnung. Ein falscher Hash ist der teuerste
Fehler dieses Moduls: er faellt nicht beim Schreiben auf, sondern erst, wenn
die Box nach dem Neustart nicht mehr ins Netz kommt — und dann steckt die
Karte schon wieder im Geraet. Deshalb wird gegen die veroeffentlichten
IEEE-802.11i-Testvektoren geprueft UND, wo vorhanden, live gegen
`wpa_passphrase` als unabhaengige Umsetzung.

Danach die Schutzbedingung: `ist_kartenwurzel` muss '/' abweisen. Ein Fehler
dort veraendert die wpa_supplicant.conf des LAUFENDEN Rechners.

  python3 tests/sdwlan_test.py       # exit 0 = alles gruen
"""
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "controller"))
import sdwlan  # noqa: E402

ok = bad = 0


def chk(name, cond):
    global ok, bad
    print(("  \033[32mOK  \033[0m" if cond else "  \033[31mFAIL\033[0m") + "  " + name)
    ok += bool(cond)
    bad += (not cond)


# ── PSK: gegen eine fremde Umsetzung, nicht gegen uns selbst ──────────────
# Quelle der Sollwerte: wpa_passphrase (wpa_supplicant), NICHT sdwlan — sonst
# pruefte der Test die Rechnung gegen sich selbst.
VEKTOREN = [
    ("IEEE", "password",
     "f42c6fc52df0ebef9ebb4b90b38a5f902e83fe1b135a70e23aed762e9710a12e"),
    ("ThisIsASSID", "ThisIsAPassword",
     "0dc0d6eb90555ed6419756b9a15ec3e3209b63df707dd508d14581f8982721af"),
]
for ssid, pw, soll in VEKTOREN:
    chk(f"PSK stimmt fuer ssid={ssid!r}", sdwlan.psk_hash(ssid, pw) == soll)

chk("SSID ist das Salz (gleiches Passwort, anderes Netz -> anderer PSK)",
    sdwlan.psk_hash("NetzA", "geheim123") != sdwlan.psk_hash("NetzB", "geheim123"))
chk("PSK ist 64 Hex-Zeichen",
    len(sdwlan.psk_hash("x", "y")) == 64 and all(c in "0123456789abcdef" for c in sdwlan.psk_hash("x", "y")))
chk("Umlaute im Passwort brechen nicht (UTF-8)",
    len(sdwlan.psk_hash("Netz", "füü-schlüssel")) == 64)

if shutil.which("wpa_passphrase"):
    r = subprocess.run(["wpa_passphrase", "LiveNetz", "einprobepasswort"],
                       capture_output=True, text=True)
    fremd = ""
    for z in (r.stdout or "").splitlines():
        if z.strip().startswith("psk=") and not z.strip().startswith("#"):
            fremd = z.strip()[4:]
    chk("stimmt live mit wpa_passphrase ueberein",
        fremd == sdwlan.psk_hash("LiveNetz", "einprobepasswort"))
else:
    print("  \033[33m--  \033[0m  wpa_passphrase nicht da, Live-Vergleich uebersprungen")

# NetworkManager legt je nach Netz die Passphrase ODER den fertigen PSK ab.
FERTIG = "A" * 64
chk("fertiger 64-Hex-PSK wird durchgereicht, nicht nochmal gehasht",
    sdwlan.psk_aus(FERTIG, "egal") == FERTIG.lower())
chk("Passphrase wird gehasht", sdwlan.psk_aus("password", "IEEE") == VEKTOREN[0][2])
chk("63 Hex-Zeichen sind KEIN PSK, sondern eine Passphrase",
    sdwlan.psk_aus("a" * 63, "N") == sdwlan.psk_hash("N", "a" * 63))

# ── Netzblock ─────────────────────────────────────────────────────────────
b = sdwlan.netzblock("MeinNetz", "ab" * 32, priority=2)
chk("Block nennt die SSID in Anfuehrungszeichen", '\tssid="MeinNetz"' in b)
chk("Block traegt den PSK ohne Anfuehrungszeichen", "\tpsk=" + "ab" * 32 in b)
chk("Block traegt den Vorrang", "\tpriority=2" in b)
chk("Block ist geschlossen", b.strip().startswith("network={") and b.strip().endswith("}"))
chk("priority=0 laesst die Zeile weg",
    "priority" not in sdwlan.netzblock("N", "cd" * 32, priority=0))

# ── vorhandene Datei lesen/ergaenzen ──────────────────────────────────────
BESTAND = (
    "country=DE\n"
    "ctrl_interface=DIR=/run/wpa_supplicant GROUP=netdev\n"
    "update_config=1\n"
    "network={\n"
    '\tssid="AltesNetz"\n'
    "\tscan_ssid=1\n"
    "\tkey_mgmt=WPA-PSK\n"
    "\tpsk=" + "11" * 32 + "\n"
    "}\n"
)
chk("bekannte_netze findet das vorhandene", sdwlan.bekannte_netze(BESTAND) == ["AltesNetz"])

neu, geaendert = sdwlan.ergaenzen(BESTAND, "NeuesNetz", "22" * 32)
chk("Ergaenzen meldet die Aenderung", geaendert)
chk("das alte Netz bleibt stehen", "AltesNetz" in sdwlan.bekannte_netze(neu))
chk("das neue kommt dazu", sdwlan.bekannte_netze(neu) == ["AltesNetz", "NeuesNetz"])
chk("der Kopf bleibt unangetastet", neu.startswith("country=DE\n"))

# Zweiter Lauf darf nichts verdoppeln — sonst waechst die Datei bei jedem Umzug.
nochmal, geaendert2 = sdwlan.ergaenzen(neu, "NeuesNetz", "22" * 32)
chk("zweiter Lauf aendert nichts", not geaendert2 and nochmal == neu)

ohne_nl, _ = sdwlan.ergaenzen("update_config=1", "N", "33" * 32)
chk("fehlender Zeilenumbruch am Ende klebt nichts zusammen",
    "update_config=1\n" in ohne_nl and "network={" in ohne_nl)
leer, _ = sdwlan.ergaenzen("", "N", "44" * 32)
chk("leere Datei ergibt eine gueltige", leer.lstrip().startswith("network={"))

# ── Maskierung: der Hash ist so gut wie das Passwort ──────────────────────
m = sdwlan.maskiert(neu)
chk("Hash erscheint nicht in der Anzeige", "22" * 32 not in m and "11" * 32 not in m)
chk("SSIDs bleiben lesbar", "NeuesNetz" in m)
# wpa_supplicant erlaubt den Schluessel auch im Klartext; eine fremde Datei
# kann ihn also so enthalten. Der WERT muss weg, das Feld darf bleiben.
_klar = sdwlan.maskiert('\tpsk="geheim"\n')
chk("auch ein Klartext-psk wird maskiert",
    "geheim" not in _klar and '<klartext>' in _klar)

# ── Schutz: niemals das laufende System ───────────────────────────────────
chk("'/' wird abgewiesen", not sdwlan.ist_kartenwurzel("/"))
chk("Heimatverzeichnis wird abgewiesen", not sdwlan.ist_kartenwurzel(os.path.expanduser("~")))
chk("leerer Pfad wird abgewiesen", not sdwlan.ist_kartenwurzel(""))

with tempfile.TemporaryDirectory() as t:
    # ERLAUBTE_ORTE wird zur LAUFZEIT gelesen (kein Standardargument), damit der
    # Test gegen ein Wegwerfverzeichnis laufen kann statt gegen echte Karten —
    # dieselbe Lehre wie bei bootwache.bootdir().
    merk = sdwlan.ERLAUBTE_ORTE
    sdwlan.ERLAUBTE_ORTE = (t,)
    try:
        chk("ohne etc/mupibox: keine Karte", not sdwlan.ist_kartenwurzel(t))
        os.makedirs(os.path.join(t, "etc", "mupibox"))
        chk("mit etc/mupibox: als Karte erkannt", sdwlan.ist_kartenwurzel(t))
    finally:
        sdwlan.ERLAUBTE_ORTE = merk
    chk("nach dem Zuruecksetzen wieder abgewiesen (Ort zaehlt, nicht nur der Marker)",
        not sdwlan.ist_kartenwurzel(t))

# schreiben() darf ohne gueltige Wurzel gar nicht erst zum Rechte-Helfer kommen
erg = sdwlan.schreiben("/", "N", "55" * 32, interactive=False)
chk("schreiben() verweigert '/' ohne Rechteanfrage",
    erg.get("ok") is False and "MuPiBox" in erg.get("grund", ""))

print(f"\n{ok}/{ok + bad} bestanden")
sys.exit(1 if bad else 0)
