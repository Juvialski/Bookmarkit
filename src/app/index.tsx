import { ScannerScreen } from '../screens/ScannerScreen';
import { useRecognition } from '../services/RecognitionContext';
export default function Scanner() {
  const session = useRecognition();
  return <ScannerScreen loading={session.loading} status={session.status} state={session.state} error={session.error} recognized={session.recognized} onScan={session.scan} onCover={session.cover} onRetry={session.reset} />;
}
