#!/usr/bin/env node
// Mock local "library" media for the sim from a SpotifyRecorder output folder.
//
// Reads <SRC>/.spotcap_index.json (the recorder's manifest), groups tracks by
// artist+album, and writes a MuPiBox media layout
//   state/media/<category>/<artist>/<album>/playlist.m3u
// whose album dirs are filled with HARD LINKS to the real mp3s (same inode, no
// data copied — needs the source + harness/state on the same filesystem), so
// mplayer plays them and the box's track-count `find -type f` sees them. It also
// writes state/data.json with matching `library` items (+ a radio demo), which
// backend-api serves as the media library.
//
// The user's music folder is only READ — never modified (a hard link shares the
// inode but removing a link never touches the original).
//
// Env: MOCK_SRC (default /home/achim/Music/SpotifyRec), MOCK_MAX_PER_CAT (3)
import { existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = process.env.MOCK_SRC || '/home/achim/Music/SpotifyRec'
// Where the box (and the sim's backend-player) expects the media layout.
const MEDIA_MOUNT = process.env.MOCK_MEDIA_MOUNT || '/home/dietpi/MuPiBox/media'
const OUT = join(HERE, 'state')
const MEDIA = join(OUT, 'media')
const MAX_PER_CAT = Number(process.env.MOCK_MAX_PER_CAT || 3)

const manifestPath = join(SRC, '.spotcap_index.json')
if (!existsSync(manifestPath)) {
  console.error(`[mock] no manifest at ${manifestPath} — nothing to mock.`)
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const tracks = Object.values(manifest.tracks || {}).filter((t) => t && t.complete && t.path && existsSync(t.path))

// Group by ALBUM (preserving the manifest's recording order). The display
// artist is the shortest artist string on the album, so feature credits like
// "Thomas D, Reinhard Mey" collapse into the main artist "Thomas D" instead of
// splitting one album into several one-track ones.
const albums = new Map()
for (const t of tracks) {
  const key = t.album
  if (!albums.has(key)) albums.set(key, { album: t.album, artists: new Set(), tracks: [] })
  const a = albums.get(key)
  a.artists.add(t.artist)
  a.tracks.push(t)
}
for (const a of albums.values()) {
  a.artist = [...a.artists].sort((x, y) => x.length - y.length)[0]
}

// Extract the embedded ID3v2 APIC cover from an mp3 (the recorder tags every
// track incl. cover art). Pure-node minimal parser: ID3v2.3 (plain BE sizes)
// and v2.4 (syncsafe). Returns {mime, data} or null; failures just mean the
// nocover fallback is used.
const extractCover = (file) => {
  try {
    const buf = readFileSync(file)
    if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return null
    const ver = buf[3]
    const syncsafe = (o) => ((buf[o] & 0x7f) << 21) | ((buf[o + 1] & 0x7f) << 14) | ((buf[o + 2] & 0x7f) << 7) | (buf[o + 3] & 0x7f)
    const tagEnd = syncsafe(6) + 10
    let off = 10
    if (buf[5] & 0x40) off += (ver === 4 ? syncsafe(10) : buf.readUInt32BE(10)) + 4
    while (off + 10 <= tagEnd && off + 10 <= buf.length) {
      const id = buf.toString('latin1', off, off + 4)
      if (!/^[A-Z0-9]{4}$/.test(id)) break
      const size = ver === 4 ? syncsafe(off + 4) : buf.readUInt32BE(off + 4)
      if (size <= 0 || off + 10 + size > buf.length) break
      if (id === 'APIC') {
        let p = off + 10
        const enc = buf[p]
        p += 1
        const mimeEnd = buf.indexOf(0, p)
        const mime = buf.toString('latin1', p, mimeEnd) || 'image/jpeg'
        p = mimeEnd + 1
        p += 1 // picture type
        if (enc === 1 || enc === 2) {
          while (p + 1 < buf.length && !(buf[p] === 0 && buf[p + 1] === 0)) p += 2
          p += 2
        } else {
          while (p < buf.length && buf[p] !== 0) p += 1
          p += 1
        }
        return { mime, data: buf.subarray(p, off + 10 + size) }
      }
      off += 10 + size
    }
  } catch {
    /* fall through to null */
  }
  return null
}

const NOCOVER = 'assets/images/nocover_mupi.png'

const isAudiobook = (a) => /pummel|hörspiel|geschichte|abenteuer|kapitel|maus|benjamin|bibi/i.test(a)
const catOf = (artist, album) => (isAudiobook(`${artist} ${album}`) ? 'audiobook' : 'music')

// Pick a balanced mix so the home segments (audiobook / music) both fill.
const picked = { audiobook: [], music: [] }
for (const al of albums.values()) {
  const c = catOf(al.artist, al.album)
  if (picked[c].length < MAX_PER_CAT) picked[c].push({ ...al, category: c })
}

const data = [
  {
    type: 'radio',
    category: 'music',
    id: 'http://swr-swr3-live.cast.addradio.de/swr/swr3/live/mp3/128/stream.mp3',
    artist: 'SWR3',
    title: 'Live-Radio (Demo)',
    cover: NOCOVER,
    index: 0,
  },
]

let index = data.length
for (const al of [...picked.audiobook, ...picked.music]) {
  const dir = join(MEDIA, al.category, al.artist, al.album)
  mkdirSync(dir, { recursive: true })
  // Hard-link each track into the album dir so the media dir holds REAL files
  // (same inode as the source — no data copied): mplayer plays them and the
  // box's track-count `find -type f` sees them, exactly mirroring the real box.
  const lines = []
  for (const t of al.tracks) {
    const base = basename(t.path)
    const dest = join(dir, base)
    rmSync(dest, { force: true })
    linkSync(t.path, dest)
    lines.push(join(MEDIA_MOUNT, al.category, al.artist, al.album, base))
  }
  writeFileSync(join(dir, 'playlist.m3u'), `${lines.join('\n')}\n`)

  // Real cover art: pull the embedded APIC image from the first track that has
  // one — write it as cover.jpg (mirrors the real box layout, m3u_generator
  // would pick it up) AND inline it as a data URL for the sim's data.json.
  let cover = NOCOVER
  for (const t of al.tracks) {
    const pic = extractCover(t.path)
    if (pic) {
      writeFileSync(join(dir, 'cover.jpg'), pic.data)
      cover = `data:${pic.mime};base64,${pic.data.toString('base64')}`
      break
    }
  }

  data.push({
    type: 'library',
    category: al.category,
    artist: al.artist,
    title: al.album,
    cover,
    index: index++,
  })
  console.log(
    `[mock] ${al.category}/${al.artist}/${al.album}  (${al.tracks.length} tracks${cover === NOCOVER ? '' : ', cover'})`,
  )
}

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'data.json'), `${JSON.stringify(data, null, 2)}\n`)
console.log(`[mock] wrote ${data.length - 1} albums + ${data.length}-item data.json to ${OUT}/data.json`)
