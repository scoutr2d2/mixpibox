/**
 * Tests für die Bluetooth-Verwaltung.
 *
 * Die Ausgaben stammen ABGESCHRIEBEN von der echten Box (Pi 5, BlueZ 5.82),
 * nicht aus der Vorstellung — inklusive des chinesischen Lautsprechernamens
 * und der namenlosen Streuer, die eine Suche dort wirklich findet.
 *
 * Wichtigster Test: istMac. Genau dort hatte bluetooth.php sein Loch
 * ($_POST['bt_device'] wanderte unquotiert in einen sudo-Aufruf).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AKTIONEN,
  BEFEHL,
  type Funkadapter,
  adapterBezeichnung,
  adapterListe,
  besserenFinden,
  bewerteAdapter,
  parseAdapter,
  SUCHE_MAX,
  SUCHE_MIN,
  SUCHE_VORGABE,
  art,
  ergebnis,
  istAktion,
  istMac,
  istNamenlos,
  macNormal,
  ohneSelectFehlzeile,
  parseDevices,
  parseInfo,
  parseShow,
  sortiert,
  suchdauer,
  akkuAus,
  parseCodecs,
} from './bluetooth.js'

describe('istMac — die Stelle, an der die alte Seite ihr Loch hatte', () => {
  it('nimmt echte Adressen an', () => {
    for (const m of ['00:9E:C8:61:1A:EA', '7c:e7:12:af:5c:83', 'FF:FF:FF:FF:FF:FF'])
      assert.equal(istMac(m), true, m)
  })

  it('weist alles ab, was einen Befehl anhängen könnte', () => {
    for (const m of [
      '00:9E:C8:61:1A:EA; reboot',
      '00:9E:C8:61:1A:EA && rm -rf /',
      '$(reboot)',
      '`reboot`',
      '00:9E:C8:61:1A:EA\nreboot',
      '00:9E:C8:61:1A:EA ',
      ' 00:9E:C8:61:1A:EA',
    ])
      assert.equal(istMac(m), false, JSON.stringify(m))
  })

  it('weist alles ab, was keine Adresse ist', () => {
    for (const m of [
      '00:9E:C8:61:1A',
      '00:9E:C8:61:1A:EA:FF',
      '00-9E-C8-61-1A-EA',
      'ZZ:9E:C8:61:1A:EA',
      '',
      null,
      undefined,
      42,
      {},
    ])
      assert.equal(istMac(m), false, String(m))
  })

  it('normalisiert auf Großbuchstaben, wie BlueZ es meldet', () => {
    assert.equal(macNormal('7c:e7:12:af:5c:83'), '7C:E7:12:AF:5C:83')
  })
})

describe('istAktion / BEFEHL', () => {
  it('kennt genau die fünf', () => {
    assert.deepEqual([...AKTIONEN], ['koppeln', 'verbinden', 'trennen', 'vertrauen', 'entfernen'])
    for (const a of AKTIONEN) {
      assert.equal(istAktion(a), true, a)
      assert.equal(typeof BEFEHL[a], 'string', a)
    }
  })

  it('weist alles andere ab, auch die Prototypenkette', () => {
    for (const x of ['pair', 'remove', 'toString', '__proto__', '', null, 42])
      assert.equal(istAktion(x), false, String(x))
  })
})

describe('parseDevices', () => {
  // Wörtlich von der Box.
  const echt = [
    'Device 27:66:09:E8:33:74 27-66-09-E8-33-74',
    'Device 48:CA:43:DA:0A:E9 QMN000BZP4N8H1L6',
    'Device 7C:E7:12:AF:5C:83 HM_B2500_5c83',
    'Device 00:9E:C8:61:1A:EA 小米蓝牙音箱',
  ].join('\n')

  it('liest Adresse und Namen', () => {
    const g = parseDevices(echt)
    assert.equal(g.length, 4)
    assert.equal(g[3].mac, '00:9E:C8:61:1A:EA')
    assert.equal(g[3].name, '小米蓝牙音箱', 'nicht-lateinische Namen müssen durchkommen')
  })

  it('erkennt die namenlosen Streuer', () => {
    const g = parseDevices(echt)
    assert.equal(g[0].namenlos, true, 'Name ist nur die eigene Adresse')
    assert.equal(g[1].namenlos, false)
    assert.equal(g[3].namenlos, false)
  })

  it('verträgt Namen mit Leerzeichen', () => {
    const g = parseDevices('Device AA:BB:CC:DD:EE:FF Bose QC 35 II')
    assert.equal(g[0].name, 'Bose QC 35 II')
  })

  it('ignoriert alles, was keine Geräte-Zeile ist', () => {
    assert.deepEqual(parseDevices(''), [])
    assert.deepEqual(parseDevices('Discovery started\n[CHG] Controller ... Discovering: yes'), [])
  })
})

describe('istNamenlos', () => {
  it('erkennt die Adress-Ersatznamen von BlueZ', () => {
    assert.equal(istNamenlos('28:0D:B6:85:BD:80', '28-0D-B6-85-BD-80'), true)
    assert.equal(istNamenlos('28:0D:B6:85:BD:80', '28:0d:b6:85:bd:80'), true)
    assert.equal(istNamenlos('28:0D:B6:85:BD:80', ''), true)
  })

  it('lässt echte Namen in Ruhe', () => {
    assert.equal(istNamenlos('00:9E:C8:61:1A:EA', '小米蓝牙音箱'), false)
    assert.equal(istNamenlos('7C:E7:12:AF:5C:83', 'HM_B2500_5c83'), false)
  })
})

describe('parseInfo', () => {
  // Wörtlich von der Box.
  const echt = [
    'Device 00:9E:C8:61:1A:EA (public)',
    '\tName: 小米蓝牙音箱',
    '\tAlias: 小米蓝牙音箱',
    '\tClass: 0x0024041c (2360348)',
    '\tIcon: audio-card',
    '\tPaired: no',
    '\tBonded: no',
    '\tTrusted: yes',
    '\tConnected: no',
    '\tUUID: Audio Sink                (0000110b-0000-1000-8000-00805f9b34fb)',
  ].join('\n')

  it('liest die Zustände', () => {
    const i = parseInfo(echt)
    assert.equal(i.gekoppelt, false)
    assert.equal(i.verbunden, false)
    assert.equal(i.vertraut, true)
    assert.equal(i.name, '小米蓝牙音箱')
  })

  it('erkennt einen Lautsprecher am Icon', () => {
    assert.equal(parseInfo(echt).art, 'lautsprecher')
  })

  it('meldet Fehlendes als „weiß nicht", nicht als nein', () => {
    // undefined und false sind verschiedene Aussagen.
    const i = parseInfo('Device AA:BB:CC:DD:EE:FF (public)\n\tName: X')
    assert.equal(i.gekoppelt, undefined)
    assert.equal(i.verbunden, undefined)
  })

  it('lässt sich von UUID-Zeilen nicht durcheinanderbringen', () => {
    const i = parseInfo(echt)
    assert.equal(i.name, '小米蓝牙音箱', 'nicht von der UUID-Zeile überschrieben')
  })

  it('verträgt Leeres', () => {
    assert.deepEqual(parseInfo('').gekoppelt, undefined)
  })
})

describe('art', () => {
  it('erkennt am Icon', () => {
    assert.equal(art('audio-card'), 'lautsprecher')
    assert.equal(art('audio-headset'), 'kopfhoerer')
    assert.equal(art('phone'), 'telefon')
    assert.equal(art('input-keyboard'), 'eingabe')
    assert.equal(art('computer'), 'rechner')
  })

  it('fällt auf die Geräteklasse zurück', () => {
    // 0x0024041c -> Hauptklasse 0x04 = Audio/Video
    assert.equal(art(undefined, 0x0024041c), 'lautsprecher')
    assert.equal(art(undefined, 0x000200), 'telefon')
  })

  it('sagt „unbekannt" statt zu raten', () => {
    assert.equal(art(), 'unbekannt')
    assert.equal(art('etwas-anderes'), 'unbekannt')
  })
})

describe('parseShow', () => {
  const echt = [
    'Controller 88:A2:9E:48:F6:50 mupibox [default]',
    '\tAlias: mupibox',
    '\tPowered: yes',
    '\tDiscoverable: no',
    '\tDiscovering: no',
  ].join('\n')

  it('liest den Adapter', () => {
    const a = parseShow(echt)
    assert.equal(a?.mac, '88:A2:9E:48:F6:50')
    assert.equal(a?.name, 'mupibox')
    assert.equal(a?.an, true)
    assert.equal(a?.sucht, false)
    assert.equal(a?.sichtbar, false)
  })

  it('meldet null, wenn es keinen Adapter gibt', () => {
    assert.equal(parseShow(''), null)
    assert.equal(parseShow('No default controller available'), null)
  })
})

describe('sortiert', () => {
  it('stellt Verbundenes nach oben und Namenloses nach unten', () => {
    const g = sortiert([
      { mac: 'A', name: 'namenlos', namenlos: true },
      { mac: 'B', name: 'Bekannt', gekoppelt: true },
      { mac: 'C', name: 'Cinch' },
      { mac: 'D', name: 'Dose', verbunden: true },
    ])
    assert.deepEqual(
      g.map((x) => x.name),
      ['Dose', 'Bekannt', 'Cinch', 'namenlos'],
    )
  })

  it('lässt die Eingabe unangetastet', () => {
    const ein = [
      { mac: 'B', name: 'B' },
      { mac: 'A', name: 'A' },
    ]
    sortiert(ein)
    assert.equal(ein[0].name, 'B')
  })
})

describe('suchdauer', () => {
  it('hält sich in vernünftigen Grenzen', () => {
    assert.equal(suchdauer(10), 10)
    assert.equal(suchdauer(1), SUCHE_MIN)
    assert.equal(suchdauer(9999), SUCHE_MAX)
  })

  it('fällt bei Unsinn auf die Vorgabe zurück', () => {
    for (const x of ['', 'lang', null, undefined, Number.NaN])
      assert.equal(suchdauer(x), SUCHE_VORGABE, String(x))
  })
})

describe('ergebnis', () => {
  it('erkennt Erfolg', () => {
    assert.equal(ergebnis('Attempting to pair with 00:11\nPairing successful').ok, true)
    assert.equal(ergebnis('Connection successful').ok, true)
    assert.equal(ergebnis('[CHG] Device X Trusted: yes\nChanging X trust succeeded').ok, true)
  })

  it('erkennt die Fehlermeldungen, die BlueZ wirklich schickt', () => {
    // Genau diese Zeile kam auf der Box zurueck.
    const e = ergebnis('Device 03:BE:C9:23:41:AC not available')
    assert.equal(e.ok, false)
    assert.match(e.meldung, /not available/)
    assert.equal(ergebnis('Failed to pair: org.bluez.Error.AuthenticationFailed').ok, false)
    assert.equal(ergebnis('Failed to connect: org.bluez.Error.NotReady').ok, false)
  })

  it('behauptet ohne klare Rückmeldung KEINEN Erfolg', () => {
    // bluetoothctl endet oft mit Code 0, auch wenn nichts geklappt hat.
    assert.equal(ergebnis('').ok, false)
    assert.equal(ergebnis('irgendwas Belangloses').ok, false)
  })
})

describe('ohneSelectFehlzeile — die tote Adapterwahl darf kein Befehlsergebnis werden', () => {
  // Der Fall vom 09.09.2026 (MixPiBox .62): Wahl-Datei zeigte auf den am
  // 20.08. gewechselten USB-Stecker. Zeilen abgeschrieben von der Box.
  const WAHL = '08:BF:B8:56:CE:44'
  const fehlzeile = `Controller ${WAHL} not available`

  it('tilgt genau die Controller-Zeile der gewählten Adresse', () => {
    const roh = `${fehlzeile}\nAttempting to connect to 00:9E:C8:61:1A:EA\nConnection successful`
    const sauber = ohneSelectFehlzeile(roh, WAHL)
    assert.doesNotMatch(sauber, /not available/)
    assert.match(sauber, /Connection successful/)
  })

  it('macht aus einem vergifteten Erfolg wieder einen Erfolg', () => {
    // GENAU der Fehlmodus des Menüs: ergebnis() las das select-Echo als
    // Ausgang des connect und meldete „not available" an die Oberfläche.
    const roh = `${fehlzeile}\nAttempting to connect to 00:9E:C8:61:1A:EA\nConnection successful`
    assert.equal(ergebnis(roh).ok, false)
    assert.equal(ergebnis(ohneSelectFehlzeile(roh, WAHL)).ok, true)
  })

  it('lässt ein „Device … not available" stehen — das ist eine echte Auskunft', () => {
    const roh = `${fehlzeile}\nDevice 03:BE:C9:23:41:AC not available`
    const sauber = ohneSelectFehlzeile(roh, WAHL)
    assert.match(sauber, /Device 03:BE:C9:23:41:AC not available/)
    assert.equal(ergebnis(sauber).ok, false)
  })

  it('lässt Controller-Zeilen ANDERER Adapter stehen', () => {
    const show = 'Controller 88:A2:9E:48:F6:50 (public)\n\tAlias: MixPiBox #1\n\tPowered: yes'
    assert.equal(ohneSelectFehlzeile(`${fehlzeile}\n${show}`, WAHL), show)
  })

  it('gibt parseShow den echten Adapter zurück statt der toten Wahl', () => {
    // Vor dem Filter meldete /api/bluetooth die MAC aus der Fehlzeile als
    // Adapter — einen Controller, den es auf der Box gar nicht gab.
    const roh = [fehlzeile, 'Controller 88:A2:9E:48:F6:50 (public)', '\tAlias: MixPiBox #1', '\tPowered: yes'].join(
      '\n',
    )
    assert.equal(parseShow(roh)?.mac, WAHL)
    assert.equal(parseShow(ohneSelectFehlzeile(roh, WAHL))?.mac, '88:A2:9E:48:F6:50')
  })

  it('ändert ohne gültige Wahl nichts', () => {
    const roh = `${fehlzeile}\nirgendwas`
    assert.equal(ohneSelectFehlzeile(roh, ''), roh)
    assert.equal(ohneSelectFehlzeile(roh, 'keineMac'), roh)
  })
})

describe('akkuAus — Ladezustand, wenn das Geraet ihn meldet', () => {
  it('liest die Dezimalzahl aus der Klammer', () => {
    assert.equal(akkuAus('\tBattery Percentage: 0x54 (84)'), 84)
  })

  it('nimmt den Hex-Wert, wenn keine Klammer dasteht', () => {
    assert.equal(akkuAus('Battery Percentage: 0x50'), 80)
  })

  it('findet die Zeile auch mitten in einer langen Ausgabe', () => {
    const aus = ['Device 00:9E:C8:61:1A:EA', '\tConnected: yes', '\tBattery Percentage: 0x28 (40)', '\tIcon: audio-card'].join('\n')
    assert.equal(akkuAus(aus), 40)
  })

  it('meldet NICHTS, wenn keine Angabe da ist — statt zu raten', () => {
    assert.equal(akkuAus('\tConnected: yes\n\tIcon: audio-card'), undefined)
    assert.equal(akkuAus(''), undefined)
    assert.equal(akkuAus(undefined), undefined)
  })

  it('weist unmoegliche Werte ab', () => {
    assert.equal(akkuAus('Battery Percentage: 0xFF (255)'), undefined)
  })
})

describe('parseCodecs — welcher Codec ausgehandelt wurde', () => {

  it('parseCodecs liest Adresse aus dem Senkennamen und den Codec darunter', () => {
    const text = `
  Sink #441
  	Name: bluez_output.00_9E_C8_61_1A_EA.1
  	Properties:
  		api.bluez5.codec = "sbc"
  		api.bluez5.profile = "a2dp-sink"
  Sink #520
  	Name: bluez_output.7C_96_D2_89_35_CC.1
  	Properties:
  		api.bluez5.codec = "aptx"
  `
    assert.deepEqual(parseCodecs(text), {
      '00:9E:C8:61:1A:EA': 'sbc',
      '7C:96:D2:89:35:CC': 'aptx',
    })
  })

  it('parseCodecs ordnet einen Codec NICHT einer fremden Senke zu', () => {
    // Zwischen Bluetooth-Senke und Codec steht eine andere Senke: der Codec
    // gehoert dann zu KEINER — lieber nichts anzeigen als das Falsche.
    const text = `
  	Name: bluez_output.00_9E_C8_61_1A_EA.1
  	Name: alsa_output.platform-soc_sound.stereo-fallback
  		api.bluez5.codec = "sbc"
  `
    assert.deepEqual(parseCodecs(text), {})
  })

  it('parseCodecs bleibt bei leerer oder fremder Ausgabe leer', () => {
    assert.deepEqual(parseCodecs(''), {})
    assert.deepEqual(parseCodecs('irgendwas ganz anderes'), {})
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Funkadapter
// ═══════════════════════════════════════════════════════════════════════════

/** Echte Ausgabe der Box (2026-07-28), gekuerzt auf das Wesentliche. */
const HCICONFIG = `hci0:	Type: Primary  Bus: USB
	BD Address: 00:15:83:F9:C5:4F  ACL MTU: 310:10  SCO MTU: 64:8
	UP RUNNING PSCAN
	RX bytes:1653152 acl:176 sco:0 events:234074 errors:0
	HCI Version: 4.0 (0x6)  Revision: 0x22bb
	LMP Version: 4.0 (0x6)  Subversion: 0x22bb
	Manufacturer: Cambridge Silicon Radio (10)

hci1:	Type: Primary  Bus: UART
	BD Address: 88:A2:9E:48:F6:50  ACL MTU: 1021:8  SCO MTU: 64:1
	UP RUNNING PSCAN
	HCI Version: 5.0 (0x9)  Revision: 0x1

hci2:	Type: Primary  Bus: USB
	BD Address: 08:BF:B8:56:CE:44  ACL MTU: 1021:6  SCO MTU: 255:12
	UP RUNNING PSCAN
	HCI Version: 5.1 (0xa)  Revision: 0xdfc
`

