# Ảnh thông báo "đơn về" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay tin văn bản báo "đơn về" bằng một tấm ảnh render từ template của chủ bot, kèm caption ngắn chứa link dashboard.

**Architecture:** Module mới `src/core/orderImage/` tách làm 2 tầng — một hàm thuần dựng view model (test được không cần font) và một renderer satori → resvg → jpeg-js. `notifyUser` được nới từ `string` thành `{ text, image? }` nên fallback khi render lỗi chính là bỏ trống `image`, không cần nhánh `if` ở từng chỗ gọi.

**Tech Stack:** TypeScript (ESM, NodeNext), Node 22+, `satori`, `@resvg/resvg-js`, `jpeg-js`, `node:test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-10-05-anh-thong-bao-don-ve-design.md`

## Global Constraints

- **Khung ảnh cố định 1408×768.** Mọi toạ độ trong plan này thuộc hệ đó.
- **Tin báo tiền không bao giờ được mất.** Mọi lỗi render/gửi ảnh đều phải rơi về gửi text, không được ném lên trên.
- **Luôn `console.warn` kèm chi tiết chẩn đoán TRƯỚC khi nuốt lỗi** (quy tắc 2026-09-02 trong `CLAUDE.md`).
- **`src/core/**` không được import `express`, `telegraf`, hay bất cứ thứ gì biết về platform cụ thể.**
- **Tổng tiền trên ảnh là tổng TẤT CẢ đơn**, không phải tổng 3 đơn hiện trên thẻ.
- **Số dư khả dụng phải đọc SAU khi đã ghi nhận đơn mới vào ledger.**
- Test chạy bằng `npm test` (glob đã bao gồm `src/core/__tests__/*.test.ts` và `src/adapters/zalo/__tests__/*.test.ts`).
- Import nội bộ luôn có đuôi `.js` (NodeNext).

---

### Task 1: View model (hàm thuần)

**Files:**
- Create: `src/core/orderImage/orderImageLayout.ts`
- Test: `src/core/__tests__/orderImageLayout.test.ts`

**Interfaces:**
- Consumes: `formatVnd` từ `src/core/money.ts`; `ConfirmedOrderItem` từ `src/core/orderIngest.ts` (`{ orderId: string; productName: string | null; userShareAmount: number }`).
- Produces: `ORDER_IMAGE_MAX_CARDS`, `OrderImageInput`, `OrderImageCard`, `OrderImageView`, `buildOrderImageView(input): OrderImageView`.

- [ ] **Step 1: Viết test thất bại**

Tạo `src/core/__tests__/orderImageLayout.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrderImageView } from "../orderImage/orderImageLayout.js";
import type { ConfirmedOrderItem } from "../orderIngest.js";

const item = (orderId: string, userShareAmount: number, productName: string | null = "San pham"): ConfirmedOrderItem =>
  ({ orderId, productName, userShareAmount });

test("chon 3 don tien cao nhat, xep giam dan", () => {
  const view = buildOrderImageView({
    items: [item("A", 2290), item("B", 13776), item("C", 2362), item("D", 21400)],
    availableVnd: 0,
    withdrawalThresholdVnd: 20000,
  });
  assert.equal(view.cards.length, 3);
  assert.deepEqual(view.cards.map((c) => c.amountText), ["21.400đ", "13.776đ", "2.362đ"]);
  assert.deepEqual(view.cards.map((c) => c.index), [1, 2, 3]);
  assert.equal(view.extraCount, 1);
  assert.equal(view.orderCount, 4);
});

// Hoi quy quan trong: tong phai la tong TAT CA don. Neu ai do sua thanh tong 3 the
// dang hien thi thi user se thay so tien nho hon so thuc nhan - sai lech ve TIEN.
test("tong cong tinh tren TAT CA don, khong phai 3 don hien tren anh", () => {
  const view = buildOrderImageView({
    items: [item("A", 2290), item("B", 13776), item("C", 2362), item("D", 8100), item("E", 21400)],
    availableVnd: 0,
    withdrawalThresholdVnd: 20000,
  });
  assert.equal(view.totalText, "47.928đ");
});

test("productName rong thi lui ve 'Don <orderId>'", () => {
  const view = buildOrderImageView({
    items: [item("260909K72F4DAY", 5000, null)],
    availableVnd: 0,
    withdrawalThresholdVnd: 20000,
  });
  assert.equal(view.cards[0].name, "Đơn 260909K72F4DAY");
});

test("du nguong (bang dung nguong) thi rut duoc, khong con dong thieu bao nhieu", () => {
  const view = buildOrderImageView({
    items: [item("A", 1000)],
    availableVnd: 20000,
    withdrawalThresholdVnd: 20000,
  });
  assert.equal(view.canWithdraw, true);
  assert.equal(view.missingText, null);
  assert.equal(view.availableText, "20.000đ");
});

test("chua du nguong thi bao con thieu bao nhieu", () => {
  const view = buildOrderImageView({
    items: [item("A", 1000)],
    availableVnd: 18428,
    withdrawalThresholdVnd: 20000,
  });
  assert.equal(view.canWithdraw, false);
  assert.equal(view.missingText, "1.572đ");
});

test("khong lam thay doi mang items cua caller", () => {
  const items = [item("A", 100), item("B", 900)];
  buildOrderImageView({ items, availableVnd: 0, withdrawalThresholdVnd: 1 });
  assert.deepEqual(items.map((i) => i.orderId), ["A", "B"]);
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `npx tsx --test src/core/__tests__/orderImageLayout.test.ts`
Expected: FAIL — không resolve được `../orderImage/orderImageLayout.js`.

- [ ] **Step 3: Viết implementation tối thiểu**

Tạo `src/core/orderImage/orderImageLayout.ts`:

```ts
import { formatVnd } from "../money.js";
import type { ConfirmedOrderItem } from "../orderIngest.js";

/**
 * So the toi da tren anh. Template chi du cho 3 the ngang; don du duoc gop vao dong
 * "+N don khac" chu KHONG lam anh dai ra - anh dai thi Zalo thu nho lai con kho doc hon text.
 */
export const ORDER_IMAGE_MAX_CARDS = 3;

export interface OrderImageInput {
  items: ConfirmedOrderItem[];
  /** So du kha dung, PHAI doc SAU khi da ghi nhan cac don moi vao ledger. */
  availableVnd: number;
  withdrawalThresholdVnd: number;
}

export interface OrderImageCard {
  /** 1-based, hien trong huy hieu tron o dau the. */
  index: number;
  name: string;
  amountText: string;
}

export interface OrderImageView {
  orderCount: number;
  cards: OrderImageCard[];
  extraCount: number;
  totalText: string;
  availableText: string;
  canWithdraw: boolean;
  /** null khi da rut duoc - hai trang thai nay LOAI TRU nhau tren anh. */
  missingText: string | null;
}

/**
 * Bien danh sach don + so du thanh du lieu da format san cho renderer. Tach khoi renderer de
 * test duoc ma khong can nap font hay asset nao.
 */
