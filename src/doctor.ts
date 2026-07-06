// Environment probe for `streamrelay doctor`.
//
// Checks whether the ffmpeg binary is present and reports its version, using
// the injectable Runner so the whole thing is testable without a real ffmpeg.

import type { Runner } from "./runner.js";

export interface DoctorReport {
  /** The binary that was probed (default "ffmpeg"). */
  bin: string;
  /** True when the binary launched and reported a version. */
  ffmpegFound: boolean;
  /** Parsed version string, e.g. "6.1.1", when detectable. */
  version?: string;
  /** First line of `ffmpeg -version` output, for display. */
  banner?: string;
  /** Human-readable notes / remediation. */
  notes: string[];
}

const VERSION_RE = /^ffmpeg version (\S+)/;

/**
 * Probe the ffmpeg environment. Never throws.
 * @param runner  injectable runner (real or fake)
 * @param bin     binary to probe (default "ffmpeg")
 */
export function runDoctor(runner: Runner, bin = "ffmpeg"): DoctorReport {
  const notes: string[] = [];
  const res = runner.exec({ bin, args: ["-version"] });

  if (res.spawnError) {
    notes.push(`"${bin}" is not on PATH (or could not be launched).`);
    notes.push("Install ffmpeg: macOS `brew install ffmpeg`, Debian/Ubuntu `apt install ffmpeg`, Windows `winget install Gyan.FFmpeg`.");
    return { bin, ffmpegFound: false, notes };
  }

  if (res.code !== 0) {
    notes.push(`"${bin} -version" exited with code ${res.code}.`);
  }

  const firstLine = (res.stdout || res.stderr).split(/\r?\n/, 1)[0] ?? "";
  const m = VERSION_RE.exec(firstLine);
  const found = m !== null;
  if (found) {
    notes.push("ffmpeg is available.");
  } else {
    notes.push(`"${bin}" ran but did not report a recognizable ffmpeg version banner.`);
  }

  return {
    bin,
    ffmpegFound: found,
    version: m ? m[1] : undefined,
    banner: firstLine || undefined,
    notes,
  };
}

/** Render a DoctorReport as human-readable text. */
export function doctorToString(rep: DoctorReport): string {
  const lines: string[] = [];
  lines.push(`ffmpeg binary : ${rep.bin}`);
  lines.push(`status        : ${rep.ffmpegFound ? "OK" : "NOT FOUND"}`);
  if (rep.version) lines.push(`version       : ${rep.version}`);
  if (rep.banner) lines.push(`banner        : ${rep.banner}`);
  for (const n of rep.notes) lines.push(`  - ${n}`);
  return lines.join("\n");
}
