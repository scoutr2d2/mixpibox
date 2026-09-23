#!/usr/bin/env node
/**
 * DIE DIENSTLISTE AUS EINER QUELLE — gegen alle, die sie noch einmal fuehren.
 *
 * ── DER BEFUND, DER DIESES WERKZEUG AUSGELOEST HAT (04.08.2026) ────────────
 * Die ARD war im Backend fertig gebaut (`ard.ts`, `/api/ard/suche`, die Verben
 * `ard`/`ardqueue`, `dienstVon` kennt sie) — und trotzdem an FUENF Stellen
 * nicht angekommen. Keine davon hat sich gemeldet: kein Test wurde rot, kein
 * Bau brach, keine Meldung erschien. Die Plakette blieb leer, das Formular
 * fehlte, die klassische Oberflaeche schwieg. Ein Dienst, der an einer Stelle
 * fehlt, sieht ueberall aus wie Absicht.
 *
 * Dieselbe Bauart hat in diesem Projekt schon mehrfach zugeschlagen; das
 * Wissenspaket fuehrt sie unter [[drei-orte-eine-anzeige]],
 * [[spielt-marke-eine-frage-zwei-formen]] und
 * [[darstellung-feld-faellt-still-heraus]].
 *
 * ── WARUM NICHT EINFACH EINE GEMEINSAME DATEI ─────────────────────────────
 * Weil die Verbraucher NICHT DENSELBEN Lader haben. `werke.ts` und
 * `verschmelzung.ts` liegen im selben Modul wie `dienstVon()` und leiten
 * ihre Liste seit dem 04.08.2026 wirklich davon ab (`ReturnType<typeof
 * dienstVon>`) — dort ist die Frage erledigt. Die drei anderen koennen es
 * nicht:
 *
 *   NewDesign/app.js    laeuft ohne Bauschritt im Kiosk-Browser. Es gibt
 *                       keinen Bundler, der ein TypeScript-Modul des Servers
 *                       hineinreichen koennte.
 *   NewDesign/app.css   ist CSS. Eine Farbe je Dienst ist eine Regel, kein
 *                       Datensatz; erzeugen liesse sie sich nur mit einem
 *                       Bauschritt, den diese Oberflaeche bewusst nicht hat.
 *   frontend-admin      ist eine EIGENE Angular-App mit eigenem tsconfig; sie
 *                       importiert bis heute keine einzige Zeile aus
 *                       backend-api (nachgesehen 04.08.2026). Ein Pfad-Alias
 *                       dorthin zoege die Servertypen in den Browser-Bau.
 *
 * Also bleibt die Liste an vier Orten stehen — aber sie darf nicht mehr STILL
 * auseinanderlaufen. Genau das ist die Aufgabe hier: EINE Quelle lesen, alle
 * Verbraucher dagegen halten, rot werden, wenn einer fehlt.
 *
 * ── DIE AUSNAHMEN STEHEN HIER UND NUR HIER ────────────────────────────────
 * Nicht jeder Dienst gehoert zu jedem Verbraucher — `anderes` heisst „wir
 * wissen es nicht" und bekommt mit Absicht kein Zeichen. Solche Auslassungen
 * stehen unten in `AUSNAHMEN`, jede mit einem GRUND. Wer einen Dienst
 * weglassen will, muss ihn dort eintragen; wer ihn vergisst, wird rot. Der
 * Unterschied zwischen „bewusst weggelassen" und „vergessen" ist damit
 * aufgeschrieben statt geraten.
 *
 * ── UND EINE ZWEITE FRAGE DERSELBEN BAUART ────────────────────────────────
 * „Was bleibt ohne Internet stehen?" — die Skripte, die offline_data.json
 * bauen, fuehren keine Liste der Dienste, sondern einen jq-Ausdruck, der
 * einzelne AUSSCHLIESST. Unten in `NETZ` ist jeder Dienst eingeordnet, und
 * beide Skripte werden dagegen gehalten. Der Anlass steht dort.
 *
 * ── WAS ES NICHT TUT ──────────────────────────────────────────────────────
 * Es fasst nichts an, fragt kein Netz und kennt KEINE eigene Dienstliste. Es
 * liest Quelltext. Eine eigene Kopie waere genau der Fehler, den es sucht.
 *
 * AUFRUF
 *   node tools/dienste-deckung.mjs             Tabelle, Ende 0/1
 *   node tools/dienste-deckung.mjs --pruefen   still, Ende 1 bei Befund
 *                                              (haengt in tools/pruefen.sh)
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const p = (...t) => join(WURZEL, ...t)

/**
 * Die eine Quelle: der Rueckgabetyp von `dienstVon()`.
 *
 * NICHT die `return`-Zeilen im Rumpf und nicht beides zusammengeworfen — der
 * Typ ist das, woran die anderen Module haengen. Der Rumpf wird SEPARAT
 * geprueft (siehe `zweigeAus`): ein Name im Typ ohne Zweig im Rumpf wird nie
 * vergeben, ein Zweig ohne Namen im Typ compiliert nicht. Beide Faelle sind
 * echte Fehler, aber verschiedene, und sie duerfen sich nicht gegenseitig
 * zudecken.
 */
