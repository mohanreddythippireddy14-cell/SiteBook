import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import { format } from 'date-fns';
import { calcWorkerMonth, buildHolidayDateSet } from '../utils/helpers';

// FIX BUG-18: check sharing is available before trying
const safeShare = async (uri, options) => {
  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) {
    throw new Error('No app available to open this file. Please install a PDF viewer or Files app.');
  }
  await Sharing.shareAsync(uri, options);
};

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

// FIX P2S4: Escape user-controlled text before injecting it into generated HTML.
const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// FIX BUG-12: company name comes from site.company (not hardcoded)
// FIX BUG-13: advances filtered by yearMonth inside calcWorkerMonth
export const generateAndSharePDF = async ({
  site, workers, attendance, advances, holidays = [], yearMonth,
}) => {
  const company    = site?.company || site?.name || 'My Company';
  const monthLabel = format(new Date(yearMonth + '-01'), 'MMMM yyyy');
  const siteName   = site?.name || '';
  const holidayDates = buildHolidayDateSet(holidays, site?.id);

  const workerResults = workers.map(w => ({
    w,
    r: calcWorkerMonth(w, attendance, advances, yearMonth, holidayDates),
  }));

  const totalGross = workerResults.reduce((s, { r }) => s + r.gross, 0);
  const totalNet   = workerResults.reduce((s, { r }) => s + r.net, 0);

  // Worker rows
  const rows = workerResults.map(({ w, r }) => {
    const overStyle = r.overAdvanced ? 'color:#DC2626;font-weight:700' : 'color:#16A34A;font-weight:700';
    return `
      <tr>
        <td>${escapeHtml(w.name)}</td>
        <td style="color:#64748B">${escapeHtml(w.role || '-')}</td>
        <td style="text-align:center">${r.days}</td>
        <td style="text-align:center">${r.half}</td>
        <td style="text-align:center">${r.otHrs.toFixed(1)}</td>
        <td style="text-align:right">₹${Math.round(r.gross).toLocaleString('en-IN')}</td>
        <td style="text-align:right;color:#DC2626">₹${Math.round(r.advances).toLocaleString('en-IN')}</td>
        <td style="text-align:right;${overStyle}">
          ${r.overAdvanced ? '⚠ ' : ''}₹${Math.round(r.net).toLocaleString('en-IN')}
        </td>
      </tr>`;
  }).join('');

  // Advances detail section at bottom
  const advRows = workerResults
    .filter(({ r }) => r.advances > 0)
    .flatMap(({ w, r }) =>
      (advances || [])
        .filter(a => a.workerId === w.id && a.yearMonth === yearMonth)
        .map(adv => `
          <tr>
            <td>${escapeHtml(w.name)}</td>
            <td>${escapeHtml(adv.date)}</td>
            <td style="text-align:right;color:#DC2626;font-weight:600">
              ₹${Math.round(adv.amount || 0).toLocaleString('en-IN')}
            </td>
            <td style="color:#64748B">${escapeHtml(adv.note || '-')}</td>
          </tr>`)
    ).join('');

  // Overadvanced warnings
  const warnings = workerResults
    .filter(({ r }) => r.overAdvanced)
    .map(({ w, r }) =>
      `<li><strong>${escapeHtml(w.name)}</strong> — Advance (₹${Math.round(r.advances).toLocaleString('en-IN')}) exceeds gross salary (₹${Math.round(r.gross).toLocaleString('en-IN')}). Carry-forward: ₹${Math.round(Math.abs(r.net)).toLocaleString('en-IN')}</li>`
    ).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; margin:0; padding:0; color:#0F172A; }
  .header { background: linear-gradient(135deg,#1B4FE4,#1240C0); color:#fff; padding:28px 32px; }
  .brand { font-size:11px; letter-spacing:3px; opacity:.7; margin-bottom:4px; }
  .header h1 { margin:0; font-size:24px; font-weight:800; }
  .header p  { margin:5px 0 0; font-size:13px; opacity:.8; }
  .summary { display:flex; background:#F8FAFC; border-bottom:1px solid #E2E8F0; }
  .sbox { flex:1; padding:16px 24px; border-right:1px solid #E2E8F0; }
  .sbox:last-child { border-right:none; }
  .slabel { font-size:10px; color:#64748B; text-transform:uppercase; letter-spacing:1px; font-weight:600; }
  .svalue { font-size:20px; font-weight:800; color:#1B4FE4; margin-top:3px; }
  .svalue.green { color:#16A34A; }
  .content { padding:24px 32px; }
  h2 { font-size:12px; font-weight:700; color:#64748B; text-transform:uppercase; letter-spacing:1px; margin:0 0 10px; }
  table { width:100%; border-collapse:collapse; margin-bottom:28px; }
  th { background:#1B4FE4; color:#fff; text-align:left; padding:9px 8px; font-size:11px; font-weight:600; letter-spacing:.5px; }
  td { padding:10px 8px; font-size:12px; border-bottom:1px solid #F1F5F9; }
  tr:nth-child(even) td { background:#F8FAFC; }
  .total-row td { font-weight:700; background:#EBF0FF!important; color:#1B4FE4; border-top:2px solid #1B4FE4; }
  .warn-box { background:#FEF2F2; border:1px solid #FECACA; border-radius:8px; padding:12px 16px; margin-bottom:24px; }
  .warn-box h3 { margin:0 0 8px; font-size:13px; color:#DC2626; }
  .warn-box ul { margin:0; padding-left:20px; font-size:12px; color:#7F1D1D; line-height:1.6; }
  .footer { padding:14px 32px; font-size:11px; color:#94A3B8; border-top:1px solid #E2E8F0; display:flex; justify-content:space-between; }
</style>
</head>
<body>
<div class="header">
  <div class="brand">SITEBOOK</div>
  <h1>Salary Report — ${monthLabel}</h1>
  <p>${escapeHtml(company)} &nbsp;|&nbsp; ${escapeHtml(siteName)}</p>
</div>
<div class="summary">
  <div class="sbox"><div class="slabel">Workers</div><div class="svalue">${workers.length}</div></div>
  <div class="sbox"><div class="slabel">Total Gross</div><div class="svalue">₹${Math.round(totalGross).toLocaleString('en-IN')}</div></div>
  <div class="sbox"><div class="slabel">Net Payable</div><div class="svalue green">₹${Math.round(totalNet).toLocaleString('en-IN')}</div></div>
</div>
<div class="content">
  ${warnings ? `<div class="warn-box"><h3>⚠ Advance Warnings</h3><ul>${warnings}</ul></div>` : ''}
  <h2>Salary Breakdown</h2>
  <table>
    <thead>
      <tr>
        <th>Worker</th><th>Role</th><th>Days</th><th>Half</th><th>OT hrs</th>
        <th style="text-align:right">Gross</th>
        <th style="text-align:right">Advance</th>
        <th style="text-align:right">Net Pay</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr class="total-row">
        <td colspan="5">TOTAL</td>
        <td style="text-align:right">₹${Math.round(totalGross).toLocaleString('en-IN')}</td>
        <td></td>
        <td style="text-align:right;color:#16A34A">₹${Math.round(totalNet).toLocaleString('en-IN')}</td>
      </tr>
    </tbody>
  </table>
  ${advRows ? `
  <h2 style="color:#DC2626">Advance Details</h2>
  <table>
    <thead><tr><th>Worker</th><th>Date</th><th style="text-align:right">Amount</th><th>Reason</th></tr></thead>
    <tbody>${advRows}</tbody>
  </table>` : ''}
</div>
<div class="footer">
  <span>Generated by SiteBook</span>
  <span>${format(new Date(), 'dd MMM yyyy, hh:mm a')}</span>
</div>
</body></html>`;

  if (Platform.OS === 'web') {
    downloadWebFile(html, `SiteBook_Report_${yearMonth}.html`, 'text/html;charset=utf-8');
    return true;
  }

  // FIX BUG-18: check storage before writing
  const fileInfo = await FileSystem.getFreeDiskStorageAsync();
  if (fileInfo < 5 * 1024 * 1024) { // less than 5MB free
    throw new Error('Not enough storage space on your phone to generate the PDF.');
  }

  const { uri } = await Print.printToFileAsync({ html, base64: false });
  await safeShare(uri, {
    mimeType: 'application/pdf',
    dialogTitle: `SiteBook Report — ${monthLabel}`,
    UTI: 'com.adobe.pdf',
  });

  return true; // FIX BUG-18: return success so caller can confirm
};

