import 'dart:io';

import 'package:flutter/material.dart';

import '../ablage.dart';

import '../box_client.dart';
import '../modell.dart';
import '../zustand.dart';
import 'box_bearbeiten.dart';
import 'dialoge.dart';
import 'figur.dart';
import 'koppeln.dart';
import 'medien_seite.dart';

/// Eine Box im Einzelnen: Jetzt · Profile · Mediathek.
class BoxSeite extends StatefulWidget {
  const BoxSeite({super.key, required this.stand, required this.box, this.ablage = const Ablage()});
  final BoxenStand stand;
  final BoxEintrag box;

  /// Wohin Heruntergeladenes kommt. Austauschbar, damit Tests ohne Android
  /// auskommen.
  final Ablage ablage;

  @override
  State<BoxSeite> createState() => _BoxSeiteState();
}

class _BoxSeiteState extends State<BoxSeite> {
  BoxClient get c => widget.stand.client(widget.box);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _anmeldenFallsNoetig());
  }

  Future<void> _anmeldenFallsNoetig() async {
    if (!widget.stand.lage(widget.box.id).anmeldungNoetig) return;
    await anmelden();
  }

  /// Fragt das Verwaltungspasswort und meldet an. true = angemeldet.
  Future<bool> anmelden() async {
    final pw = await passwortFragen(
      context,
      titel: 'Anmelden bei ${widget.box.name}',
      hinweis: 'Das Passwort der Verwaltung dieser Box. Die App merkt sich nur die Sitzung (12 h), nicht das Passwort.',
    );
    if (pw == null) return false;
    try {
      await c.anmelden(pw);
      await widget.stand.eineAktualisieren(widget.box);
      return true;
    } on BoxFehler catch (e) {
      if (mounted) meldung(context, e.satz);
      return false;
    }
  }

  /// Fuehrt `tat` aus; verlangt die Box eine Anmeldung, einmal anmelden und
  /// wiederholen. Fehler landen als Meldung unten.
  Future<T?> versuchen<T>(Future<T> Function() tat) async {
    try {
      return await tat();
    } on KopplungNoetig {
      if (!mounted) return null;
      if (await koppelnAblauf(context, widget.stand, widget.box)) return versuchen(tat);
    } on AnmeldungNoetig {
      if (!mounted) return null;
      if (await anmelden()) return versuchen(tat);
    } on BoxFehler catch (e) {
      if (mounted) meldung(context, e.satz);
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: Text(widget.box.name),
          actions: [
            IconButton(
              icon: const Icon(Icons.library_add),
              tooltip: 'Medien verwalten',
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => MedienSeite(stand: widget.stand, box: widget.box)),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.settings),
              tooltip: 'Box bearbeiten',
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => BoxBearbeitenSeite(stand: widget.stand, box: widget.box)),
              ),
            ),
          ],
          bottom: const TabBar(
            tabs: [
              Tab(icon: Icon(Icons.music_note), text: 'Jetzt'),
              Tab(icon: Icon(Icons.people), text: 'Profile'),
              Tab(icon: Icon(Icons.library_music), text: 'Mediathek'),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            _JetztTab(seite: this),
            _ProfileTab(seite: this),
            _MediathekTab(seite: this),
          ],
        ),
      ),
    );
  }
}

// ── Jetzt ───────────────────────────────────────────────────────────────

class _JetztTab extends StatefulWidget {
  const _JetztTab({required this.seite});
  final _BoxSeiteState seite;
  @override
  State<_JetztTab> createState() => _JetztTabState();
}

class _JetztTabState extends State<_JetztTab> {
  /// Waehrend der Finger auf dem Regler liegt, gewinnt der Finger — nicht der
  /// naechste Takt, der noch den alten Wert meldet.
  double? _reglerWert;

