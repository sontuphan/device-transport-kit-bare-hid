/**
 * Bare entry point, selected by the `bare` condition in package.json.
 *
 * Two lines of setup buy back the whole upstream source: the global shim supplies `process`,
 * which nodehid.js reads as a global, and the import map is applied to the entire subgraph
 * below this file, so `events`, `util`, `path` and `os` resolve to their bare-* equivalents.
 * That map reaches into dependencies too, which is what makes `pkg-prebuilds` work here: it
 * requires `path` and `os` from its own package, out of reach of anything declared locally.
 *
 * The .mjs extension is deliberate: node-hid is a CommonJS package, so a .js file here would
 * be parsed as CommonJS and the import statements would fail.
 *
 * Node never loads this file; it gets ./nodehid.js directly.
 */
import 'bare-node-runtime/global'

export * from './nodehid.js' with { imports: 'bare-node-runtime/imports' }

export { default } from './nodehid.js' with { imports: 'bare-node-runtime/imports' }