describe('parseAdapter', () => {
  it('findet alle drei Adapter mit ihren Zahlen', () => {
    const a = parseAdapter(HCICONFIG)
    assert.equal(a.length, 3)
    assert.deepEqual(
      a.map((x) => [x.name, x.bus, x.fassung, x.mtu, x.puffer]),
      [
        ['hci0', 'USB', '4.0', 310, 10],
        ['hci1', 'UART', '5.0', 1021, 8],
        ['hci2', 'USB', '5.1', 1021, 6],
      ],
    )
  })

  it('verwechselt die Geraeteadresse nicht mit der Paketgroesse', () => {
    // DER FEHLER, den die Bash-Fassung hatte: "BD Address: .. ACL MTU: 310:10"
    // steht auf EINER Zeile. Wer das dritte Feld nimmt, bekommt die MAC und
    // zeigt "00 Byte, 15 Puffer" an - Bruchstuecke von 00:15:83:...
    const a = parseAdapter(HCICONFIG)
    assert.equal(a[0].mtu, 310)
    assert.notEqual(a[0].mtu, 0)
    assert.equal(a[0].puffer, 10)
  })

  it('kommt mit leerer und unsinniger Eingabe zurecht', () => {
    assert.deepEqual(parseAdapter(''), [])
    assert.deepEqual(parseAdapter('irgendwas'), [])
    assert.deepEqual(parseAdapter(null as unknown as string), [])
  })

  it('laesst fehlende Angaben leer, statt zu raten', () => {
    const a = parseAdapter('hci9:	Type: Primary  Bus: USB\n')
    assert.equal(a.length, 1)
    assert.equal(a[0].mtu, 0)
    assert.equal(a[0].fassung, '')
  })
})

