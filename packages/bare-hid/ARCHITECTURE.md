# How node-hid fits together

Read from the vendored v3.4.0 tree: `nodehid.js`, `binding-options.js`, `src/*.cc`,
`src/*.h`, `binding.gyp`. Annotated with what Bare does and does not survive; see
[PORTING.md](./PORTING.md) for the evidence.

## The stack

```mermaid
flowchart TB
  subgraph js["JavaScript, nodehid.js"]
    api["devices() · devicesAsync()<br/>setDriverType()"]
    hid["class HID<br/>synchronous, ES5 inheritance"]
    hidasync["class HIDAsync<br/>extends EventEmitter"]
    loader["loadBinding()<br/>picks HID or HID_hidraw by process.platform"]
  end

  subgraph resolve["Binary resolution"]
    opts["binding-options.js<br/>name: HID, napi_versions: [4]"]
    prebuilds["pkg-prebuilds/bindings<br/>__dirname + platform + arch"]
    binary["prebuilds/HID-darwin-arm64/<br/>node-napi-v4.node"]
  end

  subgraph native["Native, src/"]
    exports["exports.cc<br/>NODE_API_MODULE(Init)<br/>builds ContextState, hid_init()"]
    devices["devices.cc<br/>devices() · devicesAsync()"]
    hidcc["HID.cc<br/>ObjectWrap + AsyncWorker"]
    hidasynccc["HIDAsync.cc<br/>10 PromiseAsyncWorkers"]
    readcc["read.cc<br/>std::thread + TypedThreadSafeFunction"]
    util["util.cc / util.h<br/>ApplicationContext · ContextState<br/>DeviceContext · AsyncWorkerQueue"]
  end

  subgraph c["C"]
    hidapi["hidapi<br/>hid_open · hid_read · hid_write · hid_enumerate"]
    backend["mac/hid.c · linux/hid.c · libusb/hid.c · windows/hid.c"]
    os["IOKit · udev · libusb · Win32 HID"]
  end

  api --> loader
  hid --> loader
  hidasync --> loader
  loader --> opts --> prebuilds --> binary --> exports

  exports --> devices
  exports --> hidcc
  exports --> hidasynccc
  hidasynccc --> readcc
  hidcc --> readcc
  devices --> util
  hidasynccc --> util
  readcc --> util

  devices --> hidapi
  hidcc --> hidapi
  hidasynccc --> hidapi
  readcc --> hidapi
  hidapi --> backend --> os
```

## One read, end to end

The path that matters for the port, and the one that breaks under Bare.

```mermaid
sequenceDiagram
  participant App as caller
  participant JS as HIDAsync (nodehid.js)
  participant Worker as ReadOnceWorker / read thread
  participant HidApi as hidapi
  participant Dev as device

  App->>JS: write(report)
  JS->>Worker: _raw.write, via a PromiseAsyncWorker
  Worker->>HidApi: hid_write()
  HidApi->>Dev: 64 byte report
  Note over App,Dev: works under Bare, the buffer travels inwards

  App->>JS: read(timeout) or on('data')
  JS->>Worker: _raw.read / readStart(cb)
  Worker->>HidApi: hid_read_timeout()
  Dev-->>HidApi: 64 byte answer
  HidApi-->>Worker: unsigned char buf[len]
  Worker-->>JS: Napi::Buffer::Copy(env, buf, len)
  JS-->>App: Buffer
  Note over Worker,JS: napi_create_buffer_copy<br/>right length, all zeros under Bare
```

## Where Bare stands

```mermaid
flowchart LR
  subgraph works["Works under Bare"]
    w1["pkg-prebuilds resolution"]
    w2["hid_enumerate → devices()"]
    w3["HIDAsync.open()"]
    w4["write(), buffer inbound"]
    w5["getDeviceInfo(), strings and numbers"]
    w6["TSFN callback fires"]
  end

  subgraph broken["Broken under Bare"]
    b1["Napi::Buffer::Copy outbound<br/>read.cc:47, HIDAsync.cc:433/518"]
    b2["EventEmitter.call(this)<br/>nodehid.js:33, sync HID class only"]
  end
```

Two failures, both narrow. The buffer copy is a libnapi defect rather than a node-hid one:
Bare's Node-API support is `holepunchto/libnapi` layered over `libjs`, so
`napi_create_buffer_copy` is the single function to look at. The `EventEmitter.call(this)`
break only affects the synchronous `HID` class, which the transport never uses.
