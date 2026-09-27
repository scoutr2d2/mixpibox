/**
 * Die Helligkeit AM LAUFENDEN SERVER — mit einem nachgestellten
 * /sys/class/backlight, damit dabei kein echter Bildschirm dunkel wird.
 *
 * WARUM DAS NICHT DIE FORMEL NOCH EINMAL PRÜFT: die Formel steht in
 * schirmhelligkeit.spec.ts und ist dort ohne Gerät festgenagelt. Was hier
 * bewiesen wird, ist etwas anderes und geht mit einer reinen Prüfung nicht:
 *
 *   1. dass der ENDPUNKT die Untergrenze anwendet — und zwar so, dass bei
 *      einer abgelehnten Anfrage in der Gerätedatei WIRKLICH NICHTS steht,
 *      was den Schirm dunkel macht. Eine 400 mit bereits geschriebener 0 wäre
 *      grün in jedem Formeltest und schwarz auf der Box.
 *   2. dass die Einstellung in mupiboxconfig.json landet und beim Start von
 *      dort zurückkommt.
 *   3. dass eine Box OHNE Hintergrundlicht 409 und `da:false` bekommt statt
 *      eines Absturzes oder eines stillen „ok".
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'
import { PROZENT_MIN } from './schirmhelligkeit'

let app: import('express').Express
let beimStart: () => Promise<string>
let ordner: string
let wurzel: string
let konfigPfad: string

/** Das Panel der Box nachbauen — Name und Werte wie am 07.08.2026 gemessen. */
const GERAET = '11-0045'
function panelBauen(): void {
  const d = join(wurzel, GERAET)
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'brightness'), '255\n')
  writeFileSync(join(d, 'max_brightness'), '255\n')
  writeFileSync(join(d, 'bl_power'), '0\n')
}

function panelWeg(): void {
  rmSync(join(wurzel, GERAET), { recursive: true, force: true })
}

/** Was WIRKLICH in der Gerätedatei steht. Die einzige Aussage, die zählt. */
function rohwert(): string {
  return readFileSync(join(wurzel, GERAET, 'brightness'), 'utf8').trim()
}

function konfig(): Record<string, Record<string, unknown>> {
  return JSON.parse(readFileSync(konfigPfad, 'utf8'))
}

