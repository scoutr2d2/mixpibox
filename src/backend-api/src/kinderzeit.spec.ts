import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  abbrechen,
  istStartbefehl,
  minutenAusZeit,
  pruefen,
  type Regeln,
  regelnFuer,
  regelnNormalisieren,
  regelnVorgabe,
  regelSatzNormalisieren,
  tagesSchluessel,
  verbrauchFuerHeute,
} from './kinderzeit'

/**
 * Tests der Kinderzeit-Regel.
 *
 * Die Uhr wird HEREINGEGEBEN, deshalb ist jede Tageszeit und jeder Wochentag
 * pruefbar, ohne zu warten. Genau darum ist die Logik pur: eine Regel, die
 * erst um 19:31 an einem Sonntag falsch entscheidet, faende man sonst nie.
 *
 * Die Daten unten sind echte Wochentage: 2026-07-27 ist ein Montag,
 * 2026-08-01 ein Samstag, 2026-08-02 ein Sonntag.
 */

const um = (datum: string, zeit: string) => new Date(`${datum}T${zeit}:00`)

function regeln(patch: Partial<Regeln> = {}): Regeln {
  return { ...regelnVorgabe(), aktiv: true, ...patch }
}

/** Montag: ab 07:00 bis 19:30, 90 Minuten. */
function schultag(): Regeln {
  const r = regeln()
  r.tage.mo = { frei: true, ab: '07:00', bis: '19:30', minuten: 90 }
  return r
}

describe('Zeit lesen', () => {
  it('liest HH:MM und weist Unsinn ab', () => {
    assert.equal(minutenAusZeit('07:00'), 420)
    assert.equal(minutenAusZeit('7:05'), 425)
    assert.equal(minutenAusZeit('23:59'), 1439)
    for (const schlecht of ['', '24:00', '12:60', 'abends', '7', null, 7]) {
      assert.equal(minutenAusZeit(schlecht as unknown), null, String(schlecht))
    }
  })

  it('bildet den Tagesschluessel in ORTSZEIT', () => {
    // Spaet am Abend: mit UTC waere hier schon der Folgetag - und der Zaehler
    // eines Kindes wuerde abends grundlos zurueckspringen.
    assert.equal(tagesSchluessel(um('2026-07-27', '23:30')), '2026-07-27')
    assert.equal(tagesSchluessel(um('2026-07-27', '00:10')), '2026-07-27')
  })
})

describe('Kinderzeit aus', () => {
  it('erlaubt alles und begrenzt nichts', () => {
    const u = pruefen(regelnVorgabe(), verbrauchFuerHeute(null, um('2026-07-27', '03:00')), um('2026-07-27', '03:00'))
    assert.equal(u.erlaubt, true)
    assert.equal(u.grund, 'aus')
    assert.equal(u.restMin, null)
  })
})

describe('Zeitfenster', () => {
  it('sperrt vor dem Beginn und gibt den Beginn an', () => {
    const u = pruefen(schultag(), verbrauchFuerHeute(null, um('2026-07-27', '06:59')), um('2026-07-27', '06:59'))
    assert.equal(u.erlaubt, false)
    assert.equal(u.grund, 'zuFrueh')
    assert.equal(u.fensterAb, '07:00')
  })

  it('erlaubt AB der Minute des Beginns', () => {
    const u = pruefen(schultag(), verbrauchFuerHeute(null, um('2026-07-27', '07:00')), um('2026-07-27', '07:00'))
    assert.equal(u.erlaubt, true)
    assert.equal(u.grund, 'frei')
  })

  it('sperrt AB der Minute des Endes, nicht erst danach', () => {
    // 19:30 ist das Ende - um 19:30 ist Schluss, nicht erst um 19:31.
    const auf = pruefen(schultag(), verbrauchFuerHeute(null, um('2026-07-27', '19:29')), um('2026-07-27', '19:29'))
    const zu = pruefen(schultag(), verbrauchFuerHeute(null, um('2026-07-27', '19:30')), um('2026-07-27', '19:30'))
    assert.equal(auf.erlaubt, true)
    assert.equal(zu.erlaubt, false)
    assert.equal(zu.grund, 'zuSpaet')
  })

  it('kennt Tage ohne Fenster', () => {
    const r = regeln()
    r.tage.sa = { frei: true, ab: '', bis: '', minuten: 0 }
    const u = pruefen(r, verbrauchFuerHeute(null, um('2026-08-01', '05:00')), um('2026-08-01', '05:00'))
    assert.equal(u.erlaubt, true)
    assert.equal(u.restMin, null)
  })
})

