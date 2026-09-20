// ─── Config ───────────────────────────────────────────────
const API_BASE = "https://dyqmawwyooeqadibnpqc.supabase.co/functions/v1/telegram-bot";
const tg = window.Telegram?.WebApp;
const params = new URLSearchParams(window.location.search);

let TG_USER_ID = "";
let TG_USER = null;
let ADMIN_SECRET = params.get("secret") || "hisobla_admin_2024";

// Get Telegram user ID from WebApp or URL param
if (tg?.initDataUnsafe?.user) {
    TG_USER = tg.initDataUnsafe.user;
    TG_USER_ID = String(TG_USER.id);
} else {
    TG_USER_ID = params.get("user_id") || params.get("id") || "";
}

// ─── State ────────────────────────────────────────────────
let allUsers = [];
let allCoupons = [];
let currentPage = "dashboard";
let userFilter = "all";

// ─── Init ─────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
    if (tg) { tg.expand(); try { tg.setHeaderColor("#080c14"); tg.setBackgroundColor("#080c14"); } catch (e) { } }

    await verifyAndBoot();
    setupNav();
    setupUserSearch();
    setupUserFilter();
    setupBroadcastCharCount();

    // Set default coupon expiry (30 days from now)
    const exp = new Date(); exp.setDate(exp.getDate() + 30);
    const expiryEl = document.getElementById("couponExpiry");
    if (expiryEl) expiryEl.value = exp.toISOString().split("T")[0];
});

// ─── Auth & Boot ──────────────────────────────────────────
async function verifyAndBoot() {
    try {
        const url = buildAdminUrl("/api/admin/stats");
        const res = await fetch(url);

        if (!res.ok) {
            showDenied();
            return;
        }
        const data = await res.json();
        hideLoading();
        setAdminChip();
        updateKPI(data);
        loadDashboard();
        loadUsers();
        loadCoupons();
    } catch (e) {
        console.error("Auth error:", e);
        showDenied();
    }
}

function buildAdminUrl(path) {
    let url = `${API_BASE}${path}?user_id=${TG_USER_ID}&secret=${encodeURIComponent(ADMIN_SECRET)}`;
    return url;
}

function showDenied() {
    document.getElementById("loadingScreen").classList.add("hidden");
    const overlay = document.getElementById("deniedOverlay");
    const text = document.getElementById("deniedText");
    overlay.classList.remove("hidden");
    if (text) {
        text.textContent = TG_USER_ID
            ? `Sizning Telegram ID (#${TG_USER_ID}) adminlar ro'yxatida topilmadi.`
            : "Ushbu sahifani Telegram bot orqali oching.";
    }
}

function hideLoading() {
    document.getElementById("loadingScreen").classList.add("hidden");
}

function setAdminChip() {
    const el = document.getElementById("adminChipName");
    if (!el) return;
    if (TG_USER) {
        el.textContent = TG_USER.first_name || "Admin";
    } else if (TG_USER_ID) {
        el.textContent = `Admin #${TG_USER_ID}`;
    }
}

// ─── Navigation ───────────────────────────────────────────
const PAGE_TITLES = {
    dashboard: "Dashboard",
    users: "Foydalanuvchilar",
    coupons: "Kuponlar",
    broadcast: "Broadcast"
};

function setupNav() {
    document.querySelectorAll(".nav-item").forEach(item => {
        item.addEventListener("click", (e) => {
            e.preventDefault();
            goToPage(item.dataset.page);
            // Close sidebar on mobile
            if (window.innerWidth <= 768) {
                document.getElementById("sidebar").classList.remove("open");
            }
        });
    });
}

function goToPage(page) {
    currentPage = page;
    document.querySelectorAll(".nav-item").forEach(i => i.classList.toggle("active", i.dataset.page === page));
    document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === `page-${page}`));
    document.getElementById("pageTitle").textContent = PAGE_TITLES[page] || page;
}

function toggleSidebar() {
    document.getElementById("sidebar").classList.toggle("open");
}

function refreshPage() {
    verifyAndBoot();
    toast("🔄 Yangilanmoqda...");
}

