/**
 * Haelt das ARD-Modul gegen die ECHTE Schnittstelle. BACKLOG E4/A4+A5.
 *
 * WOZU: `ard.spec.ts` prueft die Regel gegen ERFUNDENE Antworten — das ist
 * richtig so (schnell, ohne Netz, jede Sorte stellbar), beweist aber nicht,
 * dass die Abfragen von der ARD auch beantwortet werden. Genau diese Luecke
 * schliesst dieses Werkzeug: es ruft die Funktionen aus `ard.ts` mit dem
 * auf, was der lebende Dienst zurueckgibt, und ruft am Ende die aufgeloeste
 * Tonadresse WIRKLICH ab. Die Attrappe kann nicht luegen, wenn daneben die
 * Messung steht.
 *
 * UNTERSCHIED ZU tools/ard-audiothek-probe.py: Das dort befragt die
 * SCHNITTSTELLE (A1, „was gibt es?"). Dieses hier befragt das MODUL (A4/A5,
 * „stimmt, was wir daraus machen?"). Beide bleiben, weil sie verschiedene
 * Fragen beantworten.
 *
 * WAS ES AENDERT: nichts. Ausschliesslich POST /graphql (Lesefelder) und eine
 * HTTP-Bereichsanfrage (erste 1024 Byte) auf die Tonadresse. KEIN Zugriff auf
 * die Box, kein data.json wird geschrieben — der Eintrag wird nur ausgegeben.
 *
 * AUFRUF (aus dem Repo-Wurzelverzeichnis):
 *     npx tsx tools/ard-modul-probe.ts suche 'Die Maus'
 *     npx tsx tools/ard-modul-probe.ts treffer 'Die Maus'   (E4/A6: der Suchtreffer der Verwaltung)
 *     npx tsx tools/ard-modul-probe.ts sendung 81889970
 *     npx tsx tools/ard-modul-probe.ts folge 16543875
 *     npx tsx tools/ard-modul-probe.ts kinder
 *     npx tsx tools/ard-modul-probe.ts bedingung
 *     npx tsx tools/ard-modul-probe.ts zweige
 *
 * WAS ES SCHON GEFUNDEN HAT (04.08.2026, beides haette erst auf der Box weh
 * getan): `search{ items }` nimmt die `condition` gar nicht an (HTTP 400,
 * „Unknown argument"), und seine Knoten sind `ItemInterface`, nicht `Item` —
 * `titleClean` gibt es dort nur ueber ein eingebettetes Bruchstueck. Beides
 * steht jetzt in ard.ts, mit dem Wortlaut der Fehlermeldung.
 *
 * Rueckgabe: 0 = alles beantwortet, 1 = etwas stimmte nicht.
 */

import {
  type Abfrage,
  ARD_ENDPUNKT,
  ARD_KINDER_KATEGORIE,
  abfrageFolge,
  abfrageKategorie,
  abfrageSendung,
  abfrageSuche,
  abspielWeg,
  eintragAus,
  folgeAus,
  folgenOrdnen,
  kategorieAus,
  sendungMitFolgen,
  sucheAus,
} from '../src/backend-api/src/ard'

const FRIST_MS = 15000

async function fragen(abfrage: Abfrage): Promise<unknown> {
  const antwort = await fetch(ARD_ENDPUNKT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(abfrage),
    signal: AbortSignal.timeout(FRIST_MS),
  })
  if (!antwort.ok) throw new Error(`ARD antwortete ${antwort.status}`)
  return await antwort.json()
}

/**
 * Die Tonadresse wirklich abrufen — nur die ersten 1024 Byte.
 *
 * KEIN HEAD: Die Ausspielpartner der ARD beantworten HEAD nicht durchgehend
 * wie GET, und die Frage ist, ob der ABSPIELER etwas bekommt (Herkunft dieser
 * Entscheidung: tools/ard-audiothek-probe.py).
 */
async function tonPruefen(adresse: string): Promise<{ status: number; typ: string }> {
  try {
    const a = await fetch(adresse, { headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(FRIST_MS) })
    return { status: a.status, typ: a.headers.get('content-type') ?? '' }
  } catch (err) {
    return { status: 0, typ: String((err as Error)?.message ?? err) }
  }
}

