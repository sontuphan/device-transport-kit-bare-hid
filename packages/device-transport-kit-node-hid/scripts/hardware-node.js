/**
 * The same exchange as test/hardware.test.js, run under Node instead of Bare.
 *
 * Point of comparison: identical framing, identical node-hid calls, a real reply. Whatever
 * this prints is what Bare should print and does not, because `napi_create_buffer_copy`
 * hands back a zeroed buffer there. See docs/STRATEGY.md section 4.1.
 *
 *   npm run hardware:node -w @tetherto/device-transport-kit-node-hid
 */
import hid from 'node-hid'

const LEDGER_VENDOR_ID = 0x2c97
const LEDGER_USAGE_PAGE = 0xffa0
const FRAME_SIZE = 64
const CHANNEL = 0x0101
const TAG = 0x05

const toFrame = (apdu) => {
  const head = [CHANNEL >> 8, CHANNEL & 0xff, TAG, 0, 0]
  const body = [apdu.length >> 8, apdu.length & 0xff, ...apdu]
  const padding = new Array(FRAME_SIZE - head.length - body.length).fill(0)
  return [...head, ...body, ...padding]
}

const device = (await hid.devicesAsync()).find(
  (d) => d.vendorId === LEDGER_VENDOR_ID && d.usagePage === LEDGER_USAGE_PAGE,
)

if (!device) {
  console.error('No Ledger attached. Plug one in and unlock it.')
  process.exit(1)
}

console.log(`device   : ${device.manufacturer} ${device.product} at ${device.path}`)

const handle = await hid.HIDAsync.open(device.path)
const report = [0x00, ...toFrame([0xb0, 0x01, 0x00, 0x00])]
const written = await handle.write(report)
const response = await handle.read(2000)
await handle.close()

const bytes = [...response]
console.log(`wrote    : ${written} bytes`)
console.log(`read     : ${bytes.length} bytes`)
console.log(`frame    : ${Buffer.from(bytes).toString('hex')}`)

const length = (bytes[5] << 8) | bytes[6]
const payload = bytes.slice(7, 7 + length)
const status = (payload.at(-2) << 8) | payload.at(-1)

// b0 01 00 00 answers with: format, app name (length prefixed), version (length prefixed).
let cursor = 1
const readLengthPrefixed = () => {
  const size = payload[cursor]
  const value = Buffer.from(payload.slice(cursor + 1, cursor + 1 + size)).toString()
  cursor += 1 + size
  return value
}

console.log(`status   : 0x${status.toString(16)}`)
console.log(`app      : ${readLengthPrefixed()}`)
console.log(`version  : ${readLengthPrefixed()}`)
