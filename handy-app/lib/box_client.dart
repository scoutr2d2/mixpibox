import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

import 'modell.dart';

/// Etwas ist schiefgegangen — `satz` ist fuer Menschen geschrieben.
class BoxFehler implements Exception {
  BoxFehler(this.satz, {this.status, this.roh});
  final String satz;
  final int? status;

  /// Die JSON-Antwort der Box, falls es eine gab — fuer Faelle, in denen der
  /// Aufrufer mehr als den Satz braucht (Rueckfragen mit 409).
  final Object? roh;
  @override
  String toString() => satz;
}

/// Die Box verlangt eine Anmeldung (Verwaltungspasswort, `interfacelogin`).
class AnmeldungNoetig extends BoxFehler {
  AnmeldungNoetig() : super('Die Box verlangt das Verwaltungspasswort.', status: 401);
}

/// Die Box fragt zurueck, bevor sie eine Auswahl umschaltet (409 `bestaetigung`).
class AuswahlRueckfrage implements Exception {
  AuswahlRueckfrage(this.frage, this.anzahl);

  /// `einsperren`: das Kind saehe danach NUR noch dieses eine Werk.
  /// `oeffnen`: das Kind saehe danach ALLES.
  final String frage;
  final int anzahl;
}

/// Saetze fuer die Fehlercodes der Medienwege, die ohne eigenen Satz kommen.
const _medienSaetze = <Object?, String>{
  'gesperrt': 'Die Box schreibt gerade — gleich noch einmal versuchen.',
  'schonVorhanden': 'Das steht schon auf der Box.',
  'unvollstaendig': 'Der Eintrag ist unvollständig.',
  'nichtGefunden': 'Den Eintrag gibt es nicht mehr.',
  'auswahlVoll': 'Die Auswahl dieses Kindes ist voll.',
};

/// Die Box kennt dieses Handy nicht — es muss erst gekoppelt werden (Code
/// oder QR an der Box: Admin-Menü → Handys → Handy verbinden).
class KopplungNoetig extends BoxFehler {
  KopplungNoetig([String? hinweis]) : super(hinweis ?? 'Dieses Handy ist mit der Box nicht gekoppelt.', status: 403);
}

/// Ein Kinderprofil ist geschuetzt und braucht sein eigenes Passwort.
class ProfilPasswortNoetig extends BoxFehler {
  ProfilPasswortNoetig(this.art, {bool falsch = false})
    : super(falsch ? 'Das Passwort passt nicht.' : 'Dieses Profil hat ein Passwort.', status: falsch ? 403 : 401);
  final String? art;
}

/// Der Beweis, dass eine Box den ABDRUCK von [schluessel] kennt:
/// HMAC-SHA256 ueber `mixpi-kopplung-beweis:<frage>`, verschluesselt mit
/// sha256(schluessel) — dieselbe Rechnung wie `beweisVon()` in
/// src/backend-api/src/kopplung.ts. Beide Seiten nageln denselben Prueffall
/// fest (box_client_test.dart, kopplung.spec.ts); laeuft eine davon weg, wird
/// jede Umadressierung zum Neu-Koppeln, still und ohne Fehler.
String kopplungsBeweis(String schluessel, String frage) {
  final abdruck = sha256.convert(utf8.encode(schluessel)).bytes;
  return Hmac(sha256, abdruck).convert(utf8.encode('mixpi-kopplung-beweis:$frage')).toString();
}

/// Spricht mit EINER Box.
///
/// Die Box kennt zwei Tueren, beide auf demselben Port (8200 bzw. 8443):
///   `/api/…`     die Verwaltungs- und Kinderschirm-Schnittstelle,
///   `/player/…`  der Abspieldienst, durchgereicht; Befehle als
///                `/player/current/<befehl>` (so ruft ihn auch der Kinderschirm).
///
/// WARUM DIE APP DURCH DEN HERKUNFTSRIEGEL KOMMT: Er prueft `Origin` gegen
/// `Host` (herkunft.ts). Eine App schickt kein `Origin` — sie gilt dort wie
/// curl als „keine Herkunft" und wird durchgelassen. Ein Browser-Fetch von
/// einer fremden Seite dagegen nicht; deshalb ist eine native App hier der
/// einfachere Weg als eine Web-App auf einem anderen Rechner.
class BoxClient {
  BoxClient(this.box, {http.Client? client, this.frist = const Duration(seconds: 6)})
    : _client = client ?? _clientFuer(box);

  final BoxEintrag box;
  final http.Client _client;
  final Duration frist;

  /// Wird gerufen, wenn sich an `box` etwas geaendert hat, das gespeichert
  /// werden soll (neue Sitzung, erstmals gesehenes Zeugnis).
  void Function(BoxEintrag)? geaendert;

  static const cookieName = 'mupi_admin';

  static http.Client _clientFuer(BoxEintrag box) {
    if (!box.https) return http.Client();
    final hc = HttpClient()
      ..connectionTimeout = const Duration(seconds: 5)
      ..badCertificateCallback = (cert, host, port) {
        final abdruck = sha256.convert(cert.der).toString();
        // Vertrauen beim ersten Mal: das selbst ausgestellte Zeugnis der Box
        // wird gemerkt, jedes andere danach abgewiesen.
        if (box.fingerabdruck == null) {
          box.fingerabdruck = abdruck;
          return true;
        }
        return box.fingerabdruck == abdruck;
      };
    return IOClient(hc);
  }

