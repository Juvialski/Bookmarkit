import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { BackHandler } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { BookResult } from './src/models/book';
import { ScannerScreen } from './src/screens/ScannerScreen';
import { BookResultScreen } from './src/screens/BookResultScreen';
import { createCachedLookup, lookupBook } from './src/services/bookLookup';
import { createLocalCatalog } from './src/services/localCatalog';
import { createScanGate } from './src/utils/isbn';
export default function App() {
  return <SQLiteProvider databaseName="catalog-v2.db" assetSource={{ assetId: require('./assets/catalog-v2.db') }}><BookScanner /></SQLiteProvider>;
}
function BookScanner() {
  const db = useSQLiteContext();
  const lookupBookForSession = useMemo(() => createCachedLookup(isbn => lookupBook(isbn, undefined, createLocalCatalog(db))), [db]);
  const [book, setBook] = useState<BookResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const gate = useRef(createScanGate()).current;
  const back = useCallback(() => { setBook(null); setError(''); gate.reset(); }, [gate]);
  useEffect(() => { const handler = BackHandler.addEventListener('hardwareBackPress', () => {
    if (loading) return true;
    if (book) { back(); return true; } return false;
  }); return () => handler.remove(); }, [book, loading, back]);
  async function scan(isbn: string) {
    if (!gate.acquire(isbn)) return;
    setLoading(true); setError('');
    try { setBook(await lookupBookForSession(isbn)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Lookup failed. Please try again.'); gate.reset(); }
    finally { setLoading(false); }
  }
  return <SafeAreaProvider><StatusBar style="dark" />{book ? <BookResultScreen book={book} onScanAnother={back} /> : <ScannerScreen loading={loading} error={error} onScan={scan} onRetry={back} />}</SafeAreaProvider>;
}
