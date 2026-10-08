import { readFileSync } from "node:fs";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import jpeg from "jpeg-js";
import type { OrderImageView } from "./orderImageLayout.js";
import { renderOrderCountBadge } from "./orderCountBadge.js";

/**
 * Khung anh = dung kich thuoc goc cua file template chu bot gui. Render o dung kich thuoc nay
 * de nen khong bi phong to lam nhoe.
 *
 * DOI TEMPLATE DO PHAN GIAI CAO HON: chi can doi 2 hang so nay cho khop file moi. Toan bo toa
 * do/co chu ben duoi viet trong he thiet ke 1024x572 roi nhan voi K, nen tu dong giãn theo.
 */
export const ORDER_IMAGE_WIDTH = 1678;
export const ORDER_IMAGE_HEIGHT = 937;

/** He toa do thiet ke - moi hang so hinh hoc duoi day deu tinh theo khung nay. */
const BASE_WIDTH = 1024;
const K = ORDER_IMAGE_WIDTH / BASE_WIDTH;
/** Doi 1 so trong he thiet ke sang pixel that. */
const u = (n: number): number => Math.round(n * K);

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

// Nap 1 lan luc import module. Doc lai moi lan render se them ~100ms/anh ma khong duoc gi.
const BG = dataUri("bg.jpg", "image/jpeg");
const BAG = dataUri("moneybag.png", "image/png");
const FONTS = [
  { name: "M", data: readAsset("Montserrat-Bold.ttf"), weight: 700 as const, style: "normal" as const },
  { name: "M", data: readAsset("Montserrat-ExtraBold.ttf"), weight: 800 as const, style: "normal" as const },
];

/**
 * Toa do NGANG do TRUC TIEP tu file template: khe so don la khoang trang giua chu trang "BAN CO"
 * (het o x=371) va chu vang "DON" (bat dau o x=462), dong 2 cua tieu de nam trong dai y 96-138.
 *
 * Toa do DOC cua phan noi dung thi KHONG lay tu template (template chi co tieu de + trang tri):
 * giu dung ty le da duyet o ban truoc, co day xuong mot chut vi tieu de moi ket thuc thap hon.
 */
/**
 * Khe so don. cx/cy va fontSize do bang cach so net chu THAT voi chu hoa cua tieu de in san,
 * tren CHINH file template dang dung (he 1678x937): chu hoa cao 62px va chan o y=223.
 *
 * fontSize 49 (= 80px that) la lua chon CO Y cua chu bot: net so cao ~58px, THAP hon chu hoa
 * mot chut cho do nang, vi Montserrat ExtraBold dac hon han font cua template nen de cao bang
 * dung thi con so trong "nang" hon cum chu xung quanh.
 *
 * cy=118 de DUONG CHAN van nam o y=223 nhu chu hai ben: chu so duoc can GIUA trong hop, nen
 * doi fontSize ma giu nguyen cy se lam chan nhich len - phai bu lai.
 *
 * **Do lai moi khi doi file template** - ban 1678x937 KHONG phai ban phong deu cua ban 1024x572
 * truoc do (chu tieu de to hon ~11% so voi khung), nen suy ra bang phep nhan la sai.
 */
const SLOT = { cx: 414, cy: 118, w: 90, h: 54, fontSize: 49 };
const CARD = { y: 160, h: 246, w: 287, xs: [65, 369, 673] };
const CARD_GAP = CARD.xs[1] - CARD.xs[0] - CARD.w;
const OVERFLOW_Y = 410;
const BAR = { x: 277, y: 434, w: 470, h: 56 };
const BAL = { y: 500, h: 36 };
/**
 * Dong "Trong do X mo khoa tu dd/mm" (2026-10-08) - nam DUOI pill so du, chi ve khi lo co don bi giam.
 * BAL ket thuc o y=536 trong he thiet ke 1024x572, nen y=540 vua con cho ma khong cham day anh.
 */
const HELD = { y: 540, h: 26 };
const BAG_IN_BAR = { w: 25, h: 34 };
const BAG_IN_BALANCE = { w: 17, h: 23 };

type SatoriNode = Parameters<typeof satori>[0];

const h = (style: Record<string, unknown>, children: unknown): SatoriNode =>
  ({ type: "div", props: { style, children } }) as unknown as SatoriNode;
