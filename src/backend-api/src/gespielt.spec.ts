import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_EINTRAEGE, SPERRE_MS, haeufigste, istMeldung, meldungAusEintrag, type Gespielt, vermerken, zuletzt } from './gespielt'

const e = (key: string, anzahl: number, zeit: number): Gespielt => ({ key, anzahl, zuletzt: zeit })

describe('vermerken', () => {
  it('legt einen neuen Eintrag an', () => {
    const r = vermerken([], { key: 'spotify:a', title: 'A' }, 1000)
    assert.equal(r.length, 1)
    assert.equal(r[0].anzahl, 1)
    assert.equal(r[0].zuletzt, 1000)
    assert.equal(r[0].title, 'A')
  })

  it('zaehlt einen spaeteren Start hoch', () => {
    const a = vermerken([], { key: 'k' }, 0)
    const b = vermerken(a, { key: 'k' }, SPERRE_MS)
    assert.equal(b[0].anzahl, 2)
  })

  it('zaehlt mehrfaches Tippen NICHT mehrfach', () => {
    // Ein Kind tippt gern mehrmals, und das Fortsetzen startet ebenfalls neu.
    let s = vermerken([], { key: 'k' }, 1000)
    for (const t of [1200, 2000, 30_000]) s = vermerken(s, { key: 'k' }, t)
    assert.equal(s[0].anzahl, 1)
    assert.equal(s[0].zuletzt, 30_000, 'die Zeit wird trotzdem nachgefuehrt')
  })

  it('ergaenzt fehlende Angaben, ohne vorhandene zu loeschen', () => {
    const a = vermerken([], { key: 'k', title: 'A', artist: 'X' }, 0)
    const b = vermerken(a, { key: 'k', title: 'A neu' }, SPERRE_MS)
    assert.equal(b[0].title, 'A neu')
    assert.equal(b[0].artist, 'X')
  })

  it('laesst den uebergebenen Stand unveraendert', () => {
    const alt = [e('k', 1, 0)]
    vermerken(alt, { key: 'k' }, SPERRE_MS)
    assert.equal(alt[0].anzahl, 1)
  })

  it('verwirft eine Meldung ohne Schluessel', () => {
    assert.deepEqual(vermerken([], { key: '   ' }, 0), [])
  })

  it('wirft das AELTESTE heraus, nicht das seltenste', () => {
    // Was seit Wochen niemand hoert, gehoert auf keine Startseite - auch wenn
    // es frueher oft lief.
    let s: Gespielt[] = [{ key: 'alt-aber-oft', anzahl: 99, zuletzt: 1 }]
    for (let i = 0; i < MAX_EINTRAEGE; i++) s = vermerken(s, { key: `neu${i}` }, 1000 + i)
    assert.equal(s.length, MAX_EINTRAEGE)
    assert.equal(
      s.some((x) => x.key === 'alt-aber-oft'),
      false,
    )
  })
})

describe('zuletzt', () => {
  it('stellt das Neueste nach vorn', () => {
    const s = [e('a', 1, 100), e('b', 1, 300), e('c', 1, 200)]
    assert.deepEqual(zuletzt(s).map((x) => x.key), ['b', 'c', 'a'])
  })

  it('begrenzt die Anzahl', () => {
    const s = [e('a', 1, 1), e('b', 1, 2), e('c', 1, 3)]
    assert.equal(zuletzt(s, 2).length, 2)
  })

  it('kommt mit leerem Stand zurecht', () => {
    assert.deepEqual(zuletzt([]), [])
  })
})

describe('haeufigste', () => {
  it('nimmt nur, was mindestens zweimal lief', () => {
    const s = [e('einmal', 1, 100), e('zweimal', 2, 50)]
    assert.deepEqual(haeufigste(s).map((x) => x.key), ['zweimal'])
  })

  it('sortiert nach Haeufigkeit', () => {
    const s = [e('a', 3, 1), e('b', 9, 1)]
    assert.deepEqual(haeufigste(s).map((x) => x.key), ['b', 'a'])
  })

  it('entscheidet bei gleichem Stand nach der juengeren Zeit', () => {
    // Sonst springt die Reihenfolge bei jedem Aufbau der Seite.
    const s = [e('alt', 4, 100), e('neu', 4, 900)]
    assert.deepEqual(haeufigste(s).map((x) => x.key), ['neu', 'alt'])
  })

  it('meldet nichts, wenn noch nichts oft lief', () => {
    assert.deepEqual(haeufigste([e('a', 1, 1)]), [])
  })
})

