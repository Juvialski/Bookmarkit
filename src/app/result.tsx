import { Redirect } from 'expo-router';
import { BookResultScreen } from '../screens/BookResultScreen';
import { useRecognition } from '../services/RecognitionContext';
export default function Result() {
  const { book, reset } = useRecognition();
  return book ? <BookResultScreen key={book.isbn || book.workId || book.title} book={book} onScanAnother={reset} /> : <Redirect href="/" />;
}
