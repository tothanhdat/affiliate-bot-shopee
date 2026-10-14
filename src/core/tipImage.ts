import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { InvalidTipError } from "./errors.js";

/**
 * Anh cua Tips (2026-10-14): nhan dien loai anh bang CHU KY (magic bytes) cua noi dung file, KHONG tin
 * mimetype/ten file do client gui. Chi nhan JPEG/PNG/WebP: SVG chay duoc script khi mo truc tiep, GIF khong can.
 * Day la src/core nen KHONG import express/multer - route lo viec nhan file, o day chi nhan buffer.
 */

export const TIP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export interface TipImageType {
  ext: ".jpg" | ".png" | ".webp";
  mime: "image/jpeg" | "image/png" | "image/webp";
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function hasBytes(buf: Uint8Array, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buf[offset + index] === byte);
}

export function detectTipImageType(buf: Uint8Array): TipImageType | null {
  if (hasBytes(buf, [0xff, 0xd8, 0xff])) return { ext: ".jpg", mime: "image/jpeg" };
  if (hasBytes(buf, PNG_SIGNATURE)) return { ext: ".png", mime: "image/png" };
  // WebP = "RIFF" + 4 byte kich thuoc + "WEBP"; RIFF khong thoi chua du (WAV/AVI cung la RIFF).
  if (hasBytes(buf, [0x52, 0x49, 0x46, 0x46]) && hasBytes(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { ext: ".webp", mime: "image/webp" };
  }
  return null;
}

/** Ghi anh vao `dir` voi ten ngau nhien; tra ten FILE (khong phai duong dan) de luu vao DB. */
export function saveTipImage(dir: string, buffer: Uint8Array): string {
  const type = detectTipImageType(buffer);
  if (type === null) {
    throw new InvalidTipError("Ảnh phải là JPG, PNG hoặc WebP (không nhận SVG hay GIF).");
  }
  mkdirSync(dir, { recursive: true });
  const filename = `${randomUUID()}${type.ext}`;
  writeFileSync(join(dir, filename), buffer);
  return filename;
}

/**
 * Xoa 1 file anh. An toan: null/khong ton tai khong nem, `basename()` chan '../'. Loi khac chi canh bao -
 * file mo coi vo hai hon ban ghi tro vao file da mat, nen khong de loi nay lam fail thao tac cua admin.
 */
export function deleteTipImage(dir: string, filename: string | null): void {
  if (filename === null || filename === "") return;
  try {
    unlinkSync(join(dir, basename(filename)));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[tips] khong xoa duoc file anh ${filename}:`, (err as Error).message);
    }
  }
}