  void schliessen() => _client.close();

  /// Woran die Box erkennt, dass ein Handy mit ihr redet — sie zeigt dann
  /// ein Handy-Zeichen in der Leiste des Kinderschirms (server.ts,
  /// `handysZuletzt`). Mit JEDER Anfrage, damit der 4-s-Takt es frisch haelt.
  static const appKopf = 'x-mixpi-app';

  /// Der Schluessel aus der Kopplung — ohne ihn laesst die Box die App nur
  /// sich finden und koppeln (server.ts, kopplung.ts).
  static const schluesselKopf = 'x-mixpi-schluessel';

  Map<String, String> get _kopf => {
    'accept': 'application/json',
    appKopf: 'fernbedienung',
    if (box.schluessel != null) schluesselKopf: box.schluessel!,
    if (box.sitzung != null) 'cookie': '$cookieName=${box.sitzung}',
  };

  Uri _uri(String pfad, [Map<String, String>? abfrage]) {
    final b = box.basis();
    return b.replace(path: pfad, queryParameters: abfrage);
  }

  Future<http.Response> _senden(Future<http.Response> anfrage, [Duration? eigeneFrist]) async {
    final vorher = box.fingerabdruck;
    try {
      final r = await anfrage.timeout(eigeneFrist ?? frist);
      if (vorher != box.fingerabdruck) geaendert?.call(box);
      return r;
    } on TimeoutException {
      throw BoxFehler('${box.name} antwortet nicht.');
    } on HandshakeException {
      throw BoxFehler('Das Zeugnis von ${box.name} hat sich geaendert. Wenn die Box neu eingerichtet wurde: '
          'in den Einstellungen der Box „Zeugnis vergessen".');
    } on SocketException catch (e) {
      throw BoxFehler('${box.name} ist nicht erreichbar (${e.osError?.message ?? e.message}).');
    } on http.ClientException catch (e) {
      throw BoxFehler('${box.name} ist nicht erreichbar (${e.message}).');
    }
  }

  dynamic _auswerten(http.Response r) {
    if (r.statusCode == 401) {
      final j = _jsonOderNull(r.body);
      if (j is Map && j['error'] == 'passwortNoetig') throw ProfilPasswortNoetig(j['art'] as String?);
      throw AnmeldungNoetig();
    }
    if (r.statusCode == 403) {
      final j = _jsonOderNull(r.body);
      if (j is Map && j['error'] == 'nichtGekoppelt') throw KopplungNoetig(j['hinweis'] as String?);
      if (j is Map && j['error'] == 'passwortFalsch') throw ProfilPasswortNoetig(j['art'] as String?, falsch: true);
      // KINDERZEIT UND BOX-SPERRE schicken keinen Satz, sondern den Grund
      // (`{kinderzeit: true, grund, …}`) — die App baut ihn, wie der
      // Kinderschirm es tut, statt „abgelehnt" ohne Warum zu zeigen.
      if (j is Map && j['kinderzeit'] == true) {
        throw BoxFehler('Nicht gestartet: ${KzStand.ausJson(j).text}.', status: 403, roh: j);
      }
      // Kinderzeit, Anbieter-Schalter oder der Herkunftsriegel: die Box legt
      // ihren Satz in `satz`/`error`/`fehler` — den zeigen, statt zu raten.
      throw BoxFehler(_satzAus(j) ?? 'Die Box hat das abgelehnt.', status: 403);
    }
    if (r.statusCode >= 400) {
      final j = _jsonOderNull(r.body);
      throw BoxFehler(
        // ERST DER SATZ DER BOX, DANN DIE UEBERSETZUNG EINES CODES, zuletzt der
        // rohe Code — sonst stuende „gesperrt" am Handy statt eines Satzes.
        _satzAus(j, auchCode: false) ??
            _medienSaetze[j is Map ? j['error'] : null] ??
            _satzAus(j) ??
            'Fehler ${r.statusCode} von ${box.name}.',
        status: r.statusCode,
        roh: j,
      );
    }
    return _jsonOderNull(r.body);
  }

  static dynamic _jsonOderNull(String body) {
    try {
      return jsonDecode(body);
    } catch (_) {
      return null;
    }
  }

  static String? _satzAus(Object? j, {bool auchCode = true}) {
    if (j is! Map) return null;
    // `hinweis` VOR `error`: die Box legt in `error` einen Code
    // („nichtLokal") und daneben in `hinweis` den Satz fuer Menschen.
    for (final k in ['satz', 'meldung', 'fehler', 'hinweis', if (auchCode) 'error']) {
      final v = j[k];
      if (v is String && v.isNotEmpty) return v;
    }
    return null;
  }

  Future<dynamic> _get(String pfad, [Map<String, String>? abfrage]) async =>
      _auswerten(await _senden(_client.get(_uri(pfad, abfrage), headers: _kopf)));

  Future<dynamic> _post(String pfad, Object rumpf, [Map<String, String>? abfrage]) async => _auswerten(
    await _senden(
      _client.post(
        _uri(pfad, abfrage),
        headers: {..._kopf, 'content-type': 'application/json'},
        body: jsonEncode(rumpf),
      ),
    ),
  );

