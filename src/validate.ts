// Configuration validation. Pure functions, no I/O.

import type { RelayConfig, RelayOutput, ValidationResult } from "./types.js";

const INPUT_SCHEMES = ["rtmp://", "rtmps://", "srt://", "http://", "https://", "udp://"];
const OUTPUT_SCHEMES = ["rtmp://", "rtmps://", "srt://"];

const NAME_RE = /^[A-Za-z0-9._-]+$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateOutput(out: unknown, idx: number, seenNames: Set<string>, errors: string[]): void {
  const where = `outputs[${idx}]`;
  if (!isPlainObject(out)) {
    errors.push(`${where}: must be an object`);
    return;
  }
  const o = out as Partial<RelayOutput>;

  if (typeof o.name !== "string" || o.name.length === 0) {
    errors.push(`${where}.name: required non-empty string`);
  } else if (!NAME_RE.test(o.name)) {
    errors.push(`${where}.name: "${o.name}" may only contain letters, digits, dot, dash, underscore`);
  } else if (seenNames.has(o.name)) {
    errors.push(`${where}.name: duplicate output name "${o.name}"`);
  } else {
    seenNames.add(o.name);
  }

  if (typeof o.url !== "string" || o.url.length === 0) {
    errors.push(`${where}.url: required non-empty string`);
  } else if (!OUTPUT_SCHEMES.some((s) => o.url!.startsWith(s))) {
    errors.push(`${where}.url: must start with one of ${OUTPUT_SCHEMES.join(", ")}`);
  }

  for (const field of ["videoBitrateKbps", "audioBitrateKbps"] as const) {
    const val = o[field];
    if (val !== undefined) {
      if (typeof val !== "number" || !Number.isFinite(val) || val <= 0 || !Number.isInteger(val)) {
        errors.push(`${where}.${field}: must be a positive integer when present`);
      }
    }
  }

  for (const field of ["videoCodec", "audioCodec", "format"] as const) {
    const val = o[field];
    if (val !== undefined && (typeof val !== "string" || val.length === 0)) {
      errors.push(`${where}.${field}: must be a non-empty string when present`);
    }
  }
}

/** Validate a parsed config object. Never throws. */
export function validateConfig(cfg: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isPlainObject(cfg)) {
    return { ok: false, errors: ["config: must be a JSON object"] };
  }
  const c = cfg as Partial<RelayConfig>;

  if (typeof c.name !== "string" || c.name.length === 0) {
    errors.push("name: required non-empty string");
  } else if (!NAME_RE.test(c.name)) {
    errors.push(`name: "${c.name}" may only contain letters, digits, dot, dash, underscore`);
  }

  if (!isPlainObject(c.input)) {
    errors.push("input: required object with a url");
  } else {
    const inUrl = (c.input as Record<string, unknown>).url;
    if (typeof inUrl !== "string" || inUrl.length === 0) {
      errors.push("input.url: required non-empty string");
    } else if (inUrl !== "-" && !INPUT_SCHEMES.some((s) => inUrl.startsWith(s)) && !looksLikePath(inUrl)) {
      errors.push(`input.url: must be "-", a file path, or start with one of ${INPUT_SCHEMES.join(", ")}`);
    }
    const live = (c.input as Record<string, unknown>).live;
    if (live !== undefined && typeof live !== "boolean") {
      errors.push("input.live: must be a boolean when present");
    }
  }

  if (!Array.isArray(c.outputs)) {
    errors.push("outputs: required array with at least one output");
  } else if (c.outputs.length === 0) {
    errors.push("outputs: must contain at least one output");
  } else {
    const seen = new Set<string>();
    (c.outputs as unknown[]).forEach((out, i) => validateOutput(out, i, seen, errors));
  }

  if (c.ffmpegPath !== undefined && (typeof c.ffmpegPath !== "string" || c.ffmpegPath.length === 0)) {
    errors.push("ffmpegPath: must be a non-empty string when present");
  }

  return { ok: errors.length === 0, errors };
}

function looksLikePath(s: string): boolean {
  // Absolute/relative path or drive-letter path; reject things with an unknown "scheme://"
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(s)) return false;
  return s.length > 0;
}

/** Narrowing helper used by callers once validation has passed. */
export function asRelayConfig(cfg: unknown): RelayConfig {
  const result = validateConfig(cfg);
  if (!result.ok) {
    throw new Error(`invalid config:\n  ${result.errors.join("\n  ")}`);
  }
  return cfg as RelayConfig;
}

export { OUTPUT_SCHEMES, INPUT_SCHEMES };
