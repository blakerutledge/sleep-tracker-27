export interface WakeWindowTarget {
  id: string;
  ageLabel: string;
  minDays: number;
  maxDays: number; // exclusive
  wakeMin: number;
  wakeMax: number;
  preBedMin: number;
  preBedMax: number;
  napCountMin: number;
  napCountMax: number;
  napDurMin: number;
  napDurMax: number;
  nightSleepMinHrs: number;
  nightSleepMaxHrs: number;
  totalSleepMinHrs: number;
  totalSleepMaxHrs: number;
  bedtimeLabel: string;
  wakeTimeLabel: string; // Verbatim Table 7
  napDurationLabel: string; // Verbatim Table 7
  napsPerDayLabel: string; // Verbatim Table 7
}

// Verbatim synthesis of Table 1 (Ch. 3), Table 2 (Ch. 5), and Table 7 (Ch. 10)
export const WAKE_WINDOW_TARGETS: readonly WakeWindowTarget[] = [
  {
    id: '0-6w',
    ageLabel: 'Birth–6 Weeks',
    minDays: -300,
    maxDays: 42,
    wakeMin: 30,
    wakeMax: 60,
    preBedMin: 60,
    preBedMax: 240,
    napCountMin: 4,
    napCountMax: 8,
    napDurMin: 15,
    napDurMax: 240,
    nightSleepMinHrs: 8,
    nightSleepMaxHrs: 14,
    totalSleepMinHrs: 14,
    totalSleepMaxHrs: 18,
    bedtimeLabel: '9–11 p.m. (8p–12a)',
    wakeTimeLabel: '30 mins.–1 hr.',
    napDurationLabel: '15 mins.–4 hrs.',
    napsPerDayLabel: '4–8',
  },
  {
    id: '6w-3m',
    ageLabel: '6 Weeks–3 Months',
    minDays: 42,
    maxDays: 105, // ~3.5 months
    wakeMin: 45,
    wakeMax: 105,
    preBedMin: 60,
    preBedMax: 120,
    napCountMin: 3,
    napCountMax: 5,
    napDurMin: 30,
    napDurMax: 120,
    nightSleepMinHrs: 8,
    nightSleepMaxHrs: 13,
    totalSleepMinHrs: 11,
    totalSleepMaxHrs: 15,
    bedtimeLabel: '8–11 p.m.',
    wakeTimeLabel: '45 mins.–1 hr., 45 mins.',
    napDurationLabel: '30 mins.–2 hrs.',
    napsPerDayLabel: '3–5',
  },
  {
    id: '4m',
    ageLabel: '4 Months',
    minDays: 105,
    maxDays: 137,
    wakeMin: 60,
    wakeMax: 120,
    preBedMin: 120,
    preBedMax: 180,
    napCountMin: 3,
    napCountMax: 4,
    napDurMin: 30,
    napDurMax: 120,
    nightSleepMinHrs: 9,
    nightSleepMaxHrs: 13,
    totalSleepMinHrs: 12,
    totalSleepMaxHrs: 14,
    bedtimeLabel: '7–9 p.m.',
    wakeTimeLabel: '1–2 hrs.',
    napDurationLabel: '30 mins.–2 hrs.',
    napsPerDayLabel: '3–4',
  },
  {
    id: '5m',
    ageLabel: '5 Months',
    minDays: 137,
    maxDays: 168,
    wakeMin: 75,
    wakeMax: 150,
    preBedMin: 120,
    preBedMax: 180,
    napCountMin: 3,
    napCountMax: 3,
    napDurMin: 30,
    napDurMax: 120,
    nightSleepMinHrs: 9,
    nightSleepMaxHrs: 12,
    totalSleepMinHrs: 12,
    totalSleepMaxHrs: 14,
    bedtimeLabel: '7–9 p.m.',
    wakeTimeLabel: '1 hr., 15 mins.–2.5 hrs.',
    napDurationLabel: '30 mins.–2 hrs.',
    napsPerDayLabel: '3',
  },
  {
    id: '6m',
    ageLabel: '6 Months',
    minDays: 168,
    maxDays: 198,
    wakeMin: 90,
    wakeMax: 180,
    preBedMin: 150,
    preBedMax: 195,
    napCountMin: 3,
    napCountMax: 3,
    napDurMin: 45,
    napDurMax: 120,
    nightSleepMinHrs: 9,
    nightSleepMaxHrs: 12,
    totalSleepMinHrs: 12,
    totalSleepMaxHrs: 14,
    bedtimeLabel: '6:30–8:30 p.m.',
    wakeTimeLabel: '1.5–3 hrs.',
    napDurationLabel: '45 mins.–2 hrs.',
    napsPerDayLabel: '3',
  },
  {
    id: '7m',
    ageLabel: '7 Months',
    minDays: 198,
    maxDays: 229,
    wakeMin: 105,
    wakeMax: 210,
    preBedMin: 165,
    preBedMax: 210,
    napCountMin: 2,
    napCountMax: 3,
    napDurMin: 45,
    napDurMax: 120,
    nightSleepMinHrs: 9,
    nightSleepMaxHrs: 12,
    totalSleepMinHrs: 12,
    totalSleepMaxHrs: 14,
    bedtimeLabel: '6:30–8:30 p.m.',
    wakeTimeLabel: '1 hr., 45 mins.–3.5 hrs.',
    napDurationLabel: '45 mins.–2 hrs.',
    napsPerDayLabel: '2–3',
  },
  {
    id: '8m',
    ageLabel: '8 Months',
    minDays: 229,
    maxDays: 260,
    wakeMin: 120,
    wakeMax: 210,
    preBedMin: 180,
    preBedMax: 240,
    napCountMin: 2,
    napCountMax: 3,
    napDurMin: 60,
    napDurMax: 120,
    nightSleepMinHrs: 9,
    nightSleepMaxHrs: 12,
    totalSleepMinHrs: 12,
    totalSleepMaxHrs: 14,
    bedtimeLabel: '6:30–8:30 p.m.',
    wakeTimeLabel: '2–3.5 hrs.',
    napDurationLabel: '1–2 hrs.',
    napsPerDayLabel: '2–3',
  },
  {
    id: '9-12m',
    ageLabel: '9–12 Months',
    minDays: 260,
    maxDays: 366,
    wakeMin: 120,
    wakeMax: 240,
    preBedMin: 210,
    preBedMax: 255,
    napCountMin: 2,
    napCountMax: 2,
    napDurMin: 60,
    napDurMax: 120,
    nightSleepMinHrs: 10,
    nightSleepMaxHrs: 12,
    totalSleepMinHrs: 12,
    totalSleepMaxHrs: 14,
    bedtimeLabel: '6:30–8:00 p.m.',
    wakeTimeLabel: '2–4 hrs.',
    napDurationLabel: '1–2 hrs.',
    napsPerDayLabel: '2',
  },
  {
    id: '12-18m',
    ageLabel: '12–18 Months',
    minDays: 366,
    maxDays: 548,
    wakeMin: 180,
    wakeMax: 360,
    preBedMin: 240,
    preBedMax: 330,
    napCountMin: 1,
    napCountMax: 2,
    napDurMin: 60,
    napDurMax: 180,
    nightSleepMinHrs: 10,
    nightSleepMaxHrs: 12,
    totalSleepMinHrs: 12,
    totalSleepMaxHrs: 14,
    bedtimeLabel: '7–8 p.m.',
    wakeTimeLabel: '5–6 hrs. (1 nap) / 3–4 hrs. (2 naps)',
    napDurationLabel: '1–3 hrs.',
    napsPerDayLabel: '1–2',
  },
  {
    id: '18m-plus',
    ageLabel: '18 Months–Done Napping',
    minDays: 548,
    maxDays: 2000,
    wakeMin: 240,
    wakeMax: 360,
    preBedMin: 240,
    preBedMax: 360,
    napCountMin: 0,
    napCountMax: 1,
    napDurMin: 60,
    napDurMax: 180,
    nightSleepMinHrs: 10,
    nightSleepMaxHrs: 12,
    totalSleepMinHrs: 11,
    totalSleepMaxHrs: 14,
    bedtimeLabel: '7–8 p.m.',
    wakeTimeLabel: '5 hrs.',
    napDurationLabel: '1–3 hrs.',
    napsPerDayLabel: '0–1',
  },
];

