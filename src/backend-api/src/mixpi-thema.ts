/**
 * DAS BLOECKE-FORMAT `mixpi-thema/1` — Uebersetzer und Pruefer.
 *
 * ══ WOFUER (E119, Betreiber 05.09.2026) ═════════════════════════════════════
 * „vielleicht kann man Bloecke machen: player gross klein mittel, bar,
 * kacheln — im Prinzip haben wir es ja schon, nur eben klar und einfach
 * strukturiert" — und tauschbar: gestalten, als Datei herunterladen,
 * woanders hochladen.
 *
 * ══ DAS PRINZIP: AUSSENHAUT, KEIN UMBAU ═════════════════════════════════════
 * Die ~40 FLACHEN Felder in darstellung.json und `anwenden()` im NewDesign
 * sind erprobt und bleiben UNANGETASTET — samt Merge-Vertrag von
 * PUT /api/darstellung (Weglassen schaltet nichts ab; nur ausdruecklich
 * gesetzte Werte wirken). Dieses Modul ist die lesbare Aussenhaut darueber:
 *
 *     vonBloecken(bloecke)  ->  flache Felder   (Import, Themen anwenden)
 *     zuBloecken(flach)     ->  Bloecke         (Export, Anzeige)
 *     pruefeThema(dokument) ->  { ok, fehler[], bloecke }   (Upload-Wache)
 *
 * Ein Thema bleibt eine TEILMENGE (wie themen.ts seit je): ein Block, der
 * fehlt, sagt nichts. INNERHALB eines genannten Blocks werden beim
 * Uebersetzen alle Felder ausdruecklich gesetzt, die der Block traegt —
 * der Merge-Vertrag verlangt genau das.
 *
 * ══ WAS V1 ANNIMMT — UND WAS ANGEKUENDIGT IST ═══════════════════════════════
 * Die Whitelist unten fuehrt NUR Felder, die heute wirken (anwenden() liest
 * sie). Angekuendigte Achsen stehen als Kommentar daneben und werden mit
 * KLAREM WORT abgelehnt statt still geschluckt:
 *   * leiste.platz 'oben' und leiste.schublade — die Leiste ist fest links,
 *     die Schublade bewusst hart an (app.js:~30026: ein stilles Backend
 *     darf die Apps nicht verschwinden lassen);
 *   * farben.ton / farben.werte (gerechnete Palette -> /farben.css) und die
 *     Uebernahme-Felder aus dem Alten (endeZeit, schlummer, beimVerlassen,
 *     lautKnoepfe, ...) kommen mit E120/E121 — Whitelist, Uebersetzer und
 *     WIRKUNG wachsen dort gemeinsam, damit nie ein Feld existiert, das
 *     nichts tut.
 *
 * ══ ZWEI BEWUSSTE UMBENENNUNGEN im Format ═══════════════════════════════════
 *   * `kissen.streifen` uebersetzt das flache `statusLeiste` — der Name war
 *     eine dokumentierte Kollision (themen.ts meinte die Kopfzeile, das
 *     NewDesign den Fortschrittsstreifen des Kissens; app.js:8039–8054).
 *   * `reihen.albumTipp: 'spielt'|'lanes'` uebersetzt das flache
 *     `albumTippSpielt: true|false` — eine WAHL statt eines Schalters,
 *     damit E121 die dritte Antwort 'karte' (Flip-Ueberblendkarte)
 *     anbauen kann, ohne das Format zu brechen.
 *
 * REIN: nur Daten und Funktionen darauf, kein Dateizugriff, kein Netz —
 * dasselbe Muster wie themen.ts, und von dort wird es auch importiert.
 */

export const FORMAT_KENNUNG = 'mixpi-thema/1'

/** #RRGGBB, nur die lange Form — wie farbthema.ts und kachelRandFarbe. */
const FARBE = /^#[0-9a-fA-F]{6}$/

