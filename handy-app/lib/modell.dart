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
    this.schluessel,
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

  /// Der Schluessel aus der Kopplung (27.09.2026). Die Box gibt ihn EINMAL
  /// heraus — geht er verloren, muss das Handy neu gekoppelt werden.
  String? schluessel;

  Uri basis() => Uri(scheme: https ? 'https' : 'http', host: adresse, port: port);

  Map<String, dynamic> alsJson() => {
    'id': id,
    'name': name,
    'adresse': adresse,
    'port': port,
    'https': https,
    if (fingerabdruck != null) 'fingerabdruck': fingerabdruck,
    if (sitzung != null) 'sitzung': sitzung,
    if (schluessel != null) 'schluessel': schluessel,
  };

  factory BoxEintrag.ausJson(Map<String, dynamic> j) => BoxEintrag(
    id: j['id'] as String,
    name: (j['name'] as String?) ?? '',
    adresse: j['adresse'] as String,
    port: (j['port'] as num?)?.toInt() ?? 8200,
    https: j['https'] == true,
    fingerabdruck: j['fingerabdruck'] as String?,
    sitzung: j['sitzung'] as String?,
    schluessel: j['schluessel'] as String?,
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
  const KindProfil({
    required this.kennung,
    required this.name,
    this.geschuetzt = false,
    this.passwortArt,
    this.figur = '',
  });

  final String kennung;
  final String name;
  final bool geschuetzt;

  /// zeichen | zahlen | farben | muster | bilder (PASSWORT_ARTEN in
  /// profile.ts) — die App kann nur Zeichen und Zahlen eintippen; Farbpunkte,
  /// Muster und Bilder gibt es nur am Schirm der Box.
  final String? passwortArt;

  /// Dateiname des Bildes, das sich das Kind an der Box ausgesucht hat
  /// (`mixpi-girl-on-rainbow-v2.png`). Leer: noch keins gewaehlt — die Box
  /// zeigt dann ihr Standardbild, die App ein Personenzeichen.
  final String figur;

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
            figur: _text(p['figur']),
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
  const Werk({
    required this.schluessel,
    required this.titel,
    this.interpret = '',
    this.bild = '',
    this.kategorie = '',
    this.lokal = false,
  });

  final String schluessel;
  final String titel;
  final String interpret;

  /// Pfad auf der Box, z. B. `/api/bild/<schluessel>`.
  final String bild;
  final String kategorie;

  /// Liegt das Werk als Ordner auf der Box? Nur dann laesst es sich
  /// herunterladen (`/api/werke/<s>/download`). Auch ein verschmolzenes Werk,
  /// dessen erste Quelle Spotify ist, zaehlt, sobald EINE Quelle `lokal` ist.
  final bool lokal;

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
          lokal: (w['quellen'] as List? ?? const []).any((q) => q is Map && q['dienst'] == 'lokal'),
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

/// Was der QR an der Box traegt: `mixpi:<adresse>:<port>:<code>` (qrInhalt in
/// src/backend-api/src/kopplung.ts — so kurz, weil der Kinderschirm hoechstens
/// 42 Bytes als QR zeichnen kann). `null`, wenn der Text nicht genau so aussieht.
({String adresse, int port, String code})? koppelQrLesen(String? text) {
  final m = RegExp(r'^mixpi:([0-9a-zA-Z.-]{1,63}):(\d{1,5}):(\d{6})$').firstMatch(text?.trim() ?? '');
  if (m == null) return null;
  return (adresse: m.group(1)!, port: int.parse(m.group(2)!), code: m.group(3)!);
}

/// Ein Eintrag der Box, wie die Verwaltung ihn sieht (`GET /api/medien`).
class MedienEintrag {
  const MedienEintrag({
    required this.schluessel,
    required this.titel,
    this.interpret = '',
    this.kategorie = 'music',
    this.typ = '',
    this.cover = '',
  });

  /// Die Kennung des Eintrags — alle Aenderungen gehen ueber sie.
  final String schluessel;
  final String titel;
  final String interpret;

  /// `music`, `audiobook` oder `other` — die drei Kategorien der Box.
  final String kategorie;
  final String typ;
  final String cover;

  /// Der Dienst hinter dem Eintrag — dieselbe Einteilung wie `dienstVon`
  /// im Kern (medien.ts).
  String get dienst {
    if (typ.startsWith('spotify')) return 'spotify';
    if (typ.startsWith('jellyfin')) return 'jellyfin';
    if (typ == 'library' || typ == 'local') return 'lokal';
    return typ.isEmpty ? 'anderes' : typ;
  }

  static List<MedienEintrag> listeAusJson(Object? liste) => (liste as List? ?? const [])
      .whereType<Map>()
      .map(
        (e) => MedienEintrag(
          schluessel: _text(e['schluessel']),
          titel: _text(e['title']),
          interpret: _text(e['artist']),
          kategorie: _text(e['category']).isEmpty ? 'music' : _text(e['category']),
          typ: _text(e['type']),
          cover: _text(e['cover']),
        ),
      )
      .where((e) => e.schluessel.isNotEmpty)
      .toList();
}

/// Die drei Kategorien der Box und wie sie heissen.
const kategorieNamen = {'music': 'Musik', 'audiobook': 'Hörbuch', 'other': 'Sonstiges'};

/// Was ein Kind sieht: alles, oder genau die Werke in [werke].
class ProfilAuswahl {
  const ProfilAuswahl({required this.kennung, required this.name, required this.alle, required this.werke});

  final String kennung;
  final String name;
  final bool alle;
  final Set<String> werke;

  bool sieht(String schluessel) => alle || werke.contains(schluessel);

  factory ProfilAuswahl.ausJson(Map<String, dynamic> j) => ProfilAuswahl(
    kennung: _text(j['kennung']),
    name: _text(j['name']).isEmpty ? _text(j['kennung']) : _text(j['name']),
    alle: j['alle'] == true,
    werke: {for (final w in (j['werke'] as List? ?? const [])) '$w'},
  );
}

// ── Box-Sperre (28.09.2026) ─────────────────────────────────────────────

/// Die Sperre der Eltern (`GET /api/boxsperre`, boxsperre.ts): solange sie
/// gilt, startet die Box nichts, und der Kinderschirm zeigt „Die Box macht
/// Pause". Sie hat IMMER ein Ende (hoechstens 24 h).
class SperrStand {
  const SperrStand({this.aktiv = false, this.bis, this.bisZeit = '', this.morgen = false, this.restMin = 0});

  final bool aktiv;
  final DateTime? bis;

  /// „HH:MM" in der Ortszeit der Box.
  final String bisZeit;

  /// Endet sie erst morgen?
  final bool morgen;
  final int restMin;

  /// „bis 19:30" / „bis morgen 07:00".
  String get bisText => bisZeit.isEmpty ? '' : (morgen ? 'bis morgen $bisZeit' : 'bis $bisZeit');

  /// `null`: die Antwort ist keine Sperr-Auskunft — eine aeltere Box ohne den
  /// Weg leitet auf ihre Startseite um und liefert HTML.
  static SperrStand? ausJson(Object? j) {
    if (j is! Map || j['aktiv'] is! bool) return null;
    final bis = j['bis'];
    return SperrStand(
      aktiv: j['aktiv'] == true,
      bis: bis is num ? DateTime.fromMillisecondsSinceEpoch(bis.toInt()) : null,
      bisZeit: _text(j['bisZeit']),
      morgen: j['morgen'] == true,
      restMin: _zahl(j['restMin']),
    );
  }
}

// ── Kinderzeit (28.09.2026) ─────────────────────────────────────────────
//
// DIESELBEN FORMEN WIE src/backend-api/src/kinderzeit.ts — die Box biegt
// alles Unlesbare ohnehin auf die freundliche Seite (`regelnNormalisieren`),
// die App schickt trotzdem nur, was sie selbst gelesen hat.

/// Die Wochentage in der Reihenfolge des Kalenders (Montag zuerst) — die Box
/// fuehrt sie als `so`…`sa` (Date.getDay()).
const kzTage = ['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so'];
const kzTagNamen = {'mo': 'Mo', 'di': 'Di', 'mi': 'Mi', 'do': 'Do', 'fr': 'Fr', 'sa': 'Sa', 'so': 'So'};
const kzTagNamenLang = {
  'mo': 'Montag',
  'di': 'Dienstag',
  'mi': 'Mittwoch',
  'do': 'Donnerstag',
  'fr': 'Freitag',
  'sa': 'Samstag',
  'so': 'Sonntag',
};

/// Der Schluessel des Wochentags von [d] (`DateTime.weekday`: 1 = Montag).
String kzTagVon(DateTime d) => kzTage[d.weekday - 1];

/// „HH:MM" → Minuten seit Mitternacht; null bei leer oder Unsinn.
int? kzMinuten(String hhmm) {
  final m = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch(hhmm.trim());
  if (m == null) return null;
  final h = int.parse(m.group(1)!);
  final min = int.parse(m.group(2)!);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

String kzZeit(int minuten) => '${(minuten ~/ 60).toString().padLeft(2, '0')}:${(minuten % 60).toString().padLeft(2, '0')}';

class TagesRegel {
  const TagesRegel({this.frei = true, this.ab = '', this.bis = '', this.minuten = 0});

  /// Darf an diesem Tag ueberhaupt gehoert werden?
  final bool frei;

  /// „HH:MM" oder leer (keine Grenze).
  final String ab;
  final String bis;

  /// Hoerdauer; 0 = unbegrenzt (das Fenster gilt trotzdem).
  final int minuten;

  TagesRegel mit({bool? frei, String? ab, String? bis, int? minuten}) =>
      TagesRegel(frei: frei ?? this.frei, ab: ab ?? this.ab, bis: bis ?? this.bis, minuten: minuten ?? this.minuten);

  Map<String, dynamic> alsJson() => {'frei': frei, 'ab': ab, 'bis': bis, 'minuten': minuten};

  factory TagesRegel.ausJson(Object? j) {
    if (j is! Map) return const TagesRegel();
    return TagesRegel(
      frei: j['frei'] != false,
      ab: kzMinuten(_text(j['ab'])) == null ? '' : _text(j['ab']).trim(),
      bis: kzMinuten(_text(j['bis'])) == null ? '' : _text(j['bis']).trim(),
      minuten: _zahl(j['minuten']).clamp(0, 24 * 60),
    );
  }

  @override
  bool operator ==(Object other) =>
      other is TagesRegel && other.frei == frei && other.ab == ab && other.bis == bis && other.minuten == minuten;

  @override
  int get hashCode => Object.hash(frei, ab, bis, minuten);
}

class KzRegeln {
  const KzRegeln({this.aktiv = false, this.nachsichtMin = 5, this.tage = const {}});

  final bool aktiv;
  final int nachsichtMin;
  final Map<String, TagesRegel> tage;

  TagesRegel tag(String t) => tage[t] ?? const TagesRegel();

  KzRegeln mit({bool? aktiv, int? nachsichtMin, Map<String, TagesRegel>? tage}) =>
      KzRegeln(aktiv: aktiv ?? this.aktiv, nachsichtMin: nachsichtMin ?? this.nachsichtMin, tage: tage ?? this.tage);

  KzRegeln tagSetzen(String t, TagesRegel r) => mit(tage: {...tage, t: r});

  Map<String, dynamic> alsJson() => {
    'aktiv': aktiv,
    'nachsichtMin': nachsichtMin,
    'tage': {for (final t in kzTage) t: tag(t).alsJson()},
  };

  factory KzRegeln.ausJson(Object? j) {
    if (j is! Map) return const KzRegeln();
    final tage = j['tage'] is Map ? j['tage'] as Map : const {};
    final n = _zahl(j['nachsichtMin']);
    return KzRegeln(
      aktiv: j['aktiv'] == true,
      nachsichtMin: j['nachsichtMin'] == null ? 5 : n.clamp(0, 60),
      tage: {for (final t in kzTage) t: TagesRegel.ausJson(tage[t])},
    );
  }

  @override
  bool operator ==(Object other) =>
      other is KzRegeln &&
      other.aktiv == aktiv &&
      other.nachsichtMin == nachsichtMin &&
      kzTage.every((t) => other.tag(t) == tag(t));

  @override
  int get hashCode => Object.hash(aktiv, nachsichtMin, Object.hashAll(kzTage.map(tag)));
}

/// Hausregel und Ausnahmen je Kind (`GET /api/kinderzeit/satz`).
class KzSatz {
  const KzSatz({required this.standard, required this.je, this.vollstaendig = true});
  final KzRegeln standard;
  final Map<String, KzRegeln> je;

  /// false: eine Box von vor dem 25.09.2026 ohne `/satz` — dann ist nur die
  /// Hausregel bekannt, und ob ein Kind eigene Regeln hat, weiss die App
  /// NICHT. Sie bietet die Kinder dann gar nicht erst an.
  final bool vollstaendig;

  factory KzSatz.ausJson(Object? j) {
    final m = j is Map ? j : const {};
    final je = m['je'] is Map ? m['je'] as Map : const {};
    return KzSatz(
      standard: KzRegeln.ausJson(m['standard']),
      je: {for (final e in je.entries) '${e.key}': KzRegeln.ausJson(e.value)},
    );
  }
}

/// Was die Box JETZT sagt (`GET /api/kinderzeit/stand`).
class KzStand {
  const KzStand({
    this.erlaubt = true,
    this.grund = 'aus',
    this.restMin,
    this.fensterAb = '',
    this.fensterBis = '',
    this.aktiv = false,
    this.verbrauchtMin = 0,
    this.bonusMin = 0,
    this.gesperrtBis = '',
  });

  final bool erlaubt;

  /// aus | frei | tagGesperrt | zuFrueh | zuSpaet | aufgebraucht | gesperrt
  final String grund;

  /// null = unbegrenzt.
  final int? restMin;
  final String fensterAb;
  final String fensterBis;
  final bool aktiv;
  final int verbrauchtMin;
  final int bonusMin;
  final String gesperrtBis;

  /// Derselbe Sachverhalt in Worten — nah an dem, was Verwaltung und
  /// Kinderschirm sagen (kinderzeit.ts `standText`, app.js `kinderzeitText`).
  String get text => switch (grund) {
    'aus' => 'Kinderzeit aus',
    'frei' => fensterBis.isEmpty ? 'darf hören' : 'darf hören (bis $fensterBis)',
    'tagGesperrt' => 'heute Hörpause',
    'zuFrueh' => fensterAb.isEmpty ? 'noch zu früh' : 'noch zu früh (ab $fensterAb)',
    'zuSpaet' => fensterBis.isEmpty ? 'Feierabend' : 'Feierabend (war bis $fensterBis)',
    'aufgebraucht' => 'Zeit für heute aufgebraucht',
    'gesperrt' => gesperrtBis.isEmpty ? 'Box gesperrt' : 'Box gesperrt (bis $gesperrtBis)',
    _ => grund,
  };

  factory KzStand.ausJson(Object? j) {
    if (j is! Map) return const KzStand();
    return KzStand(
      erlaubt: j['erlaubt'] != false,
      grund: _text(j['grund']).isEmpty ? 'aus' : _text(j['grund']),
      restMin: j['restMin'] is num ? (j['restMin'] as num).toInt() : null,
      fensterAb: _text(j['fensterAb']),
      fensterBis: _text(j['fensterBis']),
      aktiv: j['aktiv'] == true,
      verbrauchtMin: _zahl(j['verbrauchtMin']),
      bonusMin: _zahl(j['bonusMin']),
      gesperrtBis: _text(j['gesperrtBis']),
    );
  }
}

// ── Sicherung (28.09.2026) ──────────────────────────────────────────────

/// Ein Stand, der auf der Box liegt (`GET /api/sicherung`, `staende`).
class SicherungsStand {
  const SicherungsStand({
    required this.name,
    this.erzeugt,
    this.grund = '',
    this.dateien = 0,
    this.zugangsdaten = 0,
    this.bytes = 0,
    this.fehler = '',
  });

  /// Dateiname auf der Box — der Schluessel fuer `/api/sicherung/stand/<name>`.
  final String name;
  final DateTime? erzeugt;

  /// Wer ihn anlegte: verwaltung, zeitgeber, vor-auslieferung, vorher …
  final String grund;
  final int dateien;

  /// Wie viele Zugangsdaten verschluesselt darin liegen.
  final int zugangsdaten;
  final int bytes;

  /// Nicht leer: der Stand laesst sich nicht oeffnen.
  final String fehler;

  static List<SicherungsStand> listeAusJson(Object? liste) => (liste as List? ?? const [])
      .whereType<Map>()
      .map(
        (s) => SicherungsStand(
          name: _text(s['name']),
          erzeugt: DateTime.tryParse(_text(s['erzeugt']))?.toLocal(),
          grund: _text(s['grund']),
          dateien: _zahl(s['dateien']),
          zugangsdaten: _zahl(s['zugangsdaten']),
          bytes: _zahl(s['bytes']),
          fehler: _text(s['fehler']),
        ),
      )
      .where((s) => s.name.isNotEmpty)
      .toList();
}

/// Die Lage der Sicherung auf einer Box (`GET /api/sicherung`).
class SicherungsLage {
  const SicherungsLage({
    this.werkzeugDa = true,
    this.anmeldungOffen = false,
    this.host = '',
    this.hinweise = const [],
    this.passwortMin = 8,
    this.staende = const [],
    this.meldung = '',
  });

  final bool werkzeugDa;

  /// Die Verwaltung ist ohne Passwort offen — dann kann jeder im WLAN
  /// sichern und zurueckspielen (die Box sagt es, statt es zu verbieten).
  final bool anmeldungOffen;
  final String host;

  /// Wovor die Datei NICHT schuetzt — wortgleich von der Box.
  final List<String> hinweise;
  final int passwortMin;
  final List<SicherungsStand> staende;
  final String meldung;

  factory SicherungsLage.ausJson(Object? j) {
    if (j is! Map) return const SicherungsLage();
    return SicherungsLage(
      werkzeugDa: j['werkzeugDa'] != false,
      anmeldungOffen: j['anmeldungOffen'] == true,
      host: _text(j['host']),
      hinweise: [for (final h in (j['ablageHinweise'] as List? ?? const [])) '$h'],
      passwortMin: j['passwortMin'] == null ? 8 : _zahl(j['passwortMin']),
      staende: SicherungsStand.listeAusJson(j['staende']),
      meldung: _text(j['meldung']),
    );
  }
}

/// Was beim Zurueckspielen passieren WUERDE (`POST /api/sicherung/pruefen`).
class ZurueckVorschau {
  const ZurueckVorschau({
    required this.kennung,
    this.satz = '',
    this.warnungen = const [],
    this.erzeugt,
    this.host = '',
    this.dateien = 0,
    this.zugangsdaten = 0,
    this.vonHand = const [],
  });

  /// sha256 der hochgeladenen Bytes — ohne sie spielt die Box nichts ein.
  final String kennung;
  final String satz;
  final List<String> warnungen;
  final DateTime? erzeugt;
  final String host;
  final int dateien;
  final int zugangsdaten;
  final List<String> vonHand;

  factory ZurueckVorschau.ausJson(Object? j) {
    final m = j is Map ? j : const {};
    final stand = m['stand'] is Map ? m['stand'] as Map : const {};
    final plan = m['plan'] is Map ? m['plan'] as Map : const {};
    return ZurueckVorschau(
      kennung: _text(m['kennung']),
      satz: _text(m['satz']),
      warnungen: [for (final w in (m['warnungen'] as List? ?? const [])) '$w'],
      erzeugt: DateTime.tryParse(_text(stand['erzeugt']))?.toLocal(),
      host: _text(stand['host']),
      dateien: _zahl(stand['dateien']),
      zugangsdaten: (stand['zugangsdaten'] as List? ?? const []).length,
      vonHand: [for (final v in (plan['vonHand'] as List? ?? const [])) '$v'],
    );
  }
}
