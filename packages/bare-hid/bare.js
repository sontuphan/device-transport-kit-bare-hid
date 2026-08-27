/**
 * Bare only. Two things stand between Bare and the `node-hid` package.
 *
 * Modules: its JS layer requires `events` and `util`, and `pkg-prebuilds` requires `path` and
 * `os` from inside its own package, out of reach of any locally declared map. The import map
 * below is applied to the whole subgraph under this file, dependencies included, so all four
 * resolve to their bare-* equivalents without a call site changing.
 *
 * Globals: nodehid.js reads `process` as a global, supplied by `bare-node-runtime/global`.
 *
 * No addon step, unlike bare-usb. node-hid resolves its binary through `pkg-prebuilds`, which
 * hands Bare an absolute path to the `.node` file, and Bare loads that directly.
 */
import 'bare-node-runtime/global'

export * from 'node-hid' with { imports: 'bare-node-runtime/imports' }

export { default } from 'node-hid' with { imports: 'bare-node-runtime/imports' }
