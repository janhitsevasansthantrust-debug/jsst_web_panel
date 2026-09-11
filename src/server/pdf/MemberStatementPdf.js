import 'server-only';

import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';

import { FONT_FAMILY } from './renderer.js';
import { trustHeader, signatureBlock, inr, hiDate } from './branding.js';
import { DEFAULT_PRIMARY } from '../../lib/theme.js';

/**
 * One member's position, printed.
 *
 * The document the old system called the "pending payment" sheet: who the
 * member is, what they owe, and the closing-by-closing list behind that
 * number. It is what gets handed over when someone asks "how much do I owe and
 * for what" — so the list matters as much as the total. A figure with no
 * itemisation is a figure people argue with.
 *
 * `mode` picks which side is shown: what is outstanding, or what has been
 * paid. Same layout either way, because they are read side by side.
 */
export function MemberStatementPdf({ trust, member, ledger, mode = 'pending' }) {
  const b = trust?.branding ?? {};
  const primary = b.theme?.primary || DEFAULT_PRIMARY;
  const s = sheet(primary);

  const isPaid = mode === 'paid';
  const rows = isPaid ? (ledger.receipts ?? []) : (ledger.due?.items ?? []);

  const title = isPaid ? 'जमा विवरण' : 'बकाया विवरण';

  return (
    <Document title={`${member.displayName} — ${title}`} author={b.nameHi || ''}>
      <Page size="A4" style={s.page}>
        {trustHeader(b)}

        <View style={s.titleRow} fixed>
          <View style={s.titleBadge}>
            <Text style={s.title}>{title}</Text>
          </View>
          <Text style={s.meta}>
            {hiDate(Date.now())}
            {member.programName ? `   ·   ${member.programName}` : ''}
          </Text>
        </View>

        {/* ── who ─────────────────────────────────────────────────────── */}
        <View style={s.card}>
          {member.photoURL ? (
            <Image src={member.photoURL} style={s.photo} />
          ) : (
            <View style={[s.photo, s.photoEmpty]}>
              <Text style={s.photoText}>फोटो{'\n'}नहीं</Text>
            </View>
          )}

          <View style={s.cardBody}>
            <View style={s.nameRow}>
              <Text style={s.name}>
                {member.displayName} {member.jati || ''}
              </Text>
              <View style={s.regBadge}>
                <Text style={s.regText}>रजि. {member.registrationNumber || '—'}</Text>
              </View>
            </View>

            <View style={s.grid}>
              <Field label="पिता / पति" value={member.fatherName} />
              <Field label="मोबाइल" value={member.phone} />
              <Field label="गाँव" value={member.village} />
              <Field label="आयु समूह" value={member.ageGroupRange} />
              <Field label="प्रति क्लोजिंग" value={inr(member.payAmount)} />
              <Field label="एजेंट" value={member.agentName || 'सीधे जोड़ा गया'} />
            </View>
          </View>
        </View>

        {/* ── the four numbers people actually ask for ────────────────── */}
        <View style={s.stats}>
          <Stat label="कुल पात्र क्लोजिंग" value={ledger.eligible?.count ?? 0} />
          <Stat label="जमा क्लोजिंग" value={ledger.settled?.count ?? 0} />
          <Stat label="बकाया क्लोजिंग" value={ledger.due?.count ?? 0} accent={primary} />
          <Stat
            label={isPaid ? 'कुल जमा' : 'कुल बकाया'}
            value={inr(isPaid ? ledger.settled?.amount : ledger.due?.amount)}
            accent={primary}
          />
        </View>

        {/* ── the itemisation ─────────────────────────────────────────── */}
        <View style={s.table}>
          <View style={s.thead} fixed>
            <Text style={[s.th, s.colNo]}>क्र.</Text>
            {isPaid ? (
              <>
                <Text style={[s.th, s.colWide]}>रसीद नंबर</Text>
                <Text style={[s.th, s.colDate]}>तिथि</Text>
                <Text style={[s.th, s.colNo]}>क्लोजिंग</Text>
                <Text style={[s.th, s.colAmt]}>राशि</Text>
              </>
            ) : (
              <>
                <Text style={[s.th, s.colSeq]}>क्रम</Text>
                <Text style={[s.th, s.colWide]}>किसकी क्लोजिंग</Text>
                <Text style={[s.th, s.colReg]}>रजि.</Text>
                <Text style={[s.th, s.colDate]}>तिथि</Text>
                <Text style={[s.th, s.colAmt]}>राशि</Text>
              </>
            )}
          </View>

          {rows.map((row, i) => (
            <View key={row.seq ?? row.id ?? i} style={[s.tr, i % 2 ? s.trAlt : null]} wrap={false}>
              <Text style={[s.td, s.colNo]}>{i + 1}</Text>
              {isPaid ? (
                <>
                  <Text style={[s.td, s.colWide]}>{row.receiptNo}</Text>
                  <Text style={[s.td, s.colDate]}>{hiDate(row.paidAtMs)}</Text>
                  <Text style={[s.td, s.colNo]}>{row.itemCount}</Text>
                  <Text style={[s.td, s.colAmt]}>{inr(row.totalAmount)}</Text>
                </>
              ) : (
                <>
                  <Text style={[s.td, s.colSeq]}>{row.seq}</Text>
                  <Text style={[s.td, s.colWide]}>{row.name || '—'}</Text>
                  <Text style={[s.td, s.colReg]}>{row.regNo || '—'}</Text>
                  <Text style={[s.td, s.colDate]}>{hiDate(row.dateMs)}</Text>
                  <Text style={[s.td, s.colAmt]}>
                    {inr(row.remaining)}{row.partial ? ' *' : ''}
                  </Text>
                </>
              )}
            </View>
          ))}

          {rows.length === 0 && (
            <View style={s.tr}>
              <Text style={[s.td, { flex: 1, textAlign: 'center', color: '#888' }]}>
                {isPaid ? 'कोई रसीद नहीं' : 'कोई बकाया नहीं'}
              </Text>
            </View>
          )}
        </View>

        <View style={s.totalRow} wrap={false}>
          <Text style={s.totalLabel}>
            {isPaid ? 'कुल जमा' : 'कुल बकाया'} ({rows.length})
          </Text>
          <Text style={s.totalValue}>
            {inr(isPaid ? ledger.settled?.amount : ledger.due?.amount)}
          </Text>
        </View>

        {!isPaid && (ledger.due?.items ?? []).some((r) => r.partial) && (
          <Text style={s.footnote}>
            * आंशिक भुगतान हो चुका है — दिखाई गई राशि शेष है।
          </Text>
        )}

        {signatureBlock(b)}

        {b.footerNote ? <Text style={s.footer} fixed>{b.footerNote}</Text> : null}

        <Text
          style={s.pageNo}
          fixed
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
        />
      </Page>
    </Document>
  );
}

