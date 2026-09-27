/**
 * DER START HOLT EINEN SCHWARZEN SCHIRM ZURÜCK — und dimmt sonst nichts.
 *
 * ══ WARUM ES DIESE DATEI GIBT ═══════════════════════════════════════════════
 *
 * Die Untergrenze in `schirmhelligkeit.ts` sorgt dafür, dass über die beiden
 * Bedienwege niemand mehr einen Rohwert unter 20 % setzen kann. Sie sagt aber
 * nichts über eine Box, die dort SCHON STEHT. Und die gibt es:
 *
 *   * Die alte Verwaltung `/var/www/mupi.php` liegt weiterhin auf jeder
 *     ausgelieferten Box und bot bis zum Riegel `a4c202f1` eine 0 an.
 *   * `systemd-backlight@backlight:11-0045.service` ist auf der Box AKTIV (am
 *     07.08.2026 gelesen) und trägt den Rohwert über jeden Neustart. Der
 *     Kernel-Vorgabewert kommt nie zum Zuge.
 *   * `mupibox.displayBrightness` steht weder in der Vorlage noch legt
 *     `conf_update.sh` ihn an — auf einer Box im Feld ist er schlicht nicht da.
 *
 * Zusammen ergibt das die Box, um die es die ganze Zeit geht: schwarzer Schirm,
 * kein Regler zu sehen, und jeder Neustart stellt das Schwarz wieder her.
 * Genau dort greift `helligkeitBeimStart()` jetzt ein.
 *
 * ══ WAS HIER FESTGENAGELT WIRD, IST DIE ZURÜCKHALTUNG ═══════════════════════
 *
 * Die Gefahr einer solchen Stelle ist nicht, dass sie zu wenig tut, sondern zu
 * viel: eine Box, die beim Start ungefragt die Helligkeit verstellt, ist ein
 * neuer Fehler. Deshalb prüfen die meisten Aussagen hier, dass NICHTS passiert
 * — bei lesbarem Schirm, genau auf der Grenze, ohne Gerät und mit gemerktem
 * Wert. Angehoben wird nur der eine Fall, der sich am Gerät nicht mehr heilen
 * lässt.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { PROZENT_MIN, rohUntergrenze } from './schirmhelligkeit'

let beimStart: () => Promise<string>
let ordner: string
let wurzel: string
let konfigPfad: string

const GERAET = '11-0045'

/** Ein Panel mit frei wählbarem Wertebereich — die Untergrenze ist eine
 *  Rechnung darüber, keine feste Zahl. */
function panelBauen(roh: number, maxRoh = 255): void {
  const d = join(wurzel, GERAET)
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'brightness'), `${roh}\n`)
  writeFileSync(join(d, 'max_brightness'), `${maxRoh}\n`)
  writeFileSync(join(d, 'bl_power'), '0\n')
}

function panelWeg(): void {
  rmSync(join(wurzel, GERAET), { recursive: true, force: true })
}

/** Was WIRKLICH in der Gerätedatei steht. Die einzige Aussage, die zählt. */
function rohwert(): number {
  return Number(readFileSync(join(wurzel, GERAET, 'brightness'), 'utf8').trim())
}

function konfigSchreiben(displayBrightness?: string): void {
  const mupibox: Record<string, string> = { host: 'MuPiBox', startVolume: '40', maxVolume: '100' }
  if (displayBrightness !== undefined) mupibox.displayBrightness = displayBrightness
  writeFileSync(
    konfigPfad,
    JSON.stringify({
      mupibox,
      interfacelogin: { state: false, password: '' },
      timeout: { idlePiShutdown: '0', idleDisplayOff: '10', pressDelay: '2' },
    }),
  )
}

