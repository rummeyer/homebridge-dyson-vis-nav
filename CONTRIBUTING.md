# Developing homebridge-dyson-vis-nav

Everything a maintainer needs that a user does not. For installing and using the
plugin, see the [README](README.md).

## Contents

- [How the code is arranged](#how-the-code-is-arranged)
- [Taking fixes from upstream](#taking-fixes-from-upstream)
- [Build, lint and checks](#build-lint-and-checks)
- [Running without hardware](#running-without-hardware)
- [Testing against a real Homebridge](#testing-against-a-real-homebridge)
- [Homebridge settings UI: what bites](#homebridge-settings-ui-what-bites)
- [Releasing](#releasing)

---

## How the code is arranged

This plugin is a port of
[`matterbridge-dyson-robot`](https://github.com/thoukydides/matterbridge-dyson-robot),
narrowed to the Dyson 360 Vis Nav and rebuilt on the Matter support added in
Homebridge 2.0. Two layers, with very different rules:

### The Dyson layer — carried over, keep it that way

Cloud API, MQTT client and parsing, message and state types, fault mapping, zone
handling, map rendering. These files were copied from upstream with **only their
import paths rewritten**:

| Upstream | Here |
|---|---|
| `matterbridge/logger` | `./logger.js` |
| `matterbridge/matter/clusters` | `./matter-clusters.js` |
| `MaybePromise` from `matterbridge/matter` | `./utils.js` |
| `CommonAreaNamespaceTag` from `matterbridge/matter` | `./matter-clusters.js` |

Most of them are still **byte-identical to upstream** after those rewrites, which
is what makes [upstream fixes](#taking-fixes-from-upstream) cheap to adopt. Resist
tidying them. A gratuitous change turns a file from "apply upstream wholesale"
into "merge by hand, forever".

Where a change is genuinely warranted, make it deliberately and say why in the
commit — the sync tool will flag the file from then on, which is correct.

### The Matter layer — written for this plugin

`matter-360.ts`, `matter-360-modes.ts`, `matter-clusters.ts`, `platform.ts`,
`index.ts`, the custom UI. Matterbridge builds an endpoint imperatively from
matter.js behaviors; Homebridge takes a declarative accessory descriptor and
applies later changes through `updateAccessoryState`. So cluster construction and
updates are split, and command handlers signal failure by **throwing** Matter
protocol errors rather than returning response structs.

`matter-clusters.ts` holds the Matter enumerations and struct types this plugin
uses, with values from the specification cross-checked against `@matter/main`
0.17.9. It exists so matter.js is **not** a dependency here: Homebridge owns that
dependency, and a second copy resolved through this plugin could drift from the
one actually running. Homebridge's own cluster state interfaces type every
enumerated attribute as a plain `number`, so nothing more is needed.

### Deliberate deviations from upstream

- **Scope**: air treatment devices and the three local provisioning methods are
  dropped. The Vis Nav accepts only cloud connections.
- **`reportedPowerLevel`** in `dyson-device-360-base.ts` reports the *running*
  cleaning strategy during a clean rather than the configured default, because a
  Vis Nav zone can carry its own strategy. Upstream reports the default.
- **Unreachable handling**: upstream writes `reachable` on the node's Basic
  Information cluster. Homebridge's plugin API cannot address the node, only the
  device endpoint, so that write fails with *"Behavior basicInformation is not
  present on this endpoint"*. An unresponsive robot is conveyed through the
  operational state after a grace period instead.
- **Matter events** are not emitted at all: Homebridge 2.4.0 exposes no API for
  them. The corresponding attributes are updated normally.
- **No `DYSON_TOKEN` environment variable.** Upstream seeds an account token from
  one in `DEFAULT_CONFIG`, for its own integration testing. An undocumented
  environment variable that silently supplies credentials is worth removing
  rather than explaining — Homebridge's verification bot flags it for manual
  security review, and it has no purpose here. Do not let a sync bring it back.

---

## Taking fixes from upstream

The Dyson protocol layer is carried over from
[`matterbridge-dyson-robot`](https://github.com/thoukydides/matterbridge-dyson-robot)
with only its import paths rewritten — see
[How the code is arranged](#how-the-code-is-arranged) for why those files must
stay that way. Applying the same rewrites to a newer upstream revision therefore
reproduces what this plugin should contain, which is what this tool does.

`.upstream.json` records the revision this port is based on, the import rewrites,
and which files are tracked.

```bash
npm run upstream                    # what changed since the baseline
npm run upstream -- --ref v1.12.0   # against a specific ref
npm run upstream -- --apply         # take the files this port has not touched
npm run upstream -- --diff dyson-mqtt.ts
```

The tool clones upstream into `.upstream-cache/` (gitignored), applies the same
rewrites to the newer revision, and sorts every tracked file into:

- **Changed upstream, untouched here** — still byte-identical to upstream after
  rewriting, so `--apply` replaces it wholesale, keeping this repo's file header.
- **Changed upstream, changed here too** — listed with the `git diff` command to
  inspect the upstream change and apply the relevant part by hand.
- **Gone** — no longer upstream, or never carried here.

`--apply` never touches a diverged file and never moves the baseline. Moving it
is a deliberate commit:

1. `npm run upstream -- --apply`
2. Work through anything listed as diverged, using the `git diff` command it
   prints for each
3. `npm run build && npm run lint`
4. `npm run check-session` — replays the recorded robot session through the
   layer you just changed, which is the point of having it
5. Set `baseline` in `.upstream.json` to the new ref, and commit the lot with a
   note of which upstream release it came from

Nothing here is automatic on purpose: an upstream change can be a fix, or it can
be support for a device this plugin does not carry. Read what `--diff` shows
before taking it.

### Keeping the rewrites honest

`rewrites` in `.upstream.json` must mirror exactly what was done when porting.
If it drifts, files look diverged when they are not, and the tool quietly stops
being useful — the failure is silent, so check the count of "untouched" files
looks plausible after a sync.

---

## Build, lint and checks

```bash
npm install
npm run build     # checkers, tsc, then the three checks below
npm run lint
```

`npm run build` runs three checks beyond the compiler. Each covers a part of a
Homebridge plugin that no compiler or linter can see, and each was written
*after* the bug it covers had already reached a user:

| Check | Covers |
|---|---|
| `check-plugin-layout` | `customUi` flag, `customUiPath` resolution, `showSchemaForm()` call, `singular`, every schema property present in the layout, hidden entries wrapped and silent, UI endpoints served, `files[]` shipping the UI |
| `check-ui-auth-config` | every plugin setting the Dyson cloud client reads is provided by the config the custom UI hands it |
| `check-ui-server` | the custom UI's `server.js` starts as a forked child and signals `ready` |

`bin/check-recorded-session.mjs` is separate, because it takes about a minute:
it replays `mqtt-logs/277.jsonl` through the ported Dyson layer and checks the
device reaches every state it is known to reach, with nothing logged as a warning
or an error. Run it after adopting an upstream change. It is not a payload
validator — a single altered field in the recording can pass unnoticed, since a
rejected message just leaves the previous status in place.

CI (`.github/workflows/build.yml`) runs the build, the lint and that replay on
Node 22, 24 and 26 — the versions in `engines.node`. Keep the matrix in step with
that field; verification requires the plugin to run on every supported LTS.

**When adding to the settings page, extend these rather than reasoning about how
the form renders.** The rendering is not observable from here, and every attempt
to reason about it in this project produced a wrong answer at least once.

A check that does not fail against the bug it covers is worthless. Verify each
new one by reintroducing the fault and watching it trip.

---

## Running without hardware

`mqtt-logs/277.jsonl` is a recorded Vis Nav MQTT session, from upstream's
regression tests. Replaying it exercises the whole state machine — cleaning,
docking, charging, mode changes, faults — with no robot and no MyDyson account.

Mock mode is deliberately **absent from the settings UI**, so write it into
`config.json` by hand. Saving from the UI afterwards drops the `devices` block,
since the form does not know it:

```json
{
    "platform": "DysonVisNav",
    "provisioningMethod": "Mock Devices",
    "unreachableTimeout": 15,
    "devices": [{
        "name": "Vis Nav Test",
        "serialNumber": "ABC-EU-TEST0001",
        "rootTopic": "277",
        "filename": "/absolute/path/to/mqtt-logs/277.jsonl"
    }]
}
```

The mock client never disconnects, so it does **not** exercise the unreachable
path. Test that logic directly against `trackReachability` and
`mapOperationalState` instead.

---

## Testing against a real Homebridge

```bash
node node_modules/homebridge/bin/homebridge -U /path/to/test-config-dir -P "$(dirname $PWD)" -D
```

`-P` points at the directory *containing* the plugin directory. The test config
needs `bridge.matter` with `enabled: true`, a `uniqueId`, and ports that do not
clash with anything else on the machine.

What to look for:

```
✓ External Matter accessory published: Vis Nav Test on port 5530
RVC Operational State: Docked (66) → Running (1) → SeekingCharger (64) → Charging (65)
Battery status: 100%, Ok (0), Active (1), and IsAtFullCharge (2)
```

Leaving `bridge.matter` out, or setting `enabled: false`, exercises the other
half: the robot is then published over HAP as a switch, a battery and a problem
sensor. What to look for:

```
Matter is not enabled for this Homebridge bridge.
Published Vis Nav Test to Homebridge as a HomeKit switch, battery and problem sensor
Switch: On (Cleaning (1))
Problem: DustBinMissing (66): Bin missing or not detected
```

Restarting with the same config must log `Restored ... from the Homebridge
cache` and leave a single entry in `<config dir>/accessories/cachedAccessories`
— a second entry means the accessory was republished rather than adopted, which
in a real installation costs the user its room and automations. Enabling Matter
afterwards must log `Removing HomeKit accessory no longer published by this
plugin` and empty that file again.

Two traps that cost real time:

- A stale Homebridge process **renames itself to plain `homebridge`**, so
  `pkill -f "homebridge/bin/homebridge"` misses it and the next run dies on
  `EADDRINUSE`. Match `homebridge`, and check with `lsof -nP -iTCP:<port>`.
- `registerPlatformAccessories` resolving does **not** mean the accessory
  published. External accessories publish asynchronously; grep the log for
  `External Matter accessory published` or `Behaviors have errors`.

---

## Homebridge settings UI: what bites

Collected the hard way. All are now asserted by `check-plugin-layout`.

| Requirement | What happens otherwise |
|---|---|
| `"customUi": true` in `config.schema.json` | The UI ignores the custom UI entirely and shows only the generated form. `customUiPath` alone just relocates the directory — it enables nothing |
| Call `homebridge.showSchemaForm()` | A custom UI *replaces* the generated form, so the plugin's own settings are unreachable |
| Custom UI server imports in `dependencies` | A devDependency resolves locally but is absent after install. The forked process dies on the import, never signals `ready`, and the page spins forever — with no error in the Homebridge log or the browser |
| Every schema property present in `layout` | Absent ones still enter the form model and are validated there. One the user cannot reach leaves *"config validation failed"* next to Save, naming nothing |
| No required sub-fields inside a `condition`-hidden fieldset | Same, and even harder to spot |
| Hidden entries wrapped in `htmlClass: "d-none"` | `"type": "hidden"` hides only the input. The label still renders, and with no title the form derives one from the key — `provisioningMethod` becomes "Provisioning Method". `notitle` is not honoured |

---

## Releasing

Homebridge's verified-plugin requirements include a GitHub release with notes for
each version, so this is not optional housekeeping.

1. Bump `version` in `package.json`, and the two `version` fields in
   `package-lock.json` to match
2. `npm run build && npm run lint`
3. Commit, `git tag -a vX.Y.Z`, push both
4. `npm pack`, then `gh release create vX.Y.Z <tarball> --title … --notes …`

Creating the release publishes to npm by itself — see below.

Attach the tarball to the GitHub release as well as publishing to npm: the
release notes are a verification requirement, and a prebuilt tarball lets anyone
install a specific version without npm. Write the notes for whoever hits the
bug, not for the person who fixed it — symptom first, then cause.

### Publishing

Publishing happens in GitHub Actions, not from a laptop. Creating the GitHub
release triggers `.github/workflows/publish.yml`, which uses **npm trusted
publishing**: GitHub mints a short-lived OIDC token for that run and npm accepts
it instead of credentials. No token is stored anywhere, and no one-time password
has to be typed.

That last part is the reason it exists. This npm account is secured with a
passkey, and a passkey cannot be presented from a terminal — a manual publish
therefore needs a browser round trip, and the authentication URL is redacted as
a secret in some terminals, including Claude Code's.

**One-time setup on npmjs.com**, without which the workflow fails rather than
falling back to anything weaker:

1. npmjs.com → the package → **Settings** → **Trusted publisher**
2. Provider **GitHub Actions**, organisation/user `rummeyer`,
   repository `homebridge-dyson-vis-nav`, workflow `publish.yml`,
   environment left blank

The workflow refuses to publish when the release tag and `package.json` version
disagree: the wrong version under the right name cannot be taken back.

#### Publishing by hand, if it ever comes to that

Run it in a plain terminal so the authentication URL is visible, and note that
the system `npm` here is 8.5.0 from a Node 16 install — prepending the npx Node
22 directory to `PATH` swaps only `node`, since the `node` package ships no
`npm`:

```bash
export PATH="$(ls -d ~/.npm/_npx/*/node_modules/node/bin | head -1):$PATH"
npx --yes npm@latest publish
```

#### Why the build runs twice

`prepublishOnly` and `prepare` both build. That is deliberate: `prepare` is what
makes a `github:` install work, and `prepublishOnly` is what guarantees lint
passes before an upload. Reordering them to save the duplicate risks linting
before the generated type checkers exist, which is a worse trade than a few
seconds.

