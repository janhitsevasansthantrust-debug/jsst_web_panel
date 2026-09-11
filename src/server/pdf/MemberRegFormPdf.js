import 'server-only';

import React from 'react';
import { Text, View, Image, StyleSheet } from '@react-pdf/renderer';

import { inr, hiDate } from './branding.js';
import { FormPage, FormCard, FormBody, FormRow, Field, NoteBox, SignRow } from './formLayout.js';
import { closingWord } from './MemberCertificatePdf.js';

/**
 * सदस्यता फॉर्म — the enrolment form, printed back out.
 *
 * The old `MemberRegFormPdf/RegFromPdf.js`, portrait A5. It carries more than
 * the certificate does — आधार, शुल्क, आयु वर्ग, स्थान समूह — because this is
 * the sheet that goes into the file, while the certificate is the one that goes
 * home with the member.
 *
 * The two photo boxes sit in a right-hand column that only the first few rows
 * run beside; below them the rows take the full width back. That is done with
 * a flex row rather than absolute positioning, so the rows can spread to fill
 * the page without drifting away from the gutter they were reserving.
 *
 * सदस्यता शुल्क prints its paid/unpaid state rather than just its amount. The
 * old form divided the fee by 100 before printing it (`formatToHundreds`),
 * which was a leftover from a time when fees were stored in paise; by the end
 * it was printing ₹5.00 on a ₹500 form. Amounts here are rupees throughout, as
 * they are stored.
 */
export function MemberRegFormPdf({ trust, member, program }) {
  const b = trust?.branding ?? {};
  const s = sheet();

  const eventWord = closingWord(program);
  const extras = (member.extraDetails ?? []).filter((f) => f.label && f.value);

  return (
    <FormPage
      title={`${member.displayName} — सदस्यता फॉर्म`}
      author={b.nameHi || trust?.name || ''}
    >
      <FormCard
        trust={trust}
        program={program}
        title="सदस्यता फॉर्म"
        serial={member.registrationNumber || ''}
      >
        <FormBody>
          {/* ── beside the photos ─────────────────────────────────────── */}
          <View style={s.split}>
            {/* Six rows, matched to the height of the two photo boxes beside
                them. The count is not arbitrary: this column stretches to the
                photos' height, so too few rows open gaps twice the size of
                every other row on the sheet, and too many crush them. */}
            <View style={s.splitFields}>
              <FormRow>
                <Field label="सदस्यता क्रमांक:" value={member.registrationNumber} />
                <Field label="दिनांक:" value={member.joinDate || hiDate(member.joinDateMs)} />
              </FormRow>
              <FormRow>
                <Field label="नाम:" value={member.displayName} />
              </FormRow>
              <FormRow>
                <Field label="पिता / पति का नाम:" value={member.fatherName} />
              </FormRow>
              <FormRow>
                <Field label="गोत्र:" value={member.gotra} />
                <Field label="जाति:" value={member.jati} />
              </FormRow>
              <FormRow>
                <Field label="जन्म दिनांक:" value={member.bobDate || hiDate(member.bobDateMs)} />
                <Field flex={0.7} label="लिंग:" value={member.gender} />
              </FormRow>
              <FormRow>
                <Field label="मोबाईल:" value={member.phone} />
                <Field label="अन्य मोबाईल:" value={member.phoneAlt} />
              </FormRow>
            </View>

            <View style={s.photoCol}>
              <View style={s.photoBox}>
                {member.photoURL ? (
                  <Image src={member.photoURL} style={s.photo} />
                ) : (
                  <Text style={s.photoLabel}>सदस्य{'\n'}फोटो</Text>
                )}
              </View>

              {/* The वारिसदार's photo where the trust collects one. An empty
                  dashed box rather than a shifted layout when it is missing,
                  so two forms stacked on a desk still line up. */}
              <View style={[s.photoBox, s.photoBoxEmpty]}>
                {member.extraImageURL ? (
                  <Image src={member.extraImageURL} style={s.photo} />
                ) : (
                  <Text style={s.photoLabel}>वारिस{'\n'}फोटो</Text>
                )}
              </View>
            </View>
          </View>

          {/* ── full width ────────────────────────────────────────────── */}
          <FormRow style={s.row}>
            <Field label="आधार नंबर:" value={member.aadhaarNo} />
            <Field flex={0.7} label="पिन कोड:" value={member.pinCode} />
          </FormRow>

          <FormRow style={s.row}>
            <Field label="गाँव / शहर:" value={member.village} />
          </FormRow>

          <FormRow style={s.row}>
            <Field label="जिला:" value={member.district} />
            <Field label="राज्य:" value={member.state} />
          </FormRow>

          <FormRow style={s.row}>
            <Field flex={1.3} label="वारिसदार का नाम:" value={member.guardian} />
            <Field label="संबंध:" value={member.guardianRelation} />
          </FormRow>

          <FormRow style={s.row}>
            <Field
              label="सदस्यता शुल्क:"
              value={`${inr(member.joinFees)}/- ${member.joinFeesDone ? '(जमा)' : '(बकाया)'}`}
            />
            <Field label="योजना:" value={program?.hiname || program?.name} />
          </FormRow>

          <FormRow style={s.row}>
            <Field label="आयु वर्ग:" value={member.ageGroupRange} />
            <Field label="स्थान समूह:" value={member.locationGroup} />
          </FormRow>

          {/* Whatever this trust decided to also record. Printed because a
              field that is captured but never appears on the form is a field
              nobody bothers to fill in correctly. */}
          {extras.length > 0 && (
            <FormRow style={s.row}>
              {extras.slice(0, 3).map((f, i) => (
                <Field key={i} label={`${f.label}:`} value={f.value} />
              ))}
            </FormRow>
          )}

          <View style={s.pledge}>
            <Text style={s.pledgeLabel}>प्रत्येक {eventWord} पर सहयोग राशि</Text>
            <Text style={s.pledgeValue}>{inr(member.payAmount)}/-</Text>
          </View>

          {/* Signed by the member, not by the office — this is the copy that
              goes into the file, and a form nobody signed is not a record of
              anything. The old form had no such line. */}
          <View style={s.declare}>
            <Text style={s.declareText}>
              मैंने ऊपर दी गई सारी जानकारी सही भरी है और योजना के नियम मुझे मंज़ूर हैं।
            </Text>
            <View style={s.declareSign}>
              <Text style={s.declareSignLabel}>सदस्य के हस्ताक्षर / अंगूठा</Text>
            </View>
          </View>
        </FormBody>

        <NoteBox text={program?.noteLine} />

        <SignRow trust={trust} member={member} />
      </FormCard>
    </FormPage>
  );
}

function sheet() {
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

    pledge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#fff8e1',
      borderWidth: 0.7,
      borderColor: '#e0c98a',
      borderRadius: 3,
      paddingVertical: 4,
      paddingHorizontal: 8,
    },
    pledgeLabel: { fontSize: 9, fontWeight: 'bold' },
    pledgeValue: { fontSize: 11, fontWeight: 'bold', marginLeft: 8 },

    declare: { flexDirection: 'row', alignItems: 'flex-end' },
    declareText: { flex: 1, fontSize: 7, color: '#333', paddingRight: 8, lineHeight: 1.3 },
    declareSign: {
      width: 120,
      borderTopWidth: 0.7,
      borderTopColor: '#666',
      borderTopStyle: 'dotted',
      paddingTop: 2,
      marginTop: 18,
    },
    declareSignLabel: { fontSize: 6.5, color: '#666', textAlign: 'center' },
  });
}
