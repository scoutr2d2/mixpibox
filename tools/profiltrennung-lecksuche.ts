/**
 * LECKSUCHE: sieht ein Kind etwas, das einem anderen gehoert?
 *
 * NICHT NUR /api/werke. Die Frage lautet „ueber IRGENDEINEN Weg", und ein Leck
 * sucht man nicht dort, wo man es vermutet, sondern auf ALLEN Wegen, auf denen
 * die Sache herauskommen kann. Deshalb geht dieser Lauf die Routen durch, die
 * profilgebundene Dinge fuehren KOENNTEN, und legt fuer JEDE fest, was
 * herauskommen darf.
 *
 * DER AUFBAU: zwei Kinder mit unverwechselbarem Bestand — und ein drittes
 * ohne jeden (Nio). Liam hat einen Verlauf, eine eigene Liste und eine
 * gemerkte Stelle; Kalea hat andere; Nio hat nichts. Dann wird umgeschaltet
 * und nachgesehen, was das jeweils andere Kind zu sehen bekommt.
 *
 * WAS DIESER LAUF NICHT PRUEFT, und warum: eine ZUWEISUNG von Medien an ein
 * Kind gibt es nicht — die Bibliothek ist box-weit, so entschieden in
 * [mixpi-die-geschichte] und BACKLOG E18 (Stufe 4 ist nicht gebaut). „Medien,
 * die ihm nicht zugewiesen sind" kann es deshalb heute gar nicht geben. Was es
 * geben kann, ist der Fall daneben: Dinge, die einem ANDEREN Kind gehoeren —
 * sein Verlauf, seine Listen, seine Stellen. Genau die werden hier gezaehlt.
 *
 * DIE GEMERKTEN STELLEN SIND SEIT E18 STUFE 3 GETRENNT (05.08.2026):
 * resume.json liegt je Kind im BEREICH (`profile/<kennung>/resume.json`),
 * und /api/resume wie /api/weiterhoeren lesen ueber
 * `resumeLesePfad(profilAktiv())` — server.ts. Die zwei Laeufe, die hier bis
 * dahin „LECK, GEMESSEN" hiessen, sind seitdem umgeschrieben: sie schreiben
 * die TRENNUNG FEST. Wird einer davon rot, ist die Trennung eingerissen —
 * nicht mehr ein bekannter Zwischenzustand vermessen.
 *
 * Fahren:
 *   NODE_ENV=test npx tsx --test tools/profiltrennung-lecksuche.ts
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'
import { tagesSchluessel } from '../src/backend-api/src/kinderzeit'

/** Zwei Werke, die es wirklich in der Bibliothek gibt — sonst faellt alles heraus. */
const WERK_LIAM = {
  id: 'leck-liam',
  title: 'Liams Hoerspiel',
  artist: 'Pruefung',
  type: 'spotify',
  category: 'audiobook',
}
const WERK_KALEA = {
  id: 'leck-kalea',
  title: 'Kaleas Hoerspiel',
  artist: 'Pruefung',
  type: 'spotify',
  category: 'audiobook',
}

const SCHLUESSEL_LIAM = `${WERK_LIAM.type}:${WERK_LIAM.id}`
const SCHLUESSEL_KALEA = `${WERK_KALEA.type}:${WERK_KALEA.id}`

let app: import('express').Express
let ordner: string

/** Alles, was in einer Antwort steht, als EIN Text — zum Durchsuchen. */
const alsText = (x: unknown) => JSON.stringify(x)

async function aktiv(kennung: string) {
  await request(app).post('/api/profil/aktiv').send({ kennung }).expect(200)
}

