/**
 * DAS ABSPIELEN NACH DER VERSCHMELZUNG — folgt es der BEVORZUGUNG?
 *
 * Die Verschmelzung selbst (welche Kacheln zusammenfallen) prueft
 * verschmelzung.integration.spec.ts. Hier geht es um die zweite Haelfte der
 * Frage „ist die play logic schon implementiert?": Was passiert, wenn jemand
 * die eine Kachel antippt, und was passiert mit dem, was sich die Box GEMERKT
 * hat.
 *
 * DER FALL, DER ALLES ENTSCHEIDET, ist der, in dem Identitaet und Bevorzugung
 * AUSEINANDERFALLEN. Auf der Box (gemessen 2026-08-03) heisst er „Das
 * Lumpenpack — Die Zukunft wird groß": Der Katalog fuehrt den SPOTIFY-Eintrag
 * vorn, also traegt die Kachel dessen Schluessel — daran haengen Verlauf,
 * Weiterhoeren, Favoriten und das Bild. GESPIELT wird aber ueber JELLYFIN
 * (lokal -> jellyfin -> spotify). Zwei Dinge fallen damit auseinander, die
 * vorher immer eins waren, und beide haben hier ihren Test:
 *
 *   1. DIE KACHEL EINES GESCHLUCKTEN SCHLUESSELS. Eine gemerkte Stelle steht
 *      unter dem Schluessel, unter dem gehoert wurde. Wird der geschluckt,
 *      zeigt die Weiterhoeren-Zeile auf ein Werk, das `/api/werke` nicht mehr
 *      kennt — die Kachel ist da, der Tipp meldet „Das gibt es nicht mehr in
 *      der Bibliothek". Dagegen `identitaetsKarte` (verschmelzung.ts).
 *   2. DIE EINHEIT. Spotify merkt sich MILLISEKUNDEN, mpv will PROZENT
 *      ([resume-lokal-ist-prozent-nicht-sekunden]). Ein durchgereichtes
 *      `seekpos:92500` ist fuer mpv „ganz ans Ende". Dagegen `fortsetzenMit`
 *      (weiterhoeren.ts).
 *
 * EIGENE DATEI UND EIGENES VERZEICHNIS, weil die andere Spec eine ABFOLGE ist
 * (abgleichen, trennen, zuruecksetzen) und ihre Reihenfolge traegt. Ein
 * resume.json dazwischenzuschieben hiesse, an ihr mitzuschreiben.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'
import { medienSchluessel } from './medien.js'

/** Der Jellyfin-Eintrag steht HINTEN — der Spotify-Eintrag fuehrt also. */
const LUMPEN_SP = {
  id: '0PyuOAMz1lv0z737JcQNOg',
  title: 'Die Zukunft wird gross',
  artist: 'Das Lumpenpack',
  type: 'spotify',
  category: 'music',
}
const LUMPEN_JF = {
  id: 'e131865d504a657a93533722fc88bc90',
  title: 'Die Zukunft wird gross',
  artist: 'Das Lumpenpack',
  type: 'jellyfin-album',
  category: 'music',
}
/** Und umgekehrt: hier fuehrt Jellyfin, der geschluckte ist Spotify. */
const HAMM_JF = {
  id: '7d9a37e2732ca78bc68eacb3232960c0',
  title: 'HAMM',
  artist: 'Kapelle Petra',
  type: 'jellyfin-album',
  category: 'music',
}
const HAMM_SP = {
  id: '0l0nQidfDmC4SiTdrpHr4v',
  title: 'HAMM',
  artist: 'Kapelle Petra',
  type: 'spotify',
  category: 'music',
}

const KATALOG = [LUMPEN_SP, LUMPEN_JF, HAMM_JF, HAMM_SP]

/**
 * Zwei gemerkte Stellen, beide ueber SPOTIFY entstanden.
 *
 * DAS IST KEINE WAHL, SONDERN DER EINZIGE FALL, DEN ES GIBT:
 * `istWeiterhoerbar` laesst Jellyfin gar nicht in die Reihe („eine Kachel, die
 * ‚weiter' verspricht und von vorn anfaengt, ist schlimmer als keine"). Eine
 * gemerkte Stelle zu einem Jellyfin-Album kann es also nicht geben — wohl aber
 * eine ueber Spotify gemerkte zu einem Album, das jetzt ueber Jellyfin spielt.
 *
 * 92,5 s von 240 s sind 38,5 %. Beide Zahlen stehen in resume.json, der Anteil
 * ist also gerechnet und nicht geschaetzt.
 */
