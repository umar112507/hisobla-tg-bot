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

ESLATMA: O'zbek tilidagi barcha imlo xatolar, dialekt va jargon so'zlarni e'tiborga oling:
- "tushli", "abed", "abet", "obed", "kafe", "osh" -> Ovqat
- "yolkira", "yo'l haqqi", "taksi", "benzin", "metan", "avto" -> Transport
- "oyli", "oylik", "zarplata", "avans" -> Maosh

Faqat mos kategoriya nomini qaytaring. JSON formatda: {"category": "Kategoriya"}`;

    try {
        if (GROQ_API_KEY) {
            const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${GROQ_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: "llama-3.3-70b-versatile",
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

    // Fallback keyword categorizer with typo/slang tolerance
    const descLower = description.toLowerCase();
    if (/oylik|oyli|maosh|zarplata|avans|ishhaqi|ish\s*xaqi|stipendiya/i.test(descLower)) return "Maosh";
    if (/biznes|foyda|sotuv/i.test(descLower)) return "Biznes";
    if (/taksi|taxi|yolkira|yo'l\s*kira|yol\s*haqqi|yo'l\s*haqqi|avto|benzin|metan|propan|yo'l|bus|marshrutka/i.test(descLower)) return "Transport";
    if (/ovqat|tushlik|tushli|abed|abet|obed|non|go'sht|osh|kafe|restoran|do'kon|bozor|somsa/i.test(descLower)) return "Ovqat";
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
Matnni (yoki ovozdan o'girilgan matnni) chuqur tahlil qiling va qarz, xarajat yoki daromad ekanligini ajrating.

IMLO XATOLARI VA SHEVA SHAKLLARI (IMPORTANT):
1. Sonlar va birliklar:
   - "min", "ming", "k", "m" -> 1 000 (masalan: "10 min", "10 ming", "10k" -> 10000)
   - "mln", "million", "milon", "lem" -> 1 000 000 (masalan: "2 mln", "2 million" -> 2000000)
2. Daromad va Oylik shakllari:
   - "oyli", "oylik", "oylih", "maosh", "zarplata", "zarplat", "avans", "stipendiya" -> Daromad
3. Xarajat va Tushlik/Transport shakllari:
   - "tushli", "tushlik", "abed", "abet", "obed", "ovqat", "somsa", "osh" -> Xarajat (tushlik/ovqat)
   - "yolkira", "yo'l kira", "yol haqqi", "yo'l haqqi", "taksi", "taxi", "benzin" -> Xarajat (taksi/transport)
4. Qarz harakatlari:
   - "qarz berdim", "berdim", "berudim", "berib turdim", "oldiga berdim" -> intent: "debt_gave"
   - "qarz oldim", "oldim", "oluvdim", "olganim", "menga berdi" -> intent: "debt_received"

QARZ QOIDALARI:
- QARZ BERILDI ("debt_gave"): Men kimgadir qarz bergan bo'lsam (masalan: "Ali ga 500 min qarz berdim", "Sardor 100k oldi", "Javohirga 200 min berildi") -> intent: "debt_gave"
- QARZ OLINDI ("debt_received"): Men kimdandir qarz olgan bo'lsam (masalan: "Validan 200 min qarz oldim", "Sobir menga 500 min qarz berdi") -> intent: "debt_received"

MUDDAT (due_date):
- Agar muddat aytilgan bo'lsa (masalan: "10 kunga", "oy oxirigacha", "15-oktyabrgacha"), uni YYYY-MM-DD formatida hisoblab chiqaring.
- Aks holda null.

Matn: "${text}"

Faqat toza JSON qaytaring:
- Qarz berildi: {"intent": "debt_gave", "person": "Ali", "amount": 500000, "due_date": "YYYY-MM-DD yoki null"}
- Qarz olindi: {"intent": "debt_received", "person": "Vali", "amount": 200000, "due_date": "YYYY-MM-DD yoki null"}
- Daromad: {"intent": "income", "amount": 2000000, "description": "oylik"}
- Xarajat: {"intent": "expense", "amount": 10000, "description": "taksi"}
- Hisobot: {"intent": "report"}
- Qarzlar: {"intent": "debts_list"}
- Muloqot: {"intent": "ai_reply", "reply": "Matn..."}`;

    try {
        if (GROQ_API_KEY) {
            const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${GROQ_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: "llama-3.3-70b-versatile",
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
    const mlnMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:mln|million|milon|lem)/);
    if (mlnMatch) amount = parseFloat(mlnMatch[1]) * 1000000;

    if (!amount) {
        const mingMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:ming|min|k)/);
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
        if (/qarz ber|berdim|berudim|berildi|berib tur/i.test(lower)) {
            return { intent: "debt_gave", person, amount, due_date: dueDate };
        }

        // DEBT RECEIVED: qarz oldim, qarz berdi, oldim, olindi, oluvdim
        if (/qarz ol|oldim|oluvdim|olindi|menga berdi/i.test(lower)) {
            return { intent: "debt_received", person, amount, due_date: dueDate };
        }

        // INCOME
        if (/oylik|oyli|maosh|zarplata|avans|stipendiya|tushum|ishhaqi|ish\s*xaqi|daromad|bonus|freelance|tushdi/i.test(lower)) {
            const desc = text.replace(/(\d+[\d\s\.]*)\s*(?:ming|min|k|mln|million|so'm)?/gi, "").replace(/tushdi|oldim|keldi/gi, "").trim();
            return { intent: "income", amount, description: desc || "oylik" };
        }

        // EXPENSE
        if (/ishlatdim|ketdi|sarfladim|taksi|taxi|yolkira|yo'l\s*kira|yol\s*haqqi|ovqat|tushlik|tushli|abed|abet|obed|do'kon|bozor|xarajat|harajat|to'ladim/i.test(lower)) {
            let desc = text.replace(/(\d+[\d\s\.]*)\s*(?:ming|min|k|mln|million|so'm)?/gi, "").replace(/ishlatdim|ketdi|sarfladim|to'ladim/gi, "").trim();
            if (/abed|abet|obed|tushli|tushlik/i.test(lower)) desc = "tushlik";
            if (/yolkira|yo'l\s*kira|yol\s*haqqi|taksi|taxi/i.test(lower)) desc = "taksi";
            return { intent: "expense", amount, description: desc || "xarajat" };
        }

        return { intent: "expense", amount, description: text };
    }

    if (/hisobot|balans|statistika/i.test(lower)) return { intent: "report" };
    if (/qarzlar|qarzlarim/i.test(lower)) return { intent: "debts_list" };

    return {
        intent: "ai_reply",
        reply: "🤖 Tushundim! Masalan: <i>Ali ga 500 min qarz berdim 10 kunga</i> deb yozishingiz yoki ovoz yuborishingiz mumkin."
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
        formData.append("model", "whisper-large-v3-turbo");
        formData.append("language", "uz"); // Force target language to Uzbek
        formData.append("prompt", "O'zbekcha moliyaviy ovozli xabarlar va hisob-kitoblar: 10 ming, 5 min, 100k, oylik, oyli, tushlik, tushli, abed, abet, taksi, yolkira, yo'l haqqi, benzin, metan, so'm, sum, qarz berdim, qarz oldim, Ali, Vali.");

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
