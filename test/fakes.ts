// A fake Runner used across the tests. No real processes are ever spawned.

import type { Runner, SpawnRequest } from "../src/runner.js";

export class FakeRunner implements Runner {
  public spawned: Array<SpawnRequest & { pid: number }> = [];
  public killed: number[] = [];
  private nextPid = 1000;
  private alivePids = new Set<number>();

  spawn(req: SpawnRequest): number {
    const pid = this.nextPid++;
    this.spawned.push({ ...req, pid });
    this.alivePids.add(pid);
    return pid;
  }

  kill(pid: number): boolean {
    this.killed.push(pid);
    const had = this.alivePids.has(pid);
    this.alivePids.delete(pid);
    return had;
  }

  isAlive(pid: number): boolean {
    return this.alivePids.has(pid);
  }

  /** Test helper: simulate a process dying without an explicit stop. */
  simulateExit(pid: number): void {
    this.alivePids.delete(pid);
  }
}
