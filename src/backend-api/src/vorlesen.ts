/**
 * Vorlesen — die Box spricht aus, was auf einer Kachel steht.
 *
 * WOFUER: ein Kind im Vorschulalter kann die Kachel nicht lesen. Es tippt sie
 * an, weil es das Bild kennt. Wer den Namen dazu hoert, lernt ihn. Und wer
 * gerade lesen lernt, dem hilft die Trennung in Sprechsilben - genau die,
 * die in der ersten Klasse geuebt wird ("Pum-mel-ein-horn").
 *
 * REINE LOGIK: kein Dateisystem, kein Netz, keine Sprachausgabe. Herein kommt
 * Text, heraus kommen Silben, Sprechtexte und Dateinamen. Damit ist die
 * Trennung pruefbar, ohne Piper zu starten - und das ist noetig, denn eine
 * falsche Trennung faellt einem Erwachsenen kaum auf, einem Erstklaessler
 * aber sofort.
 *
 * WAS DIE REGELN NICHT KOENNEN: zusammengesetzte Woerter. Zwischen "Pummel"
 * und "Einhorn" steht nur ein einzelnes L, und die Regel schiebt ein
 * einzelnes L immer in die naechste Silbe - "Pum-me-lein-horn". Richtig waere
 * "Pum-mel-ein-horn". Das laesst sich ohne Wortliste nicht entscheiden, und
 * eine Wortliste fuer Albumtitel gibt es nicht. Deshalb: die Regeln machen
 * den Vorschlag, und im Verwaltungsbereich kann er von Hand richtiggestellt
 * werden (Feld "silben" am Eintrag). Das ist ehrlicher, als eine Trennung zu
 * behaupten, die bei jedem zweiten Kinderalbum daneben liegt.
 */

// ─────────────────────────────────────────────────────────────────────────
// Bausteine der Silbentrennung
// ─────────────────────────────────────────────────────────────────────────

/**
 * Buchstabenpaare, die EINEN Laut schreiben und deshalb nie getrennt werden.
 *
 * Bewusst NICHT dabei:
 *   tz - wird getrennt ("Kat-ze"), nicht "Ka-tze"
 *   ng - wird getrennt ("Fin-ger"), nicht "Fi-nger"
 *   st - seit der Reform von 1996 trennbar ("Fens-ter")
 * ck steht dabei, weil es seither zusammenbleibt ("Zu-cker").
 */
const MITLAUT_PAARE = ['sch', 'ch', 'ck', 'ph', 'th', 'rh', 'sh', 'qu'] as const

/** Selbstlautpaare, die einen einzigen Silbenkern bilden. */
const SELBSTLAUT_PAARE = ['ei', 'ai', 'au', 'eu', 'äu', 'ie', 'aa', 'ee', 'oo'] as const

const SELBSTLAUTE = 'aeiouäöüy'

/**
 * Ein Baustein des Wortes: entweder ein Silbenkern (Selbstlaut) oder ein
 * Mitlaut. `von`/`bis` zeigen in das Originalwort, damit Gross- und
 * Kleinschreibung erhalten bleibt.
 */
interface Baustein {
  kern: boolean
  von: number
  bis: number
}

/**
 * Zerlegt ein Wort in Bausteine.
 *
 * Das H gilt hier IMMER als Mitlaut, nie als Dehnungszeichen. Klingt falsch,
 * ist aber richtig: als Dehnung ("Mehl") steht es allein im Silbenkern und
 * stoert nicht, als Silbenanfang ("ge-hen") muss es in die naechste Silbe
 * rutschen. Zaehlte man "eh" als Kern, ergaebe sich "geh-en".
 */
