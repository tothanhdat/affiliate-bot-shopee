import { test } from "node:test";
import assert from "node:assert/strict";
import { AddlivetagCommissionLookup, type FetchLike } from "../commissionLookup.js";

/**
 * Nguon du lieu hoa hong cho tinh nang "uoc tinh tien hoan" luc tra link (2026-10-01).
 *
 * Boi canh de hieu vi sao cac test duoi day ton tai (dung xoa khi refactor):
 * - Shopee KHONG cap Open API cho tai khoan ca nhan, va API noi bo cua portal affiliate bi chan
 *   boi chu ky `x-sap-sec` gan theo TUNG request (da verify 2026-09-30, khong replay duoc tu
 *   server). Nen bot di qua API cua ben thu ba (addlivetag) - xem CLAUDE.md.
 * - Fixture duoi day la RESPONSE THAT do duoc ngay 2026-09-30, khong phai so bia ra.
 */

const ULANZI_RESPONSE = {
  status: "success",
  productInfo: {
    itemId: 43881017922,
    productName: "Túi đựng máy ảnh -Túi đeo vai đựng máy ảnh khi đi du lịch dung tích 3L Ulanzi F02",
    price: 490000,
    commission: 12250,
    sellerComFinal: 0,
    shopeeComFinal: 12250,
    sellerRatePercent: 0,
    shopeeRatePercent: 2.5,
    totalRatePercent: 2.5,
    isCapped: false,
  },
};

/**
 * Canon EOS R50 - don gia tri CAO nen hoa hong CHAM TRAN: 2,5% cua 19.049.000d la 476.225d,
 * nhung Shopee chi tra 40.000d. Day la fixture quan trong nhat trong file.
 */
const CANON_CAPPED_RESPONSE = {
  status: "success",
  productInfo: {
    itemId: 57810614027,
    productName: "Máy Ảnh Canon EOS R50 + Kit RF-S 18-45mm",
    price: 19049000,
    commission: 40000,
    sellerComFinal: 0,
    shopeeComFinal: 40000,
    sellerRatePercent: 0,
    shopeeRatePercent: 2.5,
    totalRatePercent: 2.5,
    isCapped: true,
  },
};

/** San pham co CA hoa hong san (2,5%) lan hoa hong seller Xtra (2%) - 878 + 702 = 1580. */
const XTRA_RESPONSE = {
  status: "success",
  productInfo: {
    itemId: 27129209971,
    productName: "Gối Massage Chống Đau Cổ Vai Gáy",
    price: 35100,
    commission: 1580,
    sellerComFinal: 702,
    shopeeComFinal: 878,
    sellerRatePercent: 2,
    shopeeRatePercent: 2.5,
    totalRatePercent: 4.5,
    isCapped: false,
  },
};

interface Call {
  url: string;
  headers: Record<string, string>;
}

/** fetch gia: ghi lai request roi tra ve body/status dinh san. */
function fakeFetch(
  body: unknown,
  options: { status?: number; throws?: Error; invalidJson?: boolean } = {}
): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    if (options.throws) throw options.throws;
    return {
      ok: (options.status ?? 200) >= 200 && (options.status ?? 200) < 300,
      status: options.status ?? 200,
      json: async () => {
        if (options.invalidJson) throw new SyntaxError("Unexpected token");
        return body;
      },
    };
  };
  return { fetchImpl, calls };
}

function makeLookup(fetchImpl: FetchLike, overrides: Record<string, unknown> = {}) {
  return new AddlivetagCommissionLookup({
    apiKey: "test-key",
    timeoutMs: 2000,
    fetchImpl,
    ...overrides,
  });
}

test("doc dung so tien hoa hong va gia tu response that", async () => {
  const { fetchImpl } = fakeFetch(ULANZI_RESPONSE);
  const result = await makeLookup(fetchImpl).lookup("43881017922");

  assert.deepEqual(result, {
    commissionAmount: 12250,
    ratePercent: 2.5,
    price: 490000,
    isCapped: false,
    productName: "Túi đựng máy ảnh -Túi đeo vai đựng máy ảnh khi đi du lịch dung tích 3L Ulanzi F02",
  });
});

test("don CHAM TRAN: lay so tien API tra ve, TUYET DOI khong nhan rate voi gia", async () => {
  // Day la test quan trong nhat file. 2,5% x 19.049.000 = 476.225d, nhung Shopee chi tra
  // 40.000d vi co tran hoa hong. Neu ai do "toi uu" ham lookup thanh phep nhan rate x gia thi
  // bot se hua voi user so tien GAP 12 LAN so thuc nhan, o dung loai don ma user soi ky nhat.
  const { fetchImpl } = fakeFetch(CANON_CAPPED_RESPONSE);
  const result = await makeLookup(fetchImpl).lookup("57810614027");

  assert.equal(result?.commissionAmount, 40000);
  assert.equal(result?.isCapped, true);
  const naive = Math.round((result!.price * result!.ratePercent) / 100);
  assert.equal(naive, 476225);
  assert.notEqual(result?.commissionAmount, naive);
});

