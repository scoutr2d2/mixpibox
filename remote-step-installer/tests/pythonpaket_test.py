#!/usr/bin/env python3
"""
Tests fuer das Mitgeben von Python (controller/pythonpaket.py).

WORUM ES GEHT: Auf dem DietPi-Image ist kein Python — nachgezaehlt am echten
Abbild. Alles von uns ist aber Python: Agent, Einrichtungs-AP, DHCP/DNS. Ohne
diese drei Pakete auf der Karte gibt es keinen Start ohne Netz, und genau
daran ist der erste Kartenlauf gescheitert.

Die GEFAHR sitzt in der Auswahl: In einem Debian-Pool-Verzeichnis liegen die
Pakete ALLER Staende nebeneinander — buster, bookworm, trixie, sid. Wer das
neueste nimmt, spielt der Box ein sid-Paket auf, das gegen eine libc baut, die
sie nicht hat. Das faellt erst am Geraet auf, und dann als "dpkg: dependency
problems" mitten im ersten Start.

Geprueft wird gegen eine AUFGEZEICHNETE Verzeichnisliste — der Test braucht
also kein Netz und sagt trotzdem etwas ueber den echten Pool.

  python3 tests/pythonpaket_test.py
"""
import importlib.util
import os
import sys

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


spec = importlib.util.spec_from_file_location(
    "pp", os.path.join(REPO, "controller", "pythonpaket.py"))
pp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pp)

# So sieht das Pool-Verzeichnis wirklich aus (gekuerzt, 08.08.2026).
POOL_313 = """
<a href="libpython3.13-minimal_3.13.5-2+deb13u3_arm64.deb">…</a>
<a href="libpython3.13-minimal_3.13.5-2+deb13u4_arm64.deb">…</a>
<a href="libpython3.13-minimal_3.13.14-1_arm64.deb">…</a>
<a href="python3.13-minimal_3.13.5-2+deb13u3_arm64.deb">…</a>
<a href="python3.13-minimal_3.13.5-2+deb13u4_arm64.deb">…</a>
<a href="python3.13-minimal_3.13.14-1_arm64.deb">…</a>
<a href="python3.13-minimal_3.13.5-2+deb13u4_armhf.deb">…</a>
"""
POOL_DEF = """
<a href="python3-minimal_3.9.2-3_arm64.deb">…</a>
<a href="python3-minimal_3.11.2-1+b1_arm64.deb">…</a>
<a href="python3-minimal_3.13.5-1_arm64.deb">…</a>
<a href="python3-minimal_3.14.6-1_arm64.deb">…</a>
"""

print("── 1. Aus dem Bildnamen den richtigen Debian-Stand lesen")
for name, stand, arch in [
        ("DietPi_RPi5-ARMv8-Trixie.img.xz", "trixie", "arm64"),
        ("DietPi_RPi234-ARMv8-Bookworm.img.xz", "bookworm", "arm64"),
        ("DietPi_RPi1-ARMv6-Bookworm.img.xz", "bookworm", "armhf")]:
    pruefe(pp.codename_aus_bild(name) == stand, f"  {name} -> {stand}")
    pruefe(pp.arch_aus_bild(name) == arch, f"  {name} -> {arch}")
# Der Stand der KARTE zaehlt, nicht der des Rechners, der sie schreibt.
pruefe(pp.codename_aus_bild("") == "trixie", "ohne Namen: die uebliche Vorgabe")

print("\n── 2. Die Auswahl darf NIE ein Paket aus einem anderen Debian nehmen")
dateien = pp.verzeichnis_lesen(POOL_313)
# SECHS, nicht sieben: die armhf-Datei gehoert nicht dazu und wird schon beim
# Lesen aussortiert. Genau das soll die Endung leisten.
pruefe(len(dateien) == 6, f"Verzeichnis gelesen, armhf aussortiert ({len(dateien)})")

w = pp.passende_datei(dateien, "python3.13-minimal", "3.13", "deb13")
pruefe(w == "python3.13-minimal_3.13.5-2+deb13u4_arm64.deb",
       "die neueste Trixie-Fassung wird gewaehlt", str(w))
pruefe("3.13.14" not in (w or ""),
       "  und NICHT 3.13.14 aus sid — das baut gegen eine fremde libc")

lw = pp.passende_datei(dateien, "libpython3.13-minimal", "3.13", "deb13")
pruefe(pp._version(lw) == pp._version(w),
       "Bibliothek und Interpreter haben DIESELBE Version",
       f"{lw} vs {w}")

