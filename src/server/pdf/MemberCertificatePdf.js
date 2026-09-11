import 'server-only';

import React from 'react';
import { Text, View, Image, StyleSheet } from '@react-pdf/renderer';

import { inr, hiDate } from './branding.js';
import { FormPage, FormCard, FormBody, FormRow, Field, NoteBox, SignRow } from './formLayout.js';

/**
 * सदस्यता प्रमाण पत्र — the card a member keeps.
 *
 * This is the old system's `Certificates/CertificateCom.js`, landscape A5 and
 * all, with one difference that matters: nothing about the trust is written
 * into it. The old file carried the name, the CIN, the address, three phone
 * numbers and the founder's name as literals, in two places (there was a
 * near-identical server-side copy), so the printed certificate and the emailed
 * one could and did drift apart.
 *
 * Layout note: the photo is a COLUMN beside the fields, not a box floated over
 * them at a fixed offset. The first version positioned it absolutely, which
 * meant the rows had to reserve a matching right-hand gutter by hand — and the
 * moment the rows spread out to fill the page, the reserved gutter stopped
 * lining up with the photo it was reserved for.
 *
 * What the member is promised — the per-closing contribution — is printed from
 * the member's own stored rate rather than recomputed here, because the rate is
 * fixed at the age they joined at. Recomputing it from today's age would
 * quietly reprice a certificate every time it was reprinted.
 */
export function MemberCertificatePdf({ trust, member, program }) {
  const b = trust?.branding ?? {};
  const s = sheet();

  const eventWord = closingWord(program);

  return (
    <FormPage
      landscape
      title={`${member.displayName} — सदस्यता प्रमाण पत्र`}
      author={b.nameHi || trust?.name || ''}
    >
      <FormCard
        landscape
        trust={trust}
        program={program}
        title={program?.hiname || program?.name}
        serial={member.registrationNumber || ''}
      >
        <View style={s.main}>
          <FormBody style={s.fields}>
            <FormRow>
              <Field big label="सदस्यता क्रमांक:" value={member.registrationNumber} />
              <Field big label="दिनांक:" value={member.joinDate || hiDate(member.joinDateMs)} />
            </FormRow>

            <FormRow>
              <Field big flex={1.3} label="नाम:" value={member.displayName} />
              <Field big label="पिता / पति का नाम:" value={member.fatherName} />
            </FormRow>

            <FormRow>
              <Field big label="गोत्र:" value={member.gotra} />
              <Field big label="जाति:" value={member.jati} />
              <Field big label="जन्म दि.:" value={member.bobDate || hiDate(member.bobDateMs)} />
            </FormRow>

            <FormRow>
              <Field big label="मोबाईल नंबर:" value={member.phone} />
              <Field big label="गाँव / शहर:" value={member.village} />
            </FormRow>

            <FormRow>
              <Field big label="जिला:" value={member.district} />
              <Field big label="राज्य:" value={member.state} />
            </FormRow>

            <FormRow>
              <Field big label="वारिसदार:" value={member.guardian} />
              <Field big label="आयु वर्ग:" value={member.ageGroupRange} />
            </FormRow>

            {/* The promise the certificate exists to record, given its own
                band so it is the thing the eye lands on. */}
            <View style={s.pledge}>
              <Text style={s.pledgeLabel}>
                प्रत्येक {eventWord} पर सहयोग राशि
              </Text>
              <Text style={s.pledgeValue}>{inr(member.payAmount)}/-</Text>
            </View>
          </FormBody>

          <View style={s.photoCol}>
            <View style={s.photoBox}>
              {member.photoURL ? (
                <Image src={member.photoURL} style={s.photo} />
              ) : (
                <Text style={s.photoLabel}>सदस्य{'\n'}फोटो</Text>
              )}
            </View>
            <Text style={s.photoCaption}>{member.programName || ''}</Text>
          </View>
        </View>

        <NoteBox text={program?.noteLine} />

        <SignRow trust={trust} member={member} />
      </FormCard>
    </FormPage>
  );
}

/**
 * What the member is contributing towards, in the words this योजना uses.
 *
 * A सुरक्षा scheme collects on a death and a मायरा scheme on a wedding; a
 * certificate that says the wrong one is a certificate the family reads at the
 * worst possible moment.
 */
export function closingWord(program) {
  return (
    {
      isSuraksha: 'देहांत',
      isMamera: 'मायरा',
      isVivah: 'विवाह',
    }[program?.category] ?? 'क्लोजिंग'
  );
}

function sheet() {
  return StyleSheet.create({
    main: { flexGrow: 1, flexDirection: 'row', marginTop: 6 },
    fields: { flex: 1, paddingRight: 10 },

    photoCol: { width: 96, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 4 },
    photoBox: {
      width: 88,
      height: 104,
      borderWidth: 1.2,
      borderColor: '#444',
      borderRadius: 2,
      backgroundColor: '#fff',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    photo: { width: '100%', height: '100%', objectFit: 'cover' },
    photoLabel: { fontSize: 8, color: '#999', textAlign: 'center' },
    photoCaption: { fontSize: 7, color: '#777', marginTop: 3, textAlign: 'center' },

    pledge: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#fff8e1',
      borderWidth: 0.7,
      borderColor: '#e0c98a',
      borderRadius: 3,
      paddingVertical: 4,
      paddingHorizontal: 10,
    },
    pledgeLabel: { fontSize: 10, fontWeight: 'bold' },
    pledgeValue: { fontSize: 13, fontWeight: 'bold', marginLeft: 8 },
  });
}
