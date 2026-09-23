#!/usr/bin/env node
/**
 * WAS LIEGT OBEN LINKS — und wo passte dort noch ein Zeichen von 9 mm hin?
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Der Betreiber wuenscht sich (05.08.2026, woertlich): „mir fehlt noch ein
 * kleines benutzr icon oben links um per klick den beutzer zu wechslen".
 * Oben links ist aber genau die Ecke, in der seit dem 03.08.2026 alles
 * zusammenlaeuft: der EINE Rueckweg (`.zurueck`, `position: fixed`), das
 * Wappen der Box am Fuss der Seitenleiste, der Anfang der Kopfzeile — und im
 * Eltern-Bereich zusaetzlich die Taste „WLAN", deren Abstand zum Rueckweg am
 * 05.08. mit 0,00 mm gemessen wurde ([[griff-66-statt-64]]).
 *
 * `tools/beruehrziele-neu.mjs` misst die GROESSE jedes Bedienelements auf zehn
 * Schirmen. Es beantwortet die Frage hier NICHT, aus drei Gruenden:
 *   1. Es kennt nur Bedienelemente. Eine UEBERSCHRIFT, die verdeckt wird, ist
 *      keines — genau dieser Fehler rutschte am 04.08. durch vier gruene
 *      Pruefdurchgaenge ([[rueckweg-verdeckt-die-ueberschrift]]).
 *   2. Es misst nie die LEERE. Die Frage lautet nicht „ist etwas zu klein?",
 *      sondern „wo ist ueberhaupt noch Platz?" — das ist die Gegenrichtung.
 *   3. Keiner seiner zehn Schirme steht in der Lage `body.platz-machen`. Die
 *      Ecke sieht dort ANDERS aus: die Leiste ist weg, die Kopfzeile beginnt
 *      bei x 0, der Rueckweg steht trotzdem still bei x 96.
 *
 * ══ WAS ES MISST ═══════════════════════════════════════════════════════════
 * Je Lage (Leiste aus / ein, Eltern-Bereich, grosser Player, Cover-Vollbild):
 *   * jedes SICHTBARE Ding im Ausschnitt oben links, mit Rechteck in px und
 *     mm — Bedienelemente UND Text UND Bilder, getrennt gekennzeichnet;
 *   * die LUECKEN dazwischen: ein Raster von Kandidatenplaetzen fuer ein
 *     Quadrat von `--griff` (66 px), jeder mit dem Abstand zum naechsten
 *     Nachbarn;
 *   * je Lage ein BILD mit eingezeichneten Rechtecken. Bei dieser Ecke hat am
 *     05.08. zweimal nur der Blick geholfen, nicht die Zahl.
 *
 * DIE GROESSE KOMMT AUS DER SEITE, NICHT AUS DIESER DATEI. `--griff` wird zur
 * Laufzeit aus `:root` gelesen; stand hier eine nackte 64 oder 66, waere das
 * die vierte Kopie derselben Zahl (drei gab es schon, eine davon war falsch).
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts. Eigener headless-Browser gegen eine eigene `tools/neu-vorschau.mjs`.
 * Laeuft auf dem Zielport schon eine Vorschau, wird sie BENUTZT und nicht
 * angefasst — sie gehoert dann jemandem, der gerade daran misst.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/ecke-oben-links-messen.mjs
 *     node tools/ecke-oben-links-messen.mjs --bild /tmp/ecke
 *     node tools/ecke-oben-links-messen.mjs --lage start,eingefahren,lane
 *     node tools/ecke-oben-links-messen.mjs --probe '.kat-liste{padding-top:71px}'
 *     node tools/ecke-oben-links-messen.mjs --breit 400 --hoch 200
 *     node tools/ecke-oben-links-messen.mjs http://127.0.0.1:8377/neu/
 */
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import WebSocket from 'ws'
import { adminAuf } from './admin-weg.mjs'
import { eigenerBrowser } from './leihgabe.mjs'

const argv = process.argv.slice(2)
const hat = (n) => argv.includes(`--${n}`)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const ZIEL = argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8377/neu/'
const BILD = opt('bild', null)
/* MEHRERE LAGEN AUF EINMAL: `--lage start,eingefahren,lane`. Die Frage
   „passt es ueberall" hat ohne die Wahl der Lagen keine Antwort — die drei
   Alltagslagen und die drei Ueberlagerungen sind zwei verschiedene Fragen. */
const NUR = (() => {
  const w = opt('lage', null)
  return typeof w === 'string' ? w.split(',').map((s) => s.trim()).filter(Boolean) : null
})()
const BREIT = Number(opt('breit', 360))
const HOCH = Number(opt('hoch', 170))
/*
 * ── `--probe '<css>'` — EINE AENDERUNG NACHMESSEN, BEVOR SIE GESCHRIEBEN WIRD
 *
 * Die Frage „was muesste weichen, damit oben links ein Zeichen hinpasst" laesst
 * sich ausrechnen. Ausgerechnet war am 05.08.2026 aber schon zweimal etwas, das
 * am Bildschirm anders aussah — beide Male half nur der Blick. Deshalb wird der
 * Vorschlag GEMESSEN: Die Regel wird der Vorschauseite als Stilblatt
 * beigelegt, dann laeuft dieselbe Messung noch einmal.
 *
 * Es aendert NICHTS an NewDesign/app.css. Die Regel lebt im Browser dieses
 * Laufs und ist mit ihm vorbei. Wer den Vorschlag behalten will, schreibt ihn
 * hinterher von Hand in die Datei — und misst dann ohne `--probe` nach.
 */
const PROBE = typeof opt('probe', null) === 'string' ? opt('probe', null) : null

/** 800x480 auf 5" Waveshare — dieselbe Zahl wie in beruehrziele-neu.mjs. */
const MM_JE_PIXEL = 0.14
/** 9 mm nach ISO 9241-411 (Groesse eines Ziels). */
const MARKE_MM = 9
/** 2 mm nach ISO 9241-411 (Abstand zwischen zwei Zielen). */
const ABSTAND_MM = 2
const ABSTAND_PX = ABSTAND_MM / MM_JE_PIXEL

