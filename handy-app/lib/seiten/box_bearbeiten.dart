import 'dart:math';

import 'package:flutter/material.dart';

import '../box_client.dart';
import '../modell.dart';
import '../netzsuche.dart';
import '../zustand.dart';
import 'dialoge.dart';

/// Box hinzufuegen (ohne `box`) oder bearbeiten (mit).
class BoxBearbeitenSeite extends StatefulWidget {
  const BoxBearbeitenSeite({super.key, required this.stand, this.box});
  final BoxenStand stand;
  final BoxEintrag? box;

  @override
  State<BoxBearbeitenSeite> createState() => _BoxBearbeitenSeiteState();
}

class _BoxBearbeitenSeiteState extends State<BoxBearbeitenSeite> {
  late final _name = TextEditingController(text: widget.box?.name ?? '');
  late final _adresse = TextEditingController(text: widget.box?.adresse ?? '');
  late bool _https = widget.box?.https ?? false;
  bool _pruefe = false;

  final List<Fund> _funde = [];
  bool _suche = false;

  bool get _neu => widget.box == null;

  int get _port => _https ? 8443 : 8200;

  @override
  void initState() {
    super.initState();
    if (_neu) _suchen();
  }

  Future<void> _suchen() async {
    setState(() {
      _suche = true;
      _funde.clear();
    });
    try {
      await for (final f in netzDurchsuchen()) {
        if (!mounted) return;
        if (widget.stand.boxen.any((b) => b.adresse == f.adresse)) continue;
        setState(() => _funde.add(f));
      }
    } finally {
      if (mounted) setState(() => _suche = false);
    }
  }

  Future<void> _speichern() async {
    final adresse = _adresse.text.trim();
    if (adresse.isEmpty) {
      meldung(context, 'Adresse fehlt.');
      return;
    }
    setState(() => _pruefe = true);
    // Zur Probe mit einem Wegwerf-Eintrag: das Zeugnis (HTTPS) wird dabei
    // zum ersten Mal gesehen und gemerkt.
    final probe = BoxEintrag(
      id: widget.box?.id ?? _neueId(),
      name: _name.text.trim(),
      adresse: adresse,
      port: _port,
      https: _https,
      fingerabdruck: (widget.box?.adresse == adresse && widget.box?.https == _https) ? widget.box?.fingerabdruck : null,
      sitzung: widget.box?.adresse == adresse ? widget.box?.sitzung : null,
    );
    final c = BoxClient(probe);
    String? gefundenerName;
    String? fehler;
    try {
      gefundenerName = await c.kennung();
      if (gefundenerName == null) fehler = 'Unter dieser Adresse antwortet etwas, aber keine MixPiBox.';
    } on BoxFehler catch (e) {
      fehler = e.satz;
    } finally {
      c.schliessen();
    }
    if (!mounted) return;
    setState(() => _pruefe = false);
    if (fehler != null) {
      final trotzdem = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Box nicht gefunden'),
          content: Text('$fehler\n\nTrotzdem speichern?'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Nein')),
            TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Speichern')),
          ],
        ),
      );
      if (trotzdem != true || !mounted) return;
    }
    if (probe.name.isEmpty) probe.name = (gefundenerName?.isNotEmpty ?? false) ? gefundenerName! : adresse;

    final alt = widget.box;
    if (alt == null) {
      await widget.stand.hinzufuegen(probe);
    } else {
      alt
        ..name = probe.name
        ..adresse = probe.adresse
        ..port = probe.port
        ..https = probe.https
        ..fingerabdruck = probe.fingerabdruck
        ..sitzung = probe.sitzung;
      await widget.stand.geaendert(alt);
    }
    if (mounted) Navigator.pop(context);
  }

  static String _neueId() {
    final r = Random.secure();
    return List.generate(12, (_) => r.nextInt(16).toRadixString(16)).join();
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.box;
    return Scaffold(
      appBar: AppBar(title: Text(_neu ? 'Box hinzufügen' : 'Box bearbeiten')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_neu) ...[
            Row(
              children: [
                Text('Im WLAN gefunden', style: Theme.of(context).textTheme.titleMedium),
                const Spacer(),
                if (_suche)
                  const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                else
                  TextButton(onPressed: _suchen, child: const Text('Neu suchen')),
              ],
            ),
            if (_funde.isEmpty && !_suche) const Text('Keine (neue) Box gefunden — unten von Hand eintragen.'),
            for (final f in _funde)
              ListTile(
                leading: const Icon(Icons.speaker),
                title: Text(f.name),
                subtitle: Text(f.adresse),
                onTap: () => setState(() {
                  _adresse.text = f.adresse;
                  if (_name.text.isEmpty && f.name != f.adresse) _name.text = f.name;
                }),
              ),
            const Divider(height: 32),
          ],
          TextField(
            controller: _name,
            decoration: const InputDecoration(labelText: 'Name in der App', hintText: 'z. B. Kinderzimmer Lena'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _adresse,
            keyboardType: TextInputType.url,
            autocorrect: false,
            decoration: const InputDecoration(labelText: 'Adresse', hintText: 'mixpibox.local oder 192.168.178.99'),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _https,
            onChanged: (v) => setState(() => _https = v),
            title: const Text('Verschlüsselt (HTTPS, Port 8443)'),
            subtitle: const Text(
              'Empfohlen, wenn die Box ein Passwort hat. Das Zeugnis der Box wird beim ersten Kontakt gemerkt.',
            ),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _pruefe ? null : _speichern,
            child: Text(_pruefe ? 'Prüfe …' : 'Speichern'),
          ),
          if (b != null) ...[
            const Divider(height: 40),
            if (b.fingerabdruck != null)
              ListTile(
                leading: const Icon(Icons.verified_user_outlined),
                title: const Text('Zeugnis vergessen'),
                subtitle: Text('Gemerkt: ${b.fingerabdruck!.substring(0, 16)}…  Nur nach einer Neueinrichtung der Box nötig.'),
                onTap: () async {
                  b.fingerabdruck = null;
                  await widget.stand.geaendert(b);
                  if (context.mounted) meldung(context, 'Zeugnis vergessen — das nächste wird gemerkt.');
                },
              ),
            if (b.sitzung != null)
              ListTile(
                leading: const Icon(Icons.logout),
                title: const Text('Abmelden'),
                onTap: () async {
                  b.sitzung = null;
                  await widget.stand.geaendert(b);
                  if (context.mounted) meldung(context, 'Abgemeldet.');
                },
              ),
            ListTile(
              leading: Icon(Icons.delete_outline, color: Theme.of(context).colorScheme.error),
              title: const Text('Box aus der App entfernen'),
              subtitle: const Text('An der Box selbst ändert sich nichts.'),
              onTap: () async {
                await widget.stand.entfernen(b);
                if (context.mounted) Navigator.popUntil(context, (r) => r.isFirst);
              },
            ),
          ],
        ],
      ),
    );
  }
}
