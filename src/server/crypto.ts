import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return `scrypt:${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  const saltHex = parts.length === 3 && parts[0] === "scrypt" ? parts[1] : parts[0];
  const hashHex = parts.length === 3 && parts[0] === "scrypt" ? parts[2] : parts[1];
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await deriveKey(password, Buffer.from(saltHex, "hex"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function verifyPlaintextConstantTime(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  const hash = hashToken(raw);
  return { raw, hash };
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