export function getWakeWindowTargetForAgeDays(totalDays: number): WakeWindowTarget {
  for (const row of WAKE_WINDOW_TARGETS) {
    if (totalDays >= row.minDays && totalDays < row.maxDays) {
      return row;
    }
  }
  return WAKE_WINDOW_TARGETS[WAKE_WINDOW_TARGETS.length - 1]!;
}

export interface Table1Row {
  age: string;
  hoursAwakeBeforeBed: string;
  lastNapEnds: string;
  avgBedtime: string;
  nightSleepHours: string;
}

export const TABLE_1_WAKE_BEFORE_BED: readonly Table1Row[] = [
  {
    age: '0–3 Months',
    hoursAwakeBeforeBed: '1–4 (newborns are funky)',
    lastNapEnds: 'Variable',
    avgBedtime: 'Variable to late: 8 p.m.–midnight',
    nightSleepHours: '8–14',
  },
  {
    age: '3–6 Months',
    hoursAwakeBeforeBed: '2–3',
    lastNapEnds: '4–6 p.m.',
    avgBedtime: 'Shifting earlier: 7–9 p.m.',
    nightSleepHours: '9–13',
  },
  {
    age: '6–9 Months',
    hoursAwakeBeforeBed: '3',
    lastNapEnds: '4 p.m.',
    avgBedtime: '7–8 p.m.',
    nightSleepHours: '9–12',
  },
  {
    age: '9–12 Months',
    hoursAwakeBeforeBed: '4',
    lastNapEnds: '3 p.m.',
    avgBedtime: '7–8 p.m.',
    nightSleepHours: '10–12',
  },
  {
    age: '1–3 Years',
    hoursAwakeBeforeBed: '4–6',
    lastNapEnds: '3 p.m.',
    avgBedtime: '7–8 p.m.',
    nightSleepHours: '10–12',
  },
];

