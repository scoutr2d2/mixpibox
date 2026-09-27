/**
 * DIE ARD AM SERVER — die Haelfte, die ard.spec.ts nicht pruefen kann.
 *
 * `ard.spec.ts` prueft die REGEL gegen erfundene Antworten: rein, schnell, von
 * jeder Sorte eine. Was sie nicht beweisen kann, ist die VERDRAHTUNG — ob ein
 * `type: 'ard'`-Eintrag in data.json ueberhaupt bis zu einer Abfrage fuehrt,
 * ob die Antwort als Befehl beim Abspieldienst landet, und was passiert, wenn
 * die ARD nicht antwortet. Genau das steht hier, mit nock statt Netz.
 *
 * DIE EINE FRAGE, UM DIE ES BEI E4/A5 GEHT, ist die erste Pruefung unten: In
 * data.json steht NUR die Kennung — die Tonadresse entsteht erst beim
 * Antippen. Das ist kein Stilwunsch, sondern gemessen: Folge 16657073 lief am
 * 2026-06-29 ab und antwortete am 2026-08-04 mit 404, WAEHREND die
 * Schnittstelle sie weiter auflistete. Ein Eintrag mit eingebackener Adresse
 * verrottet still und faellt erst auf, wenn ein Kind drueckt.
 *
 * UND ES WIRD NICHTS GESCHRIEBEN: der letzte Test liest data.json nach dem
 * ganzen Lauf noch einmal von der Platte. Ein Katalog, den das Suchen
 * unbemerkt veraendert, waere die teuerste Sorte Fehler.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import nock from 'nock'
import request from 'supertest'
import { medienSchluessel } from './medien.js'

/**
 * DER EINTRAG, WIE `eintragAus()` IHN BAUT — und wie er in data.json steht.
 * Keine Tonadresse, kein Ablaufdatum, nichts Fluechtiges: nur die Kennung.
 */
const SENDUNG = {
  type: 'ard',
  category: 'audiobook',
  id: '81889970',
  title: 'MausHörspiel kurz',
  artist: 'Die Maus',
  cover: 'https://api.ardaudiothek.de/image/urn:ard:image:zzz?w=512&ch=6bf4',
}

/**
 * DERSELBE NAME BEI SPOTIFY — und genau deshalb steht er hier.
 *
 * `abgleich.ts` gruppiert eine ARD-Sendung und ein Spotify-Werk gleichen
 * Titels und Interpreten VON SELBST (ard.spec.ts). Fuer den Fall
 * „verschmolzen mit Spotify" weiter unten braucht es den Zwilling im Katalog;
 * fuer alle anderen Faelle liegt er nur daneben und stoert nichts — sie
 * suchen ihre Zeile ueber `typ === 'ard'` oder ueber SCHLUESSEL.
 */
const SPOTIFY_ZWILLING = {
  type: 'spotify',
  category: 'audiobook',
  showid: '4bZ1Rq2jS0aBcDeFgHiJkL',
  title: 'MausHörspiel kurz',
  artist: 'Die Maus',
}

const KATALOG = [SENDUNG, SPOTIFY_ZWILLING]
const SCHLUESSEL = medienSchluessel(SENDUNG)

const TON_NEU = 'https://wdrmedien-a.akamaihd.net/medp/ondemand/de/fsk0/300/3001234/3001234_MP3-128.mp3'
const TON_ALT = 'https://wdrmedien-a.akamaihd.net/medp/ondemand/de/fsk0/299/2991111/2991111_MP3-128.mp3'

/** Eine spielbare Folge — die neuere. */
const folgeNeu = {
  id: '16543875',
  title: 'MausHörspiel kurz — Der Wolf',
  titleClean: 'Der Wolf',
  duration: 319,
  publishDate: '2026-06-08T06:00:00+02:00',
  itemType: 'EPISODE',
  isPublished: true,
  image: { url1X1: 'https://api.ardaudiothek.de/image/urn:ard:image:aaa?w={width}' },
  audios: [{ url: TON_NEU, mimeType: 'audio/mp3' }],
  audioList: [{ availableTo: '2099-12-12T06:00:00+02:00' }],
}

/** Eine spielbare Folge — die aeltere. Fuer die Reihenfolge. */
const folgeAlt = { ...folgeNeu, id: '16400000', titleClean: 'Der Bär', publishDate: '2026-01-02T06:00:00+02:00' }

/**
 * DIE TONLOSE VORAB-DUBLETTE. Sie kommt hier MIT `isPublished: true` und
 * `itemType: EPISODE` durch die Bedingung — genau darum ist das Aussortieren
 * beim Lesen die zweite Sicherung und nicht der Guertel zum Hosentraeger.
 */
