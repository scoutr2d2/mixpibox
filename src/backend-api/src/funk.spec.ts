/**
 * Tests für die Funkschalter — und für die eine Bedingung, um die es geht.
 *
 * WARUM DIESE TESTS SO AUSSEHEN: Die Regel „WLAN darf nur aus, wenn die Box
 * danach noch erreichbar ist" lässt sich AN DER BOX nicht prüfen, ohne genau
 * das Risiko einzugehen, das sie verhindern soll. Deshalb liegt die Regel in
 * einem reinen Modul, und geprüft wird sie hier — mit der Lage, die an der
 * Box wirklich gemessen wurde (`wlan0` mit Adresse, `eth0` ohne, `carrier`
 * beim heruntergefahrenen `eth0` LEER, nicht '0').
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  adresseTraegt,
  anschlussOben,
  btPowerLesen,
  carrierLesen,
  funkAusFreigabe,
  GRUND_KEIN_ZWEITER_WEG,
  istLoopback,
  type SysZeile,
  vonDerBox,
  wegeBauen,
  wlanAnBefehle,
  wlanAusBefehle,
  zweiterWeg,
} from './funk'
import type { Schnittstelle } from './netzwerk'

const wlan0 = (adresse = '192.168.178.169'): Schnittstelle => ({
  name: 'wlan0',
  aktiv: true,
  funk: true,
  adressen: adresse ? [{ familie: 'v4', adresse, praefix: 24 }] : [],
})

const eth0 = (adresse = ''): Schnittstelle => ({
  name: 'eth0',
  aktiv: adresse !== '',
  funk: false,
  adressen: adresse ? [{ familie: 'v4', adresse, praefix: 24 }] : [],
})

/**
 * Was der Kernel zu einem Anschluss sagt — so, wie es an der Box aussieht.
 *
 * DAS `geraet: true` IST NICHT SCHMUCK. Ein Rueckweg muss echte Hardware sein;
 * ohne diese Angabe zaehlt `zweiterWeg` gar nichts, und zwar mit Absicht (kein
 * Wissen ist kein Freibrief). Deshalb steht sie hier ueberall, wo ein Weg
 * WIRKLICH einer sein soll — sonst pruefte der Test etwas anderes als die Box.
 */
const kabelSys = (oben: boolean): SysZeile => ({
  carrier: oben ? '1' : '',
  operstate: oben ? 'up' : 'down',
  geraet: true,
  funkSys: false,
})

const funkSys = (): SysZeile => ({ carrier: '1', operstate: 'up', geraet: true, funkSys: true })

describe('carrierLesen', () => {
  it("nimmt '1' als Kabel und '0' als kein Kabel", () => {
    assert.equal(carrierLesen('1\n'), true)
    assert.equal(carrierLesen('0\n'), false)
  })

  it('sagt bei leerer Datei „unbekannt" statt „kein Kabel"', () => {
    // AN DER BOX GEMESSEN: bei heruntergefahrenem eth0 ist /sys/.../carrier
    // leer (der Kernel antwortet mit EINVAL). Das als false zu lesen wäre eine
    // Behauptung — hier zählt der Unterschied zwischen „nein" und „weiß nicht".
    assert.equal(carrierLesen(''), null)
    assert.equal(carrierLesen(null), null)
    assert.equal(carrierLesen(undefined), null)
    assert.equal(carrierLesen('Invalid argument'), null)
  })
})

describe('wegeBauen', () => {
  it('setzt „trägt" nur bei einer Adresse — ein Kabel allein reicht nicht', () => {
    const wege = wegeBauen([wlan0(), eth0()], {
      wlan0: funkSys(),
      // Kabel steckt, aber keine Adresse: an dieser Box steht eth0 ohne
      // `auto`/`allow-hotplug` in /etc/network/interfaces und käme selbst
      // dann nicht von allein hoch.
      eth0: { carrier: '1', operstate: 'down', geraet: true },
    })
    assert.equal(wege.find((w) => w.name === 'eth0')?.kabel, true)
    assert.equal(wege.find((w) => w.name === 'eth0')?.traegt, false)
    assert.equal(wege.find((w) => w.name === 'wlan0')?.traegt, true)
  })

  it('kommt ohne sysfs-Angaben aus', () => {
    const wege = wegeBauen([wlan0()], {})
    assert.equal(wege[0].kabel, null)
    assert.equal(wege[0].zustand, 'up')
  })
})

