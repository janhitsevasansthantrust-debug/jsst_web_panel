import 'server-only';

import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';

import { FONT_FAMILY } from './renderer.js';
import { DEFAULT_PRIMARY } from '../../lib/theme.js';
import { EXPORT_COLUMNS, cellValue } from '../domain/exportMembers.js';

/**
 * The member list as a printed document.
 *
 * Every mark on it — the name across the top, the logo, the seal, the colour
 * of the header rule, the footer note — comes from the trust document. There
 * is no trust-specific string anywhere in this file, which is the whole point:
 * handing the system to another trust changes what prints without changing
 * what is compiled.
 *
 * Landscape A4 because this is a table with twenty columns; portrait would
 * either drop columns or shrink the type past reading size.
 */

/** Not every export column earns its place on paper. */
const PRINT_COLUMNS = EXPORT_COLUMNS.filter(
  (c) => !['aadhaarNo', 'joinFees', 'joinFeesDone', 'ageGroupRange'].includes(c.key),
);

const TOTAL_WIDTH = PRINT_COLUMNS.reduce((s, c) => s + c.width, 0);

export function MemberListPdf({ trust, members, totals, filters, generatedAt }) {
  const b = trust?.branding ?? {};
  const primary = b.theme?.primary || DEFAULT_PRIMARY;
  const styles = sheet(primary);

  return (
    <Document
      title={`${b.nameHi || 'सदस्य'} — सदस्य सूची`}
      author={b.nameHi || ''}
      creator={b.nameHi || ''}
    >
      <Page size="A4" orientation="landscape" style={styles.page}>
        {/* ── header, repeated on every page ─────────────────────────── */}

        {/* A full-width band, when the trust has artwork for one. */}
        {b.headerImageURL ? (
          <Image src={b.headerImageURL} style={styles.headerBand} fixed />
        ) : null}

        {/* Invocations sit ABOVE the name — `|| श्री गणेशाय नमः ||`. */}
        {(b.topLines ?? []).filter(Boolean).length > 0 && (
          <View style={styles.topLines} fixed>
            {(b.topLines ?? []).filter(Boolean).map((line, i) => (
              <Text key={i} style={styles.topLine}>{line}</Text>
            ))}
          </View>
        )}

        <View style={styles.header} fixed>
          {b.logoURL ? <Image src={b.logoURL} style={styles.logo} /> : <View style={styles.logo} />}

          <View style={styles.headerMiddle}>
            <Text style={styles.trustName}>{b.nameHi || 'ट्रस्ट'}</Text>
            {b.cityState ? <Text style={styles.cityState}>{b.cityState}</Text> : null}
            {b.tagline ? <Text style={styles.tagline}>{b.tagline}</Text> : null}
            {(b.headerLines ?? []).filter(Boolean).map((line, i) => (
              <Text key={i} style={styles.headerLine}>{line}</Text>
            ))}
            {addressLine(b) ? <Text style={styles.headerLine}>{addressLine(b)}</Text> : null}
            {(b.phone ?? []).filter(Boolean).length > 0 && (
              <Text style={styles.headerLine}>
                फ़ोन: {(b.phone ?? []).filter(Boolean).join(', ')}
                {b.contactPerson ? `  ·  संपर्क: ${b.contactPerson}` : ''}
              </Text>
            )}
            {b.registrationNo ? (
              <Text style={styles.headerLine}>पंजी. क्र. {b.registrationNo}</Text>
            ) : null}
          </View>

          {/* The right side takes a second logo if there is one, otherwise the
              seal — a header with a hole on one side looks broken. */}
          {b.rightLogoURL || b.sealURL ? (
            <Image src={b.rightLogoURL || b.sealURL} style={styles.logo} />
          ) : (
            <View style={styles.logo} />
          )}
        </View>

        <View style={styles.titleRow} fixed>
          <Text style={styles.title}>सदस्य सूची</Text>
          <Text style={styles.meta}>{generatedAt}</Text>
        </View>

        {/* What this list actually is. A printout that does not say which
            filters produced it is a printout nobody can check later. */}
        {filters?.length > 0 && (
          <Text style={styles.filters}>फ़िल्टर: {filters.join(' · ')}</Text>
        )}

        {/* ── table ───────────────────────────────────────────────────── */}
        <View style={styles.tableHead} fixed>
          {PRINT_COLUMNS.map((c) => (
            <Text
              key={c.key}
              style={[styles.th, { width: `${(c.width / TOTAL_WIDTH) * 100}%` },
                      c.numeric ? styles.right : null]}
            >
              {c.header}
            </Text>
          ))}
        </View>

        {members.map((m, i) => (
          <View key={m.id ?? i} style={[styles.tr, i % 2 ? styles.trAlt : null]} wrap={false}>
            {PRINT_COLUMNS.map((c) => (
              <Text
                key={c.key}
                style={[styles.td, { width: `${(c.width / TOTAL_WIDTH) * 100}%` },
                        c.numeric ? styles.right : null]}
              >
                {String(cellValue(m, c) ?? '')}
              </Text>
            ))}
          </View>
        ))}

        {/* ── totals ──────────────────────────────────────────────────── */}
        <View style={styles.totals} wrap={false}>
          <Text style={styles.totalsText}>
            कुल सदस्य: {fmt(totals?.count)}   ·   बकायादार: {fmt(totals?.withDue)}
            {'   ·   '}कुल बकाया: ₹{fmt(totals?.dueAmount)}
            {'   ·   '}कुल जमा: ₹{fmt(totals?.paidAmount)}
          </Text>
        </View>

        {/* ── signature and footer ────────────────────────────────────── */}
        <View style={styles.signRow} wrap={false}>
          <View style={styles.signBox}>
            {b.signatureURL ? <Image src={b.signatureURL} style={styles.signature} /> : null}
            <View style={styles.signLine} />
            <Text style={styles.signName}>
              {b.signatoryName || b.presidentName || ''}
            </Text>
            <Text style={styles.signRole}>{b.signatoryDesignation || ''}</Text>
          </View>
        </View>

        {b.footerNote ? (
          <Text style={styles.footerNote} fixed>{b.footerNote}</Text>
        ) : null}

        <Text
          style={styles.pageNo}
          fixed
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
        />
      </Page>
    </Document>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

const fmt = (n) => Number(n ?? 0).toLocaleString('en-IN');

function addressLine(b) {
  return [b.addressHi, b.city, b.district, b.state, b.pinCode].filter(Boolean).join(', ');
}

/**
 * The stylesheet takes the trust's primary colour, so it is built per render
 * rather than defined once at module scope.
 */
function sheet(primary) {
  return StyleSheet.create({
    page: {
      fontFamily: FONT_FAMILY,
      fontSize: 8,
      paddingTop: 20,
      paddingBottom: 36,
      paddingHorizontal: 20,
      color: '#1a1a1a',
    },

    headerBand: { width: '100%', maxHeight: 46, objectFit: 'contain', marginBottom: 4 },
    topLines: { alignItems: 'center', marginBottom: 3 },
    topLine: { fontSize: 8, fontWeight: 'bold', color: primary, marginBottom: 1 },

    header: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
    logo: { width: 42, height: 42, objectFit: 'contain' },
    headerMiddle: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
    trustName: { fontSize: 15, fontWeight: 'bold', color: primary },
    cityState: { fontSize: 9, fontWeight: 'bold', marginTop: 1 },
    tagline: { fontSize: 8, color: '#555', marginTop: 1 },
    headerLine: { fontSize: 7, color: '#555', marginTop: 1 },

    titleRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      borderBottomWidth: 1.5,
      borderBottomColor: primary,
      paddingBottom: 3,
      marginBottom: 6,
    },
    title: { fontSize: 11, fontWeight: 'bold', color: primary },
    meta: { fontSize: 7, color: '#666' },
    filters: { fontSize: 7, color: '#666', marginBottom: 5 },

    tableHead: {
      flexDirection: 'row',
      backgroundColor: primary,
      paddingVertical: 3,
      paddingHorizontal: 2,
    },
    th: { color: '#fff', fontSize: 7, fontWeight: 'bold', paddingHorizontal: 2 },

    tr: {
      flexDirection: 'row',
      paddingVertical: 2.5,
      paddingHorizontal: 2,
      borderBottomWidth: 0.5,
      borderBottomColor: '#e8e8e8',
    },
    trAlt: { backgroundColor: '#fafafa' },
    td: { fontSize: 7, paddingHorizontal: 2 },
    right: { textAlign: 'right' },

    totals: {
      marginTop: 8,
      paddingTop: 5,
      borderTopWidth: 1,
      borderTopColor: primary,
    },
    totalsText: { fontSize: 8, fontWeight: 'bold' },

    signRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 26 },
    signBox: { width: 150, alignItems: 'center' },
    signature: { height: 28, objectFit: 'contain', marginBottom: 2 },
    signLine: { width: '100%', borderTopWidth: 0.8, borderTopColor: '#888', marginTop: 2 },
    signName: { fontSize: 8, marginTop: 2 },
    signRole: { fontSize: 7, color: '#666' },

    footerNote: {
      position: 'absolute',
      bottom: 18,
      left: 20,
      right: 60,
      fontSize: 6.5,
      color: '#888',
    },
    pageNo: {
      position: 'absolute',
      bottom: 18,
      right: 20,
      fontSize: 7,
      color: '#888',
    },
  });
}
