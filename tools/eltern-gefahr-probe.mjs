#!/usr/bin/env node
/**
 * DIE DREI GEFAEHRLICHEN STELLEN DES ELTERN-BEREICHS — nachgestellt, nicht gelesen.
 *
 * Es gibt schon Werkzeuge, die MESSEN (Masse, Beruehrziele, Form) und welche,
 * die den WEG abgehen (Tor, Seite). Keines von ihnen fragt das hier:
 *
 *   1. DAS TOR. Kommt man an WLAN und Medien heran, OHNE es zu loesen? Nicht
 *      „ist die Flaeche versteckt" — sondern: WIRD SCHON GEHOLT, was dahinter
 *      liegt? Ein `fetch`, der vor der PIN losgeht, hat die Auskunft bereits
 *      im Haus; ein Stilfehler genuegt dann.
 *   2. DAS PASSWORT. Es wird getippt und verschickt. Danach darf es NIRGENDS
 *      mehr stehen: nicht im Baum, nicht in einem Attribut, nicht in einer
 *      Adresse, nicht in der Konsole. Gemessen wird der GANZE Baum samt
 *      Attributen, jede Adresse jeder Anfrage und jede Konsolenzeile.
 *   3. DAS LOESCHEN. Nennt die Rueckfrage den NAMEN? Und liegt der rote Knopf
 *      dort, wo eben noch ein harmloser lag — trifft ein zweiter Tipp auf
 *      dieselbe Stelle also das Loeschen? Beides wird mit ECHTEN Beruehrungen
 *      an ECHTEN Bildpunkten gefahren, nicht mit `element.click()`.
 *
 * Aufruf (eigene Vorschau, eigener Port!):
 *     node tools/eltern-gefahr-probe.mjs http://127.0.0.1:8911/neu/
 *     node tools/eltern-gefahr-probe.mjs            # eigene Vorschau, freier Port
 *
 * Rueckgabe: 0, wenn alle Aussagen halten, sonst 1.
 */

import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { browserSuchen, eigenerBrowser, freierPort } from './leihgabe.mjs'
import { adminAufHalten } from './admin-weg.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const MITGEGEBEN = process.argv.slice(2).find((a) => a.startsWith('http')) || null
/** `--bild <praefix>` legt zu den drei heiklen Schirmen je ein Bild ab. */
const BILD = (() => {
  const i = process.argv.indexOf('--bild')
  return i > 0 ? process.argv[i + 1] : null
})()
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

/** Das Passwort dieser Probe. Erfunden, aber unverwechselbar — es wird gesucht. */
const GEHEIM = 'kuckucksei'

const befunde = []
function sagen(gut, wort, dazu = '') {
  befunde.push({ gut, wort })
  console.log(`${gut ? 'ok  ' : 'NEIN'}  ${wort}${dazu ? `  — ${dazu}` : ''}`)
}

if (!browserSuchen()) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

let vorschau = null
let ZIEL = MITGEGEBEN
process.on('exit', () => {
  try {
    vorschau?.kill()
  } catch {
    /* schon weg */
  }
})

if (!ZIEL) {
  const p = await freierPort()
  ZIEL = `http://127.0.0.1:${p}/neu/`
  vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', '--port', String(p)], { cwd: WURZEL, stdio: 'ignore' })
  vorschau.unref()
  const bis = Date.now() + 10000
  for (;;) {
    try {
      await fetch(`http://127.0.0.1:${p}/api/werke`)
      break
    } catch {
      if (Date.now() > bis) throw new Error('tools/neu-vorschau.mjs kam nicht hoch')
      await warte(150)
    }
  }
}

let chrome = null
let lfd = 0
const send = (ws, m, p = {}) =>
  new Promise((ok, no) => {
    const i = ++lfd
    ws.send(JSON.stringify({ id: i, method: m, params: p }))
    const h = (r) => {
      const x = JSON.parse(r)
      if (x.id !== i) return
      ws.off('message', h)
      x.error ? no(new Error(x.error.message)) : ok(x.result)
    }
    ws.on('message', h)
  })

