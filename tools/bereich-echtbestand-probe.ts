/**
 * DER UMZUG AM ECHTEN BESTAND EINER BOX — gegengelesen, nicht nachgebaut.
 *
 * WARUM NOCH EIN LAUF, WO `bereich.integration.spec.ts` doch gruen ist: dieser
 * Test schreibt sich seine Ausgangslage selbst. Er prueft, was der Bauende sich
 * als Ausgangslage GEDACHT hat. Was auf der Box wirklich liegt, kann anders
 * aussehen — tote Verweise, leere Dateien, Formen, an die niemand dachte.
 *
 * DIESER LAUF NIMMT DEN ECHTEN BESTAND. Er liegt in
 * `/home/dietpi/sicherung-gegenlesen-20260805/` auf der Box .169 und ist der
 * Stand VOR der Auslieferung von E18 Stufe 2 — die flache Form, mit den beiden
 * Verweisen `active_data.json` und `active_resume.json`, die eine Box hat.
 *
 * Holen (einmalig, veraendert an der Box NICHTS):
 *   rsync -a dietpi@192.168.178.169:/home/dietpi/sicherung-gegenlesen-20260805/ <ordner>/
 *
 * Fahren:
 *   MUPIBOX_ECHTBESTAND=<ordner> npx cross-env NODE_ENV=test \
 *     npx tsx --test tools/bereich-echtbestand-probe.ts
 *
 * GEZAEHLT WIRD VORHER UND NACHHER. Nicht „die Datei ist da" — die Datei ist
 * auch da, wenn sie `[]` enthaelt. Gezaehlt werden EINTRAEGE, und zwar auf der
 * Platte UND ueber die Schnittstelle, weil nur das zweite beweist, dass die
 * Oberflaeche sie auch sieht.
 */
import assert from 'node:assert/strict'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

const QUELLE = process.env.MUPIBOX_ECHTBESTAND
if (!QUELLE) {
  console.error('MUPIBOX_ECHTBESTAND fehlt — der Ordner mit dem echten Bestand der Box.')
  process.exit(2)
}

/** Wie viele Eintraege in einer JSON-Liste stehen; -1, wenn es sie nicht gibt. */
function zaehle(pfad: string): number {
  try {
    const roh = JSON.parse(readFileSync(pfad, 'utf8'))
    return Array.isArray(roh) ? roh.length : Object.keys(roh).length
  } catch {
    return -1
  }
}

let app: import('express').Express
let ordner: string
const vorher: Record<string, number> = {}
let verlaufVorher: { key: string; anzahl: number }[] = []

