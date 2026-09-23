/**
 * WAS VON DIESEM BLOCK NOCH GELESEN WIRD — Stand 19.09.2026.
 *
 * `node-sonos-http-api` ist ein Erbe: einmal hat ein solcher Dienst den Ton
 * gemacht. Mit `GET /api/sonos` (gefallen, AUDIT-2026-09-19 Rang 7) ist der
 * letzte Weg weg, der den Block AM STUECK herausreichte. Es bleibt genau ein
 * Leser im Baum: `config['node-sonos-http-api'].server` als `deviceName` in
 * `/api/spotify/config`.
 *
 * Deshalb sind hier `rooms` (Pflichtfeld ohne einen einzigen Leser) und
 * `playerMode` (Verbraucher fiel mit E118) gestrichen. `ip`, `port`, `tts`
 * und `hat_active` haben seit dem Fall von `/api/sonos` EBENFALLS keinen
 * Leser mehr; sie bleiben vorerst stehen, weil `hat_active` in hat.ts als
 * die eine Haelfte des Zwei-Dateien-Widerspruchs beschrieben ist und man
 * einen dokumentierten Widerspruch nicht halb aufloest. Das gehoert in den
 * Rang, der hat.ts mitnimmt.
 *
 * Die DATEI auf der Box behaelt alle Felder — eine Schnittstelle streicht
 * nichts aus config.json.
 */
export interface ServerConfig {
  'node-sonos-http-api': {
    server: string
    ip: string
    port: string
    tts?: {
      enabled?: boolean
      language?: string
      volume?: string
    }
    hat_active: boolean
  }
  spotify?: {
    clientId: string
    clientSecret: string
    // PKCE flow (no client secret): a stored user refresh token — the metadata
    // service mints short-lived access tokens from it on demand (see
    // SpotifyApiService.ensureApi). accessToken is the last minted one (optional).
    refreshToken?: string
    accessToken?: string
  }
}

export type ServerHttpApiConfig = ServerConfig['node-sonos-http-api']
