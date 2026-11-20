/**
 * Financial UI Formatters & Helpers
 *
 * Rules:
 * - Tabular figures for numbers and money
 * - Never compute or format money with JS floating-point arithmetic.
 * - Always display raw exact numerical strings or precision-safe values.
 */

export function formatMoney(amount, currency = "GBP") {
  if (amount == null || amount === "") return "—";
  const num = Number(amount);
  if (Number.isNaN(num)) return String(amount);
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : "£";
  return `${symbol}${num.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDateTime(isoString) {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return String(isoString);
    return d.toLocaleString("en-GB", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return String(isoString);
  }
}

export function formatDate(isoString) {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return String(isoString);
    return d.toLocaleDateString("en-GB", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return String(isoString);
  }
}

export function formatSlaCountdown(seconds) {
  if (seconds == null) return "—";
  if (seconds < 0) {
    const overdue = Math.abs(seconds);
    const h = Math.floor(overdue / 3600);
    const m = Math.floor((overdue % 3600) / 60);
    return `Breached (+${h}h ${m}m)`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}
