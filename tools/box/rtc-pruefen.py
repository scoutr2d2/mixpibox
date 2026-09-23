#!/usr/bin/env python3
r"""Sitzt die Echtzeituhr, und haelt sie die Zeit? — auf der Box ablesen.

    python3 rtc-pruefen.py              # nur schauen
    python3 rtc-pruefen.py --merken     # Systemzeit in die RTC schreiben

Laeuft auf der Box. Ohne `sudo` fehlen `hwclock` und `i2cdetect` — dann sagt
es das, statt Luecken als „in Ordnung" auszugeben.

══ WOZU ═══════════════════════════════════════════════════════════════════

Eine Box ohne Netz weiss nicht, wie spaet es ist. Das faellt nicht sofort
auf — es faellt beim Verlauf auf, bei der Kinderzeit und bei allem, was
Zeitstempel vergleicht: Eintraege aus dem Jahr 1970, Zeitraeume, die
rueckwaerts laufen, ein Guthaben, das sich nicht zurueckstellt.

Die Falle ist, dass /dev/rtc0 DA IST und trotzdem nichts taugt. Der Kernel
legt das Geraet an, sobald er den Chip findet — ob eine Batterie dranhaengt,
sieht er nicht. Erst nach einem Stromausfall zeigt sich der Unterschied, und
dann ist die Messung teuer.

══ WAS ES ZEIGT ═══════════════════════════════════════════════════════════

  * WELCHE Uhren der Kernel kennt und welche davon eingebaut bzw. angesteckt
    ist. Auf einem Pi 5 koennen es zwei sein — dann zaehlt, welche `rtc0` ist,
    denn `hwclock` nimmt ohne Nachfrage die erste.
  * ob die RTC eine PLAUSIBLE Zeit haelt (nicht 1970, nicht weit von der
    Systemzeit weg).
  * beim Pi 5: ob die Batterieladung ueberhaupt eingeschaltet ist. Ohne
    `dtparam=rtc_bbat_vchg=…` wird die Knopfzelle NIE geladen, und eine
    ungeladene Akkuzelle ist genau so gut wie keine.
  * beim externen Modul: ob es auf dem I2C-Bus antwortet und ob der Overlay
    gesetzt ist.
  * ob `fake-hwclock` dazwischenfunkt — der schreibt beim Herunterfahren die
    Zeit in eine Datei und tut beim Start so, als waere sie echt.

══ WAS ES NICHT KANN ══════════════════════════════════════════════════════

Den eigentlichen Beweis: Strom weg, fuenf Minuten warten, Strom dran, ohne
Netz hochfahren. Alles davor ist nur ein Hinweis. Das Werkzeug sagt am Ende,
was der naechste Handgriff waere.

══ VERDRAHTUNG AUF DIESER BOX (DS3231 „for Pi" an den MuPiHAT) ════════════

Der MuPiHAT bricht I2C selbst heraus — Stiftleiste J5, linke Gruppe, auf der
Platine beschriftet „I2C, 3V, 5V". Kein Stapelstecker noetig, nichts loeten.

        5V    3V3   SCL  |  24   5    6   12   25     <- obere Reihe
        o     o     o    |  o    o    o    o    o
        o     o     o    |  o    o    o    o    o
        GND   GND   SDA  |  26  10    9   11    8     <- untere Reihe
        \____ I2C, 3V, 5V ____/   \____ GPIO ____/

Das Modul ist neben seiner Buchse mit `+ D C N G` bedruckt:

        +  ->  3V3    (obere Reihe, ZWEITE Spalte von links)
        G  ->  GND    (untere Reihe, erste oder zweite Spalte)
        D  ->  SDA    (untere Reihe, dritte Spalte)
        C  ->  SCL    (obere Reihe, dritte Spalte)
        N  ->  nichts (liegt am Pi auf GPIO4, das Modul nutzt es nicht)

DIE EINE STELLE, AN DER EIN FEHLER TEUER WIRD: `+` gehoert an 3V3, nicht an
5V — und 5V ist auf J5 der direkte Nachbar, ganz aussen. Nach dem AUFDRUCK
gehen, nicht nach der Drahtfarbe, und vorher den Strom wegnehmen.

Adressen beissen sich nicht: der DS3231 meldet sich auf 0x68 (sein EEPROM auf
0x57), der Ladeleser BQ25792 des MuPiHAT auf 0x6b. Ein Bus, drei Teilnehmer.

Danach in /boot/firmware/config.txt:

        dtoverlay=i2c-rtc,ds3231

`dtparam=i2c_arm=on` und `i2c_arm_baudrate=50000` stehen dort schon durch
scripts/mupihat/enable_mupihat.sh; 50 kHz reichen dem DS3231 muehelos.
"""
import argparse
import datetime
import glob
import os
import pathlib
import re
import subprocess
import sys

