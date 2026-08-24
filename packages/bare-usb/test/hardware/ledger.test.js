import { describe } from 'noba'
import * as usbModule from '@tetherto/bare-usb'

/**
 * Hardware suite: `npm run test:hardware`. Unlike the runtime probes in test/, this one
 * REQUIRES an attached Ledger and fails loudly without one. A skipped check that reports
 * success proves nothing, which is the whole point of keeping these separate.
 *
 * Note libusb and hidapi disagree about what a Ledger is: hidapi lists two HID interfaces
 * (the vendor page and the FIDO one), libusb lists one USB device with three interfaces.
 */
const LEDGER_VENDOR_ID = 0x2c97
const { usb } = usbModule

const devices = usb.getDeviceList()
const ledger = devices.find(
  (device) => device.deviceDescriptor.idVendor === LEDGER_VENDOR_ID,
)

describe('hardware: a Ledger must be attached', ({ test }) => {
  test('libusb finds vendor id 0x2c97 on the bus', ({ assert, log }) => {
    log(`${devices.length} device(s) on the bus`)
    for (const device of devices) {
      const { idVendor, idProduct } = device.deviceDescriptor
      log(`  bus ${device.busNumber} addr ${device.deviceAddress}: vid 0x${idVendor.toString(16)} pid 0x${idProduct.toString(16)}`)
    }
    assert.isExist(ledger, 'no Ledger attached: plug one in and unlock it')
  })
})

describe('hardware: the attached Ledger', ({ test }) => {
  test('libusb reports its descriptor', ({ assert, log }) => {
    const { idVendor, idProduct, bcdUSB } = ledger.deviceDescriptor
    log(`vid 0x${idVendor.toString(16)} pid 0x${idProduct.toString(16)}, USB ${(bcdUSB >> 8).toString(16)}.${(bcdUSB & 0xff).toString(16)}, bus ${ledger.busNumber} addr ${ledger.deviceAddress}`)
    assert.equal(idVendor, LEDGER_VENDOR_ID)
    assert.equal(typeof idProduct, 'number')
  })

  test('the device opens and exposes its interfaces', ({ assert, log }) => {
    ledger.open()
    try {
      log(`open() ok, ${ledger.interfaces.length} interface(s): ${ledger.interfaces.map((i) => `#${i.interfaceNumber} class ${i.descriptor.bInterfaceClass}`).join(', ')}`)
      assert.isTrue(ledger.interfaces.length > 0)
      assert.equal(typeof ledger.configDescriptor.bNumInterfaces, 'number')
    } finally {
      ledger.close()
    }
  })
})