function quelleAus(text) {
  const m = /export function dienstVon\([^)]*\):\s*([^{]+)\{/.exec(text)
  if (!m) throw new Error('dienstVon nicht gefunden — heisst die Funktion in medien.ts noch so?')
  const namen = [...m[1].matchAll(/'([a-z]+)'/g)].map((t) => t[1])
  if (!namen.length) throw new Error('Der Rueckgabetyp von dienstVon nennt keine Namen mehr')
  return namen
}

/** Die Namen, die der Rumpf von `dienstVon()` wirklich vergibt. */
function zweigeAus(text) {
  const anfang = text.indexOf('export function dienstVon(')
  const ende = text.indexOf('\n}', anfang)
  const rumpf = text.slice(anfang, ende)
  return [...rumpf.matchAll(/return '([a-z]+)'/g)].map((t) => t[1])
}

/**
 * Das Objektliteral `DIENST_MARKEN` aus app.js — nur die SCHLUESSEL.
 *
 * Geklammert gezaehlt und nicht per Zeilenregel, aus demselben Grund wie in
 * tools/dienst-marken-schau.mjs: in dem Objekt stehen Kommentare mit deutschen
 * Anfuehrungszeichen, und ein naiver Zaehler haelt das schliessende gerade
 * Zeichen fuer den Anfang einer Zeichenkette. Das ist dort einmal teuer
 * nachgeholt worden; hier wird es nicht ein zweites Mal gelernt.
 */
function markenAus(quelle) {
  const anfang = quelle.indexOf('const DIENST_MARKEN = {')
  if (anfang === -1) throw new Error('DIENST_MARKEN nicht gefunden — hat app.js den Namen geaendert?')
  let i = quelle.indexOf('{', anfang)
  const start = i
  let tiefe = 0
  let inZk = null
  for (; i < quelle.length; i++) {
    const c = quelle[i]
    if (inZk) {
      if (c === '\\') i++
      else if (c === inZk) inZk = null
      continue
    }
    if (c === '/' && quelle[i + 1] === '/') {
      const e = quelle.indexOf('\n', i)
      i = e === -1 ? quelle.length : e
      continue
    }
    if (c === '/' && quelle[i + 1] === '*') {
      const e = quelle.indexOf('*/', i + 2)
      i = e === -1 ? quelle.length : e + 1
      continue
    }
    if (c === "'" || c === '"' || c === '`') inZk = c
    else if (c === '{') tiefe++
    else if (c === '}') {
      tiefe--
      if (tiefe === 0) break
    }
  }
  // Der Text stammt aus dem eigenen Arbeitsverzeichnis, nicht aus dem Netz.
  return Object.keys(new Function(`return ${quelle.slice(start, i + 1)}`)())
}

/**
 * DIE PLAKETTENFARBEN aus app.css — und nur sie, nicht jede `.marke-…`-Regel.
 *
 * ── DER FEHLALARM, DER DAS GEAENDERT HAT (Kritiker-Lauf 19.09.2026) ────────
 * Gelesen wurde `^\.marke-([a-z]+)\s*\{`, also der NAME. Der Name genuegt
 * nicht: an `.marke` haengen inzwischen auch ZUSTANDSKLASSEN, die kein Dienst
 * sind — `.marke-gilt` (der Wahl-Ring, app.css:3184) und `.marke-nebenher`
 * (das Blasse der zweiten Quelle, :3124), beide gesetzt in app.js:3455. Die
 * Gegenrichtung („ein Eintrag, den dienstVon nicht kennt, ist ein Tippfehler")
 * meldete sie jeden Lauf als zwei Befunde. Sie waren echt falsch: Der
 * Pruefschritt „Deckung der Dienstliste" stand damit DAUERHAFT rot, und nach
 * [[dauerrote-wache-ist-keine]] verdeckt genau das den naechsten echten Fund.
 *
 * ── WARUM KEINE AUSNAHMELISTE DER ZWEI NAMEN ──────────────────────────────
 * Sie waere die zweite Liste, die dieses Werkzeug bekaempft: der naechste
 * Zustand an `.marke` (es kamen zwei in fuenf Wochen) stuende wieder rot da.
 * Genauso falsch waere „Name kommt in DIENST_MARKEN vor" oder „Name steht
 * woertlich in app.js": Dienst-Marken werden ZUSAMMENGESETZT (`marke-${d}`,
 * app.js:3455/7162), sie stehen dort NIE woertlich — ein Kriterium, das
 * woertliche Nennung verlangt, wuerde jeden echten Dienst wegwerfen. Und
 * woertlich kommt in app.js ausserdem `marke-schau`, `marke-ohne`,
 * `marke-grenzfaelle` … vor: Werkzeugnamen in Kommentaren
 * ([[kommentar-und-kompilat-sind-keine-gegenstelle]]).
 *
 * ── DAS KRITERIUM IST DIE SORTE, NICHT DER NAME ───────────────────────────
 * Dieser Verbraucher heisst „Farbe der Plakette", also wird gelesen, was eine
 * FARBE VERGIBT. Ein Dienst braucht eine Flaechenfarbe, sonst ist seine
 * Plakette unsichtbar (die Runde um den Farbkreis ueber `.marke-spotify` sagt
 * warum); ein Zustand verstellt Deckkraft, Ring oder Schatten. Damit veraltet
 * nichts, wenn ein Dienst dazukommt, und jeder ECHTE Fehler bleibt rot:
 *
 *   `.marke-neu` fehlt ganz        -> 'neu' fehlt (Farbe der Plakette)
 *   `.marke-neu` ohne Farbe        -> dasselbe, und das ist richtig: eine
 *                                     Plakette ohne Flaechenfarbe ist keine
 *   `.marke-sptify { background }` -> Tippfehler, Gegenrichtung schlaegt an
 *
 * WAS ES NICHT MEHR FAENGT, ausdruecklich: eine Regel mit vertipptem Namen,
 * die auch keine Farbe vergibt. Die ist ein toter Zustandsschalter, kein
 * fehlender Dienst — und der Preis dafuer, dass Zustaende an `.marke` erlaubt
 * sind.
 *
 * Kommentare im Regelrumpf werden vorher entfernt: ein `background:` in einer
 * Begruendung ist Prosa, keine Farbe (dieselbe Falle wie oben).
 */
function plakettenFarbenAus(text) {
  const namen = []
  let gesehen = 0
  for (const m of text.matchAll(/^\.marke-([a-z]+)\s*\{([^}]*)\}/gm)) {
    gesehen++
    const rumpf = m[2].replace(/\/\*[\s\S]*?\*\//g, '')
    if (/(?:^|[;{])\s*background(?:-color)?\s*:/m.test(rumpf)) namen.push(m[1])
  }
  // OHNE DIESE ZWEI WUERFE WAERE DAS WERKZEUG STILL GRUEN, wenn app.css die
  // Plaketten anders faerbt (etwa ueber eine Variable je Dienst) — und eine
  // Wache, die nichts mehr findet und nichts sagt, ist die schlimmste Sorte
  // Gruen. Die uebrigen Leser hier werfen aus demselben Grund.
  if (!gesehen) throw new Error('Keine `.marke-…`-Regel in app.css gefunden — heissen die Plaketten noch so?')
  if (!namen.length)
    throw new Error('Keine einzige `.marke-…`-Regel vergibt eine Flaechenfarbe — faerbt app.css die Plaketten anders?')
  return namen
}

/** Die Schluessel eines flachen `const NAME: Record<string, string> = { … }`. */
function objektSchluessel(text, name) {
  const re = new RegExp(`const ${name}[^=]*=\\s*\\{([^}]*)\\}`)
  const m = re.exec(text)
  if (!m) throw new Error(`${name} nicht gefunden`)
  return [...m[1].matchAll(/^\s*'?([a-zA-Z_][\w-]*)'?\s*:/gm)].map((t) => t[1])
}

/**
 * DIE VERBRAUCHER. Jeder sagt, WO seine Liste steht und WIE man sie liest.
 *
 * KEIN „optional"-Schalter je Verbraucher, und das mit Absicht: dann waere
 * die Antwort auf „warum fehlt der Dienst hier?" ein Wahrheitswert. Fehlen
 * darf ein Dienst nur, wenn er unten in AUSNAHMEN steht — mit einem Satz,
 * der es begruendet.
 */
const VERBRAUCHER = [
  {
    id: 'marken-js',
    was: 'Dienst-Zeichen der Kacheln',
    datei: 'NewDesign/app.js',
    lies: (t) => markenAus(t),
  },
  {
    id: 'marken-css',
    was: 'Farbe der Plakette',
    datei: 'NewDesign/app.css',
    // Gelesen wird, WAS EINE FARBE VERGIBT — nicht jeder Name, der mit
    // `marke-` anfaengt. Die lange Begruendung steht bei `plakettenFarbenAus`.
    lies: (t) => plakettenFarbenAus(t),
  },
  {
    id: 'verwaltung-name',
    was: 'Klartextname in der Verwaltung',
    datei: 'src/frontend-admin/src/app/seiten/medien.ts',
    lies: (t) => objektSchluessel(t, 'DIENST_NAME'),
  },
  /*
   * ── DIE DREI, DIE AM 04.08.2026 BEIM GEGENLESEN NACHGETRAGEN WURDEN ──────
   *
   * Der erste Anlauf dieses Werkzeugs hielt die Dienstliste gegen die fuenf
   * Verbraucher darueber — und war gruen, waehrend an DREI weiteren Stellen
   * ein `ard` fehlen konnte, ohne dass irgendetwas rot wurde. Gemessen mit
   * einer Gegenprobe je Stelle (herausnehmen, alle Pruefschritte laufen
   * lassen, wieder einsetzen):
   *
   *   server.ts   dienstSuche()      GRUEN — die Verwaltung haette die ARD
   *                                  nicht mehr gefunden, ohne eine Meldung
   *   medien.ts   dienstSchluessel() GRUEN — die Bibliothek haette jeden
   *                                  ARD-Eintrag „Anderes" genannt
   *   media.service.ts               GRUEN — die Kachel waere in der
   *                                  klassischen Oberflaeche wieder still
   *                                  herausgefallen
   *
   * Die dritte ist genau die Stelle, die diesen ganzen Auftrag ausgeloest hat.
   * Ein Pruefschritt, der sie nicht deckt, prueft die Nachbarn.
   */
  {
    id: 'verwaltung-schluessel',
    was: 'Dienst eines Eintrags in der Verwaltung',
    datei: 'src/frontend-admin/src/app/seiten/medien.ts',
    // `dienstSchluessel()` bildet den data.json-`type` auf den Dienstnamen ab —
    // dieselbe Abbildung wie `dienstVon()`, nur im Browser. An ihr haengen der
    // Klartextname UND das Farbzeichen; faellt ein Dienst hier heraus, heisst
    // er in der ganzen Bibliothek „Anderes".
    lies: (t) => {
      const a = t.indexOf('protected dienstSchluessel(')
      if (a === -1) throw new Error('dienstSchluessel nicht gefunden — heisst die Methode in medien.ts noch so?')
      const e = t.indexOf('\n  }', a)
      return [...t.slice(a, e).matchAll(/return '([a-z]+)'/g)].map((m) => m[1])
    },
  },
  {
    id: 'suche-dienste',
    was: 'Dienste, die die Suche der Verwaltung fragt',
    datei: 'src/backend-api/src/server.ts',
    // `dienstSuche()` fragt je Dienst einen Zweig ab; der Filter „nur <Dienst>"
    // der Oberflaeche kommt hier an. Gelesen wird die BEDINGUNG, nicht die
    // Auswahlliste im Formular — die steht in einer anderen App und wuerde
    // eine Uebereinstimmung nur vortaeuschen.
    lies: (t) => {
      const a = t.indexOf('async function dienstSuche(')
      if (a === -1) throw new Error('dienstSuche nicht gefunden — heisst die Funktion in server.ts noch so?')
      const e = t.indexOf('\n}', a)
      // `alle` ist kein Dienst, sondern das Wort fuer „keine Einschraenkung"
      // (der erste Eintrag des Auswahlfelds). Es hier stehen zu lassen, meldete
      // jeden Lauf einen Tippfehler, den es nicht gibt.
      return [...t.slice(a, e).matchAll(/nurDienst === '([a-z]+)'/g)]
        .map((m) => m[1])
        .filter((d) => d !== 'alle')
    },
  },
  // (box-quellzeichen, box-abspieler und box-aufloesung — die drei Sichten
  //  der klassischen Oberflaeche — fielen mit E118/1e.)
  /*
   * ── DER NEUNTE, NACHGETRAGEN AM 05.08.2026 (BACKLOG E4/A10) ─────────────
   *
   * Und wieder war es dieselbe Bauart: `istWeiterhoerbar()` fuehrt eine
   * Aufzaehlung der Dienste, die eine gemerkte Stelle ueberhaupt bekommen —
   * `ard` fehlte darin. Nichts wurde rot; die Reihe war nur leer, wo sie voll
   * sein sollte. Gemeldet als „die angespielten tracks landen nicht in
   * weiterhoeren".
   *
   * DIESE STELLE IST BESONDERS STILL, denn ihr Fehlen sieht aus wie ein
   * ERGEBNIS: eine Weiterhoeren-Reihe ohne die Sendung heisst genauso gut
   * „da war noch nichts". Der Unterschied zu „geht nicht" ist von aussen
   * unsichtbar — genau die Sorte, gegen die dieses Werkzeug gebaut ist.
   */
  {
    id: 'weiterhoeren',
    was: 'Dienste, die eine gemerkte Stelle bekommen',
    datei: 'src/backend-api/src/weiterhoeren.ts',
    // Gelesen wird die Aufzaehlung in `istWeiterhoerbar()` — die eine Stelle,
    // an der entschieden wird, ob eine Stelle in die Reihe darf. `stelleAus()`
    // daneben schreibt sie; beide muessen dieselben Dienste kennen, und wer
    // nur eine anfasst, faellt hier auf.
    lies: (t) => {
      const a = t.indexOf('export function istWeiterhoerbar(')
      if (a === -1) throw new Error('istWeiterhoerbar nicht gefunden — heisst die Funktion in weiterhoeren.ts noch so?')
      const e = t.indexOf('\n}', a)
      return [...t.slice(a, e).matchAll(/dienst !== '([a-z]+)'/g)].map((m) => m[1])
    },
  },
]

/**
 * Wo der Verbraucher den data.json-`type` fuehrt und nicht den Dienstnamen.
 * Dieselbe Zuordnung wie in `dienstVon()`; sie steht hier, weil ein Werkzeug,
 * das Quelltext liest, sie nicht ableiten kann.
 */
const TYP_ZU_DIENST = { library: 'lokal', local: 'lokal' }

/**
 * BEWUSST WEGGELASSEN — je Verbraucher, je Dienst, mit Grund.
 *
 * Was hier nicht steht und beim Verbraucher fehlt, ist ein Fehler. Was hier
 * steht, ist eine Entscheidung, die jemand aufgeschrieben hat. Mehr macht der
 * Unterschied nicht aus, und weniger genuegt nicht.
 */
const AUSNAHMEN = {
  'marken-js': {
    anderes:
      '„anderes" heisst „wir wissen es nicht". Ein graues Fragezeichen auf jedem Cover waere Flaeche ohne Auskunft.',
  },
  'marken-css': {
    anderes: 'siehe marken-js — ohne Zeichen braucht es auch keine Farbe.',
  },
  'verwaltung-name': {},
  /*
   * DIE GROESSTE AUSNAHMELISTE IM HAUS — und sie steht hier, damit sie eine
   * ENTSCHEIDUNG bleibt und nicht ein Versehen wird. `mediaSourceOf` beschriftet
   * nur die drei Bibliotheken, die ein Mensch DURCHBLAETTERT; die Frage, die
   * das Zeichen beantwortet, ist „welche meiner Sammlungen ist das?" und nicht
   * „woher kommt der Ton?". Fuer die zweite Frage gibt es die Plaketten der
   * neuen Oberflaeche (marken-js/marken-css), und die kennen alle Dienste.
   */
  'box-quellzeichen': {
    radio: 'Ein Sender ist keine Sammlung, die man durchblaettert. So steht es im Kopf von media.ts.',
    rss: 'Wie radio: ein Podcast-Eintrag ist eine Reihe, keine Bibliothek.',
    ard: 'Wie radio und rss — eine Sendung der Audiothek ist eine Folgenreihe, keine Sammlung der Box.',
    // `MediaSource` (media.ts) ist eine GESCHLOSSENE Aufzaehlung — sie speist
    // `Record<MediaSource, string>` in swiper.component.ts (das Icon je
    // Quelle auf der Interpretenseite), und ein vierter Wert dort verlangt
    // eine vierte Zeile in GENAU dieser Datei. Plugin-Inhalt ist ausserdem
    // wie eine ARD-Sendung eine Folgenreihe des Anbieters (siehe eine Zeile
    // hoeher) und keine der drei Bibliotheken, die man in der klassischen
    // Oberflaeche durchblaettert.
    plugin: 'Wie ard — eine Folgenreihe eines Plugins, keine der drei Bibliotheken hinter MediaSource.',
    anderes: 'Unbekannter Typ; ein Zeichen waere eine Behauptung.',
  },
  'box-abspieler': {
    anderes: 'Ein unbekannter Typ hat keinen Abspielweg; player.service.ts meldet ihn ins Protokoll.',
  },
  'verwaltung-schluessel': {},
  /*
   * WAS DIE SUCHE NICHT FRAGT — und warum das keine Luecke ist. Die Suche
   * beantwortet „was kann ich NEU aufnehmen?". Dazu braucht ein Dienst einen
   * KATALOG, den man von aussen durchsuchen kann. Drei haben keinen, und
   * `lokal` hat einen, aber es steht schon alles drin.
   */
  'suche-dienste': {
    lokal: 'Was auf der Box liegt, ist schon aufgenommen. Die Bibliotheksliste daneben durchsucht es.',
    radio: 'Es gibt kein durchsuchbares Verzeichnis der Sender; eine Radio-Kachel entsteht aus einer Adresse.',
    rss: 'Ein Podcast wird ueber seine Feed-Adresse angelegt, nicht ueber eine Suche.',
    // ANDERS ALS BEI ARD GIBT ES HIER KEIN EINZELNES PLUGIN, DAS `nurDienst`
    // ANSPRECHEN KOENNTE: `dienst === 'plugin'` steht fuer JEDES geladene
    // Medien-Plugin zugleich (E87), und jedes sucht ueber seine EIGENE Route
    // (`/api/plugins/<kennung>/http/suche`, direkt aus der Verwaltung
    // gerufen — siehe medien.ts, `mixpi-archive`/`mixpi-ardsounds`). Eine
    // gemeinsame Suche unter dem Namen 'plugin' gaebe es nur, wenn der
    // Plugin-Vertrag (plugin-vertrag.ts, RECHTE) ein Suchrecht kennte — das
    // tut er nicht.
    plugin: 'Jedes Plugin hat seine eigene Suchroute; es gibt keine gemeinsame Suche unter dem Namen "plugin".',
    anderes: '„anderes" ist kein Dienst, den man fragen koennte — der Name heisst gerade, dass keiner erkannt wurde.',
  },
  /*
   * WAS DIE KLASSISCHE OBERFLAECHE NICHT SELBST AUFLOEST. Nur wer aus EINEM
   * Eintrag VIELE Kacheln macht, braucht hier einen Zweig.
   */
  'box-aufloesung': {
    lokal: 'Ein lokales Album IST eine Kachel; aufgeloest wird es erst im Abspieldienst (die playlist.m3u).',
    jellyfin:
      'Ein Jellyfin-Album ist ebenfalls eine Kachel; seine Titel holt player.service.ts beim Antippen (playJellyfinAlbum).',
    radio: 'Ein Sender ist EIN Datenstrom — es gibt nichts aufzuloesen.',
    anderes: 'Unbekannter Typ. Ihn aufloesen zu wollen hiesse, zu wissen, was er ist.',
  },
  /*
   * WAS SICH KEINE STELLE MERKT. Die Begruendungen stehen ausfuehrlich im Kopf
   * von weiterhoeren.ts; hier stehen sie, damit ein NEUER Dienst zu einer
   * Entscheidung zwingt, statt still herauszufallen.
   */
  weiterhoeren: {
    radio: 'Ein Strom hat keine Stelle — er laeuft immer „jetzt". Fortsetzen gibt es dort nicht.',
    // `jellyfin` STAND HIER BIS ZUM 06.08.2026, mit der Begruendung „die
    // KLASSISCHE Oberflaeche kann es nicht fortsetzen". Am Geraet gemessen
    // (Box .169, tools/stelle-je-dienst-am-geraet.mjs) war das die falsche
    // Reihenfolge: die NEUE Oberflaeche kann es laengst, und ihr Kind bekam
    // trotzdem nichts. Jetzt wird gemerkt; ausgelassen wird in
    // media.service.ts — dieselbe Loesung wie bei ARD.
    anderes: 'Unbekannter Typ — es gibt keinen Abspielweg, in den man zurueckspringen koennte.',
  },
}

/**
 * ── DIE ZWEITE FRAGE: WAS BLEIBT OHNE INTERNET STEHEN? ────────────────────
 *
 * Sie ist von derselben Bauart wie die erste, hat aber eine andere Form: hier
 * fuehren die Verbraucher keine LISTE der Dienste, sondern einen jq-Ausdruck,
 * der einzelne AUSSCHLIESST (scripts/mupibox/{check,get}_network.sh bauen
 * daraus offline_data.json und offline_resume.json).
 *
 * JEDER Dienst muss unten eingeordnet sein. Ein neuer Dienst zwingt damit zu
 * einer Entscheidung, statt still im Rueckfall zu landen — und der Rueckfall
 * waere hier der schlechtere: ein Dienst, der Netz braucht, stuende ohne Netz
 * als Kachel da und taete beim Antippen nichts.
 *
 * WARUM DAS NOETIG IST, gemessen am 04.08.2026: In check_network.sh stand
 * derselbe Ausdruck sechsmal — und seit dem 21.02.2024 mit einer FEHLENDEN
 * KLAMMER. jq bricht damit ab und schreibt nichts; das Skript setzt die
 * Klammern trotzdem drumherum, also entstand `[]`. Offline haette die Box gar
 * nichts mehr gezeigt, auch keine lokalen Aufnahmen — ausgerechnet das, was
 * ohne Netz noch spielt. Aufgefallen ist es nie, weil get_network.sh dieselbe
 * Datei mit dem RICHTIGEN Ausdruck schreibt und meistens zuerst dran ist.
 */
const NETZ = {
  spotify: { braucht: true, warum: 'Fremder Dienst im Internet.' },
  radio: { braucht: true, warum: 'Ein Sender ist ein Datenstrom aus dem Netz.' },
  rss: { braucht: true, warum: 'Die Folge liegt beim Anbieter.' },
  ard: { braucht: true, warum: 'Die Audiothek — und die Tonadresse wird erst beim Antippen geholt.' },
  // ANDERS ALS BEI ARD IST 'plugin' KEIN EINZELNER, FEST BEKANNTER DIENST,
  // SONDERN EIN SAMMELNAME FUER JEDES GELADENE MEDIEN-PLUGIN ZUGLEICH (E87)
  // — und die koennen lokale UND Netzquellen bedienen (siehe Kopf von
  // medien.ts, dienstVon). Der WEG ZUM PLUGIN SELBST braucht kein Internet:
  // `pluginHttp()`/`pluginInhalt()` rufen einen WORKER-THREAD AUF DER BOX
  // (plugin-wirt.ts, `node:worker_threads`) — anders als beim ARD-Zweig, wo
  // die Tonadresse GARANTIERT beim externen WDR liegt, unabhaengig vom
  // Aufrufweg. Ob EIN GELADENES Plugin seinerseits Internet braucht,
  // entscheidet sein eigenes Manifest (Recht `netz`, plugin-vertrag.ts) —
  // das weiss diese Zeile fuer ALLE Plugins zugleich nicht und kann es auch
  // nicht wissen, denn der jq-Ausdruck unten kennt nur den `type` aus
  // data.json, nie die Plugin-Kennung dahinter. Braucht ein Plugin
  // tatsaechlich Internet, bleibt seine Kachel offline zwar stehen, meldet
  // sich beim Antippen aber ausdruecklich („Das Plugin antwortet nicht.",
  // NewDesign/app.js) statt schweigend nichts zu tun — derselbe Fehlerweg
  // wie bei einem nicht erreichbaren Jellyfin-Server.
  plugin: {
    braucht: false,
    warum: 'Der Aufruf laeuft ueber einen Worker auf der Box selbst; ob das jeweilige Plugin Internet braucht, steht in seinem eigenen Manifest.',
  },
  lokal: { braucht: false, warum: 'Die Aufnahme liegt auf der Box.' },
  jellyfin: { braucht: false, warum: 'Steht im eigenen Netz und ist ohne Internet weiter erreichbar.' },
  anderes: {
    braucht: false,
    warum:
      'Unbekannter Typ, von Hand eingetragen. Er BLEIBT — ihn wegzunehmen hiesse, einem Menschen seinen eigenen Eintrag zu verstecken, ohne zu wissen, ob er Netz braucht.',
  },
}

/** Die Skripte, die offline_data.json bauen. Beide muessen dasselbe sagen. */
const NETZ_SKRIPTE = ['scripts/mupibox/check_network.sh', 'scripts/mupibox/get_network.sh']

/**
 * Welche `type`-Werte der jq-Ausdruck ausschliesst.
 *
 * Gelesen wird die VARIABLE, nicht die Aufrufstellen: stuende der Ausdruck
 * wieder an jeder Aufrufstelle im Klartext, faende diese Regel ihn zwar auch —
 * aber sie soll gerade dafuer sorgen, dass es EINE Stelle bleibt. Fehlt die
 * Variable, wird das Werkzeug rot statt still.
 */
function nurOhneNetzAus(text) {
  const m = /^NUR_OHNE_NETZ='([^']*)'/m.exec(text)
  if (!m) return null
  return [...m[1].matchAll(/\.type\s*!=\s*"([a-z-]+)"/g)].map((t) => t[1])
}

