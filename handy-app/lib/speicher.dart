import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'modell.dart';

/// Die Liste der Boxen auf dem Handy — ein JSON-Text unter einem Schluessel.
/// Kein Passwort darin (siehe [BoxEintrag]).
class BoxSpeicher {
  static const _schluessel = 'boxen.v1';

  Future<List<BoxEintrag>> laden() async {
    final p = await SharedPreferences.getInstance();
    final roh = p.getString(_schluessel);
    if (roh == null) return [];
    try {
      return (jsonDecode(roh) as List).whereType<Map<String, dynamic>>().map(BoxEintrag.ausJson).toList();
    } catch (_) {
      // Ein kaputter Eintrag soll die App nicht festhalten: leer anfangen.
      return [];
    }
  }

  Future<void> sichern(List<BoxEintrag> boxen) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_schluessel, jsonEncode(boxen.map((b) => b.alsJson()).toList()));
  }
}
