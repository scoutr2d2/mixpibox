/**
 * Tests für die Netzwerkseite.
 *
 * Schwerpunkt ist wieder die Eingangsprüfung, und diesmal aus einem sehr
 * konkreten Grund: was durch pruefeSsid kommt, landet in wlan.json, und
 * add_wifi.sh (Root-Schleife) schreibt es UNQUOTIERT in wpa_supplicant.conf.
 * Ein durchgerutschtes Anführungszeichen wäre dort ein Ausbruch aus der Zeile.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PSK_MAX,
  PSK_MIN,
  SSID_MAX_BYTES,
  parseIpAddr,
  parseIwLink,
  parseProcWireless,
  parseWpaStatus,
  pruefePsk,
  pruefeSsid,
  traegtDasNetz,
  signalStufe,
  wlanEintrag,
  bandAusFrequenz,
  brauchtPasswort,
  hatWps,
  netzeAusScan,
  parseScanResults,
  sicherheitAusFlags,
  parseListNetworks,
  verschluesselungName,
  // E115 (31.08.2026): gespeicherte Netze per Klick — Kennungspruefung und
  // Vorrang. Die Kennung geht an `remove_network`; sie ist der heikle Teil.
  naechstePrioritaet,
  prioritaetAus,
  pruefeNetzKennung,
} from './netzwerk.js'

describe('pruefeSsid', () => {
  it('nimmt gewöhnliche Namen an', () => {
    for (const s of ['FRITZ!Box 7590', 'Gastnetz', 'wlan-2.4', 'Müllers WLAN', 'a'])
      assert.equal(pruefeSsid(s).ok, true, s)
  })

  it('weist ab, was aus der wpa-Zeile ausbrechen könnte', () => {
    // Genau diese Zeichen macht add_wifi.sh:48 gefährlich.
    for (const s of ['böse"netz', 'a\\b', 'netz"\nnetwork={', 'x\u0000y'])
      assert.equal(pruefeSsid(s).ok, false, JSON.stringify(s))
  })

  it('weist Zeilenumbrüche ab', () => {
    assert.equal(pruefeSsid('a\nb').ok, false)
    assert.equal(pruefeSsid('a\rb').ok, false)
  })

  it('hält die Längengrenze in BYTE, nicht in Zeichen', () => {
    // 32 Umlaute sind 64 Byte — nach 802.11 zu lang, obwohl es 32 Zeichen sind.
    assert.equal(pruefeSsid('a'.repeat(SSID_MAX_BYTES)).ok, true)
    assert.equal(pruefeSsid('a'.repeat(SSID_MAX_BYTES + 1)).ok, false)
    assert.equal(pruefeSsid('ä'.repeat(17)).ok, false, '34 Byte')
    assert.equal(pruefeSsid('ä'.repeat(16)).ok, true, '32 Byte')
  })

  it('weist Leeres und Nicht-Text ab', () => {
    for (const s of ['', null, undefined, 42, {}, []])
      assert.equal(pruefeSsid(s).ok, false, String(s))
  })

  it('nennt einen Grund, wenn es ablehnt', () => {
    assert.match(pruefeSsid('').grund ?? '', /leer/)
    assert.match(pruefeSsid('a"b').grund ?? '', /"/)
  })
})

describe('pruefePsk', () => {
  it('lässt ein offenes Netz ohne Passwort zu', () => {
    for (const p of ['', undefined, null]) assert.equal(pruefePsk(p).ok, true, String(p))
  })

  it('hält sich an die WPA-Grenzen', () => {
    assert.equal(pruefePsk('a'.repeat(PSK_MIN - 1)).ok, false)
    assert.equal(pruefePsk('a'.repeat(PSK_MIN)).ok, true)
    assert.equal(pruefePsk('a'.repeat(PSK_MAX)).ok, true)
    assert.equal(pruefePsk('a'.repeat(PSK_MAX + 1)).ok, false)
  })

  it('weist gefährliche Zeichen ab', () => {
    assert.equal(pruefePsk('hat"drin').ok, false)
    assert.equal(pruefePsk('hat\\drin').ok, false)
    assert.equal(pruefePsk('hat\ndrin').ok, false)
  })

  it('verrät das Passwort nicht im Grund', () => {
    const g = pruefePsk('kurz').grund ?? ''
    assert.equal(g.includes('kurz'), false)
  })
})

describe('parseIpAddr', () => {
  const roh = JSON.stringify([
    { ifname: 'lo', operstate: 'UNKNOWN', addr_info: [{ family: 'inet', local: '127.0.0.1', prefixlen: 8 }] },
    {
      ifname: 'wlan0',
      operstate: 'UP',
      addr_info: [
        { family: 'inet', local: '192.168.178.75', prefixlen: 24 },
        { family: 'inet6', local: 'fe80::1', prefixlen: 64 },
        { family: 'inet6', local: '2001:db8::5', prefixlen: 64 },
      ],
    },
    { ifname: 'eth0', operstate: 'DOWN', addr_info: [] },
  ])

  it('lässt die Rückschleife weg', () => {
    assert.equal(
      parseIpAddr(roh).some((s) => s.name === 'lo'),
      false,
    )
  })

  it('liest Namen, Zustand und Funk richtig', () => {
    const [wlan, eth] = parseIpAddr(roh)
    assert.equal(wlan.name, 'wlan0')
    assert.equal(wlan.aktiv, true)
    assert.equal(wlan.funk, true)
    assert.equal(eth.aktiv, false)
    assert.equal(eth.funk, false)
  })

  it('lässt verbindungslokale v6-Adressen weg (sie helfen beim Zugriff nicht)', () => {
    const wlan = parseIpAddr(roh)[0]
    assert.deepEqual(
      wlan.adressen.map((a) => a.adresse),
      ['192.168.178.75', '2001:db8::5'],
    )
  })

  it('gibt eine leere Liste zurück, statt bei Nicht-JSON zu werfen', () => {
    // Ältere iproute2 kennen -j nicht und geben Text aus.
    assert.deepEqual(parseIpAddr('1: lo: <LOOPBACK,UP>'), [])
    assert.deepEqual(parseIpAddr(''), [])
    assert.deepEqual(parseIpAddr('{"kein":"array"}'), [])
  })

  it('überlebt fehlende Felder', () => {
    const s = parseIpAddr('[{"ifname":"wlan0"}]')
    assert.equal(s.length, 1)
    assert.deepEqual(s[0].adressen, [])
    assert.equal(s[0].aktiv, false)
  })
})

describe('parseIwLink', () => {
  const verbunden = [
    'Connected to aa:bb:cc:dd:ee:ff (on wlan0)',
    '\tSSID: FRITZ!Box 7590',
    '\tfreq: 5180',
    '\tsignal: -47 dBm',
    '\ttx bitrate: 390.0 MBit/s',
  ].join('\n')

  it('liest Name, Signal und Frequenz', () => {
    const v = parseIwLink(verbunden)
    assert.equal(v?.ssid, 'FRITZ!Box 7590')
    assert.equal(v?.signal, -47)
    assert.equal(v?.frequenzMhz, 5180)
  })

  it('meldet "nicht verbunden" als null', () => {
    assert.equal(parseIwLink('Not connected.'), null)
    assert.equal(parseIwLink(''), null)
  })

  it('kommt ohne Signal und Frequenz aus', () => {
    const v = parseIwLink('Connected to x\n\tSSID: Nur Name')
    assert.equal(v?.ssid, 'Nur Name')
    assert.equal(v?.signal, null)
    assert.equal(v?.frequenzMhz, null)
  })
})

describe('signalStufe', () => {
  it('übersetzt dBm in etwas Verständliches', () => {
    assert.equal(signalStufe(-45), 'gut')
    assert.equal(signalStufe(-60), 'gut')
    assert.equal(signalStufe(-61), 'mittel')
    assert.equal(signalStufe(-70), 'mittel')
    assert.equal(signalStufe(-71), 'schwach')
    assert.equal(signalStufe(null), 'unbekannt')
  })
})

describe('wlanEintrag', () => {
  it('nutzt genau die Felder, die add_wifi.sh per jq liest', () => {
    // .[].ssid und .[].pw — wer das umbenennt, bricht die Box stillschweigend.
    assert.deepEqual(wlanEintrag('Netz', 'geheim123'), { ssid: 'Netz', pw: 'geheim123' })
    assert.deepEqual(wlanEintrag('Offen'), { ssid: 'Offen', pw: '' })
  })
})

describe('parseProcWireless', () => {
  // Genau so sieht es auf der Box aus (abgeschrieben, nicht ausgedacht).
  const echt = [
    'Inter-| sta-|   Quality        |   Discarded packets               | Missed | WE',
    ' face | tus | link level noise |  nwid  crypt   frag  retry   misc | beacon | 22',
    ' wlan0: 0000   39.  -71.  -256        0      0      0   1545      0        0',
  ].join('\n')

  it('liest den Pegel trotz des angehängten Punktes', () => {
    // "-71." ist kein Dezimalwert, sondern die Kennzeichnung "aktualisiert".
    assert.equal(parseProcWireless(echt), -71)
  })

  it('findet die gewünschte Schnittstelle', () => {
    const zwei = `${echt}\n wlan1: 0000   20.  -85.  -256        0      0      0      0      0        0`
    assert.equal(parseProcWireless(zwei, 'wlan0'), -71)
    assert.equal(parseProcWireless(zwei, 'wlan1'), -85)
    assert.equal(parseProcWireless(zwei, 'wlan9'), null)
  })

  it('behandelt 0 als „keine Angabe", nicht als hervorragend', () => {
    assert.equal(parseProcWireless(' wlan0: 0000   0.  0.  0'), null)
  })

  it('verträgt Fehlendes', () => {
    assert.equal(parseProcWireless(''), null)
    assert.equal(parseProcWireless('nur Kopfzeilen\nohne Daten'), null)
  })
})

describe('parseWpaStatus', () => {
  const echt = [
    'bssid=0c:72:74:93:06:54',
    'freq=5300',
    'ssid=ganznahamnetzFritz',
    'id=0',
    'mode=station',
  ].join('\n')

  it('liest Name und Frequenz', () => {
    const w = parseWpaStatus(echt)
    assert.equal(w?.ssid, 'ganznahamnetzFritz')
    assert.equal(w?.frequenzMhz, 5300)
  })

  it('meldet null ohne Netzwerknamen', () => {
    assert.equal(parseWpaStatus('bssid=x\nmode=station'), null)
    assert.equal(parseWpaStatus(''), null)
  })

  it('kommt ohne Frequenz aus', () => {
    assert.equal(parseWpaStatus('ssid=NurName')?.frequenzMhz, null)
  })

  it('verträgt ein Gleichheitszeichen im Namen', () => {
    assert.equal(parseWpaStatus('ssid=a=b')?.ssid, 'a=b')
  })
})

describe('parseScanResults', () => {
  // Wortlaut von `wpa_cli -i wlan0 scan_results`, tabgetrennt.
  const echt = [
    'bssid / frequency / signal level / flags / ssid',
    '00:11:22:33:44:55\t2412\t-45\t[WPA2-PSK-CCMP][ESS]\tMeinNetz',
    'aa:bb:cc:dd:ee:ff\t5180\t-72\t[WPA2-PSK-CCMP][WPS][ESS]\tNachbar',
    '11:22:33:44:55:66\t2437\t-80\t[ESS]\tGastnetz',
  ].join('\n')

  it('liest alle Felder', () => {
    const z = parseScanResults(echt)
    assert.equal(z.length, 3)
    assert.deepEqual(z[0], {
      bssid: '00:11:22:33:44:55',
      frequenzMhz: 2412,
      signalDbm: -45,
      flags: '[WPA2-PSK-CCMP][ESS]',
      ssid: 'MeinNetz',
    })
  })

  it('ueberspringt die Ueberschrift', () => {
    assert.equal(
      parseScanResults(echt).some((z) => z.ssid.includes('ssid')),
      false,
    )
  })

  it('laesst versteckte Netze weg — die kann man nicht anklicken', () => {
    const mit = `${echt}\n99:88:77:66:55:44\t2412\t-50\t[WPA2-PSK-CCMP][ESS]\t`
    assert.equal(parseScanResults(mit).length, 3)
  })

  it('vertraegt Unfug, ohne zu werfen', () => {
    // Die Liste ist eine Momentaufnahme; ein halber Eintrag darf die Seite
    // nicht scheitern lassen.
    assert.deepEqual(parseScanResults(''), [])
    assert.deepEqual(parseScanResults('kaputt'), [])
    assert.equal(parseScanResults(`${echt}\nhalbe\tzeile`).length, 3)
  })

  it('haelt eine SSID mit Tabulator zusammen', () => {
    const z = parseScanResults('00:11:22:33:44:55\t2412\t-45\t[ESS]\tMein\tNetz')
    assert.equal(z[0].ssid, 'Mein\tNetz')
  })
})

describe('sicherheitAusFlags', () => {
  it('trennt Personal von ENTERPRISE', () => {
    // Der wichtige Fall: bei EAP reicht ein Passwort NICHT (Benutzername,
    // ggf. Zertifikat). So ein Netz als "Passwort eingeben" anzubieten fuehrt
    // in eine Sackgasse.
    assert.equal(sicherheitAusFlags('[WPA2-PSK-CCMP][ESS]'), 'wpa')
    assert.equal(sicherheitAusFlags('[WPA2-EAP-CCMP][ESS]'), 'wpa-enterprise')
  })

  it('erkennt offen, WEP und WPA3', () => {
    assert.equal(sicherheitAusFlags('[ESS]'), 'offen')
    assert.equal(sicherheitAusFlags(''), 'offen')
    assert.equal(sicherheitAusFlags('[WEP][ESS]'), 'wep')
    assert.equal(sicherheitAusFlags('[RSN-SAE-CCMP][ESS]'), 'wpa')
  })

  it('sagt, wo ein Passwort ueberhaupt hilft', () => {
    assert.equal(brauchtPasswort('wpa'), true)
    assert.equal(brauchtPasswort('wep'), true)
    assert.equal(brauchtPasswort('offen'), false)
    assert.equal(brauchtPasswort('wpa-enterprise'), false)
  })
})

describe('hatWps / bandAusFrequenz', () => {
  it('erkennt WPS an der Kennzeichnung', () => {
    assert.equal(hatWps('[WPA2-PSK-CCMP][WPS][ESS]'), true)
    assert.equal(hatWps('[WPA2-PSK-CCMP][ESS]'), false)
  })

  it('ordnet die Frequenz einem Band zu', () => {
    assert.equal(bandAusFrequenz(2412), '2,4 GHz')
    assert.equal(bandAusFrequenz(5180), '5 GHz')
    assert.equal(bandAusFrequenz(null), null)
    assert.equal(bandAusFrequenz(999), null)
  })
})

describe('netzeAusScan', () => {
  const zeilen = parseScanResults(
    [
      '00:11:22:33:44:55\t2412\t-70\t[WPA2-PSK-CCMP][ESS]\tHeim',
      'aa:bb:cc:dd:ee:ff\t5180\t-45\t[WPA2-PSK-CCMP][ESS]\tHeim',
      '11:22:33:44:55:66\t2437\t-80\t[ESS]\tGast',
    ].join('\n'),
  )

  it('entdoppelt nach SSID und behaelt den staerksten Punkt', () => {
    // Ein Mesh strahlt dieselbe SSID mehrfach aus. Ungefiltert stuende das
    // Heimnetz mehrmals in der Liste — genau das macht die Auswahl unbrauchbar.
    const n = netzeAusScan(zeilen)
    assert.equal(n.length, 2)
    const heim = n.find((x) => x.ssid === 'Heim')
    assert.equal(heim?.signalDbm, -45)
    assert.equal(heim?.band, '5 GHz')
    assert.equal(heim?.punkte, 2)
  })

  it('sortiert nach Empfang, absteigend', () => {
    assert.deepEqual(
      netzeAusScan(zeilen).map((n) => n.ssid),
      ['Heim', 'Gast'],
    )
  })

  it('stellt ein Netz ohne Pegelangabe nach UNTEN', () => {
    // `null` ist keine gute Verbindung — es darf nicht oben stehen.
    const z = parseScanResults(
      [
        '00:11:22:33:44:55\t2412\tkeinwert\t[ESS]\tOhnePegel',
        '11:22:33:44:55:66\t2412\t-85\t[ESS]\tSchwach',
      ].join('\n'),
    )
    assert.deepEqual(
      netzeAusScan(z).map((n) => n.ssid),
      ['Schwach', 'OhnePegel'],
    )
  })

  it('reicht Stufe, Sicherheit und WPS durch', () => {
    const [n] = netzeAusScan(
      parseScanResults('00:11:22:33:44:55\t2412\t-55\t[WPA2-PSK-CCMP][WPS][ESS]\tX'),
    )
    assert.equal(n.stufe, 'gut')
    assert.equal(n.sicherheit, 'wpa')
    assert.equal(n.wps, true)
  })

  it('vertraegt eine leere Liste', () => {
    assert.deepEqual(netzeAusScan([]), [])
  })
})

describe('verschluesselungName', () => {
  it('unterscheidet WPA2, WPA3 und den Uebergangsbetrieb', () => {
    // Kein Haarspalten: ein Geraet, das an reinem WPA3 scheitert, kommt am
    // SELBEN Router im Uebergangsbetrieb hinein — und das sieht man nur hier.
    assert.equal(verschluesselungName('[WPA2-PSK-CCMP][ESS]'), 'WPA2')
    assert.equal(verschluesselungName('[RSN-SAE-CCMP][ESS]'), 'WPA2/WPA3')
    assert.equal(verschluesselungName('[WPA2-PSK+SAE-CCMP][ESS]'), 'WPA2/WPA3')
    assert.equal(verschluesselungName('[WPA-PSK-CCMP][WPA2-PSK-CCMP][ESS]'), 'WPA/WPA2')
  })

  it('kennt Enterprise, WEP und offen', () => {
    assert.equal(verschluesselungName('[WPA2-EAP-CCMP][ESS]'), 'WPA2-Enterprise')
    assert.equal(verschluesselungName('[WEP][ESS]'), 'WEP')
    assert.equal(verschluesselungName('[ESS]'), 'offen')
    assert.equal(verschluesselungName(''), 'offen')
  })
})

describe('parseListNetworks', () => {
  const echt = ['network id / ssid / bssid / flags', '0\tHeim\tany\t', '1\tArbeit\tany\t[CURRENT]'].join(
    '\n',
  )

  it('liest bekannte Netze und erkennt das aktuelle', () => {
    assert.deepEqual(parseListNetworks(echt), [
      { id: 0, ssid: 'Heim', aktuell: false, abgeschaltet: false },
      { id: 1, ssid: 'Arbeit', aktuell: true, abgeschaltet: false },
    ])
  })

  it('vertraegt Leeres und die Ueberschrift', () => {
    assert.deepEqual(parseListNetworks(''), [])
    assert.deepEqual(parseListNetworks('network id / ssid / bssid / flags'), [])
  })

  /**
   * E115 (31.08.2026): die KENNUNG ist der Punkt. Ohne sie liesse sich ein
   * gespeichertes Netz nur anzeigen, nicht anwaehlen — `select_network` und
   * `remove_network` kennen Netze ausschliesslich unter dieser Zahl.
   */
  it('nimmt die Kennung mit — und zwar die ECHTE, nicht die Listenposition', () => {
    // Nach einem remove_network klafft eine Luecke: wpa_supplicant vergibt
    // die Nummern in der laufenden Sitzung NICHT neu. Wer hier den Index
    // nimmt, loescht spaeter das falsche Netz.
    const mitLuecke = ['network id / ssid / bssid / flags', '0\tHeim\tany\t', '3\tGast\tany\t'].join('\n')
    assert.deepEqual(
      parseListNetworks(mitLuecke).map((n) => n.id),
      [0, 3],
    )
  })

  it('erkennt abgeschaltete Netze', () => {
    const aus = ['network id / ssid / bssid / flags', '2\tAlt\tany\t[DISABLED]'].join('\n')
    assert.equal(parseListNetworks(aus)[0].abgeschaltet, true)
    assert.equal(parseListNetworks(aus)[0].aktuell, false)
  })
})

