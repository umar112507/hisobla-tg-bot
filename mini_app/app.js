// ─── Config ───────────────────────────────────────────────────
const API_BASE = "https://dyqmawwyooeqadibnpqc.supabase.co/functions/v1/telegram-bot";
const tg = window.Telegram?.WebApp;

let USER_ID = null;
let tgUser = null;

if (tg && tg.initDataUnsafe?.user) {
    tgUser = tg.initDataUnsafe.user;
    USER_ID = tgUser.id;
} else {
    const params = new URLSearchParams(window.location.search);
    USER_ID = params.get("user_id") || params.get("id");
}

// ─── Init Telegram WebApp ─────────────────────────────────────
if (tg) {
    tg.expand();
    try {
        tg.setHeaderColor("#0a0e1a");
        tg.setBackgroundColor("#0a0e1a");
    } catch (e) { }
}

let expenseChartInstance = null;
let incomeChartInstance = null;
let allTransactions = [];
let allDebts = [];
let currentFilter = "all";
let currentDebtFilter = "active";
let summaryData = null;

document.addEventListener("DOMContentLoaded", () => {
    renderUserProfile();
    if (!USER_ID) {
        showEmptyAll("Telegram ID topilmadi. Bot orqali oching.");
        return;
    }
    loadAll(false);
    setupTabs();
    setupFilters();
    setupPureEventSync();

    if (window.location.hash === "#tab-premium") {
        openPremiumTab();
    }
});

// ─── Pure Event-Driven Sync (Zero Polling Timers) ─────────────
function setupPureEventSync() {
    // Update data ONLY when user switches back to Mini App tab or window
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) loadAll(true);
    });
    window.addEventListener("focus", () => loadAll(true));

    if (tg) {
        tg.onEvent("viewportChanged", () => loadAll(true));
    }
}

