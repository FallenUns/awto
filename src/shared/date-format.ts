const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_FORMAT_RE =
  /\b(?:d{1,2})\s*([/.-])\s*(?:m{1,2})\s*\1\s*(?:y{2,4})\b|\b(?:m{1,2})\s*([/.-])\s*(?:d{1,2})\s*\2\s*(?:y{2,4})\b|\b(?:y{2,4})\s*([/.-])\s*(?:m{1,2})\s*\3\s*(?:d{1,2})\b/i;

const NATIVE_DATE_TYPES = new Set(["date", "month", "week", "time", "datetime-local"]);

export function extractDateFormatHint(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(DATE_FORMAT_RE);
  if (!match) return null;
  return match[0].replace(/\s+/g, "").toUpperCase();
}

export interface FieldDateFormatContext {
  type?: string | null;
  label?: string | null;
  placeholder?: string | null;
  formatHint?: string | null;
}

export function formatIsoDateForField(
  value: string,
  context: FieldDateFormatContext
): string {
  if (!ISO_DATE_RE.test(value)) return value;

  const type = context.type?.toLowerCase();
  if (type && NATIVE_DATE_TYPES.has(type)) return value;

  const hint =
    extractDateFormatHint(context.formatHint) ??
    extractDateFormatHint(context.placeholder) ??
    extractDateFormatHint(context.label);
  if (!hint) return value;

  return formatIsoDateForHint(value, hint);
}

export function formatIsoDateForHint(value: string, hint: string): string {
  const date = ISO_DATE_RE.exec(value);
  if (!date) return value;
  const [, year, month, day] = date;
  if (!year || !month || !day) return value;
  const compact = hint.replace(/\s+/g, "").toUpperCase();
  const shape = compact.match(
    /^(D{1,2}|M{1,2}|Y{2,4})([/.-])(D{1,2}|M{1,2}|Y{2,4})\2(D{1,2}|M{1,2}|Y{2,4})$/
  );
  if (!shape) return value;

  const [, first, separator, second, third] = shape;
  if (!first || !separator || !second || !third) return value;
  return [first, second, third]
    .map((token) => formatToken(token, { year, month, day }))
    .join(separator);
}

function formatToken(
  token: string,
  parts: { year: string; month: string; day: string }
): string {
  switch (token) {
    case "D":
      return String(Number(parts.day));
    case "DD":
      return parts.day;
    case "M":
      return String(Number(parts.month));
    case "MM":
      return parts.month;
    case "YY":
      return parts.year.slice(-2);
    case "YYYY":
      return parts.year;
    default:
      return token;
  }
}
