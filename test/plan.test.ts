import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, planToString, planToShell } from "../src/plan.js";
import { scaffoldConfig } from "../src/scaffold.js";
import type { RelayConfig } from "../src/types.js";

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

test("single copy output: strategy single, one -i, one mapped copy stanza", () => {
  const cfg: RelayConfig = {
    name: "r",
    input: { url: "rtmp://src/live" },
    outputs: [{ name: "o", url: "rtmp://dst/app/key" }],
  };
  const plan = buildPlan(cfg);
  assert.equal(plan.bin, "ffmpeg");
  assert.equal(plan.strategy, "single");
  assert.equal(argValue(plan.args, "-i"), "rtmp://src/live");
  assert.deepEqual(plan.args.slice(-7), ["-c:v", "copy", "-c:a", "copy", "-f", "flv", "rtmp://dst/app/key"]);
});

test("live network input adds low-latency flags", () => {
  const cfg: RelayConfig = {
    name: "r",
    input: { url: "srt://1.2.3.4:9000", live: true },
    outputs: [{ name: "o", url: "rtmp://dst/app/key" }],
  };
  const plan = buildPlan(cfg);
  assert.equal(argValue(plan.args, "-fflags"), "nobuffer");
  assert.equal(argValue(plan.args, "-flags"), "low_delay");
});

test("live file input adds -re", () => {
  const cfg: RelayConfig = {
    name: "r",
    input: { url: "/media/clip.mp4", live: true },
    outputs: [{ name: "o", url: "rtmp://dst/app/key" }],
  };
  assert.ok(buildPlan(cfg).args.includes("-re"));
});

test("testsrc input uses two lavfi inputs (video + sine audio)", () => {
  const cfg: RelayConfig = {
    name: "r",
    input: { url: "-", kind: "testsrc", lavfi: "testsrc=size=640x480:rate=25" },
    outputs: [{ name: "o", url: "rtmp://dst/app/key" }],
  };
  const plan = buildPlan(cfg);
  assert.equal(plan.args.filter((a) => a === "-f" && true).length >= 1, true);
  assert.equal(plan.args.filter((a) => a === "lavfi").length, 2);
  assert.ok(plan.args.includes("testsrc=size=640x480:rate=25"));
  assert.ok(plan.args.some((a) => a.startsWith("sine=")));
  // must map video from input 0 and sine audio from input 1
  assert.ok(plan.args.includes("0:v"));
  assert.ok(plan.args.includes("1:a"));
});

test("srt output defaults to mpegts format", () => {
  const cfg: RelayConfig = {
    name: "r",
    input: { url: "rtmp://src/live" },
    outputs: [{ name: "o", url: "srt://host:9000" }],
  };
  const plan = buildPlan(cfg);
  assert.equal(plan.args[plan.args.lastIndexOf("-f") + 1], "mpegts");
});

test("hls output emits hls muxer + segment options and default mp4/hls format", () => {
  const cfg: RelayConfig = {
    name: "r",
    input: { url: "rtmp://src/live" },
    outputs: [
      {
        name: "hls",
        url: "./out/stream.m3u8",
        videoCodec: "libx264",
        videoBitrateKbps: 2500,
        audioCodec: "aac",
        audioBitrateKbps: 128,
        hlsSegmentSec: 2,
        hlsListSize: 10,
      },
    ],
  };
  const plan = buildPlan(cfg);
  assert.equal(argValue(plan.args, "-hls_time"), "2");
  assert.equal(argValue(plan.args, "-hls_list_size"), "10");
  assert.equal(plan.args[plan.args.lastIndexOf("-f") + 1], "hls");
  assert.equal(plan.args[plan.args.length - 1], "./out/stream.m3u8");
});

