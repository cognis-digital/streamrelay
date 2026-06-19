// ffmpeg command construction. Pure functions, no process spawning.

import type { RelayConfig, RelayOutput } from "./types.js";

/** A planned ffmpeg invocation. */
export interface FfmpegPlan {
  /** The binary to execute. */
  bin: string;
  /** Argument vector (excluding the binary itself). */
  args: string[];
}

function defaultFormat(url: string): string {
  if (url.startsWith("srt://")) return "mpegts";
  return "flv";
}

/** Build the input-side argument list. */
function buildInputArgs(cfg: RelayConfig): string[] {
  const args: string[] = [];
  const url = cfg.input.url;
  const isNetwork = /^[A-Za-z]+:\/\//.test(url);

  if (cfg.input.live) {
    if (isNetwork) {
      // Reduce latency / buffering for live network ingest.
      args.push("-fflags", "nobuffer");
    } else {
      // Read a local file at native frame rate to simulate a live source.
      args.push("-re");
    }
  }
  args.push("-i", url);
  return args;
}

/** Build the per-output codec/bitrate/format/url argument list. */
function buildOutputArgs(out: RelayOutput): string[] {
  const args: string[] = [];

  const vcodec = out.videoCodec ?? "copy";
  const acodec = out.audioCodec ?? "copy";

  args.push("-c:v", vcodec);
  if (vcodec !== "copy" && out.videoBitrateKbps !== undefined) {
    args.push("-b:v", `${out.videoBitrateKbps}k`);
  }

  args.push("-c:a", acodec);
  if (acodec !== "copy" && out.audioBitrateKbps !== undefined) {
    args.push("-b:a", `${out.audioBitrateKbps}k`);
  }

  const fmt = out.format ?? defaultFormat(out.url);
  args.push("-f", fmt);
  args.push(out.url);
  return args;
}

/**
 * Build the ffmpeg plan(s) for a config.
 *
 * Single output -> one ffmpeg process with one output.
 * Multiple outputs that all copy identically -> a single process using the
 * `tee` muxer (one decode/encode, fanned out). Mixed/transcoding outputs ->
 * one process with multiple mapped outputs (re-using the decoded input).
 */
export function buildPlan(cfg: RelayConfig): FfmpegPlan {
  const bin = cfg.ffmpegPath ?? "ffmpeg";
  const args: string[] = ["-hide_banner", "-loglevel", "warning"];
  args.push(...buildInputArgs(cfg));

  if (cfg.outputs.length === 1) {
    args.push(...buildOutputArgs(cfg.outputs[0]!));
    return { bin, args };
  }

  // If every output is a pure stream copy (no transcode, no bitrate override),
  // we can fan out with a single tee muxer for maximum efficiency.
  const allCopy = cfg.outputs.every(
    (o) =>
      (o.videoCodec ?? "copy") === "copy" &&
      (o.audioCodec ?? "copy") === "copy"
  );

  if (allCopy) {
    args.push("-c", "copy", "-map", "0");
    const legs = cfg.outputs
      .map((o) => {
        const fmt = o.format ?? defaultFormat(o.url);
        return `[f=${fmt}]${o.url}`;
      })
      .join("|");
    args.push("-f", "tee", legs);
    return { bin, args };
  }

  // Mixed outputs: emit one mapped output stanza per destination.
  for (const out of cfg.outputs) {
    args.push("-map", "0");
    args.push(...buildOutputArgs(out));
  }
  return { bin, args };
}

/** Render a plan as a shell-ish command string (for display only). */
export function planToString(plan: FfmpegPlan): string {
  const quote = (s: string) => (/[\s|"'\\]/.test(s) ? JSON.stringify(s) : s);
  return [plan.bin, ...plan.args].map(quote).join(" ");
}
