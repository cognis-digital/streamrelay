// Process runner abstraction. The CLI talks to a Runner, never to child_process
// directly, so the whole control plane is testable without ffmpeg.

import { spawn as cpSpawn, spawnSync } from "node:child_process";
import { openSync, closeSync } from "node:fs";

export interface SpawnRequest {
  bin: string;
  args: string[];
  /** Optional file path to redirect stdout+stderr into (session log capture). */
  logFile?: string;
}

/** Result of a synchronous exec (used by `doctor` to probe ffmpeg). */
export interface ExecResult {
  /** Exit code, or null when the process was terminated by a signal. */
  code: number | null;
  /** Captured stdout. */
  stdout: string;
  /** Captured stderr. */
  stderr: string;
  /** True when the binary could not be launched at all (e.g. not on PATH). */
  spawnError: boolean;
}

export interface Runner {
  /** Spawn a detached process and return its pid. */
  spawn(req: SpawnRequest): number;
  /** Send a termination signal to a pid. Returns true if the signal was delivered. */
  kill(pid: number, signal?: NodeJS.Signals): boolean;
  /** Whether a process with this pid is currently alive. */
  isAlive(pid: number): boolean;
  /** Run a binary to completion and capture its output (for probes like doctor). */
  exec(req: SpawnRequest): ExecResult;
}

/** Real runner backed by node:child_process. */
export class ProcessRunner implements Runner {
  spawn(req: SpawnRequest): number {
    let stdio: "ignore" | ["ignore", number, number] = "ignore";
    let fd: number | undefined;
    if (req.logFile) {
      fd = openSync(req.logFile, "a");
      stdio = ["ignore", fd, fd];
    }
    try {
      const child = cpSpawn(req.bin, req.args, { detached: true, stdio });
      child.unref();
      if (child.pid === undefined) {
        throw new Error(`failed to spawn ${req.bin}`);
      }
      return child.pid;
    } finally {
      // The child holds its own dup'd descriptor; the parent can close ours.
      if (fd !== undefined) closeSync(fd);
    }
  }

  kill(pid: number, signal: NodeJS.Signals = "SIGTERM"): boolean {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }

  isAlive(pid: number): boolean {
    try {
      // Signal 0 performs error checking without actually sending a signal.
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  exec(req: SpawnRequest): ExecResult {
    const r = spawnSync(req.bin, req.args, { encoding: "utf8" });
    if (r.error) {
      return { code: null, stdout: "", stderr: String(r.error.message ?? r.error), spawnError: true };
    }
    return {
      code: r.status,
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? "",
      spawnError: false,
    };
  }
}
