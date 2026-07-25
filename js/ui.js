// 共通のちょい便利関数

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const yen = (n) => "¥" + Number(n || 0).toLocaleString("ja-JP");
export const num = (n) => Number(n || 0).toLocaleString("ja-JP");

const pad2 = (n) => String(n).padStart(2, "0");

// 端末のローカル日付を YYYY-MM-DD で返す（レポート集計の基準）
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function formatDateTime(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// 月末日
export function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

let toastTimer = null;
export function toast(message, kind = "ok") {
  const el = $("#toast");
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = "toast"), 2600);
}

// 入力された金額文字列 → 整数（全角数字・カンマも許容）。空なら null
export function parseAmount(value) {
  if (value === null || value === undefined) return null;
  const s = String(value)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，\s円]/g, "");
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return NaN;
  return parseInt(s, 10);
}

export function setBusy(button, busy, busyLabel = "処理中…") {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyLabel;
    button.disabled = true;
  } else {
    if (button.dataset.label) button.textContent = button.dataset.label;
    button.disabled = false;
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