const mm = (px) => px * MM_JE_PIXEL
const mmS = (px) => mm(px).toFixed(2)

// ── Browser: GELIEHEN ueber eigenerBrowser() (tools/leihgabe.mjs) ──────────
// Freier Port statt der festen 9377, eigenes Profil, Eigentumsnachweis.
const brw = await eigenerBrowser()
if (!brw) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

/** Eine schon laufende Vorschau wird NICHT angefasst (Regel aus
 *  tools/beruehrziele-neu.mjs) — und gestartet wird auf dem Port des ZIELS,
 *  nicht auf dem Vorgabeport. */
let vorschau = null
try {
  await fetch(new URL('/api/werke', ZIEL), { signal: AbortSignal.timeout(1500) })
} catch {
  const zielport = new URL(ZIEL).port
  vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', ...(zielport ? ['--port', zielport] : [])], {
    stdio: 'ignore',
  })
  for (let i = 0; i < 25; i++) {
    await warte(300)
    try {
      await fetch(new URL('/api/werke', ZIEL), { signal: AbortSignal.timeout(1000) })
      break
    } catch {
      /* noch nicht da */
    }
  }
}


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

// ── DIE MESSUNG, IM BROWSER ────────────────────────────────────────────────
/*
 * ══ WARUM HIER GETASTET WIRD UND NICHT GERECHNET ═══════════════════════════
 *
 * Der erste Lauf dieses Werkzeugs rechnete mit `getBoundingClientRect`, und
 * das Ergebnis war GLATT FALSCH — auf zwei Weisen, die beide nach einer Zahl
 * aussahen:
 *
 *   1. ABGESCHNITTENES ZAEHLTE MIT. In der Lage `eingefahren` meldete eine
 *      Interpretenkachel `y -7 .. 120` und belegte damit rechnerisch die halbe
 *      Kopfzeile. In Wirklichkeit schneidet die Buehne sie bei y 66 ab; oben
 *      steht nichts. Der Bericht sagte „KEIN Platz" fuer eine Ecke, die auf
 *      dem Bildschirmfoto vollstaendig leer ist.
 *   2. VERDECKTES ZAEHLTE MIT. Steht der grosse Player offen, liegen die
 *      Kategorien der Seitenleiste weiter an ihrer Stelle — nur eben unter
 *      einer deckenden Ebene. Sie belegen dort nichts mehr.
 *
 * Beides sind Rechenfehler, die dieselbe Richtung haben: Sie melden Platz als
 * belegt und verhindern damit eine richtige Antwort, ohne je aufzufallen.
 *
 * DESHALB WIRD DER AUSSCHNITT ABGETASTET, Punkt fuer Punkt (2 px), mit
 * `document.elementFromPoint`. Was dort oben liegt, ist genau das, was ein
 * Auge sieht und ein Finger traefe — Abschneiden und Verdecken sind darin
 * schon enthalten, ohne dass sie einzeln nachgebaut werden muessten.
 *
 * EIN EINZIGER GRIFF IST DAFUER NOETIG: `* { pointer-events: auto }` fuer die
 * Dauer der Messung. Ohne ihn faellt der Rueckweg auf der Startseite durch —
 * er steht dort `disabled` mit `pointer-events: none` und ist fuer
 * `elementFromPoint` LUFT, waehrend er in Wahrheit gut sichtbar 66 x 66 px
 * belegt. Genau die Sorte Platz, die man zweimal vergibt. Der Griff wird
 * danach zurueckgenommen; er veraendert nur die Messung, nicht die Seite.
 *
 * WANN GILT EIN PUNKT ALS BELEGT: wenn das oberste Element dort — oder einer
 * seiner Vorfahren — INHALT ist: ein Bedienelement, eigener Text oder ein
 * Bild. Eine blosse FLAECHE (die Kopfzeile, die Leiste, die Buehne) gilt als
 * frei; auf ihr darf etwas stehen, das ist ihr Zweck. „Frei" heisst hier also
 * „nichts darunter", nicht „gestalterisch beliebig".
 */
