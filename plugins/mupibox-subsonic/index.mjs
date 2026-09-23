/**
 * SUBSONIC / NAVIDROME — das Musterplugin MIT ZUGANGSDATEN.
 *
 * Die beiden anderen zeigen je eine Haelfte des Vertrags: `mupibox-podcast`
 * eine Medienquelle ohne Anmeldung, `mupibox-wled` das Horchen auf Ereignisse.
 * Dieses hier zeigt den Fall, den die meisten echten Erweiterungen haben —
 * ein Dienst, der einen Benutzer und ein Passwort will. Und es ist das
 * einzige, das `suchen` benutzt.
 *
 * WARUM SUBSONIC: die Schnittstelle ist alt, schlicht und wird von Navidrome,
 * Airsonic, Gonic und einem halben Dutzend anderer gesprochen. Wer seine Musik
 * selbst hostet, hat sie meist schon.
 *
 * ── DAS PASSWORT GEHT NIE IM KLARTEXT HINAUS ──────────────────────────────
 *
 * Subsonic kennt beide Wege; dieses Plugin nimmt ausschliesslich den mit Salz
 * und Pruefsumme (`t` + `s`, seit API 1.13):
 *
 *     salz = 8 zufaellige Zeichen
 *     t    = md5(passwort + salz)
 *
 * Das Passwort selbst steht damit in keiner Adresse, in keinem Protokoll und
 * in keinem Mitschnitt. MD5 ist hier KEINE Sicherheitsaussage — es ist, was
 * die Schnittstelle vorschreibt; die Sicherheit kommt vom https davor. Wer
 * http benutzt, gibt alles preis, und deshalb steht das auch im Hinweis.
 *
 * `node:crypto` IST ERLAUBT. Ein Plugin laeuft in einem worker_thread, und der
 * hat den vollen Node-Umfang — das ist ausdruecklich so dokumentiert
 * (plugins/README.md: „Absturztrennung, keine Sicherheitstrennung"). Ein
 * eigener MD5 in JavaScript waere hundert Zeilen mehr und keine Zeile besser.
 *
 * MEDIENKENNUNG
 *
 *   mupibox-subsonic:<titel-id>      eine Titel-Kennung des Servers
 *
 * Die Kennungen findet man ueber `suchen`.
 */

import { createHash, randomBytes } from 'node:crypto'

/** Was jede Anfrage an Subsonic braucht. */
function anmeldung(e) {
  const salz = randomBytes(4).toString('hex')
  const marke = createHash('md5')
    .update(String(e.passwort ?? '') + salz)
    .digest('hex')
  return new URLSearchParams({
    u: String(e.benutzer ?? ''),
    t: marke,
    s: salz,
    v: '1.16.1',
    c: 'mupibox',
    f: 'json',
  })
}

/** Adresse ohne Schraegstrich am Ende — sonst entsteht `//rest/…`. */
function wurzel(e) {
  return String(e.adresse ?? '')
    .trim()
    .replace(/\/+$/, '')
}

function pfad(e, weg, zusatz = {}) {
  const p = anmeldung(e)
  for (const [k, v] of Object.entries(zusatz)) p.set(k, String(v))
  return `${wurzel(e)}/rest/${weg}?${p.toString()}`
}

/**
 * Subsonic antwortet IMMER mit HTTP 200 — auch bei falschem Passwort.
 *
 * Der Fehler steht im Rumpf (`subsonic-response.status === 'failed'`). Wer nur
 * `antwort.ok` prueft, haelt eine abgelehnte Anmeldung fuer einen Erfolg und
 * sucht den Fehler danach an der falschen Stelle. Dieselbe Falle wie beim
 * Abspieldienst der Box, der ebenfalls auf jeden Pfad mit 200 antwortet.
 */
