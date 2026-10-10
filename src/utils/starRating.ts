import { Rating } from '../models/book';

export function starFills(average: unknown): number[] {
  const value = typeof average === 'number' && Number.isFinite(average) && average >= 0 && average <= 5 ? average : 0;
  return Array.from({ length: 5 }, (_, i) => Math.round(Math.max(0, Math.min(1, value - i)) * 1000) / 1000);
}
export function ratingSource(rating: Rating): string {
  const count = rating.count;
  const valid = typeof count === 'number' && Number.isSafeInteger(count) && count > 0;
  return valid ? `${count.toLocaleString('en-US')} ${count === 1 ? 'rating' : 'ratings'} · ${rating.provider}` : rating.provider;
}
export function ratingLabel(rating: Rating): string {
  return `${rating.average!.toFixed(1)} out of 5 stars, ${ratingSource(rating).replace(' · ', ', ')}.`;
}
