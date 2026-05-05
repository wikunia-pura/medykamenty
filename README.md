# Cutis

Desktop app for planning cosmetics production: stock import from MP Firma, shortage report
grouped by supplier, RFQ email generator, cost calculator. Electron + React + TypeScript.

## Development

```bash
npm install
npm run dev
```

`npm run dev` builds the main process, starts the Vite dev server on port 3000, and launches
Electron once the dev server is ready.

To enable AI-assisted features locally, copy `config/ai-config.template.yml` to
`config/ai-config.yml` and add your Anthropic API key. The runtime file is gitignored. In CI,
the file is generated from a GitHub Actions secret before packaging.

## Building installers locally

```bash
npm run package:mac     # creates release/Cutis-<version>-arm64.dmg + zip
npm run package:win     # creates release/Cutis-Setup-<version>.exe
```

## First launch on macOS

The app uses ad-hoc signing (no Apple Developer ID), so the first launch is blocked by
Gatekeeper. To unblock:

1. Drag `Cutis.app` from the DMG into `/Applications`.
2. Double-click `Zainstaluj.command` from the same DMG. If macOS blocks the script,
   right-click → Open → Open. The script runs `xattr -cr /Applications/Cutis.app`.
3. Launch Cutis normally.

Alternative: in Terminal, run `xattr -cr /Applications/Cutis.app` directly.

## Releases

Tag a commit with `v*` (e.g. `v0.1.0`) and push. GitHub Actions builds installers for macOS
and Windows in parallel and creates a GitHub Release with the artifacts. Auto-update via
`electron-updater` then picks the new version up on next launch.
