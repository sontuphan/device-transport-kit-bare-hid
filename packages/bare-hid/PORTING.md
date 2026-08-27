# Porting audit

Everything in node-hid that touches a Node API or a platform, found by reading `nodehid.js`,
`binding-options.js`, `src/*.cc`, `src/*.h`, and `binding.gyp`. This is the map that decided
what this package had to change, which turned out to be nothing.

All line references are to **node-hid v3.4.0**, commit
`d3660efb37c15f20e2f50e38f4304592d27d985f` (2026-07-18), bundling hidapi
`d6b2a974608dec3b76fb1e36c189f22b9cf3650c`. That tree was vendored here while the audit ran and
has since been removed; read it at `node_modules/node-hid/` or upstream.

Anything marked **works** was executed under Bare against an attached Nano X. See
[../../docs/STRATEGY.md](../../docs/STRATEGY.md) section 4.1.

## 1. JS layer, `nodehid.js` (done, without a patch)

Running on both runtimes with the upstream file untouched. [bare.js](./bare.js) applies
`bare-node-runtime`'s globals and import map to everything below it, and the package's `exports`
map picks it through the `bare` condition.

| Line | Upstream | Under Bare |
| --- | --- | --- |
| 2, 3 | `require("events")`, `require("util")` | mapped to `bare-events` and `bare-utils` |
| 15 | global `process` | `bare-node-runtime/global` installs it |
| 18 | `require("pkg-prebuilds/bindings")` | works; the map reaches into pkg-prebuilds' own `path` and `os` requires |
| 22, 33, 70 | `function HID`, `EventEmitter.call(this)`, `util.inherits` | **broken**, see below |
| 66, 173, 177 | `process.nextTick` | works, `process` resolves |
| 138, 214 | `setImmediate` | works, Bare provides it globally |
| 151 | `raw instanceof binding.HIDAsync` | works |

Defining the ES5 `HID` constructor is harmless, and `util.inherits(HID, EventEmitter)` only
rewires prototypes, so the module evaluates cleanly. Only construction throws:

```
Class constructor EventEmitter cannot be invoked without 'new'
```

This is a language rule rather than a Bare defect. bare-events is
`module.exports = class EventEmitter` (index.js:103) where Node's is still a function
declaration, and a class constructor's `[[Call]]` throws unconditionally. `.call()`, `.apply()`
and `Reflect.apply()` are all `[[Call]]`, so the borrowed constructor pattern has no way through.

An earlier revision of this package vendored nodehid.js and converted the class. That is the
correct fix, and it belongs upstream, where `HIDAsync` is already `class HIDAsync extends
EventEmitter`. Worth knowing that bare-events lazily initializes anyway (index.js:67,
`if (ctx._events === undefined) ctx._events = Object.create(null)`), so deleting the line would
also work under Bare; whether Node tolerates the same deletion has not been tested.

Nothing else in the JS layer needed anything. Verified under Bare: `devices()` and
`devicesAsync()` return the same 22 entries as Node, `getHidapiVersion()` reports 0.15.0,
`HIDAsync.open()` succeeds, and `on('data')` registers a listener, which is what drives
`process.nextTick` into the read thread.

## 2. Native layer, `src/`

### N-API surface

`Napi::TypeError` (69), `Napi::Env` (69), `Napi::Value` (68), `Napi::CallbackInfo` (50),
`Napi::Number` (28), `Napi::Function` (14), `Napi::Array` (11), `Napi::String` (10),
`Napi::AsyncWorker` (10), `Napi::Object` (8), `Napi::External` (6), `Napi::Buffer` (6),
`Napi::Error` (5), `Napi::ObjectWrap` (4), `Napi::Promise` (3), `Napi::FunctionReference` (2),
`Napi::Boolean` (2), `Napi::TypedThreadSafeFunction` (1).

All of it is node-addon-api, pulled in at `src/util.h:5` with `#include <napi.h>` and reaching
every other file transitively. node-addon-api is a header-only C++ wrapper that compiles down to
plain `napi_*` calls, left undefined in the `.node` and resolved against the host at load. Node
implements them in its own binary; Bare implements them in libnapi, compiled into the bare
binary. Nothing about that pairing needs porting.

Strings, numbers, arrays, objects, promises, `External`, `ObjectWrap`, and `AsyncWorker` are all
proven working under Bare: enumeration, `HIDAsync.open`, `write`, and `getDeviceInfo` all return
correct values.

### `Napi::Buffer`, the one broken path

| Site | Direction | Under Bare |
| --- | --- | --- |
| `src/read.cc:47` | out, read thread | **zeros**, correct length |
| `src/HIDAsync.cc:433` | out, `ReadOnceWorker` promise result | zeros, same cause |
| `src/HIDAsync.cc:518` | out, `GetFeatureReportWorker` | untested, same call |
| `src/HID.cc:209` | out, synchronous `ReadWorker` | unreachable, the class fails first |
| `src/util.cc:173` | in, JS buffer to C++ on write | **works** |

Every failure is `Napi::Buffer<unsigned char>::Copy`, which is `napi_create_buffer_copy` with a
hardcoded `nullptr` for `result_data` (`napi-inl.h:3242-3248`). libnapi read that argument as the
destination rather than as an optional out-parameter, so a `nullptr` skipped the copy outright:

```c
int err = js_create_arraybuffer(env, len, result_data, &arraybuffer);
if (result_data) memcpy(result_data, data, len);
```

Fixed upstream in [libnapi@b4c5a66](https://github.com/holepunchto/libnapi/commit/b4c5a66),
which allocates into a local and copies unconditionally. Not yet in a released Bare:
`bare/CMakeLists.txt:184` pins `github:holepunchto/libnapi#60e6881`, the commit immediately
before. One line, one release, and every `.node` on Bare picks it up.

### Threading

`src/read.cc:20` builds a `Napi::TypedThreadSafeFunction` for the background read loop, and
`src/HIDAsync.cc` defines ten `PromiseAsyncWorker` subclasses (`CloseWorker`, `OpenByPathWorker`,
`OpenByUsbIdsWorker`, `ReadStopWorker`, `ReadOnceWorker`, `GetFeatureReportWorker`, and others).
The TSFN callback does fire under Bare, so the threading model itself holds up; it is only the
payload that arrives empty.

## 3. Platform sensitivity

### C++

Eight `#if defined(__APPLE__)` blocks, in `src/HID.cc` (lines 30, 68, 94, 143) and
`src/HIDAsync.cc` (32, 134, 185, 251). No `_WIN32` or `__linux__` conditionals in the C++, so
platform differences below macOS live in hidapi and the build file.

### `binding.gyp`

| Platform | hidapi backend | Link |
| --- | --- | --- |
| mac | `hidapi/mac/hid.c` | IOKit, CoreFoundation, AppKit frameworks, `MACOSX_DEPLOYMENT_TARGET` 10.9 |
| linux, hidraw | `hidapi/linux/hid.c` | `-ludev` |
| linux, libusb | `hidapi/libusb/hid.c` | `-lusb-1.0`, and `-ludev` unless disabled |
| freebsd | `hidapi/libusb/hid.c` | `-lusb` |
| win | `hidapi/windows/hid.c` | per the `OS=="win"` block |

This is upstream's problem, not ours. Consuming node-hid from npm means consuming its prebuild
matrix exactly as Node does, and no build system question arises here at all.

### Two binaries per platform on Linux

`binding-options.js` names the addon `HID`, and `nodehid.js:15-16` rewrites it to `HID_hidraw`
when `process.platform === "linux"` and no driver type was chosen. The choice is keyed on a
`process` value, which the global shim supplies, so it survives unchanged. Untested on Linux.

## 4. Summary

Two things blocked Bare, and neither is a node-hid defect.

1. `napi_create_buffer_copy` dropped the copy. **Fixed in libnapi, pending a Bare release.**
2. `EventEmitter.call(this)` against a class emitter. **Open**, affects the synchronous `HID`
   class only, which the transport does not use.

Everything else already runs, on the stock npm package, with no patch and no rebuild.

## 5. Experiments run and reverted

Three routes to a working bare-hid were built and measured before the wrapper made them
unnecessary. Recorded so none of them gets rediscovered.

**Vendor and patch the C++.** Four `Napi::Buffer<unsigned char>::Copy` calls replaced by an
allocation plus `memcpy`. About ten lines, no `.c` or `.h` touched. Works, and inherits
node-hid's async workers and read thread unchanged.

**Write a Bare addon from scratch.** Roughly 240 lines of C against Bare's own `js.h`, with
`BARE_MODULE()` as the entry point, linking the same unmodified hidapi through its own CMake,
built with `bare-make` plus `cmake-bare`. Enumerates correctly under Bare. Node-API is never
involved, so the defect is unreachable by construction, but async reads, `'data'` events and
feature reports would all have to be written. One toolchain note: `cmake-bare` looks for its
siblings at `node_modules/cmake-npm` relative to the source directory, which npm's hoisting
breaks in a workspace; prepending the root `node_modules` to `CMAKE_PREFIX_PATH` fixes it.

**Carry a fixed libnapi inside the addon.** Compiling node-hid's C++ against libnapi's own
headers does not work: `napi.h` declares `extern "C"` but its inline bodies are C99 only, and a
C++ translation unit has to compile them. It fails on a `struct`/typedef name collision at
`napi.h:61`, implicit `void *` conversions at 489 and 525, compound literals at 589 and 596, and
`char16_t` against libjs's `utf16_t` at 1154. What does work is compiling libnapi's `src/napi.c`
as C with `-fvisibility=hidden` and linking it in, which yields 161 private-external `napi_*`
definitions; the resulting bundle has zero undefined `napi_*` and 141 undefined `js_*`/`uv_*`,
all of which the bare binary exports. It is a workaround for the release lag, not an
architecture, and the pin bump retires it.

### Measured evidence for the buffer defect

A four function probe addon, the same binary on both runtimes, returning the bytes `deadbeef`:

| Strategy | Node | Bare |
| --- | --- | --- |
| `Buffer::Copy`, that is `napi_create_buffer_copy` | `deadbeef` | `00000000` |
| `Buffer::New` plus `memcpy` | `deadbeef` | `deadbeef` |
| `ArrayBuffer` plus `Uint8Array` | `deadbeef` | `deadbeef` |
| filling a caller supplied buffer | `deadbeef` | `deadbeef` |

One function, not addon support in general.