describe('E18/S2 gegengelesen: der ECHTE Bestand einer Box zieht um', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-echtbestand-'))
    // `dereference: false` — die VERWEISE muessen Verweise bleiben, sonst
    // pruefte der Lauf eine Lage, die es auf der Box nicht gibt.
    cpSync(QUELLE as string, ordner, { recursive: true, dereference: false, verbatimSymlinks: true })

    // DIE VERWEISE ZEIGEN AUF DIE BOX. Hier gibt es die Pfade nicht; ein toter
    // Verweis ist aber eine ANDERE Lage als ein lebender. Also werden sie auf
    // dieselben Ziele IM ORDNER umgehaengt — genau die Beziehung, die auf der
    // Box besteht (active_data.json -> data.json im selben Verzeichnis).
    for (const [verweis, ziel] of [
      ['active_data.json', 'data.json'],
      ['active_resume.json', 'resume.json'],
    ]) {
      const p = join(ordner, verweis)
      if (lstatSync(p).isSymbolicLink()) {
        unlinkSync(p)
        symlinkSync(join(ordner, ziel), p)
      }
    }

    for (const d of ['gespielt.gast.json', 'listen.json', 'kinderzeit-verbrauch.gast.json', 'resume.json', 'data.json'])
      vorher[d] = zaehle(join(ordner, d))
    verlaufVorher = JSON.parse(readFileSync(join(ordner, 'gespielt.gast.json'), 'utf8'))

    process.env.MUPIBOX_CONFIG_DIR = ordner
    const modul = await import('../src/backend-api/src/server.js')
    app = modul.app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
    console.info(`\nAusgangslage lag in ${ordner}`)
  })

  it('die Box hat KEIN profile.json — und bekommt trotzdem einen Bereich', async () => {
    // DIE ECHTE BOX HAT KEINS. `profilStand` faellt auf den Gast zurueck; ein
    // Umzug, der nur ueber die Profilliste laeuft, muesste dann gar nicht
    // stattfinden. Genau das waere der stille Totalverlust.
    assert.equal(existsSync(join(QUELLE as string, 'profile.json')), false, 'Annahme des Laufs')
    assert.equal(lstatSync(join(ordner, 'profile', 'gast')).isDirectory(), true)
  })

  it('KEIN Verlaufseintrag geht verloren — auf der Platte gezaehlt', () => {
    const nachher = zaehle(join(ordner, 'profile', 'gast', 'gespielt.json'))
    assert.equal(nachher, vorher['gespielt.gast.json'], `${vorher['gespielt.gast.json']} Eintraege vorher`)
    assert.ok(nachher > 0, 'und es waren wirklich welche da')
  })

  it('KEIN Verlaufseintrag geht verloren — ueber die Schnittstelle gezaehlt', async () => {
    // Die Platte kann stimmen und die Oberflaeche trotzdem leer sein (falscher
    // Leseweg, Zwischenspeicher, andere Kennung). Deshalb ZWEIMAL gezaehlt.
    //
    // GEZAEHLT WIRD `zuletzt`, NICHT `haeufigste`. Beim ersten Anlauf stand
    // hier `haeufigste`, und der Lauf war ROT: 20 statt 31. Das war KEIN
    // Verlust — `haeufigste()` siebt alles mit `anzahl < 2` heraus („was einmal
    // lief, ist nicht oft gehoert"), und auf der echten Box haben genau 11
    // Eintraege die Zahl 1. Ein Sieb als Verlust zu melden waere der teuerste
    // Fehlalarm, den ein Gegenlesen produzieren kann; deshalb steht es hier.
    // `zuletzt()` siebt nicht — und nur das beantwortet die gestellte Frage.
    const r = await request(app).get(`/api/gespielt?max=${verlaufVorher.length}`).expect(200)
    assert.equal(r.body.profil, 'gast')
    assert.equal(r.body.zuletzt.length, verlaufVorher.length, 'ungesiebt gezaehlt')
    // Und Stueck fuer Stueck: derselbe Schluessel, dieselbe Zahl.
    for (const alt of verlaufVorher) {
      const neu = r.body.zuletzt.find((e: { key: string }) => e.key === alt.key)
      assert.ok(neu, `verloren: ${alt.key}`)
      assert.equal(neu.anzahl, alt.anzahl, `Zahl veraendert bei ${alt.key}`)
    }
  })

  it('die BIBLIOTHEK ist unveraendert und fuer alle sichtbar', async () => {
    const r = await request(app).get('/api/data').expect(200)
    assert.equal(r.body.length, vorher['data.json'], 'eine gefuellte Box darf nicht leer aussehen')
    assert.ok(r.body.length > 0)
  })

  it('die beiden VERWEISE sind heil — und zeigen noch auf eine Datei', () => {
    for (const v of ['active_data.json', 'active_resume.json']) {
      const p = join(ordner, v)
      assert.equal(lstatSync(p).isSymbolicLink(), true, `${v} ist kein Verweis mehr`)
      assert.equal(statSync(p).isFile(), true, `${v} zeigt ins Leere`)
    }
  })

  it('resume.json und kinderzeit.json liegen unberuehrt an ihrem Platz', () => {
    assert.equal(zaehle(join(ordner, 'resume.json')), vorher['resume.json'])
    assert.equal(existsSync(join(ordner, 'kinderzeit.json')), true)
    assert.equal(existsSync(join(ordner, 'profile', 'gast', 'resume.json')), false)
    assert.equal(existsSync(join(ordner, 'profile', 'gast', 'kinderzeit.json')), false)
  })

  it('NICHTS AUSSER DEN DREI ABLAGEN hat das Verzeichnis verlassen', () => {
    // DIE WICHTIGSTE ZAEHLUNG DES GANZEN LAUFS. Sie faengt, was kein gezielter
    // Test faengt: eine Datei, an die niemand gedacht hat und die trotzdem
    // umgezogen (oder verschwunden) ist.
    const gezogen = new Set(['gespielt.gast.json', 'kinderzeit-verbrauch.gast.json', 'listen.json'])
    const alt = readdirSync(QUELLE as string).filter((n) => !gezogen.has(n))
    const neu = new Set(readdirSync(ordner))
    const fehlt = alt.filter((n) => !neu.has(n))
    assert.deepEqual(fehlt, [], `verschwunden: ${fehlt.join(', ')}`)
  })

  it('ein zweiter Start bei UNVOLLSTAENDIGEM Umzug macht weiter, statt zu ueberschreiben', async () => {
    // ABBRUCH MITTENDRIN, nachgestellt: gespielt.json ist schon im Bereich, die
    // Listen liegen wieder draussen (als haette der Prozess dazwischen
    // aufgegeben). Der naechste Lauf muss den Rest holen — und den schon
    // umgezogenen Teil in Ruhe lassen.
    const bereichGespielt = join(ordner, 'profile', 'gast', 'gespielt.json')
    const stempelVorher = statSync(bereichGespielt).mtimeMs
    const inhaltVorher = readFileSync(bereichGespielt, 'utf8')
    writeFileSync(join(ordner, 'listen.json'), JSON.stringify([{ id: 'a', name: 'Nachzuegler', titel: [] }]))
    // Der Bereich hat schon eine listen.json (leer, `[]`) — sie GEWINNT, denn
    // sie ist die juengere Wahrheit. Also erst wegnehmen, sonst prueft der
    // Lauf nur die Idempotenz und nicht das Nachholen.
    unlinkSync(join(ordner, 'profile', 'gast', 'listen.json'))

    await request(app)
      .put('/api/profile')
      .send({ profile: [{ kennung: 'gast', name: 'Gast' }] })
      .expect(200)

    assert.equal(readFileSync(bereichGespielt, 'utf8'), inhaltVorher, 'der fertige Teil wurde angefasst')
    assert.equal(statSync(bereichGespielt).mtimeMs, stempelVorher, 'und nicht einmal neu geschrieben')
    assert.equal(zaehle(join(ordner, 'profile', 'gast', 'listen.json')), 1, 'der Rest ist nachgezogen')
    assert.equal(existsSync(join(ordner, 'listen.json')), false)
  })

  it('taucht die alte Form WIEDER auf, ueberschreibt sie den Bereich NICHT', async () => {
    // DER FALL, DEN DIE ROTPROBE ERZWUNGEN HAT. Beim ersten Anlauf stand hier
    // nur „die alte Stelle wird nicht gelesen" — und der Lauf blieb GRUEN,
    // selbst als BEIDE Idempotenzsperren (`bereichUebernehmen` und
    // `ablageUebernehmen`) ausgebaut waren. Grund: nach einem geglueckten Umzug
    // gibt es die alte Datei gar nicht mehr, also greift keine Sperre, also
    // faellt ihr Fehlen nicht auf. Ein Test, der eine Naht nicht erreicht,
    // behauptet ihre Wirkung, ohne sie gemessen zu haben.
    //
    // ERREICHT WIRD SIE SO: die alte Form taucht WIEDER auf (Rueckbau, zweiter
    // Node-Prozess, eine von Hand zurueckgespielte Sicherung) — und dann wird
    // das Herrichten ausgeloest, genau wie es ein Neustart taete.
    writeFileSync(join(ordner, 'gespielt.gast.json'), JSON.stringify([{ key: 'untergeschoben', anzahl: 999 }]))
    await request(app)
      .put('/api/profile')
      .send({ profile: [{ kennung: 'gast', name: 'Gast' }] })
      .expect(200)

    const imBereich = JSON.parse(readFileSync(join(ordner, 'profile', 'gast', 'gespielt.json'), 'utf8'))
    assert.equal(imBereich.length, verlaufVorher.length, 'der Bereich wurde ueberschrieben')
    assert.equal(existsSync(join(ordner, 'gespielt.gast.json')), true, 'die untergeschobene Datei verschwand still')

    const r = await request(app).get(`/api/gespielt?max=${verlaufVorher.length}`).expect(200)
    assert.equal(
      r.body.zuletzt.find((e: { key: string }) => e.key === 'untergeschoben'),
      undefined,
      'und gelesen wird sie auch nicht',
    )
    assert.equal(r.body.zuletzt.length, verlaufVorher.length)
  })
})
