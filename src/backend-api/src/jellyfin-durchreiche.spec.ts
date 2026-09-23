import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  anfrageKopfzeilen,
  antwortKopfzeilen,
  kennungAusStrom,
  kennungErlaubt,
  stromAdresse,
  traegtSchluessel,
  ueberDieBox,
} from './jellyfin-durchreiche.js'

/**
 * DER WEITERREICHER FUER JELLYFIN-TOENE (BACKLOG E15/S2).
 *
 * ZWEI SORTEN VON FEHLERN werden hier festgehalten, und nur die zweite faellt
 * beim Hoeren auf:
 *
 *   SICHERHEIT  Eine Kennung, die keine ist, macht aus dem Weiterreicher einen
 *               Weg, mit dem Schluessel der Box beliebige Jellyfin-Adressen zu
 *               erreichen. Deshalb steht neben jedem „darf" ein „darf nicht".
 *   HOERBARKEIT Wird `Range` verschluckt, spielt die Box weiter — sie kann nur
 *               nicht mehr springen. Das MERKEN DER POSITION waere damit still
 *               kaputt, und still ist die teure Sorte.
 *
 * Die Werte sind der echten Box entnommen (gemessen 04.08.2026): Server
 * http://192.168.178.199:8899, Kennung 7d9a37e2732ca78bc68eacb3232960c0.
 */
