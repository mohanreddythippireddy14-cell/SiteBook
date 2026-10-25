import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

let isSecureAvailable = null;

const checkAvailability = async () => {
  if (isSecureAvailable === null) {
    try {
      isSecureAvailable = await SecureStore.isAvailableAsync();
    } catch (e) {
      isSecureAvailable = false;
    }
  }
  return isSecureAvailable;
};

export const isSecureStorageAvailable = checkAvailability;

const allowPlainStorageFallback = () => Platform.OS === 'web';

export const getSecureItem = async (key) => {
  const secure = await checkAvailability();
  if (secure) {
    return SecureStore.getItemAsync(key, OPTIONS);
  }
  if (!allowPlainStorageFallback()) {
    throw new Error('Secure storage is unavailable on this device.');
  }
  return AsyncStorage.getItem(key);
};

export const setSecureItem = async (key, value) => {
  const secure = await checkAvailability();
  if (secure) {
    await SecureStore.setItemAsync(key, String(value ?? ''), OPTIONS);
  } else if (!allowPlainStorageFallback()) {
    throw new Error('Secure storage is unavailable on this device.');
  } else {
    await AsyncStorage.setItem(key, String(value ?? ''));
  }
};

export const deleteSecureItem = async (key) => {
  const secure = await checkAvailability();
  if (secure) {
    await SecureStore.deleteItemAsync(key, OPTIONS);
  } else if (!allowPlainStorageFallback()) {
    throw new Error('Secure storage is unavailable on this device.');
  } else {
    await AsyncStorage.removeItem(key);
  }
};

// Manual only: call from app startup once if you choose to migrate old AsyncStorage secrets.
export const migrateAsyncStorageItemToSecureStore = async (key) => {
  const secure = await checkAvailability();
  if (!secure) return false;
  const existing = await AsyncStorage.getItem(key);
  if (existing == null) return false;
  await setSecureItem(key, existing);
  await AsyncStorage.removeItem(key);
  return true;
};
