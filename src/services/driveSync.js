import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import Constants from 'expo-constants';
import { collection, documentId, getDocs, limit, orderBy, query, startAfter, where } from 'firebase/firestore';
import { db } from './firebase';
import { getSecureItem, setSecureItem, deleteSecureItem } from './secureStorage';

const AUTH_KEY = 'sb_drive_auth';
const AUTH_FIELD_KEYS = {
  accessToken: `${AUTH_KEY}_accessToken`,
  idToken: `${AUTH_KEY}_idToken`,
  refreshToken: `${AUTH_KEY}_refreshToken`,
  expiresAt: `${AUTH_KEY}_expiresAt`,
  email: `${AUTH_KEY}_email`,
  firebaseUid: `${AUTH_KEY}_firebaseUid`,
};
const ENABLE_KEY = 'sb_drive_sync_enabled';
const FILE_ID_KEY = 'sb_drive_file_id';
const FOLDER_ID_KEY = 'sb_drive_folder_id';
const LAST_SYNC_KEY = 'sb_drive_last_sync';
const LAST_ERROR_KEY = 'sb_drive_last_error';
const LOCAL_BACKUP_NAME = 'sitebook_backup.json';

const MIN_INTERVAL_MS = 15000;
const DEBOUNCE_MS = 3000;
const DRIVE_FETCH_TIMEOUT_MS = 12000;
const BACKUP_PAGE_SIZE = 500;

let syncTimer = null;
let lastSyncAt = 0;
let inFlight = false;
let pendingSync = false;
let pendingUserId = null;

const isTokenValid = (auth) => {
  if (!auth?.accessToken) return false;
  if (!auth?.expiresAt) return true;
  return Date.now() < auth.expiresAt - 30 * 1000;
};

export const setDriveAuth = async (auth) => {
  // FIX P2S3: Store OAuth token fields in SecureStore instead of AsyncStorage.
  const entries = Object.entries(AUTH_FIELD_KEYS);
  await Promise.all(entries.map(([field, key]) => {
    const value = auth?.[field];
    return value == null || value === ''
      ? deleteSecureItem(key)
      : setSecureItem(key, String(value));
  }));
};

export const getDriveAuth = async () => {
  const entries = await Promise.all(
    Object.entries(AUTH_FIELD_KEYS).map(async ([field, key]) => [field, await getSecureItem(key)])
  );
  const auth = Object.fromEntries(entries);
  if (!auth.accessToken) return null;
  return {
    ...auth,
    expiresAt: auth.expiresAt ? Number(auth.expiresAt) : null,
  };
};

export const clearDriveAuth = async () => {
  await Promise.all(Object.values(AUTH_FIELD_KEYS).map(deleteSecureItem));
  await AsyncStorage.multiRemove([AUTH_KEY, FILE_ID_KEY, FOLDER_ID_KEY]);
};

export const migrateLegacyDriveAuthToSecureStore = async () => {
  const raw = await AsyncStorage.getItem(AUTH_KEY);
  if (!raw) return false;
  await setDriveAuth(JSON.parse(raw));
  await AsyncStorage.removeItem(AUTH_KEY);
  return true;
};

export const setDriveSyncEnabled = async (enabled) => {
  await AsyncStorage.setItem(ENABLE_KEY, enabled ? '1' : '0');
};

export const getDriveSyncEnabled = async () => {
  const v = await AsyncStorage.getItem(ENABLE_KEY);
  return v === '1';
};

export const getDriveSyncMeta = async () => {
  const [lastSync, lastError] = await AsyncStorage.multiGet([LAST_SYNC_KEY, LAST_ERROR_KEY]);
  return {
    lastSyncAt: lastSync?.[1] ? Number(lastSync[1]) : null,
    lastError: lastError?.[1] || null,
  };
};

const setLastSync = async () => {
  const ts = Date.now();
  await AsyncStorage.setItem(LAST_SYNC_KEY, String(ts));
  await AsyncStorage.removeItem(LAST_ERROR_KEY);
  return ts;
};

const setLastError = async (msg) => {
  await AsyncStorage.setItem(LAST_ERROR_KEY, msg || 'Unknown error');
};

const getGoogleAuthExtra = () => {
  return (Constants.expoConfig || Constants.manifest)?.extra?.googleAuth || {};
};

const refreshDriveAccessToken = async (auth) => {
  const refreshToken = auth?.refreshToken;
  const clientId = getGoogleAuthExtra()?.webClientId;

  if (!refreshToken || !clientId) {
    throw new Error('Google Drive token expired. Please reconnect.');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }).toString();

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) {
    throw new Error('Google Drive token refresh failed. Please reconnect.');
  }

  const data = await res.json();
  const nextAuth = {
    ...auth,
    accessToken: data.access_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
    refreshToken: data.refresh_token || refreshToken,
    idToken: data.id_token || auth?.idToken || '',
  };
  await setDriveAuth(nextAuth);
  return nextAuth;
};

const getUsableDriveAuth = async () => {
  const auth = await getDriveAuth();
  if (isTokenValid(auth)) return auth;
  return refreshDriveAccessToken(auth);
};

