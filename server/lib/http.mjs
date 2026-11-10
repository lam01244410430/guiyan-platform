// Demo baseline date, same as the original group demo: bookings cannot be
// earlier than this date (seed data lives around it).
const today = "2026-11-09";
const time = () => new Date().toISOString();
const yuan = (cents) => `¥${(cents / 100).toString()}`;

function assert(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}
function text(value, label, max = 1000) {
  assert(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.trim().length <= max,
    `${label}不能为空且不能超过${max}字`,
  );
  return value.trim();
}
function int(value, label, min = 0, max = 100000000) {
  assert(
    Number.isSafeInteger(value) && value >= min && value <= max,
    `${label}必须为${min}至${max}之间的整数`,
  );
  return value;
}
function date(value) {
  assert(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !isNaN(new Date(value).valueOf()) &&
      new Date(value).toISOString().slice(0, 10) === value &&
      value >= today,
    "请选择有效日期，且不能早于演示基准日",
  );
  return value;
}

const safeUser = ({ password, ...u }) => u;
const resourceRow = (r) => ({
  ...r,
  tags: JSON.parse(r.tags),
  meta: JSON.parse(r.meta),
});
const bookingType = (r) => ["venue", "equipment"].includes(r.category);

export { assert, text, int, date, time, yuan, today, safeUser, resourceRow, bookingType };
