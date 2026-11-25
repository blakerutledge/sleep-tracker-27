import { useEffect, useState } from 'react';
import {
  epochToLocalDateTimeInput,
  formatClockTime,
  formatMinutesHuman,
  localDateTimeInputToEpoch,
} from '../lib/temporal.ts';
import type { SleepEvent, SleepEventType, SleepSegment } from '../types.ts';
import { ModalDialog } from './ModalDialog.tsx';

interface EventEditDialogProps {
  open: boolean;
  onClose: () => void;
  editingEvent: SleepEvent | null;
  inspectingSegment: SleepSegment | null;
  timeZone?: string;
  onSaveEvent: (id: string, patch: Partial<Omit<SleepEvent, 'id'>>) => Promise<void>;
  onDeleteEvent: (id: string) => Promise<void>;
  onMaterializeBoundary: (type: SleepEventType, timestamp: number, comment?: string) => Promise<void>;
}

export function EventEditDialog({
  open,
  onClose,
  editingEvent,
  inspectingSegment,
  timeZone,
  onSaveEvent,
  onDeleteEvent,
  onMaterializeBoundary,
}: EventEditDialogProps) {
  const [type, setType] = useState<SleepEventType>('asleep');
  const [dateTimeVal, setDateTimeVal] = useState('');
  const [comment, setComment] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setConfirmDelete(false);
    if (editingEvent) {
      setType(editingEvent.type);
      setDateTimeVal(epochToLocalDateTimeInput(editingEvent.timestamp, timeZone));
      setComment(editingEvent.comment ?? '');
    } else if (inspectingSegment?.inferredBoundaryMs && inspectingSegment.inferredBoundaryType) {
      setType(inspectingSegment.inferredBoundaryType);
      setDateTimeVal(epochToLocalDateTimeInput(inspectingSegment.inferredBoundaryMs, timeZone));
      setComment('');
    }
  }, [editingEvent, inspectingSegment, timeZone, open]);

  const nudgeMinutes = (deltaMin: number) => {
    const currentMs = localDateTimeInputToEpoch(dateTimeVal, timeZone);
    if (currentMs === null) return;
    setDateTimeVal(epochToLocalDateTimeInput(currentMs + deltaMin * 60_000, timeZone));
  };

  if (inspectingSegment && !editingEvent) {
    const hasInferred =
      inspectingSegment.inferredBoundaryType !== undefined &&
      inspectingSegment.inferredBoundaryMs !== undefined;
    return (
      <ModalDialog open={open} onClose={onClose} title="Interpolated Sleep Span">
        <div className="banner">
          <div>
            <strong>Estimated ({formatMinutesHuman(inspectingSegment.durationMin)})</strong>
            <div className="muted">
              {formatClockTime(inspectingSegment.startMs, timeZone)} →{' '}
              {formatClockTime(inspectingSegment.endMs, timeZone)}
            </div>
          </div>
          <span className="tag">Hatched</span>
        </div>

        <p className="muted" style={{ margin: 0 }}>
          {inspectingSegment.interpolationReason ??
            'Bridged automatically from surrounding taps so graphs stay continuous.'}
        </p>

        {hasInferred ? (
          <>
            <div className="field-group">
              <label className="field-label" htmlFor="interp-type-select">
                Missing Transition To Confirm
              </label>
              <select
                id="interp-type-select"
                className="input-control"
                value={type}
                onChange={(e) => setType(e.target.value as SleepEventType)}
              >
                <option value="awake">Wake</option>
                <option value="asleep">Sleep</option>
              </select>
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="interp-dt-input">
                Estimated Time (Adjust if known)
              </label>
              <input
                id="interp-dt-input"
                type="datetime-local"
                className="input-control"
                value={dateTimeVal}
                onChange={(e) => setDateTimeVal(e.target.value)}
                required
              />
              <div className="chip-row">
                {[-15, -5, 5, 15].map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="chip-btn"
                    onClick={() => nudgeMinutes(m)}
                  >
                    {m > 0 ? `+${m}m` : `${m}m`}
                  </button>
                ))}
              </div>
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="interp-comment">
                Optional Note
              </label>
              <textarea
                id="interp-comment"
                className="input-control"
                placeholder="e.g. Confirmed from monitor history"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>

            <div className="row-between">
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={async () => {
                  const ts = localDateTimeInputToEpoch(dateTimeVal, timeZone);
                  if (ts === null) return;
                  await onMaterializeBoundary(type, ts, comment);
                  onClose();
                }}
              >
                Confirm as Real Event
              </button>
            </div>
          </>
        ) : (
          <div className="row-between">
            <span className="muted">
              Excluded from real averages while &ldquo;Include Interpolated&rdquo; is off.
            </span>
            <button type="button" className="btn primary" onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </ModalDialog>
    );
  }

  return (
    <ModalDialog open={open} onClose={onClose} title="Edit Event">
      {editingEvent ? (
        <>
          <div className="field-group">
            <label className="field-label" htmlFor="edit-type-select">
              Transition Type
            </label>
            <select
              id="edit-type-select"
              className="input-control"
              value={type}
              onChange={(e) => setType(e.target.value as SleepEventType)}
            >
              <option value="asleep">Sleep</option>
              <option value="awake">Wake</option>
            </select>
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="edit-dt-input">
              Timestamp
            </label>
            <input
              id="edit-dt-input"
              type="datetime-local"
              className="input-control"
              value={dateTimeVal}
              onChange={(e) => setDateTimeVal(e.target.value)}
              required
            />
            <div className="chip-row">
              {[-30, -15, -5, 5, 15, 30].map((m) => (
                <button
                  key={m}
                  type="button"
                  className="chip-btn"
                  onClick={() => nudgeMinutes(m)}
                >
                  {m > 0 ? `+${m}m` : `${m}m`}
                </button>
              ))}
            </div>
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="edit-comment-box">
              Comment
            </label>
            <textarea
              id="edit-comment-box"
              className="input-control"
              placeholder="Optional note (e.g., car nap, false start, fussy)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>

          <div className="row-between">
            {confirmDelete ? (
              <div className="chip-row">
                <button
                  type="button"
                  className="btn primary"
                  onClick={async () => {
                    await onDeleteEvent(editingEvent.id);
                    onClose();
                  }}
                >
                  Confirm Delete
                </button>
                <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                  Keep
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn"
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </button>
            )}
            <div className="chip-row">
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={async () => {
                  const ts = localDateTimeInputToEpoch(dateTimeVal, timeZone);
                  if (ts === null) return;
                  await onSaveEvent(editingEvent.id, {
                    type,
                    timestamp: ts,
                    comment,
                  });
                  onClose();
                }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </>
      ) : null}
    </ModalDialog>
  );
}
