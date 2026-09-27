/**
 * DER THEME-GESTALTER — Themen bauen per Ziehen und Ablegen (BACKLOG E144).
 *
 * ══ DREI QUELLEN, KEINE EIGENE WAHRHEIT ═════════════════════════════════════
 *   format.mjs   WELCHE Felder es gibt und welche Werte gelten — die erzeugte
 *                Abschrift von mixpi-thema.ts. Jeder Regler hier wird aus
 *                `BLOECKE` gebaut und jeder Wert mit `pruefeWert` gehalten,
 *                derselben Funktion, die am Tor der Box steht.
 *   katalog.mjs  WO etwas andockt und wie es heisst.
 *   ablage.mjs   WOHIN es geht: Box (/api) oder Datei (auch Desktop-App).
 *
 * DER ENTWURF ist ein Bloecke-Objekt (`zustand.bloecke`), genau das, was in
 * einer .mixpi-thema.json unter `bloecke` steht. Bei jeder Aenderung geht er
 * — in flache Felder uebersetzt — an die Vorschau (`?gestalter=1`, Hoerer in
 * app.js). Gespeichert wird erst auf Knopfdruck.
 *
 * ZIEHEN laeuft ueber Zeiger-Ereignisse und nicht ueber HTML5-Drag-and-Drop:
 * dieses kennt auf Touch-Geraeten (Tablet am Kinderbett) keine Finger. Nur
 * Dateien aus dem Dateimanager kommen ueber `drop` herein — dafuer gibt es
 * keinen anderen Weg.
 */
import {
  AblageFehler,
  blobAlsDaten,
  bildVerkleinern,
  box,
  dateiOeffnen,
  dateiSpeichern,
  istDesktop,
  verbinden,
  vorlaeufigerName,
} from './ablage.mjs'
import { BLOECKE, FORMAT_KENNUNG, pruefeThema, pruefeWert, vonBloecken, zuBloecken } from './format.mjs'
import {
  ELEMENTE,
  FARB_SAETZE,
  FARBZIELE,
  PALETTE,
  SCHIRM,
  VERLAEUFE,
  WAHL_WORTE,
  WORTE,
  ZONEN,
} from './katalog.mjs'

const $ = (id) => document.getElementById(id)

/** Ein Element bauen: el('div', { class: 'x', onclick }, kind1, 'text', …). */
function el(tag, attrs = {}, ...kinder) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v)
    else if (k === 'class') e.className = v
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v)
    else if (k === 'dataset') Object.assign(e.dataset, v)
    else if (v === true) e.setAttribute(k, '')
    else e.setAttribute(k, String(v))
  }
  for (const k of kinder.flat()) if (k !== null && k !== undefined && k !== false) e.append(k)
  return e
}

const klon = (x) => JSON.parse(JSON.stringify(x))

// ═══════════════════════════════════════════════════════════════════════════
//  Zustand und Verlauf
// ═══════════════════════════════════════════════════════════════════════════

const zustand = {
  name: 'Mein Thema',
  bloecke: {},
  /** Welches Element das Blatt zeigt (id aus ELEMENTE) oder null. */
  auswahl: null,
  ansicht: 'start',
  blatt: 'element',
  /** Verbindung: { box, angemeldet, stand } aus ablage.verbinden(). */
  lage: { box: false, angemeldet: false, stand: null },
  /** Bildnamen der Box (neueste zuerst). */
  bilder: [],
  /** Bilder OHNE Box: vorlaeufiger Name -> data:-Adresse (reisen als Anhang). */
  eigeneBilder: new Map(),
  /** Farben der Saetze, aus ../app.css gelesen: id -> { bg, ink, pill }. */
  satzFarben: {},
  verlauf: [],
  zukunft: [],
  letzteGruppe: '',
  letzteZeit: 0,
}

/** Leere Bloecke wegraeumen — ein Block ohne Feld sagt nichts. */
function aufraeumen(b) {
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) delete b[k]
  }
  return b
}

/**
 * EINE AENDERUNG am Entwurf. `gruppe` fasst schnelle Folgen zusammen (ein
 * Schieberegler erzeugt Dutzende Werte — Rueckgaengig soll den ganzen Zug
 * zuruecknehmen, nicht einen Pixel).
 */
function aendern(arbeit, { gruppe = '', blatt = true } = {}) {
  const jetzt = Date.now()
  const zusammen = gruppe && gruppe === zustand.letzteGruppe && jetzt - zustand.letzteZeit < 900
  if (!zusammen) {
    zustand.verlauf.push(JSON.stringify(zustand.bloecke))
    if (zustand.verlauf.length > 200) zustand.verlauf.shift()
    zustand.zukunft = []
  }
  zustand.letzteGruppe = gruppe
  zustand.letzteZeit = jetzt
  arbeit(zustand.bloecke)
  aufraeumen(zustand.bloecke)
  nachAenderung({ blatt })
}

function rueckgaengig() {
  if (!zustand.verlauf.length) return
  zustand.zukunft.push(JSON.stringify(zustand.bloecke))
  zustand.bloecke = JSON.parse(zustand.verlauf.pop())
  zustand.letzteGruppe = ''
  nachAenderung()
}

function wiederholen() {
  if (!zustand.zukunft.length) return
  zustand.verlauf.push(JSON.stringify(zustand.bloecke))
  zustand.bloecke = JSON.parse(zustand.zukunft.pop())
  zustand.letzteGruppe = ''
  nachAenderung()
}

/** Einen ganz neuen Entwurf setzen (Laden) — selbst ein Schritt im Verlauf. */
function entwurfSetzen(bloecke, name) {
  zustand.verlauf.push(JSON.stringify(zustand.bloecke))
  zustand.zukunft = []
  zustand.bloecke = aufraeumen(klon(bloecke || {}))
  if (typeof name === 'string' && name.trim()) {
    zustand.name = name.trim().slice(0, 60)
    $('name').value = zustand.name
  }
  zustand.letzteGruppe = ''
  nachAenderung()
}

function nachAenderung({ blatt = true } = {}) {
  paletteMarken()
  deckZeichnen()
  if (blatt) blattZeichnen()
  $('rueck').disabled = zustand.verlauf.length === 0
  $('vor').disabled = zustand.zukunft.length === 0
  entwurfSenden()
}

// ── Felder lesen und setzen, per Pfad `block.feld` (oder `licht`) ──

function feldArt(pfad) {
  if (pfad === 'licht') return { art: 'wahl', werte: ['hell', 'dunkel'] }
  const [block, name] = pfad.split('.')
  return BLOECKE[block]?.[name]?.art || null
}

function feldLesen(pfad, b = zustand.bloecke) {
  if (pfad === 'licht') return b.licht
  const [block, name] = pfad.split('.')
  const x = b[block]
  return x && typeof x === 'object' ? x[name] : undefined
}

function feldSetzen(b, pfad, wert) {
  if (pfad === 'licht') {
    b.licht = wert
    return
  }
  const [block, name] = pfad.split('.')
  if (!b[block] || typeof b[block] !== 'object') b[block] = {}
  b[block][name] = wert
}

function feldLoeschen(b, pfad) {
  if (pfad === 'licht') {
    delete b.licht
    return
  }
  const [block, name] = pfad.split('.')
  if (b[block]) delete b[block][name]
}

/** Setzen MIT Pruefung — derselben wie am Tor der Box. */
function wertSetzen(pfad, roh, optionen) {
  const art = feldArt(pfad)
  const wert = art ? pruefeWert(roh, art) : undefined
  if (wert === undefined) return false
  aendern((b) => feldSetzen(b, pfad, wert), { gruppe: pfad, ...optionen })
  return true
}

