# graze-tune

A Windows gaming and latency optimizer. It audits what other tweak tools left behind, applies tweaks with a full undo log, and lets you benchmark before and after.

- **Audit first.** Reads registry, services, boot config, power plan, scheduled tasks and NVIDIA driver profiles, and flags leftovers from OptimizerDuck, EXM, Stix, Paragon and others as harmful, conflicting, placebo or worth keeping. Nothing is written until you choose an action.
- **Every change is reversible.** Old values are written to a write-ahead undo log (`%APPDATA%\dev.lainarchive.grazetune\undo-log.json`) before anything changes, a restore point is made per batch, and Changes has a one-click revert of everything.
- **Modules:** CPU & scheduler, timers, interrupts & MSI mode, memory, storage, NVIDIA driver profiles (Profile Inspector-style, with .nip import/export), NVIDIA hardware, display path, input, audio, network, services, background, Windows UI, privacy, security tradeoffs (opt-in), BIOS guide.
- **Benchmarks:** PresentMon frametimes (avg, 1% and 0.1% lows), TCP ping and jitter, timer resolution.
- **No drivers.** No kernel drivers, memory patching or anything anti-cheat could object to.

## Layout

| Path | What |
| --- | --- |
| `crates/engine` | Rust engine: tweak catalog (`catalog/*.toml`), undo log, audit, .nip parser, benchmark math, Windows backends (`src/windows`) |
| `src-tauri` | Tauri 2 shell and commands; runs elevated |
| `src` | React + shadcn/ui frontend. In a normal browser it runs against an in-memory sample PC |

## Develop

```sh
npm install
npm run dev                 # browser preview with sample data
npx tauri dev               # real app (Windows, elevated terminal)
cargo test --workspace
npx tauri build --config src-tauri/tauri.unsigned.conf.json   # unsigned NSIS installer in target/release/bundle/nsis
```

## Releases and updates

Bump the version in `src-tauri/tauri.conf.json` and `Cargo.toml`, then push a `vX.Y.Z` tag. The Release workflow publishes the signed installer and `latest.json` to the [Releases page](https://github.com/lainarchive/graze-tune/releases). Installed copies can check for updates from **Settings > Updates**. The repository needs the `TAURI_SIGNING_PRIVATE_KEY` Actions secret.

Frametime capture needs `PresentMon.exe` (Intel PresentMon 2.x console build) in `resources/`.

After editing `crates/engine/catalog/*.toml`, refresh the browser preview data:

```sh
cargo run -p graze-engine --example export_catalog > src/data/catalog.json
```

## Credits

Many catalog entries were picked using [OptimizerDuck](https://github.com/itsfatduck/optimizerDuck) (GPL-3.0) as a reference for which settings to cover. No OptimizerDuck code or text is included; the entries and their descriptions are written for graze-tune.
