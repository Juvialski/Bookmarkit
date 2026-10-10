import { useEffect } from 'react';
import { BackHandler } from 'react-native';
import { Redirect } from 'expo-router';
import { BookResultScreen } from '../screens/BookResultScreen';
import { useRecognition } from '../services/RecognitionContext';
import { coverIdentity } from '../utils/covers';
export default function Result() {
  const { book, reset } = useRecognition();
  useEffect(() => { const sub = BackHandler.addEventListener('hardwareBackPress', () => { reset(); return true; }); return () => sub.remove(); }, [reset]);
  return book ? <BookResultScreen key={coverIdentity(book)} book={book} onScanAnother={reset} /> : <Redirect href="/" />;
}
