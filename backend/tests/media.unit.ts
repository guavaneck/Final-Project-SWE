import assert from "node:assert/strict";
import { test } from "node:test";

// mediaService imports the database client, which needs a URL to load. These tests never query it.
process.env.DATABASE_URL ??= "postgresql://unused@localhost/unused";
const { validateUpload } = await import("../src/services/mediaService.js");
const { checkProbe, parseWebpHeader } = await import("../src/services/mediaInspection.js");

const video = (extra: object = {}) => ({ codec_type: "video", codec_name: "h264", width: 1920, height: 1080, ...extra });
const probe = (streams: object[], duration?: string) => ({ streams, format: { duration } });

const MB = 1024 * 1024;

test("videos and images within their size limits are accepted", () => {
  for (const type of ["video/mp4", "video/webm", "video/quicktime"]) {
    assert.equal(validateUpload(type, 500 * MB), null);
  }
  for (const type of ["image/jpeg", "image/png", "image/gif", "image/webp"]) {
    assert.equal(validateUpload(type, 20 * MB), null);
  }
  assert.equal(validateUpload("video/mp4", 1), null);
});

test("each kind of file has its own size limit", () => {
  assert.match(validateUpload("video/mp4", 500 * MB + 1) ?? "", /at most 500 MB/);
  assert.match(validateUpload("image/png", 20 * MB + 1) ?? "", /at most 20 MB/);
});

test("other types are rejected", () => {
  for (const type of ["application/pdf", "text/html", "image/svg+xml", "video/x-msvideo", "", undefined, 5]) {
    assert.match(validateUpload(type, 100) ?? "", /^mimeType must be one of/);
  }
});

test("sizeBytes must be a positive whole number", () => {
  for (const size of [0, -1, 1.5, "100", undefined, null, Number.NaN]) {
    assert.equal(validateUpload("video/mp4", size), "sizeBytes must be a positive whole number");
  }
});

test("a normal video passes and reports its size and length", () => {
  assert.deepEqual(checkProbe("video/mp4", probe([video(), { codec_type: "audio", codec_name: "aac" }], "12.3456")), {
    ok: true, width: 1920, height: 1080, durationSeconds: 12.346,
  });
});

test("rotated videos report the size people see", () => {
  const result = checkProbe("video/mp4", probe([video({ side_data_list: [{ rotation: -90 }] })], "5"));
  assert.deepEqual(result, { ok: true, width: 1080, height: 1920, durationSeconds: 5 });
});

test("resolution is capped at 8K in either orientation", () => {
  assert.equal(checkProbe("video/mp4", probe([video({ width: 7680, height: 4320 })], "1")).ok, true);
  assert.equal(checkProbe("video/mp4", probe([video({ width: 4320, height: 7680 })], "1")).ok, true);
  assert.match((checkProbe("video/mp4", probe([video({ width: 7681, height: 100 })], "1")) as any).error, /8K/);
  assert.match((checkProbe("image/png", probe([video({ codec_name: "png", width: 5000, height: 5000 })])) as any).error, /8K/);
});

test("videos are capped at 2 hours", () => {
  assert.equal(checkProbe("video/mp4", probe([video()], "7200")).ok, true);
  assert.match((checkProbe("video/mp4", probe([video()], "7200.5")) as any).error, /2 hours/);
});

test("a video with no stated length is kept with no duration", () => {
  assert.deepEqual(checkProbe("video/webm", probe([video({ codec_name: "vp9" })])), {
    ok: true, width: 1920, height: 1080, durationSeconds: null,
  });
});

test("files without a real video track are rejected", () => {
  assert.match((checkProbe("video/mp4", probe([{ codec_type: "audio", codec_name: "aac" }], "3")) as any).error, /no video track/);
  // Only cover art: a picture attached to an audio file.
  assert.match((checkProbe("video/mp4", probe([video({ codec_name: "mjpeg", disposition: { attached_pic: 1 } })], "3")) as any).error, /no video track/);
});

test("WebM must use WebM codecs", () => {
  assert.equal(checkProbe("video/webm", probe([video({ codec_name: "vp9" }), { codec_type: "audio", codec_name: "opus" }], "1")).ok, true);
  assert.equal(checkProbe("video/webm", probe([video({ codec_name: "h264" })], "1")).ok, false);
  assert.equal(checkProbe("video/webm", probe([video({ codec_name: "vp8" }), { codec_type: "audio", codec_name: "aac" }], "1")).ok, false);
});

test("images must contain the declared image format", () => {
  assert.deepEqual(checkProbe("image/jpeg", probe([video({ codec_name: "mjpeg", width: 640, height: 480 })])), {
    ok: true, width: 640, height: 480, durationSeconds: null,
  });
  assert.equal(checkProbe("image/png", probe([video({ codec_name: "mjpeg" })])).ok, false);
  assert.equal(checkProbe("image/png", probe([])).ok, false);
});

test("WebP headers are read for all three WebP layouts", () => {
  const riff = (chunk: string, body: number[]) =>
    Uint8Array.from([..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WEBP"].map((c) => c.charCodeAt(0)), [...chunk].map((c) => c.charCodeAt(0)), [0, 0, 0, 0], body, Array(16).fill(0)));
  // Extended, animated, 640x360 canvas (stored as size minus one).
  assert.deepEqual(parseWebpHeader(riff("VP8X", [0x02, 0, 0, 0, 639 & 0xff, 639 >> 8, 0, 359 & 0xff, 359 >> 8, 0])), { width: 640, height: 360, animated: true });
  // Lossy, 320x240.
  assert.deepEqual(parseWebpHeader(riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, 320 & 0xff, 320 >> 8, 240, 0])), { width: 320, height: 240, animated: false });
  // Lossless, 100x50.
  const bits = 99 | (49 << 14);
  assert.deepEqual(parseWebpHeader(riff("VP8L", [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff])), { width: 100, height: 50, animated: false });
  assert.equal(parseWebpHeader(new TextEncoder().encode("not a webp file at all, definitely not")), null);
});
