import { test } from "node:test";
import assert from "node:assert/strict";
import { runDoctor, doctorToString } from "../src/doctor.js";
import { FakeRunner } from "./fakes.js";

test("doctor detects a present ffmpeg and parses its version", () => {
  const runner = new FakeRunner();
  runner.execResponse = {
    code: 0,
    stdout: "ffmpeg version 6.1.1 Copyright (c) 2000-2023 the FFmpeg developers\n",
    stderr: "",
    spawnError: false,
  };
  const rep = runDoctor(runner, "ffmpeg");
  assert.equal(rep.ffmpegFound, true);
  assert.equal(rep.version, "6.1.1");
  assert.equal(rep.bin, "ffmpeg");
  assert.equal(runner.execCalls[0]!.args[0], "-version");
  assert.ok(doctorToString(rep).includes("OK"));
});

test("doctor reports a missing ffmpeg (spawn error)", () => {
  const runner = new FakeRunner();
  runner.execResponse = { code: null, stdout: "", stderr: "ENOENT", spawnError: true };
  const rep = runDoctor(runner, "ffmpeg");
  assert.equal(rep.ffmpegFound, false);
  assert.equal(rep.version, undefined);
  assert.ok(rep.notes.some((n) => n.includes("not on PATH")));
  assert.ok(doctorToString(rep).includes("NOT FOUND"));
});

test("doctor honors a custom binary path", () => {
  const runner = new FakeRunner();
  const rep = runDoctor(runner, "/opt/ffmpeg/bin/ffmpeg");
  assert.equal(rep.bin, "/opt/ffmpeg/bin/ffmpeg");
});

test("doctor handles a binary that runs but is not ffmpeg", () => {
  const runner = new FakeRunner();
  runner.execResponse = { code: 0, stdout: "some other tool v1\n", stderr: "", spawnError: false };
  const rep = runDoctor(runner, "notffmpeg");
  assert.equal(rep.ffmpegFound, false);
});
