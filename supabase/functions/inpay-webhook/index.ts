import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BOT_TOKEN = Deno.env.get("BOT_TOKEN") || "";

const INPAY_MERCHANT_ID = Deno.env.get("INPAY_MERCHANT_ID") || "12313";
const INPAY_MERCHANT_TOKEN = Deno.env.get("INPAY_MERCHANT_TOKEN") || "c6051ee8b0e7eb8b7cfa77349a17afbb";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req: Request) => {
    // Enable CORS
    if (req.method === "OPTIONS") {
        return new Response("ok", {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
                "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
            },
        });
    }

    try {
        let payload: any = {};
        const url = new URL(req.url);

        if (req.method === "POST") {
            const contentType = req.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
                payload = await req.json();
            } else if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
                const formData = await req.formData();
                for (const [key, value] of formData.entries()) {
                    payload[key] = value;
                }
            } else {
                const text = await req.text();
                try {
                    payload = JSON.parse(text);
                } catch {
                    payload = Object.fromEntries(new URLSearchParams(text));
                }
            }
        } else {
            // GET query params
            for (const [key, value] of url.searchParams.entries()) {
                payload[key] = value;
            }
        }

        console.log("Inpay webhook received payload:", payload);

        // Parameters from Inpay callback
        const orderId = payload.order_id || payload.account || payload.transaction_id || payload.order;
        const merchantId = String(payload.merchant_id || payload.merchant || "");
        const status = String(payload.status || payload.state || "").toLowerCase();
        const inpayTransId = String(payload.inpay_trans_id || payload.id || payload.pay_id || "");
        const token = payload.merchant_token || payload.token || payload.sign || "";

        if (!orderId) {
            return new Response(JSON.stringify({ error: "Missing order_id" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Validate merchant ID & token if provided in callback
        if (merchantId && merchantId !== INPAY_MERCHANT_ID) {
            console.warn(`Merchant ID mismatch: received ${merchantId}, expected ${INPAY_MERCHANT_ID}`);
        }

        // Determine if payment is successful
        const isPaid = status === "paid" || status === "success" || status === "1" || status === "completed" || status === "ok";

        if (!isPaid) {
            console.log(`Payment status for order ${orderId} is not paid: ${status}`);
            // Update status to failed/cancelled if specified
            if (status === "failed" || status === "cancelled" || status === "0") {
                await supabase.from("payments").update({
                    status: "failed",
                    updated_at: new Date().toISOString(),
                }).eq("order_id", orderId);
            }

            return new Response(JSON.stringify({ status: "acknowledged", order_id: orderId }), {
                headers: { "Content-Type": "application/json" },
            });
        }

        // 1. Fetch payment record
        const { data: payment } = await supabase
            .from("payments")
            .select("*")
            .eq("order_id", orderId)
            .single();

        let userId: number | null = null;
        let plan = "1_month";

        if (payment) {
            userId = payment.user_id;
            plan = payment.plan;

            // Update payment record in database
            await supabase.from("payments").update({
                status: "paid",
                inpay_trans_id: inpayTransId,
                updated_at: new Date().toISOString(),
            }).eq("order_id", orderId);
        } else {
            // Parse orderId if format is user_{userId}_{plan}_{timestamp}
            const parts = orderId.split("_");
            if (parts.length >= 3 && parts[0] === "user") {
                userId = Number(parts[1]);
                plan = parts[2];
            }
        }

        if (!userId) {
            return new Response(JSON.stringify({ error: "User not found for order" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }

        // 2. Grant Premium to User
        const { data: user } = await supabase.from("users").select("premium_expires_at").eq("user_id", userId).single();
        let baseDate = new Date();
        if (user && user.premium_expires_at && new Date(user.premium_expires_at) > baseDate) {
            baseDate = new Date(user.premium_expires_at);
        }

        const expiresAt = new Date(baseDate);
        let planTitle = "1 Oylik Premium";
        if (plan === "1_month") {
            expiresAt.setMonth(expiresAt.getMonth() + 1);
            planTitle = "1 Oylik Premium";
        } else if (plan === "3_months") {
            expiresAt.setMonth(expiresAt.getMonth() + 3);
            planTitle = "3 Oylik Premium";
        } else if (plan === "6_months") {
            expiresAt.setMonth(expiresAt.getMonth() + 6);
            planTitle = "6 Oylik Premium";
        } else if (plan === "1_year") {
            expiresAt.setFullYear(expiresAt.getFullYear() + 1);
            planTitle = "1 Yillik Premium";
        } else if (plan === "lifetime") {
            expiresAt.setFullYear(expiresAt.getFullYear() + 100);
            planTitle = "Lifetime (Umrbod) Premium";
        } else {
            expiresAt.setMonth(expiresAt.getMonth() + 1);
        }

        await supabase.from("users").update({
            is_premium: true,
            premium_expires_at: expiresAt.toISOString(),
        }).eq("user_id", userId);

        // 3. Send Telegram notification to user
        if (BOT_TOKEN) {
            const formattedDate = expiresAt.toLocaleDateString("uz-UZ", {
                year: "numeric",
                month: "long",
                day: "numeric",
            });

            const msg = `🎉 <b>To'lovingiz muvaffaqiyatli qabul qilindi!</b>\n\n` +
                `👑 <b>Tarif:</b> ${planTitle}\n` +
                `📅 <b>Amal qilish muddati:</b> ${formattedDate}\n\n` +
                `Endi botdan va Mini App-dan cheksiz hamda ovozli xabarlar bilan foydalanishingiz mumkin! 🚀`;

            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: userId,
                    text: msg,
                    parse_mode: "HTML",
                }),
            }).catch(e => console.error("Failed to send TG notification:", e));
        }

        return new Response(JSON.stringify({ status: "success", order_id: orderId, is_premium: true }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (e: any) {
        console.error("Inpay webhook error:", e);
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
});
