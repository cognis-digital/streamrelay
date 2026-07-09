# streamrelay

A self-hosted livestream **relay control plane**. Declare an input source and
one or more RTMP/SRT/HLS outputs in a JSON config; `streamrelay`:

- **validates** the config (structural + combination checks, with warnings),
- **plans** the exact `ffmpeg` command(s) to relay input → outputs, and
- **manages** relay sessions — start / stop / restart / status / logs.

The whole control plane drives `ffmpeg` through an **injectable process runner**,
so every part of it is unit-tested without `ffmpeg`, a network, or live
processes. `ffmpeg` is the *only* external runtime requirement.

- **Maintainer:** Cognis Digital
- **License:** COCL 1.0
- **Runtime deps:** none (Node standard library only; TypeScript is a dev dep)

## Why

Restreaming to multiple destinations is "just" `ffmpeg` plumbing — but the
plumbing is fiddly and easy to get subtly wrong: per-output codecs, bitrates,
resolutions, containers, reconnect flags, and the difference between a cheap
pure stream-copy fan-out (one `tee` muxer, no re-encode) and a transcoding
fan-out (multiple mapped outputs from one decode). streamrelay turns a
declarative, validated config into the *correct* command and keeps track of
which relays are running — so you version-control the intent, not a pile of
brittle shell one-liners.

## Install

```bash
git clone https://github.com/cognis-digital/streamrelay
cd streamrelay
./install.sh          # build + npm link  (install.ps1 on Windows)
# or, manually:
npm install && npm run build && npm link
```

Requires **Node.js ≥ 22**. Then install `ffmpeg` (the only external runtime dep):

| OS | Command |
| --- | --- |
| macOS | `brew install ffmpeg` |
| Debian/Ubuntu | `sudo apt install ffmpeg` |
| Windows | `winget install Gyan.FFmpeg` |

Confirm your environment:

```text
$ streamrelay doctor
ffmpeg binary : ffmpeg
status        : OK
version       : 6.1.1
banner        : ffmpeg version 6.1.1 Copyright (c) 2000-2023 the FFmpeg developers
  - ffmpeg is available.
```

(Prefer containers? `docker build -t streamrelay .` bundles ffmpeg — see the
`Dockerfile` header for run recipes.)

## Quick start

```bash
streamrelay new studio --profile multicast --out studio.json   # scaffold
streamrelay validate studio.json                               # check it
streamrelay plan studio.json                                   # see the command
streamrelay start studio --config studio.json                  # launch
streamrelay status                                             # is it alive?
streamrelay logs studio                                        # tail ffmpeg
streamrelay stop studio                                        # graceful (SIGTERM)
```

## Real output

Everything below is copied verbatim from actual runs on this repo.

**Copy fan-out to two RTMP destinations** — one `tee` muxer, no re-encode:

```text
$ streamrelay plan examples/copy-fanout.json
ffmpeg -hide_banner -loglevel warning -fflags nobuffer -flags low_delay -i rtmp://localhost:1935/live/studio -c copy -map 0 -f tee "[f=flv]rtmp://live.twitch.tv/app/REPLACE_WITH_KEY|[f=flv]rtmp://a.rtmp.youtube.com/live2/REPLACE_WITH_KEY"
```

**Transcode ladder** (1080p + 720p) — one decode, two mapped encodes:

```text
$ streamrelay plan examples/transcode-ladder.json
ffmpeg -hide_banner -loglevel warning -fflags nobuffer -flags low_delay -i rtmp://localhost:1935/live/studio -map 0 -c:v libx264 -b:v 6000k -s 1920x1080 -r 30 -preset veryfast -g 60 -c:a aac -b:a 160k -f flv rtmp://live.twitch.tv/app/REPLACE_WITH_KEY -map 0 -c:v libx264 -b:v 2500k -s 1280x720 -r 30 -preset veryfast -g 60 -c:a aac -b:a 128k -f flv rtmp://a.rtmp.youtube.com/live2/REPLACE_WITH_KEY
```

**SRT contribution + RTMP mirror** — mixed-transport tee copy:

```text
$ streamrelay plan examples/srt-contribution.json
ffmpeg -hide_banner -loglevel warning -fflags nobuffer -flags low_delay -i srt://ingest.internal:9000 -c copy -map 0 -f tee "[f=mpegts]srt://distribution.internal:9001|[f=flv]rtmp://cdn.example.com/live/REPLACE_WITH_KEY"
```

**Dependency-free testsrc → HLS** (`plan --shell`, copy-pasteable):

```text
$ streamrelay plan examples/testsrc-hls.json --shell
ffmpeg -hide_banner -loglevel warning -re -f lavfi -i testsrc=size=1280x720:rate=30 -f lavfi -i sine=frequency=1000:sample_rate=48000 -map 0:v -map 1:a -c:v libx264 -b:v 2500k -preset veryfast -g 60 -c:a aac -b:a 128k -hls_time 4 -hls_list_size 6 -hls_flags delete_segments -f hls ./out/stream.m3u8
```

