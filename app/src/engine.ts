// Order state and the workflow engine. Stage changes are events; trigger rules
// react to events and create tasks for other personas — what HubSpot workflows do today.
import { GATES, JOURNEYS, type JourneyId, type PersonaId, type RmStageKey } from './model';

export type State = 'VIC' | 'NSW' | 'QLD';
export type PaymentMode = 'Cash' | 'BYO' | 'Cars24 finance';

export interface Task {
  id: string;
  journey: JourneyId;
  stage: string;
  enteredAt: number;
  createdAt: number;
  item?: string; // VAS product name
  fields: Record<string, string | boolean>;
}

export interface Activity {
  at: number;
  who: string;
  kind: 'stage' | 'rule' | 'comms' | 'note' | 'gate' | 'block';
  text: string;
  rule?: string;
  persona?: PersonaId;
}

export type PlanType = 'SERVICE_CONTRACT' | 'TINTING' | 'COATING' | 'WARRANTY' | 'INSURANCE' | 'ILOE' | 'ACCESSORY';
export interface VasItem { name: string; price: number; type?: PlanType; status?: 'ACTIVE' | 'CANCELLED'; details?: string; base?: boolean }

const tint = (code: string) => `Duration Months: 0, Tinting Percentage: 30, Front windshield 6" tint: Yes, Calc Unique Code: ${code}`;
// Add VAS catalogue (plan type → plans), as in the B2C admin Add VAS form. Prices are placeholders.
export const VAS_CATALOG: Record<Exclude<PlanType, 'ACCESSORY'>, VasItem[]> = {
  SERVICE_CONTRACT: [
    { name: 'Service Contract - 1 yr / 15,000 km', price: 690, details: 'Duration Months: 12, Services: 1, Calc Unique Code: SC_12_1' },
    { name: 'Service Contract - 2 yr / 30,000 km', price: 1290, details: 'Duration Months: 24, Services: 2, Calc Unique Code: SC_24_2' },
  ],
  TINTING: [
    { name: 'Tinting - 3M Color Stable', price: 449, details: tint('3M_T_00002') },
    { name: 'Tinting - Global NR Quick Dry PLUS Films', price: 349, details: tint('GL_T_00004') },
    { name: 'Tinting - 3M FX-ST', price: 399, details: tint('3M_T_00001') },
    { name: 'Tinting - 3M Crystalline', price: 899, details: tint('3M_T_00003') },
    { name: 'Tinting - Global Nano Ceramic IR Films', price: 599, details: tint('GL_T_00005') },
    { name: 'Tinting - Global NR Quick Dry Films', price: 299, details: tint('GL_T_00003') },
  ],
  COATING: [
    { name: 'Coating - Ceramic 3 yr', price: 990, details: 'Duration Months: 36, Calc Unique Code: CC_36' },
    { name: 'Coating - Paint Protection Film (front)', price: 1490, details: 'Duration Months: 60, Coverage: Bonnet, bumper, mirrors, Calc Unique Code: PPF_F' },
  ],
  WARRANTY: [
    { name: 'Extended Warranty - 1 yr', price: 699, details: 'Duration Months: 12, Calc Unique Code: EW_12' },
    { name: 'Extended Warranty - 2 yr', price: 1099, details: 'Duration Months: 24, Calc Unique Code: EW_24' },
    { name: 'Extended Warranty - 3 yr', price: 1499, details: 'Duration Months: 36, Calc Unique Code: EW_36' },
  ],
  INSURANCE: [
    { name: 'Comprehensive Insurance - 12 months', price: 1250, details: 'Duration Months: 12, Excess: $800, Calc Unique Code: INS_C_12' },
    { name: 'GAP Insurance - 36 months', price: 450, details: 'Duration Months: 36, Calc Unique Code: INS_GAP_36' },
  ],
  ILOE: [
    { name: 'ILOE - Loan Protection 12 months', price: 299, details: 'Duration Months: 12, Cover: 3 repayments, Calc Unique Code: ILOE_12' },
  ],
};
export const BASE_WARRANTY: VasItem = { name: 'Cars24 Base Warranty', price: 0, type: 'WARRANTY', status: 'ACTIVE', details: 'Duration Months: 3, Calc Unique Code: BASE_162_B', base: true };

