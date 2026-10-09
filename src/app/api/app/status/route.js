import { db } from '../../../../server/firebase/admin.js';
import { handler, ok } from '../../../../server/http.js';
import { resolveTrustId } from '../../../../server/domain/trustId.js';
import { paymentOpenFor, readAppConfig } from '../../../../server/domain/appConfig.js';

/**
 * GET /api/app/status — asked by the phone app on every start, before login.
 *
 * Public on purpose (a phone in maintenance mode may not have a session) and
 * deliberately small: only the maintenance switch and the update versions —
 * nothing private. Cached briefly so a thousand phones opening at once cost
 * one read.
 */
export const GET = handler(async () => {
  const trustId = await resolveTrustId();
  const cfg = trustId ? readAppConfig((await db.doc(`trusts/${trustId}`).get()).data()) : readAppConfig(null);

  return ok({
    serverTime: Date.now(),
    maintenance: {
      on: Boolean(cfg.maintenance),
      message: cfg.maintenanceMessage,
      until: cfg.maintenanceUntil,
    },
    update: {
      latestVersion: cfg.latestVersion,
      minVersion: cfg.minVersion,
      url: cfg.updateUrl,
      message: cfg.updateMessage,
    },
    support: { phone: cfg.supportPhone, whatsapp: cfg.supportWhatsapp },
    // Only whether the "भुगतान करें" screen exists — the account details
    // themselves are behind a login (/api/app/payment).
    payment: {
      members: paymentOpenFor(cfg, 'member'),
      agents: paymentOpenFor(cfg, 'agent'),
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
});
