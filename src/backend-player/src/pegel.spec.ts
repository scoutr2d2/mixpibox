// Tests für pegel.ts.
//
// REIN gehalten, nach dem Muster von mpv-protokoll.spec.ts: kein Ton, kein
// echter Prozess. Die Goertzel-/Normierungs-Kette wird gegen SYNTHETISCHE
// PCM-Puffer geprüft (selbst erzeugte Sinuslinien) — kein pw-record, kein
// Mikrofon, keine Box noetig. Die eine Ausnahme (Fehlertoleranz) prueft die
// Verkabelung ueber eine FAKE-Spawn-Funktion — ebenfalls kein echter Prozess,
// nur ein Objekt mit `.on()`, so wie `erzeugePegelSteuerung` es erwartet.

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'

import {
  ABTASTRATE,
  EIGENNAME,
  erzeugePegelSteuerung,
  FENSTER_PROBEN,
  VERFALL_MS,
  goertzelBetrag,
  pegelAusFenster,
  pwRecordArgumente,
} from './pegel'

/** Eine s16-LE-PCM-Sinuslinie als Buffer — der einzige Erzeuger, den diese Datei braucht. */
function sinusPuffer(hz: number, amplitude: number, anzahlProben = FENSTER_PROBEN, rate = ABTASTRATE): Buffer {
  const puffer = Buffer.alloc(anzahlProben * 2)
  for (let i = 0; i < anzahlProben; i++) {
    const wert = Math.round(amplitude * Math.sin((2 * Math.PI * hz * i) / rate))
    puffer.writeInt16LE(wert, i * 2)
  }
  return puffer
}

/** `Buffer.alloc` nullt bereits — eigens benannt, damit die Tests lesbar bleiben. */
function stillePuffer(anzahlProben = FENSTER_PROBEN): Buffer {
  return Buffer.alloc(anzahlProben * 2)
}

describe('pwRecordArgumente — die Kommandozeile IST der Vertrag', () => {
  it('entspricht genau dem entschiedenen Aufruf', () => {
    // Der exakte Aufruf, wortgleich zum Kopfkommentar von pegel.ts. Ein Test,
    // der das als GANZES Array prueft statt nur einzelne Schalter, faengt
    // auch eine vertauschte Reihenfolge (z. B. --channels ohne Wert davor).
    assert.deepEqual(pwRecordArgumente(), [
      '-P',
      `{ node.name = "${EIGENNAME}" }`,
      '--rate',
      '16000',
      '--channels',
      '1',
      '--format',
      's16',
      '--raw',
      '-',
    ])
  })

  it('ruft OHNE --target auf — Absicht, kein Versehen (siehe Kopfkommentar pegel.ts)', () => {
    // Ein --target wuerde HIER am Ziel vorbeischiessen: ohne --target sucht
    // sich pw-record den Monitor der Standard-Senke selbst (an dieser Box in
    // plugins/mixpi-mitschnitt/arbeiter.mjs bereits gemessen) — GENAU das
    // will dieses Modul. Wer das "reparieren" will, zerstoert den Vertrag.
    assert.ok(!pwRecordArgumente().includes('--target'))
  })

  it('gibt stdout aus ("-") und traegt den eigenen node.name', () => {
    const args = pwRecordArgumente()
    assert.equal(args.at(-1), '-')
    assert.ok(args.some((a) => a.includes(EIGENNAME)))
  })
})

describe('goertzelBetrag — Energie bei EINER Frequenz, ohne FFT', () => {
  it('schlaegt bei exaktem Treffer auf einer Vollausschlag-Sinuslinie deutlich aus', () => {
    // Analytisch wie am Rechner nachgerechnet: Vollausschlag/2 ~ 16383,5 —
    // siehe den Kopfkommentar von pegel.ts (NORMIERUNGS_BEZUG).
    const betrag = goertzelBetrag(sinusPuffer(440, 32767), FENSTER_PROBEN, 440, ABTASTRATE)
    assert.ok(betrag > 15000 && betrag < 17000, `unerwarteter Betrag: ${betrag}`)
  })

  it('bleibt bei Stille exakt 0', () => {
    assert.equal(goertzelBetrag(stillePuffer(), FENSTER_PROBEN, 440, ABTASTRATE), 0)
  })

  it('faellt bei einer Linie knapp daneben fast auf 0 (Fensterbreite ~10 Hz bei N=1600/16 kHz)', () => {
    const puffer = sinusPuffer(440, 32767)
    const daneben = goertzelBetrag(puffer, FENSTER_PROBEN, 4500, ABTASTRATE)
    assert.ok(daneben < 1, `sollte praktisch 0 sein, war ${daneben}`)
  })

  it('ist unabhaengig von der Phase (dieselbe Linie, verschiedene Startpunkte)', () => {
    // Der Betrag ist |X(f)|, keine Momentaufnahme - siehe tools/box/mitschnitt-machbar.py.
    const referenz = goertzelBetrag(sinusPuffer(440, 32767), FENSTER_PROBEN, 440, ABTASTRATE)
    const puffer = Buffer.alloc(FENSTER_PROBEN * 2)
    for (let i = 0; i < FENSTER_PROBEN; i++) {
      puffer.writeInt16LE(Math.round(32767 * Math.sin((2 * Math.PI * 440 * i) / ABTASTRATE + 1.7)), i * 2)
    }
    const verschoben = goertzelBetrag(puffer, FENSTER_PROBEN, 440, ABTASTRATE)
    assert.ok(Math.abs(referenz - verschoben) < 1, `${referenz} vs ${verschoben}`)
  })
})