  Future<dynamic> _put(String pfad, Object rumpf, [Map<String, String>? abfrage]) async => _auswerten(
    await _senden(
      _client.put(_uri(pfad, abfrage), headers: {..._kopf, 'content-type': 'application/json'}, body: jsonEncode(rumpf)),
    ),
  );

  Future<dynamic> _delete(String pfad, [Map<String, String>? abfrage]) async =>
      _auswerten(await _senden(_client.delete(_uri(pfad, abfrage), headers: _kopf)));

  // ── Wer bist du? ──────────────────────────────────────────────────────

  /// `/api/box` — nur eine MixPiBox antwortet mit `box: "mixpibox"`. Dient
  /// dem Hinzufuegen und der Netzsuche: „etwas antwortet auf 8200" heisst
  /// noch nicht, dass es eine Box ist.
  ///
  /// `/api/box` liegt HINTER dem Anmeldetor (auth.ts, OFFENE_PFADE). Eine Box
  /// mit Passwort antwortet deshalb 401 mit ihrem eigenen Satz — der zaehlt
  /// als Box ohne bekannten Namen (Rueckgabe `''`).
  Future<String?> kennung() async {
    final r = await _senden(_client.get(_uri('/api/box'), headers: _kopf));
    final j = _jsonOderNull(r.body);
    if (r.statusCode == 401) return (j is Map && j['error'] == 'anmeldung erforderlich') ? '' : null;
    if (r.statusCode != 200) return null;
    if (j is Map && j['box'] == 'mixpibox') return (j['name'] as String?) ?? '';
    return null;
  }

  // ── Anmeldung ─────────────────────────────────────────────────────────

  Future<bool> anmeldungNoetig() async {
    final j = await _get('/api/auth/state');
    return j is Map && j['anmeldungNoetig'] == true && j['angemeldet'] != true;
  }

  Future<void> anmelden(String passwort) async {
    final r = await _senden(
      _client.post(
        _uri('/api/auth/login'),
        headers: {'accept': 'application/json', 'content-type': 'application/json'},
        body: jsonEncode({'password': passwort}),
      ),
    );
    if (r.statusCode == 401) throw BoxFehler('Falsches Passwort.', status: 401);
    _auswerten(r);
    final sitzung = sitzungAusSetCookie(r.headers['set-cookie']);
    if (sitzung != null) {
      box.sitzung = sitzung;
      geaendert?.call(box);
    }
  }

  static String? sitzungAusSetCookie(String? kopf) {
    if (kopf == null) return null;
    final m = RegExp('(?:^|[;,]\\s*)$cookieName=([^;,\\s]+)').firstMatch(kopf);
    final wert = m?.group(1);
    return (wert == null || wert.isEmpty) ? null : wert;
  }

  // ── Wiedergabe ────────────────────────────────────────────────────────

  Future<Wiedergabe> wiedergabe() async {
    final lokal = await _get('/player/local');
    if (lokal is! Map<String, dynamic>) return const Wiedergabe();
    Map<String, dynamic>? dienst;
    if (lokal['currentPlayer'] == 'spotify') {
      try {
        final s = await _get('/player/state');
        if (s is Map<String, dynamic>) dienst = s;
      } on BoxFehler {
        // Ohne Spotify-Zustand zeigt die App eben keinen Titel.
      }
    }
    return Wiedergabe.ausLokal(lokal, dienst);
  }

  /// Ein Befehl an den Abspieldienst: play, pause, stop, next, previous,
  /// seek+30, seek-30, `setvolume:<0..100>`, `tracknr:<n>`.
  Future<void> befehl(String befehl) async {
    await _get('/player/current/${Uri.encodeComponent(befehl).replaceAll('%3A', ':')}');
  }

  Future<void> lautstaerke(int wert) => befehl('setvolume:${wert.clamp(0, 100)}');

  /// WOHIN `/api/bild/laufend` GERADE ZEIGT — `/api/bild/<schluessel>` oder
  /// `/api/bild/extern?u=…`, eine FESTE Adresse je Album. `null`: es laeuft
  /// nichts, oder es gibt kein Bild (die Box antwortet dann 404).
  ///
  /// WARUM NICHT DIREKT `laufend` ALS BILD (27.09.2026, am Handy gesehen):
  /// Die App lud `laufend?v=<n>` und zaehlte `n` beim Titelwechsel hoch.
  /// Meldete der Abspieldienst den neuen Titel, bevor die Box das neue Album
  /// kannte, kam unter dem neuen `n` noch das ALTE Bild — und blieb bis zum
  /// naechsten Titel stehen. Das Ziel der Umleitung aendert sich genau dann,
  /// wenn das Album wechselt, und als Bildadresse ist es sauber zu cachen.
  Future<String?> coverZiel() async {
    final anfrage = http.Request('GET', _uri('/api/bild/laufend'))
      ..followRedirects = false
      ..headers.addAll(bildKopf);
    try {
      final r = await _client.send(anfrage).timeout(frist);
      await r.stream.drain<void>();
      if (r.statusCode >= 300 && r.statusCode < 400) return r.headers['location'];
      return null;
    } on TimeoutException {
      return null;
    } on SocketException {
      return null;
    } on http.ClientException {
      return null;
    }
  }

