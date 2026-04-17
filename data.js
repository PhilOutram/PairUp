// ─── Grades ─────────────────────────────────────────────────────────────────

const GRADES = ['AA/AO', 'EO', 'HEO', 'SEO', 'G7', 'G6', 'SCS1', 'SCS2'];
const GRADE_IDX = Object.fromEntries(GRADES.map((g, i) => [g, i]));

// ─── Overseas offices ───────────────────────────────────────────────────────

const OVERSEAS_OFFICES = [
  'Abuja', 'Accra', 'Addis Ababa', 'Algiers', 'Amman', 'Ankara', 'Astana',
  'Baghdad', 'Baku', 'Bangkok', 'Beirut', 'Belgrade', 'Berlin', 'Bogotá',
  'Brasília', 'Brussels', 'Buenos Aires', 'Cairo', 'Canberra', 'Cape Town',
  'Colombo', 'Copenhagen', 'Dakar', 'Delhi', 'Dhaka', 'Doha', 'Dubai',
  'Dublin', 'Dushanbe', 'Geneva', 'Georgetown', 'Guatemala City', 'Harare',
  'Havana', 'Helsinki', 'Hong Kong', 'Jakarta', 'Kabul', 'Kampala', 'Karachi',
  'Kathmandu', 'Khartoum', 'Kiev (Kyiv)', 'Kinshasa', 'Kuala Lumpur', 'Lagos',
  'La Paz', 'Lima', 'Lisbon', 'Ljubljana', 'London', 'Lusaka', 'Madrid',
  'Manila', 'Mexico City', 'Mogadishu', 'Moscow', 'Mumbai', 'Muscat', 'Nairobi',
  'New York (UN)', 'Oslo', 'Ottawa', 'Paris', 'Pretoria', 'Pristina',
  'Rabat', 'Rangoon (Yangon)', 'Riyadh', 'Rome', 'San José', 'Santiago',
  'Seoul', 'Singapore', 'Sofia', 'Stockholm', 'Taipei', 'Tallinn',
  'Tashkent', 'Tehran', 'Tel Aviv', 'Tokyo', 'Tripoli', 'Tunis', 'Ulaanbaatar',
  'Vienna', 'Warsaw', 'Washington DC', 'Wellington', 'Windhoek', 'Zagreb',
];

// ─── Dummy profiles: generated, 15 per grade (120 total) ────────────────────

const DAY = 86400000;
const NOW = Date.now();

const INITIALS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K',
  'L', 'M', 'N', 'O', 'P', 'R', 'S', 'T', 'Y', 'Z',
];
const SURNAMES = [
  'Ahmed', 'Andersen', 'Adeyemi', 'Bennett', 'Brooks', 'Chen', 'Clarke', 'Davies',
  'Dubois', 'Evans', 'Fitzgerald', 'Foster', 'Gupta', 'Hassan', 'Ibrahim', 'Jones',
  'Johansson', 'Kapoor', 'Khan', 'Kowalski', 'Lee', 'Liu', 'Mensah', 'Morrison',
  'Nakamura', 'Nwosu', 'Okafor', 'Osei', 'Owusu', 'Patel', 'Pearce', 'Rahman',
  'Reyes', 'Ross', 'Singh', 'Taylor', 'Thornton', 'Walsh', 'Williams', 'Yusuf',
];

// Weighted toward popular directorates so any common user pick has plenty of
// overlapping candidates per grade.
const DIR_SETS = [
  ['Economic & Trade'],
  ['Economic & Trade', 'Climate & Environment'],
  ['Economic & Trade', 'Programme Delivery'],
  ['Economic & Trade', 'Security & Defence'],
  ['Economic & Trade', 'Open to any'],
  ['Climate & Environment'],
  ['Climate & Environment', 'Programme Delivery'],
  ['Climate & Environment', 'Overseas Network'],
  ['Climate & Environment', 'Open to any'],
  ['Programme Delivery'],
  ['Programme Delivery', 'HR & People'],
  ['Programme Delivery', 'Finance'],
  ['Programme Delivery', 'Open to any'],
  ['Security & Defence'],
  ['Security & Defence', 'Overseas Network'],
  ['Security & Defence', 'Open to any'],
  ['HR & People'],
  ['HR & People', 'Corporate Services'],
  ['HR & People', 'Communications'],
  ['Finance'],
  ['Finance', 'Corporate Services'],
  ['Digital & Data'],
  ['Digital & Data', 'Programme Delivery'],
  ['Legal & Governance'],
  ['Legal & Governance', 'HR & People'],
  ['Communications'],
  ['Consular'],
  ['Overseas Network'],
  ['Corporate Services'],
  ['Open to any'],
  ['Open to any', 'Economic & Trade'],
  ['Open to any', 'Programme Delivery'],
];

