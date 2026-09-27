import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../box_client.dart';
import '../modell.dart';
import '../zustand.dart';
import 'dialoge.dart';

/// Ein Handy mit einer Box koppeln — per Code oder QR (27.09.2026).
///
/// Den Code zeigt die Box im Admin-Menü unter Handys → „Handy verbinden",
/// zwei Minuten lang und fuer genau EIN Handy. Der QR daneben traegt
/// denselben Code plus die Adresse der Box.
///
/// `true`: gekoppelt. Fehler meldet der Ablauf selbst.
Future<bool> koppelnAblauf(BuildContext context, BoxenStand stand, BoxEintrag box) async {
  final eingabe = await showModalBottomSheet<({String code, String name})>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => _KoppelBlatt(
      boxName: box.name,
      // SOFORT AN DER BOX ZEIGEN LASSEN — der Betreiber: „wenn man in der app
      // auf koppeln klickt auf der box automatisch den qrcode und code".
      anfragen: (name) => stand.client(box).kopplungAnfragen(name: name),
    ),
  );
  if (eingabe == null || !context.mounted) return false;
  try {
    await stand.koppeln(box, eingabe.code, name: eingabe.name);
    if (context.mounted) meldung(context, 'Gekoppelt mit ${box.name}.');
    return true;
  } on BoxFehler catch (e) {
    if (context.mounted) meldung(context, e.satz);
    return false;
  }
}

/// Den QR an der Box scannen. Zurueck kommt der Rohtext — oder null.
Future<String?> qrScannen(BuildContext context) =>
    Navigator.push<String>(context, MaterialPageRoute(builder: (_) => const ScannerSeite()));

class _KoppelBlatt extends StatefulWidget {
  const _KoppelBlatt({required this.boxName, required this.anfragen});
  final String boxName;
  final Future<void> Function(String name) anfragen;
  @override
  State<_KoppelBlatt> createState() => _KoppelBlattState();
}

class _KoppelBlattState extends State<_KoppelBlatt> {
  final _code = TextEditingController();
  final _name = TextEditingController(text: 'Handy');

  /// Was die Bitte an die Box ergeben hat — steht unter der Ueberschrift.
  String _bitteStand = 'Die Box wird gebeten, QR und Code zu zeigen …';

  @override
  void initState() {
    super.initState();
    _bitten();
  }

  Future<void> _bitten() async {
    setState(() => _bitteStand = 'Die Box wird gebeten, QR und Code zu zeigen …');
    try {
      await widget.anfragen(_name.text.trim().isEmpty ? 'Handy' : _name.text.trim());
      if (mounted) {
        setState(
          () => _bitteStand =
              'Die Box zeigt jetzt QR und Code — ist dort eine Eltern-PIN gesetzt, erst nach der PIN.',
        );
      }
    } on BoxFehler catch (e) {
      if (mounted) setState(() => _bitteStand = e.satz);
    }
  }

  void _fertig(String code) {
    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
      meldung(context, 'Der Code hat sechs Ziffern.');
      return;
    }
    Navigator.pop(context, (code: code, name: _name.text.trim().isEmpty ? 'Handy' : _name.text.trim()));
  }

  Future<void> _scannen() async {
    final text = await qrScannen(context);
    if (!mounted || text == null) return;
    final qr = koppelQrLesen(text);
    if (qr == null) {
      meldung(context, 'Das ist kein Kopplungszeichen einer MixPiBox.');
      return;
    }
    _fertig(qr.code);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Mit ${widget.boxName} koppeln', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          Text(_bitteStand),
          TextButton(onPressed: _bitten, child: const Text('Noch einmal an der Box zeigen')),
          const SizedBox(height: 16),
          FilledButton.icon(onPressed: _scannen, icon: const Icon(Icons.qr_code_scanner), label: const Text('QR scannen')),
          const SizedBox(height: 16),
          TextField(
            controller: _code,
            keyboardType: TextInputType.number,
            maxLength: 6,
            decoration: const InputDecoration(labelText: 'Code (6 Ziffern)'),
            onSubmitted: _fertig,
          ),
          TextField(
            controller: _name,
            decoration: const InputDecoration(labelText: 'Name dieses Handys (steht dann an der Box)'),
          ),
          const SizedBox(height: 12),
          OutlinedButton(onPressed: () => _fertig(_code.text.trim()), child: const Text('Koppeln')),
        ],
      ),
    );
  }
}

/// Die Kamera, bis ein QR erkannt ist. Nur QR — ein Strichcode auf einer
/// Keksschachtel soll nicht versehentlich „gelesen" werden.
class ScannerSeite extends StatefulWidget {
  const ScannerSeite({super.key});
  @override
  State<ScannerSeite> createState() => _ScannerSeiteState();
}

class _ScannerSeiteState extends State<ScannerSeite> {
  final _kamera = MobileScannerController(formats: const [BarcodeFormat.qrCode]);
  bool _fertig = false;

  @override
  void dispose() {
    _kamera.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('QR an der Box scannen')),
      body: MobileScanner(
        controller: _kamera,
        onDetect: (fang) {
          if (_fertig) return;
          final text = fang.barcodes.map((b) => b.rawValue).whereType<String>().firstOrNull;
          if (text == null) return;
          _fertig = true;
          Navigator.pop(context, text);
        },
      ),
    );
  }
}