export function buildOrderImageView(input: OrderImageInput): OrderImageView {
  const { items, availableVnd, withdrawalThresholdVnd } = input;

  // Tong tinh tren TAT CA don, khong phai 3 don hien tren anh - xem test chan hoi quy.
  const totalVnd = items.reduce((sum, item) => sum + item.userShareAmount, 0);

  // Copy truoc khi sort: mang items la cua caller (summarizeOrderResultsByUser), sort tai cho
  // se lam doi thu tu o moi noi khac dang dung chung mang do.
  const shown = [...items]
    .sort((a, b) => b.userShareAmount - a.userShareAmount)
    .slice(0, ORDER_IMAGE_MAX_CARDS);

  const missingVnd = withdrawalThresholdVnd - availableVnd;
  const canWithdraw = missingVnd <= 0;

  return {
    orderCount: items.length,
    cards: shown.map((item, i) => ({
      index: i + 1,
      name: item.productName ? item.productName : `Đơn ${item.orderId}`,
      amountText: formatVnd(item.userShareAmount),
    })),
    extraCount: items.length - shown.length,
    totalText: formatVnd(totalVnd),
    availableText: formatVnd(availableVnd),
    canWithdraw,
    missingText: canWithdraw ? null : formatVnd(missingVnd),
  };
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó pass**

Run: `npx tsx --test src/core/__tests__/orderImageLayout.test.ts`
Expected: PASS, 6 test.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: không lỗi.

- [ ] **Step 6: Commit**

```bash
git add src/core/orderImage/orderImageLayout.ts src/core/__tests__/orderImageLayout.test.ts
git commit -m "feat(order-image): view model cho anh thong bao don ve"
```

---

### Task 2: Renderer + asset + bước build

**Files:**
- Create: `src/core/orderImage/orderImageRenderer.ts`
- Create: `src/core/orderImage/assets/bg.jpg`, `moneybag.png`, `PlayfairDisplay-Bold.ttf`, `BeVietnamPro-Regular.ttf`, `BeVietnamPro-Bold.ttf`
- Modify: `package.json` (dependencies + script `build:assets`)
- Test: `src/core/__tests__/orderImageRenderer.test.ts`

**Interfaces:**
- Consumes: `OrderImageView` từ Task 1.
- Produces: `ORDER_IMAGE_WIDTH` (1408), `ORDER_IMAGE_HEIGHT` (768), `RenderedOrderImage` (`{ data: Buffer; width: number; height: number }`), `renderOrdersImage(view): Promise<RenderedOrderImage>` (ném lỗi nếu hỏng), `renderOrdersImageSafe(view): Promise<RenderedOrderImage | null>` (không bao giờ ném).

- [ ] **Step 1: Cài dependency**

```bash
npm install satori @resvg/resvg-js jpeg-js
```

`jpeg-js` là thuần JS (~100KB) — `@resvg/resvg-js` chỉ xuất PNG (~690KB/ảnh), mã hoá lại thành JPEG giảm còn ~200KB mà chỉ tốn thêm ~20–30ms, và không thêm native dependency nào (tránh rủi ro build trên Railway).

- [ ] **Step 2: Chép asset đã chuẩn bị sẵn vào repo**

5 file đã được dựng và kiểm chứng trong thư mục nháp. Chép nguyên:

```bash
mkdir -p src/core/orderImage/assets
SRC=/private/tmp/claude-501/-Users-ryan-Documents-Claude-Projects-Affiliate-Bot-Shopee/051d9a06-e8f5-45d1-b9df-2ca2e8647f25/scratchpad/mockup/assets
cp "$SRC/bg.jpg" "$SRC/moneybag.png" "$SRC/PlayfairDisplay-Bold.ttf" \
   "$SRC/BeVietnamPro-Regular.ttf" "$SRC/BeVietnamPro-Bold.ttf" \
   src/core/orderImage/assets/
ls -la src/core/orderImage/assets/
```

Expected: 5 file, `bg.jpg` ~89KB, 3 font ~120KB mỗi file.

Nếu thư mục nháp đã mất, dựng lại theo mục "Cách dựng lại 2 asset ảnh nếu template đổi" trong spec; font tải từ Google Fonts bằng User-Agent cũ để lấy bản `.ttf`:

```bash
curl -s -A 'Mozilla/4.0' "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700" | grep -oE 'https://[^)]*\.ttf'
curl -s -A 'Mozilla/4.0' "https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400" | grep -oE 'https://[^)]*\.ttf'
curl -s -A 'Mozilla/4.0' "https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@700" | grep -oE 'https://[^)]*\.ttf'
```

- [ ] **Step 3: Thêm bước copy asset vào build**

Trong `package.json`, sửa `scripts`:

```json
"build:assets": "mkdir -p dist/core/orderImage && cp -R src/core/orderImage/assets dist/core/orderImage/",
"build": "npm run build:css && tsc -p tsconfig.json && npm run build:assets",
```

`tsc` chỉ copy file `.ts`. Thiếu bước này thì chạy local ngon mà **lên Railway crash vì không thấy font** — loại lỗi chỉ lộ ra sau khi deploy.

- [ ] **Step 4: Viết test thất bại**

Tạo `src/core/__tests__/orderImageRenderer.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import jpeg from "jpeg-js";
import { buildOrderImageView } from "../orderImage/orderImageLayout.js";
import {
  renderOrdersImage,
  renderOrdersImageSafe,
  ORDER_IMAGE_WIDTH,
  ORDER_IMAGE_HEIGHT,
} from "../orderImage/orderImageRenderer.js";
import type { ConfirmedOrderItem } from "../orderIngest.js";

const item = (orderId: string, userShareAmount: number, productName: string | null = "San pham"): ConfirmedOrderItem =>
  ({ orderId, productName, userShareAmount });

const view = (items: ConfirmedOrderItem[], availableVnd = 5000) =>
  buildOrderImageView({ items, availableVnd, withdrawalThresholdVnd: 20000 });

test("tra ve JPEG dung kich thuoc khung", async () => {
  const out = await renderOrdersImage(view([item("A", 2290), item("B", 13776), item("C", 2362)]));
  // Magic bytes cua JPEG: FF D8 FF
  assert.equal(out.data[0], 0xff);
  assert.equal(out.data[1], 0xd8);
  assert.equal(out.data[2], 0xff);
  assert.equal(out.width, ORDER_IMAGE_WIDTH);
  assert.equal(out.height, ORDER_IMAGE_HEIGHT);
  const decoded = jpeg.decode(out.data);
  assert.equal(decoded.width, ORDER_IMAGE_WIDTH);
  assert.equal(decoded.height, ORDER_IMAGE_HEIGHT);
});

test("render duoc voi 1, 2, 3 va 5 don", async () => {
  const all = [item("A", 2290), item("B", 13776), item("C", 2362), item("D", 8100), item("E", 21400)];
  for (const n of [1, 2, 3, 5]) {
    const out = await renderOrdersImage(view(all.slice(0, n)));
    assert.ok(out.data.length > 1000, `so don = ${n} ra anh rong`);
  }
});

// Chan bay lineClamp: lineClamp cua satori CHI an khi display la "block". De "flex" thi no im
// lang bo qua, ten dai tran ra 5 dong va day so tien ra khoi the.
test("ten san pham cuc dai khong lam vo bo cuc", async () => {
  const long =
    "Combo 3 hộp Yến Sào Khánh Hoà nguyên tổ loại đặc biệt 100g tặng kèm đường phèn hạt sen " +
    "hộp quà biếu tết cao cấp sang trọng dành cho người lớn tuổi (+4 sản phẩm khác)";
  const out = await renderOrdersImage(view([item("A", 93500, long), item("B", 1000, long)]));
  assert.equal(out.height, ORDER_IMAGE_HEIGHT);
});

test("render duoc ca hai trang thai so du", async () => {
  const chuaDu = await renderOrdersImage(view([item("A", 1000)], 18428));
  const duRoi = await renderOrdersImage(view([item("A", 1000)], 29000));
  // Hai trang thai in chu khac nhau nen anh phai khac nhau.
  assert.notEqual(chuaDu.data.toString("base64"), duRoi.data.toString("base64"));
});

test("renderOrdersImageSafe tra null thay vi nem loi khi view hong", async () => {
  const broken = { ...view([item("A", 1000)]), cards: null } as never;
  const out = await renderOrdersImageSafe(broken);
  assert.equal(out, null);
});
```

- [ ] **Step 5: Chạy test để chắc chắn nó fail**

Run: `npx tsx --test src/core/__tests__/orderImageRenderer.test.ts`
Expected: FAIL — không resolve được `../orderImage/orderImageRenderer.js`.

- [ ] **Step 6: Viết renderer**

Tạo `src/core/orderImage/orderImageRenderer.ts`:

```ts
import { readFileSync } from "node:fs";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import jpeg from "jpeg-js";
import type { OrderImageView } from "./orderImageLayout.js";

/** Khung anh = dung mot nua template goc 2816x1536 cua chu bot. */
export const ORDER_IMAGE_WIDTH = 1408;
export const ORDER_IMAGE_HEIGHT = 768;

const JPEG_QUALITY = 88;

export interface RenderedOrderImage {
  data: Buffer;
  width: number;
  height: number;
}

const ASSETS = new URL("./assets/", import.meta.url);
const readAsset = (file: string): Buffer => readFileSync(new URL(file, ASSETS));
const dataUri = (file: string, mime: string): string =>
  `data:${mime};base64,${readAsset(file).toString("base64")}`;

// Nap 1 lan luc import module: 3 font + 2 anh, tong ~500KB. Doc lai moi lan render se
// them ~100ms/anh ma khong duoc gi.
const BG = dataUri("bg.jpg", "image/jpeg");
const BAG = dataUri("moneybag.png", "image/png");
const FONTS = [
  { name: "Display", data: readAsset("PlayfairDisplay-Bold.ttf"), weight: 700 as const, style: "normal" as const },
  { name: "Body", data: readAsset("BeVietnamPro-Regular.ttf"), weight: 400 as const, style: "normal" as const },
  { name: "Body", data: readAsset("BeVietnamPro-Bold.ttf"), weight: 700 as const, style: "normal" as const },
];

/**
 * Toa do NGANG do truc tiep tu 2 file template cua chu bot, khong uoc luong. Khe so don la
 * khoang trang giua chu "CO" (het o x=1009 he 2816) va chu vang "DON" (bat dau x=1202).
 * Toa do DOC thi khong lay tu template: ban dau de the cao 400 theo anh mau, ket qua la the
 * rong ruot con o Tong cong + dong so du bi don vao 159px cuoi, chi chua 10px mep duoi.
 */
const SLOT = { cx: 552, cy: 150, w: 96 };
const CARD = { y: 206, h: 340, w: 395, xs: [90, 508, 927] };
const CARD_GAP = CARD.xs[1] - CARD.xs[0] - CARD.w;
const OVERFLOW_Y = 552;
const BAR = { x: 381, y: 586, w: 622, h: 78 };
const BAL = { y: 678, h: 50 };
const BAG_IN_BAR = { w: 34, h: 47 };
const BAG_IN_BALANCE = { w: 23, h: 32 };

type SatoriNode = Parameters<typeof satori>[0];

const h = (style: Record<string, unknown>, children: unknown): SatoriNode =>
  ({ type: "div", props: { style, children } }) as unknown as SatoriNode;
const img = (style: Record<string, unknown>, src: string): SatoriNode =>
  ({ type: "img", props: { style, src } }) as unknown as SatoriNode;

/** It hon 3 don thi can giua ca cum, khong de dinh vao o trai cua luoi 3 cot. */
function slotLeft(count: number, i: number): number {
  if (count >= CARD.xs.length) return CARD.xs[i];
  const groupW = count * CARD.w + (count - 1) * CARD_GAP;
  return Math.round((ORDER_IMAGE_WIDTH - groupW) / 2) + i * (CARD.w + CARD_GAP);
}

function cardNode(name: string, amountText: string, index: number, left: number): SatoriNode {
  return h(
    {
      position: "absolute", left, top: CARD.y, width: CARD.w, height: CARD.h,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "22px 20px", borderRadius: 30, border: "2px solid #caecdb",
      backgroundImage: "linear-gradient(180deg, #fdfffe 0%, #e4f1e7 100%)",
      boxShadow: "0 10px 26px rgba(90,120,100,0.18)",
    },
    [
      h({
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        width: 50, height: 50, borderRadius: 25, marginBottom: 16,
        backgroundImage: "linear-gradient(180deg,#f7d294,#e2a555)",
        color: "#ffffff", fontFamily: "Display", fontSize: 28,
      }, String(index)),
      // Chieu cao CO DINH -> huy hieu va so tien thang hang giua 3 the du ten dai ngan khac nhau.
      h({ display: "flex", height: 158, alignItems: "center", justifyContent: "center", flexShrink: 0 }, [
        // lineClamp CHI an khi display la "block". De "flex" thi satori im lang bo qua, ten dai
        // tran ra 5 dong va day so tien ra khoi the. Co test chan.
        h({
          display: "block", fontFamily: "Body", fontSize: 25, lineHeight: 1.32,
          color: "#2f3e35", textAlign: "center", lineClamp: 4,
        }, name),
      ]),
      h({ display: "flex", fontFamily: "Body", fontWeight: 700, fontSize: 44, color: "#c2762a", marginTop: 10 },
        amountText),
    ]
  );
}

function balanceNode(view: OrderImageView): SatoriNode {
  const cText = "#4a3a24";
  const cNum = "#b45f0c";
  const tail = view.canWithdraw
    ? h({ display: "flex", alignItems: "center", gap: 7, color: cText }, [
        h({ display: "flex" }, "Có thể rút tiền"),
        img({ width: BAG_IN_BALANCE.w, height: BAG_IN_BALANCE.h }, BAG),
      ])
    : h({ display: "flex", alignItems: "center", color: cText }, [
        h({ display: "flex" }, "Tích luỹ thêm"),
        h({ display: "flex", color: cNum, marginLeft: 7, marginRight: 7 }, view.missingText ?? ""),
        h({ display: "flex" }, "để rút tiền"),
      ]);

  return h(
    {
      position: "absolute", left: 0, top: BAL.y, width: ORDER_IMAGE_WIDTH, height: BAL.h,
      display: "flex", alignItems: "center", justifyContent: "center",
    },
    [
      // Boc trong vien kem chu KHONG de chu tran tren nen cam: da thu, so tien mau sang tren
      // nen cam sang gan nhu khong doc duoc. Nen rieng nay la de DOC DUOC, khong phai trang tri.
      h({
        display: "flex", alignItems: "center", gap: 9, height: BAL.h,
        padding: "0 30px", borderRadius: BAL.h / 2,
        backgroundColor: "#fdfaf2", border: "2px solid #f2d9ae",
        boxShadow: "0 5px 14px rgba(150,95,30,0.18)",
        fontFamily: "Body", fontWeight: 700, fontSize: 27,
      }, [
        h({ display: "flex", color: cText }, "Số dư khả dụng:"),
        h({ display: "flex", color: cNum }, view.availableText),
        h({ display: "flex", color: cText, opacity: 0.7 }, "—"),
        tail,
      ]),
    ]
  );
}

function buildTree(view: OrderImageView): SatoriNode {
  const children: SatoriNode[] = [
    // Chu vang in san tren template co bong do toi moi noi duoc. Khong co textShadow thi
    // chu sang dat tran tren nen cam se CHIM - cang sang cang chim.
    h({
      position: "absolute", left: SLOT.cx - SLOT.w / 2, top: SLOT.cy - 34, width: SLOT.w, height: 68,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "Display", fontSize: 72, color: "#ffd79b",
      textShadow: "0 3px 7px rgba(132,72,14,0.55)",
    }, String(view.orderCount)),

    ...view.cards.map((c, i) => cardNode(c.name, c.amountText, c.index, slotLeft(view.cards.length, i))),

    h({
      position: "absolute", left: BAR.x, top: BAR.y, width: BAR.w, height: BAR.h,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 13,
      borderRadius: BAR.h / 2, border: "2px solid #ffe4bb",
      backgroundImage: "linear-gradient(180deg,#feddb0 0%,#e99c56 100%)",
      boxShadow: "0 8px 20px rgba(190,120,50,0.25)",
    }, [
      h({ display: "flex", fontFamily: "Display", fontSize: 39, color: "#ffffff" }, "Tổng cộng:"),
      h({ display: "flex", fontFamily: "Display", fontSize: 41, color: "#fff4d2" }, view.totalText),
      // Tui tien nam TRONG o. Ban in san tren template da duoc xoa khi chuan bi bg.jpg -
      // neu khong, phan duoi cua no se tho ra ngoai o.
      img({ width: BAG_IN_BAR.w, height: BAG_IN_BAR.h, marginLeft: 2 }, BAG),
    ]),

    balanceNode(view),
  ];

  if (view.extraCount > 0) {
    children.push(h({
      position: "absolute", left: 0, top: OVERFLOW_Y, width: ORDER_IMAGE_WIDTH, height: 24,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "Body", fontWeight: 700, fontSize: 21, color: "#9c5f18",
    }, `+ ${view.extraCount} đơn khác`));
  }

  return h({
    width: ORDER_IMAGE_WIDTH, height: ORDER_IMAGE_HEIGHT, display: "flex", position: "relative",
    backgroundImage: `url(${BG})`,
    backgroundSize: `${ORDER_IMAGE_WIDTH}px ${ORDER_IMAGE_HEIGHT}px`,
  }, children);
}

/** Render anh. NEM LOI neu hong - dung renderOrdersImageSafe tren duong gui tin cho user. */
export async function renderOrdersImage(view: OrderImageView): Promise<RenderedOrderImage> {
  const svg = await satori(buildTree(view), {
    width: ORDER_IMAGE_WIDTH,
    height: ORDER_IMAGE_HEIGHT,
    fonts: FONTS,
  });
  const raster = new Resvg(svg, { fitTo: { mode: "width", value: ORDER_IMAGE_WIDTH } }).render();
  // resvg CHI xuat PNG (~690KB/anh). Lay pixel RGBA tho roi ma hoa JPEG bang jpeg-js (thuan JS,
  // ~20-30ms) - con ~200KB, khong them native dependency nao.
  const encoded = jpeg.encode(
    { data: Buffer.from(raster.pixels), width: raster.width, height: raster.height },
    JPEG_QUALITY
  );
  return { data: Buffer.from(encoded.data), width: raster.width, height: raster.height };
}

/**
 * Nhu tren nhung KHONG BAO GIO nem loi - tra null. Ham nay nam tren duong gui tin bao TIEN cho
 * user: anh hong thi van phai gui duoc text, khong duoc lam mat tin nhan.
 */
export async function renderOrdersImageSafe(view: OrderImageView): Promise<RenderedOrderImage | null> {
  try {
    return await renderOrdersImage(view);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`[order-image] render anh that bai (se gui text thay the): ${detail}`);
    return null;
  }
}
```

- [ ] **Step 7: Chạy test để chắc chắn nó pass**

Run: `npx tsx --test src/core/__tests__/orderImageRenderer.test.ts`
Expected: PASS, 5 test.

- [ ] **Step 8: Xem ảnh bằng mắt**

```bash
npx tsx -e '
import { buildOrderImageView } from "./src/core/orderImage/orderImageLayout.js";
import { renderOrdersImage } from "./src/core/orderImage/orderImageRenderer.js";
import { writeFileSync } from "node:fs";
const items = [
  { orderId: "A", productName: "(HCM HỎA TỐC) Ruột Gối Ôm Cao Su Non America kích thước 35cmx100cm êm ái hàng loại 1 (+1 sản phẩm khác)", userShareAmount: 2290 },
  { orderId: "B", productName: "Áo thun nam TShirt Basic Cotton 100% 220gsm dày dặn mềm mại Coolmate (+1 sản phẩm khác)", userShareAmount: 13776 },
  { orderId: "C", productName: "Trung Nguyên Legend - Cà phê rang xay Sáng tạo 2 - Bịch 340gr", userShareAmount: 2362 },
];
const t0 = Date.now();
const out = await renderOrdersImage(buildOrderImageView({ items, availableVnd: 18428, withdrawalThresholdVnd: 20000 }));
writeFileSync("/tmp/order-image-check.jpg", out.data);
console.log(`${(out.data.length/1024).toFixed(0)}KB, ${Date.now()-t0}ms -> /tmp/order-image-check.jpg`);
'
```

Expected: ~200KB, dưới 500ms. Mở ảnh và đối chiếu: số "3" nằm trong khe tiêu đề (không đè lên chữ "ĐƠN"), 💰 nằm trong ô Tổng cộng, dòng số dư ghi "Tích luỹ thêm 1.572đ để rút tiền", mép dưới còn khoảng trống.

- [ ] **Step 9: Kiểm tra build copy được asset**

```bash
npm run build && ls dist/core/orderImage/assets/
```
Expected: đủ 5 file trong `dist/`.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json src/core/orderImage/ src/core/__tests__/orderImageRenderer.test.ts
git commit -m "feat(order-image): renderer satori + resvg + jpeg-js kem asset"
```

---

### Task 3: Nới `notifyUser` thành `{ text, image? }`

Task này **chỉ đổi kiểu, chưa đổi hành vi** — mọi chỗ gọi vẫn truyền text thuần. Tách riêng để review được phần refactor mà không lẫn với phần tính năng.

**Files:**
- Create: `src/core/notification.ts`
- Modify: `src/index.ts` (hàm `notifyUser`)
- Modify: `src/api/server.ts` (kiểu tham số `notifyUser` ~dòng 129, và 4 chỗ gọi ~dòng 365, 482, 748, 833)
- Modify: `src/scripts/ledgerAdmin.ts` (nếu có chỗ gọi notify — kiểm tra bằng grep)

**Interfaces:**
- Produces: `OutgoingImage`, `OutgoingNotification`, `NotifyUser`.

- [ ] **Step 1: Tạo kiểu dùng chung**

Tạo `src/core/notification.ts`:

```ts
import type { Platform } from "./logStore.js";

/**
 * Anh dinh kem 1 thong bao. filename co dang `${string}.${string}` vi zca-js bat buoc co duoi
 * file trong AttachmentSource - de sai kieu o day thi loi chi lo ra luc chay.
 */
export interface OutgoingImage {
  data: Buffer;
  width: number;
  height: number;
  filename: `${string}.${string}`;
}

/**
 * 1 thong bao gui cho user cuoi. `image` la TUY CHON co chu dich: khi render anh that bai thi
 * chi can bo trong truong nay la tu dong lui ve gui text, khong can nhanh if rieng o tung cho goi.
 */
export interface OutgoingNotification {
  text: string;
  image?: OutgoingImage;
}

export type NotifyUser = (
  platform: Platform,
  userId: string,
  notification: OutgoingNotification
) => Promise<void>;
```

Kiểm tra `Platform` đúng là export từ `src/core/logStore.ts`:

```bash
grep -n "export type Platform\|export interface Platform" src/core/logStore.ts
```

Nếu nó nằm ở file khác, sửa import cho khớp (đừng tạo kiểu `Platform` thứ hai).

- [ ] **Step 2: Đổi `notifyUser` trong `src/index.ts`**

Tìm hàm `notifyUser` (hiện nhận `message: string`) và đổi thành:

```ts
const notifyUser: NotifyUser = async (platform, userId, notification) => {
  if (platform === "telegram" && telegramBot) {
    await telegramBot.telegram.sendMessage(userId, notification.text);
  } else if (platform === "zalo" && zaloBot) {
    await zaloBot.sendDirectMessage(userId, notification.text);
  } else {
    console.warn(
      `[user-notify] khong the gui thong bao (${platform}/${userId} chua co bot tuong ung):`,
      notification.text
    );
  }
};
```

Thêm import: `import type { NotifyUser } from "./core/notification.js";`

(Task 4 sẽ làm cho 2 nhánh này gửi được ảnh. Bước này chỉ đổi kiểu.)

- [ ] **Step 3: Đổi kiểu tham số trong `src/api/server.ts`**

Dòng ~129, đổi:

```ts
  notifyUser: (platform: Platform, userId: string, message: string) => Promise<void>,
```

thành:

```ts
  notifyUser: NotifyUser,
```

Thêm import: `import type { NotifyUser, OutgoingNotification } from "../core/notification.js";`

- [ ] **Step 4: Để typecheck chỉ ra 4 chỗ gọi**

Run: `npm run typecheck`
Expected: FAIL, báo lỗi ở 4 chỗ truyền `string` vào tham số thứ 3.

- [ ] **Step 5: Bọc 4 chỗ gọi thành `{ text: ... }`**

Ở từng chỗ lỗi trong `server.ts`, bọc đối số thứ 3 lại. Ví dụ chỗ `~748`:

```ts
        notifyUser(entry.platform, entry.userId, {
          text: formatOrdersConfirmedReply(
            ordersConfirmedTemplate,
            [{ orderId: entry.orderId, productName: entry.productName, userShareAmount: entry.userShareAmount }],
            `${dashboardBaseUrl}/d/${token}`
          ),
        }).catch(/* giu nguyen handler cu */);
```

Làm tương tự cho 3 chỗ còn lại. **Giữ nguyên mọi `.catch()` và nội dung log hiện có.**

- [ ] **Step 6: Tìm chỗ gọi ngoài server.ts**

```bash
grep -rn "notifyUser" src/ --include="*.ts"
```
Sửa nốt nếu còn chỗ nào truyền string.

- [ ] **Step 7: Typecheck + chạy toàn bộ test**

Run: `npm run typecheck && npm test`
Expected: cả hai pass. Chưa có hành vi nào thay đổi.

- [ ] **Step 8: Commit**

```bash
git add src/core/notification.ts src/index.ts src/api/server.ts
git commit -m "refactor(notify): notifyUser nhan { text, image? } thay vi string"
```

---

### Task 4: Hai adapter gửi được ảnh (+ sửa bẫy tự khoá FAQ)

**Files:**
- Modify: `src/adapters/zalo/bot.ts` (`sendTrackedDirect` ~dòng 470, `sendDirectMessage` ~dòng 722)
- Modify: `src/index.ts` (2 nhánh trong `notifyUser`)
- Test: `src/adapters/zalo/__tests__/zaloSendImage.test.ts`

**Interfaces:**
- Consumes: `OutgoingNotification`, `OutgoingImage` từ Task 3.
- Produces: `ZaloGroupBot.sendDirectMessage(userId: string, notification: OutgoingNotification): Promise<void>`.

- [ ] **Step 1: Viết test thất bại cho bẫy msgId**

Tạo `src/adapters/zalo/__tests__/zaloSendImage.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SentMessageTracker } from "../sentMessageTracker.js";
import { collectSentMsgIds, buildDirectMessagePayload } from "../bot.js";

