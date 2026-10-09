import { z } from 'zod';

import { handler, ok, readBody } from '../../../../server/http.js';
import { requireRole } from '../../../../server/auth/session.js';
import { getAppConfig, updateAppConfig } from '../../../../server/domain/appConfig.js';
import { ROLE } from '../../../../config/constants.js';

const version = z.string().trim().regex(/^(\d+(\.\d+){0,2})?$/, 'वर्ज़न 1.2.3 जैसा लिखें').optional();
const text = (max) => z.string().trim().max(max).optional();

const patch = z.object({
  maintenance: z.boolean().optional(),
  maintenanceMessage: text(400),
  maintenanceUntil: text(60),
  latestVersion: version,
  minVersion: version,
  updateUrl: z.string().trim().url().or(z.literal('')).optional(),
  updateMessage: text(400),
  supportPhone: text(20),
  supportWhatsapp: text(20),
  supportEmail: z.string().trim().email().or(z.literal('')).optional(),
  officeHours: text(120),
  aboutText: text(1500),
  payment: z.object({
    enabled: z.boolean().optional(),
    forMembers: z.boolean().optional(),
    forAgents: z.boolean().optional(),
    payeeName: text(100),
    upiId: z.string().trim().regex(/^([\w.\-]{2,256}@[a-zA-Z][\w.\-]{1,64})?$/, 'UPI ID जैसे trust@sbi').optional(),
    qrImageURL: z.string().trim().url().or(z.literal('')).optional(),
    bankName: text(100),
    accountName: text(120),
    accountNumber: z.string().trim().regex(/^[0-9]{0,20}$/, 'खाता नंबर सिर्फ़ अंक').optional(),
    ifsc: z.string().trim().toUpperCase().regex(/^([A-Z]{4}0[A-Z0-9]{6})?$/, 'IFSC जैसे SBIN0001234').optional(),
    branch: text(120),
    instructions: text(1500),
    note: text(400),
    confirmWhatsapp: text(20),
  }).optional(),
});

/** GET /api/app/config — the office settings screen reads the app switches. */
export const GET = handler(async () => {
  const scope = await requireRole(ROLE.ADMIN);
  return ok({ config: await getAppConfig(scope.trustId) });
});

/** PATCH /api/app/config — maintenance on/off, update versions, support numbers. */
export const PATCH = handler(async (request) => {
  const scope = await requireRole(ROLE.ADMIN);
  const body = await readBody(request, patch);
  return ok({ config: await updateAppConfig(scope, body) });
});
