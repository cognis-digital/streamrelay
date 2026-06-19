import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, loadState } from "../src/session.js";
import { FakeRunner } from "./fakes.js";
import { scaffoldConfig } from "../src/scaffold.js";
import type { RelayConfig } from "../src/types.js";

function tmpState(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "streamrelay-test-"));
  const path = join(dir, "state.json");
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const cfg: RelayConfig = scaffoldConfig("relay-a");

test("start spawns through the runner and persists state", () => {
  const { path, cleanup } = tmpState();
  try {
    const runner = new FakeRunner();
    const mgr = new SessionManager(runner, path);
    const rec = mgr.start("relay-a", cfg);
    assert.equal(runner.spawned.length, 1);
    assert.equal(rec.pid, runner.spawned[0]!.pid);
    assert.equal(rec.bin, "ffmpeg");
    assert.ok(existsSync(path));
    const onDisk = loadState(path);
    assert.ok(onDisk.sessions["relay-a"]);
    assert.equal(onDisk.sessions["relay-a"]!.pid, rec.pid);
  } finally {
    cleanup();
  }
});

test("start refuses a duplicate live session", () => {
  const { path, cleanup } = tmpState();
  try {
    const runner = new FakeRunner();
    const mgr = new SessionManager(runner, path);
    mgr.start("relay-a", cfg);
    assert.throws(() => mgr.start("relay-a", cfg), /already running/);
    assert.equal(runner.spawned.length, 1);
  } finally {
    cleanup();
  }
});

test("start re-uses the name slot if the prior process died", () => {
  const { path, cleanup } = tmpState();
  try {
    const runner = new FakeRunner();
    const mgr = new SessionManager(runner, path);
    const first = mgr.start("relay-a", cfg);
    runner.simulateExit(first.pid);
    const second = mgr.start("relay-a", cfg);
    assert.notEqual(first.pid, second.pid);
    assert.equal(runner.spawned.length, 2);
  } finally {
    cleanup();
  }
});

test("stop kills and untracks", () => {
  const { path, cleanup } = tmpState();
  try {
    const runner = new FakeRunner();
    const mgr = new SessionManager(runner, path);
    const rec = mgr.start("relay-a", cfg);
    const ok = mgr.stop("relay-a");
    assert.equal(ok, true);
    assert.deepEqual(runner.killed, [rec.pid]);
    assert.equal(mgr.status().length, 0);
    assert.equal(loadState(path).sessions["relay-a"], undefined);
  } finally {
    cleanup();
  }
});

test("stop on unknown name returns false", () => {
  const { path, cleanup } = tmpState();
  try {
    const mgr = new SessionManager(new FakeRunner(), path);
    assert.equal(mgr.stop("nope"), false);
  } finally {
    cleanup();
  }
});

test("status reports liveness and is sorted", () => {
  const { path, cleanup } = tmpState();
  try {
    const runner = new FakeRunner();
    const mgr = new SessionManager(runner, path);
    const b = mgr.start("zeta", scaffoldConfig("zeta"));
    mgr.start("alpha", scaffoldConfig("alpha"));
    runner.simulateExit(b.pid);
    const st = mgr.status();
    assert.equal(st.length, 2);
    assert.equal(st[0]!.name, "alpha");
    assert.equal(st[0]!.alive, true);
    assert.equal(st[1]!.name, "zeta");
    assert.equal(st[1]!.alive, false);
  } finally {
    cleanup();
  }
});

test("statusOf returns one session or undefined", () => {
  const { path, cleanup } = tmpState();
  try {
    const mgr = new SessionManager(new FakeRunner(), path);
    mgr.start("relay-a", cfg);
    assert.ok(mgr.statusOf("relay-a"));
    assert.equal(mgr.statusOf("ghost"), undefined);
  } finally {
    cleanup();
  }
});

test("loadState tolerates a missing or corrupt file", () => {
  const { path, cleanup } = tmpState();
  try {
    assert.deepEqual(loadState(path), { sessions: {} });
    writeFileSync(path, "{ not json", "utf8");
    assert.deepEqual(loadState(path), { sessions: {} });
  } finally {
    cleanup();
  }
});

test("state file is valid JSON with two-space indent", () => {
  const { path, cleanup } = tmpState();
  try {
    const mgr = new SessionManager(new FakeRunner(), path);
    mgr.start("relay-a", cfg);
    const text = readFileSync(path, "utf8");
    assert.doesNotThrow(() => JSON.parse(text));
    assert.ok(text.includes('\n  "sessions"'));
  } finally {
    cleanup();
  }
});
