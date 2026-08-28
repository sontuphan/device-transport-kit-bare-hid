/**
 * Bare entry point, selected by the `bare` condition in package.json.
 *
 * Globals first, then the graph. `bare-node-runtime/global` installs `process`, `Buffer` and
 * `AbortController`, all of which this transport reads as globals, and the DMK's own
 * dependencies (`inversify`, `xstate`, `ws`, `reflect-metadata`) need too. ES module imports
 * evaluate in order, so the shim is in place before anything under ./index.js runs.
 *
 * The import map is then applied to that whole subgraph, dependencies included, so `events`,
 * `util` and the rest resolve to their bare-* equivalents without a call site changing.
 *
 * Node never loads this file; it gets ./index.js directly.
 */
import 'bare-node-runtime/global'

export * from './index.js' with { imports: 'bare-node-runtime/imports' }
