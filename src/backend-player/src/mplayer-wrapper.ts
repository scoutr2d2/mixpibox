// Thin wrapper around an `mplayer -slave` process — the GENERIC url/file player
// engine (library / radio / rss / recordings all flow through this). Converted
// to TypeScript as part of the B2 migration; the `MplayerPlayer` interface is
// also the seam the B1 `Player` abstraction will formalize (a Spotify-Connect
// player is the sibling). Behaviour is unchanged from the former .js.

import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

import byLine = require('byline')
import createDebug = require('debug')
import jsStringEscape = require('js-string-escape')
import parsers = require('./parsers')

const debug = createDebug('mplayer-wrapper')

// The control surface exposed on top of the EventEmitter. Every method writes a
// slave-mode command to mplayer's stdin (see exec); the emitter side surfaces
// `track-change` / `playlist-finish` / `prop`+`<prop>` events parsed from stdout.
// Kept module-local (the module uses `export =` for the factory); a .ts consumer
// derives it via `ReturnType<typeof import('./mplayer-wrapper')>`.
interface MplayerPlayer extends EventEmitter {
  exec(cmd: string, args?: Array<string | number>): void
  getProps(props: string[]): void
  seek(pos: number | string): void
  seekPercent(pos: number | string): void
  /**
   * `titel` WIRD ENTGEGENGENOMMEN UND VERWORFEN — und das steht hier, weil es
   * bisher nirgends stand (F1, 06.08.2026).
   *
   * Der Aufrufer (spotify-control.ts) holt sich BEIDE Aufsätze über dasselbe
   * untypisierte `require` und ruft `player.play(adresse, titel)`. Bei mpv
   * reist der Name als Datei-Option `force-media-title` im
   * Warteschlangeneintrag mit; mplayer im Slave-Modus kennt Datei-Optionen
   * gar nicht. Das zweite Argument kommt hier also TATSÄCHLICH an und muss
   * folgenlos bleiben: die Befehlszeile ist Zeichen für Zeichen dieselbe wie
   * vor F1.
   *
   * WARUM ES TROTZDEM IM VERTRAG STEHT: ohne diese Zeile verbietet der
   * Übersetzer den zweiten Parameter, sobald jemand die Weiche in
   * spotify-control typisiert (die B1-`Player`-Abstraktion, siehe Kopf). Der
   * nächstliegende Ausweg wäre dann, den Namen an `exec` durchzureichen — und
   * genau das darf nicht passieren: mplayer liest das zweite Wort eines
   * `loadfile` als seinen Anhänge-Schalter. Aus dem Abspielen würde ein
   * Einreihen, aus einem falschen Titelnamen eine stumme Box.
   * Festgehalten in mplayer-wrapper.spec.ts.
   */
  play(fileOrUrl: string, titel?: string): void
  playList(fileOrUrl: string): void
  /** Wie `play`: `titel` wird entgegengenommen und verworfen. */
  queue(fileOrUrl: string, titel?: string): void
  queueList(fileOrUrl: string): void
  next(): void
  previous(): void
  playPause(): void
  setVolume(amount: number | string): void
  stop(): void
  close(): void
}

const createPlayer = (): MplayerPlayer => {
  const out = new EventEmitter() as MplayerPlayer

  const proc = spawn(
    'mplayer',
    [
      '-slave', // 😔
      '-idle',
      '-novideo',
      '-quiet',
      '-msglevel',
      'all=1:global=4:cplayer=4',
    ],
    {
      env: process.env,
      stdio: ['pipe', 'pipe', 'ignore'],
    },
  )

  // wrapper -> mplayer
  const exec = (cmd: string, args: Array<string | number> = []): void => {
    let str = cmd
    for (const arg of args) {
      str += ' '
      if (typeof arg === 'string') {
        if (arg.includes(' ')) str += '"'
        str += jsStringEscape(arg)
        if (arg.includes(' ')) str += '"'
      } else str += arg
    }
    str = decodeURIComponent(str)
    debug(`exec: ${str}`)
    proc.stdin?.write(`${str}\n`)
  }
  const getProps = (props: string[]): void => {
    for (const prop of props) exec('pausing_keep_force get_property', [prop])
  }

  const play = (fileOrUrl: string): void => exec('loadfile', [fileOrUrl])
  const playList = (fileOrUrl: string): void => exec('loadlist', [fileOrUrl])
  const queue = (fileOrUrl: string): void => exec('loadfile', [fileOrUrl, '1'])
  // Append a whole playlist AFTER the current one ("play next" without
  // interrupting the running playback).
  const queueList = (fileOrUrl: string): void => exec('loadlist', [fileOrUrl, '1'])
  const next = (): void => exec('pt_step', ['1'])
  const previous = (): void => exec('pt_step', ['-1'])
  const playPause = (): void => exec('pause')
  const seek = (pos: number | string): void => exec('pausing_keep seek', [pos, '0'])
  const seekPercent = (pos: number | string): void => exec('pausing_keep seek', [pos, '1'])
  const setVolume = (amount: number | string): void => exec('pausing_keep volume', [amount, '1'])
  const stop = (): void => exec('stop')

  let closed = false
  proc.on('close', (code) => {
    closed = true
    out.emit('close', code)
    // todo: on a non-zero exit, surface an error from proc.stderr
  })
  const close = (): void => {
    if (!closed) exec('quit')
  }

  // mplayer -> wrapper
  const onLine = (line: string): void => {
    debug(`line: ${line}`)
    if (line === 'Starting playback...') {
      out.emit('track-change')
      return
    }

    // Callback when the playlist finishes
    if (line === 'ANS_ERROR=PROPERTY_UNAVAILABLE') {
      out.emit('playlist-finish')
      return
    }

    const parts = /^ANS_(\w+)=/g.exec(line)
    if (!parts?.[1]) return
    const prop = parts[1]

    const parser = parsers[prop]
    if (!parser) return
    const val = parser(line.slice(parts[0].length))
    out.emit('prop', prop, val)
    out.emit(prop, val)
  }

  if (proc.stdout) {
    proc.stdout.pipe(byLine.createStream()).on('data', (line: Buffer | string) => {
      onLine(Buffer.isBuffer(line) ? line.toString() : line)
    })
  }

  out.exec = exec
  out.getProps = getProps
  out.seek = seek
  out.play = play
  out.playList = playList
  out.queue = queue
  out.queueList = queueList
  out.next = next
  out.previous = previous
  out.seekPercent = seekPercent
  out.playPause = playPause
  out.setVolume = setVolume
  out.stop = stop
  out.close = close
  return out
}

export = createPlayer
