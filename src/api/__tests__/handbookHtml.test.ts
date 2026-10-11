import { test } from "node:test";
import assert from "node:assert/strict";
import { HANDBOOK_EXAMPLE_COMMISSION_VND, renderHandbookPage } from "../handbookHtml.js";
import { computeCommissionBreakdown } from "../../core/commissionMath.js";
import { formatVnd } from "../htmlHelpers.js";

/**
 * Trang So tay hoan tien (/so-tay) thay cho ban Google Docs cu. Diem quan trong nhat duoc chot o
 * day: MOI con so tren trang deu di ra tu tham so truyen vao (settings/env luc chay), KHONG duoc
 * hardcode - ly do ton tai cua ca tinh nang la admin doi % o /admin/settings thi trang tu doi theo.
 */

const DEFAULTS = {
  userSharePercent: 90,
  taxPercent: 10,
  platformFeePercent: 1,
  withdrawalThresholdVnd: 20_000,
  payoutHoldThresholdVnd: 100_000,
  payoutHoldDays: 7,
};

function render(overrides: Partial<typeof DEFAULTS> = {}): string {
  return renderHandbookPage({ ...DEFAULTS, ...overrides });
}

test("handbook: % user nhan lay tu tham so, khong hardcode 90", () => {
  const html = render({ userSharePercent: 75 });

  assert.match(html, /75%/);
  assert.ok(!html.includes("90%"), "khong duoc con dau vet cua 90% hardcode");
});

/**
 * Cau nay da bi dao 2 lan (2026-10-01): truoc do ty le duoc tinh lai theo % hien hanh o moi lan
 * import nen chi don "hoan thanh" moi thuc su an dinh. Tu khi ty le duoc CHOT luc ghi nhan
 * (xem ledgerStore.effectivePercents), cau dung la "luc don duoc ghi nhan" - test de khoi dao lan 3.
 */
test("handbook: noi ty le chot luc don duoc GHI NHAN, khong phai luc don hoan thanh", () => {
  const html = render();

  assert.match(html, /chốt tại thời điểm đơn được ghi nhận/);
  assert.doesNotMatch(html, /chốt tại thời điểm đơn hoàn thành/);
});

test("handbook: % chu bot giu la phan bu cua % user", () => {
  const html = render({ userSharePercent: 75 });

  assert.match(html, /25%/);
});

test("handbook: nguong rut tien lay tu tham so va format kieu VN", () => {
  const html = render({ withdrawalThresholdVnd: 50_000,
  payoutHoldThresholdVnd: 100_000,
  payoutHoldDays: 7, });

  assert.ok(html.includes("50.000đ"), "phai hien nguong rut 50.000đ");
  assert.ok(!html.includes("20.000đ"), "khong duoc con dau vet cua nguong 20.000đ hardcode");
});

test("handbook: % thue va % phi san lay tu tham so", () => {
  const html = render({ taxPercent: 5, platformFeePercent: 2 });

  assert.match(html, /5%/);
  assert.match(html, /2%/);
});

test("handbook: vi du tinh tien khop dung computeCommissionBreakdown voi cung bo %", () => {
  const percents = { taxPercent: 5, platformFeePercent: 2, userSharePercent: 70 };
  const html = render({ ...percents, withdrawalThresholdVnd: 20_000,
  payoutHoldThresholdVnd: 100_000,
  payoutHoldDays: 7, });
  const expected = computeCommissionBreakdown({
    commissionAmount: HANDBOOK_EXAMPLE_COMMISSION_VND,
    ...percents,
  });

  assert.ok(html.includes(formatVnd(HANDBOOK_EXAMPLE_COMMISSION_VND)), "phai hien hoa hong goc cua vi du");
  assert.ok(html.includes(formatVnd(expected.afterTaxOnly)), "phai hien so sau khi tru thue");
  assert.ok(html.includes(formatVnd(expected.afterTaxAmount)), "phai hien so sau khi tru phi san");
  assert.ok(html.includes(formatVnd(expected.userShareAmount)), "phai hien so tien cuoi cung user nhan");
});

test("handbook: vi du voi bo % mac dinh ra dung con so cua ban Google Docs cu", () => {
  const html = render();

  // 7.584đ -> 6.826đ -> 6.758đ -> 6.082đ (y nguyen vi du trong So tay ban Google Docs).
  for (const amount of ["7.584đ", "6.826đ", "6.758đ", "6.082đ"]) {
    assert.ok(html.includes(amount), `vi du phai con moc ${amount}`);
  }
});

test("handbook: khong nhac den san da ngung (Lazada, TikTok Shop)", () => {
  const html = render();

  assert.ok(!/lazada/i.test(html), "Lazada da duoc go khoi So tay (quyet dinh 2026-09-28)");
  assert.ok(!/tiktok/i.test(html), "TikTok Shop da duoc go khoi So tay (quyet dinh 2026-09-29)");
});

test("handbook: co du 3 phan chinh cua ban goc", () => {
  const html = render();

  assert.match(html, /Các bước sử dụng/);
  assert.match(html, /Hướng dẫn chung/);
  assert.match(html, /Các quy định cần biết/);
});

test("handbook: giu cac noi dung bat buoc cua ban goc", () => {
  const html = render();

  assert.match(html, /xemhh/, "phai con huong dan lenh xemhh");
  assert.match(html, /livestream/i, "phai con canh bao khong mo video\\/livestream truoc khi dat");
  assert.match(html, /không hỗ trợ rút một phần|rút toàn bộ/i, "phai con quy dinh rut toan bo");
  assert.match(html, /Shopee/);
});

