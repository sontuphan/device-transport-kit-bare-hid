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

|              |                                                         |
| ------------ | ------------------------------------------------------- |
| Package      | `@ledgerhq/device-transport-kit-node-hid` 1.0.1         |
| Repo         | `LedgerHQ/device-sdk-ts`, `packages/transport/node-hid` |
| Commit       | `e6f7e04910329c7d15d856a6a46546762e22a10a`              |
| Runtime deps | `node-hid`, `usb`, `purify-ts`, `uuid`                  |
| Peer deps    | `@ledgerhq/device-management-kit@^1.2.0`, `rxjs@7.8.2`  |

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
  the private `@ledgerhq/vitest-config-dmk`. Tests run on noba instead.
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

- Port the upstream unit tests, already vendored, from vitest to
  [noba](https://github.com/sontuphan/noba), the test framework this repo uses. They lean on
  vitest globals and `vi.mock` against `node-hid` and `usb`; noba covers the same ground with
  `describe`/`test`/`assert` plus `noba/mock` (`shallowMock`, `deepMock`) and `noba/spy`.
  Until they are ported they are excluded from `tsconfig.json` and `pnpm test` cannot run
  them. They must pass with no device attached.
- noba ships a `noba-bare` binary alongside `noba-node`. The dependency probes run on Bare
  only (`pnpm test` is `noba-bare`), which is what the port cares about; the ported unit tests
  can run on either.
- Keep the hardware smoke test: discover, connect, read the address, disconnect.
- Two known rough edges, so they are not mistaken for port regressions: the process does
  not exit after teardown because the HID handle keeps the loop alive, and
  `sessionRefresherOptions: { isRefresherDisabled: true }` is required, or the refresher's
  polling read races teardown and node-hid throws `device has been closed`.

## Step 4: convert to Bare

Six externals, sorted by how much work Bare makes them:

| Dependency  | Used for                         | Bare status                                          | Result |
| ----------- | -------------------------------- | ---------------------------------------------------- | ------ |
| `node-hid`  | every HID read and write         | no equivalent, must be written                       | ⬜     |
| `usb`       | attach and detach events         | no equivalent, needs a substitute                    | ⬜     |
| `purify-ts` | `Either` / `EitherAsync` results | runs unchanged, all 38 exports probed                | ✅     |
| `rxjs`      | observables across the DMK       | runs unchanged, timers and interop included          | ✅     |
| `uuid`      | device and session ids           | needs Bare's import map, wrapped in `@tetherto/uuid` | ✅     |
| DMK         | the transport interface          | loads and constructs, plus APDU primitives           | ✅     |

✅ proven under Bare 1.31.0 · ⬜ not yet

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

### 4.2 Prove `purify-ts` runs under Bare (done)

Every result the transport returns is an `Either` or `EitherAsync`, so if purify-ts does not
run, nothing downstream does. Probed in [test/purify-ts.test.js](../test/purify-ts.test.js),
covering **all 38 exports**: the `Either`/`EitherAsync`/`Maybe` core, `Codec` with all 20
combinators, and the data structures and helpers (`List`, `NonEmptyList`, `Tuple`,
`MaybeAsync`, `Order`, `compare`, `orderToNumber`, `identity`, `always`, `curry`).

**Result: 41 of 41 pass under Bare 1.31.0.** `purify-ts@2.1.0`
resolves through its `import` condition unchanged, so no shim or prebundle is needed.

The coverage guard asserts the module's export list matches the list the probes exercise, so
a purify-ts upgrade that adds an export fails the suite until the new name is covered.

`pnpm test` runs the suite on Bare only, via `noba-bare`. Two toolchain notes worth keeping:

- noba pins `bare@1.23.5`, older than the `>=1.28.0` its own `bare-fs` requires, so
  `noba-bare` fails out of the box. Fixed with pnpm `overrides` pinning `bare` and
  `bare-runtime` to 1.31.x in [package.json](../package.json).
- The Bare binary ships in an optional platform package whose own dependency
  (`require-asset`) can be skipped on a normal install, leaving
  `No binaries found for target`. `pnpm install --force` fixes it.

What this still does not cover: one platform and arch (darwin-arm64) and one Bare version.

### 4.2b Prove `rxjs` runs under Bare (done)

Probed in [test/rxjs.test.js](../test/rxjs.test.js). The operator algebra is plain JavaScript
and was never the risk; the host coupling is. So the probe leans on what Bare actually has to
provide: timers (`timer`, `interval`, `delay`, `debounceTime`), microtask ordering,
`Symbol.observable` interop, teardown on unsubscribe, and promise conversion via
`firstValueFrom` and `lastValueFrom`. It also covers everything the transport imports
(`BehaviorSubject`, `from`, `map`, `Observable`, `switchMap`) and the `rxjs/operators`
subpath the DMK requires.

**Result: 25 of 25 pass under Bare 1.31.0.** Bare's timers drive
rxjs scheduling correctly, including `takeUntil` cancellation and `debounceTime` collapsing a
burst.

### 4.2c What the DMK actually requires

The DMK does not bundle its dependencies. Its per-file CJS output requires them at runtime,
which widens 4.3 beyond the DMK's own code:

| Required by the DMK            | Call sites | Bare risk                                                  |
| ------------------------------ | ---------- | ---------------------------------------------------------- |
| `purify-ts`                    | 63         | none, proven above                                         |
| `inversify`                    | 59         | decorators, `Reflect` metadata, `Proxy`                    |
| `rxjs` (plus `rxjs/operators`) | 33         | none, proven above                                         |
| `xstate`                       | 21         | unknown, pure JS but large                                 |
| `semver`, `uuid`               | 10         | `uuid` needs randomness                                    |
| `isomorphic-ws`                | 4          | picks a WebSocket per environment, likely wrong under Bare |
| `reflect-metadata`             | 2          | patches a global `Reflect`, must be checked early          |

`inversify` with `reflect-metadata` is the one to probe next: it is the DMK's DI container, it
runs at construction time, and it depends on engine features rather than plain JavaScript.
`isomorphic-ws` matters only for the parts of the DMK that talk to Ledger's backend, so it may
be avoidable.

### 4.2d `uuid` needs Bare's import map (done)

The first dependency that does not just work. `uuid@11.0.3` ships separate node and browser
builds; Bare matches the `node` export condition, and that build's `rng.js` does
`import 'crypto'`, which Bare cannot resolve:

```
MODULE_NOT_FOUND: Cannot find module 'crypto' imported from
  file:///.../node_modules/uuid/dist/esm/rng.js
```

The fix is one line, no shimming of globals. `bare-node-runtime` publishes an import map that
points `crypto` at `bare-crypto`, and Bare applies it through an import attribute:

```js
export * from 'uuid' with { imports: 'bare-node-runtime/imports' }
```

That is the whole of [src/uuid/bare.js](../src/uuid/bare.js). Node cannot parse that
attribute, so it gets [src/uuid/index.ts](../src/uuid/index.ts), a plain re-export, and the
two are selected by condition rather than by a runtime check. Both are shipped through the
build, and the root [package.json](../package.json) maps them:

```json
"imports": {
  "@tetherto/uuid": {
    "bare": "./dist/uuid/bare.js",
    "default": "./dist/uuid/index.js"
  }
}
```

Callers write `import { v4 } from '@tetherto/uuid'` and never branch on the runtime.
[tsconfig.json](../tsconfig.json) reaches the same files through its existing
`"@tetherto/*": ["./dist/*"]` wildcard, so tsc, tsx, and esbuild need no per package entry.
The wildcard targets the directory, not `index.js`: pointed at the `.js` it resolves but
carries no types, and a TypeScript importer fails with `TS7016`.

Both entries are needed, and neither substitutes for the other. A `paths` alias alone fails
under Bare, which never reads tsconfig (`MODULE_NOT_FOUND`, tested). The `imports` entry alone
fails under tsc. The key also omits the leading `#` that Node's resolution spec requires:
Bare is lenient and resolves it, plain Node ignores the key entirely. A deliberate trade,
since the suite runs on Bare only.

**Import attributes and build targets.** esbuild preserves `with { imports: ... }`, but only
when the target supports it. [tsup.config.ts](../tsup.config.ts) sets `target: 'node20'`,
which predates import attributes, so esbuild silently drops them and Bare is back to
`MODULE_NOT_FOUND`. Since `bare.js` needs no compiling, it is copied through verbatim in
`onSuccess` rather than built.

**Node rejects the attribute outright**, with `ERR_IMPORT_ATTRIBUTE_UNSUPPORTED`, on both
`node` and `tsx`. So an attribute written inline in shared source makes that file Bare only.
Keeping it in `bare.js`, behind the `bare` condition, is what lets the same tree run on both.
Test files are free to use the attribute inline, since the suite runs on Bare alone.

Because the mapping now points into `dist`, `pnpm test` builds first.

Probed in [test/uuid.test.js](../test/uuid.test.js): **12 of 12 pass under Bare 1.31.0**, covering all 14 exports, `v3` and `v5` included, which means `bare-crypto` also
satisfies uuid's md5 and sha1 paths.

Three findings worth carrying into 4.3:

- **The map propagates through the subgraph, including CJS.** A fixture that does
  `require("uuid")` resolves correctly when imported with the attribute, which is exactly the
  shape of the DMK's own per-file CJS output. So the DMK's 4 `require("uuid")` call sites do
  not each need patching; importing the DMK with the attribute should cover them.
- **Order matters, and failure is sticky.** A failed plain `import('uuid')` poisons Bare's
  module cache for that graph, and every later mapped import of it fails too. Load the mapped
  copy first. Load it early enough and later plain imports resolve from cache, mapped.
- **`bare-node-runtime/global` is not needed for this.** It patches globals; the resolution
  fix comes entirely from the import map. Tested separately: global alone still fails.
- **The transport now imports it.** `NodeHidTransport.ts` takes `v4` from `@tetherto/uuid`
  instead of `uuid`, and [tsup.config.ts](../tsup.config.ts) lists the wrapper in `external`.
  Without that, esbuild inlines the `default` branch into the bundle and the `bare` condition
  is never evaluated at runtime. Verified: both `dist` formats keep the bare specifier.

An alternative, if the goal is one less dependency: `bare-crypto` exposes `randomUUID()`,
which returns a valid v4, and the transport calls `v4()` exactly once. That does not help the
DMK's copy, so the import map is needed either way.

### 4.3 The DMK loads and constructs under Bare (done)

The go or no go item, and it is a go. Two separate problems:

1. **Resolution.** The DMK's ESM build is bundler only (`export * from "./src"`) and its
   package declares no `"type": "module"`, so Bare parses those files as CommonJS and throws
   `Unexpected token 'export'`. Its CJS build is fine, but the package exports no subpath, so
   it has to be reached by path: `lib/cjs/index.js`.
2. **Environment.** That build pulls in `inversify`, `xstate`, `ws`, and `reflect-metadata`,
   which want Node builtins (`events`, `util`) and globals (`process`). Both halves of
   `bare-node-runtime` are needed here, unlike uuid, where the import map alone sufficed.

Six lines at the top of [test/dmk.test.js](../test/dmk.test.js):

```js
import 'bare-node-runtime/global'
import * as dmk from '<path>/@ledgerhq/device-management-kit/lib/cjs/index.js' with {
  imports: 'bare-node-runtime/imports',
}
```

**Result: 6 of 6 pass under Bare 1.31.0.** The package exposes 136 exports, every symbol the
transport imports is present (`DeviceConnectionStateMachine`, `TransportConnectedDevice`,
`GeneralDmkError`, `DeviceActionStatus`, `LEDGER_VENDOR_ID`), and
`new DeviceManagementKitBuilder().addTransport(stub).build()` produces a working kit.

Construction is the meaningful half. It runs inversify's DI container, which leans on
decorators and Reflect metadata, and wires the xstate machines, so `inversify`, `xstate`, and
`reflect-metadata` are covered by that one test and need no probes of their own. The builder
also accepts a plain JavaScript stub transport, which is the shape `bare-hid` will take. A kit
with no transport builds fine and fails later on use, with `NoTransportProvidedError`.

The APDU primitives are covered too, since they are the layer the transport hands frames to:
`ApduBuilder`, `ApduParser`, `ApduResponse`, and `CommandUtils` round trip correctly on
`Uint8Array` under Bare.

What this does not prove: no APDU has crossed a wire. This is construction and wiring only.
The first real exchange waits on 4.1.

Nothing about this landed in `src/`. The transport still imports the DMK by package name, and
whether the port ships a wrapper or resolves this another way is a 4.4 decision.

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
