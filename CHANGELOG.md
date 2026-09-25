# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Everything up to and including 1.0.1 was written after the fact, reconstructed
from the commits each release contained. Entries describe what changed for someone using
the plugin; the reasoning behind each one is in the commit it came from.

## [Unreleased]

## [1.1.0] — 2026-09-25

### Added

- **Maps of your last 10 cleans, on a Recent Cleans tab in the plugin's
  settings.** Select a clean to see its map in colour, drawn the way the log's
  monospaced map looks in a terminal, next to when it finished, the area, how
  long it took and the rooms it cleaned. The plugin stores each clean under the Homebridge storage path
  when the robot finishes it, so the list works while Dyson's cloud is
  unreachable. After an update, it fetches the most recent clean once so the
  list does not start empty. The raw cloud data is kept alongside each map, so
  the map can later be drawn differently without losing earlier cleans. Needs
  the MyDyson account.

### Changed

- **With Clean Map Logging off, the log still says how much was cleaned.**
  The plugin now fetches every finished clean to store it, so the area and the
  number of charges appear in the log whatever the setting; only the map
  itself stays out of the log.

## [1.0.6] — 2026-09-23

### Changed

- **The README shows the npm download count and a Buy Me a Coffee badge**,
  instead of three donate badges. GitHub Sponsors, PayPal and Buy Me a Coffee
  all stay in `package.json` and `.github/FUNDING.yml`. No behaviour changes.

## [1.0.5] — 2026-09-23

### Added

- **A Buy Me a Coffee funding link** (buymeacoffee.com/rummeyer), next to
  GitHub Sponsors and PayPal in `package.json` and `.github/FUNDING.yml`. No
  behaviour changes.

## [1.0.4] — 2026-09-21

### Removed

- **A development fixture from the published package.** `mqtt-logs/` is a
  recorded MQTT session used by the test that replays it, and that test is in
  `bin/`, which was never published — so every installation carried 143 kB it
  had no way to use. The package is now 18% smaller. Replaying the session from
  a clone is unaffected.
- **`ws` as a direct dependency.** Nothing in this plugin imports it; the MQTT
  connection is made by `mqtt`, which declares its own copy and still resolves
  the same version. One fewer top-level package on install.
- **An unused `getDysonAccount()`**, dead since the original port — upstream
  calls it from the platform, this plugin authorises through the settings UI
  instead and never did.
- **The `watch` script**, which invoked a `nodemon` that was in no dependency
  list and had no configuration, so it could not run on a fresh clone. The
  development loop documented in `CONTRIBUTING.md` is unaffected.

## [1.0.3] — 2026-09-21

### Changed

- **Documented every `config.json` setting** in the README. The reference there
  listed only a handful of keys and explained just one of them; it now gives the
  type, default and meaning of each, including the values `logMapStyle` and
  `debugFeatures` accept, the range `unreachableTimeout` is held to, and the
  `dysonAccount` fields — among them `token`, which the settings schema has
  always accepted without saying so anywhere.
- **The settings page points at the right file** for mock devices. Its footer
  sent you to the README, where they have never been described; they are in
  `CONTRIBUTING.md`, which the footer now links to directly.

## [1.0.2] — 2026-09-21

### Added

- **This changelog**, reconstructed from the commits behind the twenty-one
  releases that came before it, and shipped in the npm package.

## [1.0.1] — 2026-09-21

### Changed

- **Funding links**: GitHub Sponsors and PayPal, in `package.json` where npm and
  the Homebridge UI read them, and in `.github/FUNDING.yml` for the Sponsor
  button on the repository page. No behaviour changes.

## [1.0.0] — 2026-09-18

### Added

- **A HomeKit switch when Matter is off.** A bridge without Matter enabled used
  to get an error in the log and nothing else — a robot vacuum has no HomeKit
  equivalent, so the plugin refused to pretend otherwise, which left anyone who
  could not enable Matter with a plugin that did nothing at all. It now
  publishes what HomeKit can represent: a switch that starts a clean and sends
  the robot back to its dock, the battery, and a contact sensor for a robot that
  needs attention.
- **`supports-hap` alongside `supports-matter`**, since both transports are now
  used.

### Changed

- Cleaning modes, zones and pause/resume are left out of the HomeKit accessory
  rather than bent onto a control that would mean something else.
- Cached HomeKit accessories are adopted rather than republished: their
  identifier is what ties a robot to its room and its automations. Stale ones
  are removed, except after a device failure — a cloud outage must not cost you
  an accessory.

## [0.4.2] — 2026-09-17

### Changed

- **A country code replaces the China flag.** The flag could only say which of
  two hosts to use, while the country is needed in three places: the API host,
  the country the ownership endpoint asks for, and the culture the cleaning
  history asks for. The last two were hardcoded to `GB` regardless of the
  account. Existing configurations are migrated before anything validates them —
  `china: true` becomes `CN`, anything else `GB` — and a missing country
  defaults rather than failing validation.

## [0.4.1] — 2026-09-17

### Removed

- **An undocumented environment variable that supplied credentials.**
  `DYSON_TOKEN`, carried over from upstream where it seeds a token for
  integration testing, was flagged by Homebridge's verification bot. Nothing
  here used it and nothing documented it, so it is gone. The authorisation flow
  in the settings UI is the one documented way in, and its token lives in the
  plugin's own storage.

## [0.4.0] — 2026-09-17

### Fixed

- **Two Homebridge verification checks this plugin was failing.** `package.json`
  declared no transport, where the bot requires `supports-matter` or
  `supports-hap`; and `config.schema.json` carried `"required": true` on a
  property, an older form-library convention that is not valid JSON Schema.

## [0.3.4] — 2026-09-17

### Changed