const MESSEN_JS = (breit, hoch) => String.raw`
(() => {
  const BREIT = ${breit}, HOCH = ${hoch}
  const SCHRITT = 2
  const WAHL = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [tabindex]:not([tabindex="-1"])'
  const FLAECHEN = ['leiste', 'kopf', 'eltern-kopf', 'kat-liste', 'wappen']

  /* DIE UHR DER LEISTE NEU ANSTOSSEN, unmittelbar vor dem Abtasten.
     Die eingefahrene Leiste kommt nach 1400 ms Ruhe von selbst zurueck
     (RUHE_BIS_ZURUECK_MS in app.js). Zwischen dem Herstellen der Lage und dem ersten
     Tastpunkt liegen Wartezeiten, die zusammen genau in dieser Groessenordnung
     sind — mal darunter, mal darueber. Das Ergebnis war ein Werkzeug, das
     dieselbe Lage in zwei Laeufen verschieden mass, ohne dass sich etwas
     geaendert haette. Ein Rollereignis stellt die Uhr auf null; der Rest der
     Messung laeuft in einem Stueck und ist lange vor 1400 ms fertig. */
  if (document.body.classList.contains('platz-machen')) {
    const b = document.getElementById('buehne')
    if (b) b.dispatchEvent(new Event('scroll'))
  }

  // DER GRIFF (siehe oben): nur fuer die Dauer der Messung.
  const durchlass = document.createElement('style')
  durchlass.textContent = '*{pointer-events:auto !important}'
  document.head.appendChild(durchlass)

  const sichtbar = (e) => {
    const s = getComputedStyle(e)
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false
    const r = e.getBoundingClientRect()
    return r.width >= 1 && r.height >= 1
  }
  const eigenerText = (e) => {
    for (const k of e.childNodes) if (k.nodeType === 3 && k.textContent.trim()) return k.textContent.trim()
    return ''
  }
  const benennen = (e) => {
    const id = e.id ? '#' + e.id : ''
    const kl = (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : '')
    return (id || kl || e.tagName.toLowerCase()).slice(0, 46)
  }
  const istFlaeche = (e) => {
    const k = typeof e.className === 'string' ? e.className.trim().split(/\s+/) : []
    return k.some((x) => FLAECHEN.includes(x))
  }
  /** INHALT oder nur Flaeche? Das ist die Entscheidung, an der alles haengt. */
  const art = (e) => {
    if (e.matches(WAHL)) {
      const aus = e.disabled === true || e.getAttribute('aria-disabled') === 'true'
      return aus ? 'ziel-aus' : 'ziel'
    }
    if (e.tagName === 'IMG' || e.tagName === 'svg' || e.tagName === 'CANVAS') return 'bild'
    if (eigenerText(e)) return 'text'
    return null
  }

  // ── 1. ABTASTEN: was liegt an jedem Punkt des Ausschnitts oben? ──────────
  const sp = Math.ceil(BREIT / SCHRITT)
  const ze = Math.ceil(HOCH / SCHRITT)
  const belegt = new Uint8Array(sp * ze)
  const belegtZiel = new Uint8Array(sp * ze)
  /* GESCHLUESSELT WIRD MIT DEM ELEMENT, NICHT MIT DEM NAMEN — und das war der
     zweite Fehler dieses Werkzeugs: Vier Interpretenkacheln heissen alle
     '.leute-kachel'. Ueber den Namen zusammengefasst wurden sie zu EINEM
     Rechteck von 344 px Breite, das so nirgends steht. Eine Map ueber Objekte
     kann das nicht passieren. */
  const treffer = new Map()   // Element -> gemessenes Rechteck der SICHTBAREN Flaeche
  for (let j = 0; j < ze; j++) {
    for (let i = 0; i < sp; i++) {
      const x = i * SCHRITT, y = j * SCHRITT
      if (x >= innerWidth || y >= innerHeight) continue
      let e = document.elementFromPoint(x, y)
      let inhalt = null
      while (e && e !== document.body && e !== document.documentElement) {
        const a = art(e)
        if (a && !istFlaeche(e)) { inhalt = { e, a }; break }
        e = e.parentElement
      }
      if (!inhalt) continue
      belegt[j * sp + i] = 1
      // ZWEI RASTER, WEIL ZWEI FRAGEN. Die 2 mm der ISO gelten dem Fall, dass
      // ein Fehlgriff etwas ANDERES ausloest — sie messen also Ziel zu Ziel.
      // Eine Ueberschrift daneben ist kein Fehlgriffrisiko, sie ist eine
      // Verdeckungsfrage. Beides in EINER Zahl zusammenzufassen hiesse, die
      // strengere Norm auf den harmloseren Fall anzuwenden und dann zu
      // erschrecken.
      if (inhalt.a === 'ziel' || inhalt.a === 'ziel-aus') belegtZiel[j * sp + i] = 1
      const t = treffer.get(inhalt.e) || { name: benennen(inhalt.e), art: inhalt.a,
                                    x1: 9e9, y1: 9e9, x2: -9e9, y2: -9e9, punkte: 0,
                                    text: eigenerText(inhalt.e).slice(0, 28) }
      t.x1 = Math.min(t.x1, x); t.y1 = Math.min(t.y1, y)
      t.x2 = Math.max(t.x2, x + SCHRITT); t.y2 = Math.max(t.y2, y + SCHRITT)
      t.punkte++
      treffer.set(inhalt.e, t)
    }
  }

  // ── 2. Die Rechtecke DANEBEN, zum Vergleich ─────────────────────────────
  /* Die getastete Flaeche und das gerechnete Rechteck AUSEINANDERZUHALTEN ist
     der halbe Zweck: Wo beide gleich sind, ist alles in Ordnung. Wo das
     gerechnete groesser ist, wird abgeschnitten oder verdeckt — und genau das
     war der Fehler des ersten Laufs. */
  const dinge = []
  for (const e of document.querySelectorAll('*')) {
    if (!sichtbar(e)) continue
    const r = e.getBoundingClientRect()
    if (r.left >= BREIT || r.top >= HOCH || r.right <= 0 || r.bottom <= 0) continue
    const fl = istFlaeche(e)
    if (!fl && r.width * r.height > 0.35 * innerWidth * innerHeight) continue
    const a = fl ? 'flaeche' : art(e)
    if (!a) continue
    if (a === 'bild' && e.closest('button, a[href], [role="button"]')) continue
    const n = benennen(e)
    const g = treffer.get(e)
    dinge.push({
      art: a, name: n, text: eigenerText(e).slice(0, 28),
      x: Math.round(r.left), y: Math.round(r.top),
      b: Math.round(r.width), h: Math.round(r.height),
      re: Math.round(r.right), un: Math.round(r.bottom),
      // getastet: was davon WIRKLICH oben liegt (null = gar nichts)
      gx: g ? g.x1 : null, gy: g ? g.y1 : null,
      gb: g ? g.x2 - g.x1 : 0, gh: g ? g.y2 - g.y1 : 0,
    })
  }

  document.head.removeChild(durchlass)

  const griff = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--griff')) || 0
  const zbtn = document.getElementById('zurueck')
  const zr = zbtn ? zbtn.getBoundingClientRect() : null
  return {
    dinge,
    getastet: [...treffer.values()],
    belegt: Array.from(belegt),
    belegtZiel: Array.from(belegtZiel),
    sp, ze, schritt: SCHRITT,
    griff,
    // DIE WIRKLICHE LAGE DES RUECKWEGS, nicht die Variable: --zurueck-links
    // ist NIRGENDS deklariert — sie steht in app.css nur als Rueckfallwert
    // var(--zurueck-links, 96px) an drei Stellen. Wer sie ausliest, bekommt
    // eine leere Zeichenkette und daraus eine 0, die nach einer Messung
    // aussieht. (Keine Schraegstrich-Anfuehrer hier: String.raw-Text.)
    zurueckLinks: zr ? Math.round(zr.left) : null,
    zurueckVariable: getComputedStyle(document.documentElement).getPropertyValue('--zurueck-links').trim() || '(nicht deklariert)',
    platzMachen: document.body.classList.contains('platz-machen'),
    breite: innerWidth, hoehe: innerHeight,
  }
})()
`

