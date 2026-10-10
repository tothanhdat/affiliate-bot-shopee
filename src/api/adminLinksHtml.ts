import type { LinkSourceContext, RequestLogEntry, RequestOutcome } from "../core/types.js";
import type { CreatedLinkFilters, CreatedLinksTotals } from "../core/logStore.js";
import { getMerchantConfig } from "../core/merchants.js";
import { formatVnd } from "../core/money.js";
import { copyIconButton, escapeHtml, formatDateTimeParts } from "./htmlHelpers.js";
import {
  FIELD_CLASS,
  FIELD_LABEL_CLASS,
  SELECT_CHEVRON_CLASS,
  adminShell,
  icon,
  kpiCard,
  kpiGrid,
  merchantChipClass,
  nameKey,
  paginationItems,
  selectOptions,
  userAvatar,
} from "./adminHtml.js";

/**
 * Trang /admin/links - "Link da tao" (2026-10-08, yeu cau truc tiep cua user).
 *
 * Nguon du lieu la bang `requests` cua logStore (MOI luot tao link, ke ca luot loi), gop voi ten
 * hien thi lay tu `user_profiles` ben ledgerStore - hai DB RIENG nen route phai gop trong JS,
 * khong JOIN duoc.
 *
 * Ba cot `product_name`/`commission_estimate`/`source_context` chi co du lieu cho luot tao TU
 * 2026-10-08; row cu hien "—" va KHONG duoc bia so (xem migrateAddLinkDetailColumns).
 */

export const LINKS_PAGE_SIZE = 50;

export interface LinksPagination {
  /** 1-based, route da kep ve khoang hop le truoc khi truyen vao. */
  page: number;
  totalPages: number;
  totalEntries: number;
}

const OUTCOME_OPTIONS: RequestOutcome[] = ["success", "error"];
const OUTCOME_LABELS: Record<RequestOutcome, string> = {
  success: "Thành công",
  error: "Lỗi",
};

/**
 * Nhan noi gui. Chip VIEN, mau TRUNG TINH co chu dich: 3 mau mang nghia trong khu /admin da kin
 * (cam = cho xac nhan / loi nhuan chu bot, xanh la = kha dung, xanh duong = Zalo), them mau thu tu
 * cho group/DM se lam loang nghia cua chung. Hinh dang + chu la du de phan biet.
 */
const SOURCE_LABELS: Record<LinkSourceContext, string> = {
  group: "Group",
  dm: "DM",
  api: "API",
};

function sourceChip(source: LinkSourceContext | null): string {
  if (!source) return `<span class="text-[11px] text-slate-400">—</span>`;
  return `<span class="inline-flex items-center rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">${SOURCE_LABELS[source]}</span>`;
}

/** O link dai: cat bang `truncate` + giu `title` de hover ra link day du. Mo tab moi, co rel an toan. */
function linkCell(url: string, label: string, ariaLabel: string): string {
  return `<div class="flex items-center gap-1.5">
    <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow" title="${escapeHtml(url)}"
       class="block max-w-[138px] truncate font-medium text-indigo-600 no-underline hover:underline">${escapeHtml(label)}</a>
    ${copyIconButton(url, ariaLabel)}
  </div>`;
}

/** Bo phan giao thuc + "www." cho de doc - link day du van o `title` va o nut copy. */
function shortenUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "");
}

/**
 * O hoa hong uoc tinh. BA trang thai loai tru nhau, dung gop lai (xem commissionLookup.ts):
 * - so > 0  -> so tien
 * - 0       -> "0 đ" + dong giai thich "shop chưa bật hoa hồng" (da XAC MINH tu nguon)
 * - null    -> "—" (khong tra duoc, hoac row ghi truoc 2026-10-08)
 *
 * Noi "chua bat hoa hong" o o dang la null se la ket luan SAI ve mot san pham binh thuong, nen
 * hai nhanh duoi phai tach han nhau.
 */
function commissionCell(amount: number | null, outcome: RequestOutcome): string {
  if (outcome === "error" || amount === null) {
    return `<td class="px-4 py-3.5 text-right"><span class="text-slate-400">—</span></td>`;
  }
  if (amount === 0) {
    return `<td class="px-4 py-3.5 text-right">
      <div class="font-medium text-slate-400 tabular-nums">0 đ</div>
      <div class="mt-0.5 text-[11px] text-amber-600">shop chưa bật hoa hồng</div>
    </td>`;
  }
  return `<td class="px-4 py-3.5 text-right font-semibold text-emerald-600 tabular-nums">${formatVnd(amount)}</td>`;
}

/** Dung lai URL /admin/links giu NGUYEN bo loc, chi doi so trang. */
/**
 * Gia tri cho <input type="datetime-local">, dang "YYYY-MM-DDTHH:mm". Link cu chi co ngay thi "tu" =
 * 00:00 va "den" = 23:59 - dung nghia cua bo loc ngay cu, de o khong bi trong khi trang van dang loc.
 */
