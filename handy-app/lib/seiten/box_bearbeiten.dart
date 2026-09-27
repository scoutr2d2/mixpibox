import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';

import '../box_client.dart';
import '../modell.dart';
import '../netzsuche.dart';
import '../zustand.dart';
import 'dialoge.dart';
import 'koppeln.dart';

/// Box hinzufuegen (ohne `box`) oder bearbeiten (mit).
class BoxBearbeitenSeite extends StatefulWidget {
  const BoxBearbeitenSeite({super.key, required this.stand, this.box, this.suche = netzDurchsuchen});
  final BoxenStand stand;
  final BoxEintrag? box;

  /// Die Suche im WLAN — austauschbar, damit Tests kein Netz abtasten.
  final Stream<Fund> Function({void Function(SuchStand)? fortschritt}) suche;

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
  SuchStand? _stand;
  StreamSubscription<Fund>? _suchlauf;

  bool get _neu => widget.box == null;

  int get _port => _https ? 8443 : 8200;

  @override
  void initState() {
    super.initState();
    if (_neu) _suchen();
  }

  @override
  void dispose() {
    _suchlauf?.cancel();
    super.dispose();
  }

  void _suchen() {
    _suchlauf?.cancel();
    setState(() {
      _suche = true;
      _stand = null;
      _funde.clear();
    });
    _suchlauf = widget
        .suche(
          fortschritt: (st) {
            if (mounted) setState(() => _stand = st);
          },
        )
        .listen(
          (f) {
            if (!mounted || widget.stand.boxen.any((b) => b.adresse == f.adresse)) return;
            setState(() => _funde.add(f));
          },
          onDone: _suchEnde,
          onError: (_) => _suchEnde(),
        );
  }

  void _suchEnde() {
    if (mounted) setState(() => _suche = false);
  }

  /// Ein Fund wird mit EINEM Tipp hinzugefuegt. Vorher fuellte er nur die
  /// Felder unten, und oben drehte die Suche weiter — das sah aus wie
  /// „erkannt, aber es kringelt ohne Ende" (Rueckmeldung 27.09.2026).
  Future<void> _fundNehmen(Fund f) async {
    await _suchlauf?.cancel();
    _suchlauf = null;
    setState(() {
      _suche = false;
      _adresse.text = f.adresse;
      if (_name.text.isEmpty && f.name != f.adresse) _name.text = f.name;
    });
    await _speichern();
  }

  /// EINE BOX PER QR: anlegen und koppeln in einem Schritt. Der QR an der
  /// Box traegt Adresse, Port und Code; den Namen fragt die App die Box selbst.
  Future<void> _perQr() async {
    final text = await qrScannen(context);
    if (!mounted || text == null) return;
    final qr = koppelQrLesen(text);
    if (qr == null) {
      meldung(context, 'Das ist kein Kopplungszeichen einer MixPiBox.');
      return;
    }
    if (widget.stand.boxen.any((b) => b.adresse == qr.adresse && b.port == qr.port)) {
      meldung(context, 'Diese Box ist schon da — in der Übersicht antippen, um sie zu koppeln.');
      return;
    }
    setState(() => _pruefe = true);
    final box = BoxEintrag(id: _neueId(), name: '', adresse: qr.adresse, port: qr.port, https: qr.port == 8443);
    final c = widget.stand.clientBauen(box);
    try {
      box.name = (await c.kennung())?.trim() ?? '';
      if (box.name.isEmpty) box.name = qr.adresse;
      await c.koppeln(qr.code, name: 'Handy');
    } on BoxFehler catch (e) {
      if (mounted) {
        setState(() => _pruefe = false);
        meldung(context, e.satz);
      }
      return;
    } finally {
      c.schliessen();
    }
    await widget.stand.hinzufuegen(box);
    if (!mounted) return;
    meldung(context, 'Gekoppelt mit ${box.name}.');
    Navigator.pop(context);
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
      // DER SCHLUESSEL GEHOERT ZUR BOX, nicht zur Adresse: bekommt dieselbe Box
      // eine neue IP, bleibt sie gekoppelt. Nur ein ANDERER Port (HTTP/HTTPS)
      // aendert daran nichts — es ist dieselbe Box.
      schluessel: widget.box?.schluessel,
    );
    // UEBER DIE FABRIK DES ZUSTANDS, nicht fest gebaut — dieselbe, die spaeter
    // die Box bedient; in Tests steckt dort die Attrappe.
    final c = widget.stand.clientBauen(probe);
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
        ..sitzung = probe.sitzung
        ..schluessel = probe.schluessel;
      await widget.stand.geaendert(alt);
    }
    // GLEICH KOPPELN, statt eine tote Box in die Liste zu stellen (27.09.2026,
    // Betreiber: „gute idee"). Suche und Eintragen von Hand fragen nur
    // `/api/box`, und der ist absichtlich frei — ob die Box dieses Handy
    // kennt, fragt `kopplungNoetig` eigens. NICHT die erste volle Abfrage
    // abwarten: `hinzufuegen`/`geaendert` stossen sie nur noch an, weil sie
    // bis zu 3 x 6 s dauern kann und die Seite so lange kringelte. Bricht man
    // hier ab, steht die Box als „Nicht gekoppelt — antippen" in der Übersicht.
    final gespeichert = alt ?? probe;
    bool noetig;
    try {
      noetig = await widget.stand.client(gespeichert).kopplungNoetig();
    } on BoxFehler {
      noetig = false; // nicht erreichbar: die Übersicht sagt es, nicht diese Seite
    }
    if (mounted && noetig) {
      await koppelnAblauf(context, widget.stand, gespeichert);
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
            // DER KURZE WEG: an der Box „Handy verbinden", hier scannen —
            // Adresse, Port und Kopplung kommen alle aus dem einen Zeichen.
            FilledButton.icon(
              onPressed: _pruefe ? null : _perQr,
              icon: const Icon(Icons.qr_code_scanner),
              label: const Text('Per QR hinzufügen'),
            ),
            const Padding(
              padding: EdgeInsets.only(top: 4, bottom: 16),
              child: Text('An der Box: Admin-Menü → Handys → „Handy verbinden".'),
            ),
            Row(
              children: [
                Text('Im WLAN gefunden', style: Theme.of(context).textTheme.titleMedium),
                const Spacer(),
                if (_suche) ...[
                  Text(
                    _stand == null ? 'suche …' : '${_stand!.geprueft} von ${_stand!.gesamt}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(width: 8),
                  const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
                ] else
                  TextButton(onPressed: _suchen, child: const Text('Neu suchen')),
              ],
            ),
            if (_funde.isEmpty && !_suche) const Text('Keine (neue) Box gefunden — unten von Hand eintragen.'),
            if (_stand != null && _stand!.gesamt == 0 && !_suche)
              const Text('Kein WLAN gefunden, in dem gesucht werden könnte. Ist das Handy im WLAN?'),
            for (final f in _funde)
              Card(
                child: ListTile(
                  leading: const Icon(Icons.speaker),
                  title: Text(f.name),
                  subtitle: Text(f.adresse),
                  trailing: _pruefe ? null : const Icon(Icons.add_circle_outline),
                  onTap: _pruefe ? null : () => _fundNehmen(f),
                ),
              ),
            if (_funde.isNotEmpty) const Text('Antippen fügt die Box hinzu.'),
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
