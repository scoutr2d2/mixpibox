import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mixpibox_fernbedienung/main.dart';
import 'package:mixpibox_fernbedienung/zustand.dart';
import 'package:shared_preferences/shared_preferences.dart';

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
}
