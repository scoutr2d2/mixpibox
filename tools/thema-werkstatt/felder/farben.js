/**
 * TAFEL „FARBEN" — die vierzehn Farben der neuen Oberflaeche.
 *
 * ══ WAS HIER NICHT STEHT ═══════════════════════════════════════════════════
 *
 * Keine Farbnamen, keine Vorgabewerte, keine Gruppen, keine Kontrastformel.
 * Alles davon kommt ueber `welt.kunde()` vom Server und stammt dort aus
 * `thema-felder.ts` und `farben.ts` — denselben Modulen, die auch die
 * Verwaltungsseite einbindet. Diese Datei ist reine Bedienung.
 *
 * Das ist die Probe aufs Exempel fuer den Umzug in den Tab „Darstellung": Was
 * hier steht, ist genau das, was dort in Angular neu entstehen muss — und
 * genau das, was dabei KEINE Entscheidung mit sich traegt.
 *
 * ══ DER UNTERSCHIED, UM DEN ES GEHT ════════════════════════════════════════
 *
 * „gesetzt" gegen „wirkt". Ein Thema ist kein vollstaendiges Farbbuch: Es sagt
 * ueber manche Farben etwas und ueber die uebrigen nichts, und dann scheint
 * app.css durch. Beide sehen im Feld gleich aus — deshalb traegt jede Zeile
 * eine Marke, und „zurücknehmen" heisst wirklich zuruecknehmen (die Farbe
 * faellt aus dem Thema heraus) und nicht „auf den Vorgabewert stellen".
 *
 * Wer das verwechselt, baut Themen, die sechzehn Farben festschreiben, und
 * merkt beim naechsten Anstrich von app.css nichts mehr davon.
 */

/** Die Kontrastformel steht NICHT hier — das ist der Server (farben.ts). */
let welt = null
let wurzel = null

const el = (art, klasse, text) => {
  const e = document.createElement(art)
  if (klasse) e.className = klasse
  if (text !== undefined) e.textContent = text
  return e
}

const HEX = /^#[0-9A-Fa-f]{6}$/

/**
 * Kontrast nach WCAG 2.1 — dieselbe Formel wie `farben.ts` und
 * `tools/kontrast.mjs`.
 *
 * DASS SIE HIER NOCH EINMAL STEHT, IST KEINE ZWEITE WAHRHEIT: Es ist eine
 * FORMEL aus einer veroeffentlichten Norm, kein Wert, der auseinanderlaufen
 * koennte — dieselbe Ueberlegung, die in `farben.ts` schon aufgeschrieben ist.
 * Sie hier zu rechnen erspart bei jedem Reglerzug einen Weg zum Server; bei
 * einem Farbwaehler, an dem man zieht, ist das der Unterschied zwischen „folgt
 * der Hand" und „ruckelt".
 */
