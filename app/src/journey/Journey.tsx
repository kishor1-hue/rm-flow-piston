// The RM order journey, laid out like the PISTON spec viewer: journey rail | the Leadverse screen at that step | spec or
// anatomy. The screen in the frame is the live RM order view (the same components as the app), so every step can be
// clicked through. Blueprint, Fields and What changed are the same data one level deeper.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PERSONAS, RULES } from '../model';
import { bookSlot, move, setBypass, setTradeInOpted, stageDef, type Order } from '../engine';
import { buildSeed } from '../seed';
import { OrderView } from '../OrderView';
import type { RmStep } from '../RmFlow';
import { CHANGES, FLOWS, PHASES, STATES, stepById, stepByKey, stepsOf, TRACKS, type Phase, type Step, type Track } from './spec';
import './journey.css';

type View = 'walk' | 'blueprint' | 'fields' | 'changes';
type Route = { view: View; track: Track; id: string };

const parse = (h: string): Route => {
  const m = h.replace('#', '').split('-');
  const track: Track = m.includes('byo') ? 'byo' : 'cash';
  if (m[0] === 'blueprint' || m[0] === 'fields' || m[0] === 'changes') return { view: m[0], track, id: 'V1' };
  return { view: 'walk', track, id: (m[1] || 'V1').toUpperCase() };
};
const hashOf = (r: Route) => (r.view === 'walk' ? `#${r.track}-${r.id}` : `#${r.view}-${r.track}`);

const Badge = ({ s }: { s: string }) => <span className={'jv-state t-' + (STATES[s] || 'grey')}>{s}</span>;
const W = 1440, H = 900;