async function befehlSendung(kennung: string): Promise<number> {
  const roh = await fragen(abfrageSendung(kennung, 12))
  const erg = sendungMitFolgen(roh as never, { jetzt: Date.now() })
  if (!erg) {
    console.error(`Keine Sendung mit der Kennung ${kennung}`)
    return 1
  }
  const eintrag = eintragAus(erg.sendung)
  console.log('Der data.json-Eintrag, den A5 daraus macht (NICHT geschrieben):')
  console.log(JSON.stringify(eintrag, null, 2))
  const alles = JSON.stringify(eintrag)
  // DIE AUFLAGE, SCHWARZ AUF WEISS: keine Tonadresse im Eintrag.
  const sauber = !alles.includes('.mp3') && !alles.includes('akamai')
  console.log(`  Tonadresse im Eintrag: ${sauber ? 'NEIN (richtig)' : 'JA — DAS IST DER FEHLER'}`)

  const folgen = folgenOrdnen(erg.folgen, 'neueste')
  console.log(`\n${folgen.length} abrufbare Folgen (tonlose und abgelaufene sind schon heraus):`)
  for (const f of folgen) {
    console.log(
      `  ${f.kennung}  ${String(f.dauerS ?? '?').padStart(5)}s  bis ${(f.bis ?? '—').slice(0, 10)}  ${f.titel.slice(0, 54)}`,
    )
  }
  if (!folgen.length) return sauber ? 0 : 1

  const erste = folgen[0]
  const weg = abspielWeg(erste, eintrag.artist ?? '')
  console.log('\nDer Befehl an den Abspieldienst (erste Folge):')
  console.log(`  ${weg.befehl.slice(0, 150)}…`)
  console.log(`  anhaengen: ${weg.anhaengen.slice(0, 40)}…`)

  const { status, typ } = await tonPruefen(erste.ton)
  const spielbar = (status === 200 || status === 206) && typ.startsWith('audio')
  console.log(`\nDie Tonadresse wirklich abgerufen: HTTP ${status} ${typ}`)
  console.log(spielbar ? '  SPIELBAR — die Aufloesung stimmt.' : '  NICHT SPIELBAR.')
  // Das Bild ebenfalls: die Platzhalterstelle ist die zweite Falle.
  if (eintrag.cover) {
    const b = await fetch(String(eintrag.cover), { signal: AbortSignal.timeout(FRIST_MS) }).catch(() => null)
    console.log(`Das Bild: HTTP ${b?.status ?? 0} ${b?.headers.get('content-type') ?? ''}`)
    if (!b?.ok) return 1
  }
  return spielbar && sauber ? 0 : 1
}

async function befehlSuche(begriff: string): Promise<number> {
  const erg = sucheAus((await fragen(abfrageSuche(begriff, 8))) as never, { jetzt: Date.now() })
  console.log(`Sendungen (${erg.anzahlSendungen ?? '?'} behauptet, ${erg.sendungen.length} gelesen):`)
  for (const s of erg.sendungen) console.log(`  [${s.kennung}] ${s.titel}  (${s.herausgeber})`)
  console.log(`Einzelfolgen (${erg.anzahlFolgen ?? '?'} behauptet, ${erg.folgen.length} mit Ton):`)
  for (const f of erg.folgen) console.log(`  [${f.kennung}] ${f.titel.slice(0, 60)}`)
  return erg.sendungen.length ? 0 : 1
}

/**
 * EINE Folge — der Weg, den die Box unmittelbar vor dem Abspielen geht.
 *
 * Das ist die Probe auf die Auflage von A5: Was aus einer gespeicherten
 * Kennung wird, muss HIER entstehen und nicht in data.json stehen.
 */
async function befehlFolge(kennung: string): Promise<number> {
  const roh = await fragen(abfrageFolge(kennung))
  const f = folgeAus(roh as never, { jetzt: Date.now() })
  if (!f) {
    console.log(
      `Folge ${kennung}: KEINE spielbare Folge (tonlos, unveroeffentlicht, abgelaufen, Livestream oder unbekannt).`,
    )
    console.log('  Das ist ein gueltiges Ergebnis — die Box darf daraus keine Kachel bauen.')
    return 0
  }
  console.log(`Folge ${f.kennung}: ${f.titel}`)
  console.log(`  Dauer ${f.dauerS ?? '?'}s, bis ${f.bis ?? '—'}`)
  const { status, typ } = await tonPruefen(f.ton)
  console.log(`  Tonadresse: HTTP ${status} ${typ}`)
  return (status === 200 || status === 206) && typ.startsWith('audio') ? 0 : 1
}

