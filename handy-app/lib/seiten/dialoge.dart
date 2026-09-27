import 'package:flutter/material.dart';

/// Fragt ein Passwort ab. `null` heisst abgebrochen.
Future<String?> passwortFragen(BuildContext context, {required String titel, String? hinweis, bool nurZahlen = false}) {
  final feld = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(titel),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (hinweis != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(hinweis)),
          TextField(
            controller: feld,
            autofocus: true,
            obscureText: true,
            keyboardType: nurZahlen ? TextInputType.number : TextInputType.visiblePassword,
            decoration: const InputDecoration(labelText: 'Passwort'),
            onSubmitted: (v) => Navigator.pop(ctx, v),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Abbrechen')),
        FilledButton(onPressed: () => Navigator.pop(ctx, feld.text), child: const Text('OK')),
      ],
    ),
  );
}

void meldung(BuildContext context, String text) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));
}
