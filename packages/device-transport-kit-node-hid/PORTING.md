# Porting audit

What stands between this transport and a real APDU exchange under Bare. Read from `api/`,
`index.ts`, `package.json` and `tsup.config.ts`, and measured against Bare 1.31.0 with the
`@tetherto/bare-hid`, `@tetherto/bare-usb` and `@tetherto/uuid` wrappers in place.

Sibling documents: [VENDOR.md](./VENDOR.md) for provenance and every deviation from upstream,
[../bare-hid/PORTING.md](../bare-hid/PORTING.md) for the node-hid layer below this one, and
[../../docs/STRATEGY.md](../../docs/STRATEGY.md) section 4 for the plan this closes out.

**Two pieces remain**, one of them outside this repository. Work that has landed is recorded in
[VENDOR.md](./VENDOR.md) rather than here, so this file stays a list of what is left. Section 3
records what was measured and found safe, so a later pass does not re-derive it.

## 1. Bare has to ship the libnapi fix

Not ours, and it gates the hardware test whatever else lands. `bare/CMakeLists.txt:184` pins
`github:holepunchto/libnapi#60e6881`, the commit immediately before
[libnapi@b4c5a66](https://github.com/holepunchto/libnapi/commit/b4c5a66), which fixed
`napi_create_buffer_copy` dropping the copy when `result_data` is `nullptr`. Until the pin moves
and a Bare release goes out, every read from node-hid returns a correctly sized buffer of zeros,
so every APDU response is zeros. See [../bare-hid/PORTING.md](../bare-hid/PORTING.md) section 2.

## 2. DMK resolution, the one open decision

This is what stops it today, ahead of everything else. Importing the built transport under Bare
fails before any of its own code runs:

```
$ bare -e "import('@tetherto/device-transport-kit-node-hid')"
Uncaught SyntaxError: Unexpected token 'export'
    at Module._extensions..cjs (bare:/bare.bundle/node_modules/bare-module/index.js:891:30)
```

`@ledgerhq/device-management-kit` resolves its `import` condition to `lib/esm/index.js`, whose
entire contents are:

```js
export*from"./src";
```

and the package declares no `"type": "module"`, so Bare parses that `.js` as CommonJS. Its CJS
build is fine, and [test/dmk.test.js](./test/dmk.test.js) already proves it: 136 exports, every
symbol this transport imports, and a working `DeviceManagementKitBuilder`. The problem is purely
reaching it. DMK's own subpath pattern is

```json
"./*": { "import": "./lib/esm/*", "require": "./lib/cjs/*" }
```

so an ESM import of any subpath lands in `lib/esm` too. `dmk.test.js` sidesteps this with the
`~/*` imports map, which bypasses `exports` entirely.

No runtime shim can help here, and it is worth being precise about why. This is a parse failure
during module linking, and ES modules link the entire graph before evaluating any of it, so the
`bare-node-runtime/global` import at the top of [bare.js](./bare.js) has not run when it happens.
Confirmed: after a failed import under Bare, `globalThis.process` is still `undefined`. The
`bare` condition is nonetheless being selected correctly, which `Module.resolve` reports as
`packages/device-transport-kit-node-hid/dist/bare.js`. The entry point is wired; the graph below
it simply cannot be parsed yet.

The obvious answer is a `@tetherto/dmk` wrapper in the `@tetherto/uuid` shape, reaching
`lib/cjs/index.js` through its own `imports` map, with `default` left as the package name so
Node is unaffected. One consideration before committing to it: the DI container and the
`instanceof` checks require a single DMK copy in the graph, so the wrapper must resolve to the
same physical files the rest of the tree loads, not a second install.

This is the only remaining piece that needs a decision rather than typing.
[../../docs/STRATEGY.md](../../docs/STRATEGY.md) left it open as a 4.4 item.

The same shape of problem applies to `@ledgerhq/device-signer-kit-ethereum`, which the
acceptance test needs; see section 3.

## 3. Measured and found safe

None of these are blockers. Recorded with their evidence so a later pass does not re-check them.

### Globals

After `import 'bare-node-runtime/global'`, under Bare 1.31.0:

| Global | Used at | Result |
| --- | --- | --- |
| `Buffer` | [NodeHidApduSender.ts:88](./api/transport/NodeHidApduSender.ts#L88), [:198](./api/transport/NodeHidApduSender.ts#L198) | ok |
| `process.platform` | [NodeHidTransport.ts:58](./api/transport/NodeHidTransport.ts#L58) | ok, reports `darwin` |
| `process.on('exit')` | [NodeHidTransport.ts:346](./api/transport/NodeHidTransport.ts#L346) | ok |
| `AbortController` | [NodeHidTransport.ts:96](./api/transport/NodeHidTransport.ts#L96), [:354](./api/transport/NodeHidTransport.ts#L354) | ok, `abort()` included |
| `setTimeout` | [NodeHidApduSender.ts:100](./api/transport/NodeHidApduSender.ts#L100), [:151](./api/transport/NodeHidApduSender.ts#L151) | ok |

`Buffer` is a Bare global already; the rest arrive with the shim. No `node:` prefixed imports
anywhere in `api/`.

### The write path takes a `Buffer`

[NodeHidApduSender.ts:88](./api/transport/NodeHidApduSender.ts#L88) sends
`Buffer.from([0x00].concat(...))`. node-hid branches on `val.IsBuffer()` first at
`node_modules/node-hid/src/util.cc:171` and falls through to `IsArray()`, erroring on anything
else, so which branch a Bare `Buffer` takes matters.

It takes the right one. libnapi implements `napi_is_buffer` as `js_is_typedarray` plus
`type == js_uint8array` (`napi.h:1019-1032`), and under Bare `Buffer.from([0, 1, 2])` reports
`instanceof Uint8Array: true`, constructor `Buffer`, tag `[object Uint8Array]`.

Sound by construction rather than executed: the existing hardware probe in
[test/hardware/ledger.test.js](./test/hardware/ledger.test.js) writes a plain array, which is the
other branch, so a `Buffer` has never actually crossed into the addon under Bare.

### The read path does not care what it receives

[NodeHidApduSender.ts:198](./api/transport/NodeHidApduSender.ts#L198) is typed
`receiveHidInputReport(buffer: Buffer)` but its first statement is `new Uint8Array(buffer)`. Bare
hands back a `Uint8Array` rather than a Node `Buffer`, since libnapi builds one through
`js_create_typedarray`, and that copy constructor accepts either. No change needed.

### The signer kit loads

`@ledgerhq/device-signer-kit-ethereum` is not a dependency of this package but the acceptance
test in [../../index.js](../../index.js) needs it, and it had never been probed. Its ESM entry
has the same `export*from` shape as the DMK's, so section 2's decision has to cover it too.
Through `lib/cjs/index.js` with the shims it loads under Bare: 6 exports, `SignerEthBuilder`
present as a function.

## 4. Outstanding, but not hardware blockers

The vendored upstream unit tests are still on vitest and excluded from `tsconfig.json`, so
`npm test` runs only the dependency probes in `test/`. Porting them is step 3 of the plan and
independent of everything above.

Two known rough edges, recorded so they are not mistaken for port regressions: the process does
not exit after teardown, because the HID handle keeps the loop alive; and
`sessionRefresherOptions: { isRefresherDisabled: true }` is required, or the refresher's polling
read races teardown and node-hid throws `device has been closed`.

## 5. Order of work

Section 2 needs the wrapper decision, and nothing downstream of it can be observed working until
it lands. Section 1 is upstream and can land at any point, and only then does the hardware suite
have a chance of passing.

Once both are in, the last mechanical step is renaming: `nodeHidIdentifier` at
[NodeHidTransport.ts:73](./api/transport/NodeHidTransport.ts#L73) carries the string `NODE-HID`,
which surfaces in DMK logs and on `ConnectedDevice.transport`, alongside `NodeHidTransport`,
`NodeHidApduSender`, `nodeHidTransportFactory` and the package name itself.
