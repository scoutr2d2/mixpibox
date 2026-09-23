/**
 * Die VERWALTUNG ansehen, ohne eine Box zu haben.
 *
 * WOZU: `tools/neu-vorschau.mjs` bedient seit dem 03.08.2026 auch die
 * Endpunkte, die die Verwaltungsoberflaeche braucht (`/api/interpreten`,
 * `/api/interpreten/suche`, `/api/darstellung`, `/api/config`). Was fehlte, war
 * der Weg dorthin: `ng serve` liefert die Oberflaeche, aber jeder `/api`-Abruf
 * ginge an den Entwicklungsserver und liefe ins Leere. Diese Datei ist die
 * Weiterleitung — und der Grund, warum sie ein WERKZEUG ist und keine
 * Befehlszeile: ohne sie muesste man die Weiterleitung jedes Mal neu erfinden.
 *
 * WAS ES AENDERT: nichts. Es laeuft nur auf der Rueckschleife, schreibt keine
 * Datei und redet mit keiner Box. Alle Antworten kommen aus der Attrappe.
 *
 * DIE EINE AUSNAHME IST DIE ANMELDUNG. `/api/auth/state` kennt die Attrappe
 * nicht, und ohne Antwort schickt die Wache (wache.ts) jede Seite auf
 * /anmeldung. Sie wird deshalb HIER beantwortet und ausdruecklich mit
 * `anmeldungNoetig: false` — so, wie eine Box im Heimnetz ohne gesetztes
 * Passwort antwortet. Das ist die einzige Stelle, an der diese Vorschau etwas
 * behauptet, was nicht aus der Attrappe kommt.
 *
 * AUFRUF (zwei Fenster):
 *     node tools/neu-vorschau.mjs                     # die Attrappe, Port 8299
 *     cd src/frontend-admin
 *     npx ng serve --proxy-config ../../tools/verwaltung-vorschau.mjs
 *     # dann http://localhost:4200/admin/interpreten
 *
 * Die Attrappe laesst sich waehrenddessen umschalten, und die Seite zeigt es
 * beim naechsten Laden:
 *     curl localhost:8299/vorschau/frei-an    # ein Freigeschalteter ohne Werke
 *     curl localhost:8299/vorschau/nein-an    # „Kiddinx" abgelehnt
 *
 * ES GIBT EINEN ZWEITEN WEG ZUR SELBEN FRAGE: tools/admin-vorschau.mjs
 * (12.09.2026). Der braucht kein `ng serve` und keine zweite Attrappe — er
 * ist selbst ein Server (Port 8298) und zeigt das GEBAUTE Buendel aus
 * src/deploy/www-admin, also das, was die Box wirklich ausliefert. Dafuer
 * laedt dort nichts von allein neu.
 *
 * Faustregel: an einer Seite BAUEN -> diese Datei (Neuladen bei jeder
 * Aenderung). Ansehen, was die Box ausliefert -> admin-vorschau.mjs.
 *
 * (Nachgetragen 19.09.2026. Bis dahin kannte keiner der beiden Koepfe den
 * anderen — wer den einen fand, suchte den anderen nicht mehr und baute im
 * Zweifel einen dritten.)
 */

/** Wo die Attrappe lauscht. Derselbe Vorgabeport wie in neu-vorschau.mjs. */
const ZIEL = process.env.VORSCHAU_ZIEL || 'http://localhost:8299'

export default [
  {
    context: ['/api/auth/state'],
    bypass: (_req, res) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ angemeldet: true, anmeldungNoetig: false }))
      return true
    },
  },
  {
    context: ['/api'],
    target: ZIEL,
    secure: false,
    changeOrigin: true,
    logLevel: 'warn',
  },
]
