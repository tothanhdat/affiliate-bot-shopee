import assert from "node:assert/strict";
import { test } from "node:test";
import jpeg from "jpeg-js";
import { buildWithdrawalPaidNotification, detectImage } from "../withdrawalPaidNotification.js";

function pngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function webpHeader(chunk: "VP8 " | "VP8L" | "VP8X", width: number, height: number): Buffer {
  const buf = Buffer.alloc(40);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(32, 4);
  buf.write("WEBP", 8, "ascii");
  buf.write(chunk, 12, "ascii");
  if (chunk === "VP8 ") {
    buf.writeUInt16LE(width, 26);
    buf.writeUInt16LE(height, 28);
  } else if (chunk === "VP8L") {
    buf.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 21);
  } else {
    buf.writeUIntLE(width - 1, 24, 3);
    buf.writeUIntLE(height - 1, 27, 3);
  }
  return buf;
}

test("detectImage doc dung kich thuoc PNG", () => {
  assert.deepEqual(detectImage(pngHeader(1080, 2400)), { width: 1080, height: 2400, ext: "png" });
});

test("detectImage doc dung kich thuoc JPEG that (jpeg-js ma hoa)", () => {
  const data = Buffer.alloc(30 * 20 * 4, 200);
  const encoded = jpeg.encode({ data, width: 30, height: 20 }, 80).data;
  assert.deepEqual(detectImage(encoded), { width: 30, height: 20, ext: "jpg" });
});

test("detectImage doc dung kich thuoc 3 loai WebP", () => {
  assert.deepEqual(detectImage(webpHeader("VP8 ", 640, 480)), { width: 640, height: 480, ext: "webp" });
  assert.deepEqual(detectImage(webpHeader("VP8L", 640, 480)), { width: 640, height: 480, ext: "webp" });
  assert.deepEqual(detectImage(webpHeader("VP8X", 640, 480)), { width: 640, height: 480, ext: "webp" });
});

test("detectImage tra null cho du lieu rac, file cut ngan, kich thuoc 0", () => {
  assert.equal(detectImage(Buffer.from([1, 2, 3, 4])), null);
  assert.equal(detectImage(Buffer.alloc(0)), null);
  assert.equal(detectImage(pngHeader(1080, 2400).subarray(0, 18)), null);
  assert.equal(detectImage(pngHeader(0, 100)), null);
  assert.equal(detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02])), null);
});

test("buildWithdrawalPaidNotification: co anh doc duoc -> text + image", () => {
  const proof = pngHeader(1080, 2400);
  const n = buildWithdrawalPaidNotification({ text: "da chuyen", proof });
  assert.equal(n.text, "da chuyen");
  assert.equal(n.image?.width, 1080);
  assert.equal(n.image?.height, 2400);
  assert.equal(n.image?.filename, "chuyen-khoan.png");
  assert.equal(n.image?.data, proof);
});

test("buildWithdrawalPaidNotification: khong anh / anh hong -> CHI text, khong nem loi", () => {
  assert.deepEqual(buildWithdrawalPaidNotification({ text: "t", proof: null }), { text: "t" });
  assert.deepEqual(buildWithdrawalPaidNotification({ text: "t", proof: undefined }), { text: "t" });
  assert.deepEqual(buildWithdrawalPaidNotification({ text: "t", proof: Buffer.alloc(0) }), { text: "t" });
  assert.deepEqual(buildWithdrawalPaidNotification({ text: "t", proof: Buffer.from([1, 2, 3, 4]) }), { text: "t" });
});