// ─── Render Telegram Profile ──────────────────────────────────
function renderUserProfile() {
    const avatarEl = document.getElementById("userAvatar");
    const nameEl = document.getElementById("userName");
    const usernameEl = document.getElementById("userUsername");

    if (tgUser) {
        const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ");
        nameEl.textContent = fullName || "Foydalanuvchi";
        usernameEl.textContent = tgUser.username ? `@${tgUser.username}` : `ID: ${tgUser.id}`;

        if (tgUser.photo_url) {
            avatarEl.src = tgUser.photo_url;
        } else {
            avatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=448aff&color=fff`;
        }
    } else if (USER_ID) {
        nameEl.textContent = `Foydalanuvchi #${USER_ID}`;
        usernameEl.textContent = `@user${USER_ID}`;
        avatarEl.src = `https://ui-avatars.com/api/?name=User+${USER_ID}&background=448aff&color=fff`;
    } else {
        nameEl.textContent = "Mehmon";
        usernameEl.textContent = "ID aniqlanmadi";
    }
}

// ─── Data Loading (Supports Silent Refresh) ────────────────────
async function loadAll(isSilent = false) {
    await Promise.all([
        loadSummary(isSilent),
        loadTransactions(isSilent),
        loadDebts(isSilent)
    ]);
}

async function loadSummary(isSilent = false) {
    try {
        const res = await fetch(`${API_BASE}/api/summary?user_id=${USER_ID}`);
        const data = await res.json();
        summaryData = data;

        const balance = data.balance || 0;
        const el = document.getElementById("balanceAmount");
        el.textContent = formatAmount(balance);
        el.className = "balance-amount " + (balance >= 0 ? "positive" : "negative");

        document.getElementById("totalIncome").textContent = formatAmount(data.total_income || 0);
        document.getElementById("totalExpense").textContent = formatAmount(data.total_expense || 0);

        const bBtn = document.getElementById("headerBadgeBtn");
        if (bBtn) {
            if (data.is_premium) {
                bBtn.className = "header-badge-btn pro-active-badge";
                bBtn.innerHTML = `👑 <span>PRO Active</span>`;
                if (data.premium_expires_at) {
                    startLiveTicker(data.premium_expires_at);
                }
            } else {
                bBtn.className = "header-badge-btn pro-get-btn";
                const used = data.usage_count || 0;
                const total = data.weekly_limit || 10;
                const rem = Math.max(0, total - used);
                bBtn.innerHTML = `⚡ <span>${rem}/${total} · PRO</span>`;
            }
        }

        updateModalProfileData(data);
        renderCharts(data.categories || []);
        generateAIInsight(data.categories || [], data.total_expense || 0);
        updateBalanceDisplay();
    } catch (e) {
        if (!isSilent) console.error("Summary load failed:", e);
    }
}

async function loadTransactions(isSilent = false) {
    try {
        const res = await fetch(`${API_BASE}/api/transactions?user_id=${USER_ID}`);
        const newTx = await res.json();

        if (JSON.stringify(newTx) !== JSON.stringify(allTransactions) || !isSilent) {
            allTransactions = newTx;
            renderTransactions(allTransactions);
        }
    } catch (e) {
        if (!isSilent) {
            console.error("Transactions load error:", e);
            document.getElementById("transactionsList").innerHTML = emptyState("📭", "Tranzaksiyalar yuklanmadi");
        }
    }
}

async function loadDebts(isSilent = false) {
    try {
        const res = await fetch(`${API_BASE}/api/debts?user_id=${USER_ID}&include_paid=true`);
        const newDebts = await res.json();

        if (JSON.stringify(newDebts) !== JSON.stringify(allDebts) || !isSilent) {
            allDebts = newDebts;
            renderDebts(allDebts);
        }
    } catch (e) {
        if (!isSilent) {
            console.error("Debts load error:", e);
            document.getElementById("debtsList").innerHTML = emptyState("💳", "Qarzlar yuklanmadi");
        }
    }
}

// ─── Render Transactions ──────────────────────────────────────
function renderTransactions(transactions) {
    const filtered = currentFilter === "all"
        ? transactions
        : transactions.filter(t => t.type === currentFilter);

    const container = document.getElementById("transactionsList");
    if (!filtered || !filtered.length) {
        container.innerHTML = emptyState("📭", "Tranzaksiyalar yo'q");
        return;
    }

    container.innerHTML = filtered.map(t => {
        const isIncome = t.type === "income";

        const categoryEmojis = {
            "Ovqat": "🍔", "Transport": "🚗", "Maosh": "💼", "Kommunal": "💡",
            "Kiyim": "👕", "Sog'liq": "💊", "Ijara": "🏠", "Internet": "🌐",
            "O'yin-kulgi": "🎮", "Ta'lim": "📚", "Sayohat": "✈️", "Oziq-ovqat": "🛒",
            "Sovg'a": "🎁", "Boshqa": "📦", "Qarz to'lovi": "💵", "Qarz qaytishi": "💸"
        };
        const catName = t.category || "Boshqa";
        let fallbackEmoji = isIncome ? "💰" : "📉";
        // Check if catName matches directly, or find first matching substring
        let emoji = categoryEmojis[catName];
        if (!emoji) {
            for (const [k, v] of Object.entries(categoryEmojis)) {
                if (catName.toLowerCase().includes(k.toLowerCase())) {
                    emoji = v;
                    break;
                }
            }
        }
        if (!emoji) emoji = fallbackEmoji;

        const dateStr = formatDate(t.created_at);
        const sign = isIncome ? "+" : "-";
        return `
      <div class="tx-item">
        <div class="tx-icon-wrap ${t.type}">${emoji}</div>
        <div class="tx-info">
          <div class="tx-desc">${escHtml(t.description || "—")}</div>
          <div class="tx-meta">
            <span class="tx-cat">${escHtml(t.category)}</span>
            <span class="tx-date">${dateStr}</span>
          </div>
        </div>
        <div class="tx-right">
          <div class="tx-amount ${t.type}">${sign}${formatAmount(t.amount)}</div>
          <button class="tx-delete-btn" onclick="deleteTx('${t.id}')" title="O'chirish">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>`;
    }).join("");
}

// ─── Delete Transaction ───────────────────────────────────────
async function deleteTx(id) {
    if (!confirm("Ushbu tranzaksiyani o'chirmoqchimisiz?")) return;
    try {
        const res = await fetch(`${API_BASE}/api/transactions/delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, user_id: USER_ID }),
        });
        if (res.ok) {
            showToast("🗑️ Tranzaksiya o'chirildi");
            loadAll(false);
        } else {
            showToast("❌ O'chirishda xatolik yuz berdi");
        }
    } catch (e) {
        console.error("Delete failed:", e);
        showToast("❌ Xatolik yuz berdi");
    }
}

// ─── Render Debts ─────────────────────────────────────────────
function renderDebts(debts) {
    const container = document.getElementById("debtsList");
    const summaryRow = document.getElementById("debtSummary");

    const activeDebts = debts.filter(d => !d.is_paid);
    const gave = activeDebts.filter(d => d.direction === "gave");
    const received = activeDebts.filter(d => d.direction === "received");
    const totalGave = gave.reduce((s, d) => s + Number(d.amount), 0);
    const totalReceived = received.reduce((s, d) => s + Number(d.amount), 0);

    summaryRow.innerHTML = `
    <div class="debt-sum-card gave">
      <div class="debt-sum-label">📤 Berganlarim</div>
      <div class="debt-sum-amount gave">${formatAmount(totalGave)}</div>
    </div>
    <div class="debt-sum-card received">
      <div class="debt-sum-label">📥 Olganlarim</div>
      <div class="debt-sum-amount received">${formatAmount(totalReceived)}</div>
    </div>`;

    let filteredDebts = [];
    if (currentDebtFilter === "active") {
        filteredDebts = debts.filter(d => !d.is_paid);
    } else if (currentDebtFilter === "gave") {
        filteredDebts = debts.filter(d => !d.is_paid && d.direction === "gave");
    } else if (currentDebtFilter === "received") {
        filteredDebts = debts.filter(d => !d.is_paid && d.direction === "received");
    } else if (currentDebtFilter === "paid") {
        filteredDebts = debts.filter(d => d.is_paid);
    }

    if (!filteredDebts.length) {
        container.innerHTML = emptyState("💳", "Ushbu bo'limda qarzlar yo'q!");
        return;
    }

    container.innerHTML = filteredDebts.map(d => {
        let days = null;
        if (d.due_date && !d.is_paid) {
            const todayDate = new Date();
            todayDate.setHours(0, 0, 0, 0);
            const dueDate = new Date(d.due_date);
            dueDate.setHours(0, 0, 0, 0);

            const diffTime = dueDate.getTime() - todayDate.getTime();
            days = Math.round(diffTime / (1000 * 60 * 60 * 24));
        }

        let urgencyClass = d.is_paid ? "paid-item" : "ok";
        let deadlineText = d.is_paid ? "✅ Qaytarilgan / To'langan" : "📅 Muddat belgilanmagan";
        let deadlineClass = d.is_paid ? "paid" : "";

        if (!d.is_paid && days !== null) {
            if (days < 0) {
                urgencyClass = "overdue";
                deadlineClass = "overdue";
                deadlineText = `⚠️ Muddati ${Math.abs(days)} kun oldin o'tgan! (${formatDate(d.due_date)})`;
            } else if (days === 0) {
                urgencyClass = "overdue";
                deadlineClass = "overdue";
                deadlineText = `🔴 Bugun muddati! (${formatDate(d.due_date)})`;
            } else if (days <= 3) {
                urgencyClass = "due-soon";
                deadlineClass = "due-soon";
                deadlineText = `🟠 ${days} kun qoldi (${formatDate(d.due_date)})`;
            } else {
                deadlineText = `🟢 ${days} kun qoldi (${formatDate(d.due_date)})`;
            }
        }

        const dirText = d.direction === "gave" ? "📤 Berdim" : "📥 Oldim";
        const payBtnText = d.direction === "received" ? "✅ To'landi" : "✅ Qaytdi";

        return `
      <div class="debt-item ${urgencyClass}">
        <div class="debt-header">
          <div class="debt-person">👤 ${escHtml(d.person_name)}</div>
          <div class="debt-direction-badge ${d.direction}">${dirText}</div>
        </div>
        <div class="debt-amount ${d.direction}">${formatAmount(d.amount)}</div>
        ${d.description ? `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;">📝 ${escHtml(d.description)}</div>` : ""}
        <div class="debt-footer">
          <div class="debt-deadline ${deadlineClass}">${deadlineText}</div>
          ${!d.is_paid ? `<button class="debt-pay-btn" onclick="payDebt('${d.id}')">${payBtnText}</button>` : `<span class="debt-paid-badge">✅ To'langan</span>`}
        </div>
      </div>`;
    }).join("");
}

// ─── Pay / Settle Debt ────────────────────────────────────────
async function payDebt(debtId) {
    if (!confirm("Ushbu qarzni qaytarilgan deb belgilamoqchimisiz? (Balansingiz mos ravishda yangilanadi)")) return;

    try {
        const res = await fetch(`${API_BASE}/api/debts/pay`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ debt_id: debtId, user_id: USER_ID }),
        });

        if (res.ok) {
            showToast("🎉 Qarz to'langan deb belgilandi va balans yangilandi!");
            loadAll(false);
        } else {
            showToast("❌ Xatolik yuz berdi");
        }
    } catch (e) {
        console.error("Pay debt error:", e);
        showToast("❌ Xatolik yuz berdi");
    }
}

// ─── Render Charts ────────────────────────────────────────────
function renderCharts(categories) {
    if (!categories) return;
    const expenseCats = categories.filter(c => c.type === "expense");
    const incomeCats = categories.filter(c => c.type === "income");

    const palette = [
        "#448aff", "#00e676", "#ff9800", "#ce93d8", "#ff5252",
        "#26c6da", "#ffee58", "#ef5350", "#ab47bc", "#66bb6a"
    ];

    renderPieChart("expenseChart", expenseCats, palette, "expenseChartInstance");
    renderPieChart("incomeChart", incomeCats, palette, "incomeChartInstance");
}

function renderPieChart(canvasId, data, palette, instanceVar) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (window[instanceVar]) {
        window[instanceVar].destroy();
    }

    if (!data || !data.length) {
        canvas.parentElement.innerHTML = emptyState("📊", "Ma'lumot yo'q");
        return;
    }

    const labels = data.map(d => d.category);
    const values = data.map(d => Number(d.total)); // Ensure values are numbers
    const totalSum = values.reduce((a, b) => a + b, 0);
    const colors = palette.slice(0, data.length);

    // Explicitly update the center label DOM elements
    const centerEl = document.getElementById(canvasId + "Center");
    if (centerEl) {
        const title = canvasId === "expenseChart" ? "Jami xarajat" : "Jami daromad";
        centerEl.innerHTML = `<span>${title}</span>${formatAmount(totalSum).replace(' so\'m', '')}`;
    }

    // Render legend table
    const legendEl = document.getElementById(canvasId.replace('Chart', 'Legend'));
    if (legendEl) {
        legendEl.innerHTML = data.map((d, i) => {
            const pct = Math.round((Number(d.total) / totalSum) * 100);
            return `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;font-size:12px;">
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="width:10px;height:10px;border-radius:50%;background:${colors[i]}"></span>
                <span style="color:var(--text-secondary)">${escHtml(d.category)}</span>
              </div>
              <div style="font-weight:600;">${pct}%</div>
            </div>`;
        }).join('');
    }

    window[instanceVar] = new Chart(canvas, {
        type: "doughnut",
        data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: "rgba(255,255,255,0.1)", borderWidth: 2, hoverOffset: 8 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: "bottom",
                    labels: { color: "rgba(255,255,255,0.7)", font: { size: 11, family: "Inter" }, padding: 14, boxWidth: 12, boxHeight: 12 }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.label}: ${formatAmount(ctx.raw)}`
                    }
                }
            },
            cutout: "75%", // Increased cutout to make room for center text
        }
    });
}

