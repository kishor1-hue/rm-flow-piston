import { useState } from 'react';
import { JOURNEYS, PERSONAS, RM_STAGES, type JourneyId, type PersonaId } from './model';
import { fmtAge, gateStatus, hasGfr, isDone, isRegistered, money, outstanding, rmStage, slaState, stageDef, task, type Order, type Task } from './engine';
import { TaskCard } from './TaskCard';

export const PERSONA_JOURNEYS: Record<PersonaId, JourneyId[]> = {
  rm: ['payment', 'byo', 'contract'], refurb: ['refurb', 'vas'], rego: ['rwc', 'rego'], delivery: ['delivery', 'transit'], finops: ['payment', 'byo'], cx: ['warranty', 'checkin'], tradein: ['tradein'],
};

export function GateDots({ o }: { o: Order }) {
  return (
    <span className="gates" title="Slot gates: Finance · Contract · Registered · Refurb GFD · Hub">
      {gateStatus(o).map((g) => (
        <span key={g.key} className={'gdot ' + ('na' in g && g.na ? 'na' : 'override' in g && g.override ? 'ov' : g.ok ? 'ok' : '')} title={g.label + ('na' in g && g.na ? ' — not interstate' : g.ok ? ' ✓' : ' — open')}>
          {g.short}
        </span>
      ))}
    </span>
  );
}

// What the RM should do next, in one line.
export function rmNext(o: Order, now: number): { text: string; tone: string } {
  const s = rmStage(o);
  if (s === 'new') {
    const t = task(o, 'payment')!;
    if (t.stage === 'cancelled') return { text: 'Sale cancelled', tone: 'c-grey' };
    return { text: 'Verify deposit proof · confirm first instalment', tone: slaState(t, now) === 'breach' ? 'c-red' : 'c-lv' };
  }
  if (s === 'prep') {
    const rwc = task(o, 'rwc');
    if (!hasGfr(o)) return { text: o.paymentMode === 'Cash' ? 'Waiting for GFR · first instalment' : o.paymentMode === 'BYO' ? 'Waiting for GFR · 3P lender approval' : 'Waiting for GFR · loan approval', tone: 'c-amber' };
    if (o.interstate && !isDone(task(o, 'transit'))) return { text: task(o, 'transit')?.stage === 'moving' ? 'Car in interstate transit' : 'Pre-transit inspection', tone: 'c-blue' };
    if (rwc?.stage === 'fail') return { text: `RWC failed · rework ETA ${rwc.fields.reworkEta || 'missing'}`, tone: 'c-red' };
    const ref = task(o, 'refurb');
    if (ref?.stage === 'qcFail') return { text: `QC failed · fix ETA ${ref.fields.qcEta || 'missing'}`, tone: 'c-red' };
    if (!isDone(rwc)) return { text: 'Waiting on roadworthy', tone: 'c-grey' };
    if (!isRegistered(o)) return { text: 'Waiting on registration', tone: 'c-grey' };
    return { text: 'Waiting on detail & QC', tone: 'c-grey' };
  }
  if (s === 'blockers') return { text: 'Open: ' + gateStatus(o).filter((g) => !g.ok).map((g) => g.label).join(', '), tone: 'c-amber' };
  if (s === 'ready') return { text: 'All gates clear · book the slot', tone: 'c-green' };
  if (s === 'booked') return { text: `Handover ${o.slot!.date} · ${o.slot!.time}`, tone: 'c-blue' };
  return { text: 'Delivered · CX check-ins running', tone: 'c-green' };
}

interface Filters { state: string; pay: string; breach: boolean }

