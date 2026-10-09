import 'server-only';

import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';

import { FONT_FAMILY } from './renderer.js';
import { trustHeader, signatureBlock, inr, hiDate } from './branding.js';
import { DEFAULT_PRIMARY } from '../../lib/theme.js';
import { amountInWords } from '../../lib/amountWords.js';

/**
 * The रसीद — a receipt for one payment.
 *
 * Printed two to a page: one for the member, one for the trust's own file.
 * That is how these are actually used — the collector tears the sheet and
 * hands half over — and printing one per page would double the paper for a
 * document that is mostly white space.
 *
 * Everything identifying the trust comes from its branding record, so the same
 * code prints a different trust's receipt without being edited.
 */
export function ReceiptPdf({ trust, receipt, member, copies = ['सदस्य प्रति', 'कार्यालय प्रति'] }) {
  const b = trust?.branding ?? {};
  const primary = b.theme?.primary || DEFAULT_PRIMARY;
  const s = sheet(primary);

  return (
    <Document
      title={`${b.nameHi || 'रसीद'} — ${receipt.receiptNo}`}
      author={b.nameHi || ''}
    >
      <Page size="A4" style={s.page}>
        {copies.map((label, i) => (
          <View key={label} style={[s.copy, i > 0 ? s.copySecond : null]}>
            {trustHeader(b, { compact: true })}

            <View style={s.titleRow}>
              <View style={s.titleBadge}>
                <Text style={s.title}>भुगतान रसीद</Text>
              </View>
              <Text style={s.copyLabel}>{label}</Text>
            </View>

            {receipt.status === 'cancelled' ? <Text>रद्द रसीद — {receipt.cancelReason}</Text> : null}
            {receipt.reversedSeqs?.length ? <Text>वापस की गई क्लोजिंग: {receipt.reversedSeqs.join(', ')} · राशि {inr(receipt.reversedAmount)}</Text> : null}

            {/* ── receipt number and date ─────────────────────────────── */}
            <View style={s.metaRow}>
              <View style={s.metaBox}>
                <Text style={s.metaLabel}>रसीद नंबर</Text>
                <Text style={s.metaValueBig}>{receipt.receiptNo}</Text>
              </View>
              <View style={s.metaBox}>
                <Text style={s.metaLabel}>तिथि</Text>
                <Text style={s.metaValue}>{hiDate(receipt.paidAtMs)}</Text>
              </View>
              <View style={s.metaBox}>
                <Text style={s.metaLabel}>माध्यम</Text>
                <Text style={s.metaValue}>{methodLabel(receipt.method)}</Text>
              </View>
              {receipt.groupCode ? (
                <View style={s.metaBox}>
                  <Text style={s.metaLabel}>समूह</Text>
                  <Text style={s.metaValue}>
                    {receipt.groupName || receipt.groupCode}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* ── who paid ────────────────────────────────────────────── */}
            <View style={s.memberRow}>
              {member?.photoURL ? (
                <Image src={member.photoURL} style={s.photo} />
              ) : null}

              <View style={s.memberCols}>
                <Field label="सदस्य का नाम" value={receipt.memberSnapshot?.name} wide />
                <Field label="रजि. नंबर" value={receipt.memberSnapshot?.regNo} />
                <Field label="पिता / पति" value={receipt.memberSnapshot?.fatherName} wide />
                <Field label="गाँव" value={receipt.memberSnapshot?.village} />
                <Field label="मोबाइल" value={receipt.memberSnapshot?.phone} />
                <Field label="एजेंट" value={receipt.collectedByAgentName || '—'} />
              </View>
            </View>

            {/* ── what was paid for ───────────────────────────────────── */}
            <View style={s.table}>
              <View style={s.thead}>
                <Text style={[s.th, s.colSeq]}>क्रम</Text>
                <Text style={[s.th, s.colName]}>किसकी क्लोजिंग</Text>
                <Text style={[s.th, s.colDate]}>तिथि</Text>
                <Text style={[s.th, s.colAmt]}>राशि</Text>
              </View>

              {(receipt.items ?? []).map((item, n) => (
                <View key={item.seq ?? n} style={[s.tr, n % 2 ? s.trAlt : null]}>
                  <Text style={[s.td, s.colSeq]}>{item.seq}</Text>
                  <Text style={[s.td, s.colName]}>
                    {item.name || '—'}
                    {item.regNo ? ` (${item.regNo})` : ''}
                  </Text>
                  <Text style={[s.td, s.colDate]}>{hiDate(item.closingDateMs ?? item.dateMs)}</Text>
                  <Text style={[s.td, s.colAmt]}>{inr(item.amount)}</Text>
                </View>
              ))}

            </View>

            {/* ── totals ──────────────────────────────────────────────── */}
            <View style={s.totalsRow}>
              <View style={s.totalsLeft}>
                {receipt.joinFeeAmount > 0 && (
                  <Text style={s.totalLine}>
                    नामांकन शुल्क: {inr(receipt.joinFeeAmount)}
                  </Text>
                )}
                <Text style={s.totalLine}>
                  क्लोजिंग ({receipt.itemCount ?? 0}): {inr(receipt.closingAmount)}
                </Text>
                {receipt.note ? (
                  <Text style={s.note}>नोट: {receipt.note}</Text>
                ) : null}
              </View>

              <View style={s.grandBox}>
                <Text style={s.grandLabel}>कुल प्राप्त</Text>
                <Text style={s.grandValue}>{inr(receipt.totalAmount)}</Text>
              </View>
            </View>

            {/* Amount in words: the line that stops a receipt being altered
                after it is handed over. */}
            <Text style={s.words}>
              अक्षरे: {amountInWords(receipt.totalAmount)} रुपये मात्र
            </Text>

            {signatureBlock(b)}

            {b.footerNote ? <Text style={s.footer}>{b.footerNote}</Text> : null}
          </View>
        ))}
      </Page>
    </Document>
  );
}

/* ── pieces ──────────────────────────────────────────────────────────────── */

function Field({ label, value, wide }) {
  const s = fieldStyles();
  return (
    <View style={[s.item, wide ? s.wide : null]}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value || '—'}</Text>
    </View>
  );
}