**Machine-readable plan** for your own launcher:

```text
$ streamrelay plan examples/copy-fanout.json --json
{
  "bin": "ffmpeg",
  "args": ["-hide_banner", "-loglevel", "warning", "-fflags", "nobuffer", "-flags", "low_delay", "-i", "rtmp://localhost:1935/live/studio", "-c", "copy", "-map", "0", "-f", "tee", "[f=flv]rtmp://live.twitch.tv/app/REPLACE_WITH_KEY|[f=flv]rtmp://a.rtmp.youtube.com/live2/REPLACE_WITH_KEY"],
  "strategy": "tee-copy"
}
```

**Session lifecycle** (real spawn; here the stand-in process exits immediately,
demonstrating liveness detection):

```text
$ streamrelay start studio --config examples/copy-fanout.json
started "studio" (pid 92940, tee-copy)
  log: ~/.streamrelay/logs/studio.log
$ streamrelay status
studio	RUNNING	pid 92940	tee-copy	up 3s	since 2026-07-06T05:08:26.523Z
$ streamrelay stop studio
stopped "studio"
```

## Commands

```text
streamrelay validate <config.json>              # exit non-zero on error (CI gate)
streamrelay plan <config.json> [--json|--shell] # print the ffmpeg command(s)
streamrelay start <name> --config <c.json>      # launch a relay session
streamrelay stop <name> [--force]               # SIGTERM, or SIGKILL with --force
streamrelay restart <name>                      # re-plan from stored config + respawn
streamrelay status [--json]                     # list sessions + liveness + uptime
streamrelay logs <name> [--lines N]             # tail a session's ffmpeg log
streamrelay doctor [--ffmpeg <path>] [--json]   # is ffmpeg present? which version?
streamrelay new [name] [--profile <p>]          # scaffold a config
```

Scaffold profiles: `multicast`, `transcode`, `srt`, `testsrc`.
`--state <path>` overrides the session state file (default
`~/.streamrelay/state.json`, or `$STREAMRELAY_HOME/state.json`).

## Config

Full field reference: **[docs/CONFIG.md](docs/CONFIG.md)**. JSON Schema:
**[docs/streamrelay.schema.json](docs/streamrelay.schema.json)**. Ready-to-edit
examples live in [`examples/`](examples). Minimal shape:

```json
{
  "name": "studio-multicast",
  "input": { "url": "rtmp://localhost:1935/live/studio", "kind": "rtmp", "live": true },
  "outputs": [
    { "name": "twitch",  "url": "rtmp://live.twitch.tv/app/KEY" },
    { "name": "youtube", "url": "rtmp://a.rtmp.youtube.com/live2/KEY" }
  ]
}
```

## How it plans

- **single** output → one mapped output.
- all **pure stream-copy** outputs → a single `tee` muxer (one decode, many
  destinations — cheapest).
- any **transcoding / mixed** output → one mapped stanza per destination, all
  from one decoded input.

Input kinds `rtmp`/`srt`/`udp`/`http`/`file`/`stdin`/`testsrc` shape the input
side (live network gets low-latency flags, live files get `-re`, `testsrc`
synthesizes video + sine audio for a no-dependency smoke test). Per-output
`reconnect` emits ffmpeg's `-reconnect*` flags for network outputs.

## Architecture

Because `SessionManager` and `doctor` take a `Runner` by injection, the tests
drive the full lifecycle with a `FakeRunner` — no real ffmpeg or OS processes.
See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

| Module | Responsibility |
| --- | --- |
| `src/types.ts` | config type definitions |
| `src/validate.ts` | pure validation + kind inference (no I/O) |
| `src/plan.ts` | `ffmpeg` argument construction (no spawning) |
| `src/runner.ts` | `Runner` interface + `ProcessRunner` |
| `src/session.ts` | `SessionManager`: lifecycle + state persistence |
| `src/doctor.ts` | ffmpeg environment probe (via `Runner`) |
| `src/scaffold.ts` | starter-config profiles |
| `cli.ts` | argument parsing + dispatch |

## Development

```bash
make build       # npm install + tsc -> dist/
make typecheck   # tsc --noEmit (strict; also the lint gate)
make test        # node --test (dist/test/*.test.js)
make demo        # sh demos/run_all.sh  (ffmpeg-optional smoke)
```

Demos in [`demos/`](demos) run and exit 0 **without** ffmpeg; when ffmpeg is
present, demo 3 actually relays a 5-second testsrc pattern to HLS.

## Platform notes

Runs on **Linux, macOS, and Windows** (Node ≥ 22). Paths go through `node:path`;
session/log state lives under your home dir (`$STREAMRELAY_HOME` to relocate).
On Windows, `stop --force` maps to a hard terminate. `ffmpeg` is the only
external runtime requirement — see the install table above.

## License

Source-available under **COCL 1.0** — see [LICENSE](LICENSE) and
[DISCLAIMER.md](DISCLAIMER.md). Free for non-commercial use; commercial use
requires a separate license (licensing@cognis.digital).