// Government charges for 3 months' registration (placeholder rates; duty ≈ 4.22% of the car price).
export function govtCharges(o: Order) {
  const duty = Math.round(o.price * 0.04223);
  const c = { transfer: 46, duty, rego: 173, ctp: 147, handling: 599, months: 3, plates: 'STANDARD' };
  return { ...c, total: c.transfer + c.duty + c.rego + c.ctp + c.handling };
}
export const vasTotal = (o: Order) => o.vas.filter((v) => v.status !== 'CANCELLED').reduce((a, v) => a + v.price, 0);
// DAP (drive-away price) = EGC + government charges + delivery fees + VAS + accessories.
export const dap = (o: Order) => o.price + govtCharges(o).total + o.shipping + vasTotal(o);

export interface Order {
  id: string;
  apptId: string;
  customer: { name: string; phone: string; email: string; state: State; suburb: string };
  car: { make: string; model: string; year: number; vin: string; km: number; hub: string; hubState: State; colour: string };
  paymentMode: PaymentMode;
  lender?: string;
  price: number;
  depositPaid: number;
  vas: VasItem[];
  promises: string[];
  tradeIn?: { car: string; value: number };
  deliveryMode: 'Pick up' | 'Home delivery';
  interstate: boolean;
  depositAt: number;
  gfrAt?: number; // HubSpot deal gfr_date
  paymentMethod: 'Bank transfer' | 'Card' | 'Stripe';
  proofUrl?: string; // deal proof_of_payment_link
  payments: { type: string; amount: number; at: number; ref: string; by: string; method?: string }[];
  discount?: { type: 'Flat' | 'Percent'; value: number; amount: number; reason: string; status: 'Applied' | 'Awaiting approval'; till?: string };
  shipping: number; // deal shipping_charges (home delivery)
  rmDone: Partial<Record<'promise' | 'discount' | 'tradein' | 'vas', number>>;
  promiseChecklist?: Record<string, string | string[]>; // submitted Sales Promise Refurbishment Checklist
  slot?: { date: string; time: string; by: string; override?: boolean };
  bypassContract: boolean;
  tasks: Task[];
  activity: Activity[];
}

export const HOUR = 3600_000;
let seq = 1;
const tid = () => 'T' + (1000 + seq++);

export function task(o: Order, j: JourneyId, item?: string) {
  return o.tasks.filter((t) => t.journey === j && (!item || t.item === item))[0];
}
export function stageDef(t: Task) {
  return JOURNEYS[t.journey].stages.find((s) => s.key === t.stage)!;
}
export function isDone(t?: Task) {
  return !!t && stageDef(t).kind === 'done';
}
const who = (p: PersonaId | 'system') => (p === 'system' ? 'Workflow' : `${PERSONA_USER[p]}`);
const PERSONA_USER: Record<PersonaId, string> = { rm: 'Priyanka A.', refurb: 'Marco D.', rego: 'Hannah L.', delivery: 'Josh K.', finops: 'FinOps', cx: 'CX team' };

function log(o: Order, a: Activity) {
  o.activity.unshift(a);
}

function createTask(o: Order, j: JourneyId, at: number, rule: string, item?: string) {
  const def = JOURNEYS[j];
  const t: Task = { id: tid(), journey: j, stage: def.stages[0].key, enteredAt: at, createdAt: at, item, fields: {} };
  o.tasks.push(t);
  log(o, { at, who: 'Workflow', kind: 'rule', rule, persona: def.persona, text: `Created ${def.name}${item ? ' · ' + item : ''} task for ${def.persona === 'rego' ? 'Registration' : def.persona === 'cx' ? 'CX' : def.persona === 'finops' ? 'FinOps' : def.persona === 'rm' ? 'RM' : def.persona === 'refurb' ? 'Refurb' : 'Delivery'}` });
  return t;
}

