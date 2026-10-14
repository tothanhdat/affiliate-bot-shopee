import { TIP_DESCRIPTION_MAX_LENGTH, TIP_TITLE_MAX_LENGTH } from "../core/ledgerStore.js";
import type { Tip } from "../core/types.js";
import { FIELD_CLASS, FIELD_LABEL_CLASS, icon } from "./adminHtml.js";
import { escapeHtml } from "./htmlHelpers.js";
import { TIPS_ADMIN_SCRIPT } from "./tipsAdminScript.js";

/**
 * Trang /admin/tips (2026-10-14, thiet ke lai theo anh tham chieu cua chu bot): THAN trang, server tu boc
 * adminShell. Moi Tip la MOT HANG ngang: tay nam keo, anh vuong, tieu de + nhan trang thai, mo ta, cong tac
 * hien/an, nut Sua, nut Xoa. Xem spec docs/superpowers/specs/2026-10-14-tips-slide-design.md muc 5.
 *
 * Mo/dong form Sua / Xoa (xac nhan 2 buoc) / Them KHONG can JS: checkbox an (.tip-toggle) dung TRUOC hang + <label for>
 * lam nut; CSS `.tip-toggle-x:checked ~ .tip-panel-x` hien panel. Khong dung window.confirm() (tung treo trinh duyet
 * tu dong khi test) va chay duoc ca khi JS loi. Phan lon style la class that trong admin.css (.tip-*), xem
 * .claude/rules/admin-ui-nen-tang.md ve bay Tailwind khong-preflight.
 */

export interface TipsAdminDraft {
  /** null = form "Them Tip"; so = form sua cua Tip do. */
  id: number | null;
  title: string;
  description: string;
}

/**
 * Chuan hoa chuoi de tim kiem: viet thuong, bo dau tieng Viet, "d gach" thanh "d". PHAI giong normalizeSearch()
 * trong tipsAdminScript.ts - data-search sinh o day, tu khoa duoc chuan hoa o trinh duyet, 2 ben lech nhau la tim sai.
 */
export function normalizeTipSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .trim();
}

const BTN_BASE =
  "inline-flex cursor-pointer items-center rounded-lg px-3.5 py-2 text-sm font-semibold transition";
const BTN_PRIMARY = `${BTN_BASE} border-0 bg-indigo-600 text-white hover:bg-indigo-700`;
const BTN_SECONDARY = `${BTN_BASE} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
const BTN_DANGER = `${BTN_BASE} border-0 bg-rose-600 text-white hover:bg-rose-700`;

const IMAGE_HINT = "Ảnh ngang, khoảng 1000px là đủ. JPG / PNG / WebP, tối đa 5MB.";

function imageUrl(imagePath: string): string {
  return `/tips/images/${encodeURIComponent(imagePath)}`;
}

function titleInput(value: string): string {
  return `<input type="text" name="title" required maxlength="${TIP_TITLE_MAX_LENGTH}" value="${escapeHtml(value)}" class="${FIELD_CLASS}">`;
}

function descriptionInput(value: string): string {
  return `<textarea name="description" rows="4" maxlength="${TIP_DESCRIPTION_MAX_LENGTH}" class="${FIELD_CLASS}">${escapeHtml(value)}</textarea>`;
}

function imageFileInput(): string {
  return `<input type="file" name="image" accept="image/jpeg,image/png,image/webp" class="block w-full text-sm text-slate-600">`;
}

function createPanel(draft: TipsAdminDraft | undefined): string {
  const mine = draft !== undefined && draft.id === null ? draft : undefined;
  return `<div class="tip-panel-create">
  <form method="post" action="/admin/tips" enctype="multipart/form-data" class="space-y-4">
    <div><label class="${FIELD_LABEL_CLASS}">Tiêu đề</label>${titleInput(mine?.title ?? "")}</div>
    <div><label class="${FIELD_LABEL_CLASS}">Mô tả</label>${descriptionInput(mine?.description ?? "")}</div>
    <div><label class="${FIELD_LABEL_CLASS}">Ảnh (không bắt buộc)</label>${imageFileInput()}
      <p class="mt-1 text-xs text-slate-400">${IMAGE_HINT}</p></div>
    <div class="flex gap-2"><button type="submit" class="${BTN_PRIMARY}">Thêm Tip</button>
      <label for="tip-create-toggle" class="${BTN_SECONDARY}">Huỷ</label></div>
  </form>
