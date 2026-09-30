// `dienstVon` gibt es im Kern (src/backend-api/src/medien.ts) und in der App
// (lib/modell.dart). Zwei Orte, eine Regel — und bis 29.09.2026 liefen sie
// schon auseinander: der Kern nahm `toLowerCase` und kannte radio/rss/ard/
// plugin, die App nicht (AUDIT-2026-09-28 §1b Rang 5).
//
// DIESER TEST LIEST DIE REGELN AUS DER QUELLE DES KERNS, statt sie hier ein
// drittes Mal abzuschreiben. Er vergleicht in BEIDE Richtungen: jede Regel
// des Kerns muss in der App stehen, und die App darf keine haben, die der
// Kern nicht kennt. Und er zaehlt mit, ob er jede Zeile des Kerns verstanden
// hat — eine neue Regelform (etwa `t.includes(…)`) soll ihn rot machen, nicht
// an ihm vorbeigehen.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mixpibox_fernbedienung/modell.dart';

const _kernPfad = '../src/backend-api/src/medien.ts';

String _kernFunktion() {
  final f = File(_kernPfad);
  expect(f.existsSync(), isTrue, reason: '$_kernPfad fehlt — liegt die App nicht mehr im MixPiBox-Baum?');
  final quelle = f.readAsStringSync();
  final anfang = quelle.indexOf('export function dienstVon(');
  expect(anfang, greaterThanOrEqualTo(0), reason: 'dienstVon() nicht mehr in medien.ts');
  final ende = quelle.indexOf('\n}\n', anfang);
  expect(ende, greaterThan(anfang));
  // Zeilenkommentare weg: ein zitiertes `return 'x'` in einem Kommentar ist keine Regel.
  return quelle.substring(anfang, ende + 2).replaceAll(RegExp(r'//[^\n]*'), '');
}

void main() {
  test('die App teilt die Dienste genau so ein wie der Kern — und sonst nichts', () {
    final kern = _kernFunktion();
    expect(kern, contains('.toLowerCase()'), reason: 'der Kern vergleicht klein geschrieben');

    final vorsilben = [
      for (final m in RegExp(r"if \(t\.startsWith\('([^']+)'\)\) return '([^']+)'").allMatches(kern))
        MapEntry(m.group(1)!, m.group(2)!),
    ];
    final gleich = <String, String>{};
    var gleichRegeln = 0;
    for (final m in RegExp(r"if \(((?:t === '[^']+'(?: \|\| )?)+)\) return '([^']+)'").allMatches(kern)) {
      gleichRegeln++;
      for (final t in RegExp(r"t === '([^']+)'").allMatches(m.group(1)!)) {
        gleich[t.group(1)!] = m.group(2)!;
      }
    }
    final rest = RegExp(r"^\s*return '([^']+)'\s*$", multiLine: true).allMatches(kern).toList();
    expect(rest, hasLength(1), reason: 'genau ein „sonst" am Ende');
    final sonst = rest.single.group(1)!;

    // HAT DER TEST JEDE ZEILE VERSTANDEN? Jedes `return '…'` muss einer der
    // drei Formen oben gehoeren.
    expect(
      RegExp(r"return '").allMatches(kern).length,
      vorsilben.length + gleichRegeln + 1,
      reason: 'eine Regel in medien.ts hat eine Form, die dieser Test nicht liest:\n$kern',
    );
    // Und die Rueckgabetypen des Kerns sind genau die gelesenen Dienste.
    final typ = RegExp(r"\):\s*([^{]+)\{").firstMatch(kern)!.group(1)!;
    expect(
      {for (final m in RegExp(r"'([^']+)'").allMatches(typ)) m.group(1)!},
      {...vorsilben.map((e) => e.value), ...gleich.values, sonst},
    );

    expect(vorsilben.map((e) => '${e.key}→${e.value}').toList(), dienstNachVorsilbe.entries.map((e) => '${e.key}→${e.value}').toList());
    expect(dienstNachTyp, gleich);
    expect(sonst, 'anderes');
    expect(dienstVon('gibt-es-nicht'), sonst);
  });

  test('gross oder klein geschrieben: derselbe Dienst', () {
    expect(dienstVon('Spotify'), 'spotify', reason: 'der Fall aus dem Audit');
    expect(dienstVon('SPOTIFYALBUM'), 'spotify');
    expect(dienstVon('Jellyfin'), 'jellyfin');
    expect(dienstVon('Library'), 'lokal');
    expect(dienstVon('RADIO'), 'radio');
    expect(dienstVon('Plugin'), 'plugin');
    expect(dienstVon(''), 'anderes');
  });

  test('das Wort der Box geht vor — die eigene Rechnung nur, wenn es fehlt', () {
    final liste = MedienEintrag.listeAusJson([
      {'schluessel': 'a', 'type': 'Spotify'},
      {'schluessel': 'b', 'type': 'spotify', 'dienst': 'hoerspielkiste'},
      {'schluessel': 'c', 'type': 'radio', 'dienst': {'kaputt': true}},
    ]);
    expect(liste.map((e) => e.dienst), ['spotify', 'hoerspielkiste', 'radio']);
  });
}