const img = (style: Record<string, unknown>, src: string): SatoriNode =>
  ({ type: "img", props: { style, src } }) as unknown as SatoriNode;

/** It hon 3 don thi can giua ca cum, khong de dinh vao o trai cua luoi 3 cot. */
function slotLeft(count: number, i: number): number {
  if (count >= CARD.xs.length) return CARD.xs[i];
  const groupW = count * CARD.w + (count - 1) * CARD_GAP;
  return Math.round((BASE_WIDTH - groupW) / 2) + i * (CARD.w + CARD_GAP);
}

function cardNode(name: string, amountText: string, index: number, left: number): SatoriNode {
  return h(
    {
      position: "absolute",
      left: u(left),
      top: u(CARD.y),
      width: u(CARD.w),
      height: u(CARD.h),
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: `${u(16)}px ${u(15)}px`,
      borderRadius: u(22),
      border: `${Math.max(1, u(2))}px solid #caecdb`,
      backgroundImage: "linear-gradient(180deg, #fdfffe 0%, #e4f1e7 100%)",
      boxShadow: `0 ${u(7)}px ${u(19)}px rgba(90,120,100,0.18)`,
    },
    [
      h(
        {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          width: u(36),
          height: u(36),
          borderRadius: u(18),
          marginBottom: u(11),
          backgroundImage: "linear-gradient(180deg,#f7d294,#e2a555)",
          color: "#ffffff",
          fontFamily: "M",
          fontWeight: 800,
          fontSize: u(19),
        },
        String(index)
      ),
      // Chieu cao CO DINH -> huy hieu va so tien thang hang giua 3 the du ten dai ngan khac nhau.
      h(
        { display: "flex", height: u(110), alignItems: "center", justifyContent: "center", flexShrink: 0 },
        [
          // lineClamp CHI an khi display la "block". De "flex" thi satori im lang bo qua, ten dai
          // tran them dong va day so tien ra khoi the. Co test chan.
          h(
            {
              display: "block",
              fontFamily: "M",
              fontWeight: 700,
              fontSize: u(17),
              lineHeight: 1.32,
              color: "#2f3e35",
              textAlign: "center",
              lineClamp: 4,
            },
            name
          ),
        ]
      ),
      h(
        {
          display: "flex",
          fontFamily: "M",
          fontWeight: 800,
          fontSize: u(30),
          color: "#c2762a",
          marginTop: u(7),
        },
        amountText
      ),
    ]
  );
}

/**
 * Dong giai thich phan tien KHONG co trong "So du kha dung" du da nam trong "Tong cong" cua lo - gop
 * CA heldLine (don trong LO NAY dang bi giam) lan debtLine (no hoan tra CO THE den tu mot lan import
 * KHAC, khong lien quan gi toi lo nay) thanh MOT dong, noi bang dau cham giua khi ca hai cung xuat hien.
 *
 * Phai gop chung mot dong (khong ve 2 dong rieng): khung anh thiet ke 1024x572, HELD.y=540 + h=26 da
 * gan sat day (con 6px), khong du cho xep them mot dong 26px nua ben duoi ma khong bi cat.
 *
 * Co NEN RIENG chu khong de chu tran tren nen cam - da gap that voi pill so du: chu mau sang tren
 * nen cam sang gan nhu khong doc duoc. Nen nay la de DOC DUOC, khong phai trang tri.
 */
