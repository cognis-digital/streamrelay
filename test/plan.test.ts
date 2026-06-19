import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, planToString } from "../src/plan.js";
import { scaffoldConfig } from "../src/scaffold.js";
import type { RelayConfig } from "../src/types.js";

test("single copy output: one -i, one -f flv, url", () => {
  const cfg: RelayConfig = {
    name: "r",
    input: { url: "rtmp://src/live" },
    outputs: [{ name: "o", url: "rtmp://dst/app/key" }],
  };
  const plan = buildPlan(cfg);
  assert.equal(plan.bin, "ffmpeg");
  assert.ok(plan.args.includes("-i"));
  assert.equal(plan.args[plan.args.indexOf("-i") + 1], "rtmp://src/live");
  assert.deepEqual(plan.args.slice(-7), ["-c:v", "copy", "-c:a", "copy", "-f", "flv", "rtmp://dst/app/key"]);
});

test("live network input adds nobuffer", () => {
  const cfg: RelayConfig = {
    name: "r",
    input: { url: "srt://1.2.3.4:9000", live: true },
    outputs: [{ name: "o", url: "rtmp://dst/app/key" }],
  };
  const plan = buildPlan(cfg);
  assert.ok(plan.args.includes("-fflags"));
  assert.equal(plan.args[plan.args.indexOf("-fflags") + 1], "nobuffer");
});

test("live file input adds -re", () => {
  const cfg: RelayConfig = {
    name: "r",
    input: { url: "/media/clip.mp4", live: true },
    outputs: [{ name: "o", url: "rtmp://dst/app/key" }],
  };
  const plan = buildPlan(cfg);
  assert.ok(plan.args.includes("-re"));
});

test("srt output defaults to mpegts format", () => {
  const cfg: RelayConfig = {
    name: "r",
    input: { url: "rtmp://src/live" },
    outputs: [{ name: "o", url: "srt://host:9000" }],
  };
  const plan = buildPlan(cfg);
  const fIdx = plan.args.lastIndexOf("-f");
  assert.equal(plan.args[fIdx + 1], "mpegts");
});

test("multiple copy outputs use the tee muxer", () => {
  const cfg = scaffoldConfig(); // two copy outputs
  cfg.input.live = false;
  const plan = buildPlan(cfg);
  assert.ok(plan.args.includes("tee"));
  const teeArg = plan.args[plan.args.length - 1]!;
  assert.ok(teeArg.includes("|"), "tee legs joined by |");
  assert.ok(teeArg.includes("[f=flv]"));
  assert.equal(plan.args.filter((a) => a === "-i").length, 1, "single input/decode");
});

test("mixed transcode outputs map separately (no tee)", () => {
  const cfg: RelayConfig = {
    name: "r",
    input: { url: "rtmp://src/live" },
    outputs: [
      { name: "copy", url: "rtmp://a/app/k" },
      { name: "transcode", url: "rtmp://b/app/k", videoCodec: "libx264", videoBitrateKbps: 2500, audioCodec: "aac", audioBitrateKbps: 128 },
    ],
  };
  const plan = buildPlan(cfg);
  assert.ok(!plan.args.includes("tee"));
  assert.ok(plan.args.includes("libx264"));
  assert.equal(plan.args[plan.args.indexOf("-b:v") + 1], "2500k");
  assert.equal(plan.args[plan.args.indexOf("-b:a") + 1], "128k");
  // two -map stanzas
  assert.equal(plan.args.filter((a) => a === "-map").length, 2);
});

test("custom ffmpegPath is honored", () => {
  const cfg: RelayConfig = {
    name: "r",
    ffmpegPath: "/opt/ffmpeg/bin/ffmpeg",
    input: { url: "rtmp://src/live" },
    outputs: [{ name: "o", url: "rtmp://dst/app/key" }],
  };
  assert.equal(buildPlan(cfg).bin, "/opt/ffmpeg/bin/ffmpeg");
});

test("planToString quotes the tee leg", () => {
  const cfg = scaffoldConfig();
  const s = planToString(buildPlan(cfg));
  assert.ok(s.startsWith("ffmpeg "));
  assert.ok(s.includes("tee"));
});