function bausteine(wort: string): Baustein[] {
  const klein = wort.toLowerCase()
  const teile: Baustein[] = []
  let i = 0

  while (i < klein.length) {
    // qu: das U gehoert zum Mitlaut, es ist kein Silbenkern.
    // Deshalb stehen die Mitlautpaare VOR der Selbstlautpruefung.
    const mit = MITLAUT_PAARE.find((p) => klein.startsWith(p, i))
    if (mit) {
      teile.push({ kern: false, von: i, bis: i + mit.length })
      i += mit.length
      continue
    }

    if (SELBSTLAUTE.includes(klein[i])) {
      const paar = SELBSTLAUT_PAARE.find((p) => klein.startsWith(p, i))
      const laenge = paar ? paar.length : 1
      teile.push({ kern: true, von: i, bis: i + laenge })
      i += laenge
      continue
    }

    teile.push({ kern: false, von: i, bis: i + 1 })
    i += 1
  }

  return teile
}

/**
 * Trennt EIN Wort in Sprechsilben.
 *
 * Die Regel zwischen zwei Silbenkernen:
 *   kein Mitlaut  -> dazwischen wird getrennt ("Feu-er", "Sta-ti-on")
 *   ein Mitlaut   -> er beginnt die naechste Silbe ("Va-ter", "Zu-cker")
 *   mehrere       -> alle bis auf den letzten bleiben ("Fens-ter", "Kat-ze")
 *
 * Gibt bei Zahlen, kurzen Woertern oder nur einem Silbenkern das Wort
 * unveraendert als einzige Silbe zurueck.
 */
export function silbenWort(wort: string): string[] {
  if (typeof wort !== 'string' || wort.length < 4) return [wort ?? '']

  const teile = bausteine(wort)
  const kerne: number[] = []
  teile.forEach((t, idx) => {
    if (t.kern) kerne.push(idx)
  })
  if (kerne.length < 2) return [wort]

  // Zeichenpositionen, an denen eine neue Silbe beginnt.
  const schnitte: number[] = []
  for (let k = 0; k < kerne.length - 1; k++) {
    const dazwischen = kerne[k + 1] - kerne[k] - 1
    let beginnBaustein: number
    if (dazwischen === 0) {
      beginnBaustein = kerne[k + 1]
    } else if (dazwischen === 1) {
      beginnBaustein = kerne[k] + 1
    } else {
      beginnBaustein = kerne[k + 1] - 1
    }
    schnitte.push(teile[beginnBaustein].von)
  }

  const silben: string[] = []
  let anfang = 0
  for (const s of schnitte) {
    // Eine Silbe ohne Buchstaben waere ein Fehler in der Rechnung oben -
    // lieber gar nicht trennen als einen leeren Strich zeigen.
    if (s <= anfang || s >= wort.length) continue
    silben.push(wort.slice(anfang, s))
    anfang = s
  }
  silben.push(wort.slice(anfang))
  return silben.filter((s) => s.length > 0)
}

/**
 * Trennt einen ganzen Titel und gibt ihn mit Bindestrichen zurueck:
 * "Das Lumpenpack" -> "Das Lum-pen-pack".
 *
 * Trennzeichen und Satzzeichen bleiben unangetastet - was schon ein
 * Bindestrich ist, wird nicht noch einmal zerlegt.
 */
export function silbenText(text: string): string {
  if (typeof text !== 'string' || !text.trim()) return ''
  return text.replace(/[\p{L}\p{M}]+/gu, (wort) => silbenWort(wort).join('-'))
}

/**
 * Macht aus getrennten Silben einen Text, den Piper mit kleinen Pausen
 * spricht. Ein Bindestrich wird ueberlesen, ein Komma nicht - deshalb Komma.
 */
export function silbenSprechText(text: string): string {
  const getrennt = silbenText(text)
  if (!getrennt) return ''
  return getrennt.replace(/-/g, ', ')
}

// ─────────────────────────────────────────────────────────────────────────
// Was gesprochen wird
// ─────────────────────────────────────────────────────────────────────────

export interface SprechEintrag {
  title?: unknown
  artist?: unknown
  /** Von Hand richtiggestellte Trennung, schlaegt die Regeln. */
  silben?: unknown
}

