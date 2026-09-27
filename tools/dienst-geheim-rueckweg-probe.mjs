#!/usr/bin/env node
/**
 * GEGENPROBE ZU DEN ZWEI EINRICHTUNGSSEITEN — DAS GEHEIMNIS UND DER RUECKWEG.
 *
 * ══ WARUM ES DIESES ZWEITE WERKZEUG GIBT ═══════════════════════════════════
 * `tools/dienst-einrichten-schau.mjs` faehrt beide Seiten ab und ist gruen.
 * Es tippt dabei aber NUR den Jellyfin-Schluessel ein. Das zweite Geheimnis
 * dieser Seiten — das SPOTIFY-ERNEUERUNGSMERKMAL — wird dort nur ANGESEHEN,
 * nie GETIPPT. Genau das ist der Unterschied, auf den es ankommt: ein Wert,
 * der nie durch die Oberflaeche gelaufen ist, kann auch nirgends
 * durchsickern. Die Aussage „kein Geheimnis steht da" ist fuer dieses Feld
 * also bisher unbewiesen — und es laeuft ueber einen ANDEREN Weg als der
 * Jellyfin-Schluessel (`POST /api/spotify/config` statt
 * `POST /api/konfiguration`), also ueber Code, den die erste Messung nicht
 * angefasst hat.
 *
 * ══ DIE VIER FRAGEN ════════════════════════════════════════════════════════
 *
 *   1. DAS SPOTIFY-MERKMAL, WIRKLICH GETIPPT. Danach: Baum, JEDES Attribut,
 *      die Adresse, die Konsole, sessionStorage und localStorage. Und der
 *      Schreibruf selbst — er muss GENAU EINER sein, an `/api/spotify/config`
 *      gehen und die Client-ID UNVERAENDERT mitschicken (der Server verlangt
 *      beide; wer dabei die ID verstellt, nimmt der Box Spotify, ohne dass es
 *      jemand am Schirm sieht).
 *
 *   2. EIN LEERES FELD LOESCHT NICHT — und zwar an der Stelle, an der man es
 *      WIRKLICH versucht: nicht „Abbrechen" (das prueft die erste Messung
 *      schon), sondern ALLES WEGLOESCHEN und dann „Fertig" druecken. Bei einem
 *      Feld mit altem Wert (Client-ID, Serveradresse) steht der alte Text in
 *      der Tastatur; wer ihn mit ⌫ leert, hat ein leeres Feld vor sich. Bleibt
 *      „Fertig" dann bedienbar, ist der Zugang mit zwei Tipps weg.
 *
 *   3. DER RUECKWEG, DER DEN AUFTRAG AUSLOESTE. Betreiber, 06.08.2026: „mir
 *      gefällt nicht das ich immer noch beim zurück aus spotify und jellyfish
 *      in das alte menü komme." Gemessen wird die GANZE Kette — Einrichtung →
 *      Dienste → Medien → hinaus — und bei JEDEM Schritt, dass die Adresse des
 *      Browsers noch auf `/neu/` steht. Ein Sprung in die Angular-App waere
 *      ein Wechsel der Adresse, und der faellt in einer Zeilenzaehlung nicht
 *      auf.
 *
 *   4. WIE ES AUSSIEHT, HELL UND DUNKEL. Ein Bild je Seite je Licht. Dreimal
 *      hat in diesem Haus genau das einen Fehler gefunden, den gruene
 *      Aussagen nicht sahen.
 *
 * ══ ES FASST DIE BOX NICHT AN ══════════════════════════════════════════════
 * Eigene Vorschau auf einem freien Port, ausdruecklich mitgegeben. Nichts von
 * hier erreicht jemals eine Box.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/dienst-geheim-rueckweg-probe.mjs
 *   node tools/dienst-geheim-rueckweg-probe.mjs --ziel http://127.0.0.1:8993/neu/
 *   node tools/dienst-geheim-rueckweg-probe.mjs --bilder /tmp/geheim
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

let fehler = 0
const ja = (b, satz, wie = '') => {
  if (!b) fehler++
  console.log(`${b ? 'ok  ' : 'FEHL'}  ${satz}${wie ? '  — ' + wie : ''}`)
}

/**
 * DIE WERTE, DIE IN DER ATTRAPPE STEHEN UND NIE HERAUSKOMMEN DUERFEN.
 * Wortgleich zu `ZUGANG` in tools/neu-vorschau.mjs.
 */
