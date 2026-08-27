# @tetherto/bare-hid

`node-hid` under [Bare](https://github.com/holepunchto/bare), consumed unmodified from npm.

The package is a wrapper and nothing else. It holds one dependency, `node-hid@^3.4.0`, and
resolves a different entry point per runtime through an export condition. Node gets
`dist/index.js`, which re-exports node-hid directly. Bare gets `dist/bare.js`, which is two
lines of setup:

```js
import 'bare-node-runtime/global'

export * from 'node-hid' with { imports: 'bare-node-runtime/imports' }
```

The global shim supplies `process`, which nodehid.js reads as a global. The import map is
applied to the whole subgraph below that import, dependencies included, so `events`, `util`,
and `pkg-prebuilds`' own `path` and `os` all resolve to their bare-\* equivalents without a
single call site changing. That last part is why no locally declared map would do: pkg-prebuilds
requires from inside its own package, out of reach of anything declared here.

There is no addon link step, unlike [bare-usb](../bare-usb/). node-hid resolves its binary
through `pkg-prebuilds`, which hands Bare an absolute path to the `.node` file, and Bare loads
that directly. `usb` needs the copy because node-gyp-build's layout does not match what Bare
searches.

## Usage

```js
import { devicesAsync, HIDAsync } from '@tetherto/bare-hid'

const device = (await devicesAsync()).find((d) => d.vendorId === 0x2c97)
const handle = await HIDAsync.open(device.path)
```

## What works, and what does not

Verified under Bare 1.31.2 by `npm test`, five tests, all passing: enumeration through both
`devices()` and `devicesAsync()`, `getHidapiVersion()` reaching into the binding, and the
documented export surface.

Two things are known to be broken, neither of them fixable from inside this package.

**Reads come back zeroed.** Against real hardware, `write()` succeeds and `read()` returns a
correctly sized buffer of zeros. The cause is one function in libnapi, Bare's Node-API layer,
and it is fixed upstream at [libnapi@b4c5a66](https://github.com/holepunchto/libnapi/commit/b4c5a66)
but not yet in any released Bare: `bare/CMakeLists.txt:184` still pins `#60e6881`. When that
pin moves, the same unmodified binary starts returning real bytes. See [PORTING.md](./PORTING.md).

**The synchronous `HID` class cannot be constructed.** nodehid.js inherits with the ES5
borrowed constructor, `EventEmitter.call(this)`, and bare-events is a class, whose `[[Call]]`
always throws. Only `[[Construct]]` is allowed, so `.call()` and `.apply()` are equally out.
Nothing outside node-hid can patch this, and it would take upstream converting to
`class HID extends EventEmitter`, matching what `HIDAsync` there already does.

`HIDAsync`, `devices()` and `devicesAsync()` are unaffected, and the transport uses `HIDAsync`
only, so the limit is recorded by a test rather than worked around.

## Further reading

[ARCHITECTURE.md](./ARCHITECTURE.md) maps how node-hid fits together, JS layer down to hidapi.
[PORTING.md](./PORTING.md) is the audit: every Node API and platform dependency in the upstream
tree, what was measured under Bare, and the experiments that were run and reverted.
