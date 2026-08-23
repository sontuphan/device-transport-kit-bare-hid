import { describe } from 'noba'
import { Left, Right } from 'purify-ts'
import { NEVER } from 'rxjs'

// The DMK's dependency tree (inversify, xstate, ws, reflect-metadata) wants Node globals.
import 'bare-node-runtime/global'
// ...and Node builtins, which the import map supplies. The path is deliberate: the DMK's ESM
// build is bundler only (`export * from "./src"`) and its package declares no
// `"type": "module"`, so Bare parses those files as CommonJS and throws
// `Unexpected token 'export'`. The CJS build works, but is not an exported subpath.
import * as dmk from '~/@ledgerhq/device-management-kit/lib/cjs/index.js' with { imports: 'bare-node-runtime/imports' }

/**
 * Bare compatibility probe for the Device Management Kit.
 *
 * This is the go or no go check for the port: if the DMK cannot run under Bare, writing
 * bare-hid buys nothing. It also stands in for the DMK's own dependencies, which are not
 * probed separately, because constructing a kit exercises all of them.
 *
 * Runs on Bare only: `pnpm test` is `noba-bare`. Node rejects the import attribute above
 * with ERR_IMPORT_ATTRIBUTE_UNSUPPORTED.
 */
describe('DMK: module loading', ({ test }) => {
  test('the package loads with its full export surface', ({ assert }) => {
    assert.isTrue(Object.keys(dmk).length > 100)
    assert.equal(typeof dmk.DeviceManagementKitBuilder, 'function')
    assert.equal(typeof dmk.ConsoleLogger, 'function')
  })

  test('the symbols the transport imports are all present', ({ assert }) => {
    assert.equal(typeof dmk.DeviceConnectionStateMachine, 'function')
    assert.equal(typeof dmk.TransportConnectedDevice, 'function')
    assert.equal(typeof dmk.GeneralDmkError, 'function')
    assert.isExist(dmk.DeviceActionStatus)
    assert.isExist(dmk.LEDGER_VENDOR_ID)
  })
})

/**
 * A kit built with no transport fails later, on use, with `NoTransportProvidedError`, so
 * construction needs one. This is the smallest thing satisfying the interface, and it doubles as a check
 * that the DMK accepts a transport written in plain JavaScript, which is the shape bare-hid
 * will take.
 */
const stubTransportFactory = () => ({
  getIdentifier: () => 'STUB',
  isSupported: () => true,
  listenToAvailableDevices: () => NEVER,
  startDiscovering: () => NEVER,
  stopDiscovering: () => {},
  connect: async () => Left(new Error('stub')),
  disconnect: async () => Right(undefined),
  destroy: () => {},
})

describe('DMK: construction', ({ test }) => {
  /**
   * The meaningful half. Building a kit runs inversify's DI container, which leans on
   * decorators and Reflect metadata, and wires the xstate machines. Those depend on engine
   * behaviour rather than plain JavaScript, so this one test covers inversify, xstate, and
   * reflect-metadata at once.
   */
  test('the builder produces a working kit', ({ assert }) => {
    const kit = new dmk.DeviceManagementKitBuilder()
      .addLogger(new dmk.ConsoleLogger())
      .addTransport(stubTransportFactory)
      .build()
    assert.equal(typeof kit.startDiscovering, 'function')
    assert.equal(typeof kit.connect, 'function')
    assert.equal(typeof kit.close, 'function')
    kit.close()
  })

  test('two kits are independent instances', ({ assert }) => {
    const first = new dmk.DeviceManagementKitBuilder()
      .addTransport(stubTransportFactory)
      .build()
    const second = new dmk.DeviceManagementKitBuilder()
      .addTransport(stubTransportFactory)
      .build()
    assert.notEqual(first, second)
    first.close()
    second.close()
  })

  test('the stub transport is reachable through the kit', ({ assert }) => {
    const kit = new dmk.DeviceManagementKitBuilder()
      .addTransport(stubTransportFactory)
      .build()
    assert.isExist(kit.listConnectedDevices())
    assert.isExist(kit.startDiscovering({}))
    kit.stopDiscovering()
    kit.close()
  })
})

describe('DMK: apdu primitives', ({ test }) => {
  /**
   * Byte level plumbing, the layer the transport hands frames to. Pure computation, but it
   * runs on Uint8Array and DataView, so it is worth confirming under Bare.
   */
  test('ApduBuilder and ApduParser round trip', ({ assert }) => {
    const apdu = new dmk.ApduBuilder({ cla: 0xe0, ins: 0x02, p1: 0x00, p2: 0x00 })
      .add8BitUIntToData(0x05)
      .build()
    const raw = apdu.getRawApdu()
    assert.equal(raw[0], 0xe0)
    assert.equal(raw[1], 0x02)

    const response = new dmk.ApduResponse({
      statusCode: new Uint8Array([0x90, 0x00]),
      data: new Uint8Array([0x01, 0x02]),
    })
    const parser = new dmk.ApduParser(response)
    assert.equal(parser.extract8BitUInt(), 0x01)
    assert.isTrue(dmk.CommandUtils.isSuccessResponse(response))
  })
})