// ─── AI Insights ──────────────────────────────────────────────
function generateAIInsight(categories, totalExpense) {
    const aiBox = document.getElementById("aiInsight");
    const aiText = document.getElementById("aiInsightText");
    if (!aiBox || !aiText) return;

    const expenseCats = categories.filter(c => c.type === "expense");
    if (expenseCats.length === 0 || totalExpense <= 0) {
        aiBox.style.display = "none";
        return;
    }

    // Sort by highest expense
    expenseCats.sort((a, b) => b.total - a.total);
    const topCat = expenseCats[0];
    const topPct = Math.round((topCat.total / totalExpense) * 100);

    let message = `💡 Ushbu oyda xarajatlaringizning eng katta qismi <b>${escHtml(topCat.category)}</b> (${topPct}%) hissasiga to'g'ri kelmoqda.`;

    if (topPct > 50) {
        message += " Bunday katta ulush e'tiboringizni talab qilishi mumkin. Boshqa xarajatlarni ham muvozanatda saqlang!";
    } else {
        message += " Xarajatlaringiz nisbatan yaxshi taqsimlangan.";
    }

    aiText.innerHTML = message;
    aiBox.style.display = "block";
}

// ─── Tabs & Filters & Toggles ─────────────────────────────────
function setupTabs() {
    document.querySelectorAll(".bottom-nav-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".bottom-nav-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");

            if (btn.dataset.tab === "statistics" && summaryData) {
                setTimeout(() => renderCharts(summaryData.categories || []), 50);
            }
        });
    });
}

