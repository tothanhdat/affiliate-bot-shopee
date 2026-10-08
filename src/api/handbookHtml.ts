import { computeCommissionBreakdown } from "../core/commissionMath.js";
import { formatVnd } from "./htmlHelpers.js";

/**
 * Trang "So tay hoan tien" (/so-tay) - ban tu host thay cho file Google Docs cu (2026-09-28).
 * Ly do doi: moi lan doi % hoa hong hay nguong rut tien phai vao Google Docs sua tay, rat de quen
 * -> tai lieu noi 1 dang, bot tra 1 dang. O day MOI con so deu di ra tu tham so truyen vao (doc
 * live tu settings/env trong server.ts), nen doi % o /admin/settings la trang tu doi theo.
 *
 * Viet HTML tay, khong templating lib - giong dashboardHtml.ts/adminHtml.ts. Theme toi/tim dung
 * chung bo bien voi dashboardHtml.ts vi day la 2 trang CUNG mot doi tuong xem (user cuoi), khac
 * theme sang cua /admin/*.
 *
 * JS phia client toi thieu: gap/mo dung <details> native (khong JS), chi 1 doan script nho cho o
 * tim kiem - theo dung pattern cua o search trong /admin/users (xem renderUsersPage).
 */

/** So tien hoa hong goc dung trong vi du minh hoa - giu nguyen con so cua ban So tay Google Docs cu. */
export const HANDBOOK_EXAMPLE_COMMISSION_VND = 7584;

export interface HandbookPageData {
  userSharePercent: number;
  taxPercent: number;
  platformFeePercent: number;
  withdrawalThresholdVnd: number;
  /**
   * Nguong giam don to (2026-10-08, xem payoutHold.ts). 0 = tinh nang dang TAT -> an ca muc, noi ra
   * mot luat khong ap dung la gay lo vo ich.
   */
  payoutHoldThresholdVnd: number;
  payoutHoldDays: number;
}

interface HandbookItem {
  id: string;
  title: string;
  /** HTML cua phan than - mo ra khi bam vao tieu de. */
  body: string;
}

interface HandbookSection {
  id: string;
  ordinal: string;
  title: string;
  /** Cac muc gap/mo duoc ben trong. Phan I khong dung (cac buoc luon hien san). */
  items: HandbookItem[];
  /** HTML hien truc tiep duoi tieu de section, truoc cac item. */
  lead?: string;
}

/**
 * Bo dau tieng Viet + ha chu thuong, de go "hoa hong" cung tim ra "hoà hồng". Dung o CA server
 * (sinh data-search) lan client (so khop tu khoa go vao) - 2 ben phai cung 1 quy tac, neu lech thi
 * co tu khoa go dung ma khong ra ket qua nao.
 */
