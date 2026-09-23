#!/usr/bin/env node
/**
 * DIE ZWEI EINRICHTUNGSSEITEN UNTER „MEDIEN → DIENSTE" — MIT ECHTEN TIPPS.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Betreiber, 06.08.2026: „mir gefällt nicht das ich immer noch beim zurück aus
 * spotify und jellyfish in das alte menü komme. bitte integriere die
 * einstellung von jellyfin spotify direkt direkt dem menü."
 *
 * Daraus wurden zwei Unterseiten. An ihnen haengen DREI Aussagen, die man
 * einem Bildschirmfoto nicht ansieht und einem gruenen Testlauf erst recht
 * nicht:
 *
 *   1. GEHEIMNISSE STEHEN NICHT DA. `refreshToken` und `apiKey` sind
 *      Dauerzugaenge. Dass sie nicht IM BILD stehen, sagt nichts — sie
 *      koennten in einem Attribut, in einer Adresse, in der Konsole oder im
 *      sessionStorage liegen. Dieses Werkzeug sieht in allen vieren nach.
 *
 *   2. NICHTS OHNE DAS TOR. Vor dem geloesten Tor darf kein Abruf hinausgehen
 *      und keine Zeile im Baum stehen — auch nicht `/api/konfiguration`, das
 *      die Serveradresse und die Client-ID traegt.
 *
 *   3. EIN LEERES FELD LOESCHT NICHT. Wer die Tastatur ABBRICHT, darf keinen
 *      Zugang verlieren. Das ist der teuerste stille Fehler dieser Seiten:
 *      Spotify waere danach aus, und gemerkt wird es erst, wenn ein Kind etwas
 *      abspielen will. Gemessen wird deshalb, ob nach einem Abbruch WIRKLICH
 *      KEIN Schreibruf hinausgeht — nicht, ob die Oberflaeche danach noch
 *      richtig AUSSIEHT.
 *
 * ══ UND DER RUECKWEG, DER DEN AUFTRAG AUSLOESTE ════════════════════════════
 * Die alte Dienste-Seite hatte zwei Knoepfe „Einrichten ↗", die in die
 * Angular-App sprangen. Hier wird nachgesehen, dass es sie NICHT MEHR gibt und
 * dass der Rueckweg oben links von der Einrichtung genau EINE Ebene nimmt —
 * auf die Dienste-Uebersicht und nicht in das alte Menue.
 *
 * ══ ES FASST DIE BOX NICHT AN ══════════════════════════════════════════════
 * Es startet seine EIGENE Vorschau auf einem freien Port (`--port`
 * ausdruecklich mitgegeben — ohne ihn bediente sie 8299, und der gehoert
 * womoeglich einem anderen Arbeitsbaum). Die Vorschau ist eine Attrappe und
 * kein Weiterreicher: nichts von hier erreicht jemals eine Box.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/dienst-einrichten-schau.mjs
 *   node tools/dienst-einrichten-schau.mjs --bilder /tmp/dienste
 *   node tools/dienst-einrichten-schau.mjs --ziel http://127.0.0.1:8991/neu/
 * ENDE 0, wenn jede Aussage haelt.
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { eigenerBrowser, freierPort } from './leihgabe.mjs'
import { adminAuf } from './admin-weg.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  return i < 0 ? v : argv[i + 1]
}
const MITGEGEBEN = opt('ziel')
const BILDER = opt('bilder')
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

/** Der Schirm der Box: 800x480 auf 5 Zoll = 0,1397 mm je Bildpunkt. */
const MM = 0.1397
/** Die Marke des Hauses: 9 mm je Ziel. */
const MARKE_MM = 9

let fehler = 0
const ja = (b, satz, wie = '') => {
  if (!b) fehler++
  console.log(`${b ? 'ok  ' : 'FEHL'}  ${satz}${wie ? '  — ' + wie : ''}`)
}

/**
 * DIE ZEICHENKETTEN, DIE NIRGENDS AUFTAUCHEN DUERFEN.
 *
 * Es sind die Werte, die in `ZUGANG` der Vorschau stehen (neu-vorschau.mjs).
 * Die Attrappe kennt sie — sie muss, sonst koennte „gesetzt / nicht gesetzt"
 * gar nicht umschlagen. Sie gibt sie aber NIE heraus, genau wie die Box.
 * Findet dieses Werkzeug eine davon im Browser, ist das Leck nicht in der
 * Attrappe, sondern auf dem Weg dahin.
 */
const NIE_SICHTBAR = ['AQD-vorschau-erneuerungsmerkmal', 'jellyfinschluesseldervorschau']

