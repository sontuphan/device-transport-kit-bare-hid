# Vendored source

A copy of node-hid, being ported to run under Bare. Upstream except for the JS layer, which
is patched in place; see **Local changes** below. No `.c` or `.h` file is touched, so hidapi is
exactly as shipped.

| | |
| --- | --- |
| Upstream repo | https://github.com/node-hid/node-hid |
| Tag | `v3.4.0` |
| Commit | `d3660efb37c15f20e2f50e38f4304592d27d985f` (2026-07-18) |
| Bundled hidapi | `d6b2a974608dec3b76fb1e36c189f22b9cf3650c`, the `hidapi` submodule |

Verified byte for byte against that tag with `diff -r`, excluding `.git` and `.github`.

The submodule was pulled in with `--recurse-submodules`, since `hidapi/` is the C library the
addon binds and the tree is useless without it.

## Why this is here

The runtime probes established that Bare loads Node-API addons, that node-hid enumerates,
opens a device, and writes to it under Bare, and that only reads come back empty: node-hid
returns read data through `Napi::Buffer<unsigned char>::Copy`, that is
`napi_create_buffer_copy`, in `src/read.cc:47`, and under Bare that yields a correctly sized
buffer of zeros. See [../../docs/STRATEGY.md](../../docs/STRATEGY.md) section 4.1 and the
hardware suite in `packages/device-transport-kit-node-hid/test/hardware/`.

So the port is narrower than a rewrite. The files that matter are:

| File | Role |
| --- | --- |
| `src/read.cc` | the read path, and the one place the data is lost |
| `src/HIDAsync.cc` | async open, write, and the read thread that calls back into JS |
| `src/HID.cc` | the synchronous class, which also trips over `EventEmitter.call(this)` under Bare |
| `src/devices.cc` | enumeration, already working under Bare |
| `nodehid.js` | the JS wrapper over the binding |
| `binding.gyp` | the node-gyp build, to be replaced by `bare-make` plus `cmake-bare` |

## State

The JS layer runs under Bare. The native layer is untouched, so reads still come back zeroed;
see **Why either is needed** below. `ARCHITECTURE.md` maps how the pieces fit together and
`PORTING.md` lists every Node API and platform dependency.

There is no compiled addon in this tree. To exercise the JS layer, borrow the installed one:

```
ln -s ../../node_modules/node-hid/prebuilds packages/bare-hid/prebuilds
```

That symlink is gitignored, and only valid while the vendored version matches the installed
one.

## Local changes

Three things, following the dual entry pattern the `wdk-wallet-*` modules use: one file per
runtime, selected by an export condition.

| File | Change |
| --- | --- |
| `package.json` | an `exports` map with a `bare` condition pointing at `./bare.mjs`, `default` at upstream's `./nodehid.js`. |
| `bare.mjs` | new. The Bare entry point, 2 lines of setup. |
| `nodehid.js` | `function HID` plus `util.inherits` converted to `class HID extends EventEmitter`; the `util` import goes with it. |

```js
// bare.mjs
import 'bare-node-runtime/global'

export * from './nodehid.js' with { imports: 'bare-node-runtime/imports' }
export { default } from './nodehid.js' with { imports: 'bare-node-runtime/imports' }
```

Those two lines buy back the entire upstream source. The global shim supplies `process`, which
nodehid.js reads as a global. The import map is applied to the whole subgraph below that
import, so `events`, `util`, `path` and `os` resolve to their bare-* equivalents without a
single call site changing.

Crucially the map reaches into dependencies too. `pkg-prebuilds` requires `path` and `os` from
inside its own package, where a locally declared map cannot reach; under `bare-node-runtime`'s
map it simply works, and node-hid's own binding resolution is used unchanged.

The `.mjs` extension is not cosmetic: node-hid is a CommonJS package, so a `bare.js` would be
parsed as CommonJS and the `import` statements would fail with `Cannot use import statement
outside a module`.

### The one thing left in the source

`util.inherits` plus `EventEmitter.call(this)` cannot work against bare-events, which is a
class. `bare-node-events`, the Node compatibility wrapper, is a class too, so no mapping fixes
this: it has to be class syntax. The hand written `new.target` guard went with the conversion,
since a class already throws when called without `new`.

Verified on both runtimes, with nothing loaded first: `devices()` returns the same 31 entries
and `getHidapiVersion()` reports 0.15.0.

## What has been proven, and reverted

Two routes to a working bare-hid were built, measured against an attached Nano X, and then
removed to leave this tree clean. Both are cheap to redo from the notes below.

**Patch the C++.** Four `Napi::Buffer<unsigned char>::Copy` calls, in `src/read.cc`,
`src/HIDAsync.cc` (twice) and `src/HID.cc`, replaced by an allocation plus `memcpy`. About ten
lines, no `.c` or `.h` touched, and it inherits node-hid's async workers and read thread
unchanged. Built out of tree with node-gyp so this tree stays pristine.

**Write a Bare addon.** Roughly 240 lines of C against Bare's own `js.h`, with `BARE_MODULE()`
as the entry point, linking this same unmodified hidapi through its own CMake, built with
`bare-make` plus `cmake-bare`. Enumerates correctly under Bare. Node-API is never involved, so
the defect below is unreachable by construction, but async reads, `'data'` events and feature
reports would all have to be written.

One toolchain note for the second route: `cmake-bare` looks for its siblings at
`node_modules/cmake-npm` relative to the source directory, which npm's hoisting breaks in a
workspace. Prepending the root `node_modules` to `CMAKE_PREFIX_PATH` fixes it.

## Why either is needed

`Napi::Buffer::Copy` is `napi_create_buffer_copy`, which Bare's Node-API layer implements as an
allocation without the copy: every read comes back the right length and full of zeros.
Measured with a four function probe addon, the same binary on both runtimes returning the
bytes `deadbeef`:

| Strategy | Node | Bare |
| --- | --- | --- |
| `Buffer::Copy`, that is `napi_create_buffer_copy` | `deadbeef` | `00000000` |
| `Buffer::New` plus `memcpy` | `deadbeef` | `deadbeef` |
| `ArrayBuffer` plus `Uint8Array` | `deadbeef` | `deadbeef` |
| filling a caller supplied buffer | `deadbeef` | `deadbeef` |

So the defect is one function in libnapi, not in node-hid. The real fix belongs upstream in
Bare; both routes above are ways to work around it until then.