describe('Bildschirmhelligkeit am laufenden Server', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-schirm-'))
    wurzel = join(ordner, 'backlight')
    mkdirSync(wurzel, { recursive: true })
    panelBauen()

    konfigPfad = join(ordner, 'mupiboxconfig.json')
    writeFileSync(
      konfigPfad,
      JSON.stringify({
        mupibox: { host: 'MuPiBox', startVolume: '40', maxVolume: '100' },
        interfacelogin: { state: false, password: '' },
        timeout: { idlePiShutdown: '0', idleDisplayOff: '10', pressDelay: '2' },
      }),
    )

    process.env.MUPIBOX_BACKLIGHT = wurzel
    process.env.MUPIBOX_CONFIG = konfigPfad
    process.env.MUPIBOX_CONFIG_DIR = ordner
    const modul = await import('./server.js')
    app = modul.app
    beimStart = modul.helligkeitBeimStart
  })

  after(() => {
    process.env.MUPIBOX_BACKLIGHT = undefined
    process.env.MUPIBOX_CONFIG = undefined
    process.env.MUPIBOX_CONFIG_DIR = undefined
  })

  it('GET sagt, welches Gerät gefunden wurde und wie hell es steht', async () => {
    panelBauen()
    const r = await request(app).get('/api/schirm/helligkeit').expect(200)
    assert.equal(r.body.da, true)
    assert.equal(r.body.geraet, GERAET)
    assert.equal(r.body.prozent, 100)
    assert.equal(r.body.maxRoh, 255)
    assert.equal(r.body.min, PROZENT_MIN)
    assert.equal(r.body.schirmAus, false)
    assert.equal(r.body.gemerktProzent, null, 'noch nichts gespeichert')
    assert.equal(r.body.geklemmt, false)
    assert.equal(r.body.prozentEcht, 100)
  })

  it('PUT setzt den Rohwert im Gerät UND merkt die Prozente in der Konfiguration', async () => {
    const r = await request(app).put('/api/schirm/helligkeit').send({ prozent: 40 }).expect(200)
    assert.equal(r.body.ok, true)
    assert.equal(r.body.prozent, 40)
    assert.equal(r.body.gespeichert, true)
    assert.equal(rohwert(), '102', 'im Gerät muss der Rohwert stehen, nicht die Prozentzahl')
    assert.equal(konfig().mupibox.displayBrightness, '40')
    assert.equal(typeof konfig().mupibox.displayBrightness, 'string', 'die Skripte lesen mit jq -r')
    // Der Rest der Konfiguration bleibt unangetastet.
    assert.equal(konfig().mupibox.startVolume, '40')
    assert.equal(konfig().timeout.idleDisplayOff, '10')
  })

  it('ganz rechts ist wirklich ganz hell', async () => {
    await request(app).put('/api/schirm/helligkeit').send({ prozent: 100 }).expect(200)
    assert.equal(rohwert(), '255')
  })

  it('DIE SPERRE: 0 % wird abgelehnt — und im Gerät ändert sich dabei NICHTS', async () => {
    await request(app).put('/api/schirm/helligkeit').send({ prozent: 60 }).expect(200)
    const vorher = rohwert()
    for (const p of [0, 1, 19, -100, '0']) {
      const r = await request(app).put('/api/schirm/helligkeit').send({ prozent: p }).expect(400)
      assert.equal(r.body.ok, false)
      assert.match(String(r.body.error), /nicht einstellbar|zurückdrehen/)
      assert.equal(rohwert(), vorher, `${p} % wurde abgelehnt, aber das Gerät hat sich geändert`)
    }
    assert.equal(konfig().mupibox.displayBrightness, '60', 'eine abgelehnte Anfrage merkt sich auch nichts')
  })

  it('Unsinn statt einer Zahl ebenso', async () => {
    const vorher = rohwert()
    for (const p of ['hell', null, {}, [], true, '../../etc/shadow']) {
      await request(app).put('/api/schirm/helligkeit').send({ prozent: p }).expect(400)
    }
    await request(app).put('/api/schirm/helligkeit').send({}).expect(400)
    assert.equal(rohwert(), vorher)
  })

  it('nach einem Neustart kommt die gemerkte Helligkeit zurück', async () => {
    await request(app).put('/api/schirm/helligkeit').send({ prozent: 35 }).expect(200)
    // Der Kernel setzt beim Hochfahren auf seinen Vorgabewert zurück.
    writeFileSync(join(wurzel, GERAET, 'brightness'), '255\n')
    assert.equal(await beimStart(), 'gesetzt')
    assert.equal(rohwert(), String(Math.round((35 / 100) * 255)))
  })

  it('ohne gemerkten Wert fasst der Start nichts an', async () => {
    const k = konfig()
    delete k.mupibox.displayBrightness
    writeFileSync(konfigPfad, JSON.stringify(k))
    writeFileSync(join(wurzel, GERAET, 'brightness'), '255\n')
    assert.equal(await beimStart(), 'nichts-gemerkt')
    assert.equal(rohwert(), '255')
  })

  it('OHNE Hintergrundlicht: 200 mit da:false, und ein PUT bekommt 409 statt eines Absturzes', async () => {
    // MIT gemerktem Wert — sonst schiene der Start nur deshalb nichts zu tun,
    // weil nichts dasteht, und die Aussage über die fehlende Hardware wäre
    // keine.
    await request(app).put('/api/schirm/helligkeit').send({ prozent: 45 }).expect(200)
    panelWeg()
    assert.equal(existsSync(join(wurzel, GERAET)), false)

    const g = await request(app).get('/api/schirm/helligkeit').expect(200)
    assert.equal(g.body.da, false)
    assert.equal(g.body.prozent, null)
    assert.match(String(g.body.grund), /nicht dimmen/)

    const p = await request(app).put('/api/schirm/helligkeit').send({ prozent: 50 }).expect(409)
    assert.equal(p.body.ok, false)
    assert.equal(p.body.da, false)

    assert.equal(await beimStart(), 'kein-geraet')
    panelBauen()
  })

  it('ein Gerät, das nur an und aus kann, zählt als keines', async () => {
    writeFileSync(join(wurzel, GERAET, 'max_brightness'), '0\n')
    const g = await request(app).get('/api/schirm/helligkeit').expect(200)
    assert.equal(g.body.da, false)
    await request(app).put('/api/schirm/helligkeit').send({ prozent: 50 }).expect(409)
    writeFileSync(join(wurzel, GERAET, 'max_brightness'), '255\n')
  })

  it('ein untauglicher Nachbar-Eintrag nimmt dem echten Panel nicht die Sicht', async () => {
    // GEMESSEN am 07.08.2026 (tools/schirm-helligkeit-loch.mjs, Abschnitt 4):
    // der Server nahm den erstbesten Namen aus der Rangfolge und gab auf, wenn
    // ausgerechnet der nichts taugte. `09-0045` steht alphabetisch vor dem
    // Panel — mit dieser einen leeren Datei daneben antwortete der ganze Weg
    // mit "Dieser Bildschirm laesst sich nicht dimmen", obwohl das Panel
    // danebenlag. Ein Betreiber haette daraus geschlossen, seine Hardware
    // koenne es nicht.
    panelBauen()
    // a) ein Ordner ohne max_brightness
    mkdirSync(join(wurzel, '09-0045'), { recursive: true })
    let g = await request(app).get('/api/schirm/helligkeit').expect(200)
    assert.equal(g.body.da, true, 'ein kaputter Nachbar darf das Panel nicht verdecken')
    assert.equal(g.body.geraet, GERAET)
    await request(app).put('/api/schirm/helligkeit').send({ prozent: 60 }).expect(200)
    assert.equal(rohwert(), '153', 'geschrieben wird ins ECHTE Panel')
    rmSync(join(wurzel, '09-0045'), { recursive: true, force: true })

    // b) gar kein Ordner, sondern eine Datei
    writeFileSync(join(wurzel, '09-0045'), 'kein Ordner\n')
    g = await request(app).get('/api/schirm/helligkeit').expect(200)
    assert.equal(g.body.da, true)
    assert.equal(g.body.geraet, GERAET)
    rmSync(join(wurzel, '09-0045'), { force: true })

    // c) und wenn ALLE nichts taugen, bleibt es bei der ehrlichen Absage
    panelWeg()
    mkdirSync(join(wurzel, '09-0045'), { recursive: true })
    g = await request(app).get('/api/schirm/helligkeit').expect(200)
    assert.equal(g.body.da, false)
    rmSync(join(wurzel, '09-0045'), { recursive: true, force: true })
    panelBauen()
  })

  it('gleichzeitige PUTs lassen die Konfiguration der Box HEIL', async () => {
    // GEMESSEN am 07.08.2026 (tools/schirm-helligkeit-loch.mjs, Abschnitt 5):
    // alle Schreiber teilten sich einen Zwischennamen `<datei>.neu`. Zwei
    // gleichzeitige PUTs hinterliessen 337 Bytes, wo 336 hingehoerten — die
    // kuerzere Fassung mit dem letzten Byte der laengeren dahinter. Lesbar
    // blieb das nur, weil dieses Byte ein Zeilenumbruch war. Ein Regler, den
    // man zweimal schnell loslaesst, erzeugt genau diese Lage.
    panelBauen()
    await request(app).put('/api/schirm/helligkeit').send({ prozent: 60 }).expect(200)
    for (let runde = 0; runde < 3; runde++) {
      await Promise.all(
        [...Array(10)].map((_, i) =>
          request(app)
            .put('/api/schirm/helligkeit')
            .send({ prozent: i % 2 === 0 ? 100 : 40 }),
        ),
      )
    }
    const text = readFileSync(konfigPfad, 'utf8')
    const k = JSON.parse(text) as Record<string, Record<string, unknown>>
    // Nicht nur "parst noch": Zeichen fuer Zeichen genau eine der beiden
    // moeglichen Fassungen. Ein Gemisch parst womoeglich auch.
    assert.equal(text, `${JSON.stringify(k, null, 4)}\n`, 'die Datei ist ein Gemisch aus zwei Schreibern')
    assert.ok(['100', '40'].includes(String(k.mupibox.displayBrightness)))
    assert.equal(k.mupibox.startVolume, '40', 'der Rest der Konfiguration ist unversehrt')
    assert.equal(k.timeout.idleDisplayOff, '10')
    // Und kein Bruchstueck, das beim Aufraeumen wie eine Sicherung aussieht.
    const reste = readdirSync(ordner).filter((n) => n.endsWith('.neu'))
    assert.deepEqual(reste, [], 'ein halber Zwischenstand ist liegengeblieben')
  })

  it('ist der Schirm gerade ganz aus, sagt die Auskunft das — und bl_power bleibt, wie es war', async () => {
    writeFileSync(join(wurzel, GERAET, 'bl_power'), '4\n')
    const g = await request(app).get('/api/schirm/helligkeit').expect(200)
    assert.equal(g.body.da, true)
    assert.equal(g.body.schirmAus, true)
    await request(app).put('/api/schirm/helligkeit').send({ prozent: 80 }).expect(200)
    assert.equal(
      readFileSync(join(wurzel, GERAET, 'bl_power'), 'utf8').trim(),
      '4',
      'dieser Weg regelt die Helligkeit und schaltet den Schirm nicht',
    )
    assert.equal(rohwert(), '204')
    writeFileSync(join(wurzel, GERAET, 'bl_power'), '0\n')
  })

  /**
   * ══ DER ANGEZEIGTE WERT DARF NICHT LÜGEN ═══════════════════════════════
   *
   * GEMESSEN am 07.08.2026: brightness = 0 bei max_brightness = 255 ergab
   * `prozent: 20, roh: 0`. Wer die Verwaltung an einem zweiten Rechner offen
   * hatte, las „20 %" und hielt das für in Ordnung, während der Bildschirm der
   * Box schwarz war.
   *
   * WOHER SO EIN ROHWERT KOMMT: aus der alten Oberfläche
   * (AdminInterface/www/mupi.php), die weiterhin eine Stufe „0 %" anbietet.
   * Das ist kein gedachter Fall — deshalb wird hier genau das nachgestellt:
   * ein FREMDER Schreiber legt eine 0 in die Gerätedatei.
   *
   * Das Klemmen von `prozent` bleibt (die Begründung steht in
   * schirmhelligkeit.ts). Was hier festgehalten wird, ist die AUSKUNFT
   * darüber.
   */
  it('DIE LÜGE: steht das Gerät unter der Untergrenze, sagt die Antwort das', async () => {
    panelBauen()
    await request(app).put('/api/schirm/helligkeit').send({ prozent: 60 }).expect(200)

    // Die alte PHP-Seite schreibt eine 0 — an diesem Weg vorbei.
    writeFileSync(join(wurzel, GERAET, 'brightness'), '0\n')

    const g = await request(app).get('/api/schirm/helligkeit').expect(200)
    assert.equal(g.body.da, true)
    // Der Regler steht weiterhin dort, wo er stehen DARF …
    assert.equal(g.body.prozent, PROZENT_MIN, 'das Klemmen der Anzeige ist Absicht und bleibt')
    // … aber die Antwort sagt jetzt, dass das nicht die Wirklichkeit ist.
    assert.equal(g.body.geklemmt, true, 'ohne diese Auskunft zeigt die Verwaltung 20 % neben einem schwarzen Schirm')
    assert.equal(g.body.prozentEcht, 0, 'der Schirm gibt gar kein Licht mehr ab')
    assert.equal(g.body.roh, 0)
    assert.equal(g.body.rohMin, 51, 'damit sich `geklemmt` nachrechnen lässt')

    // Auch knapp unter der Grenze, nicht nur bei ganz aus.
    writeFileSync(join(wurzel, GERAET, 'brightness'), '50\n')
    const knapp = await request(app).get('/api/schirm/helligkeit').expect(200)
    assert.equal(knapp.body.geklemmt, true)
    assert.equal(knapp.body.prozentEcht, 20)
    assert.equal(knapp.body.prozent, PROZENT_MIN)

    // GENAU AUF DER GRENZE ist es KEINE Klemmung — sonst stünde bei jeder Box,
    // die schlicht auf der kleinsten Stufe steht, eine Warnung.
    writeFileSync(join(wurzel, GERAET, 'brightness'), '51\n')
    const grenze = await request(app).get('/api/schirm/helligkeit').expect(200)
    assert.equal(grenze.body.geklemmt, false)
    assert.equal(grenze.body.prozentEcht, 20)
  })

  it('DER WEG ZURÜCK: ein PUT auf die Untergrenze macht die Box wieder sichtbar', async () => {
    // Am Gerät steht der Regler in dieser Lage schon ganz links — ein Zug auf
    // 20 löst gar kein change-Ereignis aus und schickt nichts. Die Verwaltung
    // bietet deshalb einen KNOPF an, und der schickt genau das hier.
    panelBauen()
    writeFileSync(join(wurzel, GERAET, 'brightness'), '0\n')
    const r = await request(app).put('/api/schirm/helligkeit').send({ prozent: PROZENT_MIN }).expect(200)
    assert.equal(r.body.ok, true)
    assert.equal(rohwert(), '51', 'aus dem schwarzen Bild kommt man mit EINEM Griff zurück')
    const g = await request(app).get('/api/schirm/helligkeit').expect(200)
    assert.equal(g.body.geklemmt, false, 'und die Warnung verschwindet wieder')
  })

  /**
   * ══ EIN NAME, ZWEI TYPEN — DIE FALLE FÜR DEN NÄCHSTEN LAUF ═════════════
   *
   * `gemerkt` hiess im GET eine PROZENTZAHL (55) und im PUT ein
   * WAHRHEITSWERT (true). Wer aus dem GET liest und `if (!d.gemerkt)`
   * schreibt, bekommt für 55 zufällig das Richtige — aus dem falschen Grund,
   * und bei `null` dieselbe Antwort wie bei „konnte nicht gespeichert
   * werden".
   *
   * BEIDE wurden umbenannt, nicht nur einer: bliebe der Name auf einer Seite
   * stehen, läse ein alter Aufrufer dort weiter und bekäme drüben `undefined`
   * — still falsch statt laut falsch. Diese Aussage hält fest, dass der alte
   * Name NIRGENDS mehr auftaucht.
   */
  it('`gemerkt` gibt es nicht mehr — zwei Namen für zwei Typen', async () => {
    panelBauen()
    const p = await request(app).put('/api/schirm/helligkeit').send({ prozent: 55 }).expect(200)
    assert.equal(p.body.gespeichert, true)
    assert.equal(typeof p.body.gespeichert, 'boolean')
    assert.equal('gemerkt' in p.body, false, 'der zweideutige Name muss weg sein, nicht daneben stehen')

    const g = await request(app).get('/api/schirm/helligkeit').expect(200)
    assert.equal(g.body.gemerktProzent, 55)
    assert.equal(typeof g.body.gemerktProzent, 'number')
    assert.equal('gemerkt' in g.body, false)

    // Die eigentliche Falle: derselbe Name, zwei Typen. Jetzt tragen die
    // beiden Felder verschiedene Namen — und keiner von beiden ist beides.
    assert.notEqual(typeof g.body.gemerktProzent, typeof p.body.gespeichert)
  })
})
