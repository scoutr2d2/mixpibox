import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mixpibox_fernbedienung/box_client.dart';
import 'package:mixpibox_fernbedienung/modell.dart';

/// Eine nachgebaute Box: antwortet so, wie backend-api es tut (Pfade und
/// Fehlerformen aus server.ts / auth.ts abgeschrieben, Stand 27.09.2026).
class AttrappenBox {
  AttrappenBox({this.passwort, this.kopplung = false});

  /// Verwaltungspasswort; null = Box ohne Anmeldung.
  final String? passwort;

  /// Sperrt die Box Apps ohne Kopplung (wie server.ts seit 27.09.2026)?
  /// Der einzige gueltige Code ist [kopplungsCode], der Schluessel [schluessel].
  final bool kopplung;
  static const kopplungsCode = '123456';
  static final schluessel = 'a' * 64;
  final List<Map<String, String>> kopfzeilen = [];

  /// Bitten an die Box, den Code zu zeigen — mit dem Namen, den die App schickte.
  final List<String> bitten = [];

  /// DIE MEDIEN DER BOX (GET /api/medien), veraenderbar wie am Geraet.
  final List<Map<String, dynamic>> medien = [
    {'schluessel': 'spotify:abc', 'type': 'spotify', 'id': 'abc', 'title': 'Die Maus', 'artist': 'WDR', 'category': 'audiobook'},
    {'schluessel': 'lokal:t:conni|conni tanzt', 'type': 'library', 'title': 'Conni tanzt', 'artist': 'Conni', 'category': 'audiobook'},
  ];

  /// Wer was sieht: Kalea alles, Liam nur „Die Maus".
  final Map<String, Set<String>?> auswahl = {'kalea': null, 'liam': {'spotify:abc'}};

  /// Eine alte Box ohne /api/medien/aus-link: sie antwortet mit ihrer Startseite.
  bool ohneAusLink = false;

  /// Steht die Box gerade im Schreiben (dataLock)? Dann 409 `gesperrt`.
  bool gesperrt = false;

  /// Welche Wege in welcher Reihenfolge geschrieben wurden.
  final List<String> schreibwege = [];
  final List<String> befehle = [];
  final List<Map<String, dynamic>> rumpfe = [];
  final List<String> herunterGeladen = [];

  /// ALSA-Lautstaerke, die `/player/local` meldet.
  int lautstaerke = 40;

  /// Wohin `/api/bild/laufend` umleitet; null = kein Bild (404).
  String? laufendesBild = '/api/bild/spotify%3Anah';
  static const sitzung = 'abc123';
  String aktiv = 'gast';

  http.Response _json(Object o, [int status = 200]) =>
      http.Response(jsonEncode(o), status, headers: {'content-type': 'application/json'});