/*
 * DER SPIELE-SCHALTER IST AM 20.09.2026 AUSGEZOGEN — nach
 * src/backend-api/src/spiele.ts und `GET/PUT /api/spiele`.
 *
 * Er stand hier vom 19. bis zum 20.09.2026, weil der Betreiber ihn auf der
 * Vorlesen-Seite haben wollte. Einen Tag spaeter: „ich moechte den spiel
 * bereich seperat einschalten koennen." Er hatte mit Sprache nie etwas zu
 * tun; hier bleibt nur der Wegweiser, damit niemand ihn in dieser Datei
 * sucht. `ausVorlesenUebernehmen` dort drueben holt den alten Wert einmalig
 * aus `vorlesen.json` — WER DIESEN VERWEIS ENTFERNT, muss pruefen, ob es
 * noch Boxen gibt, die den Umzug nicht gemacht haben.
 */
export interface SprechEinstellungen {
  /** aus | antippen (sprechen, dann spielen) | lernen (Silben, zweites Tippen spielt) */
  modus: 'aus' | 'antippen' | 'lernen'
  stimme: string
  /** Interpret mitsprechen? Bei Spotify-Listen ist das oft nur ein Benutzername. */
  interpret: boolean
  /** 1.0 = normal, groesser = langsamer. Kinder brauchen es langsamer. */
  tempo: number
}

/**
 * Die Stimme, mit der die Box ohne weiteres Zutun spricht - am Geraet
 * angehoert und ausgesucht, nicht nach Datenblatt entschieden.
 */
export const STIMME_VORGABE = 'de_DE-ramona-low'

export const EINSTELLUNGEN_VORGABE: SprechEinstellungen = {
  modus: 'aus',
  stimme: STIMME_VORGABE,
  interpret: false,
  tempo: 1.1,
}

/**
 * Aufbau eines Piper-Stimmnamens: <sprache>-<name>-<guete>,
 * zum Beispiel "de_DE-ramona-low" oder "vi_VN-vais1000-medium".
 *
 * Diese Pruefung ist die SCHRANKE ZUM DATEISYSTEM: aus dem Namen wird ein
 * Pfad zur .onnx-Datei. Punkte und Schraegstriche kommen im Muster nicht vor,
 * "../../etc/passwd" kann also gar nicht erst durch.
 */
const STIMME_MUSTER = /^[a-z]{2}_[A-Z]{2}-[a-z0-9_]+-(x_low|low|medium|high)$/

export function stimmeIdGueltig(id: unknown): boolean {
  return typeof id === 'string' && STIMME_MUSTER.test(id)
}

export interface Stimme {
  id: string
  /** Sprachkuerzel, etwa "de_DE". */
  sprache: string
  /** Sprache im Klartext, etwa "Deutsch". */
  spracheName: string
  /** Der Name der Stimme mit grossem Anfangsbuchstaben, etwa "Ramona". */
  name: string
  /** Guete im Klartext - Piper liefert nicht jede Sprache in jeder Guete. */
  guete: string
}

/** Sprachen, die wir benennen koennen. Unbekannte behalten ihr Kuerzel. */
const SPRACHEN: Record<string, string> = {
  de: 'Deutsch',
  en: 'Englisch',
  vi: 'Vietnamesisch',
  fr: 'Französisch',
  es: 'Spanisch',
  it: 'Italienisch',
  nl: 'Niederländisch',
  pl: 'Polnisch',
  pt: 'Portugiesisch',
  ru: 'Russisch',
  tr: 'Türkisch',
  uk: 'Ukrainisch',
  ar: 'Arabisch',
  zh: 'Chinesisch',
  ro: 'Rumänisch',
  el: 'Griechisch',
  da: 'Dänisch',
  sv: 'Schwedisch',
  no: 'Norwegisch',
  fi: 'Finnisch',
  cs: 'Tschechisch',
  hu: 'Ungarisch',
  sr: 'Serbisch',
  sk: 'Slowakisch',
  ka: 'Georgisch',
  kk: 'Kasachisch',
  ne: 'Nepalesisch',
  fa: 'Persisch',
  sl: 'Slowenisch',
  lv: 'Lettisch',
  is: 'Isländisch',
  ca: 'Katalanisch',
  hi: 'Hindi',
  cy: 'Walisisch',
  lb: 'Luxemburgisch',
  ms: 'Malaiisch',
}

