import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Button, Keyboard, Linking, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isValidIsbn } from '../utils/isbn';
export function ScannerScreen({ loading, error, onScan, onRetry }: { loading: boolean; error: string; onScan: (isbn: string) => void; onRetry: () => void }) {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [isbn, setIsbn] = useState('');
  const [invalid, setInvalid] = useState('');
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [cameraError, setCameraError] = useState(false);
  useEffect(() => { const sub = AppState.addEventListener('change', state => { setActive(state === 'active'); if (state === 'active') void getPermission(); }); return () => sub.remove(); }, [getPermission]);
  function submit(value: string) {
    if (!isValidIsbn(value)) { setInvalid('Use a valid ISBN-13 barcode beginning with 978 or 979.'); return; }
    setInvalid(''); Keyboard.dismiss(); onScan(value);
  }
  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.brand}>Bookmarkit</Text><Text style={styles.heading}>Scan a book</Text>
    <Text style={styles.help}>Point your camera at the ISBN barcode on the back cover.</Text>
    <View style={styles.camera}>
      {permission?.granted && active && !loading && !cameraError ? <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['ean13'] }} onBarcodeScanned={error ? undefined : ({ data }) => submit(data)} onMountError={() => setCameraError(true)} /> :
        <View style={styles.cameraMessage}>{loading ? <><ActivityIndicator size="large" /><Text>Looking up your book…</Text></> : cameraError ? <><Text>Camera could not start. Enter an ISBN below.</Text><Button title="Retry camera" onPress={() => setCameraError(false)} /></> : !permission ? <ActivityIndicator /> : !permission.granted ? <><Text style={styles.help}>Allow camera access to scan books. Manual lookup works without it.</Text><Button title={permission.canAskAgain ? 'Allow camera' : 'Open settings'} onPress={() => { if (permission.canAskAgain) void requestPermission(); else void Linking.openSettings(); }} /></> : <Text>Camera paused</Text>}</View>}
    </View>
    {!!(error || invalid) && <Text accessibilityRole="alert" style={styles.error}>{error || invalid}</Text>}
    {!!error && <Button title="Resume scanner" onPress={onRetry} />}
    <Text style={styles.label}>Or enter an ISBN-13</Text>
    <TextInput accessibilityLabel="ISBN-13" style={styles.input} value={isbn} onChangeText={setIsbn} placeholder="9780140328721" keyboardType="number-pad" editable={!loading} onSubmitEditing={() => submit(isbn)} />
    <Button title="Look up book" disabled={loading} onPress={() => submit(isbn)} />
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: '#f7f5ee' }, content: { padding: 24, gap: 16 }, brand: { fontSize: 16, fontWeight: '700', color: '#356455' }, heading: { fontSize: 32, fontWeight: '700', color: '#182a24' }, help: { fontSize: 16, lineHeight: 24, color: '#536259' }, camera: { height: 310, borderRadius: 16, overflow: 'hidden', backgroundColor: '#e1e7df' }, cameraMessage: { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center', gap: 16 }, label: { fontWeight: '600', fontSize: 16 }, input: { backgroundColor: '#fff', borderColor: '#b4c3b9', borderWidth: 1, padding: 14, borderRadius: 8, fontSize: 18 }, error: { color: '#9b3027', lineHeight: 22 } });
