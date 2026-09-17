import 'server-only';

import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

import { FONT_FAMILY } from './renderer.js';
import { trustHeader, inr, hiDate } from './branding.js';
import { amountInWords } from '../../lib/amountWords.js';
import { DEFAULT_PRIMARY, DEFAULT_ACCENT } from '../../lib/theme.js';

/**
 * सहयोग राशि रसीद — one page per member, for a whole क्लोजिंग समूह at once.
 *
 * This is the document the trust actually hands out. The batch notice says
 * what happened; this says what YOU owe for it, with the list of families
 * behind the figure printed underneath so nobody has to take the total on
 * trust.
 *
 * Two things about it are easy to get wrong and are deliberate here:
 *
 * Each member's page lists only the closings THAT MEMBER owes. A member who
 * joined on the 15th is not billed for the 3rd, so their sheet is shorter and
 * their total smaller. Printing the batch's full list on every page would
 * over-bill precisely the newest members.
 *
 * The rate on the page is the member's own, from their age band — never a
 * single figure for the batch. `कुल राशि` is that rate times the number of
 * rows below it, so the arithmetic on the page can be checked by anyone
 * holding it.
 */
export function ClosingBatchReceiptsPdf({ trust, program, batch, bills, startSerial = 1 }) {
  const b = trust?.branding ?? {};
  const primary = b.theme?.primary || DEFAULT_PRIMARY;
  const accent = b.theme?.accent || DEFAULT_ACCENT;
  const s = sheet(primary, accent);

  return (
    <Document
      title={`${batch.name} — सहयोग राशि रसीद`}
      author={b.nameHi || trust?.name || ''}
    >
      {bills.map((bill, i) => (
        <Page key={bill.member.id} size="A4" style={s.page}>
          {trustHeader(b, { compact: true })}

          <View style={s.titleRow}>
            <View style={s.titleBadge}>
              <Text style={s.title}>सहयोग राशि रसीद</Text>
            </View>
          </View>

          {/* ── who this receipt is for ───────────────────────────────── */}
          <View style={s.idRow}>
            <Line s={s} label="क्र. सं." value={String(startSerial + i)} />
            <Line s={s} label="दिनांक" value={batch.dueDate || hiDate(Date.now())} right />
          </View>

          <View style={s.idRow}>
            <Line
              s={s}
              label="नाम"
              value={`${bill.member.regNo} ${bill.member.name}${
                bill.member.fatherName ? ` / ${bill.member.fatherName}` : ''
              }`}
            />
            <Line s={s} label="फोन नं." value={bill.member.phone} right />
          </View>

          <View style={s.idRow}>
            <Line
              s={s}
              label="पता"
              value={[bill.member.village, bill.member.district].filter(Boolean).join(', ')}
            />
          </View>

          <View style={s.idRow}>
            <Line
              s={s}
              label="योजना"
              value={`${program?.hiname || program?.name || ''}${
                batch.name ? `  ·  ${batch.name}` : ''
              }`}
            />
            <Line s={s} label="सहयोग राशि" value={`${inr(bill.rate)}`} right strong />
          </View>

          {/* ── the closings this member is being billed for ──────────── */}
          <View style={s.table}>
            <View style={s.head}>
              <Text style={[s.h, s.cNo]}>#</Text>
              <Text style={[s.h, s.cCode]}>कोड</Text>
              <Text style={[s.h, s.cName]}>नाम</Text>
              <Text style={[s.h, s.cDate]}>दिनांक</Text>
              <Text style={[s.h, s.cPhone]}>मोबाइल न.</Text>
            </View>

            {bill.closings.map((c, n) => (
              <View key={c.id ?? n} style={[s.row, n % 2 ? s.rowAlt : null]} wrap={false}>
                <Text style={[s.d, s.cNo]}>{c.seq ?? n + 1}</Text>
                <Text style={[s.d, s.cCode]}>{c.regNo || '—'}</Text>
                <Text style={[s.d, s.cName]}>
                  {c.name || '—'}
                  {c.fatherName ? `  /  ${c.fatherName}` : ''}
                  {c.village ? `  ${c.village}` : ''}
                </Text>
                <Text style={[s.d, s.cDate]}>{hiDate(c.dateMs)}</Text>
                <Text style={[s.d, s.cPhone]}>{c.phone || '—'}</Text>
              </View>
            ))}
          </View>

          {/* ── what it comes to ─────────────────────────────────────── */}
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>कुल राशि रु.</Text>
            <Text style={s.totalValue}>{inr(bill.total)}</Text>
            <Text style={s.wordsLabel}>शब्दों में रूपये</Text>
            <Text style={s.wordsValue}>{amountInWords(bill.total)} रुपये मात्र</Text>
          </View>

          <View style={s.signRow}>
            <View style={s.signLeft}>
              <Text style={s.signValue}>
                कार्यकर्ता: {bill.member.agentName || 'कार्यालय'}
              </Text>
              {batch.paymentNote ? (
                <Text style={s.note}>{batch.paymentNote}</Text>
              ) : null}
              <Text style={s.note}>
                Note: {batch.name} सहयोग राशि — यह सहयोग राशि स्वैच्छिक है एवं
                गैर-वापसीयोग्य है।
              </Text>
            </View>

            <View style={s.signRight}>
              <View style={s.signLine} />
              <Text style={s.signLabel}>
                {b.signatoryDesignation || 'संस्थापक'} हस्ताक्षर
              </Text>
            </View>
          </View>

          <View style={s.footer} fixed>
            {(b.phone ?? []).filter(Boolean).length > 0 && (
              <Text style={s.footerText}>
                संपर्क सूत्र : {(b.phone ?? []).filter(Boolean).join(', ')}
              </Text>
            )}
            <View style={s.footerRow}>
              <Text style={s.footerSmall}>
                {b.city ? `Exclusive jurisdiction ${b.city}` : ''}
                {b.city && b.state ? `, ${b.state}` : ''}
              </Text>
              <Text style={s.footerSmall}>E. &amp; O.E.</Text>
            </View>
          </View>
        </Page>
      ))}
    </Document>
  );
}