export interface Table2Row {
  age: string;
  naps: string;
  napDuration: string;
  betweenNaps: string;
  beforeBed: string;
  bedtime: string;
  nightSleep: string;
  totalDaily: string;
}

export const TABLE_2_MASTER_SCHEDULE: readonly Table2Row[] = [
  {
    age: 'Birth–6 Weeks',
    naps: '4–8',
    napDuration: '15 min.–4 hrs.',
    betweenNaps: '45 min.–1 hr.',
    beforeBed: '1–4 hrs. (newborns are funky)',
    bedtime: 'Variable: 9–11 p.m.',
    nightSleep: '8–14',
    totalDaily: '14–18',
  },
  {
    age: '6 Weeks–3 Months',
    naps: '3–5',
    napDuration: '30 min.–2 hrs',
    betweenNaps: '1 hr.–1 hr., 45 mins.',
    beforeBed: '1–2 hrs.',
    bedtime: 'Variable: 8–11 p.m.',
    nightSleep: '8–13',
    totalDaily: '11–15',
  },
  {
    age: '3–6 Months',
    naps: '3',
    napDuration: '1–2 hrs.',
    betweenNaps: 'abt. 2 hrs.',
    beforeBed: '2–3 hrs.',
    bedtime: '7–9 p.m.',
    nightSleep: '9–12',
    totalDaily: '12–14',
  },
  {
    age: '6–9 Months',
    naps: '3',
    napDuration: '1–2 hrs.',
    betweenNaps: '2–3 hrs.',
    beforeBed: 'abt. 3 hrs.',
    bedtime: '6:30–8:30 p.m.',
    nightSleep: '9–12',
    totalDaily: '12–14',
  },
  {
    age: '9–12 Months',
    naps: '2–3',
    napDuration: '1–2 hrs.',
    betweenNaps: 'abt. 3 hrs.',
    beforeBed: '4 hrs.',
    bedtime: '6:30–8:00 p.m.',
    nightSleep: '10–12',
    totalDaily: '12–14',
  },
  {
    age: '12–18 Months',
    naps: '1–2',
    napDuration: '1–2 hrs.',
    betweenNaps: '3 hrs.',
    beforeBed: '4–5 hrs.',
    bedtime: '7–8 p.m.',
    nightSleep: '10–12',
    totalDaily: '12–14',
  },
  {
    age: '18 Months–3 Years',
    naps: '1',
    napDuration: '1–2 hrs.',
    betweenNaps: '–',
    beforeBed: '4–6 hrs.',
    bedtime: '7–8 p.m.',
    nightSleep: '10–12',
    totalDaily: '11–14',
  },
];

export interface Table6Row {
  age: string;
  low: string;
  average: string;
  high: string;
}

