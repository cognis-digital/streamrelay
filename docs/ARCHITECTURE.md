# streamrelay architecture

streamrelay is a **control plane**, not a media engine. It never touches packets:
it turns a declarative JSON config into the correct `ffmpeg` command line and
supervises the resulting process. ffmpeg does the actual muxing/relaying.

```
config.json ──▶ validate ──▶ plan (ffmpeg argv) ──▶ Runner.spawn ──▶ ffmpeg
                   │              │                       │
                   │              │                       └─ pid + log file
                   ▼              ▼                       ▼
              errors/warnings   strategy            state.json (session store)
```

## Modules

| Module | Responsibility | I/O | Deps |
| --- | --- | --- | --- |
| `src/types.ts` | Config type definitions | none | — |
| `src/validate.ts` | `validateConfig` (pure) + kind inference | none | types |
| `src/plan.ts` | `buildPlan` → `{ bin, args, strategy }` (pure) | none | types, validate |
| `src/runner.ts` | `Runner` interface + `ProcessRunner` | processes | node stdlib |
| `src/session.ts` | `SessionManager` lifecycle + state file | fs | plan, runner |
| `src/doctor.ts` | ffmpeg environment probe | via Runner | runner |
| `src/scaffold.ts` | starter-config profiles | none | types |
| `cli.ts` | arg parsing + dispatch | fs, stdout | all of the above |

The purely functional core (`validate`, `plan`, `scaffold`) has no I/O and no
process knowledge, so it is trivially testable and deterministic.

## The injectable Runner

Everything that would otherwise spawn `ffmpeg` goes through a `Runner`:

```ts
interface Runner {
  spawn(req: SpawnRequest): number;                 // detached, returns pid
  kill(pid: number, signal?: NodeJS.Signals): boolean;
  isAlive(pid: number): boolean;                    // process.kill(pid, 0)
  exec(req: SpawnRequest): ExecResult;              // run-to-completion (doctor)
}
```

`ProcessRunner` is the real implementation (backed by `node:child_process`).
Tests inject a `FakeRunner` that records spawns/kills, hands out synthetic pids,
and can `simulateExit(pid)` — so the **entire** `SessionManager` and `doctor`
lifecycle is verified without ffmpeg, a network, or real OS processes.

This is the key design property: the control plane is 100% unit-testable while
the only thing it can't fake — ffmpeg itself — is isolated behind one seam.

## Planning strategies

`buildPlan` always emits a **single** ffmpeg process (one decode of the input)
and picks the cheapest correct fan-out:

- **`single`** — one output → one mapped stanza.
- **`tee-copy`** — every output is a pure stream copy → one `tee` muxer fans the
  copied streams to all destinations. No re-encode; cheapest possible.
- **`map-transcode`** — any output transcodes (or mixes copy + transcode) → one
  mapped output stanza per destination, re-using the single decoded input.

Input kinds (`rtmp`/`srt`/`udp`/`http`/`file`/`stdin`/`testsrc`) shape the input
side: live network ingest gets `-fflags nobuffer -flags low_delay`, live files
get `-re`, and `testsrc` synthesizes a lavfi video + sine audio pair (mapped as
`0:v` + `1:a`) for a dependency-free smoke demo.

## Session state model

`SessionManager` persists a small JSON document (default
`~/.streamrelay/state.json`, override with `--state` or `$STREAMRELAY_HOME`):

```jsonc
{
  "sessions": {
    "<name>": {
      "name", "pid", "bin", "args",
      "startedAt",          // ISO timestamp
      "logFile",            // <state-dir>/logs/<name>.log
      "strategy",           // single | tee-copy | map-transcode
      "config"              // the config used, so restart can rebuild the plan
    }
  }
}
```

- **Liveness / staleness** — `status` re-checks every pid via `isAlive`
  (signal 0) on each call, so a relay that died on its own shows `DEAD`. `reap`
  drops dead records; `start` transparently reclaims a name whose prior pid is
  gone.
- **Logs** — ffmpeg stdout+stderr is redirected to the per-session log file;
  `logs <name>` tails it.
- **Graceful vs force** — `stop` sends `SIGTERM`; `stop --force` sends `SIGKILL`.
- **Restart** — `restart` re-plans from the stored config and re-spawns.
- **Corruption tolerance** — a missing or malformed state file loads as empty
  rather than crashing.

## Portability

All paths go through `node:path`; the state/log directory lives under the user
home (`os.homedir()`), overridable via `$STREAMRELAY_HOME`. No shell-outs except
through the `Runner`. Runs on Linux, macOS, and Windows on Node ≥ 22.