# I2C-Adressen, die auf dieser Box vorkommen koennen.
BEKANNT = {
    0x68: 'DS3231/DS1307 (RTC-Modul)',
    0x57: 'AT24C32 (EEPROM auf dem ZS-042-Modul, gehoert zur RTC)',
    0x6B: 'BQ25792 — der Ladeleser vom MuPiHAT (KEINE Uhr)',
    0x51: 'PCF8563/PCF85063 (RTC-Modul)',
}

# Chipnamen, die fuer ein ANGESTECKTES Modul stehen. Alles andere, was der
# Kernel meldet, gilt hier als eingebaut — so muss der Name der eingebauten
# Uhr nicht fest verdrahtet werden (er heisst je nach Pi anders).
EXTERNE_CHIPS = ('ds3231', 'ds1307', 'ds1339', 'pcf8523', 'pcf8563',
                 'pcf85063', 'mcp794', 'mcp7940', 'rv3028', 'rv8803')

CONFIGS = ('/boot/firmware/config.txt', '/boot/config.txt')


def laufen(befehl, sek=6):
    """Befehl ausfuehren; gibt (rc, ausgabe) — Ausgabe IMMER, auch bei Abbruch.

    Der Abbruchfall traegt oft die eigentliche Auskunft; sie wegzuwerfen war
    hier schon dreimal der Grund fuer eine leere Diagnose.
    """
    try:
        p = subprocess.run(befehl, shell=True, capture_output=True,
                           text=True, timeout=sek)
        return p.returncode, (p.stdout + p.stderr).strip()
    except subprocess.TimeoutExpired as e:
        teile = [x.decode('utf-8', 'replace') if isinstance(x, bytes) else (x or '')
                 for x in (e.stdout, e.stderr)]
        return 124, ('\n'.join(t for t in teile if t).strip()
                     or '(Zeitueberschreitung, keine Ausgabe)')
    except OSError as e:
        return 127, str(e)


def darf_root():
    return os.geteuid() == 0 or laufen('sudo -n true', 3)[0] == 0


def ist_pi5(modell):
    """Ist das ein Pi 5? — nur der hat eine eingebaute Uhr.

    Eigene Funktion, weil die erste Fassung hier FALSCH HERUM suchte: sie sah
    hinter dem Wort „Model" nach der 5. Die Modellnummer steht aber DAVOR
    („Raspberry Pi 5 Model B Rev 1.0"), also war die Antwort auf einem echten
    Pi 5 immer False — und der Abschnitt zur Zellenladung fiel still aus.
    Genau die Bauart Fehler, die als „nichts Auffaelliges" durchgeht.
    """
    return bool(re.search(r'raspberry\s+pi\s+5\b', str(modell or ''), re.I))


def config_datei():
    for c in CONFIGS:
        if os.path.exists(c):
            return c
    return None


def uhren():
    """Was der Kernel an Uhren kennt: [(rtcN, chipname, extern?)]."""
    aus = []
    for pfad in sorted(glob.glob('/sys/class/rtc/rtc*')):
        name = ''
        try:
            name = pathlib.Path(pfad, 'name').read_text().strip()
        except OSError:
            pass
        kurz = name.split()[0].lower() if name else ''
        extern = any(c in kurz for c in EXTERNE_CHIPS)
        aus.append((os.path.basename(pfad), name or '(namenlos)', extern))
    return aus