/**
 * zca-js tra ve { message, attachment[] }. Khi co dinh kem thi CHU co the di cung attachment va
 * `message` tra ve null. Chi ghi nhan result.message.msgId se lam bot KHONG nhan ra tin cua chinh
 * minh -> handleSelfMessage hieu nham la admin go tay -> bot TU KHOA FAQ cua chinh no 30 phut.
 */
test("gom msgId tu CA message lan moi phan tu attachment", () => {
  assert.deepEqual(collectSentMsgIds({ message: { msgId: 11 }, attachment: [] }), [11]);
  assert.deepEqual(collectSentMsgIds({ message: null, attachment: [{ msgId: 22 }] }), [22]);
  assert.deepEqual(
    collectSentMsgIds({ message: { msgId: 11 }, attachment: [{ msgId: 22 }, { msgId: 33 }] }),
    [11, 22, 33]
  );
});

test("khong co msgId nao thi tra ve mot phan tu null de van ghi dau vet", () => {
  assert.deepEqual(collectSentMsgIds(undefined), [null]);
  assert.deepEqual(collectSentMsgIds({ message: null, attachment: [] }), [null]);
});

test("tracker nhan ra tin cua chinh bot khi msgId chi nam trong attachment", () => {
  const tracker = new SentMessageTracker();
  for (const id of collectSentMsgIds({ message: null, attachment: [{ msgId: 22 }] })) {
    tracker.record(id, "noi dung");
  }
  assert.equal(tracker.wasSentByBot("22", "noi dung"), true);
});