// ═══════════════════════════════════════════════════════════════════════════
//  Die Vorschau
// ═══════════════════════════════════════════════════════════════════════════

const vorschau = () => $('vorschau')
let sendeTimer = 0

function entwurfSenden(sofort = false) {
  clearTimeout(sendeTimer)
  const los = () => {
    const w = vorschau()?.contentWindow
    if (!w) return
    w.postMessage({ art: 'mixpi-gestalter', was: 'entwurf', flach: vonBloecken(zustand.bloecke) }, '*')
  }
  if (sofort) los()
  else sendeTimer = setTimeout(los, 40)
  // Die Box braucht einen Augenblick, um umzubauen — danach stehen die
  // Marken dort, wo die Elemente jetzt wirklich sind.
  setTimeout(deckZeichnen, 260)
}

function musterSenden() {
  vorschau()?.contentWindow?.postMessage({ art: 'mixpi-gestalter', was: 'muster', an: $('muster').checked }, '*')
}

window.addEventListener('message', (e) => {
  if (e.source !== vorschau()?.contentWindow) return
  const m = e.data
  if (m && m.art === 'mixpi-gestalter' && m.was === 'bereit') {
    entwurfSenden(true)
    musterSenden()
  }
})

function ansichtSetzen(ansicht) {
  if (zustand.ansicht === ansicht) return
  zustand.ansicht = ansicht
  for (const b of document.querySelectorAll('[data-ansicht]')) b.setAttribute('aria-selected', String(b.dataset.ansicht === ansicht))
  vorschau().src = `../index.html?gestalter=1${ansicht === 'player' ? '&seite=player' : ''}`
  deckZeichnen()
}

/** Die 800x480 in den Platz einpassen, den die Mitte hat. */
let massstab = 1
function einpassen() {
  const schirm = $('schirm')
  const verfuegbar = schirm.parentElement.clientWidth - 24
  massstab = Math.max(0.35, Math.min(1.25, verfuegbar / SCHIRM.breite))
  schirm.style.width = `${Math.round(SCHIRM.breite * massstab)}px`
  schirm.style.height = `${Math.round(SCHIRM.hoehe * massstab)}px`
  const innen = $('schirm-innen')
  innen.style.transform = `scale(${massstab})`
}

// ═══════════════════════════════════════════════════════════════════════════
//  Palette
// ═══════════════════════════════════════════════════════════════════════════

function elementWo(e) {
  const zone = e.lesen(zustand.bloecke)
  return zone ? ZONEN[zone]?.wort || zone : null
}

function paletteBauen() {
  const gruppen = { andockbar: $('p-andockbar'), kopf: $('p-kopf'), buehne: $('p-buehne'), fest: $('p-fest') }
  for (const g of Object.values(gruppen)) g.replaceChildren()
  for (const e of ELEMENTE) {
    const ziel = gruppen[e.gruppe]
    if (e.gruppe === 'andockbar') {
      const teil = el(
        'div',
        { class: 'teil', tabindex: '0', role: 'button', 'aria-label': `${e.wort} ziehen`, dataset: { element: e.id } },
        el('span', { class: 'sym' }, e.symbol),
        el('span', { class: 'namen' }, el('span', {}, e.wort), el('span', { class: 'wo' })),
        e.neu ? el('span', { class: 'neu-marke', title: 'Gab es vor dem Gestalter nicht auf dem Schirm' }, 'NEU') : null,
      )
      teil.addEventListener('pointerdown', (ev) => ziehVorbereiten(ev, { art: 'element', id: e.id }, () => waehlen(e.id)))
      teil.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault()
          waehlen(e.id)
        }
      })
      ziel.append(teil)
    } else {
      const chip = el(
        'span',
        {
          class: `chip${e.fest ? ' fest' : ''}`,
          tabindex: '0',
          role: 'button',
          title: e.fest ? 'Eigenschaften zeigen' : 'Auf den Schirm ziehen',
          dataset: { element: e.id },
        },
        el('span', {}, e.symbol),
        e.wort,
      )
      if (e.fest) chip.addEventListener('click', () => waehlen(e.id))
      else chip.addEventListener('pointerdown', (ev) => ziehVorbereiten(ev, { art: 'element', id: e.id }, () => waehlen(e.id)))
      chip.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault()
          waehlen(e.id)
        }
      })
      ziel.append(chip)
    }
  }

  // Farbsaetze
  const saetze = $('p-saetze')
  saetze.replaceChildren()
  for (const s of FARB_SAETZE) {
    const f = zustand.satzFarben[s.id] || {}
    const kachel = el(
      'div',
      {
        class: 'satz',
        title: `Farbsatz „${s.wort}" — auf den Schirm ziehen oder antippen`,
        tabindex: '0',
        role: 'button',
        dataset: { satz: s.id },
        style: {
          background: `linear-gradient(135deg, ${f.bg || '#eee'} 0 55%, ${f.pill || '#333'} 55% 100%)`,
          color: f.ink || '#222',
        },
      },
      el('span', { class: 'satz-wort' }, s.wort),
    )
    kachel.addEventListener('pointerdown', (ev) =>
      ziehVorbereiten(ev, { art: 'satz', id: s.id, wort: s.wort, farbe: f.bg }, () => wertSetzen('farben.satz', s.id)),
    )
    saetze.append(kachel)
  }

  // Farben
  const farben = $('p-farben')
  farben.replaceChildren()
  for (const c of PALETTE) farben.append(farbKnopf(c))
  const eigene = $('p-eigene')
  const eigenerKnopf = farbKnopf(eigene.value.toUpperCase())
  eigenerKnopf.id = 'p-eigene-knopf'
  eigene.closest('label').prepend(eigenerKnopf)
  eigene.addEventListener('input', () => {
    const k = $('p-eigene-knopf')
    k.style.background = eigene.value
    k.dataset.farbe = eigene.value.toUpperCase()
  })

  hintergruendeBauen()
}

function farbKnopf(c) {
  const k = el('div', { class: 'farbe', title: `${c} — auf den Schirm ziehen`, style: { background: c }, dataset: { farbe: c } })
  k.addEventListener('pointerdown', (ev) => ziehVorbereiten(ev, { art: 'farbe', wert: k.dataset.farbe }))
  return k
}

function bildAdresse(name) {
  return zustand.eigeneBilder.get(name) || box.bildAdresse(name)
}

