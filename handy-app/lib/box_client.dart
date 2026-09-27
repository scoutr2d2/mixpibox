import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

import 'modell.dart';

/// Etwas ist schiefgegangen — `satz` ist fuer Menschen geschrieben.
class BoxFehler implements Exception {
  BoxFehler(this.satz, {this.status});
  final String satz;
  final int? status;
  @override
  String toString() => satz;
}

/// Die Box verlangt eine Anmeldung (Verwaltungspasswort, `interfacelogin`).
class AnmeldungNoetig extends BoxFehler {
  AnmeldungNoetig() : super('Die Box verlangt das Verwaltungspasswort.', status: 401);
}

/// Ein Kinderprofil ist geschuetzt und braucht sein eigenes Passwort.
class ProfilPasswortNoetig extends BoxFehler {
  ProfilPasswortNoetig(this.art, {bool falsch = false})
    : super(falsch ? 'Das Passwort passt nicht.' : 'Dieses Profil hat ein Passwort.', status: falsch ? 403 : 401);
  final String? art;
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

  Map<String, String> get _kopf => {
    'accept': 'application/json',
    if (box.sitzung != null) 'cookie': '$cookieName=${box.sitzung}',
  };

  Uri _uri(String pfad, [Map<String, String>? abfrage]) {
    final b = box.basis();
    return b.replace(path: pfad, queryParameters: abfrage);
  }

  Future<http.Response> _senden(Future<http.Response> anfrage) async {
    final vorher = box.fingerabdruck;
    try {
      final r = await anfrage.timeout(frist);
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
      if (j is Map && j['error'] == 'passwortFalsch') throw ProfilPasswortNoetig(j['art'] as String?, falsch: true);
      // Kinderzeit, Anbieter-Schalter oder der Herkunftsriegel: die Box legt
      // ihren Satz in `satz`/`error`/`fehler` — den zeigen, statt zu raten.
      throw BoxFehler(_satzAus(j) ?? 'Die Box hat das abgelehnt.', status: 403);
    }
    if (r.statusCode >= 400) {
      throw BoxFehler(_satzAus(_jsonOderNull(r.body)) ?? 'Fehler ${r.statusCode} von ${box.name}.', status: r.statusCode);
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

  static String? _satzAus(Object? j) {
    if (j is! Map) return null;
    for (final k in const ['satz', 'meldung', 'fehler', 'error']) {
      final v = j[k];
      if (v is String && v.isNotEmpty) return v;
    }
    return null;
  }

  Future<dynamic> _get(String pfad, [Map<String, String>? abfrage]) async =>
      _auswerten(await _senden(_client.get(_uri(pfad, abfrage), headers: _kopf)));

  Future<dynamic> _post(String pfad, Object rumpf) async => _auswerten(
    await _senden(
      _client.post(_uri(pfad), headers: {..._kopf, 'content-type': 'application/json'}, body: jsonEncode(rumpf)),
    ),
  );

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

  Uri coverAdresse() => _uri('/api/bild/laufend');

  /// `pfad` kommt fertig kodiert von der Box (`/api/bild/<schluessel>`) —
  /// `resolve` statt `replace(path:)`, sonst wird aus `%20` ein `%2520`.
  Uri bildAdresse(String pfad) => box.basis().resolve(pfad);

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
}
