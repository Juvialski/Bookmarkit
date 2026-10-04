import { useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { BookResult } from './src/models/book';
import { ScannerScreen } from './src/screens/ScannerScreen';
import { BookResultScreen } from './src/screens/BookResultScreen';
import { lookupBook } from './src/services/bookLookup';
import { createScanGate } from './src/utils/isbn';
export default function App() {
  const [book, setBook] = useState<BookResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const gate = useRef(createScanGate()).current;
  const back = () => { setBook(null); setError(''); gate.reset(); };
  useEffect(() => { const handler = BackHandler.addEventListener('hardwareBackPress', () => {
    if (loading) return true;
    if (book) { back(); return true; } return false;
  }); return () => handler.remove(); }, [book, loading]);
  async function scan(isbn: string) {
    if (!gate.acquire(isbn)) return;
    setLoading(true); setError('');
    try { setBook(await lookupBook(isbn)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Lookup failed. Please try again.'); gate.reset(); }
    finally { setLoading(false); }
  }
  return <SafeAreaProvider><StatusBar style="dark" />{book ? <BookResultScreen book={book} onScanAnother={back} /> : <ScannerScreen loading={loading} error={error} onScan={scan} onRetry={back} />}</SafeAreaProvider>;
}