describe('Wochentage', () => {
  it('sperrt einen ganzen Tag', () => {
    const r = regeln()
    r.tage.so = { frei: false, ab: '', bis: '', minuten: 0 }
    const u = pruefen(r, verbrauchFuerHeute(null, um('2026-08-02', '10:00')), um('2026-08-02', '10:00'))
    assert.equal(u.erlaubt, false)
    assert.equal(u.grund, 'tagGesperrt')
  })

  it('nimmt die Regel des RICHTIGEN Wochentags', () => {
    const r = regeln()
    r.tage.mo = { frei: false, ab: '', bis: '', minuten: 0 }
    r.tage.sa = { frei: true, ab: '', bis: '', minuten: 0 }
    const mo = um('2026-07-27', '10:00')
    const sa = um('2026-08-01', '10:00')
    assert.equal(pruefen(r, verbrauchFuerHeute(null, mo), mo).erlaubt, false)
    assert.equal(pruefen(r, verbrauchFuerHeute(null, sa), sa).erlaubt, true)
  })
})

describe('Tagesdauer und Guthaben', () => {
  it('zaehlt verbrauchte Minuten vom Guthaben ab', () => {
    const jetzt = um('2026-07-27', '10:00')
    const u = pruefen(schultag(), { tag: '2026-07-27', sekunden: 30 * 60, bonusMin: 0 }, jetzt)
    assert.equal(u.erlaubt, true)
    assert.equal(u.restMin, 60)
  })

  it('sperrt, wenn die Dauer aufgebraucht ist', () => {
    const jetzt = um('2026-07-27', '10:00')
    const u = pruefen(schultag(), { tag: '2026-07-27', sekunden: 90 * 60, bonusMin: 0 }, jetzt)
    assert.equal(u.erlaubt, false)
    assert.equal(u.grund, 'aufgebraucht')
    assert.equal(u.restMin, 0)
  })

  it('rechnet geschenkte Minuten dazu', () => {
    const jetzt = um('2026-07-27', '10:00')
    const u = pruefen(schultag(), { tag: '2026-07-27', sekunden: 90 * 60, bonusMin: 20 }, jetzt)
    assert.equal(u.erlaubt, true)
    assert.equal(u.restMin, 20)
  })

  it('setzt Zaehler UND Geschenk am neuen Tag zurueck', () => {
    // Ein einmaliges Zugestaendnis darf nicht dauerhaft gelten.
    const gestern = { tag: '2026-07-26', sekunden: 90 * 60, bonusMin: 30 }
    const v = verbrauchFuerHeute(gestern, um('2026-07-27', '08:00'))
    assert.equal(v.tag, '2026-07-27')
    assert.equal(v.sekunden, 0)
    assert.equal(v.bonusMin, 0)
  })

  it('behandelt das Fenster unabhaengig von der Dauer', () => {
    // Guthaben ueber, aber ausserhalb des Fensters: trotzdem Schluss.
    const jetzt = um('2026-07-27', '20:00')
    const u = pruefen(schultag(), { tag: '2026-07-27', sekunden: 0, bonusMin: 0 }, jetzt)
    assert.equal(u.erlaubt, false)
    assert.equal(u.grund, 'zuSpaet')
    assert.equal(u.restMin, 90)
  })
})

describe('Kaputte Konfiguration sperrt NICHT aus', () => {
  it('biegt Unsinn auf die freundliche Seite', () => {
    const r = regelnNormalisieren({ aktiv: true, tage: { mo: { ab: 'abends', bis: 99, minuten: -5 } } })
    assert.equal(r.tage.mo.frei, true)
    assert.equal(r.tage.mo.ab, '')
    assert.equal(r.tage.mo.bis, '')
    assert.equal(r.tage.mo.minuten, 0)
    const jetzt = um('2026-07-27', '10:00')
    assert.equal(pruefen(r, verbrauchFuerHeute(null, jetzt), jetzt).erlaubt, true)
  })

  it('macht aus gar nichts die Vorgabe (Kinderzeit aus)', () => {
    const r = regelnNormalisieren(undefined)
    assert.equal(r.aktiv, false)
    const jetzt = um('2026-07-27', '02:00')
    assert.equal(pruefen(r, verbrauchFuerHeute(null, jetzt), jetzt).erlaubt, true)
  })

  it('deckelt masslose Werte statt sie zu uebernehmen', () => {
    const r = regelnNormalisieren({ aktiv: true, nachsichtMin: 999, tage: { mo: { minuten: 99999 } } })
    assert.equal(r.nachsichtMin, 60)
    assert.equal(r.tage.mo.minuten, 24 * 60)
  })
})