/*
 * DAS BILD. Die Rechtecke werden IN die Seite gezeichnet und dann fotografiert
 * — nicht daneben gemalt. Ein Bild, das aus denselben Zahlen entsteht wie der
 * Bericht, kann nicht zeigen, dass die Zahlen woanders liegen als das, was man
 * sieht; ein Bild AUS DER SEITE kann es.
 */
const ZEICHNEN_JS = (dinge, kandidat, aufschrift = '') => String.raw`
(() => {
  document.getElementById('ecke-messmarken')?.remove()
  const d = document.createElement('div')
  d.id = 'ecke-messmarken'
  d.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:none;font:9px/1.05 monospace'
  const farbe = { ziel: '#e0245e', 'ziel-aus': '#9b8aa8', text: '#0a84ff', bild: '#12a150', flaeche: '#ff9f0a' }
  for (const t of ${JSON.stringify(dinge)}) {
    const k = document.createElement('div')
    const c = farbe[t.art] || '#000'
    k.style.cssText = 'position:absolute;left:' + t.x + 'px;top:' + t.y + 'px;width:' + t.b + 'px;height:' + t.h + 'px;' +
      'border:1.5px solid ' + c + ';box-sizing:border-box;background:' + c + '18'
    const l = document.createElement('div')
    l.textContent = t.name + ' ' + t.b + 'x' + t.h
    l.style.cssText = 'position:absolute;left:0;top:100%;white-space:nowrap;color:#fff;background:' + c + ';padding:0 2px'
    k.appendChild(l)
    d.appendChild(k)
  }
  const kd = ${JSON.stringify(kandidat)}
  if (kd) for (const k2 of kd) {
    const k = document.createElement('div')
    k.style.cssText = 'position:absolute;left:' + k2.x + 'px;top:' + k2.y + 'px;width:' + k2.b + 'px;height:' + k2.b + 'px;' +
      'border:2px dashed #7b2ff7;box-sizing:border-box;background:#7b2ff733'
    const l = document.createElement('div')
    l.textContent = k2.marke
    l.style.cssText = 'position:absolute;left:0;bottom:100%;white-space:nowrap;color:#fff;background:#7b2ff7;padding:0 2px'
    k.appendChild(l)
    d.appendChild(k)
  }
  const auf = ${JSON.stringify(aufschrift)}
  if (auf) {
    const w = document.createElement('div')
    w.textContent = auf
    w.style.cssText = 'position:absolute;left:0;bottom:0;background:#b00020;color:#fff;font:11px/1.6 monospace;padding:0 6px'
    d.appendChild(w)
  }
  document.body.appendChild(d)
  return true
})()
`

// ── Die Lagen ──────────────────────────────────────────────────────────────
const LAGEN = [
  {
    name: 'start',
    was: 'Startseite, Leiste AUSGEFAHREN (der Normalfall beim Hinsehen)',
    hin: async (h) => {
      await h.stand('voll')
      await h.stand('spielt')
      await h.neuLaden()
    },
  },
  {
    name: 'eingefahren',
    was: 'Startseite, Leiste EINGEFAHREN — durch echtes Rollen, nicht durch Setzen der Klasse',
    erwartetPlatzMachen: true,
    hin: async (h) => {
      await h.stand('voll')
      await h.stand('spielt')
      await h.neuLaden()
      await h.rollenZu('#raster .kachel')
      const ein = await h.ev(`document.body.classList.contains('platz-machen')`)
      if (!ein) throw new Error('die Leiste fuhr nicht ein (kein platz-machen nach dem Rollen)')
    },
  },
  {
    name: 'lane',
    was: 'aufgeklappte Lane — die Ebene, auf der der Rueckweg zum ersten Mal WIRKT',
    hin: async (h) => {
      await h.stand('voll')
      await h.stand('spielt')
      await h.neuLaden()
      await h.rollenZu('#raster .kachel')
      const wer = await h.ev(`(() => {
        const k = [...document.querySelectorAll('#raster .kachel')].find((x) => x.querySelector('.tipp-spiel'))
        if (!k) return null
        k.click(); return 'ok' })()`)
      if (!wer) throw new Error('keine aufklappbare Kachel im Raster')
      let auf = false
      for (let n = 0; n < 16 && !auf; n++) {
        await warte(250)
        auf = !!(await h.ev(`document.querySelectorAll('.lane-kachel').length > 0`))
      }
      if (!auf) throw new Error('die Lane klappte nicht auf')
      await warte(900)
    },
  },
  {
    name: 'player',
    was: 'grosser Player — er liegt UEBER der Kopfzeile (z-index 6)',
    hin: async (h) => {
      await h.stand('voll')
      await h.stand('spielt')
      await h.neuLaden()
      const r = await h.ev(`(() => { const a = document.querySelector('.mp-bild'); if (!a) return 'kein Mini-Player'
        a.click(); return 'ok' })()`)
      if (r !== 'ok') throw new Error(`Player: ${r}`)
      await warte(900)
    },
  },
  {
    name: 'cover-voll',
    was: 'Cover-Vollbild — die oberste Ebene ausser der Meldung',
    hin: async (h) => {
      await h.stand('voll')
      await h.stand('spielt')
      await h.neuLaden()
      const r = await h.ev(`(() => { const a = document.querySelector('.mp-bild'); if (!a) return 'kein Mini-Player'
        a.click()
        const c = document.querySelector('#gross .gross-bild'); if (!c) return 'kein Cover'
        c.click(); return 'ok' })()`)
      if (r !== 'ok') throw new Error(`Cover-Vollbild: ${r}`)
      await warte(900)
    },
  },
  {
    name: 'eltern-flaeche',
    was: 'Eltern-Bereich — hier steht die Taste WLAN unter dem Rueckweg (0,00 mm am 05.08.)',
    hin: async (h) => {
      await h.stand('voll')
      await h.stand('sperre-aus')
      await h.neuLaden()
      await h.langHalten()
      const auf = await h.ev(`!document.getElementById('eltern-flaeche').hidden`)
      if (!auf) throw new Error('die Eltern-Flaeche ging nicht auf')
    },
  },
]