test("cong ca hoa hong san lan hoa hong seller Xtra (lay field commission tong)", async () => {
  const { fetchImpl } = fakeFetch(XTRA_RESPONSE);
  const result = await makeLookup(fetchImpl).lookup("27129209971");

  // 878 (san 2,5%) + 702 (Xtra 2%) = 1580 - phai lay field `commission` tong, khong phai
  // rieng shopeeComFinal, neu khong se bao thieu cho user o moi san pham co Xtra.
  assert.equal(result?.commissionAmount, 1580);
  assert.equal(result?.ratePercent, 4.5);
});

test("gui item_id tren query va API key tren header", async () => {
  const { fetchImpl, calls } = fakeFetch(ULANZI_RESPONSE);
  await makeLookup(fetchImpl).lookup("43881017922");

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /item_id=43881017922/);
  assert.equal(calls[0].headers["X-API-Key"], "test-key");
  // Key KHONG duoc nam tren query string - de lot vao log may chu / lich su trinh duyet.
  assert.doesNotMatch(calls[0].url, /test-key/);
});

test("truyen base_rate va cap khi admin cau hinh (tier tai khoan khac mac dinh)", async () => {
  const { fetchImpl, calls } = fakeFetch(ULANZI_RESPONSE);
  await makeLookup(fetchImpl, { baseRatePercent: 8, capVnd: 20000 }).lookup("43881017922");

  assert.match(calls[0].url, /base_rate=8/);
  assert.match(calls[0].url, /cap=20000/);
});

test("khong cau hinh base_rate/cap thi KHONG gui - de API tu lay rate that cua tai khoan", async () => {
  const { fetchImpl, calls } = fakeFetch(ULANZI_RESPONSE);
  await makeLookup(fetchImpl).lookup("43881017922");

  assert.doesNotMatch(calls[0].url, /base_rate/);
  assert.doesNotMatch(calls[0].url, /cap=/);
});

/**
 * Nhom test duoi: MOI duong that bai deu phai tra `null`, KHONG BAO GIO throw. Ham nay nam tren
 * duong gui tin cho user - mot exception lot ra la user khong nhan duoc link, tuc la mat ca
 * nghiep vu chinh chi vi mot tinh nang phu.
 */
test("vuot han muc (HTTP 429) -> null, khong throw", async () => {
  const { fetchImpl } = fakeFetch({}, { status: 429 });
  assert.equal(await makeLookup(fetchImpl).lookup("43881017922"), null);
});

test("loi server (HTTP 500) -> null", async () => {
  const { fetchImpl } = fakeFetch({}, { status: 500 });
  assert.equal(await makeLookup(fetchImpl).lookup("43881017922"), null);
});

test("thieu API key (HTTP 401) -> null", async () => {
  const { fetchImpl } = fakeFetch({}, { status: 401 });
  assert.equal(await makeLookup(fetchImpl).lookup("43881017922"), null);
});

test("mang loi / timeout -> null", async () => {
  const { fetchImpl } = fakeFetch({}, { throws: new Error("The operation was aborted") });
  assert.equal(await makeLookup(fetchImpl).lookup("43881017922"), null);
});

test("JSON hong -> null", async () => {
  const { fetchImpl } = fakeFetch({}, { invalidJson: true });
  assert.equal(await makeLookup(fetchImpl).lookup("43881017922"), null);
});

test("status khac 'success' -> null", async () => {
  const { fetchImpl } = fakeFetch({ status: "error", message: "not found" });
  assert.equal(await makeLookup(fetchImpl).lookup("43881017922"), null);
});

test("thieu productInfo -> null", async () => {
  const { fetchImpl } = fakeFetch({ status: "success" });
  assert.equal(await makeLookup(fetchImpl).lookup("43881017922"), null);
});

test("commission khong phai so -> null", async () => {
  const { fetchImpl } = fakeFetch({
    status: "success",
    productInfo: { ...ULANZI_RESPONSE.productInfo, commission: "12250d" },
  });
  assert.equal(await makeLookup(fetchImpl).lookup("43881017922"), null);
});

test("commission = 0 -> tra ve 0 chu KHONG gop thanh null", async () => {
  // Doi hanh vi 2026-10-01: truoc day 0 bi gop vao null nen bot hen "doi Shopee xac nhan don" -
  // loi hen khong bao gio den. Gio 0 la mot cau tra loi THAT ("chua bat hoa hong") va phai den
  // duoc adapter de bao thang cho user.
  const { fetchImpl } = fakeFetch({
    status: "success",
    productInfo: { ...ULANZI_RESPONSE.productInfo, commission: 0, shopeeComFinal: 0 },
  });
  const result = await makeLookup(fetchImpl).lookup("43881017922");
  assert.equal(result?.commissionAmount, 0);
});

test("commission am -> null", async () => {
  const { fetchImpl } = fakeFetch({
    status: "success",
    productInfo: { ...ULANZI_RESPONSE.productInfo, commission: -100 },
  });
  assert.equal(await makeLookup(fetchImpl).lookup("43881017922"), null);
});

