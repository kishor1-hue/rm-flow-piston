import { useEffect, useState } from 'react';
import { JOURNEYS, PERSONAS, RM_STAGES, type PersonaId, type TransitionDef } from './model';
import {
  availableNext, canMove, fmtAge, gatesClear, gateStatus, hsDealStage, isDone, missingFields, money, outstanding,
  prevStage, rmStage, slaState, stageDef, task, type Order, type Task,
  CRN_NAME, DOC_LABEL, docOutdated, needsCrn, regenerateDoc, type DocKey,
} from './engine';
import { PERSONA_JOURNEYS } from './Board';
import { Field } from './TaskCard';
import { firstOpenStep, RmFlow, type RmStep } from './RmFlow';

function aiSummary(o: Order, now: number) {
  const parts: string[] = [];
  const days = Math.ceil((now - o.depositAt) / 86400000);
  parts.push(`${o.customer.name.split(' ')[0]} paid a deposit ${days === 1 ? 'today' : days + ' days ago'} for a ${o.car.year} ${o.car.make} ${o.car.model} (${o.paymentMode}${o.lender ? ' · ' + o.lender : ''}).`);
  const open = gateStatus(o).filter((g) => !g.ok).map((g) => g.label);
  if (rmStage(o) === 'delivered') parts.push('Handed over; CX check-ins are running.');
  else if (o.slot) parts.push(`Handover booked ${o.slot.date} at ${o.slot.time}.`);
  else if (open.length) parts.push(`Slot blocked by ${open.join(', ')}.`);
  else parts.push('Every gate is clear — book the slot.');
  const rwc = task(o, 'rwc');
  if (rwc?.stage === 'fail') parts.push(`RWC failed; rework ETA ${rwc.fields.reworkEta}.`);
  if (o.promises.length) parts.push(`Promised: ${o.promises.join('; ')}.`);
  return parts.join(' ');
}

type Item = { kind: 'task'; t: Task } | { kind: 'slot' };

type KV = [string, string];

// Document Workflow: every customer document on the order, its version, and the regenerate API when the order changed after it was issued.
function DocWorkflow({ o, now, onAct }: { o: Order; now: number; onAct: (fn: (o: Order, at: number) => void) => void }) {
  const c = task(o, 'contract');
  const docStatus: Record<DocKey, string> = {
    contract: isDone(c) ? 'Signed' : c && ['sent', 'form4', 'review'].includes(c.stage) ? 'Sent · unsigned' : 'Draft',
    invoice: 'Issued',
  };
  return (
    <>
      <div className="lp-title">Document Workflow</div>
      <div className="cs" style={{ marginBottom: 8 }}>If the order changes (discount, VAS, trade-in, delivery fee), regenerate the affected documents before the next step.</div>
      {(['contract', 'invoice'] as DocKey[]).map((k) => {
        const stale = docOutdated(o, k);
        return (
          <div key={k} className={'doc-card' + (stale ? ' stale' : '')}>
            <div className="dh"><b>{DOC_LABEL[k]}</b><span className={'chip ' + (stale ? 'c-amber' : 'c-green')}>{stale ? 'Outdated' : 'Up to date'}</span></div>
            <div className="dm">v{o.docs[k].v} · {docStatus[k]} · generated {fmtAge(now - o.docs[k].at)} ago</div>
            {stale && <div className="dm warn">Order changed {fmtAge(now - o.changedAt)} ago, after this version.</div>}
            <div className="dact">
              <button className={'btn sm' + (stale ? ' primary' : '')} onClick={() => onAct((x, at) => regenerateDoc(x, k, at))}>↻ Regenerate</button>
              <span className="hs">POST /documents/{k.toUpperCase()}/regenerate</span>
            </div>
          </div>
        );
      })}
      <div className="doc-card">
        <div className="dh"><b>Driver's licence</b><span className={'chip ' + (o.dl.status === 'Verified' ? 'c-green' : 'c-grey')}>{o.dl.status}</span></div>
        <div className="dm">{o.dl.state} {o.dl.number} · expires {o.dl.expiry} · uploaded by customer</div>
        {needsCrn(o) && <div className="dm">{CRN_NAME[o.customer.state]}: <b>{o.dl.crn || (o.dl.status === 'ID requested' ? `requested ${fmtAge(now - (o.dl.requestedAt || now))} ago` : 'needed')}</b></div>}
      </div>
      {o.tradeIn && <div className="doc-card"><div className="dh"><b>Form 4 (trade-in)</b><span className="chip c-grey">{c && ['form4', 'review', 'signed'].includes(c.stage) ? 'Received' : 'Pending'}</span></div><div className="dm">{o.tradeIn.car}</div></div>}
    </>
  );
}

