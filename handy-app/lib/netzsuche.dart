import 'dart:async';
import 'dart:io';

import 'package:http/io_client.dart';

import 'box_client.dart';
import 'modell.dart';

/// Ein Fund der Netzsuche.
class Fund {
  const Fund(this.adresse, this.name);
  final String adresse;
  final String name;
}

/// Wie weit die Suche ist — fuer die Anzeige „x von y".
class SuchStand {
  const SuchStand(this.geprueft, this.gesamt);
  final int geprueft;
  final int gesamt;
}

/// Schnittstellen, hinter denen keine Box steht: Mobilfunk (Qualcomm
/// `rmnet*`, MediaTek `ccmni*`, Samsung `pdp*`), VPN-Tunnel, PPP. Erste
/// Rueckmeldung vom Handy (27.09.2026): „die Box wurde erkannt, aber es
/// kringelt ohne Ende". Jedes zusaetzliche /24 kostet eine volle Runde, und
/// das Mobilfunknetz ist fast immer eines davon — ob DAS der Kringel war, ist
/// nicht belegt; die Suche zeigt seitdem ihren Fortschritt.
const _fremdeSchnittstellen = ['rmnet', 'ccmni', 'pdp', 'tun', 'ppp', 'v4-', 'dummy', 'clat'];

/// Nur Heimnetz-Bereiche (RFC 1918). 100.64/10 (Mobilfunk-NAT) und alles
/// Oeffentliche faellt heraus.
bool istHeimnetz(String ip) {
  final t = ip.split('.').map(int.tryParse).toList();
  if (t.length != 4 || t.contains(null)) return false;
  final a = t[0]!, b = t[1]!;
  return a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168);
}

/// Die eigenen Heimnetze des Handys als /24-Praefixe (`192.168.178.`),
/// WLAN (`wlan*`) zuerst.
///
/// /24 und nicht die echte Maske: `dart:io` kennt die Maske nicht, und ein
/// Heimnetz ist fast immer /24. Ein groesseres Netz findet die Suche nur zum
/// Teil — dann hilft `<name>.local` oder die IP von Hand.
Future<List<String>> eigeneNetze() async {
  final wlan = <String>{};
  final sonst = <String>{};
  for (final nic in await NetworkInterface.list(type: InternetAddressType.IPv4)) {
    final name = nic.name.toLowerCase();
    if (_fremdeSchnittstellen.any(name.startsWith)) continue;
    for (final a in nic.addresses) {
      if (a.isLoopback || a.isLinkLocal || !istHeimnetz(a.address)) continue;
      final teile = a.address.split('.');
      (name.startsWith('wlan') ? wlan : sonst).add('${teile[0]}.${teile[1]}.${teile[2]}.');
    }
  }
  return [...wlan, ...sonst.difference(wlan)];
}

/// Fragt jede Adresse der eigenen /24-Netze nach `/api/box` auf Port 8200.
///
/// In Wellen zu je [parallel] Anfragen, damit das Handy nicht 254 Sockel auf
/// einmal oeffnet. Nur wer `box: "mixpibox"` antwortet, zaehlt als Fund.
/// Die Suche ENDET immer: jede Probe hat eine harte Frist, auch fuer den
/// Verbindungsaufbau (sonst haengen tote Adressen im Hintergrund weiter).
Stream<Fund> netzDurchsuchen({
  int parallel = 48,
  Duration frist = const Duration(milliseconds: 1200),
  void Function(SuchStand)? fortschritt,
}) async* {
  final adressen = [
    for (final netz in await eigeneNetze())
      for (var i = 1; i < 255; i++) '$netz$i',
  ];
  fortschritt?.call(SuchStand(0, adressen.length));
  for (var start = 0; start < adressen.length; start += parallel) {
    final welle = adressen.skip(start).take(parallel);
    final ergebnisse = await Future.wait(welle.map((a) => _pruefen(a, frist)));
    fortschritt?.call(SuchStand(start + welle.length, adressen.length));
    for (final f in ergebnisse) {
      if (f != null) yield f;
    }
  }
}

Future<Fund?> _pruefen(String adresse, Duration frist) async {
  final hc = HttpClient()..connectionTimeout = frist;
  final c = BoxClient(BoxEintrag(id: '', name: adresse, adresse: adresse), client: IOClient(hc), frist: frist);
  try {
    final name = await c.kennung();
    return name == null ? null : Fund(adresse, name.isEmpty ? adresse : name);
  } catch (_) {
    // Jede Absage heisst hier nur „keine Box" — die Suche darf daran nicht sterben.
    return null;
  } finally {
    c.schliessen();
  }
}