const roh = new Map()
async function lies(datei) {
  if (!roh.has(datei)) roh.set(datei, await readFile(p(...datei.split('/')), 'utf8'))
  return roh.get(datei)
}

const quelltext = await lies('src/backend-api/src/medien.ts')
const dienste = quelleAus(quelltext)
const zweige = zweigeAus(quelltext)

const befunde = []

// ── Zuerst die Quelle mit sich selbst: Typ und Rumpf muessen sich decken.
for (const d of dienste) {
  if (!zweige.includes(d)) {
    befunde.push(`medien.ts: '${d}' steht im Rueckgabetyp von dienstVon, aber KEIN Zweig vergibt ihn`)
  }
}
for (const d of zweige) {
  if (!dienste.includes(d))
    befunde.push(`medien.ts: dienstVon gibt '${d}' zurueck, aber der Rueckgabetyp kennt es nicht`)
}

const tabelle = []
for (const v of VERBRAUCHER) {
  const text = await lies(v.datei)
  let hat = v.lies(text)
  if (v.uebersetzen) hat = hat.map((x) => TYP_ZU_DIENST[x] ?? x)
  const ausnahme = AUSNAHMEN[v.id] ?? {}
  const fehlt = dienste.filter((d) => !hat.includes(d) && !ausnahme[d])
  // Die Gegenrichtung: ein Eintrag, den die Quelle gar nicht kennt. Das ist
  // fast immer ein Tippfehler — und ein Tippfehler in einem CSS-Klassennamen
  // faellt sonst nie auf, weil eine Regel, die nichts trifft, nicht meckert.
  const fremd = hat.filter((x) => !dienste.includes(x))
  for (const d of fehlt) befunde.push(`${v.datei}: '${d}' fehlt (${v.was})`)
  for (const x of fremd) befunde.push(`${v.datei}: '${x}' ist dort eingetragen, aber dienstVon kennt es nicht`)
  tabelle.push({ v, hat, fehlt, fremd, ausnahme })
}

