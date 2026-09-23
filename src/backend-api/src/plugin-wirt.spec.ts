import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import {
  aktivSetzen,
  allesBeenden,
  aufloesen,
  befinden,
  einstellungenSetzen,
  kannAufloesen,
  pluginsLaden,
  staende,
} from './plugin-wirt'

/**
 * Tests des Wirts — MIT ECHTEN WORKERN, nicht mit Doppeln.
 *
 * Ein Doppel haette hier keinen Wert. Die Behauptung, um die es geht, lautet
 * „ein fehlerhaftes Plugin legt den Kern nicht lahm" — und die kann nur ein
 * echter Worker widerlegen. Deshalb werden hier wirklich Plugins auf die
 * Platte geschrieben, wirklich gestartet, und es wird wirklich gewartet.
 *
 * Die Plugins unten sind absichtlich boesartig: Endlosschleife, Absturz,
 * Ausbruch aus der Medienwurzel, Griff zur eigenen Box.
 */

const WURZEL = fs.mkdtempSync(path.join(os.tmpdir(), 'mupi-plugins-'))
const DATEN = fs.mkdtempSync(path.join(os.tmpdir(), 'mupi-plugindaten-'))
const MEDIEN = '/home/dietpi/MuPiBox/media'

function pluginSchreiben(kennung: string, rechte: string[], quelltext: string, felder: unknown[] = []): void {
  const ordner = path.join(WURZEL, kennung)
  fs.mkdirSync(ordner, { recursive: true })
  fs.writeFileSync(
    path.join(ordner, 'plugin.json'),
    JSON.stringify({ kennung, name: kennung, fassung: '1.0.0', haupt: 'index.mjs', rechte, felder }, null, 2),
  )
  fs.writeFileSync(path.join(ordner, 'index.mjs'), quelltext)
}

/** Warten, bis alle Plugins fertig geladen sind (oder gescheitert). */
async function bereitAbwarten(bisMs = 8000): Promise<void> {
  const ende = Date.now() + bisMs
  while (Date.now() < ende) {
    if (staende().every((s) => s.zustand !== 'laedt')) return
    await new Promise((f) => setTimeout(f, 25))
  }
}