const bauAdapter = (p: Partial<Funkadapter>): Funkadapter => ({
    name: 'hci0', bus: 'USB', fassung: '5.0', mtu: 1021, puffer: 8,
  kennung: '', chip: '', bezeichnung: '', an: true, note: 0, urteil: '', traegtTon: false, ...p,
})

describe('bewerteAdapter', () => {

  it('wertet kleine Pakete deutlich ab — sie sind der Hauptgrund fuer Aussetzer', () => {
    const gross = bewerteAdapter(bauAdapter({ mtu: 1021 }))
    const klein = bewerteAdapter(bauAdapter({ mtu: 310 }))
    assert.ok(gross.note > klein.note + 3, `${gross.note} vs ${klein.note}`)
    assert.match(klein.urteil, /310 Byte/)
  })

  it('kennt den CSR-Klon und benennt ihn', () => {
    const b = bewerteAdapter(bauAdapter({ mtu: 310, fassung: '4.0', kennung: '0a12:0001' }))
    assert.match(b.urteil, /CSR8510-Klon/)
    assert.match(b.urteil, /Aussetzer/)
  })

  it('wertet den eingebauten ab, obwohl seine Zahlen gut sind', () => {
    // Beim Pi teilen sich WLAN und Bluetooth ein Funkmodul. Wer einen Stecker
    // benutzt, hat sie meist genau deshalb getrennt.
    const eingebaut = bewerteAdapter(bauAdapter({ bus: 'UART' }))
    const stecker = bewerteAdapter(bauAdapter({ bus: 'USB' }))
    assert.ok(stecker.note > eingebaut.note)
    assert.match(eingebaut.urteil, /WLAN/)
  })

  it('haelt die Note zwischen 0 und 10', () => {
    assert.ok(bewerteAdapter(bauAdapter({ mtu: 0, fassung: '4.0', bus: 'UART', kennung: '0a12:0001' })).note >= 0)
    assert.ok(bewerteAdapter(bauAdapter({ mtu: 4000, fassung: '5.4', kennung: '8087:0032' })).note <= 10)
  })
})