/**
 * Thu lai khi nghi cache cua ben cung cap bi hong (2026-10-01).
 *
 * Su co that: cung item 57810614027 (Canon EOS R50), cung mot phut - ban cache
 * (`dataSource: "db"`) tra `commission: 0`, ban ep goi nguon (`clear_cache=1`,
 * `dataSource: "api"`) tra `commission: 40000`. Portal Shopee xac nhan 40.000d moi dung.
 * Khong co buoc thu lai thi bot bo qua uoc tinh cua san pham CO hoa hong that.
 */
function seqFetch(bodies: unknown[]) {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(String(url));
    const body = bodies[Math.min(urls.length - 1, bodies.length - 1)];
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetchImpl, urls };
}

const zeroFromCache = {
  status: "success",
  productInfo: { ...CANON_CAPPED_RESPONSE.productInfo, commission: 0, isCapped: false, dataSource: "db" },
};
const realFromApi = {
  status: "success",
  productInfo: { ...CANON_CAPPED_RESPONSE.productInfo, dataSource: "api" },
};

test("commission=0 den tu CACHE -> goi lai voi clear_cache=1 va lay so that", async () => {
  const { fetchImpl, urls } = seqFetch([zeroFromCache, realFromApi]);
  const result = await makeLookup(fetchImpl).lookup("57810614027");

  assert.equal(urls.length, 2, "phai goi lan 2 de ep nguon");
  assert.doesNotMatch(urls[0], /clear_cache/, "lan 1 khong duoc ep - se pha cache cua ho vo co");
  assert.match(urls[1], /clear_cache=1/);
  assert.equal(result?.commissionAmount, 40000);
});

test("commission=0 den tu NGUON (dataSource=api) -> tin ngay, khong goi lai", async () => {
  // Day la so 0 THAT (nganh hang khong co hoa hong) - goi lai cung chi ra 0, ton request va
  // lam user cho lau hon vo ich.
  const zeroFromApi = {
    status: "success",
    productInfo: { ...CANON_CAPPED_RESPONSE.productInfo, commission: 0, dataSource: "api" },
  };
  const { fetchImpl, urls } = seqFetch([zeroFromApi]);
  const result = await makeLookup(fetchImpl).lookup("57810614027");

  assert.equal(urls.length, 1, "khong duoc goi lai khi so 0 den tu nguon");
  assert.equal(result?.commissionAmount, 0, "0 da xac minh tu nguon -> tra 0, khong phai null");
});

test("goi lai van 0 -> tra null, va CHI thu dung 1 lan (khong lap vo han)", async () => {
  const zeroFromApi = {
    status: "success",
    productInfo: { ...CANON_CAPPED_RESPONSE.productInfo, commission: 0, dataSource: "api" },
  };
  const { fetchImpl, urls } = seqFetch([zeroFromCache, zeroFromApi]);
  const result = await makeLookup(fetchImpl).lookup("57810614027");

  assert.equal(urls.length, 2);
  assert.equal(result?.commissionAmount, 0, "da ep goi nguon va van 0 -> day la 0 THAT");
});

test("co hoa hong binh thuong tu cache -> KHONG ton them request nao", async () => {
  const okFromCache = {
    status: "success",
    productInfo: { ...ULANZI_RESPONSE.productInfo, dataSource: "db" },
  };
  const { fetchImpl, urls } = seqFetch([okFromCache]);
  const result = await makeLookup(fetchImpl).lookup("43881017922");

  assert.equal(urls.length, 1);
  assert.equal(result?.commissionAmount, 12250);
});

test("goi lai that bai -> khong throw, tra null theo ket qua goc", async () => {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(String(url));
    if (urls.length === 1) return { ok: true, status: 200, json: async () => zeroFromCache };
    throw new Error("The operation was aborted");
  };
  assert.equal(await makeLookup(fetchImpl).lookup("57810614027"), null);
  assert.equal(urls.length, 2);
});

test("doc ten san pham tu cung response - khong ton them request nao", async () => {
  // Nguon da tra san productInfo.productName trong CUNG loi goi dung de tra hoa hong. Trang
  // /admin/links lay ten san pham tu day, nen bo qua field nay la mat han cot do (khong co nguon
  // thu hai nao biet ten san pham).
  const { fetchImpl, calls } = fakeFetch(ULANZI_RESPONSE);
  const result = await makeLookup(fetchImpl).lookup("43881017922");

  assert.equal(
    result?.productName,
    "Túi đựng máy ảnh -Túi đeo vai đựng máy ảnh khi đi du lịch dung tích 3L Ulanzi F02"
  );
  assert.equal(calls.length, 1);
});

test("response thieu productName -> ten ve null, hoa hong van doc binh thuong", async () => {
  const { fetchImpl } = fakeFetch({
    status: "success",
    productInfo: { itemId: 1, price: 1000, commission: 50, totalRatePercent: 5, isCapped: false },
  });
  const result = await makeLookup(fetchImpl).lookup("1");

  assert.equal(result?.productName, null);
  assert.equal(result?.commissionAmount, 50);
});
