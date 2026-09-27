/**
 * Die Inhalts-Quelle — Aehnlichkeit nach THEMA, nicht nach Hoerverhalten.
 *
 * ══ WARUM ES DIESE QUELLE GIBT ════════════════════════════════════════════
 *
 * Alle anderen Quellen hier messen dasselbe: wer HOERT dasselbe. Das ist bei
 * Musik eine gute Frage und bei Kinderhoerspielen eine schlechte, weil die
 * Antwort fast immer „alles, was Vierjaehrige hoeren" lautet. Ein Kind, das
 * „Pettersson und Findus" hoert — eine ruhige Geschichte ueber einen alten
 * Mann, einen Kater und einen Bauernhof — bekommt dann „Paw Patrol"
 * vorgeschlagen, weil beide dieselbe Altersgruppe bedienen.
 *
 * Diese Quelle beantwortet stattdessen: wovon HANDELT es? Sie ist die einzige,
 * die „Bauernhof, Tiere, ruhig" von „Einsatzfahrzeuge, Action" unterscheiden
 * kann — und deshalb steht ihr Gewicht in der Vorgabe hoeher als das der
 * anderen.
 *
 * ══ ZWEI WEGE, UND DER ZWEITE IST DER, DER IMMER GEHT ═════════════════════
 *
 *   1. Einbettungen ueber Ollama, Kosinus zwischen den Vektoren.
 *   2. Jaccard ueber die Schlagworte — kein Netz, kein Modell, kein Dienst.
 *
 * Weg 1 ist der bessere und der unwahrscheinlichere. Weg 2 ist der, der auf
 * einer Box im Keller um drei Uhr nachts funktioniert. Deshalb ist Weg 2 der
 * Normalfall und Weg 1 die Zugabe — nicht umgekehrt.
 *
 * ══ DIE FALLE MIT OLLAMA, GEGEN DIE HIER GEBAUT IST ═══════════════════════
 *
 * Der Entwurf nannte als Vorgabe `http://localhost:11434`. DAS KANN HIER NICHT
 * FUNKTIONIEREN: `kontext.holen` verwehrt `127.0.0.0/8`, `localhost` und die
 * eigenen Adressen der Box (`adresseErlaubt` in `plugin-laufwerk.ts`) — der
 * Riegel gegen den kurzen Weg an der Kinderzeit vorbei. Ein Plugin, das
 * `localhost:11434` eingetragen bekommt, faengt sich bei JEDER Anfrage einen
 * Wurf und faellt auf Jaccard zurueck, ohne dass jemand versteht, warum.
 *
 * Deshalb: die Vorgabe ist LEER (= aus), und wer Ollama benutzen will, traegt
 * die Adresse eines ANDEREN Rechners im Netz ein. Ein `localhost` im Feld wird
 * hier abgefangen und in Worte gefasst, statt an der Adressenpruefung zu
 * zerschellen.
 */

import { normalName } from '../normalisieren.mjs'

export const id = 'inhalt'
export const name = 'Inhalt (Themenkarte)'
export const brauchtZugang = false

/**
 * Gewicht der Vorgabe — hoeher als die Hoerdaten-Quellen, siehe oben.
 * Der Betreiber kann es herunterdrehen; die Begruendung fuer den Anfangswert
 * steht hier und nicht in einer Tabelle irgendwo.
 */
export const GEWICHT_VORGABE = 1.5

/**
 * Aehnlichkeit ueber Schlagworte — Jaccard, gewichtet.
 *
 * Reine Jaccard-Zahl waere `|A ∩ B| / |A ∪ B|`. Hier steht eine Abwandlung,
 * und der Grund ist gemessen an den Daten selbst: Serien mit VIELEN
 * Schlagworten wuerden sonst systematisch verlieren, weil ihre Vereinigung mit
 * allem gross ist. „Die Sendung mit der Maus" hat neun Schlagworte und traefe
 * damit nie jemanden, obwohl sie thematisch breit UND passend ist.
 *
 * Deshalb: der Schnitt wird an der KLEINEREN der beiden Mengen gemessen und
 * mit der reinen Jaccard-Zahl gemittelt. Das haelt breite Eintraege im Spiel,
 * ohne sie zu Siegern zu machen.
 */
export function jaccard(a, b) {
  const mengeA = new Set((a ?? []).map((t) => normalName(t)).filter(Boolean))
  const mengeB = new Set((b ?? []).map((t) => normalName(t)).filter(Boolean))
  if (mengeA.size === 0 || mengeB.size === 0) return 0

  let schnitt = 0
  for (const t of mengeA) if (mengeB.has(t)) schnitt++
  if (schnitt === 0) return 0

  const vereinigung = mengeA.size + mengeB.size - schnitt
  const reinesJaccard = schnitt / vereinigung
  const anteilKleinere = schnitt / Math.min(mengeA.size, mengeB.size)
  return (reinesJaccard + anteilKleinere) / 2
}