  /// `pfad` kommt fertig kodiert von der Box (`/api/bild/<schluessel>`) —
  /// `resolve` statt `replace(path:)`, sonst wird aus `%20` ein `%2520`.
  ///
  /// COVER DER BOX OHNE ERSATZBILD (27.09.2026): kann die Box ein Cover
  /// (noch) nicht liefern, leitet sie auf ihr Ersatzbild um. Flutter hielt
  /// das fuer das Cover und merkte es sich bis zum Neustart — ein frisch
  /// hinzugefuegtes Stueck blieb in der App ohne Bild, waehrend der
  /// Kinderschirm es laengst zeigte. Mit `ohneRueckfall=1` antwortet die Box
  /// dann 404; das merkt sich Flutter nicht und fragt beim naechsten Zeichnen
  /// wieder. Nur fuer `/api/bild/<schluessel>` — `laufend` und `extern` haben
  /// eigene Regeln.
  Uri bildAdresse(String pfad) {
    final u = box.basis().resolve(pfad);
    final segmente = u.pathSegments;
    final istCover =
        segmente.length == 3 &&
        segmente[0] == 'api' &&
        segmente[1] == 'bild' &&
        segmente[2] != 'laufend' &&
        segmente[2] != 'extern';
    return istCover ? u.replace(queryParameters: {...u.queryParameters, 'ohneRueckfall': '1'}) : u;
  }

  /// Das Bild eines Kindes — dieselbe Datei, die der Kinderschirm zeigt.
  ///
  /// Sie liegt unter `/neu/bilder/figuren/` (FIGUR_ORDNER in profile.ts,
  /// ausgeliefert mit der Kinderoberflaeche). `/bilder/figuren/…` ohne
  /// `neu/` leitet auf die Startseite um und liefert kein Bild — gemessen
  /// an Box .62 am 27.09.2026. `null`: das Kind hat keins gewaehlt.
  Uri? figurAdresse(String figur) {
    if (figur.isEmpty || figur.contains('/') || figur.contains('..')) return null;
    return box.basis().replace(pathSegments: ['neu', 'bilder', 'figuren', figur]);
  }

  Map<String, String> get bildKopf => {if (box.sitzung case final s?) 'cookie': '$cookieName=$s'};

  // ── Kinderprofile ─────────────────────────────────────────────────────

  Future<ProfilStand> profile() async {
    final j = await _get('/api/profile');
    if (j is! Map<String, dynamic>) throw BoxFehler('Unerwartete Antwort auf /api/profile.');
    return ProfilStand.ausJson(j);
  }

  /// Wechselt das Kind an der Box. Fuer ein geschuetztes Profil (ausser dem
  /// schon aktiven) braucht die Box dessen Passwort — die Pruefung sitzt dort,
  /// nicht hier.
  Future<void> profilWechseln(String kennung, {String? passwort}) async {
    await _post('/api/profil/aktiv', {'kennung': kennung, 'passwort': ?passwort});
  }

  // ── Mediathek ─────────────────────────────────────────────────────────

  /// Die Werke, die das AKTIVE Kind sehen darf — dieselbe Liste wie auf dem
  /// Kinderschirm.
  Future<List<Werk>> werke() async {
    final j = await _get('/api/werke');
    if (j is! Map<String, dynamic>) return const [];
    return Werk.listeAusJson(j);
  }

  /// Startet ein Werk ueber denselben Weg wie der Kinderschirm
  /// (`POST /api/spielen`) — mit Kinderzeit-Pruefung auf der Box.
  Future<void> spielen(String schluessel) async {
    await _post('/api/spielen', {'schluessel': schluessel});
  }

  // ── Medien verwalten (27.09.2026) ─────────────────────────────────────
  //
  // DIESELBEN WEGE WIE DIE SEITE „MEDIEN" DER VERWALTUNG
  // (src/frontend-admin/src/app/seiten/medien.ts) — keine eigenen. Alle
  // liegen hinter dem Anmeldetor; ist ein Verwaltungspasswort gesetzt, kommt
  // `AnmeldungNoetig`, und die Box-Seite fragt danach.
  //
  // EIN EINTRAG HEISST UEBER SEINEN `schluessel`, nie ueber eine Position:
  // die verschiebt sich nach jedem Loeschen. Im Pfad steht er kodiert — ueber
  // `pathSegments`, damit ein Doppelpunkt oder Schraegstrich darin heil
  // ankommt.

  Uri _medienUri(String schluessel) => box.basis().replace(pathSegments: ['api', 'medien', schluessel]);

  /// Alles, was auf der Box steht — ungefiltert, fuer die Verwaltung.
  Future<List<MedienEintrag>> medien() async {
    final j = await _get('/api/medien');
    return MedienEintrag.listeAusJson(j is Map ? j['eintraege'] : null);
  }

  /// Suche bei den Diensten der Box (Spotify, Jellyfin, ARD).
  Future<List<Map<String, dynamic>>> medienSuchen(String begriff) async {
    if (begriff.trim().isEmpty) return const [];
    final j = await _get('/api/medien/suche', {'q': begriff.trim(), 'dienst': 'alle', 'art': 'alle'});
    return ((j is Map ? j['treffer'] : null) as List? ?? const [])
        .whereType<Map>()
        .map((t) => t.cast<String, dynamic>())
        .toList();
  }

