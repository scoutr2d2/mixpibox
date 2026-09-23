#!/usr/bin/env node
/**
 * PLUGIN-GERUEST — ein neues MuPiBox-Plugin anlegen, das sofort laeuft.
 *
 * Was hier herauskommt, ist KEIN Skelett mit TODO-Zeilen, sondern ein
 * fertiges, gepruefte Plugin: es loest eine MP3-Adresse auf, es hat Tests, und
 * beide laufen ohne Box und ohne `npm install`. Wer etwas anderes bauen will,
 * aendert eine Datei, die schon gruen ist — statt eine anzufangen, die noch
 * nie lief.
 *
 * WARUM DAS DER UNTERSCHIED IST: ein Geruest mit Luecken zwingt jeden
 * Fremdentwickler, zuerst herauszufinden, ob SEIN Fehler oder die Vorlage
 * schuld ist. Das ist der Abend, an dem die meisten aufhoeren.
 *
 * Aufruf:
 *   node tools/plugin-geruest.mjs mupibox-meinquelle
 *   node tools/plugin-geruest.mjs mupibox-meinquelle --name "Meine Quelle"
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const WURZEL = path.resolve(HIER, '..')

// Dieselbe Regel wie KENNUNG in src/backend-api/src/plugin-vertrag.ts. Sie
// steht hier ein zweites Mal, weil dieses Werkzeug ohne tsx laufen soll — und
// tools/plugin-pruefen.mjs prueft danach gegen die ECHTE, sodass eine
// Abweichung nicht unbemerkt bleibt.
const KENNUNG = /^[a-z][a-z0-9-]{2,63}$/

const argumente = process.argv.slice(2)
const kennung = (argumente.find((a) => !a.startsWith('--')) ?? '').trim()
const nameIndex = argumente.indexOf('--name')
const anzeigename = nameIndex >= 0 ? argumente[nameIndex + 1] : null
// `--ordner` gibt es NUR, damit tools/plugin-geruest-probe.sh das Geruest in
// einen Wegwerf-Ordner legen kann. Ohne diese Fahne muesste die Probe ins
// echte plugins/ schreiben und danach aufraeumen — und ein Aufraeumen, das
// nach einem Abbruch ausfaellt, hinterlaesst ein halbes Plugin im Baum.
const ordnerIndex = argumente.indexOf('--ordner')
const zielOrdner = ordnerIndex >= 0 ? argumente[ordnerIndex + 1] : null

if (!kennung) {
  console.error('Aufruf: node tools/plugin-geruest.mjs <kennung> [--name "Anzeigename"] [--ordner <pfad>]')
  console.error('')
  console.error('Die Kennung ist zugleich der Namensraum: aus "mupibox-podcast" wird')
  console.error('das Schema "mupibox-podcast:…" und die Route /api/plugins/mupibox-podcast/.')
  console.error('Ein Praefix mit dem eigenen Namen davor macht Zusammenstoesse unwahrscheinlich.')
  process.exit(2)
}

if (!KENNUNG.test(kennung)) {
  console.error(`"${kennung}" taugt nicht als Kennung.`)
  console.error('Erlaubt: 3 bis 64 Zeichen, klein, Beginn mit einem Buchstaben, danach a-z, 0-9 und Bindestrich.')
  console.error('Sie wird zu einem Ordnernamen UND zu einem Stueck URL — deshalb die Enge.')
  process.exit(2)
}

const ordner = zielOrdner ? path.join(path.resolve(zielOrdner), kennung) : path.join(WURZEL, 'plugins', kennung)
if (fs.existsSync(ordner)) {
  console.error(`${ordner} gibt es schon. Ich fasse nichts an.`)
  process.exit(2)
}

const name = anzeigename || kennung.replace(/^mupibox-/, '').replace(/-/g, ' ')

// ── Die Vorlagen ─────────────────────────────────────────────────────────
//
// KEINE BACKTICKS IM ERZEUGTEN INHALT. Ein Backtick — auch einer in einem
// Kommentar — beendet die Vorlage hier und reisst die Datei ab. Das ist in
// diesem Baum schon einmal passiert; deshalb steht unten ueberall ' statt `.

const manifest = `${JSON.stringify(
  {
    kennung,
    name,
    fassung: '1.0.0',
    haupt: 'index.mjs',
    rechte: ['medienquelle', 'netz'],
  },
  null,
  2,
)}\n`

const quelltext = `/**
 * ${name} — ein MuPiBox-Plugin.
 *
 * ANGELEGT MIT: node tools/plugin-geruest.mjs ${kennung}
 *
 * SO WIE ES DASTEHT, LAEUFT ES: es nimmt eine MP3-Adresse und macht daraus
 * einen abspielbaren Fund. Probier es aus, BEVOR du etwas aenderst —
 *
 *     node --test plugins/${kennung}/index.spec.mjs
 *     npx tsx tools/plugin-pruefen.mjs plugins/${kennung}
 *
 * MEDIENKENNUNG
 *
 *   ${kennung}:https://example.org/folge-1.mp3
 *
 * Alles nach dem ERSTEN Doppelpunkt kommt als 'rest' herein. Der Teil davor
 * ist die Kennung aus plugin.json — sie ist dein Namensraum und wird nicht
 * gewaehlt, sondern abgeleitet.
 */