function hintergruendeBauen() {
  const ort = $('p-hg')
  ort.replaceChildren()
  for (const v of VERLAEUFE) {
    const k = el(
      'div',
      {
        class: 'hg',
        title: `Verlauf „${v.wort}" — auf den Schirm ziehen`,
        style: {
          background: v.regenbogen
            ? `linear-gradient(${v.winkel}deg, #FF5A5A, #FFB84D, #FFE94D, #5AD07A, #4DB8FF, #B06DFF)`
            : `linear-gradient(${v.winkel}deg, ${v.farbe}, ${v.farbe2})`,
        },
      },
      v.wort,
    )
    k.addEventListener('pointerdown', (ev) => ziehVorbereiten(ev, { art: 'verlauf', v }))
    ort.append(k)
  }
  const namen = [...zustand.eigeneBilder.keys(), ...zustand.bilder]
  for (const name of namen) {
    const k = el('div', { class: 'hg', title: 'Bild — auf den Schirm ziehen', style: { backgroundImage: `url("${bildAdresse(name)}")` } })
    k.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('.weg')) return
      ziehVorbereiten(ev, { art: 'bild', name })
    })
    if (zustand.lage.box && !zustand.eigeneBilder.has(name)) {
      k.append(
        el(
          'button',
          {
            type: 'button',
            class: 'weg',
            title: 'Bild von der Box löschen',
            'aria-label': 'Bild löschen',
            onclick: async (ev) => {
              ev.stopPropagation()
              if (!confirm('Dieses Bild von der Box löschen? Themen, die es nutzen, zeigen dann den Farbsatz.')) return
              try {
                await box.bildLoeschen(name)
                zustand.bilder = zustand.bilder.filter((n) => n !== name)
                hintergruendeBauen()
                if (zustand.blatt === 'farben') blattZeichnen()
              } catch (f) {
                melden(f.message, 'schlecht')
              }
            },
          },
          '✕',
        ),
      )
    }
    ort.append(k)
  }
}

/** Die Palette zeigt, was schon auf dem Schirm steht. */
function paletteMarken() {
  for (const t of document.querySelectorAll('[data-element]')) {
    const e = ELEMENTE.find((x) => x.id === t.dataset.element)
    if (!e) continue
    const wo = e.fest ? null : elementWo(e)
    t.classList.toggle('platziert', !!wo)
    t.classList.toggle('an', !!wo && t.classList.contains('chip'))
    const woEl = t.querySelector('.wo')
    if (woEl) woEl.textContent = wo || 'nicht auf dem Schirm'
  }
  const satz = feldLesen('farben.satz')
  for (const s of document.querySelectorAll('[data-satz]')) s.classList.toggle('gewaehlt', s.dataset.satz === satz)
}

// ═══════════════════════════════════════════════════════════════════════════
//  Das Deck: Marken der platzierten Elemente
// ═══════════════════════════════════════════════════════════════════════════

function kasten(z) {
  return { left: `${z.x}px`, top: `${z.y}px`, width: `${z.w}px`, height: `${z.h}px` }
}

function deckZeichnen() {
  if (zug?.aktiv) return
  const deck = $('deck')
  deck.replaceChildren()
  const kopfReihe = []
  const marken = []
  for (const e of ELEMENTE) {
    const zone = e.lesen(zustand.bloecke)
    const z = zone && ZONEN[zone]
    if (!z || z.ansicht !== zustand.ansicht) continue
    if (e.gruppe === 'kopf') {
      kopfReihe.push(e)
      continue
    }
    // DIE MARKE SITZT, WO DAS ELEMENT WIRKLICH STEHT — gemessen in der
    // Vorschau (gleiche Herkunft). Nur wenn das nicht geht (fremde Herkunft,
    // Element gerade versteckt), steht sie auf der Zone.
    const r = echtesRechteck(e.knoten) || z
    marken.push({ r, m: marke(e, r) })
  }
  // GROSS ZUERST, KLEIN ZULETZT (27.09.2026, Betreiber: „die andockstellen
  // ueberschneiden sich … man kann nicht einfach die sektionen anklicken").
  // Was spaeter im Baum steht, liegt oben und faengt den Klick — so gewinnt
  // das kleinere Element in einem groesseren, nicht umgekehrt.
  marken.sort((a, b) => b.r.w * b.r.h - a.r.w * a.r.h)
  for (const { m } of marken) deck.append(m)
  if (kopfReihe.length) {
    // Die Kopf-Anzeigen stehen als Reihe in der Kopfzeile, rechts beginnend
    // — wie auf der Box (Status rechts, Uhr in der Mitte).
    const z = ZONEN.kopf
    // pointerEvents none: die Reihe liegt als Kasten ueber der GANZEN
    // Kopfzeile und fing sonst die Klicks auf die Schilder „Kopfleiste" und
    // „Zurueck-Knopf" darunter ab. Ihre Marken selbst nehmen Klicks an.
    const reihe = el('div', {
      style: {
        position: 'absolute',
        ...kasten(z),
        display: 'flex',
        gap: '4px',
        alignItems: 'flex-end',
        justifyContent: 'flex-end',
        padding: '0 6px 4px',
        pointerEvents: 'none',
      },
    })
    for (const e of kopfReihe) {
      const m = marke(e, null)
      m.classList.add('klein')
      Object.assign(m.style, { position: 'relative', width: 'auto', height: '24px' })
      m.querySelector('.schild').style.position = 'static'
      reihe.append(m)
    }
    deck.append(reihe)
  }
  schilderEntwirren(deck)
}

/**
 * SCHILDER WEICHEN EINANDER AUS (27.09.2026). Jedes Schild sitzt links oben in
 * seinem Rahmen — bei ineinanderliegenden Bereichen (Kopfleiste und
 * Zurueck-Knopf, Kacheln & Reihen und Weiterhoeren) genau uebereinander, und
 * das verdeckte war nicht mehr anzuklicken. Die kleinen Elemente behalten
 * ihren Platz (sie wurden zuletzt gezeichnet, stehen hier also vorn); ein
 * Schild, das ein schon gesetztes ueberdeckt, wandert in die naechste freie
 * Ecke seines Rahmens.
 */
function schilderEntwirren(deck) {
  const ecken = [
    { left: 'auto', right: '4px', top: '4px', bottom: 'auto' },
    { left: '4px', right: 'auto', top: 'auto', bottom: '4px' },
    { left: 'auto', right: '4px', top: 'auto', bottom: '4px' },
  ]
  const trifft = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  const gesetzt = [...deck.querySelectorAll('.marke-el.klein .schild')].map((x) => x.getBoundingClientRect())
  const schilder = [...deck.querySelectorAll(':scope > .marke-el > .schild')].reverse()
  for (const sch of schilder) {
    let r = sch.getBoundingClientRect()
    if (gesetzt.some((g) => trifft(r, g))) {
      for (const ecke of ecken) {
        Object.assign(sch.style, ecke)
        r = sch.getBoundingClientRect()
        if (!gesetzt.some((g) => trifft(r, g))) break
      }
    }
    gesetzt.push(r)
  }
}

/** Wo steht ein Knoten der Box-Seite? In Bildpunkten des 800x480-Schirms. */
function echtesRechteck(auswahl) {
  if (!auswahl) return null
  try {
    const k = vorschau()?.contentDocument?.querySelector(auswahl)
    if (!k || k.hidden) return null
    const r = k.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) return null
    const x = Math.max(0, r.left)
    const y = Math.max(0, r.top)
    return { x, y, w: Math.min(SCHIRM.breite, r.right) - x, h: Math.min(SCHIRM.hoehe, r.bottom) - y }
  } catch {
    return null
  }
}

function marke(e, r) {
  const m = el(
    'div',
    {
      class: `marke-el${e.fest ? ' fest' : ''}${zustand.auswahl === e.id ? ' gewaehlt' : ''}`,
      style: r ? kasten(r) : {},
      title: e.fest ? `${e.wort} — Eigenschaften` : `${e.wort} — ziehen zum Verschieben, antippen für Eigenschaften`,
    },
    el('span', { class: 'schild' }, `${e.symbol} ${e.wort}`),
  )
  if (e.fest) {
    m.style.pointerEvents = 'none'
    const schild = m.querySelector('.schild')
    schild.style.pointerEvents = 'auto'
    schild.style.cursor = 'pointer'
    schild.addEventListener('click', () => waehlen(e.id))
  } else {
    m.addEventListener('pointerdown', (ev) => ziehVorbereiten(ev, { art: 'element', id: e.id, vomSchirm: true }, () => waehlen(e.id)))
  }
  return m
}