function dateTimeInputValue(value: string | undefined, edge: "from" | "to"): string {
  if (!value) return "";
  return value.length === 10 ? `${value}T${edge === "from" ? "00:00" : "23:59"}` : value;
}

function linksPageHref(filters: CreatedLinkFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.search) params.set("q", filters.search);
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.fromDate) params.set("from", filters.fromDate);
  if (filters.toDate) params.set("to", filters.toDate);
  if (filters.userId) params.set("userId", filters.userId);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query === "" ? "/admin/links" : `/admin/links?${query}`;
}

function renderPagination(filters: CreatedLinkFilters, pagination: LinksPagination): string {
  if (pagination.totalPages <= 1) return "";
  const { page, totalPages } = pagination;
  const prev =
    page > 1
      ? `<a href="${escapeHtml(linksPageHref(filters, page - 1))}" aria-label="Trang trước">${icon("chevron-left")}</a>`
      : `<span class="disabled" aria-hidden="true">${icon("chevron-left")}</span>`;
  const next =
    page < totalPages
      ? `<a href="${escapeHtml(linksPageHref(filters, page + 1))}" aria-label="Trang sau">${icon("chevron-right")}</a>`
      : `<span class="disabled" aria-hidden="true">${icon("chevron-right")}</span>`;
  const middle = paginationItems(page, totalPages)
    .map((item) =>
      item === "gap"
        ? `<span class="gap">…</span>`
        : item === page
          ? `<span class="current" aria-current="page">${item}</span>`
          : `<a href="${escapeHtml(linksPageHref(filters, item))}">${item}</a>`
    )
    .join("");
  return `<nav class="pagination" aria-label="Phân trang danh sách link">${prev}${middle}${next}</nav>`;
}

