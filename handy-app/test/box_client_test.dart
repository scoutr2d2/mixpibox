import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mixpibox_fernbedienung/box_client.dart';
import 'package:mixpibox_fernbedienung/modell.dart';

/// Eine nachgebaute Box: antwortet so, wie backend-api es tut (Pfade und
/// Fehlerformen aus server.ts / auth.ts abgeschrieben, Stand 27.09.2026).
class AttrappenBox {
  AttrappenBox({this.passwort});

  /// Verwaltungspasswort; null = Box ohne Anmeldung.
  final String? passwort;
  final List<String> befehle = [];
  final List<Map<String, dynamic>> rumpfe = [];
  static const sitzung = 'abc123';
  String aktiv = 'gast';

  http.Response _json(Object o, [int status = 200]) =>
      http.Response(jsonEncode(o), status, headers: {'content-type': 'application/json'});

  MockClient client() => MockClient((req) async {
    final pfad = req.url.path;
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
        'volume': 40,
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
          {'kennung': 'lena', 'name': 'Lena', 'geschuetzt': true, 'passwortArt': 'zahlen'},
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
          {'schluessel': 'w1', 'titel': 'Eins', 'bild': '/api/bild/w%201'},
          {'schluessel': 'w2', 'titel': 'Weg', 'fehlt': true},
        ],
      });
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
      expect(w.map((x) => x.schluessel), ['w1']);
      expect(c.bildAdresse(w.first.bild).toString(), 'http://192.168.178.99:8200/api/bild/w%201');
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
