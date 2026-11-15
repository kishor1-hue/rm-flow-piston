import { useEffect, useState } from 'react';
import { JOURNEYS, RM_STAGES, type PersonaId } from './model';
import { availableNext, canMove, fmtAge, missingFields, rmStage, slaState, stageDef, type Order, type Task } from './engine';
import { PERSONA_JOURNEYS, rmNext } from './Board';

// Leadverse shows stage as an UPPER_SNAKE status code (TOKEN_PAYMENT, DOCUMENTS_APPROVED…).
export const code = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');

interface Row { o: Order; t?: Task; task: string; status: string; tone: string; next: string; nextTone: string; age: number; breach: boolean }

const PAGE = 8;

// Persona dropdown, named the way Leadverse names its task personas.
export const PERSONA_MENU: { id: PersonaId; label: string }[] = [
  { id: 'rm', label: 'RM' }, { id: 'finops', label: 'FinOps' }, { id: 'refurb', label: 'VAS Refurb · QC' },
  { id: 'rego', label: 'Registration' }, { id: 'delivery', label: 'Delivery' }, { id: 'cx', label: 'CX' },
];

export function Tasks({ orders, persona, setPersona, now, open, onMove }: {
  orders: Order[]; persona: PersonaId; setPersona: (p: PersonaId) => void; now: number;
  open: (oid: string, tid?: string) => void; onMove: (oid: string, tid: string, to: string) => void;
}) {
  const journeys = PERSONA_JOURNEYS[persona];
  const [tab, setTab] = useState<string>('all');
  const [q, setQ] = useState('');
  const [by, setBy] = useState<'appt' | 'order' | 'name'>('order');
  const [showF, setShowF] = useState(false);
  const [fl, setFl] = useState({ state: '', pay: '', breach: false, done: false });
  const [page, setPage] = useState(0);
  const [kebab, setKebab] = useState<string | null>(null);
  const [pmenu, setPmenu] = useState(false);
  useEffect(() => { setTab('all'); setPage(0); }, [persona]);
  useEffect(() => { setPage(0); }, [tab, q, fl]);

  const taskRow = (o: Order, t: Task): Row => {
    const s = stageDef(t);
    const n = availableNext(o, t)[0];
    const sla = slaState(t, now);
    return {
      o, t, task: JOURNEYS[t.journey].name + (t.item ? ' · ' + t.item : ''), status: code(s.label),
      tone: s.kind === 'done' ? 'c-green' : s.kind === 'fail' ? 'c-red' : 'c-grey',
      next: s.kind === 'done' ? 'Completed' : n ? n.label : s.auto ? 'Auto: ' + s.auto : 'Waiting on another team',
      nextTone: s.kind === 'done' ? 'c-green' : n ? 'c-lv' : 'c-grey', age: now - t.enteredAt, breach: sla === 'breach',
    };
  };

  let rows: Row[] = [];
  if (persona === 'rm' && tab === 'all') {
    rows = orders.map((o) => {
      const st = rmStage(o);
      const nx = rmNext(o, now);
      const open = o.tasks.filter((t) => journeys.includes(t.journey) && stageDef(t).kind !== 'done');
      return {
        o, task: 'Order', status: code(RM_STAGES.find((s) => s.key === st)!.label), tone: st === 'delivered' ? 'c-green' : st === 'blockers' ? 'c-amber' : 'c-grey',
        next: nx.text, nextTone: nx.tone, age: now - o.depositAt, breach: open.some((t) => slaState(t, now) === 'breach'),
      };
    });
  } else {
    const js = tab === 'all' ? journeys : [tab];
    rows = orders.flatMap((o) => o.tasks.filter((t) => js.includes(t.journey)).map((t) => taskRow(o, t)));
  }

  const counts = Object.fromEntries(journeys.map((j) => [j, orders.reduce((n, o) => n + o.tasks.filter((t) => t.journey === j && stageDef(t).kind !== 'done').length, 0)]));
  const ql = q.trim().toLowerCase();
  const shown = rows
    .filter((r) => !ql || (by === 'appt' ? r.o.apptId : by === 'order' ? r.o.id : r.o.customer.name).toLowerCase().includes(ql))
    .filter((r) => (!fl.state || r.o.customer.state === fl.state) && (!fl.pay || r.o.paymentMode === fl.pay) && (!fl.breach || r.breach))
    .filter((r) => fl.done || (r.t ? stageDef(r.t).kind !== 'done' : rmStage(r.o) !== 'delivered'))
    .sort((a, b) => Number(b.breach) - Number(a.breach) || b.age - a.age);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const slice = shown.slice(page * PAGE, page * PAGE + PAGE);
  const total = rows.filter((r) => (r.t ? stageDef(r.t).kind !== 'done' : rmStage(r.o) !== 'delivered')).length;
  const activeF = [fl.state, fl.pay, fl.breach, fl.done].filter(Boolean).length;

  return (
    <div className="tl" onClick={() => { setKebab(null); setPmenu(false); }}>
      <h1 className="tl-h">Tasks({total})</h1>
      <div className="tl-tools">
        <div className="seg">
          <select value={by} onChange={(e) => setBy(e.target.value as typeof by)}>
            <option value="order">Order ID</option><option value="appt">Appointment ID</option><option value="name">Customer name</option>
          </select>
          <input placeholder={`Search by ${by === 'order' ? 'Order ID' : by === 'appt' ? 'Appointment ID' : 'customer name'}`} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span style={{ flex: 1 }} />
        <button className={'btn fbtn' + (showF || activeF ? ' on' : '')} onClick={(e) => { e.stopPropagation(); setShowF(!showF); }}>⛛ Filters{activeF ? ` · ${activeF}` : ''}</button>
        <div className="pdrop">
          <button className="btn pbtn" onClick={(e) => { e.stopPropagation(); setPmenu(!pmenu); }}>{PERSONA_MENU.find((m) => m.id === persona)!.label}<span>⌄</span></button>
          {pmenu && (
            <div className="pmenu" onClick={(e) => e.stopPropagation()}>
              {PERSONA_MENU.map((m) => (
                <button key={m.id} className={persona === m.id ? 'on' : ''} onClick={() => { setPersona(m.id); setPmenu(false); }}>
                  <span className="tick">{persona === m.id ? '✓' : ''}</span>{m.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {showF && (
        <div className="filters" onClick={(e) => e.stopPropagation()}>
          {['', 'VIC', 'NSW', 'QLD'].map((s) => <button key={'s' + s} className={'fchip' + (fl.state === s ? ' on' : '')} onClick={() => setFl({ ...fl, state: s })}>{s || 'All states'}</button>)}
          <span className="fsep" />
          {['', 'Cash', 'BYO', 'Cars24 finance'].map((p) => <button key={'p' + p} className={'fchip' + (fl.pay === p ? ' on' : '')} onClick={() => setFl({ ...fl, pay: p })}>{p || 'All payment modes'}</button>)}
          <span className="fsep" />
          <button className={'fchip' + (fl.breach ? ' on' : '')} onClick={() => setFl({ ...fl, breach: !fl.breach })}>SLA breached</button>
          <button className={'fchip' + (fl.done ? ' on' : '')} onClick={() => setFl({ ...fl, done: !fl.done })}>Show completed</button>
        </div>
      )}

      <div className="tl-card">
        <div className="tl-tabs">
          <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>All Tasks ({total})</button>
          {journeys.map((j) => <button key={j} className={tab === j ? 'on' : ''} onClick={() => setTab(j)}>{JOURNEYS[j].name} ({counts[j]})</button>)}
          <button className="plus" title="Save a view">＋</button>
        </div>
        <div className="tl-scroll">
          <table className="tl-t">
            <thead><tr><th>Order Id</th><th>Customer Name</th><th>Customer Email</th><th>Task</th><th>Status</th><th>Next action</th><th>In stage</th><th /></tr></thead>
            <tbody>
              {slice.map((r) => {
                const key = r.o.id + (r.t?.id || '');
                const n = r.t ? availableNext(r.o, r.t)[0] : undefined;
                const blocked = r.t && n ? (missingFields(r.t, n.requires).length ? 'Open the task to fill the required fields' : canMove(r.o, r.t, n.to).reason || '') : '';
                return (
                  <tr key={key} onClick={() => open(r.o.id, r.t?.id)}>
                    <td className="oid">{r.o.id}</td>
                    <td><span className="nm"><span className="ini">{r.o.customer.name.split(' ').map((x) => x[0]).join('')}</span>{r.o.customer.name}</span></td>
                    <td className="em">{r.o.customer.email}</td>
                    <td>{r.task}</td>
                    <td><span className={'code ' + r.tone}>{r.status}</span></td>
                    <td><span className={'chip ' + r.nextTone}>{r.next}</span></td>
                    <td className={r.breach ? 'late' : 'muted'}>{fmtAge(r.age)}{r.breach ? ' · SLA' : ''}</td>
                    <td className="kb" onClick={(e) => { e.stopPropagation(); setKebab(kebab === key ? null : key); }}>
                      <span>⋮</span>
                      {kebab === key && (
                        <div className="menu kmenu" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => open(r.o.id, r.t?.id)}>Open task</button>
                          {r.t && n && <button disabled={!!blocked} title={blocked} onClick={() => { onMove(r.o.id, r.t!.id, n.to); setKebab(null); }}>Quick move: {n.label}{blocked && <span className="why2">{blocked}</span>}</button>}
                          <button onClick={() => { navigator.clipboard?.writeText(r.o.id).catch(() => {}); setKebab(null); }}>Copy order ID</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {slice.length === 0 && <tr><td colSpan={8} className="empty">No tasks match.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button>
          {Array.from({ length: pages }, (_, i) => <button key={i} className={i === page ? 'on' : ''} onClick={() => setPage(i)}>{i + 1}</button>)}
          <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>›</button>
        </div>
      </div>
    </div>
  );
}
