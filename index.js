import {
  ConsoleLogger,
  DeviceActionStatus,
  DeviceManagementKitBuilder,
} from '@ledgerhq/device-management-kit'
import { SignerEthBuilder } from '@ledgerhq/device-signer-kit-ethereum'
import { nodeHidTransportFactory } from '@tetherto/device-transport-kit-node-hid'
import { lastValueFrom, firstValueFrom } from 'rxjs'

const dmk = new DeviceManagementKitBuilder()
  .addLogger(new ConsoleLogger())
  .addTransport(nodeHidTransportFactory)
  .build()

let sessionId

try {
  // Connect the device
  const device = await firstValueFrom(dmk.startDiscovering())
  sessionId = await dmk.connect({
    device,
    sessionRefresherOptions: { isRefresherDisabled: true },
  })
  const signerEth = new SignerEthBuilder({ dmk, sessionId }).build()

  // Interact with the device
  const { observable } = signerEth.getAddress("44'/60'/0'/0/0")
  const { status, output, error } = await lastValueFrom(observable)
  if (status !== DeviceActionStatus.Completed)
    throw error || new Error('Unknown error.')
  console.log(output)
} catch (er) {
  console.error(er)
} finally {
  dmk.stopDiscovering()
  if (sessionId) await dmk.disconnect({ sessionId })
  dmk.close()
}
