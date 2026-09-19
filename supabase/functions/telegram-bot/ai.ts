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

export async function parseIntent(text: string, summaryContext?: any) {
    const prompt = `Siz "Hisobla" botining aqlli AI moliyaviy yordamchisiz.
Foydalanuvchi yozgan har qanday matnni chuqur tahlil qiling va tegishli harakatni anilashing.

Matn: "${text}"
Foydalanuvchi joriy balansi: ${summaryContext ? `${summaryContext.balance} so'm (Daromad: ${summaryContext.totalIncome}, Xarajat: ${summaryContext.totalExpense})` : "Noma'lum"}

Ixtiyoriy matn uchun JSON qaytaring:
1. Xarajat kiritilsa (masalan: "taksi 15000", "tushlikka 25 ming ketdi", "do'kondan 100 mingga narsa oldim"):
{
  "intent": "expense",
  "amount": 15000,
  "description": "taksi"
}

2. Daromad kiritilsa (masalan: "oylik tushdi 3 mln", "500$ berishdi", "freelancedan 200$ oldim"):
{
  "intent": "income",
  "amount": 3000000,
  "description": "oylik"
}

3. Qarz berilsa (masalan: "Ali ga 500000 qarz berdim", "Sardor 100 ming oldi"):
{
  "intent": "debt_gave",
  "person": "Ali",
  "amount": 500000,
  "due_date": "YYYY-MM-DD yoki null"
}

4. Qarz olinsa (masalan: "Validan 200 ming qarz oldim"):
{
  "intent": "debt_received",
  "person": "Vali",
  "amount": 200000,
  "due_date": "YYYY-MM-DD yoki null"
}

5. Hisobot yoki balans so'ralsa:
{
  "intent": "report"
}

6. Qarzlar ro'yxati so'ralsa:
{
  "intent": "debts_list"
}

7. Oddiy muloqot, savol, maslahat yoki tushunarsiz ibora bo'lsa (AI xuddi samimiy moliyaviy maslahatchi kabi o'zbek tilida javob berishi kerak):
{
  "intent": "ai_reply",
  "reply": "Samimiy, do'stona va foydali AI javobi matni..."
}

Faqat valid JSON qaytaring. Izoh yozmang.`;

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
                temperature: 0.3,
                max_tokens: 300,
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

    return {
        intent: "ai_reply",
        reply: "🤖 Qiziq fikr! Men sizga xarajat va daromadlarni yozib borishda, qarzlaringizni nazorat qilishda va balansingizni hisoblashda yordam bera olaman."
    };
}