// ─── KPI Update ───────────────────────────────────────────
function updateKPI(data) {
    animateNum("kpiUsers", data.total_users || 0);
    animateNum("kpiPremium", data.premium_users || 0);
    animateNum("kpiTxns", data.total_transactions || 0);
    animateNum("kpiCoupons", data.active_coupons || 0);

    // Broadcast info cards
    const free = (data.total_users || 0) - (data.premium_users || 0);
    setEl("bcTotal", data.total_users || 0);
    setEl("bcPremium", data.premium_users || 0);
    setEl("bcFree", free > 0 ? free : 0);

    // Nav badge
    setEl("navBadgeUsers", data.total_users || 0);
}

function animateNum(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    let current = 0;
    const step = Math.max(1, Math.ceil(target / 30));
    const timer = setInterval(() => {
        current = Math.min(current + step, target);
        el.textContent = current.toLocaleString();
        if (current >= target) clearInterval(timer);
    }, 30);
}

function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

// ─── Dashboard: Recent Users ──────────────────────────────
async function loadDashboard() {
    // Recent users (already in allUsers, or load fresh)
    if (allUsers.length > 0) {
        renderRecentUsers(allUsers.slice(0, 5));
    } else {
        try {
            const res = await fetch(buildAdminUrl("/api/admin/users"));
            if (res.ok) {
                allUsers = await res.json();
                renderRecentUsers(allUsers.slice(0, 5));
            }
        } catch (e) { console.error(e); }
    }
}

function renderRecentUsers(users) {
    const el = document.getElementById("recentUsersList");
    if (!el) return;
    if (!users.length) { el.innerHTML = `<div class="empty-cell">Foydalanuvchilar yo'q</div>`; return; }

    el.innerHTML = users.map(u => {
        const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || "Noma'lum";
        const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
        const color = avatarColor(u.user_id);
        const badge = u.is_premium
            ? `<span class="badge badge-premium">👑 Premium</span>`
            : `<span class="badge badge-free">Bepul</span>`;
        const date = u.created_at ? new Date(u.created_at).toLocaleDateString("uz-UZ") : "—";
        return `
        <div class="recent-row">
          <div class="recent-avatar" style="background:${color}20;color:${color}">${initials}</div>
          <div>
            <div class="recent-name">${escHtml(name)}</div>
            <div class="recent-meta">${u.username ? "@" + escHtml(u.username) : "#" + u.user_id} · ${date}</div>
          </div>
          <div class="recent-status">${badge}</div>
        </div>`;
    }).join("");
}

// ─── Users ────────────────────────────────────────────────
async function loadUsers() {
    try {
        const res = await fetch(buildAdminUrl("/api/admin/users"));
        if (!res.ok) return;
        allUsers = await res.json();
        renderUsers(filterUsersData(allUsers));
        renderRecentUsers(allUsers.slice(0, 5));
    } catch (e) {
        document.getElementById("usersBody").innerHTML = `<tr><td colspan="6" class="empty-cell">❌ Xatolik yuz berdi</td></tr>`;
    }
}

function setupUserSearch() {
    document.getElementById("userSearch")?.addEventListener("input", e => {
        renderUsers(filterUsersData(allUsers, e.target.value));
    });
}

function setupUserFilter() {
    document.querySelectorAll("#userFilterPills .pill").forEach(pill => {
        pill.addEventListener("click", () => {
            document.querySelectorAll("#userFilterPills .pill").forEach(p => p.classList.remove("active"));
            pill.classList.add("active");
            userFilter = pill.dataset.filter;
            renderUsers(filterUsersData(allUsers, document.getElementById("userSearch")?.value || ""));
        });
    });
}

function filterUsersData(users, query = "") {
    const q = query.toLowerCase();
    return users.filter(u => {
        const matchFilter =
            userFilter === "all" ||
            (userFilter === "premium" && u.is_premium) ||
            (userFilter === "free" && !u.is_premium);
        const matchSearch = !q ||
            String(u.user_id).includes(q) ||
            (u.first_name || "").toLowerCase().includes(q) ||
            (u.last_name || "").toLowerCase().includes(q) ||
            (u.username || "").toLowerCase().includes(q);
        return matchFilter && matchSearch;
    });
}

