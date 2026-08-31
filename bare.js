/**
 * Bare entry point for the bundled app. Run: `bare dist/bare.js`.
 *
 * Two lines that the bundle cannot do for itself. The import map is a resolution-time
 * attribute, so it has to be applied by whoever imports the bundle: it rewrites every
 * `import ... from 'crypto'` inside it to `bare-crypto`, and covers the `node:` prefixed
 * spelling too, which esbuild marks external before any alias or plugin can see it.
 *
 * It also reaches `@tetherto/bare-hid` and `@tetherto/bare-usb`, which stay external because
 * they resolve `.node` binaries at runtime.
 *
 * Globals and the CommonJS `require` fallback come from the bundle's own banner, since those
 * are needed inside it rather than around it; see tsup.config.ts.
 */
import 'bare-node-runtime/global'

await import('./index.js', { with: { imports: 'bare-node-runtime/imports' } })
