import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  CHRONOLOGICAL_PHASES,
  SETBACK_CARDS,
  TABLE_1_WAKE_BEFORE_BED,
  TABLE_2_MASTER_SCHEDULE,
  TABLE_6_NIGHT_FEEDS,
  WAKE_WINDOW_TARGETS,
  getFiveMinutePlanInterval,
  getPhaseForAgeDays,
} from '../data/plsPlaybook.ts';
import { getBabyAgeInfo } from '../lib/temporal.ts';
import type { BabySettings, InsightSeverity, PlsInsight } from '../types.ts';

interface PlaybookViewProps {
  insights: readonly PlsInsight[];
  optimalSlipBedtimeClock: string | null;
  settings: BabySettings;
  nowMs: number;
}

type SubTabId = 'coach' | 'guide' | 'timers';

function playSoftChime() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(528, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.35);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.1);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1.15);
  } catch {
    // Audio playback optional if blocked
  }
}

function formatCountdown(remainingSec: number): string {
  const s = Math.max(0, Math.ceil(remainingSec));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getSeverityLabel(sev: InsightSeverity): string {
  switch (sev) {
    case 'action':
      return 'ACTION';
    case 'watch':
      return 'WATCH';
    case 'good':
      return 'GOOD';
    case 'milestone':
      return 'NOTE';
  }
}

export function PlaybookView({
  insights,
  optimalSlipBedtimeClock,
  settings,
  nowMs,
}: PlaybookViewProps) {
  const [subTab, setSubTab] = useState<SubTabId>('coach');
  const age = useMemo(() => getBabyAgeInfo(settings, nowMs), [settings, nowMs]);
  const activePhase = useMemo(() => getPhaseForAgeDays(age.totalDays), [age.totalDays]);
  const [selectedPhaseId, setSelectedPhaseId] = useState<string>(activePhase.id);

  useEffect(() => {
    setSelectedPhaseId(activePhase.id);
  }, [activePhase.id]);

  const [timerLabel, setTimerLabel] = useState<string | null>(null);
  const [timerEndMs, setTimerEndMs] = useState<number | null>(null);
  const [timerRemainingSec, setTimerRemainingSec] = useState(0);
  const [slipNight, setSlipNight] = useState(1);
  const [slipVisit, setSlipVisit] = useState(1);
  const chimedRef = useRef(false);

  useEffect(() => {
    if (!timerEndMs) {
      setTimerRemainingSec(0);
      return;
    }
    const tick = () => {
      const rem = (timerEndMs - Date.now()) / 1000;
      if (rem <= 0) {
        setTimerRemainingSec(0);
        if (!chimedRef.current) {
          chimedRef.current = true;
          playSoftChime();
        }
      } else {
        setTimerRemainingSec(rem);
      }
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [timerEndMs]);

  const startTimer = (label: string, minutes: number) => {
    chimedRef.current = false;
    setTimerLabel(label);
    setTimerEndMs(Date.now() + minutes * 60_000);
  };

  const coachPanelRef = useRef<HTMLDivElement | null>(null);
  const guidePanelRef = useRef<HTMLDivElement | null>(null);
  const timersPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const entries: Array<[HTMLDivElement | null, SubTabId]> = [
      [coachPanelRef.current, 'coach'],
      [guidePanelRef.current, 'guide'],
      [timersPanelRef.current, 'timers'],
    ];
    const cleanups: Array<() => void> = [];
    for (const [el, id] of entries) {
      if (!el) continue;
      const handler = () => setSubTab(id);
      el.addEventListener('beforematch', handler);
      cleanups.push(() => el.removeEventListener('beforematch', handler));
    }
    return () => cleanups.forEach((fn) => fn());
  }, []);

  const baseId = useId();
  const coachTabId = `${baseId}-tab-coach`;
  const guideTabId = `${baseId}-tab-guide`;
  const timersTabId = `${baseId}-tab-timers`;

  const viewedPhase =
    CHRONOLOGICAL_PHASES.find((p) => p.id === selectedPhaseId) ?? activePhase;

  const slipNextMin = getFiveMinutePlanInterval(slipNight, slipVisit);

  return (
    <div className="tabs">
      <div
        {...({ focusgroup: 'tablist nomemory' } as Record<string, string>)}
        aria-label="PLS Coach and Playbook sections"
        className="tablist"
      >
        <button
          type="button"
          id={coachTabId}
          className="tab-btn"
          aria-selected={subTab === 'coach' ? 'true' : 'false'}
          {...(subTab === 'coach' ? { focusgroupstart: '' } : {})}
          onClick={() => setSubTab('coach')}
        >
          Coach
        </button>
        <button
          type="button"
          id={guideTabId}
          className="tab-btn"
          aria-selected={subTab === 'guide' ? 'true' : 'false'}
          {...(subTab === 'guide' ? { focusgroupstart: '' } : {})}
          onClick={() => setSubTab('guide')}
        >
          Playbook &amp; Tables
        </button>
        <button
          type="button"
          id={timersTabId}
          className="tab-btn"
          aria-selected={subTab === 'timers' ? 'true' : 'false'}
          {...(subTab === 'timers' ? { focusgroupstart: '' } : {})}
          onClick={() => setSubTab('timers')}
        >
          Timers
        </button>
      </div>

      {/* Tab Panel 1: Coach & Alerts */}
      <div
        ref={coachPanelRef}
        role="tabpanel"
        aria-labelledby={coachTabId}
        tabIndex={subTab === 'coach' ? 0 : undefined}
        {...(subTab === 'coach'
          ? {}
          : ({ hidden: 'until-found' } as Record<string, string>))}
      >
        <div className="tabpanel-inner">
          {optimalSlipBedtimeClock ? (
            <div className="banner">
              <div>
                <strong>Estimated Historical Asleep Time: {optimalSlipBedtimeClock}</strong>
                <div className="muted">
                  From real bedtime onsets (for Ch. 7 SLIP Night 1 put-down).
                </div>
              </div>
              <span className="tag">Ch. 7</span>
            </div>
          ) : null}

          {insights.map((ins) => (
            <article key={ins.id} className="box">
              <div className="box-head">
                <h3 className="box-title">{ins.title}</h3>
                <div className="chip-row" style={{ alignItems: 'center' }}>
                  <span
                    className={`tag ${ins.severity === 'action' || ins.severity === 'watch' ? 'inverted' : ''}`}
                  >
                    {getSeverityLabel(ins.severity)}
                  </span>
                  {ins.metricBadge ? <span className="tag">{ins.metricBadge}</span> : null}
                </div>
              </div>
              <p style={{ margin: 0, fontSize: '0.86rem' }}>{ins.detail}</p>
              <span className="muted">{ins.chapterRef}</span>
            </article>
          ))}
        </div>
      </div>

      {/* Tab Panel 2: Age Playbook & Verbatim Tables */}
      <div
        ref={guidePanelRef}
        role="tabpanel"
        aria-labelledby={guideTabId}
        tabIndex={subTab === 'guide' ? 0 : undefined}
        {...(subTab === 'guide'
          ? {}
          : ({ hidden: 'until-found' } as Record<string, string>))}
      >
        <div className="tabpanel-inner">
          <div className="box">
            <div className="field-group">
              <label className="field-label" htmlFor="phase-selector">
                Chronological Phase ({age.displayLabel})
              </label>
              <select
                id="phase-selector"
                className="input-control"
                value={viewedPhase.id}
                onChange={(e) => setSelectedPhaseId(e.target.value)}
              >
                {CHRONOLOGICAL_PHASES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({p.ageSpan}) · {p.calendarWindow}
                  </option>
                ))}
              </select>
            </div>

            <p className="muted" style={{ margin: 0 }}>
              <strong>Biology:</strong> {viewedPhase.biology}
            </p>

            <div>
              <strong style={{ fontSize: '0.84rem' }}>What To Do Now</strong>
              <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.15rem', fontSize: '0.84rem' }}>
                {viewedPhase.rules.map((r) => (
                  <li key={r} style={{ marginBottom: '0.28rem' }}>
                    {r}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <strong style={{ fontSize: '0.84rem' }}>What To Avoid</strong>
              <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.15rem', fontSize: '0.84rem' }}>
                {viewedPhase.avoid.map((a) => (
                  <li key={a} style={{ marginBottom: '0.28rem' }}>
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <section className="box">
            <h3 className="box-title">Table 7: Wake-Time Duration &amp; Naps (Ch. 10)</h3>
            <div className="table-wrap">
              <table className="pls-table">
                <thead>
                  <tr>
                    <th>Age</th>
                    <th>Wake Time</th>
                    <th>Nap Length</th>
                    <th>Naps/Day</th>
                  </tr>
                </thead>
                <tbody>
                  {WAKE_WINDOW_TARGETS.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.ageLabel}</strong>
                      </td>
                      <td>{row.wakeTimeLabel}</td>
                      <td>{row.napDurationLabel}</td>
                      <td>{row.napsPerDayLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="box">
            <h3 className="box-title">Table 2: Master Sleep Schedule (Ch. 5)</h3>
            <div className="table-wrap">
              <table className="pls-table">
                <thead>
                  <tr>
                    <th>Age</th>
                    <th>Before Bed</th>
                    <th>Bedtime</th>
                    <th>Night</th>
                    <th>24h Total</th>
                  </tr>
                </thead>
                <tbody>
                  {TABLE_2_MASTER_SCHEDULE.map((row) => (
                    <tr key={row.age}>
                      <td>
                        <strong>{row.age}</strong>
                      </td>
                      <td>{row.beforeBed}</td>
                      <td>{row.bedtime}</td>
                      <td>{row.nightSleep}h</td>
                      <td>{row.totalDaily}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <details className="box">
            <summary style={{ fontWeight: 700, cursor: 'pointer' }}>
              Table 1 (Pre-Bed Wake) &amp; Table 6 (Night Feed Reference)
            </summary>
            <div className="table-wrap" style={{ marginTop: '0.65rem' }}>
              <table className="pls-table">
                <thead>
                  <tr>
                    <th>Age</th>
                    <th>Hrs Awake Pre-Bed</th>
                    <th>Last Nap Ends (@7p)</th>
                    <th>Avg Bedtime</th>
                  </tr>
                </thead>
                <tbody>
                  {TABLE_1_WAKE_BEFORE_BED.map((r) => (
                    <tr key={r.age}>
                      <td>
                        <strong>{r.age}</strong>
                      </td>
                      <td>{r.hoursAwakeBeforeBed}</td>
                      <td>{r.lastNapEnds}</td>
                      <td>{r.avgBedtime}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-wrap" style={{ marginTop: '0.75rem' }}>
              <table className="pls-table">
                <thead>
                  <tr>
                    <th>Age</th>
                    <th>Low Night Feeds</th>
                    <th>Average</th>
                    <th>High</th>
                  </tr>
                </thead>
                <tbody>
                  {TABLE_6_NIGHT_FEEDS.map((r) => (
                    <tr key={r.age}>
                      <td>
                        <strong>{r.age}</strong>
                      </td>
                      <td>{r.low}</td>
                      <td>{r.average}</td>
                      <td>{r.high}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <section className="box">
            <h3 className="box-title">Rapid Setback &amp; Medical Playbook (Ch. 12 &amp; Appendix)</h3>
            {SETBACK_CARDS.map((card) => (
              <details
                key={card.id}
                style={{ borderTop: '1px solid var(--rule)', paddingTop: '0.55rem' }}
              >
                <summary style={{ fontWeight: 700, cursor: 'pointer', fontSize: '0.88rem' }}>
                  {card.title} <span className="muted">({card.chapter})</span>
                </summary>
                <p className="muted" style={{ margin: '0.35rem 0' }}>
                  {card.summary}
                </p>
                <ul style={{ margin: 0, paddingLeft: '1.15rem', fontSize: '0.84rem' }}>
                  {card.steps.map((s) => (
                    <li key={s} style={{ marginBottom: '0.2rem' }}>
                      {s}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </section>
        </div>
      </div>

      {/* Tab Panel 3: Book Timers */}
      <div
        ref={timersPanelRef}
        role="tabpanel"
        aria-labelledby={timersTabId}
        tabIndex={subTab === 'timers' ? 0 : undefined}
        {...(subTab === 'timers'
          ? {}
          : ({ hidden: 'until-found' } as Record<string, string>))}
      >
        <div className="tabpanel-inner">
          <section className="box">
            <div className="box-head">
              <h3 className="box-title">{timerLabel ?? 'PLS Book Timer'}</h3>
              {timerEndMs ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setTimerEndMs(null);
                    setTimerLabel(null);
                  }}
                >
                  Clear
                </button>
              ) : null}
            </div>

            <div className="timer-display">
              {timerEndMs ? formatCountdown(timerRemainingSec) : '00:00'}
            </div>

            {timerEndMs && timerRemainingSec === 0 ? (
              <div className="banner">
                <strong>Timer Complete</strong>
                <span className="muted">Check monitor and apply your PLS rule.</span>
              </div>
            ) : null}

            <div className="chip-row">
              <button
                type="button"
                className="btn primary"
                onClick={() => startTimer('FIO Experiment (Ch. 6)', 15)}
              >
                FIO 15m
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => startTimer('FIO Experiment (Ch. 6)', 20)}
              >
                FIO 20m
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => startTimer('Overnight Pause Rule (Ch. 8)', 10)}
              >
                10m Night Pause
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => startTimer('Newborn Night Party (Ch. 2)', 20)}
              >
                20m Night Party
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => startTimer('Failed Bedtime Attempt (Ch. 3)', 30)}
              >
                30m Bedtime Cap
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => startTimer('Nap Hour (Ch. 10)', 60)}
              >
                60m Nap Hour
              </button>
            </div>
          </section>

          <section className="box">
            <h3 className="box-title">SLIP 5-Minute Plan Stepper (Table 5, Ch. 7)</h3>
            <p className="muted" style={{ margin: 0 }}>
              Author favors Full Extinction, or use check-ins (&le;1–2m, hands-off voice only). Never
              switch Full Extinction → Check-ins.
            </p>
            <div className="row-between">
              <div className="field-group" style={{ minWidth: '8.75rem' }}>
                <label className="field-label" htmlFor="slip-night-select">
                  SLIP Night
                </label>
                <select
                  id="slip-night-select"
                  className="input-control"
                  value={slipNight}
                  onChange={(e) => {
                    setSlipNight(Number(e.target.value));
                    setSlipVisit(1);
                  }}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      Night {n}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  startTimer(`SLIP Night ${slipNight} · Visit ${slipVisit}`, slipNextMin);
                  setSlipVisit((v) => v + 1);
                }}
              >
                Start Visit #{slipVisit} ({slipNextMin}m)
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