/** Ein Zahlfeld mit Klemme — dieselben Grenzen, die anwenden() anlegt. */
type Zahl = { art: 'zahl'; min: number; max: number }
/** Eine Wahl aus festen Worten. */
type Wahl = { art: 'wahl'; werte: readonly string[] }
type Schalter = { art: 'schalter' }
type Farbe = { art: 'farbe' }
type Feldart = Zahl | Wahl | Schalter | Farbe

const zahl = (min: number, max: number): Zahl => ({ art: 'zahl', min, max })
const wahl = (...werte: string[]): Wahl => ({ art: 'wahl', werte })
const schalter: Schalter = { art: 'schalter' }
const farbe: Farbe = { art: 'farbe' }

/**
 * DIE WHITELIST — je Block: Formatfeld -> { flach, art }.
 *
 * `flach` ist der Name im heutigen darstellung.json (Punkt = verschachtelt,
 * heute nur `skalen.*`). Wer hier ein Feld ergaenzt, ergaenzt seine WIRKUNG
 * in NewDesign/app.js `anwenden()` im selben Zug — die Wache
 * (mixpi-thema.spec.ts) haelt beide Listen gegeneinander.
 */
export const BLOECKE: Record<string, Record<string, { flach: string; art: Feldart }>> = {
  farben: {
    // Der gerechnete Farbsatz des NewDesign (FARB_SAETZE in app.js). Der
    // Server prueft wie /api/profil/aussehen nur die FORM — welche Saetze es
    // gibt, weiss das Stilblatt. 'ton'/'werte' kommen mit E120.
    satz: { flach: 'farbe', art: { art: 'wahl', werte: [] } },
  },
  licht: {
    // Kein Unterobjekt — der Block IST der Wert ('hell'|'dunkel').
    // Sonderfall, wird in den Funktionen direkt behandelt.
  },
  kacheln: {
    form: { flach: 'kachelForm', art: wahl('rund', 'abgerundet', 'eckig') },
    randAn: { flach: 'kachelRand', art: schalter },
    randFarbe: { flach: 'kachelRandFarbe', art: farbe },
    randBreite: { flach: 'kachelRandBreite', art: zahl(1, 24) },
    groesse: { flach: 'bilder', art: zahl(0.5, 3) },
    abstand: { flach: 'abstandAlben', art: zahl(0, 96) },
    namen: { flach: 'bezeichnung', art: schalter },
    namenGroesse: { flach: 'skalen.titel', art: zahl(0.5, 3) },
    // E121/4c (Alt: abstandBez): Luft zwischen Bild und Name, in px.
    namenAbstand: { flach: 'namenAbstand', art: zahl(-12, 60) },
  },
  reihen: {
    groesse: { flach: 'reihenFaktor', art: zahl(0.8, 2) },
    albumTipp: { flach: 'albumTipp', art: wahl('spielt', 'lanes', 'karte') },
    diskografie: { flach: 'diskografie', art: schalter },
  },
  kissen: {
    stufe: { flach: 'miniPlayer', art: wahl('voll', 'micro', 'aus') },
    groesse: { flach: 'miniPlayer', art: zahl(0.5, 3) },
    breite: { flach: 'mpBreite', art: zahl(0.3, 1) },
    hoehe: { flach: 'mpHoehe', art: zahl(0.5, 3) },
    tasten: { flach: 'tasten', art: zahl(0.5, 3) },
    glas: { flach: 'mpGlas', art: schalter },
    titel: { flach: 'spielTitel', art: schalter },
    album: { flach: 'spielAlbum', art: schalter },
    streifen: { flach: 'statusLeiste', art: schalter },
    // E121/4a+4c — Uebernahmen (ALT-UEBERNAHMEN.md): endet-um im Streifen,
    // Streifenlaenge getrennt von der Kissenbreite.
    endeZeit: { flach: 'endeZeit', art: schalter },
    streifenLaenge: { flach: 'streifenLaenge', art: zahl(0.3, 1) },
  },
  player: {
    cover: { flach: 'skalen.cover', art: zahl(0.5, 3) },
    akzent: { flach: 'playerAkzent', art: wahl('bernstein', 'koralle', 'gruen', 'blau') },
    glas: { flach: 'grossGlas', art: schalter },
    wellenAn: { flach: 'statusWellen', art: schalter },
    /**
     * E129: WER auf der Buehne ueber den Tasten steht.
     *
     * Betreiber 05.09.2026: „also man kann umschalten welle oder songtext
     * oooder,,, oder ,,," — die Wahl ist deshalb bewusst als LISTE angelegt
     * und nicht als Schalter. Ein weiterer Bewohner ist hier ein Wort und in
     * NewDesign/app.js ein Eintrag in BUEHNE_BEWOHNER.
     *
     * 'aus' ist der Stand vor E129 und bleibt die Vorgabe: kein Platz ueber
     * den Tasten. Alles andere haelt den Platz DAUERHAFT — auch wenn der
     * Bewohner gerade nichts zeigt.
     */
    buehne: { flach: 'buehne', art: wahl('aus', 'wellen', 'songtext', 'titel') },
    wellenHoehe: { flach: 'wellenHub', art: zahl(1, 3) },
    wellenTempo: { flach: 'wellenTempo', art: zahl(1, 3) },
    wellenRegenbogen: { flach: 'wellenRegenbogen', art: schalter },
    fortschrittForm: {
      flach: 'fortschrittForm',
      art: wahl('aus', 'einhorn', 'auto', 'bagger', 'fussball', 'bonbon', 'bild'),
    },
    fortschrittPunkt: {
      flach: 'fortschrittPunkt',
      art: wahl('aus', 'akzent', 'bernstein', 'koralle', 'gruen', 'blau', 'pink', 'lila', 'weiss'),
    },
  },
  kopf: {
    uhr: { flach: 'uhrzeit', art: schalter },
    restzeit: { flach: 'restzeit', art: schalter },
    akku: { flach: 'stAkku', art: schalter },
    lautstaerke: { flach: 'stLautstaerke', art: schalter },
    internet: { flach: 'stInternet', art: schalter },
    wlan: { flach: 'stWlan', art: schalter },
    bluetooth: { flach: 'stBluetooth', art: schalter },
    // E121/4a+4c — Schlummer-Rest, Titel-Rest, Kopfhoerer-Akku.
    schlummer: { flach: 'schlummer', art: schalter },
    titelRest: { flach: 'titelRest', art: schalter },
    btAkku: { flach: 'btAkku', art: wahl('aus', 'prozent') },
  },
  verhalten: {
    blaettern: { flach: 'vollbildBlaettern', art: schalter },
    platzBeimBlaettern: { flach: 'platzBeimBlaettern', art: schalter },
    ruhigeMarke: { flach: 'ruhigeMarke', art: schalter },
    // E121/4b (ALT-UEBERNAHMEN.md): Album verlassen = Schluss (Ur-MuPiBox)
    // und die Kategorie, mit der die Box aufwacht.
    beimVerlassen: { flach: 'beimVerlassen', art: wahl('weiter', 'stopp') },
    startKategorie: { flach: 'startKategorie', art: wahl('alle', 'audiobook', 'music', 'other') },
  },
  leiste: {
    // E121/4b: EIN durchschaltender Kategorie-Knopf fuer Kinder, die nicht
    // lesen (Alt: kategorien 'einer'). Der flache Name `kategorien` traegt
    // in BESTANDSDATEIEN noch tote Alt-Werte ('reihe'/'aus') — anwenden()
    // behandelt alles ausser 'einer' als 'liste'. platz/schublade bleiben
    // angekuendigte Achsen (siehe ANGEKUENDIGT).
    kategorien: { flach: 'kategorien', art: wahl('liste', 'einer') },
  },
}

