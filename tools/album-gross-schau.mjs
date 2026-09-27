#!/usr/bin/env node
/**
 * IST DAS COVER IN DER GROSSEN ALBUMANSICHT WIRKLICH GANZ ZU SEHEN?
 *
 * WOFUER, woertlich weitergegeben (02.08.2026): „dann im der alben cover
 * ansicht die bedien elemente muessen an den rand das cover muss ganz sichtbar
 * sein sagt meine tochter."
 *
 * „Ganz sichtbar" ist eine Aussage ueber Rechtecke, und die laesst sich
 * rechnen: Jedes Bedienelement wird mit dem Rechteck des Bildes geschnitten.
 * Was sich ueberlappt, verdeckt — egal wie durchsichtig der Verlauf darueber
 * gerade aussieht. Dazu die beiden Fragen, die man daneben vergisst: Sind die
 * Knoepfe noch gross genug (64 px = 9 mm), und werden sie auch getroffen?
 *
 * DER RUECKWEG IST SEIT 03.08.2026 NICHT MEHR `#ag-zurueck`, sondern der eine
 * `#zurueck` der ganzen Oberflaeche — er liegt mit z-index 9 ueber dieser
 * Ansicht. Gemessen wird er hier weiterhin, und aus demselben Grund: Er steht
 * in der linken Randspalte, und ob er dem Cover etwas wegnimmt, entscheidet
 * seine Lage, nicht seine Herkunft.
 *
 * WICHTIG: `object-fit: contain` heisst, dass das <img> GROESSER sein kann als
 * das Bild darin. Gemessen wird deshalb nicht das Element, sondern die
 * WIRKLICH BEMALTE Flaeche — aus dem Seitenverhaeltnis der Bildquelle
 * gerechnet. Wer das Element misst, findet Ueberlappungen, die es nicht gibt,
 * und uebersieht die, die es gibt.
 *
 * WAS ES AENDERT: nichts. Eigener Browser gegen tools/neu-vorschau.mjs.
 *
 * AUFRUF
 *     node tools/album-gross-schau.mjs
 *     node tools/album-gross-schau.mjs --pruefen
 *     node tools/album-gross-schau.mjs --bild album-gross.png
 */
import { writeFile } from 'node:fs/promises'
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')
const BILD = (() => {
  const i = process.argv.indexOf('--bild')
  return i >= 0 ? process.argv[i + 1] || 'album-gross.png' : null
})()

/** 800x480 sind 0,14 mm/px; 64 px sind 9 mm (ISO 9241-411). */
const ZIEL_PX = 64

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

