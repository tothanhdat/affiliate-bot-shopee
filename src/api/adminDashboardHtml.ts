import {
  DASHBOARD_RANGES,
  type DashboardRange,
  type DashboardStats,
} from "../core/dashboardStats.js";
import type { CommissionStatus } from "../core/types.js";
import { escapeHtml, formatVnd } from "./htmlHelpers.js";

/**
 * Trang /admin/dashboard (2026-10-01) - tong quan he thong bang the KPI + chart.
 *
 * Tach FILE RIENG khoi adminHtml.ts (da ~930 dong) thay vi them 1 ham nua vao do: trang nay la
 * trang DUY NHAT trong /admin co JS phia client that su (Chart.js), gom het phan do vao 1 cho de
 * khong lan sang cac trang HTML thuan con lai.
 *
 * NGOAI LE CO CHU DICH ve triet ly "khong JS client, khong CDN" cua thu muc nay: quyet dinh cua
 * user 2026-10-01 sau khi da duoc trinh bay danh doi (phu thuoc CDN ngoai ~80KB vs khong co
 * tooltip/legend bam duoc). He qua da duoc chap nhan: CDN hong thi chart trong - vi vay chart
 * CHINH (don theo ngay) luon di kem bang so lieu <details> doc duoc khong can JS, va moi con so
 * quan trong deu da nam tren the KPI (HTML thuan) chu khong chi song trong chart.
 */

const CHART_JS_CDN = "https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js";

/**
 * Mau theo TRANG THAI don - lay dung token status co san cua admin (xem shellStyles trong
 * adminHtml.ts va statusBadge trong htmlHelpers.ts), de 1 trang thai co CUNG mot mau o badge
 * bang /admin/orders lan o chart: mau di theo thuc the, khong doi theo cho hien thi.
 *
 * Da chay qua validator cua skill dataviz tren nen trang (#ffffff): dat ca 5 check, voi 1 WARN o
 * cap "Chờ xác nhận"↔"Khả dụng" (CVD deutan ΔE 7.4, nam trong dai 6-8). Dai do CHI hop le khi co
 * kenh phan biet thu hai. Khe ho 2px giua cac doan DA BI GO (yeu cau user 2026-10-01 - nhin nhu
 * the roi), nen 3 kenh con lai thanh BAT BUOC: bang so lieu <details> duoi chart, legend chu, va
 * tooltip ghi ten trang thai. DUNG go not cac thu do.
 *
 * Thu tu xep chong cung la kenh an toan: "Khả dụng" (xanh la) va "Đã huỷ" (do) KHONG duoc dung
 * canh nhau - cap xanh la/do truot CVD (ΔE 5.0), nen "Đã rút" (tim) chen giua.
 *
 * **Rieng DONUT co mot van de thu tu xep chong khong co**: vong tron khep kin nen doan DAU va doan
 * CUOI ke nhau - tuc "Chờ xác nhận" (cam) cham "Đã huỷ" (do), ma cap cam/do chi dat ΔE 11.1 o mat
 * THUONG (duoi nguong 15: kho phan biet ngay ca voi nguoi nhin mau binh thuong). Voi 4 mau nay thi
 * KHONG co thu tu xep nao cuu duoc (do buoc phai ke 2 mau, ma hang xom an toan duy nhat cua no la
 * tim). Vi vay donut BAT BUOC co nhan % ve thang len tung doan + so don trong legend - danh tinh
 * doan nam o CHU chu khong o mau. Dung go drawArcLabels/generateLabels trong dashboardScript().
 */
const STATUS_CHART_META: Array<{ status: CommissionStatus; label: string; color: string }> = [
  // CAM - CUNG mau voi duong "Lợi nhuận chủ bot" o chart hoa hong (yeu cau user 2026-10-01).
  { status: "pending", label: "Chờ xác nhận", color: "#eb6834" },
  { status: "confirmed", label: "Khả dụng", color: "#16a34a" },
  { status: "paid", label: "Đã rút", color: "#6a4fd8" },
  { status: "reversed", label: "Đã huỷ", color: "#dc2626" },
];

/** Hoa hong goc vs phan chu bot giu - 2 series categorical, da qua validator (ΔE 24.7 CVD). */
const COMMISSION_COLOR = "#2a78d6";
const OWNER_PROFIT_COLOR = "#eb6834";

/**
 * Luot tao link: xanh la --success cua admin / do.
 *
 * **CANH BAO DA BIET, KHONG PHAI SOT**: cap #16a34a/#dc2626 TRUOT validator CVD cua skill dataviz
 * (deutan ΔE 5.0, duoi ca nguong san 6) - nguoi mu mau do-luc nhin 2 doan cot gan nhu y het.
 * Da de xuat #15803d (ΔE 8.6, dat het) va user CHON quay lai #16a34a de dong bo voi mau --success
 * dung o khap admin (2026-10-01). Day la quyet dinh co y cua chu san pham, dung "sua lai cho dung
 * chuan" neu khong co yeu cau moi.
 *
 * Doi lai, 3 kenh phan biet KHONG-PHAI-MAU duoi day tro thanh BAT BUOC o chart nay:
 *  (1) bang so lieu <details> ngay duoi chart (renderDayTable) - quan trong nhat, doc duoc chinh xac;
 *  (2) legend chu + tooltip ghi ro "Thành công"/"Lỗi";
 *  (3) vi tri co dinh trong cot: "Thành công" luon o duoi, "Lỗi" luon o tren.
 * Go bat ky cai nao trong 3 cai do la bien chart thanh "chi phan biet duoc bang mau".
 */
