/**
 * Makes the `usb` package's Node-API binary discoverable by Bare.
 *
 * Bare loads `.node` addons happily, but resolves them by its own convention:
 *
 *   <pkg>/prebuilds/<platform>-<arch>/<name>@<version>.node
 *
 * while prebuildify ships one fat binary per platform group:
 *
 *   <pkg>/prebuilds/darwin-x64+arm64/node.napi.node
 *
 * Without a match Bare throws ADDON_NOT_FOUND before any USB call is made. This copies the
 * binary across, which is cheap, idempotent, and leaves the original in place so Node keeps
 * loading it the usual way through node-gyp-build.
 */
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const usbDir = dirname(require.resolve('usb/package.json'))
const { version } = require('usb/package.json')

const target = `${process.platform}-${process.arch}`
const prebuilds = join(usbDir, 'prebuilds')
const destination = join(prebuilds, target, `usb@${version}.node`)

if (existsSync(destination)) process.exit(0)

// prebuildify names directories after platform groups, so darwin-arm64 lives in
// "darwin-x64+arm64". Match on the platform, then on the arch appearing in the group.
const source = readdirSync(prebuilds)
  .filter((dir) => dir.startsWith(`${process.platform}-`))
  .filter((dir) => dir.split('-')[1].split('+').includes(process.arch))
  .map((dir) => join(prebuilds, dir))
  .flatMap((dir) => readdirSync(dir).map((file) => join(dir, file)))
  .find((file) => file.endsWith('.node'))

if (!source) {
  console.error(`bare-usb: no usb prebuild found for ${target}, leaving it alone`)
  process.exit(0)
}

mkdirSync(dirname(destination), { recursive: true })
copyFileSync(source, destination)
