#!/usr/bin/env node
// streamrelay CLI entrypoint. Argument parsing + command dispatch.
// All business logic lives in src/* so it stays unit-testable.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { validateConfig, asRelayConfig } from "./src/validate.js";
import { buildPlan, planToString, planToShell } from "./src/plan.js";
import { ProcessRunner } from "./src/runner.js";
import { SessionManager } from "./src/session.js";
import { scaffoldConfigJson, PROFILES, type ScaffoldProfile } from "./src/scaffold.js";
import { runDoctor, doctorToString } from "./src/doctor.js";

const VERSION = "0.2.0";

function defaultStatePath(): string {
  const dir = process.env.STREAMRELAY_HOME ?? join(homedir(), ".streamrelay");
  return join(dir, "state.json");
}

interface Flags {
  positional: string[];
  options: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Flags {
  const positional: string[] = [];
  const options: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        options[key] = next;
        i++;
      } else {
        options[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, options };
}

function readConfigFile(path: string): unknown {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as unknown;
}

function fail(msg: string): never {
  process.stderr.write(`streamrelay: ${msg}\n`);
  process.exit(1);
}

function stateFrom(flags: Flags): string {
  return typeof flags.options.state === "string" ? flags.options.state : defaultStatePath();
}

const USAGE = `streamrelay v${VERSION} — self-hosted livestream relay control plane

Usage:
  streamrelay validate <config.json>
  streamrelay plan <config.json> [--json | --shell]
  streamrelay start <name> --config <config.json> [--state <path>]
  streamrelay stop <name> [--force] [--state <path>]
  streamrelay restart <name> [--state <path>]
  streamrelay status [--json] [--state <path>]
  streamrelay logs <name> [--lines N] [--state <path>]
  streamrelay doctor [--ffmpeg <path>] [--json]
  streamrelay new [name] [--profile <p>] [--out <config.json>]

Profiles for 'new': ${PROFILES.join(", ")}

Options:
  --json     Emit machine-readable JSON
  --shell    (plan) print a copy-pasteable POSIX shell command
  --config   Path to a relay config JSON file
  --state    Session state file (default ~/.streamrelay/state.json)
  --out      Output path for the scaffolded config
  --force    (stop) SIGKILL instead of graceful SIGTERM
  --lines    (logs) number of trailing lines to show (default 40)
  --ffmpeg   (doctor) ffmpeg binary to probe (default "ffmpeg")

Exit codes: 0 ok, 1 error (validate fails the build/CI gate).
License: COCL 1.0  •  Maintainer: Cognis Digital
`;

function loadCfgOrFail(path: string) {
  let parsed: unknown;
  try {
    parsed = readConfigFile(path);
  } catch (e) {
    fail(`could not read/parse ${path}: ${(e as Error).message}`);
  }
  try {
    return asRelayConfig(parsed);
  } catch (e) {
    fail((e as Error).message);
  }
}

function cmdValidate(flags: Flags): void {
  const path = flags.positional[0];
  if (!path) fail("validate requires a <config.json> path");
  let parsed: unknown;
  try {
    parsed = readConfigFile(path!);
  } catch (e) {
    fail(`could not read/parse ${path}: ${(e as Error).message}`);
  }
  const result = validateConfig(parsed);
  for (const w of result.warnings) process.stderr.write(`  warning: ${w}\n`);
  if (result.ok) {
    process.stdout.write(`OK: ${path} is a valid relay config\n`);
    process.exit(0);
  }
  process.stderr.write(`INVALID: ${path}\n`);
  for (const err of result.errors) process.stderr.write(`  - ${err}\n`);
  process.exit(1);
}

function cmdPlan(flags: Flags): void {
  const path = flags.positional[0];
  if (!path) fail("plan requires a <config.json> path");
  const cfg = loadCfgOrFail(path!);
  const plan = buildPlan(cfg!);
  if (flags.options.json) {
    process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
  } else if (flags.options.shell) {
    process.stdout.write(planToShell(plan) + "\n");
  } else {
    process.stdout.write(planToString(plan) + "\n");
  }
}

function cmdStart(flags: Flags): void {
  const name = flags.positional[0];
  if (!name) fail("start requires a <name>");
  const configPath = flags.options.config;
  if (typeof configPath !== "string") fail("start requires --config <config.json>");
  const cfg = loadCfgOrFail(configPath);
  const mgr = new SessionManager(new ProcessRunner(), stateFrom(flags));
  try {
    const rec = mgr.start(name!, cfg!);
    process.stdout.write(`started "${rec.name}" (pid ${rec.pid}, ${rec.strategy})\n`);
    process.stdout.write(`  log: ${rec.logFile}\n`);
  } catch (e) {
    fail((e as Error).message);
  }
}

function cmdStop(flags: Flags): void {
  const name = flags.positional[0];
  if (!name) fail("stop requires a <name>");
  const mgr = new SessionManager(new ProcessRunner(), stateFrom(flags));
  const stopped = mgr.stop(name!, flags.options.force === true);
  if (stopped) process.stdout.write(`stopped "${name}"\n`);
  else fail(`no tracked session named "${name}"`);
}

function cmdRestart(flags: Flags): void {
  const name = flags.positional[0];
  if (!name) fail("restart requires a <name>");
  const mgr = new SessionManager(new ProcessRunner(), stateFrom(flags));
  try {
    const rec = mgr.restart(name!);
    process.stdout.write(`restarted "${rec.name}" (pid ${rec.pid})\n`);
  } catch (e) {
    fail((e as Error).message);
  }
}

function cmdStatus(flags: Flags): void {
  const mgr = new SessionManager(new ProcessRunner(), stateFrom(flags));
  const sessions = mgr.status();
  if (flags.options.json) {
    process.stdout.write(JSON.stringify(sessions, null, 2) + "\n");
    return;
  }
  if (sessions.length === 0) {
    process.stdout.write("no relay sessions\n");
    return;
  }
  for (const s of sessions) {
    const state = s.alive ? "RUNNING" : "DEAD";
    process.stdout.write(
      `${s.name}\t${state}\tpid ${s.pid}\t${s.strategy}\tup ${s.uptimeSec}s\tsince ${s.startedAt}\n`
    );
  }
}

function cmdLogs(flags: Flags): void {
  const name = flags.positional[0];
  if (!name) fail("logs requires a <name>");
  const lines = typeof flags.options.lines === "string" ? parseInt(flags.options.lines, 10) : 40;
  const mgr = new SessionManager(new ProcessRunner(), stateFrom(flags));
  const out = mgr.logs(name!, Number.isFinite(lines) ? lines : 40);
  if (out === undefined) fail(`no tracked session named "${name}"`);
  const text = out ?? "";
  process.stdout.write(text + (text.length > 0 && !text.endsWith("\n") ? "\n" : ""));
}

function cmdDoctor(flags: Flags): void {
  const bin = typeof flags.options.ffmpeg === "string" ? flags.options.ffmpeg : "ffmpeg";
  const rep = runDoctor(new ProcessRunner(), bin);
  if (flags.options.json) {
    process.stdout.write(JSON.stringify(rep, null, 2) + "\n");
  } else {
    process.stdout.write(doctorToString(rep) + "\n");
  }
  process.exit(rep.ffmpegFound ? 0 : 1);
}

function cmdNew(flags: Flags): void {
  const name = flags.positional[0];
  const profileOpt = flags.options.profile;
  if (typeof profileOpt === "string" && !(PROFILES as string[]).includes(profileOpt)) {
    fail(`unknown profile "${profileOpt}" (choose one of ${PROFILES.join(", ")})`);
  }
  const profile: ScaffoldProfile =
    typeof profileOpt === "string" ? (profileOpt as ScaffoldProfile) : "multicast";
  const json = scaffoldConfigJson(name, profile);
  const out = flags.options.out;
  if (typeof out === "string") {
    if (existsSync(out)) fail(`refusing to overwrite existing file ${out}`);
    writeFileSync(out, json, "utf8");
    process.stdout.write(`wrote ${out}\n`);
  } else {
    process.stdout.write(json);
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write(VERSION + "\n");
    process.exit(0);
  }

  const cmd = argv[0];
  const flags = parseArgs(argv.slice(1));

  switch (cmd) {
    case "validate":
      return cmdValidate(flags);
    case "plan":
      return cmdPlan(flags);
    case "start":
      return cmdStart(flags);
    case "stop":
      return cmdStop(flags);
    case "restart":
      return cmdRestart(flags);
    case "status":
      return cmdStatus(flags);
    case "logs":
      return cmdLogs(flags);
    case "doctor":
      return cmdDoctor(flags);
    case "new":
      return cmdNew(flags);
    default:
      process.stderr.write(`streamrelay: unknown command "${cmd}"\n\n`);
      process.stdout.write(USAGE);
      process.exit(1);
  }
}

main();
