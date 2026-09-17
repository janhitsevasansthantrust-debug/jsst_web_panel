import 'server-only';

import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

import { FONT_FAMILY } from './renderer.js';
import { trustHeader, signatureBlock, inr, hiDate } from './branding.js';
import { DEFAULT_PRIMARY, DEFAULT_ACCENT } from '../../lib/theme.js';

/**
 * क्लोजिंग सूची — every closing in a date range, as a register page.
 *
 * Not the same document as the सूचना पत्र, though they list the same kind of
 * thing. The notice is a bill for one batch, handed to members. This is the
 * office's own record: whatever happened between two dates, what each one was
 * billed at, how much came in against it and how much is still out. It is what
 * gets read at a committee meeting and filed afterwards.
 *
 * Reverted closings ARE shown here, struck through, because the question this
 * page answers is "what happened", and a closing that was taken back is
 * something that happened. On the notice they are hidden, because that page
 * answers "what do you owe".
 */
export function ClosingListPdf({ trust, program, rows, range, totals, generatedAt }) {
  const b = trust?.branding ?? {};
  const primary = b.theme?.primary || DEFAULT_PRIMARY;
  const accent = b.theme?.accent || DEFAULT_ACCENT;
  const s = sheet(primary, accent);

  return (
    <Document title="क्लोजिंग सूची" author={b.nameHi || trust?.name || ''}>
      <Page size="A4" orientation="landscape" style={s.page}>
        {trustHeader(b, { compact: true })}

        <View style={s.titleRow}>
          <View style={s.titleBadge}>
            <Text style={s.title}>क्लोजिंग सूची</Text>
          </View>
          <Text style={s.meta}>
            {rangeLabel(range)}
            {program?.hiname || program?.name ? `   ·   ${program.hiname || program.name}` : ''}
            {'   ·   '}
            {hiDate(generatedAt ?? Date.now())}
          </Text>
        </View>

        <View style={s.stats}>
          <Stat s={s} label="कुल क्लोजिंग" value={String(totals.count)} />
          <Stat s={s} label="चालू" value={String(totals.active)} />
          <Stat s={s} label="वापस ली गई" value={String(totals.reverted)} />
          <Stat s={s} label="कुल माँग" value={inr(totals.expected)} />
          <Stat s={s} label="जमा" value={inr(totals.collected)} strong />
          <Stat s={s} label="बकाया" value={inr(totals.pending)} />
        </View>

        <View style={s.table}>
          <View style={s.head} fixed>
            <Text style={[s.h, s.cSeq]}>क्र.</Text>
            <Text style={[s.h, s.cDate]}>तिथि</Text>
            <Text style={[s.h, s.cReg]}>रजि. नं.</Text>
            <Text style={[s.h, s.cName]}>नाम</Text>
            <Text style={[s.h, s.cFather]}>पिता / पति</Text>
            <Text style={[s.h, s.cJati]}>जाति</Text>
            <Text style={[s.h, s.cVillage]}>गाँव</Text>
            <Text style={[s.h, s.cPhone]}>मोबाईल</Text>
            <Text style={[s.h, s.cAmt, s.right]}>प्रति सदस्य</Text>
            <Text style={[s.h, s.cNum, s.right]}>पात्र</Text>
            <Text style={[s.h, s.cNum, s.right]}>जमा</Text>
            <Text style={[s.h, s.cMoney, s.right]}>जमा राशि</Text>
            <Text style={[s.h, s.cMoney, s.right]}>बकाया</Text>
          </View>

          {rows.map((c, i) => {
            const off = c.status === 'reverted';
            return (
              <View key={c.id ?? i} style={[s.row, i % 2 ? s.rowAlt : null]} wrap={false}>
                <Text style={[s.d, s.cSeq, off ? s.off : null]}>{c.seq}</Text>
                <Text style={[s.d, s.cDate, off ? s.off : null]}>{hiDate(c.dateMs)}</Text>
                <Text style={[s.d, s.cReg, off ? s.off : null]}>{c.regNo || '—'}</Text>
                <Text style={[s.d, s.cName, off ? s.off : null]}>{c.name || '—'}</Text>
                <Text style={[s.d, s.cFather, off ? s.off : null]}>{c.fatherName || '—'}</Text>
                <Text style={[s.d, s.cJati, off ? s.off : null]}>{c.jati || '—'}</Text>
                <Text style={[s.d, s.cVillage, off ? s.off : null]}>{c.village || '—'}</Text>
                <Text style={[s.d, s.cPhone, off ? s.off : null]}>{c.phone || '—'}</Text>
                <Text style={[s.d, s.cAmt, s.right, off ? s.off : null]}>{inr(c.amount)}</Text>
                <Text style={[s.d, s.cNum, s.right, off ? s.off : null]}>{c.eligibleCount ?? '—'}</Text>
                <Text style={[s.d, s.cNum, s.right, off ? s.off : null]}>{c.paidCount ?? 0}</Text>
                <Text style={[s.d, s.cMoney, s.right, off ? s.off : null]}>{inr(c.paidAmount)}</Text>
                <Text style={[s.d, s.cMoney, s.right, off ? s.off : null]}>
                  {c.pendingAmount == null ? '—' : inr(c.pendingAmount)}
                </Text>
              </View>
            );
          })}

          {!rows.length && (
            <View style={s.row}>
              <Text style={[s.d, { flex: 1, textAlign: 'center', color: '#888' }]}>
                इस अवधि में कोई क्लोजिंग नहीं
              </Text>
            </View>
          )}

          <View style={s.totalRow}>
            <Text style={s.totalLabel}>कुल</Text>
            <Text style={[s.total, s.cMoney, s.right]}>{inr(totals.collected)}</Text>
            <Text style={[s.total, s.cMoney, s.right]}>{inr(totals.pending)}</Text>
          </View>
        </View>

        <Text style={s.footNote}>
          वापस ली गई क्लोजिंग हल्के रंग में दिखाई गई हैं — वे किसी से वसूली नहीं जातीं।
        </Text>

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

/** "01-09-2026 से 30-09-2026 तक", or an honest word when the range is open. */
export function rangeLabel({ fromMs, toMs } = {}) {
  if (fromMs && toMs) return `${hiDate(fromMs)} से ${hiDate(toMs)} तक`;
  if (fromMs) return `${hiDate(fromMs)} से आगे`;
  if (toMs) return `${hiDate(toMs)} तक`;
  return 'सभी तिथियाँ';
}

function sheet(primary, accent) {
  return StyleSheet.create({
    page: { fontFamily: FONT_FAMILY, paddingTop: 20, paddingHorizontal: 22, paddingBottom: 36 },

    titleRow: { alignItems: 'center', marginTop: 6, marginBottom: 6 },
    titleBadge: { backgroundColor: primary, borderRadius: 10, paddingVertical: 2, paddingHorizontal: 14 },
    title: { fontSize: 10.5, color: '#fff', fontWeight: 'bold' },
    meta: { fontSize: 8, color: '#555', marginTop: 3 },

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
    /** Reverted: still readable, visibly not owed. */
    off: { color: '#aaa', textDecoration: 'line-through' },

    cSeq: { width: 24 },
    cDate: { width: 48 },
    cReg: { width: 50 },
    cName: { flex: 1.3 },
    cFather: { flex: 1.3 },
    cJati: { width: 44 },
    cVillage: { width: 58 },
    cPhone: { width: 54 },
    cAmt: { width: 46 },
    cNum: { width: 32 },
    cMoney: { width: 54 },

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

    footNote: { fontSize: 6.8, color: '#888', marginTop: 5 },

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
