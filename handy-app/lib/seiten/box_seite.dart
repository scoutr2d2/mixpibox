import 'package:flutter/material.dart';

import '../box_client.dart';
import '../modell.dart';
import '../zustand.dart';
import 'box_bearbeiten.dart';
import 'dialoge.dart';

/// Eine Box im Einzelnen: Jetzt · Profile · Mediathek.
class BoxSeite extends StatefulWidget {
  const BoxSeite({super.key, required this.stand, required this.box});
  final BoxenStand stand;
  final BoxEintrag box;

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
  int _coverStand = 0;
  String _letzterTitel = '';

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
        // Neues Stueck → Cover neu laden (die Adresse bleibt dieselbe).
        if (w.titel != _letzterTitel) {
          _letzterTitel = w.titel;
          _coverStand++;
        }
        final c = s.c;
        final coverUri = c.coverAdresse().replace(queryParameters: {'v': '$_coverStand'});
        return ListView(
          padding: const EdgeInsets.all(24),
          children: [
            AspectRatio(
              aspectRatio: 1,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(16),
                child: w.spielt
                    ? Image.network(
                        coverUri.toString(),
                        headers: c.bildKopf,
                        fit: BoxFit.cover,
                        gaplessPlayback: true,
                        errorBuilder: (_, _, _) => const _CoverLeer(),
                      )
                    : const _CoverLeer(),
              ),
            ),
            const SizedBox(height: 20),
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
          ],
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

  void _neu() => setState(() => _laden = widget.seite.versuchen(widget.seite.c.profile));

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
                  leading: Icon(p.kennung == stand.aktiv ? Icons.radio_button_checked : Icons.radio_button_unchecked),
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

  @override
  void initState() {
    super.initState();
    _neu();
  }

  void _neu() => setState(() => _laden = widget.seite.versuchen(widget.seite.c.werke));

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
        final liste = f.isEmpty
            ? alle
            : alle.where((w) => w.titel.toLowerCase().contains(f) || w.interpret.toLowerCase().contains(f)).toList();
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
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(
                'Zeigt, was das Kind an der Box gerade sehen darf.',
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
                      subtitle: w.interpret.isEmpty ? null : Text(w.interpret),
                      trailing: const Icon(Icons.play_arrow),
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
