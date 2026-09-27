#!/usr/bin/env node
/**
 * DIE PLUGIN-SEITE DER VERWALTUNG — steht sie wirklich da, und zeigt sie, was sie soll?
 *
 * ══ WOZU EIN EIGENES WERKZEUG ══════════════════════════════════════════════
 *
 * Eine Angular-Seite baut sich im BROWSER. `curl` bekommt die Huelle und sonst
 * nichts — ein `grep` darauf ist gruen, solange die Route existiert, und sagt
 * ueber die Seite gar nichts. Genau so uebersieht man eine Seite, die zwar
 * geladen wird, aber leer bleibt, weil ein Abruf 404 gibt oder ein Feldname
 * anders heisst als gedacht.
 *
 * Gefragt wird deshalb im Browser, und zwar nach dem, was ein Mensch sieht:
 *
 *   1. Steht die Ueberschrift „Plugins" da?
 *   2. Steht JEDES geladene Plugin mit Namen und Zustand da?
 *   3. Stehen die angemeldeten FELDER als Eingaben da — und ist das Geheimnis
 *      wirklich ein Passwortfeld und kein Textfeld?
 *   4. Traegt der Menuepunkt „Plugins" in die Seite, auf der man steht?
 *
 * Punkt 3 ist der, an dem es leise schiefgeht: ein `type="text"` fuer einen
 * Schluessel sieht auf dem Schirm fast gleich aus und legt ihn in jeden
 * Mitschnitt.
 *
 * EIGENER BROWSER, EIGENER PORT, EIGENES PROFIL (tools/leihgabe.mjs). Ein
 * fremder Lauf auf einer festen Nummer meldet sonst klaglos SEINE Ziele.
 *
 * Aufruf:
 *   node tools/plugin-seite-schau.mjs                       # gegen die Box
 *   node tools/plugin-seite-schau.mjs http://127.0.0.1:8200 # gegen eine Vorschau
 */

import { WebSocket } from 'ws'
import { eigenerBrowser } from './leihgabe.mjs'

const WIRT = process.argv[2] || 'http://192.168.178.57:8200'
let fehler = 0
const sagen = (frage, befund, gut) => {
  if (!gut) fehler++
  console.log(`${gut ? '  ok  ' : ' FEHL '} ${frage}`)
  if (befund) console.log(`         ${String(befund).split('\n').join('\n         ')}`)
}

/** Eine Seite oeffnen und eine Funktion IM Browser auswerten lassen. */
async function imBrowser(url, ausdruck, { geduldMs = 12000 } = {}) {
  const brw = await eigenerBrowser({ fenster: '1280,900' })
  if (!brw) throw new Error('kein Browser gefunden (playwright/chromium)')
  try {
    const ws = new WebSocket(await brw.seite())
    await new Promise((r, x) => {
      ws.on('open', r)
      ws.on('error', x)
    })
    let id = 0
    const offen = new Map()
    ws.on('message', (d) => {
      const n = JSON.parse(d)
      if (n.id && offen.has(n.id)) {
        offen.get(n.id)(n)
        offen.delete(n.id)
      }
    })
    const rufen = (method, params = {}) =>
      new Promise((fertig) => {
        const meine = ++id
        offen.set(meine, fertig)
        ws.send(JSON.stringify({ id: meine, method, params }))
      })

    await rufen('Page.enable')
    await rufen('Runtime.enable')
    await rufen('Page.navigate', { url })

    // WARTEN AUF DEN INHALT, NICHT AUF EINE FRIST. Die Seite holt ihre Daten
    // selbst; eine feste Wartezeit waere entweder zu kurz (rot ohne Grund)
    // oder zu lang (jeder Lauf kostet sie).
    const bis = Date.now() + geduldMs
    let letzte = null
    while (Date.now() < bis) {
      const a = await rufen('Runtime.evaluate', { expression: ausdruck, returnByValue: true, awaitPromise: true })
      letzte = a?.result?.result?.value ?? null
      if (letzte && letzte.fertig) break
      await new Promise((f) => setTimeout(f, 250))
    }
    ws.close()
    return letzte
  } finally {
    await brw.schliessen?.()
  }
}