function heldNode(heldLine: string): SatoriNode {
  return h(
    {
      position: "absolute",
      left: 0,
      top: u(HELD.y),
      width: ORDER_IMAGE_WIDTH,
      height: u(HELD.h),
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    [
      h(
        {
          display: "flex",
          alignItems: "center",
          height: u(HELD.h),
          padding: `0 ${u(16)}px`,
          borderRadius: u(HELD.h / 2),
          backgroundColor: "#fdfaf2",
          border: `${Math.max(1, u(1))}px solid #f2d9ae`,
          fontFamily: "M",
          fontWeight: 700,
          fontSize: u(15),
          color: "#7a5a2e",
        },
        heldLine
      ),
    ]
  );
}

function balanceNode(view: OrderImageView): SatoriNode {
  const cText = "#4a3a24";
  const cNum = "#b45f0c";
  const tail = view.canWithdraw
    ? h({ display: "flex", alignItems: "center", gap: u(5), color: cText }, [
        h({ display: "flex" }, "Có thể rút tiền"),
        img({ width: u(BAG_IN_BALANCE.w), height: u(BAG_IN_BALANCE.h) }, BAG),
      ])
    : h({ display: "flex", alignItems: "center", color: cText }, [
        h({ display: "flex" }, "Tích luỹ thêm"),
        h({ display: "flex", fontWeight: 800, color: cNum, marginLeft: u(5), marginRight: u(5) }, view.missingText ?? ""),
        h({ display: "flex" }, "để rút tiền"),
      ]);

  return h(
    {
      position: "absolute",
      left: 0,
      top: u(BAL.y),
      width: ORDER_IMAGE_WIDTH,
      height: u(BAL.h),
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
          gap: u(6),
          height: u(BAL.h),
          padding: `0 ${u(22)}px`,
          borderRadius: u(BAL.h / 2),
          backgroundColor: "#fdfaf2",
          border: `${Math.max(1, u(2))}px solid #f2d9ae`,
          boxShadow: `0 ${u(4)}px ${u(10)}px rgba(150,95,30,0.18)`,
          fontFamily: "M",
          fontWeight: 700,
          fontSize: u(19),
        },
        [
          h({ display: "flex", color: cText }, "Số dư khả dụng:"),
          h({ display: "flex", fontWeight: 800, color: cNum }, view.availableText),
          h({ display: "flex", color: cText, opacity: 0.7 }, "—"),
          tail,
        ]
      ),
    ]
  );
}

function buildTree(view: OrderImageView): SatoriNode {
  // Con so don duoc ve rieng bang SVG (gradient + vien trang mo + bong do) roi nhung vao nhu
  // mot anh - satori khong lam duoc ca ba hieu ung nay cung luc. Xem orderCountBadge.ts.
  const badge = renderOrderCountBadge({
    count: view.orderCount,
    width: u(SLOT.w),
    height: u(SLOT.h),
    fontSize: u(SLOT.fontSize),
  });

  const children: SatoriNode[] = [
    img(
      {
        position: "absolute",
        left: u(SLOT.cx - SLOT.w / 2),
        top: u(SLOT.cy - SLOT.h / 2),
        width: u(SLOT.w),
        height: u(SLOT.h),
      },
      `data:image/png;base64,${badge.toString("base64")}`
    ),

    ...view.cards.map((c, i) => cardNode(c.name, c.amountText, c.index, slotLeft(view.cards.length, i))),

    h(
      {
        position: "absolute",
        left: u(BAR.x),
        top: u(BAR.y),
        width: u(BAR.w),
        height: u(BAR.h),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: u(9),
        borderRadius: u(BAR.h / 2),
        border: `${Math.max(1, u(2))}px solid #ffe4bb`,
        backgroundImage: "linear-gradient(180deg,#feddb0 0%,#e99c56 100%)",
        boxShadow: `0 ${u(6)}px ${u(15)}px rgba(190,120,50,0.25)`,
      },
      [
        h({ display: "flex", fontFamily: "M", fontWeight: 800, fontSize: u(27), color: "#ffffff" }, "Tổng cộng:"),
        h({ display: "flex", fontFamily: "M", fontWeight: 800, fontSize: u(29), color: "#fff4d2" }, view.totalText),
        img({ width: u(BAG_IN_BAR.w), height: u(BAG_IN_BAR.h), marginLeft: u(1) }, BAG),
      ]
    ),

    balanceNode(view),
  ];

  // Khong co ca 2 ly do -> khong ve gi, anh y nhu ban cu. Co 1 trong 2 -> hien dung no. Co ca hai
  // -> gop thanh 1 dong (xem ly do trong doc comment cua heldNode).
  const noteLine = [view.heldLine, view.debtLine].filter((line): line is string => line !== null).join(" · ");
  if (noteLine) children.push(heldNode(noteLine));

  if (view.extraCount > 0) {
    children.push(
      h(
        {
          position: "absolute",
          left: 0,
          top: u(OVERFLOW_Y),
          width: ORDER_IMAGE_WIDTH,
          height: u(18),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "M",
          fontWeight: 700,
          fontSize: u(15),
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
  // ~20-30ms) - nhe hon nhieu lan, khong them native dependency nao.
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
