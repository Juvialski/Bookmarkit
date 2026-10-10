export type Provider = 'Hardcover' | 'Open Library';
export interface Rating { provider: Provider; average?: number; count?: number; unavailable?: boolean; stored?: boolean }
export interface BookResult {
  source?: 'offline-catalog';
  incomplete?: boolean;
  hardcoverId?: string; hardcoverUrl?: string;
  identity?: 'isbn' | 'work';
  isbn?: string; title: string; authors: string[]; coverUrl?: string;
  seriesStatus: 'series' | 'standalone' | 'unknown';
  classificationSource?: 'hardcover' | 'open-library' | 'curated' | 'unknown';
  classificationConfidence?: 'structured' | 'explicit' | 'curated';
  seriesName?: string; seriesPosition?: string; workId?: string;
  ratings: Rating[]; warnings: string[];
}
export type ProviderBook = Omit<BookResult, 'ratings' | 'warnings'> & { rating: Rating; warnings?: string[] };
