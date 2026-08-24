/**
 * Bare only. Three things stand between Bare and the `usb` package.
 *
 * Modules: its JS layer imports `util` and `events`, supplied by the import map below.
 * Globals: libusb's JS wrapper reads `process`, supplied by `bare-node-runtime/global`.
 * Addon: Bare loads Node-API `.node` binaries, but looks for them under its own naming
 * convention, which `usb` does not ship. `scripts/link-addon.js` puts the prebuilt binary
 * where Bare expects it; see that file for the paths involved.
 */
import 'bare-node-runtime/global'

export * from 'usb' with { imports: 'bare-node-runtime/imports' }
