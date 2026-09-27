/**
 * DER KATALOG DES GESTALTERS — welche Elemente es gibt, wo sie andocken
 * duerfen und wie ihre Regler heissen.
 *
 * ══ WAS HIER STEHT UND WAS NICHT (BACKLOG E144, 27.09.2026) ════════════════
 * WELCHE Felder es gibt und welche Werte gelten, steht NICHT hier, sondern in
 * mixpi-thema.ts (als Abschrift `format.mjs`). Hier steht nur die BEDIENUNG:
 *
 *   ZONEN     Andockstellen auf dem 800x480-Schirm der Box. Sie sind reine
 *             ZIELE fuer das Ziehen — gezeichnet wird die Box von der Box
 *             selbst (die Vorschau ist die echte Oberflaeche im Rahmen).
 *   ELEMENTE  was man ziehen kann: jedes sagt, welche Zonen es annimmt, wie
 *             eine Zone in Formatfelder uebersetzt wird (`setzen`), wo es
 *             gerade steht (`lesen`) und welche Felder sein Eigenschaften-
 *             Blatt zeigt (`felder`). `knoten` ist sein Element in der
 *             Box-Seite: daran misst der Gestalter, wo die Marke hingehoert
 *             (die ECHTE Lage, nicht die Zone).
 *   WORTE     die Beschriftung je Feld.
 *
 * DIE WACHE (tools/gestalter-katalog-deckung.mjs) haelt: jedes Feld des
 * Formats ist hier irgendwo stellbar, und jedes hier genannte Feld gibt es im
 * Format. Ein neues Formatfeld ohne Platz im Gestalter faellt dort auf.
 *
 * REIN: nur Daten und kleine Funktionen auf einem Bloecke-Objekt — kein DOM.
 * Damit laesst sich der Katalog in Node pruefen (die Wache) und im Browser
 * wie in der Desktop-App gleich benutzen.
 */

/** Der Schirm der Box: 5-Zoll-DSI, 800x480 (BACKLOG „800×480"). */
export const SCHIRM = { breite: 800, hoehe: 480 }

/** Breite der Seitenleiste (`.leiste { flex: 0 0 88px }` in app.css). */
const LEISTE = 88
/** Hoehe der Kopfzeile (`--griff: 66px` in app.css). */
const KOPF = 66

/**
 * Die Andockstellen. `ansicht` sagt, auf welcher Seite der Vorschau sie
 * liegen (Startseite oder grosser Player). `gesperrt` = angekuendigt, aber
 * noch ohne Wirkung — sie wird gezeigt, nimmt aber nichts an, damit niemand
 * glaubt, er habe etwas gesetzt.
 */
