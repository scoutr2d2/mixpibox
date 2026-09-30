/**
 * Zeugen fuer kopplung.ts — die Regeln, an denen die Sperre der Handy-App
 * haengt. Die Routen in server.ts pruefen nur, dass sie diese Regeln rufen.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createHash } from 'node:crypto'
import {
  ablageAus,
  appDarf,
  beweiseFuer,
  beweisVon,
  codeErzeugen,
  FENSTER_MS,
  geraetAnlegen,
  geraetEntfernen,
  geraetZuSchluessel,
  KOPPLUNG_LEER,
  Kopplungsfenster,
  MAX_FEHLVERSUCHE,
  MAX_FEHLVERSUCHE_GESAMT,
  nameSauber,
  qrInhalt,
  qrLesen,
} from './kopplung'

const fest = (n: number) => () => Buffer.alloc(32, n)

describe('der Code', () => {
  it('hat immer sechs Ziffern, auch mit fuehrenden Nullen', () => {
    assert.equal(
      codeErzeugen(() => 42),
      '000042',
    )
    assert.equal(
      codeErzeugen(() => 999_999),
      '999999',
    )
  })
})

describe('das Kopplungsfenster', () => {
  it('koppelt mit dem richtigen Code genau EINMAL', () => {
    const f = new Kopplungsfenster()
    f.oeffnen(0, '123456')
    assert.equal(f.pruefen('123456', 1000), 'ok')
    // Bis 29.09.2026 hiess das „keins" — und das zweite Handy las „kein Code
    // offen", waehrend die Eltern ihn noch am Schirm sahen.
    assert.equal(f.pruefen('123456', 1001), 'vergeben', 'ein zweites Handy mit demselben Code: nein — und warum')
    assert.equal(f.pruefen('123456', FENSTER_MS + 1), 'keins', 'nach der Frist weiss es niemand mehr')
  })

  it('von Hand geschlossen weiss es niemand mehr', () => {
    const f = new Kopplungsfenster()
    f.oeffnen(0, '123456')
    assert.equal(f.pruefen('123456', 1), 'ok')
    f.schliessen()
    assert.equal(f.pruefen('123456', 2), 'keins')
  })

  it('laeuft nach der Frist ab', () => {
    const f = new Kopplungsfenster()
    f.oeffnen(0, '123456')
    assert.equal(f.pruefen('123456', FENSTER_MS + 1), 'abgelaufen')
    assert.equal(f.offen(FENSTER_MS + 1), null)
  })

  it(`nach ${MAX_FEHLVERSUCHE} Fehlversuchen ist der Code fuer DIESES Geraet verbrannt — auch der richtige`, () => {
    const f = new Kopplungsfenster()
    f.oeffnen(0, '123456')
    for (let i = 0; i < MAX_FEHLVERSUCHE; i++) assert.equal(f.pruefen('000000', 1, '192.168.178.66'), 'falsch')
    assert.equal(f.pruefen('123456', 2, '192.168.178.66'), 'zuOft')
  })

  it('ein ratendes Geraet verbrennt den Code NICHT fuer das Handy der Eltern (Rang 6d)', () => {
    const f = new Kopplungsfenster()
    f.oeffnen(0, '123456')
    for (let i = 0; i < MAX_FEHLVERSUCHE + 3; i++) f.pruefen(String(i).padStart(6, '0'), 1, '192.168.178.66')
    assert.equal(f.pruefen('123456', 2, '192.168.178.40'), 'ok')
  })

  it(`alle zusammen: nach ${MAX_FEHLVERSUCHE_GESAMT} Fehlversuchen ist das Fenster fuer jeden zu`, () => {
    const f = new Kopplungsfenster()
    f.oeffnen(0, '123456')
    const geraete = MAX_FEHLVERSUCHE_GESAMT / MAX_FEHLVERSUCHE
    for (let g = 0; g < geraete; g++) {
      for (let i = 0; i < MAX_FEHLVERSUCHE; i++) assert.equal(f.pruefen('000000', 1, `10.0.0.${g}`), 'falsch')
    }
    assert.equal(f.pruefen('123456', 2, '192.168.178.40'), 'zuOft', 'das naechste Geraet erfaehrt den Grund')
  })

  it('ein Fenster FUER ein Handy nimmt den Code von keinem anderen', () => {
    const f = new Kopplungsfenster()
    f.oeffnen(0, '123456', '192.168.178.40')
    assert.equal(f.pruefen('123456', 1, '192.168.178.41'), 'falsch', 'fremdes Handy mit mitgelesenem Code')
    assert.equal(f.pruefen('123456', 2, '192.168.178.40'), 'ok')
  })

  it('fremde Versuche gehen nicht vom Konto des gebetenen Handys ab', () => {
    const f = new Kopplungsfenster()
    f.oeffnen(0, '123456', '192.168.178.40')
    for (let i = 0; i < MAX_FEHLVERSUCHE; i++) f.pruefen('123456', 1, '192.168.178.41')
    assert.equal(f.pruefen('123456', 2, '192.168.178.40'), 'ok')
  })

  it('nimmt nur Zeichenketten gleicher Laenge', () => {
    const f = new Kopplungsfenster()
    f.oeffnen(0, '123456')
    assert.equal(f.pruefen(123456, 1), 'falsch')
    assert.equal(f.pruefen('1234567', 1), 'falsch')
  })
})

describe('Geraete und Schluessel', () => {
  it('speichert nur den Abdruck — der Schluessel steht nirgends in der Ablage', () => {
    const { ablage, schluessel } = geraetAnlegen(KOPPLUNG_LEER, 'Achims Honor', 5, fest(7))
    assert.equal(schluessel.length, 64)
    assert.equal(JSON.stringify(ablage).includes(schluessel), false)
    assert.equal(geraetZuSchluessel(ablage, schluessel)?.name, 'Achims Honor')
  })

  it('erkennt einen falschen oder kaputten Schluessel nicht', () => {
    const { ablage } = geraetAnlegen(KOPPLUNG_LEER, 'x', 5, fest(7))
    assert.equal(geraetZuSchluessel(ablage, 'f'.repeat(64)), null)
    assert.equal(geraetZuSchluessel(ablage, 'kein hex'), null)
    assert.equal(geraetZuSchluessel(ablage, undefined), null)
  })

  it('ein entferntes Handy kommt nicht mehr durch', () => {
    const { ablage, schluessel, id } = geraetAnlegen(KOPPLUNG_LEER, 'x', 5, fest(7))
    assert.equal(geraetZuSchluessel(geraetEntfernen(ablage, id), schluessel), null)
  })
})

describe('was die App darf', () => {
  const { ablage, schluessel } = geraetAnlegen(KOPPLUNG_LEER, 'x', 5, fest(7))

  it('ohne Schluessel nur sich finden, koppeln und fragen', () => {
    assert.equal(appDarf(ablage, '/api/box', undefined), true)
    assert.equal(appDarf(ablage, '/api/kopplung/koppeln', undefined), true)
    assert.equal(appDarf(ablage, '/api/kopplung/status', undefined), true)
    assert.equal(appDarf(ablage, '/api/kopplung/beweis', undefined), true, 'die Frage „bist du dieselbe Box?" braucht keinen Schluessel')
    assert.equal(appDarf(ablage, '/api/profile', undefined), false)
    assert.equal(appDarf(ablage, '/player/local', 'f'.repeat(64)), false)
  })

  it('mit Schluessel alles', () => {
    assert.equal(appDarf(ablage, '/api/profile', schluessel), true)
  })

  it('im Debug-Modus der Box alles, auch ohne Schluessel', () => {
    assert.equal(appDarf({ ...ablage, ohneKopplung: true }, '/api/profile', undefined), true)
  })
})

describe('die Ablage lesen', () => {
  it('oeffnet die Box NICHT, wenn die Datei kaputt ist', () => {
    assert.equal(ablageAus(null).ohneKopplung, false)
    assert.equal(ablageAus({ ohneKopplung: 'ja' }).ohneKopplung, false)
    assert.equal(ablageAus({ ohneKopplung: true }).ohneKopplung, true)
  })

  it('wirft Eintraege ohne gueltigen Abdruck weg', () => {
    const a = ablageAus({
      geraete: [
        { id: 'a', abdruck: 'zu-kurz' },
        { id: 'b', abdruck: 'a'.repeat(64) },
      ],
    })
    assert.deepEqual(
      a.geraete.map((g) => g.id),
      ['b'],
    )
  })

  it('macht aus jedem Namen etwas Einzeiliges, Kurzes, nie Leeres', () => {
    assert.equal(nameSauber('  a\nb  '), 'a b')
    assert.equal(nameSauber(''), 'Handy')
    assert.equal(nameSauber('x'.repeat(99)).length, 40)
  })
})

describe('der Beweis „dieselbe Box" (Rang 6a)', () => {
  const abdruck = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

  it('rechnet wie die App — derselbe Prueffall steht in handy-app/test/box_client_test.dart', () => {
    // Einmal mit node:crypto und einmal mit Pythons hmac gerechnet (29.09.2026).
    assert.equal(
      beweisVon(abdruck('a'.repeat(64)), '0'.repeat(32)),
      'ad2f33b3f79acd206fccd0f571f1d6f7204f0e962e737772e5883c2670db7006',
    )
  })

  it('antwortet je Handy — und die Antwort traegt weder Schluessel noch Abdruck', () => {
    const eins = geraetAnlegen(KOPPLUNG_LEER, 'a', 1, fest(1))
    const zwei = geraetAnlegen(eins.ablage, 'b', 2, fest(2))
    const frage = 'f'.repeat(32)
    const b = beweiseFuer(zwei.ablage, frage)
    assert.deepEqual(b, [beweisVon(abdruck(eins.schluessel), frage), beweisVon(abdruck(zwei.schluessel), frage)])
    const text = JSON.stringify(b)
    for (const geheim of [eins.schluessel, zwei.schluessel, abdruck(eins.schluessel), abdruck(zwei.schluessel)]) {
      assert.equal(text.includes(geheim), false)
    }
  })

  it('eine andere Frage gibt einen anderen Beweis — eine alte Antwort taugt nicht fuer eine neue Frage', () => {
    const { ablage } = geraetAnlegen(KOPPLUNG_LEER, 'a', 1, fest(1))
    assert.notDeepEqual(beweiseFuer(ablage, '0'.repeat(32)), beweiseFuer(ablage, '1'.repeat(32)))
  })

  it('nimmt nur eine Frage aus 32 bis 128 Hex-Zeichen', () => {
    for (const unsinn of [undefined, 42, '', 'abc', 'g'.repeat(32), '0'.repeat(31), '0'.repeat(129)]) {
      assert.equal(beweiseFuer(KOPPLUNG_LEER, unsinn), null, String(unsinn))
    }
    assert.deepEqual(beweiseFuer(KOPPLUNG_LEER, '0'.repeat(32)), [])
  })
})

describe('der QR', () => {
  it('traegt Adresse, Port und Code — und passt in die 42 Bytes des Kinderschirms', () => {
    const q = qrInhalt('192.168.178.62', 8200, '012345')
    assert.deepEqual(qrLesen(q), { adresse: '192.168.178.62', port: 8200, code: '012345' })
    // Die laengste denkbare IPv4-Adresse und ein fuenfstelliger Port.
    assert.ok(Buffer.byteLength(qrInhalt('255.255.255.255', 65535, '999999')) <= 42)
  })

  it('liest nichts, was nicht genau diese Form hat', () => {
    assert.equal(qrLesen('mixpi:1.2.3.4:8200:12345'), null)
    assert.equal(qrLesen('https://example.org'), null)
    assert.equal(qrLesen(undefined), null)
  })
})