describe('ausgeschaltete Adapter', () => {
  it('erkennt, dass ein Adapter aus ist', () => {
    const aus = `hci0:	Type: Primary  Bus: USB
	BD Address: 00:11:22:33:44:55  ACL MTU: 1021:8
	DOWN
`
    assert.equal(parseAdapter(aus)[0].an, false)
    assert.equal(parseAdapter(HCICONFIG)[0].an, true)
  })

  it('gibt einem ausgeschalteten KEINE schlechte Note, sondern gar keine', () => {
    // Ein ausgeschalteter meldet seine Fassung nicht. Ihn deshalb schlecht zu
    // bewerten waere irrefuehrend - er ist vielleicht der beste im Geraet.
    const b = bewerteAdapter(bauAdapter({ an: false, mtu: 1021, fassung: '' }))
    assert.equal(b.note, 0)
    assert.match(b.urteil, /ausgeschaltet/)
  })

  it('raet nicht zu einem ausgeschalteten Adapter', () => {
    const gemischt = `hci0:	Type: Primary  Bus: USB
	BD Address: 00:11:22:33:44:55  ACL MTU: 310:10
	UP RUNNING
	HCI Version: 4.0 (0x6)

hci1:	Type: Primary  Bus: USB
	BD Address: 66:77:88:99:AA:BB  ACL MTU: 1021:6
	DOWN
`
    assert.equal(besserenFinden(adapterListe(gemischt, {}, 'hci0')), null)
  })
})