try {
  chrome = await eigenerBrowser()
  if (!chrome) throw new Error('kein Browser erreichbar')
  const ws = new WebSocket(await chrome.seite(), { perMessageDeflate: false })
  await new Promise((r) => ws.once('open', r))
  await send(ws, 'Page.enable')
  await send(ws, 'Runtime.enable')
  await send(ws, 'Network.enable')
  await send(ws, 'Log.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  /** JEDE Anfrage samt Rumpf, und JEDE Konsolenzeile. Beides wird durchsucht. */
  const anfragen = []
  const konsole = []
  ws.on('message', (roh) => {
    const x = JSON.parse(roh)
    if (x.method === 'Network.requestWillBeSent')
      anfragen.push({ url: x.params.request.url, method: x.params.request.method, rumpf: x.params.request.postData || '' })
    if (x.method === 'Runtime.consoleAPICalled')
      konsole.push((x.params.args || []).map((a) => String(a.value ?? a.description ?? '')).join(' '))
    if (x.method === 'Log.entryAdded') konsole.push(String(x.params.entry.text || ''))
  })

  const ev = async (js) => {
    const r = await send(ws, 'Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'Fehler in der Seite')
    return r.result.value
  }
  const stand = async (w) => {
    await fetch(new URL(`/vorschau/${w}`, ZIEL))
  }
  const lageSetzen = async (teil) => {
    await fetch(new URL('/vorschau/lage', ZIEL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lage: teil }),
    })
  }
  const tippen = async (x, y, halteMs = 40) => {
    const gem = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, pointerType: 'touch' }
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...gem })
    await warte(halteMs)
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...gem })
    await warte(80)
  }
  /** Die Mitte eines Elements — oder null, wenn es nicht (sichtbar) dasteht. */
  const mitte = (wahl) =>
    ev(`(() => { const e = ${wahl}; if (!e) return null
      const b = e.getBoundingClientRect()
      if (!b.width || !b.height) return null
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), t: (e.textContent||'').trim().slice(0,40) } })()`)
  /**
   * Der Knopf einer `.fach-zeile`, deren Name einen Text enthaelt.
   *
   * VORHER IN DEN BLICK ROLLEN. `.fach-zeilen` ist ein Rollkasten; die fuenfte
   * Zeile steht rechnerisch bei y=515, und eine Beruehrung an dieser Stelle
   * traefe den Schirmrand statt den Knopf. Genau daran ist der erste Lauf
   * dieses Werkzeugs gescheitert.
   */
  const zeilenKnopf = async (text) => {
    const wahl = `[...document.querySelectorAll('.fach-zeile')].find((z) => (z.querySelector('.zeile-name')?.textContent || '').includes(${JSON.stringify(text)}))`
    await ev(`(() => { const z = ${wahl}; if (z) z.scrollIntoView({ block: 'center' }); return true })()`)
    await warte(120)
    return mitte(`${wahl}?.querySelector('button')`)
  }
  const hinein = async () => {
    // BIS ZUM 06.08.2026 FUEHRTE DAS ZAHNRAD `#einst-knopf` HINEIN, 800 ms
    // gehalten. Es ist ersatzlos entfallen; hinein fuehrt der Schriftzug
    // `#wappen`, WAPPEN_HALTEN_MS = 1200 ms gehalten. Dieses Werkzeug hat eine
    // echte Druckfunktion und geht deshalb den ECHTEN Weg, nicht den
    // Tastaturweg (tools/admin-weg.mjs).
    await adminAufHalten(ev, tippen, { warteMs: 900 })
  }
  const torTaste = async (w) => {
    const r = await mitte(
      `[...document.querySelectorAll('.tor-taste')].find((e) => (e.dataset.taste || e.textContent.trim()) === ${JSON.stringify(w)})`,
    )
    if (!r) throw new Error(`Tor-Taste „${w}" fehlt`)
    await tippen(r.x, r.y)
  }
  const tastTaste = async (w) => {
    const r = await mitte(
      `[...document.querySelectorAll('.tast-taste')].find((e) => !e.hidden && (e.dataset.taste === ${JSON.stringify(w)}))`,
    )
    if (!r) throw new Error(`Tastatur-Taste „${w}" fehlt`)
    await tippen(r.x, r.y)
  }

  /**
   * STEHT DIE RUECKFRAGE WIRKLICH IM BILD?
   *
   * Sie wird VORNE an den Rollkasten angehaengt. Wer vorher heruntergerollt
   * hat — und das muss man, um das vierte Netz zu treffen —, bekommt sie
   * ausserhalb des Sichtfensters, also gar nicht. Deshalb wird hier gemessen,
   * BEVOR irgendetwas sie in den Blick rollt.
   */
  const rueckfrageImBild = () =>
    ev(`(() => {
        const k = document.getElementById('fach-zeilen')
        const z = [...k.children].find((e) => (e.querySelector('.zeile-name')?.textContent || '').includes('Verbunden mit'))
        if (!z) return null
        const a = z.getBoundingClientRect(), b = k.getBoundingClientRect()
        return { drin: a.top >= b.top - 2 && a.bottom <= b.bottom + 2, rollTop: Math.round(k.scrollTop) }
      })()`)
  const bild = async (name) => {
    if (!BILD) return
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(`${BILD}-${name}.png`, Buffer.from(s.data, 'base64'))
    console.log(`      Bild: ${BILD}-${name}.png`)
  }
  const neuLaden = async () => {
    await send(ws, 'Page.navigate', { url: ZIEL })
    await warte(1600)
  }

  /**
   * ZWEI GRIFFE STATT EINEM — DIE GRUPPE, DANN DER PUNKT.
   *
   * Der Bereich hat seit dem 06.08.2026 zwei Ebenen: vier GRUPPEN in der
   * Spalte, die elf Punkte in der Karte. Nach dem Tor steht die UEBERSICHT
   * der Gruppe „Verbindung" da — nicht mehr die Netzliste.
   *
   * BEIDE HELFER STEHEN HIER OBEN und nicht in dem Abschnitt, der sie zuerst
   * braucht: sie werden an fuenf Stellen gerufen, und ein `const` weiter unten
   * laesst den ersten Aufruf in seine eigene Definition laufen („Cannot access
   * before initialization") — beim Umbau genau einmal passiert.
   */
  const zumFach = async (id) => {
    const f = await mitte(`document.querySelector('#eltern-faecher [data-fach="${id}"]')`)
    if (!f) throw new Error(`Gruppe „${id}" fehlt`)
    await tippen(f.x, f.y)
    await warte(800)
  }
  const zumPunkt = async (name) => {
    const p = await mitte(
      `[...document.querySelectorAll('#fach-zeilen .fach-zeile')].find((z) => (z.querySelector('.zeile-name')||{}).textContent === ${JSON.stringify(name)})`,
    )
    if (!p) return false
    await tippen(p.x, p.y)
    await warte(1400)
    return true
  }

  // ══════════════════════════════════════════════════════════════════════
  //  1. DAS TOR — wird geholt, was dahinter liegt?
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ 1. Das Tor haelt die drei Faecher zurueck ══')
  await stand('sperre-pin')
  await neuLaden()
  anfragen.length = 0
  await hinein()
  const vorher = anfragen.filter((a) => /\/api\/(netzwerk|medien)/.test(a.url))
  sagen(vorher.length === 0, 'vor der PIN wird NICHTS aus WLAN oder Medien geholt', vorher.map((a) => a.url).join(', '))
  const zu = await ev(`({
      flaeche: !!document.getElementById('eltern-flaeche')?.hidden,
      tor: !document.getElementById('eltern-tor')?.hidden,
      zeilen: document.getElementById('fach-zeilen')?.children.length ?? -1,
      faecher: document.getElementById('eltern-faecher')?.children.length ?? -1,
      tastatur: !!document.getElementById('tastatur')?.hidden,
    })`)
  sagen(zu.tor && zu.flaeche, 'das Tor steht, die Flaeche dahinter ist weg')
  sagen(zu.zeilen === 0 && zu.faecher === 0, 'weder Zeilen noch Faecher stehen im Baum', `Zeilen ${zu.zeilen}, Faecher ${zu.faecher}`)
  sagen(zu.tastatur, 'die Tastatur liegt nicht offen davor')

  for (const z of '2468') await torTaste(z)
  await torTaste('weiter')
  await warte(1200)
  const auf = await ev(`({ flaeche: !document.getElementById('eltern-flaeche')?.hidden, fach: document.querySelector('#fach-kopf h2, #fach-titel')?.textContent || '' })`)
  sagen(auf.flaeche, 'nach der richtigen PIN steht der Bereich offen', auf.fach)
  /* ══ UND DANN ERST AUF DIE WLAN-SEITE ═══════════════════════════════════
   *
   * HIER STAND `nachher.length > 0` unmittelbar nach dem Tor, und das war
   * richtig, solange „WLAN" das erste FACH war und sich beim Aufschlagen
   * selbst holte. Seit dem 06.08.2026 landet man auf der UEBERSICHT der Gruppe
   * „Verbindung"; die holt `/api/netzwerk` und `/api/bluetooth` fuer ihre
   * Unterzeilen, aber KEINEN Suchlauf — zwoelf Netze zu scannen kostet auf
   * einem Pi Sekunden und gehoert der Seite, die sie zeigt.
   *
   * DIE AUSSAGE WIRD DAMIT NICHT SCHWAECHER, sondern genauer: Vor dem Tor
   * darf kein Suchlauf hinausgehen (das steht oben und ist unveraendert),
   * und nach dem Tor MUSS er kommen, sobald jemand WLAN aufschlaegt. Nur der
   * Weg dorthin ist einen Griff laenger geworden. */
  await ev(`(() => { const k = document.querySelector('#eltern-faecher [data-fach="verbindung"]')
    if (k) k.click(); return true })()`)
  await warte(700)
  await ev(`(() => { for (const z of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
    const n = z.querySelector('.zeile-name')
    if (n && n.textContent.trim() === 'WLAN') { z.click(); return true } }
    return false })()`)
  await warte(1500)
  const nachher = anfragen.filter((a) => /\/api\/netzwerk\/scan/.test(a.url))
  sagen(nachher.length > 0, 'erst DANACH wird die Nachbarschaft gesucht')

  // ══════════════════════════════════════════════════════════════════════
  //  2. DAS PASSWORT — es darf hinterher nirgends mehr stehen
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ 2. Das Passwort steht nirgends ══')
  const gesichert = await zeilenKnopf('gastfreundliche')
  sagen(!!gesichert, 'ein gesichertes Netz traegt einen Knopf „Verbinden"', gesichert?.t)
  await tippen(gesichert.x, gesichert.y)
  await warte(400)
  const tastDa = await ev(`(() => { const t = document.getElementById('tastatur'); return { offen: !t.hidden, frage: document.getElementById('tast-frage')?.textContent || '', unter: document.getElementById('tast-unter')?.textContent || '' } })()`)
  sagen(tastDa.offen, 'die eigene Tastatur geht auf (keine des Systems)')
  sagen(/hängt gerade an|haengt gerade an/.test(tastDa.unter), 'auf dem Passwort-Schirm steht, in welchem Netz die Box GERADE haengt', tastDa.unter)

  for (const z of GEHEIM) await tastTaste(z)
  const beimTippen = await ev(`({
      anzeige: document.getElementById('tast-anzeige')?.textContent || '',
      baum: document.body.outerHTML.includes(${JSON.stringify(GEHEIM)}),
    })`)
  sagen(!beimTippen.anzeige.includes(GEHEIM), 'beim Tippen steht das Passwort verdeckt da', beimTippen.anzeige)
  sagen(!beimTippen.baum, 'und es steht auch NICHT im Baum, waehrend es getippt wird')

  await tastTaste('fertig')
  await warte(1200)
  const imBild = await rueckfrageImBild()
  sagen(!!imBild && imBild.drin, 'die Rueckfrage steht danach SICHTBAR da, ohne dass jemand rollen muss', JSON.stringify(imBild))
  const nachSenden = await ev(`({
      baum: document.body.outerHTML.includes(${JSON.stringify(GEHEIM)}),
      anzeige: document.getElementById('tast-anzeige')?.textContent || '',
      tastatur: !!document.getElementById('tastatur')?.hidden,
      attribute: (() => { for (const e of document.querySelectorAll('*')) for (const a of e.attributes) if (String(a.value).includes(${JSON.stringify(GEHEIM)})) return e.tagName + '@' + a.name; return '' })(),
      speicher: [...Object.keys(localStorage), ...Object.keys(sessionStorage)].some((k) => String(localStorage.getItem(k) || '').includes(${JSON.stringify(GEHEIM)}) || String(sessionStorage.getItem(k) || '').includes(${JSON.stringify(GEHEIM)})),
      zeilen: [...document.querySelectorAll('.fach-zeile')].map((z) => (z.querySelector('.zeile-name')?.textContent || '') + ' | ' + (z.querySelector('.zeile-unter')?.textContent || '')),
    })`)
  sagen(nachSenden.tastatur, 'nach „Fertig" ist die Tastatur weg')
  sagen(nachSenden.anzeige === '', 'und ihr Feld ist GELEERT, nicht nur versteckt', JSON.stringify(nachSenden.anzeige))
  sagen(!nachSenden.baum, 'das Passwort steht nicht im Baum')
  sagen(!nachSenden.attribute, 'und in keinem Attribut', nachSenden.attribute)
  sagen(!nachSenden.speicher, 'und in keinem Speicher des Browsers')
  const inAdresse = anfragen.filter((a) => a.url.includes(GEHEIM))
  sagen(inAdresse.length === 0, 'in keiner Adresse', inAdresse.map((a) => a.url).join(', '))
  const inKonsole = konsole.filter((z) => z.includes(GEHEIM))
  sagen(inKonsole.length === 0, 'und in keiner Konsolenzeile', inKonsole.join(' / '))
  const imRumpf = anfragen.filter((a) => a.rumpf.includes(GEHEIM))
  sagen(imRumpf.length === 1 && /netzwerk\/verbinden/.test(imRumpf[0].url), 'es geht GENAU EINMAL hinaus, im Rumpf von /netzwerk/verbinden', imRumpf.map((a) => a.url).join(', '))

  // ══ Der Wechsel, der bestaetigt werden will ══
  const bestaetigen = await zeilenKnopf('Verbunden mit')
  sagen(!!bestaetigen, 'nach dem Wechsel steht die Rueckfrage ganz oben', bestaetigen?.t)
  const wechselText = await ev(`(document.querySelector('.fach-zeile .zeile-unter')?.textContent || '')`)
  sagen(/rollt die Box in \d+ s/.test(wechselText), 'sie sagt, wie lange der Rueckweg noch offen ist', wechselText)

  await bild('wechsel-offen')

  // NEU LADEN MITTEN IM WECHSEL — der Knopf muss wiederkommen.
  //
  // UND DER WEG DORTHIN IST ZWEI GRIFFE LANG. Nach dem Tor steht die
  // Uebersicht der Gruppe „Verbindung"; die Bestaetigungszeile gehoert der
  // WLAN-Seite. DASS SIE NACH EINEM NEULADEN WIEDER DA IST, bleibt die
  // Aussage — sie haengt am Server (`/api/netzwerk/watchdog`) und nicht am
  // Browser, und genau das wird hier gemessen.
  await neuLaden()
  await hinein()
  for (const z of '2468') await torTaste(z)
  await torTaste('weiter')
  await warte(1200)
  await zumFach('verbindung')
  const punktWlan2 = await mitte(
    `[...document.querySelectorAll('#fach-zeilen .fach-zeile')].find((z) => (z.querySelector('.zeile-name')||{}).textContent === 'WLAN')`,
  )
  if (punktWlan2) {
    await tippen(punktWlan2.x, punktWlan2.y)
    await warte(1500)
  }
  const nachNeuladen = await zeilenKnopf('Verbunden mit')
  sagen(!!nachNeuladen, 'ein Neuladen mitten im Wechsel verliert den Bestaetigungsknopf nicht')

  // WAS DIE OBERFLAECHE ZUM GELINGEN SAGT: prueft sie es, oder glaubt sie es?
  const wieGeprueft = await ev(`(() => {
      const zeilen = [...document.querySelectorAll('.fach-zeile')].map((z) => (z.querySelector('.zeile-name')?.textContent || ''))
      return { erste: zeilen[0] || '', grueneZeile: [...document.querySelectorAll('.fach-zeile.an .zeile-name')].map((e) => e.textContent)[0] || '' }
    })()`)
  console.log(`      (zur Beurteilung) erste Zeile: „${wieGeprueft.erste}", gruen markiert: „${wieGeprueft.grueneZeile}"`)

  // ══════════════════════════════════════════════════════════════════════
  //  3. DAS LOESCHEN — Name in der Frage, und der rote Knopf woanders
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ 3. Loeschen fragt mit Namen, und nicht an derselben Stelle ══')
  // ZWEI GRIFFE STATT EINEM: „Medien" ist seit dem 06.08.2026 eine GRUPPE,
  // die Liste liegt auf ihrer Unterseite „Suchen und verwalten". Ein Griff auf
  // die Gruppe allein landete in der Uebersicht — und deren erste Zeile ist
  // ein Punkt und kein Medieneintrag, worauf das Werkzeug einen Knopf suchte,
  // den es dort nicht gibt (`querySelector('button')` auf einer Zeile, die
  // SELBST der Knopf ist, gab null).
  const fachMedien = await mitte(`document.querySelector('#eltern-faecher [data-fach="medien"]')`)
  sagen(!!fachMedien, 'die Gruppe „Medien" steht in der Spalte')
  await tippen(fachMedien.x, fachMedien.y)
  await warte(900)
  const punktMedien = await mitte(
    `[...document.querySelectorAll('#fach-zeilen .fach-zeile')].find((z) => (z.querySelector('.zeile-name')||{}).textContent === 'Suchen und verwalten')`,
  )
  sagen(!!punktMedien, 'und darin der Punkt „Suchen und verwalten"')
  await tippen(punktMedien.x, punktMedien.y)
  await warte(1200)
  const ersterEintrag = await ev(`(() => {
      const z = document.querySelector('.fach-zeile'); if (!z) return null
      const k = z.querySelector('button'); if (!k) return null
      const b = k.getBoundingClientRect()
      return { x: Math.round(b.left+b.width/2), y: Math.round(b.top+b.height/2), name: z.querySelector('.zeile-name')?.textContent || '' } })()`)
  sagen(!!ersterEintrag, 'die Liste traegt Eintraege', ersterEintrag?.name)
  await tippen(ersterEintrag.x, ersterEintrag.y)
  await warte(600)

  const loeschKnopf = await zeilenKnopf('Löschen')
  sagen(!!loeschKnopf, 'auf dem Blatt steht ein Knopf „Löschen"')
  await tippen(loeschKnopf.x, loeschKnopf.y)
  await warte(500)
  const frage = await ev(`({
      erste: document.querySelector('.fach-zeile .zeile-name')?.textContent || '',
      namen: [...document.querySelectorAll('.fach-zeile .zeile-name')].map((e) => e.textContent),
    })`)
  const nennt = frage.namen.some((n) => n.includes(ersterEintrag.name.slice(0, 12)))
  sagen(nennt, 'die Rueckfrage NENNT den Namen des Eintrags', frage.namen.join(' / '))
  await bild('loesch-rueckfrage')
  const jaKnopf = await zeilenKnopf('Ja, löschen')
  sagen(!!jaKnopf, 'und traegt einen eigenen Knopf „Löschen"')
  const abstand = Math.abs(jaKnopf.y - loeschKnopf.y)
  sagen(abstand > 40, 'der rote Knopf liegt NICHT dort, wo der harmlose lag', `${abstand} px auseinander`)

  // DER FEHLGRIFF: noch einmal auf dieselbe Stelle wie eben.
  anfragen.length = 0
  await tippen(loeschKnopf.x, loeschKnopf.y)
  await warte(600)
  const nachFehlgriff = anfragen.filter((a) => a.method === 'DELETE')
  sagen(nachFehlgriff.length === 0, 'ein zweiter Tipp auf DIESELBE STELLE loescht nichts', nachFehlgriff.map((a) => a.url).join(', '))

  // DER DOPPELTIPP AUF DEN ROTEN KNOPF: einmal loeschen, nicht zweimal.
  const nochEinmal = await zeilenKnopf('Löschen')
  if (nochEinmal) {
    await tippen(nochEinmal.x, nochEinmal.y)
    await warte(300)
  }
  const ja2 = await zeilenKnopf('Ja, löschen')
  anfragen.length = 0
  if (ja2) {
    await tippen(ja2.x, ja2.y, 20)
    await tippen(ja2.x, ja2.y, 20)
    await warte(1200)
  }
  const geloescht = anfragen.filter((a) => a.method === 'DELETE')
  sagen(geloescht.length === 1, 'ein Doppeltipp auf „Löschen" schickt GENAU EIN DELETE', `${geloescht.length}`)

  // ══════════════════════════════════════════════════════════════════════
  //  4. DERSELBE FEHLGRIFF AUS JEDEM ROLLSTAND
  // ══════════════════════════════════════════════════════════════════════
  //
  // WARUM DAS EINE EIGENE RUNDE IST: „Der rote Knopf steht in einer anderen
  // ZEILE" ist eine Aussage ueber die Reihenfolge, nicht ueber den Schirm.
  // `.fach-zeilen` ROLLT — steht Musik, nimmt das Kissen 94 px, und „Löschen"
  // ist erst nach einer Rollbewegung zu sehen. DANACH liegt es woanders, die
  // Rueckfrage darunter aber faengt wieder bei scrollTop 0 an. Die Frage ist
  // also nicht „andere Zeile", sondern: LIEGT DER PUNKT, DEN DER FINGER EBEN
  // GETROFFEN HAT, HINTERHER IM ROTEN KNOPF?
  console.log('\n══ 4. Der Fehlgriff aus jedem Rollstand ══')
  // DREI GRIFFE STATT ZWEI: Gruppe „Medien" -> Punkt „Suchen und verwalten"
  // -> erster Eintrag. Bis zum 06.08.2026 war „Medien" ein Fach und die Liste
  // stand nach EINEM Griff da.
  const zumBlatt = async () => {
    const f = await mitte(`document.querySelector('#eltern-faecher [data-fach="medien"]')`)
    if (!f) throw new Error('Gruppe „Medien" fehlt')
    await tippen(f.x, f.y)
    await warte(700)
    const p = await mitte(
      `[...document.querySelectorAll('#fach-zeilen .fach-zeile')].find((z) => (z.querySelector('.zeile-name')||{}).textContent === 'Suchen und verwalten')`,
    )
    if (!p) throw new Error('Punkt „Suchen und verwalten" fehlt')
    await tippen(p.x, p.y)
    await warte(1000)
    const z = await mitte(`document.querySelector('#fach-zeilen .fach-zeile .zeile-tat')`)
    if (!z) throw new Error('kein Medieneintrag in der Liste')
    await tippen(z.x, z.y)
    await warte(600)
  }
  const rollMass = await ev(`(() => { const k = document.getElementById('fach-zeilen'); return { hoch: k.scrollHeight, sicht: k.clientHeight } })()`)
  console.log(`      Rollkasten: ${rollMass.hoch} px Inhalt in ${rollMass.sicht} px Sicht`)
  for (const roll of [0, Math.max(0, rollMass.hoch - rollMass.sicht)]) {
    await zumBlatt()
    await ev(`(() => { document.getElementById('fach-zeilen').scrollTop = ${roll}; return true })()`)
    await warte(150)
    const k = await ev(`(() => {
        const z = [...document.querySelectorAll('.fach-zeile')].find((e) => (e.querySelector('.zeile-name')?.textContent || '') === 'Löschen')
        if (!z) return null
        const b = z.querySelector('button').getBoundingClientRect()
        const kasten = document.getElementById('fach-zeilen').getBoundingClientRect()
        const y = Math.round(b.top + b.height / 2)
        return { x: Math.round(b.left + b.width / 2), y, sichtbar: y > kasten.top && y < kasten.bottom }
      })()`)
    if (!k || !k.sichtbar) {
      console.log(`      Rollstand ${roll}: „Löschen" ist hier nicht zu treffen — uebersprungen`)
      continue
    }
    await tippen(k.x, k.y)
    await warte(500)
    const treffer = await ev(`(() => {
        const z = [...document.querySelectorAll('.fach-zeile')].find((e) => (e.querySelector('.zeile-name')?.textContent || '') === 'Ja, löschen')
        if (!z) return null
        const b = z.querySelector('button').getBoundingClientRect()
        return { drin: ${k.x} >= b.left && ${k.x} <= b.right && ${k.y} >= b.top && ${k.y} <= b.bottom, abstand: Math.round(Math.abs((b.top + b.height / 2) - ${k.y})) }
      })()`)
    sagen(
      !!treffer && !treffer.drin,
      `Rollstand ${roll}: der Punkt von „Löschen" liegt hinterher NICHT im roten Knopf`,
      treffer ? `${treffer.abstand} px zwischen den Mitten` : 'keine Rueckfrage',
    )
    anfragen.length = 0
    await tippen(k.x, k.y)
    await warte(700)
    const weg = anfragen.filter((a) => a.method === 'DELETE')
    sagen(weg.length === 0, `Rollstand ${roll}: derselbe Punkt noch einmal getippt loescht nichts`, `${weg.length} DELETE`)
  }

  // ══════════════════════════════════════════════════════════════════════
  //  5. DIE TASTATUR — 32 Ziele, die kein stehendes Werkzeug misst
  // ══════════════════════════════════════════════════════════════════════
  //
  // `beruehrziele-neu.mjs` kennt die Schirme `eltern-tor` und
  // `eltern-flaeche`. Die TASTATUR ist keiner von beiden: sie liegt
  // AUSSERHALB von `#eltern`, auf eigener Ebene, und geht erst auf, wenn man
  // ein gesichertes Netz antippt. Die groesste neue Tastenflaeche der
  // Oberflaeche wird von der stehenden Messung also gar nicht erfasst —
  // deshalb hier, mit derselben Marke: 9 mm und 2 mm bei 0,14 mm je Bildpunkt.
  console.log('\n══ 5. Die Tastatur haelt 9 mm und 2 mm ══')
  const MM = 0.14
  // UEBER DIE SUCHE UND NICHT UEBER DAS WLAN: Solange ein Wechsel auf
  // Bestaetigung wartet, sind ALLE „Verbinden"-Knoepfe aus (`wlanMalen`,
  // `aus: … || !!this.wlanWechsel`) — richtig so, aber die Tastatur ginge
  // dann gar nicht auf. Es ist ohnehin dieselbe.
  // ZWEI GRIFFE: die Gruppe, dann die Unterseite mit dem Suchknopf im Kopf.
  // Die Uebersicht der Gruppe hat KEINEN Kopfknopf (`kopfMalen(name, '')`),
  // ein `#fach-tat` waere dort `hidden` und die Tastatur ginge nie auf.
  await zumFach('medien')
  const punktSuche = await mitte(
    `[...document.querySelectorAll('#fach-zeilen .fach-zeile')].find((z) => (z.querySelector('.zeile-name')||{}).textContent === 'Suchen und verwalten')`,
  )
  if (punktSuche) {
    await tippen(punktSuche.x, punktSuche.y)
    await warte(1000)
  }
  const suchKnopf = await mitte(`document.getElementById('fach-tat')`)
  if (suchKnopf) {
    await tippen(suchKnopf.x, suchKnopf.y)
    await warte(400)
  }
  for (const ebene of ['klein', 'ziffern']) {
    if (ebene === 'ziffern') {
      await tastTaste('ebene')
      await warte(200)
    }
    const t = await ev(`(() => {
        const k = [...document.querySelectorAll('.tast-taste')].filter((e) => !e.hidden).map((e) => e.getBoundingClientRect())
        if (!k.length) return null
        let klein = 1e9, eng = 1e9
        for (const b of k) klein = Math.min(klein, b.width, b.height)
        for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) {
          const a = k[i], b = k[j]
          const dx = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right))
          const dy = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom))
          if (dx === 0 && dy === 0) return { anzahl: k.length, klein, eng: 0 }
          eng = Math.min(eng, Math.hypot(dx, dy))
        }
        return { anzahl: k.length, klein: Math.round(klein), eng: Math.round(eng) }
      })()`)
    // 31 UND NICHT 32. Gebaut werden 32 Felder, belegt sind in JEDER Ebene
    // nur 31 (26 Buchstaben + Umschalt, Ebene, Leer, Weg, Fertig) — der
    // letzte Platz bleibt leer und wird versteckt. Der Kommentar bei
    // `tastenMalen` behauptet „32 Belegungen in jeder Ebene"; das stimmt
    // nicht, und diese Zeile haelt es fest.
    sagen(!!t && t.anzahl === 31, `Ebene ${ebene}: 31 belegte Tasten stehen da`, `${t?.anzahl}`)
    sagen(!!t && t.klein * MM >= 9, `Ebene ${ebene}: die kleinste Taste haelt 9 mm`, `${t?.klein} px = ${(t?.klein * MM).toFixed(2)} mm`)
    sagen(!!t && t.eng * MM >= 2, `Ebene ${ebene}: der engste Abstand haelt 2 mm`, `${t?.eng} px = ${(t?.eng * MM).toFixed(2)} mm`)
  }
  // DAS AUGE GEHOERT NUR ZUM PASSWORT. Bei der Suche ist es versteckt — das
  // ist die Absicht („geheim" schaltet es), und deshalb wird hier nur
  // „Abbrechen" gemessen. Das Auge selbst haengt an der Passwort-Runde oben.
  const wegKnopf = await ev(`(() => { const e = document.getElementById('tast-weg'); const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), auge: !document.getElementById('tast-auge').hidden } })()`)
  sagen(Math.min(wegKnopf.w, wegKnopf.h) * MM >= 9, 'auch „Abbrechen" haelt 9 mm', `${wegKnopf.w}x${wegKnopf.h}`)
  sagen(!wegKnopf.auge, 'und das Auge steht NUR beim Passwort da, nicht bei der Suche')

  // ══════════════════════════════════════════════════════════════════════
  //  6. DER WECHSEL, DER NICHT ZUSTANDE KOMMT
  // ══════════════════════════════════════════════════════════════════════
  //
  // DER EINE FALL, AN DEM SICH DIE BOX AUSSPERRT. `POST /netzwerk/verbinden`
  // meldet Erfolg, sobald wpa_supplicant den Auftrag angenommen hat — die
  // Anmeldung kann danach immer noch scheitern, und `select_network` hat das
  // alte Netz da schon abgeschaltet. Diese Oberflaeche laeuft auf dem Schirm
  // DER BOX gegen 127.0.0.1: „die Bestaetigung kommt an" beweist hier nichts.
  // Was sie also sagen MUSS, ist, was die Box selbst ueber ihre Verbindung
  // meldet — sonst tippt jemand „Bestätigen", `save_config` schreibt das tote
  // Netz auf Platte, und der Wecker ist entschaerft.
  console.log('\n══ 6. Ein Wechsel, der nicht zustande kommt, wird gesagt ══')
  // DEN WECHSEL AUS RUNDE 2 ERST ABRAEUMEN. Solange einer offen ist, sind
  // ALLE „Verbinden"-Knoepfe aus — richtig so, aber dann faengt diese Runde
  // gar nicht erst an. Es geht ueber die Schnittstelle und nicht ueber einen
  // Griff in die Attrappe, damit hier nichts steht, was die Box nicht kann.
  await fetch(new URL('/api/netzwerk/bestaetigen', ZIEL), { method: 'POST' })
  await stand('wlan-kommtnicht')
  await neuLaden()
  await hinein()
  for (const z of '2468') await torTaste(z)
  await torTaste('weiter')
  await warte(1200)
  // UND DANN AUF DIE WLAN-SEITE. Nach dem Tor steht seit dem 06.08.2026 die
  // UEBERSICHT der Gruppe „Verbindung" da; die Netzliste liegt einen Punkt
  // tiefer. Ohne diese zwei Griffe suchte das Werkzeug „FRITZ!Box 6690" in
  // einer Liste aus zwei Zeilen namens „WLAN" und „Bluetooth".
  await zumFach('verbindung')
  const punktWlan = await mitte(
    `[...document.querySelectorAll('#fach-zeilen .fach-zeile')].find((z) => (z.querySelector('.zeile-name')||{}).textContent === 'WLAN')`,
  )
  if (punktWlan) {
    await tippen(punktWlan.x, punktWlan.y)
    await warte(1500)
  }
  const netz3 = await zeilenKnopf('FRITZ!Box 6690')
  if (!netz3) sagen(false, 'ein zweites gesichertes Netz steht zum Wechsel bereit')
  else {
    // GANZ NACH UNTEN, wie jemand, der die letzten Netze sucht — und dann das
    // UNTERSTE gesicherte Netz nehmen, das dort WIRKLICH zu treffen ist.
    // („Einfach die vierte Zeile" traf mal daneben: was im Rollkasten unter
    // der Kante liegt, hat zwar ein Rechteck, aber keinen Finger.)
    await ev(`(() => { const k = document.getElementById('fach-zeilen'); k.scrollTop = k.scrollHeight; return true })()`)
    await warte(200)
    const netz3b = await ev(`(() => {
        const k = document.getElementById('fach-zeilen').getBoundingClientRect()
        const treffer = [...document.querySelectorAll('.fach-zeile')]
          .filter((z) => !/offen/.test(z.querySelector('.zeile-unter')?.textContent || ''))
          .map((z) => ({ z, b: z.querySelector('button')?.getBoundingClientRect() }))
          .filter((t) => t.b && t.b.top >= k.top && t.b.bottom <= k.bottom && !t.z.querySelector('button').disabled)
        const t = treffer[treffer.length - 1]
        if (!t) return null
        return { x: Math.round(t.b.left + t.b.width / 2), y: Math.round(t.b.top + t.b.height / 2), name: t.z.querySelector('.zeile-name')?.textContent || '' }
      })()`)
    sagen(!!netz3b, 'im untersten Rollstand ist ein gesichertes Netz zu treffen', netz3b?.name)
    await tippen((netz3b || netz3).x, (netz3b || netz3).y)
    await warte(500)
    for (const z of GEHEIM) await tastTaste(z)
    await tastTaste('fertig')
    // 6 s bis zum Nachfassen (`wlanVerbinden`), plus Luft fuer den Suchlauf.
    await warte(9000)
    const gesagt = await ev(`(() => {
        const z = [...document.querySelectorAll('.fach-zeile')].find((e) => (e.querySelector('.zeile-name')?.textContent || '').includes('Verbunden mit'))
        return {
          da: !!z,
          unter: z?.querySelector('.zeile-unter')?.textContent || '',
          warnt: !!z?.classList.contains('warnt'),
          kopf: document.getElementById('eltern-unter')?.textContent || '',
        } })()`)
    const imBild2 = await rueckfrageImBild()
    sagen(!!imBild2 && imBild2.drin, 'auch aus dem untersten Rollstand heraus steht sie SICHTBAR da', JSON.stringify(imBild2))
    sagen(gesagt.da, 'die Rueckfrage steht noch da — der Wechsel ist ja offen')
    sagen(/NICHT an diesem Netz/.test(gesagt.unter), 'sie SAGT, dass die Box nicht an diesem Netz haengt', gesagt.unter)
    sagen(gesagt.warnt, 'und sie ist als Warnung gezeichnet, nicht als Auskunft')
    sagen(!/verbunden mit .*FRITZ!Box 6690/.test(gesagt.kopf), 'die Kopfzeile behauptet KEINE Verbindung, die es nicht gibt', gesagt.kopf)
    await bild('wechsel-gescheitert')
  }
  await stand('wlan-ok')

  await send(ws, 'Emulation.clearDeviceMetricsOverride')
  ws.close()
} finally {
  try {
    await chrome?.zu()
  } catch {
    /* schon weg */
  }
}

const schlecht = befunde.filter((b) => !b.gut)
console.log(`\n${befunde.length - schlecht.length} von ${befunde.length} Aussagen halten.`)
process.exit(schlecht.length ? 1 : 0)