</div>`;
}

function editPanel(tip: Tip, draft: TipsAdminDraft | undefined): string {
  const mine = draft !== undefined && draft.id === tip.id ? draft : undefined;
  const removeOption = tip.imagePath
    ? `<label class="mr-4 inline-flex items-center gap-1.5 text-sm"><input type="radio" name="imageAction" value="remove"> Bỏ ảnh</label>`
    : "";
  const replaceLabel = tip.imagePath ? "Thay ảnh" : "Thêm ảnh";
  return `<div class="tip-panel tip-panel-edit">
    <form method="post" action="/admin/tips/${tip.id}" enctype="multipart/form-data" class="space-y-3">
      <div><label class="${FIELD_LABEL_CLASS}">Tiêu đề</label>${titleInput(mine?.title ?? tip.title)}</div>
      <div><label class="${FIELD_LABEL_CLASS}">Mô tả</label>${descriptionInput(mine?.description ?? tip.description)}</div>
      <div>
        <label class="${FIELD_LABEL_CLASS}">Ảnh</label>
        <label class="mr-4 inline-flex items-center gap-1.5 text-sm"><input type="radio" name="imageAction" value="keep" checked> Giữ nguyên</label>
        <label class="mr-4 inline-flex items-center gap-1.5 text-sm"><input type="radio" name="imageAction" value="replace"> ${replaceLabel}</label>
        ${removeOption}
        <div class="mt-2">${imageFileInput()}</div>
        <p class="mt-1 text-xs text-slate-400">${IMAGE_HINT}</p>
      </div>
      <div class="flex gap-2"><button type="submit" class="${BTN_PRIMARY}">Lưu</button>
        <label for="tip-edit-${tip.id}-toggle" class="${BTN_SECONDARY}">Đóng</label></div>
    </form>
  </div>`;
}

function deletePanel(tip: Tip): string {
  return `<div class="tip-panel tip-panel-del">
    <form method="post" action="/admin/tips/${tip.id}/delete" class="flex flex-wrap items-center gap-2">
      <span class="text-sm text-rose-700">Xoá vĩnh viễn Tip này và cả ảnh của nó?</span>
      <button type="submit" class="${BTN_DANGER}">Xác nhận xoá</button>
      <label for="tip-del-${tip.id}-toggle" class="${BTN_SECONDARY}">Huỷ</label>
    </form>
    <p class="mt-2 text-xs text-slate-400">Muốn giữ lại để dùng sau thì hãy ẩn Tip bằng công tắc, đừng xoá.</p>
  </div>`;
}

function statusPill(active: boolean): string {
  return active
    ? `<span class="tip-pill tip-pill-on">Đang hiện</span>`
    : `<span class="tip-pill tip-pill-off">Đang ẩn</span>`;
}

function renderTipCard(tip: Tip, draft: TipsAdminDraft | undefined): string {
  const editOpen = draft !== undefined && draft.id === tip.id;
  const thumb = tip.imagePath
    ? `<img src="${imageUrl(tip.imagePath)}" alt="" draggable="false" loading="lazy" class="tip-thumb">`
    : `<div class="tip-thumb-empty">${icon("image", "h-6 w-6")}</div>`;
  const nextActive = tip.isActive ? "0" : "1";
  const switchLabel = tip.isActive ? "Ẩn Tip này khỏi user" : "Hiện Tip này cho user";
  const search = normalizeTipSearch(`${tip.title} ${tip.description}`);
  return `<li class="tip-card${tip.isActive ? "" : " is-inactive"}" data-tip-id="${tip.id}" data-search="${escapeHtml(search)}">
  <input type="checkbox" id="tip-edit-${tip.id}-toggle" class="tip-toggle tip-toggle-edit"${editOpen ? " checked" : ""}>
  <input type="checkbox" id="tip-del-${tip.id}-toggle" class="tip-toggle tip-toggle-del">
  <div class="tip-row">
    <span class="tip-handle" draggable="true" role="button" tabindex="0" aria-label="Kéo để đổi thứ tự" title="Kéo để đổi thứ tự">${icon("grip-vertical", "h-5 w-5")}</span>
    ${thumb}
    <div class="tip-main">
      <div class="tip-heading"><span class="tip-title">${escapeHtml(tip.title)}</span>${statusPill(tip.isActive)}</div>
      <p class="tip-desc">${escapeHtml(tip.description)}</p>
    </div>
    <div class="tip-actions">
      <form method="post" action="/admin/tips/${tip.id}/active">
        <input type="hidden" name="active" value="${nextActive}">
        <button type="submit" class="tip-switch" role="switch" aria-checked="${tip.isActive ? "true" : "false"}" aria-label="${switchLabel}"></button>
      </form>
      <label for="tip-edit-${tip.id}-toggle" class="tip-btn tip-btn-edit">${icon("pencil", "h-3.5 w-3.5")} Sửa</label>
      <label for="tip-del-${tip.id}-toggle" class="tip-btn tip-btn-del">${icon("trash-2", "h-3.5 w-3.5")} Xoá</label>
    </div>
  </div>
  ${editPanel(tip, draft)}
  ${deletePanel(tip)}
