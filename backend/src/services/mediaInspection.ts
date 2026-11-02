// Checks that an uploaded file really is what the client said it was, and reads its dimensions and length.
// Belongs here: e.g. running ffprobe on a stored video and rejecting it if it's not a playable MP4 or is longer than 2 hours.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import * as storage from "../storage/objectStorage.js";

// Generous ceilings that only stop abuse: 8K in either orientation, and 2 hours of video.
export const MAX_LONG_SIDE = 7680;
export const MAX_SHORT_SIDE = 4320;
export const MAX_DURATION_SECONDS = 2 * 60 * 60;

// ffprobe is told which demuxer to use instead of guessing from the file. A file that isn't really the
// declared type then fails to parse, and formats that fetch other URLs (like HLS playlists) are never used.
const DEMUXERS: Record<string, string> = {
  "video/mp4": "mov",
  "video/quicktime": "mov",
  "video/webm": "matroska",
  "image/jpeg": "jpeg_pipe",
  "image/png": "png_pipe",
  "image/gif": "gif",
  "image/webp": "webp_pipe",
};

const IMAGE_CODECS: Record<string, string> = {
  "image/jpeg": "mjpeg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

// The matroska demuxer also reads .mkv files, so WebM is checked by codec too.
const WEBM_VIDEO_CODECS = ["vp8", "vp9", "av1"];
const WEBM_AUDIO_CODECS = ["opus", "vorbis"];

export interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  disposition?: { attached_pic?: number };
  side_data_list?: { rotation?: number }[];
  tags?: { rotate?: string };
}

export interface ProbeResult {
  streams?: ProbeStream[];
  format?: { format_name?: string; duration?: string };
}

export type Inspection =
  | { ok: true; width: number; height: number; durationSeconds: number | null }
  | { ok: false; error: string };

const fail = (error: string): Inspection => ({ ok: false, error });

export function checkDimensions(width: number, height: number): string | null {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  return long > MAX_LONG_SIDE || short > MAX_SHORT_SIDE
    ? `Media can be at most ${MAX_LONG_SIDE}x${MAX_SHORT_SIDE} (8K)`
    : null;
}

// Decides whether ffprobe's view of a file matches the declared type and the limits.
export function checkProbe(mimeType: string, probe: ProbeResult): Inspection {
  const isVideo = mimeType.startsWith("video/");
  const streams = probe.streams ?? [];
  // Cover art in an MP4 shows up as a one-frame video stream; it isn't the video.
  const visual = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  if (!visual) return fail(isVideo ? "The file has no video track" : `The file isn't a valid ${mimeType} image`);

  if (!isVideo && visual.codec_name !== IMAGE_CODECS[mimeType]) {
    return fail(`The file isn't a valid ${mimeType} image`);
  }
  if (mimeType === "video/webm") {
    const audioOk = streams
      .filter((s) => s.codec_type === "audio")
      .every((s) => WEBM_AUDIO_CODECS.includes(s.codec_name ?? ""));
    if (!WEBM_VIDEO_CODECS.includes(visual.codec_name ?? "") || !audioOk) {
      return fail("WebM videos must use VP8, VP9, or AV1 video and Opus or Vorbis audio");
    }
  }

  let { width, height } = visual;
  // An image demuxer fed the wrong kind of image reports a stream it couldn't decode, with no size.
  if (!width || !height || width < 1 || height < 1) {
    return fail(isVideo ? "Couldn't read the video's dimensions" : `The file isn't a valid ${mimeType} image`);
  }
  // Phone videos are often stored sideways with a rotation flag; report the size people actually see.
  const rotation = visual.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? Number(visual.tags?.rotate ?? 0);
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  const sizeError = checkDimensions(width, height);
  if (sizeError) return fail(sizeError);

  if (!isVideo) return { ok: true, width, height, durationSeconds: null };

  // Some files (e.g. WebM recorded in a browser) don't state a length up front; those are kept with no duration.
  const duration = Number(probe.format?.duration ?? visual.duration);
  const durationSeconds = Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) / 1000 : null;
  if (durationSeconds !== null && durationSeconds > MAX_DURATION_SECONDS) {
    return fail(`Videos can be at most ${MAX_DURATION_SECONDS / 3600} hours long`);
  }
  return { ok: true, width, height, durationSeconds };
}

