/**
 * PODCAST — das Musterplugin der MuPiBox.
 *
 * Es loest einen beliebigen Podcast-Feed zu einer abspielbaren Folge auf. Wer
 * ein eigenes Plugin schreibt, kopiert am besten diese Datei: sie zeigt alles,
 * was der Vertrag hergibt, und nichts darueber hinaus.
 *
 * MEDIENKENNUNG
 *
 *   mupibox-podcast:https://example.org/feed.xml       neueste Folge
 *   mupibox-podcast:https://example.org/feed.xml#3     vierte Folge (ab 0)
 *
 * Was VOR dem ersten Doppelpunkt steht, ist die Kennung aus plugin.json — sie
 * ist der Namensraum und wird nicht gewaehlt, sondern abgeleitet. Alles
 * dahinter bekommt `aufloesen` als `rest`.
 *
 * KEINE ABHAENGIGKEITEN. Absicht: ein Plugin, das `npm install` auf einer Pi im
 * Kinderzimmer braucht, ist kein Plugin, sondern ein Nachmittag. Der
 * Feed-Leser unten ist deshalb von Hand geschrieben und bewusst einfach —
 * seine Grenzen stehen an ihm dran.
 */

/** Ein XML-Feld herausziehen. Reicht fuer RSS, ist KEIN XML-Leser. */
function feld(stueck, name) {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(stueck)
  if (!m) return ''
  return (
    m[1]
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // & ZULETZT, sonst wird aus "&amp;lt;" ein "<" statt eines "&lt;".
      .replace(/&amp;/g, '&')
      .trim()
  )
}

/** Die Tondatei einer Folge. In RSS steht sie als Anhang, nicht als Feld. */
function tonAus(stueck) {
  const m = /<enclosure\b[^>]*\burl\s*=\s*["']([^"']+)["'][^>]*>/i.exec(stueck)
  return m ? m[1].trim() : ''
}

/** "1800" oder "30:00" oder "01:30:00" → Sekunden. */
function dauerAus(text) {
  if (!text) return undefined
  if (/^\d+$/.test(text)) return Number(text)
  const teile = text.split(':').map(Number)
  if (teile.some((n) => !Number.isFinite(n))) return undefined
  return teile.reduce((summe, n) => summe * 60 + n, 0)
}

export default {
  /**
   * @param {string} rest      die Feed-Adresse, wahlweise mit "#<nummer>"
   * @param {object} kontext   protokoll, einstellungen, holen
   */
  async aufloesen(rest, kontext) {
    // OHNE NETZ-RECHT GIBT ES KEIN `holen` — nicht ein `holen`, das wirft.
    // Deshalb laesst sich hier eine verstaendliche Meldung geben, statt an
    // einem Fehler zu zerschellen, den der Benutzer nicht einordnen kann.
    if (!kontext.holen) throw new Error('Dem Plugin fehlt das Recht "netz" in plugin.json.')

    // Die Foliennummer haengt HINTEN, damit die Feed-Adresse unversehrt bleibt.
    let adresse = rest
    let nummer = 0
    const raute = rest.lastIndexOf('#')
    if (raute > 0 && /^\d+$/.test(rest.slice(raute + 1))) {
      adresse = rest.slice(0, raute)
      nummer = Number(rest.slice(raute + 1))
    }

    const antwort = await kontext.holen(adresse)
    if (!antwort.ok) throw new Error(`Feed antwortete mit ${antwort.status}`)
    const xml = await antwort.text()

    const sendung = feld(xml.slice(0, xml.indexOf('<item')), 'title') || 'Podcast'
    const folgen = xml.match(/<item[\s\S]*?<\/item>/gi) ?? []
    if (folgen.length === 0) throw new Error('Der Feed enthaelt keine Folgen.')
    if (nummer >= folgen.length) {
      throw new Error(`Folge ${nummer} gibt es nicht — der Feed hat ${folgen.length}.`)
    }

    const folge = folgen[nummer]
    const ton = tonAus(folge)
    // EIN FEED OHNE TONDATEI IST KEIN FEHLER DES BENUTZERS, sondern einer des
    // Anbieters — die Meldung soll das sagen, sonst sucht jemand bei sich.
    if (!ton) throw new Error(`Die Folge "${feld(folge, 'title')}" hat keine Tondatei im Feed.`)
    if (!/^https?:\/\//i.test(ton)) throw new Error(`Die Tondatei "${ton}" ist keine http-Adresse.`)

    kontext.protokoll(`${sendung}: Folge ${nummer} aufgeloest`)

    const bild = /<itunes:image\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(folge)?.[1]
    return {
      titel: {
        name: feld(folge, 'title') || `Folge ${nummer + 1}`,
        kuenstler: sendung,
        bild,
        dauerSek: dauerAus(feld(folge, 'itunes:duration')),
      },
      quelle: { art: 'strom', adresse: ton },
    }
  },

  async befinden(kontext) {
    if (!kontext.holen) return { ok: false, text: 'Recht "netz" fehlt' }
    return { ok: true, text: 'bereit' }
  },
}
