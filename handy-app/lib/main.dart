import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';

import 'seiten/uebersicht.dart';
import 'zustand.dart';

void main() {
  final stand = BoxenStand()..laden();
  HttpOverrides.global = _BoxZeugnisse(stand);
  runApp(MixPiApp(stand: stand));
}

/// Die Bilder (`Image.network`) laufen nicht durch den [BoxClient], sondern
/// ueber Flutters eigenen HttpClient — und der wiese das selbst ausgestellte
/// Zeugnis einer HTTPS-Box ab. Hier gilt dieselbe Regel wie im Client: nur
/// das Zeugnis, das fuer GENAU diese Box gemerkt ist.
class _BoxZeugnisse extends HttpOverrides {
  _BoxZeugnisse(this.stand);
  final BoxenStand stand;

  @override
  HttpClient createHttpClient(SecurityContext? context) {
    return super.createHttpClient(context)
      ..badCertificateCallback = (cert, host, port) {
        final abdruck = sha256.convert(cert.der).toString();
        return stand.boxen.any((b) => b.https && b.adresse == host && b.port == port && b.fingerabdruck == abdruck);
      };
  }
}

class MixPiApp extends StatefulWidget {
  const MixPiApp({super.key, required this.stand});
  final BoxenStand stand;

  @override
  State<MixPiApp> createState() => _MixPiAppState();
}

class _MixPiAppState extends State<MixPiApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.stand.taktStarten();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.stand.dispose();
    super.dispose();
  }

  /// Nur fragen, solange die App vorne ist — im Hintergrund haette das Handy
  /// nichts davon und der Akku alles.
  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.resumed) {
      widget.stand
        ..taktStarten()
        ..aktualisieren();
    } else if (s == AppLifecycleState.paused) {
      widget.stand.taktAnhalten();
    }
  }

  @override
  Widget build(BuildContext context) {
    // Derselbe Akzent wie der Kinderschirm (`--accent` in NewDesign/app.css),
    // damit App und Box zusammengehoeren.
    const saat = Color(0xFFFF6B57);
    return MaterialApp(
      title: 'MixPiBox',
      theme: ThemeData(colorSchemeSeed: saat, useMaterial3: true),
      darkTheme: ThemeData(colorSchemeSeed: saat, brightness: Brightness.dark, useMaterial3: true),
      home: UebersichtSeite(stand: widget.stand),
    );
  }
}