// ── Die zweite Frage: was bleibt ohne Internet stehen? ─────────────────────
for (const d of dienste) {
  if (!NETZ[d])
    befunde.push(`tools/dienste-deckung.mjs: '${d}' ist nicht eingeordnet — braucht er Internet oder nicht?`)
}
for (const d of Object.keys(NETZ)) {
  if (!dienste.includes(d))
    befunde.push(`tools/dienste-deckung.mjs: '${d}' ist eingeordnet, aber dienstVon kennt ihn nicht`)
}
const nurMitNetz = dienste.filter((d) => NETZ[d]?.braucht).sort()
const netzTabelle = []
for (const datei of NETZ_SKRIPTE) {
  const aus = nurOhneNetzAus(await lies(datei))
  if (!aus) {
    befunde.push(`${datei}: NUR_OHNE_NETZ nicht gefunden — steht der jq-Ausdruck wieder an jeder Aufrufstelle?`)
    continue
  }
  // Die Skripte schliessen nach data.json-`type` aus; `library`/`local` heissen
  // dort anders als der Dienst. Uebersetzt wird mit derselben Tabelle wie oben.
  const alsDienst = [...new Set(aus.map((x) => TYP_ZU_DIENST[x] ?? x))].sort()
  for (const d of nurMitNetz) {
    if (!alsDienst.includes(d)) {
      befunde.push(`${datei}: '${d}' braucht Internet, wird aber nicht aus offline_data.json ausgeschlossen`)
    }
  }
  for (const d of alsDienst) {
    if (!nurMitNetz.includes(d)) {
      befunde.push(`${datei}: '${d}' wird ausgeschlossen, ist hier aber als „geht auch ohne Netz" eingeordnet`)
    }
  }
  netzTabelle.push({ datei, alsDienst })
}

