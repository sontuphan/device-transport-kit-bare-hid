# Vendored source

`node-hid/` is an unmodified copy of node-hid, kept so it can be ported to a Bare native
addon. Nothing in it has been touched, and nothing here builds or runs yet.

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

## Deliberately not decided yet

Whether this becomes a real Bare addon, a patch to the read path that Bare can carry, or is
dropped entirely because Bare fixes `napi_create_buffer_copy` upstream. The copy is here to
make that call with the code in front of us.
