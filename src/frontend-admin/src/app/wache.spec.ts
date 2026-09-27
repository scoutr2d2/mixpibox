/**
 * Tests fuer die Wache vor den Verwaltungsseiten.
 *
 * SIE IST DIE ZWEITE REIHE — die eigentliche Absicherung sitzt im Backend, und
 * das steht so auch im Kopf von wache.ts. Trotzdem gehoert sie geprueft, denn
 * sie hat zwei Zusagen, die man ihr nicht ansieht:
 *
 *   1. Sie fragt den Zustand HOECHSTENS EINMAL ab. Faellt das weg, laeuft bei
 *      jedem Seitenwechsel eine Abfrage — auf einem Pi merkt man das.
 *   2. Sie schickt nur dann zur Anmeldung, wenn das Backend sie WIRKLICH
 *      verlangt. Waere sie strenger, sperrte sie Bestandsboxen aus, auf denen
 *      die Anmeldung ausgeschaltet ist.
 *
 * Geprueft wird gegen einen Doppelgaenger des Anmeldedienstes, nicht gegen das
 * Netz: hier geht es um die Entscheidung der Wache, nicht um HTTP.
 */
import { TestBed } from '@angular/core/testing'
import { Router, type UrlTree } from '@angular/router'
import { provideRouter } from '@angular/router'
import { AnmeldeDienst, type Anmeldelage } from './anmeldung.dienst'
import { wache } from './wache'

/** Zaehlt mit, wie oft gefragt wurde — Zusage 1 haengt genau daran. */
class DienstDoppel {
  abfragen = 0
  private wert: Anmeldelage = { anmeldungNoetig: true, angemeldet: false, passwortGesetzt: true }
  private schonGeprueft = false

  constructor(lage?: Partial<Anmeldelage>, geprueft = false) {
    this.wert = { ...this.wert, ...lage }
    this.schonGeprueft = geprueft
  }
  lage = () => this.wert
  geprueft = () => this.schonGeprueft
  pruefen = async () => {
    this.abfragen++
    this.schonGeprueft = true
    return this.wert
  }
}

function wacheLaufenLassen(doppel: DienstDoppel) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: AnmeldeDienst, useValue: doppel }],
  })
  // Eine CanActivateFn braucht den Injektionskontext — sonst findet `inject()`
  // nichts und der Test scheitert an der Umgebung statt an der Sache.
  return TestBed.runInInjectionContext(() =>
    (wache as unknown as () => Promise<boolean | UrlTree>)(),
  )
}

describe('wache', () => {
  it('laesst durch, wenn man angemeldet ist', async () => {
    const d = new DienstDoppel({ angemeldet: true })
    expect(await wacheLaufenLassen(d)).toBe(true)
  })

  it('laesst durch, wenn die Anmeldung ausgeschaltet ist', async () => {
    // Bestandsbox: das Backend meldet "angemeldet", obwohl kein Passwort
    // gesetzt ist. Die Wache darf hier NICHT strenger sein.
    const d = new DienstDoppel({ anmeldungNoetig: false, angemeldet: true, passwortGesetzt: false })
    expect(await wacheLaufenLassen(d)).toBe(true)
  })

  it('schickt zur Anmeldung, wenn man nicht angemeldet ist', async () => {
    const d = new DienstDoppel({ angemeldet: false })
    const ergebnis = await wacheLaufenLassen(d)
    expect(ergebnis).not.toBe(true)
    const router = TestBed.inject(Router)
    expect(String(ergebnis)).toBe(String(router.createUrlTree(['/anmeldung'])))
  })

  it('fragt genau einmal — beim zweiten Mal steht der Zustand schon', async () => {
    const d = new DienstDoppel({ angemeldet: true })
    await wacheLaufenLassen(d)
    expect(d.abfragen).toBe(1)

    // Zweiter Aufruf: `geprueft()` ist jetzt wahr, also darf NICHT erneut
    // gefragt werden. TestBed fuer den zweiten Lauf frisch aufsetzen.
    TestBed.resetTestingModule()
    await wacheLaufenLassen(d)
    expect(d.abfragen).toBe(1)
  })
})