/**
 * WELCHE BEDINGUNG STIMMT? — die Messung, die eine Wiki-Regel widerlegt hat.
 *
 * Das Wissenspaket empfahl `condition:{isPublished:true, itemType:EPISODE}`.
 * Dieser Unterbefehl haelt sie ueber MEHRERE Sendungen gegen
 * `condition:{isPublished:true}` allein und zeigt beides: die Anzahl und das
 * Datum der NEUESTEN Folge mit Ton. Bei MausZoom und Herzfunk liegen dazwischen
 * drei Jahre — dort sind die spielbaren Stuecke `SECTION`, nicht `EPISODE`.
 *
 * Wer die Regel wieder verschaerfen will, ruft das hier auf, bevor er es tut.
 */
const SENDUNGEN_ZUR_PROBE: [string, string][] = [
  ['10378841', 'MausZoom'],
  ['81889970', 'MausHoerspiel kurz'],
  ['7244594', 'Betthupferl'],
  ['8758580', 'Spielraum Hoerspiel'],
  ['10378427', 'Herzfunk'],
  ['12810141', 'Hotzenplotz (depubliziert)'],
]

async function befehlBedingung(): Promise<number> {
  const abfrage = (id: string, bedingung: string): Abfrage => ({
    query: `{ programSet(id:"${id}"){ items(first:30, orderBy:PUBLISH_DATE_DESC, ${bedingung}){
      totalCount nodes { publishDate itemType audios { url } } } } }`,
    variables: {},
  })
  type Knoten = { publishDate?: string; itemType?: string; audios?: { url?: string }[] }
  const lesen = async (id: string, bedingung: string) => {
    const d = (await fragen(abfrage(id, bedingung))) as {
      data?: { programSet?: { items?: { totalCount?: number; nodes?: Knoten[] } } }
    }
    const items = d?.data?.programSet?.items
    const mitTon = (items?.nodes ?? []).filter((n) => (n.audios ?? []).length > 0)
    return {
      anzahl: items?.totalCount ?? 0,
      neueste: mitTon[0]?.publishDate?.slice(0, 10) ?? '—',
      sorten: [...new Set(mitTon.map((n) => String(n.itemType)))].join('+') || '—',
    }
  }
  console.log('Vergleich der beiden Bedingungen (Anzahl / neueste Folge MIT Ton / Sorten):\n')
  console.log(`${'Sendung'.padEnd(28)} ${'mit itemType:EPISODE'.padEnd(26)} nur isPublished:true`)
  let abweichungen = 0
  for (const [id, name] of SENDUNGEN_ZUR_PROBE) {
    const eng = await lesen(id, 'condition:{isPublished:true, itemType:EPISODE}')
    const weit = await lesen(id, 'condition:{isPublished:true}')
    if (eng.neueste !== weit.neueste) abweichungen++
    const links = `${String(eng.anzahl).padStart(5)} ${eng.neueste}`
    const rechts = `${String(weit.anzahl).padStart(5)} ${weit.neueste}  ${weit.sorten}`
    console.log(`${name.padEnd(28)} ${links.padEnd(26)} ${rechts}`)
  }
  console.log(
    `\n${abweichungen} von ${SENDUNGEN_ZUR_PROBE.length} Sendungen verlieren durch itemType:EPISODE ihre neuesten Folgen.`,
  )
  console.log('Deshalb steht in ard.ts NUR isPublished:true — und der Rest wird beim Lesen aussortiert.')
  return 0
}

