import 'server-only';

import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';

import { FONT_FAMILY } from './renderer.js';
import { addressLine } from './branding.js';
import { DEFAULT_PRIMARY, DEFAULT_ACCENT } from '../../lib/theme.js';

/**
 * The ornate A5 card that the certificate and the registration form share.
 *
 * The old system had these as two 500-line files with the trust's name, its
 * address, its three phone numbers and its founder's name typed into both. A
 * trust that moved office had to be given a code change, and the certificate
 * and the form disagreed with each other for a while after every such edit.
 * Here the frame is one component and every word inside it comes from the
 * trust document, so "मेरा घांची समाज फाउंडेशन" appears in exactly one place:
 * the settings screen.
 *
 * The layout is deliberately a faithful copy of the old one — gold double
 * border, prayer lines across the top, logo / title / logo, a scheme pill, a
 * photo box floated to the right, dotted-underline fields, the note paragraph
 * and two signatures. People have been signing these for years; a document
 * that suddenly looks like a different organisation's is a document that gets
 * queried at the counter.
 */

/** A5 landscape, in points, for the certificate. */
export const A5_LANDSCAPE = { width: 595.28, height: 419.53 };

/**
 * One printed card: double border, watermark, prayer lines, masthead.
 *
 * `serial` prints in the notch at the top right — the old certificate put the
 * registration number there and the counter staff read it without opening the
 * fold, so it stays.
 */
export function FormCard({ trust, program, title, serial, children, landscape = false }) {
  const b = trust?.branding ?? {};
  const primary = b.theme?.primary || DEFAULT_PRIMARY;
  const accent = b.theme?.accent || DEFAULT_ACCENT;
  const s = cardStyles(primary, accent, landscape);

  const topLines = (b.topLines ?? []).filter(Boolean);
  const phones = (b.phone ?? []).filter(Boolean);

  return (
    <View style={s.outer}>
      {serial ? <Text style={s.serial}>{serial}</Text> : null}

      <View style={s.inner}>
        {/* Prayer lines. One goes left, one right, the rest centre between
            them — the old form hardcoded exactly two and a trust with three
            silently lost one. */}
        {topLines.length > 0 && (
          <View style={s.topRow}>
            {topLines.map((line, i) => (
              <Text key={i} style={s.topLine}>{line}</Text>
            ))}
          </View>
        )}

        {b.logoURL ? <Image src={b.logoURL} style={s.watermark} /> : null}

        <View style={s.head}>
          {b.logoURL ? <Image src={b.logoURL} style={s.logo} /> : <View style={s.logo} />}

          <View style={s.middle}>
            <Text style={s.name}>{b.nameHi || trust?.name || 'ट्रस्ट'}</Text>
            {b.cityState ? <Text style={s.cityState}>{b.cityState}</Text> : null}
            {b.registrationNo ? (
              <Text style={s.reg}>पंजी. क्र. (CIN): {b.registrationNo}</Text>
            ) : null}
            {addressLine(b) ? <Text style={s.address}>{addressLine(b)}</Text> : null}
            {phones.length > 0 ? (
              <Text style={s.phones}>{phones.join(' / ')}</Text>
            ) : null}

            <View style={s.pill}>
              <Text style={s.pillText}>
                {title || program?.hiname || program?.name || ''}
              </Text>
            </View>
          </View>

          {b.rightLogoURL ? (
            <Image src={b.rightLogoURL} style={s.logo} />
          ) : (
            <View style={s.logo} />
          )}
        </View>

        {children}
      </View>
    </View>
  );
}

/**
 * A labelled value on a dotted rule.
 *
 * The rule STRETCHES to fill whatever width the row gives it, rather than
 * being a fixed box. That is what makes these sheets look like forms rather
 * than like a paragraph of colon-separated facts: the dotted lines line up
 * down the page and reach the margin, and a page with few fields still looks
 * filled instead of trailing off into white space.
 *
 * `width` survives as a minimum, not a maximum — a Devanagari name that
 * overflows its box is worse than a ragged row, because @react-pdf clips it
 * silently and prints a member called "रामेश्वरलाल" as "रामेश्व".
 */
export function Field({ label, value, width, flex = 1, big = false, style }) {
  const s = fieldStyles(big);
  return (
    <View style={[s.group, { flex }, style]}>
      <Text style={s.label}>{label}</Text>
      <Text style={[s.value, width ? { minWidth: width } : null]}>
        {value === 0 ? '0' : (value || '—')}
      </Text>
    </View>
  );
}

/**
 * The rows between the masthead and the signatures.
 *
 * Takes all the height that is left and spreads its rows through it. Without
 * this the fields bunch under the header and leave a hand-sized blank above
 * the signatures — which is what the first version of these documents did, and
 * it reads as a page that failed to finish printing rather than as a form.
 */
export function FormBody({ children, style }) {
  return <View style={[{ flexGrow: 1, justifyContent: 'space-evenly' }, style]}>{children}</View>;
}

/** One line of fields. */
export function FormRow({ children, style }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'flex-end' }, style]}>
      {children}
    </View>
  );
}

/** The note paragraph the योजना carries — terms, in the trust's own words. */
export function NoteBox({ text }) {
  if (!text) return null;
  const s = noteStyles();
  return (
    <View style={s.box}>
      <Text style={s.text}>{text}</Text>
    </View>
  );
}

/**
 * Two signatures: whoever enrolled the member on the left, the trust's own
 * signatory on the right.
 *
 * The old file had the founder's name as a string literal. Here it is
 * `signatoryName` / `presidentName` from settings, so a change of office
 * bearer is a form edit and not a deployment.
 */
