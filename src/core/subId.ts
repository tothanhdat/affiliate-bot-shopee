import { randomBytes } from "node:crypto";
import type { Platform } from "./types.js";

/**
 * Ma 1 ky tu dai dien nen tang trong subId - CO CHU DICH khong dung ten that ("zalo"/"telegram").
 *
 * Ly do (2026-09-26, quyet dinh cua user): subId hien NGUYEN VAN trong Bao cao click va Bao cao
 * chuyen doi cua Shopee (Shopee luu vao utm_content) - da xac nhan that 2026-08-20 khi thay
 * "zalo-9053348487804998642-mt00is1b-5b3076" trong bao cao click. De nguyen ten nen tang o day la
 * mot loi TU KHAI voi Shopee rang traffic den tu Zalo, trong boi canh Shopee vua co dot quet huy
 * don co traffic tu Zalo (nghi la mo hinh hoan tien). Bo nhan nay KHONG mat gi vi nen tang THAT
 * cua don khong bao gio doc tu chuoi subId - xem orderIngest.ts (findBySubId -> requestEntry
 * .platform, doc cot `platform` cua requests.db), do moi la nguon su that, va la cai /admin/orders
 * hien o cot Platform.
 *
 * **TUYET DOI KHONG "don dep" lai thanh ten nen tang day du cho de doc** - co test chan viec nay
 * (subId.test.ts). Cung KHONG doi sang ten 1 nen tang KHAC ("facebook"/"instagram"...): click van
 * mang User-Agent cua Zalo in-app browser nen Shopee doi chieu duoc, va luc do loi tu khai sai
 * nguon roi vao dung dieu khoan (c)/(t)(iii)/(u) Chinh sach chong gian lan TTLK (phat toi
 * 10.000.000d/lan) - nang hon han viec khong khai gi.
 *
 * Record<Platform, string> co chu dich (khong phai Partial): them Platform moi la BUOC phai khai
 * ma o day, khong the quen im lang.
 */
export const SUBID_PLATFORM_CODE: Record<Platform, string> = {
  zalo: "k",
  telegram: "m",
  http: "w",
};

/**
 * Sinh subId gan vao affiliate link, dung de doi soat hoa hong ve dung user sau nay.
 *
 * Dinh dang: `{maNenTang}-{userId}-{timestamp36}-{random6hex}` (4 doan, giu nguyen so doan nhu
 * format cu de logic ghep Sub_id1..Sub_id5 trong shopeeReportImport.ts khong phai doi).
 *
 * GIU `userId` trong chuoi CO CHU DICH: neu requests.db mat (su co volume Railway, hoac deploy
 * quen mount) thi subId la manh moi DUY NHAT de quy don ve dung user bang tay tu bao cao Shopee -
 * day la tien cua user. Dung hash userId de "kin hon" neu khong thay the duoc kha nang phuc hoi nay.
 *
 * KHONG can migration khi doi format: logStore.findBySubId() khop NGUYEN CHUOI nen subId cu
 * ("zalo-...") con dang gan o cac don pending chua ve bao cao van tra duoc binh thuong. 2 format
 * cung ton tai vo hai, khong co ngay cat.
 */
export function generateSubId(platform: Platform, userId: string): string {
  const rand = randomBytes(3).toString("hex");
  return `${SUBID_PLATFORM_CODE[platform]}-${userId}-${Date.now().toString(36)}-${rand}`;
}
