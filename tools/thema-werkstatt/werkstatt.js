/**
 * DIE SCHALE — Reiter, Entwurf, Vorschau. Sie weiss nichts ueber Farben.
 *
 * ══ DER TAFEL-VERTRAG, und warum er so schmal ist ══════════════════════════
 *
 * Der Auftrag lautete: „die einzelnen Funktionen sollen später auch in den Tab
 * Darstellung wandern können". Eine Tafel ist deshalb ein Modul, das GENAU
 * DREI Dinge kennt — ihren Namen, ein Wurzelelement und die `welt` unten. Sie
 * greift nie auf `document` ausserhalb ihrer Wurzel zu, nie auf eine andere
 * Tafel, und sie kennt den Server nur ueber `welt`.
 *
 * Was beim Umzug in die Verwaltungsseite passiert, ist damit vorgezeichnet:
 *
 *   * Die FACHLICHEN Entscheidungen wandern gar nicht mit — sie stehen schon
 *     in `src/frontend-admin/src/app/thema-felder.ts` und `farben.ts`, und die
 *     Angular-Seite bindet sie als Nachbarmodule ein. Kein Umzug, kein Kopieren.
 *   * Die BEDIENUNG (das Markup einer Tafel) wird dort in Angular neu gebaut.
 *     Das ist unvermeidlich — eine Angular-Komponente ist kein `innerHTML` —
 *     aber es ist auch nur noch Darstellung, ohne eine einzige Entscheidung
 *     darin.
 *   * Die SCHALE hier bleibt zurueck. In der Verwaltung gibt es schon Reiter.
 *
 * Der Vertrag ist absichtlich nicht groesser: Alles, was eine Tafel darueber
 * hinaus kann, muesste beim Umzug nachgebaut werden.
 *
 *     export const tafel = {
 *       id: 'farben',
 *       titel: 'Farben',
 *       async bauen(wurzel, welt) { … }   // einmal beim Oeffnen
 *     }
 */

/** Die einzige Stelle, an der steht, welche Tafeln es gibt. */
const TAFELN = ['./felder/farben.js']

const $ = (s) => document.querySelector(s)
const reiterLeiste = $('#reiter')
const tafelBereich = $('#tafeln')
const themenWahl = $('#thema')
const sichernKnopf = $('#sichern')
const standAnzeige = $('#stand')
const schirm = $('#schirm')

/** Was der Server ueber Felder und Vorgaben sagt. Einmal geholt. */
let kunde = null
/** Der Entwurf: NUR die Farben, die dieses Thema wirklich setzt. */
let entwurf = {}
/** Der zuletzt gesicherte Stand — daran haengt „ungesichert". */
let gesichert = {}
let offenesThema = null

const melden = (text, art = '') => {
  standAnzeige.textContent = text
  standAnzeige.className = `stand ${art}`
}

/**
 * DIE VORSCHAU AUFFRISCHEN, OHNE SIE NEU ZU LADEN.
 *
 * Der Rahmen kommt durch DENSELBEN Server (die Werkstatt reicht alles an die
 * Attrappe durch), ist also gleichen Ursprungs — erst dadurch ist sein
 * Dokument von hier aus erreichbar. Ausgetauscht wird nur die Adresse des
 * Themenblatts; der Browser holt es neu, und die Seite behaelt dabei ihren
 * Zustand: eine geoeffnete Lane bleibt offen, der Mini-Player laeuft weiter.
 *
 * EIN NEULADEN WAERE HIER DER FALSCHE GRIFF: Man will beim Reglerziehen
 * dieselbe Ansicht vergleichen, nicht bei jedem Zug wieder auf der Startseite
 * landen.
 */
let frischZaehler = 0
function vorschauAuffrischen() {
  const dok = schirm.contentDocument
  if (!dok) return
  const blatt = dok.querySelector('link[href^="/active_theme.css"]')
  if (!blatt) return
  blatt.href = `/active_theme.css?v=${++frischZaehler}`
}