const STELLEN = [
  {
    ...LUMPEN_SP,
    category: 'resume',
    resumespotifytrack_number: 4,
    resumespotifyprogress_ms: 92_500,
    resumespotifyduration_ms: 240_000,
  },
  {
    ...HAMM_SP,
    category: 'resume',
    resumespotifytrack_number: 2,
    resumespotifyprogress_ms: 60_000,
    resumespotifyduration_ms: 200_000,
  },
]

interface Zeile {
  key: string
  schluessel?: string
  quelle?: string
  titelNr: number
  positionMs: number | null
  positionProzent: number | null
}

let app: import('express').Express
let verzeichnis = ''

const zeilen = async (abfrage: string): Promise<Zeile[]> =>
  (await request(app).get(`/api/weiterhoeren?max=20${abfrage}`).expect(200)).body.weiter

describe('Abspielen und Weiterhoeren nach der Verschmelzung', () => {
  before(async () => {
    verzeichnis = mkdtempSync(join(tmpdir(), 'mupi-verschmelzung-spielen-'))
    writeFileSync(join(verzeichnis, 'data.json'), JSON.stringify(KATALOG, null, 2))
    writeFileSync(join(verzeichnis, 'active_data.json'), JSON.stringify(KATALOG, null, 2))
    writeFileSync(join(verzeichnis, 'resume.json'), JSON.stringify(STELLEN, null, 2))
    process.env.MUPIBOX_CONFIG_DIR = verzeichnis
    // Eigene Sperrdatei je Lauf — `node --test` startet die Spec-Dateien
    // parallel, und die gemeinsame /tmp-Sperre sperrte sonst die anderen mit.
    process.env.MUPIBOX_LOCK_DIR = verzeichnis
    app = (await import('./server.js')).app
    await request(app).post('/api/verschmelzung/abgleichen').expect(200)
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
    process.env.MUPIBOX_LOCK_DIR = undefined
  })

  it('legt beide Paare zusammen — Jellyfin spielt, der Katalog bestimmt den Namen', async () => {
    const r = await request(app).get('/api/werke?verschmelzen=1').expect(200)
    assert.equal(r.body.werke.length, 2)
    const lumpen = r.body.werke.find((w: { titel: string }) => w.titel === 'Die Zukunft wird gross')
    // DIE ZWEI ZEILEN, UM DIE ES GEHT: Identitaet Spotify, gespielt Jellyfin.
    assert.equal(lumpen.schluessel, medienSchluessel(LUMPEN_SP))
    assert.equal(lumpen.quellen[0].dienst, 'jellyfin')
  })

  it('MIT `verschmelzen=0` bleibt die Weiterhoeren-Zeile, wie sie war — der Rueckweg', async () => {
    // ══ DER RUECKWEG HAT SEIT DEM 06.09.2026 EINEN ANDEREN GRIFF ═══════════
    //
    // Dieser Zeuge hiess „OHNE Schalter" und rief `zeilen('')`. Das war
    // richtig, solange „nicht mitgeschickt" gleichbedeutend mit „aus" war. An
    // jenem Tag hat der Betreiber die Vorgabe umgedreht („ich würde default
    // immer verschmolzen machen da wir ja auch so intern arbeiten");
    // `verschmelzenAusDarstellung()` prueft seither `!== false`, ein
    // fehlender Schluessel bekommt also das Hausverhalten.
    //
    // Seither mass dieser Test nicht mehr den Rueckweg, sondern die Vorgabe —
    // und war rot. DIE ZUSAGE SELBST GILT WEITER und ist es wert, geprueft zu
    // werden: wer ausdruecklich abschaltet, bekommt Byte fuer Byte das alte
    // Verhalten. Nur der Griff dafuer heisst jetzt `verschmelzen=0` statt
    // „gar nichts mitschicken".
    const w = await zeilen('&verschmelzen=0')
    const hamm = w.find((z) => z.key.includes(HAMM_SP.id))
    // Der SPOTIFY-Schluessel, Millisekunden, kein `quelle`. Byte fuer Byte wie
    // vor der Verschmelzung.
    assert.equal(hamm?.schluessel, medienSchluessel(HAMM_SP))
    assert.equal(hamm?.positionMs, 60_000)
    assert.equal(hamm?.positionProzent, null)
    assert.equal(hamm?.quelle, undefined)
  })

  it('findet die gemerkte Stelle eines GESCHLUCKTEN Schluessels wieder', async () => {
    // „HAMM" fuehrt der Jellyfin-Eintrag; gemerkt wurde unter dem von Spotify.
    // Ohne die Bruecke zeigte diese Zeile auf ein Werk, das es in /api/werke
    // nicht mehr gibt — die Kachel stuende da und fuehrte auf nichts.
    const w = await zeilen('&verschmelzen=1')
    const hamm = w.find((z) => z.key.includes(HAMM_SP.id))
    assert.equal(hamm?.schluessel, medienSchluessel(HAMM_JF))
  })

  it('laesst den FUEHRENDEN Schluessel unangetastet — er ist die Identitaet', async () => {
    // „Das Lumpenpack" fuehrt Spotify. Der Schluessel darf sich NICHT aendern,
    // sonst verloere die Box Verlauf, Favoriten und Bild in dem Moment, in dem
    // jemand ein Album zusaetzlich in Jellyfin ablegt.
    const w = await zeilen('&verschmelzen=1')
    const lumpen = w.find((z) => z.key.includes(LUMPEN_SP.id))
    assert.equal(lumpen?.schluessel, medienSchluessel(LUMPEN_SP))
  })

  it('rechnet die Stelle in die EINHEIT der Maschine um, die gleich spielt', async () => {
    const w = await zeilen('&verschmelzen=1')
    const lumpen = w.find((z) => z.key.includes(LUMPEN_SP.id))
    // Gespielt wird ueber Jellyfin, also mpv, also PROZENT. 92500/240000 = 38,5 %.
    assert.equal(lumpen?.quelle, 'jellyfin')
    assert.equal(lumpen?.positionProzent, 38.5)
    // UND KEINE MILLISEKUNDEN MEHR. `seekpos:92500` waere fuer mpv „ganz ans
    // Ende" — das Kind bekaeme den naechsten Titel statt seiner Stelle.
    assert.equal(lumpen?.positionMs, null)
  })

  it('laesst die Titelnummer in Ruhe — sie zaehlt in beiden Welten dasselbe', async () => {
    const w = await zeilen('&verschmelzen=1')
    assert.equal(w.find((z) => z.key.includes(LUMPEN_SP.id))?.titelNr, 4)
    assert.equal(w.find((z) => z.key.includes(HAMM_SP.id))?.titelNr, 2)
  })

  it('gibt fuer eine Quelle, die dieses Werk gar nicht fuehrt, 404 statt der fuehrenden', async () => {
    // `quelle=` ist das AUSWEICHEN der Oberflaeche. Bekaeme sie darauf still
    // den fuehrenden Eintrag, quittierte der Server ein Ausweichen, das nie
    // stattgefunden hat — und die Oberflaeche haengte denselben Titel zweimal
    // an, einmal je „Quelle".
    await request(app)
      .get(`/api/werke/${encodeURIComponent(medienSchluessel(LUMPEN_SP))}/inhalt?verschmelzen=1&quelle=lokal`)
      .expect(404)
  })

  it('kennt mit `verschmelzen=0` gar keine zweite Quelle', async () => {
    // AUS ist wirklich aus: Der Abfrageteil `quelle=` wird dann nicht einmal
    // angesehen, und es antwortet der Eintrag zum Schluessel wie eh und je.
    // (Spotify ist hier nicht erreichbar — 502 heisst „der Dienst war es",
    // also ist der Eintrag gefunden worden.)
    //
    // AUSDRUECKLICH `verschmelzen=0`, nicht mehr „Schalter weglassen": seit
    // dem 06.09.2026 ist die Vorgabe AN, und ein fehlender Schalter heisst
    // nicht mehr „aus" (siehe den Zeugen zum Rueckweg weiter oben). Der Test
    // mass seither die Vorgabe statt der Abschaltung und war rot.
    await request(app)
      .get(`/api/werke/${encodeURIComponent(medienSchluessel(LUMPEN_SP))}/inhalt?verschmelzen=0&quelle=lokal`)
      .expect(502)
  })
})
