import { test } from "node:test";
import assert from "node:assert/strict";
import { validateConfig } from "../src/validate.js";
import { scaffoldConfig } from "../src/scaffold.js";

test("scaffolded config validates clean", () => {
  const r = validateConfig(scaffoldConfig());
  assert.equal(r.ok, true, r.errors.join("; "));
});

test("rejects non-object", () => {
  assert.equal(validateConfig("nope").ok, false);
  assert.equal(validateConfig(null).ok, false);
  assert.equal(validateConfig([]).ok, false);
});

test("requires a name", () => {
  const r = validateConfig({ input: { url: "rtmp://x/y" }, outputs: [{ name: "a", url: "rtmp://h/k" }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.startsWith("name:")));
});

test("rejects bad name characters", () => {
  const cfg = scaffoldConfig("bad name!");
  const r = validateConfig(cfg);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("letters, digits")));
});

test("requires at least one output", () => {
  const cfg = scaffoldConfig();
  cfg.outputs = [];
  const r = validateConfig(cfg);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("at least one")));
});

test("rejects non-rtmp/srt output url", () => {
  const cfg = scaffoldConfig();
  cfg.outputs[0]!.url = "http://example.com/x";
  const r = validateConfig(cfg);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("outputs[0].url")));
});

test("accepts srt output url", () => {
  const cfg = scaffoldConfig();
  cfg.outputs[0]!.url = "srt://1.2.3.4:9000";
  cfg.outputs = [cfg.outputs[0]!];
  assert.equal(validateConfig(cfg).ok, true);
});

test("rejects duplicate output names", () => {
  const cfg = scaffoldConfig();
  cfg.outputs[1]!.name = cfg.outputs[0]!.name;
  const r = validateConfig(cfg);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("duplicate")));
});

test("rejects non-positive / non-integer bitrate", () => {
  const cfg = scaffoldConfig();
  cfg.outputs[0]!.videoBitrateKbps = -10;
  assert.equal(validateConfig(cfg).ok, false);
  cfg.outputs[0]!.videoBitrateKbps = 3000.5;
  assert.equal(validateConfig(cfg).ok, false);
  cfg.outputs[0]!.videoBitrateKbps = 3000;
  assert.equal(validateConfig(cfg).ok, true);
});

test("accepts file-path input", () => {
  const cfg = scaffoldConfig();
  cfg.input.url = "/srv/media/source.mp4";
  cfg.outputs = [cfg.outputs[0]!];
  assert.equal(validateConfig(cfg).ok, true);
});

test("accepts stdin input '-'", () => {
  const cfg = scaffoldConfig();
  cfg.input.url = "-";
  cfg.outputs = [cfg.outputs[0]!];
  assert.equal(validateConfig(cfg).ok, true);
});

test("rejects unknown input scheme", () => {
  const cfg = scaffoldConfig();
  cfg.input.url = "ftp://host/file";
  const r = validateConfig(cfg);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.startsWith("input.url")));
});
