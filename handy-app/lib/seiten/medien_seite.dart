import 'package:flutter/material.dart';

import '../box_client.dart';
import '../modell.dart';
import '../zustand.dart';
import 'dialoge.dart';
import 'versuchen.dart';

/// Medien der Box verwalten (27.09.2026) — der Kern der Seite „Medien" der
/// Verwaltung, am Handy: ansehen, suchen, hinzufuegen, umbenennen,
/// Kategorie, wer sieht was, loeschen, neu einlesen.
///
/// NICHT HIER (bleibt in der Weboberflaeche): Aufraeumen und
/// Verfuegbarkeitspruefung, ARD-Regale, Internet Archive, eigene Listen.
///
/// NUR MIT VERWALTUNGSPASSWORT, wenn die Box eins hat — so entschieden. Die
/// Wege liegen alle hinter dem Anmeldetor; ohne Passwort an der Box darf,
/// wer gekoppelt ist (wie heute jeder Browser im Heimnetz).
///
/// NACHEINANDER SCHREIBEN: die Box weist parallele Schreiber mit „gesperrt"
/// ab (`dataLock`). Deshalb haelt [_arbeitet] jeden zweiten Klick an, bis der
/// erste fertig ist.
class MedienSeite extends StatefulWidget {
  const MedienSeite({super.key, required this.stand, required this.box});
  final BoxenStand stand;
  final BoxEintrag box;

  @override
  State<MedienSeite> createState() => _MedienSeiteState();
}

class _MedienSeiteState extends State<MedienSeite> {
  BoxClient get c => widget.stand.client(widget.box);

  List<MedienEintrag>? _liste;
  List<ProfilAuswahl> _auswahlen = const [];
  String _filter = '';
  String _kategorie = '';
  bool _arbeitet = false;

  @override
  void initState() {
    super.initState();
    _laden();
  }

  /// Ein Ruf mit Anmeldung, Kopplung und Satz der Box (versuchen.dart).
  Future<T?> _versuchen<T>(Future<T> Function() tat) => mitBoxVersuchen(context, widget.stand, widget.box, tat);

  Future<void> _laden() async {
    final liste = await _versuchen(c.medien);
    final auswahlen = await _versuchen(c.auswahlen) ?? const <ProfilAuswahl>[];
    if (!mounted) return;
    setState(() {
      _liste = liste ?? _liste ?? const [];
      _auswahlen = auswahlen;
    });
  }

  /// Schreiben, nacheinander, und danach frisch laden.
  Future<void> _schreiben(Future<void> Function() tat, {String? erfolg}) async {
    if (_arbeitet) return;
    setState(() => _arbeitet = true);
    var ok = false;
    try {
      ok =
          await _versuchen(() async {
            await tat();
            return true;
          }) ??
          false;
    } finally {
      if (mounted) setState(() => _arbeitet = false);
    }
    if (ok && erfolg != null && mounted) meldung(context, erfolg);
    await _laden();
  }

  Future<void> _neuEinlesen() => _schreiben(c.medienNeuEinlesen, erfolg: 'Medien neu eingelesen.');