test("handbook: co muc luc tro toi dung cac id section co that trong trang", () => {
  const html = render();

  const tocHrefs = [...html.matchAll(/class="toc-link[^"]*"[^>]*href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(tocHrefs.length >= 3, "muc luc phai co it nhat 3 muc");
  for (const id of tocHrefs) {
    assert.ok(html.includes(`id="${id}"`), `muc luc tro toi #${id} nhung trang khong co id do`);
  }
});

test("handbook: cac muc gap/mo dung <details> native", () => {
  const html = render();

  assert.match(html, /<details class="faq"/, "phan noi dung dai phai gap/mo duoc bang <details>");
});

test("handbook: co o tim kiem va script loc", () => {
  const html = render();

  assert.match(html, /id="handbook-search"/);
  assert.match(html, /<script>[\s\S]*handbook-search[\s\S]*<\/script>/);
});

test("handbook: data-search khong bi cat ngang boi dau ngoac kep trong noi dung", () => {
  const html = render();

  // Noi dung goc co nhieu doan trich dan: "Chia sẻ", "Khả dụng", "xemhh"... Neu khong escape thi
  // dau " dau tien dong luon attribute -> nua sau cua muc bien mat khoi o tim kiem (va HTML vo).
  const values = [...html.matchAll(/data-search="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(values.length > 0);
  assert.ok(
    values.some((v) => v.includes("rut toan bo")),
    "cum 'rút toàn bộ' nam SAU doan trich \"Khả dụng\" trong muc Rut tien - phai con trong data-search"
  );
  assert.ok(
    values.some((v) => v.includes("sao chep link san pham")),
    "noi dung buoc 1 nam SAU doan trich \"Chia sẻ\" - phai con trong data-search"
  );
});

test("handbook: khong con dau ngoac kep tho lot ra ngoai attribute", () => {
  const html = render();

  // Sau moi data-search="..." phai la khoang trang hoac ky tu dong the, khong the la chu -> dau
  // hieu attribute bi dong som giua chung.
  for (const m of html.matchAll(/data-search="[^"]*"(.)/g)) {
    assert.match(m[1], /[\s>]/, `data-search bi dong som, sau no la ky tu ${JSON.stringify(m[1])}`);
  }
});

test("handbook: khong con muc 'Tin nhan bot tra loi'", () => {
  const html = render();

  // Go theo yeu cau user 2026-09-28 (cung dot voi muc Lazada).
  assert.ok(!html.includes("Tin nhắn bot trả lời"), "muc nay da duoc go khoi So tay");
  assert.ok(!html.includes("hoa hồng ước tính"), "noi dung cua muc do cung phai di theo");
});

// ---------------------------------------------------------------------------
// Muc giam don to + tra hang (2026-10-08)
//
// Khong noi ra thi luat nay la BAY voi user: tien khong vao "Kha dung" ma khong co loi giai thich
// nao, va so du bi tru ma ho khong biet vi sao.
// ---------------------------------------------------------------------------

test("handbook: muc giam don to doc LIVE tu setting, khong hardcode", () => {
  const a = render({ payoutHoldThresholdVnd: 100_000, payoutHoldDays: 7 });
  assert.match(a, /100\.000/);
  assert.match(a, /7 ngày/);

  const b = render({ payoutHoldThresholdVnd: 250_000, payoutHoldDays: 3 });
  assert.match(b, /250\.000/);
  assert.match(b, /3 ngày/);
  assert.doesNotMatch(b, /100\.000/, "khong con vet cua so cu");
});

/**
 * Tu 2026-10-11 don NHO cung nam lai o "Cho xac nhan" them vai ngay (xem payoutHold.ts), nen cau cu
 * "van chuyen sang Kha dung NGAY nhu binh thuong" thanh mot loi hua sai. CO Y khong thay bang mot
 * muc moi giai thich viec cho do: ca y tuong cua tinh nang la user khong phai nghi ve no (ho chi
 * thay "san chua cap nhat kip"), noi ra la tu tay dung lai dung cai lo lang vua go bo.
 */
test("handbook: KHONG hua don nho vao Kha dung ngay, cung khong nhac viec cho them ngay", () => {
  const html = render();
  assert.doesNotMatch(html, /"Khả dụng" ngay/);
  assert.match(html, /không bị giữ theo luật này/);
});

test("handbook: nguong giam = 0 -> AN ca muc (tinh nang dang tat)", () => {
  const html = render({ payoutHoldThresholdVnd: 0 });
  assert.doesNotMatch(html, /Đơn giá trị lớn được giữ thêm/);
  assert.doesNotMatch(html, /mở khoá/);
});

test("handbook: giai thich ro viec tra hang thi tien bi tru the nao", () => {
  const html = render();
  assert.match(html, /trả hàng/);
  assert.match(html, /khi bạn gửi yêu cầu rút tiền lần sau/);
  assert.doesNotMatch(html, /trừ dần/, "cau cua mo hinh no CU");
  assert.match(html, /không phải chuyển tiền lại/, "thieu cau nay thi user tuong phai tra tien ra");
});

test("handbook: noi ro moc 15 ngay cua Shopee de user kiem chung duoc", () => {
  const html = render();
  assert.match(html, /15 ngày/);
});