// ---------- gates ----------
// TW05: Registration Complete, or Registration Submitted for QLD, stamps registered_date.
export function isRegistered(o: Order) {
  const t = task(o, 'rego');
  return !!t && (isDone(t) || t.stage === 'qld');
}

export function gateStatus(o: Order) {
  return GATES.map((g) => {
    if (g.key === 'hub' && !o.interstate) return { ...g, ok: true, na: true };
    if (g.key === 'contract' && o.bypassContract && !isDone(task(o, 'contract'))) return { ...g, ok: true, override: true };
    if (g.key === 'rego') return { ...g, ok: isRegistered(o) };
    return { ...g, ok: isDone(task(o, g.journey)) };
  });
}
export const gatesClear = (o: Order) => gateStatus(o).every((g) => g.ok);

export function rmStage(o: Order): RmStageKey {
  if (isDone(task(o, 'delivery'))) return 'delivered';
  if (o.slot) return 'booked';
  if (!hasGfr(o)) return 'new';
  const prepJourneys: JourneyId[] = o.interstate ? ['transit', 'rwc', 'refurb'] : ['rwc', 'refurb'];
  const prep = prepJourneys.some((j) => !isDone(task(o, j))) || !isRegistered(o);
  if (prep) return 'prep';
  return gatesClear(o) ? 'ready' : 'blockers';
}

// HubSpot deal stage the order would show today.
export function hsDealStage(o: Order) {
  const s = rmStage(o);
  if (s === 'new' || !hasGfr(o)) return '1: Deposit Paid';
  if (s === 'delivered') return '9: Delivered';
  if (s === 'booked') return '8: Delivery Booked: GFD';
  if (o.interstate && !isDone(task(o, 'transit'))) return task(o, 'transit')?.stage === 'moving' ? '3: Interstate Transit In Progress' : '2: Awaiting Interstate Transit';
  if (!isDone(task(o, 'rwc'))) return '4: Awaiting RWC';
  // DW06a: Refurb GFD with any other date missing parks the deal at 7.
  if (isDone(task(o, 'refurb'))) return '7: Awaiting on blockers';
  if (!isRegistered(o)) return '5: Awaiting Registration';
  return '6: Awaiting Refurb GFD';
}

// ---------- events ----------
export function createOrder(base: Omit<Order, 'tasks' | 'activity' | 'bypassContract' | 'payments' | 'rmDone' | 'shipping'> & { shipping?: number }): Order {
  const o: Order = { ...base, vas: [{ ...BASE_WARRANTY }, ...base.vas], shipping: base.shipping || 0, tasks: [], activity: [], bypassContract: false, payments: [], rmDone: {} };
  const at = o.depositAt;
  const bank = o.paymentMethod === 'Bank transfer';
  const ref = bank ? 'BT-' + o.id.replace(/\W/g, '') : (o.paymentMethod === 'Card' ? 'pi_' : 'cs_') + o.id.replace(/\W/g, '').toLowerCase() + '3xK';
  o.payments.push({ type: 'DEPOSIT', amount: o.depositPaid, at, ref, by: 'Customer', method: o.paymentMethod });
  log(o, { at, who: 'Customer', kind: 'stage', text: `Deposit $${o.depositPaid.toLocaleString()} paid (${o.paymentMethod}) · order ${o.id} created` });
  createTask(o, 'payment', at, 'R-01');
  createTask(o, 'contract', at, 'R-01');
  // Card and Stripe deposits are confirmed by the Stripe webhook: no proof to check, ticket moves on its own.
  if (!bank) move(o, task(o, 'payment')!, 'instalment', 'system', at);
  log(o, { at, who: 'Workflow', kind: 'comms', text: 'Automated email: "Your car is reserved" sent to customer' });
  return o;
}

