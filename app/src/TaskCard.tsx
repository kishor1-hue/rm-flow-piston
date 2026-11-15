import { JOURNEYS, PERSONAS, type FieldDef } from './model';
import { ageHours, availableNext, canMove, fmtAge, HOUR, slaState, stageDef, type Order, type Task } from './engine';

export { Field };
export function sampleValue(fd: FieldDef): string | boolean {
  if (fd.type === 'check') return true;
  if (fd.type === 'select') return fd.options![0];
  if (fd.type === 'date') return new Date(Date.now() + 2 * 24 * HOUR).toISOString().slice(0, 10);
  if (fd.type === 'number') return '48390';
  if (fd.key === 'rwcNumber') return 'RW-' + Math.floor(2200000 + Math.random() * 99999);
  if (fd.key === 'regoNumber') return Math.floor(100 + Math.random() * 899) + ' ' + 'KLM';
  if (fd.key === 'envelope') return 'DS-' + Math.floor(88000 + Math.random() * 999);
  return 'Done — see notes';
}

function Field({ fd, value, editable, onChange }: { fd: FieldDef; value: string | boolean | undefined; editable: boolean; onChange: (v: string | boolean) => void }) {
  const isNew = fd.hs === 'NEW';
  const label = (
    <label>
      {fd.label}
      {isNew && <span className="new">NEW FIELD</span>}
    </label>
  );
  if (!editable)
    return (
      <div className="fld">
        {label}
        <div className="ro">{value === true ? 'Yes' : value || <span style={{ color: '#b0b7c6' }}>Pending</span>}</div>
      </div>
    );
  if (fd.type === 'check')
    return (
      <div className="fld">
        <label className="check">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {fd.label}
        </label>
      </div>
    );
  return (
    <div className="fld" style={fd.type === 'textarea' ? { gridColumn: '1 / -1' } : undefined}>
      {label}
      {fd.type === 'select' ? (
        <select value={(value as string) || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {fd.options!.map((o) => <option key={o}>{o}</option>)}
        </select>
      ) : fd.type === 'textarea' ? (
        <textarea value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input type={fd.type} value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} />
      )}
      {fd.hint && <div className="hs" style={{ marginTop: 3 }}>{fd.hint}</div>}
    </div>
  );
}

export function TaskCard({ order, t, editable, now, onField, onMove, compact, demo }: {
  order: Order; t: Task; editable: boolean; now: number; compact?: boolean; demo?: boolean;
  onField: (k: string, v: string | boolean) => void; onMove: (to: string) => void;
}) {
  const def = JOURNEYS[t.journey];
  const s = stageDef(t);
  const sla = slaState(t, now);
  const idx = def.stages.findIndex((x) => x.key === t.stage);
  const shownStages = def.stages.filter((x) => x.kind !== 'fail' || x.key === t.stage);
  const fields = s.fields || [];
  const nexts = availableNext(order, t);
  const missing = (req?: string[]) => (req || []).filter((k) => t.fields[k] === undefined || t.fields[k] === '' || t.fields[k] === false);
  const p = PERSONAS[def.persona];

  return (
    <div className={'task' + (editable ? ' mine' : '')}>
      {!compact && (
        <div className="th">
          <span className="who" style={{ background: p.color }} />
          <span className="tn">{def.name}{t.item ? ' · ' + t.item : ''}</span>
          <span className={'chip ' + (s.kind === 'done' ? 'c-green' : s.kind === 'fail' ? 'c-red' : 'c-lv')}>{s.label}</span>
          {sla === 'breach' && <span className="chip c-red">SLA breached</span>}
          {sla === 'warn' && <span className="chip c-amber">SLA due soon</span>}
          {t.journey === 'vas' && <span className="chip c-grey">Doesn't block slot</span>}
          <span className="lock">{editable ? 'You own this' : `Read-only · ${p.short}`}</span>
        </div>
      )}
      {!compact && (
        <div className="steps">
          {shownStages.map((x) => {
            const i = def.stages.indexOf(x);
            const cls = x.key === t.stage ? (x.kind === 'fail' ? 'fail' : s.kind === 'done' ? 'done' : 'act') : i < idx && x.kind !== 'fail' ? 'done' : '';
            return <span key={x.key} className={'stepdot ' + cls}>{x.label}</span>;
          })}
        </div>
      )}
      {!compact && (
        <div className="statusline">
          In <b>{s.label}</b> for {fmtAge(now - t.enteredAt)}
          {s.slaHours ? <> · SLA {s.slaHours}h{s.slaText ? ` (${s.slaText})` : ''}</> : null}
          <div className="hs" style={{ marginTop: 3 }}>{def.hsPipeline} → {s.hs}</div>
        </div>
      )}
      {fields.length > 0 && (
        <div className="fields">
          {fields.map((fd) => <Field key={fd.key} fd={fd} value={t.fields[fd.key]} editable={editable} onChange={(v) => onField(fd.key, v)} />)}
        </div>
      )}
      {editable && nexts.length > 0 && (
        <div className="acts">
          {nexts.map((n) => {
            const miss = missing(n.requires);
            const chk = canMove(order, t, n.to);
            return (
              <button key={n.label} className={'btn ' + (compact ? 'sm ' : '') + (n.tone || '')} disabled={miss.length > 0}
                title={miss.length ? 'Fill: ' + miss.map((k) => fields.find((x) => x.key === k)?.label).join(', ') : !chk.ok ? chk.reason : ''}
                onClick={(e) => { e.stopPropagation(); onMove(n.to); }}>
                {n.label}
              </button>
            );
          })}
        </div>
      )}
      {editable && nexts.some((n) => !canMove(order, t, n.to).ok) && (
        <div className="blocked">{nexts.map((n) => canMove(order, t, n.to).reason).find(Boolean)}</div>
      )}
      {demo && !editable && s.next && (
        <div className="acts">
          <button className="btn sm demo" onClick={() => onMove(s.next![0].to)}>Demo: act as {p.short} → {s.next[0].label}</button>
        </div>
      )}
      {!compact && editable && <div className="why">{def.why}</div>}
      {compact && <div className="age" style={{ marginTop: 6 }}>{Math.round(ageHours(t, now))}h in stage</div>}
    </div>
  );
}