function methodLabel(method) {
  return {
    cash: 'नकद', online: 'ऑनलाइन', upi: 'UPI', cheque: 'चेक', bank: 'बैंक',
  }[method] ?? method ?? '—';
}

/* ── styles ──────────────────────────────────────────────────────────────── */

function fieldStyles() {
  return StyleSheet.create({
    item: { width: '33.33%', paddingVertical: 2, paddingRight: 6 },
    wide: { width: '33.33%' },
    label: { fontSize: 6.5, color: '#888', fontFamily: FONT_FAMILY },
    value: { fontSize: 9, fontWeight: 'bold', fontFamily: FONT_FAMILY },
  });
}

function sheet(primary) {
  return StyleSheet.create({
    page: {
      fontFamily: FONT_FAMILY,
      fontSize: 8,
      paddingVertical: 16,
      paddingHorizontal: 22,
    },

    copy: {
      borderWidth: 1,
      borderColor: '#ddd',
      borderRadius: 4,
      padding: 12,
      minHeight: '48%',
    },
    // A dashed rule between the two halves: it is a tear line, and it should
    // look like one.
    copySecond: {
      marginTop: 12,
      borderTopWidth: 1,
      borderTopStyle: 'dashed',
      borderTopColor: '#999',
    },

    titleRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 6,
      marginBottom: 6,
    },
    titleBadge: {
      backgroundColor: primary,
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 3,
    },
    title: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
    copyLabel: { fontSize: 8, color: '#666' },

    metaRow: {
      flexDirection: 'row',
      backgroundColor: '#f7f7f9',
      borderRadius: 3,
      paddingVertical: 4,
      paddingHorizontal: 8,
      marginBottom: 6,
    },
    metaBox: { flex: 1 },
    metaLabel: { fontSize: 6.5, color: '#888' },
    metaValue: { fontSize: 9, fontWeight: 'bold' },
    metaValueBig: { fontSize: 10, fontWeight: 'bold', color: primary },

    memberRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
    photo: { width: 46, height: 52, objectFit: 'cover', borderRadius: 3 },
    memberCols: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },

    table: { borderWidth: 0.5, borderColor: '#ddd', borderRadius: 3 },
    thead: { flexDirection: 'row', backgroundColor: primary },
    th: { color: '#fff', fontSize: 7, fontWeight: 'bold', padding: 3 },
    tr: {
      flexDirection: 'row',
      borderTopWidth: 0.5,
      borderTopColor: '#eee',
    },
    trAlt: { backgroundColor: '#fafafa' },
    td: { fontSize: 7.5, padding: 3 },
    colSeq: { width: '10%', textAlign: 'center' },
    colName: { width: '52%' },
    colDate: { width: '20%', textAlign: 'center' },
    colAmt: { width: '18%', textAlign: 'right' },

    totalsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      marginTop: 6,
    },
    totalsLeft: { flex: 1 },
    totalLine: { fontSize: 8, color: '#444' },
    note: { fontSize: 7, color: '#777', marginTop: 2 },

    grandBox: {
      borderWidth: 1.2,
      borderColor: primary,
      borderRadius: 3,
      paddingHorizontal: 12,
      paddingVertical: 4,
      alignItems: 'center',
    },
    grandLabel: { fontSize: 7, color: '#666' },
    grandValue: { fontSize: 14, fontWeight: 'bold', color: primary },

    words: { fontSize: 8, marginTop: 4, fontStyle: 'italic', color: '#333' },
    footer: { fontSize: 6.5, color: '#999', textAlign: 'center', marginTop: 4 },
  });
}
