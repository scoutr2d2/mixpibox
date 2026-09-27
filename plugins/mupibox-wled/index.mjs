/**
 * WLED-Licht — das Musterplugin fuer EREIGNISSE.
 *
 * Das Podcast-Plugin daneben zeigt die andere Haelfte des Vertrags: eine
 * Medienquelle, die etwas abspielbar macht. Dieses hier spielt gar nichts —
 * es HORCHT und schaltet ein Licht.
 *
 * ES HAT ABSICHTLICH KEIN `medienquelle`-RECHT. In `plugin.json` stehen nur
 * `ereignisse` und `netz`. Damit ist auch gezeigt, dass die Rechte einzeln
 * greifen: dieses Plugin kann nicht aufloesen, und es wird nie gefragt.
 *
 * WAS ES TUT
 *
 *   wiedergabeGestartet  Licht an, mit der eingestellten Helligkeit
 *   wiedergabeGestoppt   Licht aus (wenn eingeschaltet)
 *   kinderzeitEnde       Licht aus — IMMER, egal was eingestellt ist
 *   lautstaerke          Helligkeit folgt der Lautstaerke (wenn eingeschaltet)
 *
 * WLED-SCHNITTSTELLE: der alte, schlichte Weg
 * (http://<geraet>/win&T=1&A=128). Absichtlich nicht die JSON-Schnittstelle:
 * ein GET ohne Rumpf ist leichter zu lesen, leichter zu pruefen, und dieses
 * Plugin soll eine Vorlage sein.
 */

/** 0..255, und alles andere wird hineingebogen statt zu werfen. */
function helligkeitAus(wert, vorgabe) {
  const n = Number(wert)
  if (!Number.isFinite(n)) return vorgabe
  return Math.max(0, Math.min(255, Math.round(n)))
}

export default {
  /**
   * @param {string} name     wiedergabeGestartet | wiedergabeGestoppt | lautstaerke | kinderzeitEnde
   * @param {object} nutzlast je nach Ereignis, siehe unten
   * @param {object} kontext  protokoll, einstellungen, holen
   */
  async ereignis(name, nutzlast, kontext) {
    const e = kontext.einstellungen
    const adresse = String(e.adresse ?? '').trim()

    // OHNE ADRESSE TUT ES NICHTS — und sagt es EINMAL, nicht bei jedem
    // Ereignis. Ein Plugin, das bei jedem Kacheltipp eine Zeile ins Journal
    // schreibt, macht das Journal unlesbar; genau dort sucht man spaeter.
    if (!adresse) {
      if (!this._gemeckert) {
        this._gemeckert = true
        kontext.protokoll('keine Adresse eingestellt — das Licht bleibt aus dem Spiel')
      }
      return
    }
    if (!kontext.holen) throw new Error('Dem Plugin fehlt das Recht "netz" in plugin.json.')

    const voll = helligkeitAus(e.helligkeit, 128)
    let befehl = null

    switch (name) {
      case 'wiedergabeGestartet':
        befehl = `T=1&A=${voll}`
        break

      case 'wiedergabeGestoppt':
        // `nutzlast.verb` sagt, ob angehalten oder pausiert wurde. Hier ist
        // beides dasselbe; wer den Unterschied braucht, hat ihn.
        if (e.ausBeimAnhalten) befehl = 'T=0'
        break

      case 'kinderzeitEnde':
        // OHNE WENN UND ABER. Schlafenszeit ist etwas anderes als „jemand hat
        // angehalten": ein Licht, das nachts anbleibt, weil ein Schalter auf
        // „aus" steht, ist genau der Fall, den Eltern nicht erwarten.
        befehl = 'T=0'
        kontext.protokoll(`Kinderzeit zu Ende (${nutzlast?.grund ?? 'ohne Grund'}) — Licht aus`)
        break

      case 'lautstaerke':
        if (!e.helligkeitFolgtLautstaerke) break
        // Lautstaerke kommt als 0..100, Helligkeit will 0..255 — und mehr als
        // die eingestellte Helligkeit soll es nie werden.
        befehl = `A=${Math.round((helligkeitAus(nutzlast?.wert, 0) / 100) * voll)}`
        break
    }

    if (!befehl) return
    const antwort = await kontext.holen(`http://${adresse}/win&${befehl}`)
    if (!antwort.ok) throw new Error(`WLED antwortete mit ${antwort.status}`)
  },

  async befinden(kontext) {
    const adresse = String(kontext.einstellungen.adresse ?? '').trim()
    if (!adresse) return { ok: false, text: 'keine Adresse eingestellt' }
    if (!kontext.holen) return { ok: false, text: 'Recht "netz" fehlt' }
    try {
      const antwort = await kontext.holen(`http://${adresse}/win`)
      return antwort.ok ? { ok: true, text: `${adresse} antwortet` } : { ok: false, text: `Antwort ${antwort.status}` }
    } catch (f) {
      return { ok: false, text: `${adresse} nicht erreichbar: ${f.message}` }
    }
  },
}
