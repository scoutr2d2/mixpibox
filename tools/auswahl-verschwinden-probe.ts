/**
 * KANN DURCH DIE AUSWAHL ETWAS STILL VERSCHWINDEN? — der Gegenlauf.
 *
 * ══ WOZU NOCH EIN LAUF, WO auswahl.integration.spec.ts DOCH GRUEN IST ══════
 *
 * Jener Lauf schreibt sich seine Ausgangslage selbst: drei erfundene Eintraege,
 * keine Verschmelzung, kein Offline-Betrieb, ein Verweis weniger als die Box
 * hat. Er prueft, was der Bauende sich GEDACHT hat.
 *
 * DIESER LAUF NIMMT DIE LAGE DER BOX .169, abgeholt am 07.08.2026 (lesend):
 *   * `data.json` mit 28 Eintraegen, darunter „External Playback" ohne
 *     Dienstkennung und zwei ARD-Eintraege.
 *   * `active_data.json` als VERWEIS auf `data.json` — so liegt es auf der
 *     Box, und nur so laesst sich der Offline-Fall echt nachstellen.
 *   * `offline_data.json` mit 4 Eintraegen. DAS IST DER SCHARFE FALL: Faellt
 *     das Netz aus, haengt `active_data.json` auf diese kurze Liste um. Ein
 *     Kind, dessen Auswahl auf Spotify-Werken steht, sieht dann NICHTS —
 *     und die Frage ist, ob die Box das SAGT oder ob es aussieht, als sei
 *     sie kaputt.
 *   * `verschmelzung.json` mit zwei Paaren (Jellyfin+Spotify). Wer nur EINE
 *     Haelfte auswaehlt, darf die Kachel nicht verlieren.
 *
 * ══ DIE FRAGEN, IN DER REIHENFOLGE IHRER SCHAERFE ══════════════════════════
 *
 *  1. Eine Box OHNE jede Auswahl — zeigt sie GENAU dasselbe wie vorher?
 *     Gezaehlt wird auf allen fuenf Wegen, nicht nur auf /api/data.
 *  2. Offline: die Auswahl bleibt stehen und das leere Regal sagt, warum.
 *  3. Ein Medium wird geloescht — die Auswahl kippt NICHT auf „alles".
 *  4. Ein Kind wird geloescht — die Auswahl geht mit; ein neues Kind
 *     desselben Namens erbt nichts.
 *  5. Der Gast bekommt auf KEINEM Weg eine Auswahl.
 *  6. Der Weg zurueck: eine Auswahl laesst sich aufheben.
 *  7. Was hier NEU dazukommt und nirgends sonst geprueft ist: die
 *     Weiterhoeren-Reihe, die verschmolzene Kachel und der Lauf
 *     `bereicheHerrichten()`, der nach JEDER Aenderung der Profilliste
 *     ueber alle Ablagen geht — auch ueber die neue.
 *
 * Fahren (veraendert an der Box NICHTS):
 *   NODE_ENV=test npx tsx --test tools/auswahl-verschwinden-probe.ts
 *
 * Die Bibliothek liegt daneben in tools/auswahl-verschwinden-probe/. Sie ist
 * ABGEHOLT und nicht erfunden — wer sie erneuert, holt sie mit
 *   scp dietpi@192.168.178.169:.../server/config/{data,offline_data,verschmelzung}.json
 *
 * EINE EINZIGE STELLE IST VERAENDERT: In den zwei Jellyfin-Coveradressen steht
 * `api_key=WEGGENOMMEN` statt des echten Zugangsschluessels des Jellyfin-
 * Servers. Er gehoert nicht in ein Verzeichnis, das jeder liest, und fuer
 * diesen Lauf spielt er keine Rolle — gefiltert wird ueber `type`, `id` und
 * `playlistid`, nie ueber `cover`. Die FORM der Adresse bleibt, damit die
 * Eintraege aussehen wie auf der Box.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

const HIER = dirname(fileURLToPath(import.meta.url))
const BESTAND = join(HIER, 'auswahl-verschwinden-probe')
const lies = (n: string) => JSON.parse(readFileSync(join(BESTAND, n), 'utf8'))

const BIBLIOTHEK: Record<string, unknown>[] = lies('data.json')
const OFFLINE: Record<string, unknown>[] = lies('offline_data.json')
const VERSCHMELZUNG = lies('verschmelzung.json')

/**
 * Der Schluessel eines Eintrags — WIE IHN DER SERVER BAUT.
 *
 * Bewusst NICHT `medienSchluessel` importiert: Dieser Lauf soll bemerken, wenn
 * sich die Regel aendert, statt sie mitzuaendern. Steht hier etwas anderes als
 * dort, faellt Frage 1 um — und genau das soll auffallen.
 */
