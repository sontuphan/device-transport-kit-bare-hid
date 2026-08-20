import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'device-transport-kit-node-hid/index':
      'src/device-transport-kit-node-hid/index.ts',
  },
  outDir: 'dist',
  format: ['esm', 'cjs'],
  platform: 'node',
  target: 'node20',
  dts: true,
  sourcemap: true,
  clean: true,
})
