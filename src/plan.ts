// ffmpeg command construction. Pure functions, no process spawning.
//
// The planner turns a validated RelayConfig into a single ffmpeg invocation
// (one process, one decode of the input) that fans the input out to every
// output. It picks the cheapest correct strategy:
//
//   * single output              -> one mapped output
//   * all pure stream-copy        -> one `tee` muxer (no re-encode, many dests)
//   * any transcode / mixed       -> one process, one mapped output stanza each
//
// It never spawns anything; `session.ts` feeds the plan to a Runner.

import type { OutputKind, RelayConfig, RelayInput, RelayOutput } from "./types.js";
import { inferInputKind, inferOutputKind, isTranscode } from "./validate.js";

/** A planned ffmpeg invocation. */
export interface FfmpegPlan {
  /** The binary to execute. */
  bin: string;
  /** Argument vector (excluding the binary itself). */
  args: string[];
  /** Human-readable strategy label. */
  strategy: "single" | "tee-copy" | "map-transcode";
}

const DEFAULT_TESTSRC_LAVFI = "testsrc=size=1280x720:rate=30";

/** Default container/muxer for an output kind. */
function defaultFormat(out: RelayOutput): string {
  const kind = inferOutputKind(out);
  switch (kind) {
    case "srt":
      return "mpegts";
    case "hls":
      return "hls";
    case "file":
      return "mp4";
    case "rtmp":
    default:
      return "flv";
  }
}

/** Build the input-side argument list (everything up to and including `-i`). */
function buildInputArgs(cfg: RelayConfig): string[] {
  const args: string[] = [];
  const input: RelayInput = cfg.input;
  const kind = inferInputKind(input);

  if (kind === "testsrc") {
    const spec = input.lavfi ?? DEFAULT_TESTSRC_LAVFI;
    // lavfi generates video; pair it with a sine tone so outputs have audio.
    args.push("-re", "-f", "lavfi", "-i", spec);
    args.push("-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000");
    return args;
  }

  const isNetwork = kind === "rtmp" || kind === "srt" || kind === "udp" || kind === "http";
  if (input.live) {
    if (isNetwork) {
      // Reduce latency / buffering for live network ingest.
      args.push("-fflags", "nobuffer", "-flags", "low_delay");
    } else if (kind === "file") {
      // Read a local file at native frame rate to simulate a live source.
      args.push("-re");
    }
  }
  args.push("-i", input.url);
  return args;
}

/**
 * The stream-map tokens for this config. testsrc uses two lavfi inputs
 * (video=0, sine audio=1), so it must map both; everything else maps input 0.
 */
function mapArgs(cfg: RelayConfig): string[] {
  if (inferInputKind(cfg.input) === "testsrc") return ["-map", "0:v", "-map", "1:a"];
  return ["-map", "0"];
}

/** Reconnect flags for a network output, if enabled. Applied before the URL. */
function reconnectArgs(out: RelayOutput): string[] {
  const rc = out.reconnect;
  const kind = inferOutputKind(out);
  const isNetwork = kind === "rtmp" || kind === "srt";
  if (!rc || !rc.enabled || !isNetwork) return [];
  const args = ["-reconnect", "1"];
  if (rc.streamed) args.push("-reconnect_streamed", "1");
  if (rc.delayMaxSec !== undefined) args.push("-reconnect_delay_max", String(rc.delayMaxSec));
  return args;
}

/** Codec/quality args shared by single-output and per-output map stanzas. */
function codecArgs(out: RelayOutput): string[] {
  const args: string[] = [];
  const vcodec = out.videoCodec ?? "copy";
  const acodec = out.audioCodec ?? "copy";

  args.push("-c:v", vcodec);
  if (vcodec !== "copy") {
    if (out.videoBitrateKbps !== undefined) args.push("-b:v", `${out.videoBitrateKbps}k`);
    if (out.resolution !== undefined) args.push("-s", out.resolution);
    if (out.framerate !== undefined) args.push("-r", String(out.framerate));
    if (out.preset !== undefined) args.push("-preset", out.preset);
    if (out.gop !== undefined) args.push("-g", String(out.gop));
  }

  args.push("-c:a", acodec);
  if (acodec !== "copy" && out.audioBitrateKbps !== undefined) {
    args.push("-b:a", `${out.audioBitrateKbps}k`);
  }
  return args;
}

/** HLS-specific muxer options. */
function hlsArgs(out: RelayOutput): string[] {
  return [
    "-hls_time", String(out.hlsSegmentSec ?? 4),
    "-hls_list_size", String(out.hlsListSize ?? 6),
    "-hls_flags", "delete_segments",
  ];
}

/** Build a full per-output stanza: codec + format + reconnect + destination. */
function buildOutputArgs(out: RelayOutput): string[] {
  const args: string[] = [];
  args.push(...codecArgs(out));

  const kind = inferOutputKind(out);
  const fmt = out.format ?? defaultFormat(out);
  if (kind === "hls") args.push(...hlsArgs(out));
  args.push("-f", fmt);
  args.push(...reconnectArgs(out));
  args.push(out.url);
  return args;
}

/** Whether a set of outputs can all be served by a single tee muxer. */
function canTee(outputs: RelayOutput[]): boolean {
  // tee requires uniform stream copy across every leg. HLS carries extra muxer
  // options that tee can't express cleanly, so it always goes through maps.
  return outputs.every((o) => {
    if (isTranscode(o)) return false;
    const kind: OutputKind = inferOutputKind(o);
    return kind === "rtmp" || kind === "srt" || kind === "file";
  });
}

/** Build the tee-muxer leg string, e.g. `[f=flv]rtmp://a|[f=mpegts]srt://b`. */
function teeLegs(outputs: RelayOutput[]): string {
  return outputs
    .map((o) => {
      const fmt = o.format ?? defaultFormat(o);
      return `[f=${fmt}]${o.url}`;
    })
    .join("|");
}

/** Build the ffmpeg plan for a config. Always a single process (one decode). */
export function buildPlan(cfg: RelayConfig): FfmpegPlan {
  const bin = cfg.ffmpegPath ?? "ffmpeg";
  const args: string[] = ["-hide_banner", "-loglevel", cfg.logLevel ?? "warning"];
  args.push(...buildInputArgs(cfg));

  const map = mapArgs(cfg);

  // Single output: one mapped stanza.
  if (cfg.outputs.length === 1) {
    args.push(...map);
    args.push(...buildOutputArgs(cfg.outputs[0]!));
    return { bin, args, strategy: "single" };
  }

  // Pure-copy fan-out: a single tee muxer (one decode, many destinations).
  if (canTee(cfg.outputs)) {
    args.push("-c", "copy", ...map);
    args.push("-f", "tee", teeLegs(cfg.outputs));
    return { bin, args, strategy: "tee-copy" };
  }

  // Mixed / transcoding: one mapped output stanza per destination.
  for (const out of cfg.outputs) {
    args.push(...map);
    args.push(...buildOutputArgs(out));
  }
  return { bin, args, strategy: "map-transcode" };
}

/** POSIX-shell quote a single token. */
function shQuote(s: string): string {
  if (s.length > 0 && /^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Render a plan as a display string (JSON-quoted tokens). */
export function planToString(plan: FfmpegPlan): string {
  const quote = (s: string) => (/[\s|"'\\]/.test(s) ? JSON.stringify(s) : s);
  return [plan.bin, ...plan.args].map(quote).join(" ");
}

/** Render a plan as a copy-pasteable POSIX shell command (`plan --shell`). */
export function planToShell(plan: FfmpegPlan): string {
  return [plan.bin, ...plan.args].map(shQuote).join(" ");
}
