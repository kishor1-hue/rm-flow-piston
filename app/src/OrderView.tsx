import { useState } from 'react';
import { JOURNEYS, PERSONAS, RM_STAGES, RULES, type PersonaId } from './model';
import { fmtAge, gatesClear, gateStatus, hsDealStage, isDone, money, outstanding, rmStage, stageDef, task, type Order } from './engine';
import { PERSONA_JOURNEYS, rmNext } from './Board';
import { TaskCard } from './TaskCard';

function aiSummary(o: Order, now: number) {
  const parts: string[] = [];
  const days = Math.ceil((now - o.depositAt) / 86400000);
  parts.push(`${o.customer.name.split(' ')[0]} paid a deposit ${days === 1 ? 'today' : days + ' days ago'} for a ${o.car.year} ${o.car.make} ${o.car.model} (${o.paymentMode}${o.lender ? ' · ' + o.lender : ''}).`);
  const open = gateStatus(o).filter((g) => !g.ok).map((g) => g.label);
  if (rmStage(o) === 'delivered') parts.push('The car has been handed over; CX check-ins are running.');
  else if (o.slot) parts.push(`Handover is booked for ${o.slot.date} at ${o.slot.time}.`);
  else if (open.length) parts.push(`Slot is blocked by: ${open.join(', ')}.`);
  else parts.push('All four gates are clear — the slot can be booked now.');
  const rwc = task(o, 'rwc');
  if (rwc?.stage === 'fail') parts.push(`Roadworthy failed (${rwc.fields.failReason}); rework ETA ${rwc.fields.reworkEta}.`);
  if (o.promises.length) parts.push(`Sales promised: ${o.promises.join('; ')}${isDone(task(o, 'refurb')) ? ' — delivered' : ' — not yet confirmed by refurb'}.`);
  const bal = outstanding(o);
  if (bal > 0) parts.push(`Outstanding balance ${money(bal)}.`);
  parts.push('Next: ' + rmNext(o, now).text + '.');
  return parts.join(' ');
}

function LeftPanel({ o, now }: { o: Order; now: number }) {
  const rego = task(o, 'rego');
  return (
    <div className="lp">
      <div className="card summary">
        <div className="ct">✦ Summary</div>
        <p>{aiSummary(o, now)}</p>
      </div>
      <div className="card">
        <div className="lp-title">Customer</div>
        <div className="kv">
          <div><span>Name</span><b>{o.customer.name}</b></div>
          <div><span>Phone</span><b>{o.customer.phone}</b></div>
          <div><span>Email</span><b style={{ fontSize: 12 }}>{o.customer.email}</b></div>
          <div><span>State</span><b>{o.customer.suburb}, {o.customer.state}</b></div>
          <div><span>RM</span><b>Priyanka A.</b></div>
        </div>
      </div>
      <div className="card">
        <div className="lp-title">Car</div>
        <div className="kv">
          <div><span>Order · Appt ID</span><b className="mono">{o.id} · …{o.apptId.slice(-6)}</b></div>
          <div><span>Car</span><b>{o.car.year} {o.car.make} {o.car.model}</b></div>
          <div><span>Odometer · colour</span><b>{o.car.km.toLocaleString()} km · {o.car.colour}</b></div>
          <div><span>VIN</span><b className="mono">{o.car.vin}</b></div>
          <div><span>Located at</span><b>{o.car.hub}</b></div>
          {o.interstate && <div><span>Interstate</span><b style={{ color: 'var(--amber-ink)' }}>{o.car.hubState} → {o.customer.state}</b></div>}
          <div><span>Rego</span><b>{(rego?.fields.regoNumber as string) || 'Not yet'}</b></div>
        </div>
      </div>
      <div className="card">
        <div className="lp-title">Money</div>
        <div className="kv">
          <div><span>Payment mode</span><b>{o.paymentMode}</b></div>
          {o.lender && <div><span>Lender</span><b>{o.lender}</b></div>}
          <div><span>Car price</span><b>{money(o.price)}</b></div>
          {o.vas.map((v) => <div key={v.name}><span>+ {v.name}</span><b>{money(v.price)}</b></div>)}
          {o.tradeIn && <div><span>− Trade-in ({o.tradeIn.car})</span><b>{money(o.tradeIn.value)}</b></div>}
          <div><span>Deposit paid</span><b>{money(o.depositPaid)}</b></div>
          <div><span>Outstanding</span><b style={{ color: outstanding(o) > 0 ? 'var(--amber-ink)' : 'var(--green-ink)' }}>{outstanding(o) > 0 ? money(outstanding(o)) : 'Paid'}</b></div>
        </div>
      </div>
      <div className="card">
        <div className="lp-title">Handover</div>
        <div className="kv">
          <div><span>Mode</span><b>{o.deliveryMode}</b></div>
          <div><span>Slot</span><b>{o.slot ? `${o.slot.date} · ${o.slot.time}` : 'Not booked'}</b></div>
          {o.slot && <div><span>Booked by</span><b>{o.slot.by}</b></div>}
          {o.promises.length > 0 && <div style={{ display: 'block' }}><span>Sales promises</span>{o.promises.map((p) => <div key={p} style={{ fontWeight: 600, marginTop: 3 }}>• {p}</div>)}</div>}
        </div>
      </div>
    </div>
  );
}