const GUETE: Record<string, string> = {
  x_low: 'sehr einfach',
  low: 'einfach',
  medium: 'mittel',
  high: 'hoch',
}

/**
 * Zerlegt einen Stimmnamen in etwas, das man einem Menschen zeigen kann.
 * Gibt null, wenn der Name nicht dem Muster entspricht.
 */
export function stimmeZerlegen(id: unknown): Stimme | null {
  if (!stimmeIdGueltig(id)) return null
  const s = String(id)
  const strich = s.indexOf('-')
  const letzter = s.lastIndexOf('-')
  const sprache = s.slice(0, strich)
  const name = s.slice(strich + 1, letzter)
  const guete = s.slice(letzter + 1)
  return {
    id: s,
    sprache,
    spracheName: SPRACHEN[sprache.slice(0, 2)] ?? sprache,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    guete: GUETE[guete] ?? guete,
  }
}

/**
 * Darf diese Stimme benutzt werden?
 *
 * Zwei Bedingungen, und beide sind noetig: der Name muss dem Muster
 * entsprechen (sonst waere es ein Pfad), UND die Stimme muss auf der Box
 * liegen. Welche das sind, weiss nur das Dateisystem - deshalb kommt die
 * Liste von aussen herein und steht nicht hier im Code. So kann man Stimmen
 * nachladen, ohne die Anwendung anzufassen.
 */
export function stimmeErlaubt(id: unknown, installiert: readonly string[]): boolean {
  return stimmeIdGueltig(id) && installiert.includes(String(id))
}

/**
 * Welche Stimmen liegen wirklich da? EINE STIMME SIND ZWEI DATEIEN.
 *
 * Neben jedem Modell `<id>.onnx` (20-110 MB) liegt ein `<id>.onnx.json` von
 * rund 4 KB - darin stehen Lautschrift und Abtastrate. Piper braucht beide;
 * ohne die Beschreibung bricht schon der Start ab.
 *
 * DIE FALLE, UND SIE IST AM 04.08.2026 ZWEIMAL GESTELLT WORDEN. Erst zaehlte
 * das Einrichtungsskript nur die *.onnx und meldete "1 Stimme, bereit",
 * obwohl die Leitung nach dem 60-MB-Modell abgerissen war; das wurde dort
 * behoben (scripts/mupibox/piper-einrichten.sh, bericht()). Der Server aber
 * zaehlte weiter genauso, und DORT ist es schlimmer:
 *
 *   GET  /api/vorlesen          meldet die halbe Stimme als waehlbar
 *   der Abspieler (bereitAus)   sieht `bereit && stimmen > 0` und spricht los
 *   jeder Sprechversuch         scheitert - das Kind hoert nichts
 *   POST /api/vorlesen/stimme   antwortet `{ok: true, schonDa: true}`
 *
 * Die letzte Zeile ist der eigentliche Schaden: der EINE Handgriff, der die
 * Box heilen wuerde - die Stimme noch einmal laden - wird von derselben
 * falschen Zaehlung abgewiesen. Ein halber Download war damit unreparierbar,
 * ausser man loescht die Stimme erst von Hand.
 *
 * Deshalb steht die Entscheidung hier, in einer pruefbaren Funktion, und
 * nicht als Filterzeile im Server: sie ist an drei Stellen wirksam.
 *
 * @param dateien Der rohe Verzeichnisinhalt (readdir), unsortiert.
 */
export function stimmenAusDateien(dateien: readonly string[]): string[] {
  const beschreibungen = new Set(dateien.filter((d) => d.endsWith('.onnx.json')))
  return dateien
    .filter((d) => d.endsWith('.onnx'))
    .map((d) => d.slice(0, -'.onnx'.length))
    .filter((id) => stimmeIdGueltig(id) && beschreibungen.has(`${id}.onnx.json`))
    .sort()
}