/** Angekuendigt, aber in v1 NICHT annehmbar — je Feld der Grund. */
// player.lautKnoepfe aus der Uebernahme-Liste ist BEWUSST KEIN Feld
// geworden: der grosse Player traegt die beiden Knoepfe (gr-leiser,
// gr-lauter) seit je — ein Schalter ohne Unterschied waere eine Attrappe.
export const ANGEKUENDIGT: Record<string, string> = {
  'kopf.btAkku=balken': 'die Balken-Zeichnung des Kopfhoerer-Akkus kommt spaeter (E121-Rest); prozent wirkt schon',
  'leiste.platz': "die Leiste ist heute fest links; 'oben' ist eine geplante Achse (BACKLOG E119ff)",
  'leiste.schublade': 'die Schublade ist bewusst hart an (app.js: ein stilles Backend darf die Apps nicht verstecken)',
  'farben.ton': 'gerechnete Paletten kommen mit E120 (Classic + Tauschen)',
  'farben.werte': 'gerechnete Paletten kommen mit E120 (Classic + Tauschen)',
}

/** Einen Wert gegen seine Feldart halten. Gibt den GEKLEMMTEN Wert oder undefined. */
function pruefeWert(wert: unknown, art: Feldart): unknown {
  switch (art.art) {
    case 'schalter':
      return typeof wert === 'boolean' ? wert : undefined
    case 'farbe':
      return typeof wert === 'string' && FARBE.test(wert) ? wert.toUpperCase() : undefined
    case 'wahl':
      if (art.werte.length === 0) {
        // Formpruefung wie /api/profil/aussehen: kurzer Bezeichner.
        return typeof wert === 'string' && /^[a-z0-9-]{0,24}$/.test(wert) ? wert : undefined
      }
      return typeof wert === 'string' && art.werte.includes(wert) ? wert : undefined
    case 'zahl': {
      const n = Number(wert)
      if (!Number.isFinite(n)) return undefined
      return Math.min(art.max, Math.max(art.min, n))
    }
  }
}

