// Turbo UI (the CARS24 DLS, @cspl/*) as React markup for this prototype. Each component mirrors one @cspl package:
// same structure, states and prop names, styled by dls.css (ported from turbo-ui's styles.ts). Only the RM screen's
// middle action area uses it: wrap that area in <Dls>.
import type { ReactNode } from 'react';
import './dls.css';

export type BadgeVariant = 'neutral' | 'information' | 'success' | 'warning' | 'error';

export const Icon = ({ name, size = 'base' }: { name: string; size?: 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' }) => (
  <i className={`tui tui-${name} icon-${size}`} aria-hidden="true" />
);

export const Dls = ({ children, className = '' }: { children: ReactNode; className?: string }) => <div className={'dls ' + className}>{children}</div>;
export const Stack = ({ children }: { children: ReactNode }) => <div className="tu-stack">{children}</div>;

// @cspl/badge, appearance subtle
export const Badge = ({ children, variant = 'neutral', size = 'xs', icon }: { children: ReactNode; variant?: BadgeVariant; size?: 'xs' | 's'; icon?: string }) => (
  <span className={`tu-badge ${variant}${size === 's' ? ' s' : ''}`}>{icon && <Icon name={icon} size="xs" />}{children}</span>
);

// @cspl/section-card, framed. The badge sits right of the title
export function SectionCard({ title, subtitle, badge, right, children, framed = true, part }: {
  title: ReactNode; subtitle?: ReactNode; badge?: { label: ReactNode; variant: BadgeVariant }; right?: ReactNode; children?: ReactNode; framed?: boolean; part?: string;
}) {
  return (
    <section className={'tu-sec' + (framed ? ' framed' : '')} data-part={part}>
      <div className="hd">
        <div className="tx"><h4>{title}</h4>{subtitle && <p>{subtitle}</p>}</div>
        {(badge || right) && <div className="tu-hd-r">{right}{badge && <Badge variant={badge.variant}>{badge.label}</Badge>}</div>}
      </div>
      {children && <div className="grid">{children}</div>}
    </section>
  );
}

// @cspl/table. columns: { key, label, align, isBadge, subTextKey }; a badge cell is { label, variant }
export type Col = { key: string; label: string; align?: 'left' | 'right' | 'center'; isBadge?: boolean; subTextKey?: string };
export type Row = Record<string, ReactNode | { label: ReactNode; variant: BadgeVariant }> & { $cls?: string };
export function DataTable({ columns, rows, empty = 'Nothing yet' }: { columns: Col[]; rows: Row[]; empty?: string }) {
  return (
    <div className="tu-table"><div className="shell"><table>
      <thead><tr>{columns.map((c) => <th key={c.key} className={c.align || 'left'}>{c.label}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={r.$cls}>
            {columns.map((c) => {
              const v = r[c.key] as { label: ReactNode; variant: BadgeVariant } | ReactNode;
              const sub = c.subTextKey ? (r[c.subTextKey] as ReactNode) : null;
              const badge = c.isBadge && v && typeof v === 'object' && 'label' in (v as object);
              return (
                <td key={c.key} className={c.align || 'left'}>
                  {badge ? <Badge variant={(v as { variant: BadgeVariant }).variant}>{(v as { label: ReactNode }).label}</Badge> : <span className="p">{(v as ReactNode) ?? '—'}</span>}
                  {sub != null && <span className="s">{sub}</span>}
                </td>
              );
            })}
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={columns.length} className="center"><span className="s">{empty}</span></td></tr>}
      </tbody>
    </table></div></div>
  );
}

// @cspl/dropdown, size medium (a native select styled as the trigger)
export function Dropdown({ label, value, options, onChange, disabled, hint }: {
  label: ReactNode; value: string; options: { value: string; label: string; disabled?: boolean }[]; onChange: (v: string) => void; disabled?: boolean; hint?: ReactNode;
}) {
  return (
    <div className="tu-dd">
      <label>{label}</label>
      <div className="trig">
        <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
        </select>
        <Icon name="chevron-down-small-outline" />
      </div>
      {hint && <small className="tu-hint">{hint}</small>}
    </div>
  );
}

// @cspl/text-input: label over the field
export function TextInput({ label, value, onChange, placeholder, type = 'text', prefix }: { label: ReactNode; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; prefix?: string }) {
  return (
    <div className="tu-ti">
      <label>{label}</label>
      <div className={prefix ? 'tu-ti-pre' : ''}>{prefix && <span>{prefix}</span>}<input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></div>
    </div>
  );
}

// @cspl/file-upload-card, one item: pending until a file lands, then the document preview
export function FileUploadCard({ title, description, badge, uploaded, fileName, onUpload }: {
  title: string; description: ReactNode; badge?: ReactNode; uploaded?: boolean; fileName?: string; onUpload: (name: string) => void;
}) {
  return (
    <div className="tu-fuc"><div className="row">
      <div className="tx"><div className="tt"><b>{title}</b>{badge}</div><p>{uploaded && fileName ? fileName : description}</p></div>
      <label className={'up' + (uploaded ? ' done' : '')} aria-label={`Upload ${title}`}>
        <input type="file" accept="image/*,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; onUpload(f ? f.name : title.toLowerCase().replace(/\W+/g, '-') + '.pdf'); }} />
        <span className="in" onClick={(e) => { if (!uploaded) { e.preventDefault(); onUpload(title.toLowerCase().replace(/\W+/g, '-') + '.pdf'); } }}><Icon name="arrow-out-of-box-upload-share-outline" size="xl" /><span>Upload</span></span>
        <span className="doc"><Icon name="file-text-outline" size="xl" /><span>PDF</span></span>
        <span className="corner"><Icon name="edit-outline" size="sm" /></span>
      </label>
    </div></div>
  );
}

// @cspl/fetched-info-card: a header row, then label-over-value items
export function FetchedInfo({ title, description, items, cols = 3, right }: { title?: ReactNode; description?: ReactNode; items: [ReactNode, ReactNode][]; cols?: 1 | 2 | 3 | 4; right?: ReactNode }) {
  return (
    <div className="tu-fic">
      {title && <div className="hd"><div><b>{title}</b>{description && <small>{description}</small>}</div>{right}</div>}
      <div className={'items c' + cols}>{items.map(([k, v], i) => <div key={i} className="it"><small>{k}</small><b>{v}</b></div>)}</div>
    </div>
  );
}

// @cspl/chip, rounded. Active in the brand tone, or green for a done state
export const Chip = ({ children, active, green, icon, onClick, disabled }: { children: ReactNode; active?: boolean; green?: boolean; icon?: string; onClick?: () => void; disabled?: boolean }) => (
  <button type="button" className={'tu-chip' + (green ? ' green' : '') + (active ? ' on' : '')} onClick={onClick} disabled={disabled}>{icon && <Icon name={icon} size="sm" />}{children}</button>
);

// @cspl/button. variant primary | secondary | tertiary; size small | medium
export const Button = ({ children, variant = 'primary', size = 'small', icon, onClick, disabled, title }: {
  children: ReactNode; variant?: 'primary' | 'secondary' | 'tertiary'; size?: 'small' | 'medium'; icon?: string; onClick?: () => void; disabled?: boolean; title?: string;
}) => (
  <button type="button" className={`tu-btn ${variant} ${size}`} onClick={onClick} disabled={disabled} title={title}>{icon && <Icon name={icon} size="sm" />}{children}</button>
);

// @cspl/link-button, tone brand, size sm
export const LinkButton = ({ children, icon, onClick }: { children: ReactNode; icon?: string; onClick?: () => void }) => (
  <button type="button" className="tu-link" onClick={onClick}>{icon && <Icon name={icon} size="sm" />}{children}</button>
);

// @cspl/information-message: a tinted line with an icon
export const InfoMessage = ({ children, tone = 'information', icon = 'info-outline' }: { children: ReactNode; tone?: BadgeVariant; icon?: string }) => (
  <div className={'tu-info ' + tone}><Icon name={icon} size="sm" /><span>{children}</span></div>
);

// @cspl/segment-tabs: one choice from two to four, the active one lifted
export function SegmentTabs<T extends string>({ value, options, onChange, disabled }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return <div className="tu-seg" role="tablist">{options.map((o) => <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} disabled={disabled} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>;
}

// @cspl/selection-slots: a single-select list of slots, a radio on the right; a disabled slot can't be picked
export type Slot = { value: string; title: string; description?: string; disabled?: boolean };
export function SelectionSlots({ title, slots, value, onChange, ariaLabel = 'Options' }: { title?: string; slots: Slot[]; value?: string; onChange: (v: string) => void; ariaLabel?: string }) {
  return (
    <div className="tu-slots">
      {title && <h5>{title}</h5>}
      <section className="box" role="radiogroup" aria-label={ariaLabel}>
        {slots.map((s) => {
          const on = s.value === value;
          return (
            <div key={s.value} role="radio" aria-checked={on} aria-disabled={s.disabled || undefined} tabIndex={s.disabled ? -1 : 0}
              className={'slot' + (on ? ' on' : '') + (s.disabled ? ' off' : '')}
              onClick={() => !s.disabled && !on && onChange(s.value)} onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !s.disabled) { e.preventDefault(); onChange(s.value); } }}>
              <div className="tx"><b>{s.title}</b>{s.description && <small>{s.description}</small>}</div>
              <span className="rd" aria-hidden="true" />
            </div>
          );
        })}
      </section>
    </div>
  );
}
