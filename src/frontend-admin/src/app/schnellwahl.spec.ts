/**
 * Der Waechter der Schnellwahl — die eine Stelle, an der sie gefaehrlich waere.
 *
 * Betreiber (15.08.2026): „ein quick select feature einbauen einen namen
 * wählen und dann nacheinander die zeilen wählen". In diesem Modus ist die
 * GANZE Zeile ein Schalter. Genau deshalb muss sie an den Stellen, die schon
 * etwas anderes bedeuten, NICHT schalten:
 *
 *   Titel und Interpret sind Eingabefelder. Wer dort hineinklickt, will
 *   tippen. Schaltete der Klick die Sichtbarkeit um, merkte es niemand — bis
 *   das Kind eine Sendung vermisst, und dann sucht man den Fehler bei der Box.
 *
 *   Die Profil-Haekchen und der Entfernen-Knopf sind selbst Schalter. Ein
 *   Klick darf nicht ZWEIMAL wirken und sich damit gleich wieder aufheben.
 *
 * Geprueft wird der Waechter an einer echten Zeile im echten Browser, weil
 * `closest()` ueber die Elternkette laeuft — eine nachgebaute Bedingung waere
 * eine Behauptung ueber den DOM, keine Messung an ihm.
 */
import { SCHNELL_NICHT_KLICKBAR } from './seiten/medien'

describe('Schnellwahl: was die Zeile schalten darf und was nicht', () => {
  let zeile: HTMLElement

  beforeEach(() => {
    zeile = document.createElement('li')
    zeile.innerHTML = `
      <img class="cover" id="bild">
      <span class="wer">
        <input class="titel" id="titel">
        <input class="interpret" id="interpret">
      </span>
      <span class="profilzeile">
        <span class="fuer" id="fuer">sichtbar für</span>
        <label class="schalter profilhaken" id="haken-beschriftung">
          <input type="checkbox" id="haken">Kalea
        </label>
      </span>
      <span class="marke" id="marke">Spotify<button class="weg" id="entfernen">×</button></span>
      <span id="freiflaeche">&nbsp;</span>`
    document.body.appendChild(zeile)
  })

  afterEach(() => zeile.remove())

  // Derselbe Ausdruck, den schnellKlick benutzt — als Konstante geteilt,
  // damit der Test nicht eine ZWEITE Fassung der Regel prueft.
  const schaltet = (id: string): boolean => {
    const el = document.getElementById(id)
    expect(el).withContext(`#${id} gibt es in der Zeile`).toBeTruthy()
    return !el!.closest(SCHNELL_NICHT_KLICKBAR)
  }

  it('schaltet NICHT im Titelfeld — dort will man tippen', () => {
    expect(schaltet('titel')).toBe(false)
  })

  it('schaltet NICHT im Interpretenfeld', () => {
    expect(schaltet('interpret')).toBe(false)
  })

  it('schaltet NICHT auf dem Haekchen selbst — sonst hebt es sich auf', () => {
    expect(schaltet('haken')).toBe(false)
  })

  it('schaltet NICHT auf der Beschriftung des Haekchens', () => {
    // Die Beschriftung ist ein <label>: ein Klick darauf loest das Haekchen
    // ohnehin schon aus. Beides zusammen waere ein Umschalten und sofort
    // wieder zurueck — also augenscheinlich gar nichts.
    expect(schaltet('haken-beschriftung')).toBe(false)
  })

  it('schaltet NICHT auf dem Entfernen-Knopf einer Dienst-Marke', () => {
    expect(schaltet('entfernen')).toBe(false)
  })

  it('schaltet auf der Freiflaeche der Zeile', () => {
    expect(schaltet('freiflaeche')).toBe(true)
  })

  it('schaltet auf dem Bild und auf der Dienst-Marke', () => {
    expect(schaltet('bild')).toBe(true)
    expect(schaltet('marke')).toBe(true)
    expect(schaltet('fuer')).toBe(true)
  })
})
