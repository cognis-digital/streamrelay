// Process runner abstraction. The CLI talks to a Runner, never to child_process
// directly, so the whole control plane is testable without ffmpeg.

import { spawn as cpSpawn } from "node:child_process";

export interface SpawnRequest {
  bin: string;
  args: string[];
}

export interface Runner {
  /** Spawn a detached process and return its pid. */
  spawn(req: SpawnRequest): number;
  /** Send a termination signal to a pid. Returns true if the signal was delivered. */
  kill(pid: number): boolean;
  /** Whether a process with this pid is currently alive. */
  isAlive(pid: number): boolean;
}

/** Real runner backed by node:child_process. */
export class ProcessRunner implements Runner {
  spawn(req: SpawnRequest): number {
    const child = cpSpawn(req.bin, req.args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    if (child.pid === undefined) {
      throw new Error(`failed to spawn ${req.bin}`);
    }
    return child.pid;
  }

  kill(pid: number): boolean {
    try {
      process.kill(pid, "SIGTERM");
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
}
