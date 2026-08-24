import { describe } from 'noba'
import 'bare-node-runtime/global'

const nodeHid = await import('~/node-hid/nodehid.js', {
  with: { imports: 'bare-node-runtime/imports' },
})
const hid = nodeHid.default ?? nodeHid

/**
 * Hardware probe. Needs a Ledger attached and unlocked; skips itself otherwise, so the suite
 * stays runnable without one.
 *
 * This is the step 4.1 question: does node-hid's addon actually move bytes under Bare, or
 * only enumerate? Everything is done by hand rather than through the transport, so a failure
 * points at the runtime rather than at the DMK stack above it.
 *
 * Ledger's HID framing, for the frames below: two bytes of channel, tag 0x05, two bytes of
 * sequence, then the payload, itself prefixed with its two byte length, zero padded to 64.
 * The write carries a leading 0x00 report id, as the vendored NodeHidApduSender does.
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

const device = (await hid.devicesAsync()).find(
  (d) => d.vendorId === LEDGER_VENDOR_ID && d.usagePage === LEDGER_USAGE_PAGE,
)

if (!device) {
  describe('hardware: no Ledger attached', ({ test }) => {
    test('skipped', ({ assert }) => assert.isTrue(true))
  })
} else {
  describe('hardware: enumeration', ({ test }) => {
    test('the device is visible with its vendor page', ({ assert }) => {
      assert.equal(device.vendorId, LEDGER_VENDOR_ID)
      assert.equal(device.usagePage, LEDGER_USAGE_PAGE)
      assert.isExist(device.path)
    })
  })

  describe('hardware: exchange', ({ test }) => {
    test('a device opens and accepts a write', async ({ assert }) => {
      const handle = await hid.HIDAsync.open(device.path)
      const report = [0x00, ...toFrame(GET_APP_AND_VERSION)]
      const written = await handle.write(report)
      assert.equal(written, report.length)
      await handle.close()
    })

    test('the device answers with a frame', async ({ assert }) => {
      const handle = await hid.HIDAsync.open(device.path)
      await handle.write([0x00, ...toFrame(GET_APP_AND_VERSION)])
      const response = await handle.read(2000)
      // A reply arrives, so the write reached the device and the read timed out on nothing.
      assert.equal(response.length, FRAME_SIZE)
      await handle.close()
    })

    /**
     * Pins a real Bare defect. node-hid hands read data back through
     * `Napi::Buffer<unsigned char>::Copy`, that is `napi_create_buffer_copy`, in src/read.cc.
     * Under Bare the returned buffer has the right length and no content: every byte is zero.
     * The identical call under Node returns the frame, `0101 05 0000 0015 0108 "Ethereum"...`.
     *
     * So this asserts what is, not what should be. When it starts failing, Bare has fixed the
     * copy, and section 4.1 of docs/STRATEGY.md flips: the transport would then work under
     * Bare with no addon work at all.
     */
    test('read content is empty under Bare, unlike Node', async ({ assert }) => {
      const handle = await hid.HIDAsync.open(device.path)
      await handle.write([0x00, ...toFrame(GET_APP_AND_VERSION)])
      const response = await handle.read(2000)
      const bytes = [...response]

      assert.equal(bytes.length, FRAME_SIZE)
      assert.isTrue(bytes.every((byte) => byte === 0))

      // What Node sees at the same offsets, for comparison when this is revisited.
      const channelMatches = bytes[0] === CHANNEL >> 8 && bytes[1] === (CHANNEL & 0xff)
      assert.isFalse(channelMatches)
      await handle.close()
    })
  })
}
