# Vinted HQ — Runtime Engine Reference

## Core Runtime

- Electron: 40.4.0
- Chromium: 144.0.7559.134
- Node.js: 25.2.1
- V8: 14.1.146.11-node.14

## Build Tooling

- Electron Forge: ^7.11.1
- Vite: ^5.4.21 (via @electron-forge/plugin-vite)
- TypeScript: ^5.9.3
- @vitejs/plugin-react: ^4.2.0

## Bundled Native Libraries

- OpenSSL: 3.6.0
- SQLite: 3.51.0
- libuv: 1.51.0
- llhttp: 9.3.0
- nghttp2: 1.68.0
- Undici: 7.16.0
- ICU: 78.1 (CLDR 48.0, Unicode 17.0)
- zlib: 1.2.12
- Brotli: 1.2.0
- zstd: 1.5.7
- simdutf: 7.3.3
- simdjson: 4.2.2
- c-ares: 1.34.5
- Ada: 3.3.0
- acorn: 8.15.0
- N-API: 10
- Node modules ABI: 141

## App Dependencies

- React: ^18.2.0
- React DOM: ^18.2.0
- react-window: ^2.2.7
- framer-motion: ^12.36.0
- better-sqlite3: ^12.6.2
- sql.js: ^1.10.0
- keytar: ^7.9.0
- electron-squirrel-startup: ^1.0.1

## CSS Feature Support (Chromium 144)

Supported: backdrop-filter, color-mix(), @starting-style, View Transitions API, CSS Nesting, :has(), container queries, subgrid, @layer, @scope, popover, anchor positioning.

## JS Feature Support (V8 14.1 / Node 25.2)

Supported: structuredClone, Array.groupBy, Promise.withResolvers, Set methods (union, intersection, difference), native fetch (via Undici), node:sqlite, Temporal (flagged), import.meta.resolve, RegExp v-flag.
