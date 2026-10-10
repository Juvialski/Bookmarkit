import { Linking, Modal, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Action, palette } from './Editorial';
import { SearchEvidence } from '../services/groundedSearch';
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function GroundedEvidence({ evidence, close }: { evidence: SearchEvidence | null; close: () => void }) {
  if (!evidence) return null;
  // Preserve the exact provider Search entry point. Grounded text and citations
  // remain together in a transient view; never export them to the catalog.
  const html = `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#F7F4ED;color:#17251F;font:17px/1.6 sans-serif;padding:16px}a{color:#1B3C34}p{white-space:pre-wrap}</style></head><body>${evidence.html}<p>${escape(evidence.text)}</p>${evidence.sources.map(s => `<p><a href="${escape(s.url)}">${escape(s.title)}</a></p>`).join('')}</body></html>`;
  return <Modal visible onRequestClose={close} animationType="fade"><SafeAreaView style={{ flex: 1, backgroundColor: palette.paper }}><View style={{ paddingHorizontal: 24 }}><Action quiet title="Close search" onPress={close} /></View><WebView source={{ html }} originWhitelist={['*']} javaScriptEnabled={false} onShouldStartLoadWithRequest={request => { if (request.url === 'about:blank') return true; if (request.url.startsWith('https://')) void Linking.openURL(request.url).catch(() => {}); return false; }} /></SafeAreaView></Modal>;
}