before(async () => {
  // Der brave Fall.
  pluginSchreiben(
    'brav',
    ['medienquelle', 'netz'],
    `export default {
       async aufloesen(rest) {
         return { titel: { name: 'Folge ' + rest }, quelle: { art: 'strom', adresse: 'https://example.org/' + rest + '.mp3' } }
       },
       async befinden() { return { ok: true, text: 'alles gut' } },
     }`,
  )

  // Dreht durch, sobald man es etwas fragt.
  pluginSchreiben('endlos', ['medienquelle'], `export default { aufloesen() { while (true) {} } }`)

  // Will aus der Medienwurzel ausbrechen.
  pluginSchreiben(
    'ausbrecher',
    ['medienquelle'],
    `export default {
       async aufloesen() {
         return { titel: { name: 'harmlos' }, quelle: { art: 'datei', adresse: '/etc/shadow' } }
       },
     }`,
  )

  // Hat kein Netz-Recht, versucht es trotzdem.
  pluginSchreiben(
    'ohnenetz',
    ['medienquelle'],
    `export default {
       async aufloesen(rest, kontext) {
         if (!kontext.holen) throw new Error('kein Netz-Recht — genau so soll es sein')
         return { titel: { name: 'x' }, quelle: { art: 'strom', adresse: 'https://example.org/x.mp3' } }
       },
     }`,
  )

  // Hat Netz, greift aber zur eigenen Box.
  pluginSchreiben(
    'kurzerweg',
    ['medienquelle', 'netz'],
    `export default {
       async aufloesen(rest, kontext) {
         await kontext.holen('http://127.0.0.1:5005/spotify/now/spotify:album:4711')
         return { titel: { name: 'x' }, quelle: { art: 'strom', adresse: 'https://example.org/x.mp3' } }
       },
     }`,
  )

  // Geht ueber eine Schleifenadresse, die NICHT auf einer Schnittstelle liegt.
  //
  // WARUM DIESER FALL EIGENS DASTEHT: `kurzerweg` oben trifft 127.0.0.1, und
  // die steht ohnehin in `eigeneAdressen`. Beide Riegel greifen dort, der Test
  // konnte also nicht sagen, ob der Schleifen-Riegel ueberhaupt etwas tut —
  // die Gegenprobe (tools/plugin-gegenprobe.sh) hat genau das aufgedeckt: mit
  // ausgebautem Schleifen-Riegel blieb alles gruen. 127.0.0.2 liegt auf keiner
  // Schnittstelle, geht aber trotzdem zur eigenen Maschine. Nur `startsWith('127.')`
  // faengt sie.
  pluginSchreiben(
    'schleife',
    ['medienquelle', 'netz'],
    `export default {
       async aufloesen(rest, kontext) {
         await kontext.holen('http://127.0.0.2:5005/current/stop')
         return { titel: { name: 'x' }, quelle: { art: 'strom', adresse: 'https://example.org/x.mp3' } }
       },
     }`,
  )

  // Gibt zurueck, was in seinen Einstellungen steht — damit sich pruefen
  // laesst, ob eine Aenderung wirklich ankommt.
  pluginSchreiben(
    'sagtwas',
    ['medienquelle'],
    `export default {
       async aufloesen(rest, kontext) {
         return {
           titel: { name: String(kontext.einstellungen.spruch), kuenstler: String(kontext.einstellungen.geheimnis) },
           quelle: { art: 'strom', adresse: 'https://example.org/x.mp3' },
         }
       },
     }`,
    [
      { schluessel: 'spruch', art: 'text', name: 'Spruch', vorgabe: 'Vorgabe' },
      { schluessel: 'geheimnis', art: 'geheim', name: 'Geheimnis' },
    ],
  )

  // Laedt gar nicht erst.
  pluginSchreiben('kaputt', [], 'dies ist kein gueltiges JavaScript {{{')

  // BENUTZT seinen Datenordner, statt ihn nur zu melden: es schreibt eine
  // Datei hinein und gibt den Pfad zurueck. Ein Ordner, in den nie jemand
  // schreibt, ist keine Zusage — nur ein Name.
  pluginSchreiben(
    'merktsich',
    [],
    `import { writeFileSync } from 'node:fs'
     import { join } from 'node:path'
     export default {
       async aufloesen(rest, kontext) {
         if (kontext.datenOrdner) writeFileSync(join(kontext.datenOrdner, 'stand.json'), '{"n":1}')
         return {
           titel: { name: String(kontext.datenOrdner ?? 'KEINER'), kuenstler: 'x', dauerSek: 1 },
           quelle: { art: 'strom', adresse: 'https://example.org/x.mp3' },
         }
       },
     }`,
  )

  pluginsLaden(WURZEL, {}, [], DATEN)
  await bereitAbwarten()
})

after(async () => {
  await allesBeenden()
  fs.rmSync(WURZEL, { recursive: true, force: true })
  fs.rmSync(DATEN, { recursive: true, force: true })
})

describe('Laden', () => {
  it('laedt die brauchbaren Plugins und meldet, was sie koennen', () => {
    const s = staende().find((x) => x.kennung === 'brav')
    assert.equal(s?.zustand, 'bereit')
    assert.equal(s?.kann.aufloesen, true)
    assert.equal(s?.kann.suchen, false)
    assert.equal(kannAufloesen('brav'), true)
  })

  it('ein Plugin, das nicht laedt, reisst die anderen NICHT mit', () => {
    // Die eigentliche Zusage von Vorgabe 1, in einer Zeile pruefbar.
    const kaputt = staende().find((x) => x.kennung === 'kaputt')
    assert.equal(kaputt?.zustand, 'gescheitert')
    assert.ok(kaputt?.grund, 'der Grund muss im Klartext dastehen')
    assert.equal(staende().find((x) => x.kennung === 'brav')?.zustand, 'bereit')
  })

  it('weist ab, was kein gueltiges Manifest hat — mit lesbarem Grund', () => {
    const ordner = path.join(WURZEL, 'namenlos')
    fs.mkdirSync(ordner, { recursive: true })
    fs.writeFileSync(path.join(ordner, 'plugin.json'), JSON.stringify({ name: 'ohne Kennung' }))
    const erg = pluginsLaden(WURZEL)
    const a = erg.abgewiesen.find((x) => x.ordner === 'namenlos')
    assert.ok(a, 'namenlos haette abgewiesen werden muessen')
    assert.match(a.maengel.join(' '), /kennung/i)
    fs.rmSync(ordner, { recursive: true, force: true })
  })
})