const folgeStumm = { ...folgeNeu, id: '16543999', titleClean: null, title: 'MausHörspiel kurz', audios: [] }

/**
 * DIE ABGELAUFENE. `availableTo` liegt in der Vergangenheit — die
 * Schnittstelle listet sie trotzdem auf, die Adresse antwortet mit 404.
 * Nachgebaut nach Folge 16657073 (gemessen 04.08.2026).
 */
const folgeTot = {
  ...folgeNeu,
  id: '16657073',
  titleClean: 'Willi, der Kater',
  audios: [{ url: TON_ALT, mimeType: 'audio/mp3' }],
  audioList: [{ availableTo: '2020-01-01T00:00:00+01:00' }],
}

const ARD = 'https://api.ardaudiothek.de'

/** Die Antwort auf `programSet(...)`, so wie der Dienst sie baut. */
function antwortSendung(nodes: unknown[]) {
  return {
    data: {
      programSet: {
        id: '81889970',
        title: 'MausHörspiel kurz',
        synopsis: 'Hoerspiele fuer Kinder.',
        numberOfElements: 198,
        image: { url1X1: 'https://api.ardaudiothek.de/image/urn:ard:image:zzz?w={width}&ch=6bf4' },
        publicationService: { title: 'Die Maus' },
        items: { totalCount: 168, nodes },
      },
    },
  }
}

let app: import('express').Express
let verzeichnis = ''
let plugins = ''

/**
 * Was der Plugin-Stummel beim naechsten Ruf antworten soll.
 *
 * DIE ROLLE VON `nock`, an der Naht, die es seit E78 gibt. Herein kommen die
 * FERTIGEN Folgen — die ARD-Regeln (tonlose Dublette, Verweildauer,
 * Reihenfolge) sind nicht mehr Sache des Servers und werden in
 * `plugins/mixpi-ardsounds/index.spec.mjs` geprueft, wo sie heute wohnen.
 */
function antwortSetzen(folgen: unknown[], extra: Record<string, unknown> = {}) {
  writeFileSync(
    join(verzeichnis, 'plugin-antwort.json'),
    JSON.stringify({ titel: 'MausHörspiel kurz', kuenstler: 'Die Maus', vollstaendig: true, folgen, ...extra }),
  )
}

/** Eine ARD-Rohfolge in die Form bringen, die das Plugin heute liefert. */
function alsFolge(roh: Record<string, unknown>) {
  const audios = (roh.audios ?? []) as { url?: string }[]
  return {
    kennung: String(roh.id ?? ''),
    name: String(roh.titleClean ?? roh.title ?? ''),
    bild: 'https://api.ardaudiothek.de/image/urn:ard:image:zzz?w=512&ch=6bf4',
    dauerSek: typeof roh.duration === 'number' ? roh.duration : undefined,
    quelle: { art: 'strom', adresse: String(audios[0]?.url ?? '') },
  }
}

/** Der Inhalt der Kachel — der Weg, den ein Antippen wirklich geht. */
const inhalt = (abfrage = '') =>
  request(app).get(`/api/werke/${encodeURIComponent(SCHLUESSEL)}/inhalt${abfrage}`)