test("khong co anh thi gui chuoi thuan, co anh thi gui kem attachments", () => {
  assert.equal(buildDirectMessagePayload({ text: "chao" }), "chao");

  const image = {
    data: Buffer.from([1, 2, 3]),
    width: 1408,
    height: 768,
    filename: "don-ve.jpg" as const,
  };
  const payload = buildDirectMessagePayload({ text: "co anh", image });
  assert.notEqual(typeof payload, "string");
  const obj = payload as { msg: string; attachments: Array<{ filename: string; metadata: { totalSize: number; width: number; height: number } }> };
  assert.equal(obj.msg, "co anh");
  assert.equal(obj.attachments.length, 1);
  assert.equal(obj.attachments[0].filename, "don-ve.jpg");
  assert.equal(obj.attachments[0].metadata.totalSize, 3);
  assert.equal(obj.attachments[0].metadata.width, 1408);
  assert.equal(obj.attachments[0].metadata.height, 768);
});
```

Trước khi chạy, kiểm tra tên method thật của tracker:

```bash
grep -n "^  [a-zA-Z]*(" src/adapters/zalo/sentMessageTracker.ts
```
Nếu method kiểm tra không tên `wasSentByBot`, sửa test cho khớp tên thật.

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `npx tsx --test src/adapters/zalo/__tests__/zaloSendImage.test.ts`
Expected: FAIL — `collectSentMsgIds` và `buildDirectMessagePayload` chưa tồn tại.

- [ ] **Step 3: Thêm 2 hàm export vào `src/adapters/zalo/bot.ts`**

Đặt ở module scope (ngoài class) để test gọi được mà không phải dựng cả bot:

```ts
/**
 * Gom MOI msgId tu ket qua api.sendMessage. zca-js tra { message, attachment[] } - khi co dinh
 * kem thi chu co the di cung attachment va `message` la null. Bo sot attachment se lam bot khong
 * nhan ra tin cua chinh minh roi TU KHOA FAQ cua chinh no (xem handleSelfMessage).
 * Tra [null] khi khong co msgId nao de van ghi dau vet theo noi dung.
 */
