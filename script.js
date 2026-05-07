const STORAGE_KEY = "hotelBillingState";
const WATER_UNIT_PRICE = 10000;
const BILL_COLLECTION = "bills";

const fields = {
    priceFirst: document.getElementById("priceFirst"),
    priceExtra: document.getElementById("priceExtra"),
    timeIn: document.getElementById("timeIn"),
    timeOut: document.getElementById("timeOut"),
    waterQty: document.getElementById("waterQty")
};

const historyEl = document.getElementById("historyList");
let db = null;
let firebaseReady = false;
let historyCache = [];

function getCurrentTime() {
    return new Date().toTimeString().slice(0, 5);
}

function readState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function saveState() {
    const state = {
        priceFirst: fields.priceFirst.value,
        priceExtra: fields.priceExtra.value,
        timeIn: fields.timeIn.value,
        timeOut: fields.timeOut.value,
        waterQty: fields.waterQty.value
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function formatDate(dateInput) {
    if (!dateInput) return "";
    if (dateInput.toDate) {
        return dateInput.toDate().toLocaleString("vi-VN");
    }
    return new Date(dateInput).toLocaleString("vi-VN");
}

function renderHistory(history = historyCache) {
    historyCache = history;

    if (!history.length) {
        historyEl.className = "history-empty";
        historyEl.textContent = "Chưa có lượt tính tiền nào.";
        return;
    }

    historyEl.className = "history-list";
    historyEl.innerHTML = history
        .map(
            (item) => `
            <div class="history-item">
                <div class="history-item-head">
                    <span class="history-date">${formatDate(item.createdAt || item.calculatedAt)}</span>
                    <button class="history-delete-btn" type="button" data-id="${item.id}">Xóa</button>
                </div>
                <div class="history-main">
                    <span>${item.timeIn} - ${item.timeOut} (${item.hours} giờ)</span>
                    <strong>${Number(item.total).toLocaleString("vi-VN")} đ</strong>
                </div>
                <div class="history-sub">
                    <span>Phòng: ${Number(item.room).toLocaleString("vi-VN")} đ</span>
                    <span>Nước: ${item.waterQty} chai</span>
                </div>
            </div>
        `
        )
        .join("");
}

function initFirebase() {
    if (typeof firebase === "undefined" || !window.FIREBASE_CONFIG) {
        historyEl.className = "history-empty";
        historyEl.textContent = "Chưa nap Firebase SDK.";
        return;
    }

    const cfg = window.FIREBASE_CONFIG;
    if (!cfg.apiKey || cfg.apiKey.startsWith("YOUR_")) {
        historyEl.className = "history-empty";
        historyEl.textContent = "Chua cau hinh firebase-config.js.";
        return;
    }

    if (!firebase.apps.length) {
        firebase.initializeApp(cfg);
    }
    db = firebase.firestore();
    firebaseReady = true;
}

async function loadHistoryFromCloud() {
    if (!firebaseReady) return;

    const snapshot = await db
        .collection(BILL_COLLECTION)
        .orderBy("createdAt", "desc")
        .limit(50)
        .get();

    const items = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
    }));
    renderHistory(items);
}

async function appendHistory(entry) {
    if (!firebaseReady) {
        alert("Chua cau hinh Firebase nen khong the luu lich su cloud.");
        return;
    }

    await db.collection(BILL_COLLECTION).add({
        ...entry,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await loadHistoryFromCloud();
}

async function clearHistory() {
    const ok = confirm("Bạn có chắc muốn xóa toàn bộ lịch sử?");
    if (!ok) return;
    if (!firebaseReady) return;

    const snapshot = await db.collection(BILL_COLLECTION).get();
    const batch = db.batch();
    snapshot.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    renderHistory([]);
}

async function deleteHistoryItem(id) {
    const found = historyCache.find((item) => item.id === id);
    if (!found || !firebaseReady) return;

    const ok = confirm("Bạn có chắc muốn xóa bill này?");
    if (!ok) return;

    await db.collection(BILL_COLLECTION).doc(id).delete();
    await loadHistoryFromCloud();
}

function hydrateState() {
    const state = readState();

    if (state.priceFirst) fields.priceFirst.value = state.priceFirst;
    if (state.priceExtra) fields.priceExtra.value = state.priceExtra;
    if (state.timeIn) fields.timeIn.value = state.timeIn;
    if (state.timeOut) fields.timeOut.value = state.timeOut;
    if (state.waterQty !== undefined) fields.waterQty.value = state.waterQty;
}

function handleCheckIn() {
    fields.timeIn.value = getCurrentTime();
    saveState();
    alert(`Đã checkin lúc ${fields.timeIn.value}`);
}

function handleCheckOut() {
    fields.timeOut.value = getCurrentTime();
    saveState();
    alert(`Đã checkout lúc ${fields.timeOut.value}`);
}

async function calculate() {
    const pFirst = Number(fields.priceFirst.value) || 0;
    const pExtra = Number(fields.priceExtra.value) || 0;
    const tIn = fields.timeIn.value;
    const tOut = fields.timeOut.value;
    const waterQty = Math.max(0, Number(fields.waterQty.value) || 0);
    const water = waterQty * WATER_UNIT_PRICE;

    if (!tIn || !tOut) {
        alert("Cần bấm Checkin và Checkout trước khi tính tiền.");
        return;
    }

    const [h1, m1] = tIn.split(":").map(Number);
    const [h2, m2] = tOut.split(":").map(Number);

    let minutes = h2 * 60 + m2 - (h1 * 60 + m1);
    if (minutes < 0) minutes += 1440;

    const hours = Math.ceil(minutes / 60);
    const room = pFirst + Math.max(0, hours - 1) * pExtra;
    const total = room + water;

    document.getElementById("resHours").innerText = `${hours} giờ`;
    document.getElementById("resRoom").innerText = `${room.toLocaleString("vi-VN")} đ`;
    document.getElementById("resWater").innerText = `${water.toLocaleString("vi-VN")} đ`;
    document.getElementById("resTotal").innerText = `${total.toLocaleString("vi-VN")} đ`;

    const result = document.getElementById("result");
    result.style.display = "block";
    result.classList.remove("fade-in");
    void result.offsetWidth;
    result.classList.add("fade-in");

    await appendHistory({
        timeIn: tIn,
        timeOut: tOut,
        hours,
        room,
        waterQty,
        total,
        calculatedAt: new Date().toISOString()
    });

    // Hoàn tất lượt tính tiền, reset giờ để bắt đầu lượt mới.
    fields.timeIn.value = "";
    fields.timeOut.value = "";
    fields.waterQty.value = "0";
    saveState();
}

window.addEventListener("load", () => {
    hydrateState();
    initFirebase();
    void loadHistoryFromCloud();
});

document.getElementById("checkInBtn").addEventListener("click", handleCheckIn);
document.getElementById("checkOutBtn").addEventListener("click", handleCheckOut);
document.getElementById("calculateBtn").addEventListener("click", () => {
    void calculate();
});
document.getElementById("clearHistoryBtn").addEventListener("click", () => {
    void clearHistory();
});
document.getElementById("historyList").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const deleteBtn = target.closest(".history-delete-btn");
    if (!deleteBtn) return;
    if (!deleteBtn.dataset.id) return;
    void deleteHistoryItem(deleteBtn.dataset.id);
});
fields.priceFirst.addEventListener("input", saveState);
fields.priceExtra.addEventListener("input", saveState);
fields.timeIn.addEventListener("input", saveState);
fields.timeOut.addEventListener("input", saveState);
fields.waterQty.addEventListener("input", saveState);

// Đăng ký service worker (PWA)
if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js");
}