  /// Einen Suchtreffer aufnehmen — FLACH, wie die Verwaltung ihn schickt; ein
  /// `{eintrag: …}` drumherum weist die Box mit 400 ab. Zurueck kommt der
  /// Schluessel des neuen Eintrags.
  ///
  /// DIE KATEGORIE KOMMT VOM MENSCHEN, nicht aus dem Treffer: die Suche der
  /// Box liefert keine (gemessen an .62, 27.09.2026), und ohne landete jedes
  /// Hoerbuch unter „Musik". Die Verwaltung laesst sie ebenso waehlen.
  Future<String> medienHinzufuegen(Map<String, dynamic> treffer, {String kategorie = 'music'}) async {
    final rumpf = <String, dynamic>{
      for (final k in const ['type', 'title', 'artist', 'cover', 'id', 'playlistid', 'audiobookid', 'showid'])
        if (treffer[k] != null) k: treffer[k],
      'category': kategorie,
    };
    final j = await _post('/api/medien', rumpf);
    return j is Map && j['schluessel'] is String ? j['schluessel'] as String : '';
  }

  /// Einen geteilten Text (Spotify-Link darin) zu Treffern machen — die Box
  /// fragt Spotify (GET /api/medien/aus-link). Ein Titel kommt als SEIN Album
  /// zurueck, ein Interpret als seine Alben; `hinweise` sagt es dazu.
  Future<({List<Map<String, dynamic>> treffer, List<String> hinweise})> medienAusLink(String text) async {
    final j = await _get('/api/medien/aus-link', {'url': text});
    // EINE BOX OHNE DIESEN WEG leitet auf ihre Startseite um — dann kommt
    // HTML statt Treffern, und das sah am Handy (27.09.2026) aus wie „nichts
    // gefunden", ohne ein Wort warum.
    if (j is! Map || j['treffer'] is! List) {
      throw BoxFehler('Diese Box kennt das Teilen noch nicht — sie braucht ein Update.');
    }
    final m = j;
    return (
      treffer: ((m['treffer'] as List?) ?? const []).whereType<Map>().map((t) => t.cast<String, dynamic>()).toList(),
      hinweise: ((m['hinweise'] as List?) ?? const []).map((h) => '$h').toList(),
    );
  }

  /// Titel, Interpret oder Kategorie aendern. Typ und Kennungen bleiben.
  Future<void> medienAendern(String schluessel, Map<String, String> aenderung) async {
    await _auswerten(
      await _senden(
        _client.patch(
          _medienUri(schluessel),
          headers: {..._kopf, 'content-type': 'application/json'},
          body: jsonEncode(aenderung),
        ),
      ),
    );
  }

  /// Einen Eintrag loeschen. Die Box fragt nicht nach — das tut die App.
  Future<void> medienLoeschen(String schluessel) async {
    _auswerten(await _senden(_client.delete(_medienUri(schluessel), headers: _kopf)));
  }

  /// Wer was sieht: je Kind `alle` oder eine Liste von Schluesseln.
  Future<List<ProfilAuswahl>> auswahlen() async {
    final j = await _get('/api/profil/auswahlen');
    return ((j is Map ? j['profile'] : null) as List? ?? const [])
        .whereType<Map>()
        .map((p) => ProfilAuswahl.ausJson(p.cast<String, dynamic>()))
        .toList();
  }

  /// Ein Werk fuer ein Kind sichtbar machen oder verbergen.
  ///
  /// DIE BOX FRAGT ZURUECK, wenn das Kind dadurch von „alles" auf eine Liste
  /// mit nur diesem Werk faellt (`einsperren`) oder umgekehrt alles sehen
  /// wuerde (`oeffnen`): dann kommt [AuswahlRueckfrage], und nach einem Ja
  /// geht derselbe Ruf mit `bestaetigt` noch einmal.
  Future<void> auswahlSetzen(String profil, String schluessel, {required bool an, bool bestaetigt = false}) async {
    try {
      await _post('/api/profil/auswahl/werk', {
        'profil': profil,
        'schluessel': schluessel,
        'an': an,
        if (bestaetigt) 'bestaetigt': true,
      });
    } on BoxFehler catch (e) {
      if (e.status == 409 && e.roh is Map && (e.roh as Map)['error'] == 'bestaetigung') {
        final r = e.roh as Map;
        throw AuswahlRueckfrage('${r['frage']}', (r['anzahl'] as num?)?.toInt() ?? 0);
      }
      rethrow;
    }
  }

  /// `m3u_generator.sh` auf der Box — neue Dateien in den Ordnern finden.
  Future<void> medienNeuEinlesen() async {
    await _post('/api/system/medien-neu', const <String, dynamic>{});
  }

  // ── Kopplung ──────────────────────────────────────────────────────────

  /// Die Box bitten, QR und Code zu zeigen (27.09.2026). Mit Eltern-PIN
  /// fragt sie erst danach; ohne zeigt sie beides sofort. Hoechstens alle
  /// 30 s — sonst antwortet die Box mit ihrem Satz (429), und der kommt als
  /// [BoxFehler] zurueck.
  Future<void> kopplungAnfragen({String name = 'Handy'}) async {
    await _post('/api/kopplung/anfrage', {'name': name});
  }