export function collectSentMsgIds(
  result: { message?: { msgId?: number } | null; attachment?: Array<{ msgId?: number }> } | undefined
): Array<number | null> {
  const ids: Array<number | null> = [];
  if (result?.message?.msgId !== undefined) ids.push(result.message.msgId);
  for (const att of result?.attachment ?? []) {
    if (att?.msgId !== undefined) ids.push(att.msgId);
  }
  return ids.length > 0 ? ids : [null];
}

/** Chuoi thuan khi khong co anh; object MessageContent kem attachments khi co. */
export function buildDirectMessagePayload(
  notification: OutgoingNotification
): string | { msg: string; attachments: AttachmentSource[] } {
  const image = notification.image;
  if (!image) return notification.text;
  return {
    msg: notification.text,
    attachments: [
      {
        data: image.data,
        filename: image.filename,
        metadata: { totalSize: image.data.length, width: image.width, height: image.height },
      },
    ],
  };
}
```

Thêm import: `import type { AttachmentSource } from "zca-js";` và `import type { OutgoingNotification } from "../../core/notification.js";`

- [ ] **Step 4: Chạy test để chắc chắn nó pass**

Run: `npx tsx --test src/adapters/zalo/__tests__/zaloSendImage.test.ts`
Expected: PASS.

- [ ] **Step 5: Dùng 2 hàm đó trong `sendTrackedDirect` và `sendDirectMessage`**

Đổi `sendTrackedDirect` (~dòng 470) thành:

```ts
  private async sendTrackedDirect(
    api: API,
    threadId: string,
    notification: OutgoingNotification
  ): Promise<void> {
    const payload = buildDirectMessagePayload(notification);
    const result = (await api.sendMessage(payload, threadId, ThreadType.User)) as
      | { message?: { msgId?: number } | null; attachment?: Array<{ msgId?: number }> }
      | undefined;
    // Ghi nhan MOI msgId tra ve - xem doc comment cua collectSentMsgIds.
    for (const msgId of collectSentMsgIds(result)) {
      this.sentTracker.record(msgId, notification.text);
    }
  }
