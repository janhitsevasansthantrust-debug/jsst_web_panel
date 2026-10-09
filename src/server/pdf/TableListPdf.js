import 'server-only';

import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

import { FONT_FAMILY } from './renderer.js';
import { trustHeader, signatureBlock } from './branding.js';
import { DEFAULT_PRIMARY } from '../../lib/theme.js';

/**
 * A branded, printable list — used by the agent app for "who has paid / who
 * still owes" sheets.
 *
 * Generic on purpose: the caller says which columns, the trust document says
 * how the page is headed. Nothing trust-specific is written here.
 *
 * @param {object}   props
 * @param {object}   props.trust
 * @param {string}   props.title        big heading, e.g. "बकाया सूची"
 * @param {string[]} [props.lines]      what this list is — closing, agent, date
 * @param {Array<{key:string, header:string, width:number, align?:'right'|'center'}>} props.columns
 * @param {Array<object>} props.rows    plain values, already formatted
 * @param {string[]} [props.totals]     lines printed under the table
 * @param {boolean}  [props.landscape]
 */
export function TableListPdf({ trust, title, lines = [], columns, rows, totals = [], landscape = false, generatedAt }) {
  const b = trust?.branding ?? {};
  const primary = b.theme?.primary || DEFAULT_PRIMARY;
  const s = sheet(primary);
  const total = columns.reduce((t, c) => t + c.width, 0);
  const w = (c) => ({ width: `${(c.width / total) * 100}%` });
  const align = (c) => (c.align === 'right' ? s.right : c.align === 'center' ? s.center : null);

  return (
    <Document title={title} author={b.nameHi || ''}>
      <Page size="A4" orientation={landscape ? 'landscape' : 'portrait'} style={s.page}>
        {trustHeader(b, { compact: true })}

        <View style={s.titleRow}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.meta}>{generatedAt}</Text>
        </View>
        {lines.filter(Boolean).map((l, i) => (
          <Text key={i} style={s.line}>{l}</Text>
        ))}

        <View style={s.thead} fixed>
          {columns.map((c) => (
            <Text key={c.key} style={[s.th, w(c), align(c)]}>{c.header}</Text>
          ))}
        </View>

        {rows.length === 0 ? (
          <Text style={s.empty}>कोई पंक्ति नहीं</Text>
        ) : rows.map((r, i) => (
          <View key={i} style={[s.tr, i % 2 ? s.alt : null]} wrap={false}>
            {columns.map((c) => (
              <Text key={c.key} style={[s.td, w(c), align(c)]}>{String(r[c.key] ?? '')}</Text>
            ))}
          </View>
        ))}

        {totals.length > 0 && (
          <View style={s.totals} wrap={false}>
            {totals.map((t, i) => <Text key={i} style={s.totalText}>{t}</Text>)}
          </View>
        )}

        <View wrap={false}>{signatureBlock(b)}</View>

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

function sheet(primary) {
  return StyleSheet.create({
    page: { fontFamily: FONT_FAMILY, fontSize: 8.5, padding: 22, paddingBottom: 38, color: '#1a1a1a' },
    titleRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
      marginTop: 8, marginBottom: 3,
    },
    title: { fontSize: 12.5, fontWeight: 'bold', color: primary },
    meta: { fontSize: 7, color: '#666' },
    line: { fontSize: 8, color: '#333', marginBottom: 1.5 },
    thead: {
      flexDirection: 'row', backgroundColor: primary, paddingVertical: 3.5,
      paddingHorizontal: 2, marginTop: 6,
    },
    th: { color: '#fff', fontSize: 7.5, fontWeight: 'bold', paddingHorizontal: 2 },
    tr: {
      flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 2,
      borderBottomWidth: 0.5, borderBottomColor: '#e5e5e5',
    },
    alt: { backgroundColor: '#fafafa' },
    td: { fontSize: 7.8, paddingHorizontal: 2 },
    right: { textAlign: 'right' },
    center: { textAlign: 'center' },
    empty: { fontSize: 9, color: '#777', textAlign: 'center', marginTop: 16 },
    totals: { marginTop: 8, paddingTop: 5, borderTopWidth: 1, borderTopColor: primary },
    totalText: { fontSize: 9, fontWeight: 'bold', marginBottom: 2 },
    footer: { position: 'absolute', bottom: 18, left: 22, right: 70, fontSize: 6.5, color: '#888' },
    pageNo: { position: 'absolute', bottom: 18, right: 22, fontSize: 7, color: '#888' },
  });
}
