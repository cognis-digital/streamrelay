# streamrelay

A self-hosted livestream relay control plane. Declare an input source and one or
more RTMP/SRT outputs in a JSON config; `streamrelay` **validates** the config,
**generates** the `ffmpeg` command(s) needed to relay input → outputs, and
**manages** relay sessions (start / stop / status).

The whole control plane drives `ffmpeg` through an injectable process runner, so
every part of it is testable without `ffmpeg`, a network, or live processes.

- **Maintainer:** Cognis Digital
- **License:** COCL 1.0
- **Runtime deps:** none (Node standard library only)

## Why

Restreaming to multiple destinations is just `ffmpeg` plumbing, but the plumbing
is fiddly: per-output codecs, bitrates, container formats, and the difference
between a pure stream-copy fan-out (cheap, one `tee` muxer) and a transcoding
fan-out (multiple mapped outputs). `streamrelay` turns a declarative config into
the correct command and keeps track of which relays are running.

## Install

```bash
npm install
npm run build      # compiles TypeScript -> dist/
npm link           # optional: exposes the `streamrelay` bin globally
```

Requires Node.js >= 20.

## Config format

```json
{
  "name": "studio-multicast",
  "input": { "url": "rtmp://localhost:1935/live/studio", "live": true },
  "outputs": [
    { "name": "twitch",  "url": "rtmp://live.twitch.tv/app/KEY" },
    { "name": "youtube", "url": "rtmp://a.rtmp.youtube.com/live2/KEY" },
    {
      "name": "archive-720p",
      "url": "srt://archive.internal:9000",
      "videoCodec": "libx264", "videoBitrateKbps": 2500,
      "audioCodec": "aac", "audioBitrateKbps": 128
    }
  ]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | `[A-Za-z0-9._-]+` |
| `input.url` | yes | `rtmp(s)://`, `srt://`, `http(s)://`, `udp://`, a file path, or `-` (stdin) |
| `input.live` | no | live ingest: `-fflags nobuffer` for network, `-re` for files |
| `outputs[]` | yes | at least one |
| `outputs[].name` | yes | unique within the config |
| `outputs[].url` | yes | must be `rtmp(s)://` or `srt://` |
| `outputs[].videoCodec` / `audioCodec` | no | default `copy` |
| `outputs[].videoBitrateKbps` / `audioBitrateKbps` | no | positive integers; only applied when the matching codec is not `copy` |
| `outputs[].format` | no | container; defaults to `flv` (rtmp) or `mpegts` (srt) |
| `ffmpegPath` | no | defaults to `ffmpeg` on `PATH` |

## Commands

```text
streamrelay validate <config.json>            # exit non-zero on error (CI gate)
streamrelay plan <config.json> [--json]       # print the ffmpeg command(s)
streamrelay start <name> --config <c.json>    # launch a relay session
streamrelay stop <name>                        # stop a relay session
streamrelay status [--json]                    # list tracked sessions + liveness
streamrelay new [name] [--out config.json]     # scaffold a starter config
```

Common flags: `--state <path>` overrides the session state file
(default `~/.streamrelay/state.json`, or `$STREAMRELAY_HOME/state.json`).

### validate — the CI gate

```bash
streamrelay validate examples/config.json
# OK: examples/config.json is a valid relay config   (exit 0)
```

On any structural error it prints each problem and exits non-zero, so it drops
straight into a CI pipeline.

### plan — see the generated ffmpeg command

```bash
streamrelay plan examples/config.json
```

- A **single** output produces one `ffmpeg` process with one output.
- **Multiple pure-copy** outputs fan out through a single `tee` muxer (one
  decode, many destinations).
- **Mixed / transcoding** outputs emit one mapped output stanza per destination.

Add `--json` for a `{ "bin", "args": [...] }` object you can feed to your own
launcher.

### start / stop / status

```bash
streamrelay start studio --config examples/config.json
streamrelay status
# studio   RUNNING   pid 48213   since 2026-06-19T15:00:00.000Z
streamrelay stop studio
```

Session pids are tracked in the state file. `status` re-checks each pid's
liveness on every call, so a relay that exited on its own shows as `DEAD`.

## Architecture

| Module | Responsibility |
| --- | --- |
| `src/types.ts` | config type definitions |
| `src/validate.ts` | pure validation (`validateConfig`) — no I/O |
| `src/plan.ts` | `ffmpeg` argument construction (`buildPlan`) — no spawning |
| `src/runner.ts` | `Runner` interface + `ProcessRunner` (real `child_process`) |
| `src/session.ts` | `SessionManager`: start/stop/status + state-file persistence |
| `src/scaffold.ts` | starter-config generator for `new` |
| `cli.ts` | argument parsing + command dispatch |

Because `SessionManager` takes a `Runner` by constructor injection, tests drive
the full lifecycle with a `FakeRunner` that records spawns/kills and simulates
process exits — no real `ffmpeg` or OS processes involved.

## Development

```bash
npm run build      # tsc -> dist/
npm test           # node --test over dist/test/*.test.js
```

## License

License: COCL 1.0