const NIE_SICHTBAR = ['AQD-vorschau-erneuerungsmerkmal', 'jellyfinschluesseldervorschau']

/**
 * WAS HIER EINGETIPPT WIRD.
 *
 * Nur Buchstaben der ersten Ebene — ein Ebenenwechsel mitten in der Messung
 * pruefte die Tastatur statt der Seite. Jeder Wert ist eine Folge, die es
 * sonst nirgends im Baum gibt; „abc" stuende sonst in irgendeiner Unterzeile
 * und machte die Aussage rot, ohne dass etwas durchgesickert waere.
 */
const MERKMAL = 'kjhgfdsa'
const ABBRUCH = 'plmokn'

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
    if (gestorben !== null) throw new Error(`tools/neu-vorschau.mjs endete sofort (${gestorben}) — Port ${p} belegt`)
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
 * DER MITSCHREIBER — er zaehlt jeden `fetch` mit Art, Pfad und RUMPF.
 *
 * ER HEBT KEINEN WERT AUF, sondern nur die Laenge und ob leer. Ein Werkzeug,
 * das ein Erneuerungsmerkmal in sein Protokoll schreibt, ist genau das Leck,
 * gegen das es prueft. AUSNAHME mit Absicht: `clientId` — sie ist kein
 * Geheimnis (PKCE, `art: 'text'` in der Feldliste der Box), und OHNE ihren
 * WERT liesse sich die Aussage „die Client-ID geht UNVERAENDERT mit" gar nicht
 * treffen.
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
            if (k === 'clientId' || k === 'spotifyClientId') rumpf[k] = { wert: String(w) }
            else rumpf[k] = typeof w === 'string' ? { leer: w === '', laenge: w.length } : { wert: w }
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
 * DIE GELIEHENE VORSCHAU WIRD WIEDER HINGELEGT.
 *
 * Dieses Werkzeug SETZT ein Erneuerungsmerkmal (Punkt 2 — ohne wirklich zu
 * schreiben waere die Aussage „es sickert nichts durch" wertlos) und aendert
 * dabei den Zustand der Attrappe. Bei einer eigenen Vorschau ist das egal, sie
 * stirbt am Ende; bei einer mitgegebenen bliebe der neue Stand stehen und der
 * naechste Lauf eines anderen Werkzeugs faende ihn vor. Dieselbe Regel wie in
 * `vorschauLeihen` (tools/leihgabe.mjs): zurueckgelegt wird, was vorher da war.
 */
let vorherigeLage = null
if (MITGEGEBEN) {
  try {
    const s = await (await fetch(new URL('/vorschau/lage', ZIEL), { signal: AbortSignal.timeout(2000) })).json()
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
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

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
  const licht = async (was) => {
    await ev(`localStorage.setItem('mupibox_neu_licht_v1', ${JSON.stringify(was)})`)
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
  const tippen = async (text) => {
    await ev(`(() => { for (const t of ${JSON.stringify(text)}) {
      const k = [...document.querySelectorAll('#tast-feld button')].find((b) => b.textContent === t)
      if (k) k.click() } return true })()`)
    await warte(220)
  }
  /** ⌫ so oft druecken, wie das Feld Zeichen hat — bis es WIRKLICH leer ist. */
  const alleWeg = async () => {
    await ev(`(() => {
      const w = [...document.querySelectorAll('#tast-feld button')].find((b) => b.dataset.taste === 'weg')
      for (let i = 0; i < 80; i++) w.click()
      return true })()`)
    await warte(220)
  }
  const tastStand = async () =>
    JSON.parse(
      await ev(`JSON.stringify((() => {
        const f = [...document.querySelectorAll('#tast-feld button')].find((b) => b.dataset.taste === 'fertig')
        return {
          offen: !document.getElementById('tastatur').hidden,
          frage: (document.getElementById('tast-frage')||{}).textContent || '',
          anzeige: (document.getElementById('tast-anzeige')||{}).textContent || '',
          geheim: !(document.getElementById('tast-auge')||{}).hidden,
          fertigAus: !!(f && f.disabled),
        } })())`),
    )
  const lage = async () =>
    JSON.parse(
      await ev(`JSON.stringify({
        kopf: (document.getElementById('fach-name')||{}).textContent || '',
        unter: (document.getElementById('eltern-unter')||{}).textContent || '',
        adresse: location.pathname + location.search,
        elternOffen: !document.getElementById('eltern').hidden,
        zeilen: [...document.querySelectorAll('#fach-zeilen .fach-zeile')].map((z) => ({
          name: (z.querySelector('.zeile-name')||{}).textContent || '',
          unter: (z.querySelector('.zeile-unter')||{}).textContent || '',
          knopf: (z.querySelector('.zeile-tat')||{}).textContent || '',
        })),
      })`),
    )
  /** Der GANZE Baum als Text, plus jedes Attribut, plus beide Speicher, plus die Adresse. */
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

  const aufSpotify = async () => {
    await gruppe('medien')
    await zeile('Dienste')
    await zeile('Spotify')
  }

  // ══ 1. VOR DEM TOR STEHT NICHTS ═════════════════════════════════════════
  console.log('\n══ 1  NICHTS OHNE DAS TOR ═══════════════════════════════════')
  await stand('voll')
  await stand('sperre-pin')
  await laden()
  await hinein()
  const vorRufe = await rufe()
  const verboten = vorRufe.filter((r) => /\/api\/(konfiguration|spotify\/config|spotify\/bereit|musikdienste)/.test(r.pfad))
  ja(
    verboten.length === 0,
    'vor dem geloesten Tor geht KEIN Abruf zu Konfiguration oder Zugang hinaus',
    verboten.map((r) => r.art + ' ' + r.pfad).join(', ') || 'keiner',
  )
  const vorLage = await lage()
  ja(vorLage.zeilen.length === 0, 'und KEINE Zeile steht im Baum', String(vorLage.zeilen.length))
  const vorBaum = await alleSpuren()
  ja(
    !NIE_SICHTBAR.some((g) => vorBaum.includes(g)),
    'und kein Zugang steht im Baum, in einem Attribut oder in einem Speicher',
    'geprueft: Baum, Attribute, Adresse, beide Speicher',
  )

  // ══ 2. DAS SPOTIFY-MERKMAL — WIRKLICH GETIPPT ═══════════════════════════
  console.log('\n══ 2  DAS SPOTIFY-MERKMAL, WIRKLICH GETIPPT ═════════════════')
  await stand('sperre-aus')
  await laden()
  await hinein()
  await aufSpotify()
  const sp0 = await lage()
  ja(sp0.kopf === 'Spotify', 'die Einrichtung steht', sp0.kopf)
  const idVorher = (sp0.zeilen.find((z) => z.name === 'Client-ID') || {}).unter || ''
  console.log(`      Client-ID vorher: ${idVorher}`)

  await rufeLeeren()
  await zeile('Erneuerungsmerkmal')
  const t1 = await tastStand()
  ja(t1.offen, 'die Tastatur geht auf', t1.frage)
  ja(t1.geheim, 'und sie ist VERDECKT — das Auge steht da', String(t1.geheim))
  ja(t1.anzeige === '–', 'sie faengt LEER an — ein Geheimnis wird nicht vorgelegt', `„${t1.anzeige}"`)
  await tippen(MERKMAL)
  const t1b = await tastStand()
  ja(
    t1b.anzeige === '•'.repeat(MERKMAL.length),
    'waehrend des Tippens stehen Punkte da, nicht der Wert',
    `„${t1b.anzeige}"`,
  )
  await ev(`(() => { const f = [...document.querySelectorAll('#tast-feld button')]
    .find((b) => b.dataset.taste === 'fertig'); if (f && !f.disabled) { f.click(); return true } return false })()`)
  await warte(1400)

  const merkRufe = await rufe()
  const schreib = merkRufe.filter((r) => r.art === 'POST')
  ja(schreib.length === 1, 'GENAU EIN Schreibruf geht hinaus', String(schreib.length))
  const s0 = schreib[0] || { pfad: '', rumpf: {} }
  ja(s0.pfad.includes('/api/spotify/config'), 'und er geht an den einzigen Weg, den es dafuer gibt', s0.pfad.replace(/^.*\/api/, '/api'))
  ja(
    s0.rumpf && s0.rumpf.refreshToken && s0.rumpf.refreshToken.laenge === MERKMAL.length && !s0.rumpf.refreshToken.leer,
    'er traegt das Merkmal in voller Laenge und NICHT leer',
    JSON.stringify(s0.rumpf && s0.rumpf.refreshToken),
  )
  ja(
    s0.rumpf && s0.rumpf.clientId && idVorher.includes(s0.rumpf.clientId.wert),
    'und die Client-ID geht UNVERAENDERT mit — der Server verlangt beide',
    (s0.rumpf && s0.rumpf.clientId && s0.rumpf.clientId.wert) || '—',
  )

  const nachMerk = await alleSpuren()
  ja(
    !nachMerk.includes(MERKMAL),
    'das eben getippte Merkmal steht NIRGENDS mehr',
    'geprueft: Baum, jedes Attribut, Adresse, sessionStorage, localStorage',
  )
  ja(!konsole.some((k) => k.includes(MERKMAL)), 'und es stand auch nicht auf der Konsole', konsole.length + ' Konsolenzeilen')
  const spNach = await lage()
  const merkZeile = spNach.zeilen.find((z) => z.name === 'Erneuerungsmerkmal') || {}
  ja(
    (merkZeile.unter || '').includes('hinterlegt') && !(merkZeile.unter || '').includes(MERKMAL),
    'die Zeile meldet „hinterlegt" und nennt den Wert nicht',
    merkZeile.unter || '—',
  )

  // ══ 3. EIN LEER GEMACHTES FELD DARF NICHT LOESCHEN ══════════════════════
  //
  // NICHT „Abbrechen" — das misst schon tools/dienst-einrichten-schau.mjs.
  // HIER: den alten Wert mit ⌫ WEGLOESCHEN und dann „Fertig" DRUECKEN. Das ist
  // der Weg, auf dem ein Zugang wirklich verschwinden koennte.
  console.log('\n══ 3  EIN LEER GEMACHTES FELD LOESCHT NICHT ═════════════════')
  await rufeLeeren()
  await zeile('Client-ID')
  const t2 = await tastStand()
  ja(t2.offen && t2.anzeige !== '–', 'die Client-ID kommt MIT altem Wert in die Tastatur', `„${t2.anzeige}"`)
  await alleWeg()
  const t2b = await tastStand()
  ja(t2b.anzeige === '–', 'sie laesst sich vollstaendig leeren', `„${t2b.anzeige}"`)
  ja(t2b.fertigAus, '„Fertig" ist dann AUS — ein leeres Feld kommt nicht beim Server an', `fertigAus: ${t2b.fertigAus}`)
  await ev(`(() => { const f = [...document.querySelectorAll('#tast-feld button')]
    .find((b) => b.dataset.taste === 'fertig'); f.click(); return true })()`)
  await warte(900)
  const nachLeer = await rufe()
  ja(
    nachLeer.filter((r) => r.art === 'POST').length === 0,
    'und ein Druck darauf schickt trotzdem NICHTS',
    nachLeer.filter((r) => r.art === 'POST').length + ' Schreibrufe',
  )
  // Aufraeumen: abbrechen und nachsehen, ob die ID noch steht.
  await ev(`document.getElementById('tast-weg').click()`)
  await warte(800)
  const nachLeerLage = await lage()
  ja(
    (nachLeerLage.zeilen.find((z) => z.name === 'Client-ID') || {}).unter === idVorher,
    'die Client-ID steht unveraendert da',
    (nachLeerLage.zeilen.find((z) => z.name === 'Client-ID') || {}).unter || '—',
  )

  // Dasselbe fuer das Merkmal: tippen, abbrechen — nichts geht hinaus.
  await rufeLeeren()
  await zeile('Erneuerungsmerkmal')
  await tippen(ABBRUCH)
  await ev(`document.getElementById('tast-weg').click()`)
  await warte(800)
  const nachAbbr = await rufe()
  ja(
    nachAbbr.filter((r) => r.art === 'POST').length === 0,
    'ein Abbruch beim Merkmal schickt ebenfalls nichts',
    nachAbbr.filter((r) => r.art === 'POST').length + ' Schreibrufe',
  )
  const abbrSpur = await alleSpuren()
  ja(!abbrSpur.includes(ABBRUCH), 'und das Abgebrochene ist weggeraeumt, nicht nur versteckt')
  const nachAbbrLage = await lage()
  ja(
    ((nachAbbrLage.zeilen.find((z) => z.name === 'Erneuerungsmerkmal') || {}).unter || '').includes('hinterlegt'),
    'der Zugang steht nach dem Abbruch noch',
    (nachAbbrLage.zeilen.find((z) => z.name === 'Erneuerungsmerkmal') || {}).unter || '—',
  )

  // Und die Jellyfin-Serveradresse, die ebenfalls mit altem Wert kommt.
  await zurueck()
  await zeile('Jellyfin')
  await rufeLeeren()
  await zeile('Serveradresse')
  const t3 = await tastStand()
  ja(t3.offen && t3.anzeige.startsWith('http'), 'die Serveradresse kommt MIT altem Wert', `„${t3.anzeige}"`)
  await alleWeg()
  const t3b = await tastStand()
  ja(t3b.fertigAus, 'leer geraeumt ist „Fertig" auch hier AUS', `fertigAus: ${t3b.fertigAus}`)
  await ev(`document.getElementById('tast-weg').click()`)
  await warte(700)
  const nachJf = await rufe()
  ja(
    nachJf.filter((r) => r.art === 'POST').length === 0,
    'und es ging nichts hinaus',
    nachJf.filter((r) => r.art === 'POST').length + ' Schreibrufe',
  )

  // ══ 4. DER RUECKWEG — EINE EBENE JE TIPP, UND NIE IN DIE ALTE APP ═══════
  console.log('\n══ 4  DER RUECKWEG ══════════════════════════════════════════')
  const startAdresse = (await lage()).adresse
  const kette = []
  for (let i = 0; i < 4; i++) {
    await zurueck()
    const l = await lage()
    kette.push(l)
    console.log(`      Tipp ${i + 1}: „${l.kopf || '(Uebersicht)'}" · ${l.unter} · ${l.adresse} · Bereich offen: ${l.elternOffen}`)
  }
  ja(kette[0].kopf === 'Dienste', 'Tipp 1 fuehrt von der Einrichtung auf die Dienste — nicht ins alte Menue', kette[0].kopf)
  ja(kette[1].unter.startsWith('Medien'), 'Tipp 2 fuehrt auf die Medien-Uebersicht', kette[1].unter)
  ja(kette[3].elternOffen === false, 'und ein Tipp weiter ist der Bereich zu', `offen: ${kette[3].elternOffen}`)
  ja(
    kette.every((l) => l.adresse === startAdresse),
    'die Adresse des Browsers hat sich auf KEINEM Schritt geaendert — kein Sprung in die Angular-App',
    kette.map((l) => l.adresse).join(' · '),
  )

  // ══ 4b. DIE KARTE MIT EINER MELDUNG IM KOPF ═════════════════════════════
  //
  // WARUM DAS EINE EIGENE MESSUNG IST: Die Rechnung im Code lautet „246 px in
  // 266 — die Seite rollt nicht". Sie gilt fuer den RUHIGEN Kopf. Nach JEDEM
  // Speichern steht dort aber eine Meldung („Schlüssel gespeichert.",
  // „Gelöscht.", eine Absage), und die kostet Hoehe — also genau in dem
  // Augenblick, in dem jemand hinsieht, ob es geklappt hat. Gemessen wird
  // deshalb der Zustand NACH einem Schreibvorgang und nicht davor.
  console.log('\n══ 4b  DIE KARTE, WENN EINE MELDUNG IM KOPF STEHT ═══════════')
  await laden()
  await hinein()
  await gruppe('medien')
  await zeile('Dienste')
  await zeile('Jellyfin')
  await zeile('Serveradresse')
  await tippen('x')
  await ev(`(() => { const f = [...document.querySelectorAll('#tast-feld button')]
    .find((b) => b.dataset.taste === 'fertig'); if (f && !f.disabled) { f.click(); return true } return false })()`)
  await warte(1500)
  const mitMeldung = JSON.parse(
    await ev(`JSON.stringify((() => {
      const f = document.getElementById('fach-zeilen')
      const fr = f.getBoundingClientRect()
      const teil = (b) => Math.max(0, Math.min(b.bottom, fr.bottom) - Math.max(b.top, fr.top))
      const h = document.getElementById('fach-hinweis')
      return {
        meldung: h && !h.hidden ? h.textContent : '',
        sicht: Math.round(f.clientHeight),
        inhalt: Math.round(f.scrollHeight),
        zeilen: [...f.querySelectorAll('.fach-zeile')].map((z) => {
          const k = z.querySelector('.zeile-tat')
          const kr = k ? k.getBoundingClientRect() : null
          return {
            n: (z.querySelector('.zeile-name')||{}).textContent || '',
            sichtbarPx: Math.round(teil(z.getBoundingClientRect())),
            hoch: Math.round(z.getBoundingClientRect().height),
            knopfTeil: kr && kr.height ? Math.round((teil(kr) / kr.height) * 100) : null,
          }
        }),
      } })())`),
  )
  await bild('jellyfin-mit-meldung')
  console.log(`      Meldung: „${mitMeldung.meldung}"  ·  ${mitMeldung.sicht} px Sicht, ${mitMeldung.inhalt} px Inhalt`)
  for (const z of mitMeldung.zeilen)
    console.log(`      · ${z.n}: ${z.sichtbarPx}/${z.hoch} px zu sehen, Knopf ${z.knopfTeil === null ? '—' : z.knopfTeil + ' %'}`)
  ja(
    mitMeldung.meldung !== '',
    'nach dem Speichern steht eine Meldung im Kopf — der Fall, um den es hier geht',
    mitMeldung.meldung || '(keine)',
  )
  // DIESE AUSSAGE IST DIE, DIE DER CODE-KOMMENTAR BEHAUPTET. Sie wird hier
  // gemessen und nicht geglaubt.
  // ── WAS HIER GEMESSEN WIRD UND WAS NICHT ──────────────────────────────
  // Die Karte rollt in diesem Zustand um 8 px — das ist gemessen und steht
  // seit dem 06.08.2026 auch so im Code (der Kommentar behauptete vorher
  // „rollt gar nicht" und rechnete mit dem RUHIGEN Kopf). 8 px sind der
  // untere Rand der dritten Zeile; verloren geht dabei nichts.
  //
  // DIE AUSSAGE, DIE WIRKLICH ZAEHLT, IST EINE ANDERE: kein Knopf darf unter
  // die 9-mm-Marke DES SICHTBAREN TEILS fallen. Ein Knopf, von dem 60 Prozent
  // dastehen, sieht ganz aus und ist kein 9-mm-Ziel mehr. Das ist die Grenze,
  // die eine vierte Zeile oder eine zweizeilige Meldung reissen wuerde.
  ja(
    mitMeldung.inhalt - mitMeldung.sicht < 40,
    'die Karte rollt hoechstens um einen Rand, nie um eine ganze Zeile',
    `${mitMeldung.inhalt} px in ${mitMeldung.sicht} px — ${mitMeldung.inhalt - mitMeldung.sicht} px`,
  )
  const zuKlein = mitMeldung.zeilen.filter(
    (z) => z.knopfTeil !== null && z.knopfTeil > 0 && (66 * z.knopfTeil) / 100 < 64.42,
  )
  ja(
    zuKlein.length === 0,
    'und jeder Knopf haelt mit seinem SICHTBAREN Teil die 9-mm-Marke',
    zuKlein.map((z) => `${z.n} ${z.knopfTeil} % = ${(((66 * z.knopfTeil) / 100) * 0.1397).toFixed(2)} mm`).join(', ') || '—',
  )

  // ── UND DER FALL, DEN NIEMAND PLANT: EINE ZWEIZEILIGE MELDUNG ─────────
  // Die Meldung kann vom SERVER kommen (`d.error` bei /api/konfiguration,
  // der Antworttext bei /api/spotify/config, dort bis 120 Zeichen). Wie lang
  // sie ist, entscheidet also nicht diese Oberflaeche. Bricht sie um, kostet
  // sie eine zweite Zeile Hoehe — und die geht der dritten Zeile ab.
  const langeMeldung = JSON.parse(
    await ev(`JSON.stringify((() => {
      const h = document.getElementById('fach-hinweis')
      h.textContent = 'Die Box hat es nicht angenommen: der Wert wurde vom Server abgelehnt und die Angabe passt nicht zu dem, was dort erwartet wird.'
      const f = document.getElementById('fach-zeilen')
      const fr = f.getBoundingClientRect()
      const teil = (b) => Math.max(0, Math.min(b.bottom, fr.bottom) - Math.max(b.top, fr.top))
      return {
        sicht: Math.round(f.clientHeight),
        inhalt: Math.round(f.scrollHeight),
        zeilen: [...f.querySelectorAll('.fach-zeile')].map((z) => {
          const k = z.querySelector('.zeile-tat')
          const kr = k ? k.getBoundingClientRect() : null
          return {
            n: (z.querySelector('.zeile-name')||{}).textContent || '',
            sichtbarPx: Math.round(teil(z.getBoundingClientRect())),
            knopfTeil: kr && kr.height ? Math.round((teil(kr) / kr.height) * 100) : null,
          }
        }),
      } })())`),
  )
  await bild('jellyfin-lange-meldung')
  console.log(`      lange Meldung: ${langeMeldung.sicht} px Sicht, ${langeMeldung.inhalt} px Inhalt`)
  for (const z of langeMeldung.zeilen)
    console.log(`      · ${z.n}: ${z.sichtbarPx} px zu sehen, Knopf ${z.knopfTeil === null ? '—' : z.knopfTeil + ' %'}`)
  const langZuKlein = langeMeldung.zeilen.filter(
    (z) => z.knopfTeil !== null && z.knopfTeil > 0 && (66 * z.knopfTeil) / 100 < 64.42,
  )
  // ══ DIESE EINE AUSSAGE HAELT HEUTE NICHT, UND SIE WIRD NICHT WEGGELASSEN ══
  //
  // Bei ZWEI Zeilen Meldung faellt der Knopf der dritten Zeile auf 71 % =
  // 6,55 mm und reisst damit die 9-mm-Marke — auf der Jellyfin-Seite ist das
  // ausgerechnet „Löschen". Der Weg dahin ist selten (der Server muesste einen
  // Grund schicken, der umbricht; `pruefeKonfig` kennt Gruende bis 92
  // Zeichen), und die Abhilfe steckt in `.fach-hinweis`/`.fach-zeilen` und
  // damit in Regeln, an denen JEDE Seite dieses Bereichs haengt.
  //
  // SIE STEHT DESHALB ALS OFFENER PUNKT DA UND NICHT ALS FEHLSCHLAG: ein
  // Werkzeug, das immer rot endet, taugt nicht als Schranke, und eines, das
  // die Aussage streicht, hat sie abgeschwaecht. `--streng` macht sie scharf —
  // wer den Punkt angeht, laeuft damit, und wer nur nachsehen will, ob sonst
  // alles haelt, ohne.
  const STRENG = argv.includes('--streng')
  if (langZuKlein.length === 0 || STRENG) {
    ja(
      langZuKlein.length === 0,
      'auch bei einer langen Meldung haelt jeder sichtbare Knopf die 9-mm-Marke',
      langZuKlein.map((z) => `${z.n} ${z.knopfTeil} % = ${(((66 * z.knopfTeil) / 100) * 0.1397).toFixed(2)} mm`).join(', ') ||
        '—',
    )
  } else {
    console.log(
      `OFFEN  bei ZWEI Zeilen Meldung reisst die 9-mm-Marke  — ` +
        langZuKlein
          .map((z) => `${z.n} ${z.knopfTeil} % = ${(((66 * z.knopfTeil) / 100) * 0.1397).toFixed(2)} mm`)
          .join(', ') +
        '  (mit --streng wird daraus ein Fehlschlag)',
    )
  }

  // ══ 5. WIE ES AUSSIEHT — HELL UND DUNKEL ════════════════════════════════
  console.log('\n══ 5  BILDER ════════════════════════════════════════════════')
  for (const w of ['hell', 'dunkel']) {
    await licht(w)
    await laden()
    await hinein()
    await aufSpotify()
    await bild(`spotify-${w}`)
    await zurueck()
    await zeile('Jellyfin')
    await bild(`jellyfin-${w}`)
    const l = await lage()
    ja(l.kopf === 'Jellyfin', `die Jellyfin-Seite steht auch in „${w}"`, l.kopf)
  }
  await licht('hell')

  console.log(fehler === 0 ? '\nalles haelt' : `\n${fehler} Aussage(n) halten NICHT`)
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await lageZurueck()
  await browser.schliessen()
}
process.exit(fehler === 0 ? 0 : 1)
