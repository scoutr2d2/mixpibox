/**
 * JELLYFIN — der zweite Anbieter auf dem E77/E80-Vertrag.
 *
 * ══ WOHER DER ZUGANG KOMMT ═════════════════════════════════════════════════
 *
 * Aus `kontext.konfig.jellyfin` (E80): das Manifest meldet die Gruppe an, der
 * Wirt reicht sie eingefroren herein, und die Streaming-Karte der Verwaltung
 * bleibt die EINE Stelle, an der Server und Schluessel gepflegt werden.
 * Aendert sie die Werte, startet der Wirt dieses Plugin neu — hier liest also
 * immer der Stand, mit dem gestartet wurde.
 *
 * DER ALTE KERN-WEG las den Zugang aus den COVERADRESSEN der Bibliothek
 * (jellyfinZugangAusListe) — historisch gewachsen, mit der Konfiguration als
 * Rueckfall. Dieses Plugin dreht das um: die Konfiguration IST die Quelle;
 * eine Box ohne Eintrag ist ehrlich „nicht eingerichtet", statt ihren Zugang
 * aus alten Bildadressen zu klauben.
 *
 * ══ DIE GEMESSENEN REGELN, DIE MITGEZOGEN SIND ═════════════════════════════
 *
 *   DIRECT PLAY  `static=true` an der Stromadresse: der Server liefert die
 *                Originaldatei statt umzurechnen — ohne das meldet mpv eine
 *                falsche Laenge (am Geraet erprobt, jellyfin.ts).
 *   ZWEI SUCHEN  `searchTerm` durchsucht nur den NAMEN des Objekts. Wer den
 *                Interpreten eingibt, findet nichts („Zukunft" fand das
 *                Album, „lumpenpack" nicht) — also zusaetzlich ueber
 *                /Artists gehen. Bei Titeln zaehlt ArtistIds, bei Alben
 *                AlbumArtistIds — sonst fehlen Gastbeitraege bzw. umgekehrt.
 *   TICKS        RunTimeTicks sind 100-ns-Schritte: /10^7 = Sekunden.
 *
 * KEINE ABHAENGIGKEITEN, wie bei jedem Plugin dieses Hauses.
 */

/** Server und Schluessel aus dem Kontext — oder null mit klarem Grund. */
function zugangAus(kontext) {
  const jf = kontext.konfig?.jellyfin ?? {}
  const server = String(jf.server ?? '').trim().replace(/\/+$/, '')
  const schluessel = String(jf.apiKey ?? '').trim()
  if (!server || !schluessel) return null
  return { server, schluessel }
}

/** Eine Jellyfin-Frage. Liefert { daten, ms } oder wirft mit Status. */
async function fragen(kontext, zugang, pfad) {
  const trenner = pfad.includes('?') ? '&' : '?'
  const ab = Date.now()
  const antwort = await kontext.holen(`${zugang.server}${pfad}${trenner}api_key=${encodeURIComponent(zugang.schluessel)}`)
  const ms = Date.now() - ab
  if (!antwort.ok) throw new Error(`Jellyfin antwortet mit ${antwort.status}`)
  return { daten: await antwort.json(), ms }
}

/** Die Stromadresse eines Titels — Direct Play, siehe Kopf. */
function stromAdresse(zugang, kennung) {
  return `${zugang.server}/Audio/${encodeURIComponent(kennung)}/stream?static=true&api_key=${encodeURIComponent(zugang.schluessel)}`
}

function coverAdresse(zugang, kennung) {
  return `${zugang.server}/Items/${encodeURIComponent(kennung)}/Images/Primary?api_key=${encodeURIComponent(zugang.schluessel)}`
}

function sekundenAus(ticks) {
  const t = Number(ticks)
  return Number.isFinite(t) && t > 0 ? Math.floor(t / 10_000_000) : undefined
}