function SlotCard({ o, onBook, onBypass }: { o: Order; onBook: (d: string, t: string, ov: boolean) => void; onBypass: (on: boolean) => void }) {
  const [date, setDate] = useState('Tue 17 Nov');
  const [time, setTime] = useState('11:00 am');
  const gs = gateStatus(o);
  const clear = gatesClear(o);
  const vasOpen = o.tasks.filter((t) => t.journey === 'vas' && !isDone(t));
  return (
    <div className="card">
      <div className="ct">Delivery slot <span className={'chip ' + (o.slot ? 'c-blue' : clear ? 'c-green' : 'c-amber')}>{o.slot ? 'Booked' : clear ? 'Open' : 'Blocked'}</span></div>
      <div className="cs">Gate today in OMS: <span className="mono">isDeliveryBookingAllowed()</span> — every date back-synced from HubSpot tickets. In LeadVerse each gate is a task on this order.</div>
      <div className="gatebox">
        {gs.map((g) => {
          const na = 'na' in g && g.na; const ov = 'override' in g && g.override;
          return (
            <div key={g.key} className={'gate ' + (ov ? 'ov' : g.ok ? 'ok' : 'no')}>
              <div className="gl">{g.ok ? '✓' : '○'} {g.label}</div>
              <div style={{ color: 'var(--mute)', marginTop: 3 }}>{na ? 'Not interstate' : ov ? 'Bypassed by RM' : g.ok ? 'Done' : `Owner: ${PERSONAS[g.owner].short}`}</div>
            </div>
          );
        })}
      </div>
      {vasOpen.length > 0 && <div className="statusline">{vasOpen.length} VAS item{vasOpen.length > 1 ? 's' : ''} still open ({vasOpen.map((v) => v.item).join(', ')}) — <b>not blocking</b> (R3: warranty, tint, dashcam never hold the slot).</div>}
      {!o.slot && (
        <div className="acts">
          <select className="btn" value={date} onChange={(e) => setDate(e.target.value)}>{['Mon 16 Nov', 'Tue 17 Nov', 'Wed 18 Nov', 'Thu 19 Nov'].map((d) => <option key={d}>{d}</option>)}</select>
          <select className="btn" value={time} onChange={(e) => setTime(e.target.value)}>{['9:00 am', '11:00 am', '1:00 pm', '3:00 pm'].map((d) => <option key={d}>{d}</option>)}</select>
          <button className="btn primary" disabled={!clear} onClick={() => onBook(date, time, false)}>Book & confirm to customer</button>
          {!clear && !isDone(task(o, 'contract')) && (
            <label className="check" style={{ paddingTop: 0 }}>
              <input type="checkbox" checked={o.bypassContract} onChange={(e) => onBypass(e.target.checked)} /> Bypass contract gate
            </label>
          )}
        </div>
      )}
      {!clear && !o.slot && <div className="hs" style={{ marginTop: 8 }}>by_pass_contract_gfd_for_delivery_slots</div>}
    </div>
  );
}

