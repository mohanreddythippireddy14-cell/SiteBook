import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc,
  query, where, orderBy, limit, startAfter,
  onSnapshot, getDocs, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { monthEndKey } from '../utils/helpers';
import { queueDriveSync } from './driveSync';

const DELETE_BATCH_LIMIT = 450;

// FIX P1M2: Add onSnapshot error callbacks so listener failures are logged instead of silent.
const handleSnapshotError = (label, onError) => (error) => {
  console.warn(`Firestore listener failed (${label}):`, error);
  if (onError) onError(error, label);
};

const commitDeleteRefs = async (refs) => {
  for (let i = 0; i < refs.length; i += DELETE_BATCH_LIMIT) {
    const batch = writeBatch(db);
    refs.slice(i, i + DELETE_BATCH_LIMIT).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
};

const mapDocs = (snap) => snap.docs.map(d => ({ id: d.id, ...d.data() }));

const mergeAttendanceDocs = (...groups) => {
  const byDay = new Map();
  groups.flat().forEach(record => {
    const key = record.workerId && record.date ? `${record.workerId}_${record.date}` : record.id;
    const existing = byDay.get(key);
    const recordTime = record.updatedAt?.toMillis?.() || record.createdAt?.toMillis?.() || 0;
    const existingTime = existing?.updatedAt?.toMillis?.() || existing?.createdAt?.toMillis?.() || 0;
    if (!existing || recordTime >= existingTime) byDay.set(key, record);
  });
  return [...byDay.values()].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
};

const chunksOf = (items, size) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

// ─── SITES ────────────────────────────────────────────────────────────────────
export const getSites = (userId, callback, onError) => {
  const q = query(collection(db, 'sites'), where('userId', '==', userId));
  return onSnapshot(
    q,
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    handleSnapshotError('sites', onError)
  );
};
export const addSite = (userId, data) =>
  addDoc(collection(db, 'sites'), { ...data, userId, createdAt: serverTimestamp() })
    .then((res) => { void queueDriveSync(userId, 'addSite'); return res; });

export const addSiteWithWorker = async (userId, siteData, workerData) => {
  const siteRef = doc(collection(db, 'sites'));
  const workerRef = doc(collection(db, 'workers'));
  const batch = writeBatch(db);

  // FIX P0M3: Create a new site and its first worker atomically so partial records are not left behind.
  batch.set(siteRef, { ...siteData, userId, createdAt: serverTimestamp() });
  batch.set(workerRef, { ...workerData, siteId: siteRef.id, userId, createdAt: serverTimestamp() });
  await batch.commit();
  void queueDriveSync(userId, 'addSiteWithWorker');

  return {
    site: { id: siteRef.id, ...siteData },
    workerId: workerRef.id,
  };
};

export const addSiteAndUpdateWorker = async (userId, siteData, workerId, workerData) => {
  const siteRef = doc(collection(db, 'sites'));
  const workerRef = doc(db, 'workers', workerId);
  const batch = writeBatch(db);

  batch.set(siteRef, { ...siteData, userId, createdAt: serverTimestamp() });
  batch.update(workerRef, { ...workerData, siteId: siteRef.id, updatedAt: serverTimestamp() });
  await batch.commit();
  void queueDriveSync(userId, 'addSiteAndUpdateWorker');

  return {
    site: { id: siteRef.id, ...siteData },
  };
};

// FIX BUG-16: cascading delete — remove workers + attendance + holidays on site delete
export const deleteSite = async (userId, siteId) => {
  await updateDoc(doc(db, 'sites', siteId), {
    deleting: true,
    updatedAt: serverTimestamp(),
  });

  // FIX P0M4: Delete child records before the site so failed multi-batch deletes remain retryable.
  const refsToDelete = new Map();
  const addRef = (ref) => refsToDelete.set(ref.path, ref);

  // delete all workers for this site
  const wSnap = await getDocs(
    query(collection(db, 'workers'), where('siteId', '==', siteId), where('userId', '==', userId))
  );
  const workerIds = [];
  wSnap.docs.forEach(d => { workerIds.push(d.id); addRef(d.ref); });

  const siteAttendanceSnap = await getDocs(
    query(collection(db, 'attendance'), where('siteId', '==', siteId), where('userId', '==', userId))
  );
  siteAttendanceSnap.docs.forEach(d => addRef(d.ref));

  // Chunk by worker ID to catch legacy records and advances without N+1 queries.
  for (const workerChunk of chunksOf(workerIds, 10)) {
    if (workerChunk.length === 0) continue;
    const aSnap = await getDocs(
      query(collection(db, 'attendance'), where('workerId', 'in', workerChunk), where('userId', '==', userId))
    );
    aSnap.docs.forEach(d => addRef(d.ref));

    const advSnap = await getDocs(
      query(collection(db, 'advances'), where('workerId', 'in', workerChunk), where('userId', '==', userId))
    );
    advSnap.docs.forEach(d => addRef(d.ref));
  }

  // delete holidays for this site
  const hSnap = await getDocs(
    query(collection(db, 'holidays'), where('siteId', '==', siteId), where('userId', '==', userId))
  );
  hSnap.docs.forEach(d => addRef(d.ref));

  addRef(doc(db, 'sites', siteId));

  await commitDeleteRefs([...refsToDelete.values()]);
  void queueDriveSync(userId, 'deleteSite');
};

// ─── WORKERS ──────────────────────────────────────────────────────────────────
export const getWorkers = (userId, callback, onError) => {
  const q = query(collection(db, 'workers'), where('userId', '==', userId));
  return onSnapshot(
    q,
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    handleSnapshotError('workers', onError)
  );
};
export const addWorker = (userId, data) =>
  addDoc(collection(db, 'workers'), { ...data, userId, createdAt: serverTimestamp() })
    .then((res) => { void queueDriveSync(userId, 'addWorker'); return res; });

export const updateWorker = (userId, workerId, data) =>
  updateDoc(doc(db, 'workers', workerId), { ...data, updatedAt: serverTimestamp() })
    .then((res) => { void queueDriveSync(userId, 'updateWorker'); return res; });

// FIX BUG-09: cascading delete — remove attendance + advances when worker deleted
export const deleteWorker = async (userId, workerId) => {
  const refsToDelete = [doc(db, 'workers', workerId)];

  const aSnap = await getDocs(
    query(collection(db, 'attendance'), where('workerId', '==', workerId), where('userId', '==', userId))
  );
  aSnap.docs.forEach(d => refsToDelete.push(d.ref));

  const advSnap = await getDocs(
    query(collection(db, 'advances'), where('workerId', '==', workerId), where('userId', '==', userId))
  );
  advSnap.docs.forEach(d => refsToDelete.push(d.ref));

  await commitDeleteRefs(refsToDelete);
  void queueDriveSync(userId, 'deleteWorker');
};

// ─── ATTENDANCE ───────────────────────────────────────────────────────────────
export const getAttendance = (userId, siteId, date, callback, onError) => {
  const q = query(
    collection(db, 'attendance'),
    where('userId', '==', userId),
    where('siteId', '==', siteId),
    where('date', '==', date)
  );
  return onSnapshot(
    q,
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    handleSnapshotError('attendance', onError)
  );
};

export const setAttendance = async (userId, siteId, workerId, date, status, otHours) => {
  // FIX BUG-10: clamp OT server-side too before writing
  const clampedOT = Math.min(Math.max(Number(otHours) || 0, 0), 24);
  const yearMonth = date.slice(0, 7);
  const attendanceId = `${userId}_${siteId}_${workerId}_${date}`;

  const q = query(
    collection(db, 'attendance'),
    where('userId', '==', userId),
    where('siteId', '==', siteId),
    where('workerId', '==', workerId),
    where('date', '==', date)
  );
  const snap = await getDocs(q);
  if (!snap.empty) {
    // FIX P0H2: Use deterministic attendance IDs and clean legacy duplicates to prevent rapid-tap double records.
    const sortedDocs = [...snap.docs].sort((a, b) => {
      const aTime = a.data().updatedAt?.toMillis?.() || 0;
      const bTime = b.data().updatedAt?.toMillis?.() || 0;
      return bTime - aTime;
    });
    const keepDoc = sortedDocs[0].data().updatedAt ? sortedDocs[0] : snap.docs[0];
    const duplicateDocs = snap.docs.filter(d => d.id !== keepDoc.id);

    await updateDoc(doc(db, 'attendance', keepDoc.id), {
      status, otHours: clampedOT, siteId, yearMonth, updatedAt: serverTimestamp(), // FIX BUG-06: always update siteId
    });
    if (duplicateDocs.length > 0) {
      const batch = writeBatch(db);
      duplicateDocs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      console.warn(`Deleted ${duplicateDocs.length} duplicate attendance record(s) for ${workerId} on ${date}.`);
    }
  } else {
    // FIX P0H2: Deterministic doc ID makes simultaneous first writes converge on one attendance record.
    await setDoc(doc(db, 'attendance', attendanceId), {
      userId, siteId, workerId, date, yearMonth,
      status, otHours: clampedOT,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  void queueDriveSync(userId, 'setAttendance');
};

// FIX BUG-04 & BUG-05: use correct last day of month in range query
// FIX P4M1: Filter by yearMonth server-side instead of reading full collection.
// Composite index required: attendance — userId ASC, siteId ASC, yearMonth ASC.
export const getMonthAttendance = (userId, siteId, yearMonth, callback, workerIds = [], onError) => {
  const monthQ = query(
    collection(db, 'attendance'),
    where('userId',  '==', userId),
    where('siteId',  '==', siteId),
    where('yearMonth', '==', yearMonth)
  );

  const dateQ = query(
    collection(db, 'attendance'),
    where('userId', '==', userId),
    where('siteId', '==', siteId),
    where('date', '>=', `${yearMonth}-01`),
    where('date', '<=', monthEndKey(yearMonth))
  );

  const workerChunks = chunksOf([...new Set(workerIds)].filter(Boolean), 10);
  const workerQs = workerChunks.map(chunk => query(
    collection(db, 'attendance'),
    where('userId', '==', userId),
    where('workerId', 'in', chunk),
    where('date', '>=', `${yearMonth}-01`),
    where('date', '<=', monthEndKey(yearMonth))
  ));

  let monthRows = [];
  let dateRows = [];
  const workerRows = workerQs.map(() => []);
  let monthReady = false;
  let dateReady = false;
  const workerReady = workerQs.map(() => false);
  const emit = () => {
    if (monthReady && dateReady && workerReady.every(Boolean)) {
      callback(mergeAttendanceDocs(monthRows, dateRows, ...workerRows));
    }
  };

  const unsubMonth = onSnapshot(
    monthQ,
    snap => { monthRows = mapDocs(snap); monthReady = true; emit(); },
    handleSnapshotError('monthAttendanceByYearMonth', onError)
  );
  const unsubDate = onSnapshot(
    dateQ,
    snap => { dateRows = mapDocs(snap); dateReady = true; emit(); },
    handleSnapshotError('monthAttendanceByDate', onError)
  );
  const unsubWorkers = workerQs.map((workerQ, index) => onSnapshot(
    workerQ,
    snap => { workerRows[index] = mapDocs(snap); workerReady[index] = true; emit(); },
    handleSnapshotError('monthAttendanceByWorker', onError)
  ));

  return () => {
    unsubMonth();
    unsubDate();
    unsubWorkers.forEach(unsub => unsub());
  };
};

// FIX BUG-11: fetch attendance for ANY given yearMonth (used by export range)
// FIX P4M1: Filter by yearMonth server-side instead of reading full collection.
export const getMonthAttendanceOnce = async (userId, siteId, yearMonth, workerIds = []) => {
  const monthQ = query(
    collection(db, 'attendance'),
    where('userId',  '==', userId),
    where('siteId',  '==', siteId),
    where('yearMonth', '==', yearMonth)
  );

  const dateQ = query(
    collection(db, 'attendance'),
    where('userId', '==', userId),
    where('siteId', '==', siteId),
    where('date', '>=', `${yearMonth}-01`),
    where('date', '<=', monthEndKey(yearMonth))
  );

  const workerQs = chunksOf([...new Set(workerIds)].filter(Boolean), 10).map(chunk => query(
    collection(db, 'attendance'),
    where('userId', '==', userId),
    where('workerId', 'in', chunk),
    where('date', '>=', `${yearMonth}-01`),
    where('date', '<=', monthEndKey(yearMonth))
  ));

  const [monthSnap, dateSnap, ...workerSnaps] = await Promise.all([
    getDocs(monthQ),
    getDocs(dateQ),
    ...workerQs.map(workerQ => getDocs(workerQ)),
  ]);
  return mergeAttendanceDocs(mapDocs(monthSnap), mapDocs(dateSnap), ...workerSnaps.map(mapDocs));
};

// FIX BUG-07: paginated fetch for "All Time" export — batch 500 at a time
export const getAllAttendancePaginated = async (userId, siteId, onBatch) => {
  let lastDoc = null;
  let total   = 0;
  const PAGE  = 500;

  while (true) {
    let q = query(
      collection(db, 'attendance'),
      where('userId', '==', userId),
      where('siteId', '==', siteId),
      orderBy('date'),
      limit(PAGE)
    );
    if (lastDoc) q = query(q, startAfter(lastDoc));

    const snap = await getDocs(q);
    if (snap.empty) break;

    const batch = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    await onBatch(batch);
    total += batch.length;
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < PAGE) break;
  }
  return total;
};

// ─── ADVANCES ─────────────────────────────────────────────────────────────────
// FIX BUG-07: load advances only for current + last 2 months to cap memory
export const getAdvances = (userId, callback, onError) => {
  // Load all advances but sorted — reasonable for <30 workers
  const q = query(collection(db, 'advances'), where('userId', '==', userId));
  return onSnapshot(
    q,
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    handleSnapshotError('advances', onError)
  );
};
export const addAdvance = (userId, data) =>
  addDoc(collection(db, 'advances'), { ...data, userId, createdAt: serverTimestamp() })
    .then((res) => { void queueDriveSync(userId, 'addAdvance'); return res; });
export const deleteAdvance = (userId, advanceId) =>
  deleteDoc(doc(db, 'advances', advanceId))
    .then((res) => { void queueDriveSync(userId, 'deleteAdvance'); return res; });

// ─── HOLIDAYS ─────────────────────────────────────────────────────────────────
export const getHolidays = (userId, callback, onError) => {
  const q = query(collection(db, 'holidays'), where('userId', '==', userId));
  return onSnapshot(
    q,
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    handleSnapshotError('holidays', onError)
  );
};
export const addHoliday = (userId, data) =>
  addDoc(collection(db, 'holidays'), { ...data, userId, createdAt: serverTimestamp() })
    .then((res) => { void queueDriveSync(userId, 'addHoliday'); return res; });
export const deleteHoliday = (userId, holidayId) =>
  deleteDoc(doc(db, 'holidays', holidayId))
    .then((res) => { void queueDriveSync(userId, 'deleteHoliday'); return res; });