  List<MedienEintrag> get _sichtbar {
    final f = _filter.toLowerCase();
    return (_liste ?? const [])
        .where((e) => _kategorie.isEmpty || e.kategorie == _kategorie)
        .where((e) => f.isEmpty || e.titel.toLowerCase().contains(f) || e.interpret.toLowerCase().contains(f))
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final liste = _liste;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Medien verwalten'),
        actions: [
          PopupMenuButton<String>(
            onSelected: (w) {
              if (w == 'einlesen') _neuEinlesen();
            },
            itemBuilder: (_) => const [PopupMenuItem(value: 'einlesen', child: Text('Medien neu einlesen'))],
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _arbeitet
            ? null
            : () async {
                await Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => MedienSuchSeite(client: c, versuchen: _versuchen, auswahlen: _auswahlen),
                  ),
                );
                await _laden();
              },
        icon: const Icon(Icons.add),
        label: const Text('Hinzufügen'),
      ),
      body: liste == null
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
                  child: TextField(
                    decoration: const InputDecoration(
                      prefixIcon: Icon(Icons.search),
                      hintText: 'Suchen',
                      isDense: true,
                    ),
                    onChanged: (v) => setState(() => _filter = v),
                  ),
                ),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Row(
                    children: [
                      for (final k in ['', ...kategorieNamen.keys])
                        Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: ChoiceChip(
                            label: Text(k.isEmpty ? 'Alle (${liste.length})' : kategorieNamen[k]!),
                            selected: _kategorie == k,
                            onSelected: (_) => setState(() => _kategorie = k),
                          ),
                        ),
                    ],
                  ),
                ),
                if (_arbeitet) const LinearProgressIndicator(),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: _laden,
                    child: ListView.builder(
                      padding: const EdgeInsets.only(bottom: 96),
                      itemCount: _sichtbar.length,
                      itemBuilder: (context, i) {
                        final e = _sichtbar[i];
                        return ListTile(
                          leading: _Cover(client: c, eintrag: e),
                          title: Text(e.titel, maxLines: 2, overflow: TextOverflow.ellipsis),
                          subtitle: Text(
                            [
                              e.interpret,
                              kategorieNamen[e.kategorie] ?? e.kategorie,
                              e.dienst,
                            ].where((s) => s.isNotEmpty).join(' · '),
                          ),
                          onTap: () => _blattOeffnen(e),
                        );
                      },
                    ),
                  ),
                ),
              ],
            ),
    );
  }

  Future<void> _blattOeffnen(MedienEintrag e) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => _EintragBlatt(
        eintrag: e,
        auswahlen: _auswahlen,
        umbenennen: (titel) => _schreiben(() => c.medienAendern(e.schluessel, {'title': titel}), erfolg: 'Umbenannt.'),
        kategorieSetzen: (k) => _schreiben(() => c.medienAendern(e.schluessel, {'category': k})),
        sichtbarSetzen: (p, an) => _schreiben(() => _auswahlMitRueckfrage(p, e.schluessel, an)),
        loeschen: () => _schreiben(() => c.medienLoeschen(e.schluessel), erfolg: '„${e.titel}“ gelöscht.'),
      ),
    );
  }

  /// Die Box fragt zurueck, wenn ein Kind dadurch eingesperrt oder geoeffnet
  /// wuerde — die Frage gehoert dem Menschen, nicht der App.
  Future<void> _auswahlMitRueckfrage(ProfilAuswahl p, String schluessel, bool an) async {
    try {
      await c.auswahlSetzen(p.kennung, schluessel, an: an);
    } on AuswahlRueckfrage catch (r) {
      if (!mounted) return;
      final satz = r.frage == 'einsperren'
          ? '${p.name} sieht bisher alles. Danach sieht ${p.name} NUR noch dieses eine Werk.'
          : '${p.name} sieht danach wieder ALLES auf der Box.';
      final ja = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Wirklich?'),
          content: Text(satz),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Nein')),
            TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Ja')),
          ],
        ),
      );
      if (ja == true) await c.auswahlSetzen(p.kennung, schluessel, an: an, bestaetigt: true);
    }
  }
}

class _Cover extends StatelessWidget {
  const _Cover({required this.client, required this.eintrag});
  final BoxClient client;
  final MedienEintrag eintrag;

  @override
  Widget build(BuildContext context) {
    final ersatz = ColoredBox(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: const Icon(Icons.music_note),
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(6),
      child: SizedBox(
        width: 48,
        height: 48,
        // DAS COVER UEBER DIE BOX (/api/bild/<schluessel>), nie die Adresse
        // aus `cover` — die traegt bei Jellyfin den Zugangsschluessel.
        child: Image.network(
          client.bildAdresse('/api/bild/${Uri.encodeComponent(eintrag.schluessel)}').toString(),
          headers: client.bildKopf,
          fit: BoxFit.cover,
          cacheWidth: 144,
          errorBuilder: (_, _, _) => ersatz,
        ),
      ),
    );
  }
}

class _EintragBlatt extends StatefulWidget {
  const _EintragBlatt({
    required this.eintrag,
    required this.auswahlen,
    required this.umbenennen,
    required this.kategorieSetzen,
    required this.sichtbarSetzen,
    required this.loeschen,
  });
  final MedienEintrag eintrag;
  final List<ProfilAuswahl> auswahlen;
  final Future<void> Function(String titel) umbenennen;
  final Future<void> Function(String kategorie) kategorieSetzen;
  final Future<void> Function(ProfilAuswahl p, bool an) sichtbarSetzen;
  final Future<void> Function() loeschen;

  @override
  State<_EintragBlatt> createState() => _EintragBlattState();
}

