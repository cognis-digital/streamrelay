// Session management: start/stop/status of relays through an injectable Runner,
// persisting pids to a JSON state file. No direct process or ffmpeg knowledge
// beyond the Runner + plan builder.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { RelayConfig } from "./types.js";
import { buildPlan } from "./plan.js";
import type { Runner } from "./runner.js";

export interface SessionRecord {
  name: string;
  pid: number;
  bin: string;
  args: string[];
  startedAt: string;
}

export interface SessionState {
  sessions: Record<string, SessionRecord>;
}

export interface SessionStatus extends SessionRecord {
  alive: boolean;
}

const EMPTY_STATE: SessionState = { sessions: {} };

/** Load state from disk, returning empty state when the file is absent/corrupt. */
export function loadState(statePath: string): SessionState {
  if (!existsSync(statePath)) return { sessions: {} };
  try {
    const raw = readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "sessions" in parsed &&
      typeof (parsed as SessionState).sessions === "object"
    ) {
      return parsed as SessionState;
    }
  } catch {
    /* fall through to empty */
  }
  return { sessions: {} };
}

/** Persist state to disk, creating parent directories as needed. */
export function saveState(statePath: string, state: SessionState): void {
  const dir = dirname(statePath);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export class SessionManager {
  constructor(
    private readonly runner: Runner,
    private readonly statePath: string
  ) {}

  private read(): SessionState {
    return loadState(this.statePath);
  }

  private write(state: SessionState): void {
    saveState(this.statePath, state);
  }

  /** Start a relay session. Throws if a live session with the same name exists. */
  start(name: string, cfg: RelayConfig): SessionRecord {
    const state = this.read();
    const existing = state.sessions[name];
    if (existing && this.runner.isAlive(existing.pid)) {
      throw new Error(`session "${name}" is already running (pid ${existing.pid})`);
    }

    const plan = buildPlan(cfg);
    const pid = this.runner.spawn({ bin: plan.bin, args: plan.args });
    const record: SessionRecord = {
      name,
      pid,
      bin: plan.bin,
      args: plan.args,
      startedAt: new Date().toISOString(),
    };
    state.sessions[name] = record;
    this.write(state);
    return record;
  }

  /** Stop a relay session. Returns false when no such session is tracked. */
  stop(name: string): boolean {
    const state = this.read();
    const record = state.sessions[name];
    if (!record) return false;
    if (this.runner.isAlive(record.pid)) {
      this.runner.kill(record.pid);
    }
    delete state.sessions[name];
    this.write(state);
    return true;
  }

  /** Report status of all tracked sessions, annotating each with liveness. */
  status(): SessionStatus[] {
    const state = this.read();
    return Object.values(state.sessions)
      .map((r) => ({ ...r, alive: this.runner.isAlive(r.pid) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Status of a single named session, or undefined when untracked. */
  statusOf(name: string): SessionStatus | undefined {
    const state = this.read();
    const r = state.sessions[name];
    if (!r) return undefined;
    return { ...r, alive: this.runner.isAlive(r.pid) };
  }
}

export { EMPTY_STATE };
