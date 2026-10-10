import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RecognitionProvider } from '../services/RecognitionContext';

export default function Layout() {
  return <SafeAreaProvider><StatusBar style="dark" /><SQLiteProvider databaseName="catalog-v3.db" assetSource={{ assetId: require('../../assets/catalog-v3.db') }}>
    <RecognitionProvider><Stack screenOptions={{ headerShown: false, animation: 'none', gestureEnabled: false }} /></RecognitionProvider>
  </SQLiteProvider></SafeAreaProvider>;
}
