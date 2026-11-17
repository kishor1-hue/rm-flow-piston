// RM cash journey: one guided action flow per order, from deposit to delivery.
// Each step is an action; the "LeadVerse will" list is what the backend does in place of HubSpot workflows.
import { useEffect, useRef, useState } from 'react';
import { JOURNEYS, PERSONAS, type TransitionDef } from './model';
import {
  applyDiscount, approveDiscount, availableNext, canMove, DISCOUNT_LIMIT, finaliseTradeIn, fmtAge, gatesClear, gateStatus,
  isDone, missingFields, money, orderTotal, outstanding, recordPayment, setDeliveryMode, skipStep, stageDef, task, type Order, type Task,
} from './engine';
import { Field } from './TaskCard';
import { proofPng } from './proof';
import { payload, SchemaForm, validate, type FormValues, type SchemaPage } from './SchemaForm';
import spForm from './forms/sales-promise-checklist.json';

const SP_PAGE = spForm.pages[0] as unknown as SchemaPage;
const SP_SUBMIT = spForm.apiSources.find((a) => a.key === SP_PAGE.navigation.next.apiSourceId)!;

// Stand-in for GET_SALES_PROMISE_CHECKLIST (ON_PAGE_LOAD, dummy): map the deal's promises onto checklist options.
function prefillChecklist(promises: string[]): FormValues {
  if (!promises.length) return { refurb_select: 'No' };
  const v: FormValues = { refurb_select: 'Yes' };
  const add = (k: string, opt: string) => { v[k] = [...((v[k] as string[]) || []), opt]; };
  const other: string[] = [];
  for (const p of promises) {
    if (/tyre/i.test(p)) add('tyres', 'Need new Tyres');
    else if (/scratch|dent|paint|bumper|scuff/i.test(p)) add('exteriors', 'Paint Scratches / Dents to be repaired');
    else if (/service/i.test(p)) add('servicing', 'Periodic service required');
    else if (/brake/i.test(p)) add('brake_acceleration', 'Brakes are weak');
    else if (!/\$\d+\s*off/i.test(p)) other.push(p);
  }
  if (other.length) v.other_refurbish_comments = other.join('; ');
  return v;
}

export type RmStep = 'deposit' | 'discount' | 'docs' | 'promise' | 'tradein' | 'balance' | 'delivery';
type Act = (fn: (o: Order, at: number) => void) => void;

const STEPS: { key: RmStep; label: string; where: string }[] = [
  { key: 'deposit', label: 'Verify deposit', where: 'Finance ticket · HubSpot 01a' },
  { key: 'discount', label: 'Discount', where: 'B2C admin · Discount codes' },
  { key: 'docs', label: 'Customer documents', where: 'Customer documents ticket · HubSpot 02' },
  { key: 'promise', label: 'Sales promise', where: 'Deal property sales_promise_' },
  { key: 'tradein', label: 'Trade-in', where: 'B2C admin · Add trade-in' },
  { key: 'balance', label: 'Balance payment', where: 'Finance ticket · HubSpot 01a' },
  { key: 'delivery', label: 'Book delivery', where: 'B2C admin · Book delivery slots' },
];

export function stepDone(o: Order, k: RmStep): boolean {
  const pay = task(o, 'payment');
  if (k === 'deposit') return !!pay && pay.stage !== 'deposit';
  if (k === 'docs') return isDone(task(o, 'contract'));
  if (k === 'promise') return !!o.rmDone.promise;
  if (k === 'discount') return !!o.rmDone.discount && o.discount?.status !== 'Awaiting approval';
  if (k === 'tradein') return !o.tradeIn || !!o.rmDone.tradein;
  if (k === 'balance') return isDone(pay);
  return !!o.slot;
}
export const firstOpenStep = (o: Order): RmStep => STEPS.find((s) => !stepDone(o, s.key))?.key || 'delivery';