/** Kosinus zwischen zwei Vektoren gleicher Laenge. Rein. */
export function kosinus(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0
  let punkt = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    punkt += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return punkt / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Der Text, aus dem eine Einbettung gerechnet wird — und aus dem der Hash
 * gebildet wird, der entscheidet, ob neu gerechnet werden muss.
 *
 * BEIDES AUS DERSELBEN FUNKTION, das ist der Punkt: baute der Hash auf einem
 * anderen Text als die Einbettung, koennte sich die Beschreibung aendern, ohne
 * dass der Hash es merkt — und die Box rechnete monatelang mit dem Vektor
 * eines Textes, den es nicht mehr gibt.
 */
export function einbettungsText(satz) {
  return [satz?.name ?? '', (satz?.tags ?? []).join(', '), satz?.beschreibung ?? ''].join('\n').trim()
}

/**
 * Ein billiger, stabiler Hash (FNV-1a, 32 bit) als Hexzeichenkette.
 *
 * `node:crypto` waere hier erlaubt (ein Worker hat den vollen Node-Umfang),
 * aber unnoetig: es geht nicht um Faelschungssicherheit, sondern um die Frage
 * „hat sich der Text geaendert?". Dafuer reicht das hier und laeuft ohne
 * Import.
 */
export function textHash(text) {
  let h = 0x811c9dc5
  const s = String(text ?? '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * Ollama nach einer Einbettung fragen.
 *
 * Zurueck kommt der Vektor oder `null` — NIE ein Wurf. Diese Quelle muss ohne
 * Ollama funktionieren, und ein Dienst, der gerade nicht da ist, ist der
 * Normalfall, nicht der Fehlerfall.
 */
export async function einbettungHolen(text, { adresse, modell, holen, protokoll }) {
  if (!adresse || !holen) return null
  let ziel
  try {
    ziel = new URL('/api/embeddings', adresse)
  } catch {
    protokoll?.(`Ollama-Adresse "${adresse}" ist keine Adresse — es bleibt bei den Schlagworten.`)
    return null
  }
  // SIEHE DEN KOPF DIESER DATEI. Lieber hier ein klarer Satz als draussen ein
  // Wurf aus dem Adressenriegel, den niemand zuordnen kann.
  const wirt = ziel.hostname.toLowerCase()
  if (wirt === 'localhost' || wirt === '::1' || wirt.startsWith('127.')) {
    protokoll?.(
      'Ollama auf localhost ist fuer ein Plugin nicht erreichbar (Riegel gegen den kurzen Weg). ' +
        'Trag die Adresse eines anderen Rechners ein — bis dahin gelten die Schlagworte.',
    )
    return null
  }

  try {
    const antwort = await holen(ziel.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: modell, prompt: text }),
    })
    if (!antwort.ok) {
      protokoll?.(`Ollama antwortete mit ${antwort.status} — es bleibt bei den Schlagworten.`)
      return null
    }
    const rumpf = JSON.parse(await antwort.text())
    const vektor = rumpf?.embedding
    if (!Array.isArray(vektor) || vektor.length === 0) return null
    return vektor
  } catch (fehler) {
    protokoll?.(`Ollama nicht erreichbar (${fehler?.message ?? fehler}) — es bleibt bei den Schlagworten.`)
    return null
  }
}

/**
 * Die Quelle selbst.
 *
 * `saetze` sind die Datensaetze (Startbestand + eigene), `vektoren` die
 * Kartei mit den Einbettungen. Beides reicht der Wirt herein, statt dass diese
 * Datei sich das Dateisystem selbst sucht — dasselbe Muster wie beim Kontext:
 * was gebraucht wird, reist mit.
 */
/**
 * Alle Namen, unter denen ein Datensatz zu finden ist — Hauptname und `auch`.
 *
 * Die Aliase sind keine Bequemlichkeit: die Box nennt dieselbe Serie anders
 * als jeder Katalog, und zwar durchgehend („Die Maus", „Major Tom",
 * „Ruby van der Bogen"). Ohne sie ist die Themenkarte fuer den echten Bestand
 * zur Haelfte blind.
 */
export function namenVon(satz) {
  return [satz?.name, ...(Array.isArray(satz?.auch) ? satz.auch : [])].map((n) => normalName(n)).filter(Boolean)
}

