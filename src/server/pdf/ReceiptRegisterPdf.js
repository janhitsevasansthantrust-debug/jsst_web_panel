import 'server-only';

import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

import { FONT_FAMILY } from './renderer.js';
import { trustHeader, signatureBlock, inr, hiDate } from './branding.js';
import { paymentMethodLabel, paymentStatusLabel } from '../../config/labels.js';
import { DEFAULT_PRIMARY, DEFAULT_ACCENT } from '../../lib/theme.js';

/**
 * रसीद रजिस्टर — every receipt in a period, as a page the office can file.
 *
 * Not a substitute for an individual रसीद: that is proof that one member paid
 * one amount, and it carries the trust's seal. This is the register the
 * office keeps — what came in, from whom, against how many closings, and what
 * was taken back. It is what gets read at a committee meeting and what an
 * auditor asks for first.
 *
 * Cancelled receipts are shown, struck through, for the same reason a reverted
 * closing is shown on the क्लोजिंग सूची: the question this page answers is
 * "what happened", and a receipt that was cancelled happened. Their amount is
 * excluded from the totals — the money came back — and the note under the
 * table says so, because a struck-through row that still appeared in a total
 * would be the exact kind of number nobody can argue with afterwards.
 */
export function ReceiptRegisterPdf({
  trust,
  program,
  rows,
  filters = [],
  totals,
  truncated = false,
  generatedAt,
}) {
  const b = trust?.branding ?? {};
  const primary = b.theme?.primary || DEFAULT_PRIMARY;
  const accent = b.theme?.accent || DEFAULT_ACCENT;
  const s = sheet(primary, accent);

  return (
    <Document title="रसीद रजिस्टर" author={b.nameHi || trust?.name || ''}>
      <Page size="A4" orientation="landscape" style={s.page}>
        {trustHeader(b, { compact: true })}

        <View style={s.titleRow}>
          <View style={s.titleBadge}>
            <Text style={s.title}>रसीद रजिस्टर</Text>
          </View>
          <Text style={s.meta}>
            {program?.hiname || program?.name ? `${program.hiname || program.name}   ·   ` : ''}
            {hiDate(generatedAt ?? Date.now())}
          </Text>
        </View>

        {filters.length > 0 && (
          <Text style={s.filters}>{filters.join('   ·   ')}</Text>
        )}

        <View style={s.stats}>
          <Stat s={s} label="रसीदें" value={String(totals.count)} />
          <Stat s={s} label="सदस्य" value={String(totals.members)} />
          <Stat s={s} label="क्लोजिंग जमा" value={inr(totals.closingAmount)} />
          <Stat s={s} label="नामांकन शुल्क" value={inr(totals.joinFeeAmount)} />
          <Stat s={s} label="कुल जमा" value={inr(totals.collected)} strong />
          <Stat
            s={s}
            label="रद्द"
            value={totals.cancelled ? `${totals.cancelled} · ${inr(totals.cancelledAmount)}` : '0'}
          />
        </View>

        <View style={s.table}>
          <View style={s.head} fixed>
            <Text style={[s.h, s.cDate]}>तिथि</Text>
            <Text style={[s.h, s.cReceipt]}>रसीद नं.</Text>
            <Text style={[s.h, s.cReg]}>रजि. नं.</Text>
            <Text style={[s.h, s.cName]}>सदस्य</Text>
            <Text style={[s.h, s.cAgent]}>एजेंट</Text>
            <Text style={[s.h, s.cMethod]}>तरीका</Text>
            <Text style={[s.h, s.cNum, s.right]}>क्लोजिंग</Text>
            <Text style={[s.h, s.cMoney, s.right]}>क्लोजिंग राशि</Text>
            <Text style={[s.h, s.cMoney, s.right]}>नामांकन शुल्क</Text>
            <Text style={[s.h, s.cMoney, s.right]}>कुल राशि</Text>
            <Text style={[s.h, s.cStatus]}>स्थिति</Text>
          </View>

          {rows.map((r, i) => {
            const off = r.status === 'cancelled';
            const m = r.memberSnapshot ?? {};
            return (
              <View key={r.id ?? `${r.receiptNo}-${i}`} style={[s.row, i % 2 ? s.rowAlt : null]} wrap={false}>
                <Text style={[s.d, s.cDate, off ? s.off : null]}>{hiDate(r.paidAtMs)}</Text>
                <Text style={[s.d, s.cReceipt, off ? s.off : null]}>{r.receiptNo || '—'}</Text>
                <Text style={[s.d, s.cReg, off ? s.off : null]}>{m.regNo || '—'}</Text>
                <Text style={[s.d, s.cName, off ? s.off : null]}>{m.name || '—'}</Text>
                <Text style={[s.d, s.cAgent, off ? s.off : null]}>{r.collectedByAgentName || '—'}</Text>
                <Text style={[s.d, s.cMethod, off ? s.off : null]}>{paymentMethodLabel(r.method)}</Text>
                <Text style={[s.d, s.cNum, s.right, off ? s.off : null]}>{r.itemCount ?? 0}</Text>
                <Text style={[s.d, s.cMoney, s.right, off ? s.off : null]}>{inr(r.closingAmount)}</Text>
                <Text style={[s.d, s.cMoney, s.right, off ? s.off : null]}>{inr(r.joinFeeAmount)}</Text>
                <Text style={[s.d, s.cMoney, s.right, off ? s.off : null]}>{inr(r.totalAmount)}</Text>
                <Text style={[s.d, s.cStatus, off ? s.off : null]}>{paymentStatusLabel(r.status)}</Text>
              </View>
            );
          })}

          {!rows.length && (
            <View style={s.row}>
              <Text style={[s.d, { flex: 1, textAlign: 'center', color: '#888' }]}>
                इन फ़िल्टरों पर कोई रसीद नहीं
              </Text>
            </View>
          )}

          <View style={s.totalRow}>
            <Text style={s.totalLabel}>कुल जमा</Text>
            <Text style={[s.total, s.cMoney, s.right]}>{inr(totals.closingAmount)}</Text>
            <Text style={[s.total, s.cMoney, s.right]}>{inr(totals.joinFeeAmount)}</Text>
            <Text style={[s.total, s.cMoney, s.right, s.totalStrong]}>{inr(totals.collected)}</Text>
          </View>
        </View>

        <Text style={s.footNote}>
          रद्द की गई रसीदें हल्के रंग में हैं और उनकी राशि कुल जमा में नहीं गिनी गई है —
          पैसा वापस जा चुका है।
        </Text>
        {truncated && (
          <Text style={s.footNote}>
            यह तालिका पहली {rows.length} रसीदें दिखाती है। ऊपर के सभी आँकड़े पूरी अवधि के
            हैं, और पूरी सूची CSV फ़ाइल में है।
          </Text>
        )}

        {signatureBlock(b)}

        <Text
          style={s.pageNo}
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}

function Stat({ s, label, value, strong }) {
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, strong ? s.statStrong : null]}>{value}</Text>
    </View>
  );
}

