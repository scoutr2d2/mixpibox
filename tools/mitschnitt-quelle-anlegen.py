#!/usr/bin/env python3
"""Verwaisten Mitschnitt-Kacheln ihre Spotify-QUELLE beschaffen — nicht nur paaren.

══ WOFUER (20.09.2026, Betreiber-Befund) ═══════════════════════════════════
Betreiber, woertlich: „die box zeigt von ohrwuermer und kinderlieder nur die
aufgezeichneten aber nicht die fehlenden. Warum wird nicht aufgefuellt mit den
internet verfuegbaren."

AM GERAET NACHGEMESSEN (Box 192.168.178.62, 20.09.2026):

    Ohrwuermer und Kinderlieder mit Eva und dem Elefanten   9 von 15 Titeln
      Dateien 01,05,06,08,10,11,12,14,15 — 02,03,04,07,09,13 fehlen
    Die 30 besten Kinderlieder 2025                         4 von 30 Titeln

Der Mitschnitt ist ein PASSIVER Abgriff: aufgenommen wird, was gespielt wurde.
Ein teilweise gehoertes Album liegt danach TEILWEISE auf der Platte, und die
Kachel zeigt genau diesen Bestand.

WARUM NICHT AUFGEFUELLT WIRD — die Kette, Glied fuer Glied:

    1. `/api/werke/<k>/inhalt` holt bei eingeschalteter Verschmelzung ALLE
       Quellen des Werks und nimmt die vollere (`waehleInhalt`,
       verschmelzung.ts). Das IST das Auffuellen, und es ist gebaut.
    2. „Alle Quellen" heisst: alle Eintraege in data.json, die per
       `verschmelzung.json` demselben Werk zugeordnet sind
       (`eintraegeInBevorzugung`, server.ts). Ein Schluessel OHNE Eintrag wird
       uebergangen.
    3. Fuer diese beiden Alben gibt es KEINEN Spotify-Eintrag — das Kind hat
       sie nicht von einer Album-Kachel aus gespielt. Also nur EIN Kandidat,
       und der ist der Mitschnitt. Es gibt nichts, wovon aufgefuellt werden
       koennte.

`tools/mitschnitt-zuordnungen-nachtragen.py` daneben PAART eine lokale Kachel
mit einer vorhandenen Spotify-Zeile. Es kann keine beschaffen — und genau das
ist hier der fehlende Schritt. Dieses Werkzeug schliesst die Luecke.

══ WOHER DIE KENNUNG KOMMT ════════════════════════════════════════════════
Nicht aus einer Suche nach Titel und Interpret (die haelt „Deluxe", „Live" und
„Remaster" nicht auseinander), sondern aus dem, was der Mitschnitt SELBST
aufgeschrieben hat: seine Vormerkliste fuehrt je aufgenommenem Stueck die
`spotify:track:`-Kennung. Ein `GET tracks/<id>` nennt das Album dazu — eine
Tatsache, keine Aehnlichkeit.

GEGENPROBE STATT EINZELTREFFER: Gibt es zwei oder mehr aufgenommene Stuecke,
werden ZWEI aufgeloest und muessen dasselbe Album nennen. Ein Ordner, dessen
Stuecke aus verschiedenen Alben stammen, ist kein Album — er bleibt liegen und
wird genannt. Ein einzelnes Stueck reicht nur mit `--einzeln`.

══ WAS GESCHRIEBEN WIRD ════════════════════════════════════════════════════
    POST /api/medien                      der Spotify-Eintrag des Albums
    POST /api/verschmelzung/festschreiben lokal <-> spotify, Stufe „hand"

Beides ueber die Box-API, nie an data.json vorbei: der Server haelt die Sperre
und schreibt atomar. Beide Endpunkte sind idempotent (409 „schonVorhanden"
bzw. `handVerbinden`), ein zweiter Lauf aendert also nichts.

ANLEGEN IST NICHT UMKEHRBAR WIE EINE MESSUNG: der neue Eintrag steht danach in
data.json, und die Kachel zeigt mehr Titel als vorher. Deshalb ist die PROBE
die Vorgabe und `--schreiben` ausdruecklich — umgekehrt als beim
Geschwisterwerkzeug, das nur eine Zuordnung nachtraegt.

══ AUFRUF ══════════════════════════════════════════════════════════════════
    python3 tools/mitschnitt-quelle-anlegen.py                  # nur zeigen
    python3 tools/mitschnitt-quelle-anlegen.py --schreiben       # anlegen
    …                              --box 192.168.178.62          # Vorgabe mixpibox.local
    …                              --einzeln                     # ein Stueck genuegt

Rueckgabe: 0 = nichts zu tun oder alles geschrieben, 1 = mindestens ein
Fehlschlag, 2 = Box nicht erreichbar.
"""

