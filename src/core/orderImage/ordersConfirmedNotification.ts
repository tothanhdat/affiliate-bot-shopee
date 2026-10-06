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
  /** PHAI doc SAU khi da ghi nhan cac don moi vao ledger, khong thi anh bao thieu dung don vua ghi. */
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
 * Gop vao 1 ham thay vi lap o 2 route cua server.ts, de cho FALLBACK chi ton tai o DUNG MOT noi
 * va test duoc. Ham nay khong bao gio nem loi - no nam tren duong bao TIEN cho user.
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
    // Quy tac 2026-09-02: log chi tiet chan doan TRUOC khi nuot loi.
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