const SUCCESS_COLOR = "#16a34a";
const FAILED_COLOR = "#dc2626";

const TOP_USER_COLOR = "#2a78d6";

/** Icon cua chip tieu de nhom the KPI - cung bo emoji voi sidebar (xem NAV_ITEMS trong adminHtml.ts). */
const GROUP_ICONS: Record<string, string> = {
  Tiền: "💰",
  "Đơn hàng": "📦",
  "Hoạt động bot": "🤖",
  "Rút tiền & người dùng": "💸",
};

export function renderAdminDashboardPage(stats: DashboardStats): string {
  const chartData = {
    ordersByDay: {
      days: stats.charts.ordersByDay.days.map(toDdMm),
      series: STATUS_CHART_META.map((meta) => ({
        label: meta.label,
        color: meta.color,
        data: stats.charts.ordersByDay.series[meta.status],
      })),
    },
    commissionByDay: {
      days: stats.charts.commissionByDay.days.map(toDdMm),
      commission: stats.charts.commissionByDay.commission,
      ownerProfit: stats.charts.commissionByDay.ownerProfit,
      commissionColor: COMMISSION_COLOR,
      ownerProfitColor: OWNER_PROFIT_COLOR,
    },
    statusBreakdown: stats.charts.statusBreakdown.map((item) => ({
      label: labelOfStatus(item.status),
      value: item.count,
      color: colorOfStatus(item.status),
    })),
    linksByDay: {
      days: stats.charts.linksByDay.days.map(toDdMm),
      success: stats.charts.linksByDay.success,
      failed: stats.charts.linksByDay.failed,
      successColor: SUCCESS_COLOR,
      failedColor: FAILED_COLOR,
    },
    topUsers: {
      // Nhan truc la TEN hien thi; user chua tung nhan tin voi bot thi chua co ho so -> lui ve
      // userId chu khong de trong (cot khong nhan la cot vo nghia).
      labels: stats.charts.topUsers.map((u) => truncateLabel(u.displayName ?? u.userId)),
      // Tooltip giu ten DAY DU + nen tang + userId: ten co the bi cat o truc, va 2 user hoan toan
      // co the trung ten - userId moi la thu phan biet duoc chac chan.
      tooltips: stats.charts.topUsers.map((u) =>
        u.displayName ? `${u.displayName} · ${u.platform} · ${u.userId}` : `${u.userId} (${u.platform})`
      ),
      values: stats.charts.topUsers.map((u) => u.commission),
      color: TOP_USER_COLOR,
    },
  };

  return `
<div class="range-bar">
  <span class="range-label">Kỳ xem:</span>
  ${DASHBOARD_RANGES.map((r) => rangeLink(r.value, r.label, stats.range.range)).join("")}
  <span class="range-hint">${escapeHtml(formatRangeHint(stats))}</span>
</div>

${renderKpiGrid(stats)}

<div class="chart-grid">
  <div class="card chart-card">
    <div class="chart-head">
      <h2>Đơn hàng mới mỗi ngày</h2>
      <p class="chart-sub">Theo <strong>ngày khách đặt đơn</strong> (không phải ngày import báo cáo), nên import trễ hay gộp nhiều ngày cũng không làm méo biểu đồ. Bấm vào tên trạng thái ở chú thích để ẩn/hiện trạng thái đó.</p>
    </div>
    <div class="chart-box chart-box-tall"><canvas id="chart-orders"></canvas></div>
    ${renderDayTable(
      stats.charts.ordersByDay.days,
      STATUS_CHART_META.map((m) => m.label),
      stats.charts.ordersByDay.days.map((_, i) =>
        STATUS_CHART_META.map((m) => stats.charts.ordersByDay.series[m.status][i])
      ),
      "Chưa có đơn nào trong kỳ này."
    )}
  </div>

  <div class="card chart-card">
    <div class="chart-head">
      <h2>Lượt tạo link theo ngày</h2>
      <p class="chart-sub">Đo bot có đang được dùng hay không — độc lập với việc đã import báo cáo hoa hồng hay chưa. Đặt cạnh biểu đồ đơn hàng để đối chiếu: nhiều lượt tạo link mà ít đơn nghĩa là khách bấm link nhưng không chốt mua.</p>
    </div>
    <div class="chart-box chart-box-tall"><canvas id="chart-links"></canvas></div>
    ${renderDayTable(
      stats.charts.linksByDay.days,
      ["Thành công", "Lỗi"],
      stats.charts.linksByDay.days.map((_, i) => [
        stats.charts.linksByDay.success[i],
        stats.charts.linksByDay.failed[i],
      ]),
      "Chưa có lượt tạo link nào trong kỳ này."
    )}
  </div>

</div>

<div class="chart-grid chart-grid-3">
  <div class="card chart-card">
    <div class="chart-head">
      <h2>Hoa hồng theo ngày</h2>
      <p class="chart-sub">Hoa hồng gốc Shopee trả và phần chủ bot thực giữ sau thuế, phí sàn và phần chia cho user.</p>
    </div>
    <div class="chart-box"><canvas id="chart-commission"></canvas></div>
  </div>

  <div class="card chart-card">
    <div class="chart-head">
      <h2>Cơ cấu đơn theo trạng thái</h2>
      <p class="chart-sub">Tỉ trọng đơn trong kỳ. Tỉ lệ "Đã huỷ" tăng bất thường là dấu hiệu cần xem lại.</p>
    </div>
    <div class="chart-box">${
      stats.charts.statusBreakdown.length > 0
        ? `<canvas id="chart-status"></canvas>`
        : `<p class="chart-empty">Chưa có đơn nào trong kỳ này.</p>`
    }</div>
  </div>

  <div class="card chart-card">
    <div class="chart-head">
      <h2>Top ${stats.charts.topUsers.length > 0 ? stats.charts.topUsers.length : 10} user theo hoa hồng</h2>
      <p class="chart-sub">Hoa hồng gốc sinh ra trong kỳ, đã bỏ đơn huỷ. Rê chuột vào cột để xem đầy đủ tên, nền tảng và ID.</p>
    </div>
    <div class="chart-box" style="height: ${topUsersChartHeight(stats.charts.topUsers.length)}px">${
      stats.charts.topUsers.length > 0
        ? `<canvas id="chart-top-users"></canvas>`
        : `<p class="chart-empty">Chưa có user nào phát sinh hoa hồng trong kỳ này.</p>`
    }</div>
  </div>
</div>

<script type="application/json" id="dashboard-data">${embedJson(chartData)}</script>
<script src="${CHART_JS_CDN}"></script>
<script>${dashboardScript()}</script>
`;
}