describe('pegelAusFenster — die vier Baender ueber ein 100-ms-Fenster', () => {
  it('Stille ergibt exakt [0,0,0,0] (BACKLOG E99: "wenn es still ist, ist auch die amplitude null")', () => {
    assert.deepEqual(pegelAusFenster(stillePuffer()), [0, 0, 0, 0])
  })

  it('ein 440-Hz-Ton hebt Band 2 (untere Mitten), nicht Band 4 (Hoehen)', () => {
    // 20 % Vollausschlag: laut genug fuer einen klaren, aber ungedeckelten
    // Ausschlag (der Deckel wird im naechsten Test eigens geprueft).
    const [bass, untereMitten, obereMitten, hoehen] = pegelAusFenster(sinusPuffer(440, 0.2 * 32767))
    assert.ok(untereMitten > 0.4, `Band 2 sollte deutlich ausschlagen, war ${untereMitten}`)
    assert.ok(hoehen < 0.01, `Band 4 sollte praktisch still bleiben, war ${hoehen}`)
    assert.ok(bass < 0.01, `Band 1 sollte praktisch still bleiben, war ${bass}`)
    assert.ok(obereMitten < 0.01, `Band 3 sollte praktisch still bleiben, war ${obereMitten}`)
  })

  it('Saettigung deckelt bei 1 (eine volle Sinuslinie uebersteuert den Normierungs-Bezug)', () => {
    const [, untereMitten] = pegelAusFenster(sinusPuffer(440, 32767))
    assert.equal(untereMitten, 1)
  })

  it('kein Band verlaesst je [0,1] — auch nicht bei extremem Eingang', () => {
    for (const wert of pegelAusFenster(sinusPuffer(130, 32767))) {
      assert.ok(wert >= 0 && wert <= 1, `${wert} liegt ausserhalb [0,1]`)
    }
  })
})

describe('Fehlertoleranz (AUFGABEN 2d) — ohne echten Prozess', () => {
  it('meldet einen gescheiterten Abgriff GENAU EINMAL und versucht danach nicht erneut', async () => {
    let anzahlSpawns = 0
    let protokollAufrufe = 0
    const fakeSpawn = (): any => {
      anzahlSpawns++
      const p = new EventEmitter() as any
      p.stdout = new EventEmitter()
      p.stderr = new EventEmitter()
      p.kill = () => true
      // Wie ein echtes ENOENT: der Fehler kommt als asynchrones Ereignis,
      // nicht als Wurf aus `spawn()` selbst.
      queueMicrotask(() => p.emit('error', new Error('kein pw-record auf dieser Box')))
      return p
    }
    const steuerung = erzeugePegelSteuerung(fakeSpawn)
    const protokoll = () => {
      protokollAufrufe++
    }

    steuerung.starten(protokoll)
    await new Promise((f) => setImmediate(f))

    assert.equal(steuerung.lesen(), undefined, 'nach dem Fehlschlag muss das Feld FEHLEN, nicht [0,0,0,0] sein')
    assert.equal(protokollAufrufe, 1)

    // Ein zweiter Start (das naechste Abspielen) darf weder erneut spawnen
    // noch erneut melden — "EIN Protokolleintrag, nicht je Versuch".
    steuerung.starten(protokoll)
    await new Promise((f) => setImmediate(f))
    assert.equal(anzahlSpawns, 1)
    assert.equal(protokollAufrufe, 1)
  })

  it('stoppen() ist sicher, auch wenn nie gestartet wurde — und lesen() zeigt [0,0,0,0]', () => {
    const steuerung = erzeugePegelSteuerung((() => {
      throw new Error('darf ohne starten() nicht aufgerufen werden')
    }) as any)
    assert.doesNotThrow(() => steuerung.stoppen())
    assert.deepEqual(steuerung.lesen(), [0, 0, 0, 0])
  })
})

