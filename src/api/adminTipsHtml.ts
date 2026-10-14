import { TIP_DESCRIPTION_MAX_LENGTH, TIP_TITLE_MAX_LENGTH } from "../core/ledgerStore.js";
import type { Tip } from "../core/types.js";
import { FIELD_CLASS, FIELD_LABEL_CLASS } from "./adminHtml.js";
import { escapeHtml } from "./htmlHelpers.js";
import { TIPS_ADMIN_SCRIPT } from "./tipsAdminScript.js";

/**
 * Trang /admin/tips (2026-10-14): THAN trang, server tu boc adminShell. Xem spec
 * docs/superpowers/specs/2026-10-14-tips-slide-design.md muc 5.
 *
 * Rang buoc Tailwind khong-preflight (xem .claude/rules/admin-ui-nen-tang.md): <button> tu reset
 * vien/nen (border-0 / border + bg-*), style keo-tha la class that trong admin.css (.tip-*).
 */

export interface TipsAdminDraft {
  /** null = form "Them Tip"; so = form sua cua Tip do. */
  id: number | null;
  title: string;
  description: string;
}

const BTN_BASE =
  "inline-flex cursor-pointer items-center rounded-lg px-3.5 py-2 text-sm font-semibold transition";
const BTN_PRIMARY = `${BTN_BASE} border-0 bg-indigo-600 text-white hover:bg-indigo-700`;
const BTN_SECONDARY = `${BTN_BASE} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
const BTN_DANGER = `${BTN_BASE} border-0 bg-rose-600 text-white hover:bg-rose-700`;
const SUMMARY_BTN = `${BTN_BASE} list-none border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;

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

function createForm(draft: TipsAdminDraft | undefined): string {
  const mine = draft !== undefined && draft.id === null ? draft : undefined;
  return `<details id="tip-create" class="details-plain rounded-xl border border-slate-200 bg-white p-4"${mine ? " open" : ""}>
  <summary class="${SUMMARY_BTN}">＋ Thêm Tip</summary>
  <form method="post" action="/admin/tips" enctype="multipart/form-data" class="mt-4 space-y-4">
    <div><label class="${FIELD_LABEL_CLASS}">Tiêu đề</label>${titleInput(mine?.title ?? "")}</div>
    <div><label class="${FIELD_LABEL_CLASS}">Mô tả</label>${descriptionInput(mine?.description ?? "")}</div>
    <div><label class="${FIELD_LABEL_CLASS}">Ảnh (không bắt buộc)</label>${imageFileInput()}
      <p class="mt-1 text-xs text-slate-400">${IMAGE_HINT}</p></div>
    <div class="flex gap-2"><button type="submit" class="${BTN_PRIMARY}">Thêm Tip</button>
      <button type="button" class="${BTN_SECONDARY}" data-close-details>Huỷ</button></div>
  </form>
</details>`;
}

function editForm(tip: Tip, draft: TipsAdminDraft | undefined): string {
  const mine = draft !== undefined && draft.id === tip.id ? draft : undefined;
  const removeOption = tip.imagePath
    ? `<label class="mr-4 inline-flex items-center gap-1.5 text-sm"><input type="radio" name="imageAction" value="remove"> Bỏ ảnh</label>`
    : "";
  const replaceLabel = tip.imagePath ? "Thay ảnh" : "Thêm ảnh";
  return `<details id="tip-edit-${tip.id}" class="details-plain"${mine ? " open" : ""}>
    <summary class="${SUMMARY_BTN}">Sửa</summary>
    <form method="post" action="/admin/tips/${tip.id}" enctype="multipart/form-data" class="mt-3 space-y-3">
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
        <button type="button" class="${BTN_SECONDARY}" data-close-details>Đóng</button></div>
    </form>
  </details>`;
}

function deleteForm(tip: Tip): string {
  return `<details class="details-plain">
    <summary class="${SUMMARY_BTN}">Xoá</summary>
    <form method="post" action="/admin/tips/${tip.id}/delete" class="mt-2 flex flex-wrap items-center gap-2">
      <span class="text-sm text-rose-700">Xoá vĩnh viễn Tip này và ảnh của nó?</span>
      <button type="submit" class="${BTN_DANGER}">Xác nhận xoá</button>
      <button type="button" class="${BTN_SECONDARY}" data-close-details>Huỷ</button>
    </form>
  </details>`;
}

function statusPill(active: boolean): string {
  return active
    ? `<span class="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">Đang hiện</span>`
    : `<span class="inline-flex items-center rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-600">Đã tắt</span>`;
}

function renderTipCard(tip: Tip, draft: TipsAdminDraft | undefined): string {
  const thumb = tip.imagePath
    ? `<img src="${imageUrl(tip.imagePath)}" alt="" draggable="false" loading="lazy" class="h-16 w-24 shrink-0 rounded-lg object-cover">`
    : `<div class="flex h-16 w-24 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">Không ảnh</div>`;
  const toggleLabel = tip.isActive ? "Tắt" : "Bật";
  const toggleValue = tip.isActive ? "0" : "1";
  return `<li class="tip-card rounded-xl border border-slate-200 bg-white p-4${tip.isActive ? "" : " is-inactive"}" data-tip-id="${tip.id}">
  <div class="flex items-start gap-3">
    <span class="tip-handle" draggable="true" role="button" tabindex="0" aria-label="Kéo để đổi thứ tự" title="Kéo để đổi thứ tự">⋮⋮</span>
    ${thumb}
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-2"><span class="font-semibold text-slate-900">${escapeHtml(tip.title)}</span>${statusPill(tip.isActive)}</div>
      <p class="mt-1 whitespace-pre-line text-sm text-slate-500">${escapeHtml(tip.description)}</p>
    </div>
    <form method="post" action="/admin/tips/${tip.id}/active" class="shrink-0">
      <input type="hidden" name="active" value="${toggleValue}">
      <button type="submit" class="${BTN_SECONDARY}">${toggleLabel}</button>
    </form>
  </div>
  <div class="mt-3 space-y-3 border-t border-slate-100 pt-3">
    ${editForm(tip, draft)}
    <div class="flex flex-wrap items-start gap-3">${deleteForm(tip)}
      <span class="pt-2 text-xs text-slate-400">Muốn giữ lại để dùng sau thì <b>Tắt</b>, đừng Xoá.</span></div>
  </div>
</li>`;
}

export function renderAdminTipsPage(input: { tips: Tip[]; errorMessage?: string; draft?: TipsAdminDraft }): string {
  const { tips, errorMessage, draft } = input;
  const activeCount = tips.filter((tip) => tip.isActive).length;
  const banner = errorMessage
    ? `<div class="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">${escapeHtml(errorMessage)}</div>`
    : "";
  const list =
    tips.length === 0
      ? `<div class="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
  Chưa có Tip nào. Bấm “Thêm Tip” để tạo mẹo đầu tiên — user sẽ thấy nút 💡 Tips trên dashboard khi có ít nhất 1 Tip đang bật.
</div>`
      : `<ul id="tips-list" class="tip-list space-y-3">
${tips.map((tip) => renderTipCard(tip, draft)).join("\n")}
</ul>`;
  return `<div class="space-y-4">
  <p class="text-sm text-slate-500">${tips.length} Tip, ${activeCount} đang hiện. Kéo tay nắm ⋮⋮ để đổi thứ tự — đây cũng là thứ tự slide bên user.</p>
  ${banner}
  <div id="tips-order-error" role="alert" class="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" style="display:none"></div>
  ${createForm(draft)}
  ${list}
</div>
<script>${TIPS_ADMIN_SCRIPT}</script>`;
}