export function Journey({ openApp }: { openApp: (orderId: string, step: RmStep) => void }) {
  const [route, setRoute] = useState<Route>(() => parse(location.hash));
  // The trade-in step only exists when the customer opted in, so its demo orders answer Yes at V1.
  const [orders, setOrders] = useState<Order[]>(() => {
    const all = buildSeed(Date.now());
    (['cash', 'byo'] as Track[]).forEach((t) => { const o = all.find((x) => x.id === stepById(t, 'D4').demo); if (o && o.tradeInOpted !== 'Yes') setTradeInOpted(o, 'Yes', Date.now()); });
    // F1's cash demo has its contract and invoice checked (C1), so the balance can be collected.
    const f1 = all.find((x) => x.id === stepById('cash', 'F1').demo); if (f1) f1.rmDone.final = f1.rmDone.final || Date.now();
    return all;
  });
  const [tab, setTab] = useState<'spec' | 'anatomy'>('spec');
  const [pins, setPins] = useState(true);
  const [stay, setStay] = useState<string | null>(null); // an order kept while stepping inside the frame
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const f = () => { setStay(null); setRoute(parse(location.hash)); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(i); }, []);
  const go = (r: Partial<Route>, keep = false) => { const n = { ...route, ...r }; if (!keep) setStay(null); history.replaceState(null, '', hashOf(n)); setRoute(n); };

  const steps = stepsOf(route.track);
  const step = stepById(route.track, route.id);
  const i = steps.findIndex((s) => s.id === step.id);
  const order = orders.find((o) => o.id === (stay || step.demo)) || orders[0];

  function update(id: string, fn: (o: Order) => void) {
    setOrders((prev) => prev.map((o) => { if (o.id !== id) return o; const c: Order = structuredClone(o); fn(c); return c; }));
    setNow(Date.now());
  }

  return (
    <div className="jv">
      <header className="jv-top">
        <div className="jv-brand">{PHASES.map((p) => <span key={p.id}>{p.id}</span>)}</div>
        <div className="jv-title"><b>RM order journey · screen at each step</b><small>Australia, Cash and BYOF, on the Leadverse design</small></div>
        <div className="jv-seg"><button className="on">Australia</button></div>
        <div className="jv-seg">
          {(Object.keys(TRACKS) as Track[]).map((t) => <button key={t} className={route.track === t ? 'on' : ''} onClick={() => go({ track: t })}><i style={{ background: TRACKS[t].dot }} />{TRACKS[t].label}</button>)}
        </div>
        <span className="jv-fill" />
        <div className="jv-seg">
          {([['walk', 'Walkthrough'], ['blueprint', 'Blueprint'], ['fields', 'Fields'], ['changes', 'What changed']] as [View, string][]).map(([v, l]) => <button key={v} className={route.view === v ? 'on' : ''} onClick={() => go({ view: v })}>{l}</button>)}
        </div>
        <button className="jv-btn" onClick={() => openApp(order.id, step.key)}>Open the app ↗</button>
      </header>

      {route.view === 'walk' && (
        <div className="jv-walk">
          <Rail track={route.track} cur={step.id} pick={(id) => go({ id })} />
          <section className="jv-stage">
            <div className="jv-bar">
              <span className="jv-chip">▭ Leadverse web</span>
              <b>{step.id} · {step.screen}</b>
              <span className="jv-fill" />
              <button className={'jv-btn' + (pins ? ' hot' : '')} onClick={() => setPins(!pins)}>{pins ? 'Hide pins' : `Show ${step.parts.length} pins`}</button>
              <button className="jv-btn" onClick={() => openApp(order.id, step.key)}>Screen only</button>
            </div>
            <Frame url={`c24-lead-verse-ui.cars24.team${step.route.replace(':id', order.id)}`} parts={pins ? step.parts : []} onPin={() => setTab('anatomy')} dep={`${order.id}-${step.id}-${now}`}>
              <div className="app slim lv-in">
                <aside className="rail">
                  <div className="brand"><div className="blogo">⟳</div></div>
                  {['▦', '⌑', '⇪', '⚙', '☷'].map((g, k) => <button key={k} className={'navitem' + (k === 0 ? ' on' : '')}><span className="ni">{g}</span></button>)}
                </aside>
                <div className="col">
                  <header className="top">
                    <div className="bc"><span>Leadverse</span><span>/</span><span>Tasks</span><span>/</span><span className="cur">{order.customer.name} · {order.id}</span></div>
                    <span className="jv-fill" />
                    <div className="seg top-search"><select defaultValue="appt"><option value="appt">Appointment ID</option></select><input placeholder="Search by Appointment ID" /></div>
                    <div className="me"><span className="meav">PA</span><span className="mename"><b>{PERSONAS.rm.user}</b><small>Persona: RM</small></span></div>
                  </header>
                  <main className="main full">
                    <OrderView key={order.id} o={order} persona="rm" now={now} onFocus={() => {}} back={() => {}} rightOpen
                      step={step.key} onStep={(k) => { const s = stepByKey(route.track, k); if (s && s.id !== step.id) { setStay(order.id); go({ id: s.id }, true); } }}
                      onField={(tid, k, v) => update(order.id, (o) => { const t = o.tasks.find((x) => x.id === tid); if (t) t.fields[k] = v; })}
                      onMove={(tid, to) => update(order.id, (o) => { const t = o.tasks.find((x) => x.id === tid)!; move(o, t, to, 'rm', Date.now()); })}
                      onDemo={(tid) => update(order.id, (o) => { const t = o.tasks.find((x) => x.id === tid)!; const n = stageDef(t).next?.[0]; if (n) move(o, t, n.to, 'rm', Date.now()); })}
                      onBook={(d, t, ov) => update(order.id, (o) => bookSlot(o, d, t, 'rm', Date.now(), ov || o.bypassContract))}
                      onBypass={(on) => update(order.id, (o) => setBypass(o, on, Date.now()))}
                      onAct={(fn) => update(order.id, (o) => fn(o, Date.now()))}
                      onComms={(text) => update(order.id, (o) => { o.activity.unshift({ at: Date.now(), who: PERSONAS.rm.user, kind: 'comms', text }); })} />
                  </main>
                </div>
              </div>
            </Frame>
            <div className="jv-nav">
              <button disabled={i === 0} onClick={() => go({ id: steps[i - 1].id })}>‹ {steps[i - 1]?.id || ''}</button>
              <span>Step {i + 1} of {steps.length} · {TRACKS[route.track].label} · demo order {order.id}, {order.customer.name}</span>
              <button disabled={i === steps.length - 1} onClick={() => go({ id: steps[i + 1].id })}>{steps[i + 1]?.id || ''} ›</button>
            </div>
          </section>
          <SpecPanel step={step} track={route.track} tab={tab} setTab={setTab} />
        </div>
      )}
      {route.view === 'blueprint' && <Blueprint track={route.track} open={(t, id) => go({ view: 'walk', track: t, id })} setTrack={(t) => go({ track: t })} />}
      {route.view === 'fields' && <Fields track={route.track} open={(id) => go({ view: 'walk', id })} />}
      {route.view === 'changes' && <Changes open={(t, id) => go({ view: 'walk', track: t, id })} />}
    </div>
  );
}

