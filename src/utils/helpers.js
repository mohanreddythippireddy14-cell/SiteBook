import { format, getDaysInMonth } from 'date-fns';

export const dateKey  = (date) => format(date, 'yyyy-MM-dd');
export const monthKey = (date) => format(date, 'yyyy-MM');
export const rupees   = (n) => {
  const val = Math.round(Number(n) || 0);
  if (isNaN(val)) return 'Rs 0';
  return 'Rs ' + val.toLocaleString('en-IN');
};

export const isSundayKey = (dateStr) => {
  if (!dateStr) return false;
  const date = new Date(`${dateStr}T00:00:00`);
  return !isNaN(date.getTime()) && date.getDay() === 0;
};

export const buildHolidayDateSet = (holidays = [], siteId) =>
  new Set(
    holidays
      .filter((holiday) => holiday?.date && (!siteId || holiday.siteId === siteId))
      .map((holiday) => holiday.date)
  );

export const isHolidayLikeDate = (dateStr, holidayDates = new Set()) =>
  isSundayKey(dateStr) || holidayDates.has(dateStr);

// FIX BUG-19: safe initials - never crashes on empty/space/undefined/null
export const initials = (name = '') => {
  if (!name || typeof name !== 'string' || !name.trim()) return '?';
  return name.trim().split(/\s+/).slice(0, 2)
    .map(w => (w && w[0] ? w[0].toUpperCase() : ''))
    .filter(Boolean).join('') || '?';
};

// FIX BUG-01 & BUG-02: sanitize wage - no negative, no NaN, no insane values
export const sanitizeWage = (val) => {
  const n = parseFloat(val);
  if (!isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n), 999999);
};

// FIX BUG-04: correct last day of any month (handles Feb 28/29, 30-day months)
export const lastDayOfMonth = (yearMonth) => {
  const [y, m] = yearMonth.split('-').map(Number);
  return getDaysInMonth(new Date(y, m - 1));
};
export const monthEndKey = (yearMonth) => {
  const last = lastDayOfMonth(yearMonth);
  return `${yearMonth}-${String(last).padStart(2, '0')}`;
};

// FIX BUG-20: live month key - always fresh, never stale from render time
export const liveMonthKey = () => monthKey(new Date());

// FIX BUG-03, BUG-10: safe salary calc with advance-over-salary flag
// Sundays and declared holidays are treated as holiday work:
// Present = minimum 8h OT, Half = minimum 4h OT, Absent = OT-only if entered manually.
export const calcWorkerMonth = (worker, attendance, advances, yearMonth, holidayDates = new Set()) => {
  const workerAtt = attendance.filter(a => a.workerId === worker.id);
  let days = 0, half = 0, otHrs = 0;

  workerAtt.forEach(a => {
    const isHoliday = isHolidayLikeDate(a.date, holidayDates);
    const ot = Math.min(Math.max(Number(a.otHours) || 0, 0), 24);

    if (isHoliday) {
      if (a.status === 'P') otHrs += Math.max(ot, 8);
      else if (a.status === 'H') otHrs += Math.max(ot, 4);
      else otHrs += ot;
      return;
    }

    if (a.status === 'P') days++;
    else if (a.status === 'H') half++;
    otHrs += ot;
  });

  const wage = sanitizeWage(worker.dailyWage);
  const otRate = sanitizeWage(worker.otRate);
  const basicPay = days * wage + half * wage * 0.5;
  const otPay = otHrs * otRate;
  const gross = basicPay + otPay;

  const workerAdvances = (advances || []).filter(
    adv => adv.workerId === worker.id && adv.yearMonth === yearMonth
  );
  const totalAdvances = workerAdvances.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const net = gross - totalAdvances;

  return {
    days,
    half,
    otHrs,
    basicPay,
    otPay,
    gross,
    advances: totalAdvances,
    net,
    overAdvanced: net < 0,
  };
};

export const COLORS = {
  primary:      '#1B4FE4',
  primaryLight: '#EBF0FF',
  primaryDark:  '#1240C0',
  accent:       '#F59E0B',
  accentLight:  '#FFF8E7',
  green:        '#16A34A',
  greenLight:   '#DCFCE7',
  red:          '#DC2626',
  redLight:     '#FEE2E2',
  orange:       '#EA580C',
  orangeLight:  '#FFF0E8',
  gray0:        '#F8FAFC',
  gray1:        '#F1F5F9',
  gray2:        '#E2E8F0',
  gray3:        '#94A3B8',
  gray4:        '#64748B',
  gray5:        '#334155',
  text:         '#0F172A',
  white:        '#FFFFFF',
};