// GFR (Go For Refurb): the customer's money is committed, so car prep can start.
// HubSpot: DW01b stamps GFR Date from the finance ticket stage, DW02 creates the 05 ticket.
export const hasGfr = (o: Order) => !!o.gfrAt;
function fireGfr(o: Order, at: number) {
  if (hasGfr(o)) return;
  o.gfrAt = at;
  log(o, { at, who: 'Workflow', kind: 'rule', rule: 'R-03', text: `GFR reached (${o.paymentMode === 'Cash' ? 'first instalment paid' : o.paymentMode === 'BYO' ? 'approved by 3P lender' : 'loan approved'}) — car prep starts` });
  // DW02 branches on interstate_transit_required: 03 inspection ticket, or the 05 refurb ticket.
  if (o.interstate) createTask(o, 'transit', at, 'R-02');
  else createTask(o, 'rwc', at, 'R-03');
}

// One "VAS ticket pipelines – <product>" workflow per product. In-house finance goes at GFR
// (dashcam still waits for Finance GFD); Cash and BYO wait for Finance GFD; NSW also waits
// until the car is local. Extended warranty is a 07b warranty ticket, not a VAS install.
function vasCheck(o: Order, at: number) {
  if (!hasGfr(o)) return;
  const financeGfd = isDone(task(o, 'payment'));
  const local = o.customer.state !== 'NSW' || !o.interstate || isDone(task(o, 'transit'));
  o.vas.forEach((v) => {
    if (v.status === 'CANCELLED' || /warranty|insurance|iloe|service contract/i.test(v.name) || task(o, 'vas', v.name)) return;
    const money = o.paymentMode === 'Cars24 finance' && !/dash ?cam/i.test(v.name) ? true : financeGfd;
    if (money && local) createTask(o, 'vas', at, 'R-04', v.name);
  });
}

export interface MoveResult { ok: boolean; reason?: string }

export function canMove(o: Order, t: Task, to: string): MoveResult {
  if (t.journey === 'delivery' && to === 'today' && !o.slot)
    return { ok: false, reason: 'No slot booked yet (rule R-08). The RM or the customer books the slot first.' };
  return { ok: true };
}

export function move(o: Order, t: Task, to: string, by: PersonaId | 'system', at: number): MoveResult {
  const chk = canMove(o, t, to);
  if (!chk.ok) {
    log(o, { at, who: who(by), kind: 'block', text: chk.reason! });
    return chk;
  }
  const def = JOURNEYS[t.journey];
  const from = stageDef(t).label;
  t.stage = to;
  t.enteredAt = at;
  const s = stageDef(t);
  log(o, { at, who: who(by), kind: 'stage', persona: def.persona, text: `${def.name}${t.item ? ' · ' + t.item : ''}: ${from} → ${s.label}` });

  // trigger rules
  if (t.journey === 'payment' && ['instalment', 'short', 'final', 'gfd'].includes(to)) fireGfr(o, at);
  if (t.journey === 'payment' && to === 'cancelled') log(o, { at, who: 'Workflow', kind: 'rule', text: 'Sale cancelled — all open tickets on the order move to Cancelled sale; customer refund raised' });
  if (t.journey === 'transit' && to === 'arrived') createTask(o, 'rwc', at, 'R-11');
  if (t.journey === 'rwc' && to === 'complete') {
    createTask(o, 'rego', at, 'R-05');
    createTask(o, 'refurb', at, 'R-05');
  }
  if (t.journey === 'rwc' && to === 'fail') log(o, { at, who: 'Workflow', kind: 'rule', rule: 'R-10', text: 'RWC failed — RM notified; rework ETA is mandatory' });
  if (t.journey === 'delivery' && to === 'delivered') {
    createTask(o, 'warranty', at, 'R-09');
    createTask(o, 'checkin', at, 'R-09');
    log(o, { at, who: 'Workflow', kind: 'comms', text: 'Thank-you email + warranty pack queued' });
  }
  vasCheck(o, at);
  checkGates(o, at);
  return { ok: true };
}

