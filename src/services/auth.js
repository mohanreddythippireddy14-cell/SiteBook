import {
  signInAnonymously,
  signInWithCredential,
  GoogleAuthProvider,
  onAuthStateChanged,
  linkWithCredential,
} from 'firebase/auth';
import { auth } from './firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const UID_BACKUP_KEY = 'sitebook_uid_backup';

// FIX BUG-08: persist UID backup in AsyncStorage
// If user reinstalls → we detect mismatch and warn them
export const initAuth = (onUser, onError) => {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      // Backup the UID locally every time we have a valid user
      await AsyncStorage.setItem(UID_BACKUP_KEY, user.uid);
      onUser(user);
    } else {
      try {
        // Try anonymous sign-in
        const cred = await signInAnonymously(auth);
        // Check if this is a NEW anonymous user after reinstall
        const savedUid = await AsyncStorage.getItem(UID_BACKUP_KEY);
        if (savedUid && savedUid !== cred.user.uid) {
          // Different UID — data is under old UID — warn user
          onError('DATA_MISMATCH', savedUid, cred.user.uid);
          return;
        }
        await AsyncStorage.setItem(UID_BACKUP_KEY, cred.user.uid);
        onUser(cred.user);
      } catch (e) {
        console.error('Auth error:', e);
        onError('AUTH_FAILED', null, null);
      }
    }
  });
};

export const getSavedUid = () => AsyncStorage.getItem(UID_BACKUP_KEY);
export const clearSavedUid = () => AsyncStorage.removeItem(UID_BACKUP_KEY);