export const TABLE_6_NIGHT_FEEDS: readonly Table6Row[] = [
  { age: '0–3 Months', low: '1–2', average: '3–4', high: '6' },
  { age: '3–6 Months', low: '0', average: '2–3', high: '4' },
  { age: '6–9 Months', low: '0', average: '0–2', high: '2–3' },
  { age: '9–12 Months', low: '0', average: '0–1', high: '2' },
];

export function getFiveMinutePlanInterval(night: number, visit: number): number {
  const safeNight = Math.max(1, Math.min(5, Math.round(night)));
  const safeVisit = Math.max(1, Math.round(visit));
  return 5 * (safeNight + safeVisit - 1);
}

export interface ChronologicalPhase {
  id: string;
  title: string;
  ageSpan: string;
  calendarWindow: string;
  minDays: number;
  maxDays: number;
  biology: string;
  rules: readonly string[];
  avoid: readonly string[];
}

export const CHRONOLOGICAL_PHASES: readonly ChronologicalPhase[] = [
  {
    id: 'phase-0',
    title: 'Phase 0: Pre-Arrival Setup',
    ageSpan: 'Before Birth',
    calendarWindow: 'Now – Dec 31, 2026',
    minDays: -400,
    maxDays: 0,
    biology: 'Prep your bedroom bassinet station + future nursery so you never panic-shop at 2:00 AM.',
    rules: [
      'White noise between your bed and bassinet at ~50 dB (running-shower volume), zero auto-shutoff timers (Ch. 5).',
      'Blackout shades in BOTH your master bedroom and future nursery (Ch. 5 & 6).',
      'Night-vision video monitor mounted over the bassinet too—essential for FIO at Month 2+.',
      'Velcro/zip swaddles (two-finger chest tightness, loose hips) + arms-free sleep sacks ready.',
      'Know accidental bed-sharing safety rules; NEVER feed drowsy on a couch, armchair, or recliner (Ch. 1).',
    ],
    avoid: [
      'Avoid gifted amber teething necklaces and OTC benzocaine teething gels (Appendix).',
      'Do not rely on breathing/movement monitors to excuse stomach sleeping (Ch. 1).',
    ],
  },
  {
    id: 'phase-1',
    title: 'Phase 1: Newborn Party (Survival Mode)',
    ageSpan: '0–6 Weeks',
    calendarWindow: 'Jan 1 – Feb 12, 2027',
    minDays: 0,
    maxDays: 42,
    biology:
      '~50% noisy REM sleep, 50-min cycles, zero circadian rhythm. Longest stretch is 2–4h (often 9 a.m.–2 p.m. in Weeks 2–6!). Typical daily sleep: 14–18h (as low as 9h normal).',
    rules: [
      'Take a 2-week post-birth grace pass on schedules (Ch. 10); respect 30–60 min wake windows.',
      'Day/Night cues: morning sun & lively daytime feeds; pitch dark + ~50 dB white noise at night.',
      'NEVER change a wet-only diaper overnight—change ONLY for poop or active leaks (Ch. 4).',
      '2:00 AM Night Party Timer: try dim soothing ~20 mins; if wide awake, concede and retry in 45–60 mins (Ch. 2).',
      'Failed Bedtime Timer: cap soothing attempts at ~30 mins, reset calmly, retry later (Ch. 3).',
      'Witching Hours (5–11 p.m., peaking Week 6): cluster-feed freely (even every 10 mins) (Ch. 2).',
    ],
    avoid: [
      'Do NOT wake a sleeping young newborn (<2m) from long day naps to "fix day/night confusion" (Ch. 2).',
      'Zero SLIP/cry-it-out; do not worry about "bad habits" in the first 6 weeks.',
    ],
  },
  {
    id: 'phase-2',
    title: 'Phase 2: Circadian Awakening',
    ageSpan: '6 Weeks–3 Months',
    calendarWindow: 'Feb 12 – Mar 26, 2027',
    minDays: 42,
    maxDays: 90,
    biology:
      'Circadian rhythm switches on at 1–2 months; witching hours fade by ~8 weeks; longest stretch reaches 3–6h (4–6h early night).',
    rules: [
      'At 6–8 weeks, restrict pacifier to sleep-only and practice the gentle "pull-out" tug trick to strengthen grip (Ch. 5).',
      'Lock in a consistent 20–30 min bedtime routine, putting feeding near the start (15–20m before bed) (Ch. 3 & 6).',
      'Follow bedtime earlier from 9–11 p.m. toward 7–8 p.m. in 15-min/day steps (Ch. 3).',
      'Pause 30–60s ("Le Pause") on active-sleep bassinet grunts before picking up.',
    ],
    avoid: [
      'Do NOT drop the pacifier before 4 months unless medically advised—peak SIDS risk spans 2–3 months (Ch. 11).',
      'Stop swaddling IMMEDIATELY if baby rolls OR tips up onto their side (Ch. 5 & 11).',
    ],
  },
  {
    id: 'phase-3',
    title: 'Phase 3: Fuss It Out (FIO) Window',
    ageSpan: '2–4 Months',
    calendarWindow: 'Mar – Apr 2027',
    minDays: 60,
    maxDays: 120,
    biology:
      'Once bedtime lands within a 30-min window, precedes the longest stretch, and baby falls asleep within 10–15 min, FIO can teach independence before 4m object permanence locks in.',
    rules: [
      'Run low-stakes FIO: routine (feed 15–20m early) → power tools → into bassinet AWAKE → exit bedroom → strict 15 or 20 min timer (Ch. 6).',
      'If timer hits 00:00 and baby is calm/grumbling, let be; if screaming, rescue and retry in 1–7 days (or wait 2m if a "switch-flipper").',
      'Start 10–15 min pre-nap routine around 2–3 months; aim for 80% home/dark-room nap consistency at Month 3 (Ch. 10).',
      'Protect rolling safety: one-arm-out or cold-turkey swaddle transition once rolling threatens (Ch. 11).',
    ],
    avoid: [
      'Do NOT stay in the room watching baby fall asleep—exit the bedroom and watch via night-vision monitor (Ch. 6).',
    ],
  },
  {
    id: 'phase-4',
    title: 'Phase 4: Nursery Move, SLIP & Post-SLIP Nights',
    ageSpan: '4–6 Months',
    calendarWindow: 'May – Jun 2027',
    minDays: 120,
    maxDays: 185,
    biology:
      'Adult ~50–90m sleep cycles + object permanence (emerges 3.5m, spikes 4–8m). Even near-sleep feeding can cause hourly wakeups. Room-sharing SIDS evidence peaks <6m, making ~4.5–6m ideal for the nursery crib.',
    rules: [
      'Clean Nursery Transition: combine crib move + cold-turkey pacifier drop (4–5m golden exit!) + Full Extinction SLIP in one consistent stretch (Ch. 1, 7, 11).',
      'Pre-SLIP Checklist: 20+ min feed buffer, empty crib, blackout + ~50 dB white noise, unanimous parents, 14-day commitment, naps rescued by any means (zero 5-min catnaps after 4 p.m.).',
      'Night-1 Put-Down Time = historical 100%-asleep timestamp (not soothing start time!) (Ch. 7).',
      'Full Extinction (author top pick) or 5-Minute Plan check-ins (never switch Full -> Check-ins; expect possible Night 4 Extinction Burst).',
      'Post-SLIP Overnight Protocol (Ch. 8): No food before 12:00 a.m.; >=3–4h spacing afterward; binary 5–10 min pause/response rule (never feed after 30–40m crying!); optional 4–5:30 a.m. Snooze Feed.',
      'If starting solids: always serve full milk/formula BEFORE low-calorie purees (10–15 vs ~20 kcal/oz) (Ch. 9).',
    ],
    avoid: [
      'Avoid "drowsy but awake" after 4 months—aim for Calm and 100% Wide Awake (Ch. 4 & 7).',
      'Do NOT swaddle during SLIP unless strapped supine OR actively watched on a working night-vision monitor (Ch. 11).',
    ],
  },
  {
    id: 'phase-5',
    title: 'Phase 5: Zen Nap Ninja & Night Weaning',
    ageSpan: '5–9 Months',
    calendarWindow: 'Jun – Sep 2027',
    minDays: 150,
    maxDays: 275,
    biology:
      'Naps consolidate to 1.5h+ between 6–9m; 50% of 6m babies sleep 8h unfed, and almost all >6m full-term babies can sleep 10–12h (or until 4 a.m. snooze feed). Distracted daytime eating peaks at 6–8m.',
    rules: [
      'Nap Master Plan (after nights click, >=5–7 days): Naps 1 & 2 get 60-min crib attempt (>20m brief sleep = nap over; zero micro-dozes after failed nap; Nap 3 = 15–20m stroller/carrier rescue) (Ch. 10).',
      'Rough nap day? Move bedtime 30–60 min earlier (Ch. 10).',
      'Short-nap extension at 6+m (<=35m naps): Bore-to-Sleep (wait 15–30m in dark crib) OR Wake-to-Sleep (jostle 5–10m before wake for 5–7d) (Ch. 10).',
      'Drop 3 → 2 naps (6–9m) toward 2–3–4 schedule (~6:30a wake / ~9a N1 / ~1:30p N2 / ~7p bed).',
      'Deliberate Night Weaning (Ch. 9): drop 1 feed at a time picking whichever gives parents >=6h continuous sleep (-2 oz/night bottle or -1 min/side/night nursing down to 2–3m, then non-nursing partner 1–2m check).',
    ],
    avoid: [
      'Never feed distracted 6–8m babies in bright noisy rooms if night feeds spike—feed in dark quiet room right after naps (Ch. 9).',
    ],
  },
  {
    id: 'phase-6',
    title: 'Phase 6: Regressions, Standing & 1-Nap Drop',
    ageSpan: '9–18 Months',
    calendarWindow: 'Oct 2027 – Jun 2028',
    minDays: 275,
    maxDays: 548,
    biology:
      '8–10m, 12m, and 18m regressions (1–2 weeks each), pulling to stand, separation anxiety peaks (8–9m), night sleep compresses to ~11h (10–12h).',
    rules: [
      'Hard 1-Month Rule: weather 1–2w regressions without letting survival crutches persist past 1 month (Ch. 12).',
      'Standing in Crib: practice "plop on bum" 20x/day; cap any laydown check at <=1 min (Ch. 7 & 13).',
      '12-Month Fake-Out Guardrail: if Nap 2 is fought at 10–12m, cap Nap 1 at 1 hr before dropping to 1 nap (Ch. 10 & 12).',
      'True 2→1 Nap Drop (12–18m): 20+ min indoor wind-down, 5–6h wake windows, 1–3h midday nap ending ~3 p.m. (Table 1 & 7).',
      'Split Nights (1–2h happy awake at 2 a.m.): cut daily scheduled sleep by exact length of the night gap (Ch. 12).',
      'Ok to introduce a small safe lovey at 12+ months; optionally fade white noise after 1st birthday (Ch. 5 & 11).',
    ],
    avoid: [
      'Do not drop to 1 nap permanently at 11–12 months unless capping Nap 1 and stretching wake windows fails for 2+ weeks.',
    ],
  },
  {
    id: 'phase-7',
    title: 'Phase 7: Toddlerhood & Defending the Crib',
    ageSpan: '18 Months–3+ Years',
    calendarWindow: 'Jul 2028 – 2030+',
    minDays: 548,
    maxDays: 2000,
    biology:
      'Impulse control is immature (Marshmallow Test); limit testing surges at age 2; 32% of toddlers/preschoolers are sleep-deprived.',
    rules: [
      'Keep the crib until AFTER the 3rd birthday (ignore 1–2 flukes; use zip sleep sack to deter climbing) (Ch. 13).',
      'Switch from SWAP/SLIP at 18–24+m to Boundaries & Bait (3-day lunch briefing, 20–30m phone-free routine, 1–2 Bedtime Tickets, bedside water sippy) OR The Fade (2 ft → 4 ft → out in <=3–5 nights, staying in room all night) (Ch. 13).',
      'Rewards: immediate next-morning reward under age 3; 7-sticker chart at age 3+ (Ch. 13).',
      'Age 2 Nap Strikes: enforce the 1-Hour Rule daily in dark crib—almost all <3y kids still need 1 nap (Ch. 12). Drop nap at 3–5y → 1-hr Quiet Time + timer (Ch. 10).',
      'Age 2+ Reverse Alarm Clock: start +15m past natural wake, advance +15m every 3–4 days (stop if awake >15–20m) (Ch. 12).',
      'Nightmares/Fears: ALWAYS go to child’s room (never your bed), validate briefly, cue 5x belly breathing, NO "monster spray" (Ch. 13).',
    ],
    avoid: [
      'Never leave a mobile toddler <3 yrs unsupervised overnight in a room with a baby (Ch. 13).',
      'Report any non-cold habitual snoring or mouth breathing to your pediatrician (~2% sleep apnea) (Appendix).',
    ],
  },
];

