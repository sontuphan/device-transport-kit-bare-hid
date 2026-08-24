import { describe } from 'noba'
import * as usbModule from '@tetherto/bare-usb'

/**
 * Bare compatibility probe for the `usb` package, which the transport uses purely as a
 * hotplug trigger: it listens for attach and detach, then re-enumerates with node-hid.
 *
 * Three things had to line up, and each has its own failure mode. The JS layer needs `util`
 * and `events` (import map), libusb's wrapper reads `process` (global shim), and the
 * Node-API binary has to sit where Bare looks for addons, which scripts/link-addon.js
 * arranges. Missing the last one throws ADDON_NOT_FOUND before any USB call happens.
 *
 * Runs on Bare only: `npm test` runs `noba-bare`.
 */
const { usb } = usbModule

describe('bare-usb: module loading', ({ test }) => {
  test('the package loads with its documented surface', ({ assert }) => {
    assert.isExist(usb)
    assert.equal(typeof usbModule.findByIds, 'function')
    assert.equal(typeof usbModule.Device, 'function')
    assert.equal(typeof usbModule.WebUSB, 'function')
  })

  test('the native addon is really loaded, not stubbed', ({ assert }) => {
    // These only exist once the N-API binding is in place.
    assert.equal(typeof usb.getDeviceList, 'function')
    assert.equal(typeof usb.setDebugLevel, 'function')
    assert.equal(typeof usb._supportedHotplugEvents, 'function')
  })
})

describe('bare-usb: enumeration', ({ test }) => {
  test('getDeviceList returns descriptors', ({ assert }) => {
    const devices = usb.getDeviceList()
    assert.isTrue(Array.isArray(devices))
    for (const device of devices) {
      assert.isExist(device.deviceDescriptor)
      assert.equal(typeof device.deviceDescriptor.idVendor, 'number')
      assert.equal(typeof device.busNumber, 'number')
    }
  })

  test('findByIds answers for an absent device', ({ assert }) => {
    // 0xffff/0xffff is not a real vendor, so this must be undefined rather than throw.
    assert.isUndefined(usbModule.findByIds(0xffff, 0xffff))
  })
})

describe('bare-usb: hotplug', ({ test }) => {
  /**
   * The transport's only use of this package. Attaching a listener is what starts libusb's
   * event thread, or the polling fallback where libusb has no hotplug support, so this
   * exercises the part most likely to differ under Bare's loop.
   */
  test('listeners attach and detach without throwing', ({ assert }) => {
    const seen = []
    const onAttach = (device) => seen.push(device)

    usb.on('attach', onAttach)
    assert.equal(usb.listenerCount('attach'), 1)

    usb.off('attach', onAttach)
    assert.equal(usb.listenerCount('attach'), 0)
    usb.unrefHotplugEvents()
  })

  test('hotplug support is reported either way', ({ assert }) => {
    const supported = usb._supportedHotplugEvents()
    assert.equal(typeof supported, 'boolean')
    // false is fine: the package falls back to polling getDeviceList and diffing.
    assert.equal(typeof usb.pollHotplugDelay, 'number')
  })
})