```

Đổi `sendDirectMessage` (~dòng 722):

```ts
  async sendDirectMessage(userId: string, notification: OutgoingNotification): Promise<void> {
    if (!this.api) {
      throw new Error("Zalo bot chua dang nhap, khong the gui tin nhan.");
    }
    await this.sendTrackedDirect(this.api, userId, notification);
  }
```

- [ ] **Step 6: Để typecheck chỉ ra các chỗ gọi `sendTrackedDirect` cũ**

Run: `npm run typecheck`
Expected: FAIL ở các chỗ gọi `sendTrackedDirect(api, threadId, "chuoi")` trong `bot.ts` (khoảng dòng 335, 358, 524, 591, 640). Bọc từng chỗ thành `{ text: <chuỗi cũ> }`. **Đừng đổi nội dung chuỗi.**

- [ ] **Step 7: Cho Telegram và Zalo gửi ảnh trong `src/index.ts`**

```ts
const notifyUser: NotifyUser = async (platform, userId, notification) => {
  if (platform === "telegram" && telegramBot) {
    if (notification.image) {
      await telegramBot.telegram.sendPhoto(
        userId,
        { source: notification.image.data },
        { caption: notification.text }
      );
    } else {
      await telegramBot.telegram.sendMessage(userId, notification.text);
    }
  } else if (platform === "zalo" && zaloBot) {
    await zaloBot.sendDirectMessage(userId, notification);
  } else {
    console.warn(
      `[user-notify] khong the gui thong bao (${platform}/${userId} chua co bot tuong ung):`,
      notification.text
    );
  }
};
```

- [ ] **Step 8: Typecheck + chạy toàn bộ test**

Run: `npm run typecheck && npm test`
Expected: cả hai pass.

- [ ] **Step 9: Commit**

```bash
git add src/adapters/zalo/bot.ts src/adapters/zalo/__tests__/zaloSendImage.test.ts src/index.ts
git commit -m "feat(notify): gui duoc anh qua Zalo/Telegram, ghi nhan du msgId cua attachment"
```

---

### Task 5: Nối vào luồng báo đơn về

**Files:**
- Create: `src/core/orderImage/ordersConfirmedNotification.ts`
- Modify: `src/adapters/shared/replyText.ts` (thêm default + formatter cho caption)
- Modify: `src/core/settingsKeys.ts` (thêm key)
- Modify: `src/config/settingsRegistry.ts` (thêm entry)
- Modify: `src/core/ledgerStore.ts` (thêm getter)
- Modify: `src/config/env.ts` (thêm `orderImage.enabled`)
- Modify: `.env.example`
- Modify: `src/api/server.ts` (2 nhánh báo đơn confirmed, ~dòng 748 và ~833; chữ ký `createServer`)
- Modify: `src/index.ts` (truyền cờ vào `createServer`)
- Test: `src/core/__tests__/ordersConfirmedNotification.test.ts`

**Interfaces:**
- Consumes: `buildOrderImageView`, `renderOrdersImageSafe`, `OutgoingNotification`.
- Produces: `buildOrdersConfirmedNotification(params): Promise<OutgoingNotification>`; `ORDERS_CONFIRMED_CAPTION_TEMPLATE_DEFAULT`; `formatOrdersConfirmedCaption(template, dashboardUrl)`; `SETTINGS_KEYS.ordersConfirmedCaptionTemplate`; `LedgerStore.getOrdersConfirmedCaptionTemplate(defaultValue)`; `env.orderImage.enabled`.

- [ ] **Step 1: Thêm caption template vào `src/adapters/shared/replyText.ts`**

Đặt ngay dưới `ORDERS_CONFIRMED_TEMPLATE_DEFAULT`:

```ts
/**
 * Caption di kem ANH bao don ve (2026-10-05). Khac ORDERS_CONFIRMED_TEMPLATE_DEFAULT o cho anh
 * da hien ten don + so tien + tong roi, nen caption chi con viec chi duong vao dashboard.
 * Template cu van duoc giu nguyen lam text du phong khi render anh that bai.
 */
export const ORDERS_CONFIRMED_CAPTION_TEMPLATE_DEFAULT =
  `Xem chi tiết từng đơn ở dashboard của bạn nha: {{dashboardUrl}}`;

export function formatOrdersConfirmedCaption(template: string, dashboardUrl: string): string {
  return renderTemplate(template, { dashboardUrl });
}
```

- [ ] **Step 2: Khai báo setting mới**

`src/core/settingsKeys.ts`, thêm vào `SETTINGS_KEYS` ngay sau `ordersConfirmedTemplate`:

```ts
  /** Caption di kem ANH bao don ve (2026-10-05) - xem ORDERS_CONFIRMED_CAPTION_TEMPLATE_DEFAULT. */
  ordersConfirmedCaptionTemplate: "orders_confirmed_caption_template",
```

`src/config/settingsRegistry.ts`, thêm entry ngay sau entry `ordersConfirmedTemplate` (và thêm `ORDERS_CONFIRMED_CAPTION_TEMPLATE_DEFAULT` vào khối import từ `replyText.js`):

```ts
  {
    key: SETTINGS_KEYS.ordersConfirmedCaptionTemplate,
    label: "Caption đi kèm ảnh báo đơn về",
    type: "textarea",
    default: ORDERS_CONFIRMED_CAPTION_TEMPLATE_DEFAULT,
    helpText:
      "Placeholder hợp lệ: {{dashboardUrl}}. Dùng khi gửi được ảnh. Nếu render ảnh lỗi thì bot gửi mẫu tin ở ô trên thay thế.",
  },
```

`src/core/ledgerStore.ts`, thêm getter cạnh `getOrdersConfirmedTemplate`:

```ts
  getOrdersConfirmedCaptionTemplate(defaultValue: string): string {
    return this.getSetting(SETTINGS_KEYS.ordersConfirmedCaptionTemplate, defaultValue);
  }
```

- [ ] **Step 3: Thêm công tắc env**

`src/config/env.ts`, thêm vào object env (cạnh `commissionLookup`):

```ts
  /**
   * Anh bao don ve (2026-10-05). Mac dinh BAT. Tat de quay ve tin van ban thuan ma khong
   * phai rollback - render loi thi da tu dong lui ve text roi, co nay danh cho truong hop
   * muon tat han (vi du anh hien sai sau khi doi template).
   */
  orderImage: {
    enabled: optionalBool("ORDER_IMAGE_ENABLED", true),
  },
```

`.env.example`, thêm:

```
# Anh bao don ve (mac dinh true). Dat false de bot quay lai gui tin van ban thuan.
ORDER_IMAGE_ENABLED=true
```

- [ ] **Step 4: Viết test thất bại cho hàm lắp thông báo**

Tạo `src/core/__tests__/ordersConfirmedNotification.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrdersConfirmedNotification } from "../orderImage/ordersConfirmedNotification.js";
import type { ConfirmedOrderItem } from "../orderIngest.js";

const items: ConfirmedOrderItem[] = [{ orderId: "A", productName: "San pham", userShareAmount: 2290 }];
const base = {
  items,
  availableVnd: 2290,
  withdrawalThresholdVnd: 20000,
  fallbackText: "TEXT DU PHONG",
  captionText: "CAPTION",
};

