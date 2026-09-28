import 'package:flutter/material.dart';

import '../box_client.dart';
import '../modell.dart';
import '../zustand.dart';
import 'dialoge.dart';
import 'versuchen.dart';

/// Kinderzeit einstellen (28.09.2026) — Betreiber: „kinderzeit einstellen
/// kleiner 7 tages kalender". Dieselben Regeln wie die Seite „Kinderzeit" der
/// Verwaltung, am Handy als Woche auf einen Blick: je Tag ein Balken von 0 bis
/// 24 Uhr, darin das erlaubte Fenster, darunter die Hördauer. Ein Tipp auf
/// einen Tag öffnet ihn.
///
/// HAUSREGEL UND EIGENE REGELN JE KIND — die Box führt beides
/// (`/api/kinderzeit/satz`). Wer ein Kind wählt, das keine eigenen hat, sieht
/// die Hausregel, die für es gilt, und legt eigene erst AUSDRÜCKLICH an:
/// sonst friert der erste Speichern-Klick still eine Kopie der Hausregel für
/// dieses Kind ein, und spätere Änderungen an der Hausregel erreichen es nie
/// mehr (dieselbe Falle, wegen der es `/satz` gibt, server.ts).
///
/// DURCHGESETZT WIRD AUF DER BOX, nicht hier (kinderzeit.ts): die App liest
/// und schreibt nur die Regeln.
class KinderzeitSeite extends StatefulWidget {
  const KinderzeitSeite({super.key, required this.stand, required this.box, this.jetzt});
  final BoxenStand stand;
  final BoxEintrag box;

  /// Nur fuer Tests: die Uhr, gegen die „heute" und der Jetzt-Strich gelten.
  final DateTime Function()? jetzt;

  @override
  State<KinderzeitSeite> createState() => _KinderzeitSeiteState();
}

class _KinderzeitSeiteState extends State<KinderzeitSeite> {
  BoxClient get c => widget.stand.client(widget.box);
  DateTime get _jetzt => (widget.jetzt ?? DateTime.now)();

  KzSatz? _satz;
  List<KindProfil> _kinder = const [];
  String _aktivesKind = '';

  /// null = Hausregel (alle Kinder ohne eigene Regeln).
  String? _fuer;

  /// Was gerade bearbeitet wird, und was zuletzt auf der Box stand.
  KzRegeln? _regeln;
  KzRegeln? _gespeichert;

  /// Das gewaehlte Kind hat noch keine eigenen Regeln, soll aber welche
  /// bekommen (nach „Eigene Regeln anlegen", vor dem Speichern).
  bool _eigeneNeu = false;

  KzStand? _heute;
  bool _arbeitet = false;
  bool _geladen = false;

  bool get _hatEigene => _fuer != null && (_satz?.je.containsKey(_fuer) ?? false);

  /// Darf gerade bearbeitet werden? Bei einem Kind ohne eigene Regeln erst
  /// nach „Eigene Regeln anlegen".
  bool get _bearbeitbar => _fuer == null || _hatEigene || _eigeneNeu;
  bool get _geaendert => _regeln != null && (_regeln != _gespeichert || _eigeneNeu);

  Future<T?> _versuchen<T>(Future<T> Function() tat) => mitBoxVersuchen(context, widget.stand, widget.box, tat);

  @override
  void initState() {
    super.initState();
    _laden();
  }

  Future<void> _laden() async {
    final satz = await _versuchen(c.kinderzeitSatz);
    final profile = await _versuchen(c.profile);
    if (!mounted) return;
    setState(() {
      _geladen = true;
      if (satz == null) return;
      _satz = satz;
      _kinder = profile?.profile ?? const [];
      _aktivesKind = profile?.aktiv ?? '';
      // Ein Kind, das es nicht mehr gibt, faellt auf die Hausregel zurueck.
      if (_fuer != null && !_kinder.any((k) => k.kennung == _fuer)) _fuer = null;
      _eigeneNeu = false;
      _regeln = _regelnFuer(_fuer);
      _gespeichert = _regeln;
    });
    await _heuteLaden();
  }

  KzRegeln _regelnFuer(String? kind) => (kind == null ? null : _satz!.je[kind]) ?? _satz!.standard;

