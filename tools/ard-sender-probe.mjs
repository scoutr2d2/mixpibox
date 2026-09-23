#!/usr/bin/env node
/**
 * ARD-SENDER-PROBE — wie kommt man an die LIVE-Radiosender der Audiothek?
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * `plugins/mixpi-ardsounds/index.mjs` sortiert `EVENT_LIVESTREAM` beim Lesen
 * aus, und das aus gutem Grund: eine Kachel, die nicht endet, ist in einer
 * Folgenliste ein Fremdkoerper ([[ard-items-ohne-ton-und-die-falschen-zahlen]]).
 * Der Betreiber will die Sender aber ABSICHTLICH — als eigene Sorte, nicht
 * zwischen den Hoerspielen.
 *
 * Bevor dafuer eine Zeile Plugin-Code entsteht, muss feststehen, WAS die
 * Schnittstelle ueberhaupt anbietet. Geraten wurde hier schon genug: die
 * Wiki-Eintraege zur Audiothek sind allesamt aus Fehlschluessen entstanden,
 * die eine Probe vorher billiger beantwortet haette.
 *
 * ══ WAS ES TUT ═════════════════════════════════════════════════════════════
 * 1. Fragt das Schema nach ALLEN Einstiegen unter `Query` und zeigt die, die
 *    nach Live/Sender/Radio klingen — mit ihren Argumenten.
 * 2. Sucht den Typ hinter jedem Treffer und listet dessen Felder, damit
 *    klar ist, ob eine Tonadresse drinsteht.
 * 3. Probiert die Treffer wirklich an und zeigt einen echten Datensatz.
 *
 * Es AENDERT NICHTS — nur lesende Abfragen, kein Schluessel noetig.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/ard-sender-probe.mjs              # alle drei Schritte
 *     node tools/ard-sender-probe.mjs --schema     # nur die Einstiege
 *     node tools/ard-sender-probe.mjs --feld <name>  # einen Einstieg anfassen
 */

const GRAPHQL = 'https://api.ardaudiothek.de/graphql'
const FRIST_MS = 15000

/** Woerter, an denen ein Live-Einstieg zu erkennen ist. */
const SPUR = ['live', 'stream', 'radio', 'sender', 'station', 'broadcast', 'permanent']

async function fragen(query, variables) {
  const ab = new AbortController()
  const uhr = setTimeout(() => ab.abort(), FRIST_MS)
  const start = Date.now()
  try {
    const antwort = await fetch(GRAPHQL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: ab.signal,
    })
    if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`)
    const roh = await antwort.json()
    if (roh.errors?.length) throw new Error(roh.errors.map((f) => f.message).join('; '))
    return { daten: roh.data, ms: Date.now() - start }
  } finally {
    clearTimeout(uhr)
  }
}

/** Den Typnamen aus der verschachtelten GraphQL-Typangabe herausschaelen. */
function typName(t) {
  let x = t
  while (x?.ofType) x = x.ofType
  return x?.name ?? '?'
}

async function einstiege() {
  const { daten, ms } = await fragen(`query{
    __schema { queryType { fields {
      name
      args { name type { name kind ofType { name kind } } }
      type { name kind ofType { name kind ofType { name kind } } }
    } } }
  }`)
  const alle = daten.__schema.queryType.fields
  console.log(`Die Audiothek nennt ${alle.length} Einstiege unter Query (${ms} ms).\n`)

  const treffer = alle.filter((f) => SPUR.some((w) => f.name.toLowerCase().includes(w)))
  if (treffer.length === 0) {
    console.log('KEIN Einstieg traegt Live/Sender/Radio im Namen.')
    console.log('Dann fuehrt der Weg ueber itemType EVENT_LIVESTREAM in den normalen Listen.\n')
    console.log('Alle Einstiege, zum Selberlesen:')
    console.log(`  ${alle.map((f) => f.name).join(', ')}\n`)
    return []
  }
  console.log(`${treffer.length} Einstieg(e) klingen nach Live:\n`)
  for (const f of treffer) {
    const args = f.args.map((a) => `${a.name}: ${typName(a.type)}`).join(', ')
    console.log(`  ${f.name}(${args}) -> ${typName(f.type)}`)
  }
  console.log()
  return treffer
}

async function felderVon(typ) {
  const { daten } = await fragen(`query($t:String!){ __type(name:$t){ name kind fields { name type { name kind ofType { name kind } } } } }`, {
    t: typ,
  })
  return daten.__type?.fields ?? []
}

async function main() {
  const argumente = process.argv.slice(2)
  console.log(`ARD-Sender-Probe gegen ${GRAPHQL}\n${'─'.repeat(70)}\n`)

  const treffer = await einstiege()
  if (argumente.includes('--schema')) return

  // ── Die Typen hinter den Treffern, damit die Tonadresse sichtbar wird ──
  const gesehen = new Set()
  for (const f of treffer) {
    const typ = typName(f.type)
    if (gesehen.has(typ)) continue
    gesehen.add(typ)
    const felder = await felderVon(typ)
    if (felder.length === 0) continue
    console.log(`Typ ${typ}:`)
    console.log(`  ${felder.map((x) => `${x.name}:${typName(x.type)}`).join('  ')}\n`)
    // Eine Ebene tiefer, wenn es eine Sammlung mit `nodes` ist.
    const knoten = felder.find((x) => x.name === 'nodes')
    if (knoten) {
      const untertyp = typName(knoten.type)
      if (!gesehen.has(untertyp)) {
        gesehen.add(untertyp)
        const unter = await felderVon(untertyp)
        console.log(`Typ ${untertyp} (in nodes):`)
        console.log(`  ${unter.map((x) => `${x.name}:${typName(x.type)}`).join('  ')}\n`)
      }
    }
  }

  // ── Und einmal wirklich anfassen ───────────────────────────────────────
  const feldIndex = argumente.indexOf('--feld')
  const nurDies = feldIndex >= 0 ? argumente[feldIndex + 1] : null
  for (const f of treffer) {
    if (nurDies && f.name !== nurDies) continue
    const nimmtFirst = f.args.some((a) => a.name === 'first')
    const args = nimmtFirst ? '(first:3)' : ''
    for (const rumpf of ['nodes { id title }', 'id title', 'nodes { id }']) {
      try {
        const { daten, ms } = await fragen(`query{ ${f.name}${args} { ${rumpf} } }`)
        console.log(`${f.name} mit "${rumpf}" (${ms} ms):`)
        console.log(`  ${JSON.stringify(daten).slice(0, 600)}\n`)
        break
      } catch (fehler) {
        console.log(`  ${f.name} mit "${rumpf}": ${fehler.message.slice(0, 120)}`)
      }
    }
  }
}

main().catch((f) => {
  console.error(`\nFEHLGESCHLAGEN: ${f.message}`)
  process.exit(1)
})