describe('Nachsicht am Ende', () => {
  const jetzt = um('2026-07-27', '10:00')
  const aufgebraucht = pruefen(schultag(), { tag: '2026-07-27', sekunden: 90 * 60, bonusMin: 0 }, jetzt)

  it('laesst den laufenden Titel zu Ende gehen', () => {
    assert.equal(abbrechen(schultag(), aufgebraucht, 0), false)
    assert.equal(abbrechen(schultag(), aufgebraucht, 4), false)
  })

  it('bricht ab, wenn die Nachsicht vorbei ist', () => {
    assert.equal(abbrechen(schultag(), aufgebraucht, 5), true)
  })

  it('kennt keine Nachsicht an gesperrten Tagen', () => {
    // Dort lief nichts, was zu Ende gehen koennte - Nachsicht waere ein Loch.
    const r = regeln()
    r.tage.so = { frei: false, ab: '', bis: '', minuten: 0 }
    const so = um('2026-08-02', '10:00')
    assert.equal(abbrechen(r, pruefen(r, verbrauchFuerHeute(null, so), so), 0), true)
  })

  it('bricht nie ab, solange erlaubt ist', () => {
    const frei = pruefen(schultag(), { tag: '2026-07-27', sekunden: 0, bonusMin: 0 }, jetzt)
    assert.equal(abbrechen(schultag(), frei, 999), false)
  })

  it('bricht nie ab, wenn die Kinderzeit aus ist', () => {
    const r = regelnVorgabe()
    const u = pruefen(r, verbrauchFuerHeute(null, jetzt), jetzt)
    assert.equal(abbrechen(r, u, 999), false)
  })
})

describe('Welche Befehle die Kinderzeit abweisen darf', () => {
  it('erkennt das Starten von Wiedergabe', () => {
    for (const p of [
      '/current/spotify/now/spotify:album:12tbwMFeUIvYg3dxKbCb8N:1:0',
      '/current/jellyfin/http%3A%2F%2Fx%2FAudio%2F1%2Fstream/Titel:title:artist:Wer',
      '/current/jfqueue/abc/Titel:title:artist:Wer',
      '/current/musicsearch/library/album/musik:Interpret:Album',
      '/current/queue/etwas',
      '/current/radio/http%3A%2F%2Fstrom/Sender:title:artist:X',
      '/current/rss/http%3A%2F%2Ffeed/Folge:title:artist:X',
      '/current/play',
      // ARD Audiothek (E4/A5, 04.08.2026). BEIDE Verben, so wie bei Jellyfin:
      // ohne sie waere die ARD der einzige Dienst, der nach dem Zubettgehen
      // weiterspielt — und zwar lautlos, ohne Fehler irgendwo.
      '/current/ard/https%3A%2F%2Fx%2Fa.mp3/Folge:title:artist:WDR',
      '/current/ardqueue/https%3A%2F%2Fx%2Fb.mp3/Folge:title:artist:WDR',
      // Plugin-Werke (E87, gefunden 31.08.2026 beim E95-Umbau): der
      // /inhalt-Zweig baut `plugin/…` und `pluginqueue/…`, der Abspieldienst
      // fuehrt beide Verben — nur diese Liste kannte sie nicht. Eine
      // Plugin-Kachel spielte damit als einzige an der Kinderzeit vorbei,
      // und ihr Start feuerte kein wiedergabeGestartet-Ereignis. Genau die
      // Luecke, die der Kommentar ueber der Liste prophezeit.
      '/current/plugin/https%3A%2F%2Fx%2Fc.mp3/Folge:title:artist:Podcast',
      '/current/pluginqueue/https%3A%2F%2Fx%2Fd.mp3/Folge:title:artist:Podcast',
      // Die Mischliste (E108): lokale Spuren als Einzeltitel — datei startet,
      // dateiqueue fuellt die Warteschlange. Beide sind Starts wie jfqueue:
      // ein Anhaengen ohne Grenze fuellte sie nach Feierabend weiter auf.
      '/current/datei/%2Fhome%2Fdietpi%2FMuPiBox%2Fmedia%2Fmusic%2FX%2FA%2F01%20x.flac/x:title:artist:X',
      '/current/dateiqueue/%2Fhome%2Fdietpi%2FMuPiBox%2Fmedia%2Fmusic%2FX%2FA%2F02%20y.flac/y:title:artist:X',
    ]) {
      assert.equal(istStartbefehl(p), true, p)
    }
  })

  it('laesst ANHALTEN und Steuerung immer durch', () => {
    // Das ist der wichtigste Test der Datei: eine Zeitgrenze, die das
    // Ausschalten verhindert, waere schlimmer als gar keine.
    for (const p of [
      '/current/stop',
      '/current/pause',
      '/current/setvolume:40',
      '/current/seekpos:30',
      '/current/say/Gute%20Nacht',
      '/state',
      '/local',
      '/tracklist',
      '/spotify/token',
    ]) {
      assert.equal(istStartbefehl(p), false, p)
    }
  })

  it('laesst im Zweifel durch, statt zu blockieren', () => {
    // Unbekannte oder kaputte Pfade sind KEIN Startbefehl - die Box soll im
    // Zweifel spielen duerfen, nicht stumm bleiben.
    for (const p of ['', '/', '/irgendwas', null, 42]) {
      assert.equal(istStartbefehl(p as unknown), false, String(p))
    }
  })
})

