import 'package:flutter/material.dart';

import '../box_client.dart';
import '../modell.dart';
import '../zustand.dart';
import 'box_bearbeiten.dart';
import 'box_seite.dart';
import 'dialoge.dart';
import 'figur.dart';
import 'koppeln.dart';

/// Startseite: alle Boxen untereinander, oben die Befehle fuer alle.
class UebersichtSeite extends StatelessWidget {
  const UebersichtSeite({super.key, required this.stand});
  final BoxenStand stand;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: stand,
      builder: (context, _) => Scaffold(
        appBar: AppBar(
          title: const Text('MixPiBox'),
          actions: [if (stand.boxen.length > 1) _AlleMenue(stand: stand)],
        ),
        body: !stand.geladen
            ? const Center(child: CircularProgressIndicator())
            : stand.boxen.isEmpty
            ? const _Leer()
            : RefreshIndicator(
                onRefresh: stand.aktualisieren,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 96),
                  children: [
                    if (stand.boxen.length > 1) _AlleKarte(stand: stand),
                    for (final b in stand.boxen) _BoxKarte(stand: stand, box: b),
                  ],
                ),
              ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: () => Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => BoxBearbeitenSeite(stand: stand)),
          ),
          icon: const Icon(Icons.add),
          label: const Text('Box hinzufügen'),
        ),
      ),
    );
  }
}

class _Leer extends StatelessWidget {
  const _Leer();
  @override
  Widget build(BuildContext context) => const Center(
    child: Padding(
      padding: EdgeInsets.all(32),
      child: Text(
        'Noch keine Box.\n\nTippe auf „Box hinzufügen" — die App sucht im WLAN, '
        'oder du gibst Name (z. B. mixpibox.local) oder IP von Hand ein.',
        textAlign: TextAlign.center,
      ),
    ),
  );
}

class _BoxKarte extends StatelessWidget {
  const _BoxKarte({required this.stand, required this.box});
  final BoxenStand stand;
  final BoxEintrag box;

  @override
  Widget build(BuildContext context) {
    final lage = stand.lage(box.id);
    final w = lage.wiedergabe;
    final zeile = switch (lage) {
      _ when lage.kopplungNoetig => 'Nicht gekoppelt — antippen',
      _ when lage.anmeldungNoetig => 'Anmeldung nötig — antippen',
      _ when w == null => lage.fehler ?? 'wird gefragt …',
      _ when !w.spielt => 'still',
      _ => [w.titel, w.album].where((s) => s.isNotEmpty).join(' · '),
    };
    final c = stand.client(box);
    final coverPfad = lage.coverPfad;
    final zeichen = Icon(
      w == null ? Icons.cloud_off : (w.hoerbar ? Icons.graphic_eq : Icons.speaker),
      color: w == null ? Theme.of(context).colorScheme.error : null,
    );
    return Card(
      child: Column(
        children: [
          ListTile(
            // DAS KLEINE ALBUMBILD — dieselbe feste Adresse wie auf der Box-Seite
            // (`coverPfad`), also wechselt es mit dem Album und nicht spaeter.
            leading: w != null && w.spielt && coverPfad != null
                ? ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Image.network(
                      c.bildAdresse(coverPfad).toString(),
                      headers: c.bildKopf,
                      width: 56,
                      height: 56,
                      fit: BoxFit.cover,
                      gaplessPlayback: true,
                      errorBuilder: (_, _, _) => SizedBox.square(dimension: 56, child: zeichen),
                    ),
                  )
                : SizedBox.square(dimension: 56, child: zeichen),
            title: Text(box.name),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (lage.profilName != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    child: Row(
                      children: [
                        FigurBild(client: stand.client(box), figur: lage.profilFigur, groesse: 22),
                        const SizedBox(width: 6),
                        Flexible(child: Text(lage.profilName!, overflow: TextOverflow.ellipsis)),
                      ],
                    ),
                  ),
                Text(zeile, maxLines: 2, overflow: TextOverflow.ellipsis),
              ],
            ),
            isThreeLine: lage.profilName != null,
            trailing: w == null || !w.spielt
                ? null
                : IconButton(
                    iconSize: 32,
                    icon: Icon(w.hoerbar ? Icons.pause_circle : Icons.play_circle),
                    onPressed: () async {
                      try {
                        await stand.client(box).befehl(w.hoerbar ? 'pause' : 'play');
                      } on BoxFehler catch (e) {
                        if (context.mounted) meldung(context, e.satz);
                      }
                      await stand.eineAktualisieren(box);
                    },
                  ),
            onTap: () async {
              // NICHT GEKOPPELT HEISST: ERST KOPPELN. Die Box-Seite wuerde sonst
              // mit drei Reitern voller „nicht gekoppelt" aufgehen.
              if (lage.kopplungNoetig && !await koppelnAblauf(context, stand, box)) return;
              if (!context.mounted) return;
              await Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => BoxSeite(stand: stand, box: box),
                ),
              );
            },
          ),
          if (w != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 4),
              child: Lautstaerke(
                wert: w.lautstaerke,
                beschriftung: 'Lautstärke ${box.name}',
                stellen: (v) async {
                  try {
                    await c.lautstaerke(v);
                  } on BoxFehler catch (e) {
                    if (context.mounted) meldung(context, e.satz);
                  }
                  await stand.eineAktualisieren(box);
                },
              ),
            ),
        ],
      ),
    );
  }
}