export function renderLinksPage(
  entries: RequestLogEntry[],
  filters: CreatedLinkFilters,
  displayNames: Map<string, string>,
  pagination: LinksPagination,
  totals: CreatedLinksTotals,
  /** So yeu cau rut dang cho - chi de hien badge tren muc nav, xem adminShell(). */
  pendingWithdrawals?: number
): string {
  const rows = entries
    .map((e) => {
      const when = formatDateTimeParts(e.timestamp);
      const displayName = displayNames.get(nameKey(e.platform, e.userId)) ?? null;
      const failed = e.outcome === "error";

      // Ten hien thi: user Zalo rat thuong chua co ten (chi nhan tin trong group). Ghi ro "Chưa đặt
      // tên" chu khong de o trong - o trong doc ra nhu du lieu bi mat.
      const nameBlock = `<div class="flex items-center gap-2.5">
        ${userAvatar(displayName, e.userId)}
        <div class="min-w-0">
          <div class="truncate font-medium text-slate-800">${
            displayName ? escapeHtml(displayName) : `<span class="text-slate-400">Chưa đặt tên</span>`
          }</div>
          <div class="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
            <span class="truncate font-mono">${escapeHtml(e.userId)}</span>
            ${copyIconButton(e.userId, `Sao chép User ID ${e.userId}`)}
          </div>
        </div>
      </div>`;

      // Luot loi khong co link affiliate nao -> dung chinh o do de noi vi sao, kem ma loi de tra
      // cuu. Them cot thu 9 chi cho trang thai se day bang ra ngoai man hinh.
      const affiliateBlock = failed
        ? `<div class="flex flex-col items-start gap-1">
             <span class="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap"
                   style="background:var(--danger-soft);color:var(--danger);border-color:color-mix(in srgb, var(--danger) 25%, transparent)">Lỗi</span>
             <span class="font-mono text-[11px] text-slate-400">${escapeHtml(e.errorCode ?? "UNKNOWN")}</span>
           </div>`
        : e.affiliateUrl
          ? linkCell(e.affiliateUrl, shortenUrl(e.affiliateUrl), `Sao chép link affiliate ${e.affiliateUrl}`)
          : `<span class="text-slate-400">—</span>`;

      // Sub_id (2026-10-10): khoa de doi chieu voi Sub_id1-5 cua bao cao Shopee. Cat gon bang CSS
      // (`truncate`) chu KHONG cat chuoi: doan cuoi (random) moi la phan phan biet cac luot, va
      // title + nut copy luon giu nguyen chuoi day du. Cot cat o ~140px de khong day cot "Hoa hong
      // uoc tinh" ra ngoai man hinh (xem chu thich o dau file ve do rong bang).
      const subIdBlock = e.subId
        ? `<div class="flex items-center gap-1.5">
    <span class="block max-w-[140px] truncate font-mono text-[11px] text-slate-600" title="${escapeHtml(e.subId)}">${escapeHtml(e.subId)}</span>
    ${copyIconButton(e.subId, `Sao chép Sub_id ${e.subId}`)}
  </div>`
        : `<span class="text-slate-400">—</span>`;

      const productBlock = e.productName
        ? `<span class="block truncate font-medium text-slate-700" title="${escapeHtml(e.productName)}">${escapeHtml(
            e.productName
          )}</span>`
        : `<span class="text-slate-400">—</span>`;

      const merchantChip = e.merchant
        ? `<span class="inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium ${merchantChipClass(
            e.merchant
          )}">${escapeHtml(getMerchantConfig(e.merchant).displayName)}</span>`
        : "";

      return `<tr class="transition hover:bg-slate-50/80${failed ? " bg-rose-50/20" : ""}">
  <td class="px-4 py-3.5">
    <div class="font-semibold text-slate-800 tabular-nums">${escapeHtml(when.time)}</div>
    <div class="mt-0.5 text-[11px] text-slate-400 tabular-nums">${escapeHtml(when.date)}</div>
  </td>
  <td class="max-w-[180px] px-4 py-3.5">${nameBlock}</td>
  <td class="px-4 py-3.5">
    <div class="flex items-center gap-1.5">
      ${sourceChip(e.sourceContext)}
    </div>
    ${merchantChip ? `<div class="mt-1">${merchantChip}</div>` : ""}
  </td>
  <td class="px-4 py-3.5">${linkCell(
    e.originalUrl,
    shortenUrl(e.originalUrl),
    `Sao chép link gốc ${e.originalUrl}`
  )}</td>
  <td class="px-4 py-3.5">${affiliateBlock}</td>
  <td class="px-4 py-3.5">${subIdBlock}</td>
  <td class="max-w-[200px] px-4 py-3.5">${productBlock}</td>
  ${commissionCell(e.commissionEstimate, e.outcome)}
</tr>`;
    })
    .join("\n");

  // 4 the KPI tinh tren DUNG bo loc dang ap (getCreatedLinksTotals dung chung menh de WHERE voi
  // bang) - lech la the KPI noi mot so trong khi bang liet ke so khac.
  const kpiRow = kpiGrid([
    kpiCard({
      label: "Tổng lượt tạo link",
      value: String(totals.total),
      note: "theo bộ lọc đang áp",
      icon: "link",
      valueClass: "text-slate-800",
      iconClass: "bg-slate-100 text-slate-600",
    }),
    kpiCard({
      label: "Tạo thành công",
      value: String(totals.success),
      note: `${totals.distinctUsers} người dùng`,
      icon: "check-circle",
      valueClass: "text-emerald-600",
      iconClass: "bg-emerald-50 text-emerald-600",
    }),
    kpiCard({
      label: "Lượt lỗi",
      value: String(totals.errors),
      note: "link bị từ chối",
      icon: "alert-circle",
      valueClass: totals.errors > 0 ? "text-rose-600" : "text-slate-400",
      iconClass: "bg-rose-50 text-rose-600",
    }),
    kpiCard({
      label: "Hoa hồng ước tính",
      value: formatVnd(totals.commissionEstimateTotal),
      // Dong nay BAT BUOC chu khong phai trang tri: so nay la hoa hong GOC Shopee tra, khong phai
      // tien user nhan, va chi cong duoc nhung luot TRA DUOC gia - thieu chu thich thi admin se
      // doc nham thanh doanh thu du kien.
      note: "hoa hồng gốc, chỉ lượt tra được giá",
      icon: "coins",
      valueClass: "text-indigo-600",
      iconClass: "bg-indigo-50 text-indigo-600",
    }),
  ]);

  // Form GET khong co input "page" -> moi lan bam Loc tu dong ve trang 1 (doi bo loc thi so trang
  // cu khong con y nghia). `userId` la input AN: bo loc khop CHINH XAC do /admin/users bam sang,
  // bam Loc khong duoc lam mat no.
  const filterForm = `<form method="GET" action="/admin/links" class="mb-5 flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
  <div class="flex flex-wrap items-end gap-3">
    <div class="w-full sm:w-80">
      <label class="${FIELD_LABEL_CLASS}" for="links-q">Tìm kiếm</label>
      <div class="relative">
        ${icon("search", "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400")}
        <input type="search" id="links-q" name="q" value="${escapeHtml(filters.search ?? "")}" placeholder="Tìm theo tên sản phẩm, user ID, link hoặc Sub_id..." class="${FIELD_CLASS} pl-9">
      </div>
    </div>
    <div class="w-full sm:w-40">
      <label class="${FIELD_LABEL_CLASS}" for="links-outcome">Kết quả</label>
      <select id="links-outcome" name="outcome" class="${FIELD_CLASS} ${SELECT_CHEVRON_CLASS}">${selectOptions(
        OUTCOME_OPTIONS,
        (v: RequestOutcome) => OUTCOME_LABELS[v],
        filters.outcome
      )}</select>
    </div>
    <div class="w-full sm:w-56">
      <label class="${FIELD_LABEL_CLASS}" for="links-from">Từ lúc</label>
      <input type="datetime-local" id="links-from" name="from" value="${escapeHtml(
        dateTimeInputValue(filters.fromDate, "from")
      )}" max="${escapeHtml(dateTimeInputValue(filters.toDate, "to"))}" class="${FIELD_CLASS}">
    </div>
    <div class="w-full sm:w-56">
      <label class="${FIELD_LABEL_CLASS}" for="links-to">Đến lúc</label>
      <input type="datetime-local" id="links-to" name="to" value="${escapeHtml(
        dateTimeInputValue(filters.toDate, "to")
      )}" min="${escapeHtml(dateTimeInputValue(filters.fromDate, "from"))}" class="${FIELD_CLASS}">
    </div>
  </div>
  ${filters.userId ? `<input type="hidden" name="userId" value="${escapeHtml(filters.userId)}">` : ""}
  <button type="submit" class="inline-flex w-full shrink-0 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 sm:w-auto">
    ${icon("search", "h-3.5 w-3.5")} Lọc
  </button>
</form>`;

  const hasFilter = Boolean(
    filters.search || filters.outcome || filters.userId || filters.fromDate || filters.toDate
  );
  const emptyState = `<div class="px-5 py-14 text-center">
  <div class="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">${icon(
    "link",
    "h-5 w-5"
  )}</div>
  <div class="mb-1 text-sm font-semibold text-slate-700">${
    hasFilter ? "Chưa có lượt nào khớp bộ lọc" : "Chưa có link nào được tạo"
  }</div>
  <p class="m-0 text-xs text-slate-500">${
    hasFilter
      ? "Thử bỏ bớt điều kiện lọc, hoặc xoá nội dung trong ô tìm kiếm."
      : "Mỗi lần user gửi link sản phẩm cho bot, lượt đó sẽ xuất hiện ở đây."
  }</p>
</div>`;

  // Chan duoi lay theo so dong THAT SU render chu khong phai page * PAGE_SIZE - trang cuoi thuong
  // khong day, tinh theo cong thuc se bao thua.
  const firstIndex = (pagination.page - 1) * LINKS_PAGE_SIZE + 1;
  const lastIndex = firstIndex + entries.length - 1;
  const rangeText = `Hiển thị <strong class="font-semibold text-slate-800 tabular-nums">${firstIndex} – ${lastIndex}</strong> trên tổng số <strong class="font-semibold text-slate-800 tabular-nums">${pagination.totalEntries}</strong> lượt`;

  const thClass = "px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500";
  const table = `<div class="table-scroll">
    <table class="w-full border-collapse whitespace-nowrap text-xs">
      <thead class="border-b border-slate-200 bg-slate-50">
        <tr>
          <th class="${thClass}">Thời gian</th>
          <th class="${thClass}">Người dùng</th>
          <th class="${thClass}">Nơi gửi</th>
          <th class="${thClass}">Link gốc</th>
          <th class="${thClass}">Link đã chuyển đổi</th>
          <th class="${thClass}">Sub_id</th>
          <th class="${thClass}">Tên sản phẩm</th>
          <th class="${thClass} !text-right">Hoa hồng ước tính</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100">${rows}</tbody>
    </table>
  </div>
  <div class="flex flex-col items-start justify-between gap-3 border-t border-slate-200 px-4 py-3.5 text-xs text-slate-500 sm:flex-row sm:items-center">
    <div>${rangeText}</div>
    ${renderPagination(filters, pagination)}
  </div>`;

  // Ghi chu ve gioi han du lieu, dat NGAY TREN bang: khong co dong nay thi mot trang day "—" o 3
  // cot cuoi doc ra nhu he thong dang hong, trong khi day la row ghi truoc khi co 3 cot do.
  const dataNote = `<p class="mb-5 flex items-start gap-2 rounded-xl border border-slate-200/80 bg-slate-50/60 px-4 py-3 text-[11px] leading-relaxed text-slate-500">
  ${icon("info", "mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400")}
  <span>Tên sản phẩm, hoa hồng ước tính và nơi gửi chỉ được ghi cho link tạo từ 08/10/2026 — lượt cũ hơn hiển thị “—”.
  Hoa hồng là số <strong class="font-semibold text-slate-600">gốc Shopee trả</strong> (chưa trừ thuế, phí sàn và phần chia cho khách), ước tính theo giá niêm yết lúc tạo link.</span>
</p>`;

  const body = `${kpiRow}
${filterForm}
${dataNote}
<div class="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
${entries.length > 0 ? table : emptyState}
</div>`;

  return adminShell("links", "Link đã tạo", body, pendingWithdrawals);
}