describe('jellyfin-durchreiche', () => {
  const KENNUNG = '7d9a37e2732ca78bc68eacb3232960c0'
  const SERVER = 'http://192.168.178.199:8899'

  describe('kennungErlaubt — die einzige Schranke des Weiterreichers', () => {
    it('nimmt die Form, die Jellyfin wirklich vergibt (32 Hexziffern)', () => {
      assert.equal(kennungErlaubt(KENNUNG), true)
      assert.equal(kennungErlaubt('E131865D504A657A93533722FC88BC90'), true)
    })

    it('weist Pfadanteile ab — sonst waere der Weg ein Schluessel zu jedem Jellyfin-Pfad', () => {
      assert.equal(kennungErlaubt('../../System/Configuration'), false)
      assert.equal(kennungErlaubt(`${KENNUNG}/../Users`), false)
      assert.equal(kennungErlaubt(`${KENNUNG}?api_key=x`), false)
    })

    it('weist alles ab, was nur fast passt', () => {
      assert.equal(kennungErlaubt(''), false)
      assert.equal(kennungErlaubt(KENNUNG.slice(0, 31)), false) // zu kurz
      assert.equal(kennungErlaubt(`${KENNUNG}0`), false) // zu lang
      assert.equal(kennungErlaubt('7d9a37e2-732c-a78b-c68e-acb3232960c0'), false) // GUID mit Strichen
      assert.equal(kennungErlaubt('7d9a37e2732ca78bc68eacb3232960cZ'), false) // kein Hex
    })

    it('haelt Unfug aus', () => {
      assert.equal(kennungErlaubt(undefined as unknown as string), false)
      assert.equal(kennungErlaubt(null as unknown as string), false)
    })
  })

  describe('stromAdresse — was die Box bei Jellyfin holt', () => {
    it('traegt KEINEN Schluessel in der Adresse (der Zweck der ganzen Uebung)', () => {
      const adresse = stromAdresse(SERVER, KENNUNG)
      assert.equal(traegtSchluessel(adresse), false)
      assert.equal(adresse.includes('api_key'), false)
    })

    it('bleibt bei DIRECT PLAY — ohne static=true meldet mpv eine falsche Laenge', () => {
      assert.ok(stromAdresse(SERVER, KENNUNG).includes('static=true'))
    })

    it('haengt keinen zweiten Schraegstrich an', () => {
      assert.equal(stromAdresse(`${SERVER}/`, KENNUNG), stromAdresse(SERVER, KENNUNG))
      assert.equal(stromAdresse(`${SERVER}///`, KENNUNG), stromAdresse(SERVER, KENNUNG))
    })
  })

  describe('anfrageKopfzeilen — Range ist die eine, die durch MUSS', () => {
    it('reicht Range durch: ohne sie kann mpv nicht springen, und das Fortsetzen ist still kaputt', () => {
      assert.deepEqual(anfrageKopfzeilen({ range: 'bytes=1048576-' }), { Range: 'bytes=1048576-' })
    })

    it('nimmt sie auch mit grossem R (die Sorte, die Node nicht normalisiert)', () => {
      assert.deepEqual(anfrageKopfzeilen({ Range: 'bytes=0-1023' }), { Range: 'bytes=0-1023' })
    })

    it('laesst Authorization und Cookie DRAUSSEN — der Zugang der Box wird eigens gesetzt', () => {
      const raus = anfrageKopfzeilen({
        range: 'bytes=0-',
        authorization: 'Bearer fremd',
        cookie: 'sitzung=1',
        'accept-encoding': 'gzip',
      })
      assert.deepEqual(raus, { Range: 'bytes=0-' })
    })

    it('erfindet keine leere Range — eine leere Kopfzeile ist schlimmer als keine', () => {
      assert.deepEqual(anfrageKopfzeilen({ range: '   ' }), {})
      assert.deepEqual(anfrageKopfzeilen({}), {})
    })
  })

  describe('antwortKopfzeilen — Laenge und Sprungfaehigkeit zurueckgeben', () => {
    const von = (m: Record<string, string>) => (name: string) => m[name] ?? null

    it('reicht durch, was mpv fuer Laenge und Sprung braucht', () => {
      const raus = antwortKopfzeilen(
        von({
          'content-type': 'audio/flac',
          'content-length': '41234567',
          'accept-ranges': 'bytes',
          'content-range': 'bytes 1048576-41234566/41234567',
        }),
      )
      assert.deepEqual(raus, {
        'content-type': 'audio/flac',
        'content-length': '41234567',
        'accept-ranges': 'bytes',
        'content-range': 'bytes 1048576-41234566/41234567',
      })
    })

    it('behaelt fuer sich, wer der Server ist, und setzt keine fremde Sitzung', () => {
      const raus = antwortKopfzeilen(
        von({ 'content-type': 'audio/mpeg', server: 'Kestrel', 'x-powered-by': 'Jellyfin', 'set-cookie': 'a=b' }),
      )
      assert.deepEqual(raus, { 'content-type': 'audio/mpeg' })
    })

    it('erfindet nichts, was nicht da war', () => {
      assert.deepEqual(antwortKopfzeilen(von({})), {})
      assert.deepEqual(antwortKopfzeilen(von({ 'content-length': '' })), {})
    })
  })

  describe('traegtSchluessel — dieselbe Frage fuer Umbau und Nachweis', () => {
    it('erkennt alle drei Schreibweisen, die Jellyfin annimmt', () => {
      assert.equal(traegtSchluessel(`${SERVER}/Items/${KENNUNG}/Images/Primary?api_key=31f5d6`), true)
      assert.equal(traegtSchluessel(`${SERVER}/Audio/${KENNUNG}/stream?static=true&ApiKey=31f5d6`), true)
      assert.equal(traegtSchluessel(`${SERVER}/Audio/${KENNUNG}/stream?X-Emby-Token=31f5d6`), true)
    })

    it('haelt eine schluessellose Adresse fuer schluessellos', () => {
      assert.equal(traegtSchluessel(stromAdresse(SERVER, KENNUNG)), false)
      assert.equal(traegtSchluessel('/api/jellyfin/strom/' + KENNUNG), false)
      // Ein Titel, der zufaellig „api_key" heisst, ist kein Schluessel.
      assert.equal(traegtSchluessel(`${SERVER}/Audio/${KENNUNG}/stream?title=api_key`), false)
    })
  })

  describe('kennungAusStrom / ueberDieBox', () => {
    it('holt die Kennung aus der Adresse, die die Box wirklich speichert', () => {
      const gespeichert = `${SERVER}/Audio/${KENNUNG}/stream?static=true&api_key=TESTSCHLUESSEL-KEIN-ECHTER`
      assert.equal(kennungAusStrom(gespeichert), KENNUNG)
      assert.equal(ueberDieBox(gespeichert), `/api/jellyfin/strom/${KENNUNG}`)
    })

    it('nimmt auch den Umrechnungsweg (universal), den der Rueckfall benutzt', () => {
      assert.equal(kennungAusStrom(`${SERVER}/Audio/${KENNUNG}/universal?api_key=x`), KENNUNG)
    })

    it('LAESST STEHEN, was keine Stromadresse ist — schweigen waere schlimmer als schleppen', () => {
      const cover = `${SERVER}/Items/${KENNUNG}/Images/Primary?api_key=31f5d6`
      assert.equal(kennungAusStrom(cover), null)
      assert.equal(ueberDieBox(cover), cover)
      assert.equal(ueberDieBox('spotify:track:4uLU6hMCjMI75M1A2tKUQC'), 'spotify:track:4uLU6hMCjMI75M1A2tKUQC')
      assert.equal(ueberDieBox(''), '')
    })

    it('schreibt eine Adresse mit unglaubwuerdiger Kennung NICHT um', () => {
      const boese = `${SERVER}/Audio/..%2f..%2fSystem/stream?api_key=x`
      assert.equal(kennungAusStrom(boese), null)
      assert.equal(ueberDieBox(boese), boese)
    })
  })
})