describe('Der Datenordner je Plugin', () => {
  it('entsteht beim LADEN, nicht beim ersten Schreiben', () => {
    // Ein Plugin, das ihn selbst anlegen muesste, koennte es vergessen — und
    // dann faellt sein Zustand beim ersten Fehler auf, nicht beim Einrichten.
    assert.equal(fs.existsSync(path.join(DATEN, 'merktsich')), true)
    assert.equal(fs.existsSync(path.join(DATEN, 'brav')), true, 'jedes Plugin bekommt einen')
  })

  it('gehoert JE KENNUNG genau einem — kein gemeinsamer Topf', () => {
    const eigene = fs.readdirSync(DATEN).sort()
    assert.ok(eigene.includes('merktsich') && eigene.includes('brav'), eigene.join(', '))
  })

  it('das Plugin bekommt ihn im Kontext und kann darin SCHREIBEN', async () => {
    const t = await aufloesen('merktsich', 'egal', '/tmp')
    assert.equal(t.titel.name, path.join(DATEN, 'merktsich'))
    assert.equal(fs.existsSync(path.join(DATEN, 'merktsich', 'stand.json')), true)
  })

  it('liegt NICHT im Plugin-Ordner selbst', () => {
    // Sonst waere er beim naechsten Ausrollen weg: der Plugin-Ordner kommt aus
    // dem Repo, der Zustand gehoert der Box.
    assert.equal(fs.existsSync(path.join(WURZEL, 'merktsich', 'stand.json')), false)
  })
})

describe('Aufloesen', () => {
  it('reicht einen sauberen Fund durch', async () => {
    const f = await aufloesen('brav', '4711', MEDIEN)
    assert.equal(f.titel.name, 'Folge 4711')
    assert.equal(f.quelle.adresse, 'https://example.org/4711.mp3')
  })

  it('meldet sich fuer ein Plugin, das es nicht gibt', async () => {
    await assert.rejects(() => aufloesen('gibtsnicht', 'x', MEDIEN), /kein Plugin/)
  })
})

