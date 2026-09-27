#!/usr/bin/env node
// WOZU/WOFUER
// Zeigt, was der Abspieldienst (src/backend-player/src/spotify-control.ts,
// Abschnitt `app.use` ab Zeile 1597) aus einer eingehenden HTTP-Adresse macht:
// welches Verb erkannt wird, WELCHE ZWEIGE FEUERN (es sind oft mehrere!), und
// welche Stream-Adresse am Ende bei mpv landet.
//
// Der Anlass: `jfqueue` traegt die Zeichenkette "queue" in sich, und der
// aeltere Zweig darueber prueft mit `command.dir.includes('queue')`. Ein
// jfqueue-Befehl loest deshalb ZWEI Zweige aus. Das von Hand nachzurechnen
// kostete eine Sitzung; hier rechnet es die Maschine in einer Sekunde.
//
// AUFRUF
//   node tools/jellyfin-befehl-zerlegen.mjs                 # Beispielfaelle
//   node tools/jellyfin-befehl-zerlegen.mjs '/current/jellyfin/http%3A%2F%2F…/Titel:title:artist:Wer'
//
// WAS ES NICHT TUT
// - Es spricht mit keinem Geraet und startet kein mpv. Reine Textzerlegung.
// - Es liest spotify-control.ts NICHT ein; die Regeln sind hier NACHGEBAUT.
//   Aendert sich der Dienst, muss diese Datei nachgezogen werden (Zeilennummern
//   stehen an jeder Regel).
// - Es prueft nicht, ob die Stream-Adresse erreichbar ist (dafuer: curl/mupi-ton.py).

import path from 'node:path'

/** Nachbau von spotify-control.ts app.use (Stand 2026-08-01). */
export function zerlege(reqUrl) {
  const command = path.parse(reqUrl)
  const dir = command.dir
  const verb = dir.split('/').filter(Boolean)[1] || '' // Z. 1603
  const zweige = []

  if (command.name.includes('spotify:')) zweige.push({ zweig: 'spotify', zeile: 1608, wirkung: 'useSpotify()' })
  if (dir.includes('library'))
    zweige.push({ zweig: 'library', zeile: 1612, wirkung: `playList(${command.name}) -> mpv loadlist replace` })
  if (dir.includes('queue'))
    zweige.push({ zweig: 'queue', zeile: 1618, wirkung: `queueAlbum(${command.name}) -> mpv loadlist append` })
  if (dir.includes('radio'))
    zweige.push({ zweig: 'radio', zeile: 1624, wirkung: `playURL(${decodeURIComponent(dir.split('radio/').pop())})` })
  if (dir.includes('rss'))
    zweige.push({ zweig: 'rss', zeile: 1636, wirkung: `playURL(${decodeURIComponent(dir.split('rss/').pop())})` })
  if (verb === 'jellyfin') {
    const u = decodeURIComponent(dir.split('jellyfin/').pop())
    zweige.push({ zweig: 'jellyfin', zeile: 1648, wirkung: `playURL(${u}) -> mpv loadfile replace` })
  }
  if (verb === 'jfqueue') {
    const u = decodeURIComponent(dir.split('jfqueue/').pop())
    zweige.push({ zweig: 'jfqueue', zeile: 1663, wirkung: `player.queue(${u}) -> mpv loadfile append-play` })
  }
  if (dir.includes('say/')) zweige.push({ zweig: 'say', zeile: 1672, wirkung: 'playFile()/downloadTTS()' })

  // Der Titel-Teil: `<Titel>:title:artist:<Kuenstler>` — ACHTUNG, path.parse
  // schneidet alles ab dem letzten Punkt als Endung ab (command.ext).
  const teile = decodeURIComponent(command.name).split(':title:artist:')
  return {
    reqUrl,
    dir,
    name: command.name,
    ext: command.ext,
    verb,
    titel: teile[0],
    kuenstler: teile[1],
    zweige,
  }
}

const beispiele = [
  '/current/jellyfin/' +
    encodeURIComponent('http://192.168.1.9:8096/Audio/ab12/stream?static=true&api_key=deadbeef') +
    '/' +
    encodeURIComponent('Erster Titel') +
    ':title:artist:' +
    encodeURIComponent('Die Band'),
  '/current/jfqueue/' +
    encodeURIComponent('http://192.168.1.9:8096/Audio/cd34/stream?static=true&api_key=deadbeef') +
    '/' +
    encodeURIComponent('Zweiter Titel') +
    ':title:artist:' +
    encodeURIComponent('Die Band'),
  // Endungs-Falle: ein Punkt im Titel
  '/current/jellyfin/' +
    encodeURIComponent('http://host:8096/Audio/ef56/stream?static=true&api_key=k') +
    '/' +
    encodeURIComponent('Kap. 1') +
    ':title:artist:' +
    encodeURIComponent('Wer'),
  // Gegenprobe: Wirtsname mit "jellyfin" darin
  '/current/radio/' + encodeURIComponent('http://jellyfin.example.com/stream') + '/Sender:title:artist:X',
]

const eingaben = process.argv.slice(2).length ? process.argv.slice(2) : beispiele
for (const e of eingaben) {
  const r = zerlege(e)
  console.log('\n=== ' + r.reqUrl)
  console.log('  verb      :', JSON.stringify(r.verb))
  console.log('  name      :', JSON.stringify(r.name), ' ext:', JSON.stringify(r.ext))
  console.log('  Titel     :', r.titel, '| Kuenstler:', r.kuenstler)
  console.log('  Zweige    :', r.zweige.length)
  for (const z of r.zweige) console.log(`    - ${z.zweig} (Z. ${z.zeile}): ${z.wirkung}`)
}
