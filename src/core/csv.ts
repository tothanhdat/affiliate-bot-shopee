/**
 * Parser CSV toi gian (RFC4180-lite) - KHONG dung lib ngoai (khong co trong dependencies), chi can
 * du de xu ly file Excel/Google Sheets xuat ra (co ho tro dau ngoac kep bao quanh field chua dau
 * phay/xuong dong). Dung chung boi ledgerAdmin.ts (record-conversions-csv) va trang admin web
 * (/admin/record-orders, import file CSV qua form upload) - xem core/orderIngest.ts.
 */

/** Dong dau tien la header, cac dong sau map theo ten cot trong header (khong theo vi tri co dinh). */
export function parseCsv(text: string): Record<string, string>[] {
  // Excel/Shopee xuat CSV UTF-8 luon kem BOM dau file - neu khong bo se lam sai ten cot dau tien
  // (vd "﻿ID don hang" khong khop "ID don hang" khi tra theo ten cot).
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = parseCsvRows(withoutBom);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row) => {
      const obj: Record<string, string> = {};
      header.forEach((key, i) => {
        obj[key] = (row[i] ?? "").trim();
      });
      return obj;
    });
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, "\n");

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (inQuotes) {
      if (c === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      pushField();
    } else if (c === "\n") {
      pushRow();
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  return rows;
}
