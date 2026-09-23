/**
 * WAS EIN NEUES KIND VORFINDET, DAS SO HEISST WIE EIN GELOESCHTES.
 *
 * ══ DIE FRAGE, UM DIE ES GEHT ══════════════════════════════════════════════
 *
 * Seit dem 07.08.2026 koennen die Eltern ein Kind LOESCHEN (Admin-Menue ·
 * System · Kinder). Der Server legt dabei den Ordner des Kindes beiseite
 * (`bereichBeiseite`), und die Begruendung dort lautet:
 *
 *   „Die Kennung wird aus dem NAMEN gebaut, also bekommt das zweite Kind
 *    namens Liam dieselbe. Es faende dann das Weiterhoeren, die Hoerzeit und
 *    die Listen eines fremden Kindes vor, ohne dass irgendwo etwas dazu
 *    dastuende."
 *
 * DER SATZ IST RICHTIG, UND DER ORDNER WAR NUR DIE HAELFTE. Der Server haelt
 * denselben Bestand ausserdem IM ARBEITSSPEICHER, unter genau derselben
 * Kennung, und schreibt ihn von dort aus zurueck:
 *
 *   `kzKonten`       die verbrauchte Hoerzeit von heute. Wird beim
 *                    Herunterfahren fuer JEDEN Eintrag gesichert
 *                    (`kzVerbrauchSichern(true)`) — ueber `bereichSchreibPfad`,
 *                    das den Ordner dabei NEU ANLEGT.
 *   `gespieltStaende` der Verlauf. `gespieltFuer(kennung)` liest die Platte nur
 *                    beim ERSTEN Mal; danach gilt die Karte.
 *
 * Ein Ordner, der beiseitegelegt und aus dem Speicher heraus wieder aufgebaut
 * wird, ist kein beiseitegelegter Ordner. Und das faellt niemandem auf: Die
 * Box startet, das neue Kind heisst richtig, es hat bloss schon „gehoert".
 *
 * DIE REGELN SIND DIE DRITTE STELLE — und sie liegen nicht im Bereich des
 * Kindes, sondern in `kinderzeit.json` unter `je.<kennung>`. Ein neues Kind
 * mit derselben Kennung erbt sonst die Zeitgrenzen des geloeschten, also eine
 * Einstellung, die sein Verhalten SOFORT aendert.
 *
 * GEPRUEFT WIRD DAS ERGEBNIS UND NICHT DER WEG: „Was sagt die Box ueber das
 * neue Kind?" — nicht „welche Karte wurde geleert?".
 *
 * EIGENER LAUF, EIGENES VERZEICHNIS: server.ts richtet die Bereiche EINMAL
 * beim Laden des Moduls her; `node --test` gibt jeder Testdatei einen eigenen
 * Prozess.
 */
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

const EINTRAG = {
  id: 'test-erbschaft-1',
  title: 'Was Liam der Erste gehoert hat',
  artist: 'Pruefung',
  type: 'spotify',
  category: 'audiobook',
}

let app: import('express').Express
let ordner: string
const bereich = (kennung: string, datei: string) => join(ordner, 'profile', kennung, datei)

/** Die Liste so schreiben, wie es die Seite „Kinder" tut: ohne `figur`. */
const liste = (...kennungen: string[]) => kennungen.map((k) => ({ kennung: k, name: k, angelegt: 1 }))