  @override
  Widget build(BuildContext context) {
    final s = widget.seite;
    return ListenableBuilder(
      listenable: s.widget.stand,
      builder: (context, _) {
        final lage = s.widget.stand.lage(s.widget.box.id);
        final w = lage.wiedergabe;
        if (w == null) {
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(lage.fehler ?? 'wird gefragt …', textAlign: TextAlign.center),
                if (lage.anmeldungNoetig)
                  Padding(
                    padding: const EdgeInsets.only(top: 16),
                    child: FilledButton(onPressed: s.anmelden, child: const Text('Anmelden')),
                  ),
              ],
            ),
          );
        }
        final c = s.c;
        // DIE FESTE ADRESSE DES ALBUMS, nicht `laufend` mit Zaehler — siehe
        // `BoxClient.coverZiel`. Sie wechselt genau mit dem Album, also
        // wechselt das Bild genau dann, und nicht einen Titel zu spaet.
        final coverPfad = lage.coverPfad;
        final cover = AspectRatio(
          aspectRatio: 1,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: w.spielt && coverPfad != null
                ? Image.network(
                    c.bildAdresse(coverPfad).toString(),
                    headers: c.bildKopf,
                    fit: BoxFit.cover,
                    gaplessPlayback: true,
                    errorBuilder: (_, _, _) => const _CoverLeer(),
                  )
                : const _CoverLeer(),
          ),
        );
        final steuerung = <Widget>[
            Text(
              w.spielt ? (w.titel.isEmpty ? '—' : w.titel) : 'Es spielt gerade nichts.',
              style: Theme.of(context).textTheme.titleLarge,
              textAlign: TextAlign.center,
            ),
            if (w.spielt)
              Text(
                [w.interpret, w.album].where((x) => x.isNotEmpty).join(' · '),
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            if (w.spielt && w.titelGesamt > 1)
              Text('Titel ${w.titelNr} von ${w.titelGesamt}', textAlign: TextAlign.center),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                IconButton(iconSize: 36, icon: const Icon(Icons.skip_previous), onPressed: () => _befehl('previous')),
                IconButton(iconSize: 36, icon: const Icon(Icons.replay_30), onPressed: () => _befehl('seek-30')),
                IconButton.filled(
                  iconSize: 48,
                  icon: Icon(w.hoerbar ? Icons.pause : Icons.play_arrow),
                  onPressed: () => _befehl(w.hoerbar ? 'pause' : 'play'),
                ),
                IconButton(iconSize: 36, icon: const Icon(Icons.forward_30), onPressed: () => _befehl('seek+30')),
                IconButton(iconSize: 36, icon: const Icon(Icons.skip_next), onPressed: () => _befehl('next')),
              ],
            ),
            Center(
              child: TextButton.icon(onPressed: () => _befehl('stop'), icon: const Icon(Icons.stop), label: const Text('Stopp')),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.volume_down),
                Expanded(
                  child: Slider(
                    value: _reglerWert ?? w.lautstaerke.toDouble(),
                    max: 100,
                    divisions: 20,
                    label: '${(_reglerWert ?? w.lautstaerke).round()}',
                    onChanged: (v) => setState(() => _reglerWert = v),
                    onChangeEnd: (v) async {
                      await s.versuchen(() => c.lautstaerke(v.round()));
                      await s.widget.stand.eineAktualisieren(s.widget.box);
                      if (mounted) setState(() => _reglerWert = null);
                    },
                  ),
                ),
                const Icon(Icons.volume_up),
              ],
            ),
        ];
        // QUERFORMAT (27.09.2026, am Handy gesehen): Hochkant stehen Cover und
        // Knoepfe untereinander. Quer waere das quadratische Cover so breit wie
        // der Schirm — also hoeher als er, und alle Knoepfe laegen unter dem
        // Rand. Dann nebeneinander: links das Cover, so hoch wie Platz ist,
        // rechts Titel, Knoepfe und Lautstaerke, bei Bedarf scrollbar.
        return LayoutBuilder(
          builder: (context, platz) {
            if (platz.maxWidth > platz.maxHeight) {
              final seite = (platz.maxHeight - 32).clamp(0.0, platz.maxWidth / 2);
              return Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    SizedBox.square(dimension: seite, child: cover),
                    const SizedBox(width: 24),
                    Expanded(child: ListView(children: steuerung)),
                  ],
                ),
              );
            }
            return ListView(
              padding: const EdgeInsets.all(24),
              children: [cover, const SizedBox(height: 20), ...steuerung],
            );
          },
        );
      },
    );
  }

  Future<void> _befehl(String b) async {
    final s = widget.seite;
    await s.versuchen(() => s.c.befehl(b));
    await s.widget.stand.eineAktualisieren(s.widget.box);
  }
}

