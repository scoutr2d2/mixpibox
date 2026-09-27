/**
 * DIE NAHT ZWISCHEN RING UND SKRIPT — hält sie noch?
 *
 * `taster.ts` doppelt zwei Zahlen aus `scripts/OnOffShim/off_trigger.sh`: die
 * vier erlaubten Stufen und die Vorgabe. Die Doppelung ist gewollt (die
 * Begründung steht dort), aber eine gewollte Doppelung ohne Wache ist nur eine
 * Doppelung mit besserer Ausrede. Diese Datei ist die Wache.
 *
 * WAS SIE VERHINDERT: Jemand hebt die Obergrenze im Skript auf 6, weil eine
 * Box mit anderem HAT das verträgt. Der Server weiß davon nichts, der Ring ist
 * bei 5 s voll und behauptet „jetzt fährt sie herunter", während das Skript
 * noch eine Sekunde wartet. Ein Kind hält den Knopf, sieht den vollen Ring,
 * lässt los — und nichts passiert. Solche Fehler findet niemand durch Hinsehen.
 *
 * ══ SIE MUSS ROT WERDEN, WENN SIE IHRE STELLE NICHT FINDET ═══════════════
 *
 * Eine Wache, die bei „Muster nicht gefunden" durchwinkt, ist genau dann still,
 * wenn jemand die gesuchte Zeile umgeschrieben hat — also im einzigen Fall,
 * der zählt. Deshalb ist „nicht gefunden" hier ein FEHLSCHLAG und kein
 * Übersprung.
 *
 * ══ UND SIE LIEST KEINE KOMMENTARE ═══════════════════════════════════════
 *
 * `off_trigger.sh` erklärt seine eigenen Stufen im Fließtext („bleiben vier
 * Stufen: 2 (zuegig), 3, 4, 5") und nennt sie in einer Warnmeldung („which is
 * none of 2/3/4/5"). Ein Muster, das darauf anspricht, wäre grün, während der
 * ausführbare `case` längst etwas anderes sagt — die gefährlichste Art grün.
 * Kommentarzeilen fliegen deshalb vorher raus.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { HALTEDAUER_STUFEN, HALTEDAUER_VORGABE, KONFIG_PFAD_HALTEDAUER } from './taster'

const HIER = dirname(fileURLToPath(import.meta.url))
const SKRIPT = join(HIER, '..', '..', '..', 'scripts', 'OnOffShim', 'off_trigger.sh')

/** Das Skript ohne seine Kommentarzeilen — nur, was die Shell wirklich ausführt. */
function ausfuehrbareZeilen(): string[] {
  let text: string
  try {
    text = readFileSync(SKRIPT, 'utf8')
  } catch (e) {
    assert.fail(
      `${SKRIPT} ist nicht lesbar (${(e as Error).message}). Diese Wache vergleicht den ` +
        'Ring mit dem Skript, das wirklich abschaltet — ohne das Skript ist der Vergleich ' +
        'nicht möglich, und das ist ein Fehlschlag und kein Übersprung.',
    )
  }
  return text.split('\n').filter((z) => !/^\s*#/.test(z))
}

describe('Ring und off_trigger.sh meinen dieselbe Schwelle', () => {
  it('die vier Stufen stehen im ausführbaren case — nicht nur im Kommentar', () => {
    const zeilen = ausfuehrbareZeilen()
    const treffer = zeilen.filter((z) => /^\s*[\d|]+\)\s*;;/.test(z))
    assert.ok(
      treffer.length > 0,
      'Im ausführbaren Teil von off_trigger.sh steht kein `N|N|N) ;;` mehr. Entweder wurde ' +
        'die Prüfung der Haltedauer umgebaut — dann gehört taster.ts nachgezogen — oder sie ' +
        'ist ganz entfallen, was schlimmer wäre.',
    )

    const erwartet = HALTEDAUER_STUFEN.join('|')
    assert.ok(
      treffer.some((z) => z.includes(erwartet)),
      `off_trigger.sh lässt nicht mehr genau "${erwartet}" durch, sondern: ` +
        `${treffer.map((z) => z.trim()).join('  /  ')}. ` +
        'HALTEDAUER_STUFEN in taster.ts sagt etwas anderes als das Skript — der Ring auf dem ' +
        'Schirm zeigte dann eine Schwelle, bei der nichts passiert.',
    )
  })

  it('die Vorgabe des Skripts ist die Vorgabe des Rings', () => {
    const zeilen = ausfuehrbareZeilen()
    const zuweisung = zeilen.find((z) => /^\s*PRESS_DELAY=\d+\s*$/.test(z))
    assert.ok(
      zuweisung,
      'In off_trigger.sh gibt es keine schlichte Zuweisung `PRESS_DELAY=<Zahl>` mehr, aus der ' +
        'sich die Vorgabe ablesen ließe. Ohne sie kann diese Wache die Deckung nicht prüfen.',
    )
    const zahl = Number(zuweisung.trim().split('=')[1])
    assert.equal(
      zahl,
      HALTEDAUER_VORGABE,
      `off_trigger.sh fällt auf ${zahl} s zurück, taster.ts auf ${HALTEDAUER_VORGABE} s. ` +
        'Genau im Fehlerfall — unlesbare Konfiguration — lägen Ring und Skript auseinander.',
    )
  })

  it('der Ring liest die Haltedauer AN DERSELBEN STELLE wie das Skript', () => {
    // DIESE WACHE GIBT ES WEGEN EINES ECHTEN FEHLERS (31.08.2026): Der Server
    // las `shim.pressDelay`, das Skript liest `timeout.pressDelay`. Der
    // `shim`-Abschnitt führt die Anschlüsse und sieht wie der richtige Ort aus
    // — die Haltedauer steht aber nebenan. Der Zugriff ergab `undefined`, der
    // Rückfall griff, und der Ring zeigte 3 s, wo das Skript bei 2 s
    // abschaltete. Nichts daran meldete sich; am Gerät stand nur eine Zahl,
    // die zu nichts passte.
    //
    // Zwei Zahlen zu vergleichen hätte das NICHT gefunden — beide Seiten
    // waren für sich genommen richtig. Nur der PFAD war es nicht.
    const zeilen = ausfuehrbareZeilen()
    const jqZeile = zeilen.find((z) => z.includes('pressDelay'))
    assert.ok(
      jqZeile,
      'off_trigger.sh liest `pressDelay` nicht mehr im ausführbaren Teil. Ohne diese Zeile ' +
        'lässt sich nicht prüfen, ob der Ring dieselbe Stelle liest.',
    )
    // Aus `jq -r .timeout.pressDelay` wird `timeout.pressDelay`.
    const treffer = jqZeile.match(/\.([A-Za-z_][\w]*)\.pressDelay/)
    assert.ok(treffer, `Der Pfad ließ sich aus dieser Zeile nicht ablesen: ${jqZeile.trim()}`)
    assert.equal(
      `${treffer[1]}.pressDelay`,
      KONFIG_PFAD_HALTEDAUER,
      `off_trigger.sh liest "${treffer[1]}.pressDelay", der Ring liest "${KONFIG_PFAD_HALTEDAUER}". ` +
        'Der Ring bekäme dann `undefined`, fiele still auf seine Vorgabe zurück und zeigte eine ' +
        'Schwelle an, bei der nichts passiert.',
    )
  })

  it('die Untergrenze des Skripts ist die kleinste Stufe des Rings', () => {
    const zeilen = ausfuehrbareZeilen()
    const zuweisung = zeilen.find((z) => /^\s*PRESS_DELAY_MIN=\d+\s*$/.test(z))
    assert.ok(zuweisung, 'PRESS_DELAY_MIN steht nicht mehr im ausführbaren Teil von off_trigger.sh.')
    const min = Number(zuweisung.trim().split('=')[1])
    assert.equal(
      min,
      Math.min(...HALTEDAUER_STUFEN),
      `off_trigger.sh hebt auf mindestens ${min} s an, die kleinste Stufe im Ring ist ` +
        `${Math.min(...HALTEDAUER_STUFEN)} s.`,
    )
  })
})
