import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTipSearch, renderAdminTipsPage } from "../adminTipsHtml.js";
import type { Tip } from "../../core/types.js";

function tip(overrides: Partial<Tip> = {}): Tip {
  return {
    id: 1,
    title: "Tieu de",
    description: "Mo ta",
    imagePath: null,
    sortOrder: 1,
    isActive: true,
    createdAt: "2026-10-14T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
    ...overrides,
  };
}

test("tieu de trang 'Quan ly Tips' + phu de dem so Tip va so dang hien", () => {
  const html = renderAdminTipsPage({ tips: [tip({ id: 1 }), tip({ id: 2, isActive: false }), tip({ id: 3 })] });
  assert.match(html, /<h1[^>]*>Quản lý Tips<\/h1>/);
  assert.match(html, /3 Tip, 2 đang hiện\./);
  assert.match(html, /Kéo tay nắm ⋮⋮ để đổi thứ tự/);
});

test("thanh cong cu: nut '+ Them Tip' ben trai va o tim kiem 'Tim kiem tip...' ben phai", () => {
  const html = renderAdminTipsPage({ tips: [tip()] });
  assert.match(html, /<label[^>]*for="tip-create-toggle"[^>]*>[\s\S]*?Thêm Tip<\/label>/);
  assert.match(html, /<input type="search" id="tips-search"[^>]*placeholder="Tìm kiếm tip\.\.\."/);
  assert.ok(html.indexOf("tip-create-toggle") < html.indexOf('id="tips-search"'), "nut them nam truoc o tim kiem");
});

test("trang rong: co cau huong dan, khong co danh sach", () => {
  const html = renderAdminTipsPage({ tips: [] });
  assert.match(html, /Chưa có Tip nào/);
  assert.doesNotMatch(html, /id="tips-list"/);
});

test("moi Tip la MOT HANG: tay nam keo, anh, tieu de + nhan, cong tac, Sua, Xoa", () => {
  const html = renderAdminTipsPage({ tips: [tip({ id: 7, title: "Tieu de 7" })] });
  assert.match(html, /<li class="tip-card[^"]*" data-tip-id="7"/);
  assert.match(html, /class="tip-handle"[^>]*draggable="true"/);
  assert.match(html, /action="\/admin\/tips\/7\/active"/);
  assert.match(html, /<label[^>]*for="tip-edit-7-toggle"[^>]*>[\s\S]*?Sửa<\/label>/);
  assert.match(html, /<label[^>]*for="tip-del-7-toggle"[^>]*>[\s\S]*?Xoá<\/label>/);
  assert.match(html, /action="\/admin\/tips\/7"/);
  assert.match(html, /action="\/admin\/tips\/7\/delete"/);
});

test("nhan trang thai: 'Dang hien' (xanh) / 'Dang an' (xam) la CHU, khong chi dua vao mau", () => {
  const on = renderAdminTipsPage({ tips: [tip({ isActive: true })] });
  assert.match(on, />Đang hiện</);
  assert.doesNotMatch(on, />Đang ẩn</);
  assert.doesNotMatch(on, /is-inactive/);

  const off = renderAdminTipsPage({ tips: [tip({ isActive: false })] });
  assert.match(off, />Đang ẩn</);
  assert.match(off, /is-inactive/);
});

test("cong tac: la nut role=switch gui active dao nguoc; aria-checked theo trang thai", () => {
  const on = renderAdminTipsPage({ tips: [tip({ id: 4, isActive: true })] });
  assert.match(on, /<button type="submit" class="tip-switch"[^>]*role="switch"[^>]*aria-checked="true"/);
  assert.match(on, /name="active" value="0"/);

  const off = renderAdminTipsPage({ tips: [tip({ id: 4, isActive: false })] });
  assert.match(off, /role="switch"[^>]*aria-checked="false"/);
  assert.match(off, /name="active" value="1"/);
});

test("anh: dung URL /tips/images/ da encode + khong cho keo anh; khong anh thi co o placeholder, khong co <img>", () => {
  const withImage = renderAdminTipsPage({ tips: [tip({ imagePath: "a b.png" })] });
  assert.match(withImage, /src="\/tips\/images\/a%20b\.png"/);
  assert.match(withImage, /draggable="false"/);
  assert.match(withImage, /value="remove"/);

  const noImage = renderAdminTipsPage({ tips: [tip({ imagePath: null })] });
  assert.doesNotMatch(noImage, /<img /);
  assert.match(noImage, /class="tip-thumb-empty"/);
  assert.doesNotMatch(noImage, /value="remove"/);
});