export const ZONEN = {
  'leiste-links': { x: 0, y: 0, w: LEISTE, h: 480, ansicht: 'start', wort: 'Seitenleiste links' },
  'leiste-rechts': {
    x: 800 - LEISTE,
    y: 0,
    w: LEISTE,
    h: 480,
    ansicht: 'start',
    wort: 'Seitenleiste rechts',
    gesperrt: 'Die Leiste steht heute fest links (angekündigt: leiste.platz).',
  },
  kopf: { x: LEISTE, y: 0, w: 800 - LEISTE, h: KOPF, ansicht: 'start', wort: 'Kopfzeile' },
  'band-oben': { x: LEISTE, y: KOPF, w: 800 - LEISTE, h: 44, ansicht: 'start', wort: 'Band oben' },
  'band-unten': { x: LEISTE, y: 436, w: 800 - LEISTE, h: 44, ansicht: 'start', wort: 'Band unten' },
  'kissen-oben-links': { x: LEISTE, y: KOPF, w: 237, h: 86, ansicht: 'start', wort: 'oben links' },
  'kissen-oben-mitte': { x: LEISTE + 237, y: KOPF, w: 238, h: 86, ansicht: 'start', wort: 'oben Mitte' },
  'kissen-oben-rechts': { x: LEISTE + 475, y: KOPF, w: 237, h: 86, ansicht: 'start', wort: 'oben rechts' },
  'kissen-unten-links': { x: LEISTE, y: 394, w: 237, h: 86, ansicht: 'start', wort: 'unten links' },
  'kissen-unten-mitte': { x: LEISTE + 237, y: 394, w: 238, h: 86, ansicht: 'start', wort: 'unten Mitte' },
  'kissen-unten-rechts': { x: LEISTE + 475, y: 394, w: 237, h: 86, ansicht: 'start', wort: 'unten rechts' },
  'ecke-oben-links': { x: LEISTE, y: KOPF, w: 130, h: 130, ansicht: 'start', wort: 'Ecke oben links' },
  'ecke-oben-rechts': { x: 670, y: KOPF, w: 130, h: 130, ansicht: 'start', wort: 'Ecke oben rechts' },
  'ecke-unten-links': { x: LEISTE, y: 350, w: 130, h: 130, ansicht: 'start', wort: 'Ecke unten links' },
  'ecke-unten-rechts': { x: 670, y: 350, w: 130, h: 130, ansicht: 'start', wort: 'Ecke unten rechts' },
  inhalt: { x: LEISTE, y: 110, w: 800 - LEISTE, h: 284, ansicht: 'start', wort: 'Inhalt (Kacheln)' },
  // Der grosse Player: Bild links, Tasten rechts, die Buehne darueber
  // (E129) — eine Zone genuegt, der Bewohner ist EINE Wahl.
  player: { x: 0, y: 72, w: 800, h: 408, ansicht: 'player', wort: 'Player' },
  buehne: { x: 300, y: 72, w: 500, h: 120, ansicht: 'player', wort: 'Bühne über den Tasten' },
}

/** Kleiner Helfer: ein Feld eines Blocks lesen. */
function feld(b, block, name) {
  const x = b[block]
  return x && typeof x === 'object' ? x[name] : undefined
}

/** Kleiner Helfer: ein Feld eines Blocks setzen (legt den Block an). */
function setze(b, block, name, wert) {
  if (!b[block] || typeof b[block] !== 'object') b[block] = {}
  b[block][name] = wert
}

/** Ein Kopf-Element: an der Kopfzeile = an, weggezogen = aus. */
function kopfElement(name, wort, symbol, an = true, aus = false) {
  return {
    id: `kopf.${name}`,
    wort,
    symbol,
    gruppe: 'kopf',
    ansicht: 'start',
    zonen: ['kopf'],
    lesen: (b) => {
      const w = feld(b, 'kopf', name)
      return w !== undefined && w !== aus ? 'kopf' : null
    },
    setzen: (b) => setze(b, 'kopf', name, an),
    entfernen: (b) => setze(b, 'kopf', name, aus),
    felder: [],
    steuert: [`kopf.${name}`],
  }
}

/** Ein Bewohner der Player-Buehne (E129): genau einer zur Zeit. */
function buehnenElement(wert, wort, symbol) {
  return {
    id: `buehne.${wert}`,
    wort,
    symbol,
    gruppe: 'buehne',
    ansicht: 'player',
    zonen: ['buehne'],
    lesen: (b) => (feld(b, 'player', 'buehne') === wert ? 'buehne' : null),
    setzen: (b) => setze(b, 'player', 'buehne', wert),
    entfernen: (b) => setze(b, 'player', 'buehne', 'aus'),
    felder: wert === 'wellen' ? ['player.wellenHoehe', 'player.wellenTempo', 'player.wellenRegenbogen'] : [],
    steuert: ['player.buehne'],
  }
}

const KISSEN_ZONEN = [
  'kissen-oben-links',
  'kissen-oben-mitte',
  'kissen-oben-rechts',
  'kissen-unten-links',
  'kissen-unten-mitte',
  'kissen-unten-rechts',
]
const ECKEN = ['ecke-oben-links', 'ecke-oben-rechts', 'ecke-unten-links', 'ecke-unten-rechts']