describe('adapterListe', () => {
  const kennungen = { hci0: '0a12:0001', hci2: '0b05:190e' }

  it('stellt den besten nach vorn und merkt sich, wer den Ton traegt', () => {
    const l = adapterListe(HCICONFIG, kennungen, 'hci0')
    assert.equal(l[0].name, 'hci2', 'der ASUS mit 1021 Byte und BT 5.1 gehoert nach vorn')
    assert.equal(l.find((a) => a.traegtTon)?.name, 'hci0')
  })

  it('benennt bekannte Chips im Klartext', () => {
    const l = adapterListe(HCICONFIG, kennungen, '')
    assert.equal(l.find((a) => a.name === 'hci2')?.chip, 'ASUS USB-BT500 (RTL8761B)')
    assert.equal(l.find((a) => a.name === 'hci0')?.chip, 'CSR8510-Klon')
    assert.equal(l.find((a) => a.name === 'hci1')?.chip, '')
  })
})

describe('adapterBezeichnung — ein Name, den man wiedererkennt', () => {
  it('nennt den Chip, wenn wir ihn kennen — das steht auf dem Stecker', () => {
    const l = adapterListe(HCICONFIG, { hci0: '0a12:0001', hci2: '0b05:190e' }, '')
    assert.equal(l.find((a) => a.name === 'hci2')?.bezeichnung, 'ASUS USB-BT500 (RTL8761B)')
  })

  it('nennt den eingebauten beim Namen statt bei der Nummer', () => {
    const l = adapterListe(HCICONFIG, {}, '')
    assert.equal(l.find((a) => a.name === 'hci1')?.bezeichnung, 'Eingebauter Funk der Box')
  })

  it('faellt bei einem unbekannten Stecker auf die Kennung zurueck, statt zu schweigen', () => {
    const l = adapterListe(HCICONFIG, { hci0: '1234:5678' }, '')
    assert.equal(l.find((a) => a.name === 'hci0')?.bezeichnung, 'USB-Adapter (1234:5678)')
  })

  it('macht die hci-Nummer NICHT zum Namen — sie aendert sich beim Neustart', () => {
    const l = adapterListe(HCICONFIG, {}, '')
    for (const a of l) assert.doesNotMatch(a.bezeichnung, /hci/)
  })
})