// Reads a WebP file's header. Returns null if it isn't one.
export function parseWebpHeader(bytes: Uint8Array): { width: number; height: number; animated: boolean } | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length < 30 || ascii(0, 4) !== "RIFF" || ascii(8, 12) !== "WEBP") return null;
  const u24 = (i: number) => bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16);

  switch (ascii(12, 16)) {
    case "VP8X": // Extended format: flags, then the canvas size minus one as 24-bit numbers.
      return { width: u24(24) + 1, height: u24(27) + 1, animated: (bytes[20]! & 0x02) !== 0 };
    case "VP8 ": // Lossy: a 3-byte frame tag and start code, then 14-bit width and height.
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
      return {
        width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff,
        height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff,
        animated: false,
      };
    case "VP8L": { // Lossless: a signature byte, then width and height minus one packed into 14 bits each.
      if (bytes[20] !== 0x2f) return null;
      const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, animated: false };
    }
    default:
      return null;
  }
}

let ffprobePath: string | undefined;
function ffprobe(): string {
  // FFPROBE_PATH overrides the bundled binary, e.g. to use a system install.
  ffprobePath ??=
    process.env.FFPROBE_PATH ??
    (createRequire(import.meta.url)("@ffprobe-installer/ffprobe") as { path: string }).path;
  return ffprobePath;
}

const PROBE_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_PROBE_OUTPUT = 1024 * 1024;

// Streams a stored file into ffprobe. Returns null if the file can't be parsed as the given format.
// Throws if ffprobe couldn't run, crashed, timed out, or the file couldn't be read from storage;
// those aren't the uploader's fault, so the upload stays pending and can be retried.
//
// The file goes in through stdin rather than as a URL: ffprobe then never touches the network or
// filesystem (only the "pipe" protocol is allowed, which also stops MP4s that reference external files),
// and it stops reading as soon as it has what it needs.
async function runFfprobe(objectKey: string, demuxer: string): Promise<ProbeResult | null> {
  const args = [
    "-v", "error",
    "-protocol_whitelist", "pipe",
    "-f", demuxer,
    "-print_format", "json",
    "-show_format", "-show_streams",
    "-i", "pipe:0",
  ];
  const source = await storage.openObjectStream(objectKey);

  return new Promise((resolve, reject) => {
    const child = spawn(ffprobe(), args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let storageError: Error | undefined;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, PROBE_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_PROBE_OUTPUT) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_PROBE_OUTPUT) stderr += chunk;
    });
    // ffprobe closes stdin once it has read enough; that isn't an error.
    child.stdin.on("error", () => {});
    source.on("error", (err) => {
      storageError = err;
      child.kill("SIGKILL");
    });
    source.pipe(child.stdin);

    child.on("error", (err) => {
      clearTimeout(timer);
      source.destroy();
      reject(err); // e.g. the ffprobe binary is missing
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      source.destroy();
      if (storageError) return reject(storageError);
      if (timedOut) return reject(new Error(`ffprobe timed out after ${PROBE_TIMEOUT_MS / 1000}s`));
      if (signal) return reject(new Error(`ffprobe was killed by ${signal}: ${stderr.trim()}`));
      if (code !== 0) return resolve(null);
      try {
        resolve(JSON.parse(stdout) as ProbeResult);
      } catch {
        resolve(null);
      }
    });
  });
}

// Inspects a stored file: reads it with ffprobe and checks it against the declared type and the limits.
export async function inspectStoredFile(objectKey: string, mimeType: string): Promise<Inspection> {
  const demuxer = DEMUXERS[mimeType];
  if (!demuxer) return fail(`${mimeType} files aren't supported`);

  const invalid = fail(mimeType.startsWith("video/") ? `The file isn't a valid ${mimeType} video` : `The file isn't a valid ${mimeType} image`);

  // This ffprobe build can't decode animated WebP, so those are checked by their header instead.
  if (mimeType === "image/webp") {
    const header = parseWebpHeader(await storage.readObjectStart(objectKey, 32));
    if (!header) return invalid;
    if (header.animated) {
      const sizeError = checkDimensions(header.width, header.height);
      return sizeError ? fail(sizeError) : { ok: true, width: header.width, height: header.height, durationSeconds: null };
    }
  }

  const probe = await runFfprobe(objectKey, demuxer);
  return probe ? checkProbe(mimeType, probe) : invalid;
}