/**
 * DIE ELEMENTE. `gruppe` ordnet die Palette:
 *   andockbar  frei an eine der erlaubten Stellen zu ziehen
 *   kopf       Anzeigen in der Kopfzeile
 *   buehne     Bewohner der Player-Buehne
 *   fest       steht, wo es steht — nur Eigenschaften (`fest: true`)
 * `neu: true` markiert, was es vor dem Gestalter auf dem Schirm nicht gab.
 */
export const ELEMENTE = [
  {
    id: 'kissen',
    wort: 'Mini-Player',
    knoten: '#mp',
    symbol: '▶',
    gruppe: 'andockbar',
    ansicht: 'start',
    zonen: KISSEN_ZONEN,
    lesen: (b) => {
      if (feld(b, 'kissen', 'stufe') === 'aus') return null
      const platz = feld(b, 'kissen', 'platz') === 'oben' ? 'oben' : 'unten'
      const aus = feld(b, 'kissen', 'ausrichtung')
      return `kissen-${platz}-${aus === 'links' || aus === 'mitte' ? aus : 'rechts'}`
    },
    setzen: (b, zone) => {
      const [, platz, ausrichtung] = zone.split('-')
      setze(b, 'kissen', 'platz', platz)
      setze(b, 'kissen', 'ausrichtung', ausrichtung)
      if (feld(b, 'kissen', 'stufe') === 'aus' || feld(b, 'kissen', 'stufe') === undefined) setze(b, 'kissen', 'stufe', 'voll')
    },
    entfernen: (b) => setze(b, 'kissen', 'stufe', 'aus'),
    felder: [
      'kissen.stufe',
      'kissen.groesse',
      'kissen.breite',
      'kissen.hoehe',
      'kissen.tasten',
      'kissen.glas',
      'kissen.titel',
      'kissen.album',
      'kissen.streifen',
      'kissen.streifenLaenge',
      'kissen.endeZeit',
    ],
    steuert: ['kissen.platz', 'kissen.ausrichtung', 'kissen.stufe'],
  },
  {
    id: 'titelband',
    wort: 'Titelband',
    knoten: '#titelband',
    symbol: '▬',
    gruppe: 'andockbar',
    neu: true,
    ansicht: 'start',
    zonen: ['band-oben', 'band-unten'],
    lesen: (b) =>
      feld(b, 'titelband', 'an') === true ? (feld(b, 'titelband', 'platz') === 'unten' ? 'band-unten' : 'band-oben') : null,
    setzen: (b, zone) => {
      setze(b, 'titelband', 'an', true)
      setze(b, 'titelband', 'platz', zone === 'band-unten' ? 'unten' : 'oben')
      if (feld(b, 'titelband', 'inhalt') === undefined) setze(b, 'titelband', 'inhalt', 'beides')
      if (feld(b, 'titelband', 'text') === undefined) setze(b, 'titelband', 'text', 'Meine MixPiBox')
    },
    entfernen: (b) => setze(b, 'titelband', 'an', false),
    felder: ['titelband.inhalt', 'titelband.text', 'titelband.groesse'],
    steuert: ['titelband.an', 'titelband.platz'],
  },
  {
    id: 'maskottchen',
    wort: 'Maskottchen',
    knoten: '#maskottchen',
    symbol: '☺',
    gruppe: 'andockbar',
    neu: true,
    ansicht: 'start',
    zonen: ECKEN,
    lesen: (b) => (feld(b, 'maskottchen', 'an') === true ? `ecke-${feld(b, 'maskottchen', 'ecke') || 'unten-rechts'}` : null),
    setzen: (b, zone) => {
      setze(b, 'maskottchen', 'an', true)
      setze(b, 'maskottchen', 'ecke', zone.replace(/^ecke-/, ''))
    },
    entfernen: (b) => setze(b, 'maskottchen', 'an', false),
    felder: ['maskottchen.groesse', 'maskottchen.lebendig'],
    steuert: ['maskottchen.an', 'maskottchen.ecke'],
  },
  kopfElement('uhr', 'Uhr', '🕒'),
  kopfElement('restzeit', 'Restzeit (Kinderzeit)', '⏳'),
  kopfElement('titelRest', 'Rest des Titels', '⏱'),
  kopfElement('schlummer', 'Schlummer-Rest', '☾'),
  kopfElement('akku', 'Akku', '🔋'),
  kopfElement('lautstaerke', 'Lautstärke', '🔊'),
  kopfElement('internet', 'Internet', '🌐'),
  kopfElement('wlan', 'WLAN', '📶'),
  kopfElement('bluetooth', 'Bluetooth', 'ᛒ'),
  kopfElement('btAkku', 'Kopfhörer-Akku', '🎧', 'prozent', 'aus'),
  buehnenElement('wellen', 'Wellen', '〰'),
  buehnenElement('songtext', 'Songtext', '♪'),
  buehnenElement('titel', 'Titel groß', 'T'),
  {
    id: 'leiste',
    wort: 'Seitenleiste',
    knoten: '#leiste',
    symbol: '▮',
    gruppe: 'fest',
    fest: true,
    ansicht: 'start',
    zonen: ['leiste-links', 'leiste-rechts'],
    lesen: () => 'leiste-links',
    setzen: () => {},
    entfernen: () => {},
    felder: ['leiste.kategorien', 'verhalten.startKategorie'],
    steuert: [],
  },
  {
    id: 'raster',
    wort: 'Kacheln & Reihen',
    knoten: '#buehne',
    symbol: '▦',
    gruppe: 'fest',
    fest: true,
    ansicht: 'start',
    zonen: ['inhalt'],
    lesen: () => 'inhalt',
    setzen: () => {},
    entfernen: () => {},
    felder: [
      'kacheln.form',
      'kacheln.groesse',
      'kacheln.abstand',
      'kacheln.randAn',
      'kacheln.randFarbe',
      'kacheln.randBreite',
      'kacheln.namen',
      'kacheln.namenGroesse',
      'kacheln.namenAbstand',
      'reihen.groesse',
      'reihen.albumTipp',
      'reihen.diskografie',
      'verhalten.blaettern',
      'verhalten.platzBeimBlaettern',
      'verhalten.ruhigeMarke',
      'verhalten.beimVerlassen',
    ],
    steuert: [],
  },
  {
    id: 'player',
    wort: 'Großer Player',
    knoten: '#gross-blatt',
    symbol: '◉',
    gruppe: 'fest',
    fest: true,
    ansicht: 'player',
    zonen: ['player'],
    lesen: () => 'player',
    setzen: () => {},
    entfernen: () => {},
    felder: [
      'player.cover',
      'player.akzent',
      'player.glas',
      'player.wellenAn',
      'player.fortschrittForm',
      'player.fortschrittPunkt',
    ],
    steuert: [],
  },
]

