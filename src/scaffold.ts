// Scaffolding helper for `streamrelay new`.
//
// Ships a few named profiles so `new --profile <p>` produces a ready-to-edit
// config for a common shape.

import type { RelayConfig } from "./types.js";

export type ScaffoldProfile = "multicast" | "transcode" | "srt" | "testsrc";

export const PROFILES: ScaffoldProfile[] = ["multicast", "transcode", "srt", "testsrc"];

/** Produce a starter config object for the given profile. */
export function scaffoldConfig(name = "my-relay", profile: ScaffoldProfile = "multicast"): RelayConfig {
  switch (profile) {
    case "transcode":
      return {
        name,
        input: { url: "rtmp://localhost:1935/live/source", live: true },
        outputs: [
          {
            name: "twitch-1080p",
            url: "rtmp://live.twitch.tv/app/STREAM_KEY",
            videoCodec: "libx264",
            videoBitrateKbps: 6000,
            resolution: "1920x1080",
            framerate: 30,
            preset: "veryfast",
            gop: 60,
            audioCodec: "aac",
            audioBitrateKbps: 160,
          },
          {
            name: "youtube-720p",
            url: "rtmp://a.rtmp.youtube.com/live2/STREAM_KEY",
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
    case "srt":
      return {
        name,
        input: { url: "srt://ingest.internal:9000", kind: "srt", live: true },
        outputs: [
          {
            name: "contribution",
            url: "srt://distribution.internal:9001",
            reconnect: { enabled: true, delayMaxSec: 10 },
          },
        ],
      };
    case "testsrc":
      return {
        name,
        input: { url: "-", kind: "testsrc", lavfi: "testsrc=size=1280x720:rate=30" },
        outputs: [
          {
            name: "local-hls",
            url: "./out/stream.m3u8",
            kind: "hls",
            videoCodec: "libx264",
            videoBitrateKbps: 2500,
            preset: "veryfast",
            audioCodec: "aac",
            audioBitrateKbps: 128,
          },
        ],
      };
    case "multicast":
    default:
      return {
        name,
        input: { url: "rtmp://localhost:1935/live/source", live: true },
        outputs: [
          { name: "twitch", url: "rtmp://live.twitch.tv/app/STREAM_KEY" },
          { name: "youtube", url: "rtmp://a.rtmp.youtube.com/live2/STREAM_KEY" },
        ],
      };
  }
}

/** Render a starter config as pretty JSON text. */
export function scaffoldConfigJson(name?: string, profile: ScaffoldProfile = "multicast"): string {
  return JSON.stringify(scaffoldConfig(name, profile), null, 2) + "\n";
}
