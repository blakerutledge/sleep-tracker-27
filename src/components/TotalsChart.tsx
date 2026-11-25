import { getWakeWindowTargetForAgeDays } from '../data/plsPlaybook.ts';
import { formatMinutesHuman, formatShortDate, getBabyAgeInfo } from '../lib/temporal.ts';
import type { BabySettings, DaySummary } from '../types.ts';

interface TotalsChartProps {
  days: readonly DaySummary[];
  settings: BabySettings;
  nowMs: number;
}

export function TotalsChart({ days, settings, nowMs }: TotalsChartProps) {
  const age = getBabyAgeInfo(settings, nowMs);
  const target = getWakeWindowTargetForAgeDays(Math.max(0, age.totalDays));
  const maxHrs = 18;
  const chartW = 580;
  const chartH = 172;
  const leftPad = 36;
  const bottomPad = 24;
  const topPad = 14;
  const plotW = chartW - leftPad - 12;
  const plotH = chartH - topPad - bottomPad;

  const targetTopY = topPad + (1 - target.totalSleepMaxHrs / maxHrs) * plotH;
  const targetBotY = topPad + (1 - target.totalSleepMinHrs / maxHrs) * plotH;

  const slotW = plotW / Math.max(1, days.length);
  const barW = Math.min(26, Math.max(6, slotW * 0.64));

  return (
    <div className="chart-scroll">
      <svg
        viewBox={`0 0 ${chartW} ${chartH}`}
        role="img"
        aria-label="Daily total sleep bar chart compared to PLS target range"
        style={{ width: '100%', minWidth: '400px', height: 'auto', display: 'block' }}
      >
        {[0, 6, 12, 18].map((h) => {
          const y = topPad + (1 - h / maxHrs) * plotH;
          return (
            <g key={h}>
              <line
                x1={leftPad}
                y1={y}
                x2={leftPad + plotW}
                y2={y}
                stroke="#ffffff"
                strokeOpacity="0.2"
                strokeWidth="1"
              />
              <text
                x={leftPad - 5}
                y={y + 3.5}
                textAnchor="end"
                fill="#ffffff"
                fillOpacity="0.7"
                fontSize="10"
              >
                {h}h
              </text>
            </g>
          );
        })}

        {/* PLS Table 2 min/max target band lines */}
        <line
          x1={leftPad}
          y1={targetTopY}
          x2={leftPad + plotW}
          y2={targetTopY}
          stroke="#ffffff"
          strokeOpacity="0.6"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        <line
          x1={leftPad}
          y1={targetBotY}
          x2={leftPad + plotW}
          y2={targetBotY}
          stroke="#ffffff"
          strokeOpacity="0.6"
          strokeWidth="1"
          strokeDasharray="4 4"
        />

        {days.map((d, idx) => {
          const cx = leftPad + idx * slotW + slotW / 2;
          const x = cx - barW / 2;
          const nightHrs = Math.min(maxHrs, d.totalNightSleepMin / 60);
          const dayHrs = Math.min(maxHrs - nightHrs, d.totalDaySleepMin / 60);
          const nightH = (nightHrs / maxHrs) * plotH;
          const dayH = (dayHrs / maxHrs) * plotH;
          const nightY = topPad + plotH - nightH;
          const dayY = nightY - dayH;

          return (
            <g key={d.sleepDayKey}>
              <title>
                {formatShortDate(d.sleepDayKey)}: Night {formatMinutesHuman(d.totalNightSleepMin)} +
                Naps {formatMinutesHuman(d.totalDaySleepMin)} ={' '}
                {formatMinutesHuman(d.total24hSleepMin)}
              </title>
              {nightH > 0 ? (
                <rect
                  x={x}
                  y={nightY}
                  width={barW}
                  height={nightH}
                  fill="#ffffff"
                  fillOpacity={d.hasRealData ? 1 : 0.3}
                />
              ) : null}
              {dayH > 0 ? (
                <rect
                  x={x}
                  y={dayY}
                  width={barW}
                  height={dayH}
                  fill="#000000"
                  stroke="#ffffff"
                  strokeOpacity={d.hasRealData ? 1 : 0.45}
                  strokeWidth="1.5"
                />
              ) : null}
              {days.length <= 10 || idx % Math.ceil(days.length / 7) === 0 ? (
                <text
                  x={cx}
                  y={chartH - 6}
                  textAnchor="middle"
                  fill="#ffffff"
                  fillOpacity="0.72"
                  fontSize="9.5"
                >
                  {formatShortDate(d.sleepDayKey).split(' ')[1] ?? d.sleepDayKey.slice(5)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
