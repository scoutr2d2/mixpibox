/**
 * Webhook — ein POST mit JSON, fuer die Hausautomatisierung.
 *
 * Dieselbe Regel wie bei allen Kanaelen: die Meldung liegt schon im
 * Posteingang, wenn dieser hier aufgerufen wird. Ein Fehler wird gemeldet,
 * nicht geworfen.
 *
 * ══ DIE ADRESSE DARF NICHT AUF DIE BOX ZEIGEN — UND ZWAR ZWEIMAL NICHT ════
 *
 * `kontext.holen` verwehrt die eigene Box ohnehin (`adresseErlaubt` in
 * `plugin-laufwerk.ts`). Hier steht die Pruefung trotzdem noch einmal, aus
 * demselben Grund wie bei der Ollama-Adresse: der Riegel wirft eine Meldung,
 * die von einem Zaun handelt und nicht von dem, was der Betreiber falsch
 * eingetragen hat. Wer „http://localhost:1880/mupibox" einträgt, meint einen
 * Node-RED auf der Box — und soll lesen, warum das nicht geht, statt einen
 * Fehler zu sehen, der nach einem Fehler der Erweiterung aussieht.
 */

export const id = 'webhook'
export const name = 'Webhook (POST)'

export function bereit(einst) {
  const adresse = String(einst?.webhookAdresse ?? '').trim()
  if (!adresse) return { ok: false, grund: null }
  let u
  try {
    u = new URL(adresse)
  } catch {
    return { ok: false, grund: `"${adresse}" ist keine Adresse.` }
  }
  const wirt = u.hostname.toLowerCase()
  if (wirt === 'localhost' || wirt === '::1' || wirt.startsWith('127.')) {
    return {
      ok: false,
      grund: 'Die eigene Box ist fuer ein Plugin kein Ziel. Trag die Adresse eines anderen Rechners ein.',
    }
  }
  return { ok: true, grund: null, adresse }
}

export default {
  id,
  name,
  bereit,

  async senden(ereignis, umgebung) {
    const zustand = bereit(umgebung.einstellungen)
    if (!zustand.ok) return { ok: false, text: zustand.grund ?? 'nicht eingerichtet' }
    if (!umgebung.holen) return { ok: false, text: 'Dem Plugin fehlt das Recht "netz".' }

    try {
      const antwort = await umgebung.holen(zustand.adresse, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'User-Agent': umgebung.nutzerKennung },
        // DAS EREIGNIS WOERTLICH, ohne Umformung: der Empfaenger ist fremder
        // Code, und was er braucht, weiss er besser als dieses Plugin.
        body: JSON.stringify(ereignis),
      })
      if (!antwort.ok) return { ok: false, text: `Webhook antwortete mit ${antwort.status}` }
      return { ok: true, text: 'zugestellt' }
    } catch (fehler) {
      return { ok: false, text: String(fehler?.message ?? fehler) }
    }
  },
}