/**
 * WAS DIESES WERKZEUG SELBST EINTIPPT.
 *
 * Es geht ueber die Bildschirmtastatur hinein und darf danach NIRGENDS mehr
 * stehen — nicht im Baum, nicht in einem Attribut, nicht in der Adresse, nicht
 * auf der Konsole, nicht in einem der beiden Speicher. Nur Buchstaben: die
 * Ziffern liegen auf der zweiten Ebene, und ein Ebenenwechsel mitten in dieser
 * Messung pruefte die Tastatur statt der Seite.
 */
const PROBEWERT = 'qwertzui'

/**
 * WAS DIESES WERKZEUG TIPPT UND DANN ABBRICHT.
 *
 * EIGEN UND NICHT `PROBEWERT`, weil die beiden Messungen sonst nicht mehr
 * auseinanderzuhalten waeren: dieser hier darf NIE gespeichert werden, jener
 * wird es. Ausdruecklich eine Folge, die es sonst nirgends im Baum gibt —
 * „abc" stand beim ersten Lauf in der Seite und machte die Aussage rot, ohne
 * dass irgendetwas stehengeblieben waere.
 */
const ABBRUCHWERT = 'zzyyxxww'

// ── Vorschau: eigene oder mitgegebene ──────────────────────────────────────
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
  vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', '--port', String(p)], {
    cwd: WURZEL,
    stdio: 'ignore',
  })
  vorschau.unref()
  let gestorben = null
  vorschau.on('exit', (c) => {
    gestorben = c
  })
  const bis = Date.now() + 10000
  for (;;) {
    if (gestorben !== null)
      throw new Error(`tools/neu-vorschau.mjs endete sofort (${gestorben}) — Port ${p} war belegt`)
    try {
      await fetch(`http://127.0.0.1:${p}/api/werke`)
      break
    } catch {
      if (Date.now() > bis) throw new Error('tools/neu-vorschau.mjs kam nicht hoch')
      await warte(150)
    }
  }
}
console.log(`ZIEL: ${ZIEL}${vorschau ? '  (eigene Vorschau)' : '  (mitgegeben)'}`)

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

/**
 * DER MITSCHREIBER — er zaehlt JEDEN `fetch` mit Art, Pfad UND RUMPF.
 *
 * DER RUMPF IST NEU UND ER IST DER PUNKT. Bei den Schreibwegen dieser Seiten
 * ist die Frage nicht „ging etwas hinaus", sondern WAS: ein
 * `{"aenderungen":{"jellyfinSchluessel":""}}` sieht am Schirm genauso aus wie
 * gar kein Abruf — und loescht den Zugang.
 *
 * ER SPEICHERT NICHT, WAS ER SIEHT, SONDERN WAS ER GEZAEHLT HAT: fuer
 * geheime Felder wird nur die LAENGE aufgehoben und ob der Wert leer war. Ein
 * Werkzeug, das ein Erneuerungsmerkmal in sein Protokoll schreibt, ist genau
 * das Leck, gegen das es prueft.
 */
const MITSCHREIBER = `(() => {
  if (window.__rufe) return true
  window.__rufe = []
  const echt = window.fetch
  window.fetch = function (u, o) {
    try {
      let rumpf = null
      const roh = o && typeof o.body === 'string' ? o.body : ''
      if (roh) {
        try {
          const b = JSON.parse(roh)
          const a = (b && b.aenderungen) || b || {}
          rumpf = {}
          for (const k of Object.keys(a)) {
            const w = a[k]
            rumpf[k] = typeof w === 'string' ? { leer: w === '', laenge: w.length } : { wert: w }
          }
        } catch { rumpf = { unlesbar: true } }
      }
      window.__rufe.push({
        pfad: String(typeof u === 'string' ? u : (u && u.url) || ''),
        art: (o && o.method) || 'GET',
        rumpf,
      })
    } catch { /* ein Abruf, den wir nicht lesen koennen, wird nicht gezaehlt */ }
    return echt.apply(this, arguments)
  }
  return true
})()`

