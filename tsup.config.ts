import { createRequire } from 'node:module'

import { defineConfig } from 'tsup'

/**
 * Bundles the app, which `bare.js` then loads: `bare dist/bare.js`.
 *
 * The reason to bundle is not speed. Bare resolves modules perfectly well, but several
 * dependencies below the DMK cannot be resolved by any plain runtime: its ESM build is
 * `export*from"./src";` in a directory whose package.json declares no `"type"`, which Bare
 * parses as CommonJS and Node rejects as a directory import. The signer kit and the two Ledger
 * packages under it are built the same way. esbuild does directory resolution and never
 * consults `type`, so bundling sidesteps the whole class of problem, and the DMK lands in the
 * graph exactly once, which its DI container and `instanceof` checks require.
 */

const require = createRequire(import.meta.url)

const watching = process.argv.includes('--watch')

/**
 * Node builtin to bare-* package, for the banner's `require` below. Static `import` statements
 * are handled at load time by the import map in bare.js instead, which is the only thing that
 * catches `node:` prefixed specifiers: esbuild marks those external before an alias or a plugin
 * can see them, which is why `@noble/hashes` kept a raw `crypto` import through both.
 */
const builtins: Record<string, string> = Object.fromEntries(
  Object.entries(
    require('bare-node-runtime/imports') as Record<string, { bare?: string }>,
  )
    .filter(([, target]) => target.bare && !target.bare.includes('unsupported'))
    .map(([name, target]) => [name, target.bare as string]),
)

export default defineConfig({
  entry: { index: 'index.js' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  sourcemap: true,
  clean: true,

  // tsup leaves everything in `dependencies` external. Here the point is the opposite, so name
  // what has to come inside. Their own transitive dependencies are bundled by default.
  noExternal: [
    '@ledgerhq/device-management-kit',
    '@ledgerhq/device-signer-kit-ethereum',
    '@tetherto/device-transport-kit-node-hid',
    'rxjs',
  ],

  // The two that cannot be bundled: they resolve `.node` binaries at runtime, and their `bare`
  // export condition applies bare-node-runtime's import map to node-hid and usb for us.
  external: ['@tetherto/bare-hid', '@tetherto/bare-usb'],

  // bare.js needs no compiling and esbuild cannot carry `with { imports: ... }` into every
  // target, so copy it through verbatim, the same way the workspace packages do. In watch mode
  // it also runs the app, which tsup restarts on every rebuild. Both live here rather than in
  // `--onSuccess` on the command line, because that flag replaces this field rather than adding
  // to it, and the copy would be lost.
  onSuccess: watching
    ? 'cp bare.js dist/bare.js && bare dist/bare.js'
    : 'cp bare.js dist/bare.js',

  banner: {
    js: [
      // `process` is read as a global throughout the DMK's dependencies.
      "import 'bare-node-runtime/global'",
      // CommonJS `require()` never reaches the alias above: in ESM output esbuild rewrites it
      // into a helper that throws by design, so this gives it a real one to fall back to and
      // maps the builtins on the way through. 'module' would resolve only under an import map,
      // and this output runs standalone, so name Bare's package directly.
      "import { createRequire } from 'bare-module'",
      'const __nodeRequire = createRequire(import.meta.url)',
      `const __builtins = ${JSON.stringify(builtins)}`,
      'const require = (name) => __nodeRequire(__builtins[name] ?? name)',
    ].join('\n'),
  },
})
