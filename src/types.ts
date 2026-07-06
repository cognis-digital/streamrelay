// Core type definitions for streamrelay relay configurations.
//
// A relay is one INPUT source fanned out to one or more OUTPUT destinations.
// Every field here is plain JSON-serializable data: a config is authored by
// hand (or scaffolded), validated, and turned into an ffmpeg plan.

/** Input source kind. Determines how the input side of ffmpeg is built. */
export type InputKind = "rtmp" | "srt" | "file" | "udp" | "http" | "testsrc" | "stdin";

/** Output transport kind. Determines default container + arg construction. */
export type OutputKind = "rtmp" | "srt" | "hls" | "file";

/** Reconnect / backoff options for a network output (ffmpeg reconnect flags). */
export interface ReconnectOptions {
  /** Enable ffmpeg's automatic reconnection for this output. */
  enabled: boolean;
  /** Also reconnect when the stream was already streaming (`-reconnect_streamed`). */
  streamed?: boolean;
  /** Max seconds to keep retrying a reconnect (`-reconnect_delay_max`). */
  delayMaxSec?: number;
}

/** A single relay output destination. */
export interface RelayOutput {
  /** Stable identifier for this output within the config. */
  name: string;
  /**
   * Destination URL (or file path for `hls`/`file`). One of:
   *   rtmp(s)://…   srt://…   /path/to/out.m3u8 (hls)   /path/to/out.mp4 (file)
   */
  url: string;
  /**
   * Explicit transport kind. When omitted it is inferred from the URL scheme
   * (rtmp/srt) or the file extension (`.m3u8` -> hls, else file).
   */
  kind?: OutputKind;

  // ---- Video ----
  /** Video codec, e.g. "libx264", "copy". Defaults to "copy". */
  videoCodec?: string;
  /** Target video bitrate in kbps. Only applied when videoCodec !== "copy". */
  videoBitrateKbps?: number;
  /** Output resolution "WxH", e.g. "1280x720". Only applied when transcoding. */
  resolution?: string;
  /** Output frame rate in fps. Only applied when transcoding. */
  framerate?: number;
  /** x264/x265 preset, e.g. "veryfast". Only applied when transcoding. */
  preset?: string;
  /** GOP size (keyframe interval, in frames). Only applied when transcoding. */
  gop?: number;

  // ---- Audio ----
  /** Audio codec, e.g. "aac", "copy". Defaults to "copy". */
  audioCodec?: string;
  /** Target audio bitrate in kbps. Only applied when audioCodec !== "copy". */
  audioBitrateKbps?: number;

  // ---- Container / reliability ----
  /** Output container/muxer. Defaults per kind (flv/mpegts/hls/mp4). */
  format?: string;
  /** Reconnect/backoff behavior for network outputs. */
  reconnect?: ReconnectOptions;

  // ---- HLS-specific ----
  /** HLS target segment duration in seconds (`-hls_time`). Default 4. */
  hlsSegmentSec?: number;
  /** HLS playlist window length in segments (`-hls_list_size`). Default 6. */
  hlsListSize?: number;
}

/** Input source for a relay. */
export interface RelayInput {
  /**
   * Source URL or path. Interpreted per `kind`:
   *   rtmp/srt/udp/http -> a URL; file -> a path; stdin -> "-"; testsrc -> ignored.
   */
  url: string;
  /** Explicit input kind. When omitted it is inferred from `url`. */
  kind?: InputKind;
  /** Treat input as a live stream (adds -re for files / low-latency flags for network). */
  live?: boolean;
  /**
   * For `kind: "testsrc"`: a lavfi spec, e.g.
   * "testsrc=size=1280x720:rate=30". A sine audio track is auto-added.
   */
  lavfi?: string;
}

/** A complete relay configuration: one input fanned out to one or more outputs. */
export interface RelayConfig {
  /** Human-friendly relay name. */
  name: string;
  /** The input source. */
  input: RelayInput;
  /** One or more output destinations. */
  outputs: RelayOutput[];
  /** Optional path to the ffmpeg binary. Defaults to "ffmpeg". */
  ffmpegPath?: string;
  /** ffmpeg log level (default "warning"). */
  logLevel?: string;
}

/** Result of validating a config. */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
  /** Non-fatal advisories (surfaced but do not fail validation). */
  warnings: string[];
}