- **Setup recommends a child bridge for Matter** rather than enabling it for the
  whole of Homebridge. It works as well and leaves the main bridge alone.
  Installing now comes first, since bridge settings only exist for an installed
  plugin.

## [0.3.3] — 2026-09-16

### Added

- **CI across every supported Node version.** The build compiles, lints and
  replays a recorded Vis Nav session on Node 22, 24 and 26, so the versions
  `package.json` claims are demonstrated rather than asserted.

## [0.3.2] — 2026-09-16

### Fixed

- **The repository showed no licence.** The ISC wording carried over from
  upstream uses the © symbol and its own line wrapping, which GitHub's matcher
  does not recognise. Both copyright holders are kept; only the wording changes.

## [0.3.1] — 2026-09-16

### Changed

- **Installation points at npm**, through the Homebridge UI's plugin search or
  `hb-service`, now that the package is published. The README previously had
  people install a release tarball by hand.

## [0.3.0] — 2026-09-16

### Added

- **The MyDyson password is now optional.** It is read in exactly one place —
  exchanging the emailed code for a token — and the token is held separately, so
  the settings box offers *Forget password* once an account is authorised.

### Fixed

- **The README claimed the password is not stored. It is.** The settings form
  writes it to `config.json` in plain text, like any Homebridge plugin that takes
  credentials. That is now stated in a table of what goes where, rather than
  implied otherwise — it is the kind of claim someone might reasonably decide
  something on.

## [0.2.5] — 2026-09-16

### Changed

- Developer documentation moves to `CONTRIBUTING.md`: the upstream sync
  procedure, the deliberate deviations from upstream, and the settings-UI traps.

## [0.2.4] — 2026-09-16

### Fixed

- **Hidden settings appeared as fields named Email, Password, China, Token and
  Provisioning Method.** With no title set the form derives a label from the
  property key, and nothing reliably suppresses it. They are now wrapped in a
  section the form cannot render.

## [0.2.3] — 2026-09-16

### Fixed

- **Stray prose under the settings form**, describing fields nobody can see. The
  entries added to keep the form valid suppress only the input control; the form
  still rendered the title and description of the property behind each one.

## [0.2.2] — 2026-09-16

### Fixed

- **"Config validation failed" next to Save**, from two constructs that could
  hold the form invalid without showing anything to correct: a mock-device array
  whose required sub-fields sat inside a hidden fieldset, and a free-text control
  for a property constrained to an enum. Mock mode leaves the form entirely and
  is set by hand in `config.json`.

## [0.2.1] — 2026-09-16

### Removed

- **The block list.** A single allow list covers the intent — expose one robot
  and ignore the rest — and two lists with precedence between them was more
  mechanism than the job needs.

## [0.2.0] — 2026-09-16

### Added

- **A robot that stops responding is reported as unknown activity.** The
  accessory kept whatever state it last saw, so a robot that went offline
  mid-clean showed as cleaning forever with nothing to end it. After a
  configurable grace period (`unreachableTimeout`, 120 s) the activity is
  reported as an error instead of stale motion; the grace period keeps brief
  dropouts from flickering.

### Removed

- `statusPollInterval`, which this plugin never read. It existed for a device
  class dropped when the scope narrowed to the Vis Nav, so it was a control that
  did nothing.

## [0.1.4] — 2026-09-16

### Changed

- **The MyDyson fields and the code request sit in one box.** The authorisation
  steps used to sit above the generated form while the account fields sat inside
  it, so requesting a code meant filling in one part of the page and acting in
  another.

## [0.1.3] — 2026-09-16

### Fixed

- **The settings page hung on a spinner.** `@homebridge/plugin-ui-utils` is
  imported by the custom UI server, which runs on the user's machine, but it was
  declared as a development dependency — so after a normal install it was absent
  and the process died on the import, with nothing shown in the UI or the
  Homebridge log.

## [0.1.2] — 2026-09-16

### Fixed

- **The MyDyson authorisation steps never appeared.** The Homebridge UI opens a
  plugin's custom UI only when the config schema sets `customUi` to true;
  `customUiPath` alone only relocates the directory, so the UI fell back to the
  generated form.

## [0.1.1] — 2026-09-16

### Fixed

- **The settings page showed the authorisation steps with no fields to fill in.**
  The custom UI replaces the generated form rather than appearing beside it, and
  never called `showSchemaForm()` — so the MyDyson email and password the steps
  depend on were nowhere on the page, and *Request code* could never do anything.

## [0.1.0] — 2026-09-16

First release. Exposes the Dyson 360 Vis Nav (RB03) to Apple Home as a native
Matter robot vacuum cleaner, using the Matter support added in Homebridge 2.0.
HAP has no robot vacuum service, so Matter was required rather than optional.

The Dyson protocol layer is ported essentially unchanged from
[matterbridge-dyson-robot](https://github.com/thoukydides/matterbridge-dyson-robot)
(ISC, Alexander Thoukydides): cloud API, MQTT client and parsing, state and
fault mapping, zone handling and map rendering. The Matter layer is new, since
Homebridge takes a declarative accessory descriptor where Matterbridge builds an
endpoint imperatively.

Verified end to end by replaying a recorded Vis Nav MQTT session: the accessory
publishes as a standalone Matter node and all five clusters track the device
through cleaning, docking, charging and fault states.

[Unreleased]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v1.0.6...v1.1.0
[1.0.6]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v0.4.2...v1.0.0
[0.4.2]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v0.3.4...v0.4.0
[0.3.4]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v0.2.5...v0.3.0
[0.2.5]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v0.1.4...v0.2.0
[0.1.4]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/rummeyer/homebridge-dyson-vis-nav/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rummeyer/homebridge-dyson-vis-nav/releases/tag/v0.1.0