function renderUsers(users) {
    const tbody = document.getElementById("usersBody");
    if (!users.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Foydalanuvchilar topilmadi</td></tr>`;
        return;
    }
    tbody.innerHTML = users.map(u => {
        const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || "Noma'lum";
        const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
        const color = avatarColor(u.user_id);
        const badge = u.is_premium
            ? `<span class="badge badge-premium">👑 Premium</span>`
            : `<span class="badge badge-free">Bepul</span>`;
        const usage = `${u.usage_count || 0}/10`;
        const date = u.created_at ? new Date(u.created_at).toLocaleDateString("uz-UZ") : "—";
        const toggleBtn = u.is_premium
            ? `<button class="act-btn red" onclick="togglePremium(${u.user_id}, false)">🚫 Bekor</button>`
            : `<button class="act-btn gold" onclick="togglePremium(${u.user_id}, true)">👑 Premium</button>`;
        return `<tr>
          <td><code style="color:var(--text-muted);font-size:11px">${u.user_id}</code></td>
          <td>
            <div style="display:flex;align-items:center;gap:10px">
              <div style="width:30px;height:30px;border-radius:50%;background:${color}20;color:${color};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;flex-shrink:0">${initials}</div>
              <div>
                <div style="font-weight:600;font-size:13px">${escHtml(name)}</div>
                <div style="font-size:11px;color:var(--text-muted)">${u.username ? "@" + escHtml(u.username) : ""}</div>
              </div>
            </div>
          </td>
          <td>${badge}</td>
          <td><span style="font-size:12px;color:var(--text-sec)">${usage}</span></td>
          <td><span style="font-size:12px;color:var(--text-muted)">${date}</span></td>
          <td>
            ${toggleBtn}
            <button class="act-btn green" onclick="resetUsage(${u.user_id})" title="Limitni sifirla">🔄</button>
            <button class="act-btn info"  onclick="openUserModal(${u.user_id})" title="Batafsil">🔍</button>
          </td>
        </tr>`;
    }).join("");
}

// ─── Toggle Premium ───────────────────────────────────────
async function togglePremium(userId, enable) {
    const action = enable ? "Premium bermoqchimisiz?" : "Premiumni bekor qilmoqchimisiz?";
    if (!confirm(`User #${userId}: ${action}`)) return;
    try {
        const res = await fetch(`${API_BASE}/api/admin/toggle-premium`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ secret: ADMIN_SECRET, user_id: userId, is_premium: enable, admin_id: TG_USER_ID }),
        });
        if (res.ok) {
            toast(enable ? "👑 Premium berildi!" : "🚫 Premium bekor qilindi");
            await loadUsers();
            await refreshStats();
        } else { toast("❌ Xatolik yuz berdi"); }
    } catch (e) { toast("❌ Server bilan bog'lanib bo'lmadi"); }
}