/**
 * FARBEN UND HINTERGRUND sind kein Element mit Platz — sie werden auf Ziele
 * GEZOGEN (Farbfeld -> „Akzent"), und ihr Blatt steht immer offen.
 */
export const FARBZIELE = [
  { id: 'hintergrund', wort: 'Hintergrund', hinweis: 'hinter den Kacheln' },
  { id: 'farben.akzent', wort: 'Akzent', hinweis: 'Knöpfe, Markierungen' },
  { id: 'farben.grund', wort: 'Grundfarbe', hinweis: 'Seiten und Fenster' },
  { id: 'farben.flaeche', wort: 'Fläche', hinweis: 'Leiste, Karten' },
  { id: 'farben.schrift', wort: 'Schrift', hinweis: 'Text' },
  { id: 'kacheln.randFarbe', wort: 'Kachelrand', hinweis: 'Ring um die Cover' },
]

export const FARB_FELDER = [
  'licht',
  'farben.satz',
  'farben.akzent',
  'farben.grund',
  'farben.flaeche',
  'farben.schrift',
  'hintergrund.art',
  'hintergrund.farbe',
  'hintergrund.farbe2',
  'hintergrund.winkel',
  'hintergrund.bild',
  'hintergrund.schleier',
]

/**
 * DIE FARBSAETZE — Kennung und Wort. Die FARBEN selbst liest der Gestalter
 * aus ../app.css (dort erzeugt von tools/farbsaetze-bauen.mjs); die Liste der
 * Kennungen und Worte ist dieselbe wie `FARB_SAETZE` in app.js und wird von
 * der Wache gegen sie gehalten. `superrosa` heisst „Lila" — Begruendung dort.
 */