function Line({ s, label, value, right, strong }) {
  return (
    <View style={[s.line, right ? s.lineRight : null]}>
      <Text style={s.lineLabel}>{label} :</Text>
      <Text style={[s.lineValue, strong ? s.lineStrong : null]}>{value || '—'}</Text>
    </View>
  );
}

function sheet(primary, accent) {
  return StyleSheet.create({
    page: { fontFamily: FONT_FAMILY, paddingTop: 22, paddingHorizontal: 26, paddingBottom: 52 },

    titleRow: { alignItems: 'center', marginTop: 6, marginBottom: 8 },
    titleBadge: {
      borderWidth: 1,
      borderColor: accent,
      borderRadius: 12,
      backgroundColor: '#fff8e1',
      paddingVertical: 3,
      paddingHorizontal: 20,
    },
    title: { fontSize: 11, fontWeight: 'bold', color: primary },

    idRow: { flexDirection: 'row', marginBottom: 4 },
    line: { flexDirection: 'row', alignItems: 'flex-end', flex: 1 },
    lineRight: { justifyContent: 'flex-end', flex: 0.7 },
    lineLabel: { fontSize: 9, color: '#333', marginRight: 4 },
    lineValue: { fontSize: 9.5, fontWeight: 'bold' },
    lineStrong: { fontSize: 11, color: primary },

    table: { borderWidth: 0.8, borderColor: '#999', marginTop: 6 },
    head: { flexDirection: 'row', backgroundColor: '#f2ece0', borderBottomWidth: 0.8, borderBottomColor: '#999' },
    h: {
      fontSize: 8,
      fontWeight: 'bold',
      paddingVertical: 4,
      paddingHorizontal: 3,
      textAlign: 'center',
      borderRightWidth: 0.5,
      borderRightColor: '#bbb',
    },
    row: { flexDirection: 'row', borderBottomWidth: 0.4, borderBottomColor: '#ddd' },
    rowAlt: { backgroundColor: '#fafafa' },
    d: {
      fontSize: 8,
      paddingVertical: 3.5,
      paddingHorizontal: 3,
      borderRightWidth: 0.5,
      borderRightColor: '#eee',
    },

    cNo: { width: 26, textAlign: 'center' },
    cCode: { width: 62, textAlign: 'center' },
    cName: { flex: 1 },
    cDate: { width: 66, textAlign: 'center' },
    cPhone: { width: 72, textAlign: 'center' },

    totalRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 8, flexWrap: 'wrap' },
    totalLabel: { fontSize: 9.5, fontWeight: 'bold', marginRight: 6 },
    totalValue: { fontSize: 12, fontWeight: 'bold', color: primary, marginRight: 18 },
    wordsLabel: { fontSize: 8.5, color: '#666', marginRight: 5 },
    wordsValue: { fontSize: 9, fontWeight: 'bold' },

    signRow: { flexDirection: 'row', marginTop: 10 },
    signLeft: { flex: 1, paddingRight: 12 },
    signValue: { fontSize: 9, fontWeight: 'bold' },
    note: { fontSize: 7.5, color: '#555', marginTop: 3, lineHeight: 1.3 },

    signRight: { width: 150, alignItems: 'center', justifyContent: 'flex-end' },
    signLine: { width: '100%', borderTopWidth: 0.8, borderTopColor: '#666', marginTop: 26 },
    signLabel: { fontSize: 8, fontWeight: 'bold', marginTop: 2 },

    footer: {
      position: 'absolute',
      bottom: 18,
      left: 26,
      right: 26,
      borderTopWidth: 0.8,
      borderTopColor: primary,
      paddingTop: 3,
    },
    footerText: { fontSize: 7.5, fontWeight: 'bold', textAlign: 'center', color: primary },
    footerRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
    footerSmall: { fontSize: 7, color: '#666' },
  });
}