function toggleBalance() {
    const isHidden = localStorage.getItem("hideBalance") === "true";
    const newHidden = !isHidden;
    localStorage.setItem("hideBalance", newHidden.toString());
    updateBalanceDisplay();
}

function updateBalanceDisplay() {
    const isHidden = localStorage.getItem("hideBalance") === "true";
    const amountEl = document.getElementById("balanceAmount");
    const openEye = document.getElementById("eyeIconOpen");
    const closedEye = document.getElementById("eyeIconClosed");

    if (!amountEl) return;

    if (summaryData) {
        amountEl.textContent = formatAmount(summaryData.balance || 0);
        amountEl.className = "balance-amount " + ((summaryData.balance || 0) >= 0 ? "positive" : "negative");
    }

    if (isHidden) {
        amountEl.textContent = "••••••";
        if (openEye) openEye.classList.add("hidden");
        if (closedEye) closedEye.classList.remove("hidden");
    } else {
        if (openEye) openEye.classList.remove("hidden");
        if (closedEye) closedEye.classList.add("hidden");
    }
}

function setupFilters() {
    document.querySelectorAll(".filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            if (btn.dataset.filter) {
                document.querySelectorAll(".filter-btn[data-filter]").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                currentFilter = btn.dataset.filter;
                renderTransactions(allTransactions);
            }
            if (btn.dataset.debtFilter) {
                document.querySelectorAll(".debt-filter-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                currentDebtFilter = btn.dataset.debtFilter;
                renderDebts(allDebts);
            }
        });
    });
}