// ─── Reset Usage ──────────────────────────────────────────
async function resetUsage(userId) {
    if (!confirm(`User #${userId}: xabar limitini sifirlamoqchimisiz?`)) return;
    try {
        const res = await fetch(`${API_BASE}/api/admin/reset-usage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ secret: ADMIN_SECRET, user_id: userId, admin_id: TG_USER_ID }),
        });
        if (res.ok) { toast("🔄 Limit sifirlanadi!"); await loadUsers(); }
        else { toast("❌ Xatolik yuz berdi"); }
    } catch (e) { toast("❌ Server bilan bog'lanib bo'lmadi"); }
}

// ─── User Modal ───────────────────────────────────────────
function openUserModal(userId) {
    const u = allUsers.find(x => x.user_id === userId);
    if (!u) return;
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || "Noma'lum";
    const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
    const color = avatarColor(u.user_id);
    const date = u.created_at ? new Date(u.created_at).toLocaleString("uz-UZ") : "—";

    document.getElementById("modalTitle").textContent = escHtml(name);
    document.getElementById("modalBody").innerHTML = `
      <div class="modal-avatar" style="background:${color}20;color:${color}">${initials}</div>
      <div class="modal-row"><span class="modal-row-label">Telegram ID</span><span class="modal-row-value">${u.user_id}</span></div>
      <div class="modal-row"><span class="modal-row-label">Ism</span><span class="modal-row-value">${escHtml(name)}</span></div>
      <div class="modal-row"><span class="modal-row-label">Username</span><span class="modal-row-value">${u.username ? "@" + escHtml(u.username) : "—"}</span></div>
      <div class="modal-row"><span class="modal-row-label">Holat</span><span class="modal-row-value">${u.is_premium ? "👑 Premium" : "🆓 Bepul"}</span></div>
      <div class="modal-row"><span class="modal-row-label">Xabarlar ishlatilgan</span><span class="modal-row-value">${u.usage_count || 0} / 10</span></div>
      <div class="modal-row"><span class="modal-row-label">Ro'yxatdan o'tgan</span><span class="modal-row-value">${date}</span></div>
    `;
    document.getElementById("modalFooter").innerHTML = u.is_premium
        ? `<button class="act-btn red" onclick="togglePremium(${u.user_id}, false);closeModal()">🚫 Premiumni bekor qilish</button>`
        : `<button class="act-btn gold" onclick="togglePremium(${u.user_id}, true);closeModal()">👑 Premium berish</button>`;
    document.getElementById("userModal").classList.remove("hidden");
}

function closeModal() {
    document.getElementById("userModal").classList.add("hidden");
}

// ─── Coupons ──────────────────────────────────────────────
async function loadCoupons() {
    try {
        const res = await fetch(buildAdminUrl("/api/admin/coupons"));
        if (!res.ok) return;
        allCoupons = await res.json();
        renderCoupons(allCoupons);
    } catch (e) { console.error(e); }
}

const PLAN_NAMES = { "1_month": "1 Oy", "3_months": "3 Oy", "6_months": "6 Oy", "1_year": "1 Yil", "lifetime": "Umrbod" };

function renderCoupons(coupons) {
    const tbody = document.getElementById("couponsBody");
    if (!coupons.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Kuponlar topilmadi. Yuqorida yarating!</td></tr>`;
        return;
    }
    tbody.innerHTML = coupons.map(c => {
        const now = new Date();
        const expiry = c.expires_at ? new Date(c.expires_at) : null;
        const isExpired = expiry && expiry < now;
        const isFull = c.used_count >= c.max_uses;

        let badge;
        if (!c.is_active) badge = `<span class="badge badge-inactive">O'chirilgan</span>`;
        else if (isExpired) badge = `<span class="badge badge-expired">Muddati tugagan</span>`;
        else if (isFull) badge = `<span class="badge badge-expired">Limit tugagan</span>`;
        else badge = `<span class="badge badge-active">Faol</span>`;

        const toggleBtn = c.is_active
            ? `<button class="act-btn red" onclick="toggleCoupon('${c.id}', false)">🚫</button>`
            : `<button class="act-btn green" onclick="toggleCoupon('${c.id}', true)">✅</button>`;

        return `<tr>
          <td><span class="coupon-code">${escHtml(c.code)}</span></td>
          <td style="font-size:12px">${PLAN_NAMES[c.plan] || c.plan}</td>
          <td style="font-size:12px; font-weight: 600; color: var(--gold)">${c.discount_percent ?? 100}%</td>
          <td style="font-size:12px">${c.used_count} / ${c.max_uses}</td>
          <td style="font-size:12px;color:var(--text-muted)">${expiry ? expiry.toLocaleDateString("uz-UZ") : "—"}</td>
          <td>${badge}</td>
          <td>${toggleBtn}<button class="act-btn red" onclick="deleteCoupon('${c.id}')">🗑️</button></td>
        </tr>`;
    }).join("");
}

async function createCoupon() {
    const code = document.getElementById("couponCode").value.trim().toUpperCase();
    const plan = document.getElementById("couponPlan").value;
    const maxUses = parseInt(document.getElementById("couponLimit").value) || 1;
    const expiry = document.getElementById("couponExpiry").value || null;
    if (!code) { toast("❌ Kupon kodini kiriting!"); return; }
    try {
        const res = await fetch(`${API_BASE}/api/admin/coupons/create`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ secret: ADMIN_SECRET, code, plan, max_uses: maxUses, expires_at: expiry }),
        });
        if (res.ok) {
            toast(`🎟️ "${code}" yaratildi!`);
            document.getElementById("couponCode").value = "";
            await loadCoupons(); await refreshStats();
        } else {
            const err = await res.json();
            toast(`❌ ${err.error || "Xatolik yuz berdi"}`);
        }
    } catch (e) { toast("❌ Server bilan bog'lanib bo'lmadi"); }
}

