/**
 * Integrationszeugen fuer die PROXY-VERWEIGERUNG (E76).
 *
 * ══ WARUM DIESE NAHT EINEN EIGENEN ZEUGEN BRAUCHT ══════════════════════════
 *
 * Die Regel selbst (`dienstAktiv`, `anbieterAusBefehl`) ist in
 * mixpi-anbieter.spec.ts geprueft. Aber die NAHT — sitzt die Pruefung im
 * Proxy VOR der Weiterleitung, nur bei Startbefehlen, mit dem richtigen
 * Formular? — laesst sich am Geraet nicht gefahrlos messen: schluege die
 * Verweigerung fehl, erreichte der Testbefehl den Abspieldienst und risse
 * einem hoerenden Kind die Wiedergabe ab. Genau deshalb steht sie hier, wo
 * hinter dem Proxy nichts lauscht.
 *
 * KEIN ABSPIELDIENST LAEUFT: leitet der Proxy durch, endet das im
 * Verbindungsfehler (502) — sauber unterscheidbar vom 403 der Verweigerung.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, describe, it } from 'node:test'
import request from 'supertest'

let app: import('express').Express
let konfigPfad: string

function konfigSchreiben(inhalt: Record<string, unknown>): void {
  writeFileSync(konfigPfad, JSON.stringify(inhalt))
}

before(async () => {
  const verzeichnis = mkdtempSync(join(tmpdir(), 'mixpi-anbieter-'))
  konfigPfad = join(verzeichnis, 'mupiboxconfig.json')
  konfigSchreiben({ mupibox: { host: 'TestBox' } })
  process.env.MUPIBOX_CONFIG = konfigPfad
  process.env.MUPIBOX_CONFIG_DIR = verzeichnis
  process.env.MUPIBOX_LOCK_DIR = verzeichnis
  app = (await import('./server.js')).app
})

describe('der /player-Proxy verweigert abgeschaltete Anbieter (E76)', () => {
  it('ARD abgeschaltet: Startbefehl -> 403 mit dem Anker und einem ganzen Satz', async () => {
    konfigSchreiben({ mupibox: { host: 'TestBox' }, ard: { aktiv: false } })
    const antwort = await request(app).get('/player/kinderzimmer/ard/http%3A%2F%2Fbeispiel/folge:title:artist:wer')
    assert.equal(antwort.status, 403)
    assert.equal(antwort.body.anbieterAus, true)
    assert.equal(antwort.body.dienst, 'ard')
    assert.match(antwort.body.grund, /ARD Sounds ist gerade abgeschaltet/)
  })

  it('auch das ANHAENGEN ist ein Start — ardqueue faellt mit', async () => {
    konfigSchreiben({ mupibox: { host: 'TestBox' }, ard: { aktiv: false } })
    const antwort = await request(app).get('/player/x/ardqueue/http%3A%2F%2Fbeispiel/folge')
    assert.equal(antwort.status, 403)
  })

  it('ARD an (Schalter fehlt): der Befehl wird DURCHGELEITET — kein 403', async () => {
    konfigSchreiben({ mupibox: { host: 'TestBox' } })
    const antwort = await request(app).get('/player/x/ard/http%3A%2F%2Fbeispiel/folge:title:artist:wer')
    // Hinter dem Proxy lauscht im Test nichts: Durchleitung endet im
    // Verbindungsfehler. Entscheidend ist NICHT 403 — die Tuer war offen.
    assert.notEqual(antwort.status, 403)
  })

  it('STOP UND ZUSTAND gehen auch bei abgeschaltetem Anbieter durch', async () => {
    // Eine Box mit abgeschaltetem Spotify muss einen laufenden Titel noch
    // anhalten koennen — die Verweigerung gilt nur fuer Startbefehle.
    konfigSchreiben({ mupibox: { host: 'TestBox' }, spotify: { aktiv: false }, ard: { aktiv: false } })
    for (const pfad of ['/player/x/stop', '/player/x/state']) {
      const antwort = await request(app).get(pfad)
      assert.notEqual(antwort.status, 403, pfad)
    }
  })

  it('Spotify abgeschaltet trifft nur Spotify — ein Jellyfin-Start bleibt frei', async () => {
    konfigSchreiben({
      mupibox: { host: 'TestBox' },
      spotify: { aktiv: false },
      jellyfin: { server: 'http://s', apiKey: 'k' },
    })
    const spotify = await request(app).get('/player/x/spotify/now/spotify:album:abc:1:0')
    assert.equal(spotify.status, 403)
    assert.equal(spotify.body.dienst, 'spotify')
    const jellyfin = await request(app).get('/player/x/jellyfin/http%3A%2F%2Fs/titel:title:artist:wer')
    assert.notEqual(jellyfin.status, 403)
  })

  it('eine KAPUTTE Konfiguration verweigert nichts', async () => {
    // Regel 1 des Moduls, an der Naht nachgeprueft: lieber spielt eine Box
    // mit kaputter Datei weiter, als dass sie wegen ihr verstummt.
    writeFileSync(konfigPfad, '{kaputt')
    const antwort = await request(app).get('/player/x/ard/http%3A%2F%2Fbeispiel/folge')
    assert.notEqual(antwort.status, 403)
    konfigSchreiben({ mupibox: { host: 'TestBox' } })
  })
})
