// Scaffolding helper for `streamrelay new`.

import type { RelayConfig } from "./types.js";

/** Produce a starter config object. */
export function scaffoldConfig(name = "my-relay"): RelayConfig {
  return {
    name,
    input: {
      url: "rtmp://localhost:1935/live/source",
      live: true,
    },
    outputs: [
      {
        name: "twitch",
        url: "rtmp://live.twitch.tv/app/STREAM_KEY",
      },
      {
        name: "youtube",
        url: "rtmp://a.rtmp.youtube.com/live2/STREAM_KEY",
      },
    ],
  };
}

/** Render a starter config as pretty JSON text. */
export function scaffoldConfigJson(name?: string): string {
  return JSON.stringify(scaffoldConfig(name), null, 2) + "\n";
}
