import { test } from "node:test";
import assert from "node:assert/strict";
import { vietQrImageUrl, VIETQR_COVERAGE } from "../vietQr.js";

/**
 * Bang ma ngan hang cua VietQR va danh sach ngan hang cho user chon la HAI NOI KHAC NHAU. Them mot
 * ngan hang vao VIETNAM_BANKS ma quen ben kia thi nut QR am tham bien mat voi ngan hang do - khong
 * ai phat hien duoc tru khi dung user do di rut tien. Test nay bat ngay luc build.
 */
test("moi ngan hang trong VIETNAM_BANKS phai co ma VietQR, hoac duoc ghi ro la khong ho tro", () => {
  const chuaPhanLoai = VIETQR_COVERAGE.allBanks.filter(
    (name) => !(name in VIETQR_COVERAGE.codes) && !VIETQR_COVERAGE.unsupported.has(name)
  );
  assert.deepEqual(
    chuaPhanLoai,
    [],
    `Ngan hang chua co ma VietQR va cung chua duoc ghi vao BANKS_WITHOUT_VIETQR: ${chuaPhanLoai.join(", ")}`
  );
});

test("khong co ngan hang nao vua co ma vua bi liet ke la khong ho tro", () => {
  const mauThuan = [...VIETQR_COVERAGE.unsupported].filter((name) => name in VIETQR_COVERAGE.codes);
  assert.deepEqual(mauThuan, [], `Vua co ma vua nam trong danh sach khong ho tro: ${mauThuan.join(", ")}`);
});

test("moi ten trong BANKS_WITHOUT_VIETQR phai that su ton tai trong VIETNAM_BANKS", () => {
  // Chan loi go sai ten: ghi nham "HSBC VN" thi ngan hang that "HSBC Việt Nam" lai roi vao nhanh
  // "chua phan loai" va test dau tien se do - nhung neu test dau da do vi ly do khac thi dong nay
  // chi ra dung cho sai.
  const la = [...VIETQR_COVERAGE.unsupported].filter((name) => !VIETQR_COVERAGE.allBanks.includes(name));
  assert.deepEqual(la, [], `Ten khong co trong VIETNAM_BANKS: ${la.join(", ")}`);
});

test("vietQrImageUrl: sinh dung link cho ngan hang co ho tro", () => {
  const url = vietQrImageUrl({
    bankName: "Vietcombank",
    accountNumber: "0123456789",
    accountHolder: "NGUYEN VAN A",
    amount: 59_535,
    note: "Hoan tien",
  });
  assert.ok(url);
  assert.match(url, /^https:\/\/img\.vietqr\.io\/image\/VCB-0123456789-compact2\.png\?/);
  assert.match(url, /amount=59535/);
  assert.match(url, /addInfo=Hoan\+tien/);
  assert.match(url, /accountName=NGUYEN\+VAN\+A/);
});

// Yeu cau user 2026-10-08: noi dung chuyen khoan de TRONG de app ngan hang tu lay noi dung mac dinh -
// QR khong duoc mang addInfo (ke ca addInfo rong).
test("vietQrImageUrl: khong truyen note -> KHONG co addInfo trong link", () => {
  const url = vietQrImageUrl({
    bankName: "Vietcombank",
    accountNumber: "0123456789",
    accountHolder: "NGUYEN VAN A",
    amount: 59_535,
  });
  assert.ok(url);
  assert.doesNotMatch(url, /addInfo/);
  assert.match(url, /amount=59535/);
});

test("vietQrImageUrl: tra null cho ngan hang VietQR khong ho tro chuyen khoan", () => {
  for (const bankName of ["HSBC Việt Nam", "Standard Chartered Việt Nam", "DongA Bank"]) {
    assert.equal(
      vietQrImageUrl({ bankName, accountNumber: "0123456789", accountHolder: "A", amount: 1000, note: "x" }),
      null,
      `${bankName} khong ho tro chuyen khoan qua VietQR, phai an nut QR di`
    );
  }
});

test("vietQrImageUrl: tra null khi thieu du lieu, khong nem loi", () => {
  const base = { accountHolder: "A", amount: 1000, note: "x" };
  assert.equal(vietQrImageUrl({ ...base, bankName: "", accountNumber: "0123456789" }), null);
  assert.equal(vietQrImageUrl({ ...base, bankName: "Vietcombank", accountNumber: "   " }), null);
  assert.equal(vietQrImageUrl({ ...base, bankName: "Ngan hang khong co that", accountNumber: "1" }), null);
});

/**
 * So tien <= 0 van phai ra duoc QR (admin tu nhap tien tren app ngan hang) - chi la bo tham so
 * amount di. Gui "amount=0" hay "amount=-5" sang may chu ben thu ba thi QR hien ra sai so.
 */
test("vietQrImageUrl: so tien khong hop le thi bo tham so amount chu khong bo ca QR", () => {
  const url = vietQrImageUrl({
    bankName: "Techcombank",
    accountNumber: "19001234",
    accountHolder: "A",
    amount: 0,
    note: "x",
  });
  assert.ok(url);
  assert.doesNotMatch(url, /amount=/);
});

test("vietQrImageUrl: so tien le duoc lam tron - VietQR khong nhan phan thap phan", () => {
  const url = vietQrImageUrl({
    bankName: "Techcombank",
    accountNumber: "19001234",
    accountHolder: "A",
    amount: 22_990.5,
    note: "x",
  });
  assert.match(url!, /amount=22991/);
});
