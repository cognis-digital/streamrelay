// Session management: start/stop/status/restart of relays through an injectable
// Runner, persisting pids to a JSON state file. No direct process or ffmpeg
// knowledge beyond the Runner + plan builder.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RelayConfig } from "./types.js";
import { buildPlan } from "./plan.js";
import type { Runner } from "./runner.js";

export interface SessionRecord {
  name: string;
  pid: number;
  bin: string;
  args: string[];
  startedAt: string;
  /** Path to the per-session log file (stdout+stderr of ffmpeg). */
  logFile: string;
  /** ffmpeg planning strategy used ("single"|"tee-copy"|"map-transcode"). */
  strategy: string;
  /** The config used to start this session, so `restart` can rebuild the plan. */
  config: RelayConfig;
}

export interface SessionState {
  sessions: Record<string, SessionRecord>;
}

export interface SessionStatus extends SessionRecord {
  alive: boolean;
  /** Uptime in whole seconds since startedAt (0 when not alive). */
  uptimeSec: number;
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

/** Default per-session log file path, alongside the state file. */
function defaultLogFile(statePath: string, name: string): string {
  return join(dirname(statePath), "logs", `${name}.log`);
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

  /** Directory that will hold session log files. */
  logDir(): string {
    return join(dirname(this.statePath), "logs");
  }

  /** Start a relay session. Throws if a live session with the same name exists. */
  start(name: string, cfg: RelayConfig): SessionRecord {
    const state = this.read();
    const existing = state.sessions[name];
    if (existing && this.runner.isAlive(existing.pid)) {
      throw new Error(`session "${name}" is already running (pid ${existing.pid})`);
    }

    const plan = buildPlan(cfg);
    const logFile = defaultLogFile(this.statePath, name);
    const logParent = dirname(logFile);
    if (!existsSync(logParent)) mkdirSync(logParent, { recursive: true });

    const pid = this.runner.spawn({ bin: plan.bin, args: plan.args, logFile });
    const record: SessionRecord = {
      name,
      pid,
      bin: plan.bin,
      args: plan.args,
      startedAt: new Date().toISOString(),
      logFile,
      strategy: plan.strategy,
      config: cfg,
    };
    state.sessions[name] = record;
    this.write(state);
    return record;
  }

  /**
   * Stop a relay session. Returns false when no such session is tracked.
   * @param force  send SIGKILL instead of a graceful SIGTERM.
   */
  stop(name: string, force = false): boolean {
    const state = this.read();
    const record = state.sessions[name];
    if (!record) return false;
    if (this.runner.isAlive(record.pid)) {
      this.runner.kill(record.pid, force ? "SIGKILL" : "SIGTERM");
    }
    delete state.sessions[name];
    this.write(state);
    return true;
  }

  /** Stop then start a session with its recorded config. Throws if untracked. */
  restart(name: string): SessionRecord {
    const state = this.read();
    const record = state.sessions[name];
    if (!record) throw new Error(`no tracked session named "${name}"`);
    const cfg = record.config;
    if (this.runner.isAlive(record.pid)) {
      this.runner.kill(record.pid, "SIGTERM");
    }
    delete state.sessions[name];
    this.write(state);
    return this.start(name, cfg);
  }

  /**
   * Reap dead sessions: drop any tracked record whose pid is no longer alive.
   * Returns the names that were reaped. Handles PID staleness.
   */
  reap(): string[] {
    const state = this.read();
    const reaped: string[] = [];
    for (const [name, rec] of Object.entries(state.sessions)) {
      if (!this.runner.isAlive(rec.pid)) {
        reaped.push(name);
        delete state.sessions[name];
      }
    }
    if (reaped.length > 0) this.write(state);
    return reaped;
  }

  private annotate(r: SessionRecord): SessionStatus {
    const alive = this.runner.isAlive(r.pid);
    const uptimeSec = alive
      ? Math.max(0, Math.floor((Date.now() - Date.parse(r.startedAt)) / 1000))
      : 0;
    return { ...r, alive, uptimeSec };
  }

  /** Report status of all tracked sessions, annotating each with liveness. */
  status(): SessionStatus[] {
    const state = this.read();
    return Object.values(state.sessions)
      .map((r) => this.annotate(r))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Status of a single named session, or undefined when untracked. */
  statusOf(name: string): SessionStatus | undefined {
    const state = this.read();
    const r = state.sessions[name];
    if (!r) return undefined;
    return this.annotate(r);
  }

  /**
   * Return the tail of a session's log file. Returns undefined when the session
   * is untracked; returns "" when the log file does not exist yet.
   * @param lines  number of trailing lines to return (default 40).
   */
  logs(name: string, lines = 40): string | undefined {
    const state = this.read();
    const r = state.sessions[name];
    if (!r) return undefined;
    if (!existsSync(r.logFile)) return "";
    const text = readFileSync(r.logFile, "utf8");
    const all = text.split(/\r?\n/);
    return all.slice(Math.max(0, all.length - lines)).join("\n");
  }
}

export { EMPTY_STATE };