/**
 * DIE GELIEHENE VORSCHAU WIRD WIEDER HINGELEGT — auch die ZUGAENGE.
 *
 * DIESES WERKZEUG LOESCHT MIT ABSICHT (Punkt 5b: Loeschen, das nur angezeigt
 * wird, sieht genauso aus wie echtes). Bei einer EIGENEN Vorschau ist das
 * gleichgueltig — sie stirbt am Ende. Bei einer MITGEGEBENEN (`--ziel`, im
 * Kopf dieser Datei ausdruecklich angeboten) blieb der Jellyfin-Schluessel
 * geloescht stehen, und der NAECHSTE Lauf meldete „es steht nicht da, dass die
 * Probe den Schluessel nicht prueft" — ein Fehler, den es nicht gab. Gemessen
 * am 06.08.2026, zweimal hintereinander gegen dieselbe Vorschau.
 *
 * ZURUECKGELEGT WIRD, WAS VORHER DA WAR, nicht die Vorgabe — dieselbe Regel
 * wie in `vorschauLeihen` (tools/leihgabe.mjs).
 */
let vorherigeLage = null
if (MITGEGEBEN) {
  try {
    const a = await fetch(new URL('/vorschau/lage', ZIEL), { signal: AbortSignal.timeout(2000) })
    const s = await a.json()
    // AN `zugang` ERKENNT MAN DEN NEUEN STAND. Eine aeltere Vorschau kennt das
    // Feld nicht; dann waere ein Zurueckgeben ein halbes und stiller Schaden.
    if (s && s.zugang) vorherigeLage = s
    else console.log('  ACHTUNG  die Vorschau kennt die Zugaenge im Schnappschuss nicht — es wird nichts zurueckgelegt.')
  } catch {
    console.log('  ACHTUNG  /vorschau/lage war nicht zu lesen — es wird nichts zurueckgelegt.')
  }
}
const lageZurueck = async () => {
  if (!vorherigeLage) return
  try {
    await fetch(new URL('/vorschau/lage', ZIEL), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(vorherigeLage),
      signal: AbortSignal.timeout(2000),
    })
  } catch {
    console.log('  ACHTUNG  die Lage liess sich nicht zurueckgeben.')
  }
}

