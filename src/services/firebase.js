import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { initializeAuth, getAuth, getReactNativePersistence, browserLocalPersistence } from 'firebase/auth';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const missingFirebaseConfig = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingFirebaseConfig.length > 0) {
  throw new Error(`Missing Firebase configuration: ${missingFirebaseConfig.join(', ')}`);
}

const hasExistingApp = getApps().length > 0;
const app = hasExistingApp ? getApp() : initializeApp(firebaseConfig);

const createAuth = () => {
  if (hasExistingApp) return getAuth(app);

  if (Platform.OS === 'web') {
    return initializeAuth(app, {
      persistence: browserLocalPersistence,
    });
  }

  return initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
};

export const auth = createAuth();
export const db = getFirestore(app);
export default app;
