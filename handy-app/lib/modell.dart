// Die Daten, mit denen die App rechnet — bewusst nur die Felder, die sie
// anzeigt. Die Box liefert weit mehr; alles andere wird beim Lesen
// uebergangen, damit ein neues Feld auf der Box die App nicht bricht.

/// Eine Box, wie die App sie sich merkt. Die Anmeldung (Cookie) gehoert dazu,
/// das Passwort NICHT: die Sitzung der Box gilt 12 Stunden und stirbt mit
/// jedem Neustart des Backends — danach fragt die App einmal neu.
class BoxEintrag {
  BoxEintrag({
    required this.id,
    required this.name,
    required this.adresse,
    this.port = 8200,
    this.https = false,
    this.fingerabdruck,
    this.sitzung,
  });

  /// Stabil ueber Umbenennen hinweg, nur fuer die App.
  final String id;
  String name;

  /// Rechnername (`mixpibox.local`) oder IP.
  String adresse;
  int port;

  /// HTTPS auf 8443 mit dem selbst ausgestellten Zeugnis der Box. Beim ersten
  /// Kontakt wird dessen SHA-256 gemerkt; ein ANDERES Zeugnis wird danach
  /// abgewiesen (Vertrauen beim ersten Mal, wie ssh).
  bool https;
  String? fingerabdruck;

  /// Inhalt des Cookies `mupi_admin`, falls die Box eine Anmeldung verlangt.
  String? sitzung;

  Uri basis() => Uri(scheme: https ? 'https' : 'http', host: adresse, port: port);

  Map<String, dynamic> alsJson() => {
    'id': id,
    'name': name,
    'adresse': adresse,
    'port': port,
    'https': https,
    if (fingerabdruck != null) 'fingerabdruck': fingerabdruck,
    if (sitzung != null) 'sitzung': sitzung,
  };

  factory BoxEintrag.ausJson(Map<String, dynamic> j) => BoxEintrag(
    id: j['id'] as String,
    name: (j['name'] as String?) ?? '',
    adresse: j['adresse'] as String,
    port: (j['port'] as num?)?.toInt() ?? 8200,
    https: j['https'] == true,
    fingerabdruck: j['fingerabdruck'] as String?,
    sitzung: j['sitzung'] as String?,
  );
}

/// Was gerade laeuft — zusammengesetzt aus `/player/local` und, wenn Spotify
/// spielt, `/player/state` (lokal traegt dann keinen Titel).
class Wiedergabe {
  const Wiedergabe({
    this.spielt = false,
    this.pause = false,
    this.titel = '',
    this.album = '',
    this.interpret = '',
    this.lautstaerke = 0,
    this.spieler = '',
    this.titelNr = 0,
    this.titelGesamt = 0,
  });

  final bool spielt;
  final bool pause;
  final String titel;
  final String album;
  final String interpret;

  /// ALSA-Lautstaerke 0–100, dieselbe Skala wie `setvolume:<n>`.
  final int lautstaerke;
  final String spieler;
  final int titelNr;
  final int titelGesamt;

  /// Laeuft wirklich etwas hoerbar? `playing` bleibt bei Pause true.
  bool get hoerbar => spielt && !pause;

  factory Wiedergabe.ausLokal(Map<String, dynamic> lokal, [Map<String, dynamic>? dienst]) {
    var titel = _text(lokal['currentTrackname']);
    var album = _text(lokal['album']);
    var interpret = '';
    var spielt = lokal['playing'] == true;
    var pause = lokal['pause'] == true;
    if (dienst != null) {
      final item = dienst['item'];
      if (item is Map) {
        if (titel.isEmpty) titel = _text(item['name']);
        final a = item['album'];
        if (album.isEmpty && a is Map) album = _text(a['name']);
        final kuenstler = item['artists'];
        if (kuenstler is List) {
          interpret = kuenstler.whereType<Map>().map((k) => _text(k['name'])).where((n) => n.isNotEmpty).join(', ');
        }
        final show = item['show'];
        if (album.isEmpty && show is Map) album = _text(show['name']);
      }
      if (dienst['is_playing'] is bool) {
        spielt = true;
        pause = dienst['is_playing'] != true;
      }
    }
    return Wiedergabe(
      spielt: spielt,
      pause: pause,
      titel: titel,
      album: album,
      interpret: interpret,
      lautstaerke: _zahl(lokal['volume']).clamp(0, 100),
      spieler: _text(lokal['currentPlayer']),
      titelNr: _zahl(lokal['currentTracknr']),
      titelGesamt: _zahl(lokal['totalTracks']),
    );
  }
}

/// Ein Kinderprofil der Box (`/api/profile`).
class KindProfil {
  const KindProfil({required this.kennung, required this.name, this.geschuetzt = false, this.passwortArt});

  final String kennung;
  final String name;
  final bool geschuetzt;

  /// zeichen | zahlen | farben | muster | bilder (PASSWORT_ARTEN in
  /// profile.ts) — die App kann nur Zeichen und Zahlen eintippen; Farbpunkte,
  /// Muster und Bilder gibt es nur am Schirm der Box.
  final String? passwortArt;

  bool get perTastaturEingebbar => !geschuetzt || passwortArt == null || passwortArt == 'zeichen' || passwortArt == 'zahlen';
}

class ProfilStand {
  const ProfilStand({required this.profile, required this.aktiv});

  final List<KindProfil> profile;
  final String aktiv;

  factory ProfilStand.ausJson(Map<String, dynamic> j) {
    final liste = (j['profile'] as List? ?? const [])
        .whereType<Map>()
        .map(
          (p) => KindProfil(
            kennung: _text(p['kennung']),
            name: _text(p['name']).isEmpty ? _text(p['kennung']) : _text(p['name']),
            geschuetzt: p['geschuetzt'] == true,
            passwortArt: p['passwortArt'] is String ? p['passwortArt'] as String : null,
          ),
        )
        .where((p) => p.kennung.isNotEmpty)
        .toList();
    // Ein abgeschalteter Gast ist kein Ziel (die Box weist den Wechsel ab).
    if (j['gastAktiv'] == false) liste.removeWhere((p) => p.kennung == 'gast');
    return ProfilStand(profile: liste, aktiv: _text(j['aktiv']));
  }
}

/// Ein Eintrag der Mediathek (`/api/werke`), so weit die App ihn braucht.
class Werk {
  const Werk({required this.schluessel, required this.titel, this.interpret = '', this.bild = '', this.kategorie = ''});

  final String schluessel;
  final String titel;
  final String interpret;

  /// Pfad auf der Box, z. B. `/api/bild/<schluessel>`.
  final String bild;
  final String kategorie;

  static List<Werk> listeAusJson(Map<String, dynamic> j) => (j['werke'] as List? ?? const [])
      .whereType<Map>()
      .where((w) => w['fehlt'] != true)
      .map(
        (w) => Werk(
          schluessel: _text(w['schluessel']),
          titel: _text(w['titel']),
          interpret: _text(w['interpret']),
          bild: _text(w['bild']),
          kategorie: _text(w['kategorie']),
        ),
      )
      .where((w) => w.schluessel.isNotEmpty)
      .toList();
}

String _text(Object? v) => v is String ? v : (v == null ? '' : '$v');

int _zahl(Object? v) {
  if (v is num) return v.round();
  if (v is String) return int.tryParse(v) ?? double.tryParse(v)?.round() ?? 0;
  return 0;
}