describe('Profiltrennung: was sieht das andere Kind?', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-leck-'))
    const medien = [WERK_LIAM, WERK_KALEA]
    writeFileSync(join(ordner, 'data.json'), JSON.stringify(medien, null, 2))
    writeFileSync(join(ordner, 'active_data.json'), JSON.stringify(medien, null, 2))
    writeFileSync(
      join(ordner, 'profile.json'),
      JSON.stringify({
        profile: [
          { kennung: 'gast', name: 'Gast', figur: 'mixpi-hoert.png', angelegt: 1 },
          { kennung: 'liam', name: 'Liam', figur: 'mixpi-hoert.png', angelegt: 2 },
          { kennung: 'kalea', name: 'Kalea', figur: 'mixpi-hoert.png', angelegt: 3 },
          // NIO HAT NIE ETWAS GEHOERT — er ist der Fall „aktives Profil ohne
          // eigenen Bestand", den /api/resume mit 404 beantworten muss.
          { kennung: 'nio', name: 'Nio', figur: 'mixpi-hoert.png', angelegt: 4 },
        ],
        aktiv: 'liam',
      }),
    )

    // JE KIND EIN VERLAUF UND EINE GEMERKTE STELLE — in der Form von E18
    // Stufe 3: alles im Bereich des Kindes, nichts mehr in einer gemeinsamen
    // Datei.
    for (const [k, werk, s] of [
      ['liam', WERK_LIAM, SCHLUESSEL_LIAM],
      ['kalea', WERK_KALEA, SCHLUESSEL_KALEA],
    ] as const) {
      const bereich = join(ordner, 'profile', k)
      mkdirSync(bereich, { recursive: true })
      writeFileSync(
        join(bereich, 'gespielt.json'),
        JSON.stringify([{ key: s, anzahl: 5, zuletzt: Date.now(), title: werk.title }]),
      )
      writeFileSync(
        join(bereich, 'listen.json'),
        JSON.stringify([{ id: `liste-${k}`, name: `Liste von ${k}`, titel: [] }]),
      )
      writeFileSync(
        join(bereich, 'kinderzeit-verbrauch.json'),
        JSON.stringify({ tag: tagesSchluessel(new Date()), sekunden: k === 'liam' ? 60 : 1800, bonusMin: 0 }),
      )
      // DIE FELDNAMEN SIND DIE DER ECHTEN BOX (`resumespotify…`), abgelesen an
      // /home/dietpi/…/config/resume.json. Beim ersten Anlauf standen hier
      // erfundene (`progress`, `tracknr`) — der Lauf war rot, und zwar aus dem
      // falschen Grund: die Stellen waren gar nicht weiterhoerbar, also war
      // auch kein Leck zu sehen. Eine Attrappe, die dem Vertrag nicht folgt,
      // meldet Dichtheit, wo keine ist.
      writeFileSync(
        join(bereich, 'resume.json'),
        JSON.stringify([
          {
            ...werk,
            category: 'resume',
            resumespotifytrack_number: 3,
            resumespotifyprogress_ms: 60000,
            resumespotifyduration_ms: 200000,
            resumeGesamtTitel: 12,
          },
        ]),
      )
    }

    // DIE BOX-WEITE resume.json VON FRUEHER — absichtlich dabei. Seit E18
    // Stufe 3 liegt der Bestand je Kind im Bereich; was hier noch liegt, ist
    // die ERBSCHAFT von vor dem Umzug. Der Server holt sie beim Start in den
    // Bereich des GASTES (`bereichUebernehmen` in server.ts): ohne Profilwahl
    // gehoerte alles allen, die an der Box stehen — und das ist der Gast.
    // KEIN KIND darf sie erben; genau das steht unten als Messung.
    writeFileSync(
      join(ordner, 'resume.json'),
      JSON.stringify([
        {
          ...WERK_LIAM,
          category: 'resume',
          resumespotifytrack_number: 3,
          resumespotifyprogress_ms: 60000,
          resumespotifyduration_ms: 200000,
          resumeGesamtTitel: 12,
        },
        {
          ...WERK_KALEA,
          category: 'resume',
          resumespotifytrack_number: 3,
          resumespotifyprogress_ms: 60000,
          resumespotifyduration_ms: 200000,
          resumeGesamtTitel: 12,
        },
      ]),
    )

    process.env.MUPIBOX_CONFIG_DIR = ordner
    const modul = await import('../src/backend-api/src/server.js')
    app = modul.app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
  })

  it('DICHT: der Verlauf — Liam sieht nur seinen', async () => {
    await aktiv('liam')
    const r = await request(app).get('/api/gespielt?max=50').expect(200)
    assert.equal(r.body.profil, 'liam')
    assert.equal(alsText(r.body).includes(SCHLUESSEL_KALEA), false, 'Kaleas Verlauf ist bei Liam sichtbar')
  })

  it('DICHT: die eigenen Listen — Liam sieht nur seine', async () => {
    await aktiv('liam')
    const r = await request(app).get('/api/listen').expect(200)
    assert.equal(r.body.profil, 'liam')
    assert.deepEqual(
      r.body.listen.map((l: { name: string }) => l.name),
      ['Liste von liam'],
    )
  })

  it('DICHT: der Kinderzeit-Stand — Liams Guthaben ist Liams', async () => {
    await aktiv('liam')
    const r = await request(app).get('/api/kinderzeit/stand').expect(200)
    assert.equal(r.body.profil, 'liam')
    assert.equal(r.body.verbrauchtMin, 1, 'Kaleas 30 Minuten duerfen Liam nicht belasten')
  })

  it('BOX-WEIT UND SO GEWOLLT: die Bibliothek zeigt beiden alles', async () => {
    // KEIN LECK, sondern die Entscheidung aus [mixpi-die-geschichte]: data.json
    // gehoert der BOX. Hier steht sie als MESSUNG, nicht als Vorwurf — damit
    // ein Naechster nicht glaubt, hier sei eine Trennung gebaut, die es nicht
    // gibt.
    for (const k of ['liam', 'kalea']) {
      await aktiv(k)
      const r = await request(app).get('/api/werke').expect(200)
      const titel = alsText(r.body)
      assert.equal(titel.includes(WERK_LIAM.title), true, k)
      assert.equal(titel.includes(WERK_KALEA.title), true, k)
    }
  })

  it('TRENNUNG, FESTGESCHRIEBEN: „Weiterhoeren" zeigt Liam nur SEINE Stellen', async () => {
    // HIER STAND EIN GEMESSENES LECK. Bis E18 Stufe 3 war resume.json
    // box-weit, `weiterhoerbare()` nahm JEDE Stelle auf, und der Verlauf des
    // aktiven Profils bestimmte nur die REIHENFOLGE — Kaleas Stelle stand bei
    // Liam hinten in der Reihe, aber sie stand da, mit Titel, Bild und
    // Fortsetzen-Knopf. Der Vorgaenger dieses Tests trug den Satz „WENN DAS
    // HIER ROT WIRD, IST STUFE 3 GEBAUT" — er wurde rot, und seither steht
    // hier die Trennung: /api/weiterhoeren liest
    // `resumeStellenLesen(profilAktiv())`, also `profile/<kennung>/resume.json`.
    //
    // DIE TRENNUNG ENTSTEHT OHNE SIEB: `weiterhoerbare()` siebt weiterhin
    // nicht nach Besitzer, und soll es auch nicht (server.ts, „HIER ENTSTEHT
    // DIE TRENNUNG") — es liegt je Kind schlicht nur das Richtige in der
    // Datei. Taucht Kaleas Stelle hier doch auf, liest jemand wieder eine
    // gemeinsame Datei.
    await aktiv('liam')
    const r = await request(app).get('/api/weiterhoeren?max=20').expect(200)
    const keys = r.body.weiter.map((z: { key: string }) => z.key)
    assert.ok(keys.includes(SCHLUESSEL_LIAM), 'seine eigene Stelle muss da sein')
    assert.equal(
      keys.includes(SCHLUESSEL_KALEA),
      false,
      'Kaleas Stelle steht bei Liam in der Reihe — die Trennung ist eingerissen',
    )
  })

  it('TRENNUNG, FESTGESCHRIEBEN: /api/resume liefert den Bestand des AKTIVEN Profils — oder 404', async () => {
    // Die ROHEN Stellen, wie die klassische Oberflaeche sie liest. Kein
    // `?profil=` — die Route hat genau EINEN Aufrufer (medialist.page.ts, auf
    // der Box), und der meint immer das Kind, das gerade dran ist. Seit E18
    // Stufe 3 liest sie `resumeLesePfad(profilAktiv())`.
    await aktiv('liam')
    const liam = await request(app).get('/api/resume').expect(200)
    assert.equal(alsText(liam.body).includes(WERK_LIAM.title), true, 'der eigene Bestand muss kommen')
    assert.equal(
      alsText(liam.body).includes(WERK_KALEA.title),
      false,
      'Kaleas Stelle in Liams Antwort — die Trennung ist eingerissen',
    )

    await aktiv('kalea')
    const kalea = await request(app).get('/api/resume').expect(200)
    assert.equal(alsText(kalea.body).includes(WERK_KALEA.title), true)
    assert.equal(alsText(kalea.body).includes(WERK_LIAM.title), false)

    // EIN PROFIL OHNE EIGENEN BESTAND BEKOMMT 404 — nicht den Bestand eines
    // anderen. Das ist derselbe Vertrag wie vor dem Umzug („File Not Found",
    // wenn die Datei fehlt), nur zeigt der Pfad jetzt in den Bereich des
    // aktiven Kindes. Ein 200 hiesse hier, dass ein Rueckfall auf eine fremde
    // Datei greift.
    await aktiv('nio')
    await request(app).get('/api/resume').expect(404)

    // /api/activeresume liest active_resume.json — die legt auf der Box
    // check_network.sh als Verweiskette auf den Bereich des AKTIVEN Kindes
    // (active_resume.json -> resume.json -> profile/<aktiv>/…, siehe
    // resumeBrueckeRichten in server.ts). Ohne die root-Skripte gibt es die
    // Datei in diesem Lauf nicht, und die Route antwortet mit leerer Liste
    // statt zu haengen — jedenfalls nie mit fremdem Bestand.
    const aktivRes = await request(app).get('/api/activeresume').expect(200)
    assert.deepEqual(aktivRes.body, [])
  })

  it('DIE ERBSCHAFT GEHT AN DEN GAST: die box-weite resume.json von frueher', async () => {
    // Vor dem Umzug gehoerte die eine Datei allen, die an der Box stehen —
    // und „alle an der Box" ist der GAST. `bereichUebernehmen` holt sie beim
    // Start deshalb in DESSEN Bereich, nicht in den des ersten Kindes: das
    // erste angelegte Kind erbte sonst die Stellen der ganzen Box (dieselbe
    // Entscheidung wie bei gespielt.json, profile.ts). Dass bei Liam und
    // Kalea nichts davon ankommt, steht schon oben.
    await aktiv('gast')
    const r = await request(app).get('/api/resume').expect(200)
    assert.equal(alsText(r.body).includes(WERK_LIAM.title), true, 'die alte box-weite Datei liegt beim Gast')
    assert.equal(alsText(r.body).includes(WERK_KALEA.title), true)
  })

  it('DER BESITZER KOMMT NICHT VOM CLIENT: eine Meldung landet beim AKTIVEN Profil', async () => {
    // Duerfte die Meldung ihn mitbringen, schriebe eine Oberflaeche in den
    // falschen Topf. Hier wird es gegengeprobt: die Meldung BEHAUPTET Kalea.
    await aktiv('liam')
    const r = await request(app)
      .post('/api/gespielt')
      .send({ key: SCHLUESSEL_KALEA, title: 'untergeschoben', profil: 'kalea', kennung: 'kalea' })
      .expect(200)
    assert.equal(r.body.profil, 'liam', 'die Behauptung des Clients hat gewonnen')

    const kalea = await request(app).get('/api/gespielt?max=50&profil=kalea').expect(200)
    assert.equal(
      kalea.body.zuletzt.find((e: { title: string }) => e.title === 'untergeschoben'),
      undefined,
      'in Kaleas Verlauf gelandet, obwohl Liam dran war',
    )
  })

  it('LESEN MIT `?profil=` GEHT FUER JEDEN, DER DIE BOX ERREICHT — gemessen, nicht behauptet', async () => {
    // `/api/gespielt?profil=` und `/api/kinderzeit/stand?profil=` sind fuer die
    // VERWALTUNG gedacht. Sie liegen aber am selben Ursprung wie die Oberflaeche
    // der Box und haben keine eigene Sperre: wer die Adresse tippen kann, liest
    // den Verlauf jedes Kindes.
    //
    // OB DAS SCHLIMM IST, ENTSCHEIDET DER BETREIBER — an einer Box im
    // Wohnzimmer ist es womoeglich egal, und eine Sperre auf dem Lesen waere
    // die Art Sicherheit, die vor allem den Eltern im Weg steht. Gemessen wird
    // es trotzdem, damit die Entscheidung eine ist und keine Annahme.
    await aktiv('liam')
    const r = await request(app).get('/api/gespielt?max=50&profil=kalea').expect(200)
    assert.equal(r.body.profil, 'kalea')
    assert.equal(alsText(r.body).includes(SCHLUESSEL_KALEA), true)
  })

  it('SCHREIBEN mit `?profil=` gibt es NICHT — auch nicht ueber Umwege', async () => {
    // Die Gegenprobe zur Zeile darueber: Lesen quer ist moeglich, SCHREIBEN
    // quer darf es nicht sein. Sonst koennte eine Oberflaeche das Guthaben
    // eines anderen Kindes leeren.
    await aktiv('liam')
    const vorher = await request(app).get('/api/kinderzeit/stand?profil=kalea').expect(200)
    await request(app).post('/api/listen').send({ name: 'quer geschrieben', profil: 'kalea' }).expect(200)
    const kalea = await request(app).get('/api/gespielt?max=50&profil=kalea').expect(200)
    assert.equal(kalea.body.profil, 'kalea')
    // Die Liste muss bei LIAM gelandet sein.
    await aktiv('liam')
    const liam = await request(app).get('/api/listen').expect(200)
    assert.ok(
      liam.body.listen.some((l: { name: string }) => l.name === 'quer geschrieben'),
      'die Liste ist nicht beim schreibenden Profil gelandet',
    )
    await aktiv('kalea')
    const kaleaListen = await request(app).get('/api/listen').expect(200)
    assert.equal(
      kaleaListen.body.listen.some((l: { name: string }) => l.name === 'quer geschrieben'),
      false,
      'quer geschrieben — das waere der schlimmste Fall',
    )
    assert.equal(vorher.body.profil, 'kalea')
  })
})
