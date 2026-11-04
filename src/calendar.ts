export function lagosDate(at = Date.now()) {
  return new Date(at + 3600000).toISOString().slice(0, 10);
}
