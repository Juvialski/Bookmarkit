export type Provider = 'Goodreads' | 'Hardcover' | 'Open Library' | 'Google Books';
export interface Rating { provider: Provider; average?: number; count?: number; unavailable?: boolean; stored?: boolean; verified?: boolean; url?: string; scope?: 'work' | 'edition'; retrievedAt?: string }
export interface BookResult {
  source?: 'offline-catalog' | 'personal-cache';
  goodreadsUrl?: string; goodreadsId?: string;
  retrievedAt?: string; matchingConfidence?: 'identified';
  incomplete?: boolean;
  hardcoverId?: string; hardcoverUrl?: string;
  identity?: 'isbn' | 'work';
  isbn?: string; title: string; authors: string[]; coverUrl?: string; coverUrls?: string[];
  seriesStatus: 'series' | 'standalone' | 'unknown';
  classificationSource?: 'hardcover' | 'open-library' | 'curated' | 'unknown';
  classificationConfidence?: 'structured' | 'explicit' | 'curated';
  plannedSequel?: boolean; classificationEvidence?: string; seriesName?: string; seriesPosition?: string; workId?: string;
  ratings: Rating[]; warnings: string[];
}
export type ProviderBook = Omit<BookResult, 'ratings' | 'warnings'> & { rating: Rating; warnings?: string[] };
