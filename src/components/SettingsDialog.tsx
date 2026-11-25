import type { User } from 'firebase/auth';
import { useState } from 'react';
import { ALLOWED_EMAILS } from '../lib/firebase.ts';
import type { BabySettings } from '../types.ts';
import { ModalDialog } from './ModalDialog.tsx';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  settings: BabySettings;
  authUser: User | null;
  syncMode: 'cloud' | 'local';
  eventsCount: number;
  onUpdateSettings: (patch: Partial<BabySettings>) => Promise<void>;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onLoadDemo: () => Promise<void>;
  onResetClean: () => Promise<void>;
  onExportJson: () => string;
}

export function SettingsDialog({
  open,
  onClose,
  settings,
  authUser,
  syncMode,
  eventsCount,
  onUpdateSettings,
  onSignIn,
  onSignOut,
  onLoadDemo,
  onResetClean,
  onExportJson,
}: SettingsDialogProps) {
  const [confirmReset, setConfirmReset] = useState(false);

  const handleDownloadJson = () => {
    const json = onExportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sleep-tracker-27-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ModalDialog open={open} onClose={onClose} title="Setup & Sync">
      {/* Firebase Auth / Sync Box */}
      <section className="box">
        <div className="row-between">
          <div>
            <strong>{syncMode === 'cloud' ? 'Cloud Live Sync Active' : 'Local Device Mode'}</strong>
            <div className="muted">
              {authUser
                ? `Signed in as ${authUser.email}`
                : 'Sign in with Google to sync live between Blake & Aliyana.'}
            </div>
          </div>
          {authUser ? (
            <button type="button" className="btn" onClick={onSignOut}>
              Sign Out
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={onSignIn}>
              Google Sign-In
            </button>
          )}
        </div>
        <div className="muted" style={{ fontSize: '0.74rem' }}>
          Allowlist: {ALLOWED_EMAILS.join(' · ')}
        </div>
      </section>

      {/* Baby Profile */}
      <div className="field-group">
        <label className="field-label" htmlFor="set-baby-name">
          Baby Name
        </label>
        <input
          id="set-baby-name"
          type="text"
          className="input-control"
          value={settings.babyName}
          onChange={(e) => onUpdateSettings({ babyName: e.target.value })}
        />
      </div>

      <div className="two-col">
        <div className="field-group">
          <label className="field-label" htmlFor="set-birth-date">
            Due / Birth Date
          </label>
          <input
            id="set-birth-date"
            type="date"
            className="input-control"
            value={settings.birthDate}
            onChange={(e) =>
              onUpdateSettings({ birthDate: e.target.value || '2027-01-01', isDemoMode: false })
            }
          />
        </div>

        <div className="field-group">
          <label className="field-label" htmlFor="set-adj-date">
            Adjusted Date (Optional)
          </label>
          <input
            id="set-adj-date"
            type="date"
            className="input-control"
            value={settings.adjustedBirthDate ?? ''}
            onChange={(e) =>
              onUpdateSettings({ adjustedBirthDate: e.target.value || undefined })
            }
          />
        </div>
      </div>

      <div className="two-col">
        <div className="field-group">
          <label className="field-label" htmlFor="set-day-start">
            Sleep-Day Anchor
          </label>
          <select
            id="set-day-start"
            className="input-control"
            value={settings.dayStartHour}
            onChange={(e) => onUpdateSettings({ dayStartHour: Number(e.target.value) })}
          >
            {[5, 6, 7, 8, 9, 10].map((h) => (
              <option key={h} value={h}>
                {h}:00 AM → {h}:00 AM
              </option>
            ))}
          </select>
        </div>

        <div className="field-group">
          <label className="field-label" htmlFor="set-night-start">
            Night Zone Starts
          </label>
          <select
            id="set-night-start"
            className="input-control"
            value={settings.nightStartHour}
            onChange={(e) => onUpdateSettings({ nightStartHour: Number(e.target.value) })}
          >
            {[17, 18, 19, 20, 21, 22].map((h) => (
              <option key={h} value={h}>
                {h - 12}:00 PM
              </option>
            ))}
          </select>
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', fontSize: '0.84rem' }}>
        <input
          type="checkbox"
          checked={settings.includeInterpolatedInStats}
          onChange={(e) => onUpdateSettings({ includeInterpolatedInStats: e.target.checked })}
        />
        <span>Include hatched interpolated spans in multi-day averages</span>
      </label>

      {/* Demo / Backup / Clean Slate */}
      <section className="box">
        <div className="box-head">
          <h3 className="box-title">Demo &amp; Backup</h3>
          <span className="muted">{eventsCount} events</span>
        </div>
        <div className="chip-row">
          <button
            type="button"
            className="btn"
            onClick={async () => {
              await onLoadDemo();
              onClose();
            }}
          >
            Load 14-Day Sample Data
          </button>
          <button type="button" className="btn" onClick={handleDownloadJson}>
            Export JSON
          </button>
        </div>
        {confirmReset ? (
          <div className="chip-row">
            <button
              type="button"
              className="btn primary"
              onClick={async () => {
                await onResetClean();
                setConfirmReset(false);
                onClose();
              }}
            >
              Confirm Wipe &amp; Restore 2027-01-01
            </button>
            <button type="button" className="btn" onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={() => setConfirmReset(true)}
            style={{ width: 'fit-content' }}
          >
            Reset to Clean Jan 1, 2027 Slate
          </button>
        )}
      </section>
    </ModalDialog>
  );
}
