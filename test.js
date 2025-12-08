import { createLarkClient } from "./src/core/larkbase-client.js";
import dotenv from "dotenv";
dotenv.config();

async function test() {
  const baseId = process.env.LARK_BASE_ID;

  const larkClient = await createLarkClient(
    process.env.LARK_APP_ID,
    process.env.LARK_APP_SECRET
  );

  try {
    const res = await larkClient.bitable.appTable.list({
      path: {
        app_token: baseId,
      },
      params: {
        page_size: 100,
      },
    });

    console.log("LIST TABLE:", res.data.items);
  } catch (err) {
    console.error("ERROR ----");
    console.error(err.response?.data || err);
  }
}

test();