// HubSpot DW06a/DW06b: Finance GFD ∧ Registered ∧ Refurb GFD ∧ Contract signed → 07 delivery
// ticket (owner by delivery state). OMS adds hub arrival for interstate cars.
function checkGates(o: Order, at: number) {
  if (!gatesClear(o) || task(o, 'delivery')) return;
  log(o, { at, who: 'Workflow', kind: 'gate', rule: 'R-07', text: 'All gates clear — Handover task created for Delivery, slot booking open, customer sent a self-book link' });
  createTask(o, 'delivery', at, 'R-07');
}

export function bookSlot(o: Order, date: string, time: string, by: PersonaId, at: number, override = false) {
  o.slot = { date, time, by: who(by), override };
  log(o, { at, who: who(by), kind: 'stage', persona: 'rm', text: `Delivery slot booked: ${date} · ${time}${override ? ' (RM override)' : ''}` });
  log(o, { at, who: 'Workflow', kind: 'comms', rule: 'R-08', text: `Instant confirmation sent by email + SMS to ${o.customer.phone}` });
  if (!task(o, 'delivery')) createTask(o, 'delivery', at, 'R-08');
}

export function setBypass(o: Order, on: boolean, at: number) {
  o.bypassContract = on;
  log(o, { at, who: who('rm'), kind: 'gate', text: on ? 'Contract gate bypassed for slot booking (by_pass_contract_gfd_for_delivery_slots)' : 'Contract gate bypass removed' });
}

// ---------- SLA ----------
export function ageHours(t: Task, now: number) {
  return (now - t.enteredAt) / HOUR;
}
export function slaState(t: Task, now: number): 'ok' | 'warn' | 'breach' | 'none' {
  const s = stageDef(t);
  if (!s.slaHours || s.kind === 'done') return 'none';
  const h = ageHours(t, now);
  if (h > s.slaHours) return 'breach';
  if (h > s.slaHours * 0.75) return 'warn';
  return 'ok';
}
export function fmtAge(ms: number) {
  const h = ms / HOUR;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}
export const money = (n: number) => '$' + Math.round(n).toLocaleString('en-AU');
export function orderTotal(o: Order) {
  return dap(o) - (o.discount?.status === 'Applied' ? o.discount.amount : 0) - (o.tradeIn?.value || 0);
}
export function outstanding(o: Order) {
  const p = task(o, 'payment');
  if (isDone(p) || p?.stage === 'final') return 0;
  return Math.max(0, orderTotal(o) - o.payments.reduce((a, x) => a + x.amount, 0));
}

// ---------- RM actions (B2C admin panel today) ----------
// TW01a: a new payment on a cash ticket moves it to Final remittance or Awaiting additional deposit.
export function recordPayment(o: Order, amount: number, ref: string, by: PersonaId, at: number) {
  o.payments.push({ type: o.payments.length === 1 ? 'FIRST_INSTALMENT' : 'BALANCE', amount, at, ref, by: who(by) });
  log(o, { at, who: who(by), kind: 'stage', persona: by, text: `Payment of ${money(amount)} recorded (${ref})` });
  const p = task(o, 'payment');
  if (!p || !['instalment', 'short'].includes(p.stage)) return;
  const left = outstanding(o);
  log(o, { at, who: 'Workflow', kind: 'rule', rule: 'R-12', text: left === 0 ? 'Fully paid — Finance ticket moved to Final remittance received' : `${money(left)} still outstanding — Finance ticket at Awaiting additional deposit` });
  move(o, p, left === 0 ? 'final' : 'short', 'system', at);
}