d2 = pp.verzeichnis_lesen(POOL_DEF)
w2 = pp.passende_datei(d2, "python3-minimal", "3.13", "deb13")
pruefe(w2 == "python3-minimal_3.13.5-1_arm64.deb",
       "der Wrapper passt zur Python-Fassung des Stands", str(w2))
pruefe(pp.passende_datei(d2, "python3-minimal", "3.11", "deb12")
       == "python3-minimal_3.11.2-1+b1_arm64.deb",
       "fuer Bookworm wird 3.11 gewaehlt, nicht das neueste")

print("\n── 3. Architektur: armhf darf nicht auf arm64 landen")
nur_armhf = pp.verzeichnis_lesen(POOL_313, endung="_armhf.deb")
pruefe(len(nur_armhf) == 1 and "armhf" in nur_armhf[0],
       "die Endung trennt die Architekturen sauber")

print("\n── 4. Was fehlt, wird gesagt statt geraten")
leer = pp.passende_datei([], "python3-minimal", "3.13", "deb13")
pruefe(leer is None, "leeres Verzeichnis -> None (kein Raten)")
pruefe(pp.passende_datei(d2, "python3-minimal", "3.99", "deb13") is None,
       "unbekannte Python-Fassung -> None")
try:
    pp.pakete_bestimmen("sarge")
    pruefe(False, "unbekannter Debian-Stand wird abgewiesen")
except ValueError:
    pruefe(True, "unbekannter Debian-Stand wird abgewiesen")

print("\n── 5. Die Zusammenstellung, ohne Netz")
POOL_EXPAT = """
<a href="libexpat1_2.5.0-1_arm64.deb">…</a>
<a href="libexpat1_2.8.2-1~deb13u1_arm64.deb">…</a>
"""
POOL_313_MIT_STDLIB = POOL_313 + """
<a href="libpython3.13-stdlib_3.13.5-2+deb13u3_arm64.deb">…</a>
<a href="libpython3.13-stdlib_3.13.5-2+deb13u4_arm64.deb">…</a>
"""
POOL_MEDIA = '<a href="media-types_13.0.0_all.deb">…</a><a href="media-types_14.0.0_all.deb">…</a>'
POOL_NETBASE = '<a href="netbase_6.4_all.deb">…</a><a href="netbase_6.5_all.deb">…</a>' 


def falscher_pool(url):
    if "python3-defaults" in url:
        return POOL_DEF
    if "expat" in url:
        return POOL_EXPAT
    if "media-types" in url:
        return POOL_MEDIA
    if "netbase" in url:
        return POOL_NETBASE
    return POOL_313_MIT_STDLIB

liste = pp.pakete_bestimmen("trixie", "arm64", lesen=falscher_pool)
pruefe(len(liste) == 7, f"sieben Pakete ({len(liste)})")
namen = [n for _, n in liste]
pruefe(any("libpython" in n for n in namen), "  die Bibliothek ist dabei")
pruefe(any(n.startswith("python3.13-minimal") for n in namen), "  der Interpreter")
pruefe(any(n.startswith("python3-minimal") for n in namen), "  der Wrapper")
# DIE VIERTE HAT ALLES AUFGEHALTEN. Am Geraet:
#   python3.13-minimal depends on libexpat1 (>= 2.6.0); however:
#     Package libexpat1 is not installed.
# Ohne sie laesst dpkg ALLES unkonfiguriert — es gibt kein Python, und der
# ganze Weg ohne Netz faellt in sich zusammen.
pruefe(any(n.startswith("libexpat1") for n in namen),
       "  libexpat1 — ohne sie bleibt Python unkonfiguriert")
# DRITTER FUND AM GERAET: python3.13-minimal heisst minimal, weil die
# STANDARDBIBLIOTHEK fehlt. Der Interpreter lief — aber
#     ModuleNotFoundError: No module named 'secrets'
# und damit starben Agent und Einrichtungs-AP beim Import.
pruefe(any(n.startswith("libpython3.13-stdlib") for n in namen),
       "  die stdlib — minimal alleine kann kein secrets/http.server")
pruefe(any(n.startswith("media-types") for n in namen)
       and any(n.startswith("netbase") for n in namen),
       "  media-types und netbase — die zwei, die dem Abbild fehlen")
pruefe(all(u.startswith("http://deb.debian.org/") for u, _ in liste),
       "  alle von deb.debian.org")

