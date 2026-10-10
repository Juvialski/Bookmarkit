import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RecognitionProvider } from '../services/RecognitionContext';
import { OfflineCatalogProvider } from '../services/OfflineCatalogContext';

export default function Layout() {
  return <SafeAreaProvider><StatusBar style="dark" /><SQLiteProvider databaseName="catalog-v3.db" assetSource={{ assetId: require('../../assets/catalog-v3.db') }}>
    <OfflineCatalogProvider><RecognitionProvider><Stack screenOptions={{ headerShown: false, animation: 'fade', gestureEnabled: false, statusBarStyle: 'dark', contentStyle: { backgroundColor: '#F7F4ED' } }} /></RecognitionProvider></OfflineCatalogProvider>
  </SQLiteProvider></SafeAreaProvider>;
}