/** Ein flaches Feld setzen — `skalen.titel` landet verschachtelt. */
function flachSetzen(ziel: Record<string, unknown>, name: string, wert: unknown): void {
  const punkt = name.indexOf('.')
  if (punkt < 0) {
    ziel[name] = wert
    return
  }
  const kopf = name.slice(0, punkt)
  const rest = name.slice(punkt + 1)
  const innen =
    ziel[kopf] && typeof ziel[kopf] === 'object' && !Array.isArray(ziel[kopf])
      ? (ziel[kopf] as Record<string, unknown>)
      : {}
  innen[rest] = wert
  ziel[kopf] = innen
}

/** Ein flaches Feld lesen — Gegenstueck zu flachSetzen. */
function flachLesen(quelle: Readonly<Record<string, unknown>>, name: string): unknown {
  const punkt = name.indexOf('.')
  if (punkt < 0) return quelle[name]
  const innen = quelle[name.slice(0, punkt)]
  if (!innen || typeof innen !== 'object' || Array.isArray(innen)) return undefined
  return (innen as Record<string, unknown>)[name.slice(punkt + 1)]
}

/**
 * Bloecke -> flache Felder.
 *
 * Unbekanntes faellt STILL weg (pruefeThema sagt es vorher laut — diese
 * Funktion ist der Arbeitsgang danach). Die zwei Sonderfaelle:
 *   * `licht` ist direkt der Wert;
 *   * `kissen.stufe`/`kissen.groesse` teilen sich das flache `miniPlayer`
 *     ('aus' -> 0; sonst gilt die groesse, Vorgabe 1) — `kissenMicro`
 *     traegt die micro-Stufe.
 */