</li>`;
}

export function renderAdminTipsPage(input: { tips: Tip[]; errorMessage?: string; draft?: TipsAdminDraft }): string {
  const { tips, errorMessage, draft } = input;
  const activeCount = tips.filter((tip) => tip.isActive).length;
  const createOpen = draft !== undefined && draft.id === null;
  const banner = errorMessage
    ? `<div class="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">${escapeHtml(errorMessage)}</div>`
    : "";
  const list =
    tips.length === 0
      ? `<div class="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
  Chưa có Tip nào. Bấm “Thêm Tip” để tạo mẹo đầu tiên — user sẽ thấy nút 💡 Tips trên dashboard khi có ít nhất 1 Tip đang bật.
</div>`
      : `<ul id="tips-list" class="tip-list">
${tips.map((tip) => renderTipCard(tip, draft)).join("\n")}
</ul>
<div id="tips-no-match" class="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500" style="display:none">Không có Tip nào khớp với từ khoá.</div>`;
  return `<div class="tip-page">
  <h1 class="tip-h1">Quản lý Tips</h1>
  <p class="tip-sub">${tips.length} Tip, ${activeCount} đang hiện. Kéo tay nắm ⋮⋮ để đổi thứ tự — đây cũng là thứ tự slide bên user.</p>
  ${banner}
  <div id="tips-order-error" role="alert" class="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" style="display:none"></div>
  <input type="checkbox" id="tip-create-toggle" class="tip-toggle tip-toggle-create"${createOpen ? " checked" : ""}>
  <div class="tip-toolbar">
    <label for="tip-create-toggle" class="tip-add-btn">${icon("plus", "h-4 w-4")} Thêm Tip</label>
    <div class="tip-search">
      ${icon("search", "pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400")}
      <label class="sr-only" for="tips-search">Tìm kiếm Tip</label>
      <input type="search" id="tips-search" autocomplete="off" placeholder="Tìm kiếm tip..." class="${FIELD_CLASS} pl-8">
    </div>
  </div>
  ${createPanel(draft)}
  ${list}
</div>
<script>${TIPS_ADMIN_SCRIPT}</script>`;
}