describe('ARD Audiothek am Server (E4/A5)', () => {
  before(async () => {
    verzeichnis = mkdtempSync(join(tmpdir(), 'mupi-ard-'))
    writeFileSync(join(verzeichnis, 'data.json'), JSON.stringify(KATALOG, null, 2))
    writeFileSync(join(verzeichnis, 'active_data.json'), JSON.stringify(KATALOG, null, 2))
    // Fuer den Weiterhoeren-Teil weiter unten. Leer angelegt, damit der Server
    // nicht in einen fremden Stand hineinschreibt.
    writeFileSync(join(verzeichnis, 'resume.json'), '[]')
    writeFileSync(join(verzeichnis, 'gespielt.json'), '[]')
    writeFileSync(join(verzeichnis, 'mupiboxconfig.json'), JSON.stringify({ mupibox: { resume: 9 } }))
    process.env.MUPIBOX_CONFIG = join(verzeichnis, 'mupiboxconfig.json')
    process.env.MUPIBOX_CONFIG_DIR = verzeichnis
    // Eigene Sperrdatei je Lauf — die Spec-Dateien laufen parallel.
    process.env.MUPIBOX_LOCK_DIR = verzeichnis

    /* ══ DIE ATTRAPPE SITZT SEIT E78 AN EINER ANDEREN NAHT ═══════════════
     *
     * Bis dahin holte der SERVER die Folgen selbst, und `nock` konnte das
     * Netz faelschen. Seit E78 kommt die Liste aus `mixpi-ardsounds` — und
     * das laeuft in einem WORKER. `nock` flickt das http-Modul des
     * HAUPTprozesses; der Worker hat sein eigenes. Die Faelschung lief also
     * ins Leere, und weil ausserdem `MUPIBOX_PLUGIN_DIR` fehlte, war gar
     * kein Plugin geladen: 17 Zeugen antworteten mit 502.
     *
     * SIE WAREN SEITHER DAUERHAFT ROT — gemessen am 22.08.2026, mit und
     * ohne fremde Aenderungen identisch. Ein Zeuge, der immer rot ist,
     * wird uebersehen wie einer, der immer gruen ist.
     *
     * Deshalb steht hier jetzt ein Plugin-STUMMEL, der seine Antwort aus
     * einer Datei liest. Die Spec schreibt sie je Fall — dieselbe Rolle,
     * die frueher `nock` hatte, nur an der Naht, die es heute gibt. */
    plugins = join(verzeichnis, '.mupibox', 'plugins', 'mixpi-ardsounds')
    mkdirSync(plugins, { recursive: true })
    writeFileSync(
      join(plugins, 'plugin.json'),
      JSON.stringify({ kennung: 'mixpi-ardsounds', name: 'Stummel', fassung: '1.0.0', haupt: 'index.mjs', rechte: [] }),
    )
    writeFileSync(
      join(plugins, 'index.mjs'),
      `import { readFileSync } from 'node:fs'
       export default {
         async inhalt(rest) {
           const d = JSON.parse(readFileSync(${JSON.stringify(join(verzeichnis, 'plugin-antwort.json'))}, 'utf8'))
           if (d.wirf) throw new Error(d.wirf)
           /* DIE REIHENFOLGE REIST HINTER DEM DOPPELKREUZ. Der Server reicht
              sie durch, entschieden wird sie im Plugin - der Stummel bildet
              nur nach, was das echte tut. KEINE BACKTICKS HIER: dieser
              Kommentar steht INNERHALB eines Template-Literals. */
           const folgen = [...(d.folgen ?? [])]
           if (String(rest).endsWith('#aelteste')) folgen.reverse()
           return { ...d, folgen }
         },
       }\n`,
    )
    process.env.MUPIBOX_PLUGIN_DIR = join(verzeichnis, '.mupibox', 'plugins')
    antwortSetzen([])
    app = (await import('./server.js')).app
    const { warteBereit } = await import('./plugin-wirt.js')
    await warteBereit('mixpi-ardsounds', 10_000)
  })

  after(async () => {
    // Ohne das haelt der Worker den Testprozess offen.
    const { allesBeenden } = await import('./plugin-wirt.js')
    await allesBeenden()
    process.env.MUPIBOX_CONFIG_DIR = undefined
    process.env.MUPIBOX_LOCK_DIR = undefined
    process.env.MUPIBOX_PLUGIN_DIR = undefined
    nock.cleanAll()
  })

  it('holt die Tonadresse ERST BEIM ANTIPPEN — in data.json steht sie nicht', async () => {
    antwortSetzen([alsFolge(folgeNeu)])
    const r = await inhalt().expect(200)

    // 1. Der Befehl traegt die frische Adresse.
    const t = r.body.titel[0]
    assert.equal(decodeURIComponent(t.befehl.split('/')[1]), TON_NEU)
    assert.ok(t.befehl.startsWith('ard/'), t.befehl)
    assert.ok(t.anhaengen.startsWith('ardqueue/'), t.anhaengen)

    // 2. Der gespeicherte Eintrag kennt sie nicht — und zwar auf der Platte.
    const gespeichert = readFileSync(join(verzeichnis, 'data.json'), 'utf8')
    assert.ok(!gespeichert.includes('akamai'), 'die Tonadresse steht in data.json')
    assert.ok(!gespeichert.includes('.mp3'), 'die Tonadresse steht in data.json')
  })

  /* UMGEZOGEN, NICHT GESTRICHEN (E78 nachgetragen 23.08.2026).
   *
   * „laesst die tonlose Dublette und die abgelaufene Folge aus" pruefte eine
   * ARD-REGEL. Die wohnt seit E78 in `plugins/mixpi-ardsounds` und wird dort
   * gehalten — „TON-NACHSICHT: fehlendes mimeType wirft keine spielbare Folge
   * weg" und „VERWEILDAUER: abgelaufene Folgen fallen". Sie hier ein zweites
   * Mal zu pruefen hiesse, dieselbe Regel an zwei Orten zu fuehren; sie liefen
   * genau dann auseinander, wenn es darauf ankommt.
   *
   * Was DIESER Zeuge pruefen kann und weiter prueft, steht darunter: was der
   * SERVER aus einer gegebenen Folgenliste macht. */

  it('gibt die Reihenfolge her, statt sie zu bestimmen', async () => {
    // Kindernachrichten wollen die neueste zuerst, ein Hoerspiel in Teilen
    // genau umgekehrt. Die Vorgabe ist „neueste", wie die Audiothek selbst.
    antwortSetzen([alsFolge(folgeNeu), alsFolge(folgeAlt)])
    const neu = await inhalt().expect(200)
    assert.deepEqual(
      neu.body.titel.map((t: { titel: string }) => t.titel),
      ['Der Wolf', 'Der Bär'],
    )

    antwortSetzen([alsFolge(folgeNeu), alsFolge(folgeAlt)])
    const alt = await inhalt('?reihenfolge=aelteste').expect(200)
    assert.deepEqual(
      alt.body.titel.map((t: { titel: string }) => t.titel),
      ['Der Bär', 'Der Wolf'],
    )
    // Die Nummerierung folgt der gezeigten Reihenfolge, nicht der Quelle.
    assert.deepEqual(
      alt.body.titel.map((t: { nr: number }) => t.nr),
      [1, 2],
    )
  })

  it('nummeriert, benennt und misst — die Felder, die die Oberflaeche liest', async () => {
    antwortSetzen([alsFolge(folgeNeu)])
    const t = (await inhalt().expect(200)).body.titel[0]
    assert.equal(t.nr, 1)
    // `titleClean`, nicht `title`: sonst stuende der Sendungsname doppelt da.
    assert.equal(t.titel, 'Der Wolf')
    assert.equal(t.interpret, 'Die Maus')
    // Sekunden der Schnittstelle, Millisekunden fuer die Oberflaeche.
    assert.equal(t.dauerMs, 319_000)
    // Die Platzhalterstelle `{width}` ist ersetzt — unveraendert waere das
    // Bild ein HTTP 400 (gemessen 04.08.2026).
    assert.ok(!String(t.bild).includes('{width}'), t.bild)
  })

  /* DIE FEHLERNAMEN HABEN SICH BEI E78 GEAENDERT, und niemand hat es gemerkt
   * — weil diese Zeugen seither ohnehin rot waren.
   *
   * Frueher unterschied der Server `nichtErreichbar` von `sendungUnbekannt`.
   * Seit die Liste aus dem Plugin kommt, meldet er EINEN Namen, `pluginInhalt`,
   * und legt den GRUND im Klartext daneben. Das ist die ehrlichere Auskunft:
   * welcher der beiden Faelle vorliegt, weiss der Server gar nicht mehr — er
   * hat nur eine geworfene Meldung.
   *
   * DER UNTERSCHIED, AUF DEN ES ANKOMMT, BLEIBT DERSELBE: 502 heisst „ich
   * konnte nicht fragen", NICHT „die Sendung ist leer". Eine leere Sendung
   * ist 200 mit leerer Liste, und dafuer gibt es den Zeugen darunter. */
  it('meldet einen Ausfall der ARD als Ausfall — nicht als leere Sendung', async () => {
    antwortSetzen([], { wirf: 'kein Netz' })
    const r = await inhalt().expect(502)
    assert.equal(r.body.error, 'pluginInhalt')
    assert.match(String(r.body.grund), /kein Netz/, 'der Grund steht im Klartext daneben')
  })

  it('meldet eine unbekannte Sendung, statt eine leere Kachel zu bauen', async () => {
    antwortSetzen([], { wirf: 'Sendung 81889970 ist der ARD unbekannt' })
    const r = await inhalt().expect(502)
    assert.equal(r.body.error, 'pluginInhalt')
    assert.match(String(r.body.grund), /unbekannt/)
  })

  it('LEER IST HIER EIN ERGEBNIS: eine Sendung ohne abrufbare Folge', async () => {
    // Anders als beim lokalen Album. Eine Sendung KANN gerade nichts
    // Abrufbares haben (alles abgelaufen) — das ist die Wahrheit und kein
    // Dienstfehler, den nachher niemand findet.
    antwortSetzen([])
    const r = await inhalt().expect(200)
    assert.deepEqual(r.body.titel, [])
  })

  /* DIE SUCHE IST GANZ WEG — und das gehoert benannt, nicht stillschweigend
   * geloescht.
   *
   * `GET /api/ard/suche` gibt es im Server nicht mehr; sie ist bei E79 in das
   * Plugin gewandert (`/api/plugins/mixpi-ardsounds/http/suche`). Die beiden
   * Zeugen, die hier standen, riefen also eine Route, die es nicht gibt — und
   * scheiterten seither an 404, nicht an einem Fehler der Suche.
   *
   * Was sie prueften, prueft heute `plugins/mixpi-ardsounds/index.spec.mjs`:
   * dass ein fertiger data.json-Vorschlag mitkommt und dass eine Suche ohne
   * Begriff abgewiesen wird, ohne den Dienst zu fragen. */

  /*
   * ══ WEITERHOEREN (05.08.2026) ═════════════════════════════════════════════
   *
   * Gemeldet als „die angespielten tracks landen nicht in weiterhoeren".
   * Sie landeten nicht, weil `ard` in weiterhoeren.ts gar nicht vorkam.
   *
   * WAS HIER GEPRUEFT WIRD UND IN weiterhoeren.spec.ts NICHT KANN: die
   * AUFLOESUNG. mpv meldet nur eine Warteschlangennummer; welche FOLGE das
   * ist, weiss allein die Liste, aus der die Warteschlange gebaut wurde. Der
   * Weg von „Nummer 2" zu „Folge 16400000" fuehrt durch den Server, durch
   * einen Zwischenspeicher und notfalls durch einen Netzabruf — und genau
   * dort liegt die Fehlerklasse, die man nicht sieht: die Reihe zeigt eine
   * Kachel, sie startet nur die falsche Folge.
   */
  describe('Weiterhoeren — die Folge, nicht die Nummer', () => {
    const merken = (koerper: Record<string, unknown>) =>
      request(app).post('/api/weiterhoeren').send({ schluessel: SCHLUESSEL, ...koerper })

    it('loest die Warteschlangennummer in die FOLGENKENNUNG auf', async () => {
      // Die Box holt vor dem Abspielen ohnehin `/inhalt` — daraus baut sie die
      // mpv-Warteschlange, und daraus merkt sich der Server die Reihenfolge.
      // Genau diese Abfolge wird hier nachgestellt.
      antwortSetzen([alsFolge(folgeNeu), alsFolge(folgeAlt)])
      const liste = await inhalt().expect(200)
      assert.deepEqual(
        liste.body.titel.map((t: { id: string }) => t.id),
        ['16543875', '16400000'],
      )

      // mpv sagt „Titel 2 von 2, bei 249 von 600 Sekunden". OHNE Netzabruf:
      // die Reihenfolge steht schon im Speicher.
      const r = await merken({ titelNr: 2, gesamt: 2, bisher: 249, dauer: 600 }).expect(200)
      assert.equal(r.body.status, 'ok')

      const stellen = JSON.parse(readFileSync(join(verzeichnis, 'resume.json'), 'utf8'))
      assert.equal(stellen.length, 1)
      // Nummer 2 der Liste ist „Der Bär" — 16400000, nicht 16543875.
      assert.equal(stellen[0].resumeardfolge, '16400000')
      assert.equal(stellen[0].resumeardcurrentTracknr, 2)
      assert.equal(stellen[0].resumeardprogressTime, 41.5)
      assert.equal(stellen[0].resumeGesamtTitel, 2)
      assert.equal(stellen[0].category, 'resume')
    })

    it('SCHREIBT KEINE TONADRESSE IN resume.json — auf der Platte nachgelesen', () => {
      // Dieselbe Frage wie beim Katalog ganz oben, nur eine Datei weiter. Und
      // sie ist hier schaerfer: resume.json wandert ueber die Netz-Skripte der
      // Box auch in offline_resume.json, also in eine Datei, die genau dann
      // gelesen wird, wenn kein Netz da ist, um eine abgelaufene Adresse
      // nachzuholen.
      const roh = readFileSync(join(verzeichnis, 'resume.json'), 'utf8')
      assert.ok(!roh.includes('.mp3'), `Tonadresse in resume.json: ${roh}`)
      assert.ok(!roh.includes('akamai'), `Tonadresse in resume.json: ${roh}`)
    })

    it('liefert die Zeile MIT Folgenkennung und in PROZENT aus', async () => {
      const r = await request(app).get('/api/weiterhoeren').expect(200)
      const zeile = r.body.weiter.find((z: { typ: string }) => z.typ === 'ard')
      assert.ok(zeile, JSON.stringify(r.body.weiter))
      assert.equal(zeile.folge, '16400000')
      assert.equal(zeile.positionProzent, 41.5)
      // Millisekunden gibt es hier nicht — eine ARD-Folge laeuft ueber mpv,
      // und `seekpos:` rechnet in Prozent.
      assert.equal(zeile.positionMs, null)
      assert.equal(zeile.schluessel, SCHLUESSEL)
    })

    it('faerbt in der Folgen-Lane genau EINE Kachel blau — die gemerkte', async () => {
      // Der blaue Knopf haengt an der KENNUNG und nicht am Platz in der Liste.
      // Hier steht die gemerkte Folge inzwischen an einer ANDEREN Stelle
      // (Reihenfolge umgedreht) — sie muss trotzdem sie sein.
      antwortSetzen([alsFolge(folgeNeu), alsFolge(folgeAlt)])
      const r = await inhalt('?reihenfolge=aelteste').expect(200)
      const blau = r.body.titel.filter((t: { weiterAb: unknown }) => t.weiterAb)
      assert.equal(blau.length, 1)
      assert.equal(blau[0].id, '16400000')
      // Die Nummer stammt aus DIESER Liste (Platz 1), nicht aus der gemerkten
      // Stelle (dort stand 2). Wer die gemerkte durchreichte, spraenge daneben.
      assert.equal(blau[0].weiterAb.titelNr, 1)
      assert.equal(blau[0].weiterAb.positionProzent, 41.5)
      assert.equal(blau[0].weiterAb.folge, '16400000')
    })

    it('folgt der Liste, die ZULETZT ausgeliefert wurde — nicht einer zweiten', async () => {
      /*
       * Der Test davor hat `/inhalt?reihenfolge=aelteste` geholt; die
       * Warteschlange der Oberflaeche steht damit ANDERSHERUM. Nummer 1 ist
       * jetzt „Der Bär", nicht mehr „Der Wolf".
       *
       * WARUM DAS EIN EIGENER FALL IST: Der Speicher haette sich nach Sendung
       * UND Reihenfolge schluesseln lassen — dann laegen zwei Listen darin,
       * und die genommene waere nicht die, gegen die mpv gerade zaehlt. Der
       * Schluessel ist deshalb die SENDUNG allein: gemerkt wird, was zuletzt
       * hinausging.
       */
      const r = await merken({ titelNr: 1, gesamt: 2, bisher: 300, dauer: 600 }).expect(200)
      assert.equal(r.body.status, 'ok')
      const stellen = JSON.parse(readFileSync(join(verzeichnis, 'resume.json'), 'utf8'))
      assert.equal(stellen.at(-1).resumeardfolge, '16400000')
    })

    it('VERSCHMOLZEN MIT SPOTIFY: die Zeile faengt von vorn an, statt in Kapitel 7 zu springen', async () => {
      /*
       * BEFUND BEIM GEGENLESEN (06.08.2026, E4/A10).
       *
       * `verschmelzung.ts` begruendet, warum `ard` nicht in
       * QUELLEN_REIHENFOLGE steht, unter anderem so: „Eine verschmolzene
       * Kachel, deren bevorzugte Quelle wechselt, verloere ihre Stelle STILL:
       * die Zeile bliebe stehen, der Tipp finge von vorn an." Der Code tat das
       * NICHT. `fortsetzenMit` nahm der Stelle die POSITION (Prozent gilt bei
       * Spotify nicht), die TITELNUMMER reiste aber unveraendert mit — und
       * `weiterSpielen` baute daraus im Spotify-Zweig `abspielBefehl(w, nr, …)`
       * (bis E95/V; heute formt `startPlan` in spielfunktion.ts denselben Befehl).
       * Aus „Folge 2 der ARD-Sendung" wurde „Kapitel 2 des Spotify-Werks".
       *
       * UND ES BRAUCHT DAFUER KEINE FEHLBEDIENUNG: `abgleich.ts` schlaegt
       * genau diese Zuordnung von sich aus vor (ard.spec.ts, „faellt mit einem
       * Spotify-Hoerbuch desselben Namens in EINE Gruppe"). Ein Erwachsener,
       * der „Die Maus" bei der ARD UND bei Spotify sieht, nimmt an — es ist ja
       * dieselbe Sendung. Nur nicht dieselbe Folgenreihe, und die der ARD
       * rollt obendrein.
       */
      writeFileSync(
        join(verzeichnis, 'verschmelzung.json'),
        JSON.stringify({
          zuordnungen: [{ schluessel: medienSchluessel(SPOTIFY_ZWILLING), auch: [SCHLUESSEL], stufe: 'hand' }],
          getrennt: [],
        }),
      )
      try {
        const r = await request(app).get('/api/weiterhoeren?verschmelzen=1').expect(200)
        const zeile = r.body.weiter.find((z: { typ: string }) => z.typ === 'ard')
        assert.ok(zeile, JSON.stringify(r.body.weiter))
        // Die Kachel spielt jetzt ueber Spotify — das ist die Verschmelzung.
        assert.equal(zeile.quelle, 'spotify')
        // UND DIE STELLE IST WEG. Alle drei Zahlen, nicht nur die Position:
        // die Nummer ist bei einer rollenden Folgenliste keinen Deut
        // verlaesslicher als der Prozentwert.
        assert.equal(zeile.titelNr, 0)
        assert.equal(zeile.positionMs, null)
        assert.equal(zeile.positionProzent, null)
        assert.equal(zeile.anteil, null)

        /*
         * GEGENPROBE: OHNE Verschmelzung spielt die Kachel weiter ueber die
         * ARD — und dann gilt die Stelle unveraendert.
         *
         * HIER STAND BIS ZUM 19.09.2026 `get('/api/weiterhoeren')` OHNE
         * PARAMETER, und genau das war seit dem 06.09.2026 falsch. Nicht die
         * Sache war falsch, sondern die FRAGE: „ohne Verschmelzung" wurde
         * buchstabiert als „den Schalter weglassen".
         *
         * WAS SICH GEAENDERT HAT (25b55123, 06.09.2026, „Doppelte Alben
         * werden ab jetzt zusammengefasst — die Vorgabe dreht sich, an allen
         * acht Stellen zugleich"). Vorher las der Server
         *   String(req.query.verschmelzen ?? '') === '1'
         * — ein fehlender Parameter hiess AUS. Heute heisst er „frag die
         * Darstellung", und die Vorgabe dort ist `!== false`, also AN
         * (Betreiber, 06.09.2026: „ich wuerde default immer verschmolzen
         * machen da wir ja auch so intern arbeiten"; am Geraet gemessen,
         * Box .81: 44 Kacheln ohne, 35 mit Verschmelzung, neun Werke doppelt).
         * Diese Spec legt keine darstellung.json an — es gilt also die
         * Vorgabe, und der Aufruf ohne Parameter war ab dem 06.09. ein
         * ZWEITER verschmolzener Aufruf.
         *
         * WAS DIE WACHE DAMIT GEMESSEN HAT: nichts. Sie verglich den
         * verschmolzenen Fall mit sich selbst und meldete den Unterschied als
         * Fehler. Gemessen am 19.09.2026, beide Aufrufe im selben Lauf:
         *   ohne Parameter  -> quelle 'spotify', titelNr 0, positionProzent null
         *   verschmelzen=0  -> titelNr 1, positionProzent 50, folge '16400000'
         * Der Code tut also genau das, was der Fall oben von ihm verlangt;
         * rot war allein die Gegenprobe.
         *
         * DESHALB STEHT DER SCHALTER JETZT AUSDRUECKLICH AUF 0. Eine
         * Gegenprobe, die den unverschmolzenen Zustand meint, muss ihn
         * VERLANGEN — eine Vorgabe darf sie nicht mitdrehen. Sonst faellt sie
         * beim naechsten Richtungswechsel wieder um, und zwar wieder ohne
         * dass an der geprueften Sache etwas kaputt waere.
         */
        const ohne = await request(app).get('/api/weiterhoeren?verschmelzen=0').expect(200)
        // Der Stand stammt aus dem Fall darueber: Nummer 1, 300 von 600 s.
        const roh = ohne.body.weiter.find((z: { typ: string }) => z.typ === 'ard')
        assert.equal(roh.titelNr, 1)
        assert.equal(roh.positionProzent, 50)
        assert.equal(roh.folge, '16400000')
      } finally {
        // Die Verschmelzung wieder wegnehmen — die Faelle danach rechnen mit
        // einer unverschmolzenen Bibliothek (llmwiki messwerkzeug-laesst-
        // zustand-stehen).
        writeFileSync(join(verzeichnis, 'verschmelzung.json'), JSON.stringify({ zuordnungen: [], getrennt: [] }))
      }
    })

    it('merkt den FOLGENTITEL mit — und ohne Tonadresse', () => {
      // Er ist der Rueckfall fuer den Fall darunter. Auf der Platte
      // nachgelesen, nicht in der Antwort: was hier NICHT steht, gibt es beim
      // naechsten Start auch nicht.
      const stellen = JSON.parse(readFileSync(join(verzeichnis, 'resume.json'), 'utf8'))
      assert.equal(stellen.at(-1).resumeardfolge, '16400000')
      assert.equal(stellen.at(-1).resumeardfolgentitel, 'Der Bär')
      const roh = readFileSync(join(verzeichnis, 'resume.json'), 'utf8')
      assert.ok(!roh.includes('.mp3'), `Tonadresse in resume.json: ${roh}`)
    })

    it('DIE FOLGE WURDE NEU EINGESETZT: die Kennung trifft nicht mehr, der TITEL schon', async () => {
      /*
       * DER GEMESSENE FALL (04.08.2026): Folge 16657073 antwortete mit 404,
       * WAEHREND die Schnittstelle sie weiter auflistete. Die Audiothek nimmt
       * Folgen heraus und setzt sie wieder ein — unter einer NEUEN Kennung.
       *
       * OHNE DEN RUECKFALL sieht das so aus: Die Folge steht in der Liste, das
       * Kind sieht sie, und der Tipp auf „weiterhören" meldet „Diese Folge gibt
       * es nicht mehr — die Sendung fängt vorn an". Eine Ansage, die PLAUSIBEL
       * klingt (die Verweildauer laeuft wirklich ab) und trotzdem falsch ist.
       *
       * Hier steht „Der Bär" jetzt unter 16400001 statt 16400000. Die gemerkte
       * Stelle nennt die alte Kennung — gefaerbt wird trotzdem die richtige
       * Kachel, und die Oberflaeche folgt genau dieser Markierung
       * (`ardSendungAb`, `ausStelle`).
       */
      const neuEingesetzt = { ...folgeAlt, id: '16400001' }
      antwortSetzen([alsFolge(folgeNeu), alsFolge(neuEingesetzt)])
      const r = await inhalt().expect(200)
      const blau = r.body.titel.filter((t: { weiterAb: unknown }) => t.weiterAb)
      assert.equal(blau.length, 1, JSON.stringify(r.body.titel))
      assert.equal(blau[0].id, '16400001')
      assert.equal(blau[0].titel, 'Der Bär')
      // Die Nummer stammt aus DIESER Liste, und die Folge steht hier auf 2.
      assert.equal(blau[0].weiterAb.titelNr, 2)
      assert.equal(blau[0].weiterAb.positionProzent, 50)
      // Und die Kennung im Knopf ist die NEUE — die alte fuehrte ins Leere.
      assert.equal(blau[0].weiterAb.folge, '16400001')
    })

    it('WEDER KENNUNG NOCH TITEL: dann gar nichts, statt die Position zu raten', async () => {
      // Die Position allein entscheidet NIE — genau daraus entstand die
      // rollende Falle (llmwiki ard-folgenliste-rollt). Hier ist „Der Bär"
      // wirklich weg; uebrig bleibt eine Liste ohne blauen Knopf, und die
      // Sendung faengt ehrlich vorn an.
      antwortSetzen([alsFolge(folgeNeu), alsFolge({ ...folgeAlt, id: '16400002', titleClean: 'Der Dachs' })])
      const r = await inhalt().expect(200)
      assert.equal(r.body.titel.filter((t: { weiterAb: unknown }) => t.weiterAb).length, 0)
    })

    it('merkt NICHTS, wenn die Folge nicht zu ermitteln ist', async () => {
      // Eine Nummer jenseits der Liste — etwa weil mpv noch eine alte
      // Warteschlange meldet. Lieber die vorige Stelle stehen lassen als eine
      // schreiben, die in eine fremde Folge zeigt.
      const vorher = readFileSync(join(verzeichnis, 'resume.json'), 'utf8')
      const r = await merken({ titelNr: 99, gesamt: 2, bisher: 100, dauer: 600 }).expect(200)
      assert.equal(r.body.status, 'nichtAufloesbar')
      assert.equal(readFileSync(join(verzeichnis, 'resume.json'), 'utf8'), vorher)
    })
  })

  it('hat den Katalog nach alldem NICHT angefasst', async () => {
    // Suchen und Abspielen sind Lesevorgaenge. Ein Dienst, der beim Suchen
    // Eintraege anlegt, ist der Fehler, den niemand sucht.
    assert.deepEqual(JSON.parse(readFileSync(join(verzeichnis, 'data.json'), 'utf8')), KATALOG)
  })
})