let lfd = 0
const send = (ws, m, p = {}) =>
  new Promise((ok, no) => {
    const i = ++lfd
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
let fehler = 0
const melde = (z) => {
  fehler++
  console.error(`  FEHLER  ${z}`)
}
const zeile = (name, wert) => console.log(`  ${String(name).padEnd(44)} ${wert}`)

try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  // Ohne das misst man einen Schirm, den es nicht gibt: `--window-size` liess
  // dem Sichtfenster nur 337 statt 480 px Hoehe.
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  // ══ DIE LAGE WIRD GESTELLT UND NICHT VORGEFUNDEN ═══════════════════════
  //
  // HIER STAND NICHTS, UND DAS HAT DIESES WERKZEUG ZU EINEM LUEGNER GEMACHT.
  // Die Albumansicht IST das Cover des laufenden Titels. Laeuft nichts, gibt
  // es kein Kissen, keinen grossen Player und kein Cover — und dann misst
  // dieser Lauf einen Schirm, den es in dieser Lage gar nicht geben KANN.
  //
  // GEMESSEN, NICHT BEFUERCHTET (07.08.2026): Nach einem Lauf von
  // tools/eltern-seite-schau.mjs steht die Vorschau auf `spielt: "still"` und
  // `cover: false`. Wer danach dieses Werkzeug startet, bekommt REPRODUZIERBAR
  // „13 Abweichung(en)". Direkt nach `voll`/`spielt` bekommt er „ohne
  // Abweichung" — dieselbe Zeile Code, derselbe Baum, dieselbe Minute.
  //
  // DIE 13 SIND ALSO SCHON EINMAL WEITERGEREICHT WORDEN als „standen vorher
  // schon so da, nicht von mir behoben". Das war der falsche Schluss aus einer
  // richtigen Beobachtung: Es war nie ein Fehler der Oberflaeche, sondern eine
  // Vorbedingung, die dieses Werkzeug nicht genannt hat.
  //
  // ZURUECKGELEGT WIRD SIE VON `leihe.zurueckgeben()` weiter unten — was hier
  // gestellt wird, gehoert dem Lauf und nicht dem naechsten.
  // Siehe [[vorschau-wird-geliehen]] und den Kopf von tools/leihgabe.mjs.
  for (const w of ['voll', 'mit-cover', 'spielt']) {
    await fetch(new URL(`/vorschau/${w}`, ZIEL)).catch(() => null)
    await warte(120)
  }

  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(2500)

  // Der Weg dorthin ist der ECHTE: grosser Player auf, dann aufs Cover tippen.
  // Ein `hidden = false` von aussen zeigt die Ansicht auch dann, wenn sie ueber
  // die Oberflaeche gar nicht mehr erreichbar waere.
  const weg = await ev(`(() => {
    const auf = document.querySelector('.mp-bild'); if (!auf) return 'kein Mini-Player';
    auf.click();
    const c = document.querySelector('#gross .gross-bild'); if (!c) return 'kein Cover im Player';
    c.click();
    return document.getElementById('album-gross').hidden ? 'Ansicht blieb zu' : 'ok' })()`)
  zeile('Weg dorthin (Player -> Cover)', weg)
  if (weg !== 'ok') melde(`die Albumansicht war ueber die Oberflaeche nicht zu erreichen: ${weg}`)
  await warte(600)

  const messFn = `
    /**
     * Die WIRKLICH BEMALTE Flaeche eines <img> mit object-fit: contain.
     * Ohne diese Rechnung misst man den Kasten und nicht das Bild.
     */
    function bildFlaeche(img) {
      const r = img.getBoundingClientRect();
      const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
      const f = Math.min(r.width / nw, r.height / nh);
      const b = nw * f, h = nh * f;
      return { left: r.left + (r.width - b) / 2, top: r.top + (r.height - h) / 2, width: b, height: h,
               right: r.left + (r.width + b) / 2, bottom: r.top + (r.height + h) / 2 };
    }
    function schnitt(a, b) {
      const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return { breit: Math.round(w), hoch: Math.round(h), flaeche: Math.round(w * h) };
    }
    (() => {
      const img = document.getElementById('ag-bild');
      const cover = bildFlaeche(img);
      const stuecke = [
        ['Rueckweg',  document.getElementById('zurueck')],
        ['Titel',     document.querySelector('.ag-wort')],
        ['Knopfleiste', document.querySelector('.ag-leiste')],
      ];
      const ueber = stuecke.map(([n, e]) => {
        const r = e.getBoundingClientRect();
        return { name: n, ...schnitt(cover, r) };
      });
      // Und der Verlauf, falls es ihn noch gibt: ein ::after ueber dem Bild
      // verdunkelt es genauso, auch wenn es kein Bedienelement ist.
      const nach = getComputedStyle(document.getElementById('album-gross'), '::after');
      const verlauf = nach.content !== 'none' && nach.content !== 'normal';
      const knoepfe = [...document.querySelectorAll('.ag-knopf, .zurueck')].map((k) => {
        const r = k.getBoundingClientRect();
        const o = document.elementFromPoint(Math.round(r.left + r.width/2), Math.round(r.top + r.height/2));
        return { id: k.id, b: Math.round(r.width), h: Math.round(r.height), trifft: !!(o && k.contains(o)) };
      });
      const t = document.querySelector('.ag-titel'), u = document.querySelector('.ag-unter');
      return {
        cover: { b: Math.round(cover.width), h: Math.round(cover.height),
                 l: Math.round(cover.left), r: Math.round(cover.right) },
        kasten: { b: Math.round(img.getBoundingClientRect().width), h: Math.round(img.getBoundingClientRect().height) },
        ueber, verlauf, knoepfe,
        // WIE VIELE ZEILEN BRAUCHT ER, UND WIE VIELE DARF ER?
        // NICHT ueber scrollHeight gegen clientHeight: Bei einer Box mit
        // Zeilendeckel weichen die beiden auch dann um ein bis zwei
        // Bildpunkte ab, wenn alles hineinpasst — das meldete faelschlich
        // "abgeschnitten". Gezaehlt werden ZEILEN: einmal ohne Deckel messen,
        // dann durch die Zeilenhoehe teilen.
        // (KEINE Rueckstriche in diesem Kommentar — er steht in einem
        //  Vorlagenliteral und beendete es sonst mitten im Satz.)
        titel: (() => {
          const s = getComputedStyle(t);
          const zh = parseFloat(s.lineHeight) || 20;
          const deckel = parseInt(s.webkitLineClamp, 10) || 0;
          const alt = t.style.webkitLineClamp;
          t.style.webkitLineClamp = 'unset';
          const voll = t.scrollHeight;
          t.style.webkitLineClamp = alt;
          const noetig = Math.max(1, Math.round(voll / zh));
          return { text: (t.textContent||'').trim(), noetig, deckel,
                   abgeschnitten: deckel > 0 && noetig > deckel,
                   voll: Math.round(voll), gezeigt: t.clientHeight, zh: Math.round(zh),
                   breit: Math.round(t.getBoundingClientRect().width) };
        })(),
        unter: (u.textContent||'').trim(),
      };
    })()`

  const messen = async (licht) => {
    await ev(`document.documentElement.setAttribute('data-licht', ${JSON.stringify(licht)})`)
    await warte(200)
    return ev(messFn)
  }

  for (const licht of ['hell', 'dunkel']) {
    const m = await messen(licht)
    console.log(`\n  ── ${licht} ──`)
    zeile('Cover (bemalte Flaeche)', `${m.cover.b} x ${m.cover.h} px, x ${m.cover.l}..${m.cover.r}`)
    zeile('Bildkasten', `${m.kasten.b} x ${m.kasten.h} px`)
    for (const u of m.ueber) {
      zeile(`  ${u.name} verdeckt`, u.flaeche === 0 ? 'nichts' : `${u.breit} x ${u.hoch} px = ${u.flaeche} px²`)
      if (u.flaeche > 0) melde(`${licht}: ${u.name} liegt ${u.breit} x ${u.hoch} px auf dem Cover`)
    }
    zeile('Verlauf ueber dem Bild', m.verlauf ? 'JA' : 'nein')
    if (m.verlauf) melde(`${licht}: ein Verlauf liegt ueber dem Cover und verdunkelt es`)
    for (const k of m.knoepfe) {
      zeile(`  Knopf ${k.id}`, `${k.b} x ${k.h} px${k.trifft ? '' : '  — WIRD NICHT GETROFFEN'}`)
      if (k.b < ZIEL_PX || k.h < ZIEL_PX)
        melde(`${licht}: ${k.id} ist ${k.b}x${k.h} px, unter den geforderten ${ZIEL_PX}`)
      if (!k.trifft) melde(`${licht}: ${k.id} wird von etwas anderem verdeckt`)
    }
    zeile(
      'Titel',
      `„${m.titel.text}" auf ${m.titel.breit} px, ${m.titel.noetig} von ${m.titel.deckel} Zeilen ` +
        `(voll ${m.titel.voll} px, gezeigt ${m.titel.gezeigt} px, Zeile ${m.titel.zh} px)` +
        (m.titel.abgeschnitten ? ' — ABGESCHNITTEN' : ''),
    )
    if (m.titel.abgeschnitten) melde(`${licht}: der Titel passt nicht in die Randspalte`)
    zeile('Zweite Zeile', m.unter ? `„${m.unter}"` : '(leer)')

    if (BILD) {
      const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
      const datei = BILD.replace(/(\.png)?$/, `-${licht}.png`)
      await writeFile(datei, Buffer.from(s.data, 'base64'))
      console.log(`  Bild: ${datei}`)
    }
  }
  await ev(`document.documentElement.setAttribute('data-licht', 'hell')`)

  // ── DER LANGE TITEL ─────────────────────────────────────────────────────
  //
  // WOZU: Der Titel der Attrappe ist kurz („Folge 3 — Die Maus", eine Zeile).
  // Die Frage, wie viele Zeilen die Randspalte tragen muss, beantwortet er
  // deshalb NICHT — und genau ueber diese Zahl steht im Blatt ein Deckel
  // (`-webkit-line-clamp`). Ein Deckel, der nie an einem langen Titel gemessen
  // wurde, ist eine Behauptung; hier wird einer eingesetzt, der so auf der Box
  // vorkommt (llmwiki mediathek-aufraeumen: Serientitel plus Folgenname).
  //
  // Der Text wird danach zurueckgesetzt — gemessen wird, nicht veraendert.
  const LANG = 'Bibi Blocksberg — Die Kartoffelsuppe und der verhexte Besen (Folge 42)'
  const lang = await ev(`(() => {
    const t = document.querySelector('.ag-titel');
    const alt = t.textContent;
    t.textContent = ${JSON.stringify(LANG)};
    const s = getComputedStyle(t);
    const zh = parseFloat(s.lineHeight) || 20;
    const deckel = parseInt(s.webkitLineClamp, 10) || 0;
    const merk = t.style.webkitLineClamp;
    t.style.webkitLineClamp = 'unset';
    const voll = t.scrollHeight;
    t.style.webkitLineClamp = merk;
    const noetig = Math.max(1, Math.round(voll / zh));
    // Wie viel Hoehe hat die Spalte ueberhaupt? Vom oberen Rand des Titels bis
    // zum unteren Rand des Schirms — mehr steht ihm nicht zur Verfuegung.
    const platz = Math.round(window.innerHeight - t.getBoundingClientRect().top);
    t.textContent = alt;
    return { noetig, deckel, zh: Math.round(zh), platz, deckelHoch: Math.round(deckel * zh) };
  })()`)
  console.log('\n  ── Worst case: ein langer Serientitel ──')
  zeile('Titel', `„${LANG}"`)
  zeile('braucht Zeilen', `${lang.noetig} (Deckel ${lang.deckel}, Zeile ${lang.zh} px)`)
  zeile('Deckel in Bildpunkten', `${lang.deckelHoch} px von ${lang.platz} px Spaltenhoehe`)
  if (lang.deckelHoch > lang.platz) {
    melde(`der Zeilendeckel (${lang.deckelHoch} px) ist hoeher als die Spalte (${lang.platz} px)`)
  }

  console.log(fehler ? `\n  ${fehler} Abweichung(en)` : '\n  ohne Abweichung')
} finally {
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  await brw.schliessen()
  await leihe.zurueckgeben()
}

process.exit(PRUEFEN && fehler ? 1 : 0)
