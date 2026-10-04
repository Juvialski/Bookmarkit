import { Rating } from '../models/book';

export function visibleRatings(ratings: Rating[]) {
  return ratings.filter(r => !r.unavailable && r.average !== undefined && Number.isFinite(r.average) && r.average > 0 && r.average <= 5);
}

export function primaryRating(ratings: Rating[]): Rating | undefined {
  const visible = visibleRatings(ratings);
  return visible.find(r => r.provider === 'Hardcover') ?? visible.find(r => r.provider === 'Open Library') ?? visible[0];
}
