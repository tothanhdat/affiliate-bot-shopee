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

export type OrderImageRenderFn = (view: OrderImageView) => Promise<RenderedOrderImage>;

const ASSETS = new URL("./assets/", import.meta.url);
const readAsset = (file: string): Buffer => readFileSync(new URL(file, ASSETS));
const dataUri = (file: string, mime: string): string =>
  `data:${mime};base64,${readAsset(file).toString("base64")}`;

// Nap 1 lan luc import module: 3 font + 2 anh, tong ~500KB. Doc lai moi lan render se them
// ~100ms/anh ma khong duoc gi.
const BG = dataUri("bg.jpg", "image/jpeg");
const BAG = dataUri("moneybag.png", "image/png");
const FONTS = [
  {
    name: "Display",
    data: readAsset("PlayfairDisplay-Bold.ttf"),
    weight: 700 as const,
    style: "normal" as const,
  },
  {
    name: "Body",
    data: readAsset("BeVietnamPro-Regular.ttf"),
    weight: 400 as const,
    style: "normal" as const,
  },
  {
    name: "Body",
    data: readAsset("BeVietnamPro-Bold.ttf"),
    weight: 700 as const,
    style: "normal" as const,
  },
];

/**
 * Toa do NGANG do truc tiep tu 2 file template cua chu bot, khong uoc luong. Khe so don la
 * khoang trang giua chu "CO" (het o x=1009 he 2816) va chu vang "DON" (bat dau x=1202).
 *
 * Toa do DOC thi KHONG lay tu template: ban dau de the cao 400 theo dung anh mau, ket qua la
 * the rong ruot con o Tong cong + dong so du bi don vao 159px cuoi va chi chua 10px mep duoi.
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
      position: "absolute",
      left,
      top: CARD.y,
      width: CARD.w,
      height: CARD.h,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "22px 20px",
      borderRadius: 30,
      border: "2px solid #caecdb",
      backgroundImage: "linear-gradient(180deg, #fdfffe 0%, #e4f1e7 100%)",
      boxShadow: "0 10px 26px rgba(90,120,100,0.18)",
    },
    [
      h(
        {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          width: 50,
          height: 50,
          borderRadius: 25,
          marginBottom: 16,
          backgroundImage: "linear-gradient(180deg,#f7d294,#e2a555)",
          color: "#ffffff",
          fontFamily: "Display",
          fontSize: 28,
        },
        String(index)
      ),
      // Chieu cao CO DINH -> huy hieu va so tien thang hang giua 3 the du ten dai ngan khac nhau.
      h({ display: "flex", height: 158, alignItems: "center", justifyContent: "center", flexShrink: 0 }, [
        // lineClamp CHI an khi display la "block". De "flex" thi satori im lang bo qua, ten dai
        // tran ra 5 dong va day so tien ra khoi the. Co test chan.
        h(
          {
            display: "block",
            fontFamily: "Body",
            fontSize: 25,
            lineHeight: 1.32,
            color: "#2f3e35",
            textAlign: "center",
            lineClamp: 4,
          },
          name
        ),
      ]),
      h(
        {
          display: "flex",
          fontFamily: "Body",
          fontWeight: 700,
          fontSize: 44,
          color: "#c2762a",
          marginTop: 10,
        },
        amountText
      ),
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
      position: "absolute",
      left: 0,
      top: BAL.y,
      width: ORDER_IMAGE_WIDTH,
      height: BAL.h,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    [
      // Boc trong vien kem chu KHONG de chu tran tren nen cam: da thu, so tien mau sang tren nen
      // cam sang gan nhu khong doc duoc. Nen rieng nay la de DOC DUOC, khong phai trang tri.
      h(
        {
          display: "flex",
          alignItems: "center",
          gap: 9,
          height: BAL.h,
          padding: "0 30px",
          borderRadius: BAL.h / 2,
          backgroundColor: "#fdfaf2",
          border: "2px solid #f2d9ae",
          boxShadow: "0 5px 14px rgba(150,95,30,0.18)",
          fontFamily: "Body",
          fontWeight: 700,
          fontSize: 27,
        },
        [
          h({ display: "flex", color: cText }, "Số dư khả dụng:"),
          h({ display: "flex", color: cNum }, view.availableText),
          h({ display: "flex", color: cText, opacity: 0.7 }, "—"),
          tail,
        ]
      ),
    ]
  );
}

function buildTree(view: OrderImageView): SatoriNode {
  const children: SatoriNode[] = [
    // Chu vang in san tren template co bong do toi moi noi duoc. Khong co textShadow thi chu
    // sang dat tran tren nen cam se CHIM - cang sang cang chim.
    h(
      {
        position: "absolute",
        left: SLOT.cx - SLOT.w / 2,
        top: SLOT.cy - 34,
        width: SLOT.w,
        height: 68,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Display",
        fontSize: 72,
        color: "#ffd79b",
        textShadow: "0 3px 7px rgba(132,72,14,0.55)",
      },
      String(view.orderCount)
    ),

    ...view.cards.map((c, i) => cardNode(c.name, c.amountText, c.index, slotLeft(view.cards.length, i))),

    h(
      {
        position: "absolute",
        left: BAR.x,
        top: BAR.y,
        width: BAR.w,
        height: BAR.h,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 13,
        borderRadius: BAR.h / 2,
        border: "2px solid #ffe4bb",
        backgroundImage: "linear-gradient(180deg,#feddb0 0%,#e99c56 100%)",
        boxShadow: "0 8px 20px rgba(190,120,50,0.25)",
      },
      [
        h({ display: "flex", fontFamily: "Display", fontSize: 39, color: "#ffffff" }, "Tổng cộng:"),
        h({ display: "flex", fontFamily: "Display", fontSize: 41, color: "#fff4d2" }, view.totalText),
        // Tui tien nam TRONG o. Ban in san tren template da duoc xoa khi chuan bi bg.jpg - neu
        // khong, phan duoi cua no se tho ra ngoai o.
        img({ width: BAG_IN_BAR.w, height: BAG_IN_BAR.h, marginLeft: 2 }, BAG),
      ]
    ),

    balanceNode(view),
  ];

  if (view.extraCount > 0) {
    children.push(
      h(
        {
          position: "absolute",
          left: 0,
          top: OVERFLOW_Y,
          width: ORDER_IMAGE_WIDTH,
          height: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Body",
          fontWeight: 700,
          fontSize: 21,
          color: "#9c5f18",
        },
        `+ ${view.extraCount} đơn khác`
      )
    );
  }

  return h(
    {
      width: ORDER_IMAGE_WIDTH,
      height: ORDER_IMAGE_HEIGHT,
      display: "flex",
      position: "relative",
      backgroundImage: `url(${BG})`,
      backgroundSize: `${ORDER_IMAGE_WIDTH}px ${ORDER_IMAGE_HEIGHT}px`,
    },
    children
  );
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
