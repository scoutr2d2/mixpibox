import 'package:flutter_test/flutter_test.dart';
import 'package:mixpibox_fernbedienung/box_client.dart';
import 'package:mixpibox_fernbedienung/modell.dart';
import 'package:mixpibox_fernbedienung/zustand.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'box_client_test.dart' show AttrappenBox;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('Befehl an alle: wer nicht mitmacht, wird mit Grund genannt', () async {
    final attrappen = {'a': AttrappenBox(), 'b': AttrappenBox(passwort: 'x'), 'c': AttrappenBox()};
    final stand = BoxenStand(clientBauen: (b) => BoxClient(b, client: attrappen[b.id]!.client()));
    for (final id in attrappen.keys) {
      await stand.hinzufuegen(BoxEintrag(id: id, name: 'Box $id', adresse: '10.0.0.$id'));
    }
    final fehler = await stand.anAlle((c) => c.befehl('stop'));
    expect(fehler.keys, ['Box b']);
    expect(attrappen['a']!.befehle, ['stop']);
    expect(attrappen['c']!.befehle, ['stop']);
    expect(stand.lage('b').anmeldungNoetig, isTrue);
    stand.dispose();
  });

  test('Profile ueber alle Boxen werden nach NAMEN zusammengefuehrt', () async {
    final attrappen = {'a': AttrappenBox(), 'b': AttrappenBox()};
    final stand = BoxenStand(clientBauen: (b) => BoxClient(b, client: attrappen[b.id]!.client()));
    for (final id in attrappen.keys) {
      await stand.hinzufuegen(BoxEintrag(id: id, name: 'Box $id', adresse: '10.0.0.$id'));
    }
    final alle = await stand.profileUeberAlle();
    expect(alle['lena']!.length, 2);
    stand.dispose();
  });

  test('Boxen ueberleben einen Neustart der App (ohne Passwort, mit Sitzung)', () async {
    final a = BoxenStand(clientBauen: (b) => BoxClient(b, client: AttrappenBox().client()));
    await a.hinzufuegen(BoxEintrag(id: 'q', name: 'Q', adresse: 'q.local', https: true, sitzung: 's'));
    a.dispose();
    final b = BoxenStand(clientBauen: (b) => BoxClient(b, client: AttrappenBox().client()));
    await b.laden();
    expect(b.boxen.single.adresse, 'q.local');
    expect(b.boxen.single.https, isTrue);
    expect(b.boxen.single.sitzung, 's');
    b.dispose();
  });
}