const DAYS_PATTERNS = [
  { Mon: 'full', Tue: 'full', Wed: 'non', Thu: 'full', Fri: 'non' },
  { Mon: 'full', Tue: 'full', Wed: 'part', Thu: 'non', Fri: 'non' },
  { Mon: 'non', Tue: 'full', Wed: 'non', Thu: 'full', Fri: 'full' },
  { Mon: 'full', Tue: 'non', Wed: 'full', Thu: 'full', Fri: 'non' },
  { Mon: 'full', Tue: 'full', Wed: 'non', Thu: 'full', Fri: 'flexible' },
  { Mon: 'non', Tue: 'non', Wed: 'full', Thu: 'full', Fri: 'full' },
  { Mon: 'full', Tue: 'full', Wed: 'full', Thu: 'non', Fri: 'non' },
  { Mon: 'non', Tue: 'full', Wed: 'full', Thu: 'full', Fri: 'non' },
  { Mon: 'full', Tue: 'non', Wed: 'non', Thu: 'full', Fri: 'flexible' },
  { Mon: 'full', Tue: 'part', Wed: 'non', Thu: 'full', Fri: 'non' },
  { Mon: 'non', Tue: 'full', Wed: 'full', Thu: 'non', Fri: 'full' },
  { Mon: 'full', Tue: 'full', Wed: 'full', Thu: 'non', Fri: 'non' },
  { Mon: 'non', Tue: 'non', Wed: 'full', Thu: 'full', Fri: 'part' },
  { Mon: 'full', Tue: 'non', Wed: 'full', Thu: 'non', Fri: 'full' },
  { Mon: 'full', Tue: 'full', Wed: 'non', Thu: 'non', Fri: 'full' },
  { Mon: 'non', Tue: 'full', Wed: 'flexible', Thu: 'full', Fri: 'full' },
  { Mon: 'flexible', Tue: 'full', Wed: 'non', Thu: 'non', Fri: 'part' },
  { Mon: 'full', Tue: 'non', Wed: 'part', Thu: 'full', Fri: 'non' },
];

// Weighted toward London — matches real FCDO distribution
const LOCATIONS = [
  { loc: 'London - KCS', overseas: '' },
  { loc: 'London - KCS', overseas: '' },
  { loc: 'London - KCS', overseas: '' },
  { loc: 'London - KCS', overseas: '' },
  { loc: 'East Kilbride', overseas: '' },
  { loc: 'East Kilbride', overseas: '' },
  { loc: 'Remote', overseas: '' },
  { loc: 'Overseas', overseas: 'Delhi' },
  { loc: 'Overseas', overseas: 'Nairobi' },
  { loc: 'Overseas', overseas: 'Brussels' },
  { loc: 'Overseas', overseas: 'Washington DC' },
  { loc: 'Overseas', overseas: 'Singapore' },
  { loc: 'Overseas', overseas: 'Paris' },
];

const FTES = ['0.5 FTE', '0.6 FTE', '0.7 FTE', '0.8 FTE', '3 days', '22 hours', '30 hours', '4 days'];
const NEGOTIABLES = ['yes', 'possibly', 'no', 'yes', 'possibly', ''];
const STYLES = ['clean', 'collaborative', 'flexible', 'unsure', ''];

const AVAILABILITIES = [
  'Looking for roles in stage 2 of the restructure',
  'Open to opportunities, flexible on timing',
  'End of tour June, seeking partner for next posting',
  'Have been offered a role, seeking Mon-Wed partner',
  'Returning from maternity leave, starting Sep',
  '',
  'Comms role, any team, starting Oct',
  'Open to HR or corporate services',
  'Looking for strategy or talent roles',
  'Currently overseas, UK return Aug 2026',
  '',
  'Actively seeking, stage 2 placements',
  'Finance or corporate services roles, stage 2',
  'Happy to consider any team where the work aligns',
  '',
];

const SKILLS_POOL = [
  '',
  '8 years policy, Middle East and trade specialism',
  'HR business partnering, D&I lead, complex casework',
  'Digital product management, agile delivery',
  'Finance business partner, 5 years budget management',
  'Programme delivery, monitoring and evaluation specialist',
  'Legal adviser, compliance, public international law',
  'Press office lead, strategic communications',
  'Consular, safeguarding, crisis response',
  '',
  'Data analysis, Python and SQL, 4 years analytics',
  'Senior policy, sanctions and trade experience',
  'Talent management, workforce planning',
  'Policy adviser, programme officer background',
  '',
];

const PATTERN_NOTES = [
  '', '', '', '',
  'Happy to cover school hours if needed',
  'Prefer not to work school holidays',
  'Can work 6 hours Wednesday from home',
  'Carer responsibilities some days',
];

const OTHER_INFO = [
  '', '', '', '', '',
  'Open to 12-month initial trial',
  'Applying for Geneva multilateral roles',
  'Happy to consider job share across grades',
];

const DUMMY_PROFILES = [];
let _pIdx = 1;

GRADES.forEach((grade, gi) => {
  for (let j = 0; j < 15; j++) {
    const idx = gi * 15 + j;
    const initial = INITIALS[(idx * 7) % INITIALS.length];
    const surname = SURNAMES[idx % SURNAMES.length];
    const loc = LOCATIONS[(idx * 3) % LOCATIONS.length];
    // "Last active" distribution: ~55% fresh (<2 months), ~30% amber (2–6m),
    // ~15% red (>6m). No grey in the colour scale any more.
    const bucket = idx % 20;
    let ageDays;
    if (bucket < 11) ageDays = (idx * 3) % 60;               // ~55% fresh
    else if (bucket < 17) ageDays = 60 + ((idx * 5) % 120);  // ~30% amber
    else ageDays = 180 + ((idx * 7) % 120);                  // ~15% red

    DUMMY_PROFILES.push({
      id: 'p' + String(_pIdx++).padStart(3, '0'),
      name: `${initial}. ${surname}`,
      grade,
      directorates: DIR_SETS[(idx * 5) % DIR_SETS.length],
      days: DAYS_PATTERNS[(idx * 11) % DAYS_PATTERNS.length],
      fte: FTES[idx % FTES.length],
      daysNegotiable: NEGOTIABLES[idx % NEGOTIABLES.length],
      availability: AVAILABILITIES[idx % AVAILABILITIES.length],
      skills: SKILLS_POOL[idx % SKILLS_POOL.length],
      workingPatternNotes: PATTERN_NOTES[idx % PATTERN_NOTES.length],
      otherInfo: OTHER_INFO[idx % OTHER_INFO.length],
      style: STYLES[idx % STYLES.length],
      location: loc.loc,
      overseas: loc.overseas,
      lastActive: NOW - ageDays * DAY,
    });
  }
});
