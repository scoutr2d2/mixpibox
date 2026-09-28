import 'package:flutter/material.dart';

import '../modell.dart';
import '../zustand.dart';
import 'dialoge.dart';
import 'versuchen.dart';

/// Box sperren (28.09.2026) — Betreiber: „handy app: box sperren". Per
/// Rueckfrage: eine ECHTE Sperre mit Ende. Die Box startet nichts mehr,
/// laufende Musik haelt an, das Kind sieht „Die Box macht Pause"; sie endet
/// von selbst oder hier. Durchgesetzt wird sie an der Box (boxsperre.ts),
/// nicht in der App — ein anderes Handy, der Taster und die Karten laufen
/// alle gegen dieselbe Wand.
///
/// IMMER MIT ENDE, hoechstens 24 h: eine vergessene Sperre soll sich selbst
/// aufheben, statt die Box fuer das Kind stumm zu lassen, waehrend niemand
/// mehr weiss, warum. Deshalb gibt es hier keinen Knopf „bis ich entsperre".
class SperrWahl {
  const SperrWahl.aufheben() : aufheben = true, minuten = null, bis = null;
  const SperrWahl.fuer(int this.minuten) : aufheben = false, bis = null;
  const SperrWahl.bis(DateTime this.bis) : aufheben = false, minuten = null;

  final bool aufheben;
  final int? minuten;
  final DateTime? bis;
}

/// Das naechste Mal, dass es [stunde]:[minute] ist — heute, wenn das noch
/// kommt, sonst morgen. „Bis 7 Uhr" um 1 Uhr nachts meint heute frueh.
DateTime naechsteUhrzeit(DateTime jetzt, int stunde, int minute) {
  final heute = DateTime(jetzt.year, jetzt.month, jetzt.day, stunde, minute);
  return heute.isAfter(jetzt) ? heute : DateTime(jetzt.year, jetzt.month, jetzt.day + 1, stunde, minute);
}

/// Die Auswahl „wie lange" als Blatt von unten. [jetzt] ist die laufende
/// Sperre, falls es eine gibt — dann steht „aufheben" oben.
Future<SperrWahl?> sperrDauerWaehlen(BuildContext context, {SperrStand? jetzt, String titel = 'Box sperren'}) {
  final gesperrt = jetzt?.aktiv == true;
  return showModalBottomSheet<SperrWahl>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (ctx) => SafeArea(
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 8),
              child: Text(gesperrt ? 'Gesperrt ${jetzt!.bisText}' : titel, style: Theme.of(ctx).textTheme.titleLarge),
            ),
            if (gesperrt)
              Padding(
                padding: const EdgeInsets.fromLTRB(24, 0, 24, 8),
                child: FilledButton.icon(
                  onPressed: () => Navigator.pop(ctx, const SperrWahl.aufheben()),
                  icon: const Icon(Icons.lock_open),
                  label: const Text('Sperre aufheben'),
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 4),
              child: Text(
                gesperrt
                    ? 'Oder neu sperren — ab jetzt:'
                    : 'Die Box startet nichts mehr, laufende Musik hält an, das Kind sieht „Die Box macht Pause". '
                          'Anhalten und leiser drehen gehen weiter.',
                style: Theme.of(ctx).textTheme.bodySmall,
              ),
            ),
            for (final (text, min) in const [
              ('15 Minuten', 15),
              ('30 Minuten', 30),
              ('1 Stunde', 60),
              ('2 Stunden', 120),
            ])
              ListTile(
                leading: const Icon(Icons.timer_outlined),
                title: Text(text),
                onTap: () => Navigator.pop(ctx, SperrWahl.fuer(min)),
              ),
            ListTile(
              leading: const Icon(Icons.bedtime_outlined),
              title: const Text('Bis morgen früh (7:00)'),
              onTap: () => Navigator.pop(ctx, SperrWahl.bis(naechsteUhrzeit(DateTime.now(), 7, 0))),
            ),
            ListTile(
              leading: const Icon(Icons.schedule),
              title: const Text('Bis … Uhr'),
              onTap: () async {
                final t = await showTimePicker(
                  context: ctx,
                  initialTime: TimeOfDay.fromDateTime(DateTime.now().add(const Duration(hours: 1))),
                  helpText: 'Gesperrt bis',
                );
                if (t == null || !ctx.mounted) return;
                Navigator.pop(ctx, SperrWahl.bis(naechsteUhrzeit(DateTime.now(), t.hour, t.minute)));
              },
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    ),
  );
}

/// Die ganze Handlung fuer EINE Box: waehlen, setzen oder aufheben, melden.
Future<void> sperrenAblauf(BuildContext context, BoxenStand stand, BoxEintrag box) async {
  final wahl = await sperrDauerWaehlen(context, jetzt: stand.lage(box.id).sperre, titel: '${box.name} sperren');
  if (wahl == null || !context.mounted) return;
  final c = stand.client(box);
  if (wahl.aufheben) {
    final ok = await mitBoxVersuchen(context, stand, box, () async {
      await c.entsperren();
      return true;
    });
    if (ok == true && context.mounted) meldung(context, '${box.name} ist wieder frei.');
  } else {
    final st = await mitBoxVersuchen(context, stand, box, () => c.sperren(minuten: wahl.minuten, bis: wahl.bis));
    if (st != null && context.mounted) meldung(context, '${box.name} ist gesperrt ${st.bisText}.');
  }
  await stand.eineAktualisieren(box);
}

/// Der Streifen oben auf „Jetzt", solange die Box gesperrt ist.
class SperrStreifen extends StatelessWidget {
  const SperrStreifen({super.key, required this.sperre, required this.aendern});
  final SperrStand sperre;
  final VoidCallback aendern;

  @override
  Widget build(BuildContext context) {
    final f = Theme.of(context).colorScheme;
    return Material(
      color: f.errorContainer,
      borderRadius: BorderRadius.circular(12),
      child: ListTile(
        leading: Icon(Icons.lock, color: f.onErrorContainer),
        title: Text('Gesperrt ${sperre.bisText}', style: TextStyle(color: f.onErrorContainer)),
        subtitle: Text('Die Box macht Pause.', style: TextStyle(color: f.onErrorContainer)),
        trailing: TextButton(onPressed: aendern, child: const Text('Ändern')),
      ),
    );
  }
}
