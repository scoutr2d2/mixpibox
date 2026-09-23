/**
 * Die Wache vor den Verwaltungsseiten.
 *
 * Sie fragt den Zustand hoechstens EINMAL ab (danach steht er im Dienst) und
 * schickt nur dann zur Anmeldung, wenn das Backend die Anmeldung wirklich
 * verlangt. Sie ist bewusst die zweite Reihe: die eigentliche Absicherung
 * sitzt im Backend, denn eine Wache im Browser haelt niemanden auf, der die
 * API direkt anspricht.
 */
import { inject } from '@angular/core'
import { Router, type CanActivateFn } from '@angular/router'
import { AnmeldeDienst } from './anmeldung.dienst'

export const wache: CanActivateFn = async () => {
  const dienst = inject(AnmeldeDienst)
  const router = inject(Router)
  const lage = dienst.geprueft() ? dienst.lage() : await dienst.pruefen()
  if (lage.angemeldet) return true
  return router.createUrlTree(['/anmeldung'])
}
