import 'server-only';

import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

import { FONT_FAMILY } from './renderer.js';
import { inr, hiDate } from './branding.js';
import { DEFAULT_PRIMARY, DEFAULT_ACCENT } from '../../lib/theme.js';

/**
 * क्लोजिंग पेमेंट सारांश — the sheet that goes on top of a stack of receipts.
 *
 * An agent takes the receipts for their members and walks the village. This
 * page is what they and the office both hold: how many members, how many
 * closings each, what each one should bring in, and what that adds up to. When
 * the agent comes back, the office checks the cash against the कुल योग line.
 *
 * One section per agent, so the same document works whether it was asked for
 * as "Bharat Kumar's sheet" or as "the whole batch, agent by agent".
 *
 * `कुल बकाया` is the member's total outstanding across EVERY closing, not just
 * this batch — deliberately, and labelled as such. An agent standing at a door
 * collects what is owed, not what was billed this month, and a sheet showing
 * only the month's figure sends them away from arrears they were standing next
 * to.
 */
export function ClosingBatchSummaryPdf({ trust, program, batch, groups, totals, generatedAt }) {
  const b = trust?.branding ?? {};
  const primary = b.theme?.primary || DEFAULT_PRIMARY;
  const accent = b.theme?.accent || DEFAULT_ACCENT;
  const s = sheet(primary, accent);

  const stamp = hiDate(generatedAt ?? Date.now());

  return (
    <Document
      title={`${batch.name} — क्लोजिंग पेमेंट सारांश`}
      author={b.nameHi || trust?.name || ''}
    >
      <Page size="A4" style={s.page}>
        <Text style={s.trust}>{b.nameHi || trust?.name || 'ट्रस्ट'}</Text>
        <Text style={s.subtitle}>
          क्लोजिंग पेमेंट सारांश — {batch.name} · {stamp}
        </Text>
        <View style={s.rule} />

        {groups.map((g) => (
          <View key={g.agentId ?? 'office'} style={s.section} break={false}>
            <View style={s.metaRow}>
              <Meta s={s} label="एजेंट" value={g.agentName} />
              <Meta s={s} label="ग्रुप" value={batch.name} />
              <Meta s={s} label="योजना" value={program?.hiname || program?.name} />
              <Meta s={s} label="कुल सदस्य" value={String(g.memberCount)} />
              <Meta s={s} label="दिनांक" value={stamp} />
            </View>

            <View style={s.table}>
              <View style={s.head} fixed>
                <Text style={[s.h, s.cNo]}>क्र. सं.</Text>
                <Text style={[s.h, s.cName]}>नाम</Text>
                <Text style={[s.h, s.cReg]}>रजि. नं.</Text>
                <Text style={[s.h, s.cPhone]}>फोन</Text>
                <Text style={[s.h, s.cCount]}>क्लोजिंग काउंट</Text>
                <Text style={[s.h, s.cRate]}>किस्त</Text>
                <Text style={[s.h, s.cMoney]}>कुल राशि</Text>
                <Text style={[s.h, s.cMoney]}>कुल बकाया</Text>
              </View>

              {g.bills.map((bill, i) => (
                <View key={bill.member.id} style={[s.row, i % 2 ? s.rowAlt : null]} wrap={false}>
                  <Text style={[s.d, s.cNo]}>{i + 1}</Text>
                  <Text style={[s.d, s.cName]}>
                    {bill.member.name}
                    {bill.member.fatherName ? ` / ${bill.member.fatherName}` : ''}
                  </Text>
                  <Text style={[s.d, s.cReg]}>{bill.member.regNo || '—'}</Text>
                  <Text style={[s.d, s.cPhone]}>{bill.member.phone || '—'}</Text>
                  <Text style={[s.d, s.cCount]}>{bill.count}</Text>
                  <Text style={[s.d, s.cRate]}>{inr(bill.rate)}</Text>
                  <Text style={[s.d, s.cMoney]}>{inr(bill.total)}</Text>
                  <Text style={[s.d, s.cMoney]}>{inr(bill.member.totalDue)}</Text>
                </View>
              ))}

              <View style={s.totalRow}>
                <Text style={[s.total, s.cTotalLabel]}>
                  कुल योग ({g.memberCount} सदस्य)
                </Text>
                <Text style={[s.total, s.cCount]}>{g.closingCount}</Text>
                <Text style={[s.total, s.cRate]}>—</Text>
                <Text style={[s.total, s.cMoney]}>{inr(g.total)}</Text>
                <Text style={[s.total, s.cMoney]}>{inr(g.totalDue)}</Text>
              </View>
            </View>
          </View>
        ))}

        {groups.length > 1 && (
          <View style={s.grand}>
            <Text style={s.grandLabel}>
              सब मिलाकर — {totals.memberCount} सदस्य, {totals.closingCount} क्लोजिंग
            </Text>
            <Text style={s.grandValue}>{inr(totals.total)}</Text>
          </View>
        )}

        {!groups.length && (
          <Text style={s.empty}>इस समूह के लिए कोई सदस्य नहीं मिला</Text>
        )}

        <Text style={s.foot} fixed>
          Generated on {stamp} — {b.nameHi || trust?.name || ''}
        </Text>
      </Page>
    </Document>
  );
}