/**
 * DIE KENNUNGSPRUEFUNG (E115, 31.08.2026).
 *
 * Sie ist die einzige Schranke zwischen einer Zahl aus dem Netz und
 * `remove_network`. Der Kommentar am Dateikopf beschreibt, wie `network.php`
 * genau diesen Wert per Verkettung in die Shell schob. Die neue Fassung geht
 * ohne Shell — aber eine falsche Zahl loescht auch ohne Shell ein fremdes
 * Netz. Deshalb ist die Regel nicht „sieht wie eine Zahl aus", sondern „steht
 * in der Liste, die wir eben selbst gelesen haben".
 */
describe('pruefeNetzKennung', () => {
  const liste = parseListNetworks(
    ['network id / ssid / bssid / flags', '0\tHeim\tany\t[CURRENT]', '3\tGast\tany\t'].join('\n'),
  )

  it('nimmt eine Kennung an, die es WIRKLICH gibt — und liefert das Netz mit', () => {
    const p = pruefeNetzKennung(3, liste)
    assert.equal(p.ok, true)
    assert.equal(p.netz?.ssid, 'Gast')
    // Die 0 ist eine gueltige Kennung und darf nicht als „leer" durchfallen.
    assert.equal(pruefeNetzKennung(0, liste).ok, true)
    assert.equal(pruefeNetzKennung(0, liste).netz?.ssid, 'Heim')
  })

  it('nimmt dieselbe Kennung auch als reine Ziffernfolge an', () => {
    assert.equal(pruefeNetzKennung('3', liste).ok, true)
    assert.equal(pruefeNetzKennung('3', liste).netz?.ssid, 'Gast')
  })

  it('DIE HAUPTSACHE: eine wohlgeformte Zahl, die es nicht gibt, wird abgelehnt', () => {
    // 1 und 2 sind Luecken in der Liste — wohlgeformt, aber nicht vorhanden.
    for (const k of [1, 2, 4, 99, '1', '4']) {
      const p = pruefeNetzKennung(k, liste)
      assert.equal(p.ok, false, `${JSON.stringify(k)} haette abgelehnt werden muessen`)
      assert.equal(p.netz, undefined)
    }
  })

  it('lehnt alles ab, was auf dem Weg zu wpa_cli noch etwas anderes werden koennte', () => {
    for (const k of [
      'all', // bei wpa_cli ein gueltiges Wort — und etwas voellig anderes
      '0; reboot',
      '0 ',
      ' 0',
      '00',
      '0x3',
      '3e0',
      '+3',
      '-1',
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '',
      null,
      undefined,
      {},
      [],
      [3],
      true,
    ]) {
      assert.equal(pruefeNetzKennung(k, liste).ok, false, `${JSON.stringify(k)} kam durch`)
    }
  })

  it('eine leere Liste laesst gar nichts durch', () => {
    assert.equal(pruefeNetzKennung(0, []).ok, false)
  })
})

