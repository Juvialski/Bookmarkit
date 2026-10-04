export function normalizeIsbn(value: string): string { return value.replace(/[\s-]/g, ''); }
export function isValidIsbn(value: string): boolean {
  const isbn = normalizeIsbn(value);
  if (!/^97[89]\d{10}$/.test(isbn)) return false;
  const sum = [...isbn.slice(0, 12)].reduce((n, digit, i) => n + Number(digit) * (i % 2 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === Number(isbn[12]);
}
export function createScanGate() {
  let locked = false;
  return { acquire(value: string) { if (locked || !isValidIsbn(value)) return false; locked = true; return true; }, reset() { locked = false; } };
}
