import { test } from "node:test";
import assert from "node:assert/strict";
import { renderWithdrawalsPage } from "../adminHtml.js";
import type { WithdrawalRequest } from "../../core/types.js";

/**
 * Trang /admin/withdrawals la man hinh TIEN: mot loi o day la chuyen nham hoac khong chuyen. Cac
 * test duoi day chot 3 thu de vo am tham khi chinh giao dien:
 *  1. O chon file va nut gui nam o HAI <td> khac nhau nen phai noi voi <form> qua thuoc tinh `form`
 *     - mat thuoc tinh do thi nut van bam duoc nhung KHONG gui gi, hoac gui thieu anh bill.
 *  2. <form> that phai nam NGOAI <table> (trinh duyet day <form> con truc tiep cua <tr> ra ngoai
 *     bang luc phan tich HTML, lam mat action/enctype).
 *  3. Nut QR chi duoc hien khi ngan hang that su chuyen khoan duoc qua VietQR.
 */

function wd(over: Partial<WithdrawalRequest> = {}): WithdrawalRequest {
  return {
    id: "w-1",
    platform: "zalo",
    userId: "u-001",
    amount: 12_578,
    status: "pending",
    createdAt: "2026-10-04T05:00:00.000Z",
    paidAt: null,
    proofImagePath: null,
    bankName: "Vietcombank",
    bankAccountNumber: "0123456789",
    bankAccountHolder: "LE THI THAO",
    debtApplied: 0,
    ...over,
  } as WithdrawalRequest;
}

test("o chon file va nut gui deu tro vao DUNG form cua dong do", () => {
  const html = renderWithdrawalsPage([wd({ id: "abc" })], [], new Map());

  assert.match(html, /<input type="file" id="proofImage-abc"[^>]*name="proofImage"[^>]*form="pay-abc"/);
  assert.match(html, /<button type="submit" form="pay-abc"/);
});