export const FARB_SAETZE = [
  { id: 'creme', wort: 'Creme' },
  { id: 'blau', wort: 'Blau' },
  { id: 'rot', wort: 'Rot' },
  { id: 'rosa', wort: 'Rosa' },
  { id: 'gruen', wort: 'Grün' },
  { id: 'superrosa', wort: 'Lila' },
  { id: 'pink', wort: 'Pink' },
  { id: 'gelb', wort: 'Gelb' },
  { id: 'orange', wort: 'Orange' },
  { id: 'kittypink', wort: 'Kittypink' },
  { id: 'classic', wort: 'Classic' },
]

/** Vorgeschlagene Verlaeufe fuer den Hintergrund — Ausgangspunkte, keine Regel. */
export const VERLAEUFE = [
  { wort: 'Morgen', farbe: '#FFE9C7', farbe2: '#FFC4D6', winkel: 160 },
  { wort: 'Meer', farbe: '#BDE7FF', farbe2: '#6FB8F0', winkel: 180 },
  { wort: 'Wiese', farbe: '#E3F9C9', farbe2: '#9BDB8C', winkel: 180 },
  { wort: 'Nacht', farbe: '#1B1D3A', farbe2: '#3E2A5C', winkel: 200 },
  { wort: 'Bonbon', farbe: '#FFD1F0', farbe2: '#C9D6FF', winkel: 135 },
]

/** Freie Farben fuer die Farb-Palette zum Ziehen. */
export const PALETTE = [
  '#FF6B57',
  '#FFC145',
  '#3BB273',
  '#3880FF',
  '#8E5CF7',
  '#FF5C85',
  '#2E2A3B',
  '#FFFFFF',
  '#FFF7EC',
  '#121212',
]