function Rail({ track, cur, pick }: { track: Track; cur: string; pick: (id: string) => void }) {
  const steps = stepsOf(track);
  return (
    <nav className="jv-rail">
      {PHASES.map((ph) => (
        <div key={ph.id} className="jv-ph">
          <div className="jv-phh"><span>{ph.id}</span><div><b>{ph.name}</b><small>{ph.who}</small></div></div>
          {steps.filter((s) => s.phase === ph.id).map((s) => (
            <button key={s.id} className={'jv-st' + (s.id === cur ? ' on' : '') + (s.branch ? ' br' : '')} onClick={() => pick(s.id)}>
              <span className="id">{s.id}</span><span className="nm">{s.name}</span>{s.isNew && <i className="nw" title="Changed from HubSpot" />}<span className="dv">▭</span>
            </button>
          ))}
        </div>
      ))}
      <div className="jv-key"><div><i className="nw" /> Changed from HubSpot today</div><div><em>Italic</em> is a branch, taken on some exits</div><div>▭ Leadverse web, the RM’s screen</div></div>
    </nav>
  );
}

// The browser frame: the Leadverse screen at 1440×900, scaled to fit, with numbered pins on each anatomy part.
function Frame({ url, parts, children, onPin, dep }: { url: string; parts: Step['parts']; children: ReactNode; onPin: () => void; dep: string }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  const [pos, setPos] = useState<({ x: number; y: number } | null)[]>([]);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / W)));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const root = inner.current; if (!root) return;
    const place = () => {
      const r0 = root.getBoundingClientRect();
      setPos(parts.map((p) => {
        const el = root.querySelector(p.sel) as HTMLElement | null;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const sc = root.querySelector('.ws-body')?.getBoundingClientRect();
        const inBody = sc && el.closest('.ws-body');
        if (inBody && (r.top > sc.bottom - 44 || r.bottom < sc.top + 8)) return null;
        return { x: Math.max(4, (r.left - r0.left) / scale - (inBody ? 26 : 10)), y: Math.max(4, (Math.max(r.top, inBody ? sc.top : r.top) - r0.top) / scale - 10) };
      }));
    };
    place();
    const t = setInterval(place, 600);
    root.addEventListener('scroll', place, true);
    return () => { clearInterval(t); root.removeEventListener('scroll', place, true); };
  }, [parts, scale, dep]);
  return (
    <div className="jv-frame">
      <div className="jv-url"><span>🔒</span>{url}</div>
      <div className="jv-screen" ref={box} style={{ height: H * scale }}>
        <div className="jv-inner" ref={inner} style={{ width: W, height: H, transform: `scale(${scale})` }}>
          {children}
          {pos.map((p, k) => p && parts[k] && <button key={k} className="jv-pin" style={{ left: p.x, top: p.y }} title={parts[k].label} onClick={onPin}>{k + 1}</button>)}
        </div>
      </div>
    </div>
  );
}