describe('besserenFinden', () => {
  it('findet den echten Fall dieser Box: ASUS statt CSR', () => {
    const l = adapterListe(HCICONFIG, { hci0: '0a12:0001', hci2: '0b05:190e' }, 'hci0')
    assert.equal(besserenFinden(l)?.name, 'hci2')
  })

  it('raet NICHT zum Wechsel, wenn schon der beste laeuft', () => {
    const l = adapterListe(HCICONFIG, { hci0: '0a12:0001', hci2: '0b05:190e' }, 'hci2')
    assert.equal(besserenFinden(l), null)
  })

  it('raet nicht wegen eines einzigen Punktes zum Umstecken', () => {
    // Ein Rat, der sich nicht lohnt, kostet nur Vertrauen.
    const knapp = `hci0:	Type: Primary  Bus: USB
	BD Address: 00:11:22:33:44:55  ACL MTU: 1021:8
	HCI Version: 5.0 (0x9)

hci1:	Type: Primary  Bus: USB
	BD Address: 66:77:88:99:AA:BB  ACL MTU: 1021:8
	HCI Version: 5.1 (0xa)
`
    assert.equal(besserenFinden(adapterListe(knapp, {}, 'hci0')), null)
  })

  it('schweigt, wenn niemand den Ton traegt', () => {
    assert.equal(besserenFinden(adapterListe(HCICONFIG, {}, '')), null)
  })
})