export function SignRow({ trust, member }) {
  const b = trust?.branding ?? {};
  const s = signStyles();

  const agent = [member?.agentName || member?.addedByName, member?.agentPhone]
    .filter(Boolean)
    .join(' ');

  return (
    <View style={s.row}>
      <View style={s.box}>
        <Text style={s.value}>{agent || 'सीधे जोड़ा गया'}</Text>
        <Text style={s.label}>कार्यकर्ता</Text>
      </View>

      {b.sealURL ? <Image src={b.sealURL} style={s.seal} /> : null}

      <View style={s.box}>
        {b.signatureURL ? <Image src={b.signatureURL} style={s.signature} /> : null}
        <Text style={s.value}>
          {b.signatoryName || b.presidentName || b.contactPerson || ''}
        </Text>
        <Text style={s.label}>{b.signatoryDesignation || 'अध्यक्ष'}</Text>
      </View>
    </View>
  );
}

/** Convenience: a one-page A5 document wrapper with the right font. */
export function FormPage({ landscape, children, ...rest }) {
  const s = pageStyles();
  return (
    <Document {...rest}>
      <Page
        size={landscape ? A5_LANDSCAPE : 'A5'}
        orientation="portrait"
        style={s.page}
      >
        {children}
      </Page>
    </Document>
  );
}

function pageStyles() {
  return StyleSheet.create({
    page: {
      backgroundColor: '#ffffff',
      fontFamily: FONT_FAMILY,
      padding: 12,
    },
  });
}

function cardStyles(primary, accent, landscape) {
  return StyleSheet.create({
    outer: {
      borderWidth: 3,
      borderColor: accent,
      borderRadius: 4,
      padding: 6,
      height: '100%',
      position: 'relative',
    },
    serial: {
      position: 'absolute',
      top: -9,
      right: 20,
      fontSize: 9,
      fontWeight: 'bold',
      color: primary,
      backgroundColor: '#fff',
      paddingHorizontal: 6,
      paddingVertical: 1,
      zIndex: 5,
    },
    inner: {
      borderWidth: 1,
      borderColor: accent,
      borderRadius: 2,
      padding: landscape ? 12 : 10,
      // Room for the signature row, which is absolutely positioned at the
      // bottom: flowed content that runs into it would be printed over.
      paddingBottom: 44,
      height: '100%',
      position: 'relative',
      flexDirection: 'column',
    },
    topRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      marginBottom: 3,
    },
    topLine: {
      fontSize: 7.5,
      fontWeight: 'bold',
      color: primary,
      letterSpacing: 0.2,
    },
    watermark: {
      position: 'absolute',
      top: '22%',
      left: '20%',
      width: '60%',
      height: '55%',
      objectFit: 'contain',
      opacity: 0.07,
    },
    head: { flexDirection: 'row', alignItems: 'center' },
    logo: { width: landscape ? 58 : 46, height: landscape ? 58 : 46, objectFit: 'contain' },
    middle: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
    name: {
      fontSize: landscape ? 17 : 14,
      fontWeight: 'bold',
      color: primary,
      textAlign: 'center',
      lineHeight: 1.15,
    },
    cityState: { fontSize: landscape ? 10 : 9, fontWeight: 'bold', marginTop: 1 },
    reg: { fontSize: 7, fontWeight: 'bold', color: '#4a2800', marginTop: 1 },
    address: {
      fontSize: 7.2,
      color: '#333',
      textAlign: 'center',
      marginTop: 1,
      lineHeight: 1.25,
    },
    phones: { fontSize: 7.8, fontWeight: 'bold', marginTop: 1 },
    pill: {
      backgroundColor: primary,
      borderRadius: 10,
      paddingVertical: 2,
      paddingHorizontal: 12,
      marginTop: 4,
    },
    pillText: { fontSize: landscape ? 10 : 9, color: '#fff', fontWeight: 'bold' },
  });
}

function fieldStyles(big) {
  // One scale factor rather than two style sheets: the certificate is A5
  // LANDSCAPE with six rows on it and can carry larger type; the registration
  // form is portrait with fourteen and cannot.
  const k = big ? 1.25 : 1;

  return StyleSheet.create({
    group: { flexDirection: 'row', alignItems: 'flex-end', marginRight: 10 },
    label: { fontSize: 8.2 * k, color: '#000', marginRight: 3 },
    value: {
      flex: 1,
      fontSize: 9 * k,
      fontWeight: 'bold',
      borderBottomWidth: 0.7,
      borderBottomColor: '#666',
      borderBottomStyle: 'dotted',
      paddingHorizontal: 3,
      paddingBottom: 1.5,
    },
  });
}

function noteStyles() {
  return StyleSheet.create({
    box: {
      marginTop: 5,
      paddingHorizontal: 6,
      paddingVertical: 3,
      backgroundColor: '#fafafa',
      borderWidth: 0.5,
      borderColor: '#ddd',
      borderRadius: 2,
    },
    text: { fontSize: 7.2, color: '#000', textAlign: 'justify', lineHeight: 1.35 },
  });
}

function signStyles() {
  return StyleSheet.create({
    row: {
      position: 'absolute',
      bottom: 6,
      left: 10,
      right: 10,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
    },
    box: { width: '40%', alignItems: 'center' },
    seal: { width: 44, height: 44, objectFit: 'contain', opacity: 0.85 },
    signature: { height: 22, objectFit: 'contain', marginBottom: 1 },
    value: {
      fontSize: 8.5,
      fontWeight: 'bold',
      textAlign: 'center',
      borderTopWidth: 0.7,
      borderTopColor: '#555',
      paddingTop: 2,
      width: '100%',
    },
    label: { fontSize: 7.5, fontWeight: 'bold', marginTop: 1 },
  });
}