describe('adresseTraegt / anschlussOben', () => {
  it('lässt eine gewöhnliche LAN-Adresse gelten', () => {
    assert.equal(adresseTraegt('192.168.178.42'), true)
    assert.equal(adresseTraegt('10.0.0.7'), true)
  })

  it('lässt 169.254.x.y NICHT gelten — da hat kein DHCP geantwortet', () => {
    assert.equal(adresseTraegt('169.254.7.9'), false)
    assert.equal(adresseTraegt('127.0.0.1'), false)
    assert.equal(adresseTraegt('0.0.0.0'), false)
    assert.equal(adresseTraegt(''), false)
  })

  it('zählt einen Anschluss ohne Träger als unten — auch mit Adresse', () => {
    assert.equal(anschlussOben(false, 'up'), false)
    assert.equal(anschlussOben(true, 'down'), false)
    assert.equal(anschlussOben(null, 'down'), false)
    assert.equal(anschlussOben(true, 'up'), true)
    // „unbekannt" darf keinen Rückweg kosten — manche Treiber melden nichts.
    assert.equal(anschlussOben(null, 'unknown'), true)
  })
})

describe('zweiterWeg', () => {
  it('zählt ein zweites WLAN NICHT — es geht mit aus', () => {
    const wege = wegeBauen(
      [
        wlan0(),
        {
          name: 'wlan1',
          aktiv: true,
          funk: true,
          adressen: [{ familie: 'v4', adresse: '192.168.178.170', praefix: 24 }],
        },
      ],
      {},
    )
    assert.equal(zweiterWeg(wege), null)
  })

  it('zählt ein Kabel mit Adresse', () => {
    const wege = wegeBauen([wlan0(), eth0('192.168.178.42')], { wlan0: funkSys(), eth0: kabelSys(true) })
    assert.equal(zweiterWeg(wege)?.name, 'eth0')
  })

  it('zählt eine Adresse OHNE Kabel nicht — sie steht nur noch da', () => {
    // DER FALL, DER DIE BOX AUSSPERRT: jemand steckt das Kabel, sieht den
    // Knopf, zieht es wieder — und klickt. Die per DHCP geholte Adresse bleibt
    // im Kernel stehen, bis ihre Laufzeit abläuft; `ip addr` zeigt sie noch,
    // erreichbar ist die Box darüber nicht mehr.
    const wege = wegeBauen([wlan0(), eth0('192.168.178.42')], { wlan0: funkSys(), eth0: kabelSys(false) })
    assert.equal(wege.find((w) => w.name === 'eth0')?.traegt, false)
    assert.equal(zweiterWeg(wege), null)
  })

  it('zählt 169.254.x.y nicht — das ist der Beweis, dass kein DHCP antwortete', () => {
    const wege = wegeBauen([wlan0(), eth0('169.254.7.9')], { wlan0: funkSys(), eth0: kabelSys(true) })
    assert.equal(zweiterWeg(wege), null)
  })

  it('zählt einen Tunnel nicht — er läuft selbst über das WLAN', () => {
    // tun0/wg0/docker0/br-… haben eine Adresse und sind kein Funk. Sie als
    // Rückweg zu zählen hiesse, den Rückweg mit abzuschalten. Der Kernel
    // unterscheidet sie zuverlässig: kein `device`.
    const tun: Schnittstelle = {
      name: 'tun0',
      aktiv: true,
      funk: false,
      adressen: [{ familie: 'v4', adresse: '10.8.0.6', praefix: 24 }],
    }
    const wege = wegeBauen([wlan0(), tun], {
      wlan0: funkSys(),
      tun0: { carrier: '1', operstate: 'unknown', geraet: false },
    })
    assert.equal(wege.find((w) => w.name === 'tun0')?.traegt, true, 'die Adresse steht, das ist nicht der Punkt')
    assert.equal(wege.find((w) => w.name === 'tun0')?.eigenstaendig, false)
    assert.equal(zweiterWeg(wege), null)
  })

  it('glaubt dem Kernel, wenn ein Adapter nicht wl… heisst', () => {
    const ra0: Schnittstelle = {
      name: 'ra0',
      aktiv: true,
      funk: false,
      adressen: [{ familie: 'v4', adresse: '192.168.178.50', praefix: 24 }],
    }
    const wege = wegeBauen([ra0], { ra0: { carrier: '1', operstate: 'up', geraet: true, funkSys: true } })
    assert.equal(wege[0].funk, true, 'phy80211 ist der Beleg, der Name nur der Verdacht')
    assert.equal(zweiterWeg(wege), null)
  })

  it('zählt nichts, wenn sysfs nichts hergibt — kein Wissen ist kein Freibrief', () => {
    assert.equal(zweiterWeg(wegeBauen([wlan0(), eth0('192.168.178.42')], {})), null)
  })
})