/**
 * @param installiert Die Stimmen, die auf der Box liegen. Leer = wir wissen
 *   es (noch) nicht; dann wird der Name nur auf seine Form geprueft, damit
 *   eine gespeicherte Einstellung beim Start nicht verlorengeht.
 */
export function einstellungenNormalisieren(roh: unknown, installiert: readonly string[] = []): SprechEinstellungen {
  const r = (roh ?? {}) as Record<string, unknown>
  const modus = r.modus
  const tempo = Number(r.tempo)
  const stimmeOk = installiert.length ? stimmeErlaubt(r.stimme, installiert) : stimmeIdGueltig(r.stimme)
  return {
    modus: modus === 'antippen' || modus === 'lernen' ? modus : 'aus',
    stimme: stimmeOk ? String(r.stimme) : ersatzStimme(installiert),
    interpret: r.interpret === true,
    tempo: Number.isFinite(tempo) && tempo >= 0.5 && tempo <= 2 ? tempo : EINSTELLUNGEN_VORGABE.tempo,
  }
}

/**
 * Welche Stimme nehmen, wenn die eingestellte nicht taugt? Die Vorgabe, wenn
 * sie da ist - sonst irgendeine, die da ist. Lieber eine fremde Stimme als
 * Stille, denn eine Box, die ploetzlich schweigt, sieht kaputt aus.
 */
export function ersatzStimme(installiert: readonly string[] = []): string {
  if (!installiert.length) return STIMME_VORGABE
  if (installiert.includes(STIMME_VORGABE)) return STIMME_VORGABE
  const deutsch = installiert.find((s) => s.startsWith('de_'))
  return deutsch ?? installiert[0]
}

/**
 * Was soll zu einer Kachel gesagt werden?
 *
 * Der Interpret kommt nur dazu, wenn er etwas hinzufuegt. Bei einer
 * Spotify-Liste steht dort oft der Benutzername dessen, der sie angelegt hat -
 * "Pummeleinhorn von andrea" hilft keinem Kind. Deshalb ist das abschaltbar,
 * und ein Interpret, der schon im Titel steckt, faellt immer weg.
 */
export function sprechText(eintrag: SprechEintrag, e: SprechEinstellungen): string {
  const titel = String(eintrag?.title ?? '').trim()
  if (!titel) return ''
  if (!e.interpret) return titel

  const interpret = String(eintrag?.artist ?? '').trim()
  if (!interpret) return titel
  const t = titel.toLowerCase()
  const i = interpret.toLowerCase()
  if (t.includes(i) || i.includes(t)) return titel
  return `${titel}, von ${interpret}`
}

/**
 * Die Trennung fuer den Lernmodus: von Hand gesetzte schlaegt die Regeln.
 */
export function lernTrennung(eintrag: SprechEintrag): string {
  const handgemacht = String(eintrag?.silben ?? '').trim()
  if (handgemacht) return handgemacht
  return silbenText(String(eintrag?.title ?? '').trim())
}

// ─────────────────────────────────────────────────────────────────────────
// Zwischenspeicher
// ─────────────────────────────────────────────────────────────────────────

/**
 * FNV-1a, 32 Bit. Reicht fuer Dateinamen und braucht keine Abhaengigkeit -
 * hier wird nichts gesichert, nur unterschieden.
 */
function streuwert(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * Dateiname im Zwischenspeicher.
 *
 * Stimme und Tempo gehoeren in den Namen: dieselbe Zeile klingt mit einer
 * anderen Stimme anders, und wer die Stimme wechselt, soll nicht die alte
 * aus dem Speicher hoeren.
 */
export function cacheName(text: string, e: SprechEinstellungen): string {
  const roh = `${e.stimme}|${e.tempo}|${text}`
  return `${streuwert(roh)}-${String(text).length}.wav`
}
