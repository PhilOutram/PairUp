# FCDO PairUp — Job Share Matching App

## IMPORTANT: Read this file in full before making any changes

This file is the single source of truth for the PairUp prototype.

> **Current version: v1.14** (post user-testing round, April 2026). The section
> immediately below supersedes the large "19 changes" specification further down
> the page where they conflict. The older spec is kept as historical context only.

---

## Current state (v1.13) — what the app does today

### Three tabs
1. **My profile** — single form the user fills in. Required info + Optional info.
   A consent checkbox above the Save button must be ticked before saving (sticky
   once accepted, stored in `localStorage` under `pairup_consent_v1`).
2. **Potential matches** — a single ranked list. Each card has an **Email**
   button (opens `mailto:` with a pre-populated subject and body containing the
   user's own profile summary) and a **Dismiss** button. No request/accept/
   connection workflow exists.
3. **Guidance** — a third tab with placeholder links (curated content TBD) and
   an explanation of what data becomes visible.

### What was removed in this round
- **Request / accept / ignore / withdraw / connection** flows — entirely gone.
  No `sentRequests`, `receivedRequests`, `connections`, `pendingTimers`,
  `activeOverrides`, `newConnBanner` in state. No Connected tab.
- **Working style presets** (4 cards on the profile form) — removed. The
  concept now lives only as a prompt inside the "Other information, including
  working style" optional field. The `style` field is removed from state and
  from all dummy profiles.
- **"Open to any"** directorate label — renamed to **"Match to any"**, moved
  to the first chip in the directorate list, styled distinctly (dashed border).
  Migration logic in `app.js` converts any saved profile with the old value.

### What was added
- **"How matching works" collapsible** on the Potential matches tab — explains
  gating and the 0-100 ranking breakdown in plain English.
- **"New" pill** — shows against match cards the user hasn't seen yet.
  Tracked via `localStorage` key `pairup_seenMatches_v1`. Cleared when the user
  leaves the Potential matches tab.
- **Help button (?)** in the Optional info section — opens a modal with
  "things to consider before sharing".
- **Only overlapping directorates** are shown on match cards. Full directorate
  list remains visible in the "Full profile…" modal.
- **Consent checkbox** gating the Save button. Sticky across sessions.
- **Guidance tab** with placeholder links.
- **Neutral pair-of-people icon** replaces the heart icon on the Matches tab.
- **Mobile pass** — header actions stacked/icon-only under 640px, card buttons
  move below content, day matrix narrows its header column, visibility and
  search-pref rows stack vertically.

### State shape (current)
```javascript
// localStorage key: 'pairup_v2'
{
  profile: {
    name, grade, directorates: [],  // may include 'Match to any'
    days: { Mon: 'non', ... },      // 'full'|'part'|'non'|'flexible'
    location, overseas,
    availability, skills, fte, daysNegotiable,
    workingPatternNotes, otherInfo,
    lastActive,
    visibility: { grade, directorates, location, days }  // 'must' | 'open'
  } | null,
  dismissed: [],
  showDismissed: false,
}
// localStorage key: 'pairup_searchPrefs'  — { grade, directorates, location, days }: 'definite'|'preferred'|'irrelevant'
// localStorage key: 'pairup_consent_v1'   — '1' once consent given
// localStorage key: 'pairup_seenMatches_v1' — JSON array of ids the user has seen
// localStorage key: 'pairup_weights_v1'   — { gradePenalty: 'hard'|'heavy'|'light'|'none' }
```

### Known gaps flagged for future rounds
- FCDO grade and directorate lists are approximate — awaiting authoritative
  source before updating.
- Guidance-tab link targets are placeholders.
- No real email address is known for dummy profiles, so the `mailto:` opens
  with an empty `to` field; users paste the real internal address from the
  FCDO directory. Production (Azure) version will fill this in.

### Do not regress (post-v1.13)
- Single-list matches flow. Do not reintroduce request/accept/connection
  workflow without explicit instruction.
- Consent checkbox gating Save.
- Only overlapping directorates on match cards.
- "Match to any" as the first directorate chip, with the dashed-border style.
- Working style lives inside "Other information", not as separate preset cards.
- "New" pill visibility logic: only tag cards whose id is NOT in
  `pairup_seenMatches_v1`; add ids to the set on tab-leave.

---

## Project overview

PairUp is an internal FCDO web application that helps staff find compatible job share partners during the organisational restructure. It is particularly important for part-time staff (disproportionately women, parents, carers, and disabled staff) who are at risk of being unable to compete for roles if they cannot find job share partners quickly.

A working prototype exists as four static files (`index.html`, `styles.css`, `app.js`, `data.js`). This CLAUDE.md describes the full set of 19 changes required to bring the prototype in line with staff survey feedback and subsequent design decisions.

---

## Why this matters — problem context

- Staff at EO–SCS1 (particularly G6/G7) report repeated failed attempts to find job share partners
- The existing job share register is a Word document: out of date, poorly maintained, overly exposed, impossible to filter
- Successful matches currently happen via personal networks — reinforcing inequity
- The restructure will create an unprecedented spike in simultaneous demand
- PUS has publicly committed to supporting job sharing; this tool makes that commitment practical
- Groups disproportionately affected: women, parents, carers, disabled staff

---

## Current prototype — file inventory

| File | Purpose |
|------|---------|
| `index.html` | Shell, navigation, tab structure, all modal HTML (privacy, about, admin, score, profile) |
| `styles.css` | All styling — CSS custom properties, mobile-responsive |
| `app.js` | All behaviour: matching algorithm, card rendering, localStorage state, filter UI, admin panel, modal logic, timer simulation |
| `data.js` | 22 dummy profiles, role taxonomy (12 groups, 64 roles), FCDO grade/directorate/overseas data |

### State management
All state stored in `localStorage` under key `pairup_v2`. Production will replace this with Azure PostgreSQL via Azure Functions API. For now, keep localStorage but update the state schema to support all new fields defined in Change 19.

---

## Required changes — full specification

These 19 changes must all be implemented. Work through them in order as later changes depend on earlier ones.

---

### CHANGE 1 — Remove the roles accordion from the profile form entirely

**Files:** `index.html`, `app.js`, `data.js`

**What to remove from `index.html`:** The entire "Roles you'd consider" `<div class="form-section">` block including the accordion container, grade note, and selected roles summary.

**What to remove from `app.js`:** The functions `buildAccordion()`, `updateGradeFilter()`, `updateGroupCounts()`, `updateRoleSummary()`, and all references to `ROLE_GROUPS`, `.role-chip`, `#roleAccordion`, `#selectedRolesSummary`, `#complFill` role-related logic. Also remove the `setupMultiChips` call for roles and any accordion-related CSS class references.

**What to remove from `data.js`:** The entire `ROLE_GROUPS` array (12 groups, 64 roles). Remove the `roles` field from all 22 dummy profiles.

**Why:** Survey feedback (Kate Binns, April 2026): *"Roles you'd consider — hard to define what categories are helpful here. Probably easier to just filter by directorate."* The accordion added complexity without matching value. Directorate selection covers the need adequately.

**Effect on scoring:** Role fit was a 25pt scoring dimension. Remove it entirely. Do not redistribute to other dimensions — the new algorithm (Change 4) replaces the points system.

**Completeness bar:** Remove roles from required fields. New required fields = name, grade, directorates, days, location (5 fields = 100%).

---

### CHANGE 2 — Replace days picker with per-day full/part/non/flexible grid

**Files:** `index.html`, `styles.css`, `app.js`, `data.js`

**What to replace:** The current 5-chip Mon/Tue/Wed/Thu/Fri multi-select (`#dayChips`, `.days-grid`, `.day-chip`) with a grid where each day has a 4-option selector.

**Why:** Survey feedback: *"'Days I work' is too rigid given that many job-sharers have flexibility to negotiate or work some part-days."* Staff need to express e.g. "I work Wednesday but only half a day."

**New UI:** A 5-column grid, one column per day. Each column has the day name as a header and four buttons (Full / Part / Non / Flex) where exactly one can be active. Compact, scannable.

```
     Mon      Tue      Wed      Thu      Fri
  [Full  ]  [Full  ]  [Part  ]  [Non   ]  [Flex  ]
  [ Part ]  [ Part ]  [ Full ]  [ Part ]  [ Part ]
  [ Non  ]  [ Non  ]  [ Non  ]  [ Full ]  [ Non  ]
  [ Flex ]  [ Flex ]  [ Flex ]  [ Flex ]  [ Full ]
```

Style the active button with blue fill, inactive with grey border. Default all days to 'non' (not working) until user selects.

**New data model for days — replace array with object:**
```javascript
// Old: days: ['Mon', 'Tue', 'Thu']
// New:
days: {
  Mon: 'full',      // 'full' | 'part' | 'non' | 'flexible'
  Tue: 'full',
  Wed: 'part',
  Thu: 'non',
  Fri: 'flexible'
}
```

**Completeness check:** Profile is complete on days if at least one day is set to 'full', 'part', or 'flexible' (i.e. not all 'non').

**Update all 22 dummy profiles in `data.js`** to use the new object format.

---

### CHANGE 3 — Remove working style from matching score and required fields

**Files:** `index.html`, `app.js`

**What to change in `app.js`:** Remove the working style dimension from `scoreMatch()` entirely. Remove from `updateCompleteness()` required field count. Remove `setupSingleChips` for style cards. Remove style from `scoreToPercent` calculation.

**What to change in `index.html`:** Keep the 4-option working style selector (Clean handover / Close collaboration / Flexible / Not sure yet) on the profile form but mark it clearly as **optional**. Add hint text: *"Optional — not used in matching. Useful for reference when you speak to potential partners."*

**Remove from:** Filter bar (Change 16), About modal scoring table (Change 15), score breakdown modal.

**Keep:** Store working style in the profile state as `style: ''`. Show it on the full profile modal view as an informational field. Do not use it in any matching or ranking calculation.

**Why:** Survey feedback: *"Working style — don't think it's helpful to filter on this, best to discuss once you've matched."*

---

### CHANGE 4 — Restructure matching: grade and directorate become hard gates; introduce ranking score

**Files:** `app.js`

**This is the most significant algorithmic change.**

**Why:** Survey feedback: *"Best to only see people who are 100% match in terms of your selected grade and divisions — this reduces personal info being visible to people who are not potential matches."*

**New `getMatches()` logic — three steps:**

**Step 1 — Target's visibility gates** (cannot be overridden by searcher — see Change 18):
For each candidate, check if the searcher satisfies the candidate's "must match" settings. If not, exclude.

**Step 2 — Searcher's Definite criteria** (set in search preferences — see Change 19):
For each criterion the searcher has set to 'definite', exclude candidates that don't match. Default: grade = definite, directorates = definite.

**Step 3 — Rank remaining by score** (0–100):
- Day complementarity: 0–40pts (primary — see complementarity scoring below)
- Additional directorate overlap beyond minimum: 0–20pts (each shared dir beyond first = +7, max 20)
- Recency/staleness: 0–20pts (< 2 weeks = 20, 2 weeks–3 months = 15, 3–6 months = 5, >6 months = 0)
- Location match: 0–10pts (same location = 10, different = 0)
- Preferred criteria bonuses from search preferences (see Change 19)
- Days negotiable: yes = +3, possibly = +1

**Day complementarity scoring function:**
```javascript
function dayComplementarityScore(userDays, candidateDays) {
  // Returns 0.0 – 1.0 (multiply by 40 for points)
  const pairs = {
    'full+non': 1.0, 'non+full': 1.0,
    'full+flexible': 0.8, 'flexible+full': 0.8,
    'part+non': 0.6, 'non+part': 0.6,
    'part+flexible': 0.5, 'flexible+part': 0.5,
    'flexible+flexible': 0.4,
    'part+part': 0.3,
    'non+non': 0.2,
    'full+full': 0.0,
    'full+part': 0.1, 'part+full': 0.1
  };
  const days = ['Mon','Tue','Wed','Thu','Fri'];
  const total = days.reduce((sum, d) => {
    const key = `${userDays[d]||'non'}+${candidateDays[d]||'non'}`;
    return sum + (pairs[key] ?? 0.2);
  }, 0);
  return total / 5;
}
```

**Score display:** Keep RAG colouring (≥65% green, 40–64% amber, <40% red) but this now represents ranking quality among pre-filtered results, not overall compatibility across all dimensions.

**Remove from `scoreMatch()`:** Grade score (40pts), directorate score (25pts), role score (25pts), working style score (10pts). These no longer contribute to the ranking score.

---

### CHANGE 5 — Add "Availability" free text field

**Files:** `index.html`, `app.js`, `data.js`

**What:** A single-line text input with 200 character limit and live character count. Place it as the second field on the profile form (after name, before grade).

**Label:** `Availability — what are you currently looking for?`

**Hint:** *e.g. 'Looking for roles in stage 2', 'Have been offered X role, seeking Mon–Wed partner', 'End of tour June, seeking partner for next posting'*

**Required:** No (optional). Does not affect completeness bar.

**Display:**
- On match card: show as a short line below the name row, truncated at ~80 characters with ellipsis. If empty, show nothing (do not show an empty row).
- On full profile modal: show in full.

**Matching:** Not used in matching or ranking.

**Data model:** Add `availability: ''` to profile state. Add a short sentence to each dummy profile in `data.js`.

---

### CHANGE 6 — Add "Skills and experience" free text field (50-word limit)

**Files:** `index.html`, `app.js`, `data.js`

**What:** A textarea with live word count. Show remaining words (e.g. "32 words remaining"). Hard cap at 50 words — prevent further input once limit reached.

**Label:** `Skills and experience`

**Hint:** *A short summary to help potential partners assess fit — e.g. '7 years policy, Middle East specialism, programme management experience'. Max 50 words.*

**Required:** No.

**Display:** Full profile modal only (not on match cards — too long).

**Matching:** Not used.

**Data model:** Add `skills: ''` to profile state. Add brief examples to some dummy profiles.

---

### CHANGE 7 — Add "Additional working pattern information" free text field

**Files:** `index.html`, `app.js`

**What:** A textarea for patterns the day grid cannot capture.

**Label:** `Additional working pattern information`

**Hint:** *e.g. 'I work 6 hours on Wednesday from home', 'Can be flexible around school hours', 'Prefer not to work school holidays'*

**Required:** No.

**Display:** Full profile modal only.

**Matching:** Not used.

**Data model:** Add `workingPatternNotes: ''` to profile state.

---

### CHANGE 8 — Add "Other information" free text field

**Files:** `index.html`, `app.js`

**What:** A general-purpose free text textarea. Equivalent to what the existing Word register allows.

**Label:** `Other information`

**Hint:** *Anything else that might help a potential partner — overseas posting plans, specialist skills, languages, specific roles you have in mind, whether you are already in a role and looking for a partner to join you*

**Required:** No.

**Display:** Full profile modal only.

**Matching:** Not used.

**Data model:** Add `otherInfo: ''` to profile state.

---

### CHANGE 9 — Add "FTE / hours" field

**Files:** `index.html`, `app.js`, `data.js`

**What:** A short free text input.

**Label:** `FTE or hours per week`

**Hint:** *e.g. '0.6 FTE', '22 hours', '3 days'*

**Required:** No.

**Display:** On match cards alongside the day grid. Format: `0.6 FTE | M● T● W◑ Th○ F~`

**Matching:** Not used directly.

**Data model:** Add `fte: ''` to profile state. Populate all 22 dummy profiles with plausible values.

---

### CHANGE 10 — Add "Is your working pattern negotiable?" field

**Files:** `index.html`, `app.js`, `data.js`

**What:** Three-option selector: **Yes / Possibly / No**. Displayed as a chip-style single select.

**Label:** `Is your working pattern negotiable?`

**Required:** No.

**Display:** On match cards as a small tag: green `Negotiable` if yes, amber `Possibly` if possibly, no tag if no or unset.

**Matching:** Used as a small ranking bonus in Change 4 (yes = +3pts, possibly = +1pt).

**Data model:** Add `daysNegotiable: ''` to profile state (values: `'yes'`, `'possibly'`, `'no'`, `''`). Populate dummy profiles with varied values.

---

### CHANGE 11 — Name visibility — initials only when gates not satisfied

**Files:** `app.js`

**What:** In `buildCard()`, conditionally show the candidate's full name or initials only.

**Logic:**
- If the candidate passes both the grade gate AND directorate gate for the searcher → show full name
- If the candidate is visible only because the searcher relaxed a Definite to Preferred → show initials (e.g. "K.B.") with italic grey text `[Name visible once criteria are met]`

**Why:** Survey/Kate: *"Name should only be visible when grade/directorate are a direct match to reduce oversharing personal info."*

**Implementation:** Since Change 4 means all profiles in the default view already pass both gates, full names will normally be shown. Initials only appear in the relaxed-search scenario where the searcher has changed Grade or Directorates from Definite to Preferred and is seeing results outside their own gate criteria.

---

### CHANGE 12 — Location: display only, not a gate

**Files:** `app.js`, `styles.css`

**What:** Remove location as a hard matching gate. Location provides a ranking bonus only (10pts for same location in Change 4).

**Why:** Survey respondents: *"Location is not a major factor for me unless the job is limited to a location. I job shared with someone based at another location and it was a pro."*

**Changes:**
- Location tag on cards: always grey (informational), never green. It is no longer a "match" signal.
- Remove location from the hard filter bar gates.
- Keep location as an optional search preference filter (Preferred setting in Change 19 gives bonus points).
- Keep location on profile form and full profile modal.

---

### CHANGE 13 — Update match cards to show availability text and day pattern

**Files:** `app.js`, `styles.css`

**What:** Update `buildCard()` in `app.js` to display:

1. **Availability text** — shown below the name row if filled in; truncated at ~80 chars with `…`; muted grey text; if empty, the row is omitted entirely
2. **FTE + day pattern** — compact display on a single line. Use pip symbols: ● = full, ◑ = part, ○ = non, ~ = flexible. Format: `0.6 FTE | M● T◑ W○ Th● F~`
3. **Negotiable tag** — small pill after the day pattern: green `Negotiable` if yes, amber `Possibly` if possibly

**Updated card layout:**
```
[5px accent] | Name · STATUS TEXT                          | [Request]
             | availability text truncated (if set)        | [Dismiss]
             | [grade tag] [directorate tag]               |
             | 0.6 FTE | M● T◑ W○ Th● F~  Negotiable      |
             | XX% match · last active X days · Full profile… |
```

**Staleness text** (see Change 14) sits on the bottom info row alongside match % and Full profile link.

---

### CHANGE 14 — Add staleness indicator ("last active") to match cards

**Files:** `app.js`, `data.js`, `styles.css`

**What:** Each profile has a `lastActive` timestamp. Updated to `Date.now()` every time the user saves their profile. Display staleness on match cards.

**Display rules:**
| Age | Display | Style |
|-----|---------|-------|
| < 14 days | Nothing shown | — |
| 14 days – 3 months | `Active X weeks ago` | Light grey text |
| 3 – 6 months | `Active X months ago` | Amber text with amber dot |
| > 6 months | `Active 6+ months ago` | Red text with red dot + tooltip: *"This profile may be out of date"* |

**Why:** Survey: *"Confidence in any tool is contingent on up-to-date records."* The existing register is distrusted precisely because it goes stale. Recency signals encourage trust.

**Ranking effect:** More recently active profiles rank higher (see Change 4 — 0–20pts for recency).

**Prototype implementation:** Add `lastActive` to profile state, set on every save. In `data.js`, add `lastActive` to all 22 dummy profiles with varied timestamps: some recent (Date.now() minus a few days), some old (Date.now() - 7 months) to demonstrate all three indicator states.

---

### CHANGE 15 — Update the About modal scoring explanation

**Files:** `index.html`

**What:** Rewrite the scoring section of the About modal to reflect the new algorithm.

**Remove:** The bar chart of weighted dimensions (grade 40pts, role 25pts etc.). This is no longer accurate.

**Replace with:**

```
How matching works

First, PairUp applies two gates — your profile only shows people who:
  ✓ Are the grade you are looking for (unless you relax this in search settings)
  ✓ Share at least one directorate with you (unless you relax this)

Within those results, profiles are ranked by:
  • Day pattern complementarity — how well your working days fit together
  • How recently the person was active — fresher profiles rank higher
  • How many directorates you share beyond the minimum
  • Whether you are in the same location
  • Whether their pattern is negotiable

You control this in "How I want to find matches" on the Matches tab.
```

Also remove role fit and working style from the About modal entirely.

---

### CHANGE 16 — Overhaul the filter bar

**Files:** `index.html`, `app.js`

**What to remove:** Working style filter section. Min match % filter section.

**What to replace it with:** The filter bar becomes a lightweight secondary control — quick toggles that layer on top of the main Search Preferences panel (Change 19). Keep only:
- **Days filter** — filter to profiles that work a specific day (e.g. show only people who work Mondays). Multi-select.
- **Location filter** — single-select to narrow to a specific location.

**Position:** Keep filter button inline with "Suggested matches" label (right-aligned). Filter panel drops below.

**Chip colour coding:** Keep the existing behaviour — green chips for values matching the user's own profile, grey for others. The critical CSS bug fix must be preserved: when a chip is selected, `chip.style.background = ''` and `chip.style.color = ''` must be called explicitly to clear inline styles and allow the `.filter-chip.selected { background: #042C53; color: #fff }` CSS class to take over.

---

### CHANGE 17 — Update completeness bar and admin panel

**Files:** `app.js`, `index.html`

**Completeness bar — `updateCompleteness()` in `app.js`:**
New required fields (5 total for 100%):
1. Name (non-empty)
2. Substantive grade (selected)
3. Directorates of interest (at least one selected)
4. Days (at least one day set to 'full', 'part', or 'flexible' — not all 'non')
5. Location (selected)

Working style, roles: no longer required. All new free-text fields are optional.

**Admin panel:** Remove weight sliders for role fit and working style (no longer scoring dimensions). Update panel to show the new ranking factor descriptions (day complementarity, recency, directorate overlap, location). Keep the grade penalty mode selector — relevant for the edge case where grade is in Preferred mode (Change 19). The admin panel now primarily controls whether 1-grade-apart profiles appear at all in relaxed searches.

---

### CHANGE 18 — NEW FEATURE: Profile visibility controls ("Who can find me")

**Files:** `index.html`, `app.js`

**What:** A new collapsible section at the bottom of the profile form, below all other fields. Titled **"Who can find me"**.

**UI:**
```
─── Who can find me ─────────────────────────────────────────────────
Control when your profile appears in other people's search results.

"Must match" = your profile only shows to people who meet this criterion.
"Open" = your profile is visible to anyone regardless of this criterion.

Grade:         [Must match ●]  [Open ○]
Directorates:  [Must match ●]  [Open ○]
Location:      [Must match ○]  [Open ●]
Days pattern:  [Must match ○]  [Open ●]
─────────────────────────────────────────────────────────────────────
```

**Defaults:** Grade = Must match, Directorates = Must match, Location = Open, Days = Open.

**How visibility gates work in matching:**
When User A (searcher) searches for matches, for each candidate profile (User B):
- For each criterion where User B has "must match" set:
  - Check whether User A's profile satisfies that criterion
  - If not → exclude User B from User A's results entirely, always, regardless of what User A sets in their search preferences (Change 19)

**This rule is absolute.** If Kate sets grade = must match and Phil is a different grade, Phil will never see Kate's profile, even if Phil relaxes his own grade preference to Preferred.

**On match cards — warning indicator:** If User A can see User B (because User A passed User B's visibility gates), but User A's own profile would NOT satisfy User B's criteria if the roles were reversed, show a small warning icon on the card:
```
⚠ Note: this person requires a grade match to see your profile
```
This prevents wasted one-sided connection attempts where only one party can find the other.

**Data model:** Add to profile state:
```javascript
visibility: {
  grade: 'must',          // 'must' | 'open'
  directorates: 'must',   // 'must' | 'open'
  location: 'open',       // 'must' | 'open'
  days: 'open'            // 'must' | 'open'
}
```

Add to all 22 dummy profiles with default values.

---

### CHANGE 19 — NEW FEATURE: Search preferences panel ("How I want to find matches")

**Files:** `index.html`, `app.js`

**What:** A collapsible panel on the Matches tab, replacing the old filter bar as the primary search control. Titled **"How I want to find matches"**.

**This is entirely separate from profile visibility (Change 18).** It controls how *this* user searches. It applies only to the searcher's own results. It can be more relaxed than the searcher's own visibility settings — the user controls their own search experience.

**Key rule:** A user's search preferences can override their own visibility settings for search purposes. If Kate set grade = "must match" on her profile (meaning Kate only wants to appear to same-grade people), she can still relax grade to Preferred in her own search to find people of adjacent grades. Her visibility setting governs who finds her; her search preferences govern who she finds.

**UI:**
```
─── How I want to find matches ──────────────────────────────────────
Set how important each criterion is to your search.

● Definite = only show profiles that match this (hard gate)
◐ Preferred = show all, rank matching profiles higher
○ Not relevant = ignore this when searching

Grade:          [● Definite]  [◐ Preferred]  [○ Not relevant]
Directorates:   [● Definite]  [◐ Preferred]  [○ Not relevant]
Location:       [○ Not rel.]  [◐ Preferred]  [○ Not relevant]   ← default: Preferred
Days pattern:   [○ Not rel.]  [◐ Preferred]  [○ Not relevant]   ← default: Preferred
─────────────────────────────────────────────────────────────────────
```

**Defaults:** Grade = Definite, Directorates = Definite, Location = Preferred, Days = Preferred.

**Matching algorithm incorporating search preferences:**

```javascript
function getMatches(userProfile, allProfiles, searchPrefs) {
  return allProfiles
    .filter(candidate => {
      // Gate 1: Does searcher satisfy candidate's must-match visibility rules?
      // (see Change 18 — these cannot be overridden)
      if (candidate.visibility.grade === 'must') {
        if (candidate.grade !== userProfile.grade) return false;
      }
      if (candidate.visibility.directorates === 'must') {
        const overlap = userProfile.directorates.some(d =>
          candidate.directorates.includes(d) || d === 'Open to any' ||
          candidate.directorates.includes('Open to any')
        );
        if (!overlap) return false;
      }
      if (candidate.visibility.location === 'must') {
        if (candidate.location !== userProfile.location) return false;
      }
      if (candidate.visibility.days === 'must') {
        if (dayComplementarityScore(userProfile.days, candidate.days) < 0.3) return false;
      }

      // Gate 2: Searcher's own Definite criteria
      if (searchPrefs.grade === 'definite') {
        if (candidate.grade !== userProfile.grade) return false;
      }
      if (searchPrefs.directorates === 'definite') {
        const overlap = userProfile.directorates.some(d =>
          candidate.directorates.includes(d) || d === 'Open to any' ||
          candidate.directorates.includes('Open to any')
        );
        if (!overlap) return false;
      }
      if (searchPrefs.location === 'definite') {
        if (candidate.location !== userProfile.location) return false;
      }
      if (searchPrefs.days === 'definite') {
        if (dayComplementarityScore(userProfile.days, candidate.days) < 0.3) return false;
      }

      return true;
    })
    .map(candidate => {
      const score = rankScore(userProfile, candidate, searchPrefs);
      const failsVisibilityCheck = candidateCannotFindSearcher(candidate, userProfile);
      return { profile: candidate, score, failsVisibilityCheck };
    })
    .sort((a, b) => b.score - a.score);
}

function rankScore(user, candidate, searchPrefs) {
  let score = 0;

  // Day complementarity (0–40pts)
  score += dayComplementarityScore(user.days, candidate.days) * 40;

  // Additional directorate overlap (0–20pts)
  const sharedDirs = user.directorates.filter(d =>
    candidate.directorates.includes(d) && d !== 'Open to any'
  );
  score += Math.min(sharedDirs.length * 7, 20);

  // Recency (0–20pts)
  const ageDays = (Date.now() - (candidate.lastActive || 0)) / 86400000;
  if (ageDays < 14) score += 20;
  else if (ageDays < 90) score += 15;
  else if (ageDays < 180) score += 5;

  // Location (0–10pts)
  if (user.location && candidate.location === user.location) score += 10;

  // Preferred criteria bonuses
  if (searchPrefs.grade === 'preferred' && candidate.grade === user.grade) score += 10;
  if (searchPrefs.directorates === 'preferred' && sharedDirs.length > 0) score += 8;
  if (searchPrefs.location === 'preferred' && candidate.location === user.location) score += 5;
  if (searchPrefs.days === 'preferred' &&
      dayComplementarityScore(user.days, candidate.days) > 0.5) score += 7;

  // Days negotiable
  if (candidate.daysNegotiable === 'yes') score += 3;
  if (candidate.daysNegotiable === 'possibly') score += 1;

  return Math.min(Math.round(score), 100);
}

function candidateCannotFindSearcher(candidate, user) {
  // Returns true if user's profile would fail candidate's visibility rules
  if (candidate.visibility.grade === 'must' && candidate.grade !== user.grade) return true;
  if (candidate.visibility.directorates === 'must') {
    if (!candidate.directorates.some(d => user.directorates.includes(d))) return true;
  }
  if (candidate.visibility.location === 'must' && candidate.location !== user.location) return true;
  return false;
}
```

**Persistence:** Save `searchPrefs` to `localStorage` under key `pairup_searchPrefs`. Load on init. Persist between sessions.

**UX for "no results" state:** If the user gets zero matches with default Definite settings, show a clear message: *"No matches found with your current criteria. Try changing Grade or Directorates from 'Definite' to 'Preferred' in your search preferences to see a wider set of potential partners."*

---

## Updated profile state data model

```javascript
// localStorage key: 'pairup_v2'
{
  profile: {
    name: '',
    grade: '',                  // 'G7' etc.
    directorates: [],           // ['Economic & Trade', ...]
    days: {                     // per-day working pattern
      Mon: 'non', Tue: 'non', Wed: 'non', Thu: 'non', Fri: 'non'
      // values: 'full' | 'part' | 'non' | 'flexible'
    },
    location: '',               // 'London - KCS' | 'East Kilbride' | 'Remote' | 'Overseas'
    overseas: '',
    availability: '',           // free text, 200 char max
    skills: '',                 // free text, 50 word max
    fte: '',                    // e.g. '0.6 FTE'
    daysNegotiable: '',         // 'yes' | 'possibly' | 'no' | ''
    workingPatternNotes: '',    // free text
    otherInfo: '',              // free text
    style: '',                  // optional: 'clean' | 'collaborative' | 'flexible' | 'unsure'
    lastActive: null,           // Date.now() — updated on every profile save
    visibility: {
      grade: 'must',            // 'must' | 'open'
      directorates: 'must',
      location: 'open',
      days: 'open'
    }
  },
  sentRequests: [],
  receivedRequests: [],
  connections: [],
  dismissed: [],
  showDismissed: false,
  newConnBanner: null,
  pendingTimers: {},
  _bootstrapped: false
}

// localStorage key: 'pairup_searchPrefs'
{
  grade: 'definite',            // 'definite' | 'preferred' | 'irrelevant'
  directorates: 'definite',
  location: 'preferred',
  days: 'preferred'
}
```

---

## UI/UX design decisions — DO NOT REGRESS THESE

### Card layout (updated for new fields)
```
[5px accent bar] | Name · STATUS TEXT                          | [Request btn]
                 | availability text truncated (if set)        | [Dismiss btn]
                 | [grade tag] [directorate tag(s)]            |
                 | FTE | M● T◑ W○ Th● F~  [Negotiable tag]    |
                 | XX% match · staleness · Full profile…       |
```

- Accent bar colour = RAG from ranking % (green ≥65 / amber 40–64 / red <40)
- Match % text = same RAG colour as bar
- Grade and directorate tags: green if matches searcher's own value, grey otherwise
- Location tag: always grey (display only — no longer a match signal per Change 12)
- "Full profile…" = plain text link, NOT a button
- Primary button: `all:unset; background:#185FA5; color:#fff`
- Secondary button: ghost, grey border, muted text
- No avatars or initials circles
- No right-side 2×2 grid layout (caused height problems)

### CRITICAL: Filter/preference chip CSS bug (previously broken, now fixed — do not revert)
When a chip is selected, you MUST call:
```javascript
chip.style.background = '';
chip.style.color = '';
```
This clears the inline style set by the profile-colouring function, allowing the CSS class `.filter-chip.selected { background: #042C53; color: #fff }` to take over. Without this, the inline style wins over the CSS class and the dark navy selected state never shows.

When a chip is deselected, restore: `chip.style.background = chip.dataset.profileBg`

### CRITICAL: Button browser default override
All action buttons must use `all:unset` as the first style rule, followed by explicit values for every property. Without `all:unset`, browser default button styles (grey background, system font, wrong padding) override everything.

### Typography
- Chips: `font-weight: 500` (NOT 700 or 800 — heavier weights do not render in system fonts)
- Form labels: `font-weight: 700`, uppercase, `color: #777`, `letter-spacing: 0.6px`
- Card name: `font-weight: 500`, `font-size: 14px`
- Status text (inline with name): `font-size: 11px`, uppercase, `color: #185FA5`

---

## Dummy profiles — update spec for data.js

Remove `roles` field from all 22 profiles. Add these fields to each profile:

| Field | Example values |
|-------|---------------|
| `days` | `{Mon:'full', Tue:'full', Wed:'part', Thu:'non', Fri:'flexible'}` |
| `availability` | `'Looking for roles in stage 2'` / `'Have been offered X role, need Mon–Wed partner'` |
| `skills` | `'Policy adviser, 8 years, Middle East and trade'` |
| `fte` | `'0.6 FTE'` / `'3 days'` / `'22 hours'` |
| `daysNegotiable` | `'yes'` / `'possibly'` / `'no'` |
| `workingPatternNotes` | `''` or e.g. `'Can work 6 hours Wednesday from home'` |
| `otherInfo` | `''` or e.g. `'Applying for roles with current partner'` |
| `lastActive` | Vary: some `Date.now() - 3*86400000` (3 days), some `Date.now() - 210*86400000` (7 months), some medium |
| `visibility` | Default `{grade:'must', directorates:'must', location:'open', days:'open'}` |
| `style` | Keep or remove — optional field only |

Ensure at least 4–5 profiles have a `lastActive` older than 6 months to demonstrate the red staleness indicator, and 3–4 in the amber range (3–6 months).

---

## Testing checklist

- [ ] Roles accordion completely removed from profile form and all JS functions cleaned up
- [ ] Days picker is a 5×4 grid (day × full/part/non/flexible), one selection per day
- [ ] Working style is optional, clearly labelled, not used in matching
- [ ] Grade and directorate act as hard gates in default search (Definite setting)
- [ ] Relaxing grade to Preferred shows wider results, ranked by day complementarity
- [ ] Candidate's "must match" visibility rule is never overridden by searcher's preferences
- [ ] Warning shown on card: "this person requires a grade match to see your profile"
- [ ] Availability, skills, FTE, negotiable, pattern notes, other info all present on profile form
- [ ] Availability text appears (truncated) on match cards; omitted if empty
- [ ] FTE + day pattern shown on match cards with pip symbols (●◑○~)
- [ ] Negotiable tag shown on cards (green for yes, amber for possibly)
- [ ] Staleness: profiles >6 months shown in red, 3–6 months amber, <2 weeks no indicator
- [ ] Name shown as initials only when gate criteria not satisfied (relaxed search scenario)
- [ ] Profile visibility section ("Who can find me") on profile form with 4 criteria toggles
- [ ] Search preferences panel ("How I want to find matches") on matches tab
- [ ] Search preferences persisted in localStorage under `pairup_searchPrefs`
- [ ] "No matches" message includes prompt to relax search preferences
- [ ] Filter chip bug: selecting chip clears inline style so `.selected` CSS class takes over
- [ ] Location tag is always grey (not green) — display only
- [ ] Profile save updates `lastActive` timestamp
- [ ] Completeness bar: 5 required fields only (name, grade, directorates, days, location)
- [ ] Admin panel updated: remove role/style sliders, keep grade penalty mode
- [ ] About modal updated to explain gates + ranking (not weighted scores)
- [ ] Version number incremented to v1.12

---

## Production architecture (Azure) — for reference

```
Staff browser (HTTPS)
  → Azure Static Web Apps (AAD/Entra ID auth + MFA)
  → Azure Functions (serverless API)
  → Azure PostgreSQL Flexible (private VNet, no public endpoint)
  → Azure Key Vault (secrets, connection strings)
  → Azure Monitor (audit logs)
```

Running costs: ~£15–25/month. PostgreSQL Flexible B1ms dominates; Static Web Apps and Functions are effectively free at this scale.

## Key contacts & credentials

- Flexible working network: flexible.working@fcdo.gov.uk
- Admin passphrase (prototype only, replace with AAD roles in production): `pairup-admin`
- Admin panel: single-click version number at bottom of page, or `Ctrl+Shift+A`
- Current version: v1.11 → increment to **v1.12** after all changes are complete