describe('Ein neues Kind erbt nichts vom geloeschten gleichen Namens', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-erbschaft-'))
    writeFileSync(join(ordner, 'active_data.json'), JSON.stringify([EINTRAG], null, 2))
    writeFileSync(join(ordner, 'data.json'), JSON.stringify([EINTRAG], null, 2))
    writeFileSync(
      join(ordner, 'profile.json'),
      JSON.stringify({
        profile: [
          { kennung: 'gast', name: 'Gast', figur: '', angelegt: 1 },
          { kennung: 'liam', name: 'Liam', figur: '', angelegt: 2 },
        ],
        aktiv: 'liam',
      }),
    )
    // DER BESTAND VON LIAM DEM ERSTEN, an der Stelle, an der er heute liegt.
    mkdirSync(join(ordner, 'profile', 'liam'), { recursive: true })
    writeFileSync(
      bereich('liam', 'gespielt.json'),
      JSON.stringify([{ key: `${EINTRAG.type}:${EINTRAG.id}`, anzahl: 7, zuletzt: Date.now(), title: EINTRAG.title }]),
    )
    process.env.MUPIBOX_CONFIG_DIR = ordner
    const modul = await import('./server.js')
    app = modul.app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
  })

  it('Liam der Erste hoert etwas, bekommt eine eigene Regel und verbraucht Zeit', async () => {
    // DER VERLAUF WIRD GELESEN UND NICHT GEMELDET, und das ist Absicht: Nur
    // ein LESEN fuellt `gespieltStaende` aus der Platte — und genau diese
    // Karte ist es, die den Loeschvorgang ueberlebt. Ein `POST /api/gespielt`
    // pruefte nebenbei die Schluesselbildung; hier geht es um das Erben.
    await request(app).get('/api/gespielt?max=50').expect(200)
    // Eine eigene Zeitgrenze — der Weg der Verwaltung (`?profil=`).
    await request(app)
      .put('/api/kinderzeit?profil=liam')
      .send({ aktiv: true, nachsichtMin: 0, tage: { mo: { frei: true, ab: '', bis: '', minuten: 5 } } })
      .expect(200)
    // Und Zeit auf dem Konto — ueber den Bonus, weil er `kzKonto` anlegt und
    // gleich sichert; „warten, bis der Takt zaehlt" waere ein Test mit Uhr.
    await request(app).post('/api/kinderzeit/bonus?profil=liam').send({ minuten: 30 }).expect(200)

    const g = await request(app).get('/api/gespielt?max=50').expect(200)
    assert.equal(g.body.profil, 'liam')
    assert.ok(
      g.body.haeufigste.some((e: { key: string }) => e.key === `${EINTRAG.type}:${EINTRAG.id}`),
      'sein Verlauf steht da',
    )
    const s = await request(app).get('/api/kinderzeit/stand?profil=liam').expect(200)
    assert.equal(s.body.bonusMin, 30, 'und sein Konto traegt die geschenkten Minuten')
    assert.equal(existsSync(bereich('liam', 'gespielt.json')), true, 'sein Ordner ist gefuellt')
  })

  it('die Eltern loeschen ihn — erst auf den Gast, dann weg', async () => {
    await request(app).post('/api/profil/aktiv').send({ kennung: 'gast' }).expect(200)
    await request(app)
      .put('/api/profile')
      .send({ profile: liste() })
      .expect(200)
    assert.equal(existsSync(join(ordner, 'profile', 'liam')), false, 'die alte Stelle ist frei')
  })

  it('ein neues Kind heisst wieder Liam — und findet KEINEN fremden Verlauf vor', async () => {
    await request(app)
      .put('/api/profile')
      .send({ profile: liste('liam') })
      .expect(200)
    await request(app).post('/api/profil/aktiv').send({ kennung: 'liam' }).expect(200)

    const g = await request(app).get('/api/gespielt?max=50').expect(200)
    assert.equal(g.body.profil, 'liam')
    assert.deepEqual(
      g.body.haeufigste.filter((e: { key: string }) => e.key === `${EINTRAG.type}:${EINTRAG.id}`),
      [],
      'was Liam der Erste gehoert hat, gehoert nicht dem Zweiten',
    )
  })

  it('… und KEINE fremde Hoerzeit', async () => {
    const s = await request(app).get('/api/kinderzeit/stand?profil=liam').expect(200)
    assert.equal(s.body.bonusMin, 0, 'die geschenkten Minuten des Ersten sind nicht seine')
    assert.equal(s.body.verbrauchtMin, 0, 'und seine verbrauchte Zeit auch nicht')
  })

  it('… und KEINE fremde Zeitgrenze — die liegt nicht einmal in seinem Ordner', async () => {
    // `kinderzeit.json` fuehrt die Regeln je Kennung (`je.<kennung>`), also
    // AUSSERHALB des Bereichs, den `bereichBeiseite` beiseitelegt. Eine geerbte
    // Regel ist die schaerfste der drei Erbschaften: sie aendert das Verhalten
    // der Box sofort und ohne dass jemand sie eingestellt haette.
    const r = await request(app).get('/api/kinderzeit?profil=liam').expect(200)
    const haus = await request(app).get('/api/kinderzeit').expect(200)
    assert.deepEqual(r.body, haus.body, 'das neue Kind hoert nach der Hausregel')
    const datei = JSON.parse(readFileSync(join(ordner, 'kinderzeit.json'), 'utf8'))
    assert.equal(
      Object.hasOwn(datei.je ?? {}, 'liam'),
      false,
      'und in kinderzeit.json steht keine Regel mehr auf die alte Kennung',
    )
  })

  it('ein Neustart baut den beiseitegelegten Ordner nicht wieder auf', async () => {
    // `kzVerbrauchSichern(true)` laeuft beim Herunterfahren fuer JEDEN Eintrag
    // der Karte, auch fuer die ungespeicherten — und `bereichSchreibPfad` legt
    // den Ordner dabei an. Ein Eintrag, der ein geloeschtes Kind meint, baut
    // also genau den Ordner wieder auf, der eben beiseitegelegt wurde.
    // HIER wird die Wirkung geprueft, nicht die Karte: nach dem Loeschen von
    // Kalea darf sich ihr Ordner durch nichts wieder fuellen.
    await request(app)
      .put('/api/profile')
      .send({ profile: liste('liam', 'kalea') })
      .expect(200)
    await request(app).post('/api/kinderzeit/bonus?profil=kalea').send({ minuten: 12 }).expect(200)
    assert.equal(existsSync(bereich('kalea', 'kinderzeit-verbrauch.json')), true, 'ihr Konto liegt auf der Platte')

    await request(app)
      .put('/api/profile')
      .send({ profile: liste('liam') })
      .expect(200)
    assert.equal(existsSync(join(ordner, 'profile', 'kalea')), false, 'beiseitegelegt')

    // Etwas, das die Sicherung ausloest — sie laeuft ueber ALLE Eintraege.
    await request(app).post('/api/kinderzeit/bonus?profil=liam').send({ minuten: 1 }).expect(200)
    assert.equal(
      existsSync(join(ordner, 'profile', 'kalea')),
      false,
      'und ihr Ordner ist nicht aus dem Arbeitsspeicher wieder aufgetaucht',
    )
  })

  it('misslingt das Speichern, ist WIRKLICH nichts geloescht', async (t) => {
    // ══ WARUM DAS EINEN TEST BRAUCHT ══════════════════════════════════════
    // Die Seite „Kinder" sagt bei einem Fehlschlag ausdruecklich: „Die Box hat
    // es nicht angenommen. Es ist nichts gelöscht." Dieser Satz muss stimmen.
    // Solange beiseitegelegt und vergessen wurde, BEVOR profile.json geschrieben
    // war, stimmte er nicht: der Ordner lag beiseite, die Regel war aus
    // kinderzeit.json entfernt — und profile.json fuehrte das Kind weiter.
    //
    // ALS ROOT GEHT DAS NICHT ZU PRUEFEN: ein schreibgeschuetztes Verzeichnis
    // haelt root nicht auf. Dann steht hier lieber ein uebersprungener Test als
    // ein gruener, der nichts gemessen hat.
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      return t.skip('als root laesst sich kein Schreibfehler erzwingen')
    }
    await request(app)
      .put('/api/profile')
      .send({ profile: liste('liam', 'nele') })
      .expect(200)
    await request(app)
      .put('/api/kinderzeit?profil=nele')
      .send({ aktiv: true, nachsichtMin: 0, tage: { mo: { frei: true, ab: '', bis: '', minuten: 7 } } })
      .expect(200)
    assert.equal(existsSync(join(ordner, 'profile', 'nele')), true, 'ihr Ordner steht')

    // Das Verzeichnis dichtmachen: `kzSchreiben` legt eine Zwischendatei
    // DANEBEN an, und genau das geht dann nicht mehr.
    chmodSync(ordner, 0o555)
    try {
      await request(app)
        .put('/api/profile')
        .send({ profile: liste('liam') })
        .expect(500)
    } finally {
      chmodSync(ordner, 0o755)
    }

    assert.equal(existsSync(join(ordner, 'profile', 'nele')), true, 'ihr Ordner liegt noch, wo er lag')
    const datei = JSON.parse(readFileSync(join(ordner, 'kinderzeit.json'), 'utf8'))
    assert.equal(Object.hasOwn(datei.je ?? {}, 'nele'), true, 'und ihre Zeitgrenze steht noch in kinderzeit.json')
    const r = await request(app).get('/api/profile').expect(200)
    assert.equal(
      r.body.profile.some((p: { kennung: string }) => p.kennung === 'nele'),
      true,
      'und die Box kennt sie weiter — auch im Arbeitsspeicher, nicht nur auf der Platte',
    )
  })
})
