import 'dart:io';

import 'package:flutter/services.dart';

/// Wohin Heruntergeladenes kommt — der Kanal `de.mixpibox/ablage` in
/// `MainActivity.kt`.
///
/// Erst in den Zwischenordner der App, dann in einem Rutsch in
/// `Download/MixPiBox`. So steht im Download-Ordner nie eine halbe Datei,
/// wenn die Verbindung mitten im Album abreisst.
class Ablage {
  const Ablage();

  static const _kanal = MethodChannel('de.mixpibox/ablage');

  /// Eine neue, leere Zwischendatei.
  Future<File> zwischenDatei() async {
    final ordner = await _kanal.invokeMethod<String>('zwischenOrdner');
    if (ordner == null) throw StateError('Kein Zwischenordner');
    return File('$ordner/download-${DateTime.now().microsecondsSinceEpoch}.part');
  }

  /// Legt [datei] als [name] in den Download-Ordner und nennt den Ort, wie
  /// ein Mensch ihn sucht („Download/MixPiBox/…"). [mime] ist der Dateityp,
  /// unter dem das Handy sie fuehrt — eine Sicherung ist kein ZIP.
  Future<String> inDownloads(File datei, String name, {String mime = 'application/zip'}) async {
    final ort = await _kanal.invokeMethod<String>('inDownloads', {
      'pfad': datei.path,
      'name': sichererName(name),
      'mime': mime,
    });
    return ort ?? name;
  }

  /// Der Dateiwaehler des Systems — die gewaehlte Datei kommt als Kopie im
  /// Zwischenordner zurueck (der Aufrufer loescht sie). `null`: abgebrochen.
  Future<({File datei, String name})?> waehlen() async {
    final r = await _kanal.invokeMethod<Map<Object?, Object?>>('waehlen');
    if (r == null || r['pfad'] is! String) return null;
    return (datei: File(r['pfad']! as String), name: '${r['name'] ?? ''}');
  }

  /// Ein Dateiname ohne Zeichen, die Android oder ein PC-Dateisystem
  /// ablehnen. Die Box schickt schon einen gesaeuberten; das hier ist die
  /// zweite Leine, falls eine aeltere Box es nicht tut.
  static String sichererName(String name) {
    final s = name.replaceAll(RegExp(r'[\\/:*?"<>|\u0000-\u001f]'), '_').trim();
    return s.isEmpty ? 'mixpibox.zip' : s;
  }
}
