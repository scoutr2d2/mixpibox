import 'dart:async';

import 'package:flutter/foundation.dart';

import 'box_client.dart';
import 'modell.dart';
import 'speicher.dart';

/// Was die App von einer Box gerade weiss.
class BoxLage {
  const BoxLage({
    this.wiedergabe,
    this.fehler,
    this.anmeldungNoetig = false,
    this.kopplungNoetig = false,
    this.profilName,
    this.profilFigur = '',
    this.coverPfad,
    this.sperre,
  });

  final Wiedergabe? wiedergabe;
  final String? fehler;
  final bool anmeldungNoetig;

  /// Die Box kennt dieses Handy nicht — erst koppeln (Code oder QR).
  final bool kopplungNoetig;

  /// Name des aktiven Kinderprofils, falls bekannt.
  final String? profilName;

  /// Bild des aktiven Kindes (Dateiname, siehe `KindProfil.figur`).
  final String profilFigur;

  /// Feste Bildadresse des laufenden Albums (siehe `BoxClient.coverZiel`).
  final String? coverPfad;

  /// Die Sperre der Eltern (`/api/boxsperre`). `null`: unbekannt — eine
  /// aeltere Box ohne den Weg, oder noch nicht gefragt.
  final SperrStand? sperre;

  bool get gesperrt => sperre?.aktiv == true;

  bool get erreichbar => wiedergabe != null;
}

/// Alle Boxen, ihre Clients und ihr zuletzt gesehener Zustand.
///
/// EIN Takt fuer alle (alle 4 s, nur solange die App vorne ist): jede Box wird
/// parallel gefragt, eine langsame haelt die anderen nicht auf.
class BoxenStand extends ChangeNotifier {
  BoxenStand({BoxSpeicher? speicher, this.clientBauen = _standardClient}) : _speicher = speicher ?? BoxSpeicher();

  final BoxSpeicher _speicher;
  final BoxClient Function(BoxEintrag) clientBauen;

  static BoxClient _standardClient(BoxEintrag b) => BoxClient(b);

  final List<BoxEintrag> boxen = [];
  final Map<String, BoxClient> _clients = {};
  final Map<String, BoxLage> _lage = {};
  Timer? _takt;
  bool _geladen = false;

  /// Ein Abruf, der erst nach dem Schliessen zurueckkommt, darf nichts mehr
  /// melden — ChangeNotifier wirft sonst.
  bool _entsorgt = false;

  void _melden() {
    if (!_entsorgt) notifyListeners();
  }

  bool get geladen => _geladen;

  BoxLage lage(String id) => _lage[id] ?? const BoxLage();

  BoxClient client(BoxEintrag b) => _clients.putIfAbsent(b.id, () {
    final c = clientBauen(b);
    c.geaendert = (_) => unawaited(sichern());
    return c;
  });

  /// Warum das Lesen der gemerkten Boxen scheiterte — oder null.
  String? ladeFehler;

  /// Die gemerkten Boxen lesen.
  ///
  /// `geladen` WIRD IN JEDEM FALL WAHR. Scheitert das Lesen, startet die App
  /// mit leerer Liste und nennt den Grund — statt fuer immer einen Kreisel zu
  /// zeigen. Genau das war am 27.09.2026 auf dem Handy passiert: der Fehler
  /// ging in einem Future unter, auf das niemand wartet.
  Future<void> laden() async {
    try {
      final gelesen = await _speicher.laden();
      boxen
        ..clear()
        ..addAll(gelesen);
      ladeFehler = null;
    } catch (e) {
      ladeFehler = e.toString();
    } finally {
      _geladen = true;
      _melden();
    }
    await aktualisieren();
  }

  Future<void> sichern() => _speicher.sichern(boxen);

  void taktStarten() {
    _takt?.cancel();
    _takt = Timer.periodic(const Duration(seconds: 4), (_) => aktualisieren());
  }

  void taktAnhalten() {
    _takt?.cancel();
    _takt = null;
  }

  Future<void> aktualisieren() async {
    await Future.wait(boxen.map(_eineAktualisieren));
  }

