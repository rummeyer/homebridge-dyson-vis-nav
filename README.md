# homebridge-dyson-vis-nav

A [Homebridge](https://homebridge.io) plugin that exposes the **Dyson 360 Vis Nav** robot vacuum to Apple Home as a **native Matter robot vacuum cleaner**, via Dyson's AWS IoT MQTT gateway.

This is a port of [`matterbridge-dyson-robot`](https://github.com/thoukydides/matterbridge-dyson-robot) by Alexander Thoukydides, narrowed to the 360 Vis Nav and rebuilt on Homebridge 2.0's Matter support.

## Requirements

| | |
|---|---|
| Homebridge | 2.4.0 or later |
| Node.js | 22, 24 or 26 |
| Matter | **must be enabled** in the Homebridge settings |
| Device | Dyson 360 Vis Nav (RB03, MQTT root topic `277`) |
| Account | a MyDyson account with the robot added |

**Matter is not optional.** HomeKit's own accessory protocol (HAP) has no robot vacuum service — Apple added robot vacuums to the Home app through Matter only. Without Matter enabled this plugin logs an error and does nothing.

## Installation

This plugin is not on the npm registry, so the Homebridge UI's plugin search will not find it. Install it from a release tarball instead.

1. Enable Matter in Homebridge (Settings → Matter), then restart Homebridge.
2. On the Homebridge host, install the plugin into the same directory `hb-service` uses for plugins. On a standard `hb-service` install that is `<storage path>/node_modules`, with the storage path usually `/var/lib/homebridge`:
   ```
   sudo npm --prefix /var/lib/homebridge install \
     https://github.com/rummeyer/homebridge-dyson-vis-nav/releases/download/v0.2.0/homebridge-dyson-vis-nav-0.2.0.tgz
   sudo hb-service restart
   ```
   The tarball is prebuilt, so the host needs neither git nor a TypeScript toolchain.

   > `sudo hb-service add homebridge-dyson-vis-nav` does **not** work: it validates its argument as an npm plugin name and rejects URLs and file paths.

   To install from source instead — this needs git and builds on the host:
   ```
   sudo npm --prefix /var/lib/homebridge install github:rummeyer/homebridge-dyson-vis-nav
   ```
3. Reload the Homebridge UI. The plugin appears under *Plugins*. Its settings open with a **MyDyson Account** box at the top, and the rest of the configuration below it.
4. Enter your email address and password, then click **Request code**. There is nothing to do in the MyDyson app itself — the plugin asks Dyson to send the email, which arrives titled "Log in to your MyDyson App".
5. Put the code from that email in **Auth code** and click **Submit**.
6. Save the configuration and restart Homebridge.
7. The robot is published as its **own Matter node**, not through the Homebridge bridge, so it has a **separate pairing code**. Find it in the Homebridge log (`📱 Commissioning codes for <name>`) and add it in the Home app with *Add Accessory → More options*.

Step 7 is not a quirk of this plugin: Apple Home does not accept bridged robot vacuums, so Homebridge publishes them as standalone nodes automatically.

## Why cloud-only

The 360 Vis Nav does not accept local MQTT connections, unlike the older 360 Eye and 360 Heurist. Dyson's AWS IoT gateway is the only way to reach it, so the local provisioning methods offered by the Matterbridge original are not implemented here. Your password is used once to obtain a bearer token; the token is stored in the plugin's own `node-persist` store, not in `config.json`.

## What you get in Apple Home

| Feature | Status |
|---|---|
| Start / stop / pause / resume | ✅ |
| Return to dock | ✅ |
| Cleaning mode (Auto, Quick, Quiet, Boost) | ✅ |
| Battery level, charging state, low-battery warning | ✅ |
| Activity state (Running, Paused, Seeking charger, Charging, Docked) | ✅ |
| Fault reporting (bin missing/full, stuck, wheels jammed, …) | ✅ |
| Zone cleaning | ✅ (Vis Nav only feature; zone list comes from the MyDyson account) |
| Clean map rendered into the log | ✅ (optional, see `logMapStyle`) |

### When the robot is unreachable

The robot is marked unreachable a few seconds after it stops responding, and its
activity is reported as unknown once `unreachableTimeout` (120 s by default)
elapses. Without that, the last state seen would stand indefinitely — a robot
that vanished mid-clean would keep showing as cleaning.

### Known limitations

- **No Matter cluster events.** Homebridge 2.4.0 exposes no API for emitting them, so the `OperationalError`, `OperationCompletion`, `BatFaultChange` and `BatChargeFaultChange` events of the Matterbridge original are written to the log instead. The corresponding *attributes* are updated normally, and those are what the Home app reads — so this is not visible in day-to-day use.
- **Some device metadata is not exposed.** Homebridge's Matter accessory descriptor has no fields for vendor ID, product ID, product appearance or product URL. They are logged at debug level instead.
- **Battery charge faults are log-only.** Homebridge's `powerSource` cluster state has `activeBatFaults` but not `activeBatChargeFaults`.

## Configuration

Most settings have sensible defaults. The full set:

| Option | Default | Meaning |
|---|---|---|
| `provisioningMethod` | `Remote Account` | `Remote Account` for a real device, `Mock Devices` to replay a recorded session |
| `dysonAccount.email` / `.password` | — | MyDyson credentials |
| `dysonAccount.china` | `false` | Set for accounts registered in China |
| `whiteList` | `[]` | Only these serial numbers are exposed; empty exposes every robot in the account |
| `simpleModeTagsRvc` | `true` | Advertise one descriptive mode tag per cleaning mode instead of the full set |
| `wildcardTopic` | `false` | Subscribe to all MQTT topics — useful when capturing logs for a bug report |
| `logMapStyle` | `Off` | Render a map of each completed clean into the log |
| `unreachableTimeout` | `120` | Seconds the robot may stay silent before Apple Home is told its activity is unknown |
| `debug` / `debugFeatures` | `false` / `[]` | Diagnostic logging |

### Testing without hardware

`mqtt-logs/277.jsonl` is a recorded Vis Nav MQTT session (from the upstream project's regression tests). With `provisioningMethod` set to `Mock Devices` the plugin replays it, which exercises the full state machine without a device or a MyDyson account.

This is a development path and is **not offered in the settings UI**: it has to be written into `config.json` by hand, and saving from the UI afterwards will drop the `devices` block, since the form does not know it.

```json
{
    "platform": "DysonVisNav",
    "name": "Dyson 360 Vis Nav",
    "provisioningMethod": "Mock Devices",
    "devices": [{
        "name": "Vis Nav Test",
        "serialNumber": "ABC-EU-TEST0001",
        "rootTopic": "277",
        "filename": "/path/to/mqtt-logs/277.jsonl"
    }]
}
```

## Development status

The Dyson protocol layer — cloud API, MQTT client, message parsing, state and fault mapping, zone handling — is ported essentially unchanged from `matterbridge-dyson-robot`, which is validated against physical devices.

The Matter layer is new. It has been verified end-to-end against Homebridge 2.4.0 with the recorded session above: the accessory publishes as a standalone Matter node and all five clusters (`rvcRunMode`, `rvcCleanMode`, `rvcOperationalState`, `serviceArea`, `powerSource`) track the device through cleaning, docking, charging and fault states. It has **not** yet been tested against a physical Vis Nav, nor paired with the Apple Home app.

## Adopting upstream fixes

The Dyson protocol layer was copied from
[`matterbridge-dyson-robot`](https://github.com/thoukydides/matterbridge-dyson-robot)
with only its import paths rewritten, so upstream fixes can be taken almost
verbatim. `.upstream.json` records the revision this port is based on, and:

```
npm run upstream                 # what changed since, against the latest tag
npm run upstream -- --ref v1.12.0
npm run upstream -- --apply      # take the files this port has not touched
```

Files are sorted into two groups: those still byte-identical to upstream after
rewriting, which `--apply` updates wholesale, and those this port has since
changed, which are listed with the command to inspect the upstream diff. The
baseline is only moved by hand, once the result builds and passes its checks.

## Credits

Practically all of the hard work — reverse-engineering Dyson's cloud API and MQTT protocol — is Alexander Thoukydides'. This port reuses it under the ISC licence. If this plugin is useful to you, consider [sponsoring the original author](https://github.com/sponsors/thoukydides).

## Licence

ISC. See [LICENSE](LICENSE).

Dyson, Dyson 360 Vis Nav and MyDyson are trademarks of Dyson Technology Limited. This project is not affiliated with, endorsed by, or supported by Dyson.