export default {
  /**
   * Eine Kennung zu etwas Abspielbarem machen.
   *
   * @param {string} rest     alles nach dem ersten Doppelpunkt
   * @param {object} kontext  protokoll, einstellungen, holen
   * @returns {Promise<{titel: object, quelle: object}>}
   */
  async aufloesen(rest, kontext) {
    // OHNE DAS RECHT 'netz' GIBT ES KEIN 'holen' — nicht ein 'holen', das
    // wirft, sondern gar keins. Frag danach, dann kannst du eine Meldung
    // geben, die jemand versteht.
    if (!kontext.holen) {
      throw new Error('Dem Plugin fehlt das Recht "netz" in plugin.json.')
    }

    if (!/^https?:\\/\\//i.test(rest)) {
      throw new Error('Erwartet wird eine http- oder https-Adresse, bekommen habe ich: ' + rest)
    }

    // HIER KOMMT DEINE ARBEIT HIN. Typisch: einen Feed oder eine Schnittstelle
    // holen, die Antwort zerlegen, die Tonadresse heraussuchen.
    //
    //   const antwort = await kontext.holen(rest)
    //   if (!antwort.ok) throw new Error('Antwort ' + antwort.status)
    //   const text = await antwort.text()
    //
    // Beachte: 'kontext.holen' hat eine Frist (8 s) und verwehrt Zugriffe auf
    // die eigene Box. Beides ist Absicht.

    kontext.protokoll('aufgeloest: ' + rest)

    return {
      titel: {
        name: entpackterName(rest),
        kuenstler: ${JSON.stringify(name)},
        // bild: 'https://…/bild.jpg',
        // dauerSek: 1800,
      },
      quelle: {
        // 'strom' = eine Adresse fuer mpv. 'datei' = ein Pfad auf der Box,
        // und der MUSS unterhalb der Medienwurzel liegen — der Kern weist
        // alles andere ab.
        art: 'strom',
        adresse: rest,
      },
    }
  },

  /** Geht es dir gut? Steht im Eltern-Bereich. */
  async befinden(kontext) {
    if (!kontext.holen) return { ok: false, text: 'Recht "netz" fehlt' }
    return { ok: true, text: 'bereit' }
  },
}

