// RM cash journey: one guided action flow per order, from deposit to delivery.
// Each step is an action; the "LeadVerse will" list is what the backend does in place of HubSpot workflows.
import { Fragment, useEffect, useRef, useState } from 'react';
import { JOURNEYS, PERSONAS, TI_FIELDS, type TransitionDef } from './model';
import {
  acceptTradeIn, applyDiscount, approveDiscount, disputeTradeIn, TI_CONFLICT_REASONS, setTradeInOpted, availableNext, canMove, DISCOUNT_LIMIT, fmtAge, gatesClear, gateStatus,
  addVas, byoVerifyDeposit, financeGfd, CRN_NAME, dap, DOC_LABEL, docOutdated, regenerateDoc, requestCrn, verifyDl, dlSuggest, receiveCrn, remindCrn, requestReupload, setDlCheck, type DlCheck, type DocKey, govtCharges, isDone, missingFields, money, removeVas, VAS_CATALOG, vasTotal, type PlanType, orderTotal, outstanding, recordPayment, type PaymentEntry, isRegistered, setDeliveryMode, skipStep, stageDef, task, type Order, type Task,
} from './engine';
import { PrepStatus } from './Visibility';
import { ByoLenderStep, byoNext, ByoStatusCard, ByoStatusField, type ByoEvent } from './Byo';
import { Field } from './TaskCard';
import { PHASES, STATES, stepByKey, type Track } from './journey/spec';
import { Button, DataTable, Dls, FetchedInfo, InfoMessage, LinkButton, SectionCard, SegmentTabs, SelectionSlots, type Row } from './dls/Dls';
import { dlPng, proofPng } from './proof';
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

export type RmStep = 'deposit' | 'discount' | 'vas' | 'docs' | 'promise' | 'tradein' | 'final' | 'balance' | 'prep' | 'delivery';
type Act = (fn: (o: Order, at: number) => void) => void;

const STEPS: { key: RmStep; label: string; where: string }[] = [
  { key: 'deposit', label: 'Verify deposit', where: 'Finance ticket · HubSpot 01a' },
  { key: 'discount', label: 'Discount', where: 'B2C admin · Discount codes' },
  { key: 'vas', label: 'Add VAS', where: 'B2C admin · VAS Sales' },
  { key: 'docs', label: 'Customer documents', where: "Driver's licence · registration state" },
  { key: 'promise', label: 'Sales promise', where: 'Deal property sales_promise_' },
  { key: 'tradein', label: 'Trade-in', where: 'Trade-In team owns the price · HubSpot 02c' },
  { key: 'final', label: 'Contract & invoice', where: 'Customer documents ticket · HubSpot 02' },
  { key: 'balance', label: 'Balance payment', where: '' },
  { key: 'prep', label: 'Car prep status', where: '' },
  { key: 'delivery', label: 'Book delivery', where: 'B2C admin · Book delivery slots' },
];

export function stepDone(o: Order, k: RmStep): boolean {
  const pay = task(o, 'payment');
  if (k === 'deposit') return !!pay && pay.stage !== 'deposit' && !!o.tradeInOpted;
  // Licence step ends once checked; when a customer ID is needed it is collected later, in Contract & invoice.
  if (k === 'docs') return ['Verified', 'ID requested', 'ID received'].includes(o.dl.status);
  if (k === 'final') return !!o.rmDone.final;
  if (k === 'vas') return !!o.rmDone.vas;
  if (k === 'promise') return !!o.rmDone.promise;
  if (k === 'discount') return !!o.rmDone.discount && o.discount?.status !== 'Awaiting approval';
  if (k === 'tradein') return o.tradeInOpted !== 'Yes' || !!o.rmDone.tradein;
  if (k === 'balance') return o.paymentMode === 'BYO' ? financeGfd(o) : isDone(pay);
  if (k === 'prep') return isDone(task(o, 'rwc')) && isDone(task(o, 'refurb')) && isRegistered(o);
  return !!o.slot;
}
// The Trade-in step only exists when the customer opted in (answered in step 1).
const stepsFor = (o: Order) => STEPS.filter((s) => s.key !== 'tradein' || o.tradeInOpted === 'Yes')
  // BYO: the balance comes from the customer's lender, so the balance step is the lender's.
  .map((s) => (s.key === 'balance' && o.paymentMode === 'BYO' ? { ...s, label: 'Lender finance' } : s));
export const firstOpenStep = (o: Order): RmStep => stepsFor(o).find((s) => !stepDone(o, s.key))?.key || 'delivery';

