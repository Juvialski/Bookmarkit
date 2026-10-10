import { Rating } from '../models/book';

export function visibleRatings(ratings: Rating[]) {
  return ratings.filter(r => !r.unavailable && r.average !== undefined && Number.isFinite(r.average) && r.average > 0 && r.average <= 5 && (r.provider !== 'Goodreads' || (r.verified === true && Number.isSafeInteger(r.count) && r.count! > 0)));
}

export function primaryRating(ratings: Rating[]): Rating | undefined {
  const visible = visibleRatings(ratings);
  return visible.find(r => r.provider === 'Goodreads') ?? visible.find(r => r.provider === 'Hardcover' && !r.stored) ?? visible.find(r => r.provider === 'Open Library' && !r.stored) ?? visible.find(r => r.provider === 'Google Books' && !r.stored) ?? visible[0];
}
