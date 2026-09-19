const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") || "";

const EXPENSE_CATEGORIES = [
    "Ovqat", "Transport", "Uy", "Salomatlik", "Ta'lim",
    "Kiyim", "Ko'ngil ochar", "Kommunal", "Telefon/Internet", "Boshqa"
];
const INCOME_CATEGORIES = [
    "Maosh", "Biznes", "Sovg'a", "Freelance", "Ijara", "Boshqa"
];

export async function categorizeTransaction(description: string, type: "income" | "expense"): Promise<string> {
    const categories = type === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
    const prompt = `Tranzaksiya turi: ${type === "expense" ? "Xarajat" : "Daromad"}
Tavsif: ${description}
Mavjud kategoriyalar: ${categories.join(", ")}
Faqat mos kategoriya nomini qaytaring. JSON: {"category": "Kategoriya"}`;

    try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "llama3-70b-8192",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.1,
                max_tokens: 50,
            }),
        });
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || "";
        const match = content.match(/\{.*?\}/s);
        if (match) {
            const parsed = JSON.parse(match[0]);
            if (categories.includes(parsed.category)) return parsed.category;
        }
    } catch (e) {
        console.error("Groq categorize error:", e);
    }
    return "Boshqa";
}

export async function parseIntent(text: string) {
    const prompt = `Matn: "${text}"
Foydalanuvchi matnini tahlil qil va JSON qaytar:
{
  "intent": "expense|income|debt_gave|debt_received|report|debts_list|unknown",
  "amount": raqam_yoki_null,
  "description": "tavsif_yoki_null",
  "person": "ism_yoki_null",
  "due_date": "YYYY-MM-DD_yoki_null"
}`;

    try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "llama3-70b-8192",
                messages: [{ role: "user", content: prompt }],
                temperature: 0,
                max_tokens: 120,
            }),
        });
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || "";
        const match = content.match(/\{.*?\}/s);
        if (match) {
            return JSON.parse(match[0]);
        }
    } catch (e) {
        console.error("Groq intent error:", e);
    }
    return { intent: "unknown" };
}