const AUSDRUCK = `(() => {
  const t = document.body.innerText || ''
  const karten = [...document.querySelectorAll('.karte')]
  const eingaben = [...document.querySelectorAll('input')].map((e) => ({
    art: e.type,
    platzhalter: e.placeholder || '',
  }))
  const menue = [...document.querySelectorAll('a')].map((a) => a.textContent.trim())
  return {
    // FERTIG heisst: die Ueberschrift steht UND es wird nicht mehr geladen.
    fertig: t.includes('Plugins') && !t.includes('Wird geladen'),
    text: t.slice(0, 1200),
    karten: karten.length,
    eingaben,
    menue: menue.filter(Boolean),
    hatUeberschrift: !!document.querySelector('h1') && document.querySelector('h1').textContent.trim() === 'Plugins',
  }
})()`

console.log(`Plugin-Seite gegen ${WIRT}\n`)

const url = `${WIRT.replace(/\/+$/, '')}/admin/plugins`
let a
try {
  a = await imBrowser(url, AUSDRUCK)
} catch (e) {
  sagen('Browser gestartet?', e.message, false)
  process.exit(1)
}

if (!a) {
  sagen('Seite geantwortet?', 'nichts zurueckbekommen', false)
  process.exit(1)
}

sagen(
  'Ueberschrift „Plugins" da?',
  a.hatUeberschrift ? 'ja' : `nein — h1 fehlt oder heisst anders`,
  !!a.hatUeberschrift,
)
sagen('Seite fertig geladen (kein „Wird geladen")?', a.fertig ? 'ja' : 'nein — sie haengt im Ladezustand', !!a.fertig)

// Die Plugins, die auf DIESER Box liegen. Kommen sie nicht vor, holt die
// Seite ihre Daten nicht oder zeigt sie nicht an — beides sieht gleich aus,
// wenn man nur die Route prueft.
for (const k of ['mupibox-podcast', 'mupibox-wled']) {
  sagen(`„${k}" steht auf der Seite?`, a.text.includes(k) ? 'ja' : 'nein', a.text.includes(k))
}

sagen(
  'Zustand wird gezeigt?',
  a.text.includes('bereit') ? 'ja — „bereit" kommt vor' : 'nein',
  a.text.includes('bereit'),
)

// ── DER GEHEIMNIS-TEIL IST UMGEZOGEN ──────────────────────────────────────
//
// Er stand hier und pruefte die LISTE — dort stehen seit dem 14.08.2026 gar
// keine Felder mehr, die liegen auf den Unterseiten. Die Pruefung war damit
// zwangslaeufig rot, ohne dass an der Oberflaeche etwas fehlte. Sie steht
// jetzt unten bei der Unterseite, wo das Feld wirklich ist.
const lage = await fetch(`${WIRT.replace(/\/+$/, '')}/api/plugins`)
  .then((r) => r.json())
  .catch(() => null)
sagen('Eingabefelder ueberhaupt da?', `${a.eingaben.length} Eingaben, ${a.karten} Karten`, a.eingaben.length > 0)

sagen(
  'Menuepunkt „Plugins" da?',
  a.menue.includes('Plugins') ? 'ja' : `nein — gefunden: ${a.menue.join(', ')}`,
  a.menue.includes('Plugins'),
)

// UND WAS NICHT MEHR DA SEIN DARF.
sagen(
  '„Weitere Einstellungen" taucht NICHT mehr auf?',
  a.text.includes('Weitere Einstellungen') ? 'doch, es steht noch da' : 'richtig, weg',
  !a.text.includes('Weitere Einstellungen'),
)

