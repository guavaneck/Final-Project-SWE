import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt:${salt.toString("base64url")}:${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, encodedSalt, encodedHash] = storedHash.split(":");
  if (algorithm !== "scrypt" || !encodedSalt || !encodedHash) return false;

  try {
    const expected = Buffer.from(encodedHash, "base64url");
    if (expected.length !== KEY_LENGTH) return false;
    const actual = (await scrypt(password, Buffer.from(encodedSalt, "base64url"), KEY_LENGTH)) as Buffer;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
