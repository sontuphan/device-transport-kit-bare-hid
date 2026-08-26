# Porting audit

Everything in the vendored tree that touches a Node API or a platform, found by reading
`nodehid.js`, `binding-options.js`, `src/*.cc`, `src/*.h`, and `binding.gyp`. Nothing here is
changed; this is the map for deciding what to change.

Anything marked **works** was executed under Bare 1.31.0 against an attached Nano X. See
[../../docs/STRATEGY.md](../../docs/STRATEGY.md) section 4.1.

## 1. JS layer, `nodehid.js` (done)

Running on both runtimes. `package.json` gains an `exports` map with a `bare` condition, and
`bare.mjs` applies `bare-node-runtime`'s globals and import map to everything below it. Every
require in this table is upstream, untouched; the sole surviving source change is the `HID`
class conversion.

| Line | Was | Now |
| --- | --- | --- |
| 2, 3 | `require("events")`, `require("util")` | `events` unchanged, mapped by bare-node-runtime; `util` no longer needed after the class conversion |
| 15 | global `process` | unchanged; `bare-node-runtime/global` installs it |
| 18 | `require("pkg-prebuilds/bindings")` | unchanged; the map reaches into pkg-prebuilds' own `path` and `os` requires |
| 22, 70 | `function HID` plus `util.inherits` | `class HID extends EventEmitter` |
| 33 | `EventEmitter.call(this)` | `super()` |
| 66, 173, 177 | `process.nextTick` | unchanged, `process` now resolves under Bare |
| 138, 214 | `setImmediate` | unchanged, Bare provides it globally |
| 151 | `raw instanceof binding.HIDAsync` | unchanged, works |

The class conversion was the only change that could not be a shim: bare-events is a class, so
calling it as a function throws. The hand written `new.target` guard went with it, since a
class already throws when called without `new`.

Verified under Bare: `devices()` returns the same 31 entries as Node, `getHidapiVersion()`
reports 0.15.0, `HIDAsync.open()` succeeds, and `on('data')` registers a listener, which is
what drives `process.nextTick` into the read thread.

## 2. Native layer, `src/`

### N-API surface

`Napi::TypeError` (69), `Napi::Env` (69), `Napi::Value` (68), `Napi::CallbackInfo` (50),
`Napi::Number` (28), `Napi::Function` (14), `Napi::Array` (11), `Napi::String` (10),
`Napi::AsyncWorker` (10), `Napi::Object` (8), `Napi::External` (6), `Napi::Buffer` (6),
`Napi::Error` (5), `Napi::ObjectWrap` (4), `Napi::Promise` (3), `Napi::FunctionReference` (2),
`Napi::Boolean` (2), `Napi::TypedThreadSafeFunction` (1).

Strings, numbers, arrays, objects, promises, `External`, `ObjectWrap`, and `AsyncWorker` are
all proven working under Bare: enumeration, `HIDAsync.open`, `write`, and `getDeviceInfo` all
return correct values.

### `Napi::Buffer`, the one broken path

| Site | Direction | Under Bare |
| --- | --- | --- |
| `src/read.cc:47` | out, read thread | **zeros**, correct length |
| `src/HIDAsync.cc:433` | out, `ReadOnceWorker` promise result | zeros, same cause |
| `src/HIDAsync.cc:518` | out, `GetFeatureReportWorker` | untested, same call |
| `src/HID.cc:209` | out, synchronous `ReadWorker` | unreachable, the class fails first |
| `src/util.cc:173` | in, JS buffer to C++ on write | **works** |

Every failure is `Napi::Buffer<unsigned char>::Copy`, that is `napi_create_buffer_copy`.
Buffers travelling into the addon are fine, only the ones created by it come back empty.
The comment at `read.cc:45` notes the copy exists for Electron's sake, which suggests the
alternative, handing back the buffer without copying, may be viable.

### Threading

`src/read.cc:20` builds a `Napi::TypedThreadSafeFunction` for the background read loop, and
`src/HIDAsync.cc` defines ten `PromiseAsyncWorker` subclasses (`CloseWorker`,
`OpenByPathWorker`, `OpenByUsbIdsWorker`, `ReadStopWorker`, `ReadOnceWorker`,
`GetFeatureReportWorker`, and others). The TSFN callback does fire under Bare, so the
threading model itself holds up; it is only the payload that arrives empty.

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

This whole file is node-gyp, and would be replaced by `bare-make` plus `cmake-bare`. hidapi
ships a `CMakeLists.txt` of its own, which helps.

### Two binaries per platform on Linux

`binding-options.js` names the addon `HID`, and `nodehid.js:15-16` rewrites it to `HID_hidraw`
when `process.platform === "linux"` and no driver type was chosen. So Linux ships both
backends and picks at load time, keyed on a `process` value. Any Bare port has to keep that
choice, or drop one backend deliberately.

## 4. Summary

Two things blocked Bare. One is now fixed:

1. `napi_create_buffer_copy` returns empty buffers. A Bare defect rather than a node-hid one,
   and it still blocks every read. **Open.**
2. `EventEmitter.call(this)` in the `HID` class, a JS level incompatibility with bare-events.
   **Fixed**, by converting to class syntax; see section 1.

Everything else, the build aside, already runs.