// ---------------------------------------------------------------------------
// The KPI
// ---------------------------------------------------------------------------

function renderKpiGrid(stats: DashboardStats): string {
  const { money, orders, activity, withdrawals } = stats;
  const periodNote = `trong ${stats.range.label.toLowerCase()}`;

  const cards: Array<{
    group: string;
    label: string;
    value: string;
    hint: string;
    tone?: string;
    /** Chip canh bao hien canh nhan - di kem tone "alert" de mau khong phai kenh duy nhat. */
    badge?: string;
    /** Link hanh dong o chan the - chi dung cho the can admin lam gi do ngay. */
    action?: { href: string; label: string };
  }> = [
    {
      group: "Tiền",
      label: "Hoa hồng gốc",
      value: formatVnd(money.commission),
      hint: `Shopee trả, trước thuế/phí · ${periodNote}`,
    },
    {
      group: "Tiền",
      label: "Lợi nhuận chủ bot",
      value: formatVnd(money.ownerProfit),
      hint: `Sau thuế, phí sàn và phần chia user · ${periodNote}`,
      tone: "accent",
    },
    {
      group: "Tiền",
      label: "Trả cho user",
      value: formatVnd(money.owedToUsers),
      // Con so TOAN THOI GIAN - phai noi ro, neu khong chu bot se doc nham thanh "no trong 7 ngay"
      // va tuong minh du tien tra.
      hint: "Toàn thời gian · tiền đã xác nhận, user chưa rút",
      tone: money.owedToUsers > 0 ? "warning" : undefined,
    },
    {
      group: "Đơn hàng",
      label: "Đơn mới",
      value: formatCount(orders.newCount),
      hint: `Theo ngày khách đặt · ${periodNote}`,
    },
    {
      group: "Đơn hàng",
      label: "Đơn chờ xác nhận",
      value: formatCount(orders.pendingCount),
      hint: `${formatVnd(orders.pendingAmount)} tiền treo, chưa chắc chắn`,
    },
    {
      group: "Đơn hàng",
      label: "Đơn huỷ",
      value: formatCount(orders.reversedCount),
      hint: `Shopee ghi huỷ/không hợp lệ · ${periodNote}`,
      tone: orders.reversedCount > 0 ? "danger" : undefined,
    },
    {
      group: "Hoạt động bot",
      label: "Lượt tạo link",
      value: formatCount(activity.linkCount),
      hint: `${formatCount(activity.successCount)} thành công · ${periodNote}`,
    },
    {
      group: "Hoạt động bot",
      label: "Tỉ lệ lỗi",
      value: `${formatPercent(activity.errorRatePercent)}%`,
      hint: `${formatCount(activity.failedCount)} lượt không tạo được link`,
      tone: activity.errorRatePercent >= 20 ? "danger" : undefined,
    },
    {
      group: "Hoạt động bot",
      label: "User hoạt động",
      value: formatCount(activity.activeUsers),
      hint: `Có gửi link · ${periodNote}`,
    },
    {
      group: "Rút tiền & người dùng",
      label: "Chờ duyệt rút",
      value: formatCount(withdrawals.pendingCount),
      hint:
        withdrawals.pendingCount > 0
          ? `${formatVnd(withdrawals.pendingAmount)} đang chờ chuyển khoản`
          : "Không có yêu cầu nào đang chờ",
      // Day la the DUY NHAT co hanh dong cho admin lam ngay: co nguoi dang doi tien that. Khi > 0
      // thi doi han sang kieu "alert" (nen do nhat, vien day du, so mau do) chu khong chi 1 vach
      // ben trai nhu cac the khac, kem chip canh bao + link di thang toi trang xu ly.
      //
      // Chip "Cần xử lý" kem bieu tuong la BAT BUOC chu khong phai trang tri: mau trang thai khong
      // bao gio duoc phep tu minh mang nghia (nguoi mu mau se khong thay the nay khac the con lai).
      tone: withdrawals.pendingCount > 0 ? "alert" : undefined,
      badge: withdrawals.pendingCount > 0 ? "⚠️ Cần xử lý" : undefined,
      action:
        withdrawals.pendingCount > 0
          ? { href: "/admin/withdrawals", label: "Xử lý ngay →" }
          : undefined,
    },
    {
      group: "Rút tiền & người dùng",
      label: "Đã chi trả",
      value: formatVnd(withdrawals.paidAmount),
      hint: `${formatCount(withdrawals.paidCount)} yêu cầu · ${periodNote}`,
    },
    {
      group: "Rút tiền & người dùng",
      label: "User mới",
      value: formatCount(withdrawals.newUsers),
      hint: `Tổng ${formatCount(withdrawals.totalUsers)} user đã từng có đơn`,
    },
  ];

  // Chip nhom nam TRONG the, goc tren ben PHAI (yeu cau user 2026-10-01). Truoc do no la 1 hang
  // tieu de rieng cho ca nhom - tren man hep (1 cot) moi chip an tron mot hang, tinh ra ton dien
  // tich hon la tiet kiem.
  return `<div class="kpi-grid">${cards
    .map(
      (c) => `<div class="kpi-card${c.tone ? ` kpi-${c.tone}` : ""}">
      <div class="kpi-top">
        <span class="kpi-label">${escapeHtml(c.label)}${
          c.badge ? `<span class="kpi-badge">${escapeHtml(c.badge)}</span>` : ""
        }</span>
        <span class="kpi-chip"><span class="kpi-chip-icon" aria-hidden="true">${
          GROUP_ICONS[c.group] ?? "•"
        }</span>${escapeHtml(c.group)}</span>
      </div>
      <span class="kpi-value">${escapeHtml(c.value)}</span>
      <span class="kpi-hint">${escapeHtml(c.hint)}</span>${
        c.action
          ? `<a class="kpi-action" href="${escapeHtml(c.action.href)}">${escapeHtml(c.action.label)}</a>`
          : ""
      }
    </div>`
    )
    .join("")}</div>`;
}