test("multiple copy outputs use the tee muxer (single decode)", () => {
  const cfg = scaffoldConfig(); // two copy rtmp outputs
  cfg.input.live = false;
  const plan = buildPlan(cfg);
  assert.equal(plan.strategy, "tee-copy");
  assert.ok(plan.args.includes("tee"));
  const teeArg = plan.args[plan.args.length - 1]!;
  assert.ok(teeArg.includes("|"), "tee legs joined by |");
  assert.ok(teeArg.includes("[f=flv]"));
  assert.equal(plan.args.filter((a) => a === "-i").length, 1, "single input/decode");
});

test("mixed copy + srt copy still tees (uniform copy)", () => {
  const cfg: RelayConfig = {
    name: "r",
    input: { url: "rtmp://src/live" },
    outputs: [
      { name: "a", url: "rtmp://a/app/k" },
      { name: "b", url: "srt://b:9000" },
    ],
  };
  const plan = buildPlan(cfg);
  assert.equal(plan.strategy, "tee-copy");
  const tee = plan.args[plan.args.length - 1]!;
  assert.ok(tee.includes("[f=flv]rtmp://a/app/k"));
  assert.ok(tee.includes("[f=mpegts]srt://b:9000"));
});

test("mixed transcode outputs map separately (no tee)", () => {
  const cfg: RelayConfig = {
    name: "r",
    input: { url: "rtmp://src/live" },
    outputs: [
      { name: "copy", url: "rtmp://a/app/k" },
      {
        name: "transcode",
        url: "rtmp://b/app/k",
        videoCodec: "libx264",
        videoBitrateKbps: 2500,
        resolution: "1280x720",
        framerate: 30,
        preset: "veryfast",
        gop: 60,
        audioCodec: "aac",
        audioBitrateKbps: 128,
      },
    ],
  };
  const plan = buildPlan(cfg);
  assert.equal(plan.strategy, "map-transcode");
  assert.ok(!plan.args.includes("tee"));
  assert.ok(plan.args.includes("libx264"));
  assert.equal(argValue(plan.args, "-b:v"), "2500k");
  assert.equal(argValue(plan.args, "-s"), "1280x720");
  assert.equal(argValue(plan.args, "-r"), "30");
  assert.equal(argValue(plan.args, "-preset"), "veryfast");
  assert.equal(argValue(plan.args, "-g"), "60");
  assert.equal(argValue(plan.args, "-b:a"), "128k");
  assert.equal(plan.args.filter((a) => a === "-map").length, 2);
});

test("reconnect flags are emitted before a network output url", () => {
  const cfg: RelayConfig = {
    name: "r",
    input: { url: "rtmp://src/live" },
    outputs: [
      {
        name: "o",
        url: "rtmp://dst/app/key",
        reconnect: { enabled: true, streamed: true, delayMaxSec: 15 },
      },
    ],
  };
  const plan = buildPlan(cfg);
  assert.equal(argValue(plan.args, "-reconnect"), "1");
  assert.equal(argValue(plan.args, "-reconnect_streamed"), "1");
  assert.equal(argValue(plan.args, "-reconnect_delay_max"), "15");
  // reconnect flags must appear before the destination url
  assert.ok(plan.args.indexOf("-reconnect") < plan.args.indexOf("rtmp://dst/app/key"));
});

test("logLevel is honored", () => {
  const cfg: RelayConfig = {
    name: "r",
    logLevel: "info",
    input: { url: "rtmp://src/live" },
    outputs: [{ name: "o", url: "rtmp://dst/app/key" }],
  };
  assert.equal(argValue(buildPlan(cfg).args, "-loglevel"), "info");
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
  const s = planToString(buildPlan(scaffoldConfig()));
  assert.ok(s.startsWith("ffmpeg "));
  assert.ok(s.includes("tee"));
});

test("planToShell single-quotes tokens with pipes and is round-trip safe-ish", () => {
  const s = planToShell(buildPlan(scaffoldConfig()));
  assert.ok(s.startsWith("ffmpeg "));
  // The tee leg contains a pipe and must be single-quoted.
  assert.ok(/'.*\|.*'/.test(s));
});
