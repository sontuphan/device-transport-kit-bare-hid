import {
  ConsoleLogger,
  DeviceManagementKitBuilder,
} from '@ledgerhq/device-management-kit'
import { nodeHidTransportFactory } from '@ledgerhq/device-transport-kit-node-hid'

export const sdk = new DeviceManagementKitBuilder()
  .addLogger(new ConsoleLogger())
  .addTransport(nodeHidTransportFactory)
  .build()
