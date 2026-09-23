#!/usr/bin/env python3
# Prueft, ob die Box und librespot beim SELBEN Spotify-Konto angemeldet sind —
# und meldet librespot auf Wunsch wieder beim Konto der Box an.
#
# WOZU: Die Box hat zwei voneinander unabhaengige Spotify-Zugaenge.
#
#   1. Backend und Oberflaeche fragen mit einem OAuth-Zugang aus
#      mupiboxconfig.json (clientId + refreshToken, PKCE, KEIN Secret).
#   2. librespot — das Geraet, das den Ton macht — meldet sich mit dem an, was
#      in /home/dietpi/.cache/spotify/credentials.json steht.
#
# Normalerweise gehoeren beide demselben Konto. Sie koennen aber
# AUSEINANDERLAUFEN, ohne dass sich irgendetwas beschwert: Spielt jemand von
# einem fremden Handy per Spotify Connect auf die Box, meldet librespot sich
# mit DESSEN Konto an und schreibt credentials.json neu. Danach
#
#   * laeuft librespot fehlerfrei und protokolliert eine erfolgreiche Anmeldung
#     ("successfully put connect state ... active device is <>"),
#   * steht die Box in der Geraeteliste JENES fremden Kontos,
#   * und die Box selbst fragt weiter mit ihrem eigenen Konto — und bekommt
#     eine LEERE Geraeteliste.
#
# Von aussen sieht das aus wie "librespot ist kaputt". Es ist aber kerngesund;
# es hoert nur dem Falschen zu. GEMESSEN am 2026-08-02: Neustart half nicht,
# der Waechter startete im 5-Minuten-Takt neu, und jeder Neustart meldete sich
# wieder beim fremden Konto an.
#
# WAS AUSGEGEBEN WIRD: nur Kurzform-Kennungen (sha1, 8 Zeichen) und das Urteil.
# Kontonamen, Token und Geheimnisse erscheinen NICHT — das Skript laeuft auch
# aus dem Waechter heraus ins Systemprotokoll.
#
# ══ DER ZWEITE FALL, GEMESSEN AM 2026-08-11 ═══════════════════════════════
# Betreiber: "spotify spielt nicht ab hat aber zugang". Auf der Box lief
# librespot im Neustartkreis (15 Neustarts) mit
#
#     could not initialize spirc: Login request was denied: INVALID_CREDENTIALS
#
# und trotzdem gehoerten BEIDE Zugaenge demselben Konto. Der Kontovergleich
# oben findet diesen Fall NICHT — er liest den Namen aus credentials.json, und
# ein Dateizugriff ist keine Anmeldung. Er meldete "DASSELBE Konto", gab 0
# zurueck, und --reparieren tat folgerichtig nichts.
#
# DAZU KOMMT EINE FALLE IN env-librespot:
#
#     if [ ! -z "$access_token" ] && [ ! -f "$credentials" ]; then
#       export LIBRESPOT_ACCESS_TOKEN=${access_token}
#
# Der Token ist nur die ANSAAT und wird ausschliesslich benutzt, solange keine
# credentials.json existiert. Ist sie da und wird abgelehnt, blockiert genau
# die kaputte Datei den Weg, der sie ersetzen wuerde. Ein Neustart der Box
# aendert daran nichts: die Datei ueberlebt ihn.
#
# Deshalb prueft dieses Skript jetzt ZWEIERLEI — wem librespot zuhoert UND ob
# es ueberhaupt hereingelassen wird.
#
# AUFRUF
#     librespot-konto.py                # nur pruefen  (0 gleich, 1 verschieden)
#     librespot-konto.py --reparieren   # bei Bedarf neu anmelden
#     librespot-konto.py --heilen       # fuer systemd: nur bei Abweisung, gedrosselt
#     librespot-konto.py --leise        # nur Urteil, fuer den Waechter
#
# Rueckgabe: 0 = in Ordnung, 1 = behebbar (verschieden/abgewiesen),
#            2 = nicht feststellbar.
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

CONFIG = '/etc/mupibox/mupiboxconfig.json'
CREDS = '/home/dietpi/.cache/spotify/credentials.json'

LEISE = '--leise' in sys.argv


def sag(text):
    if not LEISE:
        print(text)