/**
 * ZIEHEN ECHTE ARD-ADRESSEN DIE FALSCHEN ZWEIGE DES ABSPIELDIENSTES?
 *
 * Der Abspieldienst schaltete seine Stroeme frueher mit
 * `command.dir.includes('radio')`, `…('rss')`, `…('queue')` — also nach einem
 * WORT irgendwo im Pfad. Im Pfad steht aber die kodierte FREMDE Adresse. Ob
 * das je zusammenstoesst, ist keine Geschmacksfrage, sondern eine Messung:
 * dieser Unterbefehl holt die Tonadressen echter Sendungen und haelt sie
 * gegen genau diese Bedingungen.
 *
 * WAS ER AM 04.08.2026 GEFUNDEN HAT: Das Kinder-Regal allein sagt NEIN — acht
 * Ausspielpartner, kein einziger Treffer. Erst die Deutschlandfunk-Sendungen
 * (Kakadu, das Kinderhoerspiel) zeigen es: sie kommen ueber
 * `podcast-mp3.dradio.de`, und „dradio" enthaelt „radio". Eine Stichprobe von
 * zwanzig Kacheln haette also „alles gut" gemeldet. Deshalb steht die
 * Deutschlandfunk-Liste hier ausdruecklich mit drin.
 */
const ZWEIG_WOERTER = ['radio', 'rss', 'queue', 'library', 'deletelocal'] as const