function schluessel(e: Record<string, unknown>): string {
  const typ = String(e.type ?? '')
  const dienst = typ.startsWith('jellyfin') ? 'jellyfin' : typ === 'ard' ? 'ard' : typ
  const kennung = String(e.playlistid ?? e.id ?? e.showid ?? e.audiobookid ?? '')
  if (kennung) return `${dienst}:${kennung}`
  return `${dienst}:t:${String(e.artist ?? '').toLowerCase()}|${String(e.title ?? '').toLowerCase()}`
}

const SCHLUESSEL = BIBLIOTHEK.map(schluessel)
/** Drei Spotify-Werke — keines davon liegt in der Offline-Liste. */
const NUR_ONLINE = SCHLUESSEL.filter((s) => s.startsWith('spotify:') && !s.includes(':t:')).slice(0, 3)
/** Die beiden Haelften des ersten Verschmelzungspaares. */
const PAAR = VERSCHMELZUNG.zuordnungen[0] as { schluessel: string; auch: string[] }

let app: import('express').Express
let ordner: string
const auswahlDatei = (k: string) => join(ordner, 'profile', k, 'auswahl.json')
const profil = (k: string) => request(app).post('/api/profil/aktiv').send({ kennung: k }).expect(200)
const setzen = (k: string, werke: string[]) =>
  request(app).put('/api/profil/auswahl').send({ profil: k, werke }).expect(200)

/** Was ein Profil auf ALLEN Wegen sieht, aus denen Kacheln entstehen. */
async function sicht(k: string) {
  await profil(k)
  const d = await request(app).get('/api/data').expect(200)
  const w = await request(app).get('/api/werke').expect(200)
  const wv = await request(app).get('/api/werke?verschmelzen=1').expect(200)
  const i = await request(app).get('/api/interpreten').expect(200)
  const h = await request(app).get('/api/weiterhoeren').expect(200)
  return {
    data: d.body.length as number,
    werke: w.body.werke.length as number,
    verschmolzen: wv.body.werke.length as number,
    schluessel: (wv.body.werke as { schluessel: string }[]).map((x) => x.schluessel).sort(),
    interpreten: (i.body.interpreten ?? i.body.leute ?? i.body).length as number,
    weiter: (h.body.weiter as { schluessel?: string }[]).filter((z) => z.schluessel).length,
    auswahl: w.body.auswahl as { gewaehlt: number; vorrat: number; sichtbar: number },
  }
}

/** Den Verweis active_data.json umhaengen — genau das tut der Offline-Betrieb. */
function aktivAuf(ziel: string): void {
  const p = join(ordner, 'active_data.json')
  try {
    unlinkSync(p)
  } catch {
    /* gab es noch nicht */
  }
  symlinkSync(join(ordner, ziel), p)
}