/**
 * Der VORRANG beim Umschalten (E115).
 *
 * `/api/netzwerk/verbinden` setzt jedem eingerichteten Netz fest `priority 10`.
 * Wer zwei Netze ueber die Verwaltung angelegt hat, hat zwei Zehner — und
 * genau zwischen denen will der Betreiber umschalten. Eine feste Zahl waere
 * dort ein Gleichstand statt eines Vorrangs.
 */
describe('prioritaetAus / naechstePrioritaet', () => {
  it('liest den blossen Wert, den wpa_cli ausgibt', () => {
    assert.equal(prioritaetAus('10\n'), 10)
    assert.equal(prioritaetAus('0'), 0)
    assert.equal(prioritaetAus('  7  '), 7)
  })

  it('FAIL heisst „nie gesetzt" — und das ist die Vorgabe 0, kein Fehler', () => {
    assert.equal(prioritaetAus('FAIL'), 0)
    assert.equal(prioritaetAus(''), 0)
  })

  it('legt eine drauf — auch wenn zwei Netze denselben Wert tragen', () => {
    assert.equal(naechstePrioritaet([10, 10]), 11)
    assert.equal(naechstePrioritaet([]), 1)
    assert.equal(naechstePrioritaet([0, 0, 0]), 1)
    assert.equal(naechstePrioritaet([-5, 2]), 3)
  })
})

