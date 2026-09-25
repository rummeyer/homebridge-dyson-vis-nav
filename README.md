<p align="center">
  <img src="https://raw.githubusercontent.com/rummeyer/homebridge-dyson-vis-nav/main/assets/icon.png" width="100" height="100" alt="">
</p>

<h1 align="center">homebridge-dyson-vis-nav</h1>

<p align="center">
  Control your <b>Dyson 360 Vis Nav</b> from the Apple Home app &mdash; as a real robot vacuum, or as a switch if it doesn't Matter.
</p>

<p align="center">
  <a href="https://github.com/rummeyer/homebridge-dyson-vis-nav/releases"><img src="https://img.shields.io/github/v/release/rummeyer/homebridge-dyson-vis-nav?label=release" alt="Release"></a>
  <a href="https://www.npmjs.com/package/homebridge-dyson-vis-nav"><img src="https://img.shields.io/npm/dt/homebridge-dyson-vis-nav" alt="Downloads"></a>
  <a href="https://github.com/rummeyer/homebridge-dyson-vis-nav/blob/main/LICENSE"><img src="https://img.shields.io/badge/licence-ISC-blue" alt="Licence"></a>
  <img src="https://img.shields.io/badge/homebridge-%E2%89%A5%202.4.0-purple" alt="Homebridge 2.4.0+">
  <img src="https://img.shields.io/badge/node-22%20%7C%2024%20%7C%2026-green" alt="Node 22, 24 or 26">
</p>

<p align="center">
  <a href="https://buymeacoffee.com/rummeyer"><img src="https://img.shields.io/badge/donate-Buy%20Me%20a%20Coffee-yellow" alt="Buy Me a Coffee"></a>
</p>

---

## What you get

Your robot appears in the Home app as a genuine **robot vacuum cleaner**, with the controls Apple provides for that device type:

- **Start, pause, resume and stop** a clean
- **Send it back to the dock**
- **Choose a cleaning mode** — Auto, Quick, Quiet or Max
- **Battery level**, charging state and low-battery warning
- **What it is doing right now** — cleaning, paused, heading for the dock, charging, docked
- **Problems, in plain language** — bin full or missing, stuck, wheels jammed, sensor obscured, and more
- **Room cleaning**, for the rooms you have mapped in the MyDyson app
- **Maps of your last 10 cleans** in the plugin's settings — see [Maps of recent cleans](#maps-of-recent-cleans)
- **Siri**: *"Hey Siri, start the vacuum"*, *"Hey Siri, send the vacuum to its dock"*