export function vonBloecken(bloecke: Readonly<Record<string, unknown>> | null | undefined): Record<string, unknown> {
  const raus: Record<string, unknown> = {}
  if (!bloecke || typeof bloecke !== 'object') return raus

  for (const [blockName, felder] of Object.entries(bloecke)) {
    if (blockName === 'licht') {
      if (felder === 'hell' || felder === 'dunkel') raus.licht = felder
      continue
    }
    const plan = BLOECKE[blockName]
    if (!plan || !felder || typeof felder !== 'object' || Array.isArray(felder)) continue

    if (blockName === 'kissen') {
      const k = felder as Record<string, unknown>
      const stufe = pruefeWert(k.stufe, wahl('voll', 'micro', 'aus'))
      if (stufe === 'aus') {
        raus.miniPlayer = 0
        raus.kissenMicro = false
      } else if (stufe === 'micro' || stufe === 'voll') {
        const g = pruefeWert(k.groesse, zahl(0.5, 3))
        raus.miniPlayer = g === undefined ? 1 : g
        raus.kissenMicro = stufe === 'micro'
      } else if (k.groesse !== undefined) {
        const g = pruefeWert(k.groesse, zahl(0.5, 3))
        if (g !== undefined) raus.miniPlayer = g
      }
    }

    for (const [feldName, wert] of Object.entries(felder as Record<string, unknown>)) {
      if (blockName === 'kissen' && (feldName === 'stufe' || feldName === 'groesse')) continue
      const eintrag = plan[feldName]
      if (!eintrag) continue
      if (blockName === 'reihen' && feldName === 'albumTipp') {
        const w = pruefeWert(wert, eintrag.art)
        if (w !== undefined) {
          // Der string ist die Wahl; der bool bleibt als Bestands-Alias
          // AUSDRUECKLICH mitgeschrieben (Merge-Vertrag: alte Leser und
          // alte Dateien sollen dieselbe Antwort sehen).
          raus.albumTipp = w
          raus.albumTippSpielt = w === 'spielt'
        }
        continue
      }
      const w = pruefeWert(wert, eintrag.art)
      if (w !== undefined) flachSetzen(raus, eintrag.flach, w)
    }
  }
  return raus
}

/**
 * Flache Felder -> Bloecke. Nur Felder, die die Whitelist kennt — der Rest
 * bleibt liegen (Export zeigt die Aussenhaut, nicht jede Altlast).
 */
export function zuBloecken(flach: Readonly<Record<string, unknown>> | null | undefined): Record<string, unknown> {
  const raus: Record<string, Record<string, unknown>> = {}
  if (!flach || typeof flach !== 'object') return {}

  const setzen = (block: string, feld: string, wert: unknown): void => {
    if (wert === undefined) return
    raus[block] = raus[block] || {}
    raus[block][feld] = wert
  }

  for (const [blockName, plan] of Object.entries(BLOECKE)) {
    for (const [feldName, eintrag] of Object.entries(plan)) {
      if (blockName === 'kissen' && (feldName === 'stufe' || feldName === 'groesse')) continue
      if (blockName === 'reihen' && feldName === 'albumTipp') continue
      const roh = flachLesen(flach, eintrag.flach)
      if (roh === undefined) continue
      const w = pruefeWert(roh, eintrag.art)
      if (w !== undefined) setzen(blockName, feldName, w)
    }
  }

  // Die Sonderfaelle in der Rueckrichtung — der string gewinnt vor dem Alias.
  if (flach.albumTipp === 'spielt' || flach.albumTipp === 'lanes' || flach.albumTipp === 'karte')
    setzen('reihen', 'albumTipp', flach.albumTipp)
  else if (flach.albumTippSpielt === true) setzen('reihen', 'albumTipp', 'spielt')
  else if (flach.albumTippSpielt === false) setzen('reihen', 'albumTipp', 'lanes')

  const mp = flach.miniPlayer
  if (mp === 0) setzen('kissen', 'stufe', 'aus')
  else if (mp !== undefined) {
    const g = pruefeWert(mp, zahl(0.5, 3))
    if (g !== undefined) setzen('kissen', 'groesse', g)
    setzen('kissen', 'stufe', flach.kissenMicro === true ? 'micro' : 'voll')
  } else if (flach.kissenMicro === true) setzen('kissen', 'stufe', 'micro')

  const ergebnis: Record<string, unknown> = { ...raus }
  if (flach.licht === 'hell' || flach.licht === 'dunkel') ergebnis.licht = flach.licht
  return ergebnis
}

export interface Pruefbefund {
  ok: boolean
  fehler: string[]
  /** Nur bei ok: die angenommenen Bloecke (geklemmt, bereinigt). */
  bloecke: Record<string, unknown>
  name: string
}