function Fx({ items }: { items: string[] }) {
  return (
    <div className="fx">
      <div className="fx-h">When you take the main exit, LeadVerse will</div>
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

// Price breakdown: what the customer owes, what has landed, what is still pending. @cspl/table in a section card.
function PriceBreakdown({ o }: { o: Order }) {
  const paid = o.payments.reduce((a, x) => a + x.amount, 0);
  const due = outstanding(o);
  const rows: Row[] = [
    { k: `${o.car.year} ${o.car.make} ${o.car.model}`, s: 'Car price', v: money(o.price) },
    { k: 'Govt charges', s: 'Duty, 3 months registration, CTP, transfer, handling', v: money(govtCharges(o).total) },
    ...o.vas.filter((v) => v.price > 0).map((v): Row => ({ k: v.name, s: 'Add-on', v: money(v.price) })),
    ...(o.shipping > 0 ? [{ k: 'Shipping', s: 'Home delivery', v: money(o.shipping) }] : []),
    ...(o.discount ? [{ k: 'Discount', s: o.discount.status === 'Applied' ? o.discount.reason : `${money(o.discount.amount)} awaiting approval`, v: o.discount.status === 'Applied' ? '− ' + money(o.discount.amount) : money(0) }] : []),
    ...(o.tradeIn ? [{ k: 'Trade-in', s: o.tradeIn.car, v: '− ' + money(o.tradeIn.value) }] : []),
    { k: 'Total payable', v: money(orderTotal(o)), $cls: 'sum' },
    ...o.payments.map((x): Row => ({ k: x.type === 'DEPOSIT' ? 'Deposit paid' : x.type === 'FIRST_INSTALMENT' ? 'First instalment paid' : x.type === 'LENDER_REMITTANCE' ? 'Lender remittance' : 'Balance paid', s: methodLabel(x.method), v: '− ' + money(x.amount) })),
    { k: 'Pending balance', s: due ? `${Math.round((paid / orderTotal(o)) * 100)}% paid so far` : 'Fully paid', v: money(due), $cls: 'due' + (due ? '' : ' paid') },
  ];
  return (
    <SectionCard part="price" title="Price breakdown" subtitle="What the customer owes, what has landed and what is still to collect">
      <DataTable columns={[{ key: 'k', label: 'Item', subTextKey: 's' }, { key: 'v', label: 'Amount', align: 'right' }]} rows={rows} />
    </SectionCard>
  );
}

// Price breakup - DAP (drive-away price), as in the B2C admin order page.
const amt = (v: number) => (v < 0 ? '− ' + money(-v) : money(v));
function DapBreakup({ o }: { o: Order }) {
  const g = govtCharges(o);
  const paid = o.payments.reduce((a, x) => a + x.amount, 0);
  const disc = o.discount?.status === 'Applied' ? o.discount.amount : 0;
  const rows: [string, number, string?][] = [
    ['EGC', o.price],
    ['Govt charges', g.total, 'grp'],
    ['Registration transfer fees', g.transfer, 'sub'], ['Motor vehicle duty', g.duty, 'sub'], [`${g.months} months registration`, g.rego, 'sub'], ['CTP insurance', g.ctp, 'sub'], ['Handling fee', g.handling, 'sub'],
    ['Hub2Hub delivery fees', 0], ['Home delivery fees', o.shipping], ['VAS charges', vasTotal(o)], ['Accessories amount', 0],
    ['DAP', dap(o), 'sum'],
    ['Discount value', disc ? -disc : 0], ['Trade-in value', o.tradeIn ? -o.tradeIn.value : 0],
    ['Total amount to be paid', orderTotal(o), 'sum'], ['Total amount paid', paid], ['Total outstanding', outstanding(o), 'due' + (outstanding(o) ? '' : ' paid')],
  ];
  return (
    <SectionCard part="dap" title="Price breakup · DAP" subtitle="Drive-away price, recalculated with every VAS added or removed">
      <DataTable columns={[{ key: 'k', label: 'Item' }, { key: 'v', label: 'Price', align: 'right' }]} rows={rows.map(([k, v, c]) => ({ k, v: amt(v), $cls: c }))} />
    </SectionCard>
  );
}

// Final payment price breakup: what makes up the DAP and what is still to collect.
function FinalBreakup({ o }: { o: Order }) {
  const g = govtCharges(o);
  const disc = o.discount?.status === 'Applied' ? o.discount.amount : 0;
  const paid = o.payments.reduce((a, x) => a + x.amount, 0);
  const due = outstanding(o);
  const rows: [string, number | null, string?][] = [
    ['DAP', dap(o), 'sum'], ['EGC', o.price], ['Govt charges', g.total, 'grp'],
    ['Motor vehicle duty', g.duty, 'sub'], [`${g.months} months registration`, g.rego, 'sub'], ['CTP insurance', g.ctp, 'sub'], ['Transfer fee', g.transfer, 'sub'], ['Handling fee', g.handling, 'sub'],
    ['Interstate charges', 0], ['Home delivery charges', o.shipping], ['Discount value', disc ? -disc : null], ['VAS', vasTotal(o)],
    ...(o.tradeIn ? [['Trade-in value', -o.tradeIn.value] as [string, number]] : []),
    ['Total amount to be paid', orderTotal(o), 'sum'], ['Total amount paid', paid], ['Outstanding balance', due, 'due' + (due ? '' : ' paid')],
  ];
  return (
    <SectionCard part="price" title="Price breakup" subtitle="What makes up the drive-away price and what is still to collect">
      <DataTable columns={[{ key: 'k', label: 'Item' }, { key: 'v', label: 'Amount', align: 'right' }]} rows={rows.map(([k, v, c]) => ({ k, v: v == null ? '—' : amt(v), $cls: c }))} />
    </SectionCard>
  );
}

function RegistrationDetails({ o }: { o: Order }) {
  const g = govtCharges(o);
  return (
    <SectionCard part="rego" title="Registration" subtitle={`${g.months} months, ${o.customer.state} plates`}>
      <FetchedInfo cols={3} items={[['Registration opted', 'Yes'], ['Months', `${g.months} months`], ['Total charges', money(g.total)], ['Stamp duty', money(g.duty)], ['CTP', money(g.ctp)], ['Transfer fee', money(g.transfer)], ['Registration fee', money(g.rego)], ['Number plates', g.plates], ['Handling fee', money(g.handling)]]} />
    </SectionCard>
  );
}

function AddVasModal({ o, onClose, onAdd }: { o: Order; onClose: () => void; onAdd: (type: PlanType, name: string) => void }) {
  const [type, setType] = useState<keyof typeof VAS_CATALOG | ''>('');
  const [plan, setPlan] = useState('');
  const have = new Set(o.vas.map((v) => v.name));
  const plans = type ? VAS_CATALOG[type] : [];
  const pick = plans.find((p) => p.name === plan);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Add VAS" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><div><b>Add VAS</b><small>Complete the form to continue.</small></div><button className="lb-x sm" aria-label="Close" onClick={onClose}>×</button></div>
        <div className="modal-b">
          <div className="modal-card">
            <h2>Add VAS</h2>
            <p>Select a plan type and VAS plan for this order.</p>
            <label className="tf"><span>Plan Type <i className="req">*</i></span>
              <div className="tf-sel"><select value={type} onChange={(e) => { setType(e.target.value as keyof typeof VAS_CATALOG); setPlan(''); }}>
                <option value="">Select plan type</option>
                {Object.keys(VAS_CATALOG).map((k) => <option key={k}>{k}</option>)}
              </select></div>
            </label>
            <label className="tf"><span>VAS Plan <i className="req">*</i></span>
              <div className="tf-sel"><select value={plan} disabled={!type} onChange={(e) => setPlan(e.target.value)}>
                <option value="">Select VAS plan</option>
                {plans.map((p) => <option key={p.name} value={p.name} disabled={have.has(p.name)}>{p.name}{have.has(p.name) ? ' (already added)' : ''}</option>)}
              </select></div>
            </label>
            {pick && <div className="dc-msg"><b>{money(pick.price)}</b> · {pick.details}</div>}
            <span className="sp" />
            <button className="btn primary wide" disabled={!pick} onClick={() => pick && type && onAdd(type, pick.name)}>Add VAS item</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const PAYMENT_SOURCES = ['Bank transfer', 'Card', 'Stripe', 'Finance payout', 'Trade-in settlement'];
const RECEIVED_BY = ['Finance team', 'RM', 'Customer (self-serve)'];
function AddPaymentModal({ due, onClose, onAdd }: { due: number; onClose: () => void; onAdd: (amount: number, ref: string, e: PaymentEntry) => void }) {
  const [f, setF] = useState({ amount: due ? String(due) : '', source: '', txn: '', ref: '', date: new Date().toISOString().slice(0, 10), receivedBy: '', remarks: '' });
  const [tried, setTried] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const errs: Partial<Record<keyof typeof f, string>> = {};
  if (!(Number(f.amount) > 0)) errs.amount = 'Enter the amount received';
  else if (Number(f.amount) > due) errs.amount = `More than the outstanding ${money(due)}`;
  if (!f.source) errs.source = 'Select the payment source';
  if (!f.txn.trim()) errs.txn = 'Enter the transaction ID';
  if (!f.ref.trim()) errs.ref = 'Enter the reference ID';
  if (!f.date) errs.date = 'Pick the payment date';
  const err = (k: keyof typeof f) => tried && errs[k] ? <div className="dc-err">{errs[k]}</div> : null;
  const submit = () => {
    setTried(true);
    if (Object.keys(errs).length) return;
    onAdd(Number(f.amount), f.ref.trim(), { method: f.source, txn: f.txn.trim(), paidAt: f.date === new Date().toISOString().slice(0, 10) ? undefined : new Date(f.date + 'T12:00:00').getTime(), receivedBy: f.receivedBy || undefined, remarks: f.remarks.trim() || undefined });
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Add payment entry" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><div><b>Add payment entry</b><small>Complete the form to continue.</small></div><button className="lb-x sm" aria-label="Close" onClick={onClose}>×</button></div>
        <div className="modal-b">
          <div className="modal-card">
            <label className="tf"><span>Amount (AUD) <i className="req">*</i></span>
              <input className={'tf-in' + (tried && errs.amount ? ' bad' : '')} type="number" min="0" placeholder="e.g. 5000" value={f.amount} onChange={set('amount')} />{err('amount')}
            </label>
            <label className="tf"><span>Payment Source <i className="req">*</i></span>
              <div className="tf-sel"><select className={tried && errs.source ? 'bad' : ''} value={f.source} onChange={set('source')}>
                <option value="">Select payment source</option>
                {PAYMENT_SOURCES.map((x) => <option key={x}>{x}</option>)}
              </select></div>{err('source')}
            </label>
            <label className="tf"><span>Transaction ID <i className="req">*</i></span>
              <input className={'tf-in' + (tried && errs.txn ? ' bad' : '')} placeholder="e.g. TXN-12345" value={f.txn} onChange={set('txn')} />{err('txn')}
            </label>
            <label className="tf"><span>Reference ID <i className="req">*</i></span>
              <input className={'tf-in' + (tried && errs.ref ? ' bad' : '')} placeholder="e.g. PO-67890" value={f.ref} onChange={set('ref')} />{err('ref')}
            </label>
            <label className="tf"><span>Payment date <i className="req">*</i></span>
              <input className={'tf-in' + (tried && errs.date ? ' bad' : '')} type="date" value={f.date} max={new Date().toISOString().slice(0, 10)} onChange={set('date')} />
              <small className="tf-help">Use ISO format expected by API</small>{err('date')}
            </label>
            <label className="tf"><span>Received by</span>
              <div className="tf-sel"><select value={f.receivedBy} onChange={set('receivedBy')}>
                <option value="">Select</option>
                {RECEIVED_BY.map((x) => <option key={x}>{x}</option>)}
              </select></div>
              <small className="tf-help">Not sent to the current API</small>
            </label>
            <label className="tf"><span>Remarks</span>
              <textarea className="tf-in sf-ta" placeholder="Internal note" value={f.remarks} onChange={set('remarks')} />
            </label>
            <button className="btn primary wide" onClick={submit}>Add Payment entry</button>
          </div>
        </div>
      </div>
    </div>
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
  const SV = stepsFor(o);
  const [menu, setMenu] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [date, setDate] = useState('Wed 18 Nov');
  const [time, setTime] = useState('11:00 am');
  const promisedOff = Number((o.promises.join(' ').match(/\$(\d+)\s*off/i) || [])[1] || 0);
  const [disc, setDisc] = useState({ type: 'Flat' as 'Flat' | 'Percent', value: String(promisedOff || ''), reason: promisedOff ? 'Car Discount' : '', till: '' });
  // Discount page has two sections, like the B2C admin: back-calculate from a target outstanding, then generate the discount.
  const [calc, setCalc] = useState<{ target: string; result: number | null }>({ target: '', result: null });
  useEffect(() => { setCalc({ target: '', result: null }); }, [o.id]);
  const [sp, setSp] = useState<FormValues>(() => o.promiseChecklist || prefillChecklist(o.promises));
  const [spTried, setSpTried] = useState(false);
  const [vasModal, setVasModal] = useState(false);
  const [payModal, setPayModal] = useState(false);
  const [byoOpen, setByoOpen] = useState<ByoEvent | null>(null);
  const [showSpec, setShowSpec] = useState(false);
  useEffect(() => { setByoOpen(null); }, [o.id]);
  const isByo = o.paymentMode === 'BYO' && !!o.byo;
  const [vasRow, setVasRow] = useState('');
  const [crn, setCrn] = useState('');
  const [dlZoom, setDlZoom] = useState<'' | 'front' | 'back'>('');
  useEffect(() => { setCrn(''); }, [o.id]);
  useEffect(() => { setSp(o.promiseChecklist || prefillChecklist(o.promises)); setSpTried(false); }, [o.id]);
  const [tiAns, setTiAns] = useState({ agree: '', reason: '', expected: '', note: '' });
  useEffect(() => { setTiAns({ agree: '', reason: '', expected: '', note: '' }); }, [o.id, o.tradeIn?.value, o.tradeIn?.finalAt]);
  useEffect(() => { setMenu(false); }, [step, o.id]);
  // Finishing a step moves the RM on to the next open one.
  const wasDone = useRef({ key: o.id + step, done: stepDone(o, step) });
  useEffect(() => {
    const d = stepDone(o, step);
    const same = wasDone.current.key === o.id + step;
    if (same && d && !wasDone.current.done) { const n = SV.slice(SV.findIndex((s) => s.key === step) + 1).find((s) => !stepDone(o, s.key)); if (n) setStep(n.key); }
    wasDone.current = { key: o.id + step, done: d };
  });

  const p = task(o, 'payment')!;
  const c = task(o, 'contract')!;
  const first = o.customer.name.split(' ')[0];
  const idx0 = SV.findIndex((s) => s.key === step);
  const idx = idx0 < 0 ? 0 : idx0;
  useEffect(() => { if (idx0 < 0) setStep(SV[0].key); }, [idx0]);
  const go = (d: number) => setStep(SV[Math.max(0, Math.min(SV.length - 1, idx + d))].key);
  const goNextOpen = () => { const n = SV.slice(idx + 1).find((s) => !stepDone(o, s.key)); if (n) setStep(n.key); };
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
  const cur = SV[idx];

  if (step === 'deposit') {
    const a = p.stage === 'deposit' ? taskActions(p) : { primary: undefined, alts: [] };
    primary = a.primary; alts = a.alts;
    if (isByo && p.stage === 'deposit') primary = { label: 'Deposit verified · awaiting 3P lender', run: () => act((x, at) => byoVerifyDeposit(x, at)) };
    if (!primary && !o.tradeInOpted) primary = { label: 'Continue', run: () => {}, block: 'Answer: did the customer opt in to a trade-in?' };
    fx = isByo ? (p.stage === 'deposit' ? ['BYO status → Awaiting Approval from 3P Lender', 'Start the lender clocks: pre-approval due in 2 business days, funds in 5', 'Car prep waits for the approval letter (GFR at Approved from 3P Lender)'] : [])
      : p.stage === 'deposit'
      ? ['Finance ticket → First Instalment Paid', 'Stamp GFR date on the order (HubSpot DW01b)', o.interstate ? 'Create the interstate inspection task for Delivery (DW02)' : 'Create the RWC / refurb task for the Refurb team (DW02)', 'Order moves to Car prep (HubSpot deal 4: Awaiting RWC)', 'Sync GFR to OMS']
      : [];
    const bank = o.paymentMethod === 'Bank transfer';
    const pending = p.stage === 'deposit';
    const payRows: Row[] = o.payments.filter((x) => !(isByo && x.type === 'LENDER_REMITTANCE')).map((x) => {
      const verify = pending && x.type === 'DEPOSIT' && bank;
      return { type: x.type, method: methodLabel(x.method), txn: <span className="mono">{x.ref}</span>, paid: `${fmtAge(Date.now() - x.at)} ago`, amount: money(x.amount), status: { label: verify ? 'To verify' : 'Success', variant: verify ? 'warning' : 'success' } };
    });
    body = (
      <>
        <SectionCard part="tradein" title="Trade-in" subtitle={o.tradeInBooking ? `At booking: ${o.tradeInBooking.car} · ${money(o.tradeInBooking.value)}` : 'No trade-in entered at booking'}
          badge={o.tradeInOpted ? { label: o.tradeInOpted === 'Yes' ? 'Opted in' : 'No trade-in', variant: o.tradeInOpted === 'Yes' ? 'information' : 'neutral' } : { label: 'Ask the customer', variant: 'warning' }}>
          <div className="rm-row">
            <div><b>Did the customer opt in to a trade-in?</b><small>Yes adds the Trade-in step and sends a valuation request to the Trade-In team</small></div>
            <SegmentTabs value={o.tradeInOpted || ('' as 'Yes')} disabled={!!o.rmDone.tradein || task(o, 'tradein')?.stage === 'final'} options={[{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }]} onChange={(v) => act((x, at) => setTradeInOpted(x, v, at))} />
          </div>
        </SectionCard>
        {isByo ? <SectionCard part="ticket" title="BYO finance ticket" subtitle="HubSpot 01b BYO Finance Customer · the status other teams' tasks hang off">
          <ByoStatusField o={o} act={act} open={byoOpen} setOpen={setByoOpen} />
        </SectionCard> : <SectionCard part="ticket" title="Finance ticket" subtitle="HubSpot 01a Cash Customer Finance" badge={{ label: stageDef(p).label, variant: pending ? 'warning' : 'success' }}>
          <TicketStatus o={o} t={p} title={`${o.id}-${first} (Finance Ticket)`} onMove={(to) => moveTask(p, to)} />
        </SectionCard>}
        <SectionCard part="payments" title="Payments" subtitle="Every payment on the order, from OMS">
          <DataTable columns={[{ key: 'type', label: 'Type' }, { key: 'method', label: 'Method' }, { key: 'txn', label: 'Transaction ID' }, { key: 'paid', label: 'Paid' }, { key: 'amount', label: 'Amount', align: 'right' }, { key: 'status', label: 'Status', isBadge: true }]} rows={payRows} />
        </SectionCard>
        <PriceBreakdown o={o} />
        {bank ? (
          <SectionCard part="proof" title="Payment proof" subtitle="Uploaded by the customer · proof_of_payment_link" badge={{ label: pending ? 'To verify' : 'Verified', variant: pending ? 'warning' : 'success' }}>
            <button className="proof-shot" onClick={() => setZoom(true)} aria-label="Open payment proof">
              <img src={proofPng(o)} alt={`Bank transfer receipt for ${o.id}`} />
              <span className="ps-cap"><b>{(o.proofUrl || '').split('/').pop()}</b><small>Uploaded {fmtAge(Date.now() - o.depositAt)} ago · click to enlarge</small></span>
            </button>
            {zoom && (
              <div className="lightbox" onClick={() => setZoom(false)}>
                <img src={proofPng(o)} alt={`Bank transfer receipt for ${o.id}`} />
                <button className="lb-x" aria-label="Close">×</button>
              </div>
            )}
            {!pending && <InfoMessage tone="success" icon="circle-check-filled">Proof verified. First instalment confirmed and car prep has started (GFR).</InfoMessage>}
          </SectionCard>
        ) : (
          <InfoMessage tone="neutral">Paid by {methodLabel(o.paymentMethod)}. Stripe confirmed it and moved the ticket to {isByo ? 'Awaiting Approval from 3P Lender' : 'First Instalment Paid'} on its own. Nothing to verify.</InfoMessage>
        )}
      </>
    );
  }

  // Customer ID request tracker: raised in Customer documents, filled in Contract & invoice.
  const crnName = CRN_NAME[o.customer.state];
  const crnOk = /^\d{6,10}$/.test(crn.trim());
  const crnStage = o.dl.status === 'ID requested' ? 1 : o.dl.status === 'ID received' ? 2 : o.dl.status === 'Verified' ? 3 : 0;
  const crnTracker = (editable: boolean) => (
    <div className="crn">
      <div className="crn-steps">{['Requested', 'Awaiting customer', 'Received', 'Verified'].map((st, k) => { const done = (k < crnStage && o.dl.status !== 'Uploaded') || o.dl.status === 'Verified'; return <div key={st} className={done ? 'done' : k === crnStage && o.dl.status !== 'Uploaded' ? 'on' : ''}><i>{done ? '✓' : k + 1}</i>{st}</div>; })}</div>
      {o.dl.status === 'Uploaded' || o.dl.status === 'Re-upload requested' ? (
        <div className="cs">{o.dl.state} licence, registering in {o.customer.state}: the customer needs a {crnName} from the {o.customer.state} road authority. Raise the request and LeadVerse sends them a portal link with the steps.</div>
      ) : o.dl.status === 'ID requested' ? (
        <>
          <div className="cs">Requested {fmtAge(Date.now() - (o.dl.requestedAt || Date.now()))} ago · {o.dl.reminders || 0} reminder{o.dl.reminders === 1 ? '' : 's'} sent · SLA 24h. {editable ? 'The customer can submit it on the portal, or enter it here if they share it on a call.' : 'Collected in Contract & invoice, before the final payment.'}</div>
          {editable && (
            <div className="crn-in">
              <label className="tf"><span>{crnName} <i className="req">*</i></span><input className="tf-in" inputMode="numeric" value={crn} placeholder="e.g. 123456789" onChange={(e) => setCrn(e.target.value)} /></label>
              <button className="btn primary" disabled={!crnOk} title={crnOk ? '' : 'Enter 6–10 digits'} onClick={() => act((x, at) => { receiveCrn(x, crn.trim(), 'Agent (phone)', at); verifyDl(x, at); })}>Save &amp; verify</button>
              <button className="btn" onClick={() => act((x, at) => remindCrn(x, at))}>Send reminder</button>
            </div>
          )}
        </>
      ) : (
        <div className="cs">Received: <b>{o.dl.crn}</b> via {o.dl.crnVia}{o.dl.status === 'Verified' ? ' · passed to the Registration team' : ''}.</div>
      )}
    </div>
  );

  if (step === 'docs') {
    const dl = o.dl;
    const sug = dlSuggest(o);
    const ans = dl.checks || {};
    const QS: [DlCheck, string, string][] = [
      ['name', 'Name on the licence matches the buyer', o.customer.name],
      ['valid', 'Licence is valid (not expired, not expiring within 30 days)', `Expires ${dl.expiry}`],
      ['clear', 'Front and back are clear and readable', 'Both sides uploaded'],
      ['state', 'Licence state matches the car registration state', `Licence ${dl.state} · registering in ${o.customer.state}`],
    ];
    const answered = QS.every(([k]) => ans[k]);
    const reupload = (['name', 'valid', 'clear'] as DlCheck[]).filter((k) => ans[k] === 'No');
    const stateNo = ans.state === 'No';
    const open = dl.status === 'Uploaded' || dl.status === 'Re-upload requested';
    if (open) {
      if (!answered) {
        primary = { label: "Verify driver's licence", run: () => {}, block: 'Answer all four checks first' };
        alts = [{ label: 'Accept the system suggestions', run: () => act((x) => QS.forEach(([k]) => setDlCheck(x, k, sug[k]))) }];
      } else if (reupload.length) {
        primary = { label: 'Request licence re-upload', run: () => act((x, at) => requestReupload(x, reupload.map((k) => ({ name: 'name mismatch', valid: 'expired or expiring', clear: 'image not readable', state: '' })[k]), at)) };
      } else if (stateNo) {
        primary = { label: `Raise customer ID request (${crnName})`, run: () => act((x, at) => requestCrn(x, at)) };
      } else {
        primary = { label: "Verify driver's licence", run: () => act((x, at) => verifyDl(x, at)) };
      }
    }
    fx = !open ? [] : stateNo && !reupload.length ? [`Raise a customer ID request: SMS + email with a portal link and how to get a ${crnName} from the ${o.customer.state} road authority`, 'Track it on the order (requested, reminders, received) with a 24h SLA', 'This step is done; the number is collected in Contract & invoice, before the final payment']
      : reupload.length ? ['Send the customer a portal link to upload the licence again, with the reason', 'Checks reset when the new images arrive'] : ["Mark the licence verified", 'Registration team can lodge the transfer', 'Sync to OMS'];
    const dlTone = dl.status === 'Verified' ? 'success' : dl.status === 'Re-upload requested' ? 'error' : dl.status === 'Uploaded' ? 'warning' : 'information';
    body = (
      <>
        <SectionCard part="licence" title="Driver's licence" subtitle="Uploaded by the customer on the portal · click a side to enlarge" badge={{ label: dl.status, variant: dlTone }}>
          <div className="dl-imgs">
            {(['front', 'back'] as const).map((sd) => (
              <button key={sd} className="dl-img" onClick={() => setDlZoom(sd)} aria-label={`Open licence ${sd}`}><img src={dlPng(o, sd)} alt={`Driver's licence ${sd}`} /><span>{sd === 'front' ? 'Front' : 'Back'}</span></button>
            ))}
          </div>
          <FetchedInfo cols={3} items={[['Licence holder', o.customer.name], ['Licence number', dl.number], ['State of issue', dl.state], ['Expiry', dl.expiry], ['Lives in', `${o.customer.suburb}, ${o.customer.state}`], ['Car registration state', o.customer.state]]} />
        </SectionCard>
        {dlZoom && <div className="lightbox" onClick={() => setDlZoom('')}><img src={dlPng(o, dlZoom)} alt={`Driver's licence ${dlZoom}`} /><button className="lb-x" aria-label="Close">×</button></div>}

        <SectionCard part="checks" title="Agent checks" subtitle="Four checks, each with the system's suggestion" badge={answered ? { label: reupload.length || stateNo ? 'Action needed' : 'All passed', variant: reupload.length ? 'error' : stateNo ? 'warning' : 'success' } : { label: `${QS.filter(([k]) => ans[k]).length} of 4 answered`, variant: 'neutral' }}>
          <div className="rm-rows">
            {QS.map(([k, q, hint]) => (
              <div key={k} className={'rm-row' + (ans[k] === 'No' ? ' no' : '')}>
                <div><b>{q}</b><small>{hint} · <span className={'sugg ' + sug[k].toLowerCase()}>System: {sug[k]}</span></small></div>
                <SegmentTabs value={(ans[k] || '') as 'Yes'} disabled={!open} options={[{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }]} onChange={(v) => act((x) => setDlCheck(x, k, v))} />
              </div>
            ))}
          </div>
          {reupload.length > 0 && <InfoMessage tone="error">The licence fails a check, so ask the customer to upload it again before going further.</InfoMessage>}
          {dl.status === 'Re-upload requested' && <InfoMessage tone="warning">Re-upload requested. Waiting for new images from the customer.</InfoMessage>}
        </SectionCard>

        {(stateNo || dl.crn) && !reupload.length && (
          <SectionCard part="crn" title={`Customer ID request · ${crnName}`} subtitle={`${dl.state} licence, registering in ${o.customer.state}`}>
            {crnTracker(false)}
          </SectionCard>
        )}
        {dl.status === 'ID requested' && <InfoMessage>Licence checked. Customer ID request raised; the RM collects the {crnName} in Contract &amp; invoice, before the final payment.</InfoMessage>}
        {dl.status === 'Verified' && <InfoMessage tone="success" icon="circle-check-filled">Licence verified{dl.crn ? ` · ${crnName} ${dl.crn} passed to Registration` : ''}.</InfoMessage>}
      </>
    );
  }

  if (step === 'final') {
    const signed = isDone(c);
    const stale = (['contract', 'invoice'] as DocKey[]).filter((k) => docOutdated(o, k));
    const idPending = o.dl.status === 'ID requested' || o.dl.status === 'ID received';
    if (!signed) { const a = taskActions(c); primary = a.primary; alts = a.alts; }
    else if (idPending) {
      primary = { label: `Save & verify ${crnName}`, run: () => act((x, at) => { receiveCrn(x, crn.trim(), 'Agent (phone)', at); verifyDl(x, at); }), block: !crnOk ? `Enter the ${crnName} (6–10 digits)` : '' };
      alts = [
        { label: 'Send reminder (SMS + email)', run: () => act((x, at) => remindCrn(x, at)) },
        { label: 'Demo: customer shares it on the portal', run: () => act((x, at) => { receiveCrn(x, String(100000000 + (x.id.charCodeAt(3) * 7919) % 899999999), 'Customer portal', at); verifyDl(x, at); }) },
      ];
    }
    else if (stale.length) primary = { label: `Regenerate ${stale.map((k) => DOC_LABEL[k].split(' (')[0].toLowerCase()).join(' & ')}`, run: () => act((x, at) => stale.forEach((k) => regenerateDoc(x, k, at))) };
    else if (!o.rmDone.final) primary = { label: 'Confirm contract & invoice', run: () => act((x, at) => skipStep(x, 'final', 'Contract signed and tax invoice checked before the final payment', at)) };
    const n0 = availableNext(o, c)[0];
    fx = !signed ? (n0?.to === 'signed' ? ['Stamp contract signed date (HubSpot TW02a)', 'Contract gate ✓ for delivery', 'Sync to OMS so the customer app can open the slot'] : n0?.to === 'sent' ? ['Send the DocuSign envelope with the tax invoice', 'Deal contract status → Contract not signed (TW02b)', 'Nudge the customer after 48h'] : [])
      : idPending ? [`Save the ${crnName} on the order and mark the licence verified`, 'Pass it to the Registration team so the transfer can be lodged', 'Registration is on the delivery critical path'] : stale.length ? ['Call the regenerate API for each outdated document', 'A regenerated contract goes out as a new DocuSign envelope'] : !o.rmDone.final ? ['Contract & invoice gate ✓ — the final payment can be taken'] : [];
    const check = (ok: boolean, label: string, note: string, k?: DocKey) => (
      <div className={'chk' + (ok ? ' ok' : ' bad')}>
        <i>{ok ? '✓' : '!'}</i><div><b>{label}</b><small>{note}</small></div>
        {k && !ok && <button className="btn sm" onClick={() => act((x, at) => regenerateDoc(x, k, at))}>Regenerate</button>}
      </div>
    );
    body = (
      <>
        <SectionCard part="ticket" title="Customer documents ticket" subtitle="HubSpot 02 Sales Contracts · DocuSign" badge={{ label: stageDef(c).label, variant: signed ? 'success' : 'warning' }}>
          <TicketStatus o={o} t={c} title={`${o.id}-${o.apptId}(Customer Documents)`} onMove={(to) => moveTask(c, to)} />
          {!signed && <StageFields t={c} onField={(k, v) => onField(c.id, k, v)} />}
        </SectionCard>
        <SectionCard part="checks" title="Before the final payment" subtitle="The contract and the invoice must match the order as it is now" badge={o.rmDone.final ? { label: 'Checked', variant: 'success' } : undefined}>
          <div className="chks">
            {check(signed, 'Contract signed', signed ? 'DocuSign envelope completed' : ['sent', 'form4', 'review'].includes(c.stage) ? 'Sent · waiting for the customer to sign' : 'Not sent yet')}
            {check(!docOutdated(o, 'contract'), `Contract up to date · v${o.docs.contract.v}`, docOutdated(o, 'contract') ? 'Order changed after it was generated (discount, VAS or trade-in)' : `Generated ${fmtAge(Date.now() - o.docs.contract.at)} ago`, 'contract')}
            {check(!docOutdated(o, 'invoice'), `Tax invoice correct · v${o.docs.invoice.v}`, docOutdated(o, 'invoice') ? `Invoice total is out of date; order total is now ${money(orderTotal(o))}` : `Total ${money(orderTotal(o))} · generated ${fmtAge(Date.now() - o.docs.invoice.at)} ago`, 'invoice')}
            {o.tradeIn && check(['form4', 'review', 'signed'].includes(c.stage) || signed, 'Trade-in Form 4', 'Required for the trade-in')}
            {(idPending || o.dl.crn) && check(o.dl.status === 'Verified', `Customer ID · ${crnName}`, o.dl.status === 'Verified' ? `${o.dl.crn} · received via ${o.dl.crnVia}` : `${o.dl.state} licence, registering in ${o.customer.state} · requested ${fmtAge(Date.now() - (o.dl.requestedAt || Date.now()))} ago`)}
          </div>
        </SectionCard>
        {(idPending || o.dl.crn) && <SectionCard part="crn" title={`Customer ID · ${crnName}`} subtitle="Collected here, before the final payment">{crnTracker(true)}</SectionCard>}
        {o.rmDone.final && <InfoMessage tone="success" icon="circle-check-filled">Checked {fmtAge(Date.now() - o.rmDone.final)} ago. Ready for the final payment.</InfoMessage>}
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
        <SectionCard part="checklist" title={SP_PAGE.title} subtitle={!done ? `Prefilled from the deal's sales promise · ${spForm.apiSources[0].key}` : `Submitted ${fmtAge(Date.now() - o.rmDone.promise!)} ago and handed to Refurb`} badge={done ? { label: 'Submitted', variant: 'success' } : { label: o.promises.length ? `${o.promises.length} promise${o.promises.length > 1 ? 's' : ''}` : 'No promise', variant: o.promises.length ? 'information' : 'neutral' }}>
          {!done ? (
            <SchemaForm stepper key={o.id} page={SP_PAGE} values={sp} showErrors={spTried} onChange={(id, v) => setSp((cur) => ({ ...cur, [id]: v }))} />
          ) : (
            <DataTable columns={[{ key: 'k', label: 'Field' }, { key: 'v', label: 'Answer' }]} rows={Object.entries(done).map(([k, v]) => ({ k: SP_PAGE.fields.find((f) => f.field_key === k)?.label || k, v: <span className="wrap">{Array.isArray(v) ? v.join(', ') : String(v)}</span> }))} />
          )}
        </SectionCard>
      </>
    );
  }

  if (step === 'discount') {
    const v = Number(disc.value || 0);
    const amt = disc.type === 'Flat' ? v : Math.round((o.price * v) / 100);
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
          <SectionCard part="calc" title="1 · Discount calculator" subtitle="Enter the outstanding amount you want; LeadVerse back-calculates the discount">
            <div className="dc-cols">
              <ul className="dc-list">
                {li('DAP', dap(o))}
                {li('EGC', o.price)}
                {li('Govt charges', govtCharges(o).total)}
                <ul className="dc-sub">{li('Motor vehicle duty', govtCharges(o).duty)}{li('3 months registration', govtCharges(o).rego)}{li('CTP insurance', govtCharges(o).ctp)}{li('Transfer fee', govtCharges(o).transfer)}{li('Handling fee', govtCharges(o).handling)}</ul>
              </ul>
              <ul className="dc-list">
                {li('Interstate charges', 0)}
                {li('Home delivery charges', o.shipping)}
                {li('Discount value', o.discount?.status === 'Applied' ? o.discount.amount : '—')}
                {li('VAS', vasTotal(o))}
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
          </SectionCard>
        )}

        {open && (
          <SectionCard part="generate" title="2 · Generate discount" subtitle={`Above ${money(DISCOUNT_LIMIT)} goes to the sales manager first`} badge={o.discount?.status === 'Awaiting approval' ? { label: 'Awaiting approval', variant: 'warning' } : undefined}>
          <div className="tform">
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
          </SectionCard>
        )}

        {o.discount && <InfoMessage tone={o.discount.status === 'Awaiting approval' ? 'warning' : 'success'}>Discount {o.discount.type === 'Percent' ? o.discount.value + '% · ' : ''}{money(o.discount.amount)} · {o.discount.reason}{o.discount.till ? ` · valid till ${o.discount.till}` : ''} · <b>{o.discount.status}</b></InfoMessage>}
        {!open && !o.discount && <InfoMessage tone="neutral">No discount on this order.</InfoMessage>}
      </>
    );
  }

  if (step === 'vas') {
    if (!o.rmDone.vas) {
      primary = { label: 'Confirm VAS with customer', run: () => act((x, at) => skipStep(x, 'vas', `VAS confirmed: ${x.vas.map((v) => v.name).join(', ')}`, at)) };
      alts = [{ label: 'Add VAS', run: () => setVasModal(true) }];
    }
    fx = !o.rmDone.vas ? ['Add each VAS to the order (b2c-admin VAS Sales) and recalculate DAP and the outstanding amount', 'Regenerate the tax invoice', 'Create the VAS install task for VAS ops when the money gate clears (R-04)', 'Warranty, insurance and ILOE need no install task'] : [];
    body = (
      <>
        <SectionCard part="vas" title="Value added services" subtitle="On the order now; each one changes the DAP and the invoice" right={<Button variant="secondary" icon="plus-large-outline" onClick={() => setVasModal(true)}>Add VAS</Button>}>
        <div className="tbox">
          <table className="tl-t">
            <thead><tr><th>VAS Item</th><th>Total Amount</th><th>Status</th><th>Details</th><th aria-label="Actions" /></tr></thead>
            <tbody>{o.vas.map((v) => (
              <Fragment key={v.name}>
                <tr>
                  <td>{v.name}</td><td className="mono">{money(v.price)}</td><td>{v.status || 'ACTIVE'}</td><td className="vas-d">{v.details || '—'}</td>
                  <td style={{ textAlign: 'right' }}><button className="vas-plus" aria-label={`More on ${v.name}`} aria-expanded={vasRow === v.name} onClick={() => setVasRow(vasRow === v.name ? '' : v.name)}>{vasRow === v.name ? '−' : '+'}</button></td>
                </tr>
                {vasRow === v.name && (
                  <tr className="vas-x"><td colSpan={5}>
                    <span>Plan type: <b>{v.type || '—'}</b>{task(o, 'vas', v.name) ? <> · Install task: <b>{stageDef(task(o, 'vas', v.name)!).label}</b></> : /warranty|insurance|iloe|service contract/i.test(v.name) ? ' · No install task needed' : ' · Install task created once the money gate clears'}</span>
                    {v.base ? <small>Included with every car, can't be removed</small> : <button className="btn sm danger" onClick={() => { setVasRow(''); act((x, at) => removeVas(x, v.name, at)); }}>Remove VAS</button>}
                  </td></tr>
                )}
              </Fragment>
            ))}</tbody>
          </table>
        </div>
        </SectionCard>
        <DapBreakup o={o} />
        <RegistrationDetails o={o} />
        {o.rmDone.vas && <InfoMessage tone="success" icon="circle-check-filled">VAS confirmed {fmtAge(Date.now() - o.rmDone.vas)} ago.</InfoMessage>}
        {vasModal && <AddVasModal o={o} onClose={() => setVasModal(false)} onAdd={(type, name) => { setVasModal(false); act((x, at) => addVas(x, VAS_CATALOG[type as keyof typeof VAS_CATALOG].find((p) => p.name === name)!, type, at)); }} />}
      </>
    );
  }

  if (step === 'tradein') {
    const tt = task(o, 'tradein');
    const ti = o.tradeIn;
    const fin = tt?.stage === 'final';
    const accepted = !!o.rmDone.tradein;
    if (tt && !fin) {
      primary = { label: 'Waiting for the Trade-In team', run: () => {}, block: tt.stage === 'disputed' ? 'Price conflict is with the Trade-In team for re-valuation' : 'The Trade-In team has not set the final price yet' };
      alts = [{ label: 'Nudge the Trade-In team', run: () => onComms('Nudged the Trade-In team on the trade-in valuation') }];
    } else if (fin && !accepted) {
      const conflict = tiAns.agree === 'Not agree';
      primary = conflict
        ? { label: 'Raise price conflict to Trade-In team', run: () => act((x, at) => disputeTradeIn(x, { reason: tiAns.reason, expected: Number(tiAns.expected) || undefined, note: tiAns.note.trim() }, at)), block: !tiAns.reason ? 'Pick why the customer does not agree' : tiAns.note.trim().length < 5 ? 'Add a note for the Trade-In team' : '' }
        : { label: `Confirm customer agreed ${money(ti!.value)}`, run: () => act((x, at) => acceptTradeIn(x, at)), block: tiAns.agree ? '' : 'Ask the customer and pick Agree or Not agree' };
      alts = [{ label: `Call ${first} about the final price`, run: () => onComms(`Call to ${o.customer.phone}: trade-in final price ${money(ti!.value)} discussed`) }];
    }
    fx = fin && !accepted ? (tiAns.agree === 'Not agree' ? ['Trade-In ticket moves to Price conflict with your reason, expected price and note', 'The Trade-In team re-values and sets a revised price; it reflects here', 'Balance payment stays blocked until the customer agrees'] : ['Record the customer agreed the final trade-in price', 'Balance payment can go ahead at the new outstanding amount', 'Contract & invoice flag for regenerate if the price changed']) : tt && !fin ? ['The Trade-In team inspects the car and sets the final price', 'It reflects here and in the price breakup automatically'] : [];
    const v = tt?.fields || {};
    const shown = (fd: (typeof TI_FIELDS)[number]) => { const x = v[fd.key]; return fd.type === 'check' ? (x ? 'Uploaded' : 'Not uploaded') : x ? (fd.key === 'tiValue' ? money(Number(x)) : String(x)) : '—'; };
    const status = !tt ? '' : tt.stage === 'requested' ? `Valuation requested ${fmtAge(Date.now() - tt.enteredAt)} ago. The Trade-In team inspects the car and sets the final price; it shows here as soon as they do.`
      : tt.stage === 'disputed' ? `Price conflict raised ${fmtAge(Date.now() - tt.enteredAt)} ago: ${ti?.dispute || v.disputeNote}. With the Trade-In team for re-valuation.`
      : accepted ? `Customer accepted ${money(ti!.value)} ${fmtAge(Date.now() - o.rmDone.tradein!)} ago. Balance payment can go ahead.`
      : `Final price ${money(ti!.value)} set by the Trade-In team${ti!.offered && ti!.offered !== ti!.value ? ` (${money(ti!.offered)} at booking, ${ti!.value < ti!.offered ? '−' : '+'}${money(Math.abs(ti!.value - ti!.offered))})` : ''}. Confirm it with the customer.`;
    body = (
      <>
        <InfoMessage tone={tt && (tt.stage === 'disputed' || (fin && !accepted)) ? 'warning' : accepted ? 'success' : 'information'}>{status}</InfoMessage>
        <SectionCard part="details" title="Trade-in details" subtitle="Owned by the Trade-In team · read-only for the RM" badge={tt ? { label: stageDef(tt).label, variant: accepted ? 'success' : tt.stage === 'disputed' ? 'error' : fin ? 'warning' : 'neutral' } : undefined}>
        <div className="ti-form">
          {TI_FIELDS.map((fd, k) => (
            <label key={fd.key} className="tf"><span>{k + 1}. {fd.label.replace(' ($)', '')}</span><div className={'tf-ro' + (fd.key === 'tiValue' ? ' strong' : '')}>{shown(fd)}</div></label>
          ))}
        </div>
        <small className="tu-hint">*If modified by the Trade-In team, changes are stored in the B2C database only, not in C2B.</small>
        </SectionCard>
        {fin && !accepted && (
          <SectionCard part="decision" title="Customer decision on the price" subtitle={`Final price ${money(ti!.value)}, set by the Trade-In team`}>
            <div className="ti-ans">
              <label className="tf"><span>Customer agrees with {money(ti!.value)}? <i className="req">*</i></span>
                <div className="tf-sel"><select value={tiAns.agree} onChange={(e) => setTiAns({ ...tiAns, agree: e.target.value })}>
                  <option value="">Select</option><option>Agree</option><option>Not agree</option>
                </select></div>
              </label>
              {tiAns.agree === 'Not agree' && (
                <>
                  <label className="tf"><span>Reason <i className="req">*</i></span>
                    <div className="tf-sel"><select value={tiAns.reason} onChange={(e) => setTiAns({ ...tiAns, reason: e.target.value })}>
                      <option value="">Select reason</option>{TI_CONFLICT_REASONS.map((r) => <option key={r}>{r}</option>)}
                    </select></div>
                  </label>
                  <label className="tf"><span>Customer expected price (AUD) <i className="opt">optional</i></span>
                    <input className="tf-in" type="number" min="0" placeholder={`e.g. ${ti!.value + 500}`} value={tiAns.expected} onChange={(e) => setTiAns({ ...tiAns, expected: e.target.value })} />
                  </label>
                  <label className="tf full"><span>Note for the Trade-In team <i className="req">*</i></span>
                    <textarea className="tf-in sf-ta" placeholder="e.g. Has the full service history and new tyres; another dealer offered more" value={tiAns.note} onChange={(e) => setTiAns({ ...tiAns, note: e.target.value })} />
                  </label>
                </>
              )}
            </div>
          </SectionCard>
        )}
      </>
    );
  }

  if (step === 'balance' && isByo) {
    const nx = byoNext(o);
    if (nx.ev === 'approve' || nx.ev === 'remit') primary = { label: nx.label, run: () => setByoOpen(nx.ev) };
    else if (p.stage === 'remitShort') primary = { label: 'Add payment entry (customer gap)', run: () => setPayModal(true) };
    else if (p.stage === 'deposit') primary = { label: 'Verify the deposit first', run: () => setStep('deposit') };
    alts = [
      { label: `Call ${first} about the lender`, run: () => onComms(`Call to ${o.customer.phone}: lender status (${stageDef(p).label}) discussed`) },
      { label: `Email ${o.byo!.lender || 'the lender'} for an update`, run: () => onComms(`Email to ${o.byo!.lender}: status of application ${o.byo!.appNo || '(no number yet)'} for ${o.id}`) },
      { label: 'Correct the BYO status', run: () => setByoOpen('correct') },
      { label: 'Cancel sale', run: () => setByoOpen('cancel'), tone: 'danger' },
    ];
    fx = p.stage === 'awaiting' ? ['Approved from 3P lender → GFR: RWC / refurb task for Refurb', 'Approved amount short of the balance → RM told to warn the customer now']
      : p.stage === 'approved' ? ['Remittance covers the balance → Finance GFD: VAS tasks, handover slot open, FinOps confirms funds', 'Remittance short → Lender remittance received · outstanding deposit']
      : p.stage === 'remitShort' ? ['Customer pays the gap → outstanding $0 → Finance GFD on its own'] : [];
    body = (
      <>
        <ByoLenderStep o={o} onAddPayment={() => setPayModal(true)} />
        {payModal && <AddPaymentModal due={outstanding(o)} onClose={() => setPayModal(false)} onAdd={(amount, ref, e) => { setPayModal(false); act((x, at) => recordPayment(x, amount, ref, 'rm', at, e)); }} />}
      </>
    );
  }

  if (step === 'balance' && !isByo) {
    const left = outstanding(o);
    if (p.stage === 'deposit') {
      primary = { label: 'Record payment', run: () => {}, block: 'Confirm the first instalment in step 1 first' };
    } else if (['instalment', 'short'].includes(p.stage)) {
      primary = { label: 'Add payment entry', run: () => setPayModal(true), block: o.tradeInOpted === 'Yes' && !o.rmDone.tradein ? 'Trade-in final price not agreed with the customer yet' : !o.rmDone.final ? 'Check the contract & invoice first (previous step)' : '' };
      alts = [{ label: `Call ${first} to chase the balance`, run: () => onComms(`Call to ${o.customer.phone}: balance of ${money(left)} discussed`) }, ...taskActions(p).alts];
      fx = ['Add the payment to the ledger', `Fully paid → Finance ticket to Final remittance received, else Awaiting additional deposit (HubSpot TW01a)`];
    } else {
      const a = taskActions(p);
      primary = a.primary; alts = a.alts;
      if (p.stage === 'final') fx = ['Stamp Finance GFD date (HubSpot DW01e)', 'Create the VAS install tasks for Refurb (cash)', 'Finance gate ✓ for delivery', 'Sync to OMS'];
    }
    body = (
      <>
        <SectionCard part="payments" title="Payments" subtitle="The ledger; each entry needs a transaction and a reference ID" badge={{ label: left ? `${money(left)} outstanding` : 'Paid in full', variant: left ? 'warning' : 'success' }}
          right={['instalment', 'short'].includes(p.stage) && !primary?.block ? <LinkButton icon="plus-large-outline" onClick={() => setPayModal(true)}>Add payment entry</LinkButton> : undefined}>
          <DataTable columns={[{ key: 'type', label: 'Payment type' }, { key: 'src', label: 'Source' }, { key: 'txn', label: 'Transaction ID' }, { key: 'ref', label: 'Reference' }, { key: 'amt', label: 'Amount', align: 'right' }, { key: 'paid', label: 'Paid' }, { key: 'by', label: 'By' }]}
            rows={o.payments.map((x) => ({ type: x.type, src: x.method || '—', txn: <span className="mono">{x.txn || '—'}</span>, ref: <span className="mono">{x.ref}</span>, amt: money(x.amount), paid: `${fmtAge(Date.now() - x.at)} ago`, by: x.receivedBy || x.by }))} />
        </SectionCard>
        <FinalBreakup o={o} />
        {payModal && <AddPaymentModal due={left} onClose={() => setPayModal(false)} onAdd={(amount, ref, e) => { setPayModal(false); act((x, at) => recordPayment(x, amount, ref, 'rm', at, e)); }} />}
        {p.stage === 'final' && <SectionCard part="gfd" title="Finance GFD" subtitle="Properties HubSpot needs before Finance GFD"><StageFields t={p} onField={(k, v) => onField(p.id, k, v)} /></SectionCard>}
        {isDone(p) && <InfoMessage tone="success" icon="circle-check-filled">Finance GFD. Fully paid.</InfoMessage>}
      </>
    );
  }

  if (step === 'prep') {
    const open = (['rwc', 'refurb', 'rego'] as const).map((j) => task(o, j)).filter((t) => t && !isDone(t));
    alts = open.map((t) => ({ label: `Nudge ${t!.journey === 'refurb' ? 'Refurb' : 'Registration & RWC'} on ${stageDef(t!).label}`, run: () => onComms(`Nudged the ${t!.journey === 'refurb' ? 'Refurb' : 'Registration & RWC'} team: ${stageDef(t!).label}`) }));
    body = <SectionCard part="prep" title="Car prep" subtitle="Read-only: RWC, refurb, registration and VAS belong to their teams"><PrepStatus o={o} /></SectionCard>;
  }

  if (step === 'delivery') {
    const clear = gatesClear(o);
    if (!o.slot) {
      primary = { label: 'Book & confirm slot', run: () => onBook(date, time, false), block: clear ? '' : 'Blocked by: ' + gateStatus(o).filter((g) => !g.ok).map((g) => g.label).join(', ') };
      alts = !isDone(c) ? [{ label: o.bypassContract ? 'Remove contract gate bypass' : 'Bypass contract gate (by_pass_contract_gfd_for_delivery_slots)', run: () => onBypass(!o.bypassContract) }] : [];
      fx = ['Book the slot and create / move the Handover task for Delivery', 'Email + SMS confirmation to the customer', o.deliveryMode === 'Home delivery' ? 'Shipping charge is on the invoice' : 'Pick-up at ' + o.car.hub.split(' · ')[0]];
    }
    const gates = gateStatus(o);
    const hub = o.car.hub.split(' · ')[0];
    // Slot capacity per day at the hub: a full day, or a taken time, shows as a disabled slot.
    const DAYS = [['Wed 18 Nov', '3 of 6 handovers left'], ['Thu 19 Nov', '1 of 6 handovers left'], ['Fri 20 Nov', 'Fully booked', true], ['Sat 21 Nov', '5 of 6 handovers left']] as const;
    const TIMES = [['9:00 am', 'Hub opens 8:30'], ['11:00 am', ''], ['1:00 pm', 'Taken by another handover', true], ['3:00 pm', 'Last slot of the day']] as const;
    body = (
      <>
        <SectionCard part="mode" title="Delivery mode" subtitle={o.deliveryMode === 'Home delivery' ? 'The shipping charge goes on the invoice' : `Customer collects at ${hub}`} badge={{ label: o.shipping ? money(o.shipping) + ' shipping' : 'No shipping charge', variant: 'neutral' }}>
          <SegmentTabs value={o.deliveryMode} disabled={!!o.slot} options={[{ value: 'Pick up', label: 'Pick up at the hub' }, { value: 'Home delivery', label: 'Home delivery' }]} onChange={(v) => act((x, at) => setDeliveryMode(x, v as Order['deliveryMode'], at))} />
        </SectionCard>
        <SectionCard part="gates" title="Handover gates" subtitle="The slot opens when every gate is clear (HubSpot DW06a, OMS isDeliveryBookingAllowed)" badge={{ label: `${gates.filter((g) => g.ok).length} of ${gates.length} clear`, variant: clear ? 'success' : 'warning' }}>
          <DataTable columns={[{ key: 'g', label: 'Gate' }, { key: 'w', label: 'Owner' }, { key: 'st', label: 'Status', isBadge: true }]}
            rows={gates.map((g) => { const na = 'na' in g && g.na; const ov = 'override' in g && g.override; return { g: g.label, w: PERSONAS[g.owner].short, st: { label: na ? 'Not interstate' : ov ? 'Bypassed by RM' : g.ok ? 'Clear' : 'Open', variant: ov ? 'warning' : g.ok ? 'success' : 'neutral' } }; })} />
        </SectionCard>
        {!o.slot ? (
          <SectionCard part="slot" title="Handover slot" subtitle={clear ? `${hub} · pick a day, then a time` : 'Slots open once every gate is clear'} badge={clear ? { label: 'Open to book', variant: 'success' } : { label: 'Blocked', variant: 'warning' }}>
            <div className="tu-slots-2">
              <SelectionSlots title="Day" ariaLabel="Handover day" value={date} onChange={setDate} slots={DAYS.map(([d, n, full]) => ({ value: d, title: d, description: clear ? n : 'Gates not clear', disabled: !clear || !!full }))} />
              <SelectionSlots title="Time" ariaLabel="Handover time" value={time} onChange={setTime} slots={TIMES.map(([t, n, taken]) => ({ value: t, title: t, description: clear ? n || undefined : undefined, disabled: !clear || !!taken }))} />
            </div>
          </SectionCard>
        ) : <InfoMessage tone="success" icon="calendar-check-outline">Booked for {o.slot.date} · {o.slot.time} by {o.slot.by}. Confirmation sent by email and SMS.</InfoMessage>}
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

  const track: Track = isByo ? 'byo' : 'cash';
  const spec = stepByKey(track, step);
  const specOf = (k: RmStep) => stepByKey(track, k);
  const phases = PHASES.filter((ph) => SV.some((x) => specOf(x.key)?.phase === ph.id));
  const curPh = spec?.phase;
  const state = orderState(o);
  const mainExit = spec?.exits.find((e) => e.main);
  return (
    <>
      <div className={'rm-phases' + (stepsOpen ? '' : ' mini')}>
        <div className="stagebar">
          {phases.map((ph) => {
            const keys = SV.filter((x) => specOf(x.key)?.phase === ph.id);
            const allDone = keys.every((x) => stepDone(o, x.key));
            const cls = ph.id === curPh ? 'act' : allDone ? 'done' : '';
            return (
              <button key={ph.id} className={'stg ' + cls} onClick={() => setStep((keys.find((x) => !stepDone(o, x.key)) || keys[0]).key)}>
                <span className="stg-dot">{cls === 'done' ? '✓' : ph.id}</span>
                <b>{ph.name}</b>
                <small>{cls === 'done' ? 'completed' : cls === 'act' ? 'active' : `${keys.filter((x) => stepDone(o, x.key)).length} of ${keys.length} done`}</small>
              </button>
            );
          })}
          <button className="stog" aria-label={stepsOpen ? 'Hide the steps' : 'Show the steps'} onClick={toggleSteps}>{stepsOpen ? '⌃' : '⌄'}</button>
        </div>
        {stepsOpen && (
          <div className="substeps">
            {SV.filter((x) => specOf(x.key)?.phase === curPh).map((x) => {
              const sp = specOf(x.key)!;
              return <button key={x.key} className={'stepdot' + (x.key === step ? ' act' : stepDone(o, x.key) ? ' done' : '') + (sp.branch ? ' br' : '')} onClick={() => setStep(x.key)}>{sp.id} · {sp.name}</button>;
            })}
            {cancelled && <span className="chip c-red">Sale cancelled</span>}
          </div>
        )}
      </div>
      <div className="ws-body">
        <div className="rm-title">
          <h2>{spec?.name || cur.label} <span className="step-id">{spec?.id}</span>{done && <span className="chip c-green">Done</span>}<span className={'chip st-' + STATES[state]}>{state}</span></h2>
          <p>{spec?.screen.split(' › ')[1] === 'Lender finance' ? 'The balance comes from the customer’s lender: this step follows the BYO status.' : GUIDE[step]}</p>
        </div>
        <Dls className="rm-dls">
          <div className="tu-stack">
            {isByo && step !== 'deposit' && <ByoStatusCard o={o} act={act} open={byoOpen} setOpen={setByoOpen} />}
            {body}
          </div>
        </Dls>
        {fx.length > 0 && <Fx items={fx} />}
        {primary?.block && <div className="blocked">{primary.block}</div>}
        {spec && <button className="lnk-btn spec-tog" onClick={() => setShowSpec(!showSpec)}>{showSpec ? 'Hide' : 'Show'} the spec for {spec.id}</button>}
        {spec && showSpec && (
          <div className="specbox">
            <div className="kvbox">
              <div><span>Owner</span><b>{spec.owner}</b></div>
              <div><span>Trigger</span><b>{spec.trigger}</b></div>
              <div><span>Screen</span><b>{spec.screen}</b></div>
              <div><span>Route</span><b className="mono">{spec.route}</b></div>
              {spec.rules.length > 0 && <div><span>Rules</span><b>{spec.rules.join(' · ')}</b></div>}
            </div>
            <div className="lp-title">Data it reads and writes</div>
            <ul className="bul">{spec.data.map((x) => <li key={x}>{x}</li>)}</ul>
            <div className="lp-title">HubSpot today</div>
            <p className="sp-p">{spec.hubspot}</p>
          </div>
        )}
      </div>
      <div className="ws-foot">
        <button className="btn prevb" disabled={idx === 0} onClick={() => go(-1)}>Previous</button>
        <span className="exit">{done ? 'Step complete' : `${spec?.exits.length || 0} exits · state on main exit: ${mainExit?.state || 'none'}`}</span>
        <div className="split">
          {primary ? (
            <button className="btn primary" disabled={!!primary.block || cancelled} title={primary.block} onClick={() => { primary!.run(); setMenu(false); }}>{primary.label}</button>
          ) : (
            <button className="btn primary" disabled={idx === SV.length - 1 && done} onClick={goNextOpen}>{idx === SV.length - 1 ? 'All done' : 'Next: ' + (specOf(SV.slice(idx + 1).find((x) => !stepDone(o, x.key))?.key || step)?.name || 'next open step')}</button>
          )}
          <button className="btn primary caret" aria-label="More exits" onClick={() => setMenu(!menu)}>▾</button>
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

// One line under each step's title.
const GUIDE: Record<RmStep, string> = {
  deposit: 'Confirm the deposit and whether a trade-in is coming.',
  docs: 'Check the licence against the order before registration needs it.',
  discount: 'Apply what was agreed on the lot, from the outstanding amount or the discount itself.',
  vas: 'Confirm add-ons; each one changes the drive-away price.',
  promise: 'Turn what the ground team promised into Refurb’s checklist.',
  tradein: 'Agree the Trade-In team’s final price with the customer.',
  final: 'The contract and invoice must match the order before the final payment.',
  balance: 'Collect the balance and reach Finance GFD.',
  prep: 'Where the car is, team by team. Read-only.',
  delivery: 'Pick up or home delivery, then a slot once every gate is clear.',
};

// The order's state, the badge PISTON shows beside the step title.
export function orderState(o: Order): string {
  const p = task(o, 'payment');
  if (p?.stage === 'cancelled') return 'SALE CANCELLED';
  if (o.slot) return 'DELIVERY BOOKED';
  if (gatesClear(o)) return 'READY TO BOOK';
  if (o.paymentMode === 'BYO') {
    if (p?.stage === 'settled') return 'LOAN SETTLED';
    if (p?.stage === 'remit') return 'FINANCE GFD';
    if (p?.stage === 'remitShort') return 'OUTSTANDING DEPOSIT';
    if (p?.stage === 'approved') return 'LENDER APPROVED';
    if (p?.stage === 'awaiting') return 'AWAITING 3P LENDER';
    return 'DEPOSIT PAID';
  }
  if (gatesClear(o)) return 'READY TO BOOK';
  if (isDone(p)) return 'FINANCE GFD';
  if (p?.stage === 'short') return 'OUTSTANDING DEPOSIT';
  if (p && p.stage !== 'deposit') return 'GFR';
  return 'DEPOSIT PAID';
}