describe('Regelsatz: eine Hausregel, Ausnahmen je Profil', () => {
  it('liest die ALTE Datei — ein blankes Regeln-Objekt wird zur Hausregel', () => {
    // Diese Form liegt auf jeder Box, die es schon gibt. Wuerde sie nicht
    // gelesen, faenden sich alle Kinder ploetzlich ohne Zeitgrenze wieder —
    // ein stiller Ausfall einer SICHERHEITSfunktion.
    const alt = { aktiv: true, nachsichtMin: 3, tage: { mo: { frei: true, ab: '', bis: '20:00', minuten: 45 } } }
    const satz = regelSatzNormalisieren(alt)
    assert.equal(satz.standard.aktiv, true)
    assert.equal(satz.standard.nachsichtMin, 3)
    assert.equal(satz.standard.tage.mo.minuten, 45)
    assert.deepEqual(satz.je, {})
  })

  it('liest die NEUE Datei mit standard und je', () => {
    const satz = regelSatzNormalisieren({
      standard: { aktiv: true, tage: { mo: { minuten: 60 } } },
      je: { liam: { aktiv: true, tage: { mo: { minuten: 20 } } } },
    })
    assert.equal(satz.standard.tage.mo.minuten, 60)
    assert.equal(satz.je.liam.tage.mo.minuten, 20)
  })

  it('ohne eigenen Eintrag gilt die Hausregel — auch fuer den Gast', () => {
    // DAS IST DIE ANTWORT AUF „was gilt morgens um sieben, wenn niemand
    // gewaehlt hat": genau das, was heute gilt.
    const satz = regelSatzNormalisieren({ aktiv: true, tage: { mo: { minuten: 30 } } })
    assert.equal(regelnFuer(satz, 'gast').tage.mo.minuten, 30)
    assert.equal(regelnFuer(satz, 'liam').tage.mo.minuten, 30)
    assert.equal(regelnFuer(satz, 'gast'), satz.standard)
  })

  it('ein eigener Eintrag sticht die Hausregel', () => {
    const satz = regelSatzNormalisieren({
      standard: { aktiv: true, tage: { mo: { minuten: 60 } } },
      je: { liam: { aktiv: true, tage: { mo: { minuten: 20 } } } },
    })
    assert.equal(regelnFuer(satz, 'liam').tage.mo.minuten, 20)
    assert.equal(regelnFuer(satz, 'kalea').tage.mo.minuten, 60)
  })

  it('eine Kennung, die keine ist, faellt heraus — sie wuerde ein Dateiname', () => {
    const satz = regelSatzNormalisieren({ standard: {}, je: { '../../etc': { aktiv: true } } })
    assert.deepEqual(Object.keys(satz.je), [])
  })

  it('Unsinn wird zur Vorgabe, nicht zu einer Sperre', () => {
    for (const roh of [null, undefined, 0, '', 'kaputt', [], { standard: 'nein', je: 5 }]) {
      const satz = regelSatzNormalisieren(roh)
      assert.equal(satz.standard.aktiv, false, JSON.stringify(roh))
      assert.deepEqual(satz.je, {})
    }
  })

  it('zweimal gelesen kommt dasselbe heraus — die Uebernahme darf nicht driften', () => {
    const alt = { aktiv: true, nachsichtMin: 7, tage: { fr: { frei: false } } }
    const einmal = regelSatzNormalisieren(alt)
    const zweimal = regelSatzNormalisieren(einmal)
    assert.deepEqual(zweimal, einmal)
  })
})