function sheet(primary, accent) {
  return StyleSheet.create({
    page: { fontFamily: FONT_FAMILY, paddingTop: 20, paddingHorizontal: 22, paddingBottom: 36 },

    titleRow: { alignItems: 'center', marginTop: 6, marginBottom: 3 },
    titleBadge: { backgroundColor: primary, borderRadius: 10, paddingVertical: 2, paddingHorizontal: 14 },
    title: { fontSize: 10.5, color: '#fff', fontWeight: 'bold' },
    meta: { fontSize: 8, color: '#555', marginTop: 3 },

    filters: {
      fontSize: 7.5,
      color: '#555',
      textAlign: 'center',
      marginBottom: 4,
      backgroundColor: '#f6f6f6',
      borderRadius: 3,
      paddingVertical: 2,
      paddingHorizontal: 6,
    },

    stats: {
      flexDirection: 'row',
      borderWidth: 0.8,
      borderColor: accent,
      borderRadius: 3,
      marginBottom: 6,
    },
    stat: { flex: 1, alignItems: 'center', paddingVertical: 4 },
    statLabel: { fontSize: 6.8, color: '#666' },
    statValue: { fontSize: 9.5, fontWeight: 'bold', marginTop: 1.5 },
    statStrong: { color: primary, fontSize: 11 },

    table: { borderWidth: 0.6, borderColor: '#bbb', borderRadius: 2 },
    head: {
      flexDirection: 'row',
      backgroundColor: '#f2ece0',
      borderBottomWidth: 0.8,
      borderBottomColor: '#bbb',
    },
    h: { fontSize: 7, fontWeight: 'bold', paddingVertical: 3.5, paddingHorizontal: 2.5 },
    row: { flexDirection: 'row', borderBottomWidth: 0.4, borderBottomColor: '#e2e2e2' },
    rowAlt: { backgroundColor: '#fafafa' },
    d: { fontSize: 7.2, paddingVertical: 3, paddingHorizontal: 2.5 },
    right: { textAlign: 'right' },
    /** Cancelled: still a record, visibly not money the trust has. */
    off: { color: '#aaa', textDecoration: 'line-through' },

    cDate: { width: 50 },
    cReceipt: { width: 92 },
    cReg: { width: 46 },
    cName: { flex: 2 },
    cAgent: { width: 76 },
    cMethod: { width: 46 },
    cNum: { width: 40 },
    cMoney: { width: 60 },
    cStatus: { width: 44 },

    totalRow: {
      flexDirection: 'row',
      backgroundColor: '#fff8e1',
      borderTopWidth: 0.8,
      borderTopColor: accent,
    },
    totalLabel: {
      flex: 1,
      fontSize: 8,
      fontWeight: 'bold',
      textAlign: 'right',
      paddingVertical: 4,
      paddingHorizontal: 6,
    },
    total: { fontSize: 8.5, fontWeight: 'bold', paddingVertical: 4, paddingHorizontal: 2.5 },
    totalStrong: { color: primary },

    footNote: { fontSize: 6.8, color: '#888', marginTop: 4 },

    pageNo: {
      position: 'absolute',
      bottom: 16,
      left: 0,
      right: 0,
      textAlign: 'center',
      fontSize: 6.8,
      color: '#888',
    },
  });
}