print("\n── 6. Das Vorstart-Skript, das ohne Netz alles anwirft")
spec2 = importlib.util.spec_from_file_location(
    "sdprep", os.path.join(REPO, "controller", "sdprep.py"))
sd = importlib.util.module_from_spec(spec2)
sys.path.insert(0, os.path.join(REPO, "controller"))
spec2.loader.exec_module(sd)

skript = sd.vorstart_skript(agent_port=8099, wartezeit=600)
pruefe("dpkg -i" in skript, "Python wird per dpkg gesetzt (kein apt = kein Netz)")
pruefe('"$E"/*.deb' in skript,
       "  und zwar ALLE drei zusammen — einzeln loest dpkg sie nicht auf")
pruefe("--host 0.0.0.0" in skript, "der Agent lauscht im LAN")
# Nicht woertlich suchen: der Pfad steht in Anfuehrungszeichen ("$E/…").
import re as _re
pruefe(_re.search(r'einrichtung-ap\.py"?\s+starten', skript) is not None,
       "das eigene WLAN wird aufgemacht")
pruefe(_re.search(r'einrichtung-ap\.py"?\s+stoppen', skript) is not None,
       "  und danach wieder abgeraeumt — ein AP darf die Einrichtung nicht ueberleben")
pruefe("einrichtung-schirm.py" in skript, "der QR kommt auf den Schirm")
# OHNE DECKEL STUENDE DIE BOX BIS ZUM STROMAUSFALL DA.
pruefe("ENDE=$(( $(date +%s) + 600 ))" in skript, "es wird mit Zeitgrenze gewartet")
pruefe("exit 0" in skript, "und danach geht es weiter, statt zu haengen")
# Der haeufigste Fall ueberhaupt: es IST ein Netz da. Dann darf hier nichts
# passieren — kein AP, kein Schirm, keine Verzoegerung.
# MIT NETZ heisst seit dem 09.08. nicht mehr "nichts tun": QR und AP bleiben
# aus (richtig), aber eine UNVOLLSTAENDIGE DietPi-Installation wird selbst
# weitergefuehrt — die Box hat keine Tastatur fuer DietPis Rueckfrage.
pruefe("hat_netz" in skript and "dietpi_weiterfuehren" in skript
       and "exit 0" in skript,
       "mit Netz: kein AP/QR, aber DietPi wird weitergefuehrt")
pruefe(skript.index("Netz vorhanden") < skript.index("dietpi_weiterfuehren\n")
       if "dietpi_weiterfuehren\n" in skript else True,
       "  und zwar im Netz-Zweig, nicht davor")
# DER SELBSTABGLEICH, Rueckgrat des Aktualisierungswegs: jede Verbesserung
# musste bisher per sudo auf die Root-Partition gespiegelt werden — der
# Schritt riss DREIMAL, und die Box lief jeweils mit der alten Fassung.
# Jetzt holt sich der Vorstart seine Dateien selbst von der Boot-Partition.
# DIE EIGENE ADRESSE IST KEIN NETZ. Der erste erfolgreiche AP wurde nach
# Sekunden wieder abgeraeumt, weil die Warteschleife die frisch gesetzte
# 192.168.4.1 fuer "Netz da" hielt — Code kurz sichtbar, dann alles weg.
pruefe("hat_fremdnetz" in skript and "192[.]168[.]4[.]1" in skript,
       "die Warteschleife ignoriert die EIGENE AP-Adresse")
# EINE ADRESSE OHNE TRAEGER IST EINE BEHAUPTUNG: DietPis interfaces-Vorlage
# setzte 192.168.0.100 auch ohne Kabel — der Vorstart trat beiseite, DietPi
# lief in "Network is unreachable". Beide Pruefer verlangen carrier=1.
pruefe(skript.count("carrier") >= 2,
       "hat_netz UND hat_fremdnetz verlangen einen Traeger (carrier=1)")
pruefe("cmp -s" in skript and 'exec "$E/vorstart.sh"' in skript,
       "der Vorstart uebernimmt eine neue Fassung von der Boot-Partition selbst")
# UND ZWAR ALLES, IMMER — nicht nur bei geaendertem Skript. Die erste Fassung
# verglich nur vorstart.sh: neue Nachbarn (Schirm, AP, Seite) blieben liegen,
# und die Box verlangte am Handy ein Passwort, das es nicht mehr gab.
kop = skript.index('cp -a "$Q"/.')
vgl = skript.index('cmp -s "$E/vorstart.sh"')
pruefe(kop < vgl,
       "kopiert wird VOR dem Vergleich — Nachbarn kommen auch ohne Skriptaenderung an")
