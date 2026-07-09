// Configuration validation. Pure functions, no I/O. Never throws.
//
// This is a hand-rolled validator (zero runtime deps). It mirrors the
// JSON-Schema shipped in docs/streamrelay.schema.json; keep them in sync.

import type {
  InputKind,
  OutputKind,
  RelayConfig,
  RelayInput,
  RelayOutput,
  ValidationResult,
} from "./types.js";

const INPUT_SCHEMES = ["rtmp://", "rtmps://", "srt://", "http://", "https://", "udp://"];
const OUTPUT_SCHEMES = ["rtmp://", "rtmps://", "srt://"];

const INPUT_KINDS: InputKind[] = ["rtmp", "srt", "file", "udp", "http", "testsrc", "stdin"];
const OUTPUT_KINDS: OutputKind[] = ["rtmp", "srt", "hls", "file"];

const NAME_RE = /^[A-Za-z0-9._-]+$/;
const RESOLUTION_RE = /^[1-9][0-9]{1,4}x[1-9][0-9]{1,4}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function looksLikePath(s: string): boolean {
  // Reject anything with an explicit scheme://; everything else is a path.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(s)) return false;
  return s.length > 0;
}

/** Infer an input kind from its url (used when `kind` is omitted). */
export function inferInputKind(input: RelayInput): InputKind {
  if (input.kind) return input.kind;
  const u = input.url;
  if (u === "-") return "stdin";
  if (u.startsWith("rtmp://") || u.startsWith("rtmps://")) return "rtmp";
  if (u.startsWith("srt://")) return "srt";
  if (u.startsWith("udp://")) return "udp";
  if (u.startsWith("http://") || u.startsWith("https://")) return "http";
  return "file";
}

/** Infer an output kind from url/extension (used when `kind` is omitted). */
export function inferOutputKind(out: RelayOutput): OutputKind {
  if (out.kind) return out.kind;
  const u = out.url;
  if (u.startsWith("rtmp://") || u.startsWith("rtmps://")) return "rtmp";
  if (u.startsWith("srt://")) return "srt";
  if (u.endsWith(".m3u8")) return "hls";
  return "file";
}

/** True when this output performs any transcoding (not a pure stream copy). */
export function isTranscode(out: RelayOutput): boolean {
  return (out.videoCodec ?? "copy") !== "copy" || (out.audioCodec ?? "copy") !== "copy";
}

function checkPositiveInt(val: unknown, where: string, errors: string[]): void {
  if (typeof val !== "number" || !Number.isFinite(val) || val <= 0 || !Number.isInteger(val)) {
    errors.push(`${where}: must be a positive integer when present`);
  }
}

function validateReconnect(rc: unknown, where: string, errors: string[]): void {
  if (!isPlainObject(rc)) {
    errors.push(`${where}: must be an object`);
    return;
  }
  if (typeof rc.enabled !== "boolean") {
    errors.push(`${where}.enabled: required boolean`);
  }
  if (rc.streamed !== undefined && typeof rc.streamed !== "boolean") {
    errors.push(`${where}.streamed: must be a boolean when present`);
  }
  if (rc.delayMaxSec !== undefined) checkPositiveInt(rc.delayMaxSec, `${where}.delayMaxSec`, errors);
}

function validateOutput(
  out: unknown,
  idx: number,
  seenNames: Set<string>,
  errors: string[],
  warnings: string[]
): void {
  const where = `outputs[${idx}]`;
  if (!isPlainObject(out)) {
    errors.push(`${where}: must be an object`);
    return;
  }
  const o = out as Partial<RelayOutput> & Record<string, unknown>;

  // name
  if (typeof o.name !== "string" || o.name.length === 0) {
    errors.push(`${where}.name: required non-empty string`);
  } else if (!NAME_RE.test(o.name)) {
    errors.push(`${where}.name: "${o.name}" may only contain letters, digits, dot, dash, underscore`);
  } else if (seenNames.has(o.name)) {
    errors.push(`${where}.name: duplicate output name "${o.name}"`);
  } else {
    seenNames.add(o.name);
  }

  // kind (optional, but if present must be valid)
  if (o.kind !== undefined && !OUTPUT_KINDS.includes(o.kind as OutputKind)) {
    errors.push(`${where}.kind: must be one of ${OUTPUT_KINDS.join(", ")}`);
  }

  // url + kind coherence
  if (typeof o.url !== "string" || o.url.length === 0) {
    errors.push(`${where}.url: required non-empty string`);
  } else {
    const kind = (o.kind as OutputKind | undefined) ?? inferOutputKind(o as RelayOutput);
    if (kind === "rtmp" && !(o.url.startsWith("rtmp://") || o.url.startsWith("rtmps://"))) {
      errors.push(`${where}.url: kind "rtmp" requires an rtmp(s):// URL`);
    } else if (kind === "srt" && !o.url.startsWith("srt://")) {
      errors.push(`${where}.url: kind "srt" requires an srt:// URL`);
    } else if ((kind === "hls" || kind === "file") && !looksLikePath(o.url)) {
      errors.push(`${where}.url: kind "${kind}" requires a file path, not a URL`);
    }
  }

  // numeric fields
  for (const field of [
    "videoBitrateKbps",
    "audioBitrateKbps",
    "framerate",
    "gop",
    "hlsSegmentSec",
    "hlsListSize",
  ] as const) {
    if (o[field] !== undefined) checkPositiveInt(o[field], `${where}.${field}`, errors);
  }

  // string fields
  for (const field of ["videoCodec", "audioCodec", "format", "preset"] as const) {
    const val = o[field];
    if (val !== undefined && (typeof val !== "string" || val.length === 0)) {
      errors.push(`${where}.${field}: must be a non-empty string when present`);
    }
  }

  // resolution shape
  if (o.resolution !== undefined) {
    if (typeof o.resolution !== "string" || !RESOLUTION_RE.test(o.resolution)) {
      errors.push(`${where}.resolution: must be "WxH" (e.g. "1280x720")`);
    }
  }

  // reconnect
  if (o.reconnect !== undefined) validateReconnect(o.reconnect, `${where}.reconnect`, errors);

  // ---- combination checks ----
  const transcoding = isTranscode(o as RelayOutput);
  const transcodeOnlyFields: Array<keyof RelayOutput> = [
    "videoBitrateKbps",
    "resolution",
    "framerate",
    "preset",
    "gop",
  ];
  if (!transcoding) {
    for (const f of transcodeOnlyFields) {
      if (o[f] !== undefined) {
        errors.push(
          `${where}.${f}: cannot set a video transcode option while videoCodec is "copy" (set a real videoCodec)`
        );
      }
    }
    if (o.audioBitrateKbps !== undefined && (o.audioCodec ?? "copy") === "copy") {
      errors.push(`${where}.audioBitrateKbps: cannot set audio bitrate while audioCodec is "copy"`);
    }
  } else if ((o.videoCodec ?? "copy") !== "copy" && o.videoBitrateKbps === undefined) {
    warnings.push(
      `${where}: transcoding video without videoBitrateKbps will use ffmpeg's default rate`
    );
  }

  // reconnect only meaningful for network outputs
  const kind = (o.kind as OutputKind | undefined) ?? inferOutputKind(o as RelayOutput);
  const rc = o.reconnect as { enabled?: unknown } | undefined;
  if (rc && isPlainObject(rc) && rc.enabled === true && (kind === "hls" || kind === "file")) {
    warnings.push(`${where}.reconnect: ignored for ${kind} outputs (only network outputs reconnect)`);
  }
}