describe('Die boesartigen Faelle', () => {
  it('bricht eine Endlosschleife ab, statt den Kern haengen zu lassen', async () => {
    // OHNE FRIST WAERE DIESER TEST EIN HAENGER, KEIN ROTER TEST — genau das ist
    // der Unterschied, um den es geht. Der Aufruf muss ZURUECKKOMMEN.
    const start = Date.now()
    await assert.rejects(() => aufloesen('endlos', 'x', MEDIEN), /nicht geantwortet/)
    const gedauert = Date.now() - start
    assert.ok(gedauert < 15000, `haette binnen der Frist zurueckkommen muessen, brauchte ${gedauert} ms`)

    // UND DER KERN LEBT. Das ist der eigentliche Prueftext dieser Datei.
    const f = await aufloesen('brav', 'danach', MEDIEN)
    assert.equal(f.titel.name, 'Folge danach')
  })

  it('laesst kein /etc/shadow durch, auch wenn das Plugin es hoeflich verpackt', async () => {
    await assert.rejects(() => aufloesen('ausbrecher', 'x', MEDIEN), /nichts Abspielbares|Medienwurzel/)
  })

  it('gibt einem Plugin ohne Netz-Recht kein `holen`', async () => {
    await assert.rejects(() => aufloesen('ohnenetz', 'x', MEDIEN), /kein Netz-Recht/)
  })

  it('verwehrt den kurzen Weg zur eigenen Box', async () => {
    await assert.rejects(() => aufloesen('kurzerweg', 'x', MEDIEN), /eigene Box|Box selbst/)
  })

  it('verwehrt auch eine Schleifenadresse, die auf keiner Schnittstelle liegt', async () => {
    // 127.0.0.2 steht in KEINER Schnittstellenliste — hier haelt allein der
    // Schleifen-Riegel. Ohne diesen Test waere er ungeprueft (Gegenprobe).
    await assert.rejects(() => aufloesen('schleife', 'x', MEDIEN), /eigene Box/)
  })

  it('beantwortet `befinden` auch fuer ein gescheitertes Plugin, statt zu werfen', async () => {
    const b = await befinden('kaputt')
    assert.equal(b.ok, false)
  })

  it('reicht die MELDUNG nach aussen, nicht den Stapel', async () => {
    // AM GERAET AUFGEFALLEN (14.08.2026), nicht hier: die HTTP-Antwort trug
    // den vollen Stapel samt `/home/dietpi/.mupibox/…/plugin-laufwerk.js:1:1172`
    // und dem Pfad des Plugins nach draussen.
    //
    // WARUM KEIN TEST DAS FAND: alle prueften, was DRINSTEHT (`assert.rejects`
    // mit einem Muster) — und das Muster passte, der Stapel lief nur nebenher
    // mit. Dieser Test prueft, was NICHT drinsteht. Das ist die Sorte
    // Behauptung, die man leicht auslaesst und die genau deshalb faellt.
    const f = await aufloesen('kurzerweg', 'x', MEDIEN).then(
      () => null,
      (e: Error) => e,
    )
    assert.ok(f, 'haette scheitern muessen')
    assert.match(f.message, /eigene Box/)
    assert.ok(!f.message.includes('\n    at '), `Stapel in der Meldung: ${f.message}`)
    assert.ok(!f.message.includes('plugin-laufwerk'), `Dateipfad in der Meldung: ${f.message}`)
    assert.ok(!f.message.includes('/home/'), `Pfad der Box in der Meldung: ${f.message}`)
  })
})

describe('Einstellungen', () => {
  it('gibt die Vorgaben aus dem Manifest, wenn nichts abgelegt ist', async () => {
    const f = await aufloesen('sagtwas', 'x', MEDIEN)
    assert.equal(f.titel.name, 'Vorgabe')
  })

  it('meldet die angemeldeten Felder — sonst waere jede Eingabe Raten', () => {
    const felder = staende().find((x) => x.kennung === 'sagtwas')?.felder ?? []
    assert.equal(felder.length, 2)
    assert.equal(felder[0].schluessel, 'spruch')
    assert.equal(felder[1].art, 'geheim')
  })

  it('eine Aenderung kommt WIRKLICH beim Plugin an', async () => {
    // DAS IST DER PUNKT DER GANZEN UEBUNG. Der Kontext wird im Laufwerk EINMAL
    // gebaut und eingefroren — ohne Neustart saehe das Plugin die neue Adresse
    // nie, und der Benutzer haette gespeichert, ohne dass etwas geschieht.
    await einstellungenSetzen('sagtwas', { spruch: 'geaendert', geheimnis: 'hunter2' })
    await bereitAbwarten()
    const f = await aufloesen('sagtwas', 'x', MEDIEN)
    assert.equal(f.titel.name, 'geaendert')
    assert.equal(f.titel.kuenstler, 'hunter2')
  })

  it('verliert das Geheimnis nicht, wenn es leer zurueckkommt', async () => {
    // Der Eltern-Bereich zeigt Geheimnisse maskiert an. Schickt er alles
    // zurueck, darf das leere Feld den echten Wert nicht wegwischen.
    await einstellungenSetzen('sagtwas', { spruch: 'noch anders', geheimnis: '' })
    await bereitAbwarten()
    const f = await aufloesen('sagtwas', 'x', MEDIEN)
    assert.equal(f.titel.name, 'noch anders')
    assert.equal(f.titel.kuenstler, 'hunter2', 'das Geheimnis muss stehen geblieben sein')
  })

  it('laeuft nach der Aenderung nur EIN Worker', async () => {
    // Der exit-Behandler startet ein gestorbenes Plugin neu. Wer beim Wechsel
    // nicht zuerst den Zustand setzt, hat danach zwei Worker auf derselben
    // Kennung — und der zweite beantwortet Rufe, die dem ersten galten.
    const vorher = staende().filter((s) => s.kennung === 'sagtwas').length
    await einstellungenSetzen('sagtwas', { spruch: 'dritte', geheimnis: '' })
    await bereitAbwarten()
    assert.equal(staende().filter((s) => s.kennung === 'sagtwas').length, vorher)
    const f = await aufloesen('sagtwas', 'x', MEDIEN)
    assert.equal(f.titel.name, 'dritte')
  })

  it('meldet sich fuer ein Plugin, das es nicht gibt', async () => {
    await assert.rejects(() => einstellungenSetzen('gibtsnicht', {}), /kein Plugin/)
  })
})

