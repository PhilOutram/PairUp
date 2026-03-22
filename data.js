const ROLE_GROUPS = [
  {
    id: 'leadership', emoji: '👥', label: 'Leadership & Management',
    minGrade: 'HEO',
    roles: [
      { label: 'Team Leader / Head of Section', minGrade: 'HEO' },
      { label: 'Programme Manager / Programme Lead', minGrade: 'HEO' },
      { label: 'Project Manager / Delivery Manager', minGrade: 'HEO' },
      { label: 'Change Manager', minGrade: 'HEO' },
      { label: 'Senior Responsible Owner (SRO)', minGrade: 'G7' },
      { label: 'Deputy Head of Mission', minGrade: 'G6' },
    ]
  },
  {
    id: 'policy', emoji: '🌍', label: 'Policy & Diplomatic',
    minGrade: 'EO',
    roles: [
      { label: 'Desk Officer', minGrade: 'EO' },
      { label: 'Policy Adviser', minGrade: 'HEO' },
      { label: 'Senior Policy Adviser', minGrade: 'SEO' },
      { label: 'Multilateral / Bilateral Policy Lead', minGrade: 'SEO' },
      { label: 'Strategic Adviser', minGrade: 'G7' },
      { label: 'Political Officer (overseas posts)', minGrade: 'HEO' },
    ]
  },
  {
    id: 'consular', emoji: '🛟', label: 'Consular & Crisis Response',
    minGrade: 'EO',
    roles: [
      { label: 'Consular Officer', minGrade: 'EO' },
      { label: 'Consular Manager', minGrade: 'HEO' },
      { label: 'Crisis Response Officer', minGrade: 'HEO' },
      { label: 'Crisis Centre Operations Lead', minGrade: 'SEO' },
      { label: 'Safeguarding & Welfare Adviser', minGrade: 'HEO' },
    ]
  },
  {
    id: 'finance', emoji: '💷', label: 'Finance & Commercial',
    minGrade: 'EO',
    roles: [
      { label: 'Finance Officer', minGrade: 'EO' },
      { label: 'Finance Business Partner', minGrade: 'HEO' },
      { label: 'Budget Holder', minGrade: 'HEO' },
      { label: 'Commercial / Procurement Officer', minGrade: 'EO' },
      { label: 'Contract Manager', minGrade: 'HEO' },
      { label: 'Audit & Assurance Officer', minGrade: 'HEO' },
    ]
  },
  {
    id: 'hr', emoji: '🧑‍💼', label: 'Human Resources & People',
    minGrade: 'EO',
    roles: [
      { label: 'HR Adviser', minGrade: 'EO' },
      { label: 'HR Business Partner', minGrade: 'HEO' },
      { label: 'Learning & Development Specialist', minGrade: 'HEO' },
      { label: 'Talent & Capability Lead', minGrade: 'SEO' },
      { label: 'Diversity & Inclusion Lead', minGrade: 'HEO' },
      { label: 'Workforce Planning Analyst', minGrade: 'HEO' },
    ]
  },
  {
    id: 'corporate', emoji: '🧩', label: 'Corporate Services',
    minGrade: 'EO',
    roles: [
      { label: 'Corporate Services Manager', minGrade: 'HEO' },
      { label: 'Estates & Facilities Manager', minGrade: 'HEO' },
      { label: 'Security Manager', minGrade: 'HEO' },
      { label: 'Protocol Officer', minGrade: 'EO' },
      { label: 'Transport & Logistics Coordinator', minGrade: 'EO' },
    ]
  },
  {
    id: 'digital', emoji: '🖥️', label: 'Digital, Data & Technology',
    minGrade: 'EO',
    roles: [
      { label: 'Digital Product Manager', minGrade: 'HEO' },
      { label: 'Technical Architect', minGrade: 'G7' },
      { label: 'Software Engineer', minGrade: 'EO' },
      { label: 'Data Analyst / Data Scientist', minGrade: 'EO' },
      { label: 'Cyber Security Officer', minGrade: 'HEO' },
      { label: 'IT Service Manager', minGrade: 'HEO' },
    ]
  },
  {
    id: 'comms', emoji: '📢', label: 'Communications & Engagement',
    minGrade: 'EO',
    roles: [
      { label: 'Communications Officer', minGrade: 'EO' },
      { label: 'Press & Media Adviser', minGrade: 'HEO' },
      { label: 'Strategic Communications Lead', minGrade: 'SEO' },
      { label: 'Internal Communications Manager', minGrade: 'HEO' },
      { label: 'Digital Communications Specialist', minGrade: 'EO' },
    ]
  },
  {
    id: 'legal', emoji: '📑', label: 'Legal, Governance & Compliance',
    minGrade: 'HEO',
    roles: [
      { label: 'Legal Adviser', minGrade: 'HEO' },
      { label: 'Governance Officer', minGrade: 'HEO' },
      { label: 'Risk & Compliance Manager', minGrade: 'SEO' },
      { label: 'Freedom of Information (FOI) Officer', minGrade: 'EO' },
      { label: 'Data Protection Officer', minGrade: 'SEO' },
    ]
  },
  {
    id: 'programme', emoji: '📦', label: 'Programme Delivery & Development',
    minGrade: 'EO',
    roles: [
      { label: 'Programme Officer', minGrade: 'EO' },
      { label: 'Monitoring, Evaluation & Learning (MEL) Specialist', minGrade: 'HEO' },
      { label: 'Results Adviser', minGrade: 'HEO' },
      { label: 'Thematic Adviser (climate, governance, health, economics)', minGrade: 'SEO' },
      { label: 'Grant Manager', minGrade: 'HEO' },
    ]
  },
  {
    id: 'strategy', emoji: '🏢', label: 'Corporate Strategy & Performance',
    minGrade: 'HEO',
    roles: [
      { label: 'Strategy Adviser', minGrade: 'SEO' },
      { label: 'Organisational Performance Analyst', minGrade: 'HEO' },
      { label: 'Portfolio Manager', minGrade: 'SEO' },
      { label: 'Business Planning Lead', minGrade: 'HEO' },
    ]
  },
  {
    id: 'overseas', emoji: '🌐', label: 'Overseas Network Support',
    minGrade: 'EO',
    roles: [
      { label: 'Political / Economic / Trade Officer', minGrade: 'EO' },
      { label: 'Development Adviser', minGrade: 'HEO' },
      { label: 'Consular Local Staff Lead', minGrade: 'EO' },
      { label: 'Deputy High Commissioner / Deputy Ambassador', minGrade: 'G6' },
      { label: 'Corporate Services Provider', minGrade: 'EO' },
    ]
  },
];

