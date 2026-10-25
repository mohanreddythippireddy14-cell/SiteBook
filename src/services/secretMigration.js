import AsyncStorage from '@react-native-async-storage/async-storage';
import { migrateAsyncStorageItemToSecureStore } from './secureStorage';
import { setDriveAuth } from './driveSync';

const PIN_KEY = 'sitebook_pin';
const DRIVE_AUTH_KEY = 'sb_drive_auth';

// Manual only: call once on app open if you choose to migrate legacy AsyncStorage secrets.
export const migrateLegacySecretsToSecureStore = async () => {
  const migratedPin = await migrateAsyncStorageItemToSecureStore(PIN_KEY);
  const rawDriveAuth = await AsyncStorage.getItem(DRIVE_AUTH_KEY);
  if (!rawDriveAuth) {
    return { pin: migratedPin, driveAuth: false };
  }

  await setDriveAuth(JSON.parse(rawDriveAuth));
  await AsyncStorage.removeItem(DRIVE_AUTH_KEY);
  return { pin: migratedPin, driveAuth: true };
};
