import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteTipImage, detectTipImageType, saveTipImage } from "../tipImage.js";
import { InvalidTipError } from "../errors.js";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
// "RIFF" + 4 byte kich thuoc + "WEBP"
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const GIF = new TextEncoder().encode("GIF89a....");
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const TEXT = new TextEncoder().encode("khong phai anh");

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "tip-images-"));
}

test("detectTipImageType: nhan JPEG / PNG / WebP theo chu ky, ra dung duoi", () => {
  assert.deepEqual(detectTipImageType(JPEG), { ext: ".jpg", mime: "image/jpeg" });
  assert.deepEqual(detectTipImageType(PNG), { ext: ".png", mime: "image/png" });
  assert.deepEqual(detectTipImageType(WEBP), { ext: ".webp", mime: "image/webp" });
});

test("detectTipImageType: tu choi GIF, SVG, van ban, rong, qua ngan", () => {
  assert.equal(detectTipImageType(GIF), null);
  assert.equal(detectTipImageType(SVG), null);
  assert.equal(detectTipImageType(TEXT), null);
  assert.equal(detectTipImageType(new Uint8Array([])), null);
  assert.equal(detectTipImageType(new Uint8Array([0xff, 0xd8])), null);
  // RIFF nhung khong phai WEBP (vd WAV) khong duoc nhan
  assert.equal(
    detectTipImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45])),
    null
  );
});

test("saveTipImage: ghi file ten ngau nhien + duoi suy ra tu chu ky, tu tao thu muc", () => {
  const root = tmpDir();
  const dir = join(root, "nested", "tips");
  try {
    const name = saveTipImage(dir, PNG);
    assert.match(name, /^[0-9a-f-]{36}\.png$/);
    assert.deepEqual(new Uint8Array(readFileSync(join(dir, name))), PNG);
    const other = saveTipImage(dir, JPEG);
    assert.match(other, /\.jpg$/);
    assert.notEqual(name, other);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("saveTipImage: file gia mao (khong phai anh) -> InvalidTipError va KHONG ghi file", () => {
  const dir = tmpDir();
  try {
    assert.throws(() => saveTipImage(dir, TEXT), InvalidTipError);
    assert.throws(() => saveTipImage(dir, SVG), InvalidTipError);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deleteTipImage: xoa file; null / khong ton tai khong nem", () => {
  const dir = tmpDir();
  try {
    const name = saveTipImage(dir, PNG);
    deleteTipImage(dir, name);
    assert.equal(existsSync(join(dir, name)), false);
    assert.doesNotThrow(() => deleteTipImage(dir, name));
    assert.doesNotThrow(() => deleteTipImage(dir, null));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deleteTipImage: path traversal khong thoat duoc thu muc ('../victim')", () => {
  const root = tmpDir();
  const dir = join(root, "tips");
  try {
    saveTipImage(dir, PNG); // tao thu muc
    const victim = join(root, "victim.txt");
    writeFileSync(victim, "dung xoa toi");
    deleteTipImage(dir, "../victim.txt");
    assert.equal(existsSync(victim), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
