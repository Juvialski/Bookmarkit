export type Provider = 'Google Books' | 'Open Library';
export interface Rating { provider: Provider; average?: number; count?: number; unavailable?: boolean }
export interface BookResult {
  source?: 'offline-catalog';
  isbn: string; title: string; authors: string[]; coverUrl?: string;
  seriesStatus: 'series' | 'standalone' | 'unknown';
  seriesName?: string; seriesPosition?: string; workId?: string;
  ratings: Rating[]; warnings: string[];
}
export type ProviderBook = Omit<BookResult, 'ratings' | 'warnings'> & { rating: Rating; warnings?: string[] };
