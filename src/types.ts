// Core type definitions for streamrelay relay configurations.

/** A single relay output destination. */
export interface RelayOutput {
  /** Stable identifier for this output within the config. */
  name: string;
  /** Destination URL. Must be rtmp(s):// or srt:// */
  url: string;
  /** Target video bitrate in kbps. When omitted the stream is copied (-c:v copy). */
  videoBitrateKbps?: number;
  /** Target audio bitrate in kbps. When omitted audio is copied (-c:a copy). */
  audioBitrateKbps?: number;
  /** Video codec, e.g. "libx264", "copy". Defaults to "copy". */
  videoCodec?: string;
  /** Audio codec, e.g. "aac", "copy". Defaults to "copy". */
  audioCodec?: string;
  /** Output container format. Defaults to "flv" for rtmp, "mpegts" for srt. */
  format?: string;
}

/** Input source for a relay. */
export interface RelayInput {
  /** Source URL or path: rtmp(s)://, srt://, http(s)://, file path, or "-" for stdin. */
  url: string;
  /** Treat input as a live stream (adds -re for files / -fflags nobuffer for live). */
  live?: boolean;
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
}

/** Result of validating a config. */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
}