export function quelleBauen(saetze) {
  const alsRef = (satz) => ({ quellenId: id, name: satz.name, mbid: satz.mbid, extra: { satz } })

  return {
    id,
    name,
    brauchtZugang,

    /**
     * Ein Name → der Datensatz, falls es einen gibt.
     *
     * DREI STUFEN, UND JEDE IST AN EINEM ECHTEN FALL AUS DEM BESTAND DER BOX
     * GEMESSEN (66 Eintraege, abgefragt am 06.09.2026):
     *
     *   1. MBID — wo es eine gibt, ist sie die Wahrheit.
     *   2. Name oder ALIAS. Die Box fuehrt „Die Maus", die Themenkarte
     *      „Die Sendung mit der Maus"; ohne `auch` faende sich der
     *      meistgehoerte Eintrag der Box nicht.
     *   3. EIN TEIL EINES MEHRFACHFELDES. Das `artist`-Feld der Box ist NICHT
     *      ein Interpret: dort steht „Ruby van der Bogen, 101 fabelhafte
     *      Freunde" und „Team Karacho, ANOTHER NGUYEN". Wer das Feld als einen
     *      Namen nimmt, findet nichts — und zwar bei 9 von 66 Eintraegen, dem
     *      groessten Posten im ganzen Bestand.
     */
    async aufloesen(frage) {
      const gesucht = normalName(frage?.name)
      if (!gesucht) return null

      if (frage?.mbid) {
        const perMbid = saetze.find((s) => s.mbid && s.mbid === frage.mbid)
        if (perMbid) return alsRef(perMbid)
      }

      const genau = saetze.find((s) => namenVon(s).includes(gesucht))
      if (genau) return alsRef(genau)

      // Stufe 3: das Feld zerlegen und jeden Teil einzeln probieren.
      //
      // ZERLEGT WIRD DER ROHE NAME, NICHT DER NORMALISIERTE — und das ist der
      // Fehler, den diese Zeile teuer gelernt hat: `normalName` macht aus
      // jedem Komma ein Leerzeichen. Wer danach am Komma trennen will, findet
      // keines mehr und probiert die ganze Kette als einen Namen. Am Bestand
      // gemessen: „Team Karacho, ANOTHER NGUYEN" blieb dabei unauffindbar,
      // obwohl „Team Karacho" in der Karte steht.
      for (const teil of String(frage.name).split(/\s*[,;/&]\s*|\s+feat\.?\s+/iu)) {
        const t = normalName(teil)
        // ZU KURZE STUECKE WERDEN NICHT PROBIERT. „Die Maus, Eva mit Gitarre,
        // Der Elefant" zerfaellt sonst in Teile wie „der", und ein Zweibuchstabe
        // trifft irgendwann irgendetwas.
        if (t.length < 4) continue
        const treffer = saetze.find((s) => namenVon(s).includes(t))
        if (treffer) return alsRef(treffer)
      }
      return null
    },

    /**
     * Die aehnlichsten Datensaetze.
     *
     * NULL-TREFFER FALLEN HERAUS, nicht erst hinten. Ein Wert von 0 heisst
     * „kein einziges gemeinsames Schlagwort" — das ist keine schwache
     * Aehnlichkeit, sondern gar keine, und sie hat im Ergebnis nichts
     * verloren. Ohne diese Zeile stuenden am Ende der Liste beliebige
     * Eintraege in alphabetischer Ordnung und saehen aus wie Vorschlaege.
     */
    async aehnlich(ref, grenze, umgebung) {
      const eigener = ref?.extra?.satz
      if (!eigener) return []

      const eigenerVektor = await vektorFuer(eigener, umgebung)

      const bewertet = []
      for (const anderer of saetze) {
        if (anderer === eigener || normalName(anderer.name) === normalName(eigener.name)) continue

        let punkte = jaccard(eigener.tags, anderer.tags)
        if (eigenerVektor) {
          const andererVektor = await vektorFuer(anderer, umgebung)
          // KOSINUS ERSETZT JACCARD NICHT, ER ERGAENZT IHN. Die Schlagworte
          // sind von Hand gepflegt und damit die verlaesslichere Auskunft;
          // die Einbettung faengt, was in der Beschreibung steht und in
          // keinem Schlagwort. Der Mittelwert nimmt beides ernst.
          if (andererVektor) punkte = (punkte + Math.max(0, kosinus(eigenerVektor, andererVektor))) / 2
        }

        if (punkte > 0) bewertet.push({ name: anderer.name, mbid: anderer.mbid, punkte })
      }

      return bewertet
        .sort((a, b) => b.punkte - a.punkte || String(a.name).localeCompare(String(b.name), 'de'))
        .slice(0, grenze)
        .map((t, i) => ({ ...t, rang: i + 1 }))
    },
  }

  /**
   * Der Vektor zu einem Datensatz — aus der Kartei, oder frisch gerechnet.
   *
   * NEU GERECHNET WIRD NUR BEI GEAENDERTEM TEXT (Hash-Vergleich). Ohne diese
   * Pruefung fragte jeder Aufruf fuer jeden Datensatz bei Ollama nach, und ein
   * Aufruf mit 30 Datensaetzen waere 30 Netzanfragen in einer 8-Sekunden-Frist.
   */
  async function vektorFuer(satz, umgebung) {
    if (!umgebung?.ollama?.adresse) return null
    const text = einbettungsText(satz)
    const hash = textHash(text)
    const schluessel = `${normalName(satz.name)}#${umgebung.ollama.modell}`

    const gemerkt = umgebung.vektoren?.holen(schluessel, 0)
    if (gemerkt?.wert?.hash === hash && Array.isArray(gemerkt.wert.vektor)) return gemerkt.wert.vektor

    const vektor = await einbettungHolen(text, {
      adresse: umgebung.ollama.adresse,
      modell: umgebung.ollama.modell,
      holen: umgebung.holen,
      protokoll: umgebung.protokoll,
    })
    if (!vektor) return null
    umgebung.vektoren?.setzen(schluessel, { hash, vektor })
    return vektor
  }
}
