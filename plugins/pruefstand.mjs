/**
 * PRUEFSTAND — ein MuPiBox-Plugin pruefen, ohne MuPiBox.
 *
 * Ein Fremdentwickler hat keine Box im Kinderzimmer stehen, und selbst wer eine
 * hat, will nicht fuer jeden Tippfehler ausliefern. Der Kontext, den ein Plugin
 * bekommt, ist aber nur ein Objekt — er laesst sich also faelschen. Diese Datei
 * tut genau das, und sonst nichts.
 *
 *   import { kontext } from '../pruefstand.mjs'
 *   import plugin from './index.mjs'
 *
 *   const { k, geholt } = kontext({ antworten: { 'https://…/feed.xml': FEED_XML } })
 *   const fund = await plugin.aufloesen('https://…/feed.xml', k)
 *
 * KEINE ABHAENGIGKEITEN, reines ESM. `node --test` genuegt.
 *
 * WAS HIER NICHT NACHGEBAUT IST: die Pruefung dessen, was dein Plugin
 * ZURUECKGIBT (Medienwurzel, http/https, Titelname). Die steht in
 * `src/backend-api/src/plugin-vertrag.ts` und gilt dort — sie hier ein zweites
 * Mal hinzuschreiben hiesse, zwei Wahrheiten zu pflegen, von denen eine still
 * veraltet. Wer das echte Urteil will, nimmt
 *
 *   npx tsx tools/plugin-pruefen.mjs plugins/<kennung>
 *
 * Das laedt dein Plugin im ECHTEN Laufwerk, in einem echten Worker, mit den
 * echten Riegeln.
 */

/** Ein Fehler, den der Pruefstand wirft — erkennbar an seinem Namen. */
export class PruefstandFehler extends Error {
  constructor(text) {
    super(text)
    this.name = 'PruefstandFehler'
  }
}

/**
 * Eine gefaelschte Antwort, wie `fetch` sie liefert — aber nur so viel davon,
 * wie der Vertrag zusagt: `ok`, `status` und `text()`.
 *
 * ABSICHTLICH KARG. Wer im Pruefstand `antwort.json()` benutzen kann, schreibt
 * ein Plugin, das auf der Box an einer fehlenden Methode zerbricht — der
 * Kontext gibt eine echte `Response`, aber verlassen sollte man sich nur auf
 * das Zugesagte.
 */
export function antwort(text, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => text,
  }
}

/**
 * Der gefaelschte Kontext.
 *
 * @param antworten  Adresse -> Text, oder Adresse -> Funktion(adresse), oder
 *                   eine einzelne Funktion fuer alles. Fehlt eine Adresse,
 *                   wirft `holen` — ein stilles `undefined` waere ein Test,
 *                   der etwas anderes prueft als gedacht.
 * @param netz       false laesst `holen` WEG (nicht: wirft). Genau so verhaelt
 *                   sich die Box ohne das Recht `netz`.
 * @param einstellungen  was die Eltern eingestellt haetten.
 *
 * Zurueck kommt `{ k, geholt, protokoll }` — `k` ist der Kontext, `geholt`
 * sammelt die abgefragten Adressen in Reihenfolge, `protokoll` die Zeilen aus
 * `kontext.protokoll(...)`.
 */
export function kontext({ antworten = {}, netz = true, einstellungen = {} } = {}) {
  const geholt = []
  const protokoll = []

  const k = {
    protokoll: (text) => protokoll.push(String(text)),
    einstellungen: Object.freeze({ ...einstellungen }),
  }

  if (netz) {
    k.holen = async (adresse) => {
      geholt.push(adresse)

      // DER LOOPBACK-RIEGEL, HIER NACHGEBILDET — und zwar nur er.
      //
      // Auf der Box verwehrt `kontext.holen` den Zugriff auf die eigene
      // Maschine (plugin-laufwerk.ts): sonst waere ein Plugin, das
      // 127.0.0.1:5005 anruft, ein Abspielbefehl an der Kinderzeit vorbei.
      // Ohne diese Zeile faende ein Entwickler den Fehler erst auf dem Geraet.
      //
      // ES IST EINE NACHBILDUNG UND KANN VERALTEN. Massgeblich bleibt das
      // Laufwerk; `tools/plugin-pruefen.mjs` laeuft dagegen und faengt jede
      // Abweichung. Was hier fehlt, ist die Liste der eigenen LAN-Adressen —
      // die kennt nur die Box.
      let u
      try {
        u = new URL(adresse)
      } catch {
        throw new PruefstandFehler(`"${adresse}" ist keine gueltige Adresse`)
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        throw new PruefstandFehler(`nur http und https, nicht "${u.protocol}"`)
      }
      const wirt = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
      if (wirt === 'localhost' || wirt === '::1' || wirt.startsWith('127.')) {
        throw new PruefstandFehler('die eigene Box ist kein Ziel fuer Plugins')
      }

      if (typeof antworten === 'function') return antworten(adresse)
      const a = antworten[adresse]
      if (a === undefined) {
        throw new PruefstandFehler(
          `Der Pruefstand kennt "${adresse}" nicht.\n` +
            `Bekannt sind: ${Object.keys(antworten).join(', ') || '(nichts)'}\n` +
            'Trag die Adresse in `antworten` ein, oder gib eine Funktion fuer alles.',
        )
      }
      if (typeof a === 'function') return a(adresse)
      if (typeof a === 'string') return antwort(a)
      return a
    }
  }

  return { k, geholt, protokoll }
}

/**
 * Die Form eines Fundes grob nachsehen — als FREUNDLICHER Hinweis beim
 * Schreiben, nicht als Urteil.
 *
 * Das Urteil faellt der Kern (`fundPruefen` in plugin-vertrag.ts) und ist
 * strenger: er kennt die Medienwurzel dieser Box, und er laesst `file:` nicht
 * durch. Diese Funktion sagt nur, ob ueberhaupt die richtigen Felder dastehen —
 * damit ein Test „titel.name fehlt" meldet statt „undefined is not an object".
 */
export function formStimmt(fund) {
  const maengel = []
  if (!fund || typeof fund !== 'object') return ['kein Objekt zurueckgegeben']
  if (!fund.titel || typeof fund.titel.name !== 'string' || !fund.titel.name.trim()) {
    maengel.push('`titel.name` fehlt oder ist leer')
  }
  if (!fund.quelle) {
    maengel.push('`quelle` fehlt')
  } else {
    if (fund.quelle.art !== 'strom' && fund.quelle.art !== 'datei') {
      maengel.push(`\`quelle.art\` muss "strom" oder "datei" sein, nicht "${String(fund.quelle.art)}"`)
    }
    if (typeof fund.quelle.adresse !== 'string' || !fund.quelle.adresse.trim()) {
      maengel.push('`quelle.adresse` fehlt oder ist leer')
    }
  }
  return maengel
}
