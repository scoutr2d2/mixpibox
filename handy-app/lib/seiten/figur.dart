import 'package:flutter/material.dart';

import '../box_client.dart';

/// Das Bild eines Kindes, rund — oder ein Personenzeichen, wenn es keins
/// gibt oder es nicht laedt. Ein fehlendes Bild zerbricht nichts.
class FigurBild extends StatelessWidget {
  const FigurBild({super.key, required this.client, required this.figur, this.groesse = 40, this.aktiv = false});

  final BoxClient client;
  final String figur;
  final double groesse;

  /// Das Kind, das gerade an der Box ist, bekommt einen Ring.
  final bool aktiv;

  @override
  Widget build(BuildContext context) {
    final farben = Theme.of(context).colorScheme;
    final adresse = client.figurAdresse(figur);
    final ersatz = ColoredBox(
      color: farben.surfaceContainerHighest,
      child: Icon(Icons.person, size: groesse * 0.6),
    );
    return Container(
      width: groesse,
      height: groesse,
      padding: EdgeInsets.all(aktiv ? 2 : 0),
      decoration: aktiv ? BoxDecoration(shape: BoxShape.circle, border: Border.all(color: farben.primary, width: 2)) : null,
      child: ClipOval(
        child: adresse == null
            ? ersatz
            : Image.network(
                adresse.toString(),
                headers: client.bildKopf,
                fit: BoxFit.cover,
                cacheWidth: (groesse * 3).round(),
                errorBuilder: (_, _, _) => ersatz,
              ),
      ),
    );
  }
}