That is what you get with Matter enabled. Without it you still get a switch, a battery and a problem sensor — see [Why Matter matters](#why-matter-matters).

Everything runs through your own Homebridge. Nothing is sent anywhere except to Dyson, exactly as the MyDyson app does.

## Before you start

| | |
|---|---|
| **Robot** | Dyson 360 Vis Nav, added to your MyDyson account |
| **Homebridge** | 2.4.0 or newer |
| **Node.js** | 22, 24 or 26 |
| **Matter** | **Strongly recommended**, on the bridge the plugin runs on — see step 2. Without it the robot appears as a switch rather than as a robot vacuum |
| **Apple Home** | iOS 18.4 / iPadOS 18.4 / tvOS 18.4 or newer, on every device that should control it |

### Why Matter matters

Apple never added robot vacuums to HomeKit itself. It added them to the Home app **through Matter**, which is why this plugin asks for it.

With Matter switched off the plugin still works, but HomeKit has no robot vacuum for your robot to be, so it appears as the nearest things HomeKit does have:

- a **switch** — on starts a clean, off sends the robot back to its dock
- its **battery**, with charging state and low-battery warning
- a **problem sensor** — a contact sensor that opens when the robot needs attention, which an automation can react to

Cleaning modes, room cleaning, and pause and resume have no HomeKit equivalent, and are left out rather than bent onto a control that would mean something else. The log says which of the two you are getting, every time the plugin starts.

Homebridge 2.0 speaks Matter alongside HomeKit, so switching it on costs you nothing: your other accessories carry on exactly as before.

---

## Step 1 — Install the plugin

Open the Homebridge UI, go to **Plugins**, search for `homebridge-dyson-vis-nav`, and click **Install**.

> Newly published plugins take a while to appear in the search. If it does not come up, type the **full name** — the Homebridge UI looks anything beginning with `homebridge-` up directly, bypassing the search index.

<details>
<summary>Installing from the command line instead</summary>

Install into the directory `hb-service` uses for plugins — on a standard install that is `<storage path>/node_modules`, with the storage path usually `/var/lib/homebridge`:

```bash
sudo npm --prefix /var/lib/homebridge install homebridge-dyson-vis-nav
sudo hb-service restart
```

`hb-service add homebridge-dyson-vis-nav` works too. It does **not** accept URLs or file paths, only names from npm.
</details>

## Step 2 — Give it a child bridge with Matter

Matter has to be enabled on whichever bridge this plugin runs on. Putting the plugin in its own **child bridge** and enabling Matter there is the tidier way round: your main bridge keeps running exactly as it does today, and the robot stays isolated from your other accessories.

1. In the Homebridge UI, go to **Plugins** and open the ⋮ menu next to **Dyson 360 Vis Nav**.
2. Choose **Bridge Settings**, switch the child bridge on, and enable **Matter** for it.
3. Save, then restart Homebridge.

<details>
<summary>Enabling Matter on the main bridge instead</summary>

You can also switch Matter on globally, under **Settings** → **Matter**, and skip the child bridge. It works the same way; it just turns Matter on for the whole instance rather than for this plugin alone.
</details>

## Step 3 — Connect your MyDyson account

1. In the Homebridge UI, open the plugin's **Settings**.
2. In the **MyDyson Account** box at the top, enter the **email address** and **password** you use with the MyDyson app.
3. Click **Request code**.

   There is nothing to do in the MyDyson app itself. Dyson sends you an email titled **"Log in to your MyDyson App"** containing a short code. Check your spam folder if it does not turn up within a minute.

4. Type that code into **Auth code** and click **Submit**.

   The box collapses to **✓ Authorised** once it works, and shows how many devices were found in your account.

5. Click **Save**, then **Restart Homebridge**.

### What is stored, and where

| | |
|---|---|
| **Email address, password** | Homebridge's `config.json`, **in plain text** |
| **Access token** | the plugin's own storage, under the Homebridge storage path |
| **Your last 10 cleans** | `homebridge-dyson-vis-nav/cleans/` under the Homebridge storage path — each clean's map as Dyson's cloud returned it, about 400 kB per clean |

Credentials in `config.json` are normal for Homebridge plugins, but worth knowing: anything that can read your Homebridge configuration — including a configuration backup — can read that password.

Your password is used **only** to exchange the emailed code for an access token. From then on the plugin authenticates with the token and never reads the password again, so you can remove it:

- Once the box shows **✓ Authorised**, click **Forget password**, then **Save**.
- The plugin carries on working. Enter the password again only if you need to authorise afresh, for instance after Dyson revokes the token.

The plugin checks the token whenever you open the settings, and offers a new code by itself if Dyson has stopped accepting it.

## Step 4 — Add the robot to the Home app

The robot is **not** part of the Homebridge bridge you have already paired. Apple does not accept bridged robot vacuums, so Homebridge publishes it as a device of its own, with its own pairing code.

1. In the Homebridge log, look for a block like:

   ```
   📱 Commissioning codes for Dyson 360 Vis Nav:
      Manual Pairing Code: 1234-567-8901
   ```

   You can also find it in the Homebridge UI under **Matter**.

2. In the **Home app**: **+** → **Add Accessory** → **More options…**
3. Pick your robot from the list, or enter the pairing code by hand.
4. Choose a room and a name, and you are done.

---

## Everyday use

**Where the controls are.** Tap the tile to open the robot; the cleaning modes sit above the **Start** button. The tile itself only starts and stops.

**Cleaning modes.** Auto, Quick, Quiet and Max mirror the modes in the MyDyson app. Choosing one here sets the robot's **default** mode, the same setting the MyDyson app shows.

**Rooms with their own setting.** In the MyDyson app you can give an individual room its own cleaning strategy. Those settings live in Dyson's cloud and this plugin never changes them — so a room set to Max keeps cleaning at Max even when the default is Quick. While a clean is running, the Home app shows the mode the robot is **actually** using, not the default.

**When the robot is out of reach.** If it stops responding — off its dock in a dead spot, or the network is down — the plugin keeps showing the last state it saw for a couple of minutes, so a brief dropout does not make the tile flicker. After that it reports the robot's activity as unknown rather than claiming it is still cleaning. The wait is adjustable (**Unreachable Timeout**).

### Maps of recent cleans

Open the plugin's settings in Homebridge and switch to the **Recent Cleans** tab. It lists your last 10 cleans, newest first:

- when the clean finished
- how much floor it covered, and how long it took
- how often the robot had to recharge, if it did
- the rooms it cleaned — rooms it only drove through on the way are left out

Select a clean to see its map. It is drawn the way the Homebridge log shows it in a terminal, one character per cell:

| On the map | Means |
|---|---|
| purple → red → orange → yellow → white | cleaned floor, coloured by how much dust the robot picked up there; the brighter, the dirtier |
| dark grey | a room on your map that this clean did not cover |
| white dots | room boundaries |
| ○ | the dock |
| ‼ | where the robot reported a fault |
| faint grid | outside your map |

**Where the maps come from.** When the robot finishes a clean, the plugin asks Dyson's cloud for the clean's map — the same data the MyDyson app shows — and stores it locally, so the list keeps working when the cloud does not answer. After you install or update the plugin, it fetches the most recent clean once, so the list does not start empty. The durations of cleans stored this way are unknown and left out.

**What it needs.** The MyDyson account from [Step 3](#step-3--connect-your-mydyson-account). Without it the plugin cannot reach the maps and the list stays empty.

**Maps in the log as well.** Set **Clean Map Logging** to draw each map into the Homebridge log too. Pick *Homebridge* for the log viewer in the Homebridge UI, whose font would scramble the *Monospaced* style, and *Monospaced* for a terminal (`tail -f` over SSH). The map in the log appears shortly after the clean ends, once the plugin has fetched it.

---

## Settings

Everything below has a sensible default; you can ignore all of it.

| Setting | Default | What it does |
|---|---|---|
| **Name** | Dyson 360 Vis Nav | The name shown in the Homebridge log |
| **Serial Number Allow List** | empty | Leave empty to add every robot vacuum in your account. Add serial numbers to pick specific ones |
| **Use simple RVC Clean Mode tags** | on | Describes each cleaning mode with one tag instead of several. Turn off only if your controller needs the full set |
| **Subscribe to wildcard MQTT topic** | off | Listens to everything the robot publishes. Useful when capturing a log for a bug report |
| **Clean Map Logging** | Off | Also draws the map of each finished clean into the Homebridge log. The settings page shows the maps either way |
| **Unreachable Timeout** | 120 s | How long the robot may stay silent before the Home app is told its activity is unknown |
| **Enable debug logging** | off | Much more detail in the log |
| **Debug Features** | none | Individual extras — API headers and bodies, MQTT payloads. Turn these on only when asked to |

<details>
<summary>Editing <code>config.json</code> directly</summary>

The settings page writes this block for you; you only need it if you edit
`config.json` by hand. `platform` must read exactly as shown — it is what ties
the block to this plugin — and `dysonAccount` has to be there for the default
`"Remote Account"` method. Every key that has a default below may be left out.

```json
{
    "platform": "DysonVisNav",
    "name": "Dyson 360 Vis Nav",
    "provisioningMethod": "Remote Account",
    "dysonAccount": {
        "email": "you@example.com",
        "password": "your-mydyson-password",
        "country": "GB"
    },
    "whiteList": [],
    "simpleModeTagsRvc": true,
    "wildcardTopic": false,
    "logMapStyle": "Off",
    "unreachableTimeout": 120,
    "debug": false,
    "debugFeatures": []
}
```

| Key | Type | Default | What it does |
|---|---|---|---|
| `platform` | string | — | Must be `"DysonVisNav"`. The only required key |
| `name` | string | `"Dyson 360 Vis Nav"` | Name shown in the Homebridge log |
| `provisioningMethod` | string | `"Remote Account"` | `"Remote Account"` uses your MyDyson account. `"Mock Devices"` replays a recorded MQTT session instead, for development — see [CONTRIBUTING.md](https://github.com/rummeyer/homebridge-dyson-vis-nav/blob/main/CONTRIBUTING.md) |
| `dysonAccount` | object | — | The MyDyson account to read devices from; see below |
| `whiteList` | string[] | `[]` | Serial numbers to expose. Empty exposes every robot vacuum in the account |
| `simpleModeTagsRvc` | boolean | `true` | Advertise one Matter clean-mode tag per cleaning mode instead of the full set. Turn off only if your controller needs all of them |
| `wildcardTopic` | boolean | `false` | Subscribe to every MQTT topic the robot publishes. Useful when capturing a log for a bug report |
| `logMapStyle` | string | `"Off"` | Draw a map of each finished clean into the log: `"Off"`, `"Monospaced"` for a terminal, or `"Homebridge"` for the log viewer |
| `unreachableTimeout` | integer | `120` | Seconds the robot may stay silent before Apple Home is told its activity is unknown. Between 10 and 3600 |
| `debug` | boolean | `false` | Much more detail in the log |
| `debugFeatures` | string[] | `[]` | Individual extras, any of `"Log API Headers"`, `"Log API Bodies"`, `"Log MQTT Client"`, `"Log MQTT Payloads"`, `"Log MQTT Payloads as JSON"`, `"Log Serial Numbers"`, `"Log Debug as Info"` |

**Inside `dysonAccount`:**

| Key | Type | Default | What it does |
|---|---|---|---|
| `email` | string | — | The address your MyDyson account uses. It also keys the stored access token |
| `password` | string | — | Optional. Used **only** to exchange the emailed code for a token, so it can be removed afterwards — see [What is stored, and where](#what-is-stored-and-where) |
| `country` | string | `"GB"` | Two-letter code for the country your MyDyson account belongs to |
| `token` | string | — | Optional. Supply an access token yourself instead of authorising through the settings page. It takes precedence over the stored one |

A key the plugin does not know is ignored, with a warning in the log naming it,
so a typo is visible rather than silently ineffective.

`country` selects the Dyson server — mainland China has its own — and the
language that per-device requests ask for. Configurations from before this field
are migrated on startup: a `"china": true` flag becomes `"CN"`, and anything else
becomes `"GB"`.
</details>

---

## If something goes wrong

**The plugin warns about Matter and publishes a switch.**
Matter is not switched on for the bridge this plugin runs on, so the robot is published as a switch, a battery and a problem sensor rather than as a robot vacuum. Go back to step 2 — note that enabling it on the main bridge does not enable it for a plugin sitting in a child bridge, or the other way round.

**The switch disappeared after I enabled Matter.**
That is deliberate. With Matter on, the robot is published as its own Matter accessory, and the switch it replaces is removed so that one robot does not leave you with two tiles. The Matter accessory has its own pairing code — see step 4.

**The robot does not appear in the Home app.**
It has its own pairing code and is not part of your Homebridge bridge — see step 4. Adding the Homebridge bridge again will not bring it in.

**No email arrives after *Request code*.**
Check your spam folder, and that the email address matches your MyDyson account exactly. If the settings page shows a red message, its wording says whether Dyson refused the request or the plugin failed before reaching them.

**"Too many requests" when requesting a code.**
Dyson rate-limits this. Your earlier request is still valid — use the code from the most recent email rather than asking for another.

**The tile says the robot is cleaning when it is not.**
It stopped responding while cleaning. After **Unreachable Timeout** the plugin reports its activity as unknown. Lower the value if two minutes feels long.

**It cleans at full power even though a gentler mode is set.**
A room can carry its own cleaning strategy, set in the MyDyson app, which overrides the default for that room. Change it there.

**Anything else.**
Switch on **Enable debug logging**, reproduce the problem, and [open an issue](https://github.com/rummeyer/homebridge-dyson-vis-nav/issues) with the log. If it concerns the robot's behaviour rather than the plugin's, add **Log MQTT Payloads as JSON** under Debug Features — that is what makes such reports diagnosable.

---

## Good to know

**Cloud only.** Unlike the older 360 Eye and 360 Heurist, the Vis Nav does not accept local connections. Everything goes through Dyson's gateway, the same route the MyDyson app takes, so the robot needs internet access and so does Homebridge.

**Matter events are not sent.** Homebridge 2.4.0 has no way to emit them, so error and completion events are written to the log instead. The matching *attributes* are updated normally, and those are what the Home app reads — so you will not notice this in use.

**Reachability.** Matter carries this on a cluster that Homebridge's plugin API cannot address, so an unresponsive robot is conveyed through its operational state instead, as described above.

---

## For developers

Architecture, how to adopt upstream fixes, the build-time checks, running against
a recorded session, and the Homebridge settings-UI pitfalls this project ran into
are all in **[CONTRIBUTING.md](https://github.com/rummeyer/homebridge-dyson-vis-nav/blob/main/CONTRIBUTING.md)**.

---

## Credits

The hard part — reverse-engineering Dyson's cloud API and MQTT protocol — is the
work of [Alexander Thoukydides](https://github.com/thoukydides) in
[`matterbridge-dyson-robot`](https://github.com/thoukydides/matterbridge-dyson-robot).
This plugin carries that work over to Homebridge under the ISC licence. If it is
useful to you, please consider [sponsoring him](https://github.com/sponsors/thoukydides).

## Licence

ISC — see [LICENSE](https://github.com/rummeyer/homebridge-dyson-vis-nav/blob/main/LICENSE).

Dyson, Dyson 360 Vis Nav and MyDyson are trademarks of Dyson Technology Limited.
This project is not affiliated with, endorsed by, or supported by Dyson. Apple,
HomeKit, Siri and Apple Home are trademarks of Apple Inc.
