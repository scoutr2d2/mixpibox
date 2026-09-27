/**
 * ntfy — eine Meldung aufs Telefon.
 *
 * ══ DIE REGEL, DIE UEBER ALLEN KANAELEN STEHT ═════════════════════════════
 *
 * EIN KANAL DARF NIE DER GRUND SEIN, WARUM EINE MELDUNG VERLORENGEHT. Die
 * Nachricht liegt IMMER zuerst im Posteingang; die Kanaele daneben sind
 * Zustellversuche. Faellt einer aus, meldet er das und die anderen laufen
 * weiter — deshalb wirft `senden()` hier nicht, sondern gibt `{ ok, text }`
 * zurueck, und deshalb ruft der Wirt sie mit `allSettled`.
 *
 * Das ist Abnahmekriterium 8 des Entwurfs („ntfy deaktiviert oder nicht
 * erreichbar → Ereignis liegt trotzdem in der Inbox"), und es ist nicht nur
 * ein Kriterium: eine Benachrichtigung, die beim Ausfall des Zustellwegs
 * SPURLOS verschwindet, ist schlimmer als gar keine — man verlaesst sich auf
 * sie und erfaehrt nie, dass sie ausgefallen ist.
 */

export const id = 'ntfy'
export const name = 'ntfy (Push)'

/**
 * Ist der Kanal benutzbar?
 *
 * NICHT „eingeschaltet", sondern „vollstaendig eingerichtet". Ein Thema ohne
 * Adresse und eine Adresse ohne Thema sind beides halbe Einrichtungen, und
 * eine halbe Einrichtung soll sagen, was fehlt, statt bei jeder Meldung einen
 * Fehler zu erzeugen.
 */
export function bereit(einst) {
  const adresse = String(einst?.ntfyAdresse ?? '').trim()
  const thema = String(einst?.ntfyThema ?? '').trim()
  if (!adresse && !thema) return { ok: false, grund: null }
  if (!adresse) return { ok: false, grund: 'Thema eingetragen, aber keine Adresse.' }
  if (!thema) return { ok: false, grund: 'Adresse eingetragen, aber kein Thema.' }
  return { ok: true, grund: null, adresse, thema }
}

export default {
  id,
  name,
  bereit,

  async senden(ereignis, umgebung) {
    const zustand = bereit(umgebung.einstellungen)
    if (!zustand.ok) return { ok: false, text: zustand.grund ?? 'nicht eingerichtet' }
    if (!umgebung.holen) return { ok: false, text: 'Dem Plugin fehlt das Recht "netz".' }

    let ziel
    try {
      ziel = new URL(zustand.thema, zustand.adresse.endsWith('/') ? zustand.adresse : `${zustand.adresse}/`)
    } catch {
      return { ok: false, text: `"${zustand.adresse}" ist keine Adresse.` }
    }

    const titel = ereignis.art === 'veroeffentlichung' ? `Neu von ${ereignis.interpret}` : `Neu aehnlich: ${ereignis.interpret}`
    const text =
      ereignis.art === 'veroeffentlichung'
        ? `${ereignis.nutzlast?.titel ?? '?'}${ereignis.nutzlast?.erschienen ? ` (${ereignis.nutzlast.erschienen})` : ''}`
        : `${ereignis.nutzlast?.name ?? '?'} passt jetzt dazu`

    try {
      const antwort = await umgebung.holen(ziel.toString(), {
        method: 'POST',
        headers: {
          'User-Agent': umgebung.nutzerKennung,
          // ntfy nimmt Titel und Kennzeichen ueber Kopfzeilen entgegen; der
          // Rumpf ist der reine Text. Umlaute gehoeren deshalb NICHT in den
          // Titel-Kopf — Kopfzeilen sind latin-1, und ein „ö" kaeme als
          // Fragezeichen an oder wuerfe beim Senden.
          Title: titel.normalize('NFD').replace(/\p{M}+/gu, ''),
          Tags: ereignis.art === 'veroeffentlichung' ? 'new,headphones' : 'sparkles',
        },
        body: text,
      })
      if (!antwort.ok) return { ok: false, text: `ntfy antwortete mit ${antwort.status}` }
      return { ok: true, text: `an ${zustand.thema} gemeldet` }
    } catch (fehler) {
      return { ok: false, text: String(fehler?.message ?? fehler) }
    }
  },
}