describe('funkAusFreigabe — die Bedingung', () => {
  it('verbietet es, wenn die Box nur am WLAN hängt (die Lage dieser Box)', () => {
    const wege = wegeBauen([wlan0(), eth0()], { wlan0: funkSys(), eth0: kabelSys(false) })
    const f = funkAusFreigabe(wege, false)
    assert.equal(f.erlaubt, false)
    assert.equal(f.grund, GRUND_KEIN_ZWEITER_WEG)
    assert.equal(f.ueber, null)
  })

  it('erlaubt es mit Kabel — und nennt die Adresse, unter der die Box bleibt', () => {
    const wege = wegeBauen([wlan0(), eth0('192.168.178.42')], { wlan0: funkSys(), eth0: kabelSys(true) })
    const f = funkAusFreigabe(wege, false)
    assert.equal(f.erlaubt, true)
    assert.equal(f.ueber?.adresse, '192.168.178.42')
    assert.match(f.grund, /192\.168\.178\.42/)
    // Der Satz muss auch sagen, dass die EIGENE Sitzung trotzdem abreißt,
    // wenn man über WLAN verbunden ist.
    assert.match(f.grund, /über WLAN/)
    assert.equal(f.nurVorOrt, false)
  })

  it('erlaubt es ohne Kabel nur von der Box selbst — und sagt das dazu', () => {
    const wege = wegeBauen([wlan0()], { wlan0: funkSys() })
    const f = funkAusFreigabe(wege, true)
    assert.equal(f.erlaubt, true)
    assert.equal(f.nurVorOrt, true)
    assert.match(f.grund, /von der Box selbst/)
  })

  it('nimmt das Kabel, wenn beides zutrifft — es ist der bessere Grund', () => {
    const wege = wegeBauen([wlan0(), eth0('192.168.178.42')], { wlan0: funkSys(), eth0: kabelSys(true) })
    assert.equal(funkAusFreigabe(wege, true).nurVorOrt, false)
  })

  it('verbietet es auch, wenn gar keine Schnittstelle bekannt ist', () => {
    // Kein Wissen ist kein Freibrief: wer nicht sagen kann, dass ein zweiter
    // Weg da ist, darf nicht abschalten.
    assert.equal(funkAusFreigabe([], false).erlaubt, false)
  })
})

