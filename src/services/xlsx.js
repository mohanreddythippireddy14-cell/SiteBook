import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { format } from 'date-fns';
import { lastDayOfMonth, calcWorkerMonth, buildHolidayDateSet } from '../utils/helpers';

const downloadWebFile = (content, fileName, mimeType) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// FIX BUG-13: attendance passed in is already month-filtered by caller
// FIX BUG-11: accepts any yearMonth, not always current month
export const exportAttendanceXLSX = async ({ workers, attendance, advances, holidays = [], yearMonth, siteName, siteId }) => {
  const monthLabel  = format(new Date(yearMonth + '-01'), 'MMMM yyyy');
  const isCurrentMonth = yearMonth === format(new Date(), 'yyyy-MM');
  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const daysInMonth = isCurrentMonth ? new Date().getDate() : lastDayOfMonth(yearMonth); // FIX BUG-04: correct days
  const dayNums     = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const holidayDates = buildHolidayDateSet(holidays, siteId);
  const attendanceByWorkerDate = new Map();
  (attendance || []).forEach((a) => {
    if (a.workerId && a.date) attendanceByWorkerDate.set(`${a.workerId}_${a.date}`, a);
  });

  const header = [
    'Worker', 'Role',
    ...dayNums.map(d => String(d)),
    'Present', 'Half Day', 'Absent', 'OT Hrs', 'Gross (₹)', 'Advance (₹)', 'Net Pay (₹)',
    'Salary (₹)', 'OT Pay (₹)', 'Advance Given (₹)', 'Total (₹)', 'Payable (₹)'
  ];

  const rows = workers.map(w => {
    const days = dayNums.map(d => {
      const dateStr = `${yearMonth}-${String(d).padStart(2, '0')}`;
      const att     = attendanceByWorkerDate.get(`${w.id}_${dateStr}`);
      if (!att || att.status === 'A') return 'A';
      if (att.status === 'P') return 'P';
      if (att.status === 'H') return 'H';
      return 'A';
    });

    const present = days.filter(x => x === 'P').length;
    const half    = days.filter(x => x === 'H').length;
    const absent  = days.filter(x => x === 'A').length;

    const attToDate = attendance.filter(a =>
      a.workerId === w.id &&
      a.date &&
      a.date.startsWith(yearMonth) &&
      (!isCurrentMonth || a.date <= todayKey)
    );
    const fullMonth = calcWorkerMonth(w, attendance, advances, yearMonth, holidayDates);
    const toDate = calcWorkerMonth(w, attToDate, advances, yearMonth, holidayDates);

    const totalAdv = (advances || [])
      .filter(a => a.workerId === w.id && a.yearMonth === yearMonth)
      .reduce((s, a) => s + (Number(a.amount) || 0), 0);

    const advToDate = (advances || [])
      .filter(a =>
        a.workerId === w.id &&
        a.yearMonth === yearMonth &&
        (!isCurrentMonth || (a.date && a.date <= todayKey))
      )
      .reduce((s, a) => s + (Number(a.amount) || 0), 0);

    const totalToDate = toDate.basicPay + toDate.otPay;
    const payableToDate = totalToDate - advToDate;

    return [
      w.name, w.role || '-',
      ...days,
      present, half, absent,
      fullMonth.otHrs.toFixed(1),
      Math.round(fullMonth.gross),
      Math.round(totalAdv),
      Math.round(fullMonth.net),
      Math.round(toDate.basicPay),
      Math.round(toDate.otPay),
      Math.round(advToDate),
      Math.round(totalToDate),
      Math.round(payableToDate),
    ];
  });

  // Advances detail sheet appended below
  const advRows = workers.flatMap(w =>
    (advances || [])
      .filter(a => a.workerId === w.id && a.yearMonth === yearMonth)
      .map(a => [w.name, a.date, a.amount, a.note || '-'])
  );

  const escape = (val) => {
    const s = String(val ?? '');
    // FIX P2S5: Prefix formula-like CSV cells so spreadsheets do not execute user input.
    const safe = /^[=+\-@]/.test(s) ? `\t${s}` : s;
    return (safe.includes(',') || safe.includes('"') || safe.includes('\n'))
      ? `"${safe.replace(/"/g, '""')}"` : safe;
  };

  const lines = [
    [`SiteBook — Attendance & Salary — ${siteName} — ${monthLabel}`],
    [],
    header,
    ...rows,
  ];

  if (advRows.length > 0) {
    lines.push([], ['--- ADVANCE DETAILS ---'], ['Worker', 'Date', 'Amount (₹)', 'Reason'], ...advRows);
  }

  const csv = lines.map(row => row.map(escape).join(',')).join('\n');

  // FIX BUG-18: check storage
  const freeBytes = await FileSystem.getFreeDiskStorageAsync();
  if (freeBytes < 2 * 1024 * 1024) {
    throw new Error('Not enough storage on your phone.');
  }

  const safeName  = (siteName || 'Site').replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName  = `SiteBook_${safeName}_${yearMonth}.csv`;

  if (Platform.OS === 'web') {
    downloadWebFile(csv, fileName, 'text/csv;charset=utf-8');
    return true;
  }

  const fileUri   = FileSystem.documentDirectory + fileName;

  await FileSystem.writeAsStringAsync(fileUri, csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) throw new Error('No app available to open this file.');

  await Sharing.shareAsync(fileUri, {
    mimeType:    'text/csv',
    dialogTitle: `Attendance Sheet — ${monthLabel}`,
    UTI:         'public.comma-separated-values-text',
  });

  return true;
};