export function OrderView({ o, persona, now, onField, onMove, onDemo, onBook, onBypass, onComms, back }: {
  o: Order; persona: PersonaId; now: number; back: () => void;
  onField: (tid: string, k: string, v: string | boolean) => void; onMove: (tid: string, to: string) => void; onDemo: (tid: string) => void;
  onBook: (d: string, t: string, ov: boolean) => void; onBypass: (on: boolean) => void; onComms: (text: string) => void;
}) {
  const [feed, setFeed] = useState<'all' | 'rule' | 'comms'>('all');
  const mine = o.tasks.filter((t) => PERSONA_JOURNEYS[persona].includes(t.journey));
  const others = o.tasks.filter((t) => !PERSONA_JOURNEYS[persona].includes(t.journey));
  const stage = rmStage(o);
  const si = RM_STAGES.findIndex((s) => s.key === stage);
  const pay = task(o, 'payment');

  return (
    <>
      <div className="head">
        <div>
          <h1>{o.id} · {o.customer.name}</h1>
          <div className="sub">{o.car.year} {o.car.make} {o.car.model} · {o.paymentMode} · deposit {fmtAge(now - o.depositAt)} ago</div>
        </div>
        <span className="chip c-lv" style={{ marginLeft: 'auto' }}>Order stage: {RM_STAGES[si].label}</span>
        <span className="chip c-grey" title="What the HubSpot deal would show">HubSpot deal: {hsDealStage(o)}</span>
        <button className="btn" onClick={back}>← Board</button>
      </div>

      <div className="card">
        <div className="ct">Order journey <span className="cs" style={{ marginTop: 0, marginLeft: 6 }}>derived from the teams' tasks — nobody sets it by hand</span></div>
        <div className="track">
          {RM_STAGES.map((s, i) => (
            <div key={s.key} className={'tstep ' + (i < si || stage === 'delivered' ? 'done' : i === si ? 'act' : '')}>
              <div className="dot">{i < si || stage === 'delivered' ? '✓' : i + 1}</div>
              {s.label}
              <span className="hsl">{s.hs}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rec">
        <LeftPanel o={o} now={now} />

        <div>
          {persona === 'rm' && stage !== 'delivered' && (stage === 'ready' || stage === 'blockers' || stage === 'booked' || stage === 'prep') && (
            <SlotCard o={o} onBook={onBook} onBypass={onBypass} />
          )}
          <div className="card">
            <div className="ct">{PERSONAS[persona].short} tasks on this order <span className="chip c-lv">{mine.filter((t) => stageDef(t).kind !== 'done').length} open</span></div>
            <div className="cs">Fill the properties for the current stage and move it on. Stage changes fire the trigger rules for other teams.</div>
            {mine.length === 0 && <div className="statusline">No {PERSONAS[persona].short} task on this order yet. It is created by a trigger rule when the order reaches your step — see the other teams on the right.</div>}
            {mine.map((t) => (
              <TaskCard key={t.id} order={o} t={t} editable={JOURNEYS[t.journey].persona === persona} now={now} onField={(k, v) => onField(t.id, k, v)} onMove={(to) => onMove(t.id, to)} />
            ))}
          </div>

          {persona === 'rm' && pay && (
            <div className="card">
              <div className="ct">Payment <span className={'chip ' + (isDone(pay) ? 'c-green' : stageDef(pay).kind === 'fail' ? 'c-red' : 'c-amber')}>{stageDef(pay).label}</span><span className="lock">Read-only · FinOps</span></div>
              <div className="cs">{o.paymentMode === 'Cash' ? '01a Cash Customer Finance' : o.paymentMode === 'BYO' ? '01b BYO Finance Customer' : '01d In-house Finance (finance notes and credit data masked for RM)'}</div>
              <div className="acts">
                {!isDone(pay) && <button className="btn" onClick={() => onComms('Remittance flagged to FinOps as a child task with the bank reference — no screenshot needed (R6)')}>Flag a remittance to FinOps</button>}
                <button className="btn" onClick={() => onComms(`Payment reminder sent to ${o.customer.email} with outstanding ${money(outstanding(o))}`)}>Send payment reminder</button>
              </div>
            </div>
          )}

          {persona === 'rm' && (
            <div className="card">
              <div className="ct">Message the customer</div>
              <div className="cs">Templates pull deal fields in; you edit before sending. Every send lands on the timeline (R5, R10).</div>
              <div className="acts">
                {['Roadworthy update with ETA', 'Your car is ready — book handover', 'Contract reminder', 'Handover day checklist'].map((t) => (
                  <button key={t} className="btn sm" onClick={() => onComms(`Email + SMS sent: "${t}" to ${o.customer.name}`)}>{t}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="rp">
          <div className="card">
            <div className="ct">Other teams</div>
            <div className="cs">Read-only. Each card is another persona's task on this order.</div>
            {others.length === 0 && <div className="statusline">No other team has a task yet.</div>}
            {others.map((t) => {
              const def = JOURNEYS[t.journey];
              const s = stageDef(t);
              const p = PERSONAS[def.persona];
              const keyField = (s.fields || []).map((fd) => t.fields[fd.key] && `${fd.label}: ${t.fields[fd.key] === true ? 'Yes' : t.fields[fd.key]}`).filter(Boolean).slice(0, 2);
              const done = Object.entries(t.fields).filter(([k]) => ['rwcNumber', 'regoNumber', 'reworkEta', 'transitEta', 'installDate'].includes(k)).map(([k, v]) => `${k === 'rwcNumber' ? 'RWC' : k === 'regoNumber' ? 'Rego' : k === 'reworkEta' ? 'Rework ETA' : k === 'transitEta' ? 'Hub ETA' : 'Install'} ${v}`);
              return (
                <div key={t.id} className="ro-card">
                  <div className="rh"><span className="who" style={{ background: p.color }} />{def.name}{t.item ? ' · ' + t.item : ''}<span className="chip c-grey" style={{ marginLeft: 'auto' }}>{p.short}</span></div>
                  <div className="rs"><span className={'chip ' + (s.kind === 'done' ? 'c-green' : s.kind === 'fail' ? 'c-red' : 'c-lv')}>{s.label}</span> <span className="age" style={{ marginLeft: 6 }}>{fmtAge(now - t.enteredAt)}</span></div>
                  {(done.length > 0 || keyField.length > 0) && <div className="rf">{[...new Set([...done, ...(keyField as string[])])].join(' · ')}</div>}
                  {t.journey === 'vas' && <div className="rf">Doesn't block the slot</div>}
                  {s.next && s.kind !== 'done' && <div className="acts" style={{ marginTop: 7 }}><button className="btn sm demo" onClick={() => onDemo(t.id)}>Demo: {p.short} → {s.next[0].label}</button></div>}
                </div>
              );
            })}
          </div>
          <div className="card">
            <div className="ct">Timeline</div>
            <div className="ftabs">
              {(['all', 'rule', 'comms'] as const).map((k) => <button key={k} className={'fchip' + (feed === k ? ' on' : '')} onClick={() => setFeed(k)}>{k === 'all' ? 'All' : k === 'rule' ? 'Workflow rules' : 'Comms'}</button>)}
            </div>
            <div className="feed">
              {o.activity.filter((a) => feed === 'all' || (feed === 'rule' ? a.kind === 'rule' || a.kind === 'gate' : a.kind === 'comms')).slice(0, 40).map((a, i) => (
                <div key={i} className="fe">
                  <span className={'ic ' + a.kind}>{a.kind === 'rule' ? 'R' : a.kind === 'comms' ? '✉' : a.kind === 'gate' ? '✓' : a.kind === 'block' ? '!' : '•'}</span>
                  <div>
                    <div className="ft">{a.text}</div>
                    <div className="fm">{a.who} · {fmtAge(now - a.at)} ago{a.rule ? ' · ' + a.rule + ' ' + (RULES.find((r) => r.id === a.rule)?.when || '') : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