function Fx({ items }: { items: string[] }) {
  return (
    <div className="fx">
      <div className="fx-h">When you do this, LeadVerse will</div>
      <ul>{items.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  );
}

// Ticket status dropdown — same stages as the HubSpot pipeline; only moves the current stage allows.
function TicketStatus({ o, t, title, onMove }: { o: Order; t: Task; title: string; onMove: (to: string) => void }) {
  const def = JOURNEYS[t.journey];
  const nexts = availableNext(o, t);
  const reason = (n?: TransitionDef) => {
    if (!n) return 'not reachable from this stage';
    const miss = missingFields(t, n.requires);
    if (miss.length) return 'fill ' + miss.map((k) => (stageDef(t).fields || []).find((f) => f.key === k)?.label || k).join(', ');
    return canMove(o, t, n.to).reason || '';
  };
  return (
    <div className="tform">
      <label className="tf"><span>Ticket</span><div className="tf-ro">{title}</div></label>
      <label className="tf"><span>Pipeline</span><div className="tf-ro">{def.hsPipeline}<small>in stage {fmtAge(Date.now() - t.enteredAt)}</small></div></label>
      <label className="tf wide">
        <span>Ticket status</span>
        <div className="tf-sel">
          <select value={t.stage} onChange={(e) => { const n = nexts.find((x) => x.to === e.target.value); if (n && !reason(n)) onMove(n.to); }}>
            {def.stages.map((s) => {
              const n = nexts.find((x) => x.to === s.key);
              const r = s.key === t.stage ? '' : reason(n);
              return <option key={s.key} value={s.key} disabled={!!r}>{s.hs}{r && s.key !== t.stage ? ` — ${r}` : ''}</option>;
            })}
          </select>
        </div>
      </label>
    </div>
  );
}

// Discount Description options in the B2C admin Discount codes form.
const DISCOUNT_DESCRIPTIONS = ['EW', 'VAS Sales', 'Car Discount', 'Eligible Stock', 'Service History Missing', 'Referral', 'Promotional', 'Finance rate match', 'Deposit contribution'];

const methodLabel = (m?: string) => (m === 'Card' ? 'Card (Stripe)' : m === 'Stripe' ? 'Stripe payment link' : m || 'Bank transfer');

// Price breakdown: what the customer owes, what has landed, what is still pending.
function PriceBreakdown({ o }: { o: Order }) {
  const paid = o.payments.reduce((a, x) => a + x.amount, 0);
  const due = outstanding(o);
  const r = (label: string, amt: number, opts: { neg?: boolean; note?: string; cls?: string } = {}) => (
    <tr key={label} className={opts.cls}>
      <td>{label}{opts.note && <small className="pb-note">{opts.note}</small>}</td>
      <td style={{ textAlign: 'right' }}>{opts.neg && amt ? '− ' : ''}{money(amt)}</td>
    </tr>
  );
  return (
    <>
      <div className="sec-h">Price breakdown</div>
      <div className="tbox">
        <table className="tl-t pb">
          <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
          <tbody>
            {r(`${o.car.year} ${o.car.make} ${o.car.model}`, o.price, { note: 'Car price' })}
            {o.vas.map((v) => r(v.name, v.price, { note: 'Add-on' }))}
            {o.shipping > 0 && r('Shipping', o.shipping, { note: 'Home delivery' })}
            {o.discount && r('Discount', o.discount.status === 'Applied' ? o.discount.amount : 0, { neg: true, note: o.discount.status === 'Applied' ? o.discount.reason : `${money(o.discount.amount)} awaiting approval` })}
            {o.tradeIn && r('Trade-in', o.tradeIn.value, { neg: true, note: o.tradeIn.car })}
            {r('Total payable', orderTotal(o), { cls: 'pb-sum' })}
            {o.payments.map((x) => r(x.type === 'DEPOSIT' ? 'Deposit paid' : x.type === 'FIRST_INSTALMENT' ? 'First instalment paid' : 'Balance paid', x.amount, { neg: true, note: methodLabel(x.method) }))}
            {r('Pending balance', due, { cls: 'pb-due' + (due ? '' : ' paid'), note: due ? `${Math.round((paid / orderTotal(o)) * 100)}% paid so far` : 'Fully paid' })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StageFields({ t, onField }: { t: Task; onField: (k: string, v: string | boolean) => void }) {
  const s = stageDef(t);
  if (!s.fields?.length || s.kind === 'done') return null;
  const req = new Set((s.next || []).flatMap((n) => n.requires || []));
  return (
    <div className="fields">
      {s.fields.map((fd) => (
        <div key={fd.key}>
          <Field fd={{ ...fd, label: fd.label + (req.has(fd.key) ? ' *' : '') }} value={t.fields[fd.key]} editable onChange={(v) => onField(fd.key, v)} />
          {fd.hs && fd.hs !== 'NEW' && <div className="hs" style={{ marginTop: 3 }}>{fd.hs}</div>}
        </div>
      ))}
    </div>
  );
}

interface Props {
  o: Order; step: RmStep; setStep: (s: RmStep) => void; stepsOpen: boolean; toggleSteps: () => void;
  onField: (tid: string, k: string, v: string | boolean) => void; onMove: (tid: string, to: string) => void;
  onBook: (d: string, t: string, ov: boolean) => void; onBypass: (on: boolean) => void; onComms: (text: string) => void; act: Act;
}

export function RmFlow({ o, step, setStep, stepsOpen, toggleSteps, onField, onMove, onBook, onBypass, onComms, act }: Props) {
  const [menu, setMenu] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [date, setDate] = useState('Tue 17 Nov');
  const [time, setTime] = useState('11:00 am');
  const promisedOff = Number((o.promises.join(' ').match(/\$(\d+)\s*off/i) || [])[1] || 0);
  const [disc, setDisc] = useState({ type: 'Flat' as 'Flat' | 'Percent', value: String(promisedOff || ''), reason: promisedOff ? 'Car Discount' : '', till: '' });
  // Discount page has two sections, like the B2C admin: back-calculate from a target outstanding, then generate the discount.
  const [calc, setCalc] = useState<{ target: string; result: number | null }>({ target: '', result: null });
  useEffect(() => { setCalc({ target: '', result: null }); }, [o.id]);
  const [sp, setSp] = useState<FormValues>(() => o.promiseChecklist || prefillChecklist(o.promises));
  const [spTried, setSpTried] = useState(false);
  useEffect(() => { setSp(o.promiseChecklist || prefillChecklist(o.promises)); setSpTried(false); }, [o.id]);
  const [tiv, setTiv] = useState(String(o.tradeIn?.value || ''));
  const [pay, setPay] = useState({ amount: '', ref: '' });
  useEffect(() => { setMenu(false); }, [step, o.id]);
  // Finishing a step moves the RM on to the next open one.
  const wasDone = useRef({ key: o.id + step, done: stepDone(o, step) });
  useEffect(() => {
    const d = stepDone(o, step);
    const same = wasDone.current.key === o.id + step;
    if (same && d && !wasDone.current.done) { const n = STEPS.slice(STEPS.findIndex((s) => s.key === step) + 1).find((s) => !stepDone(o, s.key)); if (n) setStep(n.key); }
    wasDone.current = { key: o.id + step, done: d };
  });
  useEffect(() => { setPay({ amount: String(outstanding(o) || ''), ref: '' }); }, [o.id, step, o.payments.length, o.discount?.status, o.tradeIn?.value]);

  const p = task(o, 'payment')!;
  const c = task(o, 'contract')!;
  const first = o.customer.name.split(' ')[0];
  const idx = STEPS.findIndex((s) => s.key === step);
  const go = (d: number) => setStep(STEPS[Math.max(0, Math.min(STEPS.length - 1, idx + d))].key);
  const goNextOpen = () => { const n = STEPS.slice(idx + 1).find((s) => !stepDone(o, s.key)); if (n) setStep(n.key); };
  const moveTask = (tk: Task, to: string) => { onMove(tk.id, to); };
  const blockOf = (tk: Task, n: TransitionDef) => {
    const miss = missingFields(tk, n.requires);
    if (miss.length) return 'Fill first: ' + miss.map((k) => (stageDef(tk).fields || []).find((f) => f.key === k)?.label || k).join(', ');
    return canMove(o, tk, n.to).reason || '';
  };

  // Each step decides its primary action, alternates and the backend effects.
  type Action = { label: string; run: () => void; block?: string; tone?: string };
  let primary: Action | undefined;
  let alts: Action[] = [];
  let fx: string[] = [];
  const taskActions = (tk: Task, only?: string[]) => {
    const ns = availableNext(o, tk).filter((n) => !only || only.includes(n.to));
    const acts = ns.map((n) => ({ label: n.label, run: () => moveTask(tk, n.to), block: blockOf(tk, n), tone: n.tone }));
    return { primary: acts[0], alts: acts.slice(1) };
  };

  let body: React.ReactNode = null;
  const cur = STEPS[idx];

  if (step === 'deposit') {
    const a = p.stage === 'deposit' ? taskActions(p) : { primary: undefined, alts: [] };
    primary = a.primary; alts = a.alts;
    fx = p.stage === 'deposit'
      ? ['Finance ticket → First Instalment Paid', 'Stamp GFR date on the order (HubSpot DW01b)', o.interstate ? 'Create the interstate inspection task for Delivery (DW02)' : 'Create the RWC / refurb task for the Refurb team (DW02)', 'Order moves to Car prep (HubSpot deal 4: Awaiting RWC)', 'Sync GFR to OMS']
      : [];
    const bank = o.paymentMethod === 'Bank transfer';
    const pending = p.stage === 'deposit';
    body = (
      <>
        <TicketStatus o={o} t={p} title={`${o.id}-${first} (Finance Ticket)`} onMove={(to) => moveTask(p, to)} />
        <div className="sec-h">Payments</div>
        <div className="tbox">
          <table className="tl-t">
            <thead><tr><th>Type</th><th>Method</th><th>Transaction ID</th><th>Paid</th><th style={{ textAlign: 'right' }}>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {o.payments.map((x) => {
                const verify = pending && x.type === 'DEPOSIT' && bank;
                return (
                  <tr key={x.ref + x.at}>
                    <td>{x.type}</td><td>{methodLabel(x.method)}</td><td className="mono">{x.ref}</td><td>{fmtAge(Date.now() - x.at)} ago</td>
                    <td style={{ textAlign: 'right' }}>{money(x.amount)}</td>
                    <td><span className={'code ' + (verify ? 'c-amber' : 'c-green')}>{verify ? 'TO_VERIFY' : 'SUCCESS'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <PriceBreakdown o={o} />
        {bank ? (
          <>
            <div className="sec-h">Payment proof <span className="hs">proof_of_payment_link</span></div>
            <button className="proof-shot" onClick={() => setZoom(true)} aria-label="Open payment proof">
              <img src={proofPng(o)} alt={`Bank transfer receipt for ${o.id}`} />
              <span className="ps-cap"><b>{(o.proofUrl || '').split('/').pop()}</b><small>Uploaded by customer · {fmtAge(Date.now() - o.depositAt)} ago · click to enlarge</small></span>
            </button>
            {zoom && (
              <div className="lightbox" onClick={() => setZoom(false)}>
                <img src={proofPng(o)} alt={`Bank transfer receipt for ${o.id}`} />
                <button className="lb-x" aria-label="Close">×</button>
              </div>
            )}
            {!pending && <div className="statusline">Proof verified. First instalment confirmed and car prep has started (GFR).</div>}
          </>
        ) : (
          <div className="statusline">Paid by {methodLabel(o.paymentMethod)}. Stripe confirmed it and moved the ticket to First Instalment Paid on its own. Nothing to verify.</div>
        )}
      </>
    );
  }

  if (step === 'docs') {
    const a = taskActions(c);
    primary = a.primary; alts = a.alts;
    const n0 = availableNext(o, c)[0];
    fx = n0?.to === 'signed' ? ['Stamp contract signed date (HubSpot TW02a)', 'Contract gate ✓ for delivery', 'Sync to OMS so the customer app can open the slot'] : n0?.to === 'sent' ? ['Send the DocuSign envelope with the tax invoice', 'Deal contract status → Contract not signed (TW02b)', 'Nudge the customer after 48h'] : [];
    body = (
      <>
        <TicketStatus o={o} t={c} title={`${o.id}-${o.apptId}(Customer Documents)`} onMove={(to) => moveTask(c, to)} />
        <div className="kvbox" style={{ marginTop: 12 }}>
          <div><span>Contract handling</span><b>Contract sent through Portal</b></div>
          <div><span>DocuSign status</span><b>{isDone(c) ? 'Signed' : ['sent', 'form4', 'review'].includes(c.stage) ? 'Sent · unsigned' : 'Not sent'}</b></div>
          <div><span>Driver's licence</span><b>Uploaded by customer on the portal</b></div>
          <div><span>Trade-in paperwork</span><b>{o.tradeIn ? 'Form 4 needed' : 'Not needed'}</b></div>
        </div>
        <StageFields t={c} onField={(k, v) => onField(c.id, k, v)} />
      </>
    );
  }

  if (step === 'promise') {
    const errs = validate(SP_PAGE, sp);
    const nErr = Object.keys(errs).length;
    if (!o.rmDone.promise) {
      primary = {
        label: SP_PAGE.navigation.next.text + ' checklist',
        run: () => { setSpTried(true); if (!nErr) act((x, at) => { x.promiseChecklist = payload(SP_PAGE, sp); skipStep(x, 'promise', `Sales Promise checklist submitted (${SP_SUBMIT.key}) · refurbishment: ${sp.refurb_select}`, at); }); },
        block: spTried && nErr ? `${nErr} field${nErr > 1 ? 's' : ''} need attention` : '',
      };
    }
    fx = !o.rmDone.promise ? [`${SP_SUBMIT.method} ${SP_SUBMIT.url.replace('{{PLATFORM_BFF_BASE_URL}}', '')} (${SP_SUBMIT.key})`, 'Attach the selected items to the Refurb detail task; Refurb ticks each before QC', 'Uploaded photos go through GENERATE_REFURB_DOC_UPLOAD_URL (presigned PUT)', 'Discount promises carry into the Discount step'] : [];
    const done = o.promiseChecklist;
    body = (
      <>
        <div className="sec-h">{SP_PAGE.title}</div>
        {!done ? (
          <>
            <div className="sf-api">Prefilled from the deal's sales promise · {spForm.apiSources[0].key} (dummy)</div>
            <SchemaForm page={SP_PAGE} values={sp} showErrors={spTried} onChange={(id, v) => setSp((cur) => ({ ...cur, [id]: v }))} />
          </>
        ) : (
          <>
            <div className="tbox">
              <table className="tl-t">
                <thead><tr><th>Field</th><th>Answer</th></tr></thead>
                <tbody>{Object.entries(done).map(([k, v]) => <tr key={k}><td>{SP_PAGE.fields.find((f) => f.field_key === k)?.label || k}</td><td>{Array.isArray(v) ? v.join(', ') : v}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="statusline">Checklist submitted {fmtAge(Date.now() - o.rmDone.promise!)} ago and handed to Refurb.</div>
          </>
        )}
      </>
    );
  }

  if (step === 'discount') {
    const v = Number(disc.value || 0);
    const amt = disc.type === 'Flat' ? v : Math.round((o.price * v) / 100);
    const vasTotal = o.vas.reduce((x, y) => x + y.price, 0);
    const paid = o.payments.reduce((x, y) => x + y.amount, 0);
    const due = Math.max(0, orderTotal(o) - paid);
    const target = Number(calc.target);
    const calcErr = calc.target === '' ? 'Enter the required outstanding amount' : target < 0 ? 'Must be 0 or more' : target >= due ? `Must be below the current outstanding ${money(due)}` : '';
    // Calculating fills the Generate discount section below with the result.
    const runCalc = () => { if (calcErr) return; setCalc({ ...calc, result: due - target }); setDisc({ ...disc, type: 'Flat', value: String(due - target) }); };
    const open = !o.rmDone.discount;
    if (o.discount?.status === 'Awaiting approval') {
      primary = { label: 'Approve discount (demo: sales manager)', run: () => act((x, at) => approveDiscount(x, at)) };
    } else if (open) {
      primary = { label: `Generate ${amt ? money(amt) + ' ' : ''}discount`, run: () => act((x, at) => applyDiscount(x, disc.type, v, disc.reason, at, disc.till || undefined)), block: !v ? 'Enter a discount value' : !disc.reason ? 'Select a discount description' : disc.type === 'Percent' && v > 100 ? 'Percentage must be 100 or less' : '' };
      alts = [
        { label: 'No discount on this order', run: () => act((x, at) => skipStep(x, 'discount', 'No discount on this order', at)) },
      ];
    }
    fx = open ? ['Recalculate the outstanding amount', 'Regenerate the tax invoice', `Above ${money(DISCOUNT_LIMIT)}: send to the sales manager for approval first`, 'Sync discount_value to the order record'] : [];
    const li = (k: string, val: number | string) => <li key={k}><span>{k}</span><b>{typeof val === 'number' ? money(val) : val}</b></li>;
    body = (
      <>
        {open && (
          <div className="dcalc">
            <div className="dc-title"><i>1</i>Discount calculator</div>
            <div className="dc-h">Enter the final outstanding amount you want, and LeadVerse back-calculates the discount.</div>
            <div className="dc-cols">
              <ul className="dc-list">
                {li('DAP', o.price)}
                {li('EGC', o.price)}
                {li('Govt charges', 0)}
                <ul className="dc-sub">{li('Motor vehicle duty', 0)}{li('3 months registration', 0)}{li('CTP insurance', 0)}{li('Transfer fee', 0)}</ul>
              </ul>
              <ul className="dc-list">
                {li('Interstate charges', 0)}
                {li('Home delivery charges', o.shipping)}
                {li('Discount value', o.discount?.status === 'Applied' ? o.discount.amount : '—')}
                {li('VAS', vasTotal)}
                {o.tradeIn && li('Trade-in', -o.tradeIn.value)}
                {li('Total amount to be paid', orderTotal(o))}
                {li('Total amount paid', paid)}
                <li className="dc-due"><span>Current outstanding</span><b>{money(due)}</b></li>
              </ul>
            </div>
            <div className="dc-row">
              <label className="tf">
                <span>Required outstanding amount</span>
                <div className="dc-in"><em>$</em><input type="number" min={0} value={calc.target} placeholder={String(Math.max(0, due - 1000))} onChange={(e) => setCalc({ target: e.target.value, result: null })} onKeyDown={(e) => { if (e.key === 'Enter') runCalc(); }} /></div>
              </label>
              <button className="btn" disabled={!!calcErr} title={calcErr} onClick={runCalc}>Calculate discount</button>
            </div>
            {calc.target !== '' && calcErr && <div className="dc-err">{calcErr}</div>}
            {calc.result != null && (
              <>
                <div className="dc-msg">The current total due is <b>{money(due)}</b>. To bring it to <b>{money(target)}</b>, a discount of <b>{money(calc.result)}</b> is needed. It has been filled in below.</div>
                <label className="tf" style={{ maxWidth: 260 }}><span>Required discount</span><div className="tf-ro">{money(calc.result)}</div></label>
              </>
            )}
          </div>
        )}

        {open && <div className="dc-title sec"><i>2</i>Generate discount</div>}
        {open && (
          <div className="tform" style={{ marginTop: 8 }}>
            <label className="tf">
              <span>Discount type <i className="req">*</i></span>
              <div className="tf-sel"><select value={disc.type} onChange={(e) => setDisc({ ...disc, type: e.target.value as 'Flat' | 'Percent' })}><option value="Flat">Flat</option><option value="Percent">Percentage</option></select></div>
            </label>
            <label className="tf">
              <span>Discount description <i className="req">*</i></span>
              <div className="tf-sel"><select value={disc.reason} onChange={(e) => setDisc({ ...disc, reason: e.target.value })}><option value="">Select discount description</option>{DISCOUNT_DESCRIPTIONS.map((r) => <option key={r}>{r}</option>)}</select></div>
            </label>
            <label className="tf">
              <span>Discount value {disc.type === 'Flat' ? '($)' : '(%)'} <i className="req">*</i></span>
              <input className="tf-in" type="number" min={0} value={disc.value} onChange={(e) => setDisc({ ...disc, value: e.target.value })} />
              {disc.type === 'Percent' && v > 0 && <small className="tf-help">{v}% of {money(o.price)} = {money(amt)} off</small>}
              {amt > DISCOUNT_LIMIT && <small className="tf-help warn">Above {money(DISCOUNT_LIMIT)} needs sales manager approval</small>}
            </label>
            <label className="tf">
              <span>Discount valid till <small className="opt">(optional)</small></span>
              <input className="tf-in" type="date" value={disc.till} onChange={(e) => setDisc({ ...disc, till: e.target.value })} />
            </label>
            <div className="tf wide dc-after">
              <span>After this discount</span>
              <div className="tf-ro"><span>Outstanding {money(due)} → <b>{money(Math.max(0, due - amt))}</b></span></div>
            </div>
          </div>
        )}

        {o.discount && <div className={'statusline' + (o.discount.status === 'Awaiting approval' ? ' warn' : '')}>Discount {o.discount.type === 'Percent' ? o.discount.value + '% · ' : ''}{money(o.discount.amount)} · {o.discount.reason}{o.discount.till ? ` · valid till ${o.discount.till}` : ''} · <b>{o.discount.status}</b></div>}
        {!open && !o.discount && <div className="statusline">No discount on this order.</div>}
        <div className="hs" style={{ marginTop: 8 }}>b2c-admin · api/admin/getDiscount/&#123;orderId&#125;?finalDap · discount_value / discount_type</div>
      </>
    );
  }

  if (step === 'tradein') {
    if (o.tradeIn && !o.rmDone.tradein) {
      primary = { label: 'Finalise trade-in value', run: () => act((x, at) => finaliseTradeIn(x, Number(tiv), at)), block: !Number(tiv) ? 'Enter the final value' : '' };
      fx = ['Set the trade-in value on the order', 'Recalculate the outstanding amount', 'Send the final valuation to the Trade-in ops task (HubSpot 02c)', 'Add Form 4 to the customer documents'];
    }
    body = !o.tradeIn ? <div className="statusline">No trade-in on this order. Nothing to do here.</div> : (
      <>
        <div className="kvbox" style={{ marginTop: 14 }}>
          <div><span>Trade-in car</span><b>{o.tradeIn.car}</b></div>
          <div><span>Offered at booking</span><b>{money(o.tradeIn.value)}</b></div>
          <div><span>Mode</span><b>Drop at hub on handover day</b></div>
        </div>
        {!o.rmDone.tradein ? (
          <div className="fields" style={{ maxWidth: 320 }}>
            <div className="fld"><label>Final value after inspection ($) *</label><input type="number" value={tiv} onChange={(e) => setTiv(e.target.value)} /></div>
          </div>
        ) : <div className="statusline">Final value {money(o.tradeIn.value)} · set {fmtAge(Date.now() - o.rmDone.tradein)} ago.</div>}
        <div className="hs" style={{ marginTop: 6 }}>trade_in_value · tradein_valuation_finalised · b2c-admin Add trade-in</div>
      </>
    );
  }

  if (step === 'balance') {
    const left = outstanding(o);
    if (p.stage === 'deposit') {
      primary = { label: 'Record payment', run: () => {}, block: 'Confirm the first instalment in step 1 first' };
    } else if (['instalment', 'short'].includes(p.stage)) {
      primary = { label: `Record ${money(Number(pay.amount || 0))} payment`, run: () => act((x, at) => recordPayment(x, Number(pay.amount), pay.ref || 'Bank transfer', 'rm', at)), block: !Number(pay.amount) ? 'Enter the amount received' : '' };
      alts = [{ label: `Call ${first} to chase the balance`, run: () => onComms(`Call to ${o.customer.phone}: balance of ${money(left)} discussed`) }, ...taskActions(p).alts];
      fx = ['Add the payment to the ledger', `Fully paid → Finance ticket to Final remittance received, else Awaiting additional deposit (HubSpot TW01a)`];
    } else {
      const a = taskActions(p);
      primary = a.primary; alts = a.alts;
      if (p.stage === 'final') fx = ['Stamp Finance GFD date (HubSpot DW01e)', 'Create the VAS install tasks for Refurb (cash)', 'Finance gate ✓ for delivery', 'Sync to OMS'];
    }
    body = (
      <>
        <TicketStatus o={o} t={p} title={`${o.id}-${first} (Finance Ticket)`} onMove={(to) => moveTask(p, to)} />
        <div className="tbox">
          <table className="tl-t"><thead><tr><th>Payment type</th><th>Reference</th><th>Amount</th><th>When</th><th>By</th></tr></thead>
            <tbody>{o.payments.map((x, i) => <tr key={i}><td>{x.type}</td><td className="mono">{x.ref}</td><td>{money(x.amount)}</td><td>{fmtAge(Date.now() - x.at)} ago</td><td>{x.by}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="calc" style={{ maxWidth: 360 }}>
          <div><span>Total payable</span><b>{money(orderTotal(o))}</b></div>
          <div><span>Paid so far</span><b>{money(o.payments.reduce((a, x) => a + x.amount, 0))}</b></div>
          <div className="tot"><span>Outstanding</span><b>{money(left)}</b></div>
        </div>
        {['instalment', 'short'].includes(p.stage) && (
          <div className="fields" style={{ maxWidth: 520 }}>
            <div className="fld"><label>Amount received ($) *</label><input type="number" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
            <div className="fld"><label>Bank reference</label><input type="text" value={pay.ref} placeholder="e.g. NAB 77821" onChange={(e) => setPay({ ...pay, ref: e.target.value })} /></div>
          </div>
        )}
        {p.stage === 'final' && <StageFields t={p} onField={(k, v) => onField(p.id, k, v)} />}
        {isDone(p) && <div className="statusline">Finance GFD. Fully paid.</div>}
      </>
    );
  }

  if (step === 'delivery') {
    const clear = gatesClear(o);
    if (!o.slot) {
      primary = { label: 'Book & confirm slot', run: () => onBook(date, time, false), block: clear ? '' : 'Blocked by: ' + gateStatus(o).filter((g) => !g.ok).map((g) => g.label).join(', ') };
      alts = !isDone(c) ? [{ label: o.bypassContract ? 'Remove contract gate bypass' : 'Bypass contract gate (by_pass_contract_gfd_for_delivery_slots)', run: () => onBypass(!o.bypassContract) }] : [];
      fx = ['Book the slot and create / move the Handover task for Delivery', 'Email + SMS confirmation to the customer', o.deliveryMode === 'Home delivery' ? 'Shipping charge is on the invoice' : 'Pick-up at ' + o.car.hub.split(' · ')[0]];
    }
    body = (
      <>
        <div className="fields" style={{ maxWidth: 420 }}>
          <div className="fld"><label>Delivery mode</label>
            <select value={o.deliveryMode} disabled={!!o.slot} onChange={(e) => act((x, at) => setDeliveryMode(x, e.target.value as Order['deliveryMode'], at))}>
              <option>Pick up</option><option>Home delivery</option>
            </select>
          </div>
          <div className="fld"><label>Shipping charge</label><div className="ro">{o.shipping ? money(o.shipping) : 'None (pick up)'}</div></div>
        </div>
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
        {!o.slot ? (
          <div className="fields" style={{ maxWidth: 420 }}>
            <div className="fld"><label>Date</label><select value={date} onChange={(e) => setDate(e.target.value)}>{['Wed 18 Nov', 'Thu 19 Nov', 'Fri 20 Nov', 'Sat 21 Nov'].map((d) => <option key={d}>{d}</option>)}</select></div>
            <div className="fld"><label>Time</label><select value={time} onChange={(e) => setTime(e.target.value)}>{['9:00 am', '11:00 am', '1:00 pm', '3:00 pm'].map((d) => <option key={d}>{d}</option>)}</select></div>
          </div>
        ) : <div className="statusline">Booked for <b>{o.slot.date} · {o.slot.time}</b> by {o.slot.by}. Confirmation sent by email and SMS.</div>}
      </>
    );
  }

  const extra = [
    { label: `Call ${first}`, run: () => onComms(`Call to ${o.customer.phone} logged with recording and transcript`) },
    { label: 'Call back later', run: () => onComms('Call back scheduled for tomorrow 10:00 am (task reminder set)') },
    { label: 'Raise a task for another team', run: () => onComms('Child task raised: "Please confirm ETA" → assigned to the owning team') },
  ];
  const cancelled = p.stage === 'cancelled';
  const done = stepDone(o, step);

  return (
    <>
      <div className={'stepper' + (stepsOpen ? '' : ' mini')}>
        {STEPS.map((s) => {
          const d = stepDone(o, s.key);
          const st = s.key === step ? (d ? 'done' : 'act') : d ? 'done' : '';
          return (
            <button key={s.key} className={'sp sp-btn ' + st} onClick={() => setStep(s.key)}>
              <div className="spdot">{d ? '✓' : ''}</div>
              <div className="spl">{s.label}</div>
              <div className="sps">{d ? 'completed' : s.key === step ? 'in progress' : 'pending'}</div>
            </button>
          );
        })}
        <button className="stog" aria-label={stepsOpen ? 'Collapse steps' : 'Expand steps'} onClick={toggleSteps}>{stepsOpen ? '⌃' : '⌄'}</button>
      </div>
      <div className="ws-body">
        <div className="ws-h">{idx + 1}. {cur.label}{done && <span className="chip c-green">Done</span>}{cancelled && <span className="chip c-red">Sale cancelled</span>}</div>
        <div className="ws-guide">{cur.where}</div>
        {body}
        {fx.length > 0 && <Fx items={fx} />}
        {primary?.block && <div className="blocked">{primary.block}</div>}
      </div>
      <div className="ws-foot">
        <button className="btn prevb" disabled={idx === 0} onClick={() => go(-1)}>Previous</button>
        <span className="exit">{done ? 'Step complete' : `Step ${idx + 1} of ${STEPS.length}`}</span>
        <div className="split">
          {primary ? (
            <button className="btn primary" disabled={!!primary.block || cancelled} title={primary.block} onClick={() => { primary!.run(); setMenu(false); }}>Next: {primary.label}</button>
          ) : (
            <button className="btn primary" disabled={idx === STEPS.length - 1 && done} onClick={goNextOpen}>{idx === STEPS.length - 1 ? 'All done' : 'Go to next open step'}</button>
          )}
          <button className="btn primary caret" aria-label="More actions" onClick={() => setMenu(!menu)}>▾</button>
          {menu && (
            <div className="menu">
              {alts.map((a) => <button key={a.label} className={a.tone === 'danger' ? 'danger' : ''} disabled={!!a.block} title={a.block} onClick={() => { a.run(); setMenu(false); }}>{a.label}{a.block && <span className="why2">{a.block}</span>}</button>)}
              {alts.length > 0 && <div className="msep" />}
              {extra.map((x) => <button key={x.label} onClick={() => { x.run(); setMenu(false); }}>{x.label}</button>)}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