/// Denselben Befehl an alle Boxen — und sagen, welche NICHT mitgemacht haben.
Future<void> _anAlleMelden(
  BuildContext context,
  BoxenStand stand,
  String was,
  Future<void> Function(BoxClient) tat,
) async {
  final fehler = await stand.anAlle(tat);
  if (!context.mounted) return;
  meldung(
    context,
    fehler.isEmpty ? '$was: alle Boxen.' : '$was — nicht bei: ${fehler.entries.map((e) => '${e.key} (${e.value})').join(', ')}',
  );
}

/// Oben, sobald es mehr als eine Box gibt: ALLE PAUSIEREN und ein Regler fuer
/// alle (Betreiber 27.09.2026: „gerade wenn man mehere boxen hat ist es
/// praktisch schnell die lautstärke zu verringern").
///
/// DER REGLER STEHT AUF DER LAUTESTEN BOX und setzt beim Loslassen ALLE auf
/// seinen Wert. Wer ihn herunterzieht, macht so jede Box mindestens so leise;
/// ein Mittelwert haette die laute Box beim leichten Ziehen noch lauter
/// gelassen als die Anzeige verspricht.
class _AlleKarte extends StatelessWidget {
  const _AlleKarte({required this.stand});
  final BoxenStand stand;

  Future<void> _ausfuehren(BuildContext context, String was, Future<void> Function(BoxClient) tat) =>
      _anAlleMelden(context, stand, was, tat);

  @override
  Widget build(BuildContext context) {
    final lagen = [for (final b in stand.boxen) stand.lage(b.id).wiedergabe].nonNulls.toList();
    final lauteste = lagen.isEmpty ? 0 : lagen.map((w) => w.lautstaerke).reduce((a, b) => a > b ? a : b);
    return Card(
      color: Theme.of(context).colorScheme.secondaryContainer,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 8, 4),
        child: Column(
          children: [
            Row(
              children: [
                const Icon(Icons.speaker_group),
                const SizedBox(width: 12),
                Expanded(child: Text('Alle Boxen', style: Theme.of(context).textTheme.titleMedium)),
                FilledButton.icon(
                  onPressed: lagen.isEmpty ? null : () => _ausfuehren(context, 'Pause', (c) => c.befehl('pause')),
                  icon: const Icon(Icons.pause),
                  label: const Text('Alle pausieren'),
                ),
              ],
            ),
            Lautstaerke(
              wert: lauteste,
              beschriftung: 'Lautstärke aller Boxen',
              stellen: lagen.isEmpty ? null : (v) => _ausfuehren(context, 'Lautstärke $v', (c) => c.lautstaerke(v)),
            ),
          ],
        ),
      ),
    );
  }
}

/// Ein Lautstaerke-Regler, der erst beim LOSLASSEN schickt. Waehrend der
/// Finger darauf liegt, gewinnt der Finger — nicht der naechste Takt, der
/// noch den alten Wert meldet.
class Lautstaerke extends StatefulWidget {
  const Lautstaerke({super.key, required this.wert, required this.stellen, required this.beschriftung});
  final int wert;
  final String beschriftung;

  /// null: gesperrt (keine Box erreichbar).
  final Future<void> Function(int)? stellen;

  @override
  State<Lautstaerke> createState() => _LautstaerkeState();
}

class _LautstaerkeState extends State<Lautstaerke> {
  double? _finger;

