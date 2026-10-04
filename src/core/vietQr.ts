import { VIETNAM_BANKS } from "./vietnamBanks.js";

/**
 * Sinh link anh QR chuyen khoan (VietQR) cho trang /admin/withdrawals (2026-10-04, yeu cau cua user).
 *
 * **ANH DUOC TAI TU MAY CHU BEN THU BA (img.vietqr.io)**, nghia la trinh duyet cua admin gui SANG
 * HO so tai khoan + ten chu tai khoan + so tien cua khach moi lan hien QR. Danh doi nay da duoc user
 * chon co y (2026-10-04) sau khi duoc trinh bay ca phuong an sinh QR ngay tren server. Vi vay trang
 * admin dat anh QR trong <details> dong san: chi row nao admin BAM MO moi goi sang do, khong phai ca
 * 50 dong deu gui du lieu khach di ngay khi mo trang.
 *
 * Ma ngan hang lay tu danh sach chinh thuc cua VietQR (https://api.vietqr.io/v2/banks, tra ngay
 * 2026-10-04) chu KHONG phai tu doan: gan nham ma = QR tro sang ngan hang khac, admin quet xong
 * chuyen nham tien ma khong he biet.
 */

/**
 * Ten ngan hang trong VIETNAM_BANKS -> ma ngan hang cua VietQR.
 *
 * CHI chua ngan hang co `isTransfer = 1` trong danh sach VietQR. Ngan hang nao VietQR bao KHONG ho
 * tro chuyen khoan thi CO Y khong co mat o day (xem BANKS_WITHOUT_VIETQR) - tra ve null de UI an nut
 * QR di, tot hon la hien mot ma QR khong chuyen duoc.
 *
 * Giu DONG BO voi VIETNAM_BANKS: them ngan hang moi vao danh sach do thi phai them vao day HOAC vao
 * BANKS_WITHOUT_VIETQR. Co test chan (vietQr.test.ts) nen quen se do test chu khong am tham mat QR.
 */
const VIETQR_BANK_CODES: Readonly<Record<string, string>> = {
  Momo: "momo",
  Vietcombank: "VCB",
  VietinBank: "ICB",
  BIDV: "BIDV",
  Agribank: "VBA",
  Techcombank: "TCB",
  "MB Bank": "MB",
  ACB: "ACB",
  VPBank: "VPB",
  Sacombank: "STB",
  TPBank: "TPB",
  HDBank: "HDB",
  SHB: "SHB",
  VIB: "VIB",
  Eximbank: "EIB",
  OCB: "OCB",
  MSB: "MSB",
  SeABank: "SEAB",
  SCB: "SCB",
  "Bac A Bank": "BAB",
  PVcomBank: "PVCB",
  "Nam A Bank": "NAB",
  ABBANK: "ABB",
  // LienVietPostBank da doi ten thanh LPBank (Ngan hang TMCP Loc Phat Viet Nam) - ten cu van giu
  // trong VIETNAM_BANKS vi user da chon no khi gui yeu cau rut, doi ten se lam cac yeu cau cu mat khop.
  LienVietPostBank: "LPB",
  Kienlongbank: "KLB",
  BaoVietBank: "BVB",
  VietBank: "VIETBANK",
  PGBank: "PGB",
  NCB: "NCB",
  SaigonBank: "SGICB",
  "CIMB Việt Nam": "CIMB",
  "Shinhan Bank Việt Nam": "SHBVN",
  "Woori Bank Việt Nam": "WVN",
};

/**
 * Ngan hang trong VIETNAM_BANKS ma VietQR BAO KHONG ho tro chuyen khoan (`isTransfer = 0`), tra ngay
 * 2026-10-04. Liet ke tuong minh thay vi de thieu, de test phan biet duoc "da kiem, that su khong co"
 * voi "quen chua them".
 */
const BANKS_WITHOUT_VIETQR: ReadonlySet<string> = new Set([
  // DongA Bank da duoc chuyen giao bat buoc va doi thanh "Ngan hang So Vikki"; VietQR van liet ke
  // (bin 970406) nhung danh dau khong ho tro chuyen khoan.
  "DongA Bank",
  "Standard Chartered Việt Nam",
  "HSBC Việt Nam",
]);

/** Dung cho test dong bo - khong dung trong code chay that. */
export const VIETQR_COVERAGE = {
  codes: VIETQR_BANK_CODES,
  unsupported: BANKS_WITHOUT_VIETQR,
  allBanks: VIETNAM_BANKS,
};

export interface VietQrInput {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  /** So tien VND. Lam tron ve so nguyen vi VietQR khong nhan phan thap phan. */
  amount: number;
  /** Noi dung chuyen khoan. Giu NGAN va KHONG chua userId - chuoi nay di sang may chu ben thu ba. */
  note: string;
}

/**
 * Link anh QR, hoac `null` khi khong the sinh duoc (ngan hang chua co ma, ngan hang khong ho tro
 * chuyen khoan, so tai khoan rong, so tien khong hop le).
 *
 * Tra `null` thay vi nem loi: day nam tren duong RENDER mot trang admin - mot yeu cau rut co du lieu
 * ngan hang la khong duoc phep lam sap ca trang danh sach tien.
 */
export function vietQrImageUrl(input: VietQrInput): string | null {
  const bankName = input.bankName.trim();
  const accountNumber = input.accountNumber.trim();
  if (bankName === "" || accountNumber === "") return null;
  if (BANKS_WITHOUT_VIETQR.has(bankName)) return null;

  const code = VIETQR_BANK_CODES[bankName];
  if (!code) return null;

  // So tien phai la so nguyen duong; 0 hoac am thi bo tham so di (QR van quet duoc, admin tu nhap tien)
  // chu khong gui "NaN"/"-5" sang cho ho.
  const amount = Math.round(input.amount);
  const params = new URLSearchParams();
  if (Number.isFinite(amount) && amount > 0) params.set("amount", String(amount));
  if (input.note.trim() !== "") params.set("addInfo", input.note.trim());
  if (input.accountHolder.trim() !== "") params.set("accountName", input.accountHolder.trim());

  // Mau "compact2" = QR kem ten ngan hang + so tien in san, de admin doi chieu bang mat truoc khi quet.
  const query = params.toString();
  return `https://img.vietqr.io/image/${encodeURIComponent(code)}-${encodeURIComponent(
    accountNumber
  )}-compact2.png${query === "" ? "" : `?${query}`}`;
}