describe('istMeldung', () => {
  it('nimmt eine Meldung mit Schluessel an', () => {
    assert.equal(istMeldung({ key: 'spotify:a' }), true)
  })

  it('verwirft Fremdes', () => {
    for (const x of [null, 'text', 42, {}, { key: '' }, { key: '  ' }]) {
      assert.equal(istMeldung(x), false, JSON.stringify(x))
    }
  })
})

describe('meldungAusEintrag', () => {
  /**
   * DIE FORMEL DER ALTEN APP, woertlich abgeschrieben aus
   * player.service.ts:249-255. Sie steht hier ein zweites Mal, damit der Test
   * BEIDE Seiten vergleicht statt nur die neue mit sich selbst - genau das
   * soll er ja sicherstellen.
   */
  const wieDieAlteApp = (m: Record<string, string | undefined>): string | null => {
    const kern = m.id || m.playlistid || `${m.artist || ''}|${m.title || ''}`
    if (!kern || kern === '|') return null
    return `${m.type || 'medium'}:${kern}`
  }

  const FAELLE: Record<string, string | undefined>[] = [
    { type: 'spotify', id: '0rJLzAyAU7dVzV3iyGsH4l', title: 'Marshmallowbeeren', artist: 'Das Pummeleinhorn' },
    { type: 'spotify', playlistid: '37i9dQZF1DX', title: 'Alle Hoerspiele', artist: 'Hello Kitty' },
    { type: 'jellyfin-album', id: '88b86aa1b729', title: 'HAMM', artist: 'Kapelle Petra' },
    { type: 'library', title: 'Kinderlieder', artist: 'Verschiedene' },
    { title: 'Ohne Art', artist: 'Jemand' },
    { type: 'radio', id: 'https://stream.example/1', title: 'Sender' },
  ]

  it('bildet GENAU denselben Schluessel wie die Angular-App', () => {
    for (const f of FAELLE) {
      const meiner = meldungAusEintrag(f)
      assert.equal(meiner?.key ?? null, wieDieAlteApp(f), JSON.stringify(f))
    }
  })

  it('bevorzugt id vor playlistid vor Interpret|Titel', () => {
    assert.equal(meldungAusEintrag({ type: 't', id: 'A', playlistid: 'B', artist: 'C', title: 'D' })?.key, 't:A')
    assert.equal(meldungAusEintrag({ type: 't', playlistid: 'B', artist: 'C', title: 'D' })?.key, 't:B')
    assert.equal(meldungAusEintrag({ type: 't', artist: 'C', title: 'D' })?.key, 't:C|D')
  })

  it('nimmt medium, wenn keine Art dasteht', () => {
    assert.equal(meldungAusEintrag({ id: 'X' })?.key, 'medium:X')
  })

  it('meldet nichts, wenn kein Kern herauskommt', () => {
    // Sonst entstuende ein Eintrag mit dem Schluessel "medium:|", der jeden
    // weiteren namenlosen Eintrag mitzaehlt - ein Sammelposten, den niemand
    // zuordnen kann.
    for (const x of [null, undefined, {}, { type: 'spotify' }, { artist: '', title: '' }]) {
      assert.equal(meldungAusEintrag(x as never), null, JSON.stringify(x))
    }
  })

  it('reicht die Felder fuer die Kachel durch', () => {
    const m = meldungAusEintrag({
      type: 'spotify',
      id: 'A',
      title: 'T',
      artist: 'I',
      category: 'audiobook',
      cover: 'https://x/y.jpg',
    })
    assert.equal(m?.title, 'T')
    assert.equal(m?.artist, 'I')
    assert.equal(m?.category, 'audiobook')
    assert.equal(m?.cover, 'https://x/y.jpg')
    // Leere Felder gar nicht erst mitschicken - sonst stuenden im Verlauf
    // lauter leere Zeichenketten statt gar nichts.
    assert.equal(meldungAusEintrag({ type: 't', id: 'A' })?.artist, undefined)
  })
})
