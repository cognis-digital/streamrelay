# streamrelay config reference

A config is a single JSON object describing one **input** fanned out to one or
more **outputs**. The machine-readable schema is
[`docs/streamrelay.schema.json`](./streamrelay.schema.json) (JSON Schema draft-07);
the hand-rolled validator in `src/validate.ts` mirrors it exactly (the tool ships
zero runtime dependencies, so it does not pull in an external schema library).

Validate any config with:

```bash
streamrelay validate my-relay.json
```

## Top-level fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | `[A-Za-z0-9._-]+` |
| `input` | object | yes | see **Input** |
| `outputs` | array | yes | ≥ 1 output; see **Output** |
| `ffmpegPath` | string | no | ffmpeg binary; default `ffmpeg` |
| `logLevel` | string | no | ffmpeg `-loglevel`; default `warning` |

## Input

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `url` | string | yes* | `rtmp(s)://`, `srt://`, `udp://`, `http(s)://`, a file path, or `-` (stdin). *Ignored for `kind: testsrc`. |
| `kind` | enum | no | `rtmp` \| `srt` \| `file` \| `udp` \| `http` \| `testsrc` \| `stdin`. Inferred from `url` when omitted; if set it must match the URL. |
| `live` | boolean | no | Live ingest: `-fflags nobuffer -flags low_delay` for network, `-re` for files. |
| `lavfi` | string | no | For `kind: testsrc`: a lavfi spec (e.g. `testsrc=size=1280x720:rate=30`). A 1 kHz sine audio track is added automatically. |

## Output

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | unique within the config; `[A-Za-z0-9._-]+` |
| `url` | string | yes | `rtmp(s)://`/`srt://` URL, or a file path for `hls`/`file` |
| `kind` | enum | no | `rtmp` \| `srt` \| `hls` \| `file`. Inferred from URL/`.m3u8` extension when omitted. |
| `videoCodec` | string | no | e.g. `libx264`; default `copy` |
| `videoBitrateKbps` | int > 0 | no | transcode only (video codec ≠ `copy`) |
| `resolution` | string | no | `WxH`, e.g. `1280x720`; transcode only |
| `framerate` | int > 0 | no | fps; transcode only |
| `preset` | string | no | x264/x265 preset, e.g. `veryfast`; transcode only |
| `gop` | int > 0 | no | keyframe interval in frames; transcode only |
| `audioCodec` | string | no | e.g. `aac`; default `copy` |
| `audioBitrateKbps` | int > 0 | no | transcode only (audio codec ≠ `copy`) |
| `format` | string | no | container/muxer; defaults per kind: `flv`/`mpegts`/`hls`/`mp4` |
| `hlsSegmentSec` | int > 0 | no | HLS `-hls_time`; default `4` |
| `hlsListSize` | int > 0 | no | HLS `-hls_list_size`; default `6` |
| `reconnect` | object | no | `{ enabled, streamed?, delayMaxSec? }`; network outputs only |

## Validation rules (beyond types)

- Output `name`s must be unique.
- A `kind` (input or output) must be consistent with its `url`.
- You **cannot** set a transcode option (`videoBitrateKbps`, `resolution`,
  `framerate`, `preset`, `gop`) while `videoCodec` is `copy`; likewise
  `audioBitrateKbps` requires a non-`copy` `audioCodec`. This prevents the
  silent-no-op class of misconfiguration.
- **Warnings** (do not fail validation): transcoding video with no
  `videoBitrateKbps` (ffmpeg picks a default), and `reconnect` set on an
  `hls`/`file` output (ignored — only network outputs reconnect).

## How outputs map to a plan

- All outputs pure-copy → one `tee` muxer (`tee-copy`).
- Any transcoding output → one mapped stanza per output (`map-transcode`).
- One output → `single`.

Inspect the exact command with `streamrelay plan <config> [--json | --shell]`.
See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full model.