export function getPhaseForAgeDays(totalDays: number): ChronologicalPhase {
  for (let i = CHRONOLOGICAL_PHASES.length - 1; i >= 0; i--) {
    const phase = CHRONOLOGICAL_PHASES[i];
    if (phase && totalDays >= phase.minDays && totalDays < phase.maxDays) {
      return phase;
    }
  }
  return totalDays < 0 ? CHRONOLOGICAL_PHASES[0]! : CHRONOLOGICAL_PHASES[CHRONOLOGICAL_PHASES.length - 1]!;
}

export interface SetbackCard {
  id: string;
  title: string;
  chapter: string;
  summary: string;
  steps: readonly string[];
}

export const SETBACK_CARDS: readonly SetbackCard[] = [
  {
    id: 'dst-spring',
    title: 'DST: Spring Forward (+1 hr)',
    chapter: 'Ch. 12',
    summary: 'Avoid the pre-bedtime "forbidden zone" by shifting slowly.',
    steps: [
      'Shift wake, naps, and bedtime 15 mins EARLIER per day across 4 days (wake child 15m early in the morning too).',
      'Pair with bright morning sunlight and dim all lights/screens 1 hr before bed.',
      'Skip shifting if baby currently wakes at 4–5 a.m. or goes to bed at 6 p.m.—let the clock fix it naturally.',
    ],
  },
  {
    id: 'dst-fall',
    title: 'DST: Fall Back (-1 hr)',
    chapter: 'Ch. 12',
    summary: 'Light + breakfast timing shifts the biological clock better than crying at 5 a.m.',
    steps: [
      'Give ~1 hr of bright outdoor/SAD light in the late afternoon/early evening.',
      'Keep mornings pitch-dark, quiet, and boring with ZERO food, screens, or bright light until AFTER target wake time.',
    ],
  },
  {
    id: 'travel',
    title: 'Travel & Time Zones',
    chapter: 'Ch. 12',
    summary: 'Circadian clocks shift ~1 hr per day (5 time zones = 5 days).',
    steps: [
      '1 time zone for < 1 week: stay on home clock time.',
      '2+ zones West: bright outdoor light during home late afternoon/early evening.',
      '2+ zones East: bright outdoor light during home early morning.',
      'Use stroller/carrier naps instead of skipping naps, protect independent bedtime, and reset firmly Night 1 home.',
    ],
  },
  {
    id: 'illness',
    title: 'Illness & Chronic Sleep Debt',
    chapter: 'Ch. 12',
    summary: 'Sleep debt spikes cortisol and deepens overtiredness.',
    steps: [
      'Rescue daytime naps via stroller walks or babywearing (keeps crib associations intact!).',
      'Move bedtime 30 mins earlier for 3–7 days until caught up.',
      'Hold your 1-month boundary: return strictly to independent rules once fever-free.',
    ],
  },
  {
    id: 'teething',
    title: 'Teething Myth-Buster (4m–3y, 20 teeth)',
    chapter: 'Appendix',
    summary: 'Studies show localized gum nuisance—NOT high fevers, diarrhea, or multi-week sleep collapse.',
    steps: [
      'Daytime: offer refrigerator-chilled (NEVER rock-hard frozen) washcloths or teethers.',
      'Night: ask your pediatrician about weight-dosed OTC pain medication if genuinely acutely uncomfortable.',
      'NEVER use OTC benzocaine teething gels or amber teething necklaces.',
    ],
  },
  {
    id: 'reflux',
    title: 'Reflux (GERD) vs. Happy Spitter',
    chapter: 'Appendix',
    summary: '95% of sleep issues are behavioral (~5% medical). 67% of 4m babies spit up daily without pain.',
    steps: [
      'Watch for clustered GERD clues: crying >> 3h/day, back arching, pain flat/in car seat, hungry → refuse → retry 2m later.',
      'Up to 50% of true reflux involves cow’s milk protein (casein/caseinate)—lactose-free still triggers it! Ask MD about a strict >= 2-week 100% dairy-protein-free trial.',
      'Hold upright 20–30 min post-feed; pacifier saliva naturally buffers acid.',
    ],
  },
];
