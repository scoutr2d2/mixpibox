/**
 * DER VERTRAG ZWISCHEN DEM SCHIRM DER BOX UND /api/wlan-adapter.
 *
 * Die Adapterwahl gibt es an ZWEI Stellen: in der Browser-Verwaltung
 * (src/frontend-admin/…/netzwerk.ts) und seit dem 20.08.2026 auch auf dem
 * Schirm der Box selbst (NewDesign/app.js).
 *
 * WARUM AUF DEM SCHIRM UEBERHAUPT: Der Wechsel gibt der Box eine ANDERE
 * Adresse. Die Verwaltung im Browser verliert dabei zwangslaeufig ihre
 * Verbindung; der Schirm der Box redet mit 127.0.0.1 und merkt davon nichts.
 * Er ist damit der einzige Ort, an dem das Umschalten gefahrlos ist.
 *
 * ══ WAS DIESER TEST PRUEFT — UND WAS NICHT ═════════════════════════════════
 *
 * Er prueft den VERTRAG, nicht die Darstellung: dass die Werte, die der Schirm
 * schickt, genau die sind, die die Route annimmt. Benennt jemand in server.ts
 * `intern`/`extern` um, faellt das hier auf — sonst erst am Geraet, als Knopf,
 * der nichts tut.
 *
 * ER PRUEFT NICHT, OB DIE ZEILE GUT AUSSIEHT. Das braucht einen Bildschirm.
 *
 * Und er sucht NICHT nach blossen Zeichenketten irgendwo in der Datei: die
 * ueberleben einen auskommentierten Aufruf. Geprueft wird der Block, in dem
 * die Zeile gebaut wird, und die Bedingung, unter der sie erscheint.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const APP = new URL('../../../NewDesign/app.js', import.meta.url)
const SERVER = new URL('./server.ts', import.meta.url)

const app = readFileSync(APP, 'utf8')
const server = readFileSync(SERVER, 'utf8')

/** Der Rumpf von `wlanAdapterWaehlen` — nicht die ganze Datei. */
function waehlenBlock(): string {
  const ab = app.indexOf('async wlanAdapterWaehlen(')
  assert.ok(ab > 0, 'wlanAdapterWaehlen fehlt in NewDesign/app.js')
  // Bis zur naechsten Methode auf derselben Ebene.
  const rest = app.slice(ab)
  const ende = rest.indexOf('\n    },')
  assert.ok(ende > 0, 'Ende von wlanAdapterWaehlen nicht gefunden')
  return rest.slice(0, ende)
}

/** Der Block, der die Umschaltzeile baut. */
function zeilenBlock(): string {
  const ab = app.indexOf('// ── 2b. WELCHER FUNKBAUSTEIN')
  assert.ok(ab > 0, 'Der Abschnitt 2b fehlt in funkMalen')
  const rest = app.slice(ab)
  const ende = rest.indexOf('// ── 3. FLUGMODUS')
  assert.ok(ende > 0, 'Abschnitt 3 folgt nicht auf 2b — die Reihenfolge ist verrutscht')
  return rest.slice(0, ende)
}

