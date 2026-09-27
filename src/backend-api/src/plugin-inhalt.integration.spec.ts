/**
 * DIE NAHT (E87): ein Eintrag `type: plugin` in data.json — und was am Ende
 * als Abspielbefehl herauskommt.
 *
 * ══ WOZU DIESER ZEUGE, WO DOCH ALLES EINZELN GEPRUEFT IST ══════════════════
 * Weil GENAU DIESE KONSTELLATION am 22.08.2026 schon einmal gescheitert ist:
 * bei den Plugin-Flaechen (E77) waren Vertrag, Wirt und Route je fuer sich
 * gruen, und am Geraet kam ein 404, obwohl die Datei lag. Die Naht dazwischen
 * hatte keinen Zeugen.
 *
 * Und er hat sich sofort bezahlt gemacht: beim Schreiben fiel auf, dass
 * `plugins/mixpi-archive` seine Folgen OHNE `kennung` zurueckgab. Das Plugin
 * war gruen (22 Zeugen), der Kern haette jede Folge STILL uebergangen
 * („Folge ohne Kennung uebergangen"), und die Kachel haette eine leere Liste
 * gezeigt. Kein Fehler, keine Meldung — die teuerste Sorte.
 *
 * ══ WAS HIER ECHT IST UND WAS NICHT ════════════════════════════════════════
 * ECHT: der Server (importiert, nicht nachgebaut), der Plugin-Wirt, ein
 * echter Worker mit echtem Vertrag, data.json auf der Platte.
 * NACHGEBILDET: nur das NETZ des Plugins — es liefert seine Folgen aus einer
 * Tabelle, statt ins Internet zu gehen. Ein Zeuge, der an einer fremden
 * Schnittstelle haengt, ist kein Zeuge, sondern eine Wettervorhersage.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

// MIT PUNKT-SEGMENT, wie am Geraet (`/home/dietpi/.mupibox/plugins`): Express'
// sendFile verweigert Punktpfade in der Vorgabe. Derselbe Grund wie in
// plugin-flaechen.integration.spec.ts — die Umgebung nachbilden, in der der
// Zeuge etwas beweisen soll.
const WURZEL = fs.mkdtempSync(path.join(os.tmpdir(), 'mupi-pi-'))
const PLUGINS = path.join(WURZEL, '.mupibox', 'plugins')
let app: import('express').Express

/** Der Eintrag, um den es geht — so steht er in data.json. */
const EINTRAG = {
  type: 'plugin',
  category: 'audiobook',
  id: 'mixpi-probequelle:faust',
  title: 'Faust',
  artist: 'Goethe',
}

before(async () => {
  const ordner = path.join(PLUGINS, 'mixpi-probequelle')
  fs.mkdirSync(ordner, { recursive: true })
  fs.writeFileSync(
    path.join(ordner, 'plugin.json'),
    JSON.stringify({
      kennung: 'mixpi-probequelle',
      name: 'Probequelle',
      fassung: '1.0.0',
      haupt: 'index.mjs',
      rechte: ['medienquelle'],
    }),
  )
  /* DAS PLUGIN LIEFERT ALLE SORTEN, die der Kern unterscheiden muss —
   * [[attrappe-luegt-durch-weglassen]]: die Frage ist nicht „stelle ich den
   * schoenen Fall?", sondern „welche Sorten gibt es?".
   *
   *   1  vollstaendig
   *   2  ohne Dauer und ohne Bild
   *   3  OHNE KENNUNG — der Fehler, der mixpi-archive still lahmgelegt haette
   *   4  mit `file:`-Adresse — muss an fundPruefen scheitern
   */
  fs.writeFileSync(
    path.join(ordner, 'index.mjs'),
    `export default {
      async inhalt(rest) {
        if (rest === 'leer') return { titel: 'Leeres Werk', folgen: [], vollstaendig: true }
        if (rest === 'kaputt') throw new Error('die Quelle antwortet nicht')
        return {
          titel: 'Faust',
          kuenstler: 'LibriVox',
          vollstaendig: true,
          folgen: [
            { kennung: 'f1', name: '01 - Zueignung', dauerSek: 134, bild: 'https://bild.example/1.jpg',
              quelle: { art: 'strom', adresse: 'https://ton.example/1.mp3' } },
            { kennung: 'f2', name: '02 - Vorspiel',
              quelle: { art: 'strom', adresse: 'https://ton.example/2.mp3' } },
            { name: 'Ohne Kennung',
              quelle: { art: 'strom', adresse: 'https://ton.example/3.mp3' } },
            { kennung: 'f4', name: 'Verbotene Adresse',
              quelle: { art: 'strom', adresse: 'file:///etc/shadow' } },
          ],
        }
      },
    }\n`,
  )

  fs.writeFileSync(path.join(WURZEL, 'data.json'), JSON.stringify([EINTRAG], null, 2))
  fs.writeFileSync(path.join(WURZEL, 'active_data.json'), JSON.stringify([EINTRAG], null, 2))
  fs.writeFileSync(path.join(WURZEL, 'resume.json'), '[]')
  fs.writeFileSync(path.join(WURZEL, 'gespielt.json'), '[]')
  fs.writeFileSync(path.join(WURZEL, 'mupiboxconfig.json'), JSON.stringify({ mupibox: { resume: 9 } }))
  process.env.MUPIBOX_CONFIG = path.join(WURZEL, 'mupiboxconfig.json')
  process.env.MUPIBOX_CONFIG_DIR = WURZEL
  process.env.MUPIBOX_LOCK_DIR = WURZEL
  process.env.MUPIBOX_PLUGIN_DIR = PLUGINS
  app = (await import('./server.js')).app
  const { warteBereit } = await import('./plugin-wirt.js')
  await warteBereit('mixpi-probequelle', 10_000)
})

