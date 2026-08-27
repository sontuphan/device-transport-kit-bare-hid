import { describe } from 'noba'
import * as hid from '@tetherto/bare-hid'

/**
 * Bare compatibility probe for the `node-hid` package, consumed unmodified from npm.
 *
 * Two things have to line up. The JS layer needs `events` and `util`, and `pkg-prebuilds`
 * needs `path` and `os` from inside its own package, all supplied by the import map in
 * bare.js; and nodehid.js reads a `process` global, supplied by the global shim. Unlike
 * `usb` there is no addon link step, because pkg-prebuilds hands Bare an absolute path to
 * the `.node` file.
 *
 * Runs on Bare only: `npm test` runs `noba-bare`.
 */
describe('bare-hid: module loading', ({ test }) => {
  test('the package loads with node-hid documented surface', ({ assert }) => {
    assert.equal(typeof hid.devices, 'function')
    assert.equal(typeof hid.devicesAsync, 'function')
    assert.equal(typeof hid.HIDAsync, 'function')
    assert.equal(typeof hid.setDriverType, 'function')
  })

  test('the native addon is really loaded, not stubbed', ({ assert, log }) => {
    // getHidapiVersion() reaches into the binding, so a stub cannot answer it.
    const version = hid.getHidapiVersion()
    log(`hidapi ${version}`)
    assert.equal(typeof version, 'string')
    assert.isTrue(version.split('.').length === 3)
  })
})

describe('bare-hid: enumeration', ({ test }) => {
  test('devices() returns descriptors', ({ assert, log }) => {
    const devices = hid.devices()
    log(`${devices.length} HID device(s) visible`)
    assert.isTrue(Array.isArray(devices))

    for (const device of devices) {
      assert.equal(typeof device.vendorId, 'number')
      assert.equal(typeof device.productId, 'number')
      assert.equal(typeof device.path, 'string')
    }
  })

  test('devicesAsync() agrees with devices()', async ({ assert }) => {
    const [sync, async] = [hid.devices(), await hid.devicesAsync()]
    assert.equal(async.length, sync.length)
  })
})

describe('bare-hid: known limits', ({ test }) => {
  /**
   * The synchronous HID class uses the ES5 borrowed constructor, `EventEmitter.call(this)`,
   * and bare-events is a class, whose [[Call]] always throws. Nothing outside node-hid can
   * fix that, and the transport uses HIDAsync only, so it is recorded rather than worked
   * around. If node-hid ever converts the class, this test flips.
   */
  test('the synchronous HID class cannot be constructed under Bare', ({ assert, log }) => {
    let message = null
    try {
      new hid.HID('nonexistent-path')
    } catch (err) {
      message = err.message
    }
    log(message)
    assert.isExist(message)
    assert.isTrue(message.includes("cannot be invoked without 'new'"))
  })
})