  /// Der Stand von HEUTE: fuer das gewaehlte Kind, bei der Hausregel fuer das
  /// Kind, das gerade an der Box ist.
  Future<void> _heuteLaden() async {
    final kind = _fuer ?? (_aktivesKind.isEmpty ? null : _aktivesKind);
    final st = await _versuchen(() => c.kinderzeitStand(profil: kind));
    if (mounted && st != null) setState(() => _heute = st);
  }

  Future<void> _waehlen(String? kind) async {
    if (kind == _fuer) return;
    if (_geaendert && !await _verwerfenFragen()) return;
    setState(() {
      _fuer = kind;
      _eigeneNeu = false;
      _regeln = _regelnFuer(kind);
      _gespeichert = _regeln;
      _heute = null;
    });
    await _heuteLaden();
  }

  Future<bool> _verwerfenFragen() async =>
      await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Nicht gespeichert'),
          content: const Text('Die Änderungen an der Kinderzeit gehen verloren.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Zurück')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Verwerfen')),
          ],
        ),
      ) ==
      true;

  String _name(String? kind) =>
      kind == null ? 'Alle Kinder' : (_kinder.where((k) => k.kennung == kind).firstOrNull?.name ?? kind);

  Future<void> _speichern() async {
    final r = _regeln;
    if (r == null || _arbeitet) return;
    setState(() => _arbeitet = true);
    final neu = await _versuchen(() => c.kinderzeitSetzen(r, profil: _fuer));
    if (!mounted) return;
    setState(() => _arbeitet = false);
    if (neu == null) return;
    meldung(context, 'Kinderzeit gespeichert${_fuer == null ? '' : ' für ${_name(_fuer)}'}.');
    await _laden();
  }

  Future<void> _eigeneAblegen() async {
    final kind = _fuer;
    if (kind == null) return;
    final ja = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Hausregel für ${_name(kind)}?'),
        content: Text('Die eigenen Regeln von ${_name(kind)} werden gelöscht; danach gilt für ${_name(kind)} wieder die Hausregel.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Abbrechen')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Hausregel verwenden')),
        ],
      ),
    );
    if (ja != true || !mounted) return;
    final ok = await _versuchen(() async {
      await c.kinderzeitEigeneAblegen(kind);
      return true;
    });
    if (ok == true) await _laden();
  }

  Future<void> _bonus(int minuten) async {
    final kind = _fuer ?? (_aktivesKind.isEmpty ? null : _aktivesKind);
    final ok = await _versuchen(() async {
      await c.kinderzeitBonus(minuten, profil: kind);
      return true;
    });
    if (ok == true && mounted) meldung(context, '$minuten Minuten für heute dazugegeben.');
    await _heuteLaden();
  }

  Future<void> _zuruecksetzen() async {
    final kind = _fuer ?? (_aktivesKind.isEmpty ? null : _aktivesKind);
    final ok = await _versuchen(() async {
      await c.kinderzeitZuruecksetzen(profil: kind);
      return true;
    });
    if (ok == true && mounted) meldung(context, 'Heute beginnt die Zeit von vorn.');
    await _heuteLaden();
  }

  Future<void> _tagOeffnen(String tag) async {
    final r = _regeln;
    if (r == null) return;
    if (!_bearbeitbar) {
      meldung(context, '${_name(_fuer)} folgt der Hausregel — erst „Eigene Regeln" antippen.');
      return;
    }
    final aus = await showModalBottomSheet<({TagesRegel regel, List<String> tage})>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => _TagBlatt(tag: tag, regel: r.tag(tag)),
    );
    if (aus == null || !mounted) return;
    var neu = r;
    for (final t in aus.tage) {
      neu = neu.tagSetzen(t, aus.regel);
    }
    setState(() => _regeln = neu);
  }

  @override
  Widget build(BuildContext context) {
    final r = _regeln;
    return PopScope(
      canPop: !_geaendert,
      onPopInvokedWithResult: (weg, _) async {
        if (weg) return;
        if (await _verwerfenFragen() && context.mounted) {
          setState(() {
            _regeln = _gespeichert;
            _eigeneNeu = false;
          });
          Navigator.pop(context);
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Kinderzeit'),
          actions: [
            TextButton(
              onPressed: _geaendert && !_arbeitet ? _speichern : null,
              child: const Text('Speichern'),
            ),
          ],
        ),
        body: !_geladen
            ? const Center(child: CircularProgressIndicator())
            : r == null
            ? Center(child: TextButton(onPressed: _laden, child: const Text('Noch einmal versuchen')))
            : RefreshIndicator(
                onRefresh: _laden,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 32),
                  children: [
                    if (_satz!.vollstaendig)
                      _kinderWahl()
                    else
                      const Card(
                        child: ListTile(
                          leading: Icon(Icons.system_update),
                          title: Text('Nur die Hausregel'),
                          subtitle: Text('Eigene Regeln je Kind zeigt die App erst, wenn die Box ein Update hat.'),
                        ),
                      ),
                    if (_fuer != null && !_hatEigene && !_eigeneNeu) _erbtHinweis(),
                    if (_fuer != null && (_hatEigene || _eigeneNeu))
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton.icon(
                          onPressed: _eigeneNeu
                              ? () => setState(() {
                                  _eigeneNeu = false;
                                  _regeln = _gespeichert;
                                })
                              : _eigeneAblegen,
                          icon: const Icon(Icons.undo),
                          label: const Text('Hausregel verwenden'),
                        ),
                      ),
                    Opacity(
                      opacity: _bearbeitbar ? 1 : 0.55,
                      child: AbsorbPointer(
                        absorbing: !_bearbeitbar,
                        child: SwitchListTile(
                          title: const Text('Kinderzeit an'),
                          subtitle: Text(r.aktiv ? 'Die Box hält sich an die Woche unten.' : 'Aus — die Box spielt ohne Zeitgrenze.'),
                          value: r.aktiv,
                          onChanged: (v) => setState(() => _regeln = r.mit(aktiv: v)),
                        ),
                      ),
                    ),
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(8, 12, 8, 8),
                        child: Opacity(
                          opacity: r.aktiv && _bearbeitbar ? 1 : 0.55,
                          child: WochenKalender(regeln: r, heute: _jetzt, antippen: _tagOeffnen),
                        ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      child: Text(
                        'Balken: wann gehört werden darf (0–24 Uhr). Darunter: wie lange. Tippe auf einen Tag.',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),
                    Opacity(
                      opacity: _bearbeitbar ? 1 : 0.55,
                      child: AbsorbPointer(
                        absorbing: !_bearbeitbar,
                        child: ListTile(
                          title: const Text('Nachsicht am Ende'),
                          subtitle: const Text('So lange darf das laufende Stück noch zu Ende gehen.'),
                          trailing: DropdownButton<int>(
                            value: const [0, 5, 10, 15, 30].contains(r.nachsichtMin) ? r.nachsichtMin : null,
                            hint: Text('${r.nachsichtMin} min'),
                            items: [
                              for (final m in const [0, 5, 10, 15, 30])
                                DropdownMenuItem(value: m, child: Text(m == 0 ? 'keine' : '$m min')),
                            ],
                            onChanged: (m) => setState(() => _regeln = r.mit(nachsichtMin: m)),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    _heuteKarte(),
                  ],
                ),
              ),
      ),
    );
  }

  Widget _kinderWahl() => SingleChildScrollView(
    scrollDirection: Axis.horizontal,
    child: Row(
      children: [
        for (final k in <String?>[null, ..._kinder.map((k) => k.kennung)])
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: ChoiceChip(
              label: Text(
                k == null
                    ? 'Alle Kinder'
                    : '${_name(k)}${(_satz?.je.containsKey(k) ?? false) ? ' •' : ''}',
              ),
              selected: _fuer == k,
              onSelected: (_) => _waehlen(k),
            ),
          ),
      ],
    ),
  );

  // KEIN ListTile mit Knopf als `trailing`: dort drueckte der Knopf den Text
  // auf einen schmalen Streifen, und die Karte wurde ueber 1000 px hoch
  // (im Widget-Zeugen gemessen, 28.09.2026). Der Knopf steht darunter.
  Widget _erbtHinweis() => Card(
    child: Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.info_outline),
              const SizedBox(width: 12),
              Expanded(
                child: Text('${_name(_fuer)} folgt der Hausregel', style: Theme.of(context).textTheme.titleMedium),
              ),
            ],
          ),
          const SizedBox(height: 4),
          const Text('Unten steht, was für dieses Kind gilt. Ändert sich die Hausregel, ändert es sich mit.'),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton.tonal(
              onPressed: () => setState(() {
                _eigeneNeu = true;
                _regeln = _satz!.standard;
              }),
              child: const Text('Eigene Regeln'),
            ),
          ),
        ],
      ),
    ),
  );

  Widget _heuteKarte() {
    final h = _heute;
    final kind = _fuer ?? (_aktivesKind.isEmpty ? null : _aktivesKind);
    final wer = kind == null ? '' : ' — ${_name(kind)}${_fuer == null ? ' (gerade an der Box)' : ''}';
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Heute$wer', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            if (h == null)
              const Text('wird gefragt …')
            else ...[
              Text(
                h.text,
                style: TextStyle(color: h.erlaubt ? null : Theme.of(context).colorScheme.error, fontWeight: FontWeight.w600),
              ),
              Text(
                [
                  '${h.verbrauchtMin} min gehört',
                  if (h.restMin != null) 'noch ${h.restMin} min' else if (h.aktiv) 'ohne Minutengrenze',
                  if (h.bonusMin > 0) '${h.bonusMin} min geschenkt',
                ].join(' · '),
              ),
            ],
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                FilledButton.tonalIcon(onPressed: () => _bonus(15), icon: const Icon(Icons.add), label: const Text('15 min')),
                FilledButton.tonalIcon(onPressed: () => _bonus(30), icon: const Icon(Icons.add), label: const Text('30 min')),
                TextButton.icon(onPressed: _zuruecksetzen, icon: const Icon(Icons.restart_alt), label: const Text('Heute zurücksetzen')),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// DIE WOCHE AUF EINEN BLICK — sieben Balken, Montag zuerst.
///
/// Jeder Balken ist ein Tag von 0 bis 24 Uhr (oben Mitternacht). Farbig ist,
/// wann gehört werden darf; ein gesperrter Tag ist leer mit Mond. Unter dem
/// Balken die Hördauer. Heute ist hervorgehoben, mit einem Strich bei „jetzt".
class WochenKalender extends StatelessWidget {
  const WochenKalender({super.key, required this.regeln, required this.heute, required this.antippen, this.hoehe = 150});
  final KzRegeln regeln;
  final DateTime heute;
  final void Function(String tag) antippen;
  final double hoehe;

  static String dauerText(TagesRegel r) {
    if (!r.frei) return 'Pause';
    if (r.minuten <= 0) return '∞';
    final h = r.minuten ~/ 60;
    final m = r.minuten % 60;
    if (h == 0) return '$m min';
    return m == 0 ? '$h h' : '$h h $m';
  }

  @override
  Widget build(BuildContext context) {
    final f = Theme.of(context).colorScheme;
    final heuteTag = kzTagVon(heute);
    final nun = heute.hour * 60 + heute.minute;
    final klein = Theme.of(context).textTheme.labelSmall;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Die Stundenachse: 0, 6, 12, 18, 24.
        SizedBox(
          width: 22,
          child: Padding(
            padding: const EdgeInsets.only(top: 22),
            child: SizedBox(
              height: hoehe,
              child: Stack(
                children: [
                  for (final h in const [0, 6, 12, 18, 24])
                    Positioned(
                      top: (h / 24 * hoehe - 6).clamp(0, hoehe - 12),
                      right: 2,
                      child: Text('$h', style: klein?.copyWith(fontSize: 9, color: f.outline)),
                    ),
                ],
              ),
            ),
          ),
        ),
        for (final t in kzTage)
          Expanded(
            child: Semantics(
              button: true,
              label: '${kzTagNamenLang[t]}: ${_beschreibung(regeln.tag(t))}',
              child: InkWell(
                key: ValueKey('kz-tag-$t'),
                borderRadius: BorderRadius.circular(8),
                onTap: () => antippen(t),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 3),
                  child: Column(
                    children: [
                      Container(
                        height: 20,
                        alignment: Alignment.center,
                        decoration: t == heuteTag
                            ? BoxDecoration(color: f.primary, borderRadius: BorderRadius.circular(10))
                            : null,
                        child: Text(
                          kzTagNamen[t]!,
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color: t == heuteTag ? f.onPrimary : null,
                          ),
                        ),
                      ),
                      const SizedBox(height: 2),
                      SizedBox(
                        height: hoehe,
                        child: CustomPaint(
                          size: Size.infinite,
                          painter: _TagMaler(
                            regel: regeln.tag(t),
                            jetztMin: t == heuteTag ? nun : null,
                            grund: f.surfaceContainerHighest,
                            fenster: f.primary,
                            gesperrt: f.outlineVariant,
                            jetzt: f.error,
                          ),
                          child: regeln.tag(t).frei
                              ? null
                              : Center(child: Icon(Icons.bedtime, size: 18, color: f.outline)),
                        ),
                      ),
                      const SizedBox(height: 4),
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Text(dauerText(regeln.tag(t)), style: Theme.of(context).textTheme.labelMedium),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }

  static String _beschreibung(TagesRegel r) {
    if (!r.frei) return 'Hörpause';
    final fenster = r.ab.isEmpty && r.bis.isEmpty
        ? 'den ganzen Tag'
        : '${r.ab.isEmpty ? '0:00' : r.ab} bis ${r.bis.isEmpty ? '24:00' : r.bis}';
    return '$fenster, ${r.minuten <= 0 ? 'unbegrenzt' : '${r.minuten} Minuten'}';
  }
}

class _TagMaler extends CustomPainter {
  _TagMaler({
    required this.regel,
    required this.jetztMin,
    required this.grund,
    required this.fenster,
    required this.gesperrt,
    required this.jetzt,
  });
  final TagesRegel regel;
  final int? jetztMin;
  final Color grund;
  final Color fenster;
  final Color gesperrt;
  final Color jetzt;

  @override
  void paint(Canvas canvas, Size size) {
    final r = RRect.fromRectAndRadius(Offset.zero & size, const Radius.circular(6));
    canvas.save();
    canvas.clipRRect(r);
    canvas.drawRect(Offset.zero & size, Paint()..color = grund);
    if (regel.frei) {
      final ab = kzMinuten(regel.ab) ?? 0;
      final bis = kzMinuten(regel.bis) ?? 24 * 60;
      if (bis > ab) {
        final y0 = ab / (24 * 60) * size.height;
        final y1 = bis / (24 * 60) * size.height;
        canvas.drawRect(Rect.fromLTRB(0, y0, size.width, y1), Paint()..color = fenster.withValues(alpha: 0.75));
      }
    } else {
      // Schraffur: ein gesperrter Tag soll nicht aussehen wie ein leerer.
      final p = Paint()
        ..color = gesperrt
        ..strokeWidth = 1.5;
      for (var y = -size.width; y < size.height; y += 8) {
        canvas.drawLine(Offset(0, y + size.width), Offset(size.width, y), p);
      }
    }
    if (jetztMin != null) {
      final y = jetztMin! / (24 * 60) * size.height;
      canvas.drawLine(Offset(0, y), Offset(size.width, y), Paint()
        ..color = jetzt
        ..strokeWidth = 2);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_TagMaler alt) =>
      alt.regel != regel || alt.jetztMin != jetztMin || alt.fenster != fenster || alt.grund != grund;
}

/// Ein Tag zum Bearbeiten — als Blatt von unten. Zurueck kommt die neue
/// Regel und auf welche Tage sie soll (mindestens dieser).
class _TagBlatt extends StatefulWidget {
  const _TagBlatt({required this.tag, required this.regel});
  final String tag;
  final TagesRegel regel;

  @override
  State<_TagBlatt> createState() => _TagBlattState();
}

class _TagBlattState extends State<_TagBlatt> {
  late TagesRegel _r = widget.regel;

  /// Bis 4 Stunden in Viertelstunden; steht schon mehr auf der Box, reicht
  /// der Regler bis dorthin.
  int get _max => _r.minuten > 240 ? ((_r.minuten + 14) ~/ 15) * 15 : 240;

  String? get _fehler {
    final ab = kzMinuten(_r.ab);
    final bis = kzMinuten(_r.bis);
    if (_r.frei && ab != null && bis != null && ab >= bis) return '„Ab" muss vor „bis" liegen — sonst darf an diesem Tag nie gehört werden.';
    return null;
  }

  Future<void> _zeit(bool ab) async {
    final alt = kzMinuten(ab ? _r.ab : _r.bis) ?? (ab ? 7 * 60 : 19 * 60);
    final t = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: alt ~/ 60, minute: alt % 60),
      helpText: ab ? 'Hören ab' : 'Hören bis',
    );
    if (t == null) return;
    final z = kzZeit(t.hour * 60 + t.minute);
    setState(() => _r = ab ? _r.mit(ab: z) : _r.mit(bis: z));
  }

  void _fertig(List<String> tage) => Navigator.pop(context, (regel: _r, tage: tage));

  @override
  Widget build(BuildContext context) {
    final fehler = _fehler;
    final aus = !_r.frei;
    return SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 4),
              child: Text(kzTagNamenLang[widget.tag]!, style: Theme.of(context).textTheme.titleLarge),
            ),
            SwitchListTile(
              title: const Text('Darf hören'),
              subtitle: Text(aus ? 'Hörpause — die Box spielt an diesem Tag nichts.' : 'An diesem Tag ist Hören erlaubt.'),
              value: _r.frei,
              onChanged: (v) => setState(() => _r = _r.mit(frei: v)),
            ),
            Opacity(
              opacity: aus ? 0.4 : 1,
              child: AbsorbPointer(
                absorbing: aus,
                child: Column(
                  children: [
                    for (final ab in const [true, false])
                      ListTile(
                        leading: Icon(ab ? Icons.wb_sunny_outlined : Icons.nights_stay_outlined),
                        title: Text(ab ? 'Ab' : 'Bis'),
                        subtitle: Text(ab ? 'Früher geht nichts los.' : 'Danach ist Feierabend.'),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            TextButton(
                              key: ValueKey(ab ? 'kz-ab' : 'kz-bis'),
                              onPressed: () => _zeit(ab),
                              child: Text((ab ? _r.ab : _r.bis).isEmpty ? 'keine Grenze' : (ab ? _r.ab : _r.bis)),
                            ),
                            if ((ab ? _r.ab : _r.bis).isNotEmpty)
                              IconButton(
                                tooltip: 'Grenze entfernen',
                                icon: const Icon(Icons.clear),
                                onPressed: () => setState(() => _r = ab ? _r.mit(ab: '') : _r.mit(bis: '')),
                              ),
                          ],
                        ),
                      ),
                    ListTile(
                      leading: const Icon(Icons.hourglass_bottom),
                      title: const Text('Hördauer'),
                      trailing: Text(
                        _r.minuten <= 0 ? 'unbegrenzt' : WochenKalender.dauerText(_r),
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                    Slider(
                      value: _r.minuten.clamp(0, _max).toDouble(),
                      max: _max.toDouble(),
                      divisions: _max ~/ 15,
                      label: _r.minuten <= 0 ? 'unbegrenzt' : '${_r.minuten} min',
                      onChanged: (v) => setState(() => _r = _r.mit(minuten: v.round())),
                    ),
                  ],
                ),
              ),
            ),
            if (fehler != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Text(fehler, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                alignment: WrapAlignment.end,
                children: [
                  OutlinedButton(
                    onPressed: fehler != null ? null : () => _fertig(const ['mo', 'di', 'mi', 'do', 'fr']),
                    child: const Text('Für Mo–Fr'),
                  ),
                  OutlinedButton(
                    onPressed: fehler != null ? null : () => _fertig(const ['sa', 'so']),
                    child: const Text('Für Sa–So'),
                  ),
                  OutlinedButton(
                    onPressed: fehler != null ? null : () => _fertig(kzTage),
                    child: const Text('Für alle Tage'),
                  ),
                  FilledButton(
                    onPressed: fehler != null ? null : () => _fertig([widget.tag]),
                    child: const Text('Übernehmen'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