describe('netzeAusScan mit bekannten Netzen', () => {
  const zeilen = parseScanResults(
    [
      '00:11:22:33:44:55\t2412\t-80\t[WPA2-PSK-CCMP][ESS]\tArbeit',
      'aa:bb:cc:dd:ee:ff\t2412\t-70\t[WPA2-PSK-CCMP][ESS]\tHeim',
      '11:22:33:44:55:66\t2412\t-40\t[ESS]\tFremd',
    ].join('\n'),
  )
  const bekannt = [
    { ssid: 'Heim', aktuell: false },
    { ssid: 'Arbeit', aktuell: true },
  ]

  it('markiert bekannt und verbunden', () => {
    const n = netzeAusScan(zeilen, bekannt)
    const nach = Object.fromEntries(n.map((x) => [x.ssid, x]))
    assert.equal(nach['Arbeit'].verbunden, true)
    assert.equal(nach['Arbeit'].bekannt, true)
    assert.equal(nach['Heim'].bekannt, true)
    assert.equal(nach['Heim'].verbunden, false)
    assert.equal(nach['Fremd'].bekannt, false)
  })

  it('stellt das verbundene nach oben, dann bekannte, dann nach Empfang', () => {
    // Obwohl "Fremd" mit -40 dBm der staerkste ist: wer die Liste oeffnet,
    // sucht meistens sein eigenes Netz.
    assert.deepEqual(
      netzeAusScan(zeilen, bekannt).map((x) => x.ssid),
      ['Arbeit', 'Heim', 'Fremd'],
    )
  })

  it('ohne bekannte Netze bleibt es beim Empfang', () => {
    assert.deepEqual(
      netzeAusScan(zeilen).map((x) => x.ssid),
      ['Fremd', 'Heim', 'Arbeit'],
    )
  })

  it('reicht die Verschluesselung durch', () => {
    assert.equal(netzeAusScan(zeilen)[0].verschluesselung, 'offen')
  })
})

