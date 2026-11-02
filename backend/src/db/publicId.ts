import { randomBytes } from "node:crypto";

// Crockford base32: no I, L, O or U, so IDs are hard to misread or mistype.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LENGTH = 12;
const FORMAT = /^[0-9A-HJKMNP-TV-Z]{12}$/;

export function generatePublicId(): string {
  // 256 is a multiple of 32, so masking each byte to 5 bits keeps every character equally likely.
  return Array.from(randomBytes(LENGTH), (byte) => ALPHABET[byte & 31]).join("");
}

// Accepts what a person might type (lowercase, I/L for 1, O for 0, dashes) and returns
// the canonical ID, or null if it can't be one.
export function normalizePublicId(input: string): string | null {
  const id = input
    .toUpperCase()
    .replaceAll("-", "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  return FORMAT.test(id) ? id : null;
}