function Meta({ s, label, value }) {
  if (!value) return null;
  return (
    <Text style={s.meta}>
      <Text style={s.metaLabel}>{label} : </Text>
      {value}
    </Text>
  );
}

function sheet(primary, accent) {
  return StyleSheet.create({
    page: { fontFamily: FONT_FAMILY, paddingTop: 24, paddingHorizontal: 24, paddingBottom: 40 },

    trust: { fontSize: 13, fontWeight: 'bold', color: primary, textAlign: 'center' },
    subtitle: { fontSize: 8.5, color: '#a33', textAlign: 'center', marginTop: 2 },
    rule: { borderBottomWidth: 1, borderBottomColor: primary, marginTop: 5, marginBottom: 8 },

    section: { marginBottom: 14 },
    metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 5 },
    meta: { fontSize: 8.5, marginRight: 14, marginBottom: 2 },
    metaLabel: { fontWeight: 'bold' },

    table: { borderWidth: 0.6, borderColor: '#ccc' },
    head: { flexDirection: 'row', backgroundColor: '#f6f2ea', borderBottomWidth: 0.8, borderBottomColor: '#ccc' },
    h: {
      fontSize: 7.5,
      fontWeight: 'bold',
      paddingVertical: 4,
      paddingHorizontal: 3,
      textAlign: 'center',
      borderRightWidth: 0.5,
      borderRightColor: '#ddd',
    },
    row: { flexDirection: 'row', borderBottomWidth: 0.4, borderBottomColor: '#eee' },
    rowAlt: { backgroundColor: '#fbfbfb' },
    d: {
      fontSize: 7.8,
      paddingVertical: 3.5,
      paddingHorizontal: 3,
      textAlign: 'center',
      borderRightWidth: 0.5,
      borderRightColor: '#f0f0f0',
    },

    cNo: { width: 40 },
    cName: { flex: 1, textAlign: 'left' },
    cReg: { width: 76 },
    cPhone: { width: 66 },
    cCount: { width: 54 },
    cRate: { width: 42 },
    cMoney: { width: 56 },
    cTotalLabel: { flex: 1, textAlign: 'left', paddingLeft: 6 },

    totalRow: { flexDirection: 'row', backgroundColor: '#fdf3f3', borderTopWidth: 0.8, borderTopColor: accent },
    total: { fontSize: 8.2, fontWeight: 'bold', paddingVertical: 4, paddingHorizontal: 3, textAlign: 'center' },

    grand: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderTopWidth: 1,
      borderTopColor: primary,
      paddingTop: 5,
      marginTop: 4,
    },
    grandLabel: { fontSize: 9.5, fontWeight: 'bold' },
    grandValue: { fontSize: 12, fontWeight: 'bold', color: primary },

    empty: { fontSize: 9, color: '#888', textAlign: 'center', marginTop: 30 },

    foot: {
      position: 'absolute',
      bottom: 18,
      left: 0,
      right: 0,
      textAlign: 'center',
      fontSize: 7,
      color: '#999',
    },
  });
}