export const DISCOUNT_LIMIT = 500; // assumed approval threshold; the B2C tool shows an "Approval required" modal
export function applyDiscount(o: Order, type: 'Flat' | 'Percent', value: number, reason: string, at: number, till?: string) {
  const amount = type === 'Flat' ? value : Math.round((o.price * value) / 100);
  const status = amount > DISCOUNT_LIMIT ? 'Awaiting approval' : 'Applied';
  o.discount = { type, value, amount, reason, status, till };
  o.rmDone.discount = at;
  log(o, { at, who: who('rm'), kind: 'stage', persona: 'rm', text: `Discount ${type === 'Flat' ? money(value) : value + '%'} (${money(amount)}) — ${reason}` });
  log(o, { at, who: 'Workflow', kind: 'rule', rule: 'R-13', text: status === 'Applied' ? `Discount applied — outstanding now ${money(outstanding(o))}, tax invoice regenerated` : `Above ${money(DISCOUNT_LIMIT)} — sent to sales manager for approval` });
}
export function approveDiscount(o: Order, at: number) {
  if (!o.discount) return;
  o.discount.status = 'Applied';
  log(o, { at, who: 'Sales manager', kind: 'rule', rule: 'R-13', text: `Discount approved — outstanding now ${money(outstanding(o))}, tax invoice regenerated` });
}
export function addVas(o: Order, item: VasItem, type: PlanType, at: number) {
  o.vas.push({ ...item, type, status: 'ACTIVE' });
  log(o, { at, who: who('rm'), kind: 'stage', persona: 'rm', text: `VAS added: ${item.name} (${money(item.price)})` });
  log(o, { at, who: 'Workflow', kind: 'rule', rule: 'R-04', text: `Outstanding recalculated to ${money(outstanding(o))}; tax invoice regenerated` });
  vasCheck(o, at);
}
export function removeVas(o: Order, name: string, at: number) {
  const v = o.vas.find((x) => x.name === name && !x.base);
  if (!v) return;
  o.vas = o.vas.filter((x) => x !== v);
  log(o, { at, who: who('rm'), kind: 'stage', persona: 'rm', text: `VAS removed: ${name}` });
}
export function skipStep(o: Order, step: 'promise' | 'discount' | 'tradein' | 'vas', text: string, at: number) {
  o.rmDone[step] = at;
  log(o, { at, who: who('rm'), kind: 'stage', persona: 'rm', text });
}
export function finaliseTradeIn(o: Order, value: number, at: number) {
  if (!o.tradeIn) return;
  o.tradeIn.value = value;
  o.rmDone.tradein = at;
  log(o, { at, who: who('rm'), kind: 'stage', persona: 'rm', text: `Trade-in final value ${money(value)} (${o.tradeIn.car})` });
  log(o, { at, who: 'Workflow', kind: 'rule', rule: 'R-13', text: `Outstanding recalculated to ${money(outstanding(o))}; Trade-in ops task (02c) gets the final valuation` });
}
export function setDeliveryMode(o: Order, mode: Order['deliveryMode'], at: number) {
  o.deliveryMode = mode;
  o.shipping = mode === 'Home delivery' ? 299 : 0;
  log(o, { at, who: who('rm'), kind: 'stage', persona: 'rm', text: `Delivery mode set to ${mode}${o.shipping ? ` · shipping ${money(o.shipping)} added` : ''}` });
}

// Next actions offered at this stage for this order (state- and trade-in-specific ones filtered).
export function availableNext(o: Order, t: Task) {
  return (stageDef(t).next || []).filter((n) => (!n.states || n.states.includes(o.customer.state)) && (!n.tradeIn || !!o.tradeIn));
}
export function missingFields(t: Task, req?: string[]) {
  return (req || []).filter((k) => t.fields[k] === undefined || t.fields[k] === '' || t.fields[k] === false);
}
// Previous: step back one stage along the happy path (HubSpot lets teams drag a card back).
export function prevStage(t: Task) {
  const stages = JOURNEYS[t.journey].stages;
  const i = stages.findIndex((s) => s.key === t.stage);
  for (let j = i - 1; j >= 0; j--) if (!stages[j].kind) return stages[j].key;
  return null;
}
