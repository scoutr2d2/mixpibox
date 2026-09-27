// Festschreibende Tests für mplayer-wrapper.ts — der Teil, der die Musik macht.
//
// WOZU: der Wrapper wird auf mpv umgebaut (JSON-IPC über Socket statt
// Slave-Modus über stdin). Vorher gab es hier KEINEN Test. Diese Datei hält
// den heutigen Vertrag fest — Startargumente, erzeugte Befehlszeilen,
// Ereignisse — damit der Nachfolger daran gemessen werden kann statt am
// Gehör.
//
// WIE: statt mplayer zu verspotten, läuft ein GEFÄLSCHTES `mplayer` über den
// PATH. Es schreibt seine Argumente und jede empfangene Zeile in Dateien und
// gibt auf `EMIT <zeile>` genau diese Zeile auf stdout aus. So wird der echte
// Weg geprüft (spawn, stdin, byline, Parser, Ereignisse) und nicht eine
// Attrappe, die zufällig dasselbe tut.
//
// ACHTUNG: Hier steht das IST. Wo das Verhalten fragwürdig ist, steht MACKE
// dabei — nicht "reparieren", ohne die Aufrufer in spotify-control.ts zu
// prüfen.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

type Player = ReturnType<typeof import('./mplayer-wrapper')>

let arbeitsordner = ''
let pfadVorher = ''
const spieler: Player[] = []

const FAELSCHUNG = `#!/bin/sh
# gefälschtes mplayer für die Tests — siehe Kopf von mplayer-wrapper.spec.ts
printf '%s\\n' "$@" > "$MPTEST/argv"
: > "$MPTEST/stdin"
while IFS= read -r zeile; do
  printf '%s\\n' "$zeile" >> "$MPTEST/stdin"
  case "$zeile" in
    quit) exit 0 ;;
    "EMIT "*) printf '%s\\n' "\${zeile#EMIT }" ;;
  esac
done
`