const browser = await eigenerBrowser({ fenster: '800,480' })
if (!browser) {
  console.log('  kein Browser gefunden — uebersprungen')
  await lageZurueck()
  process.exit(0)
}
let ws = null
try {
  if (BILDER) await mkdir(BILDER, { recursive: true })
  ws = new WebSocket(await browser.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false,
  })

  /** WAS DIE SEITE AUF DIE KONSOLE SCHREIBT — Punkt 1 prueft auch DA. */
  const konsole = []
  ws.on('message', (r) => {
    const x = JSON.parse(r)
    if (x.method !== 'Runtime.consoleAPICalled') return
    for (const a of x.params.args || []) konsole.push(String(a.value ?? a.description ?? ''))
  })

  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  const stand = async (w) => {
    await fetch(new URL(`/vorschau/${w}`, ZIEL)).catch(() => null)
    await warte(120)
  }
  const laden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2200)
    await ev(MITSCHREIBER)
  }
  const bild = async (name) => {
    if (!BILDER) return
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(join(BILDER, `${name}.png`), Buffer.from(s.data, 'base64'))
    console.log(`      Bild: ${join(BILDER, `${name}.png`)}`)
  }
  const hinein = async () => {
    // HIER STAND EIN GRIFF ANS ZAHNRAD `#einst-knopf`. Es ist am 06.08.2026
    // ersatzlos entfallen; hinein fuehrt der Schriftzug `#wappen`. Dieser Weg
    // ist der TASTATURWEG und prueft das Halten NICHT — tools/admin-weg.mjs.
    await adminAuf(ev, { warteMs: 1100 })
  }
  const gruppe = async (id) => {
    await ev(`document.querySelector('#eltern-faecher [data-fach="${id}"]').click()`)
    await warte(800)
  }
  const zeile = async (name) => {
    const ok = await ev(`(() => {
      for (const z of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
        const n = z.querySelector('.zeile-name')
        if (!n || !n.textContent.trim().startsWith(${JSON.stringify(name)})) continue
        const k = z.querySelector('.zeile-tat')
        if (k) { k.click(); return true }
        if (z.tagName === 'BUTTON') { z.click(); return true }
      }
      return false })()`)
    await warte(900)
    return ok === true
  }
  const zurueck = async () => {
    await ev(`document.getElementById('zurueck').click()`)
    await warte(700)
  }
  const rufe = async () => JSON.parse(await ev(`JSON.stringify(window.__rufe || [])`))
  const rufeLeeren = async () => await ev(`(window.__rufe = [], true)`)

  /**
   * DIE ZWEI FRAGEN AN JEDE SEITE MIT FESTER ZEILENZAHL — wortgleich zu
   * `kartePruefen` in tools/admin-menue-schau.mjs.
   *
   * SIE GILT HIER, WEIL DIE ZEILENZAHL IM CODE STEHT: Jellyfin hat DREI
   * Zeilen, Spotify DREI. (Hier stand „vier und vier" — das war der Stand vor
   * dem ersten Bildschirmfoto, das die vierte Zeile ausserhalb der Karte fand;
   * die Aussagen weiter unten pruefen seither auf drei.) Das ist keine offene
   * Liste wie WLAN, wo so viele
   * Zeilen stehen, wie es gerade Netze gibt. Und sie hat in diesem Haus schon
   * dreimal etwas gefunden, was gruene Aussagen nicht sahen — zuletzt einen
   * Knopf, der zu 86 Prozent dastand und deshalb ganz aussah.
   */
  const kartePruefen = async (wo) => {
    const m = JSON.parse(
      await ev(`JSON.stringify((() => {
        const f = document.getElementById('fach-zeilen')
        const fr = f.getBoundingClientRect()
        const teil = (b) => Math.max(0, Math.min(b.bottom, fr.bottom) - Math.max(b.top, fr.top))
        const zeilen = [...f.querySelectorAll('.fach-zeile')].map((z) => {
          const k = z.querySelector('.zeile-tat')
          const kr = k ? k.getBoundingClientRect() : null
          return {
            n: (z.querySelector('.zeile-name')||{}).textContent || '',
            zeilePx: Math.round(teil(z.getBoundingClientRect())),
            knopfTeil: kr && kr.height ? teil(kr) / kr.height : null,
          }
        })
        return { sicht: Math.round(fr.height), inhalt: Math.round(f.scrollHeight), zeilen }
      })())`),
    )
    console.log(`      ${wo}: ${m.sicht} px Sicht, ${m.inhalt} px Inhalt${m.inhalt > m.sicht + 1 ? ' — rollt' : ''}`)
    const weg = m.zeilen.filter((z) => z.zeilePx < 10)
    ja(
      weg.length === 0,
      `   ${wo}: von jeder Zeile sind mindestens 10 px zu sehen`,
      weg.map((z) => z.n).join(', ') || '—',
    )
    const heikel = m.zeilen.filter((z) => z.knopfTeil !== null && z.knopfTeil > 1 / 3 && z.knopfTeil < 0.95)
    ja(
      heikel.length === 0,
      `   ${wo}: jeder Knopf steht GANZ da oder nur als Schnipsel`,
      heikel.map((z) => `${z.n} ${Math.round(z.knopfTeil * 100)} %`).join(', ') || '—',
    )
  }

  const lage = async () =>
    JSON.parse(
      await ev(`JSON.stringify({
        kopf: (document.getElementById('fach-name')||{}).textContent || '',
        unter: (document.getElementById('eltern-unter')||{}).textContent || '',
        tat: (() => { const k = document.getElementById('fach-tat'); return k && !k.hidden ? k.textContent : '' })(),
        hinweis: (() => { const h = document.getElementById('fach-hinweis'); return h && !h.hidden ? h.textContent : '' })(),
        tastatur: !document.getElementById('tastatur').hidden,
        tastFrage: (document.getElementById('tast-frage')||{}).textContent || '',
        tastGeheim: !(document.getElementById('tast-auge')||{}).hidden,
        zeilen: [...document.querySelectorAll('#fach-zeilen .fach-zeile')].map((z) => ({
          name: (z.querySelector('.zeile-name')||{}).textContent || '',
          unter: (z.querySelector('.zeile-unter')||{}).textContent || '',
          knopf: (z.querySelector('.zeile-tat')||{}).textContent || '',
          knopfAus: !!(z.querySelector('.zeile-tat')||{}).disabled,
          hoch: Math.round(z.getBoundingClientRect().height),
          knopfHoch: Math.round(((z.querySelector('.zeile-tat')||{}).getBoundingClientRect
            ? z.querySelector('.zeile-tat').getBoundingClientRect().height : 0)),
        })),
      })`),
    )

  /** Der GANZE Baum als Text, plus jedes Attribut, plus die beiden Speicher. */
  const alleSpuren = async () =>
    await ev(`(() => {
      const teile = [document.documentElement.outerHTML]
      try { for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i); teile.push(k + '=' + sessionStorage.getItem(k)) } } catch {}
      try { for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i); teile.push(k + '=' + localStorage.getItem(k)) } } catch {}
      teile.push(location.href)
      return teile.join('\\n')
    })()`)

  // ══ 1. VOR DEM TOR LIEGT NICHTS — AUCH KEIN ZUGANG ══════════════════════
  console.log('\n══ NICHTS OHNE DAS TOR ══════════════════════════════════════')
  await stand('voll')
  await stand('sperre-pin')
  await laden()
  await hinein()
  const vorRufe = await rufe()
  const verboten = vorRufe.filter((r) => /\/api\/(konfiguration|spotify\/config|musikdienste)/.test(r.pfad))
  ja(
    verboten.length === 0,
    'vor dem geloesten Tor geht KEIN Abruf zu Konfiguration oder Zugang hinaus',
    verboten.map((r) => r.art + ' ' + r.pfad).join(', ') || 'keiner',
  )
  const vorBaum = await alleSpuren()
  ja(
    !NIE_SICHTBAR.some((g) => vorBaum.includes(g)),
    'und kein Zugang steht im Baum oder in einem Speicher',
    'geprueft: Baum, Attribute, Adresse, sessionStorage, localStorage',
  )

  // ══ 2. DIE DIENSTE-UEBERSICHT HAT KEINEN AUSGANG MEHR ═══════════════════
  console.log('\n══ DER PFEIL ↗ IST WEG ══════════════════════════════════════')
  await stand('sperre-aus')
  await laden()
  await hinein()
  await gruppe('medien')
  await zeile('Dienste')
  const uebersicht = await lage()
  console.log(`      Kopf: „${uebersicht.kopf}"  ·  ${uebersicht.unter}`)
  for (const z of uebersicht.zeilen) console.log(`      · ${z.name} [${z.knopf || '—'}]`)
  ja(uebersicht.kopf === 'Dienste', 'die Uebersicht „Dienste" steht', uebersicht.kopf)
  const mitPfeil = uebersicht.zeilen.filter((z) => z.knopf.includes('↗'))
  ja(
    mitPfeil.length === 0,
    'KEINE Zeile fuehrt mehr aus der Oberflaeche hinaus',
    mitPfeil.map((z) => z.name + ' ' + z.knopf).join(', ') || 'keine',
  )
  ja(
    uebersicht.zeilen.some((z) => z.name === 'Spotify' && z.knopf === 'Einrichten'),
    'Spotify traegt „Einrichten" ohne Pfeil',
  )
  ja(
    uebersicht.zeilen.some((z) => z.name === 'Jellyfin' && z.knopf === 'Einrichten'),
    'Jellyfin traegt „Einrichten" ohne Pfeil',
  )

  // ══ 3. JELLYFIN ═════════════════════════════════════════════════════════
  console.log('\n══ JELLYFIN ═════════════════════════════════════════════════')
  await rufeLeeren()
  await zeile('Jellyfin')
  const jf = await lage()
  console.log(`      Kopf: „${jf.kopf}"  ·  ${jf.unter}  ·  Tat „${jf.tat}"`)
  for (const z of jf.zeilen) console.log(`      · ${z.name} [${z.knopf || '—'}] ${z.hoch} px — ${z.unter}`)
  await bild('1-jellyfin')
  ja(jf.kopf === 'Jellyfin', 'die Einrichtung steht als eigene Seite', jf.kopf)
  ja(
    jf.zeilen.some((z) => z.name === 'Serveradresse' && z.unter.includes('http://')),
    'die eingetragene Serveradresse steht da',
    (jf.zeilen.find((z) => z.name === 'Serveradresse') || {}).unter || '—',
  )
  ja(
    jf.zeilen.some((z) => z.name === 'API-Schlüssel'),
    'der Schluessel hat eine eigene Zeile',
  )
  // ── BERICHTIGT AM 06.08.2026, NICHT ABGESCHWAECHT ────────────────────
  // Diese Aussage suchte zuerst eine eigene Zeile „Probe". Die gibt es nicht
  // mehr: sie war die VIERTE Zeile und stand vollstaendig ausserhalb der
  // Karte (gefunden am Bildschirmfoto `1-jellyfin.png`). Die Aussage selbst
  // bleibt dieselbe — die Grenze der Probe muss dastehen —, sie wird nur dort
  // gesucht, wo sie jetzt steht: in der Zeile mit dem Schluessel.
  ja(
    jf.zeilen.some((z) => z.name === 'API-Schlüssel' && z.unter.includes('ob er gilt, prüft die Box nicht')),
    'es steht AUSDRUECKLICH da, dass die Probe den Schluessel nicht prueft',
    (jf.zeilen.find((z) => z.name === 'API-Schlüssel') || {}).unter || '—',
  )
  ja(
    (jf.zeilen.find((z) => z.name === 'Serveradresse') || {}).unter?.includes('antwortet'),
    'und die Erreichbarkeit steht bei der Adresse, ueber die sie etwas sagt',
    (jf.zeilen.find((z) => z.name === 'Serveradresse') || {}).unter || '—',
  )
  ja(jf.zeilen.length === 3, 'die Seite hat DREI Zeilen — die Zahl, die in die Karte passt', String(jf.zeilen.length))
  ja(jf.tat === '', 'und der Kopf traegt keinen Knopf; das sind die 41 px, die die dritte Zeile braucht', jf.tat || '(keiner)')
  const jfRufe = await rufe()
  ja(
    jfRufe.some((r) => r.pfad.includes('/api/konfiguration') && r.art === 'GET'),
    'sie holt den geschriebenen Stand erst HIER und nicht auf der Uebersicht',
    jfRufe.map((r) => r.art + ' ' + r.pfad.replace(/^.*\/api/, '/api')).join(', ') || 'keiner',
  )

  // ── Die Marke: 9 mm je Ziel ─────────────────────────────────────────────
  const klein = jf.zeilen.filter((z) => z.knopfHoch > 0 && z.knopfHoch * MM < MARKE_MM)
  ja(
    klein.length === 0,
    `jedes Ziel dieser Seite haelt die 9-mm-Marke`,
    klein.map((z) => `${z.name} ${(z.knopfHoch * MM).toFixed(2)} mm`).join(', ') || '—',
  )
  await kartePruefen('Jellyfin')

  // ══ 4. EIN ABBRUCH DARF NICHTS LOESCHEN ═════════════════════════════════
  //
  // DER TEUERSTE STILLE FEHLER DIESER SEITEN. Gemessen wird nicht, wie es
  // danach AUSSIEHT, sondern ob ueberhaupt ein Schreibruf hinausgeht.
  console.log('\n══ ABBRECHEN LOESCHT NICHT ══════════════════════════════════')
  await rufeLeeren()
  await zeile('API-Schlüssel')
  const tast = await lage()
  ja(tast.tastatur, 'die Tastatur geht auf', tast.tastFrage)
  ja(tast.tastGeheim, 'und sie ist VERDECKT — das Auge steht da', String(tast.tastGeheim))
  await bild('2-jellyfin-tastatur')
  // Etwas tippen UND DANN ABBRECHEN — der Fehlgriff, um den es geht.
  await ev(`(() => { for (const t of ${JSON.stringify(ABBRUCHWERT)}) {
    const k = [...document.querySelectorAll('#tast-feld button')].find((b) => b.textContent === t)
    if (k) k.click() } return true })()`)
  await warte(200)
  await ev(`document.getElementById('tast-weg').click()`)
  await warte(700)
  const nachAbbruch = await rufe()
  const geschrieben = nachAbbruch.filter((r) => r.art === 'POST')
  ja(
    geschrieben.length === 0,
    'nach dem Abbrechen ging KEIN Schreibruf hinaus',
    geschrieben.map((r) => r.art + ' ' + r.pfad + ' ' + JSON.stringify(r.rumpf)).join(', ') || 'keiner',
  )
  const nachAbbruchBaum = await alleSpuren()
  ja(
    !nachAbbruchBaum.includes(ABBRUCHWERT),
    'und das Getippte ist weggeraeumt, nicht nur versteckt',
    'geprueft: Baum, Attribute, Adresse, beide Speicher',
  )

  // ══ 5. LOESCHEN IST EIN EIGENER KNOPF MIT EIGENER RUECKFRAGE ════════════
  console.log('\n══ LOESCHEN FRAGT NACH ══════════════════════════════════════')
  // Erst einen Schluessel setzen — sonst ist der Loeschknopf zu Recht aus.
  await zeile('API-Schlüssel')
  // NUR BUCHSTABEN — die Ziffern liegen auf der zweiten Ebene, und ein
  // Ebenenwechsel mitten in dieser Messung pruefte die Tastatur und nicht die
  // Seite. `PROBEWERT` ist so gewaehlt, dass er sonst nirgends im Baum steht.
  await ev(`(() => { for (const t of ${JSON.stringify(PROBEWERT)}) {
    const k = [...document.querySelectorAll('#tast-feld button')].find((b) => b.textContent === t)
    if (k) k.click() } return true })()`)
  await warte(250)
  await ev(`(() => { const f = [...document.querySelectorAll('#tast-feld button')]
    .find((b) => b.textContent === 'Fertig'); if (f && !f.disabled) { f.click(); return true } return false })()`)
  await warte(1200)
  const nachSetzen = await lage()
  console.log(`      Hinweis: „${nachSetzen.hinweis}"`)
  ja(
    (nachSetzen.zeilen.find((z) => z.name === 'API-Schlüssel') || {}).unter?.includes('hinterlegt'),
    'nach dem Setzen sagt die Zeile „hinterlegt" — und nennt den Wert NICHT',
    (nachSetzen.zeilen.find((z) => z.name === 'API-Schlüssel') || {}).unter || '—',
  )
  const nachSetzenBaum = await alleSpuren()
  ja(
    !nachSetzenBaum.includes(PROBEWERT),
    'der eben getippte Schluessel steht NIRGENDS mehr',
    'geprueft: Baum, Attribute, Adresse, beide Speicher',
  )
  ja(
    !konsole.some((k) => k.includes(PROBEWERT)),
    'und er stand auch nicht auf der Konsole',
    konsole.length + ' Konsolenzeilen gelesen',
  )

  await rufeLeeren()
  const gabLoesch = await zeile('Schlüssel löschen')
  ja(gabLoesch, 'es gibt einen eigenen Knopf „Löschen"')
  const frage = await lage()
  await bild('3-jellyfin-loeschfrage')
  ja(frage.zeilen.length === 2, 'die Rueckfrage steht ALLEIN — zwei Zeilen', String(frage.zeilen.length))
  ja(
    frage.zeilen[0] && frage.zeilen[0].knopf === 'Abbrechen',
    'und in der ERSTEN Zeile steht Abbrechen, nicht Löschen',
    (frage.zeilen[0] || {}).knopf || '—',
  )
  const beiFrage = await rufe()
  ja(
    beiFrage.filter((r) => r.art === 'POST').length === 0,
    'die Frage allein schreibt nichts',
    beiFrage.filter((r) => r.art === 'POST').length + ' Schreibrufe',
  )

  // ── DER RUECKWEG AUS DER RUECKFRAGE NIMMT GENAU EINE EBENE ────────────
  // Er wird VOR dem Loeschen gemessen: danach ist der Loeschknopf zu Recht
  // aus, und die Rueckfrage waere nicht wieder aufzuschlagen.
  await zurueck()
  const nachZurueck1 = await lage()
  ja(
    nachZurueck1.kopf === 'Jellyfin' && nachZurueck1.zeilen.length === 3,
    'der Rueckweg aus der Rueckfrage fuehrt auf die Einrichtung — EINE Ebene',
    `${nachZurueck1.kopf}, ${nachZurueck1.zeilen.length} Zeilen`,
  )
  await zeile('Schlüssel löschen')

  // ══ 5b. UND WENN MAN WIRKLICH LOESCHT ═══════════════════════════════════
  //
  // ES WIRD HIER TATSAECHLICH GELOESCHT, und zwar in der Attrappe. Der Grund
  // ist derselbe wie ueberall in dieser Datei: eine Oberflaeche, die das
  // Loeschen nur ANZEIGT, sieht genauso aus wie eine, die es tut. Gemessen
  // wird, dass GENAU EIN Schreibruf hinausgeht, dass er das leere Feld traegt
  // (`leer: true`) — und dass die Seite danach den NEUEN Stand zeigt und nicht
  // den, den sie sich gemerkt hat.
  await rufeLeeren()
  await ev(`(() => { for (const z of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
    const n = z.querySelector('.zeile-name')
    if (n && n.textContent.trim() === 'Ja, löschen') { z.querySelector('.zeile-tat').click(); return true }
  } return false })()`)
  await warte(1400)
  const nachLoeschen = await lage()
  await bild('3b-jellyfin-ohne-schluessel')
  const loeschRufe = (await rufe()).filter((r) => r.art === 'POST')
  ja(
    loeschRufe.length === 1 && loeschRufe[0].rumpf && loeschRufe[0].rumpf.jellyfinSchluessel?.leer === true,
    'ein „Ja, löschen" schickt GENAU EINEN Schreibruf, und der traegt das leere Feld',
    loeschRufe.map((r) => r.pfad.replace(/^.*\/api/, '/api') + ' ' + JSON.stringify(r.rumpf)).join(', ') || 'keiner',
  )
  const schluesselZeile = nachLoeschen.zeilen.find((z) => z.name === 'API-Schlüssel')
  ja(
    !!schluesselZeile && schluesselZeile.unter.startsWith('Kein Schlüssel hinterlegt'),
    'die Seite zeigt danach den NEUEN Stand',
    (schluesselZeile || {}).unter || '—',
  )
  const loeschZeile = nachLoeschen.zeilen.find((z) => z.name === 'Schlüssel löschen')
  ja(
    !!loeschZeile && loeschZeile.knopfAus,
    'und der Loeschknopf ist aus — es gibt nichts mehr zu loeschen',
    loeschZeile ? `aus: ${loeschZeile.knopfAus}` : '—',
  )
  ja(nachLoeschen.zeilen.length === 3, 'die Seite hat auch OHNE Schluessel drei Zeilen — nichts wandert')
  await kartePruefen('Jellyfin ohne Schlüssel')

  // ── Und der Rueckweg nimmt genau EINE Ebene ────────────────────────────
  await zurueck()
  const nachZurueck2 = await lage()
  ja(
    nachZurueck2.kopf === 'Dienste',
    'und von der Einrichtung auf die Dienste-Uebersicht — nicht ins alte Menue',
    nachZurueck2.kopf,
  )

  // ══ 6. SPOTIFY ══════════════════════════════════════════════════════════
  console.log('\n══ SPOTIFY ══════════════════════════════════════════════════')
  await rufeLeeren()
  await zeile('Spotify')
  const sp = await lage()
  console.log(`      Kopf: „${sp.kopf}"  ·  ${sp.unter}  ·  Tat „${sp.tat}"`)
  for (const z of sp.zeilen) console.log(`      · ${z.name} [${z.knopf || '—'}] ${z.hoch} px — ${z.unter}`)
  await bild('4-spotify')
  ja(sp.kopf === 'Spotify', 'die Einrichtung steht als eigene Seite', sp.kopf)
  const idZeile = sp.zeilen.find((z) => z.name === 'Client-ID')
  ja(
    !!idZeile && idZeile.unter.length > 16 && !idZeile.unter.includes('•'),
    'die Client-ID steht OFFEN da — sie ist kein Geheimnis (PKCE)',
    (idZeile || {}).unter || '—',
  )
  const merkZeile = sp.zeilen.find((z) => z.name === 'Erneuerungsmerkmal')
  ja(
    !!merkZeile && merkZeile.unter.includes('hinterlegt') && !merkZeile.unter.includes('AQD'),
    'das Erneuerungsmerkmal wird als VORHANDEN gemeldet und nicht gezeigt',
    (merkZeile || {}).unter || '—',
  )
  // AUCH HIER BERICHTIGT: die eigene Zeile „Zugang entfernen" war die vierte
  // und lag ausserhalb der Karte. Der Satz steht jetzt in der Zeile, in der
  // jemand nach dem Loeschen sucht — gepruft wird derselbe Sachverhalt.
  ja(
    !!merkZeile && merkZeile.unter.includes('nicht löschen'),
    'und es steht dabei, dass sich das Merkmal hier NICHT löschen lässt',
    (merkZeile || {}).unter || '—',
  )
  ja(sp.zeilen.length === 3, 'die Seite hat DREI Zeilen', String(sp.zeilen.length))
  ja(sp.tat === '', 'und einen flachen Kopf ohne Knopf', sp.tat || '(keiner)')
  const spBaum = await alleSpuren()
  ja(
    !NIE_SICHTBAR.some((g) => spBaum.includes(g)),
    'und auf dieser Seite steht kein Zugang im Baum, in einem Attribut oder in einem Speicher',
  )
  const spKlein = sp.zeilen.filter((z) => z.knopfHoch > 0 && z.knopfHoch * MM < MARKE_MM)
  ja(
    spKlein.length === 0,
    'jedes Ziel dieser Seite haelt die 9-mm-Marke',
    spKlein.map((z) => `${z.name} ${(z.knopfHoch * MM).toFixed(2)} mm`).join(', ') || '—',
  )
  await kartePruefen('Spotify')

  // ── Und der Rueckweg von hier ist auch EINE Ebene ───────────────────────
  await zurueck()
  const zurueckSp = await lage()
  ja(zurueckSp.kopf === 'Dienste', 'auch von Spotify fuehrt EIN Tipp auf die Dienste-Uebersicht', zurueckSp.kopf)

  console.log(`\n${fehler === 0 ? 'alles haelt' : fehler + ' Aussage(n) rot'}`)
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  // IM `finally` UND NICHT AM ENDE DES LAUFS: Bricht eine Aussage mit einer
  // Ausnahme ab, ist die Vorschau erst recht halb verstellt.
  await lageZurueck()
  await browser.schliessen()
}
process.exit(fehler === 0 ? 0 : 1)
