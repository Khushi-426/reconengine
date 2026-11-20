export const FINANCIAL_ANALYSIS = "FINANCIAL_ANALYSIS";

function decimalParts(value) {
  const text = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error(`Invalid monetary value: ${text}`);
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  if (fraction.length > 2) throw new Error(`Monetary value exceeds the source NUMERIC(18,2) scale: ${text}`);
  return { sign: text.startsWith("-") ? -1n : 1n, units: BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2)) };
}
function cents(value) { const p = decimalParts(value); return p.sign * p.units; }
function money(value) { const abs = value < 0n ? -value : value; return `${value < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`; }
function daysApart(a, b) { return Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000); }
function normalizeRef(value) { return value?.normalize("NFKC").replace(/[\s-]/g, "").toLocaleUpperCase("en-US") || ""; }
function currencyPrecision(currency) {
  if (["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"].includes(currency)) return 3;
  if (["JPY", "KRW", "CLP", "ISK", "VND"].includes(currency)) return 0;
  return 2;
}
function hasValidCurrencyPrecision(value, currency) {
  const fraction = String(value).split(".")[1] || "";
  return fraction.replace(/0+$/, "").length <= currencyPrecision(currency);
}

export function analyzeFinancials(evidence, rules = { amountTolerance: "0.00", dateToleranceDays: 2 }) {
  const toleranceValue = cents(rules.amountTolerance);
  if (toleranceValue < 0n || !Number.isInteger(rules.dateToleranceDays) || rules.dateToleranceDays < 0) throw new Error("Investigation tolerances must be non-negative decimal values and whole days");
  const { ledger, external, duplicateCandidates = [] } = evidence;
  const findings = [];
  let difference = null;
  let dateDifferenceDays = null;
  let settlementDateDifferenceDays = null;
  let referenceMatch = null;
  let percentageDifference = null;
  let category = "UNCLASSIFIED";
  const appliedRules = [];
  if (!ledger && external) { category = duplicateCandidates.length > 1 ? "DUPLICATE_TRANSACTION" : "MISSING_INTERNAL"; appliedRules.push("MISSING_LEDGER_RECORD"); }
  else if (ledger && !external) { category = duplicateCandidates.length > 1 ? "DUPLICATE_TRANSACTION" : "MISSING_EXTERNAL"; appliedRules.push("MISSING_EXTERNAL_RECORD"); }
  else if (ledger && external) {
    if (ledger.currency !== external.currency || (evidence.account?.currency && evidence.account.currency !== ledger.currency)) {
      category = "CURRENCY_MISMATCH"; appliedRules.push("CURRENCY_MUST_MATCH");
      findings.push({ rule: "CURRENCY_MUST_MATCH", observation: `Ledger, external, and configured account currencies must agree. Ledger=${ledger.currency}; external=${external.currency}; account=${evidence.account?.currency || "unknown"}.` });
    } else if (!hasValidCurrencyPrecision(ledger.amount, ledger.currency) || !hasValidCurrencyPrecision(external.amount, external.currency)) {
      category = "CURRENCY_MISMATCH"; appliedRules.push("CURRENCY_PRECISION_INVALID");
      findings.push({ rule: "CURRENCY_PRECISION_INVALID", observation: `An amount contains more non-zero decimal places than the configured ${ledger.currency} precision (${currencyPrecision(ledger.currency)}).` });
    } else {
      difference = cents(ledger.amount) - cents(external.amount);
      const absDiff = difference < 0n ? -difference : difference;
      const tolerance = toleranceValue;
      const base = cents(ledger.amount);
      if (base !== 0n) {
        const basisPoints = (absDiff * 10000n + base / 2n) / base;
        percentageDifference = `${basisPoints / 100n}.${String(basisPoints % 100n).padStart(2, "0")}`;
      }
      referenceMatch = normalizeRef(ledger.reference) === normalizeRef(external.reference) && Boolean(normalizeRef(ledger.reference));
      if (ledger.date && external.date) dateDifferenceDays = daysApart(ledger.date, external.date);
      if (ledger.date && external.settlementDate) settlementDateDifferenceDays = daysApart(ledger.date, external.settlementDate);
      if (duplicateCandidates.length) {
        category = "DUPLICATE_TRANSACTION"; appliedRules.push("DUPLICATE_REFERENCE_OR_AMOUNT_DATE_CANDIDATE");
      } else if (absDiff > tolerance) {
        category = external.isBatchedSettlement && difference > 0n && difference < base ? "PARTIAL_SETTLEMENT" : "AMOUNT_MISMATCH";
        appliedRules.push("AMOUNT_TOLERANCE_EXCEEDED");
        findings.push({ rule: "AMOUNT_TOLERANCE_EXCEEDED", observation: `Absolute amount difference ${money(absDiff)} ${ledger.currency} exceeds tolerance ${money(tolerance)} ${ledger.currency}.` });
      } else if ((dateDifferenceDays != null && dateDifferenceDays > rules.dateToleranceDays) || (settlementDateDifferenceDays != null && settlementDateDifferenceDays > rules.dateToleranceDays)) {
        category = "DATE_MISMATCH"; appliedRules.push("DATE_TOLERANCE_EXCEEDED");
      } else if (!referenceMatch) {
        category = "REFERENCE_MISMATCH"; appliedRules.push("NORMALIZED_REFERENCE_DIFFERENCE");
      } else {
        category = "UNCLASSIFIED"; appliedRules.push("NO_CONFIGURED_DISCREPANCY_RULE_MATCHED");
      }
    }
  }
  if (ledger && external) {
    findings.push({ rule: "AMOUNT_COMPARISON", ledgerAmount: ledger.amount, externalAmount: external.amount, difference: difference === null ? null : money(difference), currency: ledger.currency });
    if (dateDifferenceDays != null) findings.push({ rule: "DATE_COMPARISON", ledgerDate: ledger.date, externalDate: external.date, differenceDays: dateDifferenceDays });
    if (settlementDateDifferenceDays != null) findings.push({ rule: "SETTLEMENT_DATE_COMPARISON", ledgerDate: ledger.date, settlementDate: external.settlementDate, differenceDays: settlementDateDifferenceDays });
    findings.push({ rule: "REFERENCE_COMPARISON", normalizedMatch: referenceMatch });
  }
  if (duplicateCandidates.length) appliedRules.push("ACCOUNT_CURRENCY_DATE_SCOPED_CANDIDATES");
  return { category, calculations: { amountDifference: difference === null ? null : money(difference), absoluteAmountDifference: difference === null ? null : money(difference < 0n ? -difference : difference), percentageDifference, currency: ledger?.currency || external?.currency || null, dateDifferenceDays, settlementDateDifferenceDays, referenceMatch, duplicateCandidateCount: duplicateCandidates.length }, appliedRules: [...new Set(appliedRules)], findings, duplicateCandidates };
}