// ── Luecken suchen ─────────────────────────────────────────────────────────
/**
 * WO PASST EIN QUADRAT VON `--griff` HIN.
 *
 * Abgetastet wird ein Raster von 2 px im Ausschnitt. Ein Platz zaehlt, wenn
 * das Quadrat KEIN vorhandenes Ding schneidet — Flaechen (`.kopf`, `.leiste`)
 * ausgenommen, denn IN einer Flaeche zu liegen ist ja der Sinn.
 *
 * DER ABSTAND WIRD GETRENNT GEFUEHRT und nicht als Bedingung eingebaut: Zwei
 * Ziele, die aneinanderstossen, sind in einem Tastenfeld normal; die Norm
 * meint den Fall, dass ein Fehlgriff etwas ANDERES ausloest. Genau der Fall
 * liegt hier vor (ein Fehlgriff neben dem Rueckweg verlaesst die Ebene), also
 * wird die Zahl genannt und nicht verschwiegen.
 */
function lueckenSuchen(m, griff, breit, hoch) {
  const { belegt, belegtZiel, sp, ze, schritt } = m
  /** Summierte Flaeche — sonst kostet jede der ~15 000 Lagen eine eigene
   *  Doppelschleife ueber 33 x 33 Felder. */
  const flaeche = (arr) => {
    const feld = (i, j) => (i < 0 || j < 0 || i >= sp || j >= ze ? 1 : arr[j * sp + i])
    const S = new Int32Array((sp + 1) * (ze + 1))
    for (let j = 0; j < ze; j++)
      for (let i = 0; i < sp; i++)
        S[(j + 1) * (sp + 1) + (i + 1)] =
          feld(i, j) + S[j * (sp + 1) + (i + 1)] + S[(j + 1) * (sp + 1) + i] - S[j * (sp + 1) + i]
    return (i1, j1, i2, j2) =>
      S[j2 * (sp + 1) + i2] - S[j1 * (sp + 1) + i2] - S[j2 * (sp + 1) + i1] + S[j1 * (sp + 1) + i1]
  }
  const summe = flaeche(belegt)
  const summeZiel = flaeche(belegtZiel)

  const g = Math.ceil(griff / schritt)
  /** Ringweise nach aussen suchen, bis der erste belegte Punkt auftaucht.
   *  Ein volles Abstandsfeld waere genauer und hier ueberfluessig — gebraucht
   *  wird nur, ob 2 mm (14,3 px) eingehalten sind. */
  const ringsuche = (f, i, j) => {
    for (let r = 1; r <= 40; r++) {
      const i1 = i - r, j1 = j - r, i2 = i + g + r, j2 = j + g + r
      if (f(Math.max(0, i1), Math.max(0, j1), Math.min(sp, i2), Math.min(ze, j2)) > 0) return (r - 1) * schritt
      // AUSSERHALB DES AUSSCHNITTS IST NICHT FREI, SONDERN UNBEKANNT — der
      // Rand des Ausschnitts darf nicht als Nachbar zaehlen, sonst meldete
      // jeder Platz am Rand einen Abstand, den niemand gemessen hat.
      if (i1 < 0 || j1 < 0 || i2 > sp || j2 > ze) return null
    }
    return null
  }

  const plaetze = []
  for (let j = 0; j + g <= ze; j++) {
    for (let i = 0; i + g <= sp; i++) {
      if (summe(i, j, i + g, j + g) !== 0) continue
      plaetze.push({
        x: i * schritt,
        y: j * schritt,
        abstand: ringsuche(summe, i, j),
        abstandZiel: ringsuche(summeZiel, i, j),
        nachbar: '',
        nachbarZiel: '',
      })
    }
  }
  // Die Namen der naechsten Nachbarn nachtragen — sie machen den Bericht lesbar.
  for (const p of plaetze) {
    let naeh = Infinity
    let naehZ = Infinity
    for (const d of m.getastet) {
      const dx = Math.max(d.x1 - (p.x + griff), p.x - d.x2, 0)
      const dy = Math.max(d.y1 - (p.y + griff), p.y - d.y2, 0)
      const ab = Math.hypot(dx, dy)
      if (ab < naeh) {
        naeh = ab
        p.nachbar = d.name
      }
      if ((d.art === 'ziel' || d.art === 'ziel-aus') && ab < naehZ) {
        naehZ = ab
        p.nachbarZiel = d.name
      }
    }
    if (p.abstand === null && naeh !== Infinity) p.abstand = naeh
    if (p.abstandZiel === null && naehZ !== Infinity) p.abstandZiel = naehZ
  }
  return plaetze
}

/** Aus vielen Einzelplaetzen zusammenhaengende Inseln machen — sonst stuenden
 *  dreihundert fast gleiche Zeilen im Bericht. */
function inseln(plaetze, griff) {
  const inseln = []
  for (const p of plaetze) {
    const i = inseln.find(
      (i) => p.x <= i.x2 + 2 && p.x + griff >= i.x1 - 2 && p.y <= i.y2 + 2 && p.y + griff >= i.y1 - 2,
    )
    if (i) {
      i.x1 = Math.min(i.x1, p.x)
      i.x2 = Math.max(i.x2, p.x)
      i.y1 = Math.min(i.y1, p.y)
      i.y2 = Math.max(i.y2, p.y)
      i.n++
      // GEWERTET WIRD NACH DEM ABSTAND ZUM NAECHSTEN INHALT, nicht zum Ziel:
      // der engere der beiden Werte entscheidet, ob ein Platz brauchbar ist.
      if ((p.abstand ?? 9e9) > (i.besterAbstand ?? 9e9)) {
        i.besterAbstand = p.abstand
        i.bester = p
      }
    } else {
      inseln.push({ x1: p.x, x2: p.x, y1: p.y, y2: p.y, n: 1, besterAbstand: p.abstand, bester: p })
    }
  }
  return inseln
}

