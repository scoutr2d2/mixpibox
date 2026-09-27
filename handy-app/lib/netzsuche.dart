import 'dart:async';
import 'dart:io';

import 'box_client.dart';
import 'modell.dart';

/// Ein Fund der Netzsuche.
class Fund {
  const Fund(this.adresse, this.name);
  final String adresse;
  final String name;
}

/// Die eigenen IPv4-Netze des Handys als /24-Praefixe (`192.168.178.`).
///
/// /24 und nicht die echte Maske: `dart:io` kennt die Maske nicht, und ein
/// Heimnetz ist fast immer /24. Ein groesseres Netz findet die Suche nur zum
/// Teil — dann hilft `<name>.local` oder die IP von Hand.
Future<List<String>> eigeneNetze() async {
  final netze = <String>{};
  for (final nic in await NetworkInterface.list(type: InternetAddressType.IPv4)) {
    for (final a in nic.addresses) {
      if (a.isLoopback || a.isLinkLocal) continue;
      final teile = a.address.split('.');
      if (teile.length == 4) netze.add('${teile[0]}.${teile[1]}.${teile[2]}.');
    }
  }
  return netze.toList();
}

/// Fragt jede Adresse der eigenen /24-Netze nach `/api/box` auf Port 8200.
///
/// In Wellen zu je [parallel] Anfragen, damit das Handy nicht 254 Sockel auf
/// einmal oeffnet. Nur wer `box: "mixpibox"` antwortet, zaehlt als Fund.
Stream<Fund> netzDurchsuchen({int parallel = 32, Duration frist = const Duration(milliseconds: 1500)}) async* {
  final adressen = [
    for (final netz in await eigeneNetze())
      for (var i = 1; i < 255; i++) '$netz$i',
  ];
  for (var start = 0; start < adressen.length; start += parallel) {
    final welle = adressen.skip(start).take(parallel);
    final ergebnisse = await Future.wait(welle.map((a) => _pruefen(a, frist)));
    for (final f in ergebnisse) {
      if (f != null) yield f;
    }
  }
}

Future<Fund?> _pruefen(String adresse, Duration frist) async {
  final c = BoxClient(BoxEintrag(id: '', name: adresse, adresse: adresse), frist: frist);
  try {
    final name = await c.kennung();
    return name == null ? null : Fund(adresse, name.isEmpty ? adresse : name);
  } on BoxFehler {
    return null;
  } finally {
    c.schliessen();
  }
}
