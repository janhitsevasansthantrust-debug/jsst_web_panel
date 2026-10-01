import 'server-only';

import React from 'react';
import { Text, View, Image, StyleSheet } from '@react-pdf/renderer';

import { inr, hiDate } from './branding.js';
import { FormPage, FormCard, FormBody, FormRow, Field, NoteBox } from './formLayout.js';
import { amountInWords } from '../../lib/amountWords.js';
import { DEFAULT_PRIMARY, DEFAULT_ACCENT } from '../../lib/theme.js';

/**
 * सदस्यता समापन पत्र — the sheet handed to the family when a case is closed.
 *
 * The old system's `ClosingForm/ClosingFormPdf.js`. It is the receipt for the
 * other direction of money: every other document in this system records what a
 * member pays IN, and this one records what the trust pays OUT, signed for by
 * the वारिसदार.
 *
 * Four figures and their arithmetic, because that is the whole document:
 *
 *   सदस्यों ने दिया      what has actually been collected against this closing
 *   दी जा रही राशि       what the trust is handing over
 *   पुरानी बकाया        what this member themselves still owed, deducted
 *   नेट राशि            what the family actually receives
 *
 * They are stored on the closing rather than computed at print time, because
 * the moment the family signs, that is what the paper said — and a reprint six
 * months later, after more people have paid, must not show a different number
 * from the one on the signed copy. The collected figure is seeded from the
 * closing's own counter when the form is first opened, and then it is a
 * record, not a calculation.
 */
export function ClosingCertificatePdf({ trust, program, closing, member }) {
  const b = trust?.branding ?? {};
  const primary = b.theme?.primary || DEFAULT_PRIMARY;
  const accent = b.theme?.accent || DEFAULT_ACCENT;
  const s = sheet(primary, accent);

  const p = closing.payout ?? {};
  const net = Number(p.netAmount) || 0;

  return (
    <FormPage
      title={`${closing.displayName} — सदस्यता समापन पत्र`}
      author={b.nameHi || trust?.name || ''}
    >
      <FormCard
        trust={trust}
        program={program}
        title="सदस्यता समापन पत्र"
        serial={closing.registrationNumber || ''}
      >
        <FormBody>
          <View style={s.split}>
            <View style={s.splitFields}>
              <FormRow>
                <Field label="सदस्यता क्रमांक:" value={closing.registrationNumber} />
                <Field label="क्लोजिंग तिथि:" value={closing.closingDate || hiDate(closing.closingDateMs)} />
              </FormRow>
              <FormRow>
                <Field label="नाम:" value={closing.displayName} />
              </FormRow>
              <FormRow>
                <Field label="पिता / पति का नाम:" value={closing.fatherName} />
              </FormRow>
              <FormRow>
                <Field label="गोत्र:" value={member?.gotra} />
                <Field label="जाति:" value={closing.jati || member?.jati} />
              </FormRow>
              <FormRow>
                <Field label="मोबाईल:" value={closing.phone || member?.phone} />
                <Field label="आधार:" value={member?.aadhaarNo} />
              </FormRow>
              <FormRow>
                <Field label="गाँव / शहर:" value={closing.village || member?.village} />
              </FormRow>
            </View>

            <View style={s.photoCol}>
              <View style={s.photoBox}>
                {closing.photoURL || member?.photoURL ? (
                  <Image src={closing.photoURL || member.photoURL} style={s.photo} />
                ) : (
                  <Text style={s.photoLabel}>सदस्य{'\n'}फोटो</Text>
                )}
              </View>
              {/* The invitation or notice card the closing was registered
                  against — the evidence the case is genuine. */}
              <View style={[s.photoBox, s.photoBoxEmpty]}>
                {closing.invitationCardURL ? (
                  <Image src={closing.invitationCardURL} style={s.photo} />
                ) : (
                  <Text style={s.photoLabel}>निमंत्रण{'\n'}पत्र</Text>
                )}
              </View>
            </View>
          </View>

          <FormRow style={s.row}>
            <Field label="जिला:" value={closing.district || member?.district} />
            <Field label="राज्य:" value={member?.state} />
          </FormRow>

          <FormRow style={s.row}>
            <Field flex={1.3} label="वारिसदार का नाम:" value={member?.guardian} />
            <Field label="संबंध:" value={member?.guardianRelation} />
          </FormRow>

          <FormRow style={s.row}>
            <Field label="योजना:" value={program?.hiname || program?.name} />
            <Field label="समूह:" value={closing.batchName} />
          </FormRow>

          {/* ── the money ───────────────────────────────────────────────── */}
          <View style={s.money}>
            <MoneyRow
              s={s}
              label="सदस्यों ने सहयोग राशि दी"
              value={inr(p.memberContributed)}
              note={`${p.membersCount ?? 0} सदस्य`}
            />
            <MoneyRow
              s={s}
              label="सदस्य को सहयोग राशि दी जा रही है"
              value={inr(p.amountGiven)}
              note={p.paymentMode || 'नकद'}
            />
            <MoneyRow
              s={s}
              label="इनकी अपनी पुरानी बकाया राशि"
              value={inr(p.oldPending)}
              note="काटी गई"
            />
            <View style={s.netRow}>
              <Text style={s.netLabel}>दी जा रही नेट राशि</Text>
              <Text style={s.netValue}>{inr(net)}/-</Text>
            </View>
            <View style={s.wordsRow}>
              <Text style={s.wordsLabel}>अक्षरे</Text>
              <Text style={s.wordsValue}>{amountInWords(net)} रुपये मात्र</Text>
            </View>
          </View>

          {closing.notes ? (
            <Text style={s.notes}>टिप्पणी: {closing.notes}</Text>
          ) : null}
        </FormBody>

        <NoteBox text={program?.noteLine} />

        {/* Three signatures, as the old form had: the family that received the
            money, the worker who handed it over, and the trust. A payment out
            with only the trust's own signature on it is not a receipt. */}
        <View style={s.signRow}>
          <Sign s={s} label="वारिसदार हस्ताक्षर" />
          <Sign s={s} label="कार्यकर्ता हस्ताक्षर" name={closing.addedByName || member?.agentName} />
          <Sign
            s={s}
            label={`${b.signatoryDesignation || 'संस्थापक'} हस्ताक्षर`}
            name={b.signatoryName || b.presidentName}
          />
        </View>
      </FormCard>
    </FormPage>
  );
}

