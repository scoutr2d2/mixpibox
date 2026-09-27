import 'package:flutter/material.dart';

import '../modell.dart';
import '../zustand.dart';
import 'medien_seite.dart';
import 'versuchen.dart';

/// Ein geteilter Link (27.09.2026): welche Box — dann die Treffer, die die
/// Box aus dem Link macht, zum Hinzufügen in die Bibliothek.
///
/// Betreiber: Links zu Alben, Titeln und Interpreten an die Box senden
/// können, damit sie in die Bibliothek kommen.
/// Hinzugefügt wird wie in „Medien verwalten" (dieselbe Seite, mit „Aufnehmen
/// als" und der Freigabe fuer Kinder mit eigener Auswahl).
class TeilenSeite extends StatelessWidget {
  const TeilenSeite({super.key, required this.stand, required this.text});
  final BoxenStand stand;
  final String text;

  @override
  Widget build(BuildContext context) {
    if (stand.boxen.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: const Text('Geteilter Link')),
        body: const Padding(padding: EdgeInsets.all(24), child: Text('Erst eine Box hinzufügen, dann noch einmal teilen.')),
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Auf welche Box?')),
      body: ListView(
        children: [
          for (final b in stand.boxen)
            ListTile(
              leading: const Icon(Icons.speaker),
              title: Text(b.name),
              subtitle: Text(b.adresse),
              onTap: () => zurBox(context, stand, b, text, ersetzen: true),
            ),
        ],
      ),
    );
  }

  /// Direkt die Treffer einer Box — bei nur EINER Box ohne die Frage davor.
  static Future<void> zurBox(
    BuildContext context,
    BoxenStand stand,
    BoxEintrag box,
    String text, {
    bool ersetzen = false,
  }) async {
    Future<T?> versuchen<T>(Future<T> Function() tat) => mitBoxVersuchen(context, stand, box, tat);
    final auswahlen = await versuchen(stand.client(box).auswahlen) ?? const <ProfilAuswahl>[];
    if (!context.mounted) return;
    final seite = MaterialPageRoute<void>(
      builder: (_) => MedienSuchSeite(
        client: stand.client(box),
        versuchen: versuchen,
        auswahlen: auswahlen,
        titel: 'Geteilt an ${box.name}',
        vorgabe: () => stand.client(box).medienAusLink(text),
      ),
    );
    if (ersetzen) {
      await Navigator.pushReplacement(context, seite);
    } else {
      await Navigator.push(context, seite);
    }
  }
}