// ── Lauf ───────────────────────────────────────────────────────────────────
const berichte = []
let abbruch = 0
try {
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  const stand = async (was) => {
    await fetch(new URL(`/vorschau/${was}`, ZIEL)).catch(() => null)
    await warte(150)
  }
  const neuLaden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2200)
  }
  const langHalten = async (ms = 900) => {
    // HIER STAND EIN GRIFF ANS ZAHNRAD `#einst-knopf`. Es ist am 06.08.2026
    // ersatzlos entfallen; hinein fuehrt der Schriftzug `#wappen`. Dieser Weg
    // ist der TASTATURWEG und prueft das Halten NICHT — tools/admin-weg.mjs.
    await adminAuf(ev, { warteMs: 900 })
  }
  const rollenZu = async (wahl) => {
    const da = await ev(`(() => {
      const e = document.querySelector('${wahl}')
      if (!e) return false
      e.scrollIntoView({ block: 'center', behavior: 'auto' })
      const b = document.getElementById('buehne')
      if (b) b.dispatchEvent(new Event('scroll'))
      return true })()`)
    if (!da) return false
    let vorher = null
    for (let i = 0; i < 12; i++) {
      await warte(220)
      const jetzt = await ev(`(document.getElementById('buehne') || {}).scrollTop`)
      if (jetzt === vorher) break
      vorher = jetzt
    }
    await warte(700)
    return true
  }
  const h = { ev, stand, neuLaden, langHalten, rollenZu }

  for (const l of LAGEN) {
    if (NUR && !NUR.includes(l.name)) continue
    try {
      await l.hin(h)
    } catch (e) {
      console.error(`  ${l.name}: NICHT ERREICHT — ${e.message}`)
      abbruch++
      continue
    }
    if (PROBE) {
      // NACH dem Aufbau der Lage, nicht davor: `neuLaden()` wirft das Stilblatt
      // sonst mit der Seite weg, und gemessen wuerde die unveraenderte Lage —
      // ein Vergleich, bei dem beide Seiten gleich sind und niemand es merkt.
      const da = await ev(`(() => {
        document.getElementById('ecke-probe')?.remove()
        const s = document.createElement('style')
        s.id = 'ecke-probe'
        s.textContent = ${JSON.stringify(PROBE)}
        document.head.appendChild(s)
        /* UND DIE UHR DER LEISTE GLEICH MIT ANSTOSSEN. Das Einsetzen der Regel
           kostet Zeit, und in der Lage eingefahren laeuft daneben die
           1400-ms-Uhr, nach der die Leiste zurueckkommt. Ohne diese drei Zeilen
           wurde die Lage bei jedem Lauf mit einer Probe-Regel verworfen — der
           Vorschlag liess sich also ausgerechnet in der Lage nicht nachmessen,
           fuer die er gedacht ist. (Keine Schraegstrich-Anfuehrer: der Block
           steht in einer Vorlagenzeichenkette und beendete sie.) */
        if (document.body.classList.contains('platz-machen')) {
          const b = document.getElementById('buehne')
          if (b) b.dispatchEvent(new Event('scroll'))
        }
        return document.getElementById('ecke-probe') !== null })()`)
      if (!da) throw new Error('die Probe-Regel liess sich nicht einsetzen')
      await warte(250)
    }
    /*
     * ERST WENN NICHTS MEHR FAEHRT. Die Leiste faehrt in 220 ms ein und aus
     * (`transition` an `.leiste`), und ein Lauf hat sie mitten darin erwischt:
     * die Kategorien standen bei x 0..62 statt geraeumt bei x -36..36, und die
     * Ecke galt als belegt, die in Ruhe frei ist. Eine Messung waehrend einer
     * Bewegung ist keine Messung — sie ist eine Momentaufnahme mit dem
     * Aussehen einer Zahl. Gewartet wird auf die LEISTE selbst, nicht auf die
     * Uhr: zwei gleiche Ablesungen hintereinander, dann steht sie.
     */
    let ruheZaehler = 0
    let vorm = null
    for (let n = 0; n < 20; n++) {
      const jetzt = await ev(`(() => {
        if (document.body.classList.contains('platz-machen')) {
          const b = document.getElementById('buehne')
          if (b) b.dispatchEvent(new Event('scroll'))
        }
        const l = document.getElementById('leiste')
        if (!l) return 'keine'
        const r = l.getBoundingClientRect()
        return [Math.round(r.left), Math.round(r.width)].join(',') })()`)
      if (jetzt === vorm) {
        if (++ruheZaehler >= 2) break
      } else ruheZaehler = 0
      vorm = jetzt
      await warte(120)
    }
    const m = await ev(MESSEN_JS(BREIT, HOCH))
    if (!m) {
      console.error(`  ${l.name}: die Messung gab nichts zurueck`)
      abbruch++
      continue
    }
    /* DIE LAGE NACH DER MESSUNG NACHPRUEFEN, nicht vorher. Eine Lage, die sich
       waehrend der Messung aufgeloest hat, liefert Zahlen einer ANDEREN Lage —
       und die sehen genauso aus. Ein Lauf hat so die eingefahrene Leiste
       gemessen und die Zahlen der ausgefahrenen geliefert. Lieber eine Lage
       weniger als eine falsch beschriftete. */
    if (l.erwartetPlatzMachen !== undefined && m.platzMachen !== l.erwartetPlatzMachen) {
      console.error(
        `  ${l.name}: VERWORFEN — platz-machen war bei der Messung ${m.platzMachen ? 'AN' : 'AUS'}, ` +
          `erwartet ${l.erwartetPlatzMachen ? 'AN' : 'AUS'} (die Leiste kam waehrend der Messung zurueck)`,
      )
      abbruch++
      continue
    }
    const plaetze = lueckenSuchen(m, m.griff, BREIT, HOCH)
    const ins = inseln(plaetze, m.griff)
    berichte.push({ ...l, ...m, plaetze, inseln: ins })
    if (BILD) {
      const kand = ins
        .sort((a, b) => (b.besterAbstand ?? 9e9) - (a.besterAbstand ?? 9e9))
        .slice(0, 4)
        .map((i) => ({
          x: i.bester.x,
          y: i.bester.y,
          b: m.griff,
          marke: i.besterAbstand === null ? 'frei (kein Nachbar)' : `${mmS(i.besterAbstand)} mm Luft`,
        }))
      // GEZEICHNET WIRD DAS GETASTETE, nicht das gerechnete Rechteck — sonst
      // zeigte das Bild genau die Kaesten, von denen die Messung gerade
      // festgestellt hat, dass sie so nicht dastehen.
      const marken = m.getastet.map((t) => ({
        art: t.art, name: t.name, x: t.x1, y: t.y1, b: t.x2 - t.x1, h: t.y2 - t.y1,
      }))
      /*
       * DIE EINGEFAHRENE LEISTE KOMMT VON SELBST ZURUECK — nach 1400 ms Ruhe
       * (`RUHE_BIS_ZURUECK_MS` in app.js, 4000 ms bei offener Lane). Das erste
       * Bild dieser Lage zeigte deshalb eine AUSGEFAHRENE Leiste neben Marken,
       * die im eingefahrenen Zustand gemessen worden waren: zwei Zustaende in
       * einem Bild, und keiner davon gekennzeichnet. Vor jeder Aufnahme wird
       * die Uhr deshalb neu angestossen — und danach nachgesehen, ob es
       * gereicht hat. Ein Bild, dessen Lage nicht mehr stimmt, wird als solches
       * gemeldet statt stillschweigend abgelegt.
       */
      let erzwungen = false
      const halten = async () => {
        const da = await ev(`(() => {
          const b = document.getElementById('buehne')
          if (b) b.dispatchEvent(new Event('scroll'))
          return document.body.classList.contains('platz-machen') })()`)
        if (da) return true
        /* DAS ANSTOSSEN REICHT NICHT IMMER: `geruehrt()` laesst ein Rollen
           liegen, solange die BLINDE ZEIT nach der Rueckkehr laeuft
           (`BLIND_NACH_RUECKKEHR_MS`) — genau in die faellt eine Messung, die
           15 000 Punkte abtastet. Dann wird die Lage fuers Bild GESETZT und
           das Bild als gestellt gekennzeichnet. Ein gestelltes Bild mit
           Aufschrift ist brauchbar; ein ungekennzeichnetes ist eine Luege. */
        await ev(`(() => { document.body.classList.add('platz-machen'); return true })()`)
        erzwungen = true
        return false
      }
      if (m.platzMachen) await halten()
      await ev(ZEICHNEN_JS(marken, kand, erzwungen ? `${l.name} — Lage fuers Bild gesetzt (platz-machen)` : ''))
      await warte(120)
      if (m.platzMachen) await halten()
      const d = await send(ws, 'Page.captureScreenshot', { format: 'png' })
      const pfad = `${BILD}-${l.name}.png`
      await writeFile(pfad, Buffer.from(d.data, 'base64'))
      // OHNE MARKEN GLEICH DANEBEN. Ein Bild mit Rechtecken zeigt, wo etwas
      // liegt; nur das nackte zeigt, wie es AUSSIEHT.
      await ev(`(() => { document.getElementById('ecke-messmarken')?.remove(); return true })()`)
      await warte(80)
      if (m.platzMachen) await halten()
      const d2 = await send(ws, 'Page.captureScreenshot', { format: 'png' })
      await writeFile(`${BILD}-${l.name}-nackt.png`, Buffer.from(d2.data, 'base64'))
      const nachher = await ev(`document.body.classList.contains('platz-machen')`)
      const passt = nachher === m.platzMachen
      console.error(`  Bild: ${pfad} (+ -nackt)${passt ? '' : '   ACHTUNG: Lage beim Foto anders als bei der Messung'}`)
    }
  }
} catch (e) {
  console.error(`ABBRUCH: ${e.message}`)
  abbruch++
} finally {
  await brw.schliessen()
  if (vorschau) vorschau.kill()
}

