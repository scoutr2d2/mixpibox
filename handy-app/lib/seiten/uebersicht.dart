import 'package:flutter/material.dart';

import '../box_client.dart';
import '../modell.dart';
import '../zustand.dart';
import 'box_bearbeiten.dart';
import 'box_seite.dart';
import 'dialoge.dart';

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
                  children: [for (final b in stand.boxen) _BoxKarte(stand: stand, box: b)],
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
      _ when lage.anmeldungNoetig => 'Anmeldung nötig — antippen',
      _ when w == null => lage.fehler ?? 'wird gefragt …',
      _ when !w.spielt => 'still',
      _ => [w.titel, w.album].where((s) => s.isNotEmpty).join(' · '),
    };
    return Card(
      child: ListTile(
        leading: Icon(
          w == null ? Icons.cloud_off : (w.hoerbar ? Icons.graphic_eq : Icons.speaker),
          color: w == null ? Theme.of(context).colorScheme.error : null,
        ),
        title: Text(box.name),
        subtitle: Text(
          [if (lage.profilName != null) '👤 ${lage.profilName}', zeile].join('\n'),
          maxLines: 3,
          overflow: TextOverflow.ellipsis,
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
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => BoxSeite(stand: stand, box: box)),
        ),
      ),
    );
  }
}

/// Die Befehle fuer ALLE Boxen — der Grund, warum es diese App gibt: „alle
/// still" zur Schlafenszeit, ohne durch jedes Kinderzimmer zu gehen.
class _AlleMenue extends StatelessWidget {
  const _AlleMenue({required this.stand});
  final BoxenStand stand;

  Future<void> _ausfuehren(BuildContext context, String was, Future<void> Function(BoxClient) tat) async {
    final fehler = await stand.anAlle(tat);
    if (!context.mounted) return;
    meldung(
      context,
      fehler.isEmpty ? '$was: alle Boxen.' : '$was — nicht bei: ${fehler.entries.map((e) => '${e.key} (${e.value})').join(', ')}',
    );
  }

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