// ═══════════════════════════════════════════════════════════════════════════
//  Ziehen und Ablegen
// ═══════════════════════════════════════════════════════════════════════════

/** Der laufende Zug: { nutzlast, sx, sy, aktiv, beiKlick, ziel }. */
let zug = null

function ziehVorbereiten(ev, nutzlast, beiKlick) {
  if (ev.button !== undefined && ev.button !== 0) return
  ev.preventDefault()
  zug = { nutzlast, sx: ev.clientX, sy: ev.clientY, aktiv: false, beiKlick, ziel: null }
  // DIE VORSCHAU IST EIN EIGENES DOKUMENT: ueber ihr kaemen Bewegen und
  // Loslassen dort an statt hier, und der Zug bliebe am Zeiger haengen
  // (gemessen: der Geist klebte nach dem Loslassen weiter). Fuer die Dauer
  // eines Zugs nimmt sie deshalb keine Zeiger an (`body.zug-offen`).
  document.body.classList.add('zug-offen')
  window.addEventListener('pointermove', ziehBewegen)
  window.addEventListener('pointerup', ziehEnde)
  window.addEventListener('pointercancel', ziehAbbruch)
}

function ziehBewegen(ev) {
  if (!zug) return
  if (!zug.aktiv) {
    if (Math.hypot(ev.clientX - zug.sx, ev.clientY - zug.sy) < 6) return
    zug.aktiv = true
    ziehBeginn()
  }
  const geist = $('geist')
  geist.style.left = `${ev.clientX}px`
  geist.style.top = `${ev.clientY + 18}px`
  const ziel = zielUnter(ev.clientX, ev.clientY)
  zug.ziel = ziel
  for (const z of document.querySelectorAll('.zone')) z.classList.toggle('drauf', !!ziel && ziel.knoten === z)
  $('palette').classList.toggle('ziel-entfernen', ziel?.art === 'entfernen')
}

function ziehAufraeumen() {
  window.removeEventListener('pointermove', ziehBewegen)
  window.removeEventListener('pointerup', ziehEnde)
  window.removeEventListener('pointercancel', ziehAbbruch)
  document.body.classList.remove('zieht', 'zug-offen')
  $('geist').hidden = true
  $('palette').classList.remove('ziel-entfernen')
}

function ziehAbbruch() {
  ziehAufraeumen()
  zug = null
  deckZeichnen()
}

function ziehEnde(ev) {
  const z = zug
  ziehAufraeumen()
  zug = null
  if (!z) return
  if (!z.aktiv) {
    z.beiKlick?.()
    return
  }
  const ziel = zielUnter(ev.clientX, ev.clientY)
  deckZeichnen()
  if (ziel) ablegen(z.nutzlast, ziel)
}

function geistText(n) {
  if (n.art === 'element') {
    const e = ELEMENTE.find((x) => x.id === n.id)
    return [el('span', {}, e?.symbol || ''), e?.wort || n.id]
  }
  if (n.art === 'satz') return [el('span', { class: 'punkt', style: { background: n.farbe || '#ccc' } }), `Farbsatz ${n.wort}`]
  if (n.art === 'farbe') return [el('span', { class: 'punkt', style: { background: n.wert } }), n.wert]
  if (n.art === 'verlauf') return [el('span', { class: 'punkt', style: { background: `linear-gradient(${n.v.farbe}, ${n.v.farbe2})` } }), n.v.wort]
  if (n.art === 'bild') return ['🖼', 'Hintergrundbild']
  return ['…']
}

/** Beim ersten Bewegen: Zonen zeigen, die diese Nutzlast annehmen. */
function ziehBeginn() {
  const n = zug.nutzlast
  document.body.classList.add('zieht')
  const geist = $('geist')
  geist.replaceChildren(...geistText(n))
  geist.hidden = false

  const deck = $('deck')
  deck.replaceChildren()
  if (n.art === 'element') {
    const e = ELEMENTE.find((x) => x.id === n.id)
    if (!e) return
    if (e.ansicht !== zustand.ansicht) ansichtSetzen(e.ansicht)
    for (const zid of e.zonen) {
      const z = ZONEN[zid]
      if (!z || z.ansicht !== zustand.ansicht) continue
      deck.append(
        el(
          'div',
          { class: `zone${z.gesperrt ? ' gesperrt' : ''}`, style: kasten(z), dataset: { zone: zid } },
          z.gesperrt ? `${z.wort}: ${z.gesperrt}` : z.wort,
        ),
      )
    }
  } else if (n.art === 'farbe') {
    const raster = el('div', { class: 'farbziele' })
    for (const f of FARBZIELE) {
      raster.append(el('div', { class: 'zone', dataset: { farbziel: f.id } }, el('div', {}, f.wort, el('small', {}, f.hinweis))))
    }
    deck.append(raster)
  } else {
    const wort = n.art === 'satz' ? `Farbsatz „${n.wort}" übernehmen` : 'Als Hintergrund übernehmen'
    deck.append(el('div', { class: 'zone flaeche', dataset: { flaeche: '1' } }, wort))
    // EIN VERLAUF GEHT AUCH AUFS GLAS DER KOPFLEISTE (27.09.2026). Die Zone
    // liegt IN der grossen Flaeche — die kleinste unter dem Zeiger gewinnt
    // (zielUnter), ueber der Leiste also diese.
    if (n.art === 'verlauf' && ZONEN.kopf && ZONEN.kopf.ansicht === zustand.ansicht) {
      deck.append(el('div', { class: 'zone', style: kasten(ZONEN.kopf), dataset: { farbziel: 'kopf.glasVerlauf' } }, 'Als Glas oben'))
    }
  }
}

