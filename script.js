const STORAGE_KEY = "hotelBillingState";
const OPERATOR_NAME_KEY = "hotelBillingOperatorName";
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
const weekRangeLabelEl = document.getElementById("weekRangeLabel");
const reportStartEl = document.getElementById("reportStart");
const reportEndEl = document.getElementById("reportEnd");
const exportReportBtnEl = document.getElementById("exportReportBtn");
const exportProgressEl = document.getElementById("exportProgress");
const operatorBadgeEl = document.getElementById("operatorBadge");
const operatorModalEl = document.getElementById("operatorModal");
const operatorNameInputEl = document.getElementById("operatorNameInput");
let db = null;
let firebaseReady = false;
let historyCache = [];
let currentOperatorName = "";

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

function readOperatorName() {
    return (localStorage.getItem(OPERATOR_NAME_KEY) || "").trim();
}

function saveOperatorName(name) {
    localStorage.setItem(OPERATOR_NAME_KEY, name);
}

function updateOperatorBadge() {
    operatorBadgeEl.textContent = currentOperatorName
        ? `Người nhập hiện tại: ${currentOperatorName}`
        : "";
}

function openOperatorModal() {
    const cachedName = readOperatorName();
    operatorNameInputEl.value = cachedName;
    operatorModalEl.classList.remove("hidden");
    setTimeout(() => operatorNameInputEl.focus(), 10);
}

function confirmOperatorName() {
    const name = operatorNameInputEl.value.trim();
    if (!name) {
        alert("Vui lòng nhập tên người thực hiện.");
        return;
    }

    currentOperatorName = name;
    saveOperatorName(name);
    updateOperatorBadge();
    operatorModalEl.classList.add("hidden");
}

function formatDate(dateInput) {
    if (!dateInput) return "";
    if (dateInput.toDate) {
        return dateInput.toDate().toLocaleString("vi-VN");
    }
    return new Date(dateInput).toLocaleString("vi-VN");
}

function getWeekRange(date = new Date()) {
    const local = new Date(date);
    const day = local.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const start = new Date(local);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() + diff);

    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
}

function formatDateOnly(date) {
    return date.toLocaleDateString("vi-VN");
}

function updateWeekRangeLabel() {
    const { start, end } = getWeekRange();
    const endDisplay = new Date(end);
    endDisplay.setDate(endDisplay.getDate() - 1);
    weekRangeLabelEl.textContent = `${formatDateOnly(start)} - ${formatDateOnly(endDisplay)}`;
}

function toDateInputValue(date) {
    const offsetMs = date.getTimezoneOffset() * 60000;
    const local = new Date(date.getTime() - offsetMs);
    return local.toISOString().slice(0, 10);
}

function initializeReportRange() {
    const { start } = getWeekRange();
    reportStartEl.value = toDateInputValue(start);
    reportEndEl.value = toDateInputValue(new Date());
}

function toFirestoreTimestamp(date) {
    return firebase.firestore.Timestamp.fromDate(date);
}

function escapeCsvValue(value) {
    const asString = String(value ?? "");
    const escaped = asString.replaceAll('"', '""');
    return `"${escaped}"`;
}

