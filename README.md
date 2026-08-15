# Screen Dimmer

A small desktop app that dims your screens below Windows' native 0% brightness floor — useful for laptop panels and external monitors that are still too bright even at minimum. Unlike similar tools, it works correctly across multiple monitors: each screen gets its own independent overlay.

## Features

- Dim each display independently below Windows' 0% brightness using a per-screen overlay
- Correctly detects and handles multiple monitors (up to 6), each positioned and sized from the OS's own monitor info — no more "only the first screen works"
- Rename each display to whatever makes sense to you
- **Identify** button flashes a number on each screen so you know which is which
- Link displays together so one slider controls several screens at once
- Lives in the system tray; choose whether closing the window minimizes to tray or quits the app
- Optional start with Windows

## For users: just run the app

Grab the latest installer from [Releases](https://github.com/AiintNoWayy/screen-dimmer/releases), run it, and you're set. No Node.js or Rust needed to just use the app.

## For developers: build from source

### Requirements

- [Node.js](https://nodejs.org/) 18 or newer
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- On Windows, [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (preinstalled on most Windows 10/11 systems)

### Setup

```bash
git clone https://github.com/AiintNoWayy/screen-dimmer.git
cd screen-dimmer
npm install
```

Run in development mode (hot-reloads on save):
```bash
npm run tauri dev
```

Or build a standalone installer:
```bash
npm run tauri build
```
The installer lands in `src-tauri/target/release/bundle/` (`.msi` and `.exe` on Windows).

## Usage

Open the app, use the **Dimmer** tab's sliders to dim each screen below Windows' own minimum brightness, and hit **Identify** if you're not sure which card matches which physical screen. Check the **Link** box on two or more displays to have them follow the same slider together. The **Options** tab controls whether closing the window minimizes to the tray or quits, and whether the app starts with Windows.

## License

MIT. See [LICENSE](LICENSE).

## Credits

Built by [AiintNoWayy](https://github.com/AiintNoWayy).