describe('Der Start und ein zu dunkler Bildschirm', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-schirmstart-'))
    wurzel = join(ordner, 'backlight')
    mkdirSync(wurzel, { recursive: true })
    konfigPfad = join(ordner, 'mupiboxconfig.json')
    konfigSchreiben()
    panelBauen(255)

    process.env.MUPIBOX_BACKLIGHT = wurzel
    process.env.MUPIBOX_CONFIG = konfigPfad
    process.env.MUPIBOX_CONFIG_DIR = ordner
    const modul = await import('./server.js')
    beimStart = modul.helligkeitBeimStart
  })

  after(() => {
    process.env.MUPIBOX_BACKLIGHT = undefined
    process.env.MUPIBOX_CONFIG = undefined
    process.env.MUPIBOX_CONFIG_DIR = undefined
    rmSync(ordner, { recursive: true, force: true })
  })

  it('holt einen Schirm auf Rohwert 0 auf die Untergrenze zurück', async () => {
    konfigSchreiben() // kein displayBrightness — wie jede Box im Feld
    panelBauen(0)
    assert.equal(await beimStart(), 'angehoben')
    assert.equal(rohwert(), rohUntergrenze(255), 'genau die Untergrenze, nicht volle Helligkeit')
  })

  it('holt auch einen Schirm knapp unter der Grenze zurück', async () => {
    konfigSchreiben()
    panelBauen(rohUntergrenze(255) - 1)
    assert.equal(await beimStart(), 'angehoben')
    assert.equal(rohwert(), rohUntergrenze(255))
  })

  it('fasst einen Schirm GENAU auf der Grenze nicht an', async () => {
    konfigSchreiben()
    panelBauen(rohUntergrenze(255))
    assert.equal(await beimStart(), 'nichts-gemerkt')
    assert.equal(rohwert(), rohUntergrenze(255), 'unverändert')
  })

  it('DIMMT NIE — ein heller Schirm bleibt hell', async () => {
    konfigSchreiben()
    panelBauen(255)
    assert.equal(await beimStart(), 'nichts-gemerkt')
    assert.equal(rohwert(), 255)
  })

  it('lässt einen bewusst mittelhellen Schirm in Ruhe', async () => {
    konfigSchreiben()
    panelBauen(120)
    assert.equal(await beimStart(), 'nichts-gemerkt')
    assert.equal(rohwert(), 120, 'wer auf 47 % steht, wird nicht beglückt')
  })

  it('hebt auch auf einem winzigen Panel an, und nie auf 0', async () => {
    konfigSchreiben()
    panelBauen(0, 2)
    assert.equal(await beimStart(), 'angehoben')
    assert.equal(rohwert(), 1, 'bei max_brightness 2 ist 1 die Untergrenze')
    assert.ok(rohwert() > 0, 'was hier herauskommt, darf nie 0 sein')
  })

  it('ein gemerkter Wert hat weiter Vorrang — das Anheben tritt nicht dazwischen', async () => {
    konfigSchreiben('60')
    panelBauen(0)
    assert.equal(await beimStart(), 'gesetzt')
    assert.equal(rohwert(), 153, '60 % von 255')
  })

  it('ein gemerkter Unsinn ergibt volle Helligkeit, nicht Dunkelheit', async () => {
    konfigSchreiben('0')
    panelBauen(0)
    assert.equal(await beimStart(), 'gesetzt')
    assert.equal(rohwert(), 255)
  })

  it('ohne Hintergrundlicht passiert gar nichts', async () => {
    konfigSchreiben()
    panelWeg()
    assert.equal(await beimStart(), 'kein-geraet')
  })

  it('ein unlesbarer Rohwert wird nicht geraten', async () => {
    konfigSchreiben()
    panelBauen(0)
    // Der Kernel gibt hier immer eine Zahl. Steht dort etwas anderes, ist die
    // Auskunft kaputt — und dann wird NICHT anhand einer Vermutung geschrieben.
    writeFileSync(join(wurzel, GERAET, 'brightness'), 'keine Zahl\n')
    assert.equal(await beimStart(), 'nichts-gemerkt')
    assert.equal(readFileSync(join(wurzel, GERAET, 'brightness'), 'utf8').trim(), 'keine Zahl')
  })

  it('die Untergrenze des Anhebens ist dieselbe wie die des Reglers', () => {
    // Kein zweiter Ort für dieselbe Zahl: was beim Start geschrieben wird,
    // kommt aus rohUntergrenze — genau wie das, was ein PUT mit PROZENT_MIN
    // schreiben würde.
    assert.equal(rohUntergrenze(255), Math.round((PROZENT_MIN / 100) * 255))
  })
})
