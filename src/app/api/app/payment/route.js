import QRCode from 'qrcode';

import { db } from '../../../../server/firebase/admin.js';
import { handler, ok, forbidden } from '../../../../server/http.js';
import { requireSession } from '../../../../server/auth/session.js';
import { paymentOpenFor, readAppConfig, upiLink } from '../../../../server/domain/appConfig.js';
import { ROLE, ROLE_RANK, paths } from '../../../../config/constants.js';

/**
 * GET /api/app/payment?amount=&note=  — the app's "भुगतान करें" screen.
 *
 * Returns where to pay (UPI ID + a QR made for this amount, the trust's own
 * QR image, bank account) and the steps, exactly as set in office settings →
 * मोबाइल ऐप → भुगतान. `?preview=1` lets the office see it even while it is
 * switched off.
 *
 * Nothing is recorded: paying here does not mark anything paid. The office
 * makes the receipt when the money is seen in the account, as always.
 */
export const GET = handler(async (request) => {
  const session = await requireSession();
  const url = new URL(request.url);
  const preview = url.searchParams.get('preview') === '1' && (ROLE_RANK[session.role] ?? 0) >= ROLE_RANK[ROLE.ADMIN];

  const snap = await db.doc(paths.trust(session.trustId)).get();
  const data = snap.exists ? snap.data() : {};
  const cfg = readAppConfig(data);
  const role = session.role === ROLE.AGENT ? 'agent' : 'member';
  if (!preview && !paymentOpenFor(cfg, role)) throw forbidden('ऐप से भुगतान अभी चालू नहीं है — कार्यालय से संपर्क करें');

  const p = cfg.payment;
  const amount = Math.max(0, Math.min(1000000, Math.round(Number(url.searchParams.get('amount')) || 0)));
  const note = String(url.searchParams.get('note') ?? '').trim().slice(0, 60);
  const payee = p.payeeName || data.branding?.nameHi || data.name || '';

  let link = '';
  let qr = '';
  if (p.upiId) {
    link = upiLink({ upiId: p.upiId, payeeName: payee, amount, note });
    qr = await QRCode.toDataURL(link, { margin: 1, width: 520, errorCorrectionLevel: 'M' });
  }

  const steps = String(p.instructions || '').split(/\r?\n/).map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);

  return ok({
    payment: {
      payeeName: payee,
      upiId: p.upiId,
      upiLink: link,
      qrDataUrl: qr,
      qrImageURL: p.qrImageURL,
      bank: p.accountNumber ? {
        bankName: p.bankName, accountName: p.accountName || payee, accountNumber: p.accountNumber,
        ifsc: p.ifsc, branch: p.branch,
      } : null,
      steps,
      note: p.note,
      confirmWhatsapp: p.confirmWhatsapp || cfg.supportWhatsapp || cfg.supportPhone || (data.branding?.phone ?? [])[0] || '',
      amount,
      txnNote: note,
      enabled: paymentOpenFor(cfg, role),
    },
  });
});
