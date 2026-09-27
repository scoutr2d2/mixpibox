import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';

import 'seiten/teilen_seite.dart';
import 'seiten/uebersicht.dart';
import 'teilen.dart';
import 'zustand.dart';

void main() {
  // ZUERST DAS BINDING. `laden()` fragt SharedPreferences, und das geht ueber
  // einen Plattform-Kanal — ohne Binding wirft es sofort. Der Fehler steckte
  // in einem Future, auf das niemand wartet: er verschwand, `geladen` wurde
  // nie wahr, und die Startseite zeigte auf dem Handy nur einen Kreisel
  // (27.09.2026, Honor PGT-N19; in den Tests unsichtbar, weil die
  // Testumgebung das Binding selbst anlegt).
  WidgetsFlutterBinding.ensureInitialized();
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
  /// Damit ein geteilter Link eine Seite oeffnen kann, ohne selbst einen
  /// BuildContext zu haben.
  final _navigator = GlobalKey<NavigatorState>();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.stand.taktStarten();
    // TEILEN (27.09.2026): waehrend die App laeuft, und was beim Start wartet.
    Teilen.lauschen(_geteilt);
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final text = await Teilen.abholen();
      if (text != null) _geteilt(text);
    });
  }

  /// Ein geteilter Text: bei EINER Box gleich deren Treffer, sonst erst die Wahl.
  Future<void> _geteilt(String text) async {
    // Erst geladen sein — sonst saehe es aus, als gaebe es keine Box.
    for (var i = 0; i < 50 && !widget.stand.geladen; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
    // DEN NAVIGATOR ERST JETZT HOLEN, nach dem Warten — ein vorher gemerkter
    // Kontext kann inzwischen weg sein.
    final nav = _navigator.currentState;
    if (!mounted || nav == null) return;
    final boxen = widget.stand.boxen;
    if (boxen.length == 1) {
      await TeilenSeite.zurBox(nav.context, widget.stand, boxen.single, text);
    } else {
      await nav.push(MaterialPageRoute<void>(builder: (_) => TeilenSeite(stand: widget.stand, text: text)));
    }
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
      navigatorKey: _navigator,
      title: 'MixPiBox',
      theme: ThemeData(colorSchemeSeed: saat, useMaterial3: true),
      darkTheme: ThemeData(colorSchemeSeed: saat, brightness: Brightness.dark, useMaterial3: true),
      home: UebersichtSeite(stand: widget.stand),
    );
  }
}