import importlib.util
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

WURZEL = Path(__file__).resolve().parent


def _normal_laden():
    """`normal()` des Geschwisterwerkzeugs — EINE Regel, nicht zwei.

    Der Dateiname traegt Bindestriche, ein gewoehnliches `import` scheitert
    daran. Eine Kopie der acht Zeilen waere die billigere Loesung und die
    teurere Rechnung: sie liefe irgendwann auseinander, und dann paart das
    eine Werkzeug, was das andere nicht findet.
    """
    pfad = WURZEL / 'mitschnitt-zuordnungen-nachtragen.py'
    spec = importlib.util.spec_from_file_location('mitschnitt_zuordnungen', pfad)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul.normal


normal = _normal_laden()


def hole(box: str, weg: str, frist: int = 20):
    with urllib.request.urlopen(f'http://{box}:8200{weg}', timeout=frist) as a:
        return json.load(a)


def schicke(box: str, weg: str, rumpf: dict, frist: int = 20):
    """POST — gibt `(status, antwort)` zurueck, auch bei 4xx.

    Ein 409 ist hier KEIN Fehler, sondern die haeufigste gute Antwort („gibt es
    schon"). Wer ihn als Ausnahme behandelt, meldet einen zweiten Lauf als
    Fehlschlag.
    """
    anfrage = urllib.request.Request(
        f'http://{box}:8200{weg}',
        data=json.dumps(rumpf).encode(),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(anfrage, timeout=frist) as a:
            return a.status, json.load(a)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.load(e)
        except Exception:
            return e.code, {}


def albumKennung(box: str, track_uri: str):
    """`spotify:track:<id>` -> `(albumId, albumName, gesamt, bild)` oder None."""
    kennung = str(track_uri or '').rsplit(':', 1)[-1].strip()
    if not kennung:
        return None
    try:
        d = hole(box, f'/api/spotify/web/tracks/{kennung}')
    except Exception:
        return None
    a = (d or {}).get('album') or {}
    if not a.get('id'):
        return None
    bilder = a.get('images') or []
    return (
        str(a['id']),
        str(a.get('name') or ''),
        a.get('total_tracks'),
        str((bilder[0] or {}).get('url') or '') if bilder else '',
    )


def schluesselPaar(e: dict) -> tuple:
    return (normal(str(e.get('album') or '')), normal(str(e.get('albumInterpret') or e.get('interpret') or '')))


def main() -> int:
    args = sys.argv[1:]
    box = args[args.index('--box') + 1] if '--box' in args else 'mixpibox.local'
    schreiben = '--schreiben' in args
    einzeln = '--einzeln' in args

    try:
        medien = hole(box, '/api/medien')
        liste = hole(box, '/api/plugins/mixpi-mitschnitt/http/liste')
    except Exception as e:
        print(f'Box nicht erreichbar ({e})')
        return 2

    eintraege = medien.get('eintraege') or []
    schonDa = {str(e.get('schluessel') or '') for e in eintraege}
    # MEHRDEUTIGE SCHLUESSEL BLEIBEN LIEGEN — am Geraet bezahlt (20.09.2026).
    #
    # Der erste Lauf legte auch fuer „Die 30 besten Lieder fuer Maedchen" eine
    # Quelle an. Dieses Album steht ZWEIMAL lokal da (einmal `audiobook`,
    # einmal `music`) — unter DEMSELBEN Schluessel, denn der entsteht aus
    # Interpret und Titel, nicht aus der Kategorie. `verschmelzeWerke()` weist
    # jede Zuordnung ab, die einen doppelten Schluessel nennt (Fall 3,
    # verschmelzung.ts), und zwar STILL. Ergebnis: die neue Spotify-Zeile
    # verschmolz mit nichts und stand als DRITTE Kachel im Regal — das
    # Gegenteil des Gewollten. Beide Zeilen wurden von Hand wieder entfernt.
    #
    # Dasselbe sagt `abgleich.ts` ueber seine eigenen Vorschlaege: einen Knopf
    # anzubieten, der nichts tut, ist schlimmer als keiner.
    mehrfach = {k for k in schonDa if sum(1 for e in eintraege if str(e.get('schluessel') or '') == k) > 1}
    # VERWAIST heisst: lokale Kachel, die in der Verwaltung mit NIEMANDEM
    # zusammengefasst wird. `auchIn` ist genau diese Auskunft — sie kommt aus
    # `gruppiereMitVerschmelzung` und beruecksichtigt sowohl die Heuristik als
    # auch die festgeschriebenen Zuordnungen. Selbst nachzurechnen hiesse, eine
    # dritte Meinung zu bilden.
    verwaist = [
        e
        for e in eintraege
        if str(e.get('dienst') or '') == 'lokal' and not (e.get('auchIn') or [])
    ]

    # Die aufgenommenen Stuecke je Album — in Listenreihenfolge, damit die
    # Gegenprobe zwei VERSCHIEDENE Stuecke erwischt und nicht zweimal dasselbe.
    spuren: dict = {}
    for m in liste.get('eintraege') or []:
        uri = str(m.get('uri') or '')
        if uri.startswith('spotify:track:'):
            spuren.setdefault(schluesselPaar(m), []).append(uri)

    print(f'{len(eintraege)} Eintraege, {len(verwaist)} lokale ohne Partner, {len(spuren)} Alben in der Vormerkliste\n')

    fehl = 0
    getan = 0
    for lok in verwaist:
        name = f'{lok.get("artist")} — {lok.get("title")}'
        if str(lok.get('schluessel') or '') in mehrfach:
            print(f'MEHRDEUTIGER SCHLUESSEL, bleibt liegen: {name}')
            continue
        schl = schluesselPaar({'album': lok.get('title'), 'albumInterpret': lok.get('artist')})
        uris = spuren.get(schl) or []
        if not uris:
            print(f'KEINE SPUR: {name} (nicht vom Mitschnitt, oder Liste verloren)')
            continue
        erste = albumKennung(box, uris[0])
        if not erste:
            print(f'NICHT AUFLOESBAR: {name} ({uris[0]})')
            fehl += 1
            continue
        if len(uris) > 1:
            zweite = albumKennung(box, uris[1])
            if not zweite:
                print(f'GEGENPROBE OHNE ANTWORT, bleibt liegen: {name}')
                fehl += 1
                continue
            if zweite[0] != erste[0]:
                print(f'ZWEI ALBEN IN EINEM ORDNER, bleibt liegen: {name} ({erste[0]} vs {zweite[0]})')
                continue
        elif not einzeln:
            print(f'NUR EIN STUECK, ohne Gegenprobe — mit --einzeln: {name}')
            continue

        albumId, albumName, gesamt, bild = erste
        sk = f'spotify:{albumId}'
        was = 'Quelle' if sk not in schonDa else 'Zuordnung'
        print(f'{"SCHREIBE" if schreiben else "WUERDE"} {was}: {name}  ->  {sk}  ("{albumName}", {gesamt} Titel)')
        if not schreiben:
            getan += 1
            continue

        if sk not in schonDa:
            rumpf = {
                'type': 'spotify',
                # DIE KATEGORIE DER LOKALEN KACHEL, nicht geraten: beide stehen
                # danach als EIN Werk da, und `KATEGORIE_TRENNT` (abgleich.ts)
                # wuerde ein Paar mit verschiedenen Kategorien gar nicht erst
                # zusammenlassen.
                'category': lok.get('category') or 'music',
                'title': albumName or str(lok.get('title') or ''),
                # DER INTERPRET DER LOKALEN KACHEL: unter ihm sucht die Box das
                # Werk, und der Mitschnitt hat ihn aus `album.artists` gebildet.
                'artist': lok.get('artist') or '',
                'id': albumId,
                'spotify_url': f'https://open.spotify.com/album/{albumId}',
            }
            if bild:
                rumpf['cover'] = bild
            st, antwort = schicke(box, '/api/medien', rumpf)
            if st == 409:
                print('   Quelle stand schon da.')
            elif not (200 <= st < 300):
                print(f'   QUELLE NICHT ANGELEGT ({st}): {antwort}')
                fehl += 1
                continue

        st, antwort = schicke(box, '/api/verschmelzung/festschreiben', {'schluessel': sk, 'auch': lok.get('schluessel')})
        if 200 <= st < 300:
            print('   festgeschrieben.')
            getan += 1
        else:
            print(f'   ZUORDNUNG FEHLGESCHLAGEN ({st}): {antwort}')
            fehl += 1

    print(f'\n{getan} Album/Alben {"bearbeitet" if schreiben else "gefunden"}, {fehl} Fehlschlag/-schlaege.')
    if not schreiben and getan:
        print('Nichts geschrieben. Mit --schreiben ausfuehren.')
    return 1 if fehl else 0


if __name__ == '__main__':
    sys.exit(main())