test("escape HTML o tieu de va mo ta (khong chen duoc <script>)", () => {
  const html = renderAdminTipsPage({
    tips: [tip({ title: '<script>alert("x")</script>', description: "a & b <img src=x onerror=1>" })],
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;/);
});

test("xoa 2 buoc ngay tai cho bang checkbox+label (khong JS), co 'Xac nhan xoa', 'Huy' va hint 'an, dung xoa'; KHONG window.confirm", () => {
  const html = renderAdminTipsPage({ tips: [tip({ id: 3 })] });
  assert.match(html, /<input type="checkbox" id="tip-del-3-toggle" class="tip-toggle tip-toggle-del">/);
  assert.match(html, /Xác nhận xoá/);
  assert.match(html, /<label[^>]*for="tip-del-3-toggle"[^>]*>Huỷ<\/label>/);
  assert.match(html, /Muốn giữ lại để dùng sau thì hãy ẩn Tip bằng công tắc, đừng xoá/);
  assert.doesNotMatch(html, /confirm\(/);
  assert.doesNotMatch(html, /<details/);
});

test("form Them Tip: mo san khi co draft tao moi, giu nguyen chu admin da go, hien banner loi", () => {
  const html = renderAdminTipsPage({
    tips: [],
    errorMessage: "Ảnh quá lớn, tối đa 5MB.",
    draft: { id: null, title: "Tieu de dang go", description: "Mo ta dai dang go" },
  });
  assert.match(html, /Ảnh quá lớn, tối đa 5MB\./);
  assert.match(html, /<input type="checkbox" id="tip-create-toggle"[^>]*\bchecked\b/);
  assert.match(html, /value="Tieu de dang go"/);
  assert.match(html, />Mo ta dai dang go<\/textarea>/);
});

test("form Them Tip dong san khi khong co draft", () => {
  const html = renderAdminTipsPage({ tips: [] });
  assert.doesNotMatch(html, /<input type="checkbox" id="tip-create-toggle"[^>]*\bchecked\b/);
});

test("form sua: draft cua dung tip mo san va giu chu da go; tip khac van dong", () => {
  const html = renderAdminTipsPage({
    tips: [tip({ id: 5, title: "Cu" }), tip({ id: 6, title: "Khac" })],
    errorMessage: "Tiêu đề không được để trống.",
    draft: { id: 5, title: "", description: "Mo ta moi" },
  });
  assert.match(html, /<input type="checkbox" id="tip-edit-5-toggle"[^>]*\bchecked\b/);
  assert.doesNotMatch(html, /<input type="checkbox" id="tip-edit-6-toggle"[^>]*\bchecked\b/);
  assert.match(html, />Mo ta moi<\/textarea>/);
});

test("form co enctype multipart, input file chi nhan jpg/png/webp, co maxlength cho tieu de va mo ta", () => {
  const html = renderAdminTipsPage({ tips: [] });
  assert.match(html, /enctype="multipart\/form-data"/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(html, /maxlength="120"/);
  assert.match(html, /maxlength="2000"/);
});

test("data-search: tieu de + mo ta da bo dau, viet thuong (go 'meo' tim ra 'Mẹo', 'đơn' ra 'don')", () => {
  const html = renderAdminTipsPage({ tips: [tip({ title: "Mẹo Mua Đơn", description: "Giữ nguyên" })] });
  assert.match(html, /data-search="meo mua don giu nguyen"/);
});

test("normalizeTipSearch: bo dau tieng Viet, doi d-gach thanh d, viet thuong, cat khoang trang", () => {
  assert.equal(normalizeTipSearch("  Đặng Dũng Ơ Ư  "), "dang dung o u");
  assert.equal(normalizeTipSearch("Kính cường lực"), "kinh cuong luc");
  assert.equal(normalizeTipSearch(""), "");
});

test("o 'khong khop' co san (an) de script hien khi tim khong ra", () => {
  const html = renderAdminTipsPage({ tips: [tip()] });
  assert.match(html, /id="tips-no-match"[^>]*style="display:none"/);
});
