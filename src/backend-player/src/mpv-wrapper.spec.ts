// Tests für die Verkabelung in mpv-wrapper.ts.
//
// Gegen einen ECHTEN Unix-Socket, nicht gegen eine Attrappe: der Doppelgänger
// ist ein kleines Node-Programm, das sich wie mpv verhält — Socket anlegen,
// Zeilen entgegennehmen, auf Wunsch Ereignisse schicken. Damit wird das
// geprüft, was zwischen Prozess und Protokoll wirklich passiert: Warten auf
// den Socket, Zeilen zusammensetzen, Antworten zuordnen.
//
// mpv selbst lässt sich hier nicht verwenden: auf dem Entwicklungsrechner ist
// es zwar installiert (0.41.0), startet aber nicht — libluajit fordert
// GLIBC_2.44, das System hat 2.43. Der Beweis gegen echtes mpv gehört
// ohnehin auf die Box (dort 0.40.0 aus dem Debian-Archiv).

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

type Player = ReturnType<typeof import('./mpv-wrapper')>

let ordner = ''
let pfadVorher = ''
const spieler: Player[] = []

// Der Doppelgänger. Er ist bewusst KEIN Mock im Testprozess, sondern ein
// eigener Prozess mit echtem Socket — sonst prüfte der Test die Verkabelung
// nicht, sondern nur sich selbst.
const DOPPELGAENGER = `
const net = require('net'), fs = require('fs')
const sockArg = process.argv.find(a => a.startsWith('--input-ipc-server='))
const sockPfad = sockArg.split('=')[1]
const protokoll = process.env.MPVTEST + '/empfangen'
fs.writeFileSync(protokoll, '')
let klient = null
const server = net.createServer(s => {
  klient = s
  s.setEncoding('utf8')
  let rest = ''
  s.on('data', stueck => {
    rest += stueck
    const zeilen = rest.split('\\n'); rest = zeilen.pop() || ''
    for (const z of zeilen) {
      if (!z.trim()) continue
      fs.appendFileSync(protokoll, z + '\\n')
      const o = JSON.parse(z)
      const c = o.command || []
      if (c[0] === 'quit') { s.end(); process.exit(0) }
      // loadfile beantworten — mpv tut das auch. MPVTEST_LOADFILE_ALT spielt
      // ein ÄLTERES mpv nach: dort gibt es die Langform mit Index und
      // Datei-Optionen noch nicht, und der Befehl wird abgelehnt. Ohne diesen
      // Schalter liesse sich der Rueckfall gar nicht pruefen.
      if (c[0] === 'loadfile') {
        const abgelehnt = process.env.MPVTEST_LOADFILE_ALT && c.length > 3
        s.write(JSON.stringify(abgelehnt
          ? { error: 'invalid parameter', request_id: o.request_id }
          : { error: 'success', data: null, request_id: o.request_id }) + '\\n')
      }
      // Abfragen beantworten, damit die Zuordnung ueber request_id pruefbar ist
      if (c[0] === 'get_property') {
        const werte = { 'time-pos': 42.5, duration: 180, metadata: { title: 'Kap 1' },
                        pause: true, filename: 'lied.mp3', path: '/media/a/b/c/d/e/f/Album/x.mp3',
                        'percent-pos': 23.6 }
        const hat = Object.prototype.hasOwnProperty.call(werte, c[1])
        s.write(JSON.stringify(hat
          ? { error: 'success', data: werte[c[1]], request_id: o.request_id }
          : { error: 'property unavailable', request_id: o.request_id }) + '\\n')
      }
      // Ereignisse von sich aus — aber NUR wenn der Test es verlangt, sonst
      // wuerden sie den Tests dazwischenfunken, die gerade das Ausbleiben
      // eines Ereignisses pruefen.
      if (c[0] === 'observe_property' && c[2] === 'path' && process.env.MPVTEST_EREIGNISSE) {
        setTimeout(() => {
          s.write(JSON.stringify({ event: 'file-loaded' }) + '\\n')
          s.write(JSON.stringify({ event: 'property-change', name: 'time-pos', data: 99.5 }) + '\\n')
          s.write(JSON.stringify({ event: 'property-change', name: 'metadata',
                                   data: { title: 'Aus dem Ereignis' } }) + '\\n')
          // Der Uebergang, wie mpv ihn wirklich schickt: erst null, dann der
          // Name des naechsten Eintrags (F1).
          s.write(JSON.stringify({ event: 'property-change', name: 'media-title', data: null }) + '\\n')
          s.write(JSON.stringify({ event: 'property-change', name: 'media-title',
                                   data: 'Aus dem Ereignis: Folge 2' }) + '\\n')
          // In EINEM Stueck, absichtlich ohne Zeilengrenze am Ende: so
          // entsteht die halbe Zeile, an der ein naiver Leser scheitert.
          s.write('{"event":"idle"}\\n{"event":"prop')
          setTimeout(() => s.write('erty-change","name":"duration","data":321}\\n'), 40)
        }, 30)
      }
    }
  })
})
server.listen(sockPfad)
process.on('SIGTERM', () => process.exit(0))
`

