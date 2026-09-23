#!/usr/bin/env node
// Prueft, ob sich das LAUFZEITVERHALTEN der Feld- und Konfig-Riegel im
// ausgelieferten server.js NUR mit PUT/POST messen laesst.
//
// Zwei Wege, beide ohne Schreibzugriff auf die Box:
//   1) Aufrufgraph: welche Routen (GET/PUT/POST) erreichen pruefeFeld/pruefeKonfig?
//   2) Ausfuehren: die minifizierten Funktionen aus dem Buendel herausschneiden
//      und lokal in node laufen lassen - echtes Verhalten, keine Zeichenkette.
//
// Aufruf: node tools/grenzruf-nur-lesend-messen.mjs <pfad-zu-server.js>

import { readFileSync } from 'node:fs';

const datei = process.argv[2];
if (!datei) {
  console.error('Aufruf: node tools/grenzruf-nur-lesend-messen.mjs <server.js>');
  process.exit(2);
}
const q = readFileSync(datei, 'utf8');

// ---------- Werkzeug: Klammern zaehlen ----------
function bloeckeEnde(text, start) {
  // start zeigt auf die oeffnende {
  let tiefe = 0, i = start, inStr = null, esc = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') tiefe++;
    else if (c === '}') { tiefe--; if (tiefe === 0) return i + 1; }
  }
  return -1;
}

function funktionAb(text, name) {
  const m = text.indexOf('function ' + name + '(');
  if (m < 0) return null;
  const auf = text.indexOf('{', m);
  const zu = bloeckeEnde(text, auf);
  return zu < 0 ? null : text.slice(m, zu);
}

// ---------- 1) Routen einsammeln ----------
const routen = [];
const rx = /([A-Za-z0-9_$]+)\.(get|put|post|delete|patch)\("(\/[^"]*)"/g;
let t;
while ((t = rx.exec(q))) {
  const auf = q.indexOf('{', rx.lastIndex);
  const zu = auf > 0 ? bloeckeEnde(q, auf) : -1;
  routen.push({
    verb: t[2].toUpperCase(),
    pfad: t[3],
    von: t.index,
    bis: zu > 0 ? zu : t.index + 400,
    rumpf: zu > 0 ? q.slice(t.index, zu) : q.slice(t.index, t.index + 400),
  });
}

