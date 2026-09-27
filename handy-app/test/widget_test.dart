import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mixpibox_fernbedienung/ablage.dart';
import 'package:mixpibox_fernbedienung/box_client.dart';
import 'package:mixpibox_fernbedienung/main.dart';
import 'package:mixpibox_fernbedienung/modell.dart';
import 'package:mixpibox_fernbedienung/netzsuche.dart';
import 'package:mixpibox_fernbedienung/seiten/box_bearbeiten.dart';
import 'package:mixpibox_fernbedienung/seiten/box_seite.dart';
import 'package:mixpibox_fernbedienung/seiten/medien_seite.dart';
import 'package:mixpibox_fernbedienung/seiten/uebersicht.dart';
import 'package:mixpibox_fernbedienung/zustand.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'box_client_test.dart' show AttrappenBox;

void main() {
  testWidgets('Ohne Box: Hinweis und Knopf zum Hinzufuegen', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final stand = BoxenStand();
    await stand.laden();
    await tester.pumpWidget(MixPiApp(stand: stand));
    await tester.pump();
    expect(find.text('Box hinzufügen'), findsOneWidget);
    expect(find.textContaining('Noch keine Box'), findsOneWidget);
    // Kein „Alle"-Menue bei weniger als zwei Boxen.
    expect(find.byIcon(Icons.speaker_group), findsNothing);
    stand.taktAnhalten();
  });

  testWidgets('Uebersicht mit zwei Boxen: Album-Bild, Regler je Box, alle pausieren, alle leiser', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final leise = AttrappenBox();
    final laut = AttrappenBox()..lautstaerke = 70;
    final attrappen = {'a': leise, 'b': laut};
    final stand = BoxenStand(clientBauen: (b) => BoxClient(b, client: attrappen[b.id]!.client()));
    await tester.runAsync(stand.laden);
    stand.boxen.addAll([
      BoxEintrag(id: 'a', name: 'Kinderzimmer', adresse: 'a.local'),
      BoxEintrag(id: 'b', name: 'Wohnzimmer', adresse: 'b.local'),
    ]);
    await tester.runAsync(stand.aktualisieren);
    await tester.pumpWidget(MaterialApp(home: UebersichtSeite(stand: stand)));
    await tester.pump();
    expect(find.text('Alle Boxen'), findsOneWidget);
    expect(find.byType(Slider), findsNWidgets(3), reason: 'einer fuer alle, einer je Box');
    expect(find.byType(Image), findsNWidgets(2), reason: 'je Box ein kleines Album-Bild');
    final alle = tester.widget<Slider>(find.byType(Slider).first);
    expect(alle.value, 70, reason: 'der Regler fuer alle steht auf der lautesten Box');

    Future<void> warten(bool Function() bis) => tester.runAsync(() async {
      for (var i = 0; i < 100 && !bis(); i++) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
        await tester.pump();
      }
    });
    await tester.tap(find.text('Alle pausieren'));
    await warten(() => leise.befehle.isNotEmpty && laut.befehle.isNotEmpty);
    expect([leise.befehle, laut.befehle], [
      ['pause'],
      ['pause'],
    ]);
    await tester.drag(find.byType(Slider).first, const Offset(-2000, 0));
    await warten(() => leise.befehle.length > 1 && laut.befehle.length > 1);
    expect([leise.befehle.last, laut.befehle.last], ['setvolume:0', 'setvolume:0']);
    // Der Regler einer Box trifft nur diese.
    await tester.drag(find.byType(Slider).at(2), const Offset(-2000, 0));
    await warten(() => laut.befehle.length > 2);
    expect(laut.befehle.length, 3);
    expect(leise.befehle.length, 2);
    stand.taktAnhalten();
    await tester.pumpAndSettle();
  });

  testWidgets('Box-Seite: Profile und Mediathek oeffnen ohne Ausnahme', (tester) async {
    // Am 27.09.2026 auf dem Handy: jedes Oeffnen des Profil- und des
    // Mediathek-Reiters warf „setState() callback argument returned a
    // Future", weil `setState(() => _laden = …)` das Future zurueckgab.
    SharedPreferences.setMockInitialValues({});
    final box = AttrappenBox();
    final stand = BoxenStand(clientBauen: (b) => BoxClient(b, client: box.client()));
    final eintrag = BoxEintrag(id: 'x', name: 'Testbox', adresse: 'x.local');
    stand.boxen.add(eintrag);
    await tester.pumpWidget(MaterialApp(home: BoxSeite(stand: stand, box: eintrag)));
    for (final reiter in ['Profile', 'Mediathek']) {
      await tester.tap(find.text(reiter));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: reiter);
    }
    stand.taktAnhalten();
  });

  testWidgets('Jetzt im Querformat: Cover und Knoepfe nebeneinander, alles auf dem Schirm', (tester) async {
    // Am 27.09.2026 am Handy: quer war das quadratische Cover so breit wie
    // der Schirm, die Knoepfe lagen darunter ausser Sicht.
    tester.view.physicalSize = const Size(900, 420);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    SharedPreferences.setMockInitialValues({});
    final box = AttrappenBox();
    final stand = BoxenStand(clientBauen: (b) => BoxClient(b, client: box.client()));
    final eintrag = BoxEintrag(id: 'x', name: 'Testbox', adresse: 'x.local');
    stand.boxen.add(eintrag);
    await tester.runAsync(() => stand.eineAktualisieren(eintrag));
    await tester.pumpWidget(MaterialApp(home: BoxSeite(stand: stand, box: eintrag)));
    await tester.pump();
    expect(tester.takeException(), isNull);
    // „Weiter" steht in jedem Zustand da; hitTestable: nur, was man antippen kann.
    final knopf = tester.getRect(find.byIcon(Icons.skip_next).hitTestable());
    expect(knopf.bottom, lessThanOrEqualTo(420), reason: 'Knoepfe liegen unter dem Rand');
    final cover = tester.getRect(find.byType(AspectRatio).first);
    expect(cover.right, lessThan(knopf.left), reason: 'Cover steht links neben den Knoepfen');
    stand.taktAnhalten();
  });

  testWidgets('Mediathek: nur Lokales zeigt einen Pfeil, und der legt die Datei ab', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final box = AttrappenBox();
    final stand = BoxenStand(clientBauen: (b) => BoxClient(b, client: box.client()));
    final eintrag = BoxEintrag(id: 'x', name: 'Testbox', adresse: 'x.local');
    stand.boxen.add(eintrag);
    final ablage = _TestAblage();
    await tester.pumpWidget(MaterialApp(home: BoxSeite(stand: stand, box: eintrag, ablage: ablage)));
    await tester.tap(find.text('Mediathek'));
    await tester.pumpAndSettle();

    // Drei Werke, zwei davon liegen auf der Box (eins davon verschmolzen).
    expect(find.text('Auf der Box (2)'), findsOneWidget);
    expect(find.byIcon(Icons.download), findsNWidgets(2));
    await tester.tap(find.text('Auf der Box (2)'));
    await tester.pumpAndSettle();
    expect(find.text('Eins'), findsNothing, reason: 'Spotify-Werk ist weggefiltert');

    await tester.runAsync(() async {
      await tester.tap(find.byIcon(Icons.download).first);
      for (var i = 0; i < 50 && ablage.abgelegt.isEmpty; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
      }
    });
    await tester.pumpAndSettle();
    expect(ablage.abgelegt.single.$2, 'Grüße.zip');
    expect(ablage.abgelegt.single.$1.sublist(0, 4), [0x50, 0x4b, 0x03, 0x04]);
    expect(find.textContaining('Gespeichert: Download/MixPiBox/Grüße.zip'), findsOneWidget);
    stand.taktAnhalten();
  });

  testWidgets('Box von Hand hinzufuegen: ist sie nicht gekoppelt, geht das Koppeln gleich auf', (tester) async {
    // 27.09.2026, Betreiber auf die Frage, wie man eine Box noch OHNE Code
    // hinzufuegen kann: „ja gute idee" — gleich koppeln statt einer toten Box.
    SharedPreferences.setMockInitialValues({});
    final box = AttrappenBox(kopplung: true);
    final stand = BoxenStand(clientBauen: (b) => BoxClient(b, client: box.client()));
    await tester.pumpWidget(
      MaterialApp(home: BoxBearbeitenSeite(stand: stand, suche: ({fortschritt}) => const Stream<Fund>.empty())),
    );
    await tester.pump();
    await tester.enterText(find.widgetWithText(TextField, 'Adresse'), '192.168.178.62');
    await tester.runAsync(() async {
      await tester.tap(find.text('Speichern'));
      for (var i = 0; i < 50 && find.textContaining('koppeln').evaluate().isEmpty; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
        await tester.pump();
      }
    });
    await tester.pumpAndSettle();
    expect(find.text('Mit kinderzimmer koppeln'), findsOneWidget, reason: 'das Koppeln geht von selbst auf');
    expect(box.bitten, ['Handy'], reason: 'und die Box wird gleich gebeten, QR und Code zu zeigen');
    await tester.runAsync(() async {
      for (var i = 0; i < 50 && find.textContaining('Die Box zeigt jetzt').evaluate().isEmpty; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
        await tester.pump();
      }
    });
    expect(find.textContaining('Die Box zeigt jetzt QR und Code'), findsOneWidget);

    await tester.enterText(find.widgetWithText(TextField, 'Code (6 Ziffern)'), AttrappenBox.kopplungsCode);
    await tester.runAsync(() async {
      await tester.tap(find.widgetWithText(OutlinedButton, 'Koppeln'));
      for (var i = 0; i < 50 && stand.boxen.single.schluessel == null; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
        await tester.pump();
      }
    });
    await tester.pumpAndSettle();
    expect(stand.boxen.single.schluessel, AttrappenBox.schluessel);
    expect(stand.lage(stand.boxen.single.id).kopplungNoetig, isFalse);
    stand.taktAnhalten();
  });

  group('Medien verwalten', () {
    late AttrappenBox box;
    late BoxenStand stand;
    late BoxEintrag eintrag;

    /// Echte Asynchronitaet laufen lassen, bis [bis] wahr ist.
    Future<void> warten(WidgetTester tester, bool Function() bis) => tester.runAsync(() async {
      for (var i = 0; i < 100 && !bis(); i++) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
        await tester.pump();
      }
    });

    Future<void> aufbauen(WidgetTester tester) async {
      SharedPreferences.setMockInitialValues({});
      box = AttrappenBox();
      stand = BoxenStand(clientBauen: (b) => BoxClient(b, client: box.client()));
      eintrag = BoxEintrag(id: 'x', name: 'Testbox', adresse: 'x.local');
      stand.boxen.add(eintrag);
      await tester.pumpWidget(MaterialApp(home: MedienSeite(stand: stand, box: eintrag)));
      await warten(tester, () => find.text('Die Maus').evaluate().isNotEmpty);
    }

    testWidgets('zeigt die Medien der Box — und loescht erst beim zweiten Tippen', (tester) async {
      await aufbauen(tester);
      expect(find.text('Conni tanzt'), findsOneWidget);
      await tester.tap(find.text('Conni tanzt'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Löschen'));
      await tester.pump();
      expect(box.schreibwege, isEmpty, reason: 'das erste Tippen fragt nur');
      await tester.tap(find.text('Wirklich löschen'));
      await warten(tester, () => find.text('Conni tanzt').evaluate().isEmpty);
      await tester.pumpAndSettle();
      expect(box.schreibwege, ['DELETE lokal:t:conni|conni tanzt']);
      expect(find.text('Conni tanzt'), findsNothing);
      stand.taktAnhalten();
    });

    testWidgets('ein Kind ausschalten, das alles sieht: erst die Rueckfrage, dann schreiben', (tester) async {
      await aufbauen(tester);
      await tester.tap(find.text('Die Maus'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(SwitchListTile, 'Kalea'));
      await warten(tester, () => find.text('Wirklich?').evaluate().isNotEmpty);
      expect(find.textContaining('NUR noch dieses eine Werk'), findsOneWidget);
      expect(box.auswahl['kalea'], isNull, reason: 'vor dem Ja aendert sich nichts');
      await tester.tap(find.text('Ja'));
      await warten(tester, () => box.auswahl['kalea'] != null);
      expect(box.auswahl['kalea'], isNot(contains('spotify:abc')));
      stand.taktAnhalten();
    });

    testWidgets('ein geteilter Link: Hinweis der Box, Treffer, Hinzufügen', (tester) async {
      SharedPreferences.setMockInitialValues({});
      box = AttrappenBox();
      stand = BoxenStand(clientBauen: (b) => BoxClient(b, client: box.client()));
      eintrag = BoxEintrag(id: 'x', name: 'Testbox', adresse: 'x.local');
      stand.boxen.add(eintrag);
      final c = stand.client(eintrag);
      await tester.pumpWidget(
        MaterialApp(
          home: MedienSuchSeite(
            client: c,
            versuchen: <T>(Future<T> Function() tat) => tat(),
            auswahlen: const [],
            vorgabe: () => c.medienAusLink('https://open.spotify.com/track/xyz'),
          ),
        ),
      );
      await warten(tester, () => find.text('Die Reklamation').evaluate().isNotEmpty);
      expect(find.textContaining('einzelner Titel'), findsOneWidget);
      expect(find.byType(TextField), findsNothing, reason: 'kein Suchfeld, der Link steht fest');
      await tester.tap(find.byTooltip('Aufnehmen'));
      await warten(tester, () => box.schreibwege.isNotEmpty);
      expect(box.schreibwege, ['POST spotify:reklamation']);
      stand.taktAnhalten();
    });

    testWidgets('Aufnehmen gibt das Neue den Kindern frei, die nicht alles sehen', (tester) async {
      await aufbauen(tester);
      await tester.tap(find.text('Hinzufügen'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'Maus');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await warten(tester, () => find.text('Maus – Folge 1').evaluate().isNotEmpty);
      expect(find.text('nur Titel'), findsOneWidget, reason: 'einzelne Titel kann die Box nicht aufnehmen');
      await tester.tap(find.text('Hörbuch'));
      await tester.pump();
      await tester.tap(find.byTooltip('Aufnehmen'));
      await warten(tester, () => box.schreibwege.length >= 2);
      expect(box.medien.last['category'], 'audiobook');
      expect(box.schreibwege, ['POST spotify:neu1', 'AUSWAHL liam spotify:neu1 true']);
      stand.taktAnhalten();
    });

    testWidgets('wer es sehen soll, steht schon beim Aufnehmen fest', (tester) async {
      await aufbauen(tester);
      await tester.tap(find.text('Hinzufügen'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'Maus');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await warten(tester, () => find.text('Maus – Folge 1').evaluate().isNotEmpty);
      final kalea = tester.widget<FilterChip>(find.widgetWithText(FilterChip, 'Kalea (sieht alles)'));
      expect(kalea.onSelected, isNull, reason: 'wer alles sieht, wird hier nicht eingesperrt');
      await tester.tap(find.widgetWithText(FilterChip, 'Liam'));
      await tester.pump();
      await tester.tap(find.byTooltip('Aufnehmen'));
      await warten(tester, () => find.byIcon(Icons.check).evaluate().isNotEmpty);
      expect(box.schreibwege, ['POST spotify:neu1'], reason: 'Liam abgewaehlt — keine Freigabe');
      stand.taktAnhalten();
    });
  });
}

/// Legt „in den Download-Ordner", ohne Android: merkt sich Inhalt und Namen.
class _TestAblage extends Ablage {
  final List<(List<int>, String)> abgelegt = [];
  final _ordner = Directory.systemTemp.createTempSync('mixpi-ablage-');

  @override
  Future<File> zwischenDatei() async => File('${_ordner.path}/z-${abgelegt.length}.part');

  @override
  Future<String> inDownloads(File datei, String name) async {
    abgelegt.add((datei.readAsBytesSync(), name));
    await datei.delete();
    return 'Download/MixPiBox/$name';
  }
}
