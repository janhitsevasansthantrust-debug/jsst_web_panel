/**
 * Money, written out in Hindi words.
 *
 * In `lib/` rather than inside the PDF component because this is the line a
 * receipt's integrity rests on: digits alone can have a 1 turned into a 4 with
 * a pen after the receipt leaves the counter, which is why every printed
 * receipt in the country carries the amount in words. Logic that matters that
 * much gets tested, and a `server-only` PDF module cannot be.
 */

/**
 * The amount in Hindi words.
 *
 * A receipt that only carries digits can have a 1 turned into a 4 with a pen
 * after it leaves the counter. Writing it out is the oldest defence there is,
 * and it is why every printed receipt in the country has this line.
 */
export function amountInWords(amount) {
  const n = Math.floor(Math.abs(Number(amount) || 0));
  if (n === 0) return 'शून्य';

  const ones = [
    '', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ', 'दस',
    'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह',
    'उन्नीस', 'बीस', 'इक्कीस', 'बाईस', 'तेईस', 'चौबीस', 'पच्चीस', 'छब्बीस',
    'सत्ताईस', 'अट्ठाईस', 'उनतीस', 'तीस', 'इकतीस', 'बत्तीस', 'तैंतीस', 'चौंतीस',
    'पैंतीस', 'छत्तीस', 'सैंतीस', 'अड़तीस', 'उनतालीस', 'चालीस', 'इकतालीस',
    'बयालीस', 'तैंतालीस', 'चौवालीस', 'पैंतालीस', 'छियालीस', 'सैंतालीस',
    'अड़तालीस', 'उनचास', 'पचास', 'इक्यावन', 'बावन', 'तिरेपन', 'चौवन', 'पचपन',
    'छप्पन', 'सत्तावन', 'अट्ठावन', 'उनसठ', 'साठ', 'इकसठ', 'बासठ', 'तिरेसठ',
    'चौंसठ', 'पैंसठ', 'छियासठ', 'सड़सठ', 'अड़सठ', 'उनहत्तर', 'सत्तर',
    'इकहत्तर', 'बहत्तर', 'तिहत्तर', 'चौहत्तर', 'पचहत्तर', 'छिहत्तर',
    'सतहत्तर', 'अठहत्तर', 'उन्यासी', 'अस्सी', 'इक्यासी', 'बयासी', 'तिरासी',
    'चौरासी', 'पचासी', 'छियासी', 'सतासी', 'अठासी', 'नवासी', 'नब्बे',
    'इक्यानवे', 'बानवे', 'तिरानवे', 'चौरानवे', 'पंचानवे', 'छियानवे',
    'सत्तानवे', 'अट्ठानवे', 'निन्यानवे',
  ];

  const under100 = (v) => ones[v] ?? '';

  // Indian grouping: crore, lakh, thousand, hundred — not millions.
  const parts = [];
  const push = (value, word) => {
    if (value > 0) parts.push(`${under100(value)} ${word}`.trim());
  };

  push(Math.floor(n / 10000000), 'करोड़');
  push(Math.floor((n % 10000000) / 100000), 'लाख');
  push(Math.floor((n % 100000) / 1000), 'हज़ार');
  push(Math.floor((n % 1000) / 100), 'सौ');

  const rest = n % 100;
  if (rest > 0) parts.push(under100(rest));

  return parts.join(' ');
}