/** Die Beschriftung je Feld. Was fehlt, zeigt den Feldnamen (die Wache meldet es). */
export const WORTE = {
  licht: 'Hell oder dunkel',
  'farben.satz': 'Farbsatz',
  'farben.akzent': 'Eigene Akzentfarbe',
  'farben.grund': 'Eigene Grundfarbe',
  'farben.flaeche': 'Eigene Flächenfarbe',
  'farben.schrift': 'Eigene Schriftfarbe',
  'hintergrund.art': 'Hintergrund',
  'hintergrund.farbe': 'Farbe',
  'hintergrund.farbe2': 'zweite Farbe (Verlauf)',
  'hintergrund.winkel': 'Winkel des Verlaufs',
  'hintergrund.bild': 'Bild',
  'hintergrund.schleier': 'Schleier (Lesbarkeit)',
  'kissen.stufe': 'Form',
  'kissen.groesse': 'Größe',
  'kissen.breite': 'Breite',
  'kissen.hoehe': 'Höhe',
  'kissen.tasten': 'Tastengröße',
  'kissen.glas': 'Glas',
  'kissen.titel': 'Titel zeigen',
  'kissen.album': 'Album zeigen',
  'kissen.streifen': 'Fortschrittsstreifen',
  'kissen.streifenLaenge': 'Länge des Streifens',
  'kissen.endeZeit': '„endet um" im Streifen',
  'kissen.platz': 'Platz',
  'kissen.ausrichtung': 'Ausrichtung',
  'titelband.an': 'Titelband zeigen',
  'titelband.platz': 'Platz',
  'titelband.inhalt': 'Inhalt',
  'titelband.text': 'Text',
  'titelband.groesse': 'Schriftgröße',
  'maskottchen.an': 'Maskottchen zeigen',
  'maskottchen.ecke': 'Ecke',
  'maskottchen.groesse': 'Größe',
  'maskottchen.lebendig': 'singt, wenn Musik läuft',
  'kacheln.form': 'Form der Kacheln',
  'kacheln.groesse': 'Kachelgröße',
  'kacheln.abstand': 'Abstand der Alben (px)',
  'kacheln.randAn': 'Rand um die Kacheln',
  'kacheln.randFarbe': 'Farbe des Rands',
  'kacheln.randBreite': 'Breite des Rands (px)',
  'kacheln.namen': 'Namen unter den Kacheln',
  'kacheln.namenGroesse': 'Größe der Namen',
  'kacheln.namenAbstand': 'Luft zwischen Bild und Name (px)',
  'reihen.groesse': 'Größe der Reihen',
  'reihen.albumTipp': 'Tipp auf ein Album',
  'reihen.diskografie': 'Ganze Diskografie',
  'verhalten.blaettern': 'Vollbild-Blättern',
  'verhalten.platzBeimBlaettern': 'Platz beim Blättern',
  'verhalten.ruhigeMarke': 'ruhige „spielt"-Marke',
  'verhalten.beimVerlassen': 'Album verlassen',
  'verhalten.startKategorie': 'Start-Kategorie',
  'leiste.kategorien': 'Kategorien',
  'player.cover': 'Covergröße',
  'player.akzent': 'Akzent des Players',
  'player.glas': 'Glas',
  'player.wellenAn': 'Wellen im Player',
  'player.buehne': 'Bühne',
  'player.wellenHoehe': 'Höhe der Wellen',
  'player.wellenTempo': 'Tempo der Wellen',
  'player.wellenRegenbogen': 'Regenbogen',
  'player.fortschrittForm': 'Form auf dem Fortschritt',
  'player.fortschrittPunkt': 'Punkt auf dem Fortschritt',
  'kopf.uhr': 'Uhr',
  'kopf.restzeit': 'Restzeit',
  'kopf.akku': 'Akku',
  'kopf.lautstaerke': 'Lautstärke',
  'kopf.internet': 'Internet',
  'kopf.wlan': 'WLAN',
  'kopf.bluetooth': 'Bluetooth',
  'kopf.schlummer': 'Schlummer-Rest',
  'kopf.titelRest': 'Rest des Titels',
  'kopf.btAkku': 'Kopfhörer-Akku',
}

/** Worte fuer Wahl-Werte, wo der Wert selbst kein gutes Wort ist. */
export const WAHL_WORTE = {
  voll: 'voll',
  micro: 'nur Bild',
  aus: 'aus',
  spielt: 'spielt sofort',
  lanes: 'zeigt Titel',
  karte: 'Karte',
  weiter: 'spielt weiter',
  stopp: 'hält an',
  alle: 'Alles',
  audiobook: 'Hörbücher',
  music: 'Musik',
  other: 'Sonstiges',
  liste: 'Liste',
  einer: 'ein Knopf',
  text: 'fester Text',
  laufend: 'laufender Titel',
  beides: 'beides',
  thema: 'vom Farbsatz',
  farbe: 'Farbe',
  verlauf: 'Verlauf',
  bild: 'Bild',
  hell: 'hell',
  dunkel: 'dunkel',
  prozent: 'Prozent',
}

/** Alle Felder, die der Gestalter anbietet — als `block.feld` (`licht` ohne Punkt). */
export function angeboteneFelder() {
  const alle = new Set(FARB_FELDER)
  for (const e of ELEMENTE) {
    for (const f of e.felder) alle.add(f)
    for (const f of e.steuert) alle.add(f)
  }
  return [...alle].sort()
}

/** Wo steht ein Element gerade? `null` = nicht auf dem Schirm. */
export function elementPlatz(id, bloecke) {
  const e = ELEMENTE.find((x) => x.id === id)
  return e ? e.lesen(bloecke) : null
}
