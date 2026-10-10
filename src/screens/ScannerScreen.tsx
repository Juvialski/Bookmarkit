import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, Pressable, Keyboard, Linking, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { launchImageLibraryAsync } from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Action as Button, Brand, palette, serif } from '../components/Editorial';
import { cleanupCover } from '../services/coverOcr';
import { ScanState } from '../recognition/session';
import { isValidIsbn } from '../utils/isbn';
import { groundedSearch, groundingAvailable, SearchEvidence } from '../services/groundedSearch';
import { GroundedEvidence } from '../components/GroundedEvidence';
export function ScannerScreen({ loading, status, state, error, recognized, onScan, onCover, onRetry }: { loading: boolean; status: string; state: ScanState; error: string; recognized: string; onScan: (value: string, author?: string) => void; onCover: (uri: string) => Promise<void>; onRetry: () => void }) {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [draft, setDraft] = useState({ source: recognized, value: recognized });
  const query = draft.source === recognized ? draft.value : recognized;
  const setQuery = (value: string) => setDraft({ source: recognized, value });
  const [author, setAuthor] = useState('');
  const [invalid, setInvalid] = useState('');
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [cameraError, setCameraError] = useState(false);
  const [permissionError, setPermissionError] = useState('');
  const [torch, setTorch] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [manual, setManual] = useState(false);
  const [evidence, setEvidence] = useState<SearchEvidence | null>(null), [grounding, setGrounding] = useState(false);
  const [groundingEnabled, setGroundingEnabled] = useState(false);
  useEffect(() => { let active = true; void groundingAvailable().then(enabled => { if (active) setGroundingEnabled(enabled); }); return () => { active = false; }; }, []);
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => { setFocused(true); return () => { setFocused(false); setReady(false); }; }, []));
  const camera = useRef<CameraView>(null);
  const captureGate = useRef(false);
  const captureId = useRef(0);
  const choosingPhoto = useRef(false);
  const refreshPermission = useCallback(async () => {
    try { await getPermission(); setPermissionError(''); } catch { setPermissionError('Camera access could not be checked. Retry or use Search.'); }
  }, [getPermission]);
  useEffect(() => { const sub = AppState.addEventListener('change', state => {
    if (state !== 'active' && !choosingPhoto.current) { captureId.current++; captureGate.current = false; setCapturing(false); }
    setActive(state === 'active'); setTorch(false); setReady(false);
    if (state === 'active') { setCameraError(false); void refreshPermission(); }
  }); return () => sub.remove(); }, [refreshPermission]);
  async function recoverPermission() {
    try { if (permission?.canAskAgain) await requestPermission(); else await Linking.openSettings(); setPermissionError(''); }
    catch { setPermissionError('Camera access could not be opened. Retry or use Search.'); }
  }
  function submit(value: string) {
    if (loading || captureGate.current || !focused || !active || AppState.currentState !== 'active') return;
    setInvalid(''); setTorch(false); setReady(false); Keyboard.dismiss(); onScan(value, author || undefined);
  }
  function cancelCapture() {
    captureId.current++; captureGate.current = false; choosingPhoto.current = false;
    setCapturing(false); setReady(false); setTorch(false); setCameraKey(value => value + 1); onRetry();
  }
  async function capture(photoLibrary = false) {
    if (loading || captureGate.current || !active || (!photoLibrary && !ready)) return;
    const id = ++captureId.current;
    choosingPhoto.current = photoLibrary;
    captureGate.current = true; setCapturing(true); setReady(photoLibrary ? ready : false); setInvalid('');
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    try {
      const operation = photoLibrary ? launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 }) : camera.current?.takePictureAsync({ quality: 0.8 });
      // A late native capture after cancel/timeout must not leak its cache file.
      void operation?.then(picture => {
        const uri = picture && ('canceled' in picture ? !picture.canceled && picture.assets[0]?.uri : picture.uri);
        if (uri && (expired || id !== captureId.current)) cleanupCover(uri);
      }).catch(() => {});
      const picture = await (photoLibrary ? operation : Promise.race([operation, new Promise<never>((_, reject) => { timeout = setTimeout(() => { expired = true; reject(new Error('Capture timed out')); }, 10000); })]));
      clearTimeout(timeout);
      const uri = picture && ('canceled' in picture ? !picture.canceled && picture.assets[0]?.uri : picture.uri);
      choosingPhoto.current = false;
      if (uri && id === captureId.current) { setTorch(false); await onCover(uri); } else if (uri) cleanupCover(uri);
    } catch { if (id === captureId.current) setInvalid('Photo could not be captured. Try again or use Search.'); }
    finally {
      clearTimeout(timeout);
      if (id === captureId.current) { choosingPhoto.current = false; captureGate.current = false; setCapturing(false); setReady(false); setCameraKey(value => value + 1); }
    }
  }
  const scanState: ScanState = capturing && !loading ? 'capturing' : state;
  const cameraVisible = permission?.granted && focused && active && !loading && !error && !cameraError;
  return <SafeAreaView style={styles.page}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="on-drag">
    <View style={styles.header}><Brand /><Pressable accessibilityRole="button" accessibilityLabel="Offline Books" onPress={() => router.push('/offline')} style={styles.offline}><Text style={styles.offlineText}>Offline books</Text></Pressable></View><Text style={styles.heading}>Scan a book</Text><Text style={styles.help}>Point at a book cover</Text>
    <View style={styles.camera}>
      {cameraVisible ? <><CameraView key={cameraKey} ref={camera} style={StyleSheet.absoluteFill} facing="back" autofocus="on" enableTorch={torch} onCameraReady={() => setReady(true)} barcodeScannerSettings={{ barcodeTypes: ['ean13', 'code128'] }} onBarcodeScanned={({ data }) => { if (!loading && !capturing && !captureGate.current && active && focused && !error && isValidIsbn(data)) { setTorch(false); setReady(false); onScan(data); } }} onMountError={() => { setCameraError(true); setReady(false); setTorch(false); }} /><View pointerEvents="none" style={styles.guide} /></> :
        <View style={styles.cameraMessage}>{loading ? <><ActivityIndicator size="large" /><Text>{status}</Text></> : cameraError ? <><Text>Camera could not start. Use Search.</Text><Button title="Retry camera" onPress={() => setCameraError(false)} /></> : !permission ? <><ActivityIndicator /><Button title="Retry camera access" onPress={() => void refreshPermission()} /></> : !permission.granted ? <><Text style={styles.help}>Allow camera to scan books.</Text><Button title={permission.canAskAgain ? 'Allow camera' : 'Open settings'} onPress={() => void recoverPermission()} /></> : <Text>Camera paused</Text>}</View>}
    {cameraVisible && <Pressable accessibilityRole="button" accessibilityLabel={torch ? 'Torch off' : 'Torch on'} accessibilityState={{ selected: torch }} disabled={capturing} onPress={() => setTorch(value => !value)} style={styles.torch}><Text style={styles.torchText}>ϟ</Text></Pressable>}
    </View>
    <Button title={scanState === 'capturing' ? 'Capturing…' : 'Scan Book'} disabled={!cameraVisible || !ready || capturing || loading} onPress={() => void capture()} />
    {!!permissionError && <Text accessibilityRole="alert" style={styles.error}>{permissionError}</Text>}
    {!!(error || invalid) && <Text accessibilityRole="alert" style={styles.error}>{error || invalid}</Text>}
    {!!error && <Button title="Resume scanner" onPress={onRetry} />}
    <View style={styles.secondary}><Button quiet title="Choose Photo" disabled={loading || capturing} onPress={() => void capture(true)} /><Button quiet title="Search" disabled={loading || capturing} onPress={() => setManual(value => !value)} /></View>
    {(loading || capturing) && <Button title="Cancel" onPress={cancelCapture} />}
    {(manual || !!error || !!recognized) && <><TextInput accessibilityLabel="Title, author, or ISBN" style={styles.input} value={query} onChangeText={setQuery} maxLength={240} placeholder="Title, author, or ISBN" autoCorrect={false} editable={!loading && !capturing} returnKeyType="search" onSubmitEditing={() => submit(query)} />
      <TextInput accessibilityLabel="Author (optional)" style={styles.input} value={author} onChangeText={setAuthor} maxLength={160} placeholder="Author (optional)" editable={!loading && !capturing} />
      <Button title="Look up book" disabled={loading || capturing} onPress={() => submit(query)} /></>}
    {!!error && groundingEnabled && <Button quiet title={grounding ? 'Searching…' : 'Search with Google'} disabled={grounding} onPress={() => { setGrounding(true); void groundedSearch(query || recognized).then(result => { setEvidence(result); if (!result) setInvalid('Search unavailable. Try again.'); }).finally(() => setGrounding(false)); }} />}
    <GroundedEvidence evidence={evidence} close={() => setEvidence(null)} />
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: palette.paper }, content: { padding: 24, paddingBottom: 28, gap: 10 }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, offline: { minHeight: 48, justifyContent: 'center', paddingLeft: 8 }, offlineText: { color: palette.forest, fontSize: 13 }, heading: { fontFamily: serif, fontSize: 34, color: palette.ink, marginTop: 16 }, help: { fontSize: 15, lineHeight: 23, color: palette.muted }, camera: { height: 330, borderRadius: 4, overflow: 'hidden', backgroundColor: palette.sage, marginVertical: 12 }, guide: { position: 'absolute', left: '14%', right: '14%', top: '10%', bottom: '10%', borderWidth: 1, borderColor: palette.paper, borderRadius: 2 }, secondary: { flexDirection: 'row', justifyContent: 'space-between' }, torch: { position: 'absolute', bottom: 8, right: 8, backgroundColor: palette.paper, borderRadius: 24, minHeight: 48, minWidth: 48, alignSelf: 'flex-end', justifyContent: 'center', alignItems: 'center' }, torchText: { color: palette.forest, fontSize: 30 }, cameraMessage: { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center', gap: 16 }, input: { backgroundColor: '#fffdf8', borderBottomColor: palette.sage, borderBottomWidth: 1, padding: 14, fontSize: 17, color: palette.ink }, error: { color: '#8B2D24', lineHeight: 22 } });