function drin(r, x, y) {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

/** Was liegt unter dem Zeiger? Die KLEINSTE passende Zone gewinnt. */
function zielUnter(x, y) {
  if (zug?.nutzlast?.art === 'element' && drin($('palette').getBoundingClientRect(), x, y)) {
    const e = ELEMENTE.find((k) => k.id === zug.nutzlast.id)
    return e && !e.fest ? { art: 'entfernen' } : null
  }
  let bester = null
  let flaeche = Infinity
  for (const knoten of document.querySelectorAll('#deck .zone')) {
    if (knoten.classList.contains('gesperrt')) continue
    const r = knoten.getBoundingClientRect()
    if (!drin(r, x, y)) continue
    const a = r.width * r.height
    if (a < flaeche) {
      flaeche = a
      bester = knoten
    }
  }
  if (!bester) return null
  return {
    art: 'zone',
    knoten: bester,
    zone: bester.dataset.zone,
    farbziel: bester.dataset.farbziel,
    flaeche: !!bester.dataset.flaeche,
  }
}

function ablegen(n, ziel) {
  if (n.art === 'element') {
    const e = ELEMENTE.find((x) => x.id === n.id)
    if (!e) return
    if (ziel.art === 'entfernen') {
      if (!e.fest) aendern((b) => e.entfernen(b))
      if (zustand.auswahl === e.id) waehlen(e.id)
      return
    }
    if (!ziel.zone || e.fest) return
    aendern((b) => e.setzen(b, ziel.zone), { blatt: false })
    waehlen(e.id)
    return
  }
  if (n.art === 'satz' && ziel.flaeche) {
    wertSetzen('farben.satz', n.id)
    blattWechseln('farben')
    return
  }
  if (n.art === 'farbe' && ziel.farbziel) {
    farbeAblegen(ziel.farbziel, n.wert)
    blattWechseln('farben')
    return
  }
  if (n.art === 'verlauf' && ziel.farbziel === 'kopf.glasVerlauf') {
    aendern((b) => {
      feldSetzen(b, 'kopf.glasFarbe', n.v.regenbogen ? 'regenbogen' : n.v.farbe)
      feldSetzen(b, 'kopf.glasFarbe2', n.v.regenbogen ? '' : n.v.farbe2)
      feldSetzen(b, 'kopf.glasWinkel', n.v.winkel)
      const stil = feldLesen('kopf.stil', b)
      if (stil === undefined || stil === 'schlicht') feldSetzen(b, 'kopf.stil', 'glas')
    })
    waehlen('kopfleiste')
    return
  }
  if (n.art === 'verlauf' && n.v.regenbogen && ziel.flaeche) {
    aendern((b) => {
      feldSetzen(b, 'hintergrund.art', 'regenbogen')
      feldSetzen(b, 'hintergrund.winkel', n.v.winkel)
      // Ein Schleier von Anfang an: der Bogen ist kraeftig, die Namen unter
      // den Kacheln sollen lesbar bleiben.
      if (feldLesen('hintergrund.schleier', b) === undefined) feldSetzen(b, 'hintergrund.schleier', 0.45)
    })
    blattWechseln('farben')
    return
  }
  if (n.art === 'verlauf' && ziel.flaeche) {
    aendern((b) => {
      feldSetzen(b, 'hintergrund.art', 'verlauf')
      feldSetzen(b, 'hintergrund.farbe', n.v.farbe)
      feldSetzen(b, 'hintergrund.farbe2', n.v.farbe2)
      feldSetzen(b, 'hintergrund.winkel', n.v.winkel)
    })
    blattWechseln('farben')
    return
  }
  if (n.art === 'bild' && ziel.flaeche) {
    bildAlsHintergrund(n.name)
  }
}

function farbeAblegen(ziel, wert) {
  aendern((b) => {
    if (ziel === 'hintergrund') {
      feldSetzen(b, 'hintergrund.art', 'farbe')
      feldSetzen(b, 'hintergrund.farbe', wert)
    } else if (ziel === 'kopf.glasFarbe') {
      // Glas ohne Glas-Leiste saehe man nicht: eine schlichte Leiste wird Glas.
      feldSetzen(b, 'kopf.glasFarbe', wert)
      const stil = feldLesen('kopf.stil', b)
      if (stil === undefined || stil === 'schlicht') feldSetzen(b, 'kopf.stil', 'glas')
    } else if (ziel === 'zurueck.glasFarbe') {
      // Eigenes Glas sieht man nur, wenn der Knopf nicht deckend ist.
      feldSetzen(b, 'zurueck.glasFarbe', wert)
      if (feldLesen('zurueck.flaeche', b) === 'deckend') feldSetzen(b, 'zurueck.flaeche', 'glas')
      const stil = feldLesen('kopf.stil', b)
      if ((stil === undefined || stil === 'schlicht') && feldLesen('zurueck.flaeche', b) !== 'glas') feldSetzen(b, 'zurueck.flaeche', 'glas')
    } else if (ziel === 'kacheln.randFarbe') {
      feldSetzen(b, 'kacheln.randFarbe', wert)
      feldSetzen(b, 'kacheln.randAn', true)
      if (feldLesen('kacheln.randBreite', b) === undefined) feldSetzen(b, 'kacheln.randBreite', 4)
    } else {
      feldSetzen(b, ziel, wert)
    }
  })
}

function bildAlsHintergrund(name) {
  aendern((b) => {
    feldSetzen(b, 'hintergrund.art', 'bild')
    feldSetzen(b, 'hintergrund.bild', name)
    if (feldLesen('hintergrund.schleier', b) === undefined) feldSetzen(b, 'hintergrund.schleier', 0.25)
  })
  blattWechseln('farben')
  if (!zustand.lage.box) melden('Ohne Box zeigt die Vorschau das Bild nicht — es reist aber in der gespeicherten Datei mit.')
}

// ── Dateien aus dem Dateimanager ──

async function dateiHerein(datei) {
  if (!datei) return
  if (/json$/i.test(datei.type) || /\.json$/i.test(datei.name)) {
    await themaLaden(await datei.text())
    return
  }
  if (!/^image\//.test(datei.type)) {
    melden('Das ist weder ein Bild noch eine Themendatei.', 'schlecht')
    return
  }
  try {
    melden('Bild wird vorbereitet …')
    const blob = await bildVerkleinern(datei)
    let name
    if (zustand.lage.box && zustand.lage.angemeldet) {
      name = (await box.bildHochladen(blob)).name
      zustand.bilder = [name, ...zustand.bilder.filter((n) => n !== name)]
    } else {
      name = await vorlaeufigerName(blob)
      zustand.eigeneBilder.set(name, await blobAlsDaten(blob))
    }
    hintergruendeBauen()
    bildAlsHintergrund(name)
    melden('Bild als Hintergrund gesetzt.', 'gut')
  } catch (f) {
    melden(f.message || String(f), 'schlecht')
  }
}

function dateiAblageVerdrahten() {
  const hinweis = $('ablage-hinweis')
  let tiefe = 0
  const mitDateien = (ev) => [...(ev.dataTransfer?.types || [])].includes('Files')
  window.addEventListener('dragenter', (ev) => {
    if (!mitDateien(ev)) return
    ev.preventDefault()
    tiefe++
    hinweis.textContent = 'Bild oder Themendatei hier ablegen'
    hinweis.hidden = false
  })
  window.addEventListener('dragover', (ev) => {
    if (mitDateien(ev)) ev.preventDefault()
  })
  window.addEventListener('dragleave', () => {
    tiefe = Math.max(0, tiefe - 1)
    if (!tiefe) hinweis.hidden = true
  })
  window.addEventListener('drop', (ev) => {
    if (!mitDateien(ev)) return
    ev.preventDefault()
    tiefe = 0
    hinweis.hidden = true
    void dateiHerein(ev.dataTransfer.files[0])
  })
  $('bild-waehlen').addEventListener('click', () => {
    const e = el('input', { type: 'file', accept: 'image/*' })
    e.addEventListener('change', () => dateiHerein(e.files?.[0]))
    e.click()
  })
}

// ═══════════════════════════════════════════════════════════════════════════
//  Das Blatt rechts
// ═══════════════════════════════════════════════════════════════════════════

function waehlen(id) {
  zustand.auswahl = id
  const e = ELEMENTE.find((x) => x.id === id)
  if (e && e.ansicht !== zustand.ansicht) ansichtSetzen(e.ansicht)
  blattWechseln('element')
  deckZeichnen()
}

function blattWechseln(welches) {
  zustand.blatt = welches
  for (const b of document.querySelectorAll('[data-blatt]')) b.setAttribute('aria-selected', String(b.dataset.blatt === welches))
  $('b-element').hidden = welches !== 'element'
  $('b-farben').hidden = welches !== 'farben'
  $('b-themen').hidden = welches !== 'themen'
  blattZeichnen()
}

function blattZeichnen() {
  if (zustand.blatt === 'element') elementBlatt()
  else if (zustand.blatt === 'farben') farbBlatt()
  else themenBlatt()
}

function elementBlatt() {
  const ort = $('b-element')
  ort.replaceChildren()
  const e = ELEMENTE.find((x) => x.id === zustand.auswahl)
  if (!e) {
    ort.append(
      el(
        'div',
        { class: 'leer-hinweis' },
        el('h3', {}, 'So geht es'),
        el(
          'ol',
          {},
          el('li', {}, 'Ein Element links greifen und auf den Schirm ziehen — die möglichen Plätze leuchten auf.'),
          el('li', {}, 'Ein Element auf dem Schirm antippen: hier erscheinen seine Eigenschaften.'),
          el('li', {}, 'Farben und Bilder auf den Schirm ziehen — oder im Reiter „Farben & Hintergrund" wählen.'),
          el('li', {}, '„Auf der Box anwenden" zeigt es sofort am Gerät; „Als Thema ablegen" merkt es sich unter dem Namen.'),
        ),
      ),
    )
    return
  }
  const wo = e.fest ? null : elementWo(e)
  ort.append(
    el(
      'div',
      { class: 'blatt-kopf' },
      el('span', { class: 'sym' }, e.symbol),
      el(
        'div',
        {},
        el('h3', {}, e.wort, ' ', e.neu ? el('span', { class: 'neu-marke' }, 'NEU') : null),
        el('div', { class: 'unter' }, e.fest ? 'fester Bereich' : wo ? `angedockt: ${wo}` : 'nicht auf dem Schirm'),
      ),
    ),
  )
  if (!e.fest) {
    // DER WEG OHNE ZIEHEN — fuer Tastatur und Bildschirmleser, und fuer alle,
    // die lieber waehlen als ziehen. Derselbe `setzen()` wie beim Ablegen.
    const platz = el('select', { 'aria-label': 'Platz' })
    platz.append(el('option', { value: '' }, '— nicht auf dem Schirm —'))
    for (const zid of e.zonen) {
      const z = ZONEN[zid]
      if (!z || z.gesperrt) continue
      platz.append(el('option', { value: zid, selected: e.lesen(zustand.bloecke) === zid }, z.wort))
    }
    platz.addEventListener('change', () => {
      if (platz.value) aendern((b) => e.setzen(b, platz.value))
      else aendern((b) => e.entfernen(b))
    })
    ort.append(el('div', { class: 'feld' }, el('div', { class: 'feld-kopf' }, el('span', {}, 'Platz')), platz))
  }
  for (const pfad of e.felder) ort.append(regler(pfad))
  if (!e.fest && e.lesen(zustand.bloecke)) {
    ort.append(
      el('hr', { class: 'trenner' }),
      el('button', { type: 'button', class: 'breit', onclick: () => aendern((b) => e.entfernen(b)) }, 'Vom Schirm nehmen'),
    )
  }
}

function farbBlatt() {
  const ort = $('b-farben')
  ort.replaceChildren()
  ort.append(el('h3', {}, 'Farben'))
  ort.append(regler('licht'))
  // Der Farbsatz als Kacheln (die Wahl hat im Format keine feste Werteliste —
  // welche es gibt, weiss das Stilblatt).
  const satz = feldLesen('farben.satz')
  const kacheln = el('div', { class: 'saetze' })
  for (const s of FARB_SAETZE) {
    const f = zustand.satzFarben[s.id] || {}
    kacheln.append(
      el(
        'button',
        {
          type: 'button',
          class: `satz${satz === s.id ? ' gewaehlt' : ''}`,
          'aria-pressed': String(satz === s.id),
          style: { background: `linear-gradient(135deg, ${f.bg || '#eee'} 0 55%, ${f.pill || '#333'} 55% 100%)`, color: f.ink || '#222' },
          onclick: () => wertSetzen('farben.satz', s.id),
        },
        el('span', { class: 'satz-wort' }, s.wort),
      ),
    )
  }
  ort.append(feldHuelle('farben.satz', kacheln))
  for (const p of ['farben.akzent', 'farben.grund', 'farben.flaeche', 'farben.schrift']) ort.append(regler(p))
  ort.append(el('hr', { class: 'trenner' }), el('h3', {}, 'Hintergrund'))
  const art = feldLesen('hintergrund.art')
  ort.append(regler('hintergrund.art'))
  if (art === 'farbe' || art === 'verlauf') ort.append(regler('hintergrund.farbe'))
  if (art === 'verlauf') ort.append(regler('hintergrund.farbe2'), regler('hintergrund.winkel'))
  if (art === 'regenbogen') ort.append(regler('hintergrund.winkel'))
  if (art === 'bild') ort.append(regler('hintergrund.bild'))
  if (art === 'bild' || art === 'verlauf' || art === 'regenbogen') ort.append(regler('hintergrund.schleier'))
}

function themenBlatt() {
  const ort = $('b-themen')
  ort.replaceChildren()
  const lage = zustand.lage
  ort.append(
    el('h3', {}, 'Neu beginnen'),
    el(
      'div',
      { class: 'themen-liste' },
      el('button', { type: 'button', onclick: () => entwurfSetzen({}, 'Mein Thema') }, 'Leer — nur was ich ändere'),
      lage.box && lage.stand?.aktuell
        ? el(
            'button',
            { type: 'button', onclick: () => entwurfSetzen(zuBloecken(lage.stand.aktuell), 'Mein Thema') },
            'Vom jetzigen Stand der Box',
          )
        : null,
    ),
    el('p', { class: 'klein' }, '„Leer" heißt: das Thema sagt nur, was du einstellst — alles andere bleibt auf der Box, wie es ist.'),
  )
  if (!lage.box) {
    ort.append(
      el('hr', { class: 'trenner' }),
      el(
        'p',
        { class: 'klein' },
        istDesktop()
          ? 'Ohne Box: gestalten und als Datei speichern. Mit einer Box verbunden (Menü „Box") kommen ihre Themen hierher.'
          : 'Keine Box erreichbar — gestalten und als Datei speichern geht trotzdem.',
      ),
    )
    return
  }
  if (!lage.angemeldet) {
    ort.append(el('p', { class: 'klein' }, 'Nicht angemeldet: ', el('a', { href: '../../admin/anmeldung' }, 'in der Verwaltung anmelden'), ', dann neu laden.'))
    return
  }
  const themen = lage.stand?.themen || {}
  const liste = el('div', { class: 'themen-liste' })
  for (const name of Object.keys(themen).sort((a, b) => a.localeCompare(b, 'de'))) {
    liste.append(
      el(
        'div',
        { class: 'thema-zeile' },
        el('b', { title: name }, name),
        lage.stand?.aktiv === name ? el('span', { class: 'aktiv' }, 'aktiv') : null,
        el('button', { type: 'button', onclick: () => abgelegtesLaden(name) }, 'Laden'),
      ),
    )
  }
  ort.append(el('hr', { class: 'trenner' }), el('h3', {}, 'Themen auf der Box'), liste)
}

// ── Die Regler: gebaut aus der Feldart des Formats ──

function feldHuelle(pfad, steuerung, wertText) {
  const gesetzt = feldLesen(pfad) !== undefined
  return el(
    'div',
    { class: `feld${gesetzt ? '' : ' ungesetzt'}` },
    el(
      'div',
      { class: 'feld-kopf' },
      el('span', {}, WORTE[pfad] || pfad),
      wertText !== undefined ? el('span', { class: 'wert' }, wertText) : null,
      gesetzt
        ? el(
            'button',
            {
              type: 'button',
              class: 'zurueck',
              title: 'Aus dem Thema nehmen — die Box behält dann ihren Wert',
              'aria-label': `${WORTE[pfad] || pfad} aus dem Thema nehmen`,
              onclick: () => aendern((b) => feldLoeschen(b, pfad)),
            },
            '↺',
          )
        : null,
    ),
    steuerung,
  )
}

function zahlText(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '')
}

