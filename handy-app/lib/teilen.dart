import 'package:flutter/services.dart';

/// Was andere Apps an die MixPiBox-App teilen (27.09.2026) — der Kanal
/// `de.mixpibox/teilen` in MainActivity.kt.
///
/// Betreiber: „ich würde gerne aus spotify links zu alben senden können".
/// Geteilt wird TEXT: die Spotify-App schickt „Hör dir … an:
/// https://open.spotify.com/…"; den Link darin liest die Box.
class Teilen {
  static const _kanal = MethodChannel('de.mixpibox/teilen');

  /// Hoeren, solange die App laeuft — ein Teilen, waehrend sie schon offen ist.
  static void lauschen(void Function(String text) an) {
    _kanal.setMethodCallHandler((aufruf) async {
      if (aufruf.method == 'geteilt' && aufruf.arguments is String) an(aufruf.arguments as String);
    });
  }

  /// Was beim KALTSTART geteilt wurde — einmal, danach ist es abgeholt.
  static Future<String?> abholen() async {
    try {
      return await _kanal.invokeMethod<String>('abholen');
    } on MissingPluginException {
      // Kein Android (Tests, spaeter iOS): nichts geteilt.
      return null;
    }
  }
}
