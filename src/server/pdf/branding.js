import 'server-only';

import React from 'react';
import { Text, View, Image, StyleSheet } from '@react-pdf/renderer';

import { FONT_FAMILY } from './renderer.js';
import { DEFAULT_PRIMARY } from '../../lib/theme.js';

/**
 * The header every printed document shares.
 *
 * One implementation, because a receipt and a member list that head themselves
 * differently look like they came from two different organisations — and the
 * whole point of keeping branding in the database is that a trust sets it once.
 */

export function trustHeader(b = {}, { compact = false } = {}) {
  const primary = b.theme?.primary || DEFAULT_PRIMARY;
  const s = headerStyles(primary, compact);

  return (
    <View>
      {b.headerImageURL ? <Image src={b.headerImageURL} style={s.band} /> : null}

      {(b.topLines ?? []).filter(Boolean).length > 0 && (
        <View style={s.topLines}>
          {(b.topLines ?? []).filter(Boolean).map((line, i) => (
            <Text key={i} style={s.topLine}>{line}</Text>
          ))}
        </View>
      )}

      <View style={s.row}>
        {b.logoURL ? <Image src={b.logoURL} style={s.logo} /> : <View style={s.logo} />}

        <View style={s.middle}>
          <Text style={s.name}>{b.nameHi || 'ट्रस्ट'}</Text>
          {b.cityState ? <Text style={s.cityState}>{b.cityState}</Text> : null}
          {b.tagline ? <Text style={s.line}>{b.tagline}</Text> : null}

          {(b.headerLines ?? []).filter(Boolean).map((line, i) => (
            <Text key={i} style={s.line}>{line}</Text>
          ))}

          {addressLine(b) ? <Text style={s.line}>{addressLine(b)}</Text> : null}

          {(b.phone ?? []).filter(Boolean).length > 0 && (
            <Text style={s.line}>
              फ़ोन: {(b.phone ?? []).filter(Boolean).join(' / ')}
              {b.contactPerson ? `   संपर्क: ${b.contactPerson}` : ''}
            </Text>
          )}

          {b.registrationNo ? (
            <Text style={s.line}>पंजी. क्र. {b.registrationNo}</Text>
          ) : null}
        </View>

        {b.rightLogoURL || b.sealURL ? (
          <Image src={b.rightLogoURL || b.sealURL} style={s.logo} />
        ) : (
          <View style={s.logo} />
        )}
      </View>

      <View style={s.rule} />
    </View>
  );
}

/** The signature block, bottom right. */
export function signatureBlock(b = {}) {
  const s = signStyles();

  return (
    <View style={s.row}>
      <View style={s.box}>
        {b.sealURL ? <Image src={b.sealURL} style={s.seal} /> : null}
      </View>
      <View style={s.box}>
        {b.signatureURL ? <Image src={b.signatureURL} style={s.signature} /> : null}
        <View style={s.line} />
        <Text style={s.name}>{b.signatoryName || b.presidentName || ''}</Text>
        <Text style={s.role}>{b.signatoryDesignation || ''}</Text>
      </View>
    </View>
  );
}

export function addressLine(b = {}) {
  return [b.addressHi, b.city, b.district, b.state, b.pinCode]
    .filter(Boolean)
    .join(', ');
}

/** `12,300` — Indian grouping, which is what these documents are read in. */
export const inr = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export const hiDate = (ms) =>
  ms
    ? new Date(Number(ms)).toLocaleDateString('hi-IN', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      })
    : '—';

function headerStyles(primary, compact) {
  return StyleSheet.create({
    band: { width: '100%', maxHeight: compact ? 34 : 46, objectFit: 'contain', marginBottom: 4 },
    topLines: { alignItems: 'center', marginBottom: 3 },
    topLine: {
      fontSize: compact ? 7 : 8, fontWeight: 'bold', color: primary, marginBottom: 1,
    },
    row: { flexDirection: 'row', alignItems: 'center' },
    logo: { width: compact ? 36 : 46, height: compact ? 36 : 46, objectFit: 'contain' },
    middle: { flex: 1, alignItems: 'center', paddingHorizontal: 6 },
    name: { fontSize: compact ? 13 : 16, fontWeight: 'bold', color: primary },
    cityState: { fontSize: compact ? 8 : 9.5, fontWeight: 'bold', marginTop: 1 },
    line: { fontSize: compact ? 6.5 : 7.5, color: '#444', marginTop: 1 },
    rule: { borderBottomWidth: 1.5, borderBottomColor: primary, marginTop: 5 },
  });
}

function signStyles() {
  return StyleSheet.create({
    row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 22 },
    box: { width: 150, alignItems: 'center' },
    seal: { width: 54, height: 54, objectFit: 'contain', opacity: 0.85 },
    signature: { height: 26, objectFit: 'contain', marginBottom: 2 },
    line: { width: '100%', borderTopWidth: 0.8, borderTopColor: '#888', marginTop: 2 },
    name: { fontSize: 8, marginTop: 2, fontFamily: FONT_FAMILY },
    role: { fontSize: 7, color: '#666', fontFamily: FONT_FAMILY },
  });
}
