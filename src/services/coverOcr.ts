import { recognizeText } from 'expo-ocr-kit';
import { File, Paths } from 'expo-file-system';
import { CoverText } from '../recognition/types';

export function cleanupCover(uri: string) {
  try {
    const image = new File(uri);
    // Never delete the user's original gallery asset.
    if (image.uri.startsWith(`${Paths.cache.uri.replace(/\/$/, '')}/`) && image.exists) image.delete();
  } catch { /* Cleanup must not misreport successful OCR. */ }
}
export async function readCover(uri: string): Promise<CoverText> {
  if (!uri.startsWith('file://')) throw new Error('A local camera image is required.');
  try {
    const result = await recognizeText(uri);
    // Preserve native block geometry. No invented line boxes or confidence.
    return { text: result.text, blocks: result.blocks };
  } finally { cleanupCover(uri); }
}