// ══ DIE UNTERSEITE EINER ERWEITERUNG ═══════════════════════════════════════
//
// Seit dem 14.08.2026 hat jedes Plugin einen eigenen Ort. Zwei Dinge koennen
// dabei leise schiefgehen, und beide sieht man der Liste nicht an:
//
//   * die Route `/plugins/:kennung` steht, aber die Seite bekommt die Kennung
//     nicht (der Router bindet Parameter hier NICHT an `input()`), und
//   * der Menuepunkt „Plugins" verliert auf der Unterseite seine Hervorhebung
//     — dann steht man in einer Verwaltung, in der KEIN Eintrag angewaehlt
//     ist. Genau dieser Fehler ist in diesem Baum schon einmal passiert
//     (siehe `leuchtet()` in rahmen.ts).
// NICHT EINFACH DIE ERSTE. Die interessante Eigenschaft (ein Geheimnis wird
// als Passwortfeld gezeichnet) ist nur dort zu sehen, wo ein Plugin eines
// anmeldet.
const mitGeheimnis = (lage?.geladen ?? []).find((p) => (p.felder ?? []).some((f) => f.art === 'geheim'))
const ersteKennung = (mitGeheimnis ?? (lage?.geladen ?? [])[0])?.kennung
if (!ersteKennung) {
  console.log('\n  ——   Unterseite: UNGEPRUEFT — auf dieser Box liegt keine Erweiterung.')
} else {
  console.log(`\n  Unterseite /admin/plugins/${ersteKennung}:`)
  const u = await imBrowser(
    `${WIRT.replace(/\/+$/, '')}/admin/plugins/${ersteKennung}`,
    `(() => {
      const t = document.body.innerText || ''
      const h1 = (document.querySelector('h1') || {}).textContent || ''
      // „hier" ist die Klasse, die den gewaehlten Menueeintrag traegt.
      const leuchtend = [...document.querySelectorAll('a.hier')].map((a) => a.textContent.trim())
      return {
        fertig: !!h1 && !t.includes('Wird geladen'),
        h1: h1.trim(),
        text: t.slice(0, 900),
        leuchtend,
        schalter: [...document.querySelectorAll('input[type=checkbox]')].length,
        eingaben: [...document.querySelectorAll('input')].length,
        passwoerter: [...document.querySelectorAll('input[type=password]')].length,
        mitPlatzhalter: [...document.querySelectorAll('input[type=password]')].filter((e) =>
          /unver/i.test(e.placeholder || ''),
        ).length,
      }
    })()`,
  )

  if (!u) {
    sagen('die Unterseite antwortet?', 'nichts zurueckbekommen', false)
  } else {
    sagen(
      'die Seite kennt IHR Plugin (nicht nur die Route)',
      u.h1 ? `Ueberschrift „${u.h1}"` : 'keine Ueberschrift',
      !!u.h1 && !/^Plugins$/.test(u.h1) && !u.text.includes('Es gibt keine Erweiterung'),
    )
    sagen(
      'der Menuepunkt „Plugins" leuchtet auch hier',
      u.leuchtend.length ? u.leuchtend.join(', ') : 'KEIN Eintrag ist angewaehlt',
      u.leuchtend.includes('Plugins'),
    )
    sagen('der Ein-/Aus-Schalter steht da', `${u.schalter} Schalter, ${u.eingaben} Eingaben`, u.schalter > 0)
    sagen(
      'ein Rueckweg zur Liste steht da',
      u.text.includes('Alle Erweiterungen') ? 'ja' : 'fehlt',
      u.text.includes('Alle Erweiterungen'),
    )

    // ── DER LEISE FEHLER: EIN SCHLUESSEL IN EINEM TEXTFELD ───────────────
    //
    // Er sieht auf dem Schirm fast gleich aus und legt das Passwort in jeden
    // Mitschnitt. Geprueft wird NUR, wenn dieses Plugin wirklich ein
    // `geheim`-Feld anmeldet.
    const geheime = (mitGeheimnis?.felder ?? []).filter((f) => f.art === 'geheim')
    if (!geheime.length) {
      console.log('  ——   Geheimnisse als Passwortfeld: UNGEPRUEFT')
      console.log('         Kein Plugin auf dieser Box meldet ein `geheim`-Feld an.')
    } else {
      sagen(
        `Geheimnisse sind Passwortfelder? (${geheime.map((f) => f.schluessel).join(', ')})`,
        u.passwoerter ? `${u.passwoerter} Feld(er) vom Typ password` : 'KEINES — der Schluessel stuende im Klartext',
        u.passwoerter >= geheime.length,
      )
      sagen(
        'und sagen sie, dass leer „unveraendert" heisst?',
        u.mitPlatzhalter
          ? `${u.mitPlatzhalter} mit Platzhalter`
          : 'kein Platzhalter — man traegt ihn jedes Mal neu ein',
        u.mitPlatzhalter >= geheime.length,
      )
    }
  }
}

console.log(`\n${fehler === 0 ? 'Die Seite steht.' : `${fehler} Beanstandung(en).`}`)
if (fehler > 0) {
  console.log('\n── was die Seite zeigt ───────────────────────────────')
  console.log(a.text.slice(0, 700))
}
process.exit(fehler === 0 ? 0 : 1)
