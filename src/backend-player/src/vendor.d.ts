// Minimal ambient type declarations for the small, untyped vendor libraries
// used by the backend-player, so the strict TypeScript migration (B2) can turn
// their consumers into .ts without pulling @types packages / a network install.
// Replace with the real @types/* if/when a dependency pass runs.

declare module 'js-string-escape' {
  function jsStringEscape(input: unknown): string
  export = jsStringEscape
}

declare module 'byline' {
  import type { Transform } from 'node:stream'
  export function createStream(input?: unknown, options?: unknown): Transform
}

declare module 'debug' {
  type Debugger = (...args: unknown[]) => void
  function createDebug(namespace: string): Debugger
  export = createDebug
}