function searchKey(text: string): string {
  return text
    .toLowerCase()
    // Bo dau ngoac kep TRUOC moi thu khac: noi dung goc co nhieu doan trich ("Chia sẻ", "Khả dụng",
    // "xemhh"), ma data-search lai duoc boc bang dau " - de nguyen thi dau " dau tien dong luon
    // attribute, nua sau cua muc bien mat khoi o tim kiem va HTML vo. Khong ai go dau " de tim nen
    // bo han la dung, khong can escape thanh &quot;.
    .replace(/["'\u201c\u201d\u2018\u2019]/g, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

/** Bo the HTML de lay phan chu thuan lam du lieu cho o tim kiem. */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

function searchAttr(...parts: string[]): string {
  return `data-search="${searchKey(stripTags(parts.join(" ")))}"`;
}

/** 1 dong "nhan - y nghia", thay cho the <table> cua ban Google Docs (bang khong doc noi tren dien thoai). */
function kvRow(label: string, value: string, tone = ""): string {
  const toneClass = tone ? ` ${tone}` : "";
  return `<div class="kv-row"><div class="kv-label${toneClass}">${label}</div><div class="kv-value">${value}</div></div>`;
}

function buildSections(data: HandbookPageData): HandbookSection[] {
  const botSharePercent = 100 - data.userSharePercent;
  const example = computeCommissionBreakdown({
    commissionAmount: HANDBOOK_EXAMPLE_COMMISSION_VND,
    taxPercent: data.taxPercent,
    platformFeePercent: data.platformFeePercent,
    userSharePercent: data.userSharePercent,
  });
  const threshold = formatVnd(data.withdrawalThresholdVnd);

  const calcFlow = `
    <div class="calc-flow">
      <div class="calc-step">
        <div class="calc-label">Hoa hồng gốc từ sàn</div>
        <div class="calc-amount">${formatVnd(HANDBOOK_EXAMPLE_COMMISSION_VND)}</div>
      </div>
      <div class="calc-arrow" aria-hidden="true">↓ <span>trừ ${data.taxPercent}% thuế</span></div>
      <div class="calc-step">
        <div class="calc-label">Sau thuế</div>
        <div class="calc-amount">${formatVnd(example.afterTaxOnly)}</div>
      </div>
      <div class="calc-arrow" aria-hidden="true">↓ <span>trừ ${data.platformFeePercent}% phí sàn</span></div>
      <div class="calc-step">
        <div class="calc-label">Sau phí sàn</div>
        <div class="calc-amount">${formatVnd(example.afterTaxAmount)}</div>
      </div>
      <div class="calc-arrow" aria-hidden="true">↓ <span>bạn nhận ${data.userSharePercent}%</span></div>
      <div class="calc-step calc-final">
        <div class="calc-label">Bạn nhận được</div>
        <div class="calc-amount">${formatVnd(example.userShareAmount)}</div>
      </div>
    </div>`;

  // Muc nay CHI hien khi tinh nang giam dang bat. Moi so doc LIVE tu settings (co test chan viec
  // hardcode lai: render voi so khac roi assert khong con vet cua so cu).
  const holdItems: HandbookItem[] =
    data.payoutHoldThresholdVnd > 0
      ? [
          {
            id: "giam-don-to",
            title: "Đơn giá trị lớn được giữ thêm vài ngày",
            body: `
            <ul>
              <li>Đơn có tiền hoàn của bạn từ <strong>${formatVnd(
                data.payoutHoldThresholdVnd
              )}</strong> trở lên sẽ được giữ thêm <strong>${
                data.payoutHoldDays
              } ngày</strong> kể từ ngày bạn nhận hàng, rồi mới chuyển sang "Khả dụng".</li>
              <li>Lí do: Shopee cho phép trả hàng trong 15 ngày kể từ khi giao thành công. Nếu đơn bị trả lại sau khi tiền đã chuyển đi thì khoản đó phải thu lại — giữ thêm vài ngày giúp phát hiện sớm và không ai phải nợ ai.</li>
              <li>Đơn nhỏ hơn mức trên vẫn chuyển sang "Khả dụng" ngay như bình thường.</li>
              <li>Dashboard hiện dòng "Đang tạm giữ" kèm ngày mở khoá của từng đơn, và mỗi đơn như vậy cũng mang nhãn "Đang tạm giữ" thay vì "Khả dụng".</li>
            </ul>`,
          },
        ]
      : [];

  return [
    {
      id: "cach-dung",
      ordinal: "I",
      title: "Các bước sử dụng",
      lead: `
        <ol class="steps">
          <li class="step-card" ${searchAttr("Bước 1 Sao chép link sản phẩm Shopee chia sẻ")}>
            <div class="step-num">1</div>
            <div class="step-body">
              <h3>Sao chép link sản phẩm</h3>
              <p>Mở app Shopee, tìm sản phẩm bạn muốn mua, bấm "Chia sẻ" và sao chép link sản phẩm.</p>
            </div>
          </li>
          <li class="step-card" ${searchAttr("Bước 2 Dán link vào group Zalo Telegram nhiều link cùng lúc 5 link")}>
            <div class="step-num">2</div>
            <div class="step-body">
              <h3>Dán link vào group</h3>
              <p>Dán link vừa sao chép vào group Zalo/Telegram (không cần gõ thêm lệnh gì). Bạn có thể dán nhiều link cùng lúc trong 1 tin nhắn (tối đa 5 link/tin nhắn), bot sẽ tách ra và trả lời riêng cho từng link.</p>
            </div>
          </li>
          <li class="step-card" ${searchAttr("Bước 3 Bấm link đến sàn thanh toán đặt hàng ngay trong phiên video livestream")}>
            <div class="step-num">3</div>
            <div class="step-body">
              <h3>Bấm link, đến sàn &amp; thanh toán</h3>
              <p>Bot sẽ trả lại cho bạn 1 link đã gắn mã hoàn tiền. Bạn <strong>bấm đúng link đó</strong> để mở sản phẩm trên sàn, rồi <strong>đặt hàng ngay trong phiên đó</strong> — đây là điều kiện bắt buộc để đơn được ghi nhận hoa hồng.</p>
              <div class="callout callout-warning">
                <div class="callout-title">⚠️ Lưu ý quan trọng</div>
                <p>Sau khi bấm link của bot, không mở thêm video/livestream nào của sản phẩm đó trước khi đặt hàng. Nếu bạn lỡ xem 1 video/live có gắn mã của người khác trước khi mua, hệ thống của sàn sẽ tính hoa hồng theo lượt bấm gần nhất đó thay vì link của bot — đơn hàng của bạn vẫn lên bình thường, chỉ là hoa hồng không về đúng chỗ.</p>
              </div>
            </div>
          </li>
          <li class="step-card" ${searchAttr(
            "Bước 4 Theo dõi nhận tiền hoàn xemhh dashboard số dư khả dụng rút tiền Shopee mỗi ngày"
          )}>
            <div class="step-num">4</div>
            <div class="step-body">
              <h3>Theo dõi &amp; nhận tiền hoàn</h3>
              <p>Nhắn <strong>"xemhh"</strong> (không phân biệt hoa/thường) trong tin nhắn riêng (DM) cho bot — không phải trong group — để lấy link dashboard cá nhân. Link này cố định, lưu lại dùng dần không cần nhắn lại nhiều lần.</p>
              <p>Trên dashboard bạn xem được: số dư khả dụng, số đang chờ xác nhận, số đang chờ rút, số đã nhận, và danh sách chi tiết từng đơn hàng.</p>
              <p>Khi có đơn được xác nhận <strong>Hoàn thành</strong>, bot sẽ tự động nhắn tin riêng báo cho bạn — bạn không cần chủ động hỏi. Khi số dư "Khả dụng" đạt từ ${threshold} trở lên, bạn có thể bấm yêu cầu rút toàn bộ ngay trên dashboard.</p>
              <p class="muted-note"><strong>Tần suất cập nhật trạng thái đơn:</strong> Shopee cập nhật <strong>mỗi ngày</strong>, nên đơn mới đặt thường cần vài ngày mới đổi trạng thái.</p>
            </div>
          </li>
        </ol>`,
      items: [],
    },
    {
      id: "huong-dan-chung",
      ordinal: "II",
      title: "Hướng dẫn chung",
      items: [
        {
          id: "san-ho-tro",
          title: "Sàn được hỗ trợ",
          body: `<p>Shopee.</p>`,
        },
        {
          id: "dinh-dang-link",
          title: "Định dạng link nhận được",
          body: `
            <ul>
              <li><strong>Shopee:</strong> link đầy đủ hoặc link rút gọn (vn.shp.ee, s.shopee.vn...)</li>
              <li>Lưu ý bot chỉ nhận đúng link sản phẩm, không nhận link video (sv.shopee.vn)</li>
            </ul>`,
        },
        {
          id: "tan-suat-cap-nhat",
          title: "Tần suất cập nhật trạng thái đơn",
          body: `
            <div class="kv-list">
              ${kvRow("Shopee", "Mỗi ngày")}
            </div>
            <p>Đơn mới đặt vẫn cần vài ngày mới hiện và đổi trạng thái — không cần sốt ruột kiểm tra dashboard liên tục.</p>`,
        },
        {
          id: "trang-thai-don",
          title: "Trạng thái đơn hàng trên dashboard",
          body: `
            <div class="kv-list">
              ${kvRow(
                "Chờ xác nhận",
                "Đơn đang chờ sàn duyệt — có thể bị huỷ nếu không đạt yêu cầu đối soát",
                "tone-warning"
              )}
              ${kvRow(
                "Khả dụng",
                "Đã xác nhận chính thức, có thể yêu cầu rút, không còn thay đổi hay bị thu hồi nữa",
                "tone-success"
              )}
              ${kvRow("Đang chờ rút", "Nằm trong 1 yêu cầu rút đang chờ admin xử lý", "tone-accent")}
              ${kvRow("Đã rút", "Admin đã chuyển khoản xong, có kèm ảnh bằng chứng chuyển khoản", "tone-success")}
              ${kvRow("Đã huỷ", "Đơn bị huỷ (khách trả hàng/huỷ đơn), có kèm lý do huỷ", "tone-danger")}
            </div>`,
        },
      ],
    },
    {
      id: "quy-dinh",
      ordinal: "III",
      title: "Các quy định cần biết",
      items: [
        {
          id: "ti-le-hoa-hong",
          title: "Tỉ lệ hoa hồng và cách tính",
          body: `
            <p>Mỗi đơn hàng được tính theo công thức: hoa hồng gốc từ sàn → trừ ${data.taxPercent}% thuế → trừ ${data.platformFeePercent}% phí sàn (tính trên phần đã trừ thuế) → phần còn lại bạn nhận <strong>${data.userSharePercent}%</strong>, chủ bot giữ ${botSharePercent}% để duy trì vận hành.</p>
            <p class="example-label">Ví dụ</p>
            ${calcFlow}
            <p class="muted-note">Tỉ lệ này chốt tại thời điểm đơn được ghi nhận vào hệ thống — nếu sau này tỉ lệ % thay đổi, các đơn đã ghi nhận trước đó không bị ảnh hưởng ngược, kể cả đơn còn đang chờ sàn xác nhận.</p>`,
        },
        {
          id: "dieu-kien",
          title: "Điều kiện bắt buộc để được tính hoa hồng",
          body: `
            <ul class="check-list">
              <li>Phải bấm đúng link bot trả về và đặt hàng ngay trong phiên đó.</li>
              <li>Không mở thêm video/livestream của sản phẩm đó trước khi đặt hàng.</li>
              <li>Không tự mua qua link của chính mình để "rút tiền mặt" hoa hồng — hầu hết chính sách affiliate (kể cả Shopee) cấm hoặc không tính hoa hồng cho hành vi tự mua hàng của chính mình.</li>
            </ul>`,
        },
        {
          id: "rut-tien",
          title: "Rút tiền",
          body: `
            <ul>
              <li>Khi số dư "Khả dụng" đạt từ <strong>${threshold}</strong> trở lên, bạn có thể yêu cầu rút.</li>
              <li>Không hỗ trợ rút một phần — mỗi lần yêu cầu là rút toàn bộ số dư khả dụng hiện có.</li>
              <li>Cần điền đủ 3 thông tin: ngân hàng/ví điện tử, số tài khoản/số điện thoại, tên chủ tài khoản.</li>
              <li>Admin sẽ tự nhắn tin riêng xác nhận lại thông tin với bạn trước khi chuyển khoản thật.</li>
              <li>Trong lúc đang có 1 yêu cầu rút chờ xử lý, bạn không thể gửi thêm yêu cầu rút khác.</li>
            </ul>`,
        },
        ...holdItems,
        {
          id: "tra-hang",
          title: "Nếu bạn trả hàng sau khi đã nhận tiền",
          body: `
            <ul>
              <li>Khi bạn trả hàng, Shopee thu lại hoa hồng của đơn đó — kể cả khi tiền đã được chuyển cho bạn rồi.</li>
              <li>Khoản đó được ghi thành <strong>nợ hoàn trả</strong>, tách riêng khỏi số dư "Khả dụng" của bạn. Bạn <strong>không phải chuyển tiền lại</strong> cho bot.</li>
              <li>Nợ chỉ được trừ <strong>khi bạn gửi yêu cầu rút tiền lần sau</strong>: rút nhiều hơn số nợ thì Admin trừ nợ rồi chuyển phần còn lại; rút ít hơn hoặc bằng số nợ thì toàn bộ số rút dùng để trừ nợ, lần đó không có tiền chuyển khoản.</li>
              <li>Dashboard hiện rõ bạn đang nợ bao nhiêu và vì đơn nào.</li>
            </ul>`,
        },
        {
          id: "rui-ro",
          title: "Lưu ý / rủi ro cần biết",
          body: `
            <div class="callout callout-warning">
              <p>Link bot trả lời trong group là công khai — ai trong group cũng bấm được. Nếu người khác bấm và mua qua link đó, hoa hồng vẫn tính về người đã gửi link ban đầu — cẩn thận khi share lại link cho người ngoài group.</p>
            </div>`,
        },
      ],
    },
  ];
}

function renderItem(item: HandbookItem): string {
  return `<details class="faq" id="${item.id}" ${searchAttr(item.title, item.body)}>
  <summary><span class="faq-title">${item.title}</span><span class="faq-chevron" aria-hidden="true"></span></summary>
  <div class="faq-body">${item.body}</div>
</details>`;
}

function renderSection(section: HandbookSection): string {
  const itemsHtml = section.items.map(renderItem).join("\n");
  const aggregate = searchAttr(section.title, section.lead ?? "", ...section.items.map((i) => i.title + " " + i.body));
  return `<section class="section" id="${section.id}" ${aggregate}>
  <h2 class="section-title"><span class="section-ordinal">${section.ordinal}</span>${section.title}</h2>
  ${section.lead ?? ""}
  ${itemsHtml}
</section>`;
}

function renderToc(sections: HandbookSection[]): string {
  const links = sections
    .map((section) => {
      const aggregate = searchAttr(
        section.title,
        section.lead ?? "",
        ...section.items.map((i) => i.title + " " + i.body)
      );
      // data-search nam tren <li> chu KHONG tren <a>: an the <a> van de lai <li> rong, ma tren
      // mobile muc luc la hang flex co gap nen o rong do van chiem cho.
      const subs = section.items
        .map(
          (item) =>
            `<li ${searchAttr(item.title, item.body)}><a class="toc-link toc-sub" href="#${item.id}">${item.title}</a></li>`
        )
        .join("");
      return `<li ${aggregate}>
        <a class="toc-link toc-main" href="#${section.id}"><span class="toc-ordinal">${section.ordinal}</span>${section.title}</a>
        ${subs ? `<ul class="toc-sublist">${subs}</ul>` : ""}
      </li>`;
    })
    .join("");
  return `<nav class="toc" aria-label="Mục lục">
  <div class="toc-heading">Mục lục</div>
  <ul class="toc-list">${links}</ul>
</nav>`;
}

/**
 * Script loc tim kiem - moi phan tu co data-search tu quyet dinh an/hien theo chinh chuoi cua no.
 * Khong can duyet cay DOM vi chuoi data-search cua 1 section da BAO TRUM chuoi cua moi muc con
 * (xem renderSection): muc con khop thi section chac chan cung khop, nen khong the co canh section
 * bi an ma muc con van hien.
 */
const SEARCH_SCRIPT = `
(function () {
  var input = document.getElementById('handbook-search');
  var noMatch = document.getElementById('handbook-no-match');
  var items = document.querySelectorAll('[data-search]');
  function key(text) {
    return String(text).toLowerCase().replace(/["'\\u201c\\u201d\\u2018\\u2019]/g, ' ').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/đ/g, 'd').replace(/\\s+/g, ' ').trim();
  }
  function refresh() {
    var term = key(input.value);
    var visible = 0;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var match = term === '' || key(item.dataset.search).indexOf(term) !== -1;
      item.hidden = !match;
      if (match) visible++;
      // Dang tim kiem thi mo san cac muc khop de thay ngay noi dung, khong phai bam them 1 lan.
      if (item.tagName === 'DETAILS') item.open = term !== '' && match;
    }
    if (noMatch) noMatch.hidden = !(term !== '' && visible === 0);
  }
  input.addEventListener('input', refresh);
})();
`;

export function renderHandbookPage(data: HandbookPageData): string {
  const sections = buildSections(data);
  const threshold = formatVnd(data.withdrawalThresholdVnd);

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sổ tay hoàn tiền</title>
<meta name="description" content="Hướng dẫn dùng bot săn sale hoàn tiền: cách gửi link, theo dõi hoa hồng và rút tiền.">
<style>
  :root {
    --bg: oklch(0.16 0.02 280);
    --card-bg: oklch(0.21 0.025 280 / 0.65);
    --card-border: oklch(1 0 0 / 0.07);
    --card-shadow: 0 6px 20px oklch(0 0 0 / 0.2);
    --text: oklch(0.92 0.01 280);
    --text-soft: oklch(0.8 0.01 280);
    --text-muted: oklch(0.7 0.01 280);
    --text-dim: oklch(0.6 0.01 280);
    --accent: oklch(0.75 0.13 300);
    --accent-soft: oklch(1 0 0 / 0.08);
    --success: oklch(0.8 0.14 150);
    --warning: oklch(0.8 0.14 70);
    --danger: oklch(0.8 0.14 25);
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    font-family: -apple-system, "Inter", system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    position: relative;
    min-height: 100vh;
    overflow-x: hidden;
    line-height: 1.6;
  }
  /* Nen glow + luoi cham dung chung cong thuc voi dashboard ca nhan (dashboardHtml.ts) - 2 trang
     nay cung 1 nguoi xem nen phai trong nhu mot bo. */
  .bg-glow { position: absolute; border-radius: 50%; pointer-events: none; }
  .bg-glow-1 {
    top: -200px; left: -150px; width: 600px; height: 600px;
    background: radial-gradient(circle, oklch(0.58 0.17 300 / 0.5), transparent 70%);
    filter: blur(40px);
  }
  .bg-glow-2 {
    top: 25%; right: -220px; width: 650px; height: 650px;
    background: radial-gradient(circle, oklch(0.68 0.17 70 / 0.34), transparent 70%);
    filter: blur(50px);
  }
  .bg-glow-3 {
    bottom: -250px; left: 15%; width: 700px; height: 700px;
    background: radial-gradient(circle, oklch(0.52 0.16 260 / 0.42), transparent 70%);
    filter: blur(50px);
  }
  .bg-dots {
    position: absolute; inset: 0; pointer-events: none;
    background-image: radial-gradient(oklch(1 0 0 / 0.035) 1px, transparent 1px);
    background-size: 26px 26px;
  }
  .page-content {
    position: relative;
    z-index: 1;
    max-width: 1060px;
    margin: 0 auto;
    padding: 2.5rem 1.25rem 4rem;
  }
  header.hero { margin-bottom: 1.75rem; }
  h1 { font-size: 2rem; font-weight: 700; margin: 0; color: #fff; letter-spacing: -0.01em; }
  .subtitle { color: var(--text-muted); font-size: 0.9375rem; margin: 0.5rem 0 0; max-width: 62ch; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 1.5rem; }
  .chip {
    background: var(--card-bg);
    -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
    border: 1px solid var(--card-border); box-shadow: var(--card-shadow);
    border-radius: 14px; padding: 0.75rem 1.125rem; min-width: 150px;
  }
  .chip-label {
    font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.06em;
    font-weight: 600; color: var(--text-dim); margin-bottom: 0.3rem;
  }
  .chip-value { font-size: 1.375rem; font-weight: 700; color: var(--accent); }
  .chip.chip-plain .chip-value { color: var(--text); font-size: 1.0625rem; }

  .search-wrap { margin: 0 0 1.75rem; }
  #handbook-search {
    width: 100%;
    background: oklch(0.21 0.02 280 / 0.6); color: var(--text);
    border: 1px solid var(--card-border); border-radius: 12px;
    padding: 0.8125rem 1rem; font-size: 0.9375rem; font-family: inherit;
  }
  #handbook-search::placeholder { color: var(--text-dim); }
  #handbook-search:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .no-match {
    background: oklch(0.24 0.04 70 / 0.18); color: oklch(0.85 0.05 70);
    border: 1px solid oklch(0.6 0.1 70 / 0.3); border-radius: 12px;
    padding: 0.875rem 1.125rem; font-size: 0.875rem; margin-bottom: 1.5rem;
  }

  .layout { display: grid; grid-template-columns: 240px 1fr; gap: 2.25rem; align-items: start; }
  /* Grid item mac dinh co min-width:auto = khong hep hon noi dung duoc. Muc luc tren mobile la 1
     hang ngang khong xuong dong nen se keo track grid rong ra theo, main rong theo luon, roi
     margin:0 auto cua .page-content can giua khoi qua kho khien mep TRAI lot ra ngoai man hinh.
     Day la bay kinh dien cua grid/flex - do that bang Chrome headless o 440px: nav.toc rong 546px. */
  .layout > * { min-width: 0; }

  .toc {
    position: sticky; top: 1.5rem;
    background: var(--card-bg);
    -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
    border: 1px solid var(--card-border); box-shadow: var(--card-shadow);
    border-radius: 16px; padding: 1.125rem 1rem;
  }
  .toc-heading {
    font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.06em;
    font-weight: 700; color: var(--text-dim); margin-bottom: 0.75rem;
  }
  .toc-list, .toc-sublist { list-style: none; margin: 0; padding: 0; }
  .toc-list > li + li { margin-top: 0.5rem; }
  .toc-link { display: block; text-decoration: none; color: var(--text-soft); border-radius: 8px; }
  .toc-main { font-weight: 650; font-size: 0.875rem; padding: 0.3rem 0.4rem; color: var(--text); }
  .toc-ordinal { color: var(--accent); font-weight: 700; margin-right: 0.45rem; }
  .toc-sublist { margin: 0.2rem 0 0 0.9rem; border-left: 1px solid var(--card-border); padding-left: 0.6rem; }
  .toc-sub { font-size: 0.8125rem; padding: 0.26rem 0.35rem; color: var(--text-muted); }
  .toc-link:hover { background: var(--accent-soft); color: #fff; }

  .section { margin-bottom: 2.5rem; scroll-margin-top: 1.5rem; }
  .section-title {
    font-size: 1.3125rem; font-weight: 700; color: #fff;
    margin: 0 0 1.125rem; display: flex; align-items: baseline; gap: 0.6rem;
  }
  .section-ordinal {
    color: var(--accent); font-size: 0.8125rem; font-weight: 700;
    background: var(--accent-soft); border-radius: 7px; padding: 0.2rem 0.55rem; letter-spacing: 0.05em;
  }

  .steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1rem; }
  .step-card {
    display: flex; gap: 1rem;
    background: var(--card-bg);
    -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
    border: 1px solid var(--card-border); box-shadow: var(--card-shadow);
    border-radius: 16px; padding: 1.25rem 1.375rem;
  }
  .step-num {
    flex: 0 0 auto; width: 32px; height: 32px; border-radius: 50%;
    background: var(--accent); color: #fff; font-weight: 700; font-size: 0.9375rem;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 14px oklch(0.75 0.13 300 / 0.35);
  }
  .step-body { min-width: 0; }
  .step-body h3 { margin: 0.25rem 0 0.5rem; font-size: 1.0625rem; color: #fff; font-weight: 650; }
  .step-body p { margin: 0 0 0.75rem; color: var(--text-soft); font-size: 0.9375rem; }
  .step-body p:last-child { margin-bottom: 0; }

  details.faq {
    background: var(--card-bg);
    -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
    border: 1px solid var(--card-border); box-shadow: var(--card-shadow);
    border-radius: 14px; margin-bottom: 0.75rem; scroll-margin-top: 1.5rem;
  }
  details.faq summary {
    list-style: none; cursor: pointer; padding: 0.9375rem 1.25rem;
    display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  }
  details.faq summary::-webkit-details-marker { display: none; }
  .faq-title { font-weight: 650; font-size: 0.96875rem; color: var(--text); }
  details.faq[open] .faq-title { color: #fff; }
  .faq-chevron {
    flex: 0 0 auto; width: 9px; height: 9px; border-right: 2px solid var(--text-dim);
    border-bottom: 2px solid var(--text-dim); transform: rotate(45deg) translateY(-2px);
    transition: transform 0.18s ease;
  }
  details.faq[open] .faq-chevron { transform: rotate(-135deg) translateY(-2px); border-color: var(--accent); }
  details.faq summary:hover .faq-chevron { border-color: var(--accent); }
  .faq-body { padding: 0 1.25rem 1.125rem; color: var(--text-soft); font-size: 0.9375rem; }
  .faq-body > :first-child { margin-top: 0; }
  .faq-body > :last-child { margin-bottom: 0; }
  .faq-body ul { margin: 0 0 0.75rem; padding-left: 1.15rem; }
  .faq-body li { margin-bottom: 0.4rem; }
  .check-list { list-style: none; padding-left: 0; }
  .check-list li { position: relative; padding-left: 1.5rem; }
  .check-list li::before { content: "✓"; position: absolute; left: 0; color: var(--success); font-weight: 700; }

  .kv-list { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.875rem; }
  .kv-row {
    display: grid; grid-template-columns: 148px 1fr; gap: 0.875rem; align-items: baseline;
    background: oklch(1 0 0 / 0.03); border-radius: 10px; padding: 0.625rem 0.875rem;
  }
  .kv-label { font-weight: 650; font-size: 0.875rem; color: var(--text); }
  .kv-label.tone-success { color: var(--success); }
  .kv-label.tone-warning { color: var(--warning); }
  .kv-label.tone-danger { color: var(--danger); }
  .kv-label.tone-accent { color: var(--accent); }
  .kv-value { font-size: 0.875rem; color: var(--text-muted); }

  .callout { border-radius: 12px; padding: 0.875rem 1.125rem; margin: 0.875rem 0; font-size: 0.875rem; }
  .callout p { margin: 0; }
  .callout-warning {
    background: oklch(0.24 0.04 70 / 0.18); color: oklch(0.85 0.05 70);
    border: 1px solid oklch(0.6 0.1 70 / 0.3);
  }
  .callout-title { font-weight: 700; margin-bottom: 0.35rem; }

  .example-label {
    font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.06em;
    font-weight: 700; color: var(--text-dim); margin: 1.125rem 0 0.625rem;
  }
  .calc-flow { display: flex; flex-direction: column; align-items: stretch; gap: 0.3rem; }
  .calc-step {
    display: flex; justify-content: space-between; align-items: baseline; gap: 1rem;
    background: oklch(1 0 0 / 0.04); border: 1px solid var(--card-border);
    border-radius: 11px; padding: 0.6875rem 1rem;
  }
  .calc-label { font-size: 0.8125rem; color: var(--text-muted); }
  .calc-amount { font-size: 1.0625rem; font-weight: 700; color: var(--text); white-space: nowrap; }
  .calc-final { background: oklch(0.4 0.11 150 / 0.22); border-color: oklch(0.6 0.12 150 / 0.35); }
  .calc-final .calc-label { color: oklch(0.86 0.06 150); }
  .calc-final .calc-amount { color: var(--success); font-size: 1.25rem; }
  .calc-arrow {
    font-size: 0.75rem; color: var(--text-dim); text-align: center; padding: 0.1rem 0;
    display: flex; align-items: center; justify-content: center; gap: 0.4rem;
  }
  .calc-arrow span { letter-spacing: 0.01em; }

  .muted-note { color: var(--text-dim); font-size: 0.8125rem; }
  footer.page-footer {
    margin-top: 2.5rem; padding-top: 1.5rem; border-top: 1px solid var(--card-border);
    color: var(--text-dim); font-size: 0.8125rem; font-style: italic;
  }
  [hidden] { display: none !important; }

  /* ---- Man hinh hep ----------------------------------------------------------------
     Day moi la man hinh CHINH cua trang nay: phan lon nguoi doc So tay la user Zalo bam
     link tu tin nhan tren dien thoai, desktop chi la phu. */
  @media (max-width: 860px) {
    .layout { grid-template-columns: 1fr; gap: 1.25rem; }
    /* Muc luc doc 12 dong se chiem gan het man hinh dau tien, user phai cuon mai moi thay chu
       dau tien cua So tay - tren mobile doi thanh 1 hang cuon ngang, chi giu cac muc chinh. */
    .toc { position: static; padding: 0.5rem 0.625rem; }
    .toc-heading { display: none; }
    .toc-list {
      display: flex; gap: 0.5rem; overflow-x: auto;
      -webkit-overflow-scrolling: touch; scrollbar-width: none;
    }
    .toc-list::-webkit-scrollbar { display: none; }
    .toc-list > li { flex: 0 0 auto; }
    .toc-list > li + li { margin-top: 0; }
    .toc-sublist { display: none; }
    .toc-main { white-space: nowrap; background: var(--accent-soft); padding: 0.4rem 0.75rem; }
    /* Safari iOS tu phong to ca trang khi focus vao input co font-size < 16px va KHONG tu thu lai
       - user bi ket o trang thai trang tran ra ngoai mep phai. 16px la nguong chan viec do. */
    #handbook-search { font-size: 1rem; }
  }

  @media (max-width: 560px) {
    .page-content { padding: 1.75rem 1rem 3rem; }
    h1 { font-size: 1.625rem; }
    .section-title { font-size: 1.1875rem; }
    .chips { display: grid; grid-template-columns: 1fr 1fr; gap: 0.625rem; }
    .chip { min-width: 0; padding: 0.625rem 0.875rem; }
    /* The thu 3 (ten san) co the dai hon 2 the so, cho chiem tron 1 hang de khong xuong dong xau. */
    .chip:last-child { grid-column: 1 / -1; }
    .chip-value { font-size: 1.25rem; }
    .chip.chip-plain .chip-value { font-size: 1rem; }
    .step-card { padding: 1.125rem 1rem; gap: 0.75rem; }
    .step-body h3 { font-size: 1rem; }
    details.faq summary { padding: 0.875rem 1rem; }
    .faq-body { padding: 0 1rem 1rem; }
    .kv-row { grid-template-columns: 1fr; gap: 0.2rem; }
    /* Nhan + so tien tren 1 hang se bi bop khi nhan dai ("Hoa hồng gốc từ sàn"); cho xuong dong. */
    .calc-step { flex-wrap: wrap; gap: 0.25rem 1rem; }
    .calc-amount { font-size: 1rem; }
    .calc-final .calc-amount { font-size: 1.125rem; }
  }
</style>
</head>
<body>
<div class="bg-glow bg-glow-1"></div>
<div class="bg-glow bg-glow-2"></div>
<div class="bg-glow bg-glow-3"></div>
<div class="bg-dots"></div>
<div class="page-content">
  <header class="hero">
    <h1>Sổ tay hoàn tiền</h1>
    <p class="subtitle">Hướng dẫn dành cho bạn khi dùng bot săn sale hoàn tiền (cashback) trong group Zalo/Telegram khi mua hàng qua Shopee.</p>
    <div class="chips">
      <div class="chip">
        <div class="chip-label">Bạn nhận</div>
        <div class="chip-value">${data.userSharePercent}%</div>
      </div>
      <div class="chip">
        <div class="chip-label">Rút từ</div>
        <div class="chip-value">${threshold}</div>
      </div>
      <div class="chip chip-plain">
        <div class="chip-label">Sàn hỗ trợ</div>
        <div class="chip-value">Shopee</div>
      </div>
    </div>
  </header>

  <div class="search-wrap">
    <input id="handbook-search" type="search" autocomplete="off" placeholder="Tìm nhanh trong sổ tay… (vd: rút tiền, xemhh, trạng thái)" aria-label="Tìm trong sổ tay">
  </div>
  <div class="no-match" id="handbook-no-match" hidden>Không tìm thấy mục nào khớp với từ khoá của bạn. Thử từ ngắn hơn, hoặc tag admin trong group nhé.</div>

  <div class="layout">
    ${renderToc(sections)}
    <main>
      ${sections.map(renderSection).join("\n")}
      <footer class="page-footer">
        Tỉ lệ %, ngưỡng rút tiền, và danh sách sàn hỗ trợ có thể thay đổi theo thời gian. Có gì thắc mắc, tag admin trong group nhé.
      </footer>
    </main>
  </div>
</div>
<script>${SEARCH_SCRIPT}</script>
</body>
</html>`;
}