  MockClient client() => MockClient((req) async {
    final pfad = req.url.path;
    kopfzeilen.add(req.headers);
    // DIE SPERRE DER BOX: dieselben offenen Wege wie OFFEN_FUER_APP in kopplung.ts.
    if (kopplung && req.headers['x-mixpi-app'] != null) {
      const offen = ['/api/box', '/api/kopplung/anfrage', '/api/kopplung/koppeln', '/api/kopplung/status'];
      if (!offen.contains(pfad) && req.headers['x-mixpi-schluessel'] != schluessel) {
        return _json({'error': 'nichtGekoppelt', 'hinweis': 'Dieses Handy ist mit der Box nicht gekoppelt.'}, 403);
      }
    }
    // ── Medien verwalten (dieselben Formen wie server.ts, 27.09.2026) ──
    if (pfad == '/api/medien' && req.method == 'GET') {
      return _json({'eintraege': medien, 'gesamt': medien.length});
    }
    if (pfad == '/api/medien' && req.method == 'POST') {
      final b = (jsonDecode(req.body) as Map).cast<String, dynamic>();
      if (b.containsKey('eintrag')) return _json({'error': 'unvollstaendig'}, 400);
      final s = '${b['type']}:${b['id']}';
      if (medien.any((m) => m['schluessel'] == s)) return _json({'error': 'schonVorhanden', 'schluessel': s}, 409);
      medien.add({...b, 'schluessel': s});
      schreibwege.add('POST $s');
      return _json({'ok': true, 'schluessel': s});
    }
    final eintragWeg = RegExp(r'^/api/medien/([^/]+)$').firstMatch(pfad);
    if (eintragWeg != null && pfad != '/api/medien/suche' && (req.method == 'PATCH' || req.method == 'DELETE')) {
      if (gesperrt) return _json({'error': 'gesperrt'}, 409);
      final s = Uri.decodeComponent(eintragWeg.group(1)!);
      final i = medien.indexWhere((m) => m['schluessel'] == s);
      if (i < 0) return _json({'error': 'nichtGefunden'}, 404);
      schreibwege.add('${req.method} $s');
      if (req.method == 'DELETE') {
        medien.removeAt(i);
      } else {
        final b = (jsonDecode(req.body) as Map).cast<String, dynamic>();
        if (b['title'] != null) medien[i]['title'] = b['title'];
        if (b['category'] != null) medien[i]['category'] = b['category'];
      }
      return _json({'ok': true});
    }
    if (pfad == '/api/medien/suche') {
      final q = req.url.queryParameters['q'] ?? '';
      return _json({
        'treffer': [
          {'schluessel': 'spotify:neu1', 'dienst': 'spotify', 'art': 'album', 'type': 'spotify', 'id': 'neu1', 'title': '$q – Folge 1', 'artist': 'Verlag', 'category': 'audiobook'},
          {'schluessel': 'spotify:track1', 'dienst': 'spotify', 'art': 'titel', 'type': 'spotify', 'title': 'Ein Lied', 'nurFuerListe': true},
        ],
        'hinweise': [],
      });
    }
    if (pfad == '/api/medien/aus-link' && ohneAusLink) {
      return http.Response('<!doctype html><title>MixPiBox</title>', 200, headers: {'content-type': 'text/html'});
    }
    if (pfad == '/api/medien/aus-link') {
      // Wie die Box bei einem geteilten TITEL: sein Album, mit Hinweis.
      if (!(req.url.queryParameters['url'] ?? '').contains('open.spotify.com')) {
        return _json({'error': 'keinSpotifyLink', 'hinweis': 'Darin steht kein Link zu Spotify.'}, 400);
      }
      return _json({
        'art': 'track',
        'treffer': [
          {'schluessel': 'spotify:reklamation', 'dienst': 'spotify', 'art': 'album', 'type': 'spotify', 'id': 'reklamation', 'title': 'Die Reklamation', 'artist': 'Wir sind Helden'},
        ],
        'hinweise': ['„Nur ein Wort" ist ein einzelner Titel — die Box nimmt sein Album auf.'],
      });
    }
    if (pfad == '/api/profil/auswahlen') {
      return _json({
        'profile': [
          for (final e in auswahl.entries)
            {'kennung': e.key, 'name': e.key[0].toUpperCase() + e.key.substring(1), 'alle': e.value == null, 'werke': [...?e.value]},
        ],
      });
    }
    if (pfad == '/api/profil/auswahl/werk') {
      final b = (jsonDecode(req.body) as Map).cast<String, dynamic>();
      final p = '${b['profil']}';
      final bisher = auswahl[p];
      // WIE DIE BOX: aus „alles" auf eine Liste mit nur diesem Werk — erst fragen.
      if (bisher == null && b['an'] == false && b['bestaetigt'] != true) {
        return _json({'error': 'bestaetigung', 'frage': 'einsperren', 'anzahl': medien.length - 1}, 409);
      }
      final neu = {...(bisher ?? medien.map((m) => '${m['schluessel']}'))};
      if (b['an'] == true) {
        neu.add('${b['schluessel']}');
      } else {
        neu.remove('${b['schluessel']}');
      }
      auswahl[p] = neu;
      schreibwege.add('AUSWAHL $p ${b['schluessel']} ${b['an']}');
      return _json({'profil': p, 'alle': false, 'werke': [...neu]});
    }
    if (pfad == '/api/system/medien-neu') {
      schreibwege.add('EINLESEN');
      return _json({'ok': true});
    }
    if (pfad == '/api/kopplung/anfrage') {
      // Wie die Box: hoechstens alle 30 s — hier: die zweite Bitte wird gebremst.
      if (bitten.isNotEmpty) return _json({'error': 'zuOft', 'hinweis': 'Die Box zeigt es schon.'}, 429);
      bitten.add('${(jsonDecode(req.body) as Map)['name']}');
      return _json({'ok': true});
    }
    if (pfad == '/api/kopplung/status') {
      return _json({'gekoppelt': req.headers['x-mixpi-schluessel'] == schluessel, 'name': null, 'ohneKopplung': !kopplung});
    }
    if (pfad == '/api/kopplung/koppeln') {
      final code = (jsonDecode(req.body) as Map)['code'];
      if (code != kopplungsCode) return _json({'error': 'kopplung_falsch', 'hinweis': 'Der Code stimmt nicht.'}, 403);
      return _json({'schluessel': schluessel, 'id': 'hdy_1'});
    }
    final angemeldet = passwort == null || (req.headers['cookie'] ?? '').contains('mupi_admin=$sitzung');
    if (pfad == '/api/auth/login') {
      final pw = (jsonDecode(req.body) as Map)['password'];
      if (pw != passwort) return _json({'ok': false, 'error': 'falsches Passwort'}, 401);
      return http.Response(
        jsonEncode({'ok': true}),
        200,
        headers: {'set-cookie': 'mupi_admin=$sitzung; Path=/; HttpOnly; SameSite=Strict'},
      );
    }
    if (!angemeldet) return _json({'error': 'anmeldung erforderlich'}, 401);
    if (pfad == '/api/box') return _json({'box': 'mixpibox', 'name': 'kinderzimmer'});
    if (pfad.startsWith('/player/current/')) {
      befehle.add(Uri.decodeComponent(pfad.substring('/player/current/'.length)));
      return _json({'status': 'ok'});
    }
    if (pfad == '/player/local') {
      return _json({
        'currentPlayer': 'spotify',
        'playing': true,
        'pause': false,
        'album': '',
        'currentTrackname': '',
        'volume': lautstaerke,
        'totalTracks': '12',
        'currentTracknr': 3,
      });
    }
    if (pfad == '/player/state') {
      return _json({
        'is_playing': false,
        'item': {
          'name': 'Das Lied',
          'album': {'name': 'Das Album'},
          'artists': [
            {'name': 'A'},
            {'name': 'B'},
          ],
        },
      });
    }
    if (pfad == '/api/profile') {
      return _json({
        'profile': [
          {'kennung': 'gast', 'name': 'Gast'},
          {'kennung': 'lena', 'name': 'Lena', 'geschuetzt': true, 'passwortArt': 'zahlen', 'figur': 'mixpi-girl-on-rainbow-v2.png'},
          {'kennung': 'tom', 'name': 'Tom', 'geschuetzt': true, 'passwortArt': 'muster'},
        ],
        'aktiv': aktiv,
        'gastAktiv': true,
      });
    }
    if (pfad == '/api/profil/aktiv') {
      final b = jsonDecode(req.body) as Map<String, dynamic>;
      rumpfe.add(b);
      if (b['kennung'] == 'lena' && aktiv != 'lena') {
        if (b['passwort'] == null) return _json({'error': 'passwortNoetig', 'art': 'zahlen'}, 401);
        if (b['passwort'] != '1234') return _json({'error': 'passwortFalsch', 'art': 'zahlen'}, 403);
      }
      aktiv = b['kennung'] as String;
      return _json({'ok': true});
    }
    if (pfad == '/api/werke') {
      return _json({
        'werke': [
          {
            'schluessel': 'w1',
            'titel': 'Eins',
            'bild': '/api/bild/w%201',
            'quellen': [
              {'dienst': 'spotify', 'kennung': 'x'},
            ],
          },
          {'schluessel': 'w2', 'titel': 'Weg', 'fehlt': true},
          {
            'schluessel': 'lokal:t:gruss',
            'titel': 'Grüße',
            'quellen': [
              {'dienst': 'lokal', 'kennung': 't:gruss'},
            ],
          },
          // WIE AUF DER BOX .62: verschmolzen, Spotify fuehrt, lokal haengt dran.
          {
            'schluessel': 'spotify:nah',
            'titel': 'Nah',
            'quellen': [
              {'dienst': 'spotify', 'kennung': 'nah'},
              {'dienst': 'lokal', 'kennung': 't:nah'},
            ],
          },
        ],
      });
    }
    if (pfad == '/api/bild/laufend') {
      // Wie die Box: eine Umleitung auf die feste Adresse des Albums.
      if (laufendesBild == null) return http.Response('', 404);
      return http.Response('', 302, headers: {'location': laufendesBild!});
    }
    final download = RegExp(r'^/api/werke/(.+)/download$').firstMatch(pfad);
    if (download != null) {
      final s = Uri.decodeComponent(download.group(1)!);
      herunterGeladen.add(s);
      if (s == 'lokal:t:gruss' || s == 'spotify:nah') {
        // Wie Express' res.attachment() bei Umlauten: schlicht UND mit Stern.
        return http.Response.bytes(
          [0x50, 0x4b, 0x03, 0x04, ...utf8.encode('inhalt von $s')],
          200,
          headers: {
            'content-type': 'application/zip',
            'content-disposition': "attachment; filename=\"Gr_e.zip\"; filename*=UTF-8''Gr%C3%BC%C3%9Fe.zip",
          },
        );
      }
      return _json({'error': 'nichtLokal', 'hinweis': 'Nur was auf der Platte liegt, laesst sich holen.'}, 409);
    }
    if (pfad == '/api/spielen') {
      rumpfe.add(jsonDecode(req.body) as Map<String, dynamic>);
      return _json({'fehler': 'Kinderzeit ist um'}, 403);
    }
    return _json({'error': 'unbekannt'}, 404);
  });
}