/**
 * BLUETOOTH 6.0 UND DIE STUMME VERSIONSZEILE (15.08.2026, ASUS USB-BT600
 * an Box .57): hciconfig von 2023 kennt den Code 0xe nicht beim Namen und
 * druckt "HCI Version:  (0xe)" — wer nur das erste Feld liest, haelt einen
 * 6.0-Adapter fuer einen ohne Fassung. Der Betreiber sah Note 5 statt 10
 * und wunderte sich zu Recht.
 */
describe('Bluetooth 6.0 am alten hciconfig', () => {
  const BT600 = [
    'hci1:	Type: Primary  Bus: USB',
    '	BD Address: B0:82:E2:1F:9C:E5  ACL MTU: 1021:6  SCO MTU: 255:12',
    '	UP RUNNING',
    '	HCI Version:  (0xe)  Revision: 0xceb',
  ].join('\n')

  it('der Code in der Klammer wird zur Fassung — auch ohne Wort davor', () => {
    assert.equal(parseAdapter(BT600)[0].fassung, '6.0')
  })

  it('das Wort gewinnt weiter, wo hciconfig es kennt', () => {
    const alt = parseAdapter('hci0:	Type: Primary  Bus: USB\n\tHCI Version: 5.1 (0xa)  Revision: 0x1')
    assert.equal(alt[0].fassung, '5.1')
  })

  it('ein unbekannter kuenftiger Code faellt auf die Hex-Schreibweise, nicht auf leer', () => {
    const k = parseAdapter('hci0:	Type: Primary  Bus: USB\n\tHCI Version:  (0x1f)  Revision: 0x1')
    assert.equal(k[0].fassung, '(0x1f)')
  })

  it('der BT600 bekommt Namen und volle Note — gemessen, kein Vorurteil mehr', () => {
    const liste = adapterListe(BT600, { hci1: '0b05:1d70' })
    assert.equal(liste[0].bezeichnung, 'ASUS USB-BT600')
    assert.equal(liste[0].note, 10)
    assert.ok(liste[0].urteil.includes('ASUS USB-BT600'), liste[0].urteil)
  })
})