class _EintragBlattState extends State<_EintragBlatt> {
  late final _titel = TextEditingController(text: widget.eintrag.titel);
  late String _kategorie = widget.eintrag.kategorie;
  late final Map<String, bool> _sieht = {
    for (final p in widget.auswahlen) p.kennung: p.sieht(widget.eintrag.schluessel),
  };
  bool _loeschFrage = false;

  @override
  Widget build(BuildContext context) {
    final e = widget.eintrag;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              [e.interpret, e.dienst].where((s) => s.isNotEmpty).join(' · '),
              style: Theme.of(context).textTheme.bodySmall,
            ),
            TextField(
              controller: _titel,
              decoration: InputDecoration(
                labelText: 'Titel',
                suffixIcon: IconButton(
                  icon: const Icon(Icons.check),
                  tooltip: 'Titel speichern',
                  onPressed: () {
                    final t = _titel.text.trim();
                    if (t.isNotEmpty && t != e.titel) widget.umbenennen(t);
                  },
                ),
              ),
            ),
            const SizedBox(height: 12),
            SegmentedButton<String>(
              segments: [for (final k in kategorieNamen.entries) ButtonSegment(value: k.key, label: Text(k.value))],
              selected: {_kategorie},
              onSelectionChanged: (s) {
                setState(() => _kategorie = s.first);
                widget.kategorieSetzen(s.first);
              },
            ),
            if (widget.auswahlen.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text('Wer sieht es?', style: Theme.of(context).textTheme.titleSmall),
              for (final p in widget.auswahlen)
                SwitchListTile(
                  title: Text(p.name),
                  subtitle: p.alle ? const Text('sieht bisher alles') : null,
                  value: _sieht[p.kennung] ?? false,
                  onChanged: (an) async {
                    setState(() => _sieht[p.kennung] = an);
                    await widget.sichtbarSetzen(p, an);
                  },
                ),
            ],
            const SizedBox(height: 12),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(foregroundColor: Theme.of(context).colorScheme.error),
              icon: const Icon(Icons.delete_outline),
              // ZWEIMAL TIPPEN, wie in der Verwaltung und an der Box: das erste fragt.
              label: Text(_loeschFrage ? 'Wirklich löschen' : 'Löschen'),
              onPressed: () async {
                if (!_loeschFrage) return setState(() => _loeschFrage = true);
                Navigator.pop(context);
                await widget.loeschen();
              },
            ),
          ],
        ),
      ),
    );
  }
}

/// Bei den Diensten der Box suchen und aufnehmen.
class MedienSuchSeite extends StatefulWidget {
  const MedienSuchSeite({
    super.key,
    required this.client,
    required this.versuchen,
    required this.auswahlen,
    this.vorgabe,
    this.titel = 'Hinzufügen',
  });
  final BoxClient client;
  final Future<T?> Function<T>(Future<T> Function()) versuchen;
  final List<ProfilAuswahl> auswahlen;

  /// Treffer, die schon feststehen (ein geteilter Link) — dann gibt es kein
  /// Suchfeld, und die Hinweise der Box stehen darueber.
  final Future<({List<Map<String, dynamic>> treffer, List<String> hinweise})> Function()? vorgabe;
  final String titel;

  @override
  State<MedienSuchSeite> createState() => _MedienSuchSeiteState();
}

class _MedienSuchSeiteState extends State<MedienSuchSeite> {
  List<Map<String, dynamic>>? _treffer;
  List<String> _hinweise = const [];

  /// Warum die Vorgabe nichts brachte — steht AUF der Seite, nicht nur als
  /// kurze Meldung unten, die verschwindet, bevor man sie liest.
  String? _fehlerSatz;
  final Set<String> _aufgenommen = {};

  @override
  void initState() {
    super.initState();
    final v = widget.vorgabe;
    if (v != null) {
      widget.versuchen(() async {
        try {
          return await v();
        } on BoxFehler catch (e) {
          _fehlerSatz = e.satz;
          rethrow;
        }
      }).then((r) {
        if (!mounted) return;
        setState(() {
          _treffer = r?.treffer ?? const [];
          _hinweise = r?.hinweise ?? const [];
        });
      });
    }
  }

  /// „Aufnehmen als" — wie die Auswahl neben dem Treffer in der Verwaltung.
  String _kategorie = 'music';
  bool _arbeitet = false;

  Future<void> _suchen(String q) async {
    setState(() => _treffer = null);
    final t = await widget.versuchen(() => widget.client.medienSuchen(q));
    if (mounted) setState(() => _treffer = t ?? const []);
  }

