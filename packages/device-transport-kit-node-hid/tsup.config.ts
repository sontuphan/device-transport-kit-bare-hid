import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'index.ts' },
  outDir: 'dist',
  format: ['esm', 'cjs'],
  platform: 'node',
  target: 'node20',
  dts: true,
  sourcemap: true,
  clean: true,
  // Keep the wrappers external. Bundled, esbuild would inline their `default` branch and the
  // `bare` condition would never be evaluated at runtime.
  external: ['@tetherto/bare-hid', '@tetherto/bare-usb', '@tetherto/uuid'],
  // esbuild cannot carry `with { imports: ... }` into every target or into CJS, and bare.js
  // needs no compiling, so copy it through verbatim.
  onSuccess: 'cp bare.js dist/bare.js',
})
