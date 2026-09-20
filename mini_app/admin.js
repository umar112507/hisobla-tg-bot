// ─── Config ───────────────────────────────────────────────────
const API_BASE = "https://dyqmawwyooeqadibnpqc.supabase.co/functions/v1/telegram-bot";
const tg = window.Telegram?.WebApp;
let ADMIN_SECRET = localStorage.getItem("admin_secret") || "";

// Check URL params for secret or user_id
const params = new URLSearchParams(window.location.search);
if (params.get("secret")) {
    ADMIN_SECRET = params.get("secret");
    localStorage.setItem("admin_secret", ADMIN_SECRET);
}
const TG_USER_ID = tg?.initDataUnsafe?.user?.id || params.get("user_id") || "";

let allUsers = [];
let allCoupons = [];

document.addEventListener("DOMContentLoaded", async () => {
    setupTabs();
    setupAuthListeners();

    if (ADMIN_SECRET) {
        const ok = await verifyAndLoad(ADMIN_SECRET);
        if (!ok) {
            showAuthOverlay();
        }
    } else {
        showAuthOverlay();
    }

    document.getElementById("userSearch").addEventListener("input", (e) => {
        filterUsers(e.target.value);
    });

    // Set default expiry to 30 days from now
    const expDate = new Date();
    expDate.setDate(expDate.getDate() + 30);
    const expiryEl = document.getElementById("couponExpiry");
    if (expiryEl) expiryEl.value = expDate.toISOString().split("T")[0];
});

function setupAuthListeners() {
    const input = document.getElementById("secretInput");
    if (input) {
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") authenticateAdmin();
        });
    }
}

function showAuthOverlay() {
    document.getElementById("authOverlay")?.classList.remove("hidden");
}

function hideAuthOverlay() {
    document.getElementById("authOverlay")?.classList.add("hidden");
}

async function authenticateAdmin() {
    const secret = document.getElementById("secretInput").value.trim();
    const errEl = document.getElementById("authError");
    errEl.textContent = "";

    if (!secret) {
        errEl.textContent = "❌ Maxfiy parolni kiriting!";
        return;
    }

    const ok = await verifyAndLoad(secret);
    if (ok) {
        ADMIN_SECRET = secret;
        localStorage.setItem("admin_secret", secret);
        hideAuthOverlay();
    } else {
        errEl.textContent = "❌ Noto'g'ri maxfiy parol yoki ruxsat yo'q!";
    }
}

function logoutAdmin() {
    localStorage.removeItem("admin_secret");
    ADMIN_SECRET = "";
    showAuthOverlay();
}

async function verifyAndLoad(secret) {
    try {
        let url = `${API_BASE}/api/admin/stats?secret=${encodeURIComponent(secret)}`;
        if (TG_USER_ID) url += `&user_id=${TG_USER_ID}`;

        const res = await fetch(url);
        if (!res.ok) return false;

        const data = await res.json();
        document.getElementById("statUsers").textContent = data.total_users || 0;
        document.getElementById("statPremium").textContent = data.premium_users || 0;
        document.getElementById("statTransactions").textContent = data.total_transactions || 0;
        document.getElementById("statCoupons").textContent = data.active_coupons || 0;

        hideAuthOverlay();
        loadUsers();
        loadCoupons();
        return true;
    } catch (e) {
        console.error("Auth verify failed:", e);
        return false;
    }
}

// ─── Tabs ─────────────────────────────────────────────────────
function setupTabs() {
    document.querySelectorAll(".admin-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".admin-tab-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".admin-tab-content").forEach(c => c.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
        });
    });
}

// ─── Load Dashboard Stats ─────────────────────────────────────
async function loadStats() {
    if (!ADMIN_SECRET) return;
    try {
        let url = `${API_BASE}/api/admin/stats?secret=${encodeURIComponent(ADMIN_SECRET)}`;
        if (TG_USER_ID) url += `&user_id=${TG_USER_ID}`;
        const res = await fetch(url);
        const data = await res.json();
        document.getElementById("statUsers").textContent = data.total_users || 0;
        document.getElementById("statPremium").textContent = data.premium_users || 0;
        document.getElementById("statTransactions").textContent = data.total_transactions || 0;
        document.getElementById("statCoupons").textContent = data.active_coupons || 0;
    } catch (e) {
        console.error("Stats load error:", e);
    }
}