class _CoverLeer extends StatelessWidget {
  const _CoverLeer();
  @override
  Widget build(BuildContext context) => ColoredBox(
    color: Theme.of(context).colorScheme.surfaceContainerHighest,
    child: const Center(child: Icon(Icons.music_note, size: 96)),
  );
}

// ── Profile ─────────────────────────────────────────────────────────────

class _ProfileTab extends StatefulWidget {
  const _ProfileTab({required this.seite});
  final _BoxSeiteState seite;
  @override
  State<_ProfileTab> createState() => _ProfileTabState();
}

class _ProfileTabState extends State<_ProfileTab> {
  Future<ProfilStand?>? _laden;

  @override
  void initState() {
    super.initState();
    _neu();
  }

  // IN GESCHWEIFTEN KLAMMERN: `setState(() => _laden = …)` gaebe den Wert der
  // Zuweisung zurueck, also ein Future — und das weist setState mit einer
  // Ausnahme ab (am 27.09.2026 auf dem Handy bei jedem Oeffnen der Box).
  void _neu() => setState(() {
    _laden = widget.seite.versuchen(widget.seite.c.profile);
  });

  Future<void> _wechseln(KindProfil p, ProfilStand stand) async {
    final s = widget.seite;
    String? pw;
    if (p.geschuetzt && p.kennung != stand.aktiv) {
      if (!p.perTastaturEingebbar) {
        meldung(context, '${p.name} hat ein Bild-/Farb-/Musterpasswort — das geht nur am Schirm der Box.');
        return;
      }
      pw = await passwortFragen(context, titel: 'Passwort für ${p.name}', nurZahlen: p.passwortArt == 'zahlen');
      if (pw == null) return;
    }
    await s.versuchen(() => s.c.profilWechseln(p.kennung, passwort: pw));
    await s.widget.stand.eineAktualisieren(s.widget.box);
    _neu();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<ProfilStand?>(
      future: _laden,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
        final stand = snap.data;
        if (stand == null) {
          return Center(child: TextButton(onPressed: _neu, child: const Text('Noch einmal versuchen')));
        }
        return RefreshIndicator(
          onRefresh: () async => _neu(),
          child: ListView(
            children: [
              for (final p in stand.profile)
                ListTile(
                  leading: FigurBild(client: widget.seite.c, figur: p.figur, groesse: 44, aktiv: p.kennung == stand.aktiv),
                  title: Text(p.name),
                  subtitle: p.kennung == stand.aktiv ? const Text('ist gerade an der Box') : null,
                  trailing: p.geschuetzt ? const Icon(Icons.lock_outline) : null,
                  onTap: () => _wechseln(p, stand),
                ),
            ],
          ),
        );
      },
    );
  }
}

// ── Mediathek ───────────────────────────────────────────────────────────

class _MediathekTab extends StatefulWidget {
  const _MediathekTab({required this.seite});
  final _BoxSeiteState seite;
  @override
  State<_MediathekTab> createState() => _MediathekTabState();
}

class _MediathekTabState extends State<_MediathekTab> {
  Future<List<Werk>?>? _laden;
  String _filter = '';

  /// Nur zeigen, was als Ordner auf der Box liegt (und sich holen laesst).
  bool _nurLokal = false;

  /// Laufende Downloads: Schluessel → bisher geschriebene Bytes.
  final Map<String, int> _laedt = {};

  @override
  void initState() {
    super.initState();
    _neu();
  }

  // Geschweifte Klammern aus demselben Grund wie im Profil-Reiter.
  void _neu() => setState(() {
    _laden = widget.seite.versuchen(widget.seite.c.werke);
  });

  static String _mb(int bytes) => '${(bytes / (1024 * 1024)).toStringAsFixed(1).replaceAll('.', ',')} MB';