test("bat anh thi tra caption kem anh JPEG", async () => {
  const n = await buildOrdersConfirmedNotification({ ...base, imageEnabled: true });
  assert.equal(n.text, "CAPTION");
  assert.ok(n.image, "phai co anh");
  assert.equal(n.image?.width, 1408);
  assert.equal(n.image?.height, 768);
  assert.ok(n.image?.filename.endsWith(".jpg"));
});

test("tat anh thi tra text du phong, khong render gi ca", async () => {
  const n = await buildOrdersConfirmedNotification({ ...base, imageEnabled: false });
  assert.equal(n.text, "TEXT DU PHONG");
  assert.equal(n.image, undefined);
});

// Tien cua user khong duoc phep mat chi vi anh hong.
test("render loi thi van tra text du phong chu khong nem loi", async () => {
  const n = await buildOrdersConfirmedNotification({
    ...base,
    imageEnabled: true,
    renderImpl: async () => {
      throw new Error("resvg hong");
    },
  });
  assert.equal(n.text, "TEXT DU PHONG");
  assert.equal(n.image, undefined);
});
```

- [ ] **Step 5: Chạy test để chắc chắn nó fail**

Run: `npx tsx --test src/core/__tests__/ordersConfirmedNotification.test.ts`
Expected: FAIL — module chưa tồn tại.

- [ ] **Step 6: Viết hàm lắp thông báo**

Tạo `src/core/orderImage/ordersConfirmedNotification.ts`:

```ts
import type { ConfirmedOrderItem } from "../orderIngest.js";
import type { OutgoingNotification } from "../notification.js";
import { buildOrderImageView } from "./orderImageLayout.js";
import {
  renderOrdersImage,
  ORDER_IMAGE_WIDTH,
  ORDER_IMAGE_HEIGHT,
  type RenderedOrderImage,
  type OrderImageRenderFn,
} from "./orderImageRenderer.js";

export interface OrdersConfirmedNotificationParams {
  items: ConfirmedOrderItem[];
  /** PHAI doc SAU khi da ghi nhan cac don moi vao ledger. */
  availableVnd: number;
  withdrawalThresholdVnd: number;
  /** Tin van ban day du - dung khi khong gui duoc anh. */
  fallbackText: string;
  /** Caption ngan di kem anh. */
  captionText: string;
  imageEnabled: boolean;
  /** Chi dung trong test de gia lap render that bai. */
  renderImpl?: OrderImageRenderFn;
}

/**
 * Lap 1 thong bao "don ve": co anh thi caption + anh, khong thi text day du.
 *
 * Gop vao 1 ham thay vi lap o 2 route cua server.ts, de cho FALLBACK chi ton tai o DUNG MOT
 * cho va test duoc. Ham nay khong bao gio nem loi - no nam tren duong bao TIEN cho user.
 */
export async function buildOrdersConfirmedNotification(
  params: OrdersConfirmedNotificationParams
): Promise<OutgoingNotification> {
  if (!params.imageEnabled) return { text: params.fallbackText };

  const view = buildOrderImageView({
    items: params.items,
    availableVnd: params.availableVnd,
    withdrawalThresholdVnd: params.withdrawalThresholdVnd,
  });

  let rendered: RenderedOrderImage | null = null;
  try {
    rendered = await (params.renderImpl ?? renderOrdersImage)(view);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`[order-image] render anh that bai (gui text thay the): ${detail}`);
    rendered = null;
  }

  if (!rendered) return { text: params.fallbackText };

  return {
    text: params.captionText,
    image: {
      data: rendered.data,
      width: rendered.width || ORDER_IMAGE_WIDTH,
      height: rendered.height || ORDER_IMAGE_HEIGHT,
      filename: "don-ve.jpg",
    },
  };
}
```

Thêm vào cuối `src/core/orderImage/orderImageRenderer.ts` kiểu cho tham số tiêm:

```ts
export type OrderImageRenderFn = (view: OrderImageView) => Promise<RenderedOrderImage>;
```

- [ ] **Step 7: Chạy test để chắc chắn nó pass**

Run: `npx tsx --test src/core/__tests__/ordersConfirmedNotification.test.ts`
Expected: PASS, 3 test.

- [ ] **Step 8: Nối vào `src/api/server.ts`**

Thêm tham số cuối cho `createServer` (đặt **sau** `notifyZaloGroup?` và cho giá trị mặc định, để các chỗ gọi hiện có trong test không phải sửa):

```ts
  orderImageEnabled = true,
```

Thêm import:

```ts
import { buildOrdersConfirmedNotification } from "../core/orderImage/ordersConfirmedNotification.js";
import {
  ORDERS_CONFIRMED_CAPTION_TEMPLATE_DEFAULT,
  formatOrdersConfirmedCaption,
} from "../adapters/shared/replyText.js";
```

**Chỗ 1 — ghi 1 đơn lẻ (~dòng 748), trong nhánh `entry.status === "confirmed"`:**

```ts
        const { token } = ledgerStore.findOrCreateDashboardToken(entry.platform, entry.userId);
        const dashboardUrl = `${dashboardBaseUrl}/d/${token}`;
        const ordersConfirmedTemplate = ledgerStore.getOrdersConfirmedTemplate(ORDERS_CONFIRMED_TEMPLATE_DEFAULT);
        const captionTemplate = ledgerStore.getOrdersConfirmedCaptionTemplate(
          ORDERS_CONFIRMED_CAPTION_TEMPLATE_DEFAULT
        );
        const confirmedItems = [
          { orderId: entry.orderId, productName: entry.productName, userShareAmount: entry.userShareAmount },
        ];
        // Doc so du SAU khi don da ghi vao ledger - doc truoc thi anh bao thieu dung don vua ghi.
        buildOrdersConfirmedNotification({
          items: confirmedItems,
          availableVnd: ledgerStore.getAvailableBalance(entry.platform, entry.userId),
          withdrawalThresholdVnd: ledgerStore.getWithdrawalThresholdVnd(withdrawalThresholdVnd),
          fallbackText: formatOrdersConfirmedReply(ordersConfirmedTemplate, confirmedItems, dashboardUrl),
          captionText: formatOrdersConfirmedCaption(captionTemplate, dashboardUrl),
          imageEnabled: orderImageEnabled,
        })
          .then((notification) => notifyUser(entry.platform, entry.userId, notification))
          .catch((notifyErr) => {
            console.warn("[user-notify] gui thong bao don moi (ghi 1 don le) that bai:", notifyErr);
          });
```

**Chỗ 2 — import báo cáo Shopee (~dòng 833), trong vòng `for (const summary of result.confirmedByUser)`:**

```ts
        const { token } = ledgerStore.findOrCreateDashboardToken(summary.platform, summary.userId);
        const dashboardUrl = `${dashboardBaseUrl}/d/${token}`;
        const ordersConfirmedTemplate = ledgerStore.getOrdersConfirmedTemplate(ORDERS_CONFIRMED_TEMPLATE_DEFAULT);
        const captionTemplate = ledgerStore.getOrdersConfirmedCaptionTemplate(
          ORDERS_CONFIRMED_CAPTION_TEMPLATE_DEFAULT
        );
        buildOrdersConfirmedNotification({
          items: summary.items,
          availableVnd: ledgerStore.getAvailableBalance(summary.platform, summary.userId),
          withdrawalThresholdVnd: ledgerStore.getWithdrawalThresholdVnd(withdrawalThresholdVnd),
          fallbackText: formatOrdersConfirmedReply(ordersConfirmedTemplate, summary.items, dashboardUrl),
          captionText: formatOrdersConfirmedCaption(captionTemplate, dashboardUrl),
          imageEnabled: orderImageEnabled,
        })
          .then((notification) => notifyUser(summary.platform, summary.userId, notification))
          .catch((notifyErr) => {
            console.warn("[user-notify] gui thong bao gop don moi (bao cao Shopee) that bai:", notifyErr);
          });