  /// „Für" — welche Kinder mit EIGENER Auswahl das Neue gleich sehen.
  /// Vorgabe: alle, wie die Verwaltung (medien.ts); abwaehlen geht HIER,
  /// statt danach je Kind im Eintrag umzuschalten (Betreiber 27.09.2026:
  /// „ich finde die doppel klicks unpraktisch").
  ///
  /// Kinder, die ALLES sehen, stehen nicht zur Wahl: fuer sie waere
  /// „abwaehlen" das Einsperren auf alles ausser diesem Werk — eine grosse
  /// Tat, die in den Eintrag gehoert, mit ihrer Rueckfrage.
  late final Set<String> _fuer = {for (final p in widget.auswahlen.where((p) => !p.alle)) p.kennung};

  /// Aufnehmen — und gleich den gewaehlten Kindern freigeben, die NICHT
  /// alles sehen; sonst saehe es dort niemand.
  Future<void> _aufnehmen(Map<String, dynamic> t) async {
    if (_arbeitet) return;
    setState(() => _arbeitet = true);
    try {
      final schluessel = await widget.versuchen(() => widget.client.medienHinzufuegen(t, kategorie: _kategorie));
      if (schluessel == null) return;
      for (final p in widget.auswahlen.where((p) => !p.alle && _fuer.contains(p.kennung))) {
        if (schluessel.isEmpty) break;
        await widget.versuchen(() => widget.client.auswahlSetzen(p.kennung, schluessel, an: true));
      }
      if (!mounted) return;
      setState(() => _aufgenommen.add('${t['schluessel']}'));
      meldung(context, '„${t['title']}“ aufgenommen.');
    } finally {
      if (mounted) setState(() => _arbeitet = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final treffer = _treffer;
    return Scaffold(
      appBar: AppBar(title: Text(widget.titel)),
      body: Column(
        children: [
          for (final h in _hinweise) Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 0), child: Text(h)),
          if (widget.vorgabe != null && treffer != null && treffer.isEmpty)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(_fehlerSatz ?? 'Die Box hat zu diesem Link nichts gefunden.'),
            ),
          if (widget.vorgabe == null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: TextField(
                autofocus: true,
                textInputAction: TextInputAction.search,
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  hintText: 'Spotify, Jellyfin, ARD durchsuchen',
                ),
                onSubmitted: _suchen,
              ),
            ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            // WRAP, NICHT ROW: am Telefon sind Text und drei Chips knapp breiter
            // als der Schirm — dann bricht die Reihe um statt ueber den Rand.
            child: Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                const Text('Aufnehmen als: '),
                for (final k in kategorieNamen.entries)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: ChoiceChip(
                      label: Text(k.value),
                      selected: _kategorie == k.key,
                      onSelected: (_) => setState(() => _kategorie = k.key),
                    ),
                  ),
              ],
            ),
          ),
          if (widget.auswahlen.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 0),
              child: Wrap(
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  const Text('Für: '),
                  for (final p in widget.auswahlen)
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: FilterChip(
                        label: Text(p.alle ? '${p.name} (sieht alles)' : p.name),
                        selected: p.alle || _fuer.contains(p.kennung),
                        onSelected: p.alle
                            ? null
                            : (an) => setState(() => an ? _fuer.add(p.kennung) : _fuer.remove(p.kennung)),
                      ),
                    ),
                ],
              ),
            ),
          if (_arbeitet) const LinearProgressIndicator(),
          Expanded(
            child: treffer == null
                ? Center(
                    child: widget.vorgabe == null
                        ? const Text('Einen Begriff eingeben und suchen.')
                        : const CircularProgressIndicator(),
                  )
                : ListView(
                    children: [
                      for (final t in treffer)
                        ListTile(
                          title: Text('${t['title'] ?? ''}'),
                          subtitle: Text(
                            [t['artist'], t['dienst'], t['art']].where((s) => s != null && '$s'.isNotEmpty).join(' · '),
                          ),
                          // EINZELNE TITEL KANN DIE BOX NICHT AUFNEHMEN (`nurFuerListe`),
                          // und was schon da ist, zeigt sie als solches.
                          trailing: t['nurFuerListe'] == true
                              ? const Text('nur Titel')
                              : (t['schonDa'] == true || _aufgenommen.contains('${t['schluessel']}'))
                              ? const Icon(Icons.check)
                              : IconButton(
                                  icon: const Icon(Icons.add_circle_outline),
                                  tooltip: 'Aufnehmen',
                                  onPressed: _arbeitet ? null : () => _aufnehmen(t),
                                ),
                        ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}