test("the <form> that nam NGOAI <table>, co action + enctype + popup xac nhan", () => {
  const html = renderWithdrawalsPage([wd({ id: "abc" })], [], new Map());

  const form = html.match(/<form id="pay-abc"[^>]*>/)?.[0];
  assert.ok(form, "phai co the <form> cho yeu cau nay");
  assert.match(form, /action="\/admin\/withdrawals\/abc\/mark-paid"/);
  assert.match(form, /enctype="multipart\/form-data"/);
  assert.match(form, /onsubmit="return confirm\(/, "hanh dong tien BAT BUOC co buoc xac nhan");

  // Form phai dung sau the </table> dong lai - khong duoc nam long trong bang.
  const posForm = html.indexOf('<form id="pay-abc"');
  const posEndTable = html.indexOf("</table>");
  assert.ok(posEndTable !== -1 && posForm > posEndTable, "the <form> phai nam ngoai <table>");
});

test("moi yeu cau dang cho co dung 1 form rieng", () => {
  const html = renderWithdrawalsPage([wd({ id: "a" }), wd({ id: "b" }), wd({ id: "c" })], [], new Map());
  assert.equal([...html.matchAll(/<form id="pay-/g)].length, 3);
});

test("nut QR hien cho ngan hang VietQR ho tro, va KHONG hien cho ngan hang khong ho tro", () => {
  const coQr = renderWithdrawalsPage([wd({ bankName: "Vietcombank" })], [], new Map());
  assert.match(coQr, /img\.vietqr\.io\/image\/VCB-0123456789/);
  assert.match(coQr, /QR Pay/);

  const khongQr = renderWithdrawalsPage([wd({ bankName: "HSBC Việt Nam" })], [], new Map());
  assert.doesNotMatch(khongQr, /img\.vietqr\.io/);
  assert.match(khongQr, /Ngân hàng này không tạo được QR/);
});

/**
 * Anh QR tai tu may chu ben thu ba. Phai nam trong <details> DONG SAN - neu de <img> hien luon thi
 * mo trang co 50 yeu cau la gui so tai khoan cua 50 khach sang ben do du admin khong xem cai nao.
 */
test("anh QR nam trong <details> dong san, khong tai ngay khi mo trang", () => {
  const html = renderWithdrawalsPage([wd()], [], new Map());
  const block = html.match(/<details class="qr-pop[^"]*">[\s\S]*?<\/details>/)?.[0];
  assert.ok(block, "khoi QR phai boc trong <details>");
  assert.doesNotMatch(block, /<details class="qr-pop[^"]*" open/, "khong duoc mo san");
  assert.match(block, /<img[^>]*loading="lazy"/);
});

test("ma QR khong chua userId - chuoi nay di sang may chu ben thu ba", () => {
  const html = renderWithdrawalsPage([wd({ userId: "2302350177028858274" })], [], new Map());
  const qrSrc = html.match(/src="(https:\/\/img\.vietqr\.io[^"]*)"/)?.[1] ?? "";
  assert.ok(qrSrc !== "");
  assert.doesNotMatch(qrSrc, /2302350177028858274/);
});

test("so tien va so yeu cau tren the KPI khop voi danh sach truyen vao", () => {
  const html = renderWithdrawalsPage(
    [wd({ id: "a", amount: 10_000 }), wd({ id: "b", amount: 2_578 })],
    [wd({ id: "c", amount: 3_600, status: "paid", paidAt: "2026-10-04T06:00:00.000Z" })],
    new Map()
  );
  assert.match(html, /12\.578đ/, "tong dang cho = 10.000 + 2.578");
  assert.match(html, /2 yêu cầu đang chờ xử lý/);
  assert.match(html, /3\.600đ/);
  assert.match(html, /1 giao dịch hoàn tất/);
});

test("trang thai rong: khong con yeu cau nao thi van hien bang lich su", () => {
  const html = renderWithdrawalsPage([], [wd({ id: "c", status: "paid", paidAt: "2026-10-04T06:00:00.000Z" })], new Map());
  assert.match(html, /Không có yêu cầu nào đang chờ/);
  assert.doesNotMatch(html, /<form id="pay-/);
});

// ---------------------------------------------------------------------------
// Canh bao don bi tra hang + nut Huy yeu cau (2026-10-08)
// ---------------------------------------------------------------------------

test("khong co don bi tra hang -> KHONG hien banner, KHONG hien nut Huy", () => {
  const html = renderWithdrawalsPage([wd({ id: "abc" })], [], new Map());
  assert.doesNotMatch(html, /vừa bị trả hàng/);
  assert.doesNotMatch(html, /Huỷ yêu cầu/);
});

// Banner "don vua bi tra hang" + nut "Huy yeu cau" da bi GO (2026-10-08, yeu cau user): import tu
// dong huy yeu cau rut co don bi huy nen banner gan nhu khong bao gio hien.
test("khong con banner tra hang / nut Huy yeu cau / form huy", () => {
  const html = renderWithdrawalsPage([wd({ id: "abc" })], [], new Map());
  assert.doesNotMatch(html, /vừa bị trả hàng/);
  assert.doesNotMatch(html, /form="cancel-/);
  assert.doesNotMatch(html, /\/cancel"/);
});

test("tab 'Da huy' chi hien khi co yeu cau da huy", () => {
  const none = renderWithdrawalsPage([wd({ id: "abc" })], [], new Map());
  assert.doesNotMatch(none, /Đã huỷ/);

  const some = renderWithdrawalsPage([], [], new Map(), null, [
    wd({ id: "c1", status: "cancelled", cancelledAt: "2026-10-08T05:00:00.000Z", cancelReason: "Đơn bị trả lại" }),
  ]);
  assert.match(some, /Đã huỷ/);
  assert.match(some, /Đơn bị trả lại/);
  assert.match(some, /line-through/, "tien cua yeu cau da huy phai gach ngang - khong ai nhan so do");
});

// Mo hinh no 2026-10-08 (yeu cau truc tiep cua user): yeu cau co tru no phai hien du 3 so - user rut
// bao nhieu, no bao nhieu, va so cuoi cung admin phai chuyen. QR tao theo so phai chuyen.
test("yeu cau co tru no: hien Rut / Tru no / Phai chuyen, QR theo so phai chuyen", () => {
  const html = renderWithdrawalsPage([wd({ id: "d1", amount: 60_000, debtApplied: 40_000 })], [], new Map());
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(text, /Rút 100\.000đ/);
  assert.match(text, /Trừ nợ −40\.000đ/);
  assert.match(text, /Phải chuyển 60\.000đ/);
  assert.match(html, /amount=60000/, "QR phai theo so PHAI CHUYEN, khong phai so user rut");
  assert.doesNotMatch(html, /addInfo/, "noi dung chuyen khoan de trong cho ngan hang tu dien mac dinh");
  assert.match(html, /ĐÃ CHUYỂN KHOẢN 60\.000đ/, "hop xac nhan cung noi so phai chuyen");
});

test("yeu cau khong no: chi 1 so nhu cu", () => {
  const html = renderWithdrawalsPage([wd({ id: "d2", amount: 60_000 })], [], new Map());
  assert.doesNotMatch(html, /Trừ nợ/);
  assert.doesNotMatch(html, /Phải chuyển/);
});

test("lich su: yeu cau tu dong tru no hien 'Tu tru no, khong chuyen'", () => {
  const html = renderWithdrawalsPage(
    [],
    [wd({ id: "d3", amount: 0, debtApplied: 30_000, status: "paid", paidAt: "2026-10-08T05:00:00.000Z" })],
    new Map()
  );
  assert.match(html, /Tự trừ nợ, không chuyển/);
  assert.match(html, /Tự động \(trừ nợ\)/);
});
