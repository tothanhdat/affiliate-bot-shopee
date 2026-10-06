import type { Platform } from "./types.js";

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
 * 1 thong bao gui cho user cuoi (khac notifyAdmin - gui cho chu bot).
 *
 * `image` la TUY CHON co chu dich: khi render anh that bai thi chi can bo trong truong nay la
 * tu dong lui ve gui text, khong can nhanh if rieng o tung cho goi. Tin bao TIEN cho user khong
 * bao gio duoc phep mat chi vi anh hong.
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
