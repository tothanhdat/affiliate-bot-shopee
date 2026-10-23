import type { OutgoingImage, OutgoingNotification } from "./notification.js";

/** Kich thuoc + duoi file doc tu chu ky file (khong tin mimetype/ten file admin tai len). */
export interface DetectedImage {
  width: number;
  height: number;
  ext: "jpg" | "png" | "webp";
}

/**
 * Doc kich thuoc anh PNG/JPEG/WebP tu byte dau file, KHONG them thu vien: zca-js bat buoc co width/height
 * khi gui anh tu Buffer (khong tu do duoc nhu khi gui tu duong dan file). Tra null neu khong nhan ra
 * dinh dang hoac file bi cat/hong - caller lui ve gui text, khong doan kich thuoc.
 */
export function detectImage(buf: Buffer): DetectedImage | null {
  // PNG: 8 byte chu ky, chunk IHDR bat dau o byte 8, width/height la 2 so uint32 BE o byte 16 va 20.
  if (buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return positive({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), ext: "png" });
  }

  // JPEG: SOI (FFD8) roi duyet cac marker toi khi gap SOFn (khung chua height/width).
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let pos = 2;
    while (pos + 4 <= buf.length) {
      if (buf[pos] !== 0xff) return null;
      const marker = buf[pos + 1];
      if (marker === 0xff) {
        pos += 1; // byte FF dem them
        continue;
      }
      // Marker khong co phan do dai: RSTn, SOI, EOI, TEM.
      if (marker === 0x01 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        pos += 2;
        continue;
      }
      const segmentLength = buf.readUInt16BE(pos + 2);
      const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isStartOfFrame) {
        if (pos + 9 > buf.length) return null;
        return positive({ height: buf.readUInt16BE(pos + 5), width: buf.readUInt16BE(pos + 7), ext: "jpg" });
      }
      pos += 2 + segmentLength;
    }
    return null;
  }

  // WebP: "RIFF"<size>"WEBP" roi 1 trong 3 loai chunk dau tien.
  if (buf.length >= 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8 ") {
      return positive({ width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, ext: "webp" });
    }
    if (chunk === "VP8L") {
      const bits = buf.readUInt32LE(21);
      return positive({ width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, ext: "webp" });
    }
    if (chunk === "VP8X") {
      return positive({ width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1, ext: "webp" });
    }
  }
  return null;
}

function positive(img: DetectedImage): DetectedImage | null {
  return img.width > 0 && img.height > 0 ? img : null;
}

/**
 * Lap thong bao "da chuyen khoan": co anh chung tu thi gui text + anh, khong thi chi text.
 *
 * Khong bao gio nem loi - nam tren duong bao TIEN cho user. Anh khong doc duoc (hong/dinh dang la)
 * thi bo anh, van gui text; bo qua im lang se kho debug nen co log canh bao.
 */
export function buildWithdrawalPaidNotification(params: {
  text: string;
  proof: Buffer | null | undefined;
}): OutgoingNotification {
  if (!params.proof || params.proof.length === 0) return { text: params.text };

  const detected = detectImage(params.proof);
  if (!detected) {
    console.warn("[user-notify] anh chung tu chuyen khoan khong doc duoc kich thuoc - chi gui text.");
    return { text: params.text };
  }
  const image: OutgoingImage = {
    data: params.proof,
    width: detected.width,
    height: detected.height,
    filename: `chuyen-khoan.${detected.ext}`,
  };
  return { text: params.text, image };
}
