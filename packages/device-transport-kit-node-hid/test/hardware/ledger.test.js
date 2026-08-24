import { describe } from 'noba'
import 'bare-node-runtime/global'

const nodeHid = await import('~/node-hid/nodehid.js', {
  with: { imports: 'bare-node-runtime/imports' },
})
const hid = nodeHid.default ?? nodeHid

/**
 * Hardware suite: `npm run test:hardware`. REQUIRES an attached, unlocked Ledger and fails
 * without one, unlike the runtime probes in test/.
 *
 * This answers the step 4.1 question: does node-hid's addon move bytes under Bare, or only
 * enumerate? Everything is done by hand rather than through the transport, so a failure points
 * at the runtime rather than the DMK stack above it.
 *
 * Ledger's HID framing: two bytes of channel, tag 0x05, two bytes of sequence, then the
 * payload prefixed with its own two byte length, zero padded to 64. The write carries a
 * leading 0x00 report id, as the vendored NodeHidApduSender does.
 */
const LEDGER_VENDOR_ID = 0x2c97
const LEDGER_USAGE_PAGE = 0xffa0
const FRAME_SIZE = 64
const CHANNEL = 0x0101
const TAG = 0x05

/** Get app name and version. Answered in the dashboard and inside any app. */
const GET_APP_AND_VERSION = [0xb0, 0x01, 0x00, 0x00]

const toFrame = (apdu) => {
  const head = [CHANNEL >> 8, CHANNEL & 0xff, TAG, 0, 0]
  const body = [apdu.length >> 8, apdu.length & 0xff, ...apdu]
  const padding = new Array(FRAME_SIZE - head.length - body.length).fill(0)
  return [...head, ...body, ...padding]
}

const hex = (bytes) => Buffer.from([...bytes]).toString('hex')

const devices = await hid.devicesAsync()
const device = devices.find(
  (d) => d.vendorId === LEDGER_VENDOR_ID && d.usagePage === LEDGER_USAGE_PAGE,
)

describe('hardware: a Ledger must be attached', ({ test }) => {
  test('hidapi finds the Ledger vendor page', ({ assert, log }) => {
    log(`${devices.length} HID device(s) visible`)
    assert.isExist(device, 'no Ledger on usage page 0xffa0: plug one in and unlock it')
    log(`${device.manufacturer} ${device.product} at ${device.path}, interface ${device.interface}`)
  })
})

describe('hardware: exchange', ({ test }) => {
  test('the device opens and reports its own identity', async ({ assert, log }) => {
    const handle = await hid.HIDAsync.open(device.path)
    const info = await handle.getDeviceInfo()
    log(`getDeviceInfo(): ${info.manufacturer} ${info.product}, vendorId ${info.vendorId}`)
    // Strings cross the addon boundary intact, which is why the zeroed reads below are a
    // buffer problem rather than a dead device.
    assert.equal(info.vendorId, LEDGER_VENDOR_ID)
    assert.isExist(info.product)
    await handle.close()
  })

  test('a write is accepted', async ({ assert, log }) => {
    const handle = await hid.HIDAsync.open(device.path)
    const report = [0x00, ...toFrame(GET_APP_AND_VERSION)]
    const written = await handle.write(report)
    log(`wrote ${written} bytes: ${hex(report).slice(0, 32)}...`)
    assert.equal(written, report.length)
    await handle.close()
  })

  test('the device answers with a frame', async ({ assert, log }) => {
    const handle = await hid.HIDAsync.open(device.path)
    await handle.write([0x00, ...toFrame(GET_APP_AND_VERSION)])
    const response = await handle.read(2000)
    // A reply arrives, so the write reached the device: a timeout would give 0 bytes.
    log(`read ${response.length} bytes back (0 would mean the device never answered)`)
    assert.equal(response.length, FRAME_SIZE)
    await handle.close()
  })

  /**
   * Pins a real Bare defect. node-hid hands read data back through
   * `Napi::Buffer<unsigned char>::Copy`, that is `napi_create_buffer_copy`, in src/read.cc.
   * Under Bare the returned buffer has the right length and no content: every byte is zero.
   * The identical call under Node returns the frame; see `npm run hardware:node`.
   *
   * So this asserts what is, not what should be. When it starts failing, Bare has fixed the
   * copy, and section 4.1 of docs/STRATEGY.md flips: the transport would then work under Bare
   * with no addon work at all.
   */
  test('read content is empty under Bare, unlike Node', async ({ assert, log }) => {
    const handle = await hid.HIDAsync.open(device.path)
    await handle.write([0x00, ...toFrame(GET_APP_AND_VERSION)])
    const response = await handle.read(2000)
    const bytes = [...response]

    log(`bare  : ${hex(bytes).slice(0, 44)}`)
    log(`node  : 010105000000150108457468657265756d06312e`)
    assert.equal(bytes.length, FRAME_SIZE)
    assert.isTrue(bytes.every((byte) => byte === 0))
    await handle.close()
  })
})