const GRADES = ['AA/AO', 'EO', 'HEO', 'SEO', 'G7', 'G6', 'SCS1', 'SCS2'];
const GRADE_IDX = Object.fromEntries(GRADES.map((g, i) => [g, i]));

function gradeAllowed(roleMinGrade, userGrade) {
  if (!userGrade) return true;
  return GRADE_IDX[userGrade] >= GRADE_IDX[roleMinGrade];
}

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

const DUMMY_PROFILES = [
  {
    id: 'p001', name: 'A. Rahman', grade: 'HEO',
    roles: ['Policy Adviser', 'Desk Officer'],
    directorates: ['Economic & Trade', 'Climate & Environment'],
    days: ['Mon', 'Tue', 'Thu'],
    style: 'clean',
    location: 'London - KCS',
    overseas: ''
  },
  {
    id: 'p002', name: 'J. Pearce', grade: 'SEO',
    roles: ['Senior Policy Adviser', 'Multilateral / Bilateral Policy Lead'],
    directorates: ['Climate & Environment', 'Security & Defence'],
    days: ['Mon', 'Tue', 'Wed'],
    style: 'collaborative',
    location: 'London - KCS',
    overseas: ''
  },
  {
    id: 'p003', name: 'M. Thornton', grade: 'HEO',
    roles: ['HR Business Partner', 'Diversity & Inclusion Lead'],
    directorates: ['HR & People'],
    days: ['Tue', 'Thu', 'Fri'],
    style: 'flexible',
    location: 'East Kilbride',
    overseas: ''
  },
  {
    id: 'p004', name: 'S. Okafor', grade: 'G7',
    roles: ['Strategic Adviser', 'Senior Policy Adviser'],
    directorates: ['Economic & Trade', 'Programme Delivery'],
    days: ['Mon', 'Wed', 'Thu'],
    style: 'collaborative',
    location: 'London - KCS',
    overseas: ''
  },
  {
    id: 'p005', name: 'L. Chen', grade: 'HEO',
    roles: ['Data Analyst / Data Scientist', 'Digital Product Manager'],
    directorates: ['Digital & Data'],
    days: ['Mon', 'Tue', 'Thu'],
    style: 'flexible',
    location: 'Remote',
    overseas: ''
  },
  {
    id: 'p006', name: 'P. Williams', grade: 'SEO',
    roles: ['Programme Officer', 'Grant Manager'],
    directorates: ['Programme Delivery', 'Climate & Environment'],
    days: ['Wed', 'Thu', 'Fri'],
    style: 'clean',
    location: 'London - KCS',
    overseas: ''
  },
  {
    id: 'p007', name: 'F. Mensah', grade: 'HEO',
    roles: ['Finance Business Partner', 'Budget Holder'],
    directorates: ['Finance', 'Corporate Services'],
    days: ['Mon', 'Tue', 'Wed'],
    style: 'clean',
    location: 'East Kilbride',
    overseas: ''
  },
  {
    id: 'p008', name: 'C. Adeyemi', grade: 'G7',
    roles: ['Strategy Adviser', 'Portfolio Manager'],
    directorates: ['Economic & Trade', 'HR & People'],
    days: ['Tue', 'Wed', 'Thu'],
    style: 'collaborative',
    location: 'London - KCS',
    overseas: ''
  },
  {
    id: 'p009', name: 'R. Kapoor', grade: 'HEO',
    roles: ['Policy Adviser', 'Political Officer (overseas posts)'],
    directorates: ['Security & Defence', 'Overseas Network'],
    days: ['Mon', 'Thu', 'Fri'],
    style: 'flexible',
    location: 'Overseas',
    overseas: 'Delhi'
  },
  {
    id: 'p010', name: 'T. Nakamura', grade: 'SEO',
    roles: ['Communications Officer', 'Strategic Communications Lead'],
    directorates: ['Communications'],
    days: ['Mon', 'Tue', 'Thu'],
    style: 'collaborative',
    location: 'London - KCS',
    overseas: ''
  },
  {
    id: 'p011', name: 'B. Owusu', grade: 'G7',
    roles: ['Legal Adviser', 'Risk & Compliance Manager'],
    directorates: ['Legal & Governance'],
    days: ['Tue', 'Thu', 'Fri'],
    style: 'clean',
    location: 'London - KCS',
    overseas: ''
  },
  {
    id: 'p012', name: 'E. Morrison', grade: 'HEO',
    roles: ['Consular Officer', 'Safeguarding & Welfare Adviser'],
    directorates: ['Consular'],
    days: ['Tue', 'Wed', 'Fri'],
    style: 'flexible',
    location: 'London - KCS',
    overseas: ''
  },
  {
    id: 'p013', name: 'D. Johansson', grade: 'EO',
    roles: ['Finance Officer', 'Protocol Officer'],
    directorates: ['Finance', 'Corporate Services'],
    days: ['Mon', 'Tue', 'Wed'],
    style: 'clean',
    location: 'East Kilbride',
    overseas: ''
  },
  {
    id: 'p014', name: 'N. Dubois', grade: 'SEO',
    roles: ['Monitoring, Evaluation & Learning (MEL) Specialist', 'Thematic Adviser (climate, governance, health, economics)'],
    directorates: ['Programme Delivery', 'Climate & Environment'],
    days: ['Mon', 'Tue', 'Thu'],
    style: 'collaborative',
    location: 'London - KCS',
    overseas: ''
  },
  {
    id: 'p015', name: 'K. Osei', grade: 'HEO',
    roles: ['HR Business Partner', 'Learning & Development Specialist'],
    directorates: ['HR & People'],
    days: ['Wed', 'Thu', 'Fri'],
    style: 'flexible',
    location: 'Remote',
    overseas: ''
  },
  {
    id: 'p016', name: 'A. Fitzgerald', grade: 'G6',
    roles: ['Deputy Head of Mission', 'Strategic Adviser'],
    directorates: ['Overseas Network', 'Security & Defence'],
    days: ['Mon', 'Tue', 'Wed'],
    style: 'clean',
    location: 'Overseas',
    overseas: 'Nairobi'
  },
  {
    id: 'p017', name: 'Y. Ibrahim', grade: 'HEO',
    roles: ['Digital Product Manager', 'IT Service Manager'],
    directorates: ['Digital & Data'],
    days: ['Tue', 'Thu', 'Fri'],
    style: 'collaborative',
    location: 'London - KCS',
    overseas: ''
  },
  {
    id: 'p018', name: 'S. Kowalski', grade: 'SEO',
    roles: ['Talent & Capability Lead', 'Workforce Planning Analyst'],
    directorates: ['HR & People', 'Corporate Services'],
    days: ['Mon', 'Wed', 'Fri'],
    style: 'flexible',
    location: 'East Kilbride',
    overseas: ''
  },
  {
    id: 'p019', name: 'O. Nwosu', grade: 'G7',
    roles: ['Technical Architect', 'Cyber Security Officer'],
    directorates: ['Digital & Data'],
    days: ['Mon', 'Tue', 'Thu'],
    style: 'clean',
    location: 'London - KCS',
    overseas: ''
  },
  {
    id: 'p020', name: 'M. Patel', grade: 'HEO',
    roles: ['Policy Adviser', 'Programme Officer'],
    directorates: ['Economic & Trade', 'Programme Delivery', 'Open to any'],
    days: ['Mon', 'Tue', 'Wed'],
    style: 'collaborative',
    location: 'London - KCS',
    overseas: ''
  },
  {
    id: 'p021', name: 'H. Davies', grade: 'SEO',
    roles: ['Senior Policy Adviser', 'Multilateral / Bilateral Policy Lead'],
    directorates: ['Security & Defence', 'Economic & Trade'],
    days: ['Wed', 'Thu', 'Fri'],
    style: 'flexible',
    location: 'London - KCS',
    overseas: ''
  },
  {
    id: 'p022', name: 'G. Andersen', grade: 'HEO',
    roles: ['Press & Media Adviser', 'Communications Officer'],
    directorates: ['Communications'],
    days: ['Mon', 'Tue', 'Fri'],
    style: 'collaborative',
    location: 'Remote',
    overseas: ''
  },
];