/** Den Entwurf zum Server schicken — er beantwortet damit `/active_theme.css`. */
async function entwurfStellen() {
  await fetch('/api/entwurf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ farben: entwurf }),
  })
  vorschauAuffrischen()
  // DIE TAFELN MUESSEN MIT. Ohne diese Zeile folgte zwar die Vorschau, aber
  // die Zeile behauptete weiter „aus app.css" und „zurücknehmen" blieb
  // gesperrt — gemessen am 06.08.2026 im Browser, nachdem die Farbe im
  // Fenster laengst umgesprungen war. Das ist die schlimmere Haelfte eines
  // solchen Fehlers: Die Wirkung stimmt, die AUSKUNFT darueber nicht, und man
  // glaubt der Auskunft.
  tafelnAuffrischen()
  sichernKnopf.disabled = JSON.stringify(entwurf) === JSON.stringify(gesichert)
  melden(sichernKnopf.disabled ? '' : 'ungesichert')
}

/**
 * DIE WELT, die eine Tafel zu sehen bekommt.
 *
 * Bewusst Funktionen und keine Objekte: Eine Tafel soll den Entwurf nicht
 * nebenbei umschreiben koennen, sondern ihn ANSAGEN. Sonst waeren zwei Tafeln,
 * die dieselbe Farbe stellen, voneinander abhaengig, ohne es zu wissen.
 */
const welt = {
  /** Die Auskunft des Servers: Felder, Gruppen, Vorgaben, Verwendungen. */
  kunde: () => kunde,
  /** Was dieses Thema setzt (ohne die Vorgaben). */
  gesetzt: () => ({ ...entwurf }),
  /** Was am Ende herauskommt: Vorgabe, vom Thema ueberschrieben. */
  wirkung: () => ({ ...kunde.vorgaben, ...entwurf }),
  /** Eine Farbe setzen (`null` = das Thema sagt dazu nichts mehr). */
  async setzen(v, wert) {
    if (wert === null || wert === undefined || wert === '') delete entwurf[v]
    else entwurf[v] = String(wert).toUpperCase()
    await entwurfStellen()
  },
  /** Mehrere auf einmal — ein Zug, eine Auffrischung. */
  async setzenViele(paare) {
    for (const [v, wert] of Object.entries(paare)) {
      if (wert === null || wert === undefined || wert === '') delete entwurf[v]
      else entwurf[v] = String(wert).toUpperCase()
    }
    await entwurfStellen()
  },
  melden,
}

/** Die Tafeln, die sich beim Laden gemeldet haben. */
const geladen = []

async function tafelnAufbauen() {
  for (const pfad of TAFELN) {
    const m = await import(pfad)
    const t = m.tafel
    const wurzel = document.createElement('section')
    wurzel.className = 'tafel'
    wurzel.id = `tafel-${t.id}`
    wurzel.setAttribute('role', 'tabpanel')
    tafelBereich.appendChild(wurzel)

    const knopf = document.createElement('button')
    knopf.textContent = t.titel
    knopf.setAttribute('role', 'tab')
    knopf.onclick = () => zeigen(t.id)
    reiterLeiste.appendChild(knopf)

    geladen.push({ t, wurzel, knopf })
    await t.bauen(wurzel, welt)
  }
  if (geladen.length) zeigen(geladen[0].t.id)
  // EIN EINZIGER REITER IST KEINE WAHL: Die Leiste bliebe ein Bedienelement,
  // das nichts tut. Sie erscheint erst ab der zweiten Tafel.
  reiterLeiste.hidden = geladen.length < 2
}

function zeigen(id) {
  for (const g of geladen) {
    const dran = g.t.id === id
    g.wurzel.hidden = !dran
    g.knopf.setAttribute('aria-selected', String(dran))
  }
}

/** Eine Tafel bitten, sich neu zu zeichnen — nach einem Themenwechsel. */
function tafelnAuffrischen() {
  for (const g of geladen) g.t.auffrischen?.()
}