describe('istLoopback / vonDerBox', () => {
  it('erkennt die ganze 127er-Familie und ::1', () => {
    assert.equal(istLoopback('127.0.0.1'), true)
    assert.equal(istLoopback('127.1.2.3'), true)
    assert.equal(istLoopback('::1'), true)
    assert.equal(istLoopback('::ffff:127.0.0.1'), true)
  })

  it('erkennt fremde Adressen nicht als Box', () => {
    assert.equal(istLoopback('192.168.178.20'), false)
    assert.equal(istLoopback('1.127.0.0'), false)
    assert.equal(istLoopback(''), false)
    assert.equal(istLoopback(undefined), false)
  })

  it('verlangt beides: Loopback UND ein ausdrückliches vorOrt', () => {
    assert.equal(vonDerBox('127.0.0.1', true), true)
    // Ohne Absicht: ein Klick in einer alten Oberfläche darf die Box nicht
    // aus dem Netz nehmen, bloß weil er zufällig von 127.0.0.1 kommt.
    assert.equal(vonDerBox('127.0.0.1', undefined), false)
    assert.equal(vonDerBox('127.0.0.1', 'ja'), false)
    // Und die Absicht allein reicht erst recht nicht.
    assert.equal(vonDerBox('192.168.178.20', true), false)
  })
})

describe('btPowerLesen', () => {
  it('liest „Powered: yes" (BlueZ 5.82, an der Box abgelesen)', () => {
    const roh = [
      'Controller 00:15:83:F9:C5:4F (public)',
      '\tName: mupibox #1',
      '\tPowered: yes',
      '\tPowerState: on',
      '\tDiscoverable: no',
    ].join('\n')
    assert.equal(btPowerLesen(roh), true)
  })

  it('liest „Powered: no"', () => {
    assert.equal(btPowerLesen('\tPowered: no\n\tPowerState: off\n'), false)
  })

  it('fällt auf PowerState zurück, wenn Powered fehlt', () => {
    assert.equal(btPowerLesen('\tPowerState: off\n'), false)
    assert.equal(btPowerLesen('\tPowerState: on\n'), true)
  })

  it('sagt „unbekannt" statt „aus", wenn nichts dasteht', () => {
    assert.equal(btPowerLesen(''), null)
    assert.equal(btPowerLesen('No default controller available'), null)
  })
})

describe('Schaltbefehle', () => {
  it('nimmt bei ifupdown ifdown --force zum Abschalten', () => {
    const b = wlanAusBefehle('wlan0', 'ifupdown')
    assert.deepEqual(b[0].args, ['-n', '/sbin/ifdown', '--force', 'wlan0'])
  })

  it('schaltet mit ifup wieder ein — und hebt vorher die Schnittstelle', () => {
    // Die Rückrichtung ist der Grund für ifupdown: ohne `ifup` gäbe es kein
    // DHCP und damit keine Adresse. Der `ip link up`-Schritt davor fängt den
    // Fall ab, dass ifstate die Schnittstelle noch als oben führt.
    const b = wlanAnBefehle('wlan0', 'ifupdown')
    assert.equal(b.length, 2)
    assert.deepEqual(b[1].args, ['-n', '/sbin/ifup', 'wlan0'])
    assert.ok(b.every((x) => x.weich))
  })

  it('hat für jeden Aus-Befehl einen An-Befehl — keine Einbahnstraße', () => {
    for (const weg of ['ifupdown', 'ip'] as const) {
      assert.ok(wlanAusBefehle('wlan0', weg).length > 0)
      assert.ok(wlanAnBefehle('wlan0', weg).length > 0)
    }
  })

  it('ruft immer sudo -n auf — der Dienst läuft als dietpi, nicht als root', () => {
    const alle = [
      ...wlanAusBefehle('wlan0', 'ifupdown'),
      ...wlanAnBefehle('wlan0', 'ifupdown'),
      ...wlanAusBefehle('wlan0', 'ip'),
      ...wlanAnBefehle('wlan0', 'ip'),
    ]
    for (const b of alle) {
      assert.equal(b.befehl, 'sudo')
      assert.equal(b.args[0], '-n')
    }
  })
})