// ─── Toast Notification ───────────────────────────────────────
function showToast(msg) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
}

// ─── Helpers ──────────────────────────────────────────────────
function formatAmount(n) {
    return `${Number(n || 0).toLocaleString("uz-UZ")} so'm`;
}

function formatDate(isoStr) {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    return d.toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function escHtml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function emptyState(iconSvg, text) {
    const defaultSvg = `<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>`;
    return `<div class="empty-state"><div class="empty-state-icon">${iconSvg || defaultSvg}</div><div class="empty-state-text">${text}</div></div>`;
}

function showEmptyAll(msg) {
    const warningSvg = `<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent-red)"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    document.getElementById("transactionsList").innerHTML = emptyState(warningSvg, msg);
    document.getElementById("debtsList").innerHTML = emptyState(warningSvg, msg);
}

let liveTickerTimer = null;

function startLiveTicker(expiryIsoStr) {
    if (liveTickerTimer) clearInterval(liveTickerTimer);

    const updateTicker = () => {
        const bBtn = document.getElementById("headerBadgeBtn");
        const diffMs = new Date(expiryIsoStr) - new Date();
        const diffSec = Math.ceil(diffMs / 1000);

        if (diffSec <= 0) {
            if (bBtn) bBtn.innerHTML = `👑 <span>PRO Tugagan</span>`;
            clearInterval(liveTickerTimer);
            liveTickerTimer = null;
            loadSummary(true);
            return;
        }

        if (bBtn) {
            if (diffSec <= 60) {
                bBtn.innerHTML = `👑 <span>PRO · ${diffSec}s</span>`;
            } else {
                const diffDays = Math.ceil(diffSec / 86400);
                bBtn.innerHTML = `👑 <span>PRO · ${diffDays}d</span>`;
            }
        }
    };

    updateTicker();
    liveTickerTimer = setInterval(updateTicker, 1000);
}

// ─── Premium Actions ──────────────────────────────────────────
async function buyPremium(planId) {
    if (planId === "test_10s") {
        if (!USER_ID) {
            showToast("❌ Telegram ID topilmadi");
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/api/premium/test-buy`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: USER_ID, seconds: 10 }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                showToast("⚡ 10 sekundlik SINOV TARIFI faollashtirildi! ⏱️");
                loadSummary(false);
            } else {
                showToast(`❌ ${data.error || "Xatolik yuz berdi"}`);
            }
        } catch (e) {
            console.error("Test buy error:", e);
            showToast("❌ Xatolik yuz berdi");
        }
        return;
    }

    showToast("💳 To'lov xizmati (inpay.uz) tez orada ulanadi! 🔥");
}