describe('netzeAusScan sammelt die Baender', () => {
  it('fuehrt denselben Namen auf 2,4 und 5 GHz in EINEM Eintrag', () => {
    // Der Normalfall im Haushalt: ein Router, ein Name, zwei Baender. Bisher
    // sah man nur das Band des staerksten Zugangspunkts.
    const z = parseScanResults(
      [
        '00:11:22:33:44:55\t2412\t-70\t[WPA2-PSK-CCMP][ESS]\tHeim',
        'aa:bb:cc:dd:ee:ff\t5180\t-45\t[WPA2-PSK-CCMP][ESS]\tHeim',
      ].join('\n'),
    )
    const [n] = netzeAusScan(z)
    assert.deepEqual(n.baender, ['2,4 GHz', '5 GHz'])
    assert.equal(n.band, '5 GHz', 'das staerkste bestimmt weiterhin den Pegel')
    assert.equal(n.signalDbm, -45)
    assert.equal(n.punkte, 2)
  })

  it('ein einzelnes Band bleibt ein einzelnes', () => {
    const z = parseScanResults('00:11:22:33:44:55\t2412\t-60\t[ESS]\tNur24')
    assert.deepEqual(netzeAusScan(z)[0].baender, ['2,4 GHz'])
  })

  it('ohne verwertbare Frequenz bleibt die Liste leer statt zu raten', () => {
    const z = parseScanResults('00:11:22:33:44:55\t999\t-60\t[ESS]\tKrumm')
    assert.deepEqual(netzeAusScan(z)[0].baender, [])
  })
})