describe('Adapterwahl auf dem Schirm der Box — der Vertrag mit /api/wlan-adapter', () => {
  it('schickt genau die Werte, die die Route annimmt', () => {
    // DIE EIGENTLICHE PRUEFUNG. Die Route laesst nur zwei Woerter durch:
    //     if (ziel !== 'intern' && ziel !== 'extern') -> 400
    // Wer eines davon umbenennt, baut einen Knopf, der still nichts tut.
    const pruefung = server.match(/ziel !== '(\w+)' && ziel !== '(\w+)'/)
    assert.ok(pruefung, 'Die Pruefung in POST /api/wlan-adapter sieht anders aus als erwartet')
    const erlaubt = new Set([pruefung[1], pruefung[2]])

    // AN DER RICHTIGEN STELLE FESTMACHEN. Die erste Fassung dieses Tests
    // sammelte alle Vorkommen von 'intern'/'extern' im Block — und blieb
    // deshalb gruen, als der GESENDETE Wert auf 'usb' verbogen wurde: die
    // Vergleiche daneben (`ad.aktiv === 'extern'`) hielten die Menge
    // vollstaendig. Geprueft gehoert die Zuweisung, die im Aufruf landet.
    const block = zeilenBlock()
    const zuweisung = block.match(/const ziel = \w+ \? '([^']*)' : '([^']*)'/)
    assert.ok(zuweisung, 'Die Zuweisung von `ziel` sieht anders aus als erwartet')
    const gesendet = [zuweisung[1], zuweisung[2]]
    for (const w of gesendet) {
      assert.ok(erlaubt.has(w), `Der Schirm schickt '${w}', die Route kennt nur ${[...erlaubt].join('/')}`)
    }
    assert.equal(new Set(gesendet).size, 2, 'Beide Richtungen muessen erreichbar sein, sonst ist es ein Einbahnknopf')
    assert.match(block, /this\.wlanAdapterWaehlen\(ziel\)/, 'Der Knopf schickt etwas anderes als `ziel`')

    // Auch der VERGLEICH muss zur Route passen — sonst zeigt die Zeile
    // dauerhaft in die falsche Richtung.
    const verglichen = block.match(/ad\.aktiv === '([^']*)'/)
    assert.ok(verglichen, 'Der Block vergleicht `ad.aktiv` nicht mehr')
    assert.ok(erlaubt.has(verglichen[1]), `Verglichen wird mit '${verglichen[1]}', das kennt die Route nicht`)
  })

  it('ruft dieselbe Adresse auf, unter der die Route liegt', () => {
    assert.ok(/app\.post\('\/api\/wlan-adapter'/.test(server), 'Die Route heisst nicht mehr /api/wlan-adapter')
    const block = waehlenBlock()
    assert.match(block, /API \+ '\/wlan-adapter'/, 'Der Schirm ruft eine andere Adresse')
    // AUF DAS VERB, NICHT AUF DIE SCHREIBWEISE (berichtigt 19.09.2026).
    //
    // Hier stand `/method:\s*'POST'/`. Das galt, solange der Schirm den Ruf
    // von Hand schrieb. Seit dem `sendeJson`-Umbau (Rang 11) steht das Verb
    // als ZWEITER PARAMETER — derselbe POST, andere Schreibweise, und der
    // Zeuge fiel, obwohl die Sache stimmte.
    //
    // Beide Formen gelten deshalb ausdruecklich, und zwar mit der Adresse im
    // Muster: ein `method: 'POST'` IRGENDWO im Block wuerde sonst auch dann
    // passen, wenn es zu einem ganz anderen Ruf daneben gehoert.
    assert.match(
      block,
      /sendeJson\(\s*API \+ '\/wlan-adapter',\s*'POST'|fetch\(\s*API \+ '\/wlan-adapter',[\s\S]{0,200}?method:\s*'POST'/,
      'Ohne POST aendert sich nichts',
    )
  })

  it('zeigt die Zeile NUR, wenn wirklich ein Stick da ist', () => {
    // Ohne diese Bedingung stuende dort dauerhaft eine Wahl, die es nicht
    // gibt — und der Knopf liefe in den 409 der Route („Kein WLAN-Stick am
    // USB gefunden"). Ein Knopf, der zuverlaessig scheitert, ist schlimmer
    // als keiner.
    const block = zeilenBlock()
    assert.match(block, /ad\.extern\.da/, 'Die Zeile prueft nicht, ob ein Stick vorhanden ist')
    assert.match(block, /ad && ad\.extern/, 'Ohne Stand darf keine Zeile erscheinen')
    assert.ok(/409/.test(server), 'Die Route sollte den fehlenden Stick weiterhin mit 409 abweisen')
  })

  it('erfindet keinen Stand, wenn die Auskunft ausbleibt', () => {
    // „Ich weiss es nicht" ist eine eigene Aussage. Wer hier auf ein leeres
    // Objekt zurueckfaellt, laesst den Umschalter genau dann verschwinden,
    // wenn man ihn braucht — oder zeigt ihn falsch herum.
    const ab = app.indexOf('async wlanAdapterHolen(')
    assert.ok(ab > 0, 'wlanAdapterHolen fehlt')
    const block = app.slice(ab, ab + 900)
    assert.match(block, /this\.wlanAdapter = a\.ok \? await a\.json\(\) : null/, 'Kein sauberer Fehlfall')
    assert.match(block, /catch \{\s*this\.wlanAdapter = null/, 'Ein Fehler muss auf null fuehren')
  })

  it('fragt den Stand NACH dem Umschalten neu — und nicht zu frueh', () => {
    // Die Route faehrt erst das Ziel hoch, wartet `sleep 8` und legt dann das
    // alte hin. Wer vorher fragt, bekommt den Stand von vorhin und haelt das
    // Umschalten fuer wirkungslos.
    const wartet = server.match(/sleep (\d+); *`? *\+/) || server.match(/sleep (\d+);/)
    assert.ok(wartet, 'Die Wartezeit in der Route ist nicht mehr zu finden')
    const serverSek = Number(wartet[1])

    const block = waehlenBlock()
    const nach = block.match(/setTimeout\(\(\) => void this\.funkHolen\(\), (\d+)\)/)
    assert.ok(nach, 'Nach dem Umschalten wird der Stand nicht neu geholt')
    assert.ok(
      Number(nach[1]) > serverSek * 1000,
      `Der Schirm fragt nach ${nach[1]} ms, die Route braucht aber ${serverSek} s`,
    )
  })
})