async function toggleCoupon(id, enable) {
    try {
        const res = await fetch(`${API_BASE}/api/admin/coupons/toggle`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ secret: ADMIN_SECRET, coupon_id: id, is_active: enable }),
        });
        if (res.ok) { toast(enable ? "✅ Kupon faollashtirildi" : "🚫 Kupon o'chirildi"); await loadCoupons(); }
        else { toast("❌ Xatolik"); }
    } catch (e) { toast("❌ Xatolik"); }
}

async function deleteCoupon(id) {
    if (!confirm("Kuponni butunlay o'chirmoqchimisiz?")) return;
    try {
        const res = await fetch(`${API_BASE}/api/admin/coupons/delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ secret: ADMIN_SECRET, coupon_id: id }),
        });
        if (res.ok) { toast("🗑️ Kupon o'chirildi!"); await loadCoupons(); await refreshStats(); }
        else { toast("❌ Xatolik"); }
    } catch (e) { toast("❌ Xatolik"); }
}

function generateCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "HSB-";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    document.getElementById("couponCode").value = code;
}

// ─── Broadcast ────────────────────────────────────────────
function setupBroadcastCharCount() {
    const ta = document.getElementById("bcMessage");
    const cc = document.getElementById("charCount");
    if (ta && cc) {
        ta.addEventListener("input", () => { cc.textContent = `${ta.value.length} belgi`; });
    }
}

async function sendBroadcast() {
    const message = document.getElementById("bcMessage").value.trim();
    const target = document.querySelector('input[name="bcTarget"]:checked')?.value || "all";
    const resultEl = document.getElementById("broadcastResult");

    if (!message) { toast("❌ Xabar matnini kiriting!"); return; }

    const btn = document.querySelector(".broadcast-send-btn");
    btn.textContent = "⏳ Yuborilmoqda..."; btn.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/api/admin/broadcast`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ secret: ADMIN_SECRET, admin_id: TG_USER_ID, message, target }),
        });
        const data = await res.json();
        resultEl.classList.remove("hidden", "success", "error");
        if (res.ok) {
            resultEl.classList.add("success");
            resultEl.textContent = `✅ Muvaffaqiyatli! ${data.sent || "?"} ta foydalanuvchiga yuborildi.`;
            document.getElementById("bcMessage").value = "";
            document.getElementById("charCount").textContent = "0 belgi";
        } else {
            resultEl.classList.add("error");
            resultEl.textContent = `❌ ${data.error || "Xatolik yuz berdi"}`;
        }
    } catch (e) {
        resultEl.classList.remove("hidden");
        resultEl.classList.add("error");
        resultEl.textContent = "❌ Server bilan bog'lanib bo'lmadi";
    } finally {
        btn.textContent = "📣 Xabar Yuborish"; btn.disabled = false;
    }
}

// ─── Stats Refresh ────────────────────────────────────────
async function refreshStats() {
    try {
        const res = await fetch(buildAdminUrl("/api/admin/stats"));
        if (res.ok) updateKPI(await res.json());
    } catch (e) { }
}

// ─── Helpers ──────────────────────────────────────────────
function toast(msg) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2800);
}

function escHtml(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const AVATAR_COLORS = ["#3d8ef8", "#22c55e", "#f5a623", "#a78bfa", "#f87171", "#06b6d4", "#fb923c"];
function avatarColor(id) {
    return AVATAR_COLORS[Number(id) % AVATAR_COLORS.length];
}

// Close modal on overlay click
document.getElementById("userModal")?.addEventListener("click", function (e) {
    if (e.target === this) closeModal();
});