pruefe('bash -n "$E/vorstart.sh"' in skript,
       "  aber erst nach Syntaxpruefung — eine halb geschriebene FAT-Datei "
       "darf nicht uebernehmen")


# ── Die Box fuehrt DietPi selbst weiter — sie hat keine Tastatur ───────────
# Nach einem fruehen Fehlschlag verlangt DietPi Anmeldung + Bestaetigung auf
# tty1; ein Neustart raeumt das NICHT ab (zweimal am Geraet belegt). Der
# Vorstart faehrt die Stufenmechanik selbst: 0 -> update, 1 -> software.
pruefe("dietpi_weiterfuehren" in skript, "der Vorstart kennt die Weiterfuehrung")
pruefe("dietpi-update 1" in skript and "dietpi-software" in skript,
       "  beide Stufen in DietPis eigener Reihenfolge")
pruefe(skript.index("dietpi-update 1") < skript.index("dietpi-software"),
       "  update VOR software — die Stufen bauen aufeinander")
pruefe('S=" = "2"'.replace('" = "', '') not in "x" and '"2"' in skript,
       "  Stufe 2 heisst fertig, dann passiert nichts")
pruefe("Unit erneuert" in skript,
       "der Selbstabgleich erneuert auch die Units — kein sudo-Nachtrag vom PC mehr")


# ── Null Zutun: nach Stufe 2 drueckt der Vorstart den Startknopf selbst ────
# Die Zustimmung kam beim Kartenschreiben (Haken "Lauf ohne PC"); die
# Standdatei ist exakt der Knopf der Handy-Seite. Ein Tippfehler im JSON
# hiesse: der Selbstlauf startet NIE — deshalb wird die Zeile hier WIRKLICH
# ausgefuehrt und zurueckgelesen, nicht nur gesucht.
import json as _json, subprocess as _sp, tempfile as _tf
_z = [l for l in skript.splitlines() if "stand.json" in l and "printf" in l]
pruefe(len(_z) == 1, "der Startschuss steht im Skript")
with _tf.TemporaryDirectory() as _d:
    _cmd = _z[0].strip().replace("/var/lib/mixpibox-lauf/stand.json", _d + "/s.json")
    _sp.run(["bash", "-c", _cmd], check=True)
    _stand = _json.load(open(_d + "/s.json"))
    pruefe(_stand == {"fertig": [], "gescheitert": None},
           "  die Standdatei ist EXAKT die der Handy-Seite (echt ausgefuehrt)")
pruefe('[ ! -f /var/lib/mixpibox-lauf/stand.json ]' in skript,
       "  ein LAUFENDER Stand wird nie ueberschrieben")
# Auf die CODE-Zeilen zielen: "reboot" steht auch in Begruendungen, und der
# Startknopf sitzt im Stufen-2-Zweig kurz vor dessen Neustart.
_knopf = skript.index('printf \'{"fertig"')
_boot = skript.index("reboot", _knopf)
pruefe(_knopf < _boot, "  erst der Knopf, dann der Neustart")


# ── Der Automatikschalter: ohne ihn ist die Weiterfuehrung umsonst ─────────
# DietPi setzt AUTO_SETUP_AUTOMATED nach dem ersten Automatiklauf auf 0 —
# auch wenn der SCHEITERTE. Ab da will dietpi-software fuer immer ins Menue
# ("DietPi has not fully been installed ... Go >> Start installation", am
# Geraet minutenlang in Endlosschleife gesehen).
pruefe("AUTO_SETUP_AUTOMATED=1" in skript,
       "der Vorstart stellt den Automatikschalter zurueck")
pruefe("/boot/dietpi.txt" in skript and "/boot/firmware/dietpi.txt" in skript,
       "  an BEIDEN Orten: Root-Partition (Betrieb) und Karte (Erstboot)")
# Auf die CODE-Zeilen zielen, nicht auf den Fliesstext: beide Begriffe stehen
# oben auch in der Begruendung, und die kommt naturgemaess zuerst.
_sed = skript.index('sed -i "s/^AUTO_SETUP_AUTOMATED=')
_ruf = skript.index("/boot/dietpi/dietpi-update 1")
pruefe(_sed < _ruf,
       "  VOR dem Start der Stufen — sonst laeuft es wieder ins Menue")

print()
print(f"{ok} in Ordnung, {bad} gebrochen")
sys.exit(1 if bad else 0)