def rtc_zeit(geraet='/dev/rtc0'):
    """(text, abweichung_sek oder None). None heisst: nicht lesbar."""
    rc, t = laufen('hwclock -r --rtc %s' % geraet if os.geteuid() == 0
                   else 'sudo -n hwclock -r --rtc %s' % geraet)
    if rc != 0:
        return t, None
    # hwclock gibt z. B. "2026-08-20 18:03:11.123456+02:00"
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})', t)
    if not m:
        return t, None
    gelesen = datetime.datetime(*(int(x) for x in m.groups()))
    jetzt = datetime.datetime.now()
    return t, abs((jetzt - gelesen).total_seconds())


def bus_absuchen(bus=1):
    """{adresse: beschreibung} — oder None, wenn i2cdetect nicht ging."""
    vor = '' if os.geteuid() == 0 else 'sudo -n '
    rc, t = laufen('%si2cdetect -y %d' % (vor, bus), 10)
    if rc != 0:
        return None, t
    gefunden = {}
    for zeile in t.splitlines()[1:]:
        m = re.match(r'([0-9a-f]{2}):(.*)', zeile)
        if not m:
            continue
        basis = int(m.group(1), 16)
        for i, feld in enumerate(m.group(2).split()):
            if re.fullmatch(r'[0-9a-f]{2}', feld):
                gefunden[basis + i] = BEKANNT.get(basis + i, '(unbekannt)')
    return gefunden, t


