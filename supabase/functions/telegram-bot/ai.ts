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
        if (GROQ_API_KEY) {
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
        }
    } catch (e) {
        console.error("Groq categorize error:", e);
    }

    // Fallback keyword categorizer
    const descLower = description.toLowerCase();
    if (/oylik|maosh|zarplata|avans|ishhaqi|stipendiya/i.test(descLower)) return "Maosh";
    if (/biznes|foyda|sotuv/i.test(descLower)) return "Biznes";
    if (/taksi|avto|benzin|metan|propan|yo'l|bus/i.test(descLower)) return "Transport";
    if (/ovqat|tushlik|non|go'sht|osh|kafe|restoran|do'kon|bozor/i.test(descLower)) return "Ovqat";
    if (/uy|ijara|arenda|remont/i.test(descLower)) return "Uy";
    if (/apteka|dori|vrach|shifokor/i.test(descLower)) return "Salomatlik";
    if (/kurs|maktab|univer|kitob/i.test(descLower)) return "Ta'lim";
    if (/kino|o'yin|park|konsert/i.test(descLower)) return "Ko'ngil ochar";
    if (/svet|gaz|suv|musor/i.test(descLower)) return "Kommunal";
    if (/payme|click|uzum|tarif|paket|internet|telefon/i.test(descLower)) return "Telefon/Internet";
    return "Boshqa";
}

export async function parseIntent(text: string, summaryContext?: any) {
    const today = new Date().toISOString().split("T")[0];

    const prompt = `Siz "Hisobla" moliyaviy AI yordamchisiz. Bugungi sana: ${today}.
Matnni chuqur tahlil qiling va qarz, xarajat yoki daromad ekanligini ajrating.

QARZ QOIDALARI:
1. QARZ BERILDI ("debt_gave"): Men kimgadir qarz bergan bo'lsam (masalan: "Ali ga 500000 qarz berdim", "Sardor 100 ming oldi", "Javohirga 200k berildi") -> intent: "debt_gave"
2. QARZ OLINDI ("debt_received"): Men kimdandir qarz olgan bo'lsam (masalan: "Validan 200 ming qarz oldim", "Sobir menga 500k qarz berdi") -> intent: "debt_received"

MUDDAT (due_date):
- Agar muddat aytilgan bo'lsa (masalan: "10 kunga", "oy oxirigacha", "15-oktyabrgacha"), uni YYYY-MM-DD formatida hisoblab chiqaring.
- Aks holda null.

NUMERIK SHAKLLAR:
- "ming" / "k" = 000 (10 ming -> 10000)
- "mln" / "million" = 000000 (2 mln -> 2000000)

Matn: "${text}"

JSON qaytaring:
- Qarz berildi: {"intent": "debt_gave", "person": "Ali", "amount": 500000, "due_date": "YYYY-MM-DD yoki null"}
- Qarz olindi: {"intent": "debt_received", "person": "Vali", "amount": 200000, "due_date": "YYYY-MM-DD yoki null"}
- Daromad: {"intent": "income", "amount": 2000000, "description": "oylik"}
- Xarajat: {"intent": "expense", "amount": 10000, "description": "taksi"}
- Hisobot: {"intent": "report"}
- Qarzlar: {"intent": "debts_list"}
- Muloqot: {"intent": "ai_reply", "reply": "Matn..."}

Faqat JSON qaytaring.`;

    try {
        if (GROQ_API_KEY) {
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
                    max_tokens: 250,
                }),
            });
            const data = await res.json();
            const content = data.choices?.[0]?.message?.content || "";
            const match = content.match(/\{.*?\}/s);
            if (match) {
                const parsed = JSON.parse(match[0]);
                if (parsed.intent) return parsed;
            }
        }
    } catch (e) {
        console.error("Groq intent error:", e);
    }

    // Local fallback regex parser
    return fallbackRegexParser(text);
}

function fallbackRegexParser(text: string) {
    const lower = text.toLowerCase();

    // Parse amount
    let amount: number | null = null;
    const mlnMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:mln|million)/);
    if (mlnMatch) amount = parseFloat(mlnMatch[1]) * 1000000;

    if (!amount) {
        const mingMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:ming|k)/);
        if (mingMatch) amount = parseFloat(mingMatch[1]) * 1000;
    }

    if (!amount) {
        const digitMatch = lower.match(/\b\d{3,9}\b/);
        if (digitMatch) amount = parseFloat(digitMatch[0]);
    }

    // Parse relative due date (e.g., "10 kunga")
    let dueDate: string | null = null;
    const daysMatch = lower.match(/(\d+)\s*kun/);
    if (daysMatch) {
        const days = parseInt(daysMatch[1]);
        const d = new Date();
        d.setDate(d.getDate() + days);
        dueDate = d.toISOString().split("T")[0];
    }

    // Parse person name
    let person = "Noma'lum";
    const personMatch = text.match(/([A-Z][a-z]+|Ali|Vali|Sardor|Javohir|Sobir|Botiro|Aziz|Jasur)/);
    if (personMatch) person = personMatch[0];

    if (amount) {
        // DEBT GAVE: qarz berdim, berdim, qarz berildi, berib turdim
        if (/qarz ber|berdim|berildi|berib tur/i.test(lower)) {
            return { intent: "debt_gave", person, amount, due_date: dueDate };
        }

        // DEBT RECEIVED: qarz oldim, qarz berdi, oldim, olindi
        if (/qarz ol|oldim|olindi|menga berdi/i.test(lower)) {
            return { intent: "debt_received", person, amount, due_date: dueDate };
        }

        // INCOME
        if (/oylik|maosh|zarplata|avans|stipendiya|tushum|ishhaqi|daromad|bonus|freelance|tushdi/i.test(lower)) {
            const desc = text.replace(/(\d+[\d\s\.]*)\s*(?:ming|k|mln|million|so'm)?/gi, "").replace(/tushdi|oldim|keldi/gi, "").trim();
            return { intent: "income", amount, description: desc || "oylik" };
        }

        // EXPENSE
        if (/ishlatdim|ketdi|sarfladim|taksi|ovqat|do'kon|bozor|tushlik|xarajat|harajat|to'ladim/i.test(lower)) {
            const desc = text.replace(/(\d+[\d\s\.]*)\s*(?:ming|k|mln|million|so'm)?/gi, "").replace(/ishlatdim|ketdi|sarfladim|to'ladim/gi, "").trim();
            return { intent: "expense", amount, description: desc || "xarajat" };
        }

        return { intent: "expense", amount, description: text };
    }

    if (/hisobot|balans|statistika/i.test(lower)) return { intent: "report" };
    if (/qarzlar|qarzlarim/i.test(lower)) return { intent: "debts_list" };

    return {
        intent: "ai_reply",
        reply: "🤖 Tushundim! Masalan: <i>Ali ga 500 ming qarz berdim 10 kunga</i> deb yozishingiz mumkin."
    };
}

export async function transcribeAudio(fileUrl: string): Promise<string | null> {
    if (!GROQ_API_KEY) return null;

    try {
        const audioRes = await fetch(fileUrl);
        if (!audioRes.ok) throw new Error("Failed to download audio from Telegram");

        const audioBlob = await audioRes.blob();

        const formData = new FormData();
        formData.append("file", audioBlob, "voice.ogg");
        formData.append("model", "whisper-large-v3");
        formData.append("language", "uz"); // Force target language to Uzbek

        const groqRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
            },
            body: formData,
        });

        const data = await groqRes.json();
        return data.text || null;
    } catch (e) {
        console.error("Groq transcript error:", e);
        return null;
    }
}
