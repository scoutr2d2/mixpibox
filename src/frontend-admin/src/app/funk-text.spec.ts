/**
 * Was auf den Funkschaltern stehen MUSS.
 *
 * Der Prueffall, um den es hier wirklich geht, ist der dritte: hat die Box
 * keinen zweiten Weg, darf DORT KEIN KNOPF STEHEN. Nicht ein ausgegrauter,
 * nicht einer mit Warnung — keiner. Ein Knopf, der 409 kassiert, sieht aus
 * wie ein Fehler der Box, dabei ist es der Schutz vor dem Aussperren.
 */
import { knopflage, rueckfrage, wegText } from './funk-text'
import type { Funklage } from './netzwerk.dienst'

const NUR_WLAN: Funklage = {
  bluetooth: { an: true, vorhanden: true },
  wlan: { an: true, name: 'wlan0', vorhanden: true, adresse: '192.168.178.169' },
  flug: false,
  wege: [
    { name: 'eth0', funk: false, adresse: '', kabel: null, zustand: 'down', traegt: false, eigenstaendig: true },
    {
      name: 'wlan0',
      funk: true,
      adresse: '192.168.178.169',
      kabel: true,
      zustand: 'up',
      traegt: true,
      eigenstaendig: false,
    },
  ],
  zweiterWeg: null,
  ausErlaubt: false,
  grund: 'Die Box hängt nur am WLAN. Ausschalten macht sie unerreichbar.',
  vonDerBox: false,
  schaltweg: 'ifupdown',
}

const MIT_KABEL: Funklage = {
  ...NUR_WLAN,
  zweiterWeg: {
    name: 'eth0',
    funk: false,
    adresse: '192.168.178.42',
    kabel: true,
    zustand: 'up',
    traegt: true,
    eigenstaendig: true,
  },
  ausErlaubt: true,
  grund:
    'Die Box bleibt über 192.168.178.42 (eth0) erreichbar. Wer diese Seite gerade über WLAN bedient, verliert sie trotzdem.',
}

describe('knopflage', () => {
  it('ohne zweiten Weg steht KEIN Knopf da, sondern der Grund', () => {
    const k = knopflage(NUR_WLAN)
    expect(k.knopf).toBe(false)
    expect(k.satz).toContain('nur am WLAN')
    expect(k.satz).toContain('nur an der Box selbst')
  })

  it('mit Kabel steht der Knopf da', () => {
    const k = knopflage(MIT_KABEL)
    expect(k.knopf).toBe(true)
    expect(k.vorOrt).toBe(false)
    expect(k.satz).toContain('192.168.178.42')
  })

  it('auf dem Schirm der Box geht es auch ohne Kabel — mit vorOrt', () => {
    const k = knopflage({ ...NUR_WLAN, vonDerBox: true })
    expect(k.knopf).toBe(true)
    expect(k.vorOrt).toBe(true)
    expect(k.satz).toContain('nur dort')
  })

  it('rechnet die Regel NICHT nach: ausErlaubt vom Backend entscheidet', () => {
    // Hier gibt es keinen zweiten Weg im `wege`-Feld, das Backend sagt aber
    // „erlaubt" (z. B. weil es etwas sieht, das diese Fassung nicht kennt).
    // Dann steht der Knopf da. Die Oberflaeche ist nicht die Instanz.
    expect(knopflage({ ...NUR_WLAN, ausErlaubt: true }).knopf).toBe(true)
  })

  it('sagt beim Laden nichts Falsches', () => {
    expect(knopflage(null).knopf).toBe(false)
  })
})

describe('rueckfrage', () => {
  it('nennt die andere Adresse — und den Verlust der eigenen Sitzung', () => {
    const t = rueckfrage(MIT_KABEL, 'WLAN')
    expect(t).toContain('192.168.178.42')
    expect(t).toContain('Kabel')
    expect(t).toContain('über WLAN bedient, verliert sie trotzdem')
  })

  it('sagt beim Flugmodus dazu, dass Bluetooth mit ausgeht', () => {
    expect(rueckfrage(MIT_KABEL, 'Flugmodus')).toContain('Bluetooth geht mit aus')
  })

  it('ohne zweiten Weg wird nichts beschönigt', () => {
    const t = rueckfrage(NUR_WLAN, 'WLAN')
    expect(t).toContain('keinen zweiten Weg')
    expect(t).toContain('nur noch am Gerät selbst')
  })
})

describe('wegText', () => {
  it('unterscheidet „kein Kabel" von „nicht feststellbar"', () => {
    expect(wegText({ adresse: '', kabel: null, zustand: 'down' })).toBe('keine Adresse · down')
    expect(wegText({ adresse: '', kabel: false, zustand: 'down' })).toBe('keine Adresse · kein Kabel · down')
    expect(wegText({ adresse: '10.0.0.5', kabel: true, zustand: 'up' })).toBe('10.0.0.5 · Kabel steckt · up')
  })
})