async function activateCoupon() {
    const input = document.getElementById("userCouponCode");
    const code = input ? input.value.trim().toUpperCase() : "";

    if (!code) {
        showToast("❌ Kupon kodini kiriting!");
        return;
    }
    if (!USER_ID) {
        showToast("❌ Telegram ID topilmadi");
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/coupon/activate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, user_id: USER_ID }),
        });
        const data = await res.json();

        if (res.ok && data.success) {
            if (data.discount === 100) {
                showToast("🎉 Premium muvaffaqiyatli faollashtirildi! 👑");
                loadSummary(false);
            } else {
                showToast(`🎉 ${data.discount}% Chegirma muvaffaqiyatli qo'llanildi! To'lov bo'limi tez orada ulanadi.`);
            }
            if (input) input.value = "";
        } else {
            showToast(`❌ ${data.error || "Kupon nofaol yoki noto'g'ri"}`);
        }
    } catch (e) {
        console.error("Coupon activate error:", e);
        showToast("❌ Xatolik yuz berdi");
    }
}

function openPremiumTab() {
    openPremiumModal();
}

// ─── Profile & Premium Modals ─────────────────────────────────
function openProfileModal() {
    const modal = document.getElementById("profileModal");
    if (modal) modal.classList.remove("hidden");
}

function closeProfileModal(e) {
    if (e && e.target && e.target.id !== "profileModal" && !e.target.classList.contains("modal-close-btn")) return;
    const modal = document.getElementById("profileModal");
    if (modal) modal.classList.add("hidden");
}

function openPremiumModal() {
    const modal = document.getElementById("premiumModal");
    if (modal) modal.classList.remove("hidden");
}

function closePremiumModal(e) {
    if (e && e.target && e.target.id !== "premiumModal" && !e.target.classList.contains("modal-close-btn")) return;
    const modal = document.getElementById("premiumModal");
    if (modal) modal.classList.add("hidden");
}

function updateModalProfileData(data) {
    if (window.Telegram?.WebApp?.initDataUnsafe?.user) {
        const u = window.Telegram.WebApp.initDataUnsafe.user;
        const name = [u.first_name, u.last_name].filter(Boolean).join(" ");
        const nameEl = document.getElementById("modalUserName");
        const userEl = document.getElementById("modalUserUsername");
        const idEl = document.getElementById("modalUserId");
        const avatarEl = document.getElementById("modalUserAvatar");

        if (nameEl) nameEl.textContent = name || "User";
        if (userEl) userEl.textContent = u.username ? `@${u.username}` : "";
        if (idEl) idEl.textContent = `ID: ${u.id}`;
        if (avatarEl && u.photo_url) avatarEl.src = u.photo_url;
    }

    const badge = document.getElementById("modalStatusBadge");
    if (badge) {
        if (data.is_premium) {
            badge.textContent = "PRO FAOL";
            badge.className = "profile-status-badge pro";
        } else {
            badge.textContent = "BEPUL";
            badge.className = "profile-status-badge free";
        }
    }

    // Usage Progress
    const used = data.usage_count || 0;
    const total = data.weekly_limit || 10;
    const pct = Math.min(100, Math.round((used / total) * 100));

    const countTxt = document.getElementById("modalUsageCountText");
    const fillEl = document.getElementById("modalUsageBarFill");
    if (countTxt) countTxt.textContent = data.is_premium ? "Cheksiz (PRO ✨)" : `${used} / ${total} ta`;
    if (fillEl) fillEl.style.width = data.is_premium ? "100%" : `${pct}%`;

    // Render Premium History Timeline
    const historyList = document.getElementById("modalPremiumHistoryList");
    if (historyList) {
        const history = data.premium_history || [];
        if (history.length === 0) {
            historyList.innerHTML = `<div class="empty-state"><div class="empty-state-text">Hali xaridlar mavjud emas</div></div>`;
        } else {
            let html = "";
            history.forEach(item => {
                const isAct = new Date(item.expires_at) > new Date();
                const planName = item.plan === "10_seconds_test" ? "⚡ 10 Sekundlik Sinov" : item.plan;
                const dt = new Date(item.created_at || Date.now()).toLocaleDateString("uz-UZ");
                const expDt = new Date(item.expires_at).toLocaleDateString("uz-UZ");

                html += `
                    <div class="history-item">
                        <div class="history-item-left">
                            <div class="history-item-plan">${planName}</div>
                            <div class="history-item-date">Olingan: ${dt} · Tugashi: ${expDt}</div>
                        </div>
                        <div class="history-item-badge ${isAct ? 'active' : 'expired'}">
                            ${isAct ? 'Faol' : 'Tugagan'}
                        </div>
                    </div>
                `;
            });
            historyList.innerHTML = html;
        }
    }
}