def abschnitt(titel):
    print('\n══ %s ' % titel + '═' * max(0, 68 - len(titel)))


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--merken', action='store_true',
                   help='Systemzeit in die RTC schreiben (hwclock -w)')
    p.add_argument('--bus', type=int, default=1)
    a = p.parse_args()

    root = darf_root()
    modell = '(unbekannt)'
    try:
        modell = pathlib.Path('/proc/device-tree/model').read_bytes() \
            .decode('utf-8', 'replace').strip('\x00').strip()
    except OSError:
        pass
    pi5 = ist_pi5(modell)

    print('Echtzeituhr — was die Box selbst sagt\n')
    print('  Geraet:     %s' % modell)
    print('  Systemzeit: %s' % datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    if not root:
        print('  ACHTUNG:    kein root — hwclock und i2cdetect fallen aus.')
        print('              Mit `sudo python3 %s` nochmal.' % os.path.basename(__file__))

    mangel = []

    abschnitt('WELCHE UHREN KENNT DER KERNEL')
    liste = uhren()
    if not liste:
        print('  keine. /sys/class/rtc ist leer.')
        mangel.append('Der Kernel sieht ueberhaupt keine Uhr.')
    for gerat, name, extern in liste:
        print('  /dev/%-6s %-14s %s' % (gerat, name,
                                        'angestecktes Modul' if extern else 'eingebaut'))
    externe = [g for g, _, e in liste if e]
    if len(liste) > 1:
        print('\n  ZWEI UHREN. `hwclock` nimmt ohne --rtc immer rtc0 — pruefe oben,')
        print('  welche das ist. Wer das Modul meint und rtc0 stellt, stellt die falsche.')

    abschnitt('HAELT SIE EINE PLAUSIBLE ZEIT')
    if not root:
        print('  (uebersprungen, kein root)')
    elif not liste:
        print('  (nichts zu lesen)')
    else:
        for gerat, name, _ in liste:
            text, ab = rtc_zeit('/dev/' + gerat)
            if ab is None:
                print('  /dev/%-6s nicht lesbar: %s' % (gerat, text.splitlines()[0][:60]))
                mangel.append('/dev/%s antwortet nicht.' % gerat)
            elif text.startswith(('1970', '2000', '1900')):
                print('  /dev/%-6s %s  ← ZURUECKGESETZT, also ohne Batterie' % (gerat, text[:19]))
                mangel.append('/dev/%s steht auf dem Anfangswert — die Zelle traegt nicht.' % gerat)
            elif ab > 120:
                print('  /dev/%-6s %s  ← %.0f s neben der Systemzeit' % (gerat, text[:19], ab))
                mangel.append('/dev/%s laeuft %.0f s daneben.' % (gerat, ab))
            else:
                print('  /dev/%-6s %s  (%.0f s Abstand — plausibel)' % (gerat, text[:19], ab))

    if pi5:
        abschnitt('PI 5: WIRD DIE KNOPFZELLE GELADEN')
        cfg = config_datei()
        gesetzt = None
        if cfg:
            for z in pathlib.Path(cfg).read_text(errors='replace').splitlines():
                m = re.match(r'\s*dtparam=rtc_bbat_vchg=(\d+)', z)
                if m:
                    gesetzt = int(m.group(1))
        if gesetzt:
            print('  %s: dtparam=rtc_bbat_vchg=%d  (%.2f V)' % (cfg, gesetzt, gesetzt / 1e6))
        else:
            print('  NICHT gesetzt in %s.' % (cfg or 'config.txt (nicht gefunden)'))
            print('  Ohne diese Zeile laedt der Pi die Zelle nie — sie leert sich und')
            print('  ist nach ein paar Wochen so gut wie keine.')
            mangel.append('dtparam=rtc_bbat_vchg fehlt — die Zelle wird nicht geladen.')
        # Nicht raten, wo der Kernel das ablegt: nachsehen, was da ist.
        treffer = [f for f in glob.glob('/sys/class/rtc/rtc*/device/**', recursive=True)
                   if re.search(r'charg|bbat|volt', os.path.basename(f))]
        for f in sorted(treffer)[:6]:
            try:
                print('  %s = %s' % (f, pathlib.Path(f).read_text().strip()))
            except OSError:
                pass

    abschnitt('EXTERNES MODUL: ANTWORTET ES AUF DEM BUS')
    if not root:
        print('  (uebersprungen, kein root)')
    else:
        gefunden, roh = bus_absuchen(a.bus)
        if gefunden is None:
            print('  i2cdetect ging nicht: %s' % roh.splitlines()[0][:70])
            print('  Fehlt das Werkzeug?  sudo apt install i2c-tools')
        elif not gefunden:
            print('  Bus %d ist leer. Weder MuPiHAT noch Uhr.' % a.bus)
        else:
            for adr in sorted(gefunden):
                print('  0x%02x  %s' % (adr, gefunden[adr]))
            if 0x68 in gefunden and not externe:
                print('\n  Auf 0x68 sitzt etwas, aber der Kernel hat keine externe Uhr')
                print('  gebunden — dann fehlt der Overlay (siehe naechster Abschnitt).')
                mangel.append('Modul antwortet auf 0x68, ist aber nicht eingebunden.')

    abschnitt('OVERLAY UND FAKE-HWCLOCK')
    cfg = config_datei()
    if cfg:
        zeilen = [z.strip() for z in pathlib.Path(cfg).read_text(errors='replace').splitlines()
                  if re.search(r'i2c|rtc', z) and not z.strip().startswith('#')]
        for z in zeilen or ['(keine i2c/rtc-Zeile)']:
            print('  %s: %s' % (os.path.basename(cfg), z))
    rc, _ = laufen('command -v fake-hwclock')
    if rc == 0:
        print('  fake-hwclock ist INSTALLIERT — der tut beim Start so, als')
        print('  waere die gemerkte Zeit echt, und verdeckt damit genau den')
        print('  Fehler, den du suchst. Bei echter RTC gehoert er weg.')
        mangel.append('fake-hwclock verdeckt eine tote RTC.')
    else:
        print('  fake-hwclock: nicht installiert (gut, wenn eine echte Uhr da ist)')

    if a.merken:
        abschnitt('SYSTEMZEIT IN DIE RTC SCHREIBEN')
        if not root:
            print('  geht nicht ohne root.')
        else:
            vor = '' if os.geteuid() == 0 else 'sudo -n '
            rc, t = laufen('%shwclock -w' % vor)
            print('  hwclock -w → %s %s' % ('ok' if rc == 0 else 'FEHLER', t[:70]))

    abschnitt('WAS FEHLT')
    if mangel:
        for m in mangel:
            print('  • %s' % m)
    else:
        print('  Nichts Auffaelliges. Das heisst aber NICHT, dass die Uhr traegt.')

    print("""
DER EINZIGE ECHTE BEWEIS ist ein Stromausfall:

  1. sudo python3 %s --merken
  2. Strom weg, funf Minuten warten
  3. ohne Netz hochfahren (WLAN aus oder Router-Stecker), dann
     sudo python3 %s

Zeigt sie danach die richtige Zeit, traegt die Batterie. Alles davor ist ein
Hinweis, kein Beleg.""" % (os.path.basename(__file__), os.path.basename(__file__)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
