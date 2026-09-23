/**
 * WELCHEN BEFEHL SCHICKT DIE INTERPRETENSEITE — je Kachel, in JEDER Reihe?
 *
 * WOFUER: Die Reihe „In deiner Box" zeigt Werke der Mediathek. Ob ein Tipp
 * darauf den RICHTIGEN Befehl ausloest, haengt daran, ob die Oberflaeche das
 * Werk fuer ein Spotify-ALBUM haelt. Sie entschied das lange an der FORM der
 * Kennung (22 Zeichen aus Buchstaben und Ziffern) — und eine Spotify-PLAYLIST
 * und eine SHOW haben genau dieselbe Form. Ergebnis war
 * `spotify/now/spotify:album:<playlist-id>:1:0`: Spotify bekommt einen
 * Zusammenhang, den es nicht gibt, und spielt nichts. Fuer ein Kind ist das
 * eine Kachel, die nicht reagiert.
 *
 * Der Befehl steht in keiner Meldung und in keinem Protokoll — nur auf der
 * Leitung. Deshalb wird hier MITGELESEN, statt am Quelltext zu raten.
 *
 * SEIT 2026-08-02 WERDEN ALLE REIHEN GEPRUEFT, nicht nur „In deiner Box".
 * Der Grund ist derselbe wie oben: Die anderen vier Reihen laufen durch
 * DIESELBE Funktion (`interpretKachelBauen`), aber durch einen ANDEREN Zweig
 * — sie haben kein Werk, `fremd` bleibt aus, und die Nummer kommt bei den
 * beliebtesten Titeln aus `titelNr` statt aus einer 1. Genau dort sitzt die
 * +1-Falle, und geprueft war davon nichts.
 *
 * WAS ES AENDERT: nichts. Es startet einen eigenen Browser gegen die
 * VORSCHAU (tools/neu-vorschau.mjs), tippt und liest mit. Weder die Box noch
 * Dateien werden angefasst.
 *
 * AUFRUF:
 *     node tools/neu-vorschau.mjs &            # Attrappe auf 8299
 *     node tools/interpretseite-befehle.mjs    # zeigt Kachel -> Befehl
 *     node tools/interpretseite-befehle.mjs --pruefen   # Ende 1 bei Fehlgriff
 *
 * DIE PRUEFUNG, Reihe fuer Reihe:
 *
 *   „In deiner Box"     Zu jeder Kachel steht das Werk aus /api/werke fest
 *                       (ueber den Titel). Sein `art`-Feld sagt, was es ist.
 *                       SEIT E95/V STUFE 2 (31.08.2026) zweigeteilt: ein
 *                       reines SPOTIFY-ALBUM startet die Seite weiter selbst
 *                       (`spotify:album:…`); JEDES ANDERE Box-Werk (Playlist,
 *                       Show, lokal, Jellyfin) laeuft ueber den
 *                       spielen()-Rueckfall und schickt den EINEN
 *                       `POST /api/spielen {schluessel}` — welcher Befehl
 *                       daraus wird (spotify:playlist:… usw.), waehlt der
 *                       Server; src/backend-api/src/spielen.integration.spec.ts
 *                       prueft das dort. Die Weiche steht in `erwartet()`.
 *   „Beliebteste Titel" DIE GANZE KACHEL startet, und zwar ueber das ALBUM
 *                       (`albumKennung`) an der Stelle `titelNr` — 1-basiert,
 *                       UNVERAENDERT. Erwartet wird
 *                       `spotify:album:<albumKennung>:<titelNr>:0`.
 *   Alben / Singles /   Der SPIELKNOPF startet das Album von vorn:
 *   Sammlungen          `spotify:album:<kennung>:1:0`.
 *
 * DAZU DIE MASSE: Am Ende misst es jedes Beruehrziel der Seite. Auf dem
 * 800x480-Schirm sind 0,14 mm/px — 64 px sind 9 mm (ISO 9241-411). Ein
 * Spielknopf auf einer Kachel darf kleiner sein (er liegt IN einem grossen
 * Ziel), der Rueckweg nicht: er ist der einzige Ausgang.
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')

// EINE SCHON LAUFENDE VORSCHAU WIRD GELIEHEN — UND ZURUECKGELEGT.
//
// Wer eine Lage stellt (/vorschau/…), muss sie am Ende wieder hinlegen,
// wenn ihm die Vorschau nicht gehoert: sonst misst der naechste Lauf gegen
// eine Vorschau, die jemand anders verstellt hat. Und der eigene Browser
// laeuft auf einem FREIEN Port mit eigenem Profil statt auf einer festen
// Nummer, die ein Ueberlebender eines harten Abbruchs noch halten koennte —
// `/json/list` liefert dann klaglos die Ziele des fremden.
// Beides samt der Messungen dahinter: tools/leihgabe.mjs.
const leihe = await vorschauLeihen(ZIEL)
const brw = await eigenerBrowser({ fenster: '800,480' }).catch(async (e) => {
  await leihe.zurueckgeben()
  console.error(`  Browser kam nicht hoch — Messung nicht moeglich: ${e.message}`)
  process.exit(2)
})
if (!brw) {
  await leihe.zurueckgeben()
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

let id = 0
const send = (ws, m, p = {}) =>
  new Promise((ok, no) => {
    const i = ++id
    ws.send(JSON.stringify({ id: i, method: m, params: p }))
    const h = (r) => {
      const x = JSON.parse(r)
      if (x.id !== i) return
      ws.off('message', h)
      x.error ? no(new Error(x.error.message)) : ok(x.result)
    }
    ws.on('message', h)
  })

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Was gehoert auf die Leitung, wenn diese Box-Kachel spielt?
 *
 * ══ SEIT STUFE 3 GIBT ES NUR NOCH WUENSCHE (E95/V, 31.08.2026) ══════════════
 * Die Interpretenseite baut KEINE /player-Befehle mehr. Ein BOX-Werk geht
 * per SCHLUESSEL (auch das Box-eigene Spotify-Album — bis Stufe 3 baute es
 * seinen Befehl selbst aus der Kennung und lief damit an der Verschmelzung
 * vorbei: ein verschmolzenes Album haette weiter Spotify gespielt, waehrend
 * das Raster laengst den Mitschnitt bevorzugt). Ein KATALOG-Album ohne
 * Bibliothekseintrag geht per KENNUNG ({dienst,art,id}); die Quellen- und
 * Befehlswahl dahinter prueft src/backend-api/src/spielen.integration.spec.ts.
 * Ein /player-Befehl aus dieser Seite waere jetzt selbst der Fehler.
 */