// ─── Load Users ───────────────────────────────────────────────
async function loadUsers() {
    if (!ADMIN_SECRET) return;
    try {
        let url = `${API_BASE}/api/admin/users?secret=${encodeURIComponent(ADMIN_SECRET)}`;
        if (TG_USER_ID) url += `&user_id=${TG_USER_ID}`;
        const res = await fetch(url);
        allUsers = await res.json();
        renderUsers(allUsers);
    } catch (e) {
        console.error("Users load error:", e);
        document.getElementById("usersTableBody").innerHTML = `<tr><td colspan="7" class="loading-cell">❌ Xatolik</td></tr>`;
    }
}

function filterUsers(query) {
    const q = query.toLowerCase();
    const filtered = allUsers.filter(u =>
        String(u.user_id).includes(q) ||
        (u.first_name || "").toLowerCase().includes(q) ||
        (u.last_name || "").toLowerCase().includes(q) ||
        (u.username || "").toLowerCase().includes(q)
    );
    renderUsers(filtered);
}

function renderUsers(users) {
    const tbody = document.getElementById("usersTableBody");
    if (!users.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="loading-cell">Foydalanuvchilar topilmadi</td></tr>`;
        return;
    }
    tbody.innerHTML = users.map(u => {
        const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || "—";
        const statusBadge = u.is_premium
            ? `<span class="badge premium">👑 Premium</span>`
            : `<span class="badge free">Bepul</span>`;
        const usage = `${u.usage_count || 0}/10`;
        const date = u.created_at ? new Date(u.created_at).toLocaleDateString("uz-UZ") : "—";
        const toggleBtn = u.is_premium
            ? `<button class="action-btn danger-btn" onclick="togglePremium(${u.user_id}, false)">🚫 Bekor</button>`
            : `<button class="action-btn premium-btn" onclick="togglePremium(${u.user_id}, true)">👑 Premium</button>`;

        return `<tr>
            <td>${u.user_id}</td>
            <td>${escHtml(name)}</td>
            <td>${u.username ? `@${escHtml(u.username)}` : "—"}</td>
            <td>${statusBadge}</td>
            <td>${usage}</td>
            <td>${date}</td>
            <td>${toggleBtn}<button class="action-btn" onclick="resetUsage(${u.user_id})">🔄</button></td>
        </tr>`;
    }).join("");
}

// ─── Toggle Premium ───────────────────────────────────────────
async function togglePremium(userId, enable) {
    const action = enable ? "Premium berish" : "Premiumni bekor qilish";
    if (!confirm(`${action}: User #${userId}?`)) return;

    try {
        const res = await fetch(`${API_BASE}/api/admin/toggle-premium`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ secret: ADMIN_SECRET, user_id: userId, is_premium: enable }),
        });
        if (res.ok) {
            showToast(enable ? "👑 Premium berildi!" : "🚫 Premium bekor qilindi");
            loadUsers();
            loadStats();
        } else {
            showToast("❌ Xatolik yuz berdi");
        }
    } catch (e) {
        showToast("❌ Xatolik yuz berdi");
    }
}