async function warteAuf(bed: () => boolean, was: string, frist = 5000): Promise<void> {
  const ende = Date.now() + frist
  while (Date.now() < ende) {
    if (bed()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`Zeitüberschreitung: ${was}`)
}

let aktuell = ''
const empfangen = (): Array<Record<string, unknown>> => {
  try {
    return fs
      .readFileSync(path.join(aktuell, 'empfangen'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((z) => JSON.parse(z) as Record<string, unknown>)
  } catch {
    return []
  }
}
const befehle = (): string[][] =>
  empfangen()
    .map((o) => (o.command as string[]) || [])
    .filter((c) => c[0] !== 'observe_property')

function neuerSpieler(mitEreignissen = false, altesLoadfile = false): Player {
  aktuell = fs.mkdtempSync(path.join(ordner, 'lauf-'))
  process.env.MPVTEST = aktuell
  if (mitEreignissen) process.env.MPVTEST_EREIGNISSE = '1'
  else delete process.env.MPVTEST_EREIGNISSE
  // Vor dem Erzeugen setzen: der Doppelgänger erbt die Umgebung beim Start.
  if (altesLoadfile) process.env.MPVTEST_LOADFILE_ALT = '1'
  else delete process.env.MPVTEST_LOADFILE_ALT
  const erzeuge = require('./mpv-wrapper') as (o?: {
    programm?: string
    socket?: string
  }) => Player
  const p = erzeuge({
    programm: path.join(ordner, 'mpv'),
    socket: path.join(aktuell, 'ipc.sock'),
  })
  spieler.push(p)
  return p
}

before(async () => {
  ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mpvwrap-'))
  fs.writeFileSync(path.join(ordner, 'doppel.js'), DOPPELGAENGER)
  fs.writeFileSync(
    path.join(ordner, 'mpv'),
    `#!/bin/sh\nexec "${process.execPath}" "${path.join(ordner, 'doppel.js')}" "$@"\n`,
    { mode: 0o755 },
  )
  pfadVorher = process.env.PATH || ''
})

after(() => {
  for (const p of spieler) {
    try {
      p.close()
    } catch {
      /* egal */
    }
  }
  process.env.PATH = pfadVorher
  fs.rmSync(ordner, { recursive: true, force: true })
})

describe('Verbinden', () => {
  it('startet mpv, verbindet sich und beobachtet alle Eigenschaften', async () => {
    const p = neuerSpieler()
    await new Promise<void>((r) => p.once('bereit', () => r()))
    // NICHT sofort prüfen: 'bereit' heisst "abgeschickt", nicht "drüben
    // angekommen und aufgeschrieben". Auf den Zustand warten, nicht auf den
    // Zeitpunkt.
    const beobachtete = () =>
      empfangen()
        .map((o) => (o.command as string[]) || [])
        .filter((c) => c[0] === 'observe_property')
        .map((c) => c[2])
    await warteAuf(() => beobachtete().length >= 11, 'elf Beobachtungen')
    const beob = beobachtete()
    // Genau die, auf die spotify-control hört.
    //
    // playlist-pos-1 und playlist-count kamen 2026-07-28 dazu: die Anzeige
    // "Titel 3 von 12" stammte vorher aus gezählten metadata-EREIGNISSEN
    // (am Gerät gemessen: bei Titel 1 stand eine 3) und die Gesamtzahl
    // wurde gar nicht gesetzt. mpv weiss beides selbst.
    //
    // media-title kam 2026-08-06 dazu (F1). Es ist die EINZIGE Eigenschaft in
    // dieser Reihe, die wir nicht nur lesen, sondern selbst setzen
    // (`force-media-title` am loadfile) — deshalb muss sie beobachtet werden:
    // sonst erführe der Dienst den Namen der nächsten Folge erst, wenn ihn
    // jemand abfragt, und der Übergang von selbst fragt niemanden.
    // idle-active kam 2026-08-31 dazu (E109): mpvs `pause` ist im Leerlauf
    // false, und der Sekundentakt machte daraus nach jedem Stop wieder
    // "spielt". Nur der Leerlauf-Melder sagt die Wahrheit.
    assert.deepEqual(beob.sort(), [
      'duration',
      'filename',
      'idle-active',
      'media-title',
      'metadata',
      'path',
      'pause',
      'percent-pos',
      'playlist-count',
      'playlist-pos-1',
      'time-pos',
    ])
  })

  it('hält Befehle zurück, die VOR der Verbindung abgesetzt werden', async () => {
    const p = neuerSpieler()
    // Sofort — der Socket steht hier garantiert noch nicht.
    p.play('/media/frueh.mp3')
    await new Promise<void>((r) => p.once('bereit', () => r()))
    await warteAuf(() => befehle().some((c) => c[0] === 'loadfile'), 'nachgeholter Befehl')
    assert.deepEqual(
      befehle().find((c) => c[0] === 'loadfile'),
      ['loadfile', '/media/frueh.mp3', 'replace'],
    )
  })
})

describe('Befehle erreichen mpv unverändert', () => {
  it('schickt Pfade mit Leerzeichen, Prozent und Anführungszeichen unangetastet', async () => {
    const p = neuerSpieler()
    await new Promise<void>((r) => p.once('bereit', () => r()))
    p.play('/media/Die Drei/Folge 1.mp3')
    p.queue('http://strom.example/Folge%201.mp3')
    p.playList('/media/50% Rabatt.m3u')
    // OHNE die Abstreif-Zeilen zaehlen: play/playList schicken seit dem
    // 15.08.2026 vorab `set_property pause/loop-file` (klebrige
    // Eigenschaften, Begruendung am Wrapper) — hier geht es um die PFADE.
    const lade = () => befehle().filter((c) => c[0] !== 'set_property')
    await warteAuf(() => lade().length >= 3, 'drei Ladebefehle')
    const b = lade()
    assert.equal(b[0][1], '/media/Die Drei/Folge 1.mp3')
    assert.equal(b[1][1], 'http://strom.example/Folge%201.mp3')
    assert.equal(b[2][1], '/media/50% Rabatt.m3u')
  })

  it('bildet die übrigen Befehle des Vertrags ab', async () => {
    const p = neuerSpieler()
    await new Promise<void>((r) => p.once('bereit', () => r()))
    p.next()
    p.previous()
    p.playPause()
    p.stop()
    p.setVolume(50)
    p.seek(30)
    p.seekPercent(75)
    p.pauseAn?.()
    p.pauseAus?.()
    await warteAuf(() => befehle().length >= 11, 'elf Befehle')
    // `stop` streift seither pause und loop-file mit ab (klebrige
    // Eigenschaften) — die zwei set_property-Zeilen danach GEHOEREN zum
    // Vertrag und stehen deshalb ausdruecklich hier.
    assert.deepEqual(befehle().slice(0, 11), [
      ['playlist-next', 'force'],
      ['playlist-prev', 'force'],
      ['cycle', 'pause'],
      ['stop'],
      ['set_property', 'pause', false],
      ['set_property', 'loop-file', 'no'],
      ['set_property', 'volume', 50],
      ['seek', 30, 'absolute'],
      ['seek', 75, 'absolute-percent'],
      ['set_property', 'pause', true],
      ['set_property', 'pause', false],
    ])
  })
})

describe('getProps — Antworten werden richtig zugeordnet', () => {
  it('beantwortet mehrere Abfragen und trifft die richtigen Ereignisse', async () => {
    const p = neuerSpieler()
    await new Promise<void>((r) => p.once('bereit', () => r()))
    const gesehen = new Map<string, unknown>()
    for (const n of ['time_pos', 'length', 'metadata', 'pause', 'filename', 'path', 'percent_pos'])
      p.on(n, (w: unknown) => gesehen.set(n, w))

    p.getProps(['time_pos', 'length', 'metadata', 'pause', 'filename', 'path', 'percent_pos'])
    await warteAuf(() => gesehen.size >= 7, 'alle sieben Antworten')

    assert.equal(gesehen.get('time_pos'), 42.5)
    assert.equal(gesehen.get('length'), 180)
    assert.equal(gesehen.get('pause'), true)
    assert.equal(gesehen.get('filename'), 'lied.mp3')
    assert.equal(gesehen.get('percent_pos'), 23.6)
    // Die Umsetzung greift auch auf dem Antwortweg, nicht nur bei Ereignissen.
    assert.equal((gesehen.get('metadata') as Record<string, string>).Title, 'Kap 1')
  })

  it('übergeht eine unbekannte Eigenschaft still — wie mplayer', async () => {
    const p = neuerSpieler()
    await new Promise<void>((r) => p.once('bereit', () => r()))
    let irgendwas = false
    p.on('prop', () => {
      irgendwas = true
    })
    p.getProps(['gibtsnicht'])
    await new Promise((r) => setTimeout(r, 250))
    assert.equal(irgendwas, false)
    assert.equal(befehle().length, 0, 'es darf gar nichts gesendet worden sein')
  })
})

describe('wenn mpv gar nicht da ist', () => {
  it('meldet es, statt den Dienst mitzureissen', async () => {
    // Der reale Fall: in der Verwaltung auf mpv gestellt, aber nie
    // installiert. Ein unbehandeltes 'error' auf dem Kindprozess WIRFT und
    // nimmt den Wiedergabe-Dienst mit — pm2 startet neu, es scheitert wieder,
    // und die Box haengt in einer Schleife statt eine Meldung zu zeigen.
    const erzeuge = require('./mpv-wrapper') as (o?: { programm?: string; socket?: string }) => Player
    const p = erzeuge({
      programm: path.join(ordner, 'gibt-es-nicht'),
      socket: path.join(ordner, 'tot.sock'),
    })
    spieler.push(p)

    let meldung = ''
    let zu = false
    p.on('stderr', (t: string) => {
      meldung += t
    })
    p.on('close', () => {
      zu = true
    })

    await warteAuf(() => zu, 'close nach fehlgeschlagenem Start')
    assert.match(meldung, /laesst sich nicht starten/)
    // Und Befehle danach duerfen ebenfalls nicht werfen.
    assert.doesNotThrow(() => {
      p.play('/media/egal.mp3')
      p.close()
    })
  })
})

describe('Ereignisse, die mpv von selbst schickt', () => {
  it('meldet Titelwechsel, Eigenschaften und Listenende', async () => {
    const p = neuerSpieler(true)
    const gesehen: string[] = []
    let zeit: unknown
    let meta: Record<string, string> | undefined
    let dauer: unknown
    p.on('track-change', () => gesehen.push('track-change'))
    p.on('playlist-finish', () => gesehen.push('playlist-finish'))
    p.on('time_pos', (w: unknown) => {
      zeit = w
    })
    p.on('metadata', (w: Record<string, string>) => {
      meta = w
    })
    p.on('length', (w: unknown) => {
      dauer = w
    })

    await warteAuf(() => dauer !== undefined, 'alle Ereignisse')
    assert.ok(gesehen.includes('track-change'))
    assert.ok(gesehen.includes('playlist-finish'))
    assert.equal(zeit, 99.5)
    assert.equal(meta?.Title, 'Aus dem Ereignis')
    // Diese kam ABSICHTLICH in zwei Stücken mitten im JSON an: ein Leser, der
    // jedes Datenpaket für eine ganze Zeile hält, scheitert genau hier.
    assert.equal(dauer, 321)
  })
})

describe('Beenden', () => {
  it('schickt quit und meldet close', async () => {
    const p = neuerSpieler()
    await new Promise<void>((r) => p.once('bereit', () => r()))
    let code: number | null | undefined
    p.on('close', (c: number | null) => {
      code = c
    })
    p.close()
    await warteAuf(() => code !== undefined, 'close-Ereignis')
    assert.ok(befehle().some((c) => c[0] === 'quit'))
  })
})

// ── gegen das ECHTE mpv ───────────────────────────────────────────────────
// Alles darüber prüft die Verkabelung gegen einen Doppelgänger, den ich selbst
// geschrieben habe — der kann also nur bestätigen, was ich ohnehin annehme.
// Hier läuft echtes mpv mit einer echten Datei. Ist es nicht lauffähig
// (fehlt, oder wie hier zeitweise an einer kaputten libluajit gescheitert),
// wird übersprungen statt rot zu werden: die Tests sollen auch dort laufen,
// wo kein mpv installiert ist.
const mpvLaeuft = (): boolean => {
  try {
    return (
      require('node:child_process').spawnSync('mpv', ['--version'], { timeout: 10000 })
        .status === 0
    )
  } catch {
    return false
  }
}

/** Eine echte, hörbare (aber stille) WAV-Datei bauen — ohne Fremdwerkzeug. */
function wavSchreiben(ziel: string, sekunden = 1, rate = 8000): void {
  const daten = Buffer.alloc(rate * sekunden) // 8-Bit unsigned, Mitte = Stille
  daten.fill(128)
  const kopf = Buffer.alloc(44)
  kopf.write('RIFF', 0)
  kopf.writeUInt32LE(36 + daten.length, 4)
  kopf.write('WAVEfmt ', 8)
  kopf.writeUInt32LE(16, 16)
  kopf.writeUInt16LE(1, 20) // PCM
  kopf.writeUInt16LE(1, 22) // mono
  kopf.writeUInt32LE(rate, 24)
  kopf.writeUInt32LE(rate, 28)
  kopf.writeUInt16LE(1, 32)
  kopf.writeUInt16LE(8, 34)
  kopf.write('data', 36)
  kopf.writeUInt32LE(daten.length, 40)
  fs.writeFileSync(ziel, Buffer.concat([kopf, daten]))
}

describe('gegen ECHTES mpv', { skip: mpvLaeuft() ? false : 'mpv nicht lauffähig' }, () => {
  it('spielt eine Datei und meldet Titelwechsel, Dauer und Pfad', async () => {
    const echtOrdner = fs.mkdtempSync(path.join(ordner, 'echt-'))
    // Ein Name, der BEIDE alten Fehler ausgelöst hätte: Leerzeichen UND ein
    // einzelnes Prozentzeichen. Unter mplayer war das ein URIError.
    const datei = path.join(echtOrdner, 'Folge 1 mit 50% Rabatt.wav')
    wavSchreiben(datei, 1)

    const erzeuge = require('./mpv-wrapper') as (o?: {
      argumente?: string[]
      socket?: string
    }) => Player
    const p = erzeuge({
      argumente: ['--ao=null'], // kein Ton auf dem Entwicklungsrechner
      socket: path.join(echtOrdner, 'ipc.sock'),
    })
    spieler.push(p)

    let wechsel = false
    let dauer: unknown
    let pfad: unknown
    p.on('track-change', () => {
      wechsel = true
    })
    p.on('length', (w: unknown) => {
      if (typeof w === 'number') dauer = w
    })
    p.on('path', (w: unknown) => {
      if (typeof w === 'string' && w) pfad = w
    })

    await new Promise<void>((r) => p.once('bereit', () => r()))
    p.play(datei)

    await warteAuf(() => wechsel, 'Titelwechsel von echtem mpv', 15000)
    await warteAuf(() => typeof dauer === 'number', 'Dauer von echtem mpv', 15000)

    assert.ok(wechsel, 'mpv hat die Datei geladen')
    assert.ok((dauer as number) > 0.5 && (dauer as number) < 2, `Dauer plausibel: ${dauer}`)
    assert.equal(pfad, datei, 'der Pfad kam unverfälscht zurück — mit Leerzeichen und Prozent')
  })
})


describe('titelPos — der absolute Sprung landet wirklich auf dem Socket', () => {
  it('schickt set_property playlist-pos-1', async () => {
    // DER PUNKT DIESES TESTS: `exec()` ist im Aufsatz ein Loch, das nur eine
    // Zeile nach stderr meldet. Genau deshalb tat ein Titelsprung auf einer
    // mpv-Box NICHTS, waehrend der Dienst `{status:'ok'}` antwortete. Hier
    // wird nachgesehen, dass der neue Weg wirklich etwas schickt.
    const p = neuerSpieler()
    await new Promise<void>((r) => p.once('bereit', () => r()))
    p.titelPos?.(4)
    await warteAuf(() => befehle().some((c) => c[1] === 'playlist-pos-1'), 'den Sprung')
    assert.deepEqual(
      befehle().find((c) => c[1] === 'playlist-pos-1'),
      ['set_property', 'playlist-pos-1', 4],
    )
  })

  it('exec() bleibt ein GEMELDETES Loch — Absicht, kein Versehen', async () => {
    const p = neuerSpieler()
    await new Promise<void>((r) => p.once('bereit', () => r()))
    let gemeldet = ''
    p.on('stderr', (z: string) => {
      gemeldet += z
    })
    const vorher = befehle().length
    p.exec('pt_step', [2])
    await new Promise((r) => setTimeout(r, 40))
    assert.match(gemeldet, /ohne Entsprechung/)
    assert.equal(befehle().length, vorher, 'exec darf NICHTS auf den Socket schicken')
  })
})

// ══ F1: DER TITELNAME KOMMT WIRKLICH AUF DEM SOCKET AN ═════════════════════
//
// Dass `BEFEHLE.queue` den Namen einbaut, steht in mpv-protokoll.spec.ts. Das
// beweist NICHT, dass der Aufsatz ihn auch weiterreicht: `out.queue` könnte
// das zweite Argument stillschweigend fallenlassen, und der Befehl sähe im
// Test der reinen Schicht trotzdem richtig aus. Diese Naht wird hier geprüft.
describe('force-media-title — der Name geht bis auf den Socket', () => {
  it('play trägt den Namen mit', async () => {
    const p = neuerSpieler()
    await new Promise<void>((r) => p.once('bereit', () => r()))
    p.play('https://x/a.mp3', 'Zu Besuch')
    await warteAuf(() => befehle().some((c) => c[0] === 'loadfile'), 'den loadfile')
    assert.deepEqual(befehle().find((c) => c[0] === 'loadfile'), [
      'loadfile',
      'https://x/a.mp3',
      'replace',
      -1,
      { 'force-media-title': 'Zu Besuch' },
    ] as unknown as string[])
  })

  it('queue trägt den Namen mit — die Stelle, an der F1 hängt', async () => {
    const p = neuerSpieler()
    await new Promise<void>((r) => p.once('bereit', () => r()))
    p.queue('https://x/b.mp3', 'Freibad Pommes')
    await warteAuf(() => befehle().some((c) => c[0] === 'loadfile'), 'den loadfile')
    assert.deepEqual(befehle().find((c) => c[0] === 'loadfile'), [
      'loadfile',
      'https://x/b.mp3',
      'append-play',
      -1,
      { 'force-media-title': 'Freibad Pommes' },
    ] as unknown as string[])
  })

  it('ohne Namen bleibt der Befehl kurz — der lokale Weg ändert sich nicht', async () => {
    const p = neuerSpieler()
    await new Promise<void>((r) => p.once('bereit', () => r()))
    p.play('/media/lied.mp3')
    await warteAuf(() => befehle().some((c) => c[0] === 'loadfile'), 'den loadfile')
    assert.deepEqual(befehle().find((c) => c[0] === 'loadfile'), ['loadfile', '/media/lied.mp3', 'replace'])
  })

  it('meldet den Namen weiter — und verschluckt das null dazwischen', async () => {
    // DIE GANZE KETTE, so wie mpv sie am Übergang wirklich schickt: erst
    // `media-title = null`, dann der Name der nächsten Folge. Käme das null
    // beim Hörer an, stünde die Titelzeile bei JEDEM Wechsel kurz leer.
    const p = neuerSpieler(true)
    const gesehen: unknown[] = []
    p.on('media_title', (w: unknown) => gesehen.push(w))
    await warteAuf(() => gesehen.length > 0, 'den Titelnamen aus dem Ereignis')
    await new Promise((r) => setTimeout(r, 60))
    assert.deepEqual(gesehen, ['Aus dem Ereignis: Folge 2'])
  })

  // ── DER RÜCKFALL: ein altes mpv darf die Box nicht stumm machen ──────────
  it('wiederholt einen abgelehnten loadfile OHNE den Namen', async () => {
    // WARUM DAS ZÄHLT: die Langform (`-1` plus Datei-Optionen) gibt es erst in
    // neueren mpv. Lehnt ein älteres sie ab, wird GAR NICHTS geladen — und
    // zwar still, denn mpv antwortet nur auf dem Socket, während der Dienst
    // der Oberfläche weiter `{status:'ok'}` schickt. Ein falscher Titelname
    // ist ein Schönheitsfehler; eine stumme Box ist keiner.
    const p = neuerSpieler(false, true)
    await new Promise<void>((r) => p.once('bereit', () => r()))
    let gemeldet = ''
    p.on('stderr', (z: string) => {
      gemeldet += z
    })
    p.queue('https://x/c.mp3', 'Zu Besuch')
    await warteAuf(() => befehle().filter((c) => c[0] === 'loadfile').length >= 2, 'den zweiten Versuch')
    const ladungen = befehle().filter((c) => c[0] === 'loadfile')
    assert.equal(ladungen.length, 2, 'genau einmal nachgefasst, nicht in Schleife')
    assert.deepEqual(ladungen[1], ['loadfile', 'https://x/c.mp3', 'append-play'])
    assert.match(gemeldet, /force-media-title abgelehnt/)
  })

  it('fasst NICHT nach, wenn der loadfile durchgeht', async () => {
    // Sonst spielte jede Folge zweimal an: `append-play` hängt an, ein zweiter
    // Aufruf hängte sie ein zweites Mal in die Warteschlange.
    const p = neuerSpieler()
    await new Promise<void>((r) => p.once('bereit', () => r()))
    p.queue('https://x/d.mp3', 'Zu Besuch')
    await warteAuf(() => befehle().some((c) => c[0] === 'loadfile'), 'den loadfile')
    await new Promise((r) => setTimeout(r, 120))
    assert.equal(befehle().filter((c) => c[0] === 'loadfile').length, 1)
  })
})
