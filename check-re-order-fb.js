import * as larkService from "./src/services/larkbase/index.js";
import * as utils from "./src/utils/index.js";
import { createLarkClient } from "./src/core/larkbase-client.js";
import dotenv from "dotenv";
dotenv.config();

const ONE_MI = 60 * 1000;
const SEVEN_DAY = 7 * 24 * 60 * 60 * 1000;

function toDate(ts) {
  return new Date(ts).toLocaleString("vi-VN");
}

function extractProductCodes(record) {
  const field = record.fields?.["Gồm các mã sản phẩm"];
  if (!field || !Array.isArray(field) || !field[0]?.text) return [];
  return field[0].text
    .split(",")
    .map((item) => item.split("-")[0]?.trim())
    .filter(Boolean);
}

export async function checkReOrderFB(
  baseId,
  tableName,
  tableName2,
  tableName3,
  from,
  to
) {
  console.log(`=== START CHECK RE-ORDER FB FROM ${from} TO ${to} ===`);

  const larkClient = await createLarkClient(
    process.env.LARK_APP_ID,
    process.env.LARK_APP_SECRET
  );

  const timestampFrom = utils.vnTimeToUTCTimestampMiliseconds(from) - ONE_MI;
  const timestampTo = utils.vnTimeToUTCTimestampMiliseconds(to) + ONE_MI;

  const listTb = await larkService.getListTable(larkClient, baseId);

  // === BẢNG HUỶ ===
  const mainTbCheck = listTb?.data?.items?.find((t) => t.name === tableName);
  if (!mainTbCheck) throw new Error(`Không tìm thấy bảng: ${tableName}`);
  const tableId1 = mainTbCheck.table_id;
  console.log(`[LARK] ✅ Tìm thấy bảng '${tableName}' (ID=${tableId1})`);

  const existingRecords = await larkService.searchLarkRecordsFilterDate(
    larkClient,
    baseId,
    tableId1,
    1000,
    "Ngày tạo đơn",
    timestampFrom,
    timestampTo
  );
  console.log(
    `[LARK] Đã lấy ${existingRecords.length} bản ghi từ '${tableName}'.`
  );

  // === BẢNG 2 (K chứa TT Huỷ) ===
  const table2 = listTb?.data?.items?.find((t) => t.name === tableName2);
  let noCancelRecord2 = [];
  let tableId2 = null;

  if (table2) {
    tableId2 = table2.table_id;
    console.log(`[LARK] ✅ Tìm thấy bảng '${tableName2}' (ID=${tableId2})`);
    noCancelRecord2 = await larkService.searchLarkRecords(
      larkClient,
      baseId,
      tableId2,
      1000
    );
    console.log(
      `[LARK] Đã lấy ${noCancelRecord2.length} bản ghi từ '${tableName2}'.`
    );
  } else {
    console.warn(
      `[LARK] ⚠️ Không tìm thấy bảng '${tableName2}', sẽ chỉ xử lý dữ liệu từ '${tableName}'.`
    );
  }

  // === BẢNG 3 (K chứa TT Huỷ) ===
  const table3 = listTb?.data?.items?.find((t) => t.name === tableName3);
  let noCancelRecord3 = [];
  let tableId3 = null;

  if (table3) {
    tableId3 = table3.table_id;
    console.log(`[LARK] ✅ Tìm thấy bảng '${tableName3}' (ID=${tableId3})`);
    noCancelRecord3 = await larkService.searchLarkRecordsFilterDate(
      larkClient,
      baseId,
      tableId3,
      1000,
      "Ngày tạo đơn",
      timestampTo,
      timestampTo + SEVEN_DAY
    );
    console.log(
      `[LARK] Đã lấy ${noCancelRecord3.length} bản ghi từ '${tableName3}'.`
    );
  } else {
    console.warn(
      `[LARK] ⚠️ Không tìm thấy bảng '${tableName3}', sẽ chỉ xử lý dữ liệu từ '${tableName}'.`
    );
  }

  // === PHÂN LOẠI ===
  const cancelledRecords = existingRecords.filter(
    (r) => r.fields?.["Trạng thái"] === "Đã huỷ"
  );

  const otherRecords = [
    ...existingRecords.filter((r) => r.fields?.["Trạng thái"] !== "Đã huỷ"),
    ...noCancelRecord2.filter((r) => r.fields?.["Trạng thái"] !== "Đã huỷ"),
    ...noCancelRecord3.filter((r) => r.fields?.["Trạng thái"] !== "Đã huỷ"),
  ];

  console.log(`[LARK] Có ${cancelledRecords.length} đơn huỷ.`);
  console.log(`[LARK] Có ${otherRecords.length} đơn còn lại.`);

  // === HUỶ KHÔNG SĐT ===
  const cancelledNoPhoneRecords = cancelledRecords.filter((r) => {
    const phones = r.fields?.["Số điện thoại"];
    if (!phones || !Array.isArray(phones) || phones.length === 0) return true;
    const validPhones = phones.filter((p) => p.text && p.text.trim() !== "");
    return validPhones.length === 0;
  });
  console.log(
    `[LARK] Có ${cancelledNoPhoneRecords.length} đơn huỷ không có SĐT.`
  );

  // === HUỶ CÓ SĐT ===
  const cancelledWithPhone = cancelledRecords.filter((r) => {
    const phones = r.fields?.["Số điện thoại"];
    return (
      Array.isArray(phones) &&
      phones.some((p) => p.text && p.text.trim() !== "")
    );
  });
  console.log(`[LARK] Có ${cancelledWithPhone.length} đơn huỷ có SĐT.`);

  // === TÌM KHÁCH ĐẶT LẠI (7 ngày) ===
  const TIME_WINDOW = 7 * 24 * 60 * 60 * 1000;
  const otherMap = {};

  for (const order of otherRecords) {
    const phone = order.fields?.["Số điện thoại"]?.[0]?.text?.trim();
    if (!phone) continue;
    if (!otherMap[phone]) otherMap[phone] = [];
    otherMap[phone].push(order);
  }

  const reorders = [];
  for (const cancelled of cancelledWithPhone) {
    const phone = cancelled.fields?.["Số điện thoại"]?.[0]?.text?.trim();
    const cancelDate = cancelled.fields?.["Ngày tạo đơn"];
    if (!phone || !cancelDate || !otherMap[phone]) continue;

    const cancelledCodes = extractProductCodes(cancelled);
    if (cancelledCodes.length === 0) continue;

    for (const order of otherMap[phone]) {
      const orderDate = order.fields?.["Ngày tạo đơn"];
      if (!orderDate) continue;
      const delta = orderDate - cancelDate;

      if (orderDate > cancelDate && delta <= TIME_WINDOW) {
        const orderCodes = extractProductCodes(order);
        const isSameProduct = cancelledCodes.some((code) =>
          orderCodes.includes(code)
        );
        if (isSameProduct) {
          reorders.push({
            sdt: phone,
            ngayHuy: toDate(cancelDate),
            ngayDatLai: toDate(orderDate),
            maTrung: cancelledCodes.filter((c) => orderCodes.includes(c)),
            donHuy: cancelled.record_id,
            donMoi: order.record_id,
          });
        }
      }
    }
  }

  console.log(
    `[LARK] Có ${reorders.length} khách đặt lại trong 7 ngày sau khi huỷ (cùng mã sản phẩm).`
  );

  // === CẬP NHẬT TRẠNG THÁI HUỶ ===
  console.log(`[LARK] Bắt đầu cập nhật trạng thái huỷ...`);

  const reordersCancelledIds = new Set(reorders.map((r) => r.donHuy));
  const noPhoneCancelledIds = new Set(
    cancelledNoPhoneRecords.map((r) => r.record_id)
  );

  const cancelledFinal = cancelledRecords.filter(
    (r) =>
      !reordersCancelledIds.has(r.record_id) &&
      !noPhoneCancelledIds.has(r.record_id)
  );

  console.log(`[LARK] Số đơn cần update:
- Không có SĐT: ${noPhoneCancelledIds.size}
- Huỷ để đặt lại: ${reordersCancelledIds.size}
- Huỷ hẳn: ${cancelledFinal.length}`);

  const batchNoPhone = cancelledNoPhoneRecords.map((r) => ({
    record_id: r.record_id,
    fields: { "Trạng thái huỷ": "Khách không cho số điện thoại" },
  }));

  const batchReorder = reorders.map((r) => ({
    record_id: r.donHuy,
    fields: { "Trạng thái huỷ": "Huỷ để đặt lại" },
  }));

  const batchCancelledFinal = cancelledFinal.map((r) => ({
    record_id: r.record_id,
    fields: { "Trạng thái huỷ": "Huỷ hẳn" },
  }));

  if (batchNoPhone.length)
    await larkService.updateLarkRecords(
      larkClient,
      baseId,
      tableId1,
      batchNoPhone
    );

  if (batchReorder.length)
    await larkService.updateLarkRecords(
      larkClient,
      baseId,
      tableId1,
      batchReorder
    );

  if (batchCancelledFinal.length)
    await larkService.updateLarkRecords(
      larkClient,
      baseId,
      tableId1,
      batchCancelledFinal
    );

  console.log(`[LARK] ✅ Hoàn tất cập nhật trạng thái huỷ.`);
}