/** Aus einer Adresse einen lesbaren Namen machen. Nur damit etwas dasteht. */
function entpackterName(adresse) {
  try {
    const letztes = new URL(adresse).pathname.split('/').filter(Boolean).pop() || 'Titel'
    return decodeURIComponent(letztes).replace(/\\.[a-z0-9]{2,4}$/i, '').replace(/[_-]+/g, ' ')
  } catch {
    return 'Titel'
  }
}
`

// Der Pruefstand liegt als Nachbar in plugins/. Bei --ordner (nur fuer die
// Probe) zeigt der Import auf die echte Datei im Baum, sonst waere der
// erzeugte Test nicht lauffaehig.
const pruefstandPfad = zielOrdner
  ? path
      .relative(ordner, path.join(WURZEL, 'plugins', 'pruefstand.mjs'))
      .split(path.sep)
      .join('/')
  : '../pruefstand.mjs'

const test = `import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formStimmt, kontext } from '${pruefstandPfad}'
import plugin from './index.mjs'

/**
 * Tests fuer ${name} — ohne Box, ohne Netz, ohne Worker.
 *
 *     node --test plugins/${kennung}/index.spec.mjs
 *
 * Der Kontext ist nur ein Objekt, also faelschen wir ihn. 'geholt' sammelt
 * mit, welche Adressen dein Plugin wirklich abgefragt hat — damit laesst sich
 * auch pruefen, was es NICHT getan hat.
 */

const MP3 = 'https://example.org/folgen/meine-erste-folge.mp3'

describe('aufloesen', () => {
  it('macht aus einer MP3-Adresse einen brauchbaren Fund', async () => {
    const { k } = kontext()
    const fund = await plugin.aufloesen(MP3, k)
    assert.deepEqual(formStimmt(fund), [], 'die Form muss stimmen')
    assert.equal(fund.quelle.art, 'strom')
    assert.equal(fund.quelle.adresse, MP3)
  })

  it('schreibt eine Zeile ins Protokoll', async () => {
    const { k, protokoll } = kontext()
    await plugin.aufloesen(MP3, k)
    assert.ok(protokoll.length > 0, 'kontext.protokoll(...) sollte benutzt werden')
  })

  it('sagt es, wenn das Recht "netz" fehlt', async () => {
    const { k } = kontext({ netz: false })
    await assert.rejects(() => plugin.aufloesen(MP3, k), /Recht "netz"/)
  })

  it('weist ab, was keine http-Adresse ist', async () => {
    const { k } = kontext()
    await assert.rejects(() => plugin.aufloesen('file:///etc/shadow', k))
    await assert.rejects(() => plugin.aufloesen('irgendwas', k))
  })
})

describe('befinden', () => {
  it('meldet bereit, wenn das Netz-Recht da ist', async () => {
    const b = await plugin.befinden(kontext().k)
    assert.equal(b.ok, true)
  })

  it('nennt den Grund, statt nur false zu sagen', async () => {
    const b = await plugin.befinden(kontext({ netz: false }).k)
    assert.equal(b.ok, false)
    assert.ok(b.text, 'ein "nein" ohne Grund hilft niemandem')
  })
})
`

fs.mkdirSync(ordner, { recursive: true })
fs.writeFileSync(path.join(ordner, 'plugin.json'), manifest)
fs.writeFileSync(path.join(ordner, 'index.mjs'), quelltext)
fs.writeFileSync(path.join(ordner, 'index.spec.mjs'), test)

console.log(`Angelegt: plugins/${kennung}/`)
console.log('  plugin.json     Manifest — die Kennung ist dein Namensraum')
console.log('  index.mjs       das Plugin, laeuft so wie es dasteht')
console.log('  index.spec.mjs  sechs Tests, gruen ab der ersten Sekunde')
console.log('')
console.log('Als naechstes:')
console.log(`  node --test plugins/${kennung}/index.spec.mjs`)
console.log(`  npx tsx tools/plugin-pruefen.mjs plugins/${kennung}`)
console.log('')
console.log('Auf die Box kommt es mit:')
console.log(`  scp -r plugins/${kennung} dietpi@<box>:/home/dietpi/.mupibox/plugins/`)
console.log('  ssh dietpi@<box> "sudo systemctl restart mupibox-server.service"')