const still = process.argv.includes('--pruefen')

if (!still) {
  const breite = Math.max(...dienste.map((d) => d.length))
  console.log(`Quelle: src/backend-api/src/medien.ts — dienstVon(): ${dienste.join(', ')}\n`)
  const kopf = ['Dienst'.padEnd(breite), ...VERBRAUCHER.map((v) => v.id.padEnd(16))]
  console.log(kopf.join(' │ '))
  console.log('─'.repeat(kopf.join(' │ ').length))
  for (const d of dienste) {
    const zellen = tabelle.map((t) => (t.hat.includes(d) ? 'ja' : t.ausnahme[d] ? 'bewusst nicht' : 'FEHLT').padEnd(16))
    console.log([d.padEnd(breite), ...zellen].join(' │ '))
  }
  console.log('')
  for (const t of tabelle) {
    for (const [d, grund] of Object.entries(t.ausnahme)) {
      console.log(`  bewusst ohne '${d}' in ${t.v.datei}: ${grund}`)
    }
  }
  console.log('')

  console.log('Ohne Internet auf der Box (offline_data.json):')
  for (const d of dienste) {
    const n = NETZ[d]
    console.log(
      `  ${d.padEnd(9)} ${n ? (n.braucht ? 'faellt weg  ' : 'bleibt      ') : 'NICHT EINGEORDNET'} ${n?.warum ?? ''}`,
    )
  }
  for (const n of netzTabelle) console.log(`  ${n.datei}: schliesst ${n.alsDienst.join(', ')} aus`)
  console.log('')
}

for (const b of befunde) console.error(`FEHLT: ${b}`)
if (!befunde.length) {
  console.error(
    `geprueft: ${dienste.length} Dienste gegen ${VERBRAUCHER.length} Verbraucher und ${NETZ_SKRIPTE.length} Netz-Skripte, alle gedeckt`,
  )
}
process.exit(befunde.length ? 1 : 0)