export function Board({ orders, persona, now, open, onField, onMove }: {
  orders: Order[]; persona: PersonaId; now: number; open: (id: string) => void;
  onField: (oid: string, tid: string, k: string, v: string | boolean) => void; onMove: (oid: string, tid: string, to: string) => void;
}) {
  const tabs: string[] = persona === 'rm' ? ['order', ...PERSONA_JOURNEYS.rm] : PERSONA_JOURNEYS[persona];
  const [tab, setTab] = useState<string>(tabs[0]);
  const [fl, setFl] = useState<Filters>({ state: '', pay: '', breach: false });
  const [expanded, setExpanded] = useState<string | null>(null);
  const cur = tabs.includes(tab) ? tab : tabs[0];

  const keep = (o: Order) => (!fl.state || o.customer.state === fl.state) && (!fl.pay || o.paymentMode === fl.pay);
  const list = orders.filter(keep);

  // KPIs across the persona's journeys
  const myTasks: { o: Order; t: Task }[] = [];
  orders.forEach((o) => o.tasks.forEach((t) => PERSONA_JOURNEYS[persona].includes(t.journey) && myTasks.push({ o, t })));
  const open_ = myTasks.filter((x) => stageDef(x.t).kind !== 'done');
  const breached = open_.filter((x) => slaState(x.t, now) === 'breach');
  const failed = open_.filter((x) => stageDef(x.t).kind === 'fail');
  const doneToday = myTasks.filter((x) => stageDef(x.t).kind === 'done' && now - x.t.enteredAt < 24 * 3600_000);

  return (
    <>
      <div className="kpis">
        {persona === 'rm' && <div className="kpi"><div className="n">{orders.filter((o) => rmStage(o) !== 'delivered').length}</div><div className="l">Live orders assigned to me</div></div>}
        {persona === 'rm' && <div className="kpi"><div className="n" style={{ color: 'var(--green)' }}>{orders.filter((o) => rmStage(o) === 'ready').length}</div><div className="l">Ready to book a slot</div></div>}
        <div className="kpi"><div className="n">{open_.length}</div><div className="l">Open {PERSONAS[persona].short} tasks</div></div>
        <div className={'kpi' + (breached.length ? ' alert' : '')}><div className="n">{breached.length}</div><div className="l">SLA breached</div></div>
        <div className={'kpi' + (failed.length ? ' alert' : '')}><div className="n">{failed.length}</div><div className="l">Failed / rework</div></div>
        <div className="kpi"><div className="n">{doneToday.length}</div><div className="l">Completed in last 24h</div></div>
      </div>

      <div className="tabs">
        {tabs.map((k) => (
          <button key={k} className={'fchip' + (cur === k ? ' on' : '')} onClick={() => setTab(k)}>
            {k === 'order' ? 'My orders (deal view)' : JOURNEYS[k as JourneyId].name}
          </button>
        ))}
      </div>
      <div className="filters">
        {['', 'VIC', 'NSW', 'QLD'].map((s) => <button key={s} className={'fchip' + (fl.state === s ? ' on' : '')} onClick={() => setFl({ ...fl, state: s })}>{s || 'All states'}</button>)}
        <span className="fsep" />
        {['', 'Cash', 'BYO', 'Cars24 finance'].map((s) => <button key={s} className={'fchip' + (fl.pay === s ? ' on' : '')} onClick={() => setFl({ ...fl, pay: s })}>{s || 'All payment modes'}</button>)}
        <span className="fsep" />
        <button className={'fchip' + (fl.breach ? ' on' : '')} onClick={() => setFl({ ...fl, breach: !fl.breach })}>SLA breached only</button>
      </div>

      <div className="board">
        {cur === 'order'
          ? RM_STAGES.map((st) => {
              const cards = list.filter((o) => rmStage(o) === st.key).filter((o) => !fl.breach || o.tasks.some((t) => slaState(t, now) === 'breach'));
              return (
                <div key={st.key} className={'lane' + (st.key === 'delivered' ? ' done' : '')}>
                  <div className="lanehead">{st.label}<span className="cnt">{cards.length}</span></div>
                  <div className="lanehs">HubSpot: {st.hs}</div>
                  {cards.map((o) => {
                    const nx = rmNext(o, now);
                    const breach = o.tasks.some((t) => slaState(t, now) === 'breach');
                    return (
                      <div key={o.id} className={'tcard' + (breach ? ' breach' : '')} onClick={() => open(o.id)}>
                        <div className="trow"><span className="tid">{o.id}</span><span className="tname">{o.customer.name}</span><span className="age">Day {Math.ceil((now - o.depositAt) / 86400000)}</span></div>
                        <div className="tcar">{o.car.year} {o.car.make} {o.car.model}</div>
                        <div className="tmeta">
                          <span className="chip c-grey">{o.customer.state}{o.interstate ? ' ← ' + o.car.hubState : ''}</span>
                          <span className="chip c-grey">{o.paymentMode}</span>
                          <span style={{ marginLeft: 'auto' }}><GateDots o={o} /></span>
                        </div>
                        <div className="next"><span className={'chip ' + nx.tone}>{nx.text}</span></div>
                        {outstanding(o) > 0 && st.key !== 'new' && <div className="age" style={{ marginTop: 6, textAlign: 'right' }}>Outstanding {money(outstanding(o))}</div>}
                      </div>
                    );
                  })}
                  {!cards.length && <div className="empty">Nothing here</div>}
                </div>
              );
            })
          : JOURNEYS[cur as JourneyId].stages.map((st) => {
              const items: { o: Order; t: Task }[] = [];
              list.forEach((o) => o.tasks.forEach((t) => t.journey === cur && t.stage === st.key && (!fl.breach || slaState(t, now) === 'breach') && (st.kind !== 'done' || now - t.enteredAt < 72 * 3600_000) && items.push({ o, t })));
              const editable = JOURNEYS[cur as JourneyId].persona === persona;
              return (
                <div key={st.key} className={'lane' + (st.kind === 'fail' ? ' fail' : st.kind === 'done' ? ' done' : '')}>
                  <div className="lanehead">{st.label}{st.kind === 'done' ? ' · last 3 days' : ''}<span className="cnt">{items.length}</span></div>
                  <div className="lanehs">HubSpot: {st.hs}{st.slaHours ? ` · SLA ${st.slaHours}h` : ''}</div>
                  {items.map(({ o, t }) => {
                    const sla = slaState(t, now);
                    const key = o.id + t.id;
                    return (
                      <div key={key} className={'tcard ' + (sla === 'breach' ? 'breach' : sla === 'warn' ? 'warn' : '')} onClick={() => open(o.id)}>
                        <div className="trow"><span className="tid">{o.id}</span><span className="tname">{o.customer.name}</span><span className={'age' + (sla === 'breach' ? ' breach' : '')}>{fmtAge(now - t.enteredAt)}</span></div>
                        <div className="tcar">{t.item ? <b>{t.item} · </b> : null}{o.car.year} {o.car.make} {o.car.model}</div>
                        <div className="tmeta">
                          <span className="chip c-grey">{o.car.hub.split(' · ')[0]}</span>
                          {t.journey === 'refurb' && o.promises.length > 0 && <span className="chip c-amber">{o.promises.length} sales promise{o.promises.length > 1 ? 's' : ''}</span>}
                          {t.journey === 'rwc' && t.fields.reworkEta && <span className="chip c-red">ETA {String(t.fields.reworkEta)}</span>}
                          {t.journey === 'refurb' && !isDone(task(o, 'rego')) && st.key === 'qc' && <span className="chip c-grey">Rego pending</span>}
                          {o.slot && t.journey === 'delivery' && <span className="chip c-blue">{o.slot.date} {o.slot.time}</span>}
                        </div>
                        {editable && st.kind !== 'done' && st.next && (
                          expanded === key ? (
                            <div className="inline" onClick={(e) => e.stopPropagation()}>
                              <TaskCard compact order={o} t={t} editable now={now} onField={(k, v) => onField(o.id, t.id, k, v)} onMove={(to) => { onMove(o.id, t.id, to); setExpanded(null); }} />
                            </div>
                          ) : (
                            <div className="next" onClick={(e) => { e.stopPropagation(); setExpanded(key); }}>Update here →</div>
                          )
                        )}
                      </div>
                    );
                  })}
                  {!items.length && <div className="empty">Nothing here</div>}
                </div>
              );
            })}
      </div>
      <div className="legend">
        <span><span className="gdot ok" style={{ display: 'inline-grid' }}>F</span> Slot gates: Finance GFD · Contract · Refurb GFD · Hub arrival (interstate only)</span>
        <span>Red edge = SLA breached · amber = due soon</span>
      </div>
    </>
  );
}