function regler(pfad) {
  const art = feldArt(pfad)
  const wert = feldLesen(pfad)
  if (!art) return el('div', {}, pfad)
  switch (art.art) {
    case 'schalter': {
      const box_ = el('input', { type: 'checkbox', checked: wert === true })
      box_.indeterminate = wert === undefined
      box_.addEventListener('change', () => wertSetzen(pfad, box_.checked))
      return feldHuelle(pfad, el('label', { class: 'schalter' }, box_, wert === undefined ? 'nicht gesetzt' : wert ? 'an' : 'aus'))
    }
    case 'zahl': {
      const spanne = art.max - art.min
      const schritt = spanne <= 3 ? 0.05 : spanne <= 100 ? 1 : 5
      const start = wert === undefined ? Math.min(art.max, Math.max(art.min, 1)) : wert
      const r = el('input', { type: 'range', min: art.min, max: art.max, step: schritt, value: start })
      const huelle = feldHuelle(pfad, r, wert === undefined ? '—' : zahlText(wert))
      r.addEventListener('input', () => {
        // blatt:false — sonst baute jeder Pixel das Blatt neu und der Regler
        // verloere unter dem Finger den Fokus.
        wertSetzen(pfad, Number(r.value), { blatt: false })
        huelle.querySelector('.wert').textContent = zahlText(Number(r.value))
        huelle.classList.remove('ungesetzt')
      })
      r.addEventListener('change', () => blattZeichnen())
      return huelle
    }
    case 'wahl': {
      const werte = art.werte
      if (werte.length > 4) {
        const s = el('select', {})
        if (wert === undefined) s.append(el('option', { value: '', selected: true }, '— nicht gesetzt —'))
        for (const w of werte) s.append(el('option', { value: w, selected: wert === w }, WAHL_WORTE[w] || w))
        s.addEventListener('change', () => s.value && wertSetzen(pfad, s.value))
        return feldHuelle(pfad, s)
      }
      const gruppe = el('div', { class: 'wahl', role: 'group', 'aria-label': WORTE[pfad] || pfad })
      for (const w of werte) {
        gruppe.append(
          el('button', { type: 'button', 'aria-pressed': String(wert === w), onclick: () => wertSetzen(pfad, w) }, WAHL_WORTE[w] || w),
        )
      }
      return feldHuelle(pfad, gruppe)
    }
    case 'farbe': {
      const hex = typeof wert === 'string' && /^#[0-9a-fA-F]{6}$/.test(wert)
      const c = el('input', { type: 'color', value: hex ? wert.toLowerCase() : '#888888' })
      c.addEventListener('input', () => wertSetzen(pfad, c.value.toUpperCase(), { blatt: false }))
      c.addEventListener('change', () => blattZeichnen())
      const zeile = el(
        'div',
        { class: 'farbfeld' },
        c,
        // Beim Regenbogen sagt es der gedrueckte Knopf — kein zweites Wort daneben.
        wert === 'regenbogen' ? null : el('code', {}, wert === '' ? 'vom Farbsatz' : wert || '—'),
        // REGENBOGEN (27.09.2026): nur, wo das Format ihn erlaubt (Kopfleiste).
        art.regenbogen
          ? el(
              'button',
              {
                type: 'button',
                class: 'leise regenbogen-knopf',
                'aria-pressed': String(wert === 'regenbogen'),
                onclick: () => wertSetzen(pfad, 'regenbogen'),
              },
              'Regenbogen',
            )
          : null,
        art.leer && wert ? el('button', { type: 'button', class: 'leise', onclick: () => wertSetzen(pfad, '') }, 'Farbsatz nehmen') : null,
      )
      return feldHuelle(pfad, zeile)
    }
    case 'text': {
      const t = el('input', { type: 'text', maxlength: art.max, value: wert || '', placeholder: 'Text …' })
      t.addEventListener('input', () => wertSetzen(pfad, t.value, { blatt: false }))
      return feldHuelle(pfad, t)
    }
    case 'bild': {
      const gitter = el('div', { class: 'bildwahl' })
      gitter.append(el('button', { type: 'button', 'aria-pressed': String(!wert), onclick: () => wertSetzen(pfad, '') }, 'keins'))
      for (const name of [...zustand.eigeneBilder.keys(), ...zustand.bilder]) {
        gitter.append(
          el('button', {
            type: 'button',
            title: name,
            'aria-label': `Bild ${name}`,
            'aria-pressed': String(wert === name),
            style: { backgroundImage: `url("${bildAdresse(name)}")` },
            onclick: () => wertSetzen(pfad, name),
          }),
        )
      }
      return feldHuelle(pfad, gitter)
    }
    default:
      return el('div', {}, pfad)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Speichern, Ablegen, Anwenden, Laden
// ═══════════════════════════════════════════════════════════════════════════

let meldeTimer = 0
function melden(text, art = '') {
  const m = $('meldung')
  m.textContent = text
  m.className = `meldung ${art}`
  m.hidden = false
  clearTimeout(meldeTimer)
  meldeTimer = setTimeout(() => (m.hidden = true), art === 'schlecht' ? 7000 : 3500)
}

function dokument() {
  return { format: FORMAT_KENNUNG, name: zustand.name, bloecke: klon(zustand.bloecke) }
}

/** Vor dem Hinausgehen: dasselbe Tor wie auf der Box, damit der Fehler HIER auffaellt. */
function pruefenOderMelden(dok) {
  const b = pruefeThema(dok)
  if (!b.ok) melden(`Das Thema hat Fehler: ${b.fehler.join(' · ')}`, 'schlecht')
  return b.ok
}

async function mitAnhang(dok) {
  const bild = dok.bloecke?.hintergrund?.bild
  if (!bild) return dok
  const daten = zustand.eigeneBilder.get(bild) || (zustand.lage.box ? await box.bildAlsDaten(bild) : null)
  return daten ? { ...dok, anhaenge: { [bild]: daten } } : dok
}

async function speichern() {
  const dok = dokument()
  if (!pruefenOderMelden(dok)) return
  try {
    const ok = await dateiSpeichern(await mitAnhang(dok))
    if (ok !== false) melden('Datei gespeichert.', 'gut')
  } catch (f) {
    melden(f.message || String(f), 'schlecht')
  }
}

async function anwenden() {
  const dok = dokument()
  if (!pruefenOderMelden(dok)) return
  try {
    const r = await box.anwenden(await mitAnhang(dok))
    melden(`Auf der Box angewendet (${r.felder} Einstellungen, Profil „${r.profil}").`, 'gut')
    await standNeu()
  } catch (f) {
    melden(f.message || String(f), 'schlecht')
  }
}

async function ablegenAufBox() {
  const dok = dokument()
  if (!pruefenOderMelden(dok)) return
  try {
    const mit = await mitAnhang(dok)
    try {
      await box.ablegen(mit)
    } catch (f) {
      if (!(f instanceof AblageFehler) || f.status !== 409) throw f
      if (!confirm(`Ein Thema „${dok.name}" gibt es schon. Ersetzen?`)) return
      await box.ablegen(mit, true)
    }
    melden(`„${dok.name}" liegt jetzt in der Themenliste der Box.`, 'gut')
    await standNeu()
  } catch (f) {
    melden(f.message || String(f), 'schlecht')
  }
}

/**
 * Eine Themendatei laden. Was das Tor ablehnt, bleibt DRAUSSEN — der Rest
 * wird geladen und die Ablehnungen gemeldet (eine Datei von einer neueren
 * Box soll nicht ganz scheitern, nur weil sie ein Feld mehr kennt).
 */
async function themaLaden(text) {
  if (!text) return
  let dok
  try {
    dok = JSON.parse(text)
  } catch {
    melden('Die Datei ist kein JSON.', 'schlecht')
    return
  }
  const befund = pruefeThema(dok)
  let bloecke = befund.bloecke || {}
  // Mitgebrachte Bilder: auf die Box hochladen (dort neu benannt) oder als
  // eigene Bilder merken.
  const umbenannt = new Map()
  const anhaenge = dok && typeof dok.anhaenge === 'object' && dok.anhaenge ? dok.anhaenge : {}
  for (const [alt, daten] of Object.entries(anhaenge)) {
    if (typeof daten !== 'string' || !daten.startsWith('data:image/')) continue
    try {
      if (zustand.lage.box && zustand.lage.angemeldet) {
        const blob = await (await fetch(daten)).blob()
        const { name } = await box.bildHochladen(blob)
        umbenannt.set(alt, name)
        zustand.bilder = [name, ...zustand.bilder.filter((n) => n !== name)]
      } else {
        zustand.eigeneBilder.set(alt, daten)
      }
    } catch (f) {
      melden(`Bild aus der Datei nicht übernommen: ${f.message}`, 'schlecht')
    }
  }
  const alt = bloecke.hintergrund?.bild
  if (alt && umbenannt.has(alt)) bloecke = { ...bloecke, hintergrund: { ...bloecke.hintergrund, bild: umbenannt.get(alt) } }
  hintergruendeBauen()
  entwurfSetzen(bloecke, befund.name || zustand.name)
  if (befund.ok) melden(`„${befund.name}" geladen.`, 'gut')
  else melden(`Geladen, aber ${befund.fehler.length} Angabe(n) übersprungen: ${befund.fehler.join(' · ')}`, 'schlecht')
}

async function abgelegtesLaden(name) {
  try {
    const dok = await box.holen(name)
    await themaLaden(JSON.stringify(dok))
  } catch (f) {
    melden(f.message || String(f), 'schlecht')
  }
}

async function standNeu() {
  zustand.lage = await verbinden()
  if (zustand.blatt === 'themen') blattZeichnen()
}

// ═══════════════════════════════════════════════════════════════════════════
//  Start
// ═══════════════════════════════════════════════════════════════════════════

/** Die Farben der Saetze aus dem Stilblatt der Box — dort werden sie erzeugt. */
async function satzFarbenLesen() {
  try {
    const css = await (await fetch('../app.css')).text()
    for (const s of FARB_SAETZE) {
      const m = new RegExp(`(^|\\n)\\[data-farbe='${s.id}'\\] \\{([^}]*)\\}`).exec(css)
      if (!m) continue
      const v = (n) => new RegExp(`--${n}:\\s*([^;]+);`).exec(m[2])?.[1]?.trim()
      zustand.satzFarben[s.id] = { bg: v('bg'), ink: v('ink'), pill: v('pill') }
    }
  } catch {
    /* ohne Farben: die Kacheln zeigen grau — die Wahl geht trotzdem */
  }
}

async function start() {
  einpassen()
  window.addEventListener('resize', einpassen)
  new ResizeObserver(einpassen).observe($('schirm').parentElement)

  const [lage] = await Promise.all([verbinden(), satzFarbenLesen()])
  zustand.lage = lage
  document.body.classList.toggle('ohne-box', !lage.box || !lage.angemeldet)
  const lageEl = $('lage')
  if (lage.box && lage.angemeldet) {
    lageEl.textContent = lage.stand?.profil ? `mit der Box verbunden · Profil „${lage.stand.profil}"` : 'mit der Box verbunden'
    lageEl.className = 'lage gut'
    try {
      zustand.bilder = (await box.bilder()).namen || []
    } catch {
      /* keine Bilder */
    }
    // Der Start: der jetzige Stand der Box als Bloecke. So zeigt die Vorschau
    // anfangs genau das Geraet, und jede Aenderung ist sichtbar eine.
    if (lage.stand?.aktuell) zustand.bloecke = aufraeumen(zuBloecken(lage.stand.aktuell))
    if (lage.stand?.aktiv) {
      zustand.name = `${lage.stand.aktiv} (angepasst)`.slice(0, 60)
      $('name').value = zustand.name
    }
  } else if (lage.box) {
    lageEl.textContent = 'Box gefunden, aber nicht angemeldet — nur Datei'
    lageEl.className = 'lage schlecht'
  } else {
    lageEl.textContent = istDesktop() ? 'ohne Box (Desktop) — gestalten und als Datei speichern' : 'ohne Box — nur Datei'
    lageEl.className = 'lage schlecht'
  }

  paletteBauen()
  dateiAblageVerdrahten()

  $('name').addEventListener('input', () => {
    zustand.name = $('name').value.trim().slice(0, 60) || 'Mein Thema'
  })
  $('rueck').addEventListener('click', rueckgaengig)
  $('vor').addEventListener('click', wiederholen)
  $('speichern').addEventListener('click', speichern)
  $('oeffnen').addEventListener('click', async () => themaLaden(await dateiOeffnen()))
  $('anwenden').addEventListener('click', anwenden)
  $('ablegen').addEventListener('click', ablegenAufBox)
  for (const b of document.querySelectorAll('[data-ansicht]')) b.addEventListener('click', () => ansichtSetzen(b.dataset.ansicht))
  for (const b of document.querySelectorAll('[data-blatt]')) b.addEventListener('click', () => blattWechseln(b.dataset.blatt))
  $('muster').addEventListener('change', musterSenden)
  $('stellen').addEventListener('change', () => document.body.classList.toggle('ohne-stellen', !$('stellen').checked))

  window.addEventListener('keydown', (ev) => {
    const imFeld = ev.target instanceof HTMLElement && ev.target.closest('input, select, textarea')
    const strg = ev.ctrlKey || ev.metaKey
    if (strg && ev.key.toLowerCase() === 'z' && !imFeld) {
      ev.preventDefault()
      if (ev.shiftKey) wiederholen()
      else rueckgaengig()
    } else if (strg && ev.key.toLowerCase() === 'y' && !imFeld) {
      ev.preventDefault()
      wiederholen()
    } else if ((ev.key === 'Delete' || ev.key === 'Backspace') && !imFeld && zustand.auswahl) {
      const e = ELEMENTE.find((x) => x.id === zustand.auswahl)
      if (e && !e.fest) {
        ev.preventDefault()
        aendern((b) => e.entfernen(b))
      }
    } else if (ev.key === 'Escape' && zug) {
      ziehAbbruch()
    }
  })

  nachAenderung()
  // Die Box bewegt sich auch von selbst (Kissen faehrt ein, ein Stueck endet)
  // — die Marken ziehen im Sekundentakt nach, solange niemand zieht.
  setInterval(() => {
    if (!zug) deckZeichnen()
  }, 1000)
  // Der Rahmen kann schon „bereit" gesagt haben, bevor dieser Hoerer stand.
  vorschau().addEventListener('load', () => setTimeout(() => {
    entwurfSenden(true)
    musterSenden()
  }, 300))
  entwurfSenden(true)
  musterSenden()
}

void start()
