# Strategy: `device-transport-kit-bare-hid`

Plan for a Ledger Device Management Kit (DMK) transport that speaks USB HID from the
[Bare](https://github.com/holepunchto/bare) runtime, ported from
`@ledgerhq/device-transport-kit-node-hid`.

Incremental by design: vendor the working Node implementation, prove it still runs, then
swap its Node specific parts for Bare ones. Every step ends runnable, so breakage is
attributable to the change that preceded it.

**Acceptance test, all steps:** [index.js](../index.js) discovers a Nano X, connects, and
reads the address at `44'/60'/0'/0/0`. The port is done when it prints the same address
under `bare` instead of `node`.

## Upstream

| | |
| --- | --- |
| Package | `@ledgerhq/device-transport-kit-node-hid` 1.0.1 |
| Repo | `LedgerHQ/device-sdk-ts`, `packages/transport/node-hid` |
| Commit | `e6f7e04910329c7d15d856a6a46546762e22a10a` |
| Runtime deps | `node-hid`, `usb`, `purify-ts`, `uuid` |
| Peer deps | `@ledgerhq/device-management-kit@^1.2.0`, `rxjs@7.8.2` |

`NodeHidTransport` implements the DMK `Transport` interface (`isSupported`,
`getIdentifier`, `listenToAvailableDevices`, `startDiscovering`, `stopDiscovering`,
`connect`, `disconnect`, `destroy`) plus reconnection via `DeviceConnectionStateMachine`.
`NodeHidApduSender` owns the read/write pair against one HID handle. Those two files hold
essentially all runtime coupling.

## Step 1: vendor the source (done)

In [src/device-transport-kit-node-hid/](../src/device-transport-kit-node-hid/); provenance
and deviations in [VENDOR.md](../src/device-transport-kit-node-hid/VENDOR.md).

- TypeScript kept, for diffability against upstream. `src/` is TypeScript, `index.js` stays
  JavaScript.
- One package, no workspace. Every dependency lives in the root
  [package.json](../package.json), which also guarantees a single DMK copy, as the DI
  container and `instanceof` checks require.
- Monorepo tooling dropped: eslint, prettier, `ldmk-tool`, and the vitest config extending
  the private `@ledgerhq/vitest-config-dmk`.
- Upstream's `@api/*` alias rewritten to relative imports, so no `paths` entry is needed.

## Step 2: build it and consume it (done)

`tsup` ([tsup.config.ts](../tsup.config.ts)) builds the vendored source to
`dist/device-transport-kit-node-hid/` as ESM, CJS, and declarations, with every external
left external. [index.js](../index.js) imports `nodeHidTransportFactory` from
`@tetherto/device-transport-kit-node-hid`, aliased in [tsconfig.json](../tsconfig.json) to
`dist/*/index.js`, and the published package is gone from dependencies.

Verified end to end against hardware: the entry script returns the expected address.

Note the alias is a tsx/tsc feature, not Node resolution. Plain `node` would need a real
`node_modules` entry (a `link:` dependency plus a generated `package.json` per dist folder).

## Step 3: test

Establish the baseline while this is still Node code, so later failures are unambiguous.

- Port the upstream unit tests, already vendored. They use vitest globals (`vi.mock` on
  `node-hid` and `usb`), so they need a standalone vitest config; the current `test` script
  runs Node's runner instead and does not pick them up. They must pass with no device
  attached.
- Keep the hardware smoke test: discover, connect, read the address, disconnect.
- Two known rough edges, so they are not mistaken for port regressions: the process does
  not exit after teardown because the HID handle keeps the loop alive, and
  `sessionRefresherOptions: { isRefresherDisabled: true }` is required, or the refresher's
  polling read races teardown and node-hid throws `device has been closed`.

## Step 4: convert to Bare

Six externals, sorted by how much work Bare makes them:

| Dependency | Used for | Bare status |
| --- | --- | --- |
| `node-hid` | every HID read and write | no equivalent, must be written |
| `usb` | attach and detach events | no equivalent, needs a substitute |
| `purify-ts` | `Either` / `EitherAsync` results | pure JS, expected to work, unproven |
| `rxjs` | observables across the DMK | pure JS, expected to work, unproven |
| `uuid` | device and session ids | needs a crypto source |
| DMK | the transport interface | bundler only ESM build, must be checked |

Two prerequisites gate everything, and neither requires touching the transport.

### 4.1 Implement `bare-hid`

The reason for this repo's name: no such module exists on npm. Bare builds native addons
with `bare-make` plus `cmake-bare`, so the options are an addon wrapping `hidapi` (the same
C library `node-hid` binds) or raw USB interrupt transfers over a Bare USB addon.

Define the seam before writing any C. The surface `NodeHidApduSender` and `NodeHidTransport`
actually consume is short: enumerate, open by path, async read, write, close. Ledger devices
expose one HID interface with 64 byte reports. Match the `node-hid` shape deliberately and
the port degrades from a rewrite into an import swap.

Hotplug has no obvious home. Upstream gets attach and detach from `usb`, driving
`startListeningToConnectionEvents` and the reconnection state machine. If the first version
cannot deliver events, poll enumeration behind the same observable so the transport cannot
tell the difference.

### 4.2 Prove `purify-ts` runs under Bare

Every result the transport returns is an `Either` or `EitherAsync`, so if it does not run,
nothing downstream does. It looks safe: 2.1.0 is pure JavaScript, its ESM build references
no `node:` builtin, no `Buffer`, no `process`, and its only dependency is types only. That
is not a test.

Import it under `bare`, build an `Either` and an `EitherAsync`, chain and await. Run the
same probe for `rxjs`, same profile and same blast radius, and settle `uuid`, which needs
randomness. Minutes of work against weeks of addon work, so do it first. It doubles as a
test of how Bare handles these packages' export maps.

### 4.3 Confirm the DMK loads

Bare resolves ESM strictly like Node, so the DMK's bundler only ESM build
(`export * from "./src"`) should fail there exactly as it fails under `node` today.
Establish whether Bare picks the `require` condition and lands on the working CJS build, or
whether the DMK must be prebundled. Go or no go for the whole port; do it alongside 4.2.

### 4.4 Port the transport

Mechanical once the substrate is proven:

- Swap `node-hid` for `bare-hid`, rewire hotplug onto whatever 4.1 produced.
- Audit `node:` imports, `Buffer`, `process`, timers, and `AbortController`
  (`_connectionListenersAbortController`). Map each onto its Bare counterpart.
- Rename `NodeHidTransport`, `NodeHidApduSender`, `nodeHidIdentifier`,
  `nodeHidTransportFactory`, and the package itself. The `TransportIdentifier` is currently
  `NODE-HID` and appears in DMK logs and on `ConnectedDevice.transport`; change it to
  `BARE-HID` and check nothing matches the old literal.

## Open questions

- Desktop only, or mobile too? That decides whether the addon needs iOS and Android builds.
- A published `bare-hid` plus a thin transport kit, or one package with the binding folded
  in? Two packages matches how `node-hid` and the Ledger transport layer today.
- Track upstream, or one time fork? That decides how much the vendoring records matter.