async function fragen(kontext, weg, zusatz) {
  if (!kontext.holen) throw new Error('Dem Plugin fehlt das Recht "netz" in plugin.json.')
  const e = kontext.einstellungen
  if (!wurzel(e)) throw new Error('Es ist keine Serveradresse eingestellt.')

  const antwort = await kontext.holen(pfad(e, weg, zusatz))
  if (!antwort.ok) throw new Error(`Der Server antwortete mit ${antwort.status}.`)
  let d
  try {
    d = JSON.parse(await antwort.text())
  } catch {
    throw new Error('Der Server antwortete nicht mit JSON — ist die Adresse richtig?')
  }
  const r = d?.['subsonic-response']
  if (!r) throw new Error('Die Antwort sieht nicht nach Subsonic aus.')
  if (r.status === 'failed') {
    // Code 40 ist „falscher Benutzer oder falsches Passwort" — der haeufigste
    // Fall, und der einzige, bei dem der Benutzer selbst etwas tun kann.
    const m = r.error?.message || 'ohne Begruendung'
    throw new Error(r.error?.code === 40 ? `Anmeldung abgelehnt: ${m}` : `Der Server meldet: ${m}`)
  }
  return r
}

export default {
  /** Eine Titel-Kennung zu einem abspielbaren Strom machen. */
  async aufloesen(rest, kontext) {
    const id = String(rest || '').trim()
    if (!id) throw new Error('Es fehlt die Titel-Kennung.')

    const r = await fragen(kontext, 'getSong', { id })
    const s = r.song
    if (!s) throw new Error(`Der Server kennt den Titel "${id}" nicht.`)

    kontext.protokoll(`aufgeloest: ${s.title ?? id}`)
    return {
      titel: {
        name: String(s.title ?? id),
        kuenstler: s.artist ? String(s.artist) : undefined,
        // DAS BILD BEKOMMT EIGENE ANMELDEDATEN. Jede Adresse traegt ihr eigenes
        // Salz; eine wiederverwendete waere nicht falsch, aber Subsonic laesst
        // Marken altern, und ein Bild, das Stunden spaeter geladen wird,
        // scheiterte dann still.
        bild: s.coverArt ? pfad(kontext.einstellungen, 'getCoverArt', { id: s.coverArt, size: 500 }) : undefined,
        dauerSek: Number.isFinite(Number(s.duration)) ? Number(s.duration) : undefined,
      },
      // DIE ANMELDUNG STECKT IN DER ADRESSE, weil mpv sie so bekommt. Genau
      // deshalb geht das Passwort nur als Marke hinaus und nie im Klartext:
      // diese Adresse steht danach in `/player/local` und im Journal.
      quelle: { art: 'strom', adresse: pfad(kontext.einstellungen, 'stream', { id, format: 'mp3' }) },
    }
  },

  /** Titel suchen. Das einzige Musterplugin, das das kann. */
  async suchen(begriff, kontext) {
    const wieviele = Number(kontext.einstellungen.treffer) || 20
    const r = await fragen(kontext, 'search3', {
      query: String(begriff || ''),
      songCount: wieviele,
      albumCount: 0,
      artistCount: 0,
    })
    const lieder = r.searchResult3?.song ?? []
    kontext.protokoll(`"${begriff}": ${lieder.length} Treffer`)
    return lieder.map((s) => ({
      name: String(s.title ?? s.id),
      kuenstler: s.artist ? String(s.artist) : undefined,
      dauerSek: Number.isFinite(Number(s.duration)) ? Number(s.duration) : undefined,
    }))
  },

  async befinden(kontext) {
    const e = kontext.einstellungen
    if (!wurzel(e)) return { ok: false, text: 'keine Serveradresse eingestellt' }
    if (!String(e.benutzer ?? '').trim()) return { ok: false, text: 'kein Benutzername eingestellt' }
    if (!String(e.passwort ?? '')) return { ok: false, text: 'kein Passwort hinterlegt' }
    // UND EIN HINWEIS, DER MEHR WERT IST ALS EIN HAKEN: ueber http geht das
    // Salz zwar verschluesselt, der Rest aber offen — und ein Kind hoert
    // Musik ueber ein Netz, in dem auch Gaeste sind.
    if (wurzel(e).startsWith('http://')) {
      try {
        await fragen(kontext, 'ping', {})
        return { ok: true, text: 'erreichbar — aber ueber http, nicht https' }
      } catch (f) {
        return { ok: false, text: f.message }
      }
    }
    try {
      await fragen(kontext, 'ping', {})
      return { ok: true, text: `${wurzel(e)} antwortet` }
    } catch (f) {
      return { ok: false, text: f.message }
    }
  },
}
