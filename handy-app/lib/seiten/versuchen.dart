import 'package:flutter/material.dart';

import '../box_client.dart';
import '../modell.dart';
import '../zustand.dart';
import 'dialoge.dart';
import 'koppeln.dart';

/// Einen Ruf an eine Box ausfuehren — mit allem, was dazwischenkommen kann:
/// nicht gekoppelt (koppeln, dann noch einmal), Verwaltungspasswort
/// (fragen, anmelden, noch einmal), sonst der Satz der Box als Meldung.
///
/// `null`: es ging nicht, und die Meldung steht schon da.
Future<T?> mitBoxVersuchen<T>(BuildContext context, BoxenStand stand, BoxEintrag box, Future<T> Function() tat) async {
  try {
    return await tat();
  } on KopplungNoetig {
    if (!context.mounted) return null;
    if (await koppelnAblauf(context, stand, box) && context.mounted) {
      return await mitBoxVersuchen(context, stand, box, tat);
    }
  } on AnmeldungNoetig {
    if (!context.mounted) return null;
    final pw = await passwortFragen(context, titel: 'Verwaltungspasswort der Box');
    if (pw == null || pw.isEmpty || !context.mounted) return null;
    try {
      await stand.client(box).anmelden(pw);
      if (context.mounted) return await mitBoxVersuchen(context, stand, box, tat);
    } on BoxFehler catch (e) {
      if (context.mounted) meldung(context, e.satz);
    }
  } on BoxFehler catch (e) {
    if (context.mounted) meldung(context, e.satz);
  }
  return null;
}
