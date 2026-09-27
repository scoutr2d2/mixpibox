/**
 * Die Regeln aus vpn.ts, jede an ihrem Beispiel.
 *
 * Die Beispieldatei unten ist der Form nach ein FRITZ!Box-Export
 * („Einstellungen für das Gerät exportieren", FRITZ!OS 7.50+): zwei
 * DNS-Zeilen, PresharedKey, Heimnetz in AllowedIPs. Die Schlüssel sind
 * erfunden — 44 Zeichen base64, mehr prüft niemand, und ein echter
 * Schlüssel hätte in einem Test nichts verloren.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  beschreibung,
  dumpLesen,
  HANDSCHLAG_FRISCH_SEK,
  handschlagAlterSek,
  KEEPALIVE_VORGABE,
  konfigLesen,
  konfigSchreiben,
  netzForm,
  netzIstAlles,
  tunnelUrteil,
} from './vpn'

const PRIV = `k${'A'.repeat(42)}=`
const PUB = `p${'B'.repeat(42)}=`
const PSK = `s${'C'.repeat(42)}=`

const FRITZ_EXPORT = [
  '[Interface]',
  `PrivateKey = ${PRIV}`,
  'Address = 192.168.178.201/24',
  'DNS = 192.168.178.1',
  'DNS = fritz.box',
  '',
  '[Peer]',
  `PublicKey = ${PUB}`,
  `PresharedKey = ${PSK}`,
  'AllowedIPs = 192.168.178.0/24',
  'Endpoint = beispiel.myfritz.net:51820',
  '',
].join('\n')

describe('konfigLesen: der FRITZ!Box-Export', () => {
  it('nimmt ihn an, streicht DNS und ergänzt den Keepalive — beides mit Ansage', () => {
    const p = konfigLesen(FRITZ_EXPORT)
    assert.equal(p.ok, true)
    if (!p.ok) return
    assert.equal(p.konfig.endpunkt, 'beispiel.myfritz.net:51820')
    assert.deepEqual(p.konfig.erlaubteNetze, ['192.168.178.0/24'])
    assert.equal(p.konfig.keepalive, KEEPALIVE_VORGABE)
    assert.equal(p.konfig.hinweise.length, 2)
    assert.match(p.konfig.hinweise[0], /DNS-Zeile gestrichen/)
    assert.match(p.konfig.hinweise[0], /fritz\.box/)
    assert.match(p.konfig.hinweise[1], /PersistentKeepalive = 25 ergänzt/)
  })

  it('verträgt CRLF, Kommentare und Schlüssel ohne Leerzeichen um das =', () => {
    const p = konfigLesen(
      `# Kommentar\r\n[Interface]\r\nPrivateKey=${PRIV}\r\nAddress=10.0.0.2/32\r\n; noch einer\r\n[Peer]\r\nPublicKey=${PUB}\r\nAllowedIPs=192.168.178.0/24\r\nEndpoint=heim.example:1234\r\nPersistentKeepalive=25\r\n`,
    )
    assert.equal(p.ok, true)
    if (!p.ok) return
    assert.equal(p.konfig.keepalive, 25)
    assert.equal(p.konfig.hinweise.length, 0)
  })

  it('behält einen vorhandenen Keepalive und erfindet keinen Hinweis dazu', () => {
    const p = konfigLesen(FRITZ_EXPORT.replace('Endpoint =', 'PersistentKeepalive = 15\nEndpoint ='))
    assert.equal(p.ok, true)
    if (!p.ok) return
    assert.equal(p.konfig.keepalive, 15)
    assert.equal(p.konfig.hinweise.filter((h) => /Keepalive/i.test(h)).length, 0)
  })
})

describe('konfigLesen: was abgelehnt wird, und dass die Meldung den Weg nennt', () => {
  it('Volltunnel 0.0.0.0/0 — die Meldung nennt den Haken beim FRITZ!Box-Export', () => {
    const p = konfigLesen(FRITZ_EXPORT.replace('AllowedIPs = 192.168.178.0/24', 'AllowedIPs = 0.0.0.0/0'))
    assert.equal(p.ok, false)
    if (p.ok) return
    assert.match(p.fehler, /ALLES durch den Tunnel/)
    assert.match(p.fehler, /FRITZ!Box/)
  })

  it('auch der /1-Trick (0.0.0.0/1 + 128.0.0.0/1) ist ein Volltunnel', () => {
    const p = konfigLesen(FRITZ_EXPORT.replace('AllowedIPs = 192.168.178.0/24', 'AllowedIPs = 0.0.0.0/1, 128.0.0.0/1'))
    assert.equal(p.ok, false)
  })

  it('PostUp wird abgelehnt — das wäre ein Befehl, der als root liefe', () => {
    const p = konfigLesen(FRITZ_EXPORT.replace('[Peer]', 'PostUp = /bin/true\n[Peer]'))
    assert.equal(p.ok, false)
    if (p.ok) return
    assert.match(p.fehler, /root/)
  })

  it('SaveConfig und Table sind ebenso draußen', () => {
    for (const zeile of ['SaveConfig = true', 'Table = off']) {
      const p = konfigLesen(FRITZ_EXPORT.replace('[Peer]', `${zeile}\n[Peer]`))
      assert.equal(p.ok, false, zeile)
    }
  })

  it('ein unbekannter Schlüssel wird mit Zeilennummer genannt', () => {
    const p = konfigLesen(FRITZ_EXPORT.replace('[Peer]', 'Quatsch = 1\n[Peer]'))
    assert.equal(p.ok, false)
    if (p.ok) return
    assert.match(p.fehler, /Zeile 7/)
    assert.match(p.fehler, /Quatsch/)
  })

  it('zwei Gegenstellen sind keine Klient-Datei', () => {
    const p = konfigLesen(`${FRITZ_EXPORT}\n[Peer]\nPublicKey = ${PUB}\nAllowedIPs = 10.1.0.0/24\nEndpoint = x.y:1\n`)
    assert.equal(p.ok, false)
    if (p.ok) return
    assert.match(p.fehler, /Gegenstelle/)
  })

  it('fehlende Pflichtfelder werden einzeln benannt', () => {
    const faelle: Array<[string, RegExp]> = [
      [`PrivateKey = ${PRIV}\n`, /PrivateKey/],
      ['Address = 192.168.178.201/24\n', /Address/],
      [`PublicKey = ${PUB}\n`, /PublicKey/],
      ['AllowedIPs = 192.168.178.0/24\n', /AllowedIPs/],
      ['Endpoint = beispiel.myfritz.net:51820\n', /Endpoint/],
    ]
    for (const [zeile, muster] of faelle) {
      const p = konfigLesen(FRITZ_EXPORT.replace(zeile, ''))
      assert.equal(p.ok, false, zeile)
      if (!p.ok) assert.match(p.fehler, muster)
    }
  })

  it('ein Schlüssel mit falscher Form fällt durch, bevor er irgendwo landet', () => {
    const p = konfigLesen(FRITZ_EXPORT.replace(PRIV, 'zu-kurz'))
    assert.equal(p.ok, false)
  })

  it('Endpoint ohne Port fällt durch', () => {
    const p = konfigLesen(FRITZ_EXPORT.replace('beispiel.myfritz.net:51820', 'beispiel.myfritz.net'))
    assert.equal(p.ok, false)
  })

  it('leer ist leer', () => {
    assert.equal(konfigLesen('').ok, false)
    assert.equal(konfigLesen('   \n').ok, false)
  })
})

describe('konfigSchreiben', () => {
  it('schreibt eine Datei, die beim Wiederlesen dasselbe ergibt — ohne DNS, mit Keepalive', () => {
    const erste = konfigLesen(FRITZ_EXPORT)
    assert.equal(erste.ok, true)
    if (!erste.ok) return
    const text = konfigSchreiben(erste.konfig)
    assert.doesNotMatch(text, /DNS/i)
    assert.match(text, /PersistentKeepalive = 25/)
    const zweite = konfigLesen(text)
    assert.equal(zweite.ok, true)
    if (!zweite.ok) return
    assert.deepEqual({ ...zweite.konfig, hinweise: [] }, { ...erste.konfig, hinweise: [] })
    // Deterministisch: dieselbe Konfiguration, dieselben Bytes.
    assert.equal(konfigSchreiben(zweite.konfig), text)
  })
})

describe('beschreibung: was die Oberfläche sehen darf', () => {
  it('enthält weder den privaten noch den Preshared-Schlüssel', () => {
    const p = konfigLesen(FRITZ_EXPORT)
    assert.equal(p.ok, true)
    if (!p.ok) return
    const text = JSON.stringify(beschreibung(p.konfig))
    assert.equal(text.includes(PRIV), false)
    assert.equal(text.includes(PSK), false)
    assert.equal(text.includes(PUB), true)
  })
})

describe('dumpLesen: wg show <name> dump', () => {
  const DUMP = [
    `${PRIV}\t${PUB}\t51820\toff`,
    `${PUB}\t${PSK}\t93.184.216.34:51820\t192.168.178.0/24\t1757600000\t1234\t5678\t25`,
  ].join('\n')

  it('überspringt die Schnittstellenzeile und die Geheimnisse der Peer-Zeile', () => {
    const stand = dumpLesen(DUMP)
    assert.equal(stand.length, 1)
    const text = JSON.stringify(stand)
    assert.equal(text.includes(PRIV), false)
    assert.equal(text.includes(PSK), false)
    assert.equal(stand[0].endpunkt, '93.184.216.34:51820')
    assert.deepEqual(stand[0].erlaubteNetze, ['192.168.178.0/24'])
    assert.equal(stand[0].handschlagEpochenSek, 1757600000)
    assert.equal(stand[0].empfangen, 1234)
    assert.equal(stand[0].gesendet, 5678)
  })

  it('(none) heißt: noch kein Endpunkt — und Handschlag 0 heißt: nie', () => {
    const stand = dumpLesen(`${PRIV}\t${PUB}\t51820\toff\n${PUB}\t(none)\t(none)\t(none)\t0\t0\t0\toff`)
    assert.equal(stand.length, 1)
    assert.equal(stand[0].endpunkt, null)
    assert.deepEqual(stand[0].erlaubteNetze, [])
    assert.equal(stand[0].handschlagEpochenSek, null)
  })

  it('leere oder fremde Ausgabe ergibt eine leere Liste, keinen Wurf', () => {
    assert.deepEqual(dumpLesen(''), [])
    assert.deepEqual(dumpLesen('Unable to access interface: No such device'), [])
  })
})

describe('Handschlag und Urteil', () => {
  it('rechnet das Alter aus der Epochenzeit', () => {
    const jetzt = 1757600030_000
    assert.equal(handschlagAlterSek(1757600000, jetzt), 30)
    assert.equal(handschlagAlterSek(null, jetzt), null)
    assert.equal(handschlagAlterSek(0, jetzt), null)
  })

  it('steht / stand / nie — die Grenze liegt bei HANDSCHLAG_FRISCH_SEK', () => {
    assert.equal(tunnelUrteil(null), 'nie')
    assert.equal(tunnelUrteil(0), 'steht')
    assert.equal(tunnelUrteil(HANDSCHLAG_FRISCH_SEK), 'steht')
    assert.equal(tunnelUrteil(HANDSCHLAG_FRISCH_SEK + 1), 'stand')
  })
})

describe('netzIstAlles / netzForm', () => {
  it('erkennt /0 und /1 als „alles", echte Heimnetze nicht', () => {
    assert.equal(netzIstAlles('0.0.0.0/0'), true)
    assert.equal(netzIstAlles('::/0'), true)
    assert.equal(netzIstAlles('128.0.0.0/1'), true)
    assert.equal(netzIstAlles('192.168.178.0/24'), false)
    assert.equal(netzIstAlles('192.168.178.1'), false)
  })

  it('prüft die Form, ohne IPv6 nachzurechnen', () => {
    assert.equal(netzForm('192.168.178.0/24'), true)
    assert.equal(netzForm('192.168.178.201'), true)
    assert.equal(netzForm('300.1.1.1/24'), false)
    assert.equal(netzForm('192.168.178.0/33'), false)
    assert.equal(netzForm('fd00::1/64'), true)
    assert.equal(netzForm('kein-netz'), false)
    assert.equal(netzForm('10.0.0.0/8/9'), false)
  })
})