describe('Kann durch die Auswahl etwas STILL verschwinden? (Lage der Box .169)', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-verschwinden-'))
    writeFileSync(join(ordner, 'data.json'), JSON.stringify(BIBLIOTHEK, null, 2))
    writeFileSync(join(ordner, 'offline_data.json'), JSON.stringify(OFFLINE, null, 2))
    writeFileSync(join(ordner, 'verschmelzung.json'), JSON.stringify(VERSCHMELZUNG, null, 2))
    aktivAuf('data.json')
    writeFileSync(
      join(ordner, 'profile.json'),
      JSON.stringify({
        profile: [
          { kennung: 'gast', name: 'Gast', figur: '', angelegt: 0 },
          { kennung: 'kalea', name: 'Kalea', figur: '', angelegt: 1 },
          { kennung: 'liam', name: 'Liam', figur: '', angelegt: 2 },
        ],
        aktiv: 'gast',
      }),
    )
    process.env.MUPIBOX_CONFIG_DIR = ordner
    app = (await import('../src/backend-api/src/server.js')).app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
  })

  // ── 1. OHNE JEDE AUSWAHL — DER ZUSTAND JEDER BESTEHENDEN BOX ──────────────

  it('die Bibliothek der Box hat 28 Eintraege, und keiner davon ist erfunden', () => {
    assert.equal(BIBLIOTHEK.length, 28)
    assert.equal(OFFLINE.length, 4)
    assert.ok(NUR_ONLINE.length === 3, 'drei Spotify-Werke fuer die Offline-Frage')
    for (const s of NUR_ONLINE) {
      assert.ok(
        !OFFLINE.map(schluessel).includes(s),
        `${s} darf in der Offline-Liste NICHT vorkommen, sonst prueft Frage 2 nichts`,
      )
    }
  })

  const ohne: Record<string, Awaited<ReturnType<typeof sicht>>> = {}

  it('ohne Auswahl sieht JEDER alles — auf allen fuenf Wegen gezaehlt', async () => {
    for (const wer of ['gast', 'kalea', 'liam']) {
      ohne[wer] = await sicht(wer)
      assert.equal(ohne[wer].data, 28, `${wer} /api/data`)
      assert.equal(ohne[wer].auswahl.gewaehlt, 0, `${wer} hat nichts gewaehlt`)
      assert.equal(ohne[wer].auswahl.sichtbar, ohne[wer].auswahl.vorrat, `${wer} sieht den ganzen Vorrat`)
    }
    // WORT FUER WORT DASSELBE, nicht bloss „auch nicht leer": Wer hier nur auf
    // „> 0" prueft, uebersieht genau den Fehler, um den es geht.
    assert.deepEqual(ohne.kalea, ohne.gast, 'Kind und Gast sehen ohne Auswahl dasselbe')
    assert.deepEqual(ohne.liam, ohne.gast)
  })

  it('und es liegt keine Datei herum, die niemand angelegt hat', () => {
    for (const k of ['gast', 'kalea', 'liam']) assert.equal(existsSync(auswahlDatei(k)), false, k)
  })

  // ── 2. OFFLINE: DIE KURZE LISTE ───────────────────────────────────────────
  //
  // DER GEFAEHRLICHSTE FALL DES GANZEN UMBAUS, und er steht in keinem anderen
  // Lauf: Kalea hat drei Spotify-Werke gewaehlt, das Netz faellt aus,
  // `active_data.json` haengt auf die vier lokalen Eintraege um. Ihr Regal ist
  // dann leer — die Frage ist, ob die Box es ERKLAEREN kann und ob die Auswahl
  // den Ausfall uebersteht.

  it('offline steht Kaleas Regal leer — aber der Server sagt, WARUM', async () => {
    await setzen('kalea', NUR_ONLINE)
    const online = await sicht('kalea')
    assert.equal(online.werke, 3, 'online sieht sie ihre drei')

    aktivAuf('offline_data.json')
    const offline = await sicht('kalea')
    assert.equal(offline.werke, 0, 'offline ist keines davon da')
    assert.deepEqual(
      offline.auswahl,
      { gewaehlt: 3, vorrat: 4, sichtbar: 0 },
      'gewaehlt > 0 bei sichtbar = 0 — daran erkennt die Seite „so eingestellt" statt „kaputt"',
    )
  })

  it('der Gast sieht offline weiter, was da ist — die Box wird nicht fuer alle leer', async () => {
    const g = await sicht('gast')
    assert.equal(g.data, 4)
    assert.equal(g.auswahl.gewaehlt, 0)
  })

  it('und die Auswahl ueberlebt den Ausfall — sie wird NICHT aufgeraeumt', async () => {
    const a = await request(app).get('/api/profil/auswahl?profil=kalea').expect(200)
    assert.deepEqual(a.body.werke, NUR_ONLINE, 'alle drei stehen noch da')
    assert.equal(a.body.alle, false, 'und sie ist nicht auf „alles" gekippt')
  })

  it('kommt das Netz zurueck, steht das Regal wieder da', async () => {
    aktivAuf('data.json')
    const k = await sicht('kalea')
    assert.equal(k.werke, 3)
    assert.deepEqual(k.auswahl, { gewaehlt: 3, vorrat: 28, sichtbar: 3 })
  })

  // ── 2b. DIE WEITERHOEREN-REIHE ────────────────────────────────────────────
  //
  // SIE IST DER EINZIGE WEG, AUF DEM ETWAS WIRKLICH VERSCHWINDEN KOENNTE, statt
  // nur nicht zu erscheinen: Eine gemerkte Stelle ist Bestand des Kindes. Die
  // Regel (server.ts) lautet: die Zeile BLEIBT, sie verliert nur ihren
  // `schluessel` und damit den Weg zur Kachel — nimmt jemand das Album zurueck
  // in die Auswahl, steht sie wieder da. Genau das wird hier nachgemessen; in
  // keinem anderen Lauf steht es.

  it('eine gemerkte Stelle bleibt liegen, wenn das Album aus der Auswahl faellt', async () => {
    await profil('kalea')
    // Ein Werk, das Kalea gerade NICHT gewaehlt hat (ihre Auswahl ist NUR_ONLINE).
    const fremd = SCHLUESSEL.find((s) => !NUR_ONLINE.includes(s) && !s.includes(':t:'))
    assert.ok(fremd, 'ein Werk ausserhalb ihrer Auswahl')
    await request(app)
      .post('/api/weiterhoeren')
      .send({ schluessel: fremd, titelNr: 2, gesamt: 9, bisher: 120, dauer: 900 })
      .expect(200)

    const mit = await request(app).get('/api/weiterhoeren').expect(200)
    const zeile = (mit.body.weiter as { schluessel?: string }[])[0]
    assert.ok(zeile, 'die Zeile steht da — eine gemerkte Stelle wird nicht verschwiegen')
    assert.equal(zeile.schluessel, undefined, 'aber ohne Weg zur Kachel')

    // UND SIE KOMMT ZURUECK. Ein Bestand, der nach dem Zuruecknehmen fehlte,
    // waere endgueltig verschwunden gewesen, ohne dass es jemand sagte.
    await setzen('kalea', [...NUR_ONLINE, fremd as string])
    const zurueck = await request(app).get('/api/weiterhoeren').expect(200)
    assert.equal(
      (zurueck.body.weiter as { schluessel?: string }[]).filter((z) => z.schluessel === fremd).length,
      1,
      'zurueck in der Auswahl, zurueck in der Reihe',
    )
    await setzen('kalea', NUR_ONLINE)
  })

  // ── 3. EIN MEDIUM WIRD GELOESCHT ──────────────────────────────────────────

  it('ein geloeschtes Medium nimmt der Auswahl EINEN Eintrag — nicht ihre Wirkung', async () => {
    await request(app).delete(`/api/medien/${encodeURIComponent(NUR_ONLINE[0])}`).expect(200)
    const k = await sicht('kalea')
    assert.equal(k.werke, 2, 'zwei bleiben sichtbar')
    assert.deepEqual(k.auswahl, { gewaehlt: 3, vorrat: 27, sichtbar: 2 })
    const a = await request(app).get('/api/profil/auswahl?profil=kalea').expect(200)
    assert.equal(a.body.werke.length, 3, 'der Schluessel bleibt stehen')
    assert.equal(a.body.alle, false, 'und die Auswahl kippt nicht auf „alles"')
  })

  // ── 4. DIE VERSCHMOLZENE KACHEL ───────────────────────────────────────────
  //
  // Die Verwaltung zeigt die beiden Haelften eines Paares als ZWEI Zeilen
  // (`/api/medien` markiert sie nur mit derselben `gruppe`, es bleiben zwei
  // Eintraege). Wer nur EINE anhakt, darf die Kachel nicht verlieren — auch
  // dann nicht, wenn er die anhakt, die in verschmelzung.json NICHT die
  // fuehrende ist.

  it('nur die FUEHRENDE Haelfte gewaehlt — die Kachel steht da', async () => {
    await setzen('liam', [PAAR.schluessel])
    const l = await sicht('liam')
    assert.equal(l.verschmolzen, 1)
    assert.deepEqual(l.schluessel, [PAAR.schluessel])
  })

  it('nur die ANDERE Haelfte gewaehlt — die Kachel steht auch da, unter ihrem Namen', async () => {
    await setzen('liam', [PAAR.auch[0]])
    const l = await sicht('liam')
    assert.equal(l.verschmolzen, 1, 'eine Zuordnung, deren Fuehrender fehlt, verschluckt die Kachel nicht')
    assert.deepEqual(l.schluessel, [PAAR.auch[0]])
  })

  // ── 5. DER GAST ───────────────────────────────────────────────────────────

  it('der Gast bekommt ueber die Schnittstelle keine — mit und ohne Angabe', async () => {
    const mit = await request(app).put('/api/profil/auswahl').send({ profil: 'gast', werke: SCHLUESSEL.slice(0, 2) })
    assert.equal(mit.status, 400)
    assert.equal(mit.body.error, 'gastOhneAuswahl')
    await profil('gast')
    const ohneAngabe = await request(app).put('/api/profil/auswahl').send({ werke: SCHLUESSEL.slice(0, 2) })
    assert.equal(ohneAngabe.status, 400, 'auch wenn der Gast gerade dran ist')
  })

  it('und auch nicht ueber eine von Hand gelegte Datei', async () => {
    mkdirSync(join(ordner, 'profile', 'gast'), { recursive: true })
    writeFileSync(auswahlDatei('gast'), JSON.stringify({ werke: [NUR_ONLINE[1]] }))
    const g = await sicht('gast')
    assert.equal(g.data, 27, 'er sieht weiter die ganze (inzwischen um eines kuerzere) Bibliothek')
    const a = await request(app).get('/api/profil/auswahl?profil=gast').expect(200)
    assert.equal(a.body.alle, true)
    assert.equal(a.body.gast, true)
    unlinkSync(auswahlDatei('gast'))
  })

  it('„uebernehmen von …" kann vom Gast nichts Einschraenkendes holen', async () => {
    const vom = await request(app).get('/api/profil/auswahl?profil=gast').expect(200)
    await setzen('liam', vom.body.werke)
    const l = await sicht('liam')
    assert.equal(l.auswahl.gewaehlt, 0, 'eine Uebernahme vom Gast heisst „alles"')
    assert.equal(l.data, 27)
  })

  // ── 6. DER WEG ZURUECK ────────────────────────────────────────────────────

  it('eine Auswahl laesst sich aufheben — keine Einbahnstrasse', async () => {
    // NICHT `NUR_ONLINE[0]`: das Werk ist zwei Aussagen weiter oben geloescht
    // worden. Ein Lauf, der auf einem geloeschten Schluessel steht, prueft die
    // Loeschung noch einmal statt den Weg zurueck.
    await setzen('kalea', [NUR_ONLINE[1]])
    assert.equal((await sicht('kalea')).werke, 1)
    await setzen('kalea', [])
    const zurueck = await sicht('kalea')
    assert.equal(zurueck.data, 27, 'sie sieht wieder alles')
    assert.equal(zurueck.auswahl.gewaehlt, 0)
    assert.deepEqual(
      zurueck.schluessel,
      (await sicht('gast')).schluessel,
      'und zwar dasselbe wie der Gast — Byte fuer Byte dieselbe Sicht',
    )
  })

  it('die aufgehobene Auswahl liegt als LEERE Datei da und wird auch so gelesen', async () => {
    assert.equal(existsSync(auswahlDatei('kalea')), true)
    assert.deepEqual(JSON.parse(readFileSync(auswahlDatei('kalea'), 'utf8')), { werke: [] })
  })

  // ── 7. WAS NACH EINER AENDERUNG DER PROFILLISTE PASSIERT ──────────────────
  //
  // `bereicheHerrichten()` laeuft nach JEDER Aenderung der Liste ueber ALLE
  // Ablagen — seit dem 07.08. auch ueber auswahl.json. Ein Herrichten, das
  // eine bestehende Auswahl anfasst, waere der stillste Fehler von allen: Er
  // traete erst auf, wenn jemand ein Kind anlegt.

  it('ein neues Kind anzulegen laesst die Auswahl der anderen unberuehrt', async () => {
    await setzen('liam', NUR_ONLINE.slice(1))
    await request(app)
      .put('/api/profile')
      .send({
        profile: [
          { kennung: 'kalea', name: 'Kalea', angelegt: 1 },
          { kennung: 'liam', name: 'Liam', angelegt: 2 },
          { kennung: 'mira', name: 'Mira', angelegt: 3 },
        ],
      })
      .expect(200)
    const a = await request(app).get('/api/profil/auswahl?profil=liam').expect(200)
    assert.deepEqual(a.body.werke, NUR_ONLINE.slice(1), 'Liams Auswahl steht unveraendert')
    const m = await request(app).get('/api/profil/auswahl?profil=mira').expect(200)
    assert.equal(m.body.alle, true, 'und Mira faengt bei „alles" an')
  })

  // ── 8. DAS KIND WIRD GELOESCHT ────────────────────────────────────────────

  it('beim Loeschen geht die Auswahl mit dem Bereich', async () => {
    await profil('gast')
    await request(app)
      .put('/api/profile')
      .send({
        profile: [
          { kennung: 'kalea', name: 'Kalea', angelegt: 1 },
          { kennung: 'mira', name: 'Mira', angelegt: 3 },
        ],
      })
      .expect(200)
    assert.equal(existsSync(auswahlDatei('liam')), false, 'die alte Stelle ist frei')
  })

  it('ein neues Kind desselben Namens erbt sie NICHT', async () => {
    await request(app)
      .put('/api/profile')
      .send({
        profile: [
          { kennung: 'kalea', name: 'Kalea', angelegt: 1 },
          { kennung: 'mira', name: 'Mira', angelegt: 3 },
          { kennung: 'liam', name: 'Liam', angelegt: 4 },
        ],
      })
      .expect(200)
    const a = await request(app).get('/api/profil/auswahl?profil=liam').expect(200)
    assert.equal(a.body.alle, true, 'keine geerbte Einschraenkung')
    const l = await sicht('liam')
    assert.equal(l.data, 27, 'das neue Kind sieht die ganze Box')
  })
})