const baseId = process.env.LARK_BASE_ID;
const tableName = process.env.LARK_TABLE_CHECK_CANCEL; // Bảng chứa tất cả đơn (Chứa huỷ) của tháng hiện tại để check huỷ (Nếu bảng này kéo tất cả trạng thái về thì bảng 2 không cần thiết)
const tableName2 = process.env.LARK_TABLE_NO_CANCEL; // Bảng không chứa TT huỷ của tháng hiện tại nếu chia 2 bảng (VD tháng 12 kéo từ pos về 2 bảng Huỷ và Không huỷ)
const tableName3 = process.env.LARK_TABLE_NEXT_MONTH_NO_CANCEL; // Bảng không chứa TT huỷ của tháng sau để check khách huỷ tháng này đặt lại tháng sau
const from = process.env.FROM ? `${process.env.FROM} 00:00:00` : null;
const to = process.env.TO ? `${process.env.TO} 23:59:59` : null;

console.log("=== CONFIG ===");
console.log(`LARK_BASE_ID: ${baseId}`);
console.log(`LARK_TABLE_CHECK_CANCEL: ${tableName}`);
console.log(`LARK_TABLE_NO_CANCEL: ${tableName2}`);
console.log(`LARK_TABLE_NEXT_MONTH_NO_CANCEL: ${tableName3}`);
console.log(`FROM: ${from}`);
console.log(`TO: ${to}`);
console.log("==============");

checkReOrderFB(baseId, tableName, tableName2, tableName3, from, to);
