#!/usr/bin/env node
// streamrelay CLI entrypoint. Argument parsing + command dispatch.
// All business logic lives in src/* so it stays unit-testable.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { validateConfig, asRelayConfig } from "./src/validate.js";
import { buildPlan, planToString } from "./src/plan.js";
import { ProcessRunner } from "./src/runner.js";
import { SessionManager } from "./src/session.js";
import { scaffoldConfigJson } from "./src/scaffold.js";

const VERSION = "0.1.0";

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

const USAGE = `streamrelay v${VERSION} — self-hosted livestream relay control plane

Usage:
  streamrelay validate <config.json>
  streamrelay plan <config.json> [--json]
  streamrelay start <name> --config <config.json> [--state <path>]
  streamrelay stop <name> [--state <path>]
  streamrelay status [--json] [--state <path>]
  streamrelay new [name] [--out <config.json>]

Options:
  --json    Emit machine-readable JSON
  --config  Path to a relay config JSON file
  --state   Path to the session state file (default ~/.streamrelay/state.json)
  --out     Output path for the scaffolded config

Exit codes: 0 ok, 1 error (validate fails the build/CI gate).
License: COCL 1.0  •  Maintainer: Cognis Digital
`;

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
  let parsed: unknown;
  try {
    parsed = readConfigFile(path!);
  } catch (e) {
    fail(`could not read/parse ${path}: ${(e as Error).message}`);
  }
  let cfg;
  try {
    cfg = asRelayConfig(parsed);
  } catch (e) {
    fail((e as Error).message);
  }
  const plan = buildPlan(cfg!);
  if (flags.options.json) {
    process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
  } else {
    process.stdout.write(planToString(plan) + "\n");
  }
}

function cmdStart(flags: Flags): void {
  const name = flags.positional[0];
  if (!name) fail("start requires a <name>");
  const configPath = flags.options.config;
  if (typeof configPath !== "string") fail("start requires --config <config.json>");
  let cfg;
  try {
    cfg = asRelayConfig(readConfigFile(configPath));
  } catch (e) {
    fail((e as Error).message);
  }
  const statePath = typeof flags.options.state === "string" ? flags.options.state : defaultStatePath();
  const mgr = new SessionManager(new ProcessRunner(), statePath);
  try {
    const rec = mgr.start(name!, cfg!);
    process.stdout.write(`started "${rec.name}" (pid ${rec.pid})\n`);
  } catch (e) {
    fail((e as Error).message);
  }
}

function cmdStop(flags: Flags): void {
  const name = flags.positional[0];
  if (!name) fail("stop requires a <name>");
  const statePath = typeof flags.options.state === "string" ? flags.options.state : defaultStatePath();
  const mgr = new SessionManager(new ProcessRunner(), statePath);
  const stopped = mgr.stop(name!);
  if (stopped) process.stdout.write(`stopped "${name}"\n`);
  else fail(`no tracked session named "${name}"`);
}

function cmdStatus(flags: Flags): void {
  const statePath = typeof flags.options.state === "string" ? flags.options.state : defaultStatePath();
  const mgr = new SessionManager(new ProcessRunner(), statePath);
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
    process.stdout.write(`${s.name}\t${state}\tpid ${s.pid}\tsince ${s.startedAt}\n`);
  }
}

function cmdNew(flags: Flags): void {
  const name = flags.positional[0];
  const json = scaffoldConfigJson(name);
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
    case "status":
      return cmdStatus(flags);
    case "new":
      return cmdNew(flags);
    default:
      process.stderr.write(`streamrelay: unknown command "${cmd}"\n\n`);
      process.stdout.write(USAGE);
      process.exit(1);
  }
}

main();