  /// Ein lokales Werk als ZIP holen: erst in den Zwischenordner, dann in
  /// einem Rutsch nach Download/MixPiBox. Bricht es ab, bleibt keine halbe
  /// Datei im Download-Ordner liegen.
  Future<void> _herunterladen(Werk w) async {
    final s = widget.seite;
    if (_laedt.containsKey(w.schluessel)) return;
    setState(() {
      _laedt[w.schluessel] = 0;
    });
    File? zwischen;
    var zuletzt = 0;
    try {
      zwischen = await s.widget.ablage.zwischenDatei();
      final ziel = zwischen;
      final name = await s.versuchen(
        () => s.c.herunterladen(
          w.schluessel,
          ziel,
          fortschritt: (b) {
            // Nicht fuer jedes Paket neu zeichnen — alle 256 KB reicht.
            if (b - zuletzt < 256 * 1024 || !mounted) return;
            zuletzt = b;
            setState(() {
              _laedt[w.schluessel] = b;
            });
          },
        ),
      );
      if (name == null) return; // versuchen() hat den Grund schon gemeldet
      final ort = await s.widget.ablage.inDownloads(ziel, name);
      zwischen = null; // gehoert jetzt dem Download-Ordner
      if (mounted) meldung(context, 'Gespeichert: $ort');
    } catch (e) {
      if (mounted) meldung(context, 'Speichern ging nicht: $e');
    } finally {
      if (zwischen != null && await zwischen.exists()) await zwischen.delete();
      if (mounted) {
        setState(() {
          _laedt.remove(w.schluessel);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.seite;
    return FutureBuilder<List<Werk>?>(
      future: _laden,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
        final alle = snap.data;
        if (alle == null) {
          return Center(child: TextButton(onPressed: _neu, child: const Text('Noch einmal versuchen')));
        }
        final f = _filter.toLowerCase();
        final liste = alle
            .where((w) => !_nurLokal || w.lokal)
            .where((w) => f.isEmpty || w.titel.toLowerCase().contains(f) || w.interpret.toLowerCase().contains(f))
            .toList();
        final lokalZahl = alle.where((w) => w.lokal).length;
        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
              child: TextField(
                decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Suchen', isDense: true),
                onChanged: (v) => setState(() => _filter = v),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Row(
                children: [
                  FilterChip(
                    label: Text('Auf der Box ($lokalZahl)'),
                    selected: _nurLokal,
                    onSelected: (v) => setState(() => _nurLokal = v),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(
                'Zeigt, was das Kind an der Box gerade sehen darf. '
                'Was auf der Box liegt, holt der Pfeil als ZIP nach Download/MixPiBox.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () async => _neu(),
                child: ListView.builder(
                  itemCount: liste.length,
                  itemBuilder: (context, i) {
                    final w = liste[i];
                    return ListTile(
                      leading: ClipRRect(
                        borderRadius: BorderRadius.circular(6),
                        child: SizedBox(
                          width: 48,
                          height: 48,
                          child: w.bild.isEmpty
                              ? const _CoverLeer()
                              : Image.network(
                                  s.c.bildAdresse(w.bild).toString(),
                                  headers: s.c.bildKopf,
                                  fit: BoxFit.cover,
                                  cacheWidth: 144,
                                  errorBuilder: (_, _, _) => const _CoverLeer(),
                                ),
                        ),
                      ),
                      title: Text(w.titel),
                      subtitle: _laedt.containsKey(w.schluessel)
                          ? Text('lädt … ${_mb(_laedt[w.schluessel]!)}')
                          : (w.interpret.isEmpty ? null : Text(w.interpret)),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (w.lokal)
                            _laedt.containsKey(w.schluessel)
                                ? const Padding(
                                    padding: EdgeInsets.all(12),
                                    child: SizedBox.square(
                                      dimension: 24,
                                      child: CircularProgressIndicator(strokeWidth: 2),
                                    ),
                                  )
                                : IconButton(
                                    icon: const Icon(Icons.download),
                                    tooltip: 'Herunterladen',
                                    onPressed: () => _herunterladen(w),
                                  ),
                          const Icon(Icons.play_arrow),
                        ],
                      ),
                      onTap: () async {
                        await s.versuchen(() => s.c.spielen(w.schluessel));
                        await s.widget.stand.eineAktualisieren(s.widget.box);
                        if (context.mounted) DefaultTabController.of(context).animateTo(0);
                      },
                    );
                  },
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}