  /// Braucht dieses Handy eine Kopplung, bevor die Box es bedient?
  ///
  /// EINE SCHNELLE FRAGE statt der ersten vollen Abfrage: `/api/kopplung/status`
  /// ist fuer die App frei und sagt, ob die Box diesen Schluessel kennt. Eine
  /// aeltere Box ohne den Weg (404) sperrt auch nicht — dann ist nichts noetig.
  Future<bool> kopplungNoetig() async {
    try {
      final j = await _get('/api/kopplung/status');
      if (j is! Map) return false;
      return j['gekoppelt'] != true && j['ohneKopplung'] != true;
    } on BoxFehler catch (e) {
      if (e.status == 404) return false;
      rethrow;
    }
  }

  /// Mit dem Code von der Box koppeln. Der Schluessel landet in `box` und
  /// wird ueber `geaendert` gespeichert — er kommt nur dieses eine Mal.
  Future<void> koppeln(String code, {String name = 'Handy'}) async {
    final j = await _post('/api/kopplung/koppeln', {'code': code.trim(), 'name': name});
    final s = j is Map ? j['schluessel'] : null;
    if (s is! String || s.isEmpty) throw BoxFehler('Die Box hat keinen Schlüssel geschickt.');
    box.schluessel = s;
    geaendert?.call(box);
  }