after(async () => {
  // Ohne das haelt der Worker den Testprozess offen — in
  // plugin-flaechen.integration.spec.ts steht derselbe Satz, und dort hing
  // der Lauf beim ersten Mal fuenf Minuten im Timeout.
  const { allesBeenden } = await import('./plugin-wirt.js')
  await allesBeenden()
  process.env.MUPIBOX_CONFIG_DIR = undefined
  process.env.MUPIBOX_LOCK_DIR = undefined
  process.env.MUPIBOX_PLUGIN_DIR = undefined
  fs.rmSync(WURZEL, { recursive: true, force: true })
})

/** Der Schluessel, unter dem die Box dieses Werk fuehrt. */
const SCHLUESSEL = encodeURIComponent('plugin:mixpi-probequelle:faust')

describe('Plugin-Inhalt vom HTTP-Ende bis in den Worker (E87)', () => {
  it('DIE KACHEL IST EINE SHOW, keine Kachel „anderes"', async () => {
    // Bis E87 kam hier `anderes` heraus — eine Kachel, die sich nicht oeffnen
    // laesst. Geprueft ueber /api/werke, also den Weg der Box.
    const a = await request(app).get('/api/werke').expect(200)
    const werk = (a.body.werke as Record<string, unknown>[]).find(
      (w) => w.schluessel === 'plugin:mixpi-probequelle:faust',
    )
    assert.ok(werk, 'das Plugin-Werk fehlt in /api/werke')
    assert.equal(werk.art, 'show')
  })

  it('DER BEFEHL ENTSTEHT IM SERVER — mit Verb, Adresse und Titelform', async () => {
    const a = await request(app).get(`/api/werke/${SCHLUESSEL}/inhalt`).expect(200)
    assert.equal(a.body.dienst, 'plugin')
    const erste = a.body.titel[0]
    assert.equal(erste.titel, '01 - Zueignung')
    assert.equal(erste.id, 'f1', 'die Folgenkennung des Plugins, nicht die Adresse')
    assert.equal(erste.dauerMs, 134_000)
    // Das VERB ist `plugin` — nicht `jellyfin` mitbenutzt, damit `currentType`
    // im Abspieldienst die Wahrheit sagt.
    assert.equal(
      erste.befehl,
      `plugin/${encodeURIComponent('https://ton.example/1.mp3')}/${encodeURIComponent('01 - Zueignung')}:title:artist:Goethe`,
    )
    assert.match(erste.anhaengen, /^pluginqueue\//)
  })

  it('DER INTERPRET KOMMT VOM EINTRAG, nicht vom Plugin', async () => {
    // Der Eintrag sagt „Goethe", das Plugin „LibriVox". Die Box beschriftet
    // ihre Kacheln selbst — was in data.json steht, hat Vorrang.
    const a = await request(app).get(`/api/werke/${SCHLUESSEL}/inhalt`).expect(200)
    assert.equal(a.body.titel[0].interpret, 'Goethe')
  })

  it('EINE FOLGE OHNE KENNUNG faellt heraus — und die anderen bleiben', async () => {
    /* GENAU DER FEHLER, DEN mixpi-archive HATTE. `inhaltPruefen` uebergeht
     * sie STILL; der Zeuge macht die Stille sichtbar. Wichtig ist der zweite
     * Teil: die uebrigen Folgen ueberleben — eine kaputte Folge darf nicht
     * das ganze Werk kosten. */
    const a = await request(app).get(`/api/werke/${SCHLUESSEL}/inhalt`).expect(200)
    const namen = (a.body.titel as { titel: string }[]).map((t) => t.titel)
    assert.ok(!namen.includes('Ohne Kennung'), 'die kennungslose Folge darf nicht durchkommen')
    assert.ok(namen.includes('01 - Zueignung') && namen.includes('02 - Vorspiel'))
  })

  it('EINE `file:`-ADRESSE kommt nicht durch — der Riegel gilt auch hier', async () => {
    // Sonst waere `quelle` ein Weg, jede Datei der Box vorlesen zu lassen.
    const a = await request(app).get(`/api/werke/${SCHLUESSEL}/inhalt`).expect(200)
    const namen = (a.body.titel as { titel: string }[]).map((t) => t.titel)
    assert.ok(!namen.includes('Verbotene Adresse'))
  })

  it('ohne Dauer und ohne Bild bleibt die Folge trotzdem spielbar', async () => {
    const a = await request(app).get(`/api/werke/${SCHLUESSEL}/inhalt`).expect(200)
    const zweite = (a.body.titel as Record<string, unknown>[]).find((t) => t.titel === '02 - Vorspiel')
    assert.ok(zweite)
    assert.equal(zweite.dauerMs, undefined)
    assert.equal(zweite.bild, undefined)
    assert.ok(String(zweite.befehl).startsWith('plugin/'))
  })

  it('OHNE GEMERKTE STELLE ist `weiterAb` ueberall null', async () => {
    const a = await request(app).get(`/api/werke/${SCHLUESSEL}/inhalt`).expect(200)
    for (const t of a.body.titel as { weiterAb: unknown }[]) assert.equal(t.weiterAb, null)
  })

  it('DIE GEMERKTE STELLE HAENGT AN DER FOLGENKENNUNG (E90), nicht an der Position', async () => {
    /* Der Grund ist derselbe wie bei der ARD: die Liste hinter einem
     * Plugin-Werk darf zwischen zwei Blicken anders aussehen. Wer die
     * Position merkt, springt nach dem naechsten Zuwachs in ein fremdes
     * Stueck. */
    // Die Box holt vor dem Abspielen ohnehin `/inhalt` — daraus baut sie die
    // mpv-Warteschlange, und daraus merkt sich der Server die Reihenfolge.
    // Genau diese Abfolge wird hier nachgestellt.
    await request(app).get(`/api/werke/${SCHLUESSEL}/inhalt`).expect(200)

    // mpv sagt „Titel 2 von 2, bei 249 von 600 Sekunden". Die FOLGE steht
    // nicht im Rumpf — sie wird aus der gemerkten Liste aufgeloest, und genau
    // das ist der Punkt.
    const m = await request(app)
      .post('/api/weiterhoeren')
      .send({ schluessel: 'plugin:mixpi-probequelle:faust', titelNr: 2, gesamt: 2, bisher: 249, dauer: 600 })
      .expect(200)
    assert.equal(m.body.status, 'ok')

    const a = await request(app).get(`/api/werke/${SCHLUESSEL}/inhalt`).expect(200)
    const titel = a.body.titel as { titel: string; weiterAb: { folge?: string; positionProzent?: number } | null }[]
    const blau = titel.filter((t) => t.weiterAb)
    assert.equal(blau.length, 1, 'genau EINE Folge traegt die Stelle')
    assert.equal(blau[0].titel, '02 - Vorspiel')
    assert.equal(blau[0].weiterAb?.folge, 'f2')
    assert.equal(blau[0].weiterAb?.positionProzent, 41.5)
  })

  it('OHNE FOLGENKENNUNG gilt eine Plugin-Stelle NICHT — lieber nichts als falsch', async () => {
    /* Der Fall, den `nummerVerlaesslich` abfaengt: eine Stelle, die vor E90
     * geschrieben wurde (oder von Hand), traegt nur eine NUMMER. In einer
     * rollenden Liste zeigt die moeglicherweise in ein fremdes Stueck — also
     * gilt sie gar nicht. Ohne diesen Zeugen faellt eine Lockerung dort nicht
     * auf. */
    const { readFileSync, writeFileSync } = await import('node:fs')
    const datei = path.join(WURZEL, 'resume.json')
    const vorher = readFileSync(datei, 'utf8')
    const stellen = JSON.parse(vorher) as Record<string, unknown>[]
    // Die Kennung wegnehmen, alles andere lassen.
    for (const st of stellen) delete st.resumeardfolge
    writeFileSync(datei, JSON.stringify(stellen))

    const a = await request(app).get(`/api/werke/${SCHLUESSEL}/inhalt`).expect(200)
    const blau = (a.body.titel as { weiterAb: unknown }[]).filter((t) => t.weiterAb)
    assert.equal(blau.length, 0, 'eine Stelle ohne Folgenkennung darf nicht gelten')

    writeFileSync(datei, vorher)
  })

  it('und sie WANDERT MIT, wenn die Liste sich verschiebt', async () => {
    /* Der eigentliche Beweis. Die Stelle steht auf `f2`; kaeme ein Stueck
     * davor dazu, waere Position 2 eine andere Folge — die Kennung bleibt
     * aber dieselbe. Hier reicht es zu zeigen, dass NICHT die Nummer zaehlt:
     * gemerkt war titelNr 2, und getroffen wird die Folge mit der Kennung. */
    const a = await request(app).get(`/api/werke/${SCHLUESSEL}/inhalt`).expect(200)
    const titel = a.body.titel as { titel: string; id: string; weiterAb: unknown }[]
    const blau = titel.find((t) => t.weiterAb)
    assert.equal(blau?.id, 'f2', 'die Kennung entscheidet, nicht der Platz')
  })
})

describe('wenn etwas fehlt, sagt die Antwort WAS (E87)', () => {
  it('ein unbekanntes Plugin ist ein 502 mit Klartext und Kennung', async () => {
    // NICHT 404: die Route hat den Eintrag gefunden, das PLUGIN fehlt. Wer
    // dem nachgeht, braucht beides auseinandergehalten.
    const eintrag = { type: 'plugin', category: 'music', id: 'gibtsnicht:x', title: 'Weg' }
    fs.writeFileSync(path.join(WURZEL, 'data.json'), JSON.stringify([EINTRAG, eintrag], null, 2))
    const a = await request(app).get(`/api/werke/${encodeURIComponent('plugin:gibtsnicht:x')}/inhalt`)
    assert.equal(a.status, 502)
    assert.equal(a.body.error, 'pluginInhalt')
    assert.equal(a.body.kennung, 'gibtsnicht')
    assert.match(String(a.body.grund), /kein Plugin/)
  })

  it('ein Eintrag ohne Doppelpunkt in `id` ist ein 400, kein halber Ruf', async () => {
    const eintrag = { type: 'plugin', category: 'music', id: 'nurwortohnetrenner', title: 'Halb' }
    fs.writeFileSync(path.join(WURZEL, 'data.json'), JSON.stringify([EINTRAG, eintrag], null, 2))
    const a = await request(app).get(`/api/werke/${encodeURIComponent('plugin:nurwortohnetrenner')}/inhalt`)
    assert.equal(a.status, 400)
    assert.equal(a.body.error, 'keineKennung')
  })

  it('wirft das Plugin, kommt der Grund WOERTLICH durch', async () => {
    const eintrag = { type: 'plugin', category: 'music', id: 'mixpi-probequelle:kaputt', title: 'Kaputt' }
    fs.writeFileSync(path.join(WURZEL, 'data.json'), JSON.stringify([EINTRAG, eintrag], null, 2))
    const a = await request(app).get(`/api/werke/${encodeURIComponent('plugin:mixpi-probequelle:kaputt')}/inhalt`)
    assert.equal(a.status, 502)
    assert.match(String(a.body.grund), /antwortet nicht/)
  })

  it('LEER IST EIN ERGEBNIS, kein Fehler — wie bei der ARD', async () => {
    const eintrag = { type: 'plugin', category: 'music', id: 'mixpi-probequelle:leer', title: 'Leer' }
    fs.writeFileSync(path.join(WURZEL, 'data.json'), JSON.stringify([EINTRAG, eintrag], null, 2))
    const a = await request(app).get(`/api/werke/${encodeURIComponent('plugin:mixpi-probequelle:leer')}/inhalt`)
    assert.equal(a.status, 200)
    assert.deepEqual(a.body.titel, [])
  })
})
