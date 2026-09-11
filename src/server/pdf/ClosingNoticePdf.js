import 'server-only';

import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';

import { FONT_FAMILY } from './renderer.js';
import { trustHeader, signatureBlock, inr, hiDate } from './branding.js';
import { amountInWords } from '../../lib/amountWords.js';
import { DEFAULT_PRIMARY, DEFAULT_ACCENT } from '../../lib/theme.js';

/**
 * क्लोजिंग सूचना पत्र — the month's notice.
 *
 * One sheet, handed to every member: here are the families we lost or married
 * this month, here is your share for each, here is the total, pay it by this
 * date at this place.
 *
 * The old system had no such document. It printed a `सदस्यता समापन पत्र` for
 * the closed member's own family — useful, and still its own thing — but the
 * notice that goes to the other five thousand people was a photocopied list
 * somebody typed by hand every month. Which is why the amounts on it and the
 * amounts in the system used to disagree.
 *
 * The table lists what a person needs to recognise a family: registration
 * number, name, father or husband, जाति, village, phone and the date. Not
 * because the system needs them — it needs the seq — but because the sheet is
 * read by people who knew the family, and "राम कुमार" alone identifies four of
 * them in any large trust.
 */
export function ClosingNoticePdf({ trust, program, batch, rows, perMemberAmount }) {
  const b = trust?.branding ?? {};
  const primary = b.theme?.primary || DEFAULT_PRIMARY;
  const accent = b.theme?.accent || DEFAULT_ACCENT;
  const s = sheet(primary, accent);

  return (
    <Document
      title={`${batch.name} — क्लोजिंग सूचना`}
      author={b.nameHi || trust?.name || ''}
    >
      <Page size="A4" style={s.page}>
        {trustHeader(b)}

        <View style={s.titleRow}>
          <View style={s.titleBadge}>
            <Text style={s.title}>क्लोजिंग सूचना पत्र</Text>
          </View>
          <Text style={s.meta}>
            {batch.name}
            {program?.hiname || program?.name ? `   ·   ${program.hiname || program.name}` : ''}
          </Text>
        </View>

        {/* ── the four facts somebody reads before the list ────────────── */}
        <View style={s.factRow}>
          <Fact label="कुल क्लोजिंग" value={String(rows.length)} s={s} />
          <Fact label="प्रति सदस्य राशि" value={`${inr(perMemberAmount)}/-`} s={s} strong />
          <Fact
            label="भुगतान की अंतिम तिथि"
            value={batch.dueDate || hiDate(batch.dueDateMs)}
            s={s}
          />
          <Fact label="जारी दिनांक" value={hiDate(Date.now())} s={s} />
        </View>

        <View style={s.wordsRow}>
          <Text style={s.wordsLabel}>अक्षरे</Text>
          <Text style={s.wordsValue}>{amountInWords(perMemberAmount)} रुपये मात्र</Text>
        </View>

        {/* ── the list ─────────────────────────────────────────────────── */}
        <View style={s.table}>
          <View style={s.head} fixed>
            <Text style={[s.h, s.cNo]}>क्र.</Text>
            <Text style={[s.h, s.cReg]}>रजि. नं.</Text>
            <Text style={[s.h, s.cName]}>नाम</Text>
            <Text style={[s.h, s.cFather]}>पिता / पति</Text>
            <Text style={[s.h, s.cJati]}>जाति</Text>
            <Text style={[s.h, s.cVillage]}>गाँव</Text>
            <Text style={[s.h, s.cPhone]}>मोबाईल</Text>
            <Text style={[s.h, s.cDate]}>तिथि</Text>
            <Text style={[s.h, s.cAmt]}>राशि</Text>
          </View>

          {rows.map((c, i) => (
            <View key={c.id ?? i} style={[s.row, i % 2 ? s.rowAlt : null]} wrap={false}>
              <Text style={[s.d, s.cNo]}>{i + 1}</Text>
              <Text style={[s.d, s.cReg]}>{c.regNo || '—'}</Text>
              <Text style={[s.d, s.cName]}>{c.name || '—'}</Text>
              <Text style={[s.d, s.cFather]}>{c.fatherName || '—'}</Text>
              <Text style={[s.d, s.cJati]}>{c.jati || '—'}</Text>
              <Text style={[s.d, s.cVillage]}>{c.village || '—'}</Text>
              <Text style={[s.d, s.cPhone]}>{c.phone || '—'}</Text>
              <Text style={[s.d, s.cDate]}>{hiDate(c.dateMs)}</Text>
              <Text style={[s.d, s.cAmt, s.right]}>{inr(c.amount)}</Text>
            </View>
          ))}

          <View style={s.totalRow}>
            <Text style={[s.total, s.cNo]} />
            <Text style={s.totalLabel}>
              कुल {rows.length} क्लोजिंग — प्रति सदस्य देय
            </Text>
            <Text style={[s.total, s.cAmt, s.right]}>{inr(perMemberAmount)}</Text>
          </View>
        </View>

        {/* ── how and where to pay ─────────────────────────────────────── */}
        {batch.paymentNote ? (
          <View style={s.note}>
            <Text style={s.noteLabel}>भुगतान के लिए</Text>
            <Text style={s.noteText}>{batch.paymentNote}</Text>
          </View>
        ) : null}

        {batch.description ? (
          <Text style={s.description}>{batch.description}</Text>
        ) : null}

        {/* The invitation card, where the trust attaches one. Last, and sized
            to what is left rather than to the image: a wedding card scanned at
            full page would otherwise push the signatures onto a sheet of their
            own. */}
        {batch.invitationCardURL ? (
          <View style={s.card}>
            <Text style={s.cardLabel}>निमंत्रण पत्र</Text>
            <Image src={batch.invitationCardURL} style={s.cardImage} />
          </View>
        ) : null}

        <View style={s.footNote}>
          <Text style={s.footNoteText}>
            यह राशि आपके खाते में जुड़ चुकी है। भुगतान के बाद रसीद ज़रूर लें —
            बिना रसीद का भुगतान खाते में दर्ज नहीं होता।
          </Text>
        </View>

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

function Fact({ label, value, s, strong }) {
  return (
    <View style={s.fact}>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={[s.factValue, strong ? s.factStrong : null]}>{value || '—'}</Text>
    </View>
  );
}

function sheet(primary, accent) {
  return StyleSheet.create({
    page: { fontFamily: FONT_FAMILY, paddingTop: 24, paddingHorizontal: 28, paddingBottom: 40 },

    titleRow: { alignItems: 'center', marginTop: 8, marginBottom: 8 },
    titleBadge: {
      backgroundColor: primary,
      borderRadius: 12,
      paddingVertical: 3,
      paddingHorizontal: 16,
    },
    title: { fontSize: 12, color: '#fff', fontWeight: 'bold' },
    meta: { fontSize: 8.5, color: '#555', marginTop: 3 },

    factRow: {
      flexDirection: 'row',
      borderWidth: 0.8,
      borderColor: accent,
      borderRadius: 3,
      marginBottom: 6,
    },
    fact: { flex: 1, alignItems: 'center', paddingVertical: 5, paddingHorizontal: 4 },
    factLabel: { fontSize: 7, color: '#666' },
    factValue: { fontSize: 10, fontWeight: 'bold', marginTop: 2 },
    factStrong: { fontSize: 12, color: primary },

    wordsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    wordsLabel: { fontSize: 7.5, color: '#666', marginRight: 6 },
    wordsValue: { fontSize: 8.5, fontWeight: 'bold', flex: 1 },

    table: { borderWidth: 0.6, borderColor: '#bbb', borderRadius: 2 },
    head: { flexDirection: 'row', backgroundColor: '#f2ece0', borderBottomWidth: 0.8, borderBottomColor: '#bbb' },
    h: { fontSize: 7.5, fontWeight: 'bold', paddingVertical: 4, paddingHorizontal: 3 },
    row: { flexDirection: 'row', borderBottomWidth: 0.4, borderBottomColor: '#ddd' },
    rowAlt: { backgroundColor: '#fafafa' },
    d: { fontSize: 7.8, paddingVertical: 3.5, paddingHorizontal: 3 },
    right: { textAlign: 'right' },

    cNo: { width: 22 },
    cReg: { width: 52 },
    cName: { flex: 1.4 },
    cFather: { flex: 1.4 },
    cJati: { width: 48 },
    cVillage: { width: 62 },
    cPhone: { width: 58 },
    cDate: { width: 50 },
    cAmt: { width: 46 },

    totalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#fff8e1',
      borderTopWidth: 0.8,
      borderTopColor: accent,
    },
    totalLabel: {
      flex: 1,
      fontSize: 8.5,
      fontWeight: 'bold',
      textAlign: 'right',
      paddingVertical: 5,
      paddingHorizontal: 6,
    },
    total: { fontSize: 9.5, fontWeight: 'bold', paddingVertical: 5, paddingHorizontal: 3 },

    note: {
      marginTop: 8,
      borderWidth: 0.6,
      borderColor: '#ddd',
      borderRadius: 2,
      padding: 6,
      backgroundColor: '#fafafa',
    },
    noteLabel: { fontSize: 7, color: '#666', marginBottom: 2 },
    noteText: { fontSize: 8.2, lineHeight: 1.35 },

    description: { fontSize: 7.8, color: '#444', marginTop: 6, lineHeight: 1.35 },

    card: { marginTop: 8, alignItems: 'center' },
    cardLabel: { fontSize: 7, color: '#666', marginBottom: 3 },
    cardImage: { maxHeight: 150, objectFit: 'contain' },

    footNote: { marginTop: 8 },
    footNoteText: { fontSize: 7.5, color: '#8a6d3b', lineHeight: 1.35 },

    pageNo: {
      position: 'absolute',
      bottom: 18,
      left: 0,
      right: 0,
      textAlign: 'center',
      fontSize: 7,
      color: '#888',
    },
  });
}
