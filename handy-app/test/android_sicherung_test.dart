// Die Kopplungsschluessel verlassen das Handy nicht — weder in die
// Cloud-Sicherung noch beim Umzug auf ein neues Handy (29.09.2026,
// AUDIT-2026-09-28 §1b Rang 6b).
//
// WARUM EIN TEST UEBER XML-DATEIEN: Die Regel steht nicht im Dart-Code,
// sondern im Manifest und in einer Regeldatei — und beide koennen still
// verloren gehen, etwa wenn jemand das Android-Geruest mit `flutter create`
// neu erzeugt. Kein anderer Test und kein `flutter analyze` sieht dann etwas.
//
// KOMMENTARE ZAEHLEN NICHT: ein auskommentiertes `allowBackup="false"` darf
// diesen Test nicht gruen machen. Deshalb fliegen sie vor jeder Suche raus.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

String _ohneKommentare(String xml) => xml.replaceAll(RegExp(r'<!--.*?-->', dotAll: true), '');

String _lesen(String pfad) {
  final f = File(pfad);
  expect(f.existsSync(), isTrue, reason: '$pfad fehlt');
  return _ohneKommentare(f.readAsStringSync());
}

/// Alle Bereiche, die Android fuer Sicherung und Umzug kennt
/// (developer.android.com/identity/data/autobackup). Eine Regel gilt nur fuer
/// ihren Bereich — wer einen vergisst, laesst ihn offen.
const _alleBereiche = {
  'root',
  'file',
  'database',
  'sharedpref',
  'external',
  'device_root',
  'device_file',
  'device_database',
  'device_sharedpref',
};

void main() {
  const manifestPfad = 'android/app/src/main/AndroidManifest.xml';

  String anwendungsKopf() {
    final m = RegExp(r'<application\b[^>]*>', dotAll: true).firstMatch(_lesen(manifestPfad));
    expect(m, isNotNull, reason: 'kein <application> im Manifest');
    return m!.group(0)!;
  }

  test('das Manifest schaltet die Sicherung ab und zeigt auf die Regeldatei', () {
    final kopf = anwendungsKopf();
    expect(kopf, contains('android:allowBackup="false"'));
    final regeln = RegExp(r'android:dataExtractionRules="@xml/(\w+)"').firstMatch(kopf);
    expect(regeln, isNotNull, reason: 'ab Android 12 sperrt allowBackup den Umzug nicht zuverlaessig');
    expect(File('android/app/src/main/res/xml/${regeln!.group(1)}.xml').existsSync(), isTrue);
  });

  test('die Regeldatei sperrt Cloud UND Umzug, in allen neun Bereichen, ohne ein einziges include', () {
    final name = RegExp(r'android:dataExtractionRules="@xml/(\w+)"').firstMatch(anwendungsKopf())!.group(1);
    final xml = _lesen('android/app/src/main/res/xml/$name.xml');
    expect(xml, contains('<data-extraction-rules>'));
    // EIN include machte aus der Sperrliste eine Erlaubnisliste.
    expect(xml, isNot(contains('<include')));
    // Umzug zu iOS gibt es nur, wenn die App ihn ausdruecklich traegt.
    expect(xml, isNot(contains('cross-platform-transfer')));
    for (final art in ['cloud-backup', 'device-transfer']) {
      final teile = RegExp('<$art\\b[^>]*>(.*?)</$art>', dotAll: true).allMatches(xml).toList();
      expect(teile, hasLength(1), reason: '<$art> genau einmal');
      final gesperrt = {
        for (final e in RegExp(r'<exclude\s+domain="([a-z_]+)"\s+path="\."\s*/>').allMatches(teile.single.group(1)!))
          e.group(1)!,
      };
      expect(gesperrt, _alleBereiche, reason: '<$art> muss jeden Bereich ganz ausschliessen');
    }
  });

  test('kein anderes Manifest (debug, profile) schaltet die Sicherung wieder ein', () {
    final manifeste = Directory('android/app/src')
        .listSync()
        .whereType<Directory>()
        .map((d) => File('${d.path}/AndroidManifest.xml'))
        .where((f) => f.existsSync())
        .toList();
    expect(manifeste.length, greaterThanOrEqualTo(3), reason: 'main, debug und profile — sonst sucht der Test am falschen Ort');
    for (final f in manifeste) {
      final xml = _ohneKommentare(f.readAsStringSync());
      expect(xml, isNot(contains('android:allowBackup="true"')), reason: f.path);
      expect(xml, isNot(contains('tools:replace')), reason: '${f.path}: ueberschreibt beim Zusammenfuehren');
    }
  });
}
