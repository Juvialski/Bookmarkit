import { BookResult } from '../models/book';

export interface Box { x: number; y: number; width: number; height: number }
export interface OcrLine { text: string; boundingBox?: Box; confidence?: number }
export interface OcrBlock extends OcrLine { lines?: OcrLine[] }
export interface CoverText { text: string; blocks: OcrBlock[] }
export interface BookQuery { confidence?: number; titleBox?: Box; authorBox?: Box; rawOcrText?: string; isbn?: string; title?: string; author?: string; text?: string; origin?: 'cover' | 'manual' }
export interface RecognitionRequest extends BookQuery { candidates?: BookQuery[] }
export type Identification = { kind: 'book'; book: BookResult } | { kind: 'candidates'; books: BookResult[] };
// A future central catalog implements the same boundary. No database/provider
// knowledge belongs in the camera or OCR interpreter.
export interface BookCatalog {
  search(query: BookQuery): Promise<BookResult[]>;
}