function kontrast(vg, hg) {
  const teile = (h) => {
    if (!HEX.test(h || '')) return null
    return [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255)
  }
  const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const A = teile(vg)
  const B = teile(hg)
  if (!A || !B) return 0
  const l = (p) => 0.2126 * linear(p[0]) + 0.7152 * linear(p[1]) + 0.0722 * linear(p[2])
  const x = l(A)
  const y = l(B)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** Die Zeilen, damit `auffrischen()` sie wiederfindet. */
const zeilen = new Map()

function zeileBauen(feld) {
  const z = el('div', 'zeile')

  const feldFarbe = el('input')
  feldFarbe.type = 'color'
  feldFarbe.title = feld.v

  const benennung = el('div', 'benennung')
  benennung.append(el('b', null, feld.name), el('small', null, feld.wozu), el('code', null, feld.v))

  const hex = el('input', 'hex')
  hex.type = 'text'
  hex.spellcheck = false
  hex.setAttribute('aria-label', `${feld.name} als Hex-Wert`)

  const marke = el('span', 'marke')

  const zurueck = el('button', 'zuruecknehmen', 'zurücknehmen')
  zurueck.title = 'Die Farbe aus dem Thema herausnehmen — dann scheint app.css durch'

  z.append(feldFarbe, benennung, hex, marke, zurueck)

  const setzen = (wert) => welt.setzen(feld.v, wert)
  feldFarbe.oninput = () => setzen(feldFarbe.value)
  hex.onchange = () => {
    const w = hex.value.trim()
    if (!HEX.test(w)) {
      hex.classList.add('falsch')
      return
    }
    hex.classList.remove('falsch')
    setzen(w)
  }
  zurueck.onclick = () => setzen(null)

  zeilen.set(feld.v, { z, feldFarbe, hex, marke, zurueck })
  return z
}

/** Jede Zeile auf den Stand des Entwurfs bringen. */
function auffrischen() {
  const gesetzt = welt.gesetzt()
  const wirkung = welt.wirkung()
  for (const [v, t] of zeilen) {
    const wert = wirkung[v] || '#000000'
    t.feldFarbe.value = HEX.test(wert) ? wert : '#000000'
    // DEM SCHREIBENDEN NICHT INS FELD GREIFEN. `auffrischen()` laeuft nach
    // JEDER Aenderung, auch nach der aus diesem Feld. Wer den Wert des gerade
    // benutzten Eingabefeldes ueberschreibt, setzt dabei die Schreibmarke ans
    // Ende und macht das Tippen einer Farbe von hinten nach vorn unmoeglich.
    if (document.activeElement !== t.hex) {
      t.hex.value = wert.toUpperCase()
      t.hex.classList.remove('falsch')
    }
    const an = Object.hasOwn(gesetzt, v)
    t.marke.textContent = an ? 'im Thema' : 'aus app.css'
    t.marke.classList.toggle('an', an)
    t.zurueck.disabled = !an
  }
  kontrasteAuffrischen()
}

/** Die Kontrastpaare, die der Server nennt (SCHRIFTPAARE aus farben.ts). */
let kontrastBereich = null
function kontrasteAuffrischen() {
  if (!kontrastBereich) return
  const w = welt.wirkung()
  kontrastBereich.textContent = ''
  for (const paar of welt.kunde().schriftpaare || []) {
    // AUCH DIE BESCHRIFTUNG KOMMT VON DRUEBEN. `SCHRIFTPAARE` traegt ein `wo`
    // („auf den Flächen (Seitenleiste, Karten, PIN-Tasten)"), und das sagt mehr
    // als zwei Variablennamen nebeneinander. Sich hier einen eigenen Text
    // auszudenken hiesse, dieselbe Auskunft ein zweites Mal zu formulieren.
    const wert = kontrast(w[paar.vg], w[paar.hg])
    if (!wert) continue
    // 4.5 ist die Schwelle fuer Fliesstext (WCAG AA), 3 die fuer grosse
    // Schrift und Bedienelemente. VERBOTEN WIRD NICHTS — das gehoert dem
    // Betreiber. Die Zahl steht daneben.
    const art = wert >= 4.5 ? 'gut' : wert >= 3 ? 'knapp' : 'schlecht'
    const s = el('span', `kontrast ${art}`, `Schrift ${paar.wo}: ${wert.toFixed(1)}:1`)
    s.title =
      art === 'gut'
        ? 'reicht auch für Fließtext'
        : art === 'knapp'
          ? 'reicht für große Schrift, nicht für Fließtext'
          : 'zu wenig'
    kontrastBereich.appendChild(s)
  }
}

export const tafel = {
  id: 'farben',
  titel: 'Farben',
  auffrischen,

  async bauen(w, welten) {
    wurzel = w
    welt = welten
    const kunde = welt.kunde()

    for (const gruppe of kunde.gruppen) {
      const felder = kunde.felder.filter((f) => f.gruppe === gruppe.id)
      if (!felder.length) continue
      const kasten = el('div', 'gruppe')
      kasten.append(el('h2', null, gruppe.name), el('p', 'wozu', gruppe.wozu))
      for (const f of felder) kasten.appendChild(zeileBauen(f))
      wurzel.appendChild(kasten)
    }

    const kk = el('div', 'gruppe')
    kk.append(
      el('h2', null, 'Lesbarkeit'),
      el(
        'p',
        'wozu',
        'Kontrast nach WCAG 2.1. Verboten wird nichts — die Zahl steht daneben, damit die Entscheidung eine bewusste ist.',
      ),
    )
    kontrastBereich = el('div', 'kontraste')
    kk.appendChild(kontrastBereich)
    wurzel.appendChild(kk)

    auffrischen()
  },
}