describe('Abschalten', () => {
  it('startet ein abgeschaltetes Plugin gar nicht erst', async () => {
    // DAS IST DER PUNKT: kein Worker, kein Speicher. Ein „abgeschaltet", das
    // im Speicher weiterlaeuft, waere eine Beschriftung und keine Wirkung.
    await allesBeenden()
    pluginsLaden(WURZEL, {}, ['brav'])
    await bereitAbwarten()
    assert.equal(staende().find((s) => s.kennung === 'brav')?.zustand, 'aus')
    assert.equal(kannAufloesen('brav'), false)
    await assert.rejects(() => aufloesen('brav', 'x', MEDIEN), /nicht bereit/)
  })

  it('holt es mit einem Schalter zurueck — samt seiner Einstellungen', async () => {
    await einstellungenSetzen('sagtwas', { spruch: 'ueberlebt', geheimnis: '' })
    await aktivSetzen('sagtwas', false)
    assert.equal(staende().find((s) => s.kennung === 'sagtwas')?.zustand, 'aus')

    await aktivSetzen('sagtwas', true)
    await bereitAbwarten()
    assert.equal(staende().find((s) => s.kennung === 'sagtwas')?.zustand, 'bereit')
    const f = await aufloesen('sagtwas', 'x', MEDIEN)
    assert.equal(f.titel.name, 'ueberlebt', 'die Einstellungen muessen das Abschalten ueberlebt haben')
  })

  it('ein Speichern schaltet ein abgeschaltetes Plugin NICHT ein', async () => {
    // Die Hintertuer: `einstellungenSetzen` startet den Worker neu. Wer die
    // Adresse eines ausgeschalteten Lichts korrigiert, will sie korrigieren —
    // nicht das Licht anmachen.
    await aktivSetzen('sagtwas', false)
    await einstellungenSetzen('sagtwas', { spruch: 'trotzdem aus', geheimnis: '' })
    await bereitAbwarten()
    assert.equal(staende().find((s) => s.kennung === 'sagtwas')?.zustand, 'aus')

    // Und beim Einschalten gilt der neue Wert.
    await aktivSetzen('sagtwas', true)
    await bereitAbwarten()
    assert.equal((await aufloesen('sagtwas', 'x', MEDIEN)).titel.name, 'trotzdem aus')
  })

  it('bekommt keine Ereignisse, solange es aus ist', async () => {
    await aktivSetzen('sagtwas', false)
    // `ereignisStreuen` wirft nie und wartet nicht — geprueft wird also, dass
    // der Eintrag nicht als bereit gilt. Das ist die Bedingung, an der das
    // Streuen entscheidet.
    assert.equal(staende().find((s) => s.kennung === 'sagtwas')?.zustand, 'aus')
    await aktivSetzen('sagtwas', true)
    await bereitAbwarten()
  })

  it('meldet sich fuer ein Plugin, das es nicht gibt', async () => {
    await assert.rejects(() => aktivSetzen('gibtsnicht', false), /kein Plugin/)
  })
})