/* ── pieces ──────────────────────────────────────────────────────────────── */

function Field({ label, value }) {
  const s = smallStyles();
  return (
    <View style={s.item}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value || '—'}</Text>
    </View>
  );
}

function Stat({ label, value, accent }) {
  const s = smallStyles();
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, accent ? { color: accent } : null]}>{value}</Text>
    </View>
  );
}

function smallStyles() {
  return StyleSheet.create({
    item: { width: '33.33%', paddingVertical: 2, paddingRight: 8 },
    label: { fontSize: 6.5, color: '#888', fontFamily: FONT_FAMILY },
    value: { fontSize: 9, fontWeight: 'bold', fontFamily: FONT_FAMILY },

    stat: { flex: 1, alignItems: 'center' },
    statLabel: { fontSize: 7, color: '#777', fontFamily: FONT_FAMILY },
    statValue: { fontSize: 13, fontWeight: 'bold', fontFamily: FONT_FAMILY, marginTop: 1 },
  });
}

function sheet(primary) {
  return StyleSheet.create({
    page: {
      fontFamily: FONT_FAMILY,
      fontSize: 8,
      paddingTop: 20,
      paddingBottom: 40,
      paddingHorizontal: 24,
    },

    titleRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 8,
      marginBottom: 8,
    },
    titleBadge: {
      backgroundColor: primary, paddingHorizontal: 12, paddingVertical: 3, borderRadius: 3,
    },
    title: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
    meta: { fontSize: 7.5, color: '#666' },

    card: {
      flexDirection: 'row',
      gap: 10,
      borderWidth: 0.8,
      borderColor: '#e2e2e6',
      borderRadius: 4,
      padding: 8,
      marginBottom: 8,
    },
    photo: { width: 54, height: 62, objectFit: 'cover', borderRadius: 3 },
    photoEmpty: {
      backgroundColor: '#f2f2f4', alignItems: 'center', justifyContent: 'center',
    },
    photoText: { fontSize: 7, color: '#aaa', textAlign: 'center', fontFamily: FONT_FAMILY },
    cardBody: { flex: 1 },
    nameRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: 4,
    },
    name: { fontSize: 12, fontWeight: 'bold' },
    regBadge: {
      backgroundColor: primary, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 3,
    },
    regText: { color: '#fff', fontSize: 8, fontWeight: 'bold' },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },

    stats: {
      flexDirection: 'row',
      backgroundColor: '#f7f7f9',
      borderRadius: 4,
      paddingVertical: 7,
      marginBottom: 8,
    },

    table: { borderWidth: 0.5, borderColor: '#e2e2e6', borderRadius: 3 },
    thead: { flexDirection: 'row', backgroundColor: primary },
    th: { color: '#fff', fontSize: 7.5, fontWeight: 'bold', padding: 4 },
    tr: { flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: '#eee' },
    trAlt: { backgroundColor: '#fafafa' },
    td: { fontSize: 8, padding: 4 },

    colNo: { width: '8%', textAlign: 'center' },
    colSeq: { width: '10%', textAlign: 'center' },
    colWide: { width: '42%' },
    colReg: { width: '14%', textAlign: 'center' },
    colDate: { width: '18%', textAlign: 'center' },
    colAmt: { width: '18%', textAlign: 'right' },

    totalRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: 12,
      marginTop: 8,
      paddingTop: 6,
      borderTopWidth: 1,
      borderTopColor: primary,
    },
    totalLabel: { fontSize: 9, fontWeight: 'bold' },
    totalValue: { fontSize: 14, fontWeight: 'bold', color: primary },

    footnote: { fontSize: 7, color: '#777', marginTop: 4 },
    footer: {
      position: 'absolute', bottom: 20, left: 24, right: 70,
      fontSize: 6.5, color: '#999',
    },
    pageNo: {
      position: 'absolute', bottom: 20, right: 24, fontSize: 7, color: '#999',
    },
  });
}
