import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getEnv } from "./env";

const DANGEROUS_EXTS = new Set([
  ".html",
  ".htm",
  ".svg",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".php",
  ".sh",
  ".bash",
  ".exe",
  ".bat",
  ".cmd",
  ".ps1",
  ".vbs",
  ".msi",
  ".dll"
]);

const ALLOWED_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const ALLOWED_DOC_EXTS = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".csv",
  ".txt",
  ".xlsx",
  ".xls",
  ".docx",
  ".doc",
  ".pptx",
  ".odt",
  ".ods",
  ".step",
  ".stp",
  ".iges",
  ".igs",
  ".stl",
  ".dxf",
  ".zip"
]);

function sniffMagicMime(buf: Buffer, ext: string): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (buf.length >= 6 && (buf.subarray(0, 6).toString("ascii") === "GIF87a" || buf.subarray(0, 6).toString("ascii") === "GIF89a")) {
    return "image/gif";
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (buf.length >= 5 && buf.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)) {
    if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (ext === ".pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    if (ext === ".odt") return "application/vnd.oasis.opendocument.text";
    if (ext === ".ods") return "application/vnd.oasis.opendocument.spreadsheet";
    return "application/zip";
  }
  if (ext === ".csv") return "text/csv; charset=utf-8";
  if (ext === ".txt" || ext === ".step" || ext === ".stp" || ext === ".iges" || ext === ".igs" || ext === ".dxf") {
    return "text/plain; charset=utf-8";
  }
  if (ext === ".stl" || ext === ".xls" || ext === ".doc") {
    return "application/octet-stream";
  }
  return null;
}

export function isInlineSafeMime(mimeType: string): boolean {
  return (
    mimeType === "image/png" ||
    mimeType === "image/jpeg" ||
    mimeType === "image/webp" ||
    mimeType === "image/gif" ||
    mimeType === "application/pdf"
  );
}

export async function saveUploadedFile(params: {
  file: File;
  mode: "image_only" | "document";
}): Promise<{
  originalName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}> {
  const { uploadDir, maxFileSizeBytes } = getEnv();
  const rawName = path.basename(params.file.name || "upload").replace(/[\x00-\x1f]/g, "_");
  const ext = path.extname(rawName).toLowerCase();

  if (!ext || DANGEROUS_EXTS.has(ext)) {
    throw new Error(`Unsupported or unsafe file type: ${rawName}`);
  }
  if (params.mode === "image_only" && !ALLOWED_IMAGE_EXTS.has(ext)) {
    throw new Error(`Images must be PNG, JPG, WEBP, or GIF (${rawName}).`);
  }
  if (params.mode === "document" && !ALLOWED_DOC_EXTS.has(ext)) {
    throw new Error(`File extension "${ext}" is not allowed (${rawName}).`);
  }
  if (params.file.size <= 0) {
    throw new Error(`Uploaded file "${rawName}" is empty.`);
  }
  if (params.file.size > maxFileSizeBytes) {
    throw new Error(`File "${rawName}" exceeds the maximum allowed size.`);
  }

  const buffer = Buffer.from(await params.file.arrayBuffer());
  const detectedMime = sniffMagicMime(buffer, ext);
  if (!detectedMime) {
    throw new Error(`File contents do not match a valid supported format (${rawName}).`);
  }
  if (params.mode === "image_only" && !detectedMime.startsWith("image/")) {
    throw new Error(`File "${rawName}" is not a valid image.`);
  }

  const now = new Date();
  const subdir = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const fileKey = `${subdir}/${randomUUID()}${ext}`;
  const fullPath = resolveSafeUploadPath(fileKey, uploadDir);

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, buffer);

  return {
    originalName: rawName.slice(0, 180),
    storageKey: fileKey,
    mimeType: detectedMime,
    sizeBytes: buffer.length
  };
}

export function resolveSafeUploadPath(storageKey: string, rootDir = getEnv().uploadDir): string {
  const normalizedRoot = path.resolve(rootDir);
  const resolved = path.resolve(normalizedRoot, storageKey);
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    throw new Error("Invalid storage key path.");
  }
  return resolved;
}

export async function readStoredFile(storageKey: string): Promise<Buffer> {
  const fullPath = resolveSafeUploadPath(storageKey);
  return fs.readFile(fullPath);
}

export async function deleteStoredFileQuietly(storageKey: string): Promise<void> {
  try {
    const fullPath = resolveSafeUploadPath(storageKey);
    await fs.unlink(fullPath);
  } catch {
    // Ignore missing files during cleanup
  }
}
