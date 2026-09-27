import 'package:flutter_test/flutter_test.dart';
import 'package:mixpibox_fernbedienung/netzsuche.dart';

void main() {
  test('nur Heimnetze werden durchsucht, kein Mobilfunk-NAT', () {
    expect(istHeimnetz('192.168.178.20'), isTrue);
    expect(istHeimnetz('10.0.0.5'), isTrue);
    expect(istHeimnetz('172.16.1.1'), isTrue);
    expect(istHeimnetz('172.31.255.1'), isTrue);
    expect(istHeimnetz('172.32.0.1'), isFalse);
    expect(istHeimnetz('100.64.12.3'), isFalse, reason: 'Mobilfunk-NAT');
    expect(istHeimnetz('8.8.8.8'), isFalse);
    expect(istHeimnetz('kaputt'), isFalse);
  });
}