function LeftPanel({ o, now, persona, onDemo, onComms, onAct, collapsed, toggle }: {
  o: Order; now: number; persona: PersonaId; onDemo: (tid: string) => void; onComms: (text: string) => void; onAct: (fn: (o: Order, at: number) => void) => void; collapsed: boolean; toggle: () => void;
}) {
  const [tab, setTab] = useState<'contact' | 'order' | 'car' | 'pricing' | 'docs' | 'teams' | 'activity'>('contact');
  const [feed, setFeed] = useState<'all' | 'rule' | 'comms'>('all');
  const [find, setFind] = useState('');
  const [note, setNote] = useState('');
  const [vis, setVis] = useState('Everyone');
  const [follow, setFollow] = useState(true);
  const others = o.tasks.filter((t) => !PERSONA_JOURNEYS[persona].includes(t.journey));
  const rego = task(o, 'rego');
  const [first, ...rest] = o.customer.name.split(' ');
  const groups: Record<string, KV[]> = {
    contact: [['First Name', first], ['Last Name', rest.join(' ')], ['Email', o.customer.email], ['Phone With Country Code', o.customer.phone], ['Suburb', o.customer.suburb], ['State', o.customer.state], ['Relationship Manager', 'Priyanka A.']],
    order: [['Order ID', o.id], ['Appointment ID', o.apptId], ['Order stage', RM_STAGES.find((s) => s.key === rmStage(o))!.label], ['HubSpot deal stage', hsDealStage(o)], ['Payment mode', o.paymentMode + (o.lender ? ' · ' + o.lender : '')], ['Payment method', o.paymentMethod], ['Proof of payment', o.proofUrl || '—'], ['Sales promise?', o.promises.length ? 'Yes' : 'No'], ...o.promises.map((p): KV => ['Sales promise', p]), ['Discount', o.discount ? `${money(o.discount.amount)} · ${o.discount.status}` : 'None'], ['Trade-in', o.tradeIn ? `${o.tradeIn.car} · ${money(o.tradeIn.value)}` : 'No'], ['Shipping charges', o.shipping ? money(o.shipping) : '$0'], ['Delivery mode', o.deliveryMode], ['Delivery slot', o.slot ? `${o.slot.date} · ${o.slot.time}` : 'Not booked']],
    car: [['Car', `${o.car.year} ${o.car.make} ${o.car.model}`], ['Odometer', o.car.km.toLocaleString() + ' km'], ['Colour', o.car.colour], ['VIN', o.car.vin], ['Located at', o.car.hub], ...(o.interstate ? [['Interstate', `${o.car.hubState} → ${o.customer.state}`] as KV] : []), ['Rego', (rego?.fields.regoNumber as string) || 'Not yet']],
    pricing: [['Car price', money(o.price)], ...o.vas.map((v): KV => ['+ ' + v.name, money(v.price)]), ...(o.tradeIn ? [['− Trade-in', money(o.tradeIn.value)] as KV] : []), ['Outstanding', outstanding(o) > 0 ? money(outstanding(o)) : 'Paid']],
  };
  const fl = find.trim().toLowerCase();
  const boxes = (kv: KV[]) => kv.filter(([k, v]) => !fl || (k + v).toLowerCase().includes(fl)).map(([k, v], i) => (
    <div key={k + i} className="fbox"><label>{k}</label><div>{v || '-'}</div></div>
  ));
  const TABS = [['contact', '☺ Contact'], ['order', '▤ Order'], ['car', '⛟ Car'], ['pricing', '$ Pricing'], ['docs', `▣ Document Workflow${(['contract', 'invoice'] as DocKey[]).some((k) => docOutdated(o, k)) ? ' ·!' : ''}`], ['teams', `Teams · ${others.filter((t) => stageDef(t).kind !== 'done').length}`], ['activity', 'Activity']] as const;
  return (
    <div className={'ws-left' + (collapsed ? ' shut' : '')}>
      <button className="lp-tog" aria-label={collapsed ? 'Show details' : 'Hide details'} onClick={toggle}>{collapsed ? '›' : '‹'}</button>
      {!collapsed && (
        <>
          <div className="ws-id">
            <div className="avatar">{first[0]}</div>
            <div className="ws-name">{o.customer.name}</div>
            <button className={'follow' + (follow ? ' on' : '')} onClick={() => setFollow(!follow)}>{follow ? '◉ Following · 1' : '○ Follow'}</button>
          </div>
          <div className="lp-search"><input placeholder="Search" value={find} onChange={(e) => setFind(e.target.value)} /></div>
          <div className="ws-tabs">
            {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          <div className="ws-scroll">
            {tab in groups && (
              <>
                {tab === 'contact' && <div className="summary-box"><b>✦ Summary</b><p>{aiSummary(o, now)}</p></div>}
                <div className="lp-title">{({ contact: 'Contact', order: 'Order', car: 'Car', pricing: 'Pricing' } as Record<string, string>)[tab]}</div>
                {boxes(groups[tab])}
                {tab === 'contact' && (
                  <>
                    <div className="lp-title" style={{ marginTop: 18 }}>Sales promise</div>
                    {boxes([['Sales promise?', o.promises.length ? 'Yes' : 'No'], ['Promised by the ground team', o.promises.length ? o.promises.join(' · ') : '—']])}
                    <div className="hs" style={{ marginTop: 4 }}>sales_promise_ · notes_to_add_sales_promise</div>
                  </>
                )}
              </>
            )}
            {tab === 'teams' && (
              <>
                <div className="cs" style={{ marginBottom: 6 }}>Other teams' tasks on this order. Read-only for {PERSONAS[persona].short}.</div>
                {others.length === 0 && <div className="statusline">No other team has a task yet.</div>}
                {others.map((t) => {
                  const def = JOURNEYS[t.journey];
                  const s = stageDef(t);
                  const p = PERSONAS[def.persona];
                  const facts = Object.entries(t.fields)
                    .filter(([k, v]) => v && ['rwcNumber', 'regoNumber', 'reworkEta', 'transitEta', 'installDate', 'qcEta', 'panelInfo'].includes(k))
                    .map(([k, v]) => `${({ rwcNumber: 'RWC', regoNumber: 'Rego', reworkEta: 'Rework ETA', transitEta: 'Hub ETA', installDate: 'Install', qcEta: 'QC fix ETA', panelInfo: 'Issue' } as Record<string, string>)[k]} ${v}`);
                  const nx = availableNext(o, t)[0];
                  return (
                    <div key={t.id} className="ro-card">
                      <div className="rh"><span className="who" style={{ background: p.color }} />{def.name}{t.item ? ' · ' + t.item : ''}<span className="chip c-grey" style={{ marginLeft: 'auto' }}>{p.short}</span></div>
                      <div className="rs"><span className={'chip ' + (s.kind === 'done' ? 'c-green' : s.kind === 'fail' ? 'c-red' : 'c-lv')}>{s.label}</span> <span className="age" style={{ marginLeft: 6 }}>{fmtAge(now - t.enteredAt)}</span></div>
                      {facts.length > 0 && <div className="rf">{facts.join(' · ')}</div>}
                      {t.journey === 'vas' && <div className="rf">Doesn't block the slot</div>}
                      {nx && s.kind !== 'done' && <div className="acts" style={{ marginTop: 7 }}><button className="btn sm demo" onClick={() => onDemo(t.id)}>Demo: {p.short} → {nx.label}</button></div>}
                    </div>
                  );
                })}
              </>
            )}
            {tab === 'docs' && <DocWorkflow o={o} now={now} onAct={onAct} />}
            {tab === 'activity' && (
              <>
                <div className="ftabs" style={{ marginTop: 0 }}>
                  {(['all', 'rule', 'comms'] as const).map((k) => <button key={k} className={'fchip' + (feed === k ? ' on' : '')} onClick={() => setFeed(k)}>{k === 'all' ? 'All' : k === 'rule' ? 'Workflow rules' : 'Notes & comms'}</button>)}
                </div>
                <div className="feed">
                  {o.activity.filter((a) => feed === 'all' || (feed === 'rule' ? a.kind === 'rule' || a.kind === 'gate' : a.kind === 'comms')).slice(0, 50).map((a, i) => (
                    <div key={i} className="fe">
                      <span className={'ic ' + a.kind}>{a.kind === 'rule' ? 'R' : a.kind === 'comms' ? '✉' : a.kind === 'gate' ? '✓' : a.kind === 'block' ? '!' : '•'}</span>
                      <div>
                        <div className="ft">{a.text}</div>
                        <div className="fm">{a.who} · {fmtAge(now - a.at)} ago{a.rule ? ' · ' + a.rule : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="lp-foot">
            <div className="vis">◎ Visible to <select value={vis} onChange={(e) => setVis(e.target.value)}><option>Everyone</option><option>My team</option><option>Only me</option></select></div>
            <div className="note">
              <input placeholder="⌀ Add a note…" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && note.trim()) { onComms(`Note (${vis}): ${note.trim()}`); setNote(''); } }} />
              <button disabled={!note.trim()} onClick={() => { onComms(`Note (${vis}): ${note.trim()}`); setNote(''); }}>Add</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stepper({ t, open, toggle }: { t: Task; open: boolean; toggle: () => void }) {
  const def = JOURNEYS[t.journey];
  const cur = stageDef(t);
  const path = def.stages.filter((s) => !s.kind || s.kind === 'done' || s.key === t.stage);
  const ci = path.findIndex((s) => s.key === t.stage);
  const shown = path.filter((s, i) => s.kind !== 'done' || i === path.length - 1 || s.key === t.stage);
  return (
    <div className={'stepper' + (open ? '' : ' mini')}>
      {shown.map((s) => {
        const i = path.indexOf(s);
        const st = s.key === t.stage ? (s.kind === 'fail' ? 'fail' : cur.kind === 'done' ? 'done' : 'act') : i < ci ? 'done' : '';
        return (
          <div key={s.key} className={'sp ' + st}>
            <div className="spdot">{st === 'done' ? '✓' : st === 'fail' ? '!' : ''}</div>
            <div className="spl">{s.label}</div>
            <div className="sps">{st === 'done' ? 'completed' : st === 'act' ? 'in progress' : st === 'fail' ? 'blocked' : 'pending'}</div>
          </div>
        );
      })}
      <button className="stog" aria-label={open ? 'Collapse steps' : 'Expand steps'} onClick={toggle}>{open ? '⌃' : '⌄'}</button>
    </div>
  );
}

function Tiles({ o }: { o: Order }) {
  const pay = task(o, 'payment');
  const con = task(o, 'contract');
  const prep = (['rwc', 'rego', 'refurb'] as const).map((j) => task(o, j)).find((t) => t && !isDone(t));
  const tiles = [
    { k: 'Payment', v: pay ? stageDef(pay).label : '—', s: outstanding(o) > 0 ? `${money(outstanding(o))} outstanding` : 'Paid in full', bad: pay && stageDef(pay).kind === 'fail' },
    { k: 'Contract', v: con ? stageDef(con).label : '—', s: o.bypassContract ? 'Gate bypassed by RM' : 'RM-owned', bad: con && stageDef(con).kind === 'fail' },
    { k: 'Car prep', v: prep ? `${JOURNEYS[prep.journey].name}: ${stageDef(prep).label}` : task(o, 'rwc') ? 'Refurb GFD ✓' : 'Waiting for GFR', s: prep?.fields.reworkEta ? `Rework ETA ${prep.fields.reworkEta}` : prep?.fields.qcEta ? `QC fix ETA ${prep.fields.qcEta}` : hsDealStage(o), bad: prep && stageDef(prep).kind === 'fail' },
    { k: 'Slot', v: o.slot ? `${o.slot.date} · ${o.slot.time}` : gatesClear(o) ? 'Open to book' : 'Blocked', s: `${gateStatus(o).filter((g) => g.ok).length}/${gateStatus(o).length} gates clear`, bad: false },
  ];
  return (
    <div className="tiles">
      {tiles.map((x) => (
        <div key={x.k} className={'tile' + (x.bad ? ' bad' : '')}>
          <div className="tk">{x.k}</div>
          <div className="tv">{x.v}</div>
          <div className="ts">{x.s}</div>
        </div>
      ))}
    </div>
  );
}

// Payment ledger + price breakup, laid out like the Leadverse Final Payment screen.
function Payments({ o, t }: { o: Order; t: Task }) {
  const s = stageDef(t);
  const rows: [string, string, number, string, string][] = o.payments.map((x) => [x.type, x.ref, x.amount, s.key === 'short' && x.type === 'BALANCE' ? 'SHORT' : 'SUCCESS', x.by]);
  return (
    <>
      <div className="lp-title" style={{ marginTop: 18 }}>Payments</div>
      <div className="tbox">
        <table className="tl-t"><thead><tr><th>Payment Type</th><th>Transaction ID</th><th>Amount</th><th>Status</th><th>Approved by</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r[0]}><td>{r[0]}</td><td className="mono">{r[1]}</td><td>{r[2] ? money(r[2]) : '—'}</td><td><span className={'code ' + (r[3] === 'SUCCESS' ? 'c-green' : 'c-amber')}>{r[3]}</span></td><td>{r[4]}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="lp-title" style={{ marginTop: 18 }}>Price breakup</div>
      <div className="tbox">
        <table className="tl-t"><thead><tr><th>Label</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
          <tbody>
            <tr><td>Car price</td><td style={{ textAlign: 'right' }}>{money(o.price)}</td></tr>
            {o.vas.map((v) => <tr key={v.name}><td>{v.name}</td><td style={{ textAlign: 'right' }}>{money(v.price)}</td></tr>)}
            {o.tradeIn && <tr><td>Trade-in</td><td style={{ textAlign: 'right' }}>− {money(o.tradeIn.value)}</td></tr>}
            <tr><td><b>Outstanding</b></td><td style={{ textAlign: 'right' }}><b>{outstanding(o) > 0 ? money(outstanding(o)) : 'Paid'}</b></td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function CarGpt({ o, item, now, open, toggle }: { o: Order; item?: Item; now: number; open: boolean; toggle: () => void }) {
  const [q, setQ] = useState('');
  const [answers, setAnswers] = useState<{ q: string; a: string }[]>([]);
  const first = o.customer.name.split(' ')[0];
  let say = '', context: string[] = [], watch: string[] = [];
  if (!item) say = aiSummary(o, now);
  else if (item.kind === 'slot') {
    say = `"Hi ${first}, it's Priyanka from CARS24 — great news, your ${o.car.make} ${o.car.model} is ready. Which day suits you for the handover at ${o.car.hub.split(' · ')[0]}?"`;
    context = [`Gates: ${gateStatus(o).map((g) => `${g.label} ${g.ok ? '✓' : '○'}`).join(' · ')}`];
    if (o.vas.length) context.push(`VAS (${o.vas.map((v) => v.name).join(', ')}) never holds the slot.`);
  } else {
    const t = item.t;
    const s = stageDef(t);
    const j = t.journey;
    if (j === 'payment') say = s.key === 'deposit' ? `Match the ${money(o.depositPaid)} transfer in the proof against the bank statement before confirming.` : `"Hi ${first}, it's Priyanka from CARS24, your relationship manager. Congratulations on the ${o.car.year} ${o.car.make} ${o.car.model}! I'll walk you through what happens next and the ${money(outstanding(o))} balance."`;
    else if (j === 'contract') say = `"Hi ${first}, your contract of sale is in your inbox from DocuSign. It takes about two minutes to sign${o.tradeIn ? ', and there is a Form 4 for your trade-in' : ''}."`;
    else if (j === 'rwc') say = s.key === 'fail' ? `Tell the RM: "${o.id} failed roadworthy — ${t.fields.panelInfo || 'issue being logged'}. Rework ETA ${t.fields.reworkEta || 'to be set'}."` : `Book ${o.id} into the RWC bay at ${o.car.hub.split(' · ')[0]}.`;
    else if (j === 'rego') say = `${o.customer.state} rule: ${o.customer.state === 'VIC' ? 'generate the VIC certificate (check digit + TAC charge needed).' : o.customer.state === 'QLD' ? 'submit to TMR with the RWC number, issue date and link.' : 'NSW goes straight to Registration complete.'}`;
    else if (j === 'refurb') say = o.promises.length ? `Sales promised: ${o.promises.join('; ')}. Tick them off before detailing.` : 'No sales promises on this order. Detail and send to QC.';
    else if (j === 'delivery') say = `"Hi ${first}, I'm at ${o.car.hub.split(' · ')[0]} with your ${o.car.make}. Before we go: odometer, a walk-around, then your signature on the handover form."`;
    else if (j === 'vas') say = `Book ${t.item} with the installer. It can go in after handover — it never holds the slot.`;
    else say = s.guide || '';
    context = [s.guide || '', s.auto ? `HubSpot today: ${s.auto}.` : ''].filter(Boolean);
    const miss = missingFields(t, availableNext(o, t)[0]?.requires);
    if (miss.length) watch.push(`Required to move on: ${miss.map((k) => (s.fields || []).find((f) => f.key === k)?.label).join(', ')}.`);
    if (slaState(t, now) === 'breach') watch.push(`SLA breached — ${fmtAge(now - t.enteredAt)} in "${s.label}" (SLA ${s.slaHours}h).`);
  }
  if (o.interstate) context.push(`Interstate car: ${o.car.hubState} → ${o.customer.state}; hub arrival is a gate.`);
  if (o.paymentMode !== 'Cash') context.push(`${o.paymentMode}${o.lender ? ' with ' + o.lender : ''}: GFR came from the lender approval, not a payment.`);
  const ask = () => {
    if (!q.trim()) return;
    const ql = q.toLowerCase();
    const a = ql.includes('slot') || ql.includes('book') ? (gatesClear(o) ? 'All gates are clear. Book from the Delivery slot step.' : `Not yet. Open gates: ${gateStatus(o).filter((g) => !g.ok).map((g) => g.label).join(', ')}.`)
      : ql.includes('pay') || ql.includes('owe') || ql.includes('balance') ? `Outstanding ${money(outstanding(o))}. Payment ticket is at "${stageDef(task(o, 'payment')!).label}".`
      : aiSummary(o, now);
    setAnswers([...answers, { q, a }]);
    setQ('');
  };
  if (!open) return <div className="ws-right shut"><button className="gpt-rail" onClick={toggle}><span className="gpt-chev">‹</span><span className="gpt-star">✦</span><span>CarGPT</span></button></div>;
  return (
    <div className="ws-right">
      <div className="gpt-head">✦ CarGPT<button className="gpt-x" aria-label="Collapse CarGPT" onClick={toggle}>›</button></div>
      <div className="gpt-scroll">
        <div className="gpt-card"><div className="gk">Say this</div><div className="gv">{say}</div></div>
        {context.length > 0 && <div className="gpt-card"><div className="gk">Use the context</div>{context.map((c) => <div key={c} className="gv">{c}</div>)}</div>}
        {watch.length > 0 && <div className="gpt-card warn"><div className="gk">Watch out</div>{watch.map((c) => <div key={c} className="gv">{c}</div>)}</div>}
        {answers.map((x, i) => <div key={i} className="gpt-card"><div className="gk">You asked: {x.q}</div><div className="gv">{x.a}</div></div>)}
      </div>
      <div className="gpt-input">
        <input id="gpt-q" placeholder="Ask about this order…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} />
        <button className="btn primary sm" onClick={ask}>Ask</button>
      </div>
    </div>
  );
}

export function OrderView({ o, persona, now, focus, onFocus, onField, onMove, onDemo, onBook, onBypass, onComms, onAct }: {
  o: Order; persona: PersonaId; now: number; back: () => void; focus?: string; onFocus: (tid?: string) => void;
  onAct: (fn: (o: Order, at: number) => void) => void;
  onField: (tid: string, k: string, v: string | boolean) => void; onMove: (tid: string, to: string) => void; onDemo: (tid: string) => void;
  onBook: (d: string, t: string, ov: boolean) => void; onBypass: (on: boolean) => void; onComms: (text: string) => void;
}) {
  const mine = o.tasks.filter((t) => PERSONA_JOURNEYS[persona].includes(t.journey));
  const items: Item[] = [...mine.map((t) => ({ kind: 'task' as const, t })), ...(persona === 'rm' ? [{ kind: 'slot' as const }] : [])];
  const defaultKey = () => {
    const open = mine.find((t) => !isDone(t));
    if (persona === 'rm' && (!open || (rmStage(o) === 'ready' && !o.slot))) return 'slot';
    return open?.id || mine[0]?.id || (persona === 'rm' ? 'slot' : '');
  };
  const pick = () => (focus && mine.some((t) => t.id === focus) ? focus : defaultKey());
  const [sel, setSelRaw] = useState<string>(pick);
  const setSel = (k: string) => { setSelRaw(k); onFocus(k === 'slot' ? undefined : k); };
  const [menu, setMenu] = useState(false);
  const [leftShut, setLeftShut] = useState(false);
  const [gptOpen, setGptOpen] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(true);
  const [rmStep, setRmStep] = useState<RmStep>(() => firstOpenStep(o));
  useEffect(() => { setRmStep(firstOpenStep(o)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [o.id]);
  const rmItem: Item | undefined = rmStep === 'delivery' ? { kind: 'slot' } : rmStep === 'deposit' || rmStep === 'balance' ? { kind: 'task', t: task(o, 'payment')! } : rmStep === 'docs' ? { kind: 'task', t: task(o, 'contract')! } : undefined;
  const [date, setDate] = useState('Tue 17 Nov');
  const [time, setTime] = useState('11:00 am');
  useEffect(() => { setSel(pick()); setMenu(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [o.id, persona]);
  const item: Item | undefined = sel === 'slot' ? (persona === 'rm' ? { kind: 'slot' } : undefined) : (() => { const t = mine.find((x) => x.id === sel); return t ? { kind: 'task' as const, t } : undefined; })();
  const t = item?.kind === 'task' ? item.t : undefined;
  const s = t ? stageDef(t) : undefined;
  const nexts: TransitionDef[] = t ? availableNext(o, t) : [];
  const primary = nexts[0];
  const prev = t ? prevStage(t) : null;
  const blockReason = (n: TransitionDef) => {
    if (!t) return '';
    const miss = missingFields(t, n.requires);
    if (miss.length) return 'Fill first: ' + miss.map((k) => (s!.fields || []).find((f) => f.key === k)?.label || k).join(', ');
    const c = canMove(o, t, n.to);
    return c.ok ? '' : c.reason!;
  };
  const doNext = (n: TransitionDef) => { if (t && !blockReason(n)) { onMove(t.id, n.to); setMenu(false); } };
  const clear = gatesClear(o);
  const extra = [
    { label: `Call ${o.customer.name.split(' ')[0]}`, run: () => onComms(`Call to ${o.customer.phone} logged with recording and transcript`) },
    { label: 'Call back later', run: () => onComms('Call back scheduled for tomorrow 10:00 am (task reminder set)') },
    { label: 'Raise a task for another team', run: () => onComms('Child task raised: "Please confirm ETA" → assigned to the owning team') },
    { label: 'Add internal note', run: () => onComms('Internal note added to the order') },
  ];

  return (
    <div className={'ws' + (leftShut ? ' lshut' : '') + (gptOpen ? '' : ' rshut')}>
      <LeftPanel o={o} now={now} persona={persona} onDemo={onDemo} onComms={onComms} onAct={onAct} collapsed={leftShut} toggle={() => setLeftShut(!leftShut)} />

      {persona === 'rm' ? (
        <div className="ws-mid">
          <div className="ws-items">
            <span className="ws-oid"><b>{o.id}</b> · {o.car.year} {o.car.make} {o.car.model} · {o.paymentMode} · {o.customer.state}</span>
            <span className="chip c-grey" style={{ marginLeft: 'auto' }} title="What the HubSpot deal would show">HubSpot deal: {hsDealStage(o)}</span>
          </div>
          <RmFlow o={o} step={rmStep} setStep={setRmStep} stepsOpen={stepsOpen} toggleSteps={() => setStepsOpen(!stepsOpen)}
            onField={onField} onMove={onMove} onBook={onBook} onBypass={onBypass} onComms={onComms} act={onAct} />
        </div>
      ) : (
      <div className="ws-mid">
        <div className="ws-items">
          <span className="ws-oid"><b>{o.id}</b> · {o.car.year} {o.car.make} {o.car.model}</span>
          {items.map((it) => {
            const key = it.kind === 'slot' ? 'slot' : it.t.id;
            const label = it.kind === 'slot' ? 'Delivery slot' : JOURNEYS[it.t.journey].name + (it.t.item ? ' · ' + it.t.item : '');
            const st = it.kind === 'slot' ? (o.slot ? 'Booked' : clear ? 'Open' : 'Blocked') : stageDef(it.t).label;
            const tone = it.kind === 'slot' ? (o.slot ? 'c-blue' : clear ? 'c-green' : 'c-amber') : stageDef(it.t).kind === 'done' ? 'c-green' : stageDef(it.t).kind === 'fail' ? 'c-red' : 'c-lv';
            return (
              <button key={key} className={'witem' + (sel === key ? ' on' : '')} onClick={() => { setSel(key); setMenu(false); }}>
                <span>{label}</span><span className={'chip ' + tone}>{st}</span>
              </button>
            );
          })}
          <span className="chip c-grey" style={{ marginLeft: 'auto' }} title="What the HubSpot deal would show">HubSpot deal: {hsDealStage(o)}</span>
          {items.length === 0 && <div className="statusline" style={{ marginTop: 0, width: '100%' }}>No {PERSONAS[persona].short} task on this order yet. A trigger rule creates it when the order reaches your step — see the Teams tab.</div>}
        </div>

        {t && s && (
          <>
            <Stepper t={t} open={stepsOpen} toggle={() => setStepsOpen(!stepsOpen)} />
            <div className="ws-body">
              <div className="ws-h">{s.label}{slaState(t, now) === 'breach' && <span className="chip c-red">SLA breached</span>}{t.journey === 'vas' && <span className="chip c-grey">Doesn't block slot</span>}</div>
              <div className="ws-guide">{s.guide || JOURNEYS[t.journey].why}</div>
              {t.journey === 'payment' && <Payments o={o} t={t} />}
              {(s.fields || []).length > 0 && s.kind !== 'done' && (
                <>
                  <div className="lp-title" style={{ marginTop: 18 }}>Properties for this stage <span className="cs" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>· * required by HubSpot to enter the next stage</span></div>
                  <div className="fields">
                    {s.fields!.map((fd) => (
                      <div key={fd.key}>
                        <Field fd={{ ...fd, label: fd.label + (nexts.some((n) => n.requires?.includes(fd.key)) ? ' *' : '') }} value={t.fields[fd.key]} editable onChange={(v) => onField(t.id, fd.key, v)} />
                        {fd.hs && fd.hs !== 'NEW' && <div className="hs" style={{ marginTop: 3 }}>{fd.hs}</div>}
                      </div>
                    ))}
                  </div>
                </>
              )}
              {s.kind === 'done' && <div className="statusline">Done {fmtAge(now - t.enteredAt)} ago. {s.auto ? `HubSpot today: ${s.auto}.` : ''}</div>}
              <div className="statusline">
                <b>{JOURNEYS[t.journey].hsPipeline}</b> → {s.hs}
                {s.auto && s.kind !== 'done' && <div style={{ marginTop: 3 }}>Moves today: {s.auto}</div>}
                {s.slaHours ? <div style={{ marginTop: 3 }}>SLA {s.slaHours}h{s.slaText ? ` · ${s.slaText}` : ''} · in stage {fmtAge(now - t.enteredAt)}</div> : null}
              </div>
              {primary && blockReason(primary) && <div className="blocked">{blockReason(primary)}</div>}
            </div>
          </>
        )}

        {item?.kind === 'slot' && (
          <div className="ws-body">
            <div className="ws-h">Delivery slot</div>
            <div className="ws-guide">The slot opens when Finance GFD, contract signed, registered and Refurb GFD are all done (HubSpot DW06a) and, for interstate cars, the car is at the hub (OMS <span className="mono">isDeliveryBookingAllowed()</span>).</div>
            <Tiles o={o} />
            <div className="gatebox">
              {gateStatus(o).map((g) => {
                const na = 'na' in g && g.na; const ov = 'override' in g && g.override;
                return (
                  <div key={g.key} className={'gate ' + (ov ? 'ov' : g.ok ? 'ok' : 'no')}>
                    <div className="gl">{g.ok ? '✓' : '○'} {g.label}</div>
                    <div style={{ color: 'var(--mute)', marginTop: 3 }}>{na ? 'Not interstate' : ov ? 'Bypassed by RM' : g.ok ? 'Done' : `Owner: ${PERSONAS[g.owner].short}`}</div>
                  </div>
                );
              })}
            </div>
            {!o.slot && (
              <div className="fields" style={{ maxWidth: 420 }}>
                <div className="fld"><label>Date</label><select id="slot-date" value={date} onChange={(e) => setDate(e.target.value)}>{['Mon 16 Nov', 'Tue 17 Nov', 'Wed 18 Nov', 'Thu 19 Nov'].map((d) => <option key={d}>{d}</option>)}</select></div>
                <div className="fld"><label>Time</label><select id="slot-time" value={time} onChange={(e) => setTime(e.target.value)}>{['9:00 am', '11:00 am', '1:00 pm', '3:00 pm'].map((d) => <option key={d}>{d}</option>)}</select></div>
              </div>
            )}
            {o.slot && <div className="statusline">Booked for <b>{o.slot.date} · {o.slot.time}</b> by {o.slot.by}. Confirmation sent by email and SMS.</div>}
            {!clear && !o.slot && <div className="blocked">Blocked by: {gateStatus(o).filter((g) => !g.ok).map((g) => g.label).join(', ')}</div>}
          </div>
        )}

        <div className="ws-foot">
          <button className="btn prevb" disabled={!t || !prev || s?.kind === 'done'} onClick={() => t && prev && onMove(t.id, prev)}>Previous</button>
          <span className="exit">
            {t ? `Exit: ${JOURNEYS[t.journey].stages.find((x) => x.kind === 'done')?.label}` : item?.kind === 'slot' ? 'Exit: slot booked, customer confirmed' : ''}
          </span>
          <div className="split">
            {t && primary && (
              <button className="btn primary" disabled={!!blockReason(primary)} title={blockReason(primary)} onClick={() => doNext(primary)}>Next: {primary.label}</button>
            )}
            {t && !primary && <button className="btn primary" disabled>{s?.kind === 'done' ? 'Completed' : 'Waiting on another team'}</button>}
            {item?.kind === 'slot' && (
              <button className="btn primary" disabled={!!o.slot || !clear} onClick={() => onBook(date, time, false)}>{o.slot ? 'Slot booked' : 'Next: Book & confirm'}</button>
            )}
            <button className="btn primary caret" aria-label="More actions" onClick={() => setMenu(!menu)}>▾</button>
            {menu && (
              <div className="menu">
                {nexts.slice(1).map((n) => {
                  const r = blockReason(n);
                  return <button key={n.label} className={n.tone === 'danger' ? 'danger' : ''} disabled={!!r} title={r} onClick={() => doNext(n)}>{n.label}{r && <span className="why2">{r}</span>}</button>;
                })}
                {item?.kind === 'slot' && !o.slot && !isDone(task(o, 'contract')) && (
                  <button onClick={() => { onBypass(!o.bypassContract); setMenu(false); }}>{o.bypassContract ? 'Remove contract gate bypass' : 'Bypass contract gate (by_pass_contract_gfd_for_delivery_slots)'}</button>
                )}
                {(nexts.length > 1 || item?.kind === 'slot') && <div className="msep" />}
                {extra.map((x) => <button key={x.label} onClick={() => { x.run(); setMenu(false); }}>{x.label}</button>)}
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      <CarGpt o={o} item={persona === 'rm' ? rmItem : item} now={now} open={gptOpen} toggle={() => setGptOpen(!gptOpen)} />
    </div>
  );
}