export default {
  /** Ein Satz fuer die Karte: antwortet der eingetragene Server? */
  async befinden(kontext) {
    const zugang = zugangAus(kontext)
    if (!zugang) return { ok: false, text: 'Kein Server oder kein Schlüssel eingetragen (Felder oben).' }
    if (!kontext.holen) return { ok: false, text: 'Das Recht `netz` fehlt.' }
    try {
      const { daten, ms } = await fragen(kontext, zugang, '/System/Info')
      const name = String(daten?.ServerName ?? 'Jellyfin')
      const version = String(daten?.Version ?? '')
      return { ok: true, text: `${name}${version ? ' ' + version : ''} antwortet (${ms} ms).` }
    } catch (f) {
      return { ok: false, text: `Server nicht erreichbar: ${f.message}` }
    }
  },

  async aktion(kennung, kontext) {
    if (kennung !== 'pruefen') return { ok: false, text: `Unbekannte Aktion "${kennung}".` }
    const zugang = zugangAus(kontext)
    if (!zugang) return { ok: false, text: 'Kein Zugang eingetragen.' }
    const zeiten = []
    for (let i = 0; i < 3; i++) {
      try {
        const { ms } = await fragen(kontext, zugang, '/System/Info')
        zeiten.push(ms)
      } catch (f) {
        return { ok: false, text: `Anfrage ${i + 1} von 3 scheiterte: ${f.message}` }
      }
    }
    const schnitt = Math.round(zeiten.reduce((a, b) => a + b, 0) / zeiten.length)
    return { ok: true, text: `Dreimal gefragt: ${zeiten.join(', ')} ms — Mittel ${schnitt} ms.` }
  },

  /**
   * Ein Album zu seiner geordneten Titelliste (E78). rest = Album-ItemId.
   *
   * Dieselbe Items-Abfrage, die der Kern seit jeher nutzt — Reihenfolge
   * nach ParentIndexNumber,IndexNumber (Disc, dann Titelnummer).
   */
  async inhalt(rest, kontext) {
    const zugang = zugangAus(kontext)
    if (!zugang) throw new Error('kein Jellyfin-Zugang eingetragen')
    if (!kontext.holen) throw new Error('Das Recht `netz` fehlt.')
    const kennung = String(rest).split('#', 1)[0]
    if (!kennung) throw new Error('keine Album-Kennung')
    const { daten } = await fragen(
      kontext,
      zugang,
      `/Items?ParentId=${encodeURIComponent(kennung)}&IncludeItemTypes=Audio&Recursive=true` +
        `&SortBy=ParentIndexNumber,IndexNumber&Fields=Artists,RunTimeTicks&Limit=200`,
    )
    const roh = Array.isArray(daten?.Items) ? daten.Items : []
    const folgen = []
    for (const x of roh) {
      if (!x?.Id || !x?.Name) continue
      const f = {
        kennung: String(x.Id),
        name: String(x.Name),
        quelle: { art: 'strom', adresse: stromAdresse(zugang, String(x.Id)) },
      }
      const wer = String(x.AlbumArtist ?? (Array.isArray(x.Artists) ? x.Artists.join(', ') : '')).trim()
      if (wer) f.kuenstler = wer
      const dauer = sekundenAus(x.RunTimeTicks)
      if (dauer) f.dauerSek = dauer
      f.bild = coverAdresse(zugang, String(x.Id))
      folgen.push(f)
    }
    return {
      // Der Albumtitel steht am ersten Titel — eine zweite Abfrage nur fuer
      // den Namen waere ein Rundlauf fuer ein Wort, das der Eintrag der
      // Bibliothek ohnehin traegt.
      titel: String(roh[0]?.Album ?? '').trim() || kennung,
      kuenstler: String(roh[0]?.AlbumArtist ?? '').trim() || undefined,
      folgen,
      vollstaendig: roh.length < 200,
    }
  },

  /** EIN Titel — rest = ItemId. Fuer gezielte Einzelstuecke. */
  async aufloesen(rest, kontext) {
    const zugang = zugangAus(kontext)
    if (!zugang) throw new Error('kein Jellyfin-Zugang eingetragen')
    if (!kontext.holen) throw new Error('Das Recht `netz` fehlt.')
    const kennung = String(rest).split('#', 1)[0]
    const { daten } = await fragen(kontext, zugang, `/Items?Ids=${encodeURIComponent(kennung)}&Fields=Artists,RunTimeTicks`)
    const x = daten?.Items?.[0]
    if (!x?.Id) throw new Error(`Titel ${kennung} ist dem Server unbekannt`)
    return {
      titel: {
        name: String(x.Name ?? kennung),
        kuenstler: String(x.AlbumArtist ?? (Array.isArray(x.Artists) ? x.Artists.join(', ') : '')).trim() || undefined,
        dauerSek: sekundenAus(x.RunTimeTicks),
        bild: coverAdresse(zugang, String(x.Id)),
      },
      quelle: { art: 'strom', adresse: stromAdresse(zugang, String(x.Id)) },
    }
  },

  /**
   * Die freie Flaeche (E77): `suche?q=&art=album|titel&anzahl=` fuer die
   * uebergreifende Suche der Verwaltung. Liefert je Treffer den fertigen
   * data.json-VORSCHLAG — `schonDa` rechnet der Kern (die Bibliothek gehoert
   * ihm), genau wie beim ARD-Plugin.
   */
  async http(anfrage, kontext) {
    if (anfrage.methode !== 'GET') return { status: 405, inhalt: { fehler: 'nur GET' } }
    const zugang = zugangAus(kontext)
    if (!zugang) return { status: 502, inhalt: { fehler: 'kein Jellyfin-Zugang eingetragen' } }

    // `art?id=` — was IST diese Kennung beim Server (Audio, MusicAlbum, ...)?
    // Der Kern fragt das beim Einfuegen in eine Liste: einer Jellyfin-Kennung
    // sieht man nicht an, ob sie ein Titel oder ein Album ist, und ein Album
    // als vermeintlicher Titel waere ein Eintrag, der nie spielt.
    if (anfrage.pfad === 'art') {
      const kennung = String(anfrage.abfrage.id ?? '').trim()
      if (!kennung) return { status: 400, inhalt: { fehler: 'keine Kennung' } }
      try {
        const { daten } = await fragen(kontext, zugang, `/Items?Ids=${encodeURIComponent(kennung)}`)
        return { inhalt: { art: String(daten?.Items?.[0]?.Type ?? '') } }
      } catch (f) {
        return { status: 502, inhalt: { fehler: f.message } }
      }
    }

    if (anfrage.pfad !== 'suche') return { status: 404, inhalt: { fehler: `kein Pfad "${anfrage.pfad}"` } }
    const q = String(anfrage.abfrage.q ?? '').trim()
    if (!q) return { status: 400, inhalt: { fehler: 'kein Suchbegriff' } }
    const istTitel = anfrage.abfrage.art === 'titel'
    const jfArt = istTitel ? 'Audio' : 'MusicAlbum'
    const felder = istTitel ? 'Fields=Artists,RunTimeTicks' : 'Fields=ChildCount'

    try {
      const gefunden = new Map()
      // 1. Nach dem NAMEN des Objekts.
      const nachName = await fragen(
        kontext,
        zugang,
        `/Items?searchTerm=${encodeURIComponent(q)}&IncludeItemTypes=${jfArt}&Recursive=true&Limit=20&${felder}`,
      )
      for (const x of nachName.daten?.Items ?? []) if (x?.Id) gefunden.set(x.Id, x)

      // 2. Ueber die INTERPRETEN — searchTerm kennt sie nicht (siehe Kopf).
      const kuenstler = await fragen(kontext, zugang, `/Artists?searchTerm=${encodeURIComponent(q)}&Limit=5`)
      const ids = (kuenstler.daten?.Items ?? []).map((a) => a?.Id).filter(Boolean).slice(0, 5)
      if (ids.length) {
        const feld = istTitel ? 'ArtistIds' : 'AlbumArtistIds'
        const weitere = await fragen(
          kontext,
          zugang,
          `/Items?${feld}=${ids.join(',')}&IncludeItemTypes=${jfArt}&Recursive=true&Limit=30&${felder}`,
        )
        for (const x of weitere.daten?.Items ?? []) if (x?.Id) gefunden.set(x.Id, x)
      }

      const treffer = []
      for (const x of gefunden.values()) {
        const wer = String(x.AlbumArtist ?? (Array.isArray(x.Artists) ? x.Artists.join(', ') : '')).trim()
        const t = {
          id: String(x.Id),
          titel: String(x.Name ?? ''),
          interpret: wer,
          cover: coverAdresse(zugang, String(x.Id)),
        }
        if (istTitel) {
          t.album = String(x.Album ?? '')
          t.dauerMs = x.RunTimeTicks ? Math.round(Number(x.RunTimeTicks) / 10_000) : undefined
        } else {
          t.titelAnzahl = Number(x.ChildCount) || undefined
          t.vorschlag = {
            type: 'jellyfin-album',
            category: 'music',
            id: String(x.Id),
            title: String(x.Name ?? ''),
            artist: wer,
            cover: coverAdresse(zugang, String(x.Id)),
          }
        }
        treffer.push(t)
      }
      return { inhalt: { treffer } }
    } catch (f) {
      return { status: 502, inhalt: { fehler: f.message } }
    }
  },
}
