import { test } from "node:test";
import assert from "node:assert/strict";
import { renderAdminTipsPage } from "../adminTipsHtml.js";
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

test("trang rong: co cau huong dan, khong co danh sach", () => {
  const html = renderAdminTipsPage({ tips: [] });
  assert.match(html, /Chưa có Tip nào/);
  assert.doesNotMatch(html, /id="tips-list"/);
});

test("moi tip co tay nam keo, cac form tat-bat/sua/xoa dung route, va hint 'Tat, dung Xoa'", () => {
  const html = renderAdminTipsPage({ tips: [tip({ id: 7 })] });
  assert.match(html, /data-tip-id="7"/);
  assert.match(html, /class="tip-handle"[^>]*draggable="true"/);
  assert.match(html, /action="\/admin\/tips\/7"/);
  assert.match(html, /action="\/admin\/tips\/7\/active"/);
  assert.match(html, /action="\/admin\/tips\/7\/delete"/);
  assert.match(html, /Muốn giữ lại để dùng sau thì <b>Tắt<\/b>, đừng Xoá/);
});

test("tip da tat: co nhan CHU 'Đã tắt' (khong chi dua vao do mo) va nut Bat lai", () => {
  const html = renderAdminTipsPage({ tips: [tip({ isActive: false })] });
  assert.match(html, /is-inactive/);
  assert.match(html, />Đã tắt</);
  assert.match(html, /name="active" value="1"/);
});

test("tip dang bat: nhan 'Đang hiện' va nut Tat gui active=0", () => {
  const html = renderAdminTipsPage({ tips: [tip({ isActive: true })] });
  assert.match(html, />Đang hiện</);
  assert.match(html, /name="active" value="0"/);
});

test("anh: dung URL /tips/images/ da encode, khong cho keo anh, co tuy chon bo anh; khong anh thi khong co <img>", () => {
  const withImage = renderAdminTipsPage({ tips: [tip({ imagePath: "a b.png" })] });
  assert.match(withImage, /src="\/tips\/images\/a%20b\.png"/);
  assert.match(withImage, /draggable="false"/);
  assert.match(withImage, /value="remove"/);

  const noImage = renderAdminTipsPage({ tips: [tip({ imagePath: null })] });
  assert.doesNotMatch(noImage, /<img /);
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

test("xoa 2 buoc bang <details> + nut Huy, KHONG dung window.confirm / onsubmit confirm", () => {
  const html = renderAdminTipsPage({ tips: [tip({ id: 3 })] });
  assert.match(html, /<details[^>]*>\s*<summary[^>]*>Xoá<\/summary>/);
  assert.match(html, /Xác nhận xoá/);
  assert.match(html, /data-close-details/);
  assert.doesNotMatch(html, /confirm\(/);
});

test("form Them Tip: mo san khi co draft tao moi, giu nguyen chu admin da go, hien banner loi", () => {
  const html = renderAdminTipsPage({
    tips: [],
    errorMessage: "Ảnh quá lớn, tối đa 5MB.",
    draft: { id: null, title: "Tieu de dang go", description: "Mo ta dai dang go" },
  });
  assert.match(html, /Ảnh quá lớn, tối đa 5MB\./);
  assert.match(html, /<details id="tip-create"[^>]*\bopen\b/);
  assert.match(html, /value="Tieu de dang go"/);
  assert.match(html, />Mo ta dai dang go<\/textarea>/);
});

test("form sua: draft cua dung tip mo san va giu chu da go", () => {
  const html = renderAdminTipsPage({
    tips: [tip({ id: 5, title: "Cu" })],
    errorMessage: "Tiêu đề không được để trống.",
    draft: { id: 5, title: "", description: "Mo ta moi" },
  });
  assert.match(html, /<details id="tip-edit-5"[^>]*\bopen\b/);
  assert.match(html, />Mo ta moi<\/textarea>/);
});

test("form co enctype multipart, input file chi nhan jpg/png/webp, co maxlength cho tieu de", () => {
  const html = renderAdminTipsPage({ tips: [] });
  assert.match(html, /enctype="multipart\/form-data"/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(html, /maxlength="120"/);
  assert.match(html, /maxlength="2000"/);
});