// ─── Web Speech API & Groq Voice Input ─────────────────────────
let recognition = null;
let isRecordingVoice = false;

function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'uz-UZ';

    rec.onstart = () => {
        isRecordingVoice = true;
        const fab = document.getElementById("voiceFabBtn");
        const overlay = document.getElementById("voiceOverlay");
        const status = document.getElementById("voiceOverlayStatus");
        const transcript = document.getElementById("voiceOverlayTranscript");

        if (fab) fab.classList.add("recording");
        if (overlay) overlay.classList.remove("hidden");
        if (status) status.textContent = "🎙️ Eshitilmoqda...";
        if (transcript) transcript.textContent = "O'zbek tilida gapiring...";
    };

    rec.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        const transcriptEl = document.getElementById("voiceOverlayTranscript");
        if (transcriptEl) {
            transcriptEl.textContent = finalTranscript || interimTranscript || "Eshitilmoqda...";
        }

        if (finalTranscript.trim()) {
            stopVoiceInput();
            sendTextIntentToGroq(finalTranscript.trim());
        }
    };

    rec.onerror = (event) => {
        console.warn("Speech recognition error:", event.error);
        stopVoiceInput();
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
            alert("Ovozli kiritishda xatolik yuz berdi: " + event.error);
        }
    };

    rec.onend = () => {
        isRecordingVoice = false;
        const fab = document.getElementById("voiceFabBtn");
        const overlay = document.getElementById("voiceOverlay");
        if (fab) fab.classList.remove("recording");
        if (overlay) overlay.classList.add("hidden");
    };

    return rec;
}

function toggleVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("Brauzeringizda Web Speech API qo'llab-quvvatlanmaydi. Iltimos, Chrome yoki Telegram ichki brauzeridan foydalaning.");
        return;
    }

    if (isRecordingVoice && recognition) {
        stopVoiceInput();
        return;
    }

    if (!recognition) {
        recognition = initSpeechRecognition();
    }

    if (recognition) {
        try {
            recognition.start();
        } catch (e) {
            console.error("Start recognition error:", e);
        }
    }
}

function stopVoiceInput(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    if (recognition && isRecordingVoice) {
        try {
            recognition.stop();
        } catch (err) { }
    }
    isRecordingVoice = false;
    const fab = document.getElementById("voiceFabBtn");
    const overlay = document.getElementById("voiceOverlay");
    if (fab) fab.classList.remove("recording");
    if (overlay) overlay.classList.add("hidden");
}

async function sendTextIntentToGroq(text) {
    try {
        const overlay = document.getElementById("voiceOverlay");
        const status = document.getElementById("voiceOverlayStatus");
        const transcriptEl = document.getElementById("voiceOverlayTranscript");

        if (overlay) overlay.classList.remove("hidden");
        if (status) status.textContent = "⚡ Groq AI tahlil qilmoqda...";
        if (transcriptEl) transcriptEl.innerHTML = `<i>"${escHtml(text)}"</i>`;

        const res = await fetch(`${API_BASE}/api/intent`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, user_id: USER_ID })
        });

        const data = await res.json();
        if (overlay) overlay.classList.add("hidden");

        if (data.success) {
            alert(data.message || "✅ Muvaffaqiyatli saqlandi!");
            loadAll();
        } else {
            alert("❌ " + (data.error || "Xatolik yuz berdi"));
        }
    } catch (err) {
        console.error("Send intent error:", err);
        const overlay = document.getElementById("voiceOverlay");
        if (overlay) overlay.classList.add("hidden");
        alert("❌ Ulanishda xatolik yuz berdi.");
    }
}