function MoneyRow({ s, label, value, note }) {
  return (
    <View style={s.moneyRow}>
      <Text style={s.moneyLabel}>{label}</Text>
      <Text style={s.moneyValue}>{value}</Text>
      {note ? <Text style={s.moneyNote}>({note})</Text> : null}
    </View>
  );
}

function Sign({ s, label, name }) {
  return (
    <View style={s.signBox}>
      <View style={s.signLine} />
      <Text style={s.signLabel}>{label}</Text>
      {name ? <Text style={s.signName}>{name}</Text> : null}
    </View>
  );
}

function sheet(primary, accent) {
  return StyleSheet.create({
    row: { marginBottom: 2 },

    split: { flexDirection: 'row' },
    splitFields: { flex: 1, justifyContent: 'space-between', paddingRight: 8 },

    photoCol: { width: 66, justifyContent: 'space-between' },
    photoBox: {
      width: 68,
      height: 72,
      borderWidth: 1,
      borderColor: '#444',
      borderRadius: 2,
      backgroundColor: '#fff',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      marginBottom: 4,
    },
    photoBoxEmpty: { borderColor: '#aaa', borderStyle: 'dashed', marginBottom: 0 },
    photo: { width: '100%', height: '100%', objectFit: 'cover' },
    photoLabel: { fontSize: 6.5, color: '#999', textAlign: 'center' },

    money: {
      borderWidth: 0.8,
      borderColor: accent,
      borderRadius: 3,
      backgroundColor: '#fffdf5',
      paddingVertical: 4,
      paddingHorizontal: 8,
      marginTop: 4,
    },
    moneyRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 3 },
    moneyLabel: { flex: 1, fontSize: 8.2 },
    moneyValue: { fontSize: 9.5, fontWeight: 'bold', minWidth: 60, textAlign: 'right' },
    moneyNote: { fontSize: 7, color: '#777', marginLeft: 6, minWidth: 54 },

    netRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderTopWidth: 0.8,
      borderTopColor: accent,
      paddingTop: 4,
      marginTop: 2,
    },
    netLabel: { flex: 1, fontSize: 9.5, fontWeight: 'bold', color: primary },
    netValue: { fontSize: 13, fontWeight: 'bold', color: primary },

    wordsRow: { flexDirection: 'row', marginTop: 2 },
    wordsLabel: { fontSize: 7, color: '#777', marginRight: 5 },
    wordsValue: { fontSize: 8, fontWeight: 'bold', flex: 1 },

    notes: { fontSize: 7.5, color: '#444', marginTop: 4 },

    signRow: {
      position: 'absolute',
      bottom: 6,
      left: 10,
      right: 10,
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    signBox: { width: '31%', alignItems: 'center' },
    signLine: { width: '100%', borderTopWidth: 0.7, borderTopColor: '#666', marginTop: 20 },
    signLabel: { fontSize: 7.5, fontWeight: 'bold', marginTop: 2 },
    signName: { fontSize: 6.8, color: '#666' },
  });
}