  /// IST DAS DIESELBE BOX, DIE [schluessel] AUSGEGEBEN HAT? (29.09.2026)
  ///
  /// Gefragt, BEVOR der Schluessel an eine neue Adresse geht — sonst traegt
  /// ein Tippfehler ihn zu einem fremden Geraet (AUDIT-2026-09-28 §1b Rang 6a).
  /// Die Box kennt nur den Abdruck (sha256) des Schluessels, das Handy den
  /// Schluessel selbst; gemeinsam ist beiden also der Abdruck. Das Handy
  /// schickt eine frische Zufallsfrage, die Box antwortet je gekoppeltem
  /// Handy mit einem HMAC darueber ([kopplungsBeweis]) — dabei verlaesst
  /// weder der Schluessel noch der Abdruck eines der beiden Geraete.
  ///
  /// OHNE DEN SCHLUESSEL-KOPF, egal was in `box` steht: die Frage geht ja
  /// gerade an eine Adresse, der noch niemand traut.
  ///
  /// `false` auch fuer eine Box von vor dem 29.09.2026 ohne den Weg — dann
  /// laesst sich nichts beweisen, und neu koppeln ist die ehrliche Antwort.
  ///
  /// WAS ES NICHT FAENGT: ein Geraet, das die Frage an die echte Box
  /// DURCHREICHT und deren Antwort zurueckgibt. Wer das im Heimnetz aufbaut,
  /// braucht den Schluessel nicht — ohne `x-mixpi-app` fragt er die Box
  /// ohnehin ungesperrt (die Kopplung sperrt die App, nicht das Netz).
  Future<bool> kenntSchluessel(String schluessel) async {
    final r = Random.secure();
    final frage = List.generate(16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
    final kopf = {..._kopf, 'content-type': 'application/json'}..remove(schluesselKopf);
    final antwort = await _senden(
      _client.post(_uri('/api/kopplung/beweis'), headers: kopf, body: jsonEncode({'frage': frage})),
    );
    if (antwort.statusCode != 200) return false;
    final j = _jsonOderNull(antwort.body);
    final beweise = j is Map && j['beweise'] is List ? j['beweise'] as List : const [];
    final erwartet = kopplungsBeweis(schluessel, frage);
    return beweise.any((b) => b == erwartet);
  }

  // ── Box sperren (28.09.2026) ──────────────────────────────────────────
  //
  // `/api/boxsperre` (boxsperre.ts): LESEN ist frei (der Kiosk braucht es auch
  // ohne Anmeldung), SETZEN und AUFHEBEN liegen hinter dem Anmeldetor. Die
  // Box haelt die Sperre in einer Datei — sie uebersteht einen Neustart — und
  // hebt sie nach hoechstens 24 h von selbst auf.

  /// `null`: eine aeltere Box ohne den Weg (sie antwortet mit ihrer
  /// Startseite statt mit JSON).
  Future<SperrStand?> sperre() async {
    try {
      return SperrStand.ausJson(await _get('/api/boxsperre'));
    } on BoxFehler catch (e) {
      if (e.status == 404) return null;
      rethrow;
    }
  }

  /// Sperren fuer [minuten] ODER bis [bis]. Laufende Musik haelt die Box
  /// selbst an.
  Future<SperrStand> sperren({int? minuten, DateTime? bis}) async {
    final j = await _post('/api/boxsperre', {
      'minuten': ?minuten,
      if (minuten == null && bis != null) 'bis': bis.millisecondsSinceEpoch,
    });
    final st = SperrStand.ausJson(j);
    if (st == null) throw BoxFehler('Diese Box kennt das Sperren noch nicht — sie braucht ein Update.');
    return st;
  }

  Future<void> entsperren() async {
    await _delete('/api/boxsperre');
  }

  // ── Kinderzeit (28.09.2026) ───────────────────────────────────────────
  //
  // DIESELBEN WEGE WIE DIE SEITE „KINDERZEIT" DER VERWALTUNG. Ohne `profil`
  // ist die HAUSREGEL gemeint (sie gilt fuer jedes Kind ohne eigene Regeln),
  // mit `profil` die eigene Regel dieses Kindes.

  Map<String, String>? _profilAbfrage(String? profil) => profil == null ? null : {'profil': profil};

  /// EINE BOX VON VOR DEM 25.09.2026 KENNT `/satz` NICHT und antwortet mit
  /// ihrer Startseite (HTML). Das darf NICHT als leerer Satz gelten — die App
  /// zeigte sonst eine Woche ohne Regeln, und das erste Speichern schriebe sie
  /// ueber die echte Hausregel. Dann gilt `GET /api/kinderzeit` (die
  /// Hausregel, seit 28.07.2026), ohne Wissen ueber die Kinder.
  Future<KzSatz> kinderzeitSatz() async {
    final j = await _get('/api/kinderzeit/satz');
    if (j is Map && j['standard'] is Map) return KzSatz.ausJson(j);
    final haus = await _get('/api/kinderzeit');
    if (haus is Map && haus['tage'] is Map) {
      return KzSatz(standard: KzRegeln.ausJson(haus), je: const {}, vollstaendig: false);
    }
    throw BoxFehler('Diese Box kennt die Kinderzeit noch nicht — sie braucht ein Update.');
  }

  /// Speichert [regeln] als Hausregel oder — mit [profil] — als eigene Regel
  /// dieses Kindes. Zurueck kommt, was die Box daraus gemacht hat.
  Future<KzRegeln> kinderzeitSetzen(KzRegeln regeln, {String? profil}) async =>
      KzRegeln.ausJson(await _put('/api/kinderzeit', regeln.alsJson(), _profilAbfrage(profil)));

  /// Die eigenen Regeln eines Kindes verwerfen — danach gilt die Hausregel.
  Future<void> kinderzeitEigeneAblegen(String profil) async {
    await _delete('/api/kinderzeit', {'profil': profil});
  }

  /// Das Urteil JETZT — ohne [profil] fuer das Kind, das gerade an der Box ist.
  Future<KzStand> kinderzeitStand({String? profil}) async =>
      KzStand.ausJson(await _get('/api/kinderzeit/stand', _profilAbfrage(profil)));

  /// Minuten fuer HEUTE schenken (negativ: zuruecknehmen).
  Future<void> kinderzeitBonus(int minuten, {String? profil}) async {
    await _post('/api/kinderzeit/bonus', {'minuten': minuten}, _profilAbfrage(profil));
  }

  /// Den heutigen Zaehler auf null — einschliesslich geschenkter Minuten.
  Future<void> kinderzeitZuruecksetzen({String? profil}) async {
    await _post('/api/kinderzeit/zuruecksetzen', const <String, dynamic>{}, _profilAbfrage(profil));
  }

  // ── Sicherung (28.09.2026) ────────────────────────────────────────────
  //
  // DIESELBEN WEGE WIE DIE SEITE „SICHERUNG" DER VERWALTUNG (sicherung.ts).
  // Die Box erfindet dabei nichts: jede Pruefung, jede Reihenfolge und das
  // atomare Schreiben bleiben in scripts/mupibox/mupibox-sicherung.py.
  //
  // DAS PASSWORT FUER DIE ZUGANGSDATEN geht nur im Koerper eines POST hinaus
  // — nie in der Adresse — und wird nirgends gemerkt.
  //
  // DIE FRIST IST LAENGER: die Box laesst fuer jeden Schritt ein Python
  // laufen, das auf einem Pi einige Sekunden braucht.

  static const _fristSicherung = Duration(minutes: 3);

  Future<SicherungsLage> sicherungLage() async =>
      SicherungsLage.ausJson(_auswerten(await _senden(_client.get(_uri('/api/sicherung'), headers: _kopf), _fristSicherung)));

  /// Einen frischen Stand anlegen und nach [ziel] schreiben. Mit [passwort]
  /// kommen die Zugangsdaten verschluesselt mit. Zurueck: der Dateiname, den
  /// die Box vorschlaegt.
  Future<String> sicherungAnlegen(File ziel, {String? passwort}) async {
    final anfrage = http.Request('POST', _uri('/api/sicherung/anlegen'))
      ..headers.addAll({..._kopf, 'content-type': 'application/json', 'accept': 'application/gzip, application/json'})
      ..body = jsonEncode({'mitZugangsdaten': passwort != null, 'passwort': ?passwort});
    return await _inDatei(anfrage, ziel, frist: _fristSicherung) ?? 'mixpibox-sicherung.tar.gz';
  }

  /// Einen Stand, der schon auf der Box liegt, nach [ziel] holen.
  Future<String> sicherungHolen(String name, File ziel) async {
    final uri = box.basis().replace(pathSegments: ['api', 'sicherung', 'stand', name]);
    final anfrage = http.Request('GET', uri)..headers.addAll({..._kopf, 'accept': 'application/gzip, application/json'});
    return await _inDatei(anfrage, ziel, frist: _fristSicherung) ?? name;
  }

  /// Schritt 1 des Zurueckspielens: die Datei hochladen, die Box laesst das
  /// Python TROCKEN laufen und sagt, was geschehen WUERDE. Es wird nichts
  /// angefasst.
  Future<ZurueckVorschau> sicherungPruefen(File datei) async {
    final bytes = await datei.readAsBytes();
    final j = _auswerten(
      await _senden(
        _client.post(
          _uri('/api/sicherung/pruefen'),
          headers: {..._kopf, 'content-type': 'application/gzip'},
          body: bytes,
        ),
        _fristSicherung,
      ),
    );
    final v = ZurueckVorschau.ausJson(j);
    if (v.kennung.isEmpty) throw BoxFehler('Die Box hat keine Vorschau geschickt.');
    return v;
  }

  /// Schritt 2: wirklich zurueckspielen — nur mit der [kennung] aus Schritt 1.
  /// Zurueck kommt die Antwort der Box (`satz`, `vorherStand`, `vonHand`,
  /// `neustartNoetig`).
  Future<Map<String, dynamic>> sicherungZurueckspielen(String kennung, {String? passwort}) async {
    final j = _auswerten(
      await _senden(
        _client.post(
          _uri('/api/sicherung/zurueckspielen'),
          headers: {..._kopf, 'content-type': 'application/json'},
          body: jsonEncode({'kennung': kennung, 'mitZugangsdaten': passwort != null, 'passwort': ?passwort}),
        ),
        _fristSicherung,
      ),
    );
    return j is Map ? j.cast<String, dynamic>() : const {};
  }

  /// Die Box neu starten (nach dem Zurueckspielen noetig, damit alle Dienste
  /// die eingespielten Dateien lesen).
  Future<void> neustarten() async {
    await _post('/api/reboot', const <String, dynamic>{});
  }

  /// Eine Antwort Stueck fuer Stueck nach [ziel] schreiben; Fehler kommen als
  /// JSON und gehen durch `_auswerten`. Zurueck: der Dateiname aus
  /// `Content-Disposition`, falls die Box einen schickt.
  Future<String?> _inDatei(
    http.BaseRequest anfrage,
    File ziel, {
    Duration? frist,
    void Function(int bytes)? fortschritt,
  }) async {
    final vorher = box.fingerabdruck;
    late http.StreamedResponse antwort;
    try {
      antwort = await _client.send(anfrage).timeout(frist ?? this.frist);
    } on TimeoutException {
      throw BoxFehler('${box.name} antwortet nicht.');
    } on SocketException catch (e) {
      throw BoxFehler('${box.name} ist nicht erreichbar (${e.osError?.message ?? e.message}).');
    } on http.ClientException catch (e) {
      throw BoxFehler('${box.name} ist nicht erreichbar (${e.message}).');
    }
    if (vorher != box.fingerabdruck) geaendert?.call(box);
    if (antwort.statusCode >= 400) {
      _auswerten(http.Response(await antwort.stream.bytesToString(), antwort.statusCode));
    }
    final senke = ziel.openWrite();
    var bytes = 0;
    try {
      await for (final stueck in antwort.stream) {
        senke.add(stueck);
        bytes += stueck.length;
        fortschritt?.call(bytes);
      }
    } on http.ClientException catch (e) {
      throw BoxFehler('Download abgebrochen (${e.message}).');
    } finally {
      await senke.close();
    }
    return dateinameAus(antwort.headers['content-disposition']);
  }

  // ── Herunterladen ─────────────────────────────────────────────────────

  /// Ein LOKALES Werk als ZIP holen (`GET /api/werke/<s>/download`, E126)
  /// und Stueck fuer Stueck nach [ziel] schreiben. Zurueck kommt der
  /// Dateiname, den die Box vorschlaegt.
  ///
  /// UEBER DIESEN CLIENT, nicht ueber einen Download-Dienst des Handys:
  /// nur hier gehen Sitzungs-Cookie und das gemerkte Zeugnis einer
  /// HTTPS-Box mit. [fortschritt] bekommt die bisher geschriebenen Bytes —
  /// eine Gesamtgroesse schickt die Box nicht (sie packt beim Senden).
  ///
  /// Die FRIST gilt nur bis zur ersten Antwort. Ein Album von einigen hundert
  /// MB braucht laenger als sechs Sekunden, und das ist kein Fehler.
  Future<String> herunterladen(String schluessel, File ziel, {void Function(int bytes)? fortschritt}) async {
    final uri = box.basis().replace(pathSegments: ['api', 'werke', schluessel, 'download']);
    final anfrage = http.Request('GET', uri)..headers.addAll(_kopf);
    return await _inDatei(anfrage, ziel, fortschritt: fortschritt) ?? '$schluessel.zip';
  }

  /// Der Dateiname aus `Content-Disposition` — die Box setzt ihn mit
  /// `res.attachment()`; Express schreibt Umlaute zusaetzlich als `filename*`.
  static String? dateinameAus(String? kopf) {
    if (kopf == null) return null;
    final stern = RegExp(r"filename\*=UTF-8''([^;]+)", caseSensitive: false).firstMatch(kopf);
    if (stern != null) return Uri.decodeComponent(stern.group(1)!.trim());
    final schlicht = RegExp(r'filename="([^"]+)"', caseSensitive: false).firstMatch(kopf);
    return schlicht?.group(1);
  }
}
