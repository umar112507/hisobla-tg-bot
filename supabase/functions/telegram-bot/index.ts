import { webhookCallback } from "https://deno.land/x/grammy@v1.27.0/mod.ts";
import { bot } from "./bot.ts";

const handleUpdate = webhookCallback(bot, "std/http");

Deno.serve(async (req) => {
    if (req.method === "POST") {
        try {
            return await handleUpdate(req);
        } catch (err) {
            console.error("Webhook processing error:", err);
            return new Response("OK", { status: 200 });
        }
    }

    return new Response("Hisobla Telegram Bot Edge Function (Deno) is running!", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
    });
});