/**
 * DIE BEIDEN ABSTAENDE IN EINEM SATZ — und in dieser Reihenfolge, weil nur der
 * erste eine NORM ist. Zwischen zwei ZIELEN fordert ISO 9241-411 2 mm, damit
 * ein Fehlgriff nicht etwas anderes ausloest. Der Abstand zu einer Ueberschrift
 * ist keine Fehlgriffgefahr, sondern eine Frage des Aussehens — er wird genannt
 * und nicht als Verstoss gefuehrt.
 */
const abstandSatz = (p) => {
  const z = p.abstandZiel === null ? 'kein Ziel im Ausschnitt' : `${mmS(p.abstandZiel)} mm zum naechsten ZIEL (${p.nachbarZiel})`
  const i = p.abstand === null ? 'kein Inhalt im Ausschnitt' : `${mmS(p.abstand)} mm zum naechsten Inhalt (${p.nachbar})`
  const warn = p.abstandZiel !== null && p.abstandZiel < ABSTAND_PX ? '  ZIELABSTAND UNTER 2 mm' : ''
  return `${z}; ${i}${warn}`
}

// ── Ausgabe ────────────────────────────────────────────────────────────────
console.log(`DIE ECKE OBEN LINKS — Ausschnitt ${BREIT}x${HOCH} px, 800x480, ${MM_JE_PIXEL} mm/px`)
if (PROBE) console.log(`GEMESSEN MIT EINER PROBE-REGEL (nicht in app.css): ${PROBE}`)
console.log(`Marke: ${MARKE_MM} mm Groesse, ${ABSTAND_MM} mm Abstand (ISO 9241-411 = ${ABSTAND_PX.toFixed(1)} px)\n`)