const fetchWithTimeout = async (url, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DRIVE_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const driveFetch = async (url, accessToken, options = {}) => {
  const fetchOptions = {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  };

  try {
    // FIX P3M7: Add a timeout and one network-error retry for Google Drive requests.
    return await fetchWithTimeout(url, fetchOptions);
  } catch (e) {
    return fetchWithTimeout(url, fetchOptions);
  }
};

const ensureFolder = async (accessToken) => {
  const existingId = await AsyncStorage.getItem(FOLDER_ID_KEY);
  if (existingId) return existingId;

  const q = encodeURIComponent(
    "name='SiteBook' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents"
  );
  const listUrl = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`;
  const listRes = await driveFetch(listUrl, accessToken);
  if (listRes.ok) {
    const data = await listRes.json();
    if (data.files?.length) {
      const id = data.files[0].id;
      await AsyncStorage.setItem(FOLDER_ID_KEY, id);
      return id;
    }
  }

  const createRes = await driveFetch('https://www.googleapis.com/drive/v3/files', accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'SiteBook',
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  if (!createRes.ok) {
    throw new Error('Could not create Google Drive folder.');
  }
  const created = await createRes.json();
  await AsyncStorage.setItem(FOLDER_ID_KEY, created.id);
  return created.id;
};

const ensureFile = async (accessToken, folderId, content) => {
  const cachedId = await AsyncStorage.getItem(FILE_ID_KEY);
  if (cachedId) return cachedId;

  const q = encodeURIComponent(
    "name='sitebook_backup.json' and trashed=false and '" + folderId + "' in parents"
  );
  const listUrl = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`;
  const listRes = await driveFetch(listUrl, accessToken);
  if (listRes.ok) {
    const data = await listRes.json();
    if (data.files?.length) {
      const id = data.files[0].id;
      await AsyncStorage.setItem(FILE_ID_KEY, id);
      return id;
    }
  }

  const boundary = 'sb_drive_boundary';
  const meta = {
    name: 'sitebook_backup.json',
    parents: [folderId],
  };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  const createUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  const createRes = await driveFetch(createUrl, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!createRes.ok) {
    throw new Error('Could not create Google Drive backup file.');
  }
  const created = await createRes.json();
  await AsyncStorage.setItem(FILE_ID_KEY, created.id);
  return created.id;
};

const fetchCollectionData = async (userId, collectionName) => {
  const rows = [];
  let lastDoc = null;

  while (true) {
    const clauses = [
      where('userId', '==', userId),
      orderBy(documentId()),
      limit(BACKUP_PAGE_SIZE),
    ];
    if (lastDoc) clauses.push(startAfter(lastDoc));

    const snap = await getDocs(query(collection(db, collectionName), ...clauses));
    rows.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    if (snap.docs.length < BACKUP_PAGE_SIZE) break;
    lastDoc = snap.docs[snap.docs.length - 1];
  }

  return rows;
};

const fetchAllData = async (userId) => {
  const collections = ['sites', 'workers', 'advances', 'holidays', 'attendance'];
  const [sites, workers, advances, holidays, attendance] = await Promise.all(
    collections.map((collectionName) => fetchCollectionData(userId, collectionName))
  );

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    userId,
    sites,
    workers,
    advances,
    holidays,
    attendance,
  };
};

const saveLocalBackup = async (data) => {
  const fileUri = FileSystem.documentDirectory + LOCAL_BACKUP_NAME;
  const content = JSON.stringify(data);
  await FileSystem.writeAsStringAsync(fileUri, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  return fileUri;
};

export const syncToDriveNow = async (userId) => {
  const enabled = await getDriveSyncEnabled();
  if (!enabled || !userId) return false;

  const data = await fetchAllData(userId);
  await saveLocalBackup(data);
  const content = JSON.stringify(data);

  const auth = await getUsableDriveAuth();

  const folderId = await ensureFolder(auth.accessToken);
  const fileId = await ensureFile(auth.accessToken, folderId, content);

  const updateUrl = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;
  const updateRes = await driveFetch(updateUrl, auth.accessToken, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: content,
  });

  if (!updateRes.ok) {
    const msg = `Drive sync failed (${updateRes.status})`;
    await setLastError(msg);
    throw new Error(msg);
  }

  lastSyncAt = await setLastSync();
  return true;
};

export const queueDriveSync = async (userId, reason = '') => {
  const enabled = await getDriveSyncEnabled();
  if (!enabled || !userId) return;

  try {
    await getUsableDriveAuth();
  } catch (e) {
    // Still save local copy even if Drive token is expired
    try {
      const data = await fetchAllData(userId);
      await saveLocalBackup(data);
      await setLastError(e?.message || 'Google Drive token expired. Please reconnect.');
    } catch (backupError) {
      // Ignore local backup errors here
    }
    return;
  }

  const now = Date.now();
  const sinceLast = now - lastSyncAt;
  const delay = sinceLast > MIN_INTERVAL_MS ? DEBOUNCE_MS : MIN_INTERVAL_MS - sinceLast;

  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    if (inFlight) {
      // FIX P1H4: Remember writes queued during an active sync and run one follow-up full backup.
      pendingSync = true;
      pendingUserId = userId;
      return;
    }
    inFlight = true;
    try {
      // Always write a local backup first
      const data = await fetchAllData(userId);
      await saveLocalBackup(data);
      await syncToDriveNow(userId);
    } catch (e) {
      await setLastError(e?.message || 'Drive sync failed.');
    } finally {
      inFlight = false;
      if (pendingSync) {
        const nextUserId = pendingUserId || userId;
        pendingSync = false;
        pendingUserId = null;
        void queueDriveSync(nextUserId, 'pending');
      }
    }
  }, delay);
};