function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function setExportLoading(isLoading) {
    exportReportBtnEl.disabled = isLoading;
    exportProgressEl.classList.toggle("hidden", !isLoading);
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
                    <span class="history-user">Người nhập: ${item.operatorName || "Không rõ"}</span>
                </div>
            </div>
        `
        )
        .join("");
}

function initFirebase() {
    if (typeof firebase === "undefined" || !window.FIREBASE_CONFIG) {
        historyEl.className = "history-empty";
        historyEl.textContent = "Chưa nạp Firebase SDK.";
        return;
    }

    const cfg = window.FIREBASE_CONFIG;
    if (!cfg.apiKey || cfg.apiKey.startsWith("YOUR_")) {
        historyEl.className = "history-empty";
        historyEl.textContent = "Chưa cấu hình firebase-config.js.";
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
    const { start, end } = getWeekRange();

    const snapshot = await db
        .collection(BILL_COLLECTION)
        .where("createdAt", ">=", toFirestoreTimestamp(start))
        .where("createdAt", "<", toFirestoreTimestamp(end))
        .orderBy("createdAt", "desc")
        .limit(200)
        .get();

    const items = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
    }));
    renderHistory(items);
}

async function appendHistory(entry) {
    if (!firebaseReady) {
        alert("Chưa cấu hình Firebase nên không thể lưu lịch sử cloud.");
        return;
    }

    await db.collection(BILL_COLLECTION).add({
        ...entry,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}

async function refreshHistorySection() {
    await loadHistoryFromCloud();
    // Firestore serverTimestamp co the cap nhat tre, doi nhip ngan de danh sach on dinh hon.
    setTimeout(() => {
        void loadHistoryFromCloud();
    }, 500);
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

async function exportReport() {
    setExportLoading(true);
    try {
        if (!firebaseReady) {
            alert("Chưa cấu hình Firebase nên không thể xuất báo cáo.");
            return;
        }

        if (!reportStartEl.value || !reportEndEl.value) {
            alert("Vui lòng chọn đầy đủ mốc thời gian.");
            return;
        }

        const fromDate = new Date(reportStartEl.value);
        const toDate = new Date(reportEndEl.value);

        if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
            alert("Mốc thời gian không hợp lệ.");
            return;
        }
        const fromDateStart = new Date(fromDate);
        fromDateStart.setHours(0, 0, 0, 0);
        const toDateStart = new Date(toDate);
        toDateStart.setHours(0, 0, 0, 0);
        if (toDateStart < fromDateStart) {
            alert("Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu.");
            return;
        }
        const toDateEndExclusive = new Date(toDate);
        toDateEndExclusive.setHours(0, 0, 0, 0);
        toDateEndExclusive.setDate(toDateEndExclusive.getDate() + 1);

        const snapshot = await db
            .collection(BILL_COLLECTION)
            .where("createdAt", ">=", toFirestoreTimestamp(fromDateStart))
            .where("createdAt", "<", toFirestoreTimestamp(toDateEndExclusive))
            .orderBy("createdAt", "asc")
            .get();

        if (snapshot.empty) {
            alert("Không có bill trong khoảng thời gian đã chọn.");
            return;
        }

        const rows = [
            ["Ngày tính", "Người nhập", "Giờ vào", "Giờ ra", "Số giờ", "Tiền phòng", "Số chai nước", "Tổng tiền"]
        ];

        snapshot.forEach((doc) => {
            const item = doc.data();
            rows.push([
                formatDate(item.createdAt || item.calculatedAt),
                item.operatorName ?? "Không rõ",
                item.timeIn ?? "",
                item.timeOut ?? "",
                item.hours ?? "",
                item.room ?? 0,
                item.waterQty ?? 0,
                item.total ?? 0
            ]);
        });

        const csv = rows
            .map((row) => row.map((cell) => escapeCsvValue(cell)).join(","))
            .join("\n");

        const fileName = `bao-cao-bill-${toDateInputValue(fromDateStart)}-${toDateInputValue(toDate)}.csv`;
        downloadFile(fileName, csv, "text/csv;charset=utf-8;");
    } finally {
        setExportLoading(false);
    }
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
    if (!currentOperatorName) {
        openOperatorModal();
        return;
    }

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

    const hours = Math.max(1, Math.ceil(minutes / 60));
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
        operatorName: currentOperatorName,
        calculatedAt: new Date().toISOString()
    });
    await refreshHistorySection();

    // Hoàn tất lượt tính tiền, reset giờ để bắt đầu lượt mới.
    fields.timeIn.value = "";
    fields.timeOut.value = "";
    fields.waterQty.value = "0";
    saveState();
}

window.addEventListener("load", () => {
    hydrateState();
    updateWeekRangeLabel();
    initializeReportRange();
    openOperatorModal();
    initFirebase();
    void refreshHistorySection();
});

document.getElementById("checkInBtn").addEventListener("click", handleCheckIn);
document.getElementById("checkOutBtn").addEventListener("click", handleCheckOut);
document.getElementById("calculateBtn").addEventListener("click", () => {
    void calculate();
});
document.getElementById("clearHistoryBtn").addEventListener("click", () => {
    void clearHistory();
});
document.getElementById("exportReportBtn").addEventListener("click", () => {
    void exportReport();
});
document.getElementById("confirmOperatorBtn").addEventListener("click", confirmOperatorName);
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