// ── Themenwahl ─────────────────────────────────────────────────────────────
async function themaOeffnen(name) {
  const a = await (await fetch(`/api/thema/${encodeURIComponent(name)}`)).json()
  if (a.ok === false) return melden(a.fehler, 'schlecht')
  offenesThema = name
  entwurf = { ...a.gesetzt }
  gesichert = { ...a.gesetzt }
  await entwurfStellen()
  tafelnAuffrischen()
  const n = Object.keys(a.gesetzt).length
  melden(
    n
      ? `„${name}" setzt ${n} von ${kunde.felder.length} Farben`
      : `„${name}" setzt bisher keine Farbe der neuen Oberfläche`,
  )
}

async function sichern() {
  const a = await (
    await fetch(`/api/thema/${encodeURIComponent(offenesThema)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ farben: entwurf }),
    })
  ).json()
  if (!a.ok) return melden(a.fehler || 'Sichern misslungen', 'schlecht')
  gesichert = { ...entwurf }
  sichernKnopf.disabled = true
  melden(`gesichert in themes/${offenesThema}.css (${a.gesichert} Farben)`, 'gut')
}
// ── Start ──────────────────────────────────────────────────────────────────
;(async () => {
  kunde = await (await fetch('/api/felder')).json()

  // EHRLICHE SELBSTAUSKUNFT BEIM OEFFNEN: Passt die Feldliste nicht mehr zu
  // app.css, steht es oben und nicht in der Konsole. Ein Regler, der nichts
  // faerbt, ist sonst nicht von einem zu unterscheiden, dessen Farbe man nur
  // nirgends sieht.
  if (kunde.unbenutzte?.length || kunde.unbekannte?.length) {
    const p = document.createElement('p')
    p.className = 'meldung'
    const teile = []
    if (kunde.unbenutzte.length)
      teile.push(`ohne Wirkung (in app.css nie mit var() gelesen): ${kunde.unbenutzte.join(', ')}`)
    if (kunde.unbekannte.length) teile.push(`in app.css nicht vorhanden: ${kunde.unbekannte.join(', ')}`)
    p.textContent = `Die Feldliste passt nicht mehr zu NewDesign/app.css — ${teile.join(' · ')}`
    tafelBereich.before(p)
  }

  const liste = await (await fetch('/api/themen')).json()
  for (const n of liste.themen) {
    const o = document.createElement('option')
    o.value = n
    o.textContent = n
    themenWahl.appendChild(o)
  }
  const start = liste.themen.includes(liste.aktiv) ? liste.aktiv : liste.themen[0]
  themenWahl.value = start
  $('#aktivhinweis').textContent = liste.aktiv
    ? `die Box trägt „${liste.aktiv}"`
    : 'in der Konfiguration steht kein Thema'

  await tafelnAufbauen()
  await themaOeffnen(start)

  themenWahl.onchange = async () => {
    if (!sichernKnopf.disabled && !confirm('Ungesicherte Änderungen verwerfen?')) {
      themenWahl.value = offenesThema
      return
    }
    await themaOeffnen(themenWahl.value)
  }
  sichernKnopf.onclick = sichern
  $('#neuladen').onclick = () => {
    schirm.src = `/neu/?frisch=${Date.now()}`
  }

  // DER DUNKLE STAND WIRD NUR ANGESEHEN, NICHT GESTELLT: Das Themenblatt
  // faerbt ausdruecklich nur den hellen (`:root:not([data-licht='dunkel'])`,
  // siehe farbthema.ts). Der Schalter ist deshalb eine GEGENPROBE — er zeigt,
  // was die Box abends zeigt, und dass das Thema dort nichts anrichtet.
  $('#dunkel').onchange = (e) => {
    const dok = schirm.contentDocument
    if (!dok) return
    dok.documentElement.dataset.licht = e.target.checked ? 'dunkel' : ''
  }

  schirm.addEventListener('load', vorschauAuffrischen)
})()
