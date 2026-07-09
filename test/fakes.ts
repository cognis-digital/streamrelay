// A fake Runner used across the tests. No real processes are ever spawned.

import type { ExecResult, Runner, SpawnRequest } from "../src/runner.js";

export class FakeRunner implements Runner {
  public spawned: Array<SpawnRequest & { pid: number }> = [];
  public killed: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  private nextPid = 1000;
  private alivePids = new Set<number>();
  /** Programmable exec response (for doctor tests). */
  public execResponse: ExecResult = {
    code: 0,
    stdout: "ffmpeg version 6.1.1 Copyright (c) 2000-2023 the FFmpeg developers\n",
    stderr: "",
    spawnError: false,
  };
  public execCalls: SpawnRequest[] = [];

  spawn(req: SpawnRequest): number {
    const pid = this.nextPid++;
    this.spawned.push({ ...req, pid });
    this.alivePids.add(pid);
    return pid;
  }

  kill(pid: number, signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killed.push({ pid, signal });
    const had = this.alivePids.has(pid);
    this.alivePids.delete(pid);
    return had;
  }

  isAlive(pid: number): boolean {
    return this.alivePids.has(pid);
  }

  exec(req: SpawnRequest): ExecResult {
    this.execCalls.push(req);
    return this.execResponse;
  }

  /** Test helper: simulate a process dying without an explicit stop. */
  simulateExit(pid: number): void {
    this.alivePids.delete(pid);
  }
}
