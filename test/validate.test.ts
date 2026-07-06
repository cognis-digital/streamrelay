import { test } from "node:test";
import assert from "node:assert/strict";
import { validateConfig, inferInputKind, inferOutputKind, isTranscode } from "../src/validate.js";
import { scaffoldConfig } from "../src/scaffold.js";

test("scaffolded configs (all profiles) validate clean", () => {
  for (const p of ["multicast", "transcode", "srt", "testsrc"] as const) {
    const r = validateConfig(scaffoldConfig("relay", p));
    assert.equal(r.ok, true, `${p}: ${r.errors.join("; ")}`);
  }
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
  const r = validateConfig(scaffoldConfig("bad name!"));
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
  cfg.outputs = [{ name: "o", url: "srt://1.2.3.4:9000" }];
  assert.equal(validateConfig(cfg).ok, true);
});

test("accepts hls file output", () => {
  const cfg = scaffoldConfig();
  cfg.outputs = [
    { name: "hls", url: "./out/s.m3u8", videoCodec: "libx264", videoBitrateKbps: 2500, audioCodec: "aac", audioBitrateKbps: 128 },
  ];
  assert.equal(validateConfig(cfg).ok, true);
});

test("kind/url mismatch is rejected", () => {
  const cfg = scaffoldConfig();
  cfg.outputs = [{ name: "o", url: "rtmp://a/b", kind: "srt" }];
  const r = validateConfig(cfg);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('kind "srt"')));
});

test("rejects duplicate output names", () => {
  const cfg = scaffoldConfig();
  cfg.outputs[1]!.name = cfg.outputs[0]!.name;
  const r = validateConfig(cfg);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("duplicate")));
});

test("rejects non-positive / non-integer bitrate", () => {
  const cfg = scaffoldConfig("r", "transcode");
  cfg.outputs[0]!.videoBitrateKbps = -10;
  assert.equal(validateConfig(cfg).ok, false);
  cfg.outputs[0]!.videoBitrateKbps = 3000.5;
  assert.equal(validateConfig(cfg).ok, false);
  cfg.outputs[0]!.videoBitrateKbps = 3000;
  assert.equal(validateConfig(cfg).ok, true);
});

test("rejects transcode options while videoCodec is copy", () => {
  const cfg = scaffoldConfig();
  cfg.outputs[0]!.videoBitrateKbps = 3000; // but codec still copy
  const r = validateConfig(cfg);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("videoCodec is \"copy\"")));
});

test("rejects audio bitrate while audioCodec is copy", () => {
  const cfg = scaffoldConfig();
  cfg.outputs[0]!.audioBitrateKbps = 128;
  const r = validateConfig(cfg);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("audioBitrateKbps")));
});

test("rejects bad resolution shape", () => {
  const cfg = scaffoldConfig("r", "transcode");
  cfg.outputs[0]!.resolution = "1080p";
  const r = validateConfig(cfg);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("resolution")));
});

test("warns when transcoding video without a bitrate", () => {
  const cfg = scaffoldConfig();
  cfg.outputs = [{ name: "o", url: "rtmp://a/b", videoCodec: "libx264" }];
  const r = validateConfig(cfg);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.includes("default rate")));
});

test("validates reconnect object shape", () => {
  const cfg = scaffoldConfig();
  cfg.outputs = [{ name: "o", url: "rtmp://a/b", reconnect: { enabled: "yes" as unknown as boolean } }];
  const r = validateConfig(cfg);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("reconnect.enabled")));
});

test("warns when reconnect set on a file/hls output", () => {
  const cfg = scaffoldConfig();
  cfg.outputs = [
    { name: "o", url: "./x.m3u8", videoCodec: "libx264", videoBitrateKbps: 1, audioCodec: "aac", audioBitrateKbps: 1, reconnect: { enabled: true } },
  ];
  const r = validateConfig(cfg);
  assert.ok(r.warnings.some((w) => w.includes("reconnect")));
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

test("accepts udp input", () => {
  const cfg = scaffoldConfig();
  cfg.input = { url: "udp://239.0.0.1:1234", kind: "udp" };
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

test("rejects invalid input kind", () => {
  const cfg = scaffoldConfig();
  (cfg.input as { kind?: string }).kind = "webrtc";
  const r = validateConfig(cfg);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.startsWith("input.kind")));
});

test("inference helpers", () => {
  assert.equal(inferInputKind({ url: "-" }), "stdin");
  assert.equal(inferInputKind({ url: "srt://h:9000" }), "srt");
  assert.equal(inferInputKind({ url: "/x.mp4" }), "file");
  assert.equal(inferOutputKind({ name: "o", url: "rtmp://a/b" }), "rtmp");
  assert.equal(inferOutputKind({ name: "o", url: "./x.m3u8" }), "hls");
  assert.equal(inferOutputKind({ name: "o", url: "/x.mp4" }), "file");
  assert.equal(isTranscode({ name: "o", url: "rtmp://a/b" }), false);
  assert.equal(isTranscode({ name: "o", url: "rtmp://a/b", videoCodec: "libx264" }), true);
});