  @override
  Widget build(BuildContext context) {
    final stellen = widget.stellen;
    return Row(
      children: [
        const Icon(Icons.volume_down, size: 20),
        Expanded(
          child: Semantics(
            label: widget.beschriftung,
            child: Slider(
              value: _finger ?? widget.wert.toDouble(),
              max: 100,
              divisions: 20,
              label: '${(_finger ?? widget.wert).round()}',
              onChanged: stellen == null ? null : (v) => setState(() => _finger = v),
              onChangeEnd: stellen == null
                  ? null
                  : (v) async {
                      await stellen(v.round());
                      if (mounted) setState(() => _finger = null);
                    },
            ),
          ),
        ),
        const Icon(Icons.volume_up, size: 20),
      ],
    );
  }
}

/// Die Befehle fuer ALLE Boxen — der Grund, warum es diese App gibt: „alle
/// still" zur Schlafenszeit, ohne durch jedes Kinderzimmer zu gehen.
class _AlleMenue extends StatelessWidget {
  const _AlleMenue({required this.stand});
  final BoxenStand stand;

  Future<void> _ausfuehren(BuildContext context, String was, Future<void> Function(BoxClient) tat) =>
      _anAlleMelden(context, stand, was, tat);

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      icon: const Icon(Icons.speaker_group),
      tooltip: 'Alle Boxen',
      onSelected: (w) async {
        switch (w) {
          case 'pause':
            await _ausfuehren(context, 'Pause', (c) => c.befehl('pause'));
          case 'stop':
            await _ausfuehren(context, 'Stopp', (c) => c.befehl('stop'));
          case 'leiser':
            await _ausfuehren(context, 'Leiser', (c) => c.befehl('-5'));
          case 'lauter':
            await _ausfuehren(context, 'Lauter', (c) => c.befehl('+5'));
          case 'profil':
            if (context.mounted) await _profilFuerAlle(context);
        }
      },
      itemBuilder: (_) => const [
        PopupMenuItem(value: 'pause', child: ListTile(leading: Icon(Icons.pause), title: Text('Alle pausieren'))),
        PopupMenuItem(value: 'stop', child: ListTile(leading: Icon(Icons.stop), title: Text('Alle stoppen'))),
        PopupMenuItem(value: 'leiser', child: ListTile(leading: Icon(Icons.volume_down), title: Text('Alle leiser'))),
        PopupMenuItem(value: 'lauter', child: ListTile(leading: Icon(Icons.volume_up), title: Text('Alle lauter'))),
        PopupMenuItem(value: 'profil', child: ListTile(leading: Icon(Icons.person), title: Text('Profil auf allen Boxen …'))),
      ],
    );
  }

  /// Ein Kind auf allen Boxen anmelden, auf denen es ein Profil gleichen
  /// Namens hat. Geschuetzte Profile fragen einmal nach dem Passwort und
  /// probieren es auf jeder Box.
  Future<void> _profilFuerAlle(BuildContext context) async {
    final alle = await stand.profileUeberAlle();
    if (!context.mounted) return;
    if (alle.isEmpty) {
      meldung(context, 'Keine Box hat Profile geliefert.');
      return;
    }
    final namen = alle.keys.toList()..sort();
    final wahl = await showDialog<String>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('Profil auf allen Boxen'),
        children: [
          for (final n in namen)
            SimpleDialogOption(
              onPressed: () => Navigator.pop(ctx, n),
              child: Text('${alle[n]!.values.first.name}  (${alle[n]!.length} von ${stand.boxen.length} Boxen)'),
            ),
        ],
      ),
    );
    if (wahl == null || !context.mounted) return;
    final ziele = alle[wahl]!;
    String? passwort;
    if (ziele.values.any((p) => p.geschuetzt)) {
      passwort = await passwortFragen(context, titel: 'Passwort für ${ziele.values.first.name}');
      if (passwort == null || !context.mounted) return;
    }
    final fehler = <String>[];
    await Future.wait(
      ziele.entries.map((e) async {
        try {
          await stand.client(e.key).profilWechseln(e.value.kennung, passwort: e.value.geschuetzt ? passwort : null);
        } on BoxFehler catch (f) {
          fehler.add('${e.key.name} (${f.satz})');
        }
      }),
    );
    await stand.aktualisieren();
    if (context.mounted) {
      meldung(context, fehler.isEmpty ? 'Gewechselt.' : 'Nicht gewechselt: ${fehler.join(', ')}');
    }
  }
}