function validateInput(input: unknown, errors: string[]): void {
  if (!isPlainObject(input)) {
    errors.push("input: required object with a url");
    return;
  }
  const i = input as Partial<RelayInput> & Record<string, unknown>;

  if (i.kind !== undefined && !INPUT_KINDS.includes(i.kind as InputKind)) {
    errors.push(`input.kind: must be one of ${INPUT_KINDS.join(", ")}`);
  }

  const kind = i.kind as InputKind | undefined;

  if (kind === "testsrc") {
    if (i.lavfi !== undefined && (typeof i.lavfi !== "string" || i.lavfi.length === 0)) {
      errors.push("input.lavfi: must be a non-empty string when present");
    }
  } else {
    const url = i.url;
    if (typeof url !== "string" || url.length === 0) {
      errors.push("input.url: required non-empty string");
    } else if (url !== "-" && !INPUT_SCHEMES.some((s) => url.startsWith(s)) && !looksLikePath(url)) {
      errors.push(`input.url: must be "-", a file path, or start with one of ${INPUT_SCHEMES.join(", ")}`);
    } else if (kind !== undefined) {
      const bad =
        (kind === "rtmp" && !(url.startsWith("rtmp://") || url.startsWith("rtmps://"))) ||
        (kind === "srt" && !url.startsWith("srt://")) ||
        (kind === "udp" && !url.startsWith("udp://")) ||
        (kind === "http" && !(url.startsWith("http://") || url.startsWith("https://"))) ||
        (kind === "stdin" && url !== "-") ||
        (kind === "file" && !looksLikePath(url));
      if (bad) errors.push(`input.url: does not match declared kind "${kind}"`);
    }
  }

  if (i.live !== undefined && typeof i.live !== "boolean") {
    errors.push("input.live: must be a boolean when present");
  }
}

/** Validate a parsed config object. Never throws. */
export function validateConfig(cfg: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isPlainObject(cfg)) {
    return { ok: false, errors: ["config: must be a JSON object"], warnings };
  }
  const c = cfg as Partial<RelayConfig> & Record<string, unknown>;

  if (typeof c.name !== "string" || c.name.length === 0) {
    errors.push("name: required non-empty string");
  } else if (!NAME_RE.test(c.name)) {
    errors.push(`name: "${c.name}" may only contain letters, digits, dot, dash, underscore`);
  }

  validateInput(c.input, errors);

  if (!Array.isArray(c.outputs)) {
    errors.push("outputs: required array with at least one output");
  } else if (c.outputs.length === 0) {
    errors.push("outputs: must contain at least one output");
  } else {
    const seen = new Set<string>();
    (c.outputs as unknown[]).forEach((out, i) => validateOutput(out, i, seen, errors, warnings));
  }

  if (c.ffmpegPath !== undefined && (typeof c.ffmpegPath !== "string" || c.ffmpegPath.length === 0)) {
    errors.push("ffmpegPath: must be a non-empty string when present");
  }
  if (c.logLevel !== undefined && (typeof c.logLevel !== "string" || c.logLevel.length === 0)) {
    errors.push("logLevel: must be a non-empty string when present");
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Narrowing helper used by callers once validation has passed. */
export function asRelayConfig(cfg: unknown): RelayConfig {
  const result = validateConfig(cfg);
  if (!result.ok) {
    throw new Error(`invalid config:\n  ${result.errors.join("\n  ")}`);
  }
  return cfg as RelayConfig;
}

export { OUTPUT_SCHEMES, INPUT_SCHEMES, OUTPUT_KINDS, INPUT_KINDS };