/* ══ E138: DIE WELLE LIEF BEI PAUSE WEITER ═════════════════════════════════
 *
 * Gemeldet vom Betreiber („läuft bei stopp"). Die Ursache lag NICHT im
 * Frontend — drei Anläufe dort sind gescheitert, weil sie versuchten, einen
 * falschen Wert zu erkennen, statt ihn gar nicht erst zu liefern. Sie lag
 * hier: `aktuell` wird nur bei einem vollen Fenster überschrieben, und
 * PipeWire suspendiert den Monitor bei Pause — also reichte `lesen()` den
 * letzten gehörten Augenblick ewig weiter.
 */
describe('E138 — ein gemessener Pegel hat ein Alter', () => {
  /** Ein Fake-Prozess, dem man von Hand Ton in den stdout schieben kann. */
  const fakeMitStdout = () => {
    const p = new EventEmitter() as any
    p.stdout = new EventEmitter()
    p.stderr = new EventEmitter()
    p.kill = () => true
    return p
  }

  /** Ein volles Fenster mit hörbarem Inhalt (Vollausschlag, nicht Stille). */
  const vollesFenster = () => {
    const b = Buffer.alloc(FENSTER_PROBEN * 2)
    for (let i = 0; i < FENSTER_PROBEN; i++) b.writeInt16LE(i % 2 === 0 ? 20000 : -20000, i * 2)
    return b
  }

  it('liefert den frisch gemessenen Wert — und nach dem Verfall Nullen', () => {
    let uhr = 1000
    const p = fakeMitStdout()
    const steuerung = erzeugePegelSteuerung((() => p) as any, () => uhr)
    steuerung.starten()
    p.stdout.emit('data', vollesFenster())

    const frisch = steuerung.lesen() as readonly number[]
    assert.ok(
      frisch.some((x) => x > 0),
      'unmittelbar nach dem Fenster muss ein Pegel dastehen',
    )

    // Genau an der Grenze gilt er noch — die Frist ist ein `>`, kein `>=`.
    uhr += VERFALL_MS
    assert.deepEqual(steuerung.lesen(), frisch, 'auf der Grenze gilt der Wert noch')

    // Eine Millisekunde darüber ist er eine Erinnerung, keine Messung.
    uhr += 1
    assert.deepEqual(steuerung.lesen(), [0, 0, 0, 0], 'nach dem Verfall muessen es Nullen sein')
  })

  it('ein neues Fenster macht den Wert wieder jung', () => {
    // Der Fall „Wiedergabe geht weiter": nach dem Verfall darf die Welle
    // nicht tot bleiben, sonst hätte der Fix den Fehler nur umgedreht.
    let uhr = 1000
    const p = fakeMitStdout()
    const steuerung = erzeugePegelSteuerung((() => p) as any, () => uhr)
    steuerung.starten()
    p.stdout.emit('data', vollesFenster())
    uhr += VERFALL_MS + 1
    assert.deepEqual(steuerung.lesen(), [0, 0, 0, 0])

    p.stdout.emit('data', vollesFenster())
    assert.ok((steuerung.lesen() as readonly number[]).some((x) => x > 0), 'frischer Ton zaehlt wieder')
  })

  it('OHNE JEDES FENSTER sind es Nullen, nicht der Rest eines Vorlaufs', () => {
    let uhr = 1000
    const p = fakeMitStdout()
    const steuerung = erzeugePegelSteuerung((() => p) as any, () => uhr)
    steuerung.starten()
    assert.deepEqual(steuerung.lesen(), [0, 0, 0, 0])
  })

  it('ein fehlender Abgriff bleibt `undefined` — der Verfall darf das nicht zu Nullen machen', () => {
    // Der Unterschied ist der ganze Sinn des Feldes: „kein Abgriff moeglich"
    // laesst `pegel` aus der Antwort FALLEN, „gerade still" schickt Nullen.
    const steuerung = erzeugePegelSteuerung((() => {
      throw new Error('kein pw-record')
    }) as any, () => 1000)
    steuerung.starten()
    assert.equal(steuerung.lesen(), undefined)
  })
})