function SpecPanel({ step, track, tab, setTab }: { step: Step; track: Track; tab: 'spec' | 'anatomy'; setTab: (t: 'spec' | 'anatomy') => void }) {
  const ph = PHASES.find((p) => p.id === step.phase)!;
  return (
    <aside className="jv-spec">
      <div className="jv-tabs"><button className={tab === 'spec' ? 'on' : ''} onClick={() => setTab('spec')}>Spec</button><button className={tab === 'anatomy' ? 'on' : ''} onClick={() => setTab('anatomy')}>Anatomy <em>{step.parts.length}</em></button></div>
      <div className="jv-sh">
        <div className="jv-kick">{ph.id} · {ph.name.toUpperCase()} <span className="jv-chip sm" style={{ color: TRACKS[track].dot }}>{TRACKS[track].label}</span><span className="jv-chip sm">Australia</span></div>
        <h2><span className="id">{step.id}</span>{step.name}</h2>
      </div>
      {tab === 'spec' ? (
        <div className="jv-body">
          <p>{step.desc}</p>
          <div className="jv-chips"><span className="jv-chip">☺ {step.owner}</span><span className="jv-chip">▭ Leadverse web</span>{step.branch && <span className="jv-chip">⑂ Branch</span>}</div>
          {step.isNew && <div className="jv-new"><b>New:</b> {step.isNew}</div>}
          <h4>Source</h4>
          <div className="jv-k">Triggered by</div><p>{step.trigger}</p>
          <div className="jv-k">Data from</div><ul className="jv-data">{step.data.map((d) => <li key={d}>{d}</li>)}</ul>
          <h4>Screen</h4>
          <p><b>{step.screen}</b> <span className="mono jv-route">{step.route}</span></p>
          <h4>Entry conditions</h4>
          <ul className="jv-ul">{step.entry.map((e) => <li key={e}>{e}</li>)}</ul>
          <h4>Exits</h4>
          <div className="jv-exits">{step.exits.map((e) => <div key={e.when} className={e.main ? 'main' : ''}><span>{e.when}{e.main && <small>main exit</small>}</span><span className="to">{e.to ? '→ ' + e.to : '→ close'}{e.state && <Badge s={e.state} />}</span></div>)}</div>
          <h4>HubSpot today</h4>
          <p>{step.hubspot}</p>
          {step.rules.length > 0 && <><h4>Rules that fire</h4><ul className="jv-rules">{step.rules.map((r) => { const d = RULES.find((x) => x.id === r); return <li key={r}><b>{r}</b> {d ? `${d.when} → ${d.then}` : ''}</li>; })}</ul></>}
        </div>
      ) : (
        <div className="jv-body">
          <p>One level below the screen. Numbers match the pins on the screen; a part with no pin shows only after an action (a modal, a branch).</p>
          <h4>Parts</h4>
          <ol className="jv-parts">{step.parts.map((p, k) => <li key={k}><span className="n">{k + 1}</span><div><b>{p.label}</b> <code>{p.widget}</code><p>{p.note}</p></div></li>)}</ol>
        </div>
      )}
    </aside>
  );
}

function Blueprint({ track, open, setTrack }: { track: Track; open: (t: Track, id: string) => void; setTrack: (t: Track) => void }) {
  const steps = stepsOf(track);
  return (
    <div className="jv-page">
      <h1>One level deeper, for every step</h1>
      <p className="jv-lead">Source, screen, entry and exit conditions at three levels: the flow, the phase and the step. Click any row to open its screen. Switch the track at the top or here.</p>
      <div className="jv-note"><span className="jv-chip sm">AU</span> Showing <b>Australia</b>, the RM’s order journey from the deposit to the handover slot.
        <span className="jv-fill" /><div className="jv-seg sm">{(Object.keys(TRACKS) as Track[]).map((t) => <button key={t} className={track === t ? 'on' : ''} onClick={() => setTrack(t)}><i style={{ background: TRACKS[t].dot }} />{TRACKS[t].label}</button>)}</div></div>
      <h3>The two flows</h3>
      <div className="jv-flows">
        {(Object.keys(FLOWS) as Track[]).map((t) => (
          <div key={t} className={'jv-card' + (t === track ? ' on' : '')}>
            <h4><i style={{ background: TRACKS[t].dot }} />{t === 'cash' ? 'Cash' : 'BYOF · bring your own finance'}<small>{TRACKS[t].pipeline}</small></h4>
            <div className="jv-k">Source</div><ul className="jv-ul">{FLOWS[t].source.map((x) => <li key={x}>{x}</li>)}</ul>
            <div className="jv-k">Flow entry conditions</div><ul className="jv-ul">{FLOWS[t].entry.map((x) => <li key={x}>{x}</li>)}</ul>
            <div className="jv-k">Flow exit conditions</div>
            <div className="jv-ex">{FLOWS[t].exits.map(([s, n]) => <div key={s}><Badge s={s} /><span>{n}</span></div>)}</div>
            <div className="jv-k">Main path</div><div className="mono jv-path">{FLOWS[t].path}</div>
          </div>
        ))}
      </div>
      <h3>Phase and step level · {TRACKS[track].label}</h3>
      {PHASES.map((ph) => <PhaseTable key={ph.id} ph={ph} steps={steps.filter((s) => s.phase === ph.id)} open={(id) => open(track, id)} />)}
    </div>
  );
}

