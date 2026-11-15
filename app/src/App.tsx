import { useEffect, useMemo, useState } from 'react';
import { JOURNEYS, PERSONAS, RULES, WORKING_PERSONAS, type PersonaId } from './model';
import { bookSlot, move, rmStage, setBypass, stageDef, type Activity, type Order } from './engine';
import { buildSeed } from './seed';
import { Board } from './Board';
import { OrderView } from './OrderView';
import { Rules } from './Rules';
import { sampleValue } from './TaskCard';

type View = 'board' | 'orders' | 'order' | 'rules';

export default function App() {
  const [now, setNow] = useState(() => Date.now());
  const [orders, setOrders] = useState<Order[]>(() => buildSeed(Date.now()));
  const [persona, setPersona] = useState<PersonaId>('rm');
  const [view, setView] = useState<View>('board');
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [toast, setToast] = useState<Activity[] | null>(null);

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
      if (fresh.length) setToast(fresh);
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

  const open = (id: string) => { setSel(id); setView('order'); window.scrollTo(0, 0); };
  const order = orders.find((o) => o.id === sel);
  const hits = useMemo(() => (q.length < 2 ? [] : orders.filter((o) => (o.id + o.customer.name + o.car.make + o.car.model + o.apptId).toLowerCase().includes(q.toLowerCase())).slice(0, 6)), [q, orders]);

  const title = view === 'rules' ? 'HubSpot → LeadVerse logic' : view === 'orders' ? 'All orders' : `${PERSONAS[persona].label} work board`;

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand"><div className="blogo">L</div><div className="bname">LeadVerse</div><span className="bgeo">AU</span></div>
        <div className="navsec">Work</div>
        <button className={'navitem' + (view === 'board' ? ' on' : '')} onClick={() => setView('board')}>▦ Work board</button>
        <button className={'navitem' + (view === 'orders' || view === 'order' ? ' on' : '')} onClick={() => setView('orders')}>☰ Orders</button>
        <div className="navsec">Explain</div>
        <button className={'navitem' + (view === 'rules' ? ' on' : '')} onClick={() => setView('rules')}>⚙ Rules & HubSpot map</button>
        <div className="navsec">Persona</div>
        {WORKING_PERSONAS.map((p) => (
          <button key={p} className={'navitem' + (persona === p ? ' on' : '')} style={{ fontWeight: 500 }} onClick={() => { setPersona(p); if (view === 'rules') setView('board'); }}>
            <span className="who" style={{ background: '#fff', opacity: persona === p ? 1 : 0.4 }} /> {PERSONAS[p].label}
          </button>
        ))}
        <div className="navfoot"><b>{PERSONAS[persona].user}</b>{PERSONAS[persona].label} · VIC + NSW + QLD</div>
      </aside>

      <div className="col">
        <header className="top">
          <div className="bc">
            <span>Post-deposit</span><span>/</span>
            {view === 'order' && order ? <><button onClick={() => setView('board')}>{PERSONAS[persona].short} board</button><span>/</span><span className="cur">{order.id}</span></> : <span className="cur">{title}</span>}
          </div>
          <span className="sp" />
          <div style={{ position: 'relative' }}>
            <input className="search" placeholder="Search order, name, appointment ID…" value={q} onChange={(e) => setQ(e.target.value)} />
            {hits.length > 0 && (
              <div className="card" style={{ position: 'absolute', right: 0, top: 42, width: 320, zIndex: 40, padding: 8, boxShadow: '0 14px 35px #0F172B22' }}>
                {hits.map((o) => <div key={o.id} className="fe" style={{ cursor: 'pointer', padding: 8 }} onClick={() => { open(o.id); setQ(''); }}><b>{o.id}</b>&nbsp;{o.customer.name} · {o.car.make} {o.car.model}</div>)}
              </div>
            )}
          </div>
          <select className="persona" value={persona} onChange={(e) => setPersona(e.target.value as PersonaId)}>
            {WORKING_PERSONAS.map((p) => <option key={p} value={p}>Persona: {PERSONAS[p].label}</option>)}
          </select>
        </header>

        <main className="main">
          {view === 'board' && (
            <>
              <div className="head"><div><h1>{title}</h1><div className="sub">{persona === 'rm' ? 'Every order you own, grouped by where it is. Stages are derived from the other teams’ tasks.' : 'Your tasks across all orders, grouped by stage. Update inline or open the order.'}</div></div></div>
              <Board orders={orders} persona={persona} now={now} open={open} onField={setField} onMove={(oid, tid, to) => doMove(oid, tid, to, persona)} />
            </>
          )}
          {view === 'orders' && (
            <>
              <div className="head"><div><h1>All orders</h1><div className="sub">{orders.length} post-deposit orders · invented data</div></div></div>
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table className="t">
                  <thead><tr><th>Order</th><th>Customer</th><th>Car</th><th>Payment</th><th>Order stage</th><th>Open tasks</th></tr></thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id} className="click" onClick={() => open(o.id)}>
                        <td className="mono"><b>{o.id}</b></td>
                        <td>{o.customer.name}<div className="hs" style={{ fontSize: 11 }}>{o.customer.state}</div></td>
                        <td>{o.car.year} {o.car.make} {o.car.model}</td>
                        <td>{o.paymentMode}</td>
                        <td><span className="chip c-lv">{rmStage(o)}</span></td>
                        <td>{o.tasks.filter((t) => stageDef(t).kind !== 'done').map((t) => <span key={t.id} className="chip c-grey" style={{ margin: '0 4px 4px 0' }}>{PERSONAS[JOURNEYS[t.journey].persona].short}: {stageDef(t).label}</span>)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {view === 'order' && order && (
            <OrderView
              o={order} persona={persona} now={now} back={() => setView('board')}
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