describe('netzeAusScan: Empfang je Band', () => {
  const z = parseScanResults(
    [
      '00:11:22:33:44:55\t2412\t-52\t[WPA2-PSK-CCMP][ESS]\tHeim',
      '00:11:22:33:44:66\t2437\t-71\t[WPA2-PSK-CCMP][ESS]\tHeim',
      'aa:bb:cc:dd:ee:ff\t5180\t-66\t[WPA2-PSK-CCMP][ESS]\tHeim',
    ].join('\n'),
  )

  it('nennt je Band den besten Pegel und die Zahl der Punkte', () => {
    // Zwei Sender auf 2,4 GHz (-52 und -71), einer auf 5 GHz (-66). Je Band
    // zaehlt der BESTE, nicht der Durchschnitt — man stellt die Box ja dorthin,
    // wo es am besten geht.
    const [n] = netzeAusScan(z)
    const nach = Object.fromEntries(n.proBand.map((b) => [b.band, b]))
    assert.equal(nach['2,4 GHz'].signalDbm, -52)
    assert.equal(nach['2,4 GHz'].punkte, 2)
    assert.equal(nach['5 GHz'].signalDbm, -66)
    assert.equal(nach['5 GHz'].punkte, 1)
  })

  it('sortiert das staerkste Band nach vorn', () => {
    assert.deepEqual(
      netzeAusScan(z)[0].proBand.map((b) => b.band),
      ['2,4 GHz', '5 GHz'],
    )
  })

  it('uebersetzt je Band in eine Stufe', () => {
    const nach = Object.fromEntries(netzeAusScan(z)[0].proBand.map((b) => [b.band, b.stufe]))
    assert.equal(nach['2,4 GHz'], 'gut')     // -52
    assert.equal(nach['5 GHz'], 'mittel')    // -66
  })

  it('ein einzelnes Band ergibt genau einen Eintrag', () => {
    const e = parseScanResults('00:11:22:33:44:55\t2412\t-60\t[ESS]\tNur24')
    assert.equal(netzeAusScan(e)[0].proBand.length, 1)
  })
})