/**
 * Ein hochgeladenes/eingelesenes Dokument pruefen — LAUT, Feld fuer Feld.
 *
 * Anders als vonBloecken (still, fuer eigene Daten) ist das die Wache am
 * Tor: jedes unbekannte oder unpassende Feld bekommt einen Satz, und
 * ANGEKUENDIGTE Felder bekommen ihren eigenen (damit niemand raet, ob er
 * sich vertippt hat oder zu frueh dran ist).
 */
export function pruefeThema(dokument: unknown): Pruefbefund {
  const fehler: string[] = []
  const d = dokument as Record<string, unknown> | null

  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    return { ok: false, fehler: ['kein Objekt — erwartet wird das JSON einer .mixpi-thema-Datei'], bloecke: {}, name: '' }
  }
  if (d.format !== FORMAT_KENNUNG) {
    fehler.push(`format fehlt oder unbekannt — erwartet "${FORMAT_KENNUNG}"`)
  }
  const name = typeof d.name === 'string' ? d.name.trim() : ''
  if (!name || name.length > 60) {
    fehler.push('name fehlt oder ist laenger als 60 Zeichen')
  }
  const bloecke = d.bloecke as Record<string, unknown> | undefined
  if (!bloecke || typeof bloecke !== 'object' || Array.isArray(bloecke)) {
    fehler.push('bloecke fehlt oder ist kein Objekt')
    return { ok: false, fehler, bloecke: {}, name }
  }

  const rein: Record<string, unknown> = {}
  for (const [blockName, felder] of Object.entries(bloecke)) {
    if (blockName === 'licht') {
      if (felder === 'hell' || felder === 'dunkel') rein.licht = felder
      else fehler.push(`licht: "${String(felder)}" — erlaubt sind "hell" und "dunkel"`)
      continue
    }
    const plan = BLOECKE[blockName]
    if (!plan) {
      const grund = ANGEKUENDIGT[`${blockName}.${''}`] || ANGEKUENDIGT[blockName]
      fehler.push(
        grund ? `Block "${blockName}": ${grund}` : `Block "${blockName}" kennt dieses Format nicht`,
      )
      continue
    }
    if (!felder || typeof felder !== 'object' || Array.isArray(felder)) {
      fehler.push(`Block "${blockName}" ist kein Objekt`)
      continue
    }
    const reinerBlock: Record<string, unknown> = {}
    for (const [feldName, wert] of Object.entries(felder as Record<string, unknown>)) {
      const schluessel = `${blockName}.${feldName}`
      const eintrag = plan[feldName]
      if (!eintrag) {
        fehler.push(
          ANGEKUENDIGT[schluessel]
            ? `${schluessel}: ${ANGEKUENDIGT[schluessel]}`
            : `${schluessel}: dieses Feld kennt das Format nicht`,
        )
        continue
      }
      const geprueft = pruefeWert(wert, eintrag.art)
      if (geprueft === undefined) {
        const speziell = blockName === 'reihen' && feldName === 'albumTipp' && wert === 'karte'
        fehler.push(
          speziell
            ? `reihen.albumTipp=karte: ${ANGEKUENDIGT['reihen.albumTipp=karte']}`
            : `${schluessel}: Wert ${JSON.stringify(wert)} passt nicht (${artWort(eintrag.art)})`,
        )
        continue
      }
      reinerBlock[feldName] = geprueft
    }
    if (Object.keys(reinerBlock).length) rein[blockName] = reinerBlock
  }

  return { ok: fehler.length === 0, fehler, bloecke: rein, name }
}

function artWort(art: Feldart): string {
  switch (art.art) {
    case 'schalter':
      return 'erwartet true/false'
    case 'farbe':
      return 'erwartet #RRGGBB'
    case 'zahl':
      return `erwartet eine Zahl ${art.min}..${art.max}`
    case 'wahl':
      return art.werte.length ? `erlaubt: ${art.werte.join(', ')}` : 'erwartet einen kurzen Bezeichner'
  }
}

/** Ein Thema als tauschbares Dokument — das Gegenstueck zu pruefeThema. */
export function alsDokument(name: string, flach: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return { format: FORMAT_KENNUNG, name, bloecke: zuBloecken(flach) }
}