async function befehlZweige(): Promise<number> {
  // Das Kinder-Regal (der Regelfall) UND Deutschlandfunk (der Fall, der es
  // aufdeckt). Die zweite Gruppe ist der Grund, warum diese Liste nicht aus
  // dem Regal allein kommt.
  const sendungen = kategorieAus((await fragen(abfrageKategorie(ARD_KINDER_KATEGORIE, 20))) as never).map(
    (s) => [s.kennung, s.titel] as [string, string],
  )
  sendungen.push(['94878292', 'Kakadu – Das Kinderhoerspiel (Dlf Kultur)'])
  sendungen.push(['42747082', 'Kakadu – Der Kinderpodcast (Dlf Kultur)'])

  const hosts = new Map<string, number>()
  const treffer = new Map<string, string[]>()
  for (const [id, name] of sendungen) {
    // EINE Sendung, die klemmt, darf die Messung nicht abbrechen — sonst
    // haengt die Aussage an der Tagesform des Dienstes. Am 04.08.2026 lief
    // genau eine Abfrage in die Frist.
    let erg: ReturnType<typeof sendungMitFolgen> = null
    try {
      erg = sendungMitFolgen((await fragen(abfrageSendung(id, 20))) as never, { jetzt: Date.now() })
    } catch (err) {
      console.error(`  (uebersprungen: ${name} — ${String((err as Error)?.message ?? err)})`)
      continue
    }
    for (const f of erg?.folgen ?? []) {
      let host = ''
      try {
        host = new URL(f.ton).host
      } catch {
        host = '(unlesbar)'
      }
      hosts.set(host, (hosts.get(host) ?? 0) + 1)
      // GENAU SO baut der Befehl den Pfad — dieselbe Kodierung wie abspielWeg.
      const dir = `/current/ard/${encodeURIComponent(f.ton)}`
      for (const wort of ZWEIG_WOERTER) {
        if (!dir.includes(wort)) continue
        const liste = treffer.get(wort) ?? []
        if (liste.length < 3) liste.push(f.ton)
        treffer.set(wort, liste)
      }
    }
  }

  console.log(`Ausspielpartner ueber ${sendungen.length} Sendungen (Folgen je Host):`)
  for (const [h, n] of [...hosts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${h}`)

  console.log('\nAdressen, die ein `dir.includes(<wort>)` faelschlich treffen wuerden:')
  let schaden = 0
  for (const wort of ZWEIG_WOERTER) {
    const liste = treffer.get(wort) ?? []
    if (liste.length) schaden++
    console.log(`  ${wort.padEnd(12)} ${liste.length ? `TREFFER — z. B. ${liste[0]}` : 'keiner'}`)
  }
  console.log(
    schaden
      ? '\nDeshalb schalten radio/rss/queue im Abspieldienst auf das VERB (befehlspfad.ts).'
      : '\nIn dieser Stichprobe kein Treffer — das ist KEIN Beweis: das Kinder-Regal',
  )
  if (!schaden) console.log('allein war am 04.08.2026 auch sauber, Deutschlandfunk war es nicht.')
  return 0
}

async function befehlKinder(): Promise<number> {
  const sendungen = kategorieAus((await fragen(abfrageKategorie(ARD_KINDER_KATEGORIE, 20))) as never)
  console.log(`Das Regal „Fuer Kinder" (${ARD_KINDER_KATEGORIE}): ${sendungen.length} Sendungen`)
  for (const s of sendungen) console.log(`  [${s.kennung}] ${s.titel}  (${s.herausgeber})`)
  return sendungen.length ? 0 : 1
}

/**
 * DER SUCHTREFFER DER VERWALTUNG — gegen die LEBENDE Schnittstelle (E4/A6).
 *
 * `ard.spec.ts` prueft dieselbe Form gegen eine erfundene Antwort. Das ist
 * richtig und schnell, beweist aber nicht, dass die ARD zu einem beliebigen
 * Suchbegriff auch WIRKLICH alles liefert, was ein Treffer braucht: ohne
 * Titel steht in der Verwaltung eine leere Zeile, ohne Cover ein graues
 * Kaestchen, ohne Kennung entsteht ein Eintrag, der auf nichts zeigt — und
 * alle drei fallen erst auf, wenn jemand hinsieht.
 *
 * Es baut den Treffer GENAUSO wie `dienstSuche()` in server.ts: aus
 * `eintragAus()`, ohne eigene Felder. Und es ruft die Bildadresse wirklich
 * ab — die kommt mit einer Platzhalterstelle, und unveraendert gespeichert
 * antwortet sie mit 400.
 */
async function befehlTreffer(begriff: string): Promise<number> {
  const erg = sucheAus((await fragen(abfrageSuche(begriff, 8))) as never, { jetzt: Date.now() })
  if (!erg.sendungen.length) {
    console.log(`Keine Sendung zu „${begriff}" — kein Befund, aber auch kein Beweis.`)
    return 1
  }
  let schaden = 0
  for (const s of erg.sendungen) {
    const v = eintragAus(s)
    const maengel: string[] = []
    if (!String(v.id ?? '').trim()) maengel.push('keine Kennung')
    if (!String(v.title ?? '').trim()) maengel.push('kein Titel')
    if (!String(v.artist ?? '').trim()) maengel.push('kein Herausgeber')
    if (!String(v.cover ?? '').trim()) maengel.push('kein Bild')
    if (String(v.cover ?? '').includes('{width}')) maengel.push('Bild mit unersetzter Platzhalterstelle')
    if (JSON.stringify(v).includes('.mp3')) maengel.push('TONADRESSE eingebacken')
    let bild = ''
    if (String(v.cover ?? '').trim()) {
      const { status, typ } = await tonPruefen(String(v.cover))
      bild = `Bild HTTP ${status} ${typ}`
      if (!(status === 200 || status === 206) || !typ.startsWith('image')) maengel.push(`Bild ${status} ${typ}`)
    }
    console.log(`  ard:${v.id}  ${v.title}  (${v.artist})  ${bild}`)
    if (maengel.length) {
      console.log(`      MANGEL: ${maengel.join(', ')}`)
      schaden++
    }
  }
  console.log(
    schaden
      ? `\n${schaden} von ${erg.sendungen.length} Treffern waeren in der Verwaltung unvollstaendig.`
      : `\nAlle ${erg.sendungen.length} Treffer sind vollstaendig — Kennung, Titel, Herausgeber, abrufbares Bild, keine Tonadresse.`,
  )
  return schaden ? 1 : 0
}

async function main(): Promise<number> {
  const [befehl, wert] = process.argv.slice(2)
  if (befehl === 'sendung' && wert) return await befehlSendung(wert)
  if (befehl === 'folge' && wert) return await befehlFolge(wert)
  if (befehl === 'suche' && wert) return await befehlSuche(wert)
  if (befehl === 'treffer' && wert) return await befehlTreffer(wert)
  if (befehl === 'kinder') return await befehlKinder()
  if (befehl === 'bedingung') return await befehlBedingung()
  if (befehl === 'zweige') return await befehlZweige()
  console.error(
    'Aufruf: npx tsx tools/ard-modul-probe.ts {suche <begriff>|treffer <begriff>|sendung <kennung>|folge <kennung>|kinder|bedingung|zweige}',
  )
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(String(err?.message ?? err))
    process.exit(1)
  })