for (const b of berichte) {
  console.log(`── ${b.name} ${'─'.repeat(Math.max(0, 56 - b.name.length))}`)
  console.log(`   ${b.was}`)
  console.log(
    `   --griff ${b.griff}px, Rueckweg steht bei x ${b.zurueckLinks} (--zurueck-links: ${b.zurueckVariable}), ` +
      `platz-machen: ${b.platzMachen ? 'JA' : 'nein'}`,
  )
  console.log('   Art        Name                                  gerechnet x,y b x h    GETASTET x,y b x h')
  for (const d of [...b.dinge].sort((p, q) => p.y - q.y || p.x - q.x)) {
    const zeig = d.text ? `${d.name} „${d.text}"` : d.name
    const gerechnet = `${d.x},${d.y} ${d.b}x${d.h}`
    const getastet =
      d.art === 'flaeche'
        ? '(Flaeche — zaehlt nie als belegt)'
        : d.gx === null
          ? 'NICHTS — abgeschnitten oder verdeckt'
          : `${d.gx},${d.gy} ${d.gb}x${d.gh}`
    const anders =
      d.art !== 'flaeche' && d.gx !== null && (Math.abs(d.gb - d.b) > 4 || Math.abs(d.gh - d.h) > 4)
        ? '  <- abgeschnitten/verdeckt'
        : ''
    console.log(
      `   ${d.art.padEnd(9)}  ${zeig.slice(0, 34).padEnd(34)} ${gerechnet.padStart(16)}   ${getastet}${anders}`,
    )
  }
  /*
   * WAS GETASTET WURDE UND IN KEINER ZEILE OBEN STEHT.
   * Die Tabelle darueber laeuft ueber die gerechneten Rechtecke — und die
   * lassen ausdruecklich alles weg, was mehr als 35 % des Schirms fuellt (sonst
   * stuende die Buehne in jeder Zeile). Das VOLLBILD-COVER faellt genau darunter
   * und belegte trotzdem die halbe Kopfzeile: im Bericht zu `cover-voll` klaffte
   * zwischen x 162 und x 632 eine Luecke, die keine Zeile erklaerte. Was der
   * Finger findet, muss im Bericht stehen, auch wenn es gross ist.
   */
  const genannt = new Set(b.dinge.map((d) => d.name))
  const stumm = b.getastet.filter((t) => !genannt.has(t.name))
  if (stumm.length) {
    console.log('   ── und getastet, aber oben nicht genannt (zu gross fuer die Tabelle):')
    for (const t of stumm.sort((p, q) => p.y1 - q.y1 || p.x1 - q.x1))
      console.log(`   ${t.art.padEnd(9)}  ${t.name.slice(0, 34).padEnd(34)} ${' '.repeat(16)}   ${t.x1},${t.y1} ${t.x2 - t.x1}x${t.y2 - t.y1}`)
  }
  console.log(`\n   FREIE PLAETZE fuer ${b.griff}x${b.griff} px (${mmS(b.griff)} x ${mmS(b.griff)} mm):`)
  if (!b.inseln.length) {
    console.log('   KEINER. In diesem Ausschnitt liegt kein Quadrat dieser Groesse, das nichts schneidet.')
  } else {
    for (const i of [...b.inseln].sort((x, y) => y.besterAbstand - x.besterAbstand)) {
      const w = i.x1 === i.x2 && i.y1 === i.y2 ? 'genau ein Platz' : `x ${i.x1}..${i.x2}, y ${i.y1}..${i.y2}`
      console.log(
        `   ${w.padEnd(30)} bester: x ${String(i.bester.x).padStart(3)} y ${String(i.bester.y).padStart(3)}` +
          `   ${abstandSatz(i.bester)}`,
      )
    }
  }
  console.log('')
}

/*
 * ══ DIE EINE ANTWORT, DIE ZAEHLT ═══════════════════════════════════════════
 *
 * Ein Zeichen, das oben links steht, steht dort IMMER — es kann nicht auf der
 * Startseite passen und im Eltern-Bereich unter der Ueberschrift liegen. Die
 * je Lage gefundenen Luecken sind also nur Zwischenergebnisse; gesucht ist
 * ihr DURCHSCHNITT.
 *
 * Er wird nicht aus den Zahlen zusammengerechnet, sondern aus den Rastern:
 * belegt ist ein Punkt, sobald ihn EINE der Lagen belegt. Das ist dieselbe
 * Messung, nur mit ODER — und damit kann kein Randfall zwischen zwei Tabellen
 * hindurchfallen.
 */
const alle = berichte.filter((b) => b.sp && b.ze)
if (alle.length > 1 && alle.every((b) => b.sp === alle[0].sp && b.ze === alle[0].ze)) {
  const sp = alle[0].sp
  const ze = alle[0].ze
  const union = new Array(sp * ze).fill(0)
  const unionZiel = new Array(sp * ze).fill(0)
  for (const b of alle)
    for (let k = 0; k < union.length; k++) {
      if (b.belegt[k]) union[k] = 1
      if (b.belegtZiel[k]) unionZiel[k] = 1
    }
  const griff = alle[0].griff
  const m = {
    belegt: union,
    belegtZiel: unionZiel,
    sp,
    ze,
    schritt: alle[0].schritt,
    getastet: alle.flatMap((b) => b.getastet),
  }
  const plaetze = lueckenSuchen(m, griff, BREIT, HOCH)
  const ins = inseln(plaetze, griff)
  console.log(`══ IN ALLEN ${alle.length} GEMESSENEN LAGEN ZUGLEICH FREI ${'═'.repeat(28)}`)
  console.log(`   (${alle.map((b) => b.name).join(', ')})`)
  if (!ins.length) {
    console.log(`   KEIN EINZIGER Platz fuer ${griff}x${griff} px. Ein Zeichen dieser Groesse oben links`)
    console.log('   verdeckt in mindestens einer Lage etwas — die Frage ist eine der ANORDNUNG.')
  } else {
    for (const i of [...ins].sort((x, y) => (y.besterAbstand ?? 9e9) - (x.besterAbstand ?? 9e9))) {
      console.log(
        `   x ${i.x1}..${i.x2}, y ${i.y1}..${i.y2}  —  bester Platz x ${i.bester.x} y ${i.bester.y}` +
          `   ${abstandSatz(i.bester)}`,
      )
    }
  }
  console.log('')
}

if (abbruch) console.log(`${abbruch} Lage(n) nicht gemessen.`)
process.exit(0)