function PhaseTable({ ph, steps, open }: { ph: Phase; steps: Step[]; open: (id: string) => void }) {
  return (
    <div className="jv-card flat">
      <div className="jv-phase"><span>{ph.id}</span><b>{ph.name}</b><small>{ph.why} · {ph.who}</small></div>
      <div className="jv-pe"><b>ENTRY</b> {ph.entry}</div>
      <div className="jv-pe"><b>EXIT</b> {ph.exit}</div>
      <div className="jv-tw"><table className="jv-t">
        <thead><tr><th>Step</th><th>Screen</th><th>Source</th><th>Entry conditions</th><th>Exit conditions</th><th>State</th></tr></thead>
        <tbody>{steps.map((s) => (
          <tr key={s.id} onClick={() => open(s.id)}>
            <td><b className="lnk">{s.id}</b> {s.branch ? <em>{s.name}</em> : s.name}</td>
            <td>{s.screen}</td>
            <td>{s.trigger}</td>
            <td>{s.entry.join('; ')}</td>
            <td>{s.exits.map((e) => <div key={e.when}>{e.main ? <b>{e.when}</b> : e.when}</div>)}</td>
            <td>{Array.from(new Set(s.exits.map((e) => e.state).filter(Boolean) as string[])).map((x) => <Badge key={x} s={x} />)}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}

function Fields({ track, open }: { track: Track; open: (id: string) => void }) {
  const steps = stepsOf(track);
  const total = steps.reduce((a, s) => a + s.fields.length, 0);
  return (
    <div className="jv-page">
      <h1>Every field on every screen</h1>
      <p className="jv-lead">The data dictionary behind the screens: {total} fields across {steps.length} screens on the {TRACKS[track].label} track. Click a row to open that screen with its pins.</p>
      {PHASES.map((ph) => {
        const rows = steps.filter((s) => s.phase === ph.id).flatMap((s) => s.fields.map((f) => ({ s, f })));
        return (
          <div key={ph.id} className="jv-card flat">
            <div className="jv-phase"><span>{ph.id}</span><b>{ph.name}</b><small>{rows.length} fields</small></div>
            <div className="jv-tw"><table className="jv-t">
              <thead><tr><th>Step</th><th>Field</th><th>Type</th><th>Required</th><th>Source</th><th>Rule</th></tr></thead>
              <tbody>{rows.map(({ s, f }) => (
                <tr key={s.id + f.name} onClick={() => open(s.id)}>
                  <td><b className="lnk">{s.id}</b> {s.name}</td><td><b>{f.name}</b></td><td>{f.type}</td>
                  <td>{f.req === 'Required' ? <span className="req">REQUIRED</span> : f.req}</td><td>{f.source}</td><td>{f.rule}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </div>
        );
      })}
    </div>
  );
}

function Changes({ open }: { open: (t: Track, id: string) => void }) {
  const n = useMemo(() => CHANGES.length, []);
  return (
    <div className="jv-page">
      <h1>What changed from HubSpot</h1>
      <p className="jv-lead">From the FinOps call on BYO finance, your brief and the HubSpot 01a and 01b pipelines. {n} changes, each with what it does to the journey and to the screens.</p>
      {CHANGES.map((c) => (
        <div key={c.title} className="jv-card">
          <div className="jv-quote"><small>{c.who}</small>{c.quote}</div>
          <h4 className="jv-ct">{c.title}</h4>
          <div className="jv-ba"><b>BEFORE</b><span className="mono">{c.before}</span></div>
          <div className="jv-ba after"><b>AFTER</b><span className="mono">{c.after}</span></div>
          {c.body.map(([h, t]) => <p key={h} className="jv-cb"><b>{h}</b> {t}</p>)}
          <div className="jv-links">{c.links.map(([t, id]) => { const s = stepById(t, id); return <button key={t + id} onClick={() => open(t, id)}>{id} {s.name}{c.links.some(([t2, id2]) => id2 === id && t2 !== t) ? `, ${TRACKS[t].label}` : ''}</button>; })}</div>
        </div>
      ))}
    </div>
  );
}