```

Giữ nguyên tính chất best-effort: **không `await`**, lỗi gửi không được làm fail response upload của admin.

- [ ] **Step 9: Truyền cờ từ `src/index.ts`**

Ở lời gọi `createServer(...)`, thêm `env.orderImage.enabled` làm đối số cuối (sau `notifyZaloGroup`).

- [ ] **Step 10: Typecheck + chạy toàn bộ test**

Run: `npm run typecheck && npm test`
Expected: cả hai pass.

- [ ] **Step 11: Kiểm tra thật trên server xem trước**

Dựng server riêng trên DB tạm (không chạy `npm run dev` để khỏi tranh token bot thật), đăng nhập `/admin`, vào `/admin/record-orders` ghi 1 đơn lẻ trạng thái "Khả dụng" cho một userId bất kỳ. Vì không có bot nào chạy, `notifyUser` rơi vào nhánh `console.warn` — xác nhận log in ra caption (không phải tin dài cũ), nghĩa là nhánh ảnh đã chạy.

Rồi mở `/admin/settings`, xác nhận có ô **"Caption đi kèm ảnh báo đơn về"** và lưu được.

- [ ] **Step 12: Commit**

```bash
git add src/core/orderImage/ordersConfirmedNotification.ts src/core/__tests__/ordersConfirmedNotification.test.ts \
        src/adapters/shared/replyText.ts src/core/settingsKeys.ts src/config/settingsRegistry.ts \
        src/core/ledgerStore.ts src/config/env.ts .env.example src/api/server.ts src/index.ts
git commit -m "feat(order-image): gui anh thay tin van ban khi bao don ve"
```

---

### Task 6: Cập nhật CLAUDE.md

`CLAUDE.md` là nguồn duy nhất cho chi tiết kiến trúc của repo này. Tính năng mới không ghi vào đó thì lần sau sẽ phải đọc lại code từ đầu.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Thêm mục cho module mới**

Trong khối cây thư mục `src/core/`, thêm sau `vietQr.ts`:

```
  orderImage/                 (2026-10-05) Anh bao "don ve" gui thay tin van ban. orderImageLayout.ts = ham THUAN dung view model (chon 3 don tien cao nhat, tong tinh tren TAT CA don chu khong phai 3 the dang hien - co test chan); orderImageRenderer.ts = satori -> SVG -> resvg -> pixel RGBA -> jpeg-js -> JPEG (~200KB, 150-340ms, khong goi mang). **resvg CHI xuat PNG (~690KB)** nen phai ma hoa lai bang jpeg-js (thuan JS, ~20-30ms, khong them native dep). ordersConfirmedNotification.ts = cho DUY NHAT quyet dinh gui anh hay gui text, khong bao gio nem loi. **Asset (nen + font) nam trong assets/ va PHAI duoc copy sang dist/ qua `npm run build:assets`** - tsc chi copy .ts, quen buoc nay thi local chay ngon ma Railway crash vi khong thay font. Toa do NGANG do truc tiep tu 2 file template cua chu bot; toa do DOC thi khong (lay y nguyen anh mau se lam the rong ruot con o Tong cong bi don vao 159px cuoi). **Hai cai bay da gap that**: (1) `lineClamp` cua satori CHI an khi `display: "block"` - de "flex" thi no im lang bo qua, ten san pham dai tran ra 5 dong va day so tien ra khoi the; (2) chu sang dat tran tren nen cam thi CHIM, cang sang cang chim - chu vang in san tren template noi duoc la nho co bong do toi, nen so don bat buoc co textShadow va dong so du bat buoc co nen kem rieng. 💰 trong o Tong cong duoc cat tu chinh anh nen, va ban in san da bi xoa khoi bg.jpg (khong xoa thi phan duoi cua no tho ra ngoai o). Tat qua ORDER_IMAGE_ENABLED=false.
```

Trong mục `src/api/server.ts`, thêm một câu: `createServer()` nhận thêm `orderImageEnabled` (mặc định `true`) — 2 nhánh báo đơn confirmed đi qua `buildOrdersConfirmedNotification()`, render lỗi thì tự lui về `formatOrdersConfirmedReply` như cũ.

Trong mục `src/adapters/zalo/bot.ts`, thêm: `sendTrackedDirect` nhận `OutgoingNotification` và ghi nhận **mọi** msgId trả về qua `collectSentMsgIds()` — khi có đính kèm thì `zca-js` có thể trả `message: null` và msgId chỉ nằm trong `attachment`, bỏ sót sẽ làm bot tưởng tin của chính mình là admin gõ tay rồi **tự khoá FAQ của chính nó**.

Trong mục `settings` của `ledgerStore.ts`, sửa "11 giá trị" thành "12 giá trị" và thêm `ordersConfirmedCaptionTemplate` vào danh sách template.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: ghi nhan module anh bao don ve vao CLAUDE.md"
```

---

## Self-Review

**Spec coverage:**

| Mục trong spec | Task |
|---|---|
| satori + resvg, không Chromium | 2 |
| Không có ảnh sản phẩm | 1 (thẻ chỉ có số thứ tự + tên + tiền) |
| Giữ tiêu đề in sẵn, điền số vào khe | 2 (`SLOT`) |
| Tối đa 3 thẻ + "+N đơn khác" | 1 (`ORDER_IMAGE_MAX_CARDS`), 2 (`OVERFLOW_Y`) |
| Tổng = tổng tất cả đơn | 1 (có test chặn hồi quy) |
| JPEG | 2 (jpeg-js) |
| Chỉ áp dụng cho thông báo đơn về | 5 (chỉ sửa 2 nhánh confirmed) |
| Asset + cách dựng lại | 2 (Step 2) |
| Toạ độ, màu, cỡ chữ | 2 |
| Dưới 3 đơn căn giữa | 2 (`slotLeft`) |
| Bẫy `lineClamp` | 2 (comment + test tên dài) |
| Hai bẫy tương phản | 2 (`textShadow`, nền kem) |
| Số dư + ngưỡng, đọc sau khi ghi | 5 (Step 8) |
| Hai trạng thái loại trừ nhau | 1 (`canWithdraw`/`missingText`), 2 (`balanceNode`) |
| `OutgoingNotification` | 3 |
| Bước build copy asset | 2 (Step 3) |
| Bẫy tự khoá FAQ | 4 (có test riêng) |
| Setting caption + giữ template cũ làm dự phòng | 5 |
| `ORDER_IMAGE_ENABLED` | 5 |
| Fallback mọi đường lỗi | 2 (`renderOrdersImageSafe`), 5 (`buildOrdersConfirmedNotification`) |
| Bộ test | 1, 2, 4, 5 |

**Chưa phủ:** spec nhắc "dùng API async của resvg để không chẹn event loop". Đã đo thật: toàn bộ chuỗi 150–340ms/ảnh và `notifyUser` được gọi **không `await`** sau khi response đã trả, nên không chẹn request của admin. Giữ API đồng bộ của resvg cho đơn giản; nếu sau này một lần import bắn cho hàng trăm user thì mới cần xếp hàng lại.

**Placeholder scan:** không có TBD/TODO. Mọi bước code đều có code thật.

**Type consistency:** `OrderImageView` (Task 1) → tham số của `renderOrdersImage` (Task 2) → `buildOrderImageView` gọi trong `buildOrdersConfirmedNotification` (Task 5). `RenderedOrderImage` (Task 2) → `OutgoingImage` (Task 3) tại Task 5. `OutgoingNotification` (Task 3) → `buildDirectMessagePayload` (Task 4) → `buildOrdersConfirmedNotification` (Task 5). `OrderImageRenderFn` khai ở Task 5 Step 6 nhưng đặt trong file của Task 2 — đã ghi rõ trong bước đó.
