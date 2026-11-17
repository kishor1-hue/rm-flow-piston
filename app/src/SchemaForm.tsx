// Renders a form-builder page schema (fields, blocks, AND-ed visible/required conditions) the way LeadVerse would.
// Supports the field types the sales-promise checklist uses: select, checkbox (multi), textarea, file_upload.

export type FormValue = string | string[];
export type FormValues = Record<string, FormValue>;

interface Cond { fieldId: string; id: string; operator: 'equals' | 'contains'; value: string }
export interface SchemaField {
  id: string; field_key: string; label: string; type: string; placeholder?: string; helperText?: string; required: boolean;
  options: { label: string; value: string }[];
  conditions: { visible: Cond[]; required: Cond[]; disabled: Cond[] };
  errorMessages: { required?: string };
}
export interface SchemaPage {
  id: string; title: string; blocks: { fieldId: string; id: string }[]; fields: SchemaField[];
  navigation: { next: { text: string; apiSourceId?: string }; previous?: { text: string } };
}

const test = (c: Cond, vals: FormValues) => {
  const v = vals[c.fieldId];
  if (c.operator === 'equals') return v === c.value;
  return Array.isArray(v) ? v.includes(c.value) : typeof v === 'string' && v.includes(c.value);
};
// meta.fieldConditionLogicOperator is AND: every condition in a list must hold.
const all = (cs: Cond[], vals: FormValues) => cs.every((c) => test(c, vals));
export const isVisible = (f: SchemaField, vals: FormValues) => all(f.conditions.visible, vals);
export const isRequired = (f: SchemaField, vals: FormValues) => f.required || (f.conditions.required.length > 0 && all(f.conditions.required, vals));
const empty = (v?: FormValue) => v == null || (Array.isArray(v) ? v.length === 0 : v.trim() === '');

export function validate(page: SchemaPage, vals: FormValues): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const f of page.fields) if (isVisible(f, vals) && isRequired(f, vals) && empty(vals[f.id])) errs[f.id] = f.errorMessages.required || 'Required';
  return errs;
}
// Submit payload: only the fields a user could see; hidden ones are dropped.
export function payload(page: SchemaPage, vals: FormValues): FormValues {
  const out: FormValues = {};
  for (const f of page.fields) if (isVisible(f, vals) && !empty(vals[f.id])) out[f.field_key] = vals[f.id];
  return out;
}

function FieldInput({ f, value, onChange, error }: { f: SchemaField; value?: FormValue; onChange: (v: FormValue) => void; error?: string }) {
  if (f.type === 'select') {
    return (
      <div className="tf-sel"><select value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} className={error ? 'bad' : ''}>
        <option value="">{f.placeholder || 'Select'}</option>
        {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select></div>
    );
  }
  if (f.type === 'checkbox') {
    const sel = (value as string[]) || [];
    return (
      <div className="sf-checks">
        {f.options.map((o) => {
          const on = sel.includes(o.value);
          return (
            <label key={o.value} className={'sf-check' + (on ? ' on' : '')}>
              <input type="checkbox" checked={on} onChange={() => onChange(on ? sel.filter((x) => x !== o.value) : [...sel, o.value])} />
              <span>{o.label}</span>
            </label>
          );
        })}
      </div>
    );
  }
  if (f.type === 'textarea') {
    return <textarea className={'tf-in sf-ta' + (error ? ' bad' : '')} placeholder={f.placeholder} value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} />;
  }
  if (f.type === 'file_upload') {
    // Prototype: the presigned PUT is simulated; we keep the file name as the uploaded document.
    const name = value as string | undefined;
    return (
      <div className={'sf-up' + (name ? ' done' : '')}>
        <div className="sf-up-t">
          <div><b>{f.label}</b><span className={'sf-badge' + (name ? ' ok' : '')}>{name ? 'Uploaded' : 'Pending'}</span></div>
          <small>{name ? name : f.helperText}</small>
        </div>
        <label className="sf-up-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 15V4M7 9l5-5 5 5M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" /></svg>
          {name ? 'Replace' : 'Upload'}
          <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => { const fl = e.target.files?.[0]; if (fl) onChange(fl.name); }} />
        </label>
      </div>
    );
  }
  return <input className="tf-in" value={(value as string) || ''} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
}

export function SchemaForm({ page, values, onChange, showErrors }: { page: SchemaPage; values: FormValues; onChange: (id: string, v: FormValue) => void; showErrors: boolean }) {
  const byId = new Map(page.fields.map((f) => [f.id, f]));
  const errs = showErrors ? validate(page, values) : {};
  const ordered = page.blocks.map((b) => byId.get(b.fieldId)!).filter(Boolean);
  // Group each checkbox category with its own remark / upload fields.
  const groups: SchemaField[][] = [];
  for (const f of ordered) {
    const last = groups[groups.length - 1];
    if (last && last[0].type === 'checkbox' && f.id.startsWith(last[0].id + '_')) last.push(f);
    else groups.push([f]);
  }
  const field = (f: SchemaField) => !isVisible(f, values) ? null : (
    <div key={f.id} className="sf-field">
      {f.type !== 'file_upload' && <label className="sf-label">{f.label}{isRequired(f, values) && <i className="req"> *</i>}</label>}
      <FieldInput f={f} value={values[f.id]} onChange={(v) => onChange(f.id, v)} error={errs[f.id]} />
      {errs[f.id] && <div className="dc-err">{errs[f.id]}</div>}
    </div>
  );
  return (
    <div className="sf">
      {groups.map((g) => g[0].type !== 'checkbox' ? g.map(field) : !isVisible(g[0], values) ? null : (
        <div key={g[0].id} className="sf-group">{g.map(field)}</div>
      ))}
    </div>
  );
}
