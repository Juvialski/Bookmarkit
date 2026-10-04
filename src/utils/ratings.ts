import { Rating } from '../models/book';
export function visibleRatings(ratings: Rating[]) {
  return ratings.filter(r => !r.unavailable && r.average !== undefined && Number.isFinite(r.average) && r.average > 0 && r.average <= 5);
}