/**
 * Die Selbstbestaetigung (traegtDasNetz) — der Kern des Fixes vom 14.08.2026
 * gegen „wlan passwoerter nicht gespeichert": die Box schreibt selbst fest,
 * sobald sie BEWEISBAR im bestellten Netz haengt. Jede der drei Bedingungen
 * muss einzeln kippen koennen, sonst prueft die Funktion weniger, als der
 * Kommentar verspricht.
 */
describe('traegtDasNetz', () => {
  const VOLL = 'wpa_state=COMPLETED\nssid=Heimnetz\nip_address=192.168.178.30\nfreq=2412'

  it('COMPLETED im Ziel-Netz mit Adresse: ja', () => {
    assert.equal(traegtDasNetz(VOLL, 'Heimnetz'), true)
  })

  it('ein ANDERES Netz zaehlt nicht — auch nicht mit COMPLETED und Adresse', () => {
    // Genau der Rueckfall-Fall: wpa hat sich mit einem aelteren gespeicherten
    // Netz verbunden, das bestellte war ausser Reichweite.
    assert.equal(traegtDasNetz(VOLL, 'Gastnetz'), false)
  })

  it('ohne DHCP-Adresse: nein — assoziiert ist nicht angekommen', () => {
    assert.equal(traegtDasNetz('wpa_state=COMPLETED\nssid=Heimnetz\nfreq=2412', 'Heimnetz'), false)
  })

  it('4WAY_HANDSHAKE (falsches Passwort pendelt hier): nein', () => {
    assert.equal(
      traegtDasNetz('wpa_state=4WAY_HANDSHAKE\nssid=Heimnetz\nip_address=169.254.1.9', 'Heimnetz'),
      false,
    )
  })

  it('leere Eingabe: nein, ohne zu werfen', () => {
    assert.equal(traegtDasNetz('', 'Heimnetz'), false)
  })
})