BoxEintrag eintrag() => BoxEintrag(id: 'x', name: 'Kinderzimmer', adresse: '192.168.178.99');

void main() {
  group('Kopplung', () {
    test('liest nur das Zeichen der Box — mixpi:<adresse>:<port>:<code>', () {
      final q = koppelQrLesen('mixpi:192.168.178.62:8200:012345');
      expect(q?.adresse, '192.168.178.62');
      expect(q?.port, 8200);
      expect(q?.code, '012345');
      expect(koppelQrLesen('mixpi:1.2.3.4:8200:12345'), isNull);
      expect(koppelQrLesen('https://example.org'), isNull);
      expect(koppelQrLesen(null), isNull);
    });

    test('ohne Kopplung meldet der Client KopplungNoetig — die Box findet er trotzdem', () async {
      final box = AttrappenBox(kopplung: true);
      final c = BoxClient(eintrag(), client: box.client());
      expect(await c.kennung(), isNotNull);
      await expectLater(c.profile(), throwsA(isA<KopplungNoetig>()));
    });

    test('die Bitte an die Box geht ohne Kopplung durch — eine zweite zu schnelle kommt mit dem Satz zurueck', () async {
      final box = AttrappenBox(kopplung: true);
      final c = BoxClient(eintrag(), client: box.client());
      await c.kopplungAnfragen(name: 'Achims Honor');
      expect(box.bitten, ['Achims Honor']);
      await expectLater(
        c.kopplungAnfragen(),
        throwsA(isA<BoxFehler>().having((e) => e.satz, 'satz', 'Die Box zeigt es schon.')),
      );
    });

    test('ein falscher Code kommt mit dem Satz der Box zurueck', () async {
      final c = BoxClient(eintrag(), client: AttrappenBox(kopplung: true).client());
      await expectLater(
        c.koppeln('000000'),
        throwsA(isA<BoxFehler>().having((e) => e.satz, 'satz', 'Der Code stimmt nicht.')),
      );
    });

    test('koppeln merkt den Schluessel, meldet ihn zum Speichern, und schickt ihn ab da mit', () async {
      final box = AttrappenBox(kopplung: true);
      final e = eintrag();
      final c = BoxClient(e, client: box.client());
      BoxEintrag? gemeldet;
      c.geaendert = (b) => gemeldet = b;
      await c.koppeln(AttrappenBox.kopplungsCode, name: 'Achims Honor');
      expect(e.schluessel, AttrappenBox.schluessel);
      expect(gemeldet, same(e));
      await c.profile();
      expect(box.kopfzeilen.last['x-mixpi-schluessel'], AttrappenBox.schluessel);
      expect(BoxEintrag.ausJson(e.alsJson()).schluessel, AttrappenBox.schluessel, reason: 'ueberlebt das Speichern');
    });
  });

  group('ohne Anmeldung', () {
    late AttrappenBox box;
    late BoxClient c;
    setUp(() {
      box = AttrappenBox();
      c = BoxClient(eintrag(), client: box.client());
    });

    test('erkennt eine MixPiBox an /api/box', () async {
      expect(await c.kennung(), 'kinderzimmer');
    });

    test('Wiedergabe: Spotify-Titel kommt aus /player/state, Pause auch', () async {
      final w = await c.wiedergabe();
      expect(w.titel, 'Das Lied');
      expect(w.album, 'Das Album');
      expect(w.interpret, 'A, B');
      expect(w.lautstaerke, 40);
      expect(w.titelGesamt, 12);
      expect(w.hoerbar, isFalse, reason: 'is_playing=false heisst Pause, auch wenn lokal playing=true sagt');
    });

    test('Befehle gehen an /player/current/<befehl>, Doppelpunkt bleibt lesbar', () async {
      await c.befehl('pause');
      await c.lautstaerke(250);
      await c.befehl('seek+30');
      expect(box.befehle, ['pause', 'setvolume:100', 'seek+30']);
    });

    test('Profilwechsel: ohne, mit falschem, mit richtigem Passwort', () async {
      await expectLater(
        c.profilWechseln('lena'),
        throwsA(isA<ProfilPasswortNoetig>().having((e) => e.status, 'status', 401)),
      );
      await expectLater(
        c.profilWechseln('lena', passwort: '0000'),
        throwsA(isA<ProfilPasswortNoetig>().having((e) => e.status, 'status', 403)),
      );
      await c.profilWechseln('lena', passwort: '1234');
      expect((await c.profile()).aktiv, 'lena');
    });

    test('Profile: Muster-Passwort ist am Handy nicht eingebbar', () async {
      final p = await c.profile();
      expect(p.profile.map((k) => k.kennung), ['gast', 'lena', 'tom']);
      expect(p.profile[1].perTastaturEingebbar, isTrue);
      expect(p.profile[2].perTastaturEingebbar, isFalse);
    });

    test('Mediathek laesst fehlende Werke weg; Bildpfad wird nicht doppelt kodiert', () async {
      final w = await c.werke();
      expect(w.map((x) => x.schluessel), ['w1', 'lokal:t:gruss', 'spotify:nah']);
      expect(c.bildAdresse(w.first.bild).toString(), 'http://192.168.178.99:8200/api/bild/w%201?ohneRueckfall=1');
      // `laufend` und `extern` bekommen den Zusatz NICHT — sie haben eigene Regeln.
      expect(c.bildAdresse('/api/bild/extern?u=x').queryParameters.containsKey('ohneRueckfall'), isFalse);
    });

    test('Profilbild: aus dem Profil gelesen, unter /neu/bilder/figuren/, nie aus dem Ordner hinaus', () async {
      final p = await c.profile();
      expect(p.profile.firstWhere((k) => k.kennung == 'lena').figur, 'mixpi-girl-on-rainbow-v2.png');
      expect(p.profile.firstWhere((k) => k.kennung == 'gast').figur, '');
      expect(
        c.figurAdresse('mixpi-girl-on-rainbow-v2.png').toString(),
        'http://192.168.178.99:8200/neu/bilder/figuren/mixpi-girl-on-rainbow-v2.png',
      );
      expect(c.figurAdresse(''), isNull);
      expect(c.figurAdresse('../../config.json'), isNull);
      expect(c.figurAdresse('a/b.png'), isNull);
    });

    test('Cover: das ZIEL der Umleitung, nicht die Umleitung — und null, wenn es keins gibt', () async {
      expect(await c.coverZiel(), '/api/bild/spotify%3Anah');
      box.laufendesBild = '/api/bild/lokal%3At%3Agruss';
      expect(await c.coverZiel(), '/api/bild/lokal%3At%3Agruss', reason: 'neues Album, neue Adresse');
      box.laufendesBild = null;
      expect(await c.coverZiel(), isNull);
    });

    test('Lokal ist, was EINE lokale Quelle hat — auch wenn Spotify fuehrt', () async {
      final w = await c.werke();
      expect({for (final x in w) x.schluessel: x.lokal}, {'w1': false, 'lokal:t:gruss': true, 'spotify:nah': true});
    });

    test('Herunterladen schreibt die Bytes und nimmt den Namen mit Umlaut', () async {
      final ziel = File('${Directory.systemTemp.createTempSync('mixpi-dl-').path}/x.part');
      var zuletzt = 0;
      final name = await c.herunterladen('lokal:t:gruss', ziel, fortschritt: (b) => zuletzt = b);
      expect(name, 'Grüße.zip');
      final bytes = ziel.readAsBytesSync();
      expect(bytes.sublist(0, 4), [0x50, 0x4b, 0x03, 0x04]);
      expect(zuletzt, bytes.length);
      expect(box.herunterGeladen.last, 'lokal:t:gruss', reason: 'Schluessel mit Doppelpunkt kommt heil an');
    });

    test('Ein Werk ohne Platte kommt mit dem Satz der Box zurueck, nicht mit ihrem Fehlercode', () async {
      final ziel = File('${Directory.systemTemp.createTempSync('mixpi-dl-').path}/x.part');
      await expectLater(
        c.herunterladen('w1', ziel),
        throwsA(isA<BoxFehler>().having((e) => e.satz, 'satz', 'Nur was auf der Platte liegt, laesst sich holen.')),
      );
    });

    test('Medien: Liste, Dienst aus dem Typ, Kategorie', () async {
      final m = await c.medien();
      expect(m.map((e) => e.titel), ['Die Maus', 'Conni tanzt']);
      expect(m.map((e) => e.dienst), ['spotify', 'lokal']);
      expect(m.first.kategorie, 'audiobook');
    });

    test('Medien: Aufnehmen schickt den Treffer FLACH — und nichts, was die Box nicht will', () async {
      final treffer = (await c.medienSuchen('Maus')).first;
      final s = await c.medienHinzufuegen(treffer, kategorie: 'audiobook');
      expect(s, 'spotify:neu1');
      expect(box.medien.last['category'], 'audiobook', reason: 'die gewaehlte Kategorie, nicht die des Treffers');
      expect(box.medien.last.containsKey('eintrag'), isFalse);
      expect(box.medien.last.containsKey('dienst'), isFalse, reason: 'nur die Felder eines Eintrags');
    });

    test('Medien: Umbenennen und Loeschen ueber den Schluessel — auch mit Doppelpunkt und Senkrechtstrich', () async {
      await c.medienAendern('lokal:t:conni|conni tanzt', {'title': 'Conni tanzt!'});
      expect(box.medien.last['title'], 'Conni tanzt!');
      await c.medienLoeschen('lokal:t:conni|conni tanzt');
      expect(box.medien.map((m) => m['schluessel']), ['spotify:abc']);
    });

    test('Medien: „gesperrt" kommt als lesbarer Satz, nicht als Fehlercode', () async {
      box.gesperrt = true;
      await expectLater(
        c.medienLoeschen('spotify:abc'),
        throwsA(isA<BoxFehler>().having((e) => e.satz, 'satz', contains('schreibt gerade'))),
      );
    });

    test('Auswahl: Einsperren fragt zurueck — erst mit bestaetigt geht es durch', () async {
      await expectLater(
        c.auswahlSetzen('kalea', 'spotify:abc', an: false),
        throwsA(isA<AuswahlRueckfrage>().having((r) => r.frage, 'frage', 'einsperren')),
      );
      expect(box.auswahl['kalea'], isNull, reason: 'ohne Ja aendert sich nichts');
      await c.auswahlSetzen('kalea', 'spotify:abc', an: false, bestaetigt: true);
      expect(box.auswahl['kalea'], isNot(contains('spotify:abc')));
    });

    test('geteilter Link: Treffer und Hinweis der Box — kein Link kommt mit ihrem Satz zurueck', () async {
      final r = await c.medienAusLink('Hör dir an: https://open.spotify.com/track/xyz?si=1');
      expect(r.treffer.single['title'], 'Die Reklamation');
      expect(r.hinweise.single, contains('einzelner Titel'));
      // EINE ALTE BOX leitet den unbekannten Weg auf die Startseite um (an .62
      // gemessen, 27.09.2026) — das darf nicht als „nichts gefunden" enden.
      box.ohneAusLink = true;
      await expectLater(
        c.medienAusLink('https://open.spotify.com/album/x'),
        throwsA(isA<BoxFehler>().having((e) => e.satz, 'satz', contains('braucht ein Update'))),
      );
      box.ohneAusLink = false;
      await expectLater(
        c.medienAusLink('ein Hund'),
        throwsA(isA<BoxFehler>().having((e) => e.satz, 'satz', 'Darin steht kein Link zu Spotify.')),
      );
    });

    test('Absage der Box (Kinderzeit) kommt mit ihrem Satz an', () async {
      await expectLater(c.spielen('w1'), throwsA(isA<BoxFehler>().having((e) => e.satz, 'satz', 'Kinderzeit ist um')));
      expect(box.rumpfe.last, {'schluessel': 'w1'});
    });
  });

  group('mit Verwaltungspasswort', () {
    late AttrappenBox box;
    late BoxEintrag e;
    late BoxClient c;
    setUp(() {
      box = AttrappenBox(passwort: 'geheim');
      e = eintrag();
      c = BoxClient(e, client: box.client());
    });

    test('/api/box hinter dem Tor zaehlt trotzdem als Box', () async {
      expect(await c.kennung(), '');
    });

    test('ohne Sitzung: AnmeldungNoetig', () async {
      await expectLater(c.wiedergabe(), throwsA(isA<AnmeldungNoetig>()));
    });

    test('falsches Passwort legt keine Sitzung an', () async {
      await expectLater(c.anmelden('falsch'), throwsA(isA<BoxFehler>()));
      expect(e.sitzung, isNull);
    });

    test('Anmeldung merkt das Cookie und meldet die Aenderung', () async {
      BoxEintrag? gemeldet;
      c.geaendert = (b) => gemeldet = b;
      await c.anmelden('geheim');
      expect(e.sitzung, AttrappenBox.sitzung);
      expect(gemeldet, same(e));
      expect((await c.wiedergabe()).titel, 'Das Lied');
    });
  });

  test('Set-Cookie: nur mupi_admin, auch zwischen anderen Cookies', () {
    expect(BoxClient.sitzungAusSetCookie('mupi_admin=Zz-9_; Path=/'), 'Zz-9_');
    expect(BoxClient.sitzungAusSetCookie('andere=1, mupi_admin=q; Path=/'), 'q');
    expect(BoxClient.sitzungAusSetCookie('nicht_mupi_admin=q'), isNull);
    expect(BoxClient.sitzungAusSetCookie('mupi_admin=; Max-Age=0'), isNull);
    expect(BoxClient.sitzungAusSetCookie(null), isNull);
  });

  test('ein abgeschalteter Gast ist kein Wechselziel', () {
    final s = ProfilStand.ausJson({
      'profile': [
        {'kennung': 'gast', 'name': 'Gast'},
        {'kennung': 'lena', 'name': 'Lena'},
      ],
      'aktiv': 'lena',
      'gastAktiv': false,
    });
    expect(s.profile.map((p) => p.kennung), ['lena']);
  });
}
