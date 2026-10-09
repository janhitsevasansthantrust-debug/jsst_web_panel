import 'server-only';

import { db, serverNow } from '../firebase/admin.js';
import { notFound } from '../http.js';
import { paths } from '../../config/constants.js';

/**
 * The phone app's switches, set from the office settings → "मोबाइल ऐप":
 *
 *   • maintenance — when on, every phone shows the maintenance screen
 *     instead of the app (agents and members alike) until it is turned off.
 *   • latestVersion / minVersion / updateUrl — a phone older than
 *     `latestVersion` sees "नया अपडेट उपलब्ध"; older than `minVersion` it
 *     MUST update before it can continue.
 *   • support numbers shown on the app's "संपर्क करें" card.
 *
 * Stored on the trust document as `appConfig`, merged on read like branding,
 * so a trust that never opened the screen gets sensible defaults.
 */
export const DEFAULT_APP_CONFIG = {
  maintenance: false,
  maintenanceMessage: '',
  maintenanceUntil: '',
  latestVersion: '',
  minVersion: '',
  updateUrl: '',
  updateMessage: '',
  supportPhone: '',
  supportWhatsapp: '',
  supportEmail: '',
  officeHours: '',
  aboutText: '',
  payment: {},
};

/**
 * "भुगतान करें" in the app — how members and agents pay the trust directly.
 * Nothing here moves money in our books: the app only shows where to pay
 * (UPI QR / UPI ID / bank account) and how to tell the office. The receipt is
 * still made by the office once the money is seen in the account (rule 3).
 */
export const DEFAULT_PAYMENT = {
  enabled: false,
  forMembers: true,
  forAgents: true,
  payeeName: '',
  upiId: '',
  /** The trust's own printed QR, if it has one (shown as well as / instead of ours). */
  qrImageURL: '',
  bankName: '',
  accountName: '',
  accountNumber: '',
  ifsc: '',
  branch: '',
  /** One step per line — shown numbered in the app. */
  instructions: '',
  /** Shown under the steps, e.g. "रसीद 2 दिन में मिलेगी". */
  note: '',
  /** Where to send the payment screenshot / UTR (falls back to the support WhatsApp). */
  confirmWhatsapp: '',
};

export function readAppConfig(trustData) {
  const cfg = { ...DEFAULT_APP_CONFIG, ...(trustData?.appConfig ?? {}) };
  cfg.payment = { ...DEFAULT_PAYMENT, ...(trustData?.appConfig?.payment ?? {}) };
  return cfg;
}

/** Is paying from the app switched on for this role? */
export function paymentOpenFor(cfg, role) {
  const p = cfg.payment;
  if (!p.enabled) return false;
  const hasWay = Boolean(p.upiId || p.qrImageURL || p.accountNumber);
  if (!hasWay) return false;
  return role === 'agent' ? p.forAgents !== false : p.forMembers !== false;
}

/**
 * The standard UPI deep link (NPCI "upi://pay"). Every UPI app — Google Pay,
 * PhonePe, Paytm, BHIM, bank apps — reads it, from a QR or a tap.
 */
export function upiLink({ upiId, payeeName, amount, note }) {
  const q = new URLSearchParams();
  q.set('pa', upiId);
  if (payeeName) q.set('pn', payeeName);
  if (amount > 0) q.set('am', Number(amount).toFixed(2));
  q.set('cu', 'INR');
  if (note) q.set('tn', note.slice(0, 60));
  // Spaces as %20 and the VPA's "@" left as is — some UPI apps reject "%40".
  return `upi://pay?${q.toString().replace(/\+/g, '%20').replace(/%40/g, '@')}`;
}

export async function getAppConfig(trustId) {
  const snap = await db.doc(paths.trust(trustId)).get();
  if (!snap.exists) throw notFound('ट्रस्ट नहीं मिला');
  return readAppConfig(snap.data());
}

export async function updateAppConfig(scope, patch) {
  const ref = db.doc(paths.trust(scope.trustId));
  await ref.set({ appConfig: patch, appConfigUpdatedAt: serverNow(), appConfigUpdatedBy: scope.uid }, { merge: true });
  return getAppConfig(scope.trustId);
}

/** The trust's public "about" card for the app — what is printed on receipts anyway. */
export function aboutTrust(trustData) {
  const b = trustData?.branding ?? {};
  const app = readAppConfig(trustData);
  const phones = Array.isArray(b.phone) ? b.phone.filter(Boolean) : (b.phone ? [String(b.phone)] : []);
  return {
    name: b.nameHi || trustData?.name || '',
    nameEn: b.nameEn ?? '',
    tagline: b.tagline ?? '',
    logoURL: b.logoURL ?? '',
    registrationNo: b.registrationNo ?? '',
    regDate: b.regDate ?? '',
    panNo: b.panNo ?? '',
    cityState: b.cityState ?? '',
    address: b.addressHi ?? '',
    city: b.city ?? '',
    district: b.district ?? '',
    state: b.state ?? '',
    pinCode: b.pinCode ?? '',
    phones,
    email: b.email ?? '',
    website: b.website ?? '',
    contactPerson: b.contactPerson ?? '',
    presidentName: b.presidentName ?? '',
    signatoryName: b.signatoryName ?? '',
    signatoryDesignation: b.signatoryDesignation ?? '',
    topLines: b.topLines ?? [],
    headerLines: b.headerLines ?? [],
    aboutText: app.aboutText,
    support: {
      phone: app.supportPhone || phones[0] || '',
      whatsapp: app.supportWhatsapp || app.supportPhone || phones[0] || '',
      email: app.supportEmail || b.email || '',
      officeHours: app.officeHours,
    },
  };
}