// ---------- 2) Aufrufgraph ----------
// alle top-level Funktionsnamen
const namen = new Set();
for (const m of q.matchAll(/function ([A-Za-z0-9_$]{1,6})\(/g)) namen.add(m[1]);

const rumpfVon = new Map();
for (const n of namen) {
  const r = funktionAb(q, n);
  if (r) rumpfVon.set(n, r);
}

function rufeIn(text) {
  const raus = new Set();
  for (const m of text.matchAll(/([A-Za-z0-9_$]{1,6})\(/g)) if (namen.has(m[1])) raus.add(m[1]);
  return raus;
}

function erreichbarVon(startText, ziel, tiefe = 6) {
  const gesehen = new Set();
  let rand = [...rufeIn(startText)];
  const weg = new Map();
  for (let d = 0; d < tiefe && rand.length; d++) {
    const naechste = [];
    for (const n of rand) {
      if (gesehen.has(n)) continue;
      gesehen.add(n);
      if (n === ziel) return { ja: true, ueber: weg.get(n) ?? n };
      const r = rumpfVon.get(n);
      if (!r) continue;
      for (const k of rufeIn(r)) if (!gesehen.has(k)) { naechste.push(k); if (!weg.has(k)) weg.set(k, (weg.get(n) ?? n) + '>' + k); }
    }
    rand = naechste;
  }
  return { ja: false };
}

// Rumpf der Funktion, die eine bestimmte Zeichenkette enthaelt
function funktionUm(text, marke) {
  const p = text.indexOf(marke);
  if (p < 0) return null;
  let best = null;
  for (const m of text.matchAll(/function ([A-Za-z0-9_$]{1,6})\(/g)) {
    if (m.index > p) break;
    best = m;
  }
  if (!best) return null;
  const auf = text.indexOf('{', best.index);
  const zu = bloeckeEnde(text, auf);
  return zu > p ? { name: best[1], rumpf: text.slice(best.index, zu) } : null;
}

// ---------- 3) Ausfuehren statt nur lesen ----------
// Schneidet die minifizierten Funktionen aus dem Buendel und laesst sie laufen.
// Die drei Riegel sind rein: keine Datei, kein Netz, kein Geraetezustand.
function ausschneidenUndLaufenLassen(quelltext, namenListe, aufrufer) {
  const teile = namenListe.map(n => funktionAb(quelltext, n));
  for (let i = 0; i < teile.length; i++) if (!teile[i]) throw new Error('nicht gefunden: ' + namenListe[i]);
  const bau = new Function(teile.join('\n') + '\nreturn {' + namenListe.join(',') + '};');
  const fn = bau();
  return aufrufer(fn);
}

// Holt den Rumpf eines Route-Handlers als ausfuehrbare Funktion, mit
// bereitgestellten Nachbarn im Geltungsbereich (fuer die Wachklausel genuegen wenige).
function handlerAusRoute(quelltext, verb, pfad, nachbarn) {
  const re = new RegExp('[A-Za-z0-9_$]+\\.' + verb.toLowerCase() + '\\("' + pfad.replace(/\//g, '\\/') + '"');
  const m = re.exec(quelltext);
  if (!m) return null;
  // den letzten Parameter (den Handler) finden: ab "async(" oder "(t,e)=>"
  const abschnitt = quelltext.slice(m.index, m.index + 4000);
  const h = /(async)?\((t|[A-Za-z0-9_$]+),\s*([A-Za-z0-9_$]+)\)=>\{/.exec(abschnitt);
  if (!h) return null;
  const auf = m.index + h.index + h[0].length - 1;
  const zu = bloeckeEnde(quelltext, auf);
  const quelle = quelltext.slice(m.index + h.index, zu);
  const teile = Object.keys(nachbarn);
  const bau = new Function(...teile, 'return (' + quelle + ');');
  return { quelle, fn: bau(...teile.map(k => nachbarn[k])) };
}

export { q, routen, funktionAb, funktionUm, bloeckeEnde, erreichbarVon, rumpfVon, namen, ausschneidenUndLaufenLassen, handlerAusRoute };

if (import.meta.url === `file://${process.argv[1]}`) {
  const ziele = process.argv.slice(3);
  if (ziele[0] === '--messen') {
    const F = ausschneidenUndLaufenLassen(q, ['C1', 'pE', 'Hp'], x => x);
    console.log('A) nenntListe ausgefuehrt:');
    for (const w of [null, 'text', {}, { profile: 'nein' }, [], { profile: [] }]) console.log('   ', JSON.stringify(w), '->', F.pE(w));
    const h = handlerAusRoute(q, 'put', '/api/profile', { pE: F.pE });
    console.log('B) PUT /api/profile Handler ausgefuehrt (Attrappen):');
    for (const koerper of [undefined, {}, 'text', { profile: 'nein' }]) {
      let g = null;
      const e = { status(c) { g = { code: c }; return { json(j) { g.json = j; } }; } };
      try { h.fn({ body: koerper }, e); } catch { }
      console.log('    body=' + JSON.stringify(koerper) + ' ->', JSON.stringify(g));
    }
    console.log('C) pruefeFeld zahl (min0 max100) ausgefuehrt:');
    for (const w of [7.9, -3.7, '12abc', 100.9, -0.4, '', null, NaN]) console.log('   ', JSON.stringify(w) ?? String(w), '->', JSON.stringify(F.C1({ art: 'zahl', min: 0, max: 100 }, w, 10)));
    console.log('D) pruefeKonfig Riegel gedimmt>hell ausgefuehrt:');
    const basis = { interfacelogin: { state: !1, password: '' }, mupibox: { audioDevice: 'x' } };
    console.log('    Min 90 > Max 10 ->', JSON.stringify(Hp2({ ...basis, shim: { ledBrightnessMax: 10, ledBrightnessMin: 90 } })));
    console.log('    Min 50 = Max 50 ->', JSON.stringify(Hp2({ ...basis, shim: { ledBrightnessMax: 50, ledBrightnessMin: 50 } })));
    function Hp2(k) { return F.Hp(k); }
    process.exit(0);
  }
  console.log('Routen gesamt:', routen.length);
  for (const ziel of ziele) {
    console.log('\n=== Ziel ' + ziel + ' ===');
    if (!rumpfVon.has(ziel)) console.log('  (Funktion ' + ziel + ' nicht als top-level function gefunden)');
    for (const r of routen) {
      const direkt = new RegExp('[^A-Za-z0-9_$]' + ziel.replace(/\$/g, '\\$') + '\\(').test(r.rumpf);
      const e = direkt ? { ja: true, ueber: 'direkt' } : erreichbarVon(r.rumpf, ziel);
      if (e.ja) console.log('  ' + r.verb.padEnd(6) + r.pfad + '   ueber ' + e.ueber);
    }
  }
}
