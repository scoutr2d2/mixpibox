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
import 'package:mixpibox_fernbedienung/seiten/kinderzeit_seite.dart';
import 'package:mixpibox_fernbedienung/seiten/medien_seite.dart';
import 'package:mixpibox_fernbedienung/seiten/sicherung_seite.dart';
import 'package:mixpibox_fernbedienung/seiten/sperren.dart';
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

  group('Eltern: sperren, Kinderzeit, Sicherung', elternTests);

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
/// Sperren, Kinderzeit, Sicherung — die Eltern-Seiten (28.09.2026).
void elternTests() {
  late AttrappenBox box;
  late BoxenStand stand;
  late BoxEintrag eintrag;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    box = AttrappenBox();
    stand = BoxenStand(clientBauen: (b) => BoxClient(b, client: box.client()));
    eintrag = BoxEintrag(id: 'x', name: 'Testbox', adresse: 'x.local');
    stand.boxen.add(eintrag);
  });
  tearDown(() => stand.taktAnhalten());

  /// Echte Asynchronitaet (Dateien) laufen lassen, bis [bis] wahr ist.
  Future<void> warten(WidgetTester tester, bool Function() bis) => tester.runAsync(() async {
    for (var i = 0; i < 150 && !bis(); i++) {
      await Future<void>.delayed(const Duration(milliseconds: 20));
      await tester.pump();
    }
  });

  test('„bis 7 Uhr" um 1 Uhr nachts heisst heute frueh, um 20 Uhr morgen frueh', () {
    expect(naechsteUhrzeit(DateTime(2026, 9, 28, 1), 7, 0), DateTime(2026, 9, 28, 7));
    expect(naechsteUhrzeit(DateTime(2026, 9, 28, 20), 7, 0), DateTime(2026, 9, 29, 7));
    expect(naechsteUhrzeit(DateTime(2026, 9, 28, 7), 7, 0), DateTime(2026, 9, 29, 7), reason: 'genau jetzt ist vorbei');
  });

  testWidgets('Sperren: Schloss oben, 30 Minuten, Streifen auf „Jetzt" — und wieder aufheben', (tester) async {
    await tester.runAsync(() => stand.eineAktualisieren(eintrag));
    await tester.pumpWidget(MaterialApp(home: BoxSeite(stand: stand, box: eintrag)));
    await tester.pump();
    expect(find.byType(SperrStreifen), findsNothing);
    await tester.tap(find.byTooltip('Box sperren'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('30 Minuten'));
    await tester.pumpAndSettle();
    expect(box.schreibwege, ['SPERRE 30']);
    expect(find.byType(SperrStreifen), findsOneWidget, reason: 'die Seite fragt nach dem Sperren sofort neu');
    // Kein fester Pixelwert (die Testschrift ist breiter als jede echte):
    // der Streifen darf nur nicht den Schirm fuellen.
    expect(tester.getSize(find.byType(SperrStreifen)).height, lessThan(tester.view.physicalSize.height / tester.view.devicePixelRatio / 3));
    expect(find.byTooltip('Gesperrt — ändern'), findsOneWidget);

    await tester.tap(find.byTooltip('Gesperrt — ändern'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sperre aufheben'));
    await tester.pumpAndSettle();
    expect(box.schreibwege, ['SPERRE 30', 'ENTSPERRT']);
    expect(find.byType(SperrStreifen), findsNothing);
    expect(find.byTooltip('Box sperren'), findsOneWidget);
  });

  testWidgets('Kinderzeit: sieben Tage, Mittwoch zur Hoerpause, erst Speichern schreibt', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.75;
    addTearDown(tester.view.reset);
    final montagAbend = DateTime(2026, 9, 28, 18); // ein Montag
    await tester.pumpWidget(MaterialApp(home: KinderzeitSeite(stand: stand, box: eintrag, jetzt: () => montagAbend)));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    for (final t in ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']) {
      expect(find.text(t), findsOneWidget);
    }
    expect(find.text('Pause'), findsOneWidget, reason: 'Sonntag ist gesperrt');
    expect(find.text('∞'), findsOneWidget, reason: 'Samstag ohne Minutengrenze');
    expect(find.text('1 h'), findsNWidgets(5));
    expect(find.text('darf hören (bis 19:30)'), findsOneWidget, reason: 'der Stand von heute');

    await tester.tap(find.byKey(const ValueKey('kz-tag-mi')));
    await tester.pumpAndSettle();
    expect(find.text('Mittwoch'), findsOneWidget);
    await tester.tap(find.widgetWithText(SwitchListTile, 'Darf hören'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Übernehmen'));
    await tester.pumpAndSettle();
    expect(find.text('Pause'), findsNWidgets(2));
    expect(box.schreibwege, isEmpty, reason: 'nichts geht zur Box, bevor gespeichert wird');

    await tester.tap(find.text('Speichern'));
    await tester.pumpAndSettle();
    expect(box.schreibwege, ['KZ haus']);
    expect(box.kzStandard['tage']['mi']['frei'], false);
    expect(box.kzStandard['tage']['mo']['minuten'], 60, reason: 'die anderen Tage bleiben');
  });

  testWidgets('Kinderzeit: ein Tag fuer Mo–Fr uebernommen', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.75;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(home: KinderzeitSeite(stand: stand, box: eintrag)));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('kz-tag-mo')));
    await tester.pumpAndSettle();
    // Grenze „bis" entfernen: dann gilt der Tag bis Mitternacht.
    await tester.tap(find.byTooltip('Grenze entfernen').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Für Mo–Fr'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Speichern'));
    await tester.pumpAndSettle();
    for (final t in ['mo', 'di', 'mi', 'do', 'fr']) {
      expect(box.kzStandard['tage'][t]['bis'], '', reason: t);
    }
    expect(box.kzStandard['tage']['sa']['bis'], '19:30', reason: 'das Wochenende bleibt');
  });

  testWidgets('Kinderzeit: ein Kind ohne eigene Regeln folgt der Hausregel — eigene erst auf Wunsch', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.75;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(home: KinderzeitSeite(stand: stand, box: eintrag)));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ChoiceChip, 'Lena'));
    await tester.pumpAndSettle();
    expect(find.text('Lena folgt der Hausregel'), findsOneWidget);
    // Vor dem Umbau war die Karte 1072 px hoch — hoeher als der ganze Schirm.
    expect(
      tester.getSize(find.byType(Card).first).height,
      lessThan(tester.view.physicalSize.height / tester.view.devicePixelRatio / 3),
      reason: 'der Hinweis darf die Woche nicht aus dem Bild schieben',
    );
    await tester.tap(find.byKey(const ValueKey('kz-tag-mo')));
    await tester.pumpAndSettle();
    expect(find.text('Montag'), findsNothing, reason: 'die Hausregel wird hier nicht still kopiert');
    await tester.tap(find.text('Eigene Regeln'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Speichern'));
    await tester.pumpAndSettle();
    expect(box.kzJe.keys, ['lena']);
    expect(box.schreibwege, ['KZ lena'], reason: 'die Hausregel wurde nicht angefasst');
  });

  testWidgets('Kinderzeit an einer Box ohne /satz: nur die Hausregel, keine Kinder zur Wahl', (tester) async {
    box.ohneSatz = true;
    await tester.pumpWidget(MaterialApp(home: KinderzeitSeite(stand: stand, box: eintrag)));
    await tester.pumpAndSettle();
    expect(find.text('Nur die Hausregel'), findsOneWidget);
    expect(find.byType(ChoiceChip), findsNothing);
    expect(find.text('Pause'), findsOneWidget, reason: 'die echte Woche der Box, Sonntag gesperrt');
  });

  testWidgets('Sicherung: anlegen legt eine .tar.gz ab; zurueckspielen erst nach der Vorschau, dann Neustart', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.75;
    addTearDown(tester.view.reset);
    final ablage = _TestAblage();
    await tester.pumpWidget(MaterialApp(home: SicherungSeite(stand: stand, box: eintrag, ablage: ablage)));
    await tester.pumpAndSettle();
    expect(find.text('Jetzt sichern'), findsOneWidget);

    // FERTIG HEISST: abgelegt UND kein Kreisel mehr — die Zwischendatei wird
    // echt geloescht, und das laeuft nur in `warten` (runAsync).
    bool ruhig() => find.byType(CircularProgressIndicator).evaluate().isEmpty;
    await tester.tap(find.text('Jetzt sichern'));
    await warten(tester, () => ablage.abgelegt.isNotEmpty && ruhig());
    await tester.pumpAndSettle();
    expect(ablage.abgelegt.single.$2, 'mupibox-sicherung-kinderzimmer-20260928200000.tar.gz');
    expect(ablage.arten.single, 'application/gzip', reason: 'eine Sicherung ist kein ZIP');

    ablage.zuWaehlen = File('${Directory.systemTemp.createTempSync('mixpi-wahl-').path}/w.tar.gz')
      ..writeAsBytesSync([0x1f, 0x8b, 1, 2]);
    await tester.tap(find.text('Datei wählen …'));
    await warten(tester, () => find.widgetWithText(FilledButton, 'Zurückspielen').evaluate().isNotEmpty);
    await tester.pumpAndSettle();
    expect(find.textContaining('anderen Box'), findsOneWidget, reason: 'die Warnung der Box steht in der Vorschau');
    expect(box.eingespielt, isEmpty, reason: 'bis hier ist nichts eingespielt');
    expect(ablage.zuWaehlen!.existsSync(), false, reason: 'die Kopie auf dem Handy ist aufgeraeumt');

    await tester.tap(find.widgetWithText(FilledButton, 'Zurückspielen'));
    await warten(tester, () => find.text('Zurückgespielt').evaluate().isNotEmpty);
    await tester.pumpAndSettle();
    expect(box.eingespielt.single, {'kennung': 'b' * 64, 'mitZugangsdaten': false});
    expect(find.text('• WLAN-Passwort'), findsOneWidget);
    await tester.tap(find.text('Jetzt neu starten'));
    await warten(tester, () => box.schreibwege.contains('NEUSTART'));
    expect(box.schreibwege, contains('NEUSTART'));
    await tester.pumpAndSettle();

    // Unten: die Staende, die schon auf der Box liegen — mit Grund in Worten.
    await tester.scrollUntilVisible(find.textContaining('automatisch'), 200);
    expect(find.text('Stände auf der Box (1)'), findsOneWidget);
    await tester.tap(find.byTooltip('Aufs Handy holen'));
    await warten(tester, () => ablage.abgelegt.length == 2 && ruhig());
    expect(ablage.abgelegt.last.$2, box.staende.single['name']);
  });
}

class _TestAblage extends Ablage {
  final List<(List<int>, String)> abgelegt = [];
  final _ordner = Directory.systemTemp.createTempSync('mixpi-ablage-');

  @override
  Future<File> zwischenDatei() async => File('${_ordner.path}/z-${abgelegt.length}.part');

  final List<String> arten = [];

  /// Was `waehlen` zurueckgibt — null heisst: abgebrochen.
  File? zuWaehlen;

  @override
  Future<({File datei, String name})?> waehlen() async {
    final f = zuWaehlen;
    return f == null ? null : (datei: f, name: 'sicherung.tar.gz');
  }

  @override
  Future<String> inDownloads(File datei, String name, {String mime = 'application/zip'}) async {
    arten.add(mime);
    abgelegt.add((datei.readAsBytesSync(), name));
    await datei.delete();
    return 'Download/MixPiBox/$name';
  }
}