/** Auf eine Bedingung warten, statt blind zu schlafen. */
async function warteAuf(bedingung: () => boolean, was: string, frist = 4000): Promise<void> {
  const ende = Date.now() + frist
  while (Date.now() < ende) {
    if (bedingung()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`Zeitüberschreitung beim Warten auf: ${was}`)
}

// Jeder Spieler bekommt einen EIGENEN Ordner. Sonst schreiben alle Fälschungen
// in dieselbe stdin-Datei und ein Test sieht die Befehle des vorherigen —
// die Zusicherungen wären dann von der Reihenfolge abhängig statt von der Sache.
let aktuellerOrdner = ''

const gesendet = (): string[] => {
  try {
    return fs.readFileSync(path.join(aktuellerOrdner, 'stdin'), 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/** Einen frischen Spieler bauen; wird am Ende sicher beendet. */
function neuerSpieler(): Player {
  aktuellerOrdner = fs.mkdtempSync(path.join(arbeitsordner, 'lauf-'))
  process.env.MPTEST = aktuellerOrdner // spawn erbt process.env beim Start
  const erzeuge = require('./mplayer-wrapper') as () => Player
  const p = erzeuge()
  spieler.push(p)
  return p
}

before(() => {
  arbeitsordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mpwrap-'))
  const gefaelscht = path.join(arbeitsordner, 'mplayer')
  fs.writeFileSync(gefaelscht, FAELSCHUNG, { mode: 0o755 })
  // Gegenprobe: läuft die Fälschung überhaupt? Sonst prüfen die Tests nichts.
  execFileSync(gefaelscht, ['--probe'], {
    input: 'quit\n',
    env: { ...process.env, MPTEST: arbeitsordner },
  })
  assert.equal(
    fs.readFileSync(path.join(arbeitsordner, 'argv'), 'utf8').trim(),
    '--probe',
    'die Fälschung selbst funktioniert nicht — alle folgenden Tests wären wertlos',
  )

  pfadVorher = process.env.PATH || ''
  process.env.PATH = `${arbeitsordner}${path.delimiter}${pfadVorher}`
  process.env.MPTEST = arbeitsordner
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
  fs.rmSync(arbeitsordner, { recursive: true, force: true })
})

describe('Start', () => {
  it('startet mplayer im Slave-Modus ohne Video', async () => {
    neuerSpieler()
    const argvDatei = path.join(aktuellerOrdner, 'argv')
    await warteAuf(() => fs.existsSync(argvDatei), 'argv-Datei')
    const argv = fs.readFileSync(argvDatei, 'utf8').split('\n').filter(Boolean)
    assert.deepEqual(argv, [
      '-slave',
      '-idle',
      '-novideo',
      '-quiet',
      '-msglevel',
      'all=1:global=4:cplayer=4',
    ])
  })
})

describe('Befehle, die auf stdin landen', () => {
  it('bildet die Wiedergabe-Befehle so ab, wie spotify-control sie erwartet', async () => {
    const p = neuerSpieler()
    p.play('/media/lied.mp3')
    p.playList('/media/liste.m3u')
    p.queue('/media/danach.mp3')
    p.queueList('/media/danach.m3u')
    p.next()
    p.previous()
    p.playPause()
    p.stop()
    p.setVolume(50)
    p.seek(30)
    p.seekPercent(75)
    p.getProps(['time_pos', 'length'])

    await warteAuf(() => gesendet().length >= 13, 'alle Befehle')
    assert.deepEqual(gesendet(), [
      'loadfile /media/lied.mp3',
      'loadlist /media/liste.m3u',
      'loadfile /media/danach.mp3 1',
      'loadlist /media/danach.m3u 1',
      'pt_step 1',
      'pt_step -1',
      'pause',
      'stop',
      'pausing_keep volume 50 1',
      'pausing_keep seek 30 0',
      'pausing_keep seek 75 1',
      'pausing_keep_force get_property time_pos',
      'pausing_keep_force get_property length',
    ])
  })

  // ── F1: DER TITELNAME DARF HIER NICHTS ÄNDERN ───────────────────────────
  //
  // Seit dem 06.08.2026 gibt spotify-control den Folgennamen mit
  // (`player.play(adresse, titel)`, `player.queue(adresse, titel)`). Bei mpv
  // reist er als Datei-Option `force-media-title` im Warteschlangeneintrag
  // mit — MPLAYER KENNT DATEI-OPTIONEN NICHT. Der Aufrufer unterscheidet die
  // beiden Aufsätze trotzdem nicht: er holt sie über dasselbe untypisierte
  // `require` und übergibt in beiden Fällen zwei Argumente. Das zweite kommt
  // hier also wirklich an.
  //
  // WAS DIESER TEST BEWACHT, und warum es kein Zierrat ist: mplayer liest im
  // Slave-Modus das zweite Wort eines `loadfile` als seinen Anhänge-Schalter
  // (`loadfile <datei> 1` = einreihen statt abspielen — siehe `queue` oben).
  // Wer den Namen je durchreicht, macht aus jedem Startbefehl ein Einreihen.
  // Auf einer mplayer-Box startete dann gar nichts mehr: aus einem falschen
  // Titelnamen würde eine stumme Box.
  //
  // GEPRÜFT WIRD GEGEN DEN LAUF OHNE NAMEN, nicht gegen einen abgeschriebenen
  // Wortlaut allein — sonst wäre der Test auch dann grün, wenn sich BEIDE
  // Wege gemeinsam verschöben. Der Wortlaut steht zusätzlich da, damit ein
  // gemeinsamer Bruch nicht als Übereinstimmung durchginge.
  it('F1: der Titelname wird verworfen — die Befehlszeile bleibt wortgleich', async () => {
    const ohneNamen = neuerSpieler()
    ohneNamen.play('/media/lied.mp3')
    ohneNamen.queue('/media/danach.mp3')
    await warteAuf(() => gesendet().length >= 2, 'Befehle ohne Namen')
    const vergleich = gesendet()

    // Beide Namen tragen ein Leerzeichen: würde einer durchgereicht, stünde
    // er in Anführungszeichen hinter dem Pfad und fiele sofort auf.
    const mitNamen = neuerSpieler()
    mitNamen.play('/media/lied.mp3', 'Nicht alleine')
    mitNamen.queue('/media/danach.mp3', 'Zu Besuch')
    await warteAuf(() => gesendet().length >= 2, 'Befehle mit Namen')

    assert.deepEqual(gesendet(), vergleich, 'der Titelname hat die Befehlszeile verändert')
    assert.deepEqual(gesendet(), ['loadfile /media/lied.mp3', 'loadfile /media/danach.mp3 1'])
  })

  it('setzt Anführungszeichen, sobald ein Leerzeichen im Pfad steckt', async () => {
    const p = neuerSpieler()
    p.play('/media/Die Drei/Folge 1.mp3')
    await warteAuf(() => gesendet().length >= 1, 'Befehl')
    assert.equal(gesendet()[0], 'loadfile "/media/Die Drei/Folge 1.mp3"')
  })

  it('MACKE: %20 im Pfad hebelt die Anführungszeichen aus', async () => {
    // Die Entscheidung "hat Leerzeichen -> quoten" faellt VOR dem
    // decodeURIComponent. Ein prozentkodierter Pfad hat vorher kein
    // Leerzeichen, bekommt also keine Anführungszeichen — und danach steht ein
    // Leerzeichen drin. mplayer sieht dann ZWEI Argumente.
    const p = neuerSpieler()
    p.play('http://strom.example/Folge%201.mp3')
    await warteAuf(() => gesendet().length >= 1, 'Befehl')
    assert.equal(gesendet()[0], 'loadfile http://strom.example/Folge 1.mp3')
  })

  it('MACKE: ein einzelnes Prozentzeichen im Namen wirft eine Ausnahme', async () => {
    // decodeURIComponent laeuft ueber die GANZE Befehlszeile. "50% off.mp3"
    // ist keine gueltige Prozentkodierung -> URIError, synchron aus play()
    // heraus. Beim mpv-Nachbau darf das nicht wieder passieren: ein Dateiname
    // ist kein URI.
    const p = neuerSpieler()
    assert.throws(() => p.play('/media/50% Rabatt.mp3'), { name: 'URIError' })
  })
})

describe('Ereignisse aus der Ausgabe', () => {
  it('meldet einen Titelwechsel', async () => {
    const p = neuerSpieler()
    let gesehen = false
    p.on('track-change', () => {
      gesehen = true
    })
    // exec ohne Argumente schreibt die Zeile woertlich auf stdin; die
    // Fälschung gibt alles nach "EMIT " auf stdout zurueck.
    p.exec('EMIT Starting playback...')
    await warteAuf(() => gesehen, 'track-change')
    assert.ok(gesehen)
  })

  it('meldet das Ende der Wiedergabeliste', async () => {
    const p = neuerSpieler()
    let gesehen = false
    p.on('playlist-finish', () => {
      gesehen = true
    })
    p.exec('EMIT ANS_ERROR=PROPERTY_UNAVAILABLE')
    await warteAuf(() => gesehen, 'playlist-finish')
    assert.ok(gesehen)
  })

  it('reicht eine gelesene Eigenschaft zweifach heraus: als prop und unter ihrem Namen', async () => {
    const p = neuerSpieler()
    const ueberProp: unknown[] = []
    let direkt: unknown
    p.on('prop', (name: string, wert: unknown) => ueberProp.push([name, wert]))
    p.on('volume', (wert: unknown) => {
      direkt = wert
    })
    p.exec('EMIT ANS_volume=42.5')
    await warteAuf(() => direkt !== undefined, 'volume-Ereignis')
    assert.equal(direkt, 42.5)
    assert.deepEqual(ueberProp, [['volume', 42.5]])
  })

  it('verschluckt Eigenschaften ohne Parser stillschweigend', async () => {
    const p = neuerSpieler()
    let irgendwas = false
    p.on('prop', () => {
      irgendwas = true
    })
    p.exec('EMIT ANS_gibtsnicht=1')
    // Kein Ereignis erwartet — kurz warten und dann prüfen, dass nichts kam.
    await new Promise((r) => setTimeout(r, 250))
    assert.equal(irgendwas, false)
  })
})

describe('Beenden', () => {
  it('schickt quit und meldet danach close', async () => {
    const p = neuerSpieler()
    let code: number | null | undefined
    p.on('close', (c: number | null) => {
      code = c
    })
    p.close()
    await warteAuf(() => code !== undefined, 'close-Ereignis')
    assert.equal(code, 0)
    assert.ok(gesendet().includes('quit'))
  })
})