/**
 * Bang so lieu dat duoi cac chart theo ngay - KENH DOC THU HAI bat buoc, khong phai trang tri:
 *  (1) cap mau "Chờ xác nhận"/"Khả dụng" nam trong dai CVD can kenh phan biet thu hai;
 *  (2) Chart.js tai tu CDN - CDN hong thi day la cho duy nhat con doc duoc so lieu theo ngay.
 * Dung <details> native, dong mac dinh, khong ton JS.
 *
 * Ngay khong co so lieu bi BO khoi bang (khac chart - chart phai giu du ngay de truc thoi gian
 * khong bi bop meo, con bang thi hang toan so 0 chi lam dai them).
 */
function renderDayTable(
  days: string[],
  columns: string[],
  valuesByDay: number[][],
  emptyMessage: string
): string {
  const rows = days
    .map((day, i) => {
      const counts = valuesByDay[i];
      const total = counts.reduce((a, b) => a + b, 0);
      if (total === 0) return "";
      return `<tr><td>${escapeHtml(toDdMm(day))}</td>${counts
        .map((c) => `<td class="num">${c}</td>`)
        .join("")}<td class="num"><strong>${total}</strong></td></tr>`;
    })
    .filter(Boolean)
    .join("");

  return `<details class="chart-table">
  <summary>Xem số liệu dạng bảng</summary>
  <table>
    <thead><tr><th>Ngày</th>${columns
      .map((c) => `<th class="num">${escapeHtml(c)}</th>`)
      .join("")}<th class="num">Tổng</th></tr></thead>
    <tbody>${
      rows ||
      `<tr><td colspan="${columns.length + 2}" class="empty">${escapeHtml(emptyMessage)}</td></tr>`
    }</tbody>
  </table>
</details>`;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function rangeLink(value: DashboardRange, label: string, active: DashboardRange): string {
  const cls = value === active ? "range-link active" : "range-link";
  const current = value === active ? ' aria-current="page"' : "";
  return `<a class="${cls}" href="/admin/dashboard?range=${value}"${current}>${escapeHtml(label)}</a>`;
}

function formatRangeHint(stats: DashboardStats): string {
  const { fromKey, toKey } = stats.range;
  return fromKey === toKey ? toDdMmYyyy(fromKey) : `${toDdMmYyyy(fromKey)} – ${toDdMmYyyy(toKey)}`;
}

/** "2026-10-01" -> "01/10". Cat chuoi chu KHONG qua new Date() - tranh lech ngay vi mui gio. */
function toDdMm(dayKey: string): string {
  const [, month, day] = dayKey.split("-");
  return `${day}/${month}`;
}

function toDdMmYyyy(dayKey: string): string {
  const [year, month, day] = dayKey.split("-");
  return `${day}/${month}/${year}`;
}

/**
 * Shopee tra hoa hong LE toi phan nghin dong (vd 22.990,5d mot san pham), nen tong cua nhieu don
 * ra so kieu 146.457,765d - dung tren the KPI thi trong nhu loi he thong. Lam tron o BUOC HIEN THI
 * (du lieu trong DB giu nguyen so le that, khong ai duoc sua so tien de cho dep).
 */
/**
 * Cat nhan truc Y cua chart top user. Ten dai keo vung ve hep lai con vai chuc pixel - ten day du
 * van con trong tooltip nen khong mat thong tin.
 */
/**
 * Chieu cao chart top user co theo SO user thay vi co dinh: the nay chiem ca hang ngang, de chieu
 * cao chet thi 3-5 nguoi se nam thua thot giua mot khung rong hoac 10 nguoi se bi nen chen nhau.
 */
function topUsersChartHeight(userCount: number): number {
  if (userCount === 0) return 160;
  return Math.max(150, userCount * 34 + 60);
}

function truncateLabel(text: string, max = 22): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("vi-VN").format(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(value);
}

function labelOfStatus(status: CommissionStatus): string {
  return STATUS_CHART_META.find((m) => m.status === status)?.label ?? status;
}

function colorOfStatus(status: CommissionStatus): string {
  return STATUS_CHART_META.find((m) => m.status === status)?.color ?? "#7c8194";
}

/**
 * Nhung du lieu vao <script type="application/json"> roi JSON.parse o client - KHONG noi chuoi du
 * lieu thang vao ma JS. userId/ten san pham la chuoi do NGUOI LA nhap, noi thang vao JS la lo XSS.
 * Van phai chan "</script" (ke ca viet hoa) vi trinh duyet dong the script ngay tai do bat ke dang
 * o trong chuoi JSON hay khong; "<" -> \\u003c vua du va van la JSON hop le.
 */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * Script client. Viet thanh chuoi (khong phai file rieng) de giu dung cach phuc vu HTML hien tai
 * cua src/api - khong co buoc build asset, khong co route phuc vu file tinh.
 */
function dashboardScript(): string {
  return `
(function () {
  var raw = document.getElementById("dashboard-data");
  if (!raw || typeof Chart === "undefined") {
    // CDN hong hoac bi chan: khong lam gi them. Moi con so quan trong da nam tren the KPI va bang
    // so lieu duoi chart chinh (HTML thuan), nen trang van dung duoc.
    document.querySelectorAll(".chart-box").forEach(function (box) {
      box.innerHTML = '<p class="chart-empty">Không tải được thư viện biểu đồ. Số liệu vẫn xem được ở các thẻ phía trên và ở bảng dưới biểu đồ chính.</p>';
    });
    return;
  }
  var data = JSON.parse(raw.textContent);

  var INK = "#262b3d";
  var MUTED = "#7c8194";
  var GRID = "#e6e8f0";

  Chart.defaults.font.family = '-apple-system, "Inter", system-ui, sans-serif';
  Chart.defaults.color = MUTED;
  Chart.defaults.maintainAspectRatio = false;

  // Lam tron: hoa hong Shopee co phan le toi phan nghin dong, de nguyen thi tooltip hien
  // "146.457,765đ" trong nhu loi. Chi lam tron luc HIEN THI.
  function vnd(value) {
    return new Intl.NumberFormat("vi-VN").format(Math.round(value)) + "đ";
  }
  // Nhan truc tien: rut gon "tr"/"k" de truc khong bi chu dai keo hep mat vung ve.
  function shortVnd(value) {
    if (Math.abs(value) >= 1000000) return (value / 1000000).toFixed(value % 1000000 === 0 ? 0 : 1).replace(".", ",") + " tr";
    if (Math.abs(value) >= 1000) return Math.round(value / 1000) + "k";
    return String(Math.round(value));
  }

  // Luoi mo nhat, khong khung vien - duong luoi khong duoc canh tranh thi giac voi cot du lieu.
  function axes(opts) {
    opts = opts || {};
    return {
      x: {
        stacked: !!opts.stacked,
        grid: { display: false },
        border: { color: GRID },
        ticks: { maxRotation: 0, autoSkipPadding: 12 }
      },
      y: {
        stacked: !!opts.stacked,
        beginAtZero: true,
        grid: { color: GRID, drawTicks: false },
        border: { display: false },
        ticks: { precision: opts.money ? undefined : 0, callback: opts.money ? function (v) { return shortVnd(v); } : undefined }
      }
    };
  }

  function legend(show) {
    return {
      display: show,
      position: "bottom",
      align: "start",
      labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "rectRounded", padding: 16, color: INK }
    };
  }

  var tooltipStyle = {
    backgroundColor: "#1f2333",
    padding: 10,
    cornerRadius: 8,
    titleFont: { weight: "600" },
    bodySpacing: 6,
    displayColors: true,
    boxWidth: 10,
    boxHeight: 10,
    usePointStyle: true
  };

  // --- Don moi moi ngay (chart chinh): cot xep chong theo trang thai ---------
  var ordersEl = document.getElementById("chart-orders");
  if (ordersEl) {
    new Chart(ordersEl, {
      type: "bar",
      data: {
        labels: data.ordersByDay.days,
        datasets: data.ordersByDay.series.map(function (s) {
          return {
            label: s.label,
            data: s.data,
            backgroundColor: s.color,
            // KHONG co khe ho giua cac doan xep chong (yeu cau user 2026-10-01: doan tren bi tach
            // ra trong nhu mot the noi roi chu khong phai mot phan cua cot).
            borderWidth: 0,
            // borderSkipped "bottom" = chi bo tron 2 goc TREN cua moi doan. Doan nam duoi bi doan
            // ke tren phu kin phan goc da bo nen khong de lai khuyet - ket qua la chi dinh cot
            // (doan tren cung) trong ra bo tron, than cot lien mach.
            borderRadius: 4,
            borderSkipped: "bottom",
            maxBarThickness: 36
          };
        })
      },
      options: {
        scales: axes({ stacked: true }),
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: legend(true),
          tooltip: Object.assign({}, tooltipStyle, {
            callbacks: {
              label: function (ctx) { return ctx.dataset.label + ": " + ctx.parsed.y + " đơn"; },
              footer: function (items) {
                var total = items.reduce(function (sum, i) { return sum + i.parsed.y; }, 0);
                return "Tổng: " + total + " đơn";
              }
            }
          })
        }
      }
    });
  }

  // --- Hoa hong theo ngay: 2 duong, CUNG don vi nen dung chung 1 truc --------
  var commissionEl = document.getElementById("chart-commission");
  if (commissionEl) {
    new Chart(commissionEl, {
      type: "line",
      data: {
        labels: data.commissionByDay.days,
        datasets: [
          {
            label: "Hoa hồng gốc",
            data: data.commissionByDay.commission,
            borderColor: data.commissionByDay.commissionColor,
            backgroundColor: data.commissionByDay.commissionColor,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 5,
            tension: 0.25
          },
          {
            label: "Lợi nhuận chủ bot",
            data: data.commissionByDay.ownerProfit,
            borderColor: data.commissionByDay.ownerProfitColor,
            backgroundColor: data.commissionByDay.ownerProfitColor,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 5,
            tension: 0.25
          }
        ]
      },
      options: {
        scales: axes({ money: true }),
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: legend(true),
          tooltip: Object.assign({}, tooltipStyle, {
            callbacks: { label: function (ctx) { return ctx.dataset.label + ": " + vnd(ctx.parsed.y); } }
          })
        }
      }
    });
  }

  // --- Co cau don theo trang thai -------------------------------------------
  var statusEl = document.getElementById("chart-status");
  if (statusEl) {
    var totalStatus = data.statusBreakdown.reduce(function (sum, s) { return sum + s.value; }, 0);

    // Ve thang ti le % len tung doan. BAT BUOC, khong phai trang tri: vong tron khep kin nen doan
    // dau ("Chờ xác nhận", cam) cham doan cuoi ("Đã huỷ", do), ma cap cam/do chi dat ΔE 11.1 o mat
    // thuong (duoi nguong 15 cua skill dataviz). Co chu tren doan thi danh tinh khong con phu
    // thuoc vao viec phan biet 2 sac do canh nhau.
    var arcLabels = {
      id: "arcLabels",
      afterDatasetsDraw: function (chart) {
        var ctx = chart.ctx;
        var meta = chart.getDatasetMeta(0);
        ctx.save();
        ctx.font = "600 12px -apple-system, Inter, system-ui, sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        meta.data.forEach(function (arc, i) {
          var value = chart.data.datasets[0].data[i];
          var pct = totalStatus === 0 ? 0 : Math.round((value / totalStatus) * 100);
          // Doan qua nho thi chu khong lot - bo qua, tooltip va legend van cho biet so that.
          if (pct < 8) return;
          var pos = arc.tooltipPosition();
          ctx.fillText(pct + "%", pos.x, pos.y);
        });
        ctx.restore();
      }
    };

    new Chart(statusEl, {
      type: "doughnut",
      plugins: [arcLabels],
      data: {
        labels: data.statusBreakdown.map(function (s) { return s.label; }),
        datasets: [{
          data: data.statusBreakdown.map(function (s) { return s.value; }),
          backgroundColor: data.statusBreakdown.map(function (s) { return s.color; }),
          borderColor: "#ffffff",
          borderWidth: 2
        }]
      },
      options: {
        cutout: "62%",
        plugins: {
          legend: Object.assign({}, legend(true), {
            labels: Object.assign({}, legend(true).labels, {
              // Legend kem SO DON - kenh chu thu hai, doc duoc ca khi doan qua nho de ve chu len.
              generateLabels: function (chart) {
                return chart.data.labels.map(function (label, i) {
                  var value = chart.data.datasets[0].data[i];
                  return {
                    text: label + " (" + value + ")",
                    fillStyle: chart.data.datasets[0].backgroundColor[i],
                    strokeStyle: chart.data.datasets[0].backgroundColor[i],
                    pointStyle: "rectRounded",
                    index: i
                  };
                });
              }
            })
          }),
          tooltip: Object.assign({}, tooltipStyle, {
            callbacks: {
              label: function (ctx) {
                var pct = totalStatus === 0 ? 0 : Math.round((ctx.parsed / totalStatus) * 100);
                return ctx.label + ": " + ctx.parsed + " đơn (" + pct + "%)";
              }
            }
          })
        }
      }
    });
  }

  // --- Luot tao link theo ngay ----------------------------------------------
  var linksEl = document.getElementById("chart-links");
  if (linksEl) {
    new Chart(linksEl, {
      type: "bar",
      data: {
        labels: data.linksByDay.days,
        datasets: [
          {
            label: "Thành công",
            data: data.linksByDay.success,
            backgroundColor: data.linksByDay.successColor,
            borderWidth: 0,
            borderRadius: 4,
            borderSkipped: "bottom",
            maxBarThickness: 36
          },
          {
            label: "Lỗi",
            data: data.linksByDay.failed,
            backgroundColor: data.linksByDay.failedColor,
            borderWidth: 0,
            borderRadius: 4,
            borderSkipped: "bottom",
            maxBarThickness: 36
          }
        ]
      },
      options: {
        scales: axes({ stacked: true }),
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: legend(true),
          tooltip: Object.assign({}, tooltipStyle, {
            callbacks: { label: function (ctx) { return ctx.dataset.label + ": " + ctx.parsed.y + " lượt"; } }
          })
        }
      }
    });
  }

  // --- Top user: 1 series -> 1 mau duy nhat, KHONG to mau theo thu hang ------
  var topEl = document.getElementById("chart-top-users");
  if (topEl) {
    new Chart(topEl, {
      type: "bar",
      data: {
        labels: data.topUsers.labels,
        datasets: [{
          label: "Hoa hồng gốc",
          data: data.topUsers.values,
          backgroundColor: data.topUsers.color,
          borderRadius: 4,
          borderSkipped: false,
          maxBarThickness: 18
        }]
      },
      options: {
        indexAxis: "y",
        scales: {
          x: { beginAtZero: true, grid: { color: GRID, drawTicks: false }, border: { display: false }, ticks: { callback: function (v) { return shortVnd(v); } } },
          y: { grid: { display: false }, border: { color: GRID }, ticks: { color: INK, autoSkip: false } }
        },
        plugins: {
          // 1 series duy nhat -> tieu de card da goi ten no, legend chi la nhieu.
          legend: legend(false),
          tooltip: Object.assign({}, tooltipStyle, {
            callbacks: {
              // Nhan o truc co the da bi cat, va 2 user co the trung ten - tieu de tooltip dung
              // chuoi day du kem nen tang + userId.
              title: function (items) { return data.topUsers.tooltips[items[0].dataIndex]; },
              label: function (ctx) { return vnd(ctx.parsed.x); }
            }
          })
        }
      }
    });
  }
})();
`;
}

/** CSS rieng cua trang dashboard - ghep vao shellStyles() cua adminHtml.ts. */
export function dashboardStyles(): string {
  return `
  .range-bar { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
  .range-label { font-size: 0.85rem; color: var(--text-muted); }
  .range-link {
    padding: 0.35rem 0.85rem; border-radius: 999px; font-size: 0.85rem; text-decoration: none;
    color: var(--text-muted); background: var(--card-bg); border: 1px solid var(--card-border);
  }
  .range-link:hover { color: var(--text); }
  .range-link.active { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  .range-hint { font-size: 0.8rem; color: var(--text-muted); margin-left: auto; }

  /* DUNG 3 cot (khong phai auto-fit): 12 the chia tron 4 hang, va moi hang la DUNG 1 nhom
     (Tiền / Đơn hàng / Hoạt động bot / Rút tiền & người dùng) nen mat quet ngang la ra ca nhom.
     auto-fit tung cho ra 5+5+2, vua lam hang cuoi lot thom vua cat nhom ngang giua hang. */
  .kpi-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.85rem; margin-bottom: 1.25rem; }
  /* Chip nhom nam trong the, goc tren PHAI. Hang tren cua the la 1 flex: nhan the ben trai (co
     the xuong dong), chip ben phai va KHONG duoc co lai (flex-shrink 0 + nowrap) - chip bi vo
     thanh 2 dong se day chieu cao cac the trong cung hang lech nhau.
     Co y dung MAU TRUNG TINH cho ca 4 chip (chi khac icon): day la "chrome" giao dien, to mau
     theo nhom se lan voi mau DU LIEU trong chart (cam = "Chờ xác nhận"/"Lợi nhuận chủ bot",
     xanh la = "Khả dụng"...), luc do mau khong con noi len dung mot thu gi nua. */
  .kpi-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
  .kpi-chip {
    flex-shrink: 0; white-space: nowrap;
    display: inline-flex; align-items: center; gap: 0.3rem;
    padding: 0.18rem 0.5rem 0.18rem 0.38rem; border-radius: 999px;
    background: #eceef5; border: 1px solid var(--card-border);
    font-size: 0.68rem; font-weight: 600; color: #6b7189; letter-spacing: 0.01em;
  }
  .kpi-chip-icon { font-size: 0.78rem; line-height: 1; }

  .kpi-card {
    background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 14px;
    padding: 0.9rem 1rem; display: flex; flex-direction: column; gap: 0.15rem;
    border-left: 3px solid var(--card-border);
    box-shadow: 0 1px 2px rgba(31, 35, 51, 0.04);
    /* Chi doi mau vien/do nang/do do - KHONG transition tren "all": layout cua the (chieu cao,
       khoang cach) khong duoc phep chay muot, no se giat khi noi dung doi. */
    transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
  }
  .kpi-card:hover {
    border-color: var(--accent); box-shadow: 0 6px 18px rgba(106, 79, 216, 0.14);
    transform: translateY(-2px);
  }
  /* The canh bao giu danh tinh DO cua no khi hover - khong duoc chuyen sang tim nhu the thuong,
     nguoi dung dang tim cho co viec phai lam. */
  .kpi-card.kpi-alert:hover {
    border-color: var(--danger); box-shadow: 0 6px 18px rgba(220, 38, 38, 0.22);
  }
  .kpi-card.kpi-accent { border-left-color: var(--accent); }
  .kpi-card.kpi-warning { border-left-color: var(--warning); }
  .kpi-card.kpi-danger { border-left-color: var(--danger); }
  /* Kieu "alert": khac han cac the con lai (nen do nhat + vien day du + so mau do) - danh cho the
     co viec phai lam ngay, hien chi co "Chờ duyệt rút" khi dang co nguoi doi tien. */
  .kpi-card.kpi-alert {
    background: var(--danger-soft); border-color: var(--danger); border-left-color: var(--danger);
    box-shadow: 0 1px 3px rgba(220, 38, 38, 0.18);
  }
  .kpi-card.kpi-alert .kpi-value { color: var(--danger); }
  .kpi-card.kpi-alert .kpi-chip { background: #fbdcdc; border-color: #f3bcbc; color: #8f2020; }
  .kpi-card.kpi-alert .kpi-label, .kpi-card.kpi-alert .kpi-hint { color: #8f2020; }
  .kpi-label { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; min-width: 0; }
  .kpi-badge {
    font-size: 0.68rem; font-weight: 600; color: #fff; background: var(--danger);
    padding: 0.1rem 0.45rem; border-radius: 999px; white-space: nowrap;
  }
  .kpi-action {
    margin-top: 0.45rem; font-size: 0.78rem; font-weight: 600; color: var(--danger);
    text-decoration: none; align-self: flex-start;
  }
  .kpi-action:hover { text-decoration: underline; }
  .kpi-label { font-size: 0.85rem; color: var(--text-muted); }

  /* Con so la thong tin chinh cua the -> dung muc ink dam nhat, khong to mau theo series. */
  .kpi-value { font-size: 1.45rem; font-weight: 700; color: var(--text); line-height: 1.25; margin: 0.1rem 0; }
  .kpi-hint { font-size: 0.75rem; color: var(--text-muted); line-height: 1.35; }

  /* DUNG 2 cot co dinh (khong auto-fit): 2 chart theo ngay o hang dau phai chia doi 50-50 de doi
     chieu truc ngay voi nhau. auto-fit co the nhay sang 3 cot tren man rong, luc do 2 chart do
     khong con cung ben nhau nua. */
  .chart-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; align-items: start; margin-bottom: 1rem; }
  /* Hang thu hai: 3 chart phu nam chung 1 hang cho do ton chieu cao (yeu cau user 2026-10-01). */
  .chart-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .chart-card-full { grid-column: 1 / -1; }
  /* min-width:0 bat buoc: grid item mac dinh min-width:auto nen canvas khong co lai duoc khi
     man hinh hep, keo ca track rong ra va lam trang tran ngang (cung bay da gap o handbookHtml.ts). */
  .chart-grid > *, .kpi-grid > * { min-width: 0; }
  .chart-card {
    padding: 1.1rem 1.25rem 1.25rem; border-radius: 14px;
    box-shadow: 0 1px 2px rgba(31, 35, 51, 0.04);
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  /* Chart card KHONG nhac len (translateY) nhu the KPI: canvas ben trong ve lai theo pixel, nhich
     ca khoi khi re chuot lam chu truc nhoe trong luc chuyen. Chi doi vien + do do. */
  .chart-card:hover { border-color: #cfd3e4; box-shadow: 0 6px 18px rgba(31, 35, 51, 0.08); }

  .chart-head h2 { font-size: 0.98rem; margin: 0 0 0.3rem; }
  .chart-sub { font-size: 0.78rem; color: var(--text-muted); margin: 0 0 0.9rem; line-height: 1.45; }
  .chart-box { position: relative; height: 260px; }
  .chart-box-tall { height: 330px; }
  .chart-empty { font-size: 0.85rem; color: var(--text-muted); text-align: center; padding: 2.5rem 1rem; margin: 0; }

  .chart-table { margin-top: 0.9rem; border-top: 1px solid var(--card-border); padding-top: 0.6rem; }
  .chart-table summary { cursor: pointer; font-size: 0.8rem; color: var(--text-muted); }
  .chart-table summary:hover { color: var(--text); }
  .chart-table table { margin-top: 0.6rem; }
  .chart-table td.num, .chart-table th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .chart-table td.empty { text-align: center; color: var(--text-muted); }

  @media (max-width: 860px) {
    /* 1 cot thay vi 2: 12 the chia 2 cot se cat doi cac nhom 3 the, mat luon loi cua bo cuc tren. */
    .kpi-grid { grid-template-columns: 1fr; }
  }

  /* 3 cot chi du cho tu ~1400px tro len; duoi nguong do cho ve 2 cot roi 1 cot. */
  @media (max-width: 1400px) {
    .chart-grid-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    /* Con 2 cot thi chart thu 3 (top user) dung mot minh o hang duoi -> cho no chiem ca hang. */
    .chart-grid-3 > *:last-child { grid-column: 1 / -1; }
  }

  @media (max-width: 1100px) {
    /* Duoi nguong nay 2 cot chart chi con ~400px moi ben, cot ngay chen nhau - cho xuong 1 cot. */
    .chart-grid, .chart-grid-3 { grid-template-columns: 1fr; }
  }

  @media (max-width: 760px) {
    .range-hint { margin-left: 0; width: 100%; }
    .chart-box { height: 230px; }
    .chart-box-tall { height: 280px; }
  }
`;
}
