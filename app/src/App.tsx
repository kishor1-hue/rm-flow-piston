import { useEffect, useMemo, useState } from 'react';
import { JOURNEYS, PERSONAS, RULES, type PersonaId } from './model';
import { bookSlot, move, setBypass, stageDef, type Activity, type Order } from './engine';
import { buildSeed } from './seed';
import { Board } from './Board';
import { OrderView } from './OrderView';
import { Rules } from './Rules';
import { Tasks } from './Tasks';
import { sampleValue } from './TaskCard';

type View = 'list' | 'board' | 'order' | 'rules';

// Persona dropdown, named the way Leadverse names its task personas.
const MENU: { id: PersonaId; label: string }[] = [
  { id: 'rm', label: 'RM' }, { id: 'finops', label: 'FinOps' }, { id: 'refurb', label: 'VAS Refurb · QC' },
  { id: 'rego', label: 'Registration' }, { id: 'delivery', label: 'Delivery' }, { id: 'cx', label: 'CX' },
];

export default function App() {
  const [now, setNow] = useState(() => Date.now());
  const [orders, setOrders] = useState<Order[]>(() => buildSeed(Date.now()));
  const [persona, setPersona] = useState<PersonaId>('rm');
  const [view, setView] = useState<View>('list');
  const [sel, setSel] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | undefined>();
  const [q, setQ] = useState('');
  const [toast, setToast] = useState<Activity[] | null>(null);
  const [pmenu, setPmenu] = useState(false);
  const [railOpen, setRailOpen] = useState(true);

  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(i); }, []);
  useEffect(() => { if (!toast) return; const i = setTimeout(() => setToast(null), 5200); return () => clearTimeout(i); }, [toast]);

  // Mutate one order through the engine; surface any rules that fired.
  function update(id: string, fn: (o: Order) => void) {
    setOrders((prev) => prev.map((o) => {
      if (o.id !== id) return o;
      const c: Order = structuredClone(o);
      const before = c.activity.length;
      fn(c);
      const fresh = c.activity.slice(0, c.activity.length - before).filter((a) => a.kind === 'rule' || a.kind === 'gate' || a.kind === 'block');
      if (fresh.length) setToast(fresh.reverse());
      return c;
    }));
    setNow(Date.now());
  }
  const setField = (oid: string, tid: string, k: string, v: string | boolean) =>
    setOrders((prev) => prev.map((o) => (o.id !== oid ? o : { ...o, tasks: o.tasks.map((t) => (t.id === tid ? { ...t, fields: { ...t.fields, [k]: v } } : t)) })));
  const doMove = (oid: string, tid: string, to: string, by: PersonaId) =>
    update(oid, (o) => { const t = o.tasks.find((x) => x.id === tid)!; move(o, t, to, by, Date.now()); });
  const demo = (oid: string, tid: string) =>
    update(oid, (o) => {
      const t = o.tasks.find((x) => x.id === tid)!;
      const s = stageDef(t);
      const n = s.next![0];
      (n.requires || []).forEach((k) => { const fd = s.fields!.find((f) => f.key === k)!; if (!t.fields[k]) t.fields[k] = sampleValue(fd); });
      move(o, t, n.to, JOURNEYS[t.journey].persona, Date.now());
    });

  const open = (id: string, tid?: string) => { setSel(id); setFocus(tid); setView('order'); setRailOpen(false); window.scrollTo(0, 0); };
  const toList = () => { setView('list'); setRailOpen(true); };
  const order = orders.find((o) => o.id === sel);
  const hits = useMemo(() => (q.length < 2 ? [] : orders.filter((o) => (o.id + o.customer.name + o.car.make + o.car.model + o.apptId).toLowerCase().includes(q.toLowerCase())).slice(0, 6)), [q, orders]);
  const curTask = order?.tasks.find((t) => t.id === focus);
  const nav = (v: View) => { setView(v); setRailOpen(true); };

  return (
    <div className={'app' + (railOpen ? '' : ' slim')} onClick={() => setPmenu(false)}>
      <aside className="rail">
        <div className="brand"><div className="blogo">⟳</div><div className="bname">Leadverse</div><span className="bgeo">AU</span></div>
        <button className="railtog" aria-label={railOpen ? 'Collapse menu' : 'Expand menu'} onClick={() => setRailOpen(!railOpen)}>{railOpen ? '‹' : '›'}</button>
        <div className="navgrp">
          <button className={'navitem grp' + (view !== 'rules' ? ' on' : '')} onClick={() => nav('list')}><span className="ni">▦</span><span className="nl">Tasks</span><span className="nl chev">⌃</span></button>
          <div className="subnav">
            <button className={view === 'list' || view === 'order' ? 'on' : ''} onClick={() => nav('list')}>Order</button>
            <button className={view === 'board' ? 'on' : ''} onClick={() => nav('board')}>Board</button>
            <button disabled title="Not part of this prototype">Lead</button>
            <button disabled title="Not part of this prototype">Contact</button>
          </div>
        </div>
        <button className="navitem" disabled title="Not part of this prototype"><span className="ni">⌑</span><span className="nl">Leads</span></button>
        <button className="navitem" disabled title="Not part of this prototype"><span className="ni">⇪</span><span className="nl">Bulk operations</span></button>
        <button className={'navitem' + (view === 'rules' ? ' on' : '')} onClick={() => nav('rules')}><span className="ni">⚙</span><span className="nl">HubSpot rules map</span></button>
        <button className="navitem" disabled title="Not part of this prototype"><span className="ni">☷</span><span className="nl">Schema admin</span></button>
        <div className="navfoot"><button className="navitem" disabled><span className="ni">⚙</span><span className="nl">Settings</span></button></div>
      </aside>

      <div className="col">
        <header className="top">
          <div className="bc">
            <span>Leadverse</span><span>/</span>
            {view === 'order' && order ? (
              <><button onClick={toList}>Tasks</button><span>/</span><span className="cur">{curTask ? stageDef(curTask).label : order.id}</span></>
            ) : view === 'rules' ? <span className="cur">HubSpot rules map</span> : <span className="cur">Tasks{view === 'board' ? ' · Board' : ''}</span>}
          </div>
          <span className="sp" />
          <div className="seg top-search">
            <select defaultValue="appt"><option value="appt">Appointment ID</option></select>
            <div style={{ position: 'relative', flex: 1 }}>
              <input placeholder="Search by Appointment ID" value={q} onChange={(e) => setQ(e.target.value)} />
              {hits.length > 0 && (
                <div className="menu" style={{ top: 40, bottom: 'auto', left: 0, right: 'auto', width: 320 }}>
                  {hits.map((o) => <button key={o.id} onClick={() => { open(o.id); setQ(''); }}><b>{o.id}</b> {o.customer.name} · {o.car.make} {o.car.model}</button>)}
                </div>
              )}
            </div>
          </div>
          <button className="bell" aria-label="Notifications">🔔</button>
          <div className="me" onClick={(e) => { e.stopPropagation(); setPmenu(!pmenu); }}>
            <span className="meav">{PERSONAS[persona].user.split(' ').map((x) => x[0]).join('')}</span>
            <span className="mename"><b>{PERSONAS[persona].user}</b><small>Persona: {MENU.find((m) => m.id === persona)!.label} ▾</small></span>
            {pmenu && (
              <div className="pmenu" onClick={(e) => e.stopPropagation()}>
                {MENU.map((m) => (
                  <button key={m.id} className={persona === m.id ? 'on' : ''} onClick={() => { setPersona(m.id); setPmenu(false); if (view === 'rules') setView('list'); }}>
                    <span className="tick">{persona === m.id ? '✓' : ''}</span>{m.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>

        <main className={'main' + (view === 'order' ? ' full' : '')}>
          {view === 'list' && (
            <Tasks orders={orders} persona={persona} now={now} open={open} onMove={(oid, tid, to) => doMove(oid, tid, to, persona)} />
          )}
          {view === 'board' && (
            <>
              <div className="head"><div><h1>{PERSONAS[persona].label} board</h1><div className="sub">{persona === 'rm' ? 'Every order you own, grouped by where it is. Stages are derived from the other teams’ tasks.' : 'Your tasks across all orders, grouped by stage. Update inline or open the order.'}</div></div></div>
              <Board orders={orders} persona={persona} now={now} open={(id) => open(id)} onField={setField} onMove={(oid, tid, to) => doMove(oid, tid, to, persona)} />
            </>
          )}
          {view === 'order' && order && (
            <OrderView
              o={order} persona={persona} now={now} focus={focus} onFocus={setFocus} back={toList}
              onField={(tid, k, v) => setField(order.id, tid, k, v)}
              onMove={(tid, to) => doMove(order.id, tid, to, persona)}
              onDemo={(tid) => demo(order.id, tid)}
              onBook={(d, t, ov) => update(order.id, (o) => bookSlot(o, d, t, 'rm', Date.now(), ov || o.bypassContract))}
              onBypass={(on) => update(order.id, (o) => setBypass(o, on, Date.now()))}
              onComms={(text) => update(order.id, (o) => { o.activity.unshift({ at: Date.now(), who: PERSONAS[persona].user, kind: 'comms', text }); })}
            />
          )}
          {view === 'rules' && (
            <>
              <div className="head"><div><h1>How HubSpot works today, and the LeadVerse rule that replaces it</h1><div className="sub">Pulled from the live AU HubSpot portal, b2c-oms-au and the RM & Finance reimagine doc.</div></div></div>
              <Rules />
            </>
          )}
        </main>
      </div>

      {toast && (
        <div className="toast">
          {toast.slice(0, 3).map((a, i) => (
            <div key={i}>{a.rule ? <b>{a.rule} · {RULES.find((r) => r.id === a.rule)?.when} → </b> : null}{a.text}</div>
          ))}
        </div>
      )}
    </div>
  );
}