// ─── Reset Usage Counter ──────────────────────────────────────
async function resetUsage(userId) {
    if (!confirm(`User #${userId} xabar limitini yangilashni xohlaysizmi?`)) return;

    try {
        const res = await fetch(`${API_BASE}/api/admin/reset-usage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ secret: ADMIN_SECRET, user_id: userId }),
        });
        if (res.ok) {
            showToast("🔄 Xabar limiti yangilandi!");
            loadUsers();
        } else {
            showToast("❌ Xatolik yuz berdi");
        }
    } catch (e) {
        showToast("❌ Xatolik yuz berdi");
    }
}

// ─── Load Coupons ─────────────────────────────────────────────
async function loadCoupons() {
    if (!ADMIN_SECRET) return;
    try {
        let url = `${API_BASE}/api/admin/coupons?secret=${encodeURIComponent(ADMIN_SECRET)}`;
        if (TG_USER_ID) url += `&user_id=${TG_USER_ID}`;
        const res = await fetch(url);
        allCoupons = await res.json();
        renderCoupons(allCoupons);
    } catch (e) {
        console.error("Coupons load error:", e);
    }
}

function renderCoupons(coupons) {
    const tbody = document.getElementById("couponsTableBody");
    if (!coupons.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="loading-cell">Kuponlar yo'q. Yuqorida yarating!</td></tr>`;
        return;
    }

    const planNames = {
        "1_month": "1 Oy",
        "3_months": "3 Oy",
        "6_months": "6 Oy",
        "1_year": "1 Yil",
        "lifetime": "Umrbod",
    };

    tbody.innerHTML = coupons.map(c => {
        const now = new Date();
        const expiry = c.expires_at ? new Date(c.expires_at) : null;
        const isExpired = expiry && expiry < now;
        const isFull = c.used_count >= c.max_uses;
        const isActive = c.is_active && !isExpired && !isFull;

        let statusBadge;
        if (!c.is_active) statusBadge = `<span class="badge inactive-badge">O'chirilgan</span>`;
        else if (isExpired) statusBadge = `<span class="badge expired">Muddati tugagan</span>`;
        else if (isFull) statusBadge = `<span class="badge expired">Limiti tugagan</span>`;
        else statusBadge = `<span class="badge active-badge">Faol</span>`;

        const expiryText = expiry ? expiry.toLocaleDateString("uz-UZ") : "—";
        const plan = planNames[c.plan] || c.plan;

        const toggleBtn = c.is_active
            ? `<button class="action-btn danger-btn" onclick="toggleCoupon('${c.id}', false)">🚫</button>`
            : `<button class="action-btn" onclick="toggleCoupon('${c.id}', true)">✅</button>`;

        return `<tr>
            <td><code style="background:rgba(255,152,0,0.15);padding:2px 8px;border-radius:6px;color:#ffb300;font-weight:700;letter-spacing:1px;">${escHtml(c.code)}</code></td>
            <td>${plan}</td>
            <td>${c.used_count}</td>
            <td>${c.max_uses}</td>
            <td>${expiryText}</td>
            <td>${statusBadge}</td>
            <td>${toggleBtn}<button class="action-btn danger-btn" onclick="deleteCoupon('${c.id}')">🗑️</button></td>
        </tr>`;
    }).join("");
}

// ─── Create Coupon ────────────────────────────────────────────
async function createCoupon() {
    const code = document.getElementById("couponCode").value.trim().toUpperCase();
    const plan = document.getElementById("couponPlan").value;
    const maxUses = parseInt(document.getElementById("couponLimit").value) || 1;
    const expiresAt = document.getElementById("couponExpiry").value || null;

    if (!code) {
        showToast("❌ Kupon kodini kiriting!");
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/admin/coupons/create`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ secret: ADMIN_SECRET, code, plan, max_uses: maxUses, expires_at: expiresAt }),
        });

        if (res.ok) {
            showToast(`🎟️ Kupon "${code}" yaratildi!`);
            document.getElementById("couponCode").value = "";
            loadCoupons();
            loadStats();
        } else {
            const err = await res.json();
            showToast(`❌ ${err.error || "Xatolik yuz berdi"}`);
        }
    } catch (e) {
        showToast("❌ Xatolik yuz berdi");
    }
}

// ─── Toggle / Delete Coupon ───────────────────────────────────
async function toggleCoupon(id, enable) {
    try {
        const res = await fetch(`${API_BASE}/api/admin/coupons/toggle`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ secret: ADMIN_SECRET, coupon_id: id, is_active: enable }),
        });
        if (res.ok) {
            showToast(enable ? "✅ Kupon faollashtirildi" : "🚫 Kupon o'chirildi");
            loadCoupons();
        }
    } catch (e) {
        showToast("❌ Xatolik");
    }
}

async function deleteCoupon(id) {
    if (!confirm("Kuponni butunlay o'chirmoqchimisiz?")) return;
    try {
        const res = await fetch(`${API_BASE}/api/admin/coupons/delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ secret: ADMIN_SECRET, coupon_id: id }),
        });
        if (res.ok) {
            showToast("🗑️ Kupon o'chirildi");
            loadCoupons();
            loadStats();
        }
    } catch (e) {
        showToast("❌ Xatolik");
    }
}

// ─── Generate Random Code ─────────────────────────────────────
function generateRandomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "HSB-";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    document.getElementById("couponCode").value = code;
}

// ─── Helpers ──────────────────────────────────────────────────
function showToast(msg) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
}

function escHtml(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
