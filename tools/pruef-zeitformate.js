/**
 * Prueft die Kuerzungen der Zeit-Anzeigen.
 *
 * Sie sind das, was jemand liest — eine falsche Grenze („59 min" vs „1:00 h")
 * faellt im Bau nicht auf, im Betrieb aber sofort. Der Auszug wird aus der
 * Quelle erzeugt, damit die Pruefung nicht neben ihr herlaeuft.
 *
 * Aufruf: node tools/pruef-zeitformate.js
 */
const { kurzZeit, kurzDauer, heuteSchluessel } = require('./zeitfns-auszug.js')
let fehler = 0
const p = (ist, soll, was) => { const ok = ist === soll; if (!ok) fehler++
  console.log(`${ok ? 'ok  ' : 'FEHL'} ${was}: ${JSON.stringify(ist)}${ok ? '' : ' erwartet ' + JSON.stringify(soll)}`) }
p(kurzZeit(0), '0:00', 'Rest 0 s');            p(kurzZeit(41), '0:41', 'Rest 41 s')
p(kurzZeit(221), '3:41', 'Rest 3:41');         p(kurzZeit(3600), '1:00 h', 'Rest genau 1 h')
p(kurzZeit(8040), '2:14 h', 'Rest 2:14 h');    p(kurzZeit(-5), '0:00', 'negativ faengt bei 0')
p(kurzDauer(0), '0 min', 'heute nichts');      p(kurzDauer(59), '0 min', 'unter 1 min')
p(kurzDauer(1800), '30 min', '30 min');        p(kurzDauer(3599), '59 min', 'knapp unter 1 h')
p(kurzDauer(3600), '1:00 h', 'genau 1 h');     p(kurzDauer(8040), '2:14 h', '2:14 h')
p(heuteSchluessel(new Date(2026, 0, 5, 23, 30)), '2026-01-05', 'Ortszeit, nicht UTC')
p(heuteSchluessel(new Date(2026, 11, 31, 0, 5)), '2026-12-31', 'Jahresende')
console.log(fehler ? `\n${fehler} FEHLER` : '\nalle Kuerzungen stimmen')
process.exitCode = fehler ? 1 : 0