function erwartet(werk) {
  if (werk.schluessel) return { wunsch: true }
  return { kennung: true }
}

let fehler = 0
try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.navigate', { url: ZIEL })
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  await warte(2500)

  // MITLESEN STATT QUITTUNG GLAUBEN: `fetch` wird ueberschrieben und jeder
  // Spielerbefehl mitgeschrieben. Die Attrappe antwortet auf beides mit
  // {ok:true} — sie kann gar nicht wissen, dass eine Playlist-Id als Album
  // ausgegeben wurde. Nur der Wortlaut auf der Leitung sagt es.
  //
  // ZWEI LEITUNGEN, EIN MITLESER (E95/V Stufe 2, 31.08.2026, Vorbild
  // tools/kachel-spielt-je-dienst.mjs): neben den /player-Befehlen auch der
  // Spielfunktions-Wunsch `POST /api/spielen` SAMT RUMPF — die Kacheln des
  // spielen()-Rueckfalls schicken nur noch ihn, und wer allein die alte
  // Leitung laese, meldete jede davon als stumm.
  //
  // MITGELESEN WIRD AUCH DIE SEITE SELBST (`/api/interpret/<id>`). Nur so
  // steht fest, was eine Kachel schicken SOLL: `albumKennung` und `titelNr`
  // eines beliebten Titels stehen in keinem Element — wer sie aus dem DOM
  // raet, prueft seine eigene Vermutung.
  await ev(`window.__befehle = []; window.__wuensche = [];
    if (!window.__mitgelesen) { window.__mitgelesen = true;
      const alt = window.fetch;
      window.fetch = function (u, o) {
        let s = '';
        try {
          s = String(u && u.url ? u.url : u);
          if (s.includes('/player/')) window.__befehle.push(s)
          if (/\\/api\\/spielen$/.test(s)) {
            let w = null;
            try { w = JSON.parse((arguments[1] || {}).body || '{}') } catch {}
            window.__wuensche.push(w || {});
          }
        } catch {}
        const p = alt.apply(this, arguments);
        if (s.includes('/api/interpret/')) {
          p.then((r) => r.clone().json()).then((d) => { window.__seite = d }).catch(() => {})
        }
        return p
      } }
    true`)

  const werke = await (await fetch(new URL('/api/werke', ZIEL))).json()

  // Die runden Interpreten-Kacheln erscheinen erst, nachdem die Namenspruefung
  // durch ist — sie laeuft ueber das Netz.
  await ev(`document.getElementById('leute').hidden = false; true`)
  for (let i = 0; i < 40 && !(await ev(`document.querySelectorAll('#leute-reihe .leute-kachel').length`)); i++) {
    await warte(250)
  }
  const namen = await ev(
    `[...document.querySelectorAll('#leute-reihe .leute-kachel .leute-name')].map((e) => e.textContent)`,
  )
  if (!namen || !namen.length) throw new Error('keine Interpreten-Kachel — laeuft tools/neu-vorschau.mjs?')

  /**
   * Auf die Kachel `k` der Reihe `ri` tippen und den Befehl mitlesen.
   *
   * `knopf` waehlt, WAS getroffen wird: bei den beliebtesten Titeln startet
   * die GANZE Kachel, sonst nur der kleine Spielknopf darin (ein Tipp auf die
   * Kachel klappt dort die Titelliste auf und schickt gar nichts).
   *
   * ALLE KACHELN DER REIHE, NICHT DER SEITE: `.int-reihe > .lane-reihe`
   * beschraenkt auf die eigene Reihe. Ohne `:scope >` zaehlten die Kacheln
   * einer aufgeklappten Titelliste mit, und ab der zweiten Kachel traefe der
   * Index daneben — der Befehl waere dann echt, die Zuordnung nicht.
   */
  const tippen = async (ri, k, knopf) => {
    await ev(`window.__befehle = []; window.__wuensche = []; true`)
    await ev(
      `(() => { const r = document.querySelectorAll('#interpret-reihen .int-reihe')[${ri}]
          const kachel = r.querySelector(':scope > .lane-reihe').children[${k}]
          const b = kachel.querySelector('.tipp-spiel')
          ;(${knopf ? 'b || kachel' : 'kachel'}).click(); return true })()`,
    )
    // 1200 ms, nicht 900: ein JELLYFIN-Album schickt seinen ersten Befehl erst
    // nach `/api/werke/<s>/inhalt` und einem `stop`. Bei 900 ms stand dort
    // „(keiner)" — und weil ein Jellyfin-Werk ohnehin kein `spotify:` schicken
    // darf, ging das als „ok" durch. Deshalb unten zusaetzlich die Frage, ob
    // ueberhaupt ETWAS geschickt wurde.
    await warte(1200)
    const befehle = (await ev('window.__befehle')) || []
    const wuensche = (await ev('window.__wuensche')) || []
    const spielerStart = befehle.find((b) => !/\/(stop|state|local|setvolume)/.test(b)) || null
    const wunsch = wuensche[0] || null
    // Fuers Auge: der Spielerbefehl, sonst der Wunsch, sonst „(keiner)".
    const kurz = spielerStart
      ? spielerStart.replace(/^.*\/player\//, '')
      : wunsch
        ? `api/spielen ${JSON.stringify(wunsch)}`
        : '(keiner)'
    return { kurz, wunsch, spielerStart }
  }

  const melden = (gut, titel, was, kurz, soll) => {
    if (!gut) fehler++
    console.log(
      `    ${gut ? 'ok  ' : 'FALSCH'} ${String(titel).slice(0, 26).padEnd(26)} ${String(was).padEnd(16)} -> ${kurz}` +
        (gut ? '' : `   erwartet: ${soll}`),
    )
  }

  for (let n = 0; n < namen.length; n++) {
    await ev(`window.__seite = null; true`)
    await ev(`document.querySelectorAll('#leute-reihe .leute-kachel')[${n}].click(); true`)
    // Der Kopf steht sofort, die Reihen kommen nach.
    for (let i = 0; i < 40 && !(await ev(`document.querySelectorAll('#interpret-reihen .lane-kachel').length`)); i++) {
      await warte(250)
    }
    const seite = (await ev('window.__seite')) || { reihen: [] }
    const reihen = Array.isArray(seite.reihen) ? seite.reihen : []
    console.log(
      `\n  ${namen[n]} — ${reihen.length} Reihe(n): ` +
        reihen.map((r) => `${r.titel} (${r.eintraege.length}${r.gesamt ? ` von ${r.gesamt}` : ''})`).join(', '),
    )

    // Steht die abgeschnittene Zahl auch WIRKLICH auf dem Schirm? Der Server
    // kann sie schicken, so viel er will — wenn die Ueberschrift sie nicht
    // zeigt, behauptet die Reihe weiter „das ist alles".
    for (let ri = 0; ri < reihen.length; ri++) {
      if (!reihen[ri].gesamt) continue
      const kopf = await ev(
        `document.querySelectorAll('#interpret-reihen .int-reihe')[${ri}].querySelector('.int-reihe-kopf').textContent`,
      )
      // MIT TRENNPUNKT: `textContent` ist das, was die Vorlesestimme sagt.
      // Ohne ihn stand hier „Alben5 von 308".
      const soll = ` · ${reihen[ri].eintraege.length} von ${Number(reihen[ri].gesamt).toLocaleString('de-DE')}`
      const gut = String(kopf || '').includes(soll)
      if (!gut) fehler++
      console.log(`    ${gut ? 'ok  ' : 'FALSCH'} Ueberschrift „${String(kopf || '').trim()}" — erwartet „…${soll}"`)
    }

    for (let ri = 0; ri < reihen.length; ri++) {
      const r = reihen[ri]
      // Zwei Kacheln je Spotify-Reihe genuegen: sie laufen alle durch denselben
      // Zweig. „In deiner Box" wird GANZ geprueft — dort entscheidet jedes
      // einzelne Werk mit seiner `art` ueber den Befehl.
      const bis = r.id === 'box' ? r.eintraege.length : Math.min(2, r.eintraege.length)
      for (let k = 0; k < bis; k++) {
        const e = r.eintraege[k]
        const { kurz, wunsch, spielerStart } = await tippen(ri, k, r.id !== 'top')
        if (r.id === 'box') {
          const werk = (werke.werke || []).find((w) => w.titel === e.titel) || {}
          // EIN Wunsch mit dem Schluessel des Werks, und KEIN selbstgebauter
          // Spielerbefehl daneben — auch nicht beim Spotify-Album (siehe
          // `erwartet`). GAR NICHTS bleibt genauso falsch wie frueher: ein
          // Tipp, der nichts ausloest, sah vor der Titelliste-Attrappe wie
          // „kein spotify: noetig" aus.
          const gut = !!wunsch && wunsch.schluessel === werk.schluessel && !spielerStart
          melden(gut, e.titel, `art=${werk.art}`, kurz, `POST /api/spielen {schluessel:"${werk.schluessel}"}`)
        } else if (r.id === 'top') {
          // 1-BASIERT UND UNVERAENDERT. Der Wunsch traegt `titelNr` genau so,
          // wie die Seite sie vom Server bekam — die einzige Stelle, die eine
          // 1 addieren darf, ist der Befehlsbau im Server (`startPlan`);
          // geschaehe es hier ein zweites Mal, spielte jeder beliebte Titel
          // den naechsten. Seit Stufe 3 als KENNUNG-Wunsch (Album-Zusammen-
          // hang: der Titel steht in keiner Playlist-Position).
          const gut =
            !!wunsch &&
            !spielerStart &&
            wunsch.kennung?.art === 'album' &&
            wunsch.kennung?.id === e.albumKennung &&
            Number(wunsch.titelNr) === Number(e.titelNr)
          melden(gut, e.titel, `Titel ${e.titelNr}`, kurz, `Kennung-Wunsch album:${e.albumKennung} titelNr:${e.titelNr}`)
        } else {
          // Diskografie-Reihen (Alben, Singles, Sammlungen): Katalog-Alben
          // ohne Bibliothekseintrag — seit Stufe 3 der Kennung-Wunsch mit
          // titelNr 1 (von vorn).
          const gut =
            !!wunsch &&
            !spielerStart &&
            wunsch.kennung?.art === 'album' &&
            wunsch.kennung?.id === e.kennung &&
            Number(wunsch.titelNr) === 1
          melden(gut, e.titel, r.id, kurz, `Kennung-Wunsch album:${e.kennung} titelNr:1`)
        }
      }
    }

    // ── Die Masse ──────────────────────────────────────────────────────────
    //
    // 0,14 mm/px auf dem 800x480-Schirm: 64 px sind 9 mm (ISO 9241-411). Der
    // Rueckweg ist der EINZIGE Ausgang und muss die volle Flaeche haben; ein
    // Spielknopf liegt IN einer 118-px-Kachel und darf kleiner sein.
    //
    // SEIT 03.08.2026 IST DER RUECKWEG `#zurueck` — der eine fuer alle Ebenen.
    // Die Interpretenseite hat keinen eigenen mehr.
    const masse = await ev(
      `(() => { const m = (s) => { const e = document.querySelector(s); if (!e) return null
            const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] }
        return { zurueck: m('#zurueck'), bild: m('#interpret-bild'),
                 kachel: m('#interpret-reihen .lane-kachel'), spiel: m('#interpret-reihen .tipp-spiel'),
                 breite: document.documentElement.clientWidth, hoehe: document.documentElement.clientHeight } })()`,
    )
    if (n === 0 && masse) {
      const zeig = (name, w, mind) => {
        const gut = !w || w[0] >= mind
        if (!gut) fehler++
        console.log(
          `    ${gut ? 'ok  ' : 'FALSCH'} ${name.padEnd(26)} ${w ? `${w[0]}x${w[1]} px` : 'fehlt'}` +
            (gut ? '' : `   mindestens ${mind} px`),
        )
      }
      console.log(`\n  Masse bei ${masse.breite}x${masse.hoehe}:`)
      zeig('Rueckweg (einziger Ausgang)', masse.zurueck, 64)
      zeig('Kachel einer Reihe', masse.kachel, 64)
      zeig('Interpretenbild', masse.bild, 64)
      // Der Spielknopf ist KEIN eigenes Ziel: er liegt in der Kachel, und wer
      // danebentippt, klappt die Titel auf statt nichts zu tun.
      console.log(
        `    ---- Spielknopf in der Kachel  ${masse.spiel ? `${masse.spiel[0]}x${masse.spiel[1]} px` : 'fehlt'}`,
      )

      // HELL UND DUNKEL, GEMESSEN STATT BEHAUPTET. Die neue Zahl „ · 5 von
      // 308" steht in `--muted`, und `--muted` ist in beiden Lichtern eine
      // ANDERE Farbe (app.css: #8B8397 gegen #9A92AC). Gerechnet wird der
      // Kontrast nach WCAG 2.1; 3,0 ist die Grenze fuer Grosstext und
      // Bedienelemente, 4,5 die fuer Fliesstext.
      for (const licht of ['hell', 'dunkel']) {
        const k = await ev(
          `(() => { document.documentElement.setAttribute('data-licht', '${licht}')
            const e = document.querySelector('#interpret-reihen .int-reihe-zahl'); if (!e) return null
            const zu = (s) => (String(s).match(/[\\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number)
            const L = (c) => { const [r, g, b] = zu(c).map((v) => { v /= 255
                return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
              return 0.2126 * r + 0.7152 * g + 0.0722 * b }
            let el2 = e, hg = 'rgb(0,0,0)'
            while (el2) { const c = getComputedStyle(el2).backgroundColor
              if (c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c)) { hg = c; break }
              el2 = el2.parentElement }
            const a = L(getComputedStyle(e).color), b = L(hg)
            return Math.round((100 * (Math.max(a, b) + 0.05)) / (Math.min(a, b) + 0.05)) / 100 })()`,
        )
        console.log(`    ${k >= 3 ? 'ok  ' : 'FALSCH'} Kontrast „von 308" ${licht.padEnd(11)} ${k}:1`)
        if (!(k >= 3)) fehler++
      }
      await ev(`document.documentElement.setAttribute('data-licht', 'hell'); true`)
    }

    await ev(`document.getElementById('zurueck')?.click(); true`)
    await warte(500)
  }

  ws.close()
} catch (e) {
  console.log(`  FEHLER: ${e.message}`)
  fehler++
} finally {
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  await brw.schliessen()
  await leihe.zurueckgeben()
}

if (fehler) console.log(`\n  ${fehler} Befund(e) — die Interpretenseite schickt oder zeigt etwas Falsches.`)
else console.log('\n  Alle Reihen der Interpretenseite schicken den passenden Befehl, die Masse stimmen.')
process.exitCode = PRUEFEN && fehler ? 1 : 0