  Future<void> _eineAktualisieren(BoxEintrag b) async {
    final c = client(b);
    BoxLage neu;
    try {
      final w = await c.wiedergabe();
      String? profilName = _lage[b.id]?.profilName;
      var profilFigur = _lage[b.id]?.profilFigur ?? '';
      try {
        final p = await c.profile();
        final aktiv = p.profile.where((k) => k.kennung == p.aktiv).firstOrNull;
        profilName = aktiv?.name;
        profilFigur = aktiv?.figur ?? '';
      } on BoxFehler {
        // Profile sind Beiwerk — die Wiedergabe zaehlt.
      }
      // Das Cover nur fragen, wenn etwas laeuft — sonst gibt es keins.
      final coverPfad = w.spielt ? await c.coverZiel() : null;
      // DIE SPERRE IM SELBEN TAKT: sie steht in der Uebersicht, und wer sie
      // vom zweiten Handy setzt, soll sie hier nach 4 s sehen.
      SperrStand? sperre = _lage[b.id]?.sperre;
      try {
        sperre = await c.sperre();
      } on BoxFehler {
        // Beiwerk wie die Profile — der letzte bekannte Stand bleibt.
      }
      neu = BoxLage(
        wiedergabe: w,
        profilName: profilName,
        profilFigur: profilFigur,
        coverPfad: coverPfad,
        sperre: sperre,
      );
    } on KopplungNoetig catch (e) {
      neu = BoxLage(kopplungNoetig: true, fehler: e.satz);
    } on AnmeldungNoetig {
      neu = const BoxLage(anmeldungNoetig: true, fehler: 'Anmeldung nötig');
    } on BoxFehler catch (e) {
      neu = BoxLage(fehler: e.satz);
    }
    _lage[b.id] = neu;
    _melden();
  }

  Future<void> eineAktualisieren(BoxEintrag b) => _eineAktualisieren(b);

  /// Mit dem Code von der Box koppeln; der Schluessel wird gespeichert.
  Future<void> koppeln(BoxEintrag b, String code, {String name = 'Handy'}) async {
    await client(b).koppeln(code, name: name);
    await sichern();
    await _eineAktualisieren(b);
  }

  Future<void> hinzufuegen(BoxEintrag b) async {
    boxen.add(b);
    await sichern();
    _melden();
    // NICHT abwarten: die Seite „Box hinzufuegen" schliesst erst, wenn dies
    // zurueckkommt — und die erste Abfrage kann bis zu 3 x 6 s dauern.
    unawaited(_eineAktualisieren(b));
  }

  /// Nach dem Bearbeiten: der Client haengt an Adresse/HTTPS, also neu bauen.
  Future<void> geaendert(BoxEintrag b) async {
    _clients.remove(b.id)?.schliessen();
    await sichern();
    _melden();
    unawaited(_eineAktualisieren(b));
  }

  Future<void> entfernen(BoxEintrag b) async {
    boxen.removeWhere((x) => x.id == b.id);
    _clients.remove(b.id)?.schliessen();
    _lage.remove(b.id);
    await sichern();
    _melden();
  }

  // ── Alle auf einmal ──────────────────────────────────────────────────

  /// Schickt denselben Befehl an alle erreichbaren Boxen und sagt, welche
  /// NICHT mitgemacht haben (Name → Grund).
  Future<Map<String, String>> anAlle(Future<void> Function(BoxClient c) tat) async {
    final fehler = <String, String>{};
    await Future.wait(
      boxen.map((b) async {
        try {
          await tat(client(b));
        } on BoxFehler catch (e) {
          fehler[b.name] = e.satz;
        }
      }),
    );
    await aktualisieren();
    return fehler;
  }

  /// Die Profilnamen, die es auf mindestens einer Box gibt — fuer „auf allen
  /// Boxen zu Lena wechseln". Zugeordnet wird ueber den NAMEN, nicht die
  /// Kennung: dasselbe Kind kann auf zwei Boxen verschiedene Kennungen haben.
  Future<Map<String, Map<BoxEintrag, KindProfil>>> profileUeberAlle() async {
    final raus = <String, Map<BoxEintrag, KindProfil>>{};
    await Future.wait(
      boxen.map((b) async {
        try {
          final stand = await client(b).profile();
          for (final p in stand.profile) {
            raus.putIfAbsent(p.name.trim().toLowerCase(), () => {})[b] = p;
          }
        } on BoxFehler {
          // nicht erreichbar: taucht einfach nicht auf
        }
      }),
    );
    return raus;
  }

  @override
  void dispose() {
    _entsorgt = true;
    taktAnhalten();
    for (final c in _clients.values) {
      c.schliessen();
    }
    super.dispose();
  }
}
