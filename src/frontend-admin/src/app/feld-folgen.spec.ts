/**
 * Der Satz, der die Folge einer kleinen Zahl hinschreibt.
 *
 * DER PRUEFFALL, UM DEN ES GEHT, IST DIE 1. Sie ist erlaubt und bleibt
 * erlaubt — aber sie darf nicht mehr WORTLOS durchgehen. „1" sieht harmlos
 * aus; „60 Sekunden nach der letzten Berührung" nicht.
 *
 * Und der zweite, der wirklich jemanden rettet: bei einer Hoechstlautstaerke
 * unter dem Boden MUSS dastehen, dass am Lautsprecher etwas anderes gilt als
 * im Feld. Sonst zeigt diese Verwaltung eine Zahl, die das Geraet nicht tut —
 * genau die Luege, an der die Bildschirmhelligkeit jahrelang haengen blieb.
 */
import {
  LAUTSTAERKE_BODEN,
  STARTKARENZ_SEKUNDEN,
  ausschaltFolge,
  feldFolge,
  lautstaerkeFolge,
} from './feld-folgen'

describe('ausschaltFolge', () => {
  it('rechnet die Minute in Sekunden um — das ist der ganze Punkt', () => {
    const f = ausschaltFolge(1)
    expect(f.hinweis).toBe(true)
    expect(f.schwere).toBe('warnen')
    expect(f.satz).toContain('60 Sekunden')
  })

  it('nennt die Berührung, nicht nur die Wiedergabe', () => {
    expect(ausschaltFolge(1).satz).toContain('Berührung')
  })

  it('nennt die Startkarenz — aber als Eigenschaft der Fassung, nicht als Zusage', () => {
    const satz = ausschaltFolge(1).satz
    expect(satz).toContain(`${STARTKARENZ_SEKUNDEN} Sekunden`)
    // Was diese Prüfung wirklich schützt: der Satz darf nicht behaupten, dass
    // die Karenz auf DIESER Box gilt. Am 08.08.2026 lag dort eine
    // idle_shutdown.sh ohne jede Karenz, und der Satz versprach eine.
    expect(satz).toContain('hängt von der Fassung auf der Box ab')
    expect(satz).toContain('ältere zählen sofort')
    expect(satz).not.toContain('erst 120 Sekunden später')
  })

  it('sagt bei kleinen Werten, dass es an der Box keinen Weg zurück gibt', () => {
    expect(ausschaltFolge(1).satz).toContain('KEINER Oberfläche der Box')
    expect(ausschaltFolge(3).schwere).toBe('warnen')
  })

  it('bleibt bei brauchbaren Werten ruhig, rechnet aber trotzdem vor', () => {
    const f = ausschaltFolge(30)
    expect(f.hinweis).toBe(true)
    expect(f.schwere).toBe('ruhig')
    expect(f.satz).toContain('1800 Sekunden')
    expect(f.satz).not.toContain('KEINER Oberfläche')
  })

  it('0 heißt „nie" und wird nicht als Gefahr ausgegeben', () => {
    const f = ausschaltFolge(0)
    expect(f.schwere).toBe('ruhig')
    expect(f.satz).toBe('Die Box schaltet sich nicht von allein aus.')
  })

  it('schweigt bei allem, was keine Zahl ist', () => {
    expect(ausschaltFolge('').hinweis).toBe(false)
    expect(ausschaltFolge(null).hinweis).toBe(false)
    expect(ausschaltFolge('abc').hinweis).toBe(false)
  })

  it('nimmt auch Zeichenketten — so stehen die Werte in der Datei', () => {
    expect(ausschaltFolge('2').satz).toContain('120 Sekunden')
  })
})

describe('lautstaerkeFolge', () => {
  it('DIE 1: sagt, dass am Lautsprecher etwas anderes gilt als im Feld', () => {
    const f = lautstaerkeFolge(1)
    expect(f.hinweis).toBe(true)
    expect(f.schwere).toBe('warnen')
    expect(f.satz).toContain('1 %')
    expect(f.satz).toContain(`${LAUTSTAERKE_BODEN} %`)
  })

  /**
   * DIE PRUEFUNG, DIE ES VORHER NICHT GAB — und die genau den Fehler festhält,
   * der am 08.08.2026 an der Box gemessen wurde.
   *
   * Der alte Satz sagte: „die Box regelt nicht unter 10 %". Auf der Box stand
   * in mupi-lautstaerke.sh:129 aber `[ "$h" -lt 1 ] && h=100` — aus 0 wird
   * NICHT der Boden, sondern die volle Lautstärke. Die Verwaltung gab damit
   * unter der Beschriftung „Gehörschutz für Kinderohren" eine Zusage, die ins
   * Gegenteil kippte.
   *
   * Solange nicht sicher ist, welche Fassung auf der Box liegt, muss der Satz
   * BEIDE Ausgänge nennen. Diese Prüfung lässt die alte, einseitige Zusage
   * nicht zurückkommen.
   */
  it('behauptet KEINEN Boden, den die Box vielleicht nicht hat', () => {
    const satz = lautstaerkeFolge(0).satz
    expect(satz).toContain('VOLLE Lautstärke')
    expect(satz).toContain('nicht zu sehen')
    expect(satz).not.toContain('regelt nicht unter')
    expect(satz).not.toContain('am Lautsprecher gelten')
  })

  it('DIE 0: sagt ausdrücklich, dass sie nicht „stumm" bedeutet', () => {
    expect(lautstaerkeFolge(0).satz).toContain('bedeutet nicht stumm')
  })

  it('sagt, dass das Feld auf der Box selbst nirgends steht', () => {
    expect(lautstaerkeFolge(0).satz).toContain('KEINER')
  })

  it('schweigt ab dem Boden — dort gibt es nichts zu warnen', () => {
    expect(lautstaerkeFolge(LAUTSTAERKE_BODEN).hinweis).toBe(false)
    expect(lautstaerkeFolge(55).hinweis).toBe(false)
    expect(lautstaerkeFolge(100).hinweis).toBe(false)
  })

  it('schweigt bei allem, was keine Zahl ist', () => {
    expect(lautstaerkeFolge('').hinweis).toBe(false)
    expect(lautstaerkeFolge(undefined).hinweis).toBe(false)
  })
})

describe('feldFolge', () => {
  it('ordnet über die Kennung zu, nicht über die Beschriftung', () => {
    expect(feldFolge('ausschaltenNach', 1).schwere).toBe('warnen')
    expect(feldFolge('maxLautstaerke', 1).schwere).toBe('warnen')
  })

  it('schweigt zu allen anderen Feldern', () => {
    expect(feldFolge('startLautstaerke', 1).hinweis).toBe(false)
    expect(feldFolge('name', 'Box').hinweis).toBe(false)
  })
})