def kurz(wert):
    return hashlib.sha1(wert.encode()).hexdigest()[:8] if wert else '(leer)'


def frag(token, pfad):
    anfrage = urllib.request.Request(
        'https://api.spotify.com/v1/' + pfad,
        headers={'Authorization': 'Bearer ' + token},
    )
    with urllib.request.urlopen(anfrage, timeout=20) as antwort:
        return json.load(antwort)


def frischer_zugang(k):
    """Holt einen neuen Access-Token — GENAU SO wie das Backend (server.ts).

    client_id im Rumpf, KEIN Secret, keine Basic-Auth: Die Box ist bei Spotify
    als PKCE-Anwendung angemeldet, clientSecret ist dort leer. Ein Versuch mit
    Basic-Auth scheitert an `invalid_client` — was aussieht, als sei der Zugang
    der Box zurueckgezogen, obwohl nur falsch gefragt wurde.
    """
    daten = urllib.parse.urlencode({
        'grant_type': 'refresh_token',
        'refresh_token': k['refreshToken'],
        'client_id': k['clientId'],
    }).encode()
    anfrage = urllib.request.Request(
        'https://accounts.spotify.com/api/token', daten,
        {'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with urllib.request.urlopen(anfrage, timeout=20) as antwort:
            return json.load(antwort)['access_token']
    except urllib.error.HTTPError as fehler:
        # Der GRUND steht im Antworttext, nicht im Statuscode: invalid_grant
        # heisst "Zugang zurueckgezogen, Konto neu verbinden", invalid_client
        # heisst "falsch gefragt". Wer nur "HTTP 400" liest, sucht falsch.
        try:
            b = json.loads(fehler.read().decode())
            raise RuntimeError('%s — %s' % (b.get('error'), b.get('error_description'))) from None
        except RuntimeError:
            raise
        except Exception:
            raise RuntimeError('HTTP %s' % fehler.code) from None


def box_token(k):
    """Access-Token fuer das Konto der Box: erst der gespeicherte, dann neu."""
    gespeichert = k.get('accessToken') or ''
    if gespeichert:
        try:
            frag(gespeichert, 'me')
            return gespeichert
        except Exception:
            pass
    if not k.get('clientId') or not k.get('refreshToken'):
        raise RuntimeError('gespeicherter Zugang abgelaufen, und zum Erneuern '
                           'fehlen clientId/refreshToken')
    return frischer_zugang(k)


def _pipewire_stroeme():
    """Wie viele Ton-Stroeme laufen? Oder None, wenn PipeWire nicht antwortet.

    Gezaehlt werden nur `Stream/Output/Audio` im Zustand `running` — also
    etwas, das gerade wirklich Ton erzeugt. Ein pausierter Strom steht auf
    `suspended` oder `idle` und zaehlt nicht: wer pausiert hat, wird von einer
    Heilung nicht mitten im Satz unterbrochen.
    """
    try:
        uid = subprocess.run(['id', '-u', 'dietpi'], capture_output=True,
                             text=True, timeout=10).stdout.strip()
        if not uid:
            return None
        r = subprocess.run(
            ['sudo', '-u', 'dietpi', 'env', 'XDG_RUNTIME_DIR=/run/user/%s' % uid,
             'pw-dump'], capture_output=True, text=True, timeout=20)
        d = json.loads(r.stdout or '[]')
    except Exception:
        return None
    n = 0
    for k in d:
        if not str(k.get('type', '')).endswith('Node'):
            continue
        info = k.get('info') or {}
        props = info.get('props') or {}
        if props.get('media.class') == 'Stream/Output/Audio' and info.get('state') == 'running':
            n += 1
    return n


def spielt_gerade(fenster=6.0, schwelle=3):
    """Hoert gerade jemand zu? (True/False/None)

    ══ WOZU ═══════════════════════════════════════════════════════════════
    Betreiber, 12.08.2026: „gibt es eine moeglichkeit den waechter nicht zu
    zerstoeren es aber dennoch zu ermoeglichen von einem anderen account zu
    spielen?"

    Ja — der Waechter muss nicht weg, er muss warten lernen. Ein fremdes Konto
    ist ein Zustand, der Zeit hat; eine Geschichte, die mitten im Satz
    abbricht, hat keine. Also: solange etwas laeuft, wird NICHT geheilt.

    ══ WARUM DIE RECHENZEIT UND NICHT DER TON ════════════════════════════
    Der naheliegende Weg waere `pactl list short sink-inputs` — am 12.08.2026
    an der Box gemessen und VERWORFEN:

        als dietpi:  Failed to load cookie file  (keine Sitzung ueber SSH)
        als root:    Connection refused          (fremder PulseAudio)

    Der Waechter laeuft aus systemd heraus, also genau in dieser Lage. Ein
    Zeichen, das nur im angemeldeten Terminal funktioniert, ist fuer ihn
    keines.

    Die Rechenzeit des Prozesses braucht dagegen niemanden: /proc/<pid>/stat
    steht jedem offen. librespot entschluesselt und dekodiert beim Abspielen —
    das kostet messbar. Gemessen am selben Tag, waehrend vom zweiten Konto
    gespielt wurde:

        spielend:  11 Ticks in 6 s
        ruhend:    0 bis 1  (es haelt nur eine Verbindung offen)

    Die Schwelle liegt bei 3 — weit ueber dem Rauschen, weit unter dem Ernst.

    None heisst „kein librespot da" — dann gibt es auch nichts zu unterbrechen.
    """
    # ══ ZUERST PIPEWIRE FRAGEN — ES WEISS ES GENAU ═════════════════════
    #
    # Betreiber, 12.08.2026: „kann man ueber pipewire gehen da ist ja dann
    # auch eine ausgabe." Ja, und es ist die bessere Auskunft: PipeWire zaehlt
    # laufende Stroeme, statt aus Rechenzeit zu schliessen.
    #
    # DER ZEIGER AUF DIE SITZUNG IST DER GANZE TRICK. Am Geraet gemessen:
    #     sudo pw-dump                      -> can't connect: Host is down
    #     sudo -u dietpi XDG_RUNTIME_DIR=…  -> antwortet
    # PipeWire laeuft in dietpis Sitzung; root kennt deren Sockel nicht von
    # selbst. Genau daran war vorher schon `pactl` gescheitert.
    strom = _pipewire_stroeme()
    if strom is not None:
        return strom > 0

    # ── Rueckfall: die Rechenzeit ──────────────────────────────────────
    try:
        pids = subprocess.run(['pgrep', '-x', 'librespot'],
                              capture_output=True, text=True, timeout=10).stdout.split()
        if not pids:
            return None
        pid = pids[0]

        def ticks():
            with open('/proc/%s/stat' % pid) as f:
                teile = f.read().split()
            # 14 = utime, 15 = stime (1-basiert gezaehlt, wie in proc(5)).
            return int(teile[13]) + int(teile[14])

        a = ticks()
        time.sleep(fenster)
        return (ticks() - a) >= schwelle
    except Exception:
        # Im Zweifel NICHT behaupten, es sei still: eine falsche Ruhe fuehrt
        # zum Abbruch einer laufenden Wiedergabe, eine falsche Betriebsamkeit
        # nur zu einer verschobenen Heilung.
        return True


def abgewiesen():
    """Wird librespot von Spotify ABGEWIESEN? (True/False/None)

    Der Kontovergleich sieht das nicht: er liest einen Namen aus einer Datei.
    Hier wird gefragt, was der Dienst tatsaechlich tut.

    ══ WARUM „ACTIVE/RUNNING" NICHTS BEWEIST ═══════════════════════════════
    Am 11.08.2026 gemessen: mitten im Neustartkreis stand der Dienst auf
    ActiveState=active, SubState=running — und NRestarts=21. Der Lauf war
    zwanzig Sekunden alt und schon zum Scheitern verurteilt; wer in genau
    diesem Fenster misst, haelt einen sterbenden Dienst fuer einen gesunden.
    Ein abgewiesenes librespot stirbt binnen einer halben Minute, ein
    angemeldetes laeuft stundenlang. Deshalb zaehlt hier nicht der Zustand,
    sondern die DAUER: laeuft es seit ueber zwei Minuten, ist es drin.

    ══ UND WARUM ZWEI ABSAGEN UND NICHT EINE ═══════════════════════════════
    Eine einzelne Absage steht auch dann noch im Protokoll, wenn laengst alles
    repariert ist. Ein Kreis meldet sie wieder und wieder. Zwei innerhalb von
    zehn Minuten unterscheidet das laufende Problem von seiner Erinnerung.

    None heisst "nicht feststellbar" — dann wird NICHT geheilt. Ein Eingriff
    auf Verdacht reisst im Zweifel eine laufende Wiedergabe ab.
    """
    try:
        r = subprocess.run(
            ['systemctl', 'show', 'librespot.service', '-p', 'ActiveState',
             '-p', 'SubState', '-p', 'ExecMainStartTimestampMonotonic'],
            capture_output=True, text=True, timeout=15)
        stand = dict(z.split('=', 1) for z in r.stdout.split() if '=' in z)
    except Exception:
        return None
    if not stand:
        return None

    if stand.get('ActiveState') == 'active' and stand.get('SubState') == 'running':
        try:
            with open('/proc/uptime') as f:
                jetzt = float(f.read().split()[0]) * 1_000_000
            seit = jetzt - float(stand.get('ExecMainStartTimestampMonotonic', 0))
            if seit > 120_000_000:
                return False
        except Exception:
            # Ohne Laufzeit lieber weitermessen als raten.
            pass

    try:
        r = subprocess.run(
            ['journalctl', '-u', 'librespot', '--no-pager', '-o', 'cat',
             '--since', '-10min'],
            capture_output=True, text=True, timeout=20)
    except Exception:
        return None
    text = r.stdout or ''
    if not text.strip():
        return None
    absagen = sum(
        1 for zeile in text.splitlines()
        if any(w in zeile for w in ('INVALID_CREDENTIALS', 'Bad credentials',
                                    'Login request was denied'))
    )
    return absagen >= 2


def konten():
    """(Konto der Box, Konto von librespot, Token) — oder wirft."""
    with open(CONFIG) as f:
        k = json.load(f)['spotify']
    token = box_token(k)
    box = frag(token, 'me').get('id', '')
    with open(CREDS) as f:
        lib = json.load(f).get('username', '')
    return box, lib, token


def pruefen():
    # ══ ZUERST DIE ABWEISUNG, DENN SIE STICHT DEN KONTOVERGLEICH ═════════
    # Wird librespot nicht hereingelassen, ist es egal, wessen Name in der
    # Datei steht — die Datei taugt nicht mehr. Am 11.08.2026 stand dort der
    # richtige Name, und genau deshalb meldete diese Pruefung frueher „alles
    # in Ordnung", waehrend der Dienst zum 15. Mal neu startete.
    weg = abgewiesen()
    if weg:
        sag('  librespot wird von Spotify ABGEWIESEN (INVALID_CREDENTIALS).')
        sag('  Die hinterlegte Anmeldung taugt nicht mehr — wessen Name darin')
        sag('  steht, spielt dann keine Rolle.')
        return 1

    try:
        box, lib, token = konten()
    except Exception as fehler:
        sag('  nicht feststellbar: %s' % fehler)
        return 2

    gleich = box == lib
    sag('  Konto der Box:        Kennung#%s' % kurz(box))
    sag('  Konto von librespot:  Kennung#%s' % kurz(lib))
    sag('  ==> %s' % ('DASSELBE Konto' if gleich else 'ZWEI VERSCHIEDENE KONTEN'))

    try:
        geraete = frag(token, 'me/player/devices').get('devices', [])
        sag('')
        sag('  Geraete im Konto der Box: %d' % len(geraete))
        for g in geraete:
            sag('    %-24r %-10s %s' % (g.get('name'), g.get('type'),
                                        'aktiv' if g.get('is_active') else 'nicht aktiv'))
    except Exception:
        pass
    return 0 if gleich else 1


def reparieren():
    """Meldet librespot wieder mit dem Konto der Box an.

    WARUM DAS MEHR IST ALS credentials.json LOESCHEN: env-librespot benutzt den
    `accessToken` aus der Konfiguration NUR, solange keine credentials.json
    existiert — er ist die Ansaat fuer die erste Anmeldung, danach meldet sich
    librespot selbst an. Genau deshalb steht dort, er duerfe "laengst abgelaufen
    sein". Das stimmt aber nur, SOLANGE die credentials.json lebt. Loescht man
    sie, faellt librespot auf einen Token zurueck, den seit Wochen niemand
    erneuert hat, und quittiert mit `Bad credentials` — im Neustartkreis, alle
    12 Sekunden. (Genau so passiert am 2026-08-02.)

    Deshalb: ZUERST frischen Token hinterlegen, DANN die fremde Anmeldung weg.
    """
    with open(CONFIG) as f:
        roh = f.read()
    k = json.loads(roh)['spotify']
    if not k.get('clientId') or not k.get('refreshToken'):
        sag('  Zum Erneuern fehlen clientId/refreshToken — Spotify in der '
            'Verwaltung neu verbinden.')
        return 2

    sag('── Frischen Zugang fuer das Konto der Box holen')
    try:
        neu = frischer_zugang(k)
    except Exception as fehler:
        sag('   misslungen: %s' % fehler)
        return 2

    sag('── In die Konfiguration eintragen (Sicherung daneben)')
    with open(CONFIG + '.vor-neuanmeldung', 'w') as f:
        f.write(roh)
    # Nur den EINEN Wert ersetzen, die Datei nicht neu schreiben: an der
    # Konfiguration haengen Backend und mehrere Skripte, und ein umformatiertes
    # JSON waere eine Aenderung an tausend Zeilen, die niemand bestellt hat.
    ersetzt, anzahl = re.subn(r'("accessToken"\s*:\s*)"[^"]*"',
                              lambda m: m.group(1) + json.dumps(neu), roh, count=1)
    if anzahl != 1:
        sag('   accessToken nicht gefunden — nichts geaendert')
        return 2
    with open(CONFIG + '.neu', 'w') as f:
        f.write(ersetzt)
    os.replace(CONFIG + '.neu', CONFIG)

    sag('── Fremde Anmeldung beiseitelegen und librespot neu starten')
    try:
        os.replace(CREDS, CREDS + '.fremdes-konto')
    except FileNotFoundError:
        pass
    subprocess.run(['systemctl', 'restart', 'librespot.service'], check=False)

    sag('── Warten, bis librespot sich angemeldet hat')
    for i in range(40):
        time.sleep(5)
        try:
            with open(CREDS) as f:
                json.load(f)
            sag('   nach %d s angemeldet' % ((i + 1) * 5))
            break
        except Exception:
            continue
    else:
        sag('   auch nach 200 s keine neue Anmeldung — sudo journalctl -u librespot -n 30')
        return 2

    sag('')
    return pruefen()


MARKE = '/run/mixpibox-librespot-geheilt'
# EINE HALBE STUNDE ZWISCHEN ZWEI HEILUNGEN. librespot startet im Fehlerfall
# alle zwoelf Sekunden neu; ohne Drosselung liefe die Heilung genauso oft und
# holte alle zwoelf Sekunden einen Token bei Spotify. Das ist der Unterschied
# zwischen einer Reparatur und einem Sturmlauf gegen eine fremde Schnittstelle.
#
# /run und nicht /var: die Marke soll einen Neustart NICHT ueberleben. Wer die
# Box neu startet, will, dass es wieder versucht wird.
FRIST = 1800


def heilen():
    """Fuer den Waechter: eingreifen, wenn librespot nicht spielen KANN.

    Der Unterschied zu --reparieren ist die Zurueckhaltung. --reparieren wird
    von Hand aufgerufen und darf tun, was noetig ist. --heilen laeuft
    unbeaufsichtigt und muss deshalb in JEDEM Zweifelsfall nichts tun:

      * Laeuft librespot rund und beim richtigen Konto, wird nicht angefasst.
      * Ist der Zustand nicht feststellbar, wird nicht angefasst.
      * Und oefter als alle 30 Minuten wird ueberhaupt nicht angefasst.

    ══ ZWEI RUECKGABEN, UND DER UNTERSCHIED IST WICHTIG ═════════════════════
        0  Es gibt hier nichts zu heilen. Der Waechter darf librespot
           neu starten — das ist dann die richtige Antwort.
        3  Erledigt oder bewusst unterlassen. Der Waechter darf NICHT
           zusaetzlich neu starten.

    Die 3 gilt auch nach einer GEGLUECKTEN Heilung. Sonst wuerde der Waechter
    das eben frisch angemeldete librespot sofort wieder abschiessen — und die
    Anmeldung, auf die 200 Sekunden gewartet wurde, waere umsonst gewesen.

    WAS ES NICHT HEILEN KANN, und das gehoert ins Protokoll statt in eine
    Endlosschleife: ein Konto ohne Premium, ein zurueckgezogener Zugang, ein
    geloeschtes refreshToken. In all diesen Faellen scheitert die Heilung
    ordentlich, die Drossel haelt sie bei einem Versuch je 30 Minuten, und im
    Protokoll steht, woran es lag.
    """
    # ══ BEIDE URSACHEN, EIN EINSTIEG ════════════════════════════════════
    # Der Waechter kann von aussen nicht unterscheiden, ob librespot beim
    # falschen Konto angemeldet ist oder gar nicht hereingelassen wird — er
    # sieht nur, dass die Box in Spotifys Geraeteliste fehlt. Die Unterscheidung
    # gehoert deshalb hierher, wo beide Befunde vorliegen. Die Reparatur ist
    # ohnehin dieselbe: frischer Token, alte Anmeldung beiseite, neu starten.
    weg = abgewiesen()
    if weg is None:
        sag('  Zustand nicht feststellbar — es wird nichts angefasst.')
        return 3

    grund = 'librespot wird von Spotify abgewiesen' if weg else ''
    if not grund:
        stand = pruefen()
        if stand == 2:
            sag('  Konto nicht pruefbar — es wird nichts angefasst.')
            return 3
        if stand == 0:
            sag('  librespot laeuft und gehoert zum Konto der Box.')
            return 0
        grund = 'librespot ist bei einem FREMDEN Konto angemeldet'

    # ══ WER HOERT, WIRD NICHT UNTERBROCHEN — UND ZWAR VOR DER DROSSEL ══
    #
    # Hier stand die Pruefung ZULETZT, nach dem Setzen der Marke. Damit
    # verbrauchte ein Lauf, der gar nichts tat, die halbe Stunde Drossel: nach
    # dem Ende der Wiedergabe haette die Box bis zu 30 Minuten gewartet, bevor
    # sie sich ihr Geraet zurueckholt. Eine Drossel ist fuer Eingriffe da, und
    # hier findet keiner statt.
    if spielt_gerade():
        sag('  %s — aber es laeuft gerade etwas.' % grund)
        sag('  Es wird NICHT eingegriffen. Ein fremdes Konto ist ein Zustand,')
        sag('  der Zeit hat; eine Geschichte mitten im Satz nicht. Sobald Ruhe')
        sag('  ist, holt sich die Box ihr Geraet zurueck — spaetestens beim')
        sag('  naechsten Waechterlauf in fuenf Minuten.')
        return 3

    try:
        alter = time.time() - os.path.getmtime(MARKE)
        if alter < FRIST:
            sag('  Vor %d min schon geheilt — es bleibt bei einem Versuch je '
                '%d min.' % (alter // 60, FRIST // 60))
            sag('  Haelt es an, liegt es nicht am Token: Premium abgelaufen, '
                'Zugang zurueckgezogen, oder das refreshToken ist weg.')
            return 3
    except OSError:
        pass

    try:
        with open(MARKE, 'w') as f:
            f.write(str(int(time.time())))
    except OSError:
        # Ohne Marke lieber gar nicht heilen, als ungedrosselt.
        sag('  Die Marke %s laesst sich nicht schreiben — ohne Drossel wird '
            'nicht geheilt.' % MARKE)
        return 3

    sag('  %s. Neue Anmeldung mit frischem Token.' % grund)
    reparieren()
    # Ob es geklappt hat, steht im Protokoll. Fuer den Waechter zaehlt nur:
    # hier wurde angefasst, also nicht noch einmal obendrauf.
    return 3


if __name__ == '__main__':
    if '--heilen' in sys.argv:
        sys.exit(heilen())
    if '--reparieren' in sys.argv:
        # Nur reparieren, wenn es wirklich noetig ist: ein unnoetiger Neustart
        # reisst laufende Wiedergabe ab.
        stand = pruefen()
        sys.exit(0 if stand == 0 else reparieren())
    sys.exit(pruefen())
