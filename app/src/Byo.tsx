// BYO (bring your own finance): the lender's side of the money, on the DLS (Turbo UI).
// One status per order, the 01b finance ticket's stage. It is shown and updated from a card pinned on every RM step,
// so it never has to be re-entered or kept in step by hand; each move carries its evidence and lands in the history.
import { useState, type ReactNode } from 'react';
import { JOURNEYS } from './model';
import {
  BYO_LENDERS, byoApprove, byoCancel, byoCorrect, byoDue, byoRemit, byoSettle, byoVerifyDeposit, financeGfd, fmtAge, money, orderTotal, outstanding, paid, task,
  type Order,
} from './engine';
import { Badge, Button, Chip, DataTable, Dls, Dropdown, FetchedInfo, FileUploadCard, InfoMessage, LinkButton, SectionCard, TextInput, type BadgeVariant, type Row } from './dls/Dls';

type Act = (fn: (o: Order, at: number) => void) => void;
export type ByoEvent = 'approve' | 'remit' | 'settle' | 'correct' | 'cancel';

const STAGES = JOURNEYS.byo.stages;
export const byoLabel = (k: string) => STAGES.find((s) => s.key === k)?.label || k;
export const byoHs = (k: string) => STAGES.find((s) => s.key === k)?.hs || k;
export const BYO_TONE: Record<string, BadgeVariant> = { deposit: 'warning', awaiting: 'warning', approved: 'information', remitShort: 'error', remit: 'success', settled: 'success', cancelled: 'error' };
const ORDER = ['deposit', 'awaiting', 'approved', 'remitShort', 'remit', 'settled'];

// The next event the status is waiting for, and who makes it.
export function byoNext(o: Order): { ev: ByoEvent | null; label: string; who: string } {
  const s = task(o, 'payment')?.stage;
  if (s === 'deposit') return { ev: null, label: 'Verify the bank transfer deposit', who: 'RM' };
  if (s === 'awaiting') return { ev: 'approve', label: 'Approval letter received', who: 'RM or FinOps' };
  if (s === 'approved') return { ev: 'remit', label: 'Remittance advice received', who: 'RM' };
  if (s === 'remitShort') return { ev: null, label: 'Customer pays the gap', who: 'Customer' };
  if (s === 'remit') return { ev: 'settle', label: 'Funds received · loan settled', who: 'FinOps' };
  return { ev: null, label: s === 'settled' ? 'Loan settled' : 'Sale cancelled', who: '' };
}

const day = (at: number) => new Date(at).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
// doneAt: when the milestone actually happened; on time or late against the due date
const due = (at: number, now: number, doneAt?: number): { label: ReactNode; tone: BadgeVariant } => {
  const d = day(at);
  if (doneAt) return doneAt <= at ? { label: `On time · ${day(doneAt)}`, tone: 'success' } : { label: `Late ${fmtAge(doneAt - at)} · ${day(doneAt)}`, tone: 'warning' };
  const left = at - now;
  return left < 0 ? { label: `Overdue ${fmtAge(-left)} · ${d}`, tone: 'error' } : { label: `Due ${d} · in ${fmtAge(left)}`, tone: left < 24 * 3600_000 ? 'warning' : 'neutral' };
};

// ---------------------------------------------------------------- the card pinned on every RM step
export function ByoStatusCard({ o, act, open, setOpen }: { o: Order; act: Act; open: ByoEvent | null; setOpen: (e: ByoEvent | null) => void }) {
  const t = task(o, 'payment')!;
  const b = o.byo!;
  const now = Date.now();
  const dueAt = byoDue(o);
  const si = ORDER.indexOf(t.stage);
  const hit = (k: string) => [...b.history].reverse().find((h) => h.stage === k)?.at;
  const approval = due(dueAt.approval, now, si >= ORDER.indexOf('approved') ? hit('approved') ?? now : undefined);
  const settle = due(dueAt.settle, now, t.stage === 'settled' ? b.settledAt ?? hit('settled') : undefined);
  // Before the lender pays, the gap is what the approval leaves uncovered; after, it is simply the outstanding.
  const gap = b.approvedAmount != null && t.stage === 'approved' ? Math.max(0, orderTotal(o) - paid(o) - b.approvedAmount) : null;
  const nx = byoNext(o);
  return (
    <Dls className="byo-pin">
      <SectionCard part="byo"
        title={<>BYO status <span className="byo-sub">01b_BYO Finance Customer</span></>}
        subtitle={<>Next: <b>{nx.label}</b>{nx.who && <> · {nx.who}</>}</>}
        badge={{ label: byoLabel(t.stage), variant: BYO_TONE[t.stage] || 'neutral' }}
        right={t.stage !== 'settled' && t.stage !== 'cancelled' && <LinkButton icon="edit-outline" onClick={() => setOpen(open ? null : nx.ev || 'correct')}>{open ? 'Close' : 'Update status'}</LinkButton>}
      >
        <FetchedInfo cols={4} items={[
          ['Lender', b.lender || '—'],
          ['Approved by lender', b.approvedAmount != null ? money(b.approvedAmount) : 'Waiting for the letter'],
          ['Remitted by lender', b.remitAmount != null ? money(b.remitAmount) : '—'],
          ['Outstanding', money(outstanding(o))],
        ]} />
        {gap ? <InfoMessage tone="warning" icon="info-outline">The approved loan leaves {money(gap)} for the customer to pay before settlement. Tell them now.</InfoMessage> : null}
        <div className="byo-dues">
          <span>Lender pre-approval</span><Badge variant={approval.tone} icon="clock-timer-outline">{approval.label}</Badge>
          <span>Funds settled</span><Badge variant={settle.tone} icon="clock-timer-outline">{settle.label}</Badge>
        </div>
        {open && <ByoUpdate o={o} act={act} ev={open} setEv={setOpen} />}
      </SectionCard>
    </Dls>
  );
}

// ---------------------------------------------------------------- one status move, with its evidence
export function ByoUpdate({ o, act, ev, setEv }: { o: Order; act: Act; ev: ByoEvent; setEv: (e: ByoEvent | null) => void }) {
  const t = task(o, 'payment')!;
  const b = o.byo!;
  const bal = Math.max(0, orderTotal(o) - paid(o));
  const [lender, setLender] = useState(b.lender || BYO_LENDERS[0]);
  const [appNo, setAppNo] = useState(b.appNo || '');
  const [amount, setAmount] = useState(String(ev === 'remit' ? Math.min(b.approvedAmount ?? bal, bal) : bal));
  const [file, setFile] = useState('');
  const [ref, setRef] = useState('');
  const [as, setAs] = useState<'RM' | 'FinOps'>('RM');
  const [reason, setReason] = useState('');
  const [back, setBack] = useState(ORDER[Math.max(0, ORDER.indexOf(t.stage) - 1)]);
  const [funds, setFunds] = useState(false);
  const n = Number(amount) || 0;
  const can: Record<ByoEvent, boolean> = {
    approve: t.stage === 'awaiting', remit: t.stage === 'approved', settle: t.stage === 'remit',
    correct: ORDER.indexOf(t.stage) > 1, cancel: !['settled', 'cancelled'].includes(t.stage),
  };
  const events: [ByoEvent, string, string][] = [
    ['approve', 'Approval letter received', 'file-text-outline'], ['remit', 'Remittance advice received', 'receipt-check-outline'],
    ['settle', 'Funds received · loan settled', 'bank-outline'], ['correct', 'Correct the status', 'arrow-left-outline'], ['cancel', 'Cancel sale', 'close-line'],
  ];
  const done = (fn: (x: Order, at: number) => void) => { act(fn); setEv(null); };
  return (
    <div className="byo-upd">
      <div className="tu-chips">{events.map(([k, l, ic]) => <Chip key={k} icon={ic} active={ev === k} disabled={!can[k]} onClick={() => setEv(k)}>{l}</Chip>)}</div>

      {ev === 'approve' && (
        <>
          <div className="tu-row3">
            <Dropdown label="Lender" value={lender} options={BYO_LENDERS.map((x) => ({ value: x, label: x }))} onChange={setLender} />
            <TextInput label="Lender application number" value={appNo} onChange={setAppNo} placeholder="e.g. APP-481233" />
            <TextInput label="Approved amount" prefix="$" value={amount} onChange={setAmount} />
          </div>
          <FileUploadCard title="Pre-approval letter" description="From the lender or the customer · PDF or photo" badge={<Badge variant="error">Required</Badge>} uploaded={!!file} fileName={file} onUpload={setFile} />
          {n > 0 && (n >= bal
            ? <InfoMessage tone="success" icon="check-outline">Covers the {money(bal)} balance. Car prep starts now (GFR): the RWC / refurb task goes to the Refurb team.</InfoMessage>
            : <InfoMessage tone="warning" icon="info-outline">Leaves a {money(bal - n)} gap the customer pays before settlement. Tell them on this call. Car prep still starts now (GFR).</InfoMessage>)}
          <div className="byo-act">
            <Dropdown label="Updated by" value={as} options={[{ value: 'RM', label: 'RM' }, { value: 'FinOps', label: 'FinOps' }]} onChange={(v) => setAs(v as 'RM' | 'FinOps')} />
            <Button size="medium" disabled={!file || n <= 0} title={!file ? 'Upload the approval letter' : ''} onClick={() => done((x, at) => byoApprove(x, { lender, appNo, amount: n, letter: file }, as, at))}>Mark approved from 3P lender</Button>
          </div>
        </>
      )}

      {ev === 'remit' && (
        <>
          <div className="tu-row2">
            <TextInput label="Amount the lender is sending" prefix="$" value={amount} onChange={setAmount} />
            <TextInput label="Remittance reference" value={ref} onChange={setRef} placeholder="e.g. RA-90244" />
          </div>
          <FileUploadCard title="Remittance advice" description="From the lender (or the customer) · PDF or screenshot" badge={<Badge variant="error">Required</Badge>} uploaded={!!file} fileName={file} onUpload={setFile} />
          {n > 0 && (n >= bal
            ? <InfoMessage tone="success" icon="check-outline">Covers the balance: Finance GFD. VAS install tasks are created and the handover slot can open. FinOps confirms when the funds land.</InfoMessage>
            : <InfoMessage tone="warning" icon="info-outline">{money(bal - n)} short. Status becomes “Lender remittance received · outstanding deposit” until the customer pays the gap; Finance GFD then follows on its own.</InfoMessage>)}
          <div className="byo-act"><span /><Button size="medium" disabled={!file || n <= 0} title={!file ? 'Upload the remittance advice' : ''} onClick={() => done((x, at) => byoRemit(x, { amount: n, ref: ref || 'RA-' + x.id.slice(-4), file }, as, at))}>Mark remittance received</Button></div>
        </>
      )}

      {ev === 'settle' && (
        <>
          <InfoMessage tone="information" icon="bank-outline">FinOps only: match {money(b.remitAmount || 0)} from {b.lender} in the bank account before confirming.</InfoMessage>
          <label className={'tu-cb' + (funds ? ' on' : '')} onClick={() => setFunds(!funds)}><span className="box"><i className="tui tui-check-outline icon-sm" /></span><span className="lb">Funds received in the account<small>loan_settled_confirmation = Yes</small></span></label>
          <div className="byo-act"><span /><Button size="medium" disabled={!funds} onClick={() => done((x, at) => byoSettle(x, at))}>Confirm loan settled</Button></div>
        </>
      )}

      {ev === 'correct' && (
        <>
          <div className="tu-row2">
            <Dropdown label="Move back to" value={back} options={ORDER.slice(0, Math.max(1, ORDER.indexOf(t.stage))).filter((k) => k !== 'remitShort').map((k) => ({ value: k, label: byoLabel(k) }))} onChange={setBack} />
            <TextInput label="Reason (kept in the history)" value={reason} onChange={setReason} placeholder="e.g. lender withdrew the approval" />
          </div>
          <div className="byo-act"><span /><Button variant="secondary" size="medium" disabled={reason.trim().length < 4} onClick={() => done((x, at) => byoCorrect(x, back, reason, at))}>Move status back</Button></div>
        </>
      )}

      {ev === 'cancel' && (
        <>
          <Dropdown label="Reason" value={reason || 'Lender declined the loan'} options={['Lender declined the loan', 'Customer withdrew', 'Customer changed to cash', 'Customer moved to in-house finance', 'Other'].map((x) => ({ value: x, label: x }))} onChange={setReason} />
          <div className="byo-act"><span /><Button variant="secondary" size="medium" onClick={() => done((x, at) => byoCancel(x, reason || 'Lender declined the loan', at))}>Cancel sale</Button></div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- step 1: the BYO status property
// HubSpot's "Ticket status" dropdown on the finance ticket, as one property on the first screen. Only the
// move the status is waiting for can be picked; picking it opens the evidence form on the card above.
export function ByoStatusField({ o, act, open, setOpen }: { o: Order; act: Act; open: ByoEvent | null; setOpen: (e: ByoEvent | null) => void }) {
  const t = task(o, 'payment')!;
  const bank = o.paymentMethod === 'Bank transfer';
  const next: Record<string, string> = { deposit: 'awaiting', awaiting: 'approved', approved: 'remit', remit: 'settled' };
  return (
    <Dls>
      <SectionCard part="byostatus" title="BYO status" subtitle={<>Finance ticket {o.id}-{o.customer.name.split(' ')[0]} · owner RM · same values as HubSpot 01b</>} badge={{ label: byoHs(t.stage), variant: BYO_TONE[t.stage] }}>
        <div className="tu-row2">
          <Dropdown label="Ticket status" value={t.stage}
            options={STAGES.filter((s) => s.key !== 'cancelled').map((s) => ({ value: s.key, label: s.hs.replace('NEW · today the ticket waits at Approved from 3P Lender', s.label + ' (new)'), disabled: s.key !== t.stage && s.key !== next[t.stage] }))}
            onChange={(v) => {
              if (v === 'awaiting' && t.stage === 'deposit') act((x, at) => byoVerifyDeposit(x, at));
              else if (v === 'approved') setOpen('approve');
              else if (v === 'remit') setOpen('remit');
              else if (v === 'settled') setOpen('settle');
            }}
            hint={t.stage === 'deposit' ? 'Most orders move on at “Awaiting Approval from 3P Lender” once the deposit is verified.' : 'Each change asks for its evidence below, and the same status shows on every step.'} />
          <FetchedInfo cols={2} items={[['Deposit', `${money(o.depositPaid)} · ${bank ? 'bank transfer' : o.paymentMethod}`], ['Lender (from booking)', o.byo?.lender || '—']]} />
        </div>
        {t.stage === 'deposit' && <InfoMessage tone="warning" icon="info-outline">Bank transfer: match the proof below to the statement, then set Awaiting Approval from 3P Lender.</InfoMessage>}
        {open && <ByoUpdate o={o} act={act} ev={open} setEv={setOpen} />}
      </SectionCard>
    </Dls>
  );
}

// ---------------------------------------------------------------- the Lender finance step (BYO's balance step)
const PAY_LABEL: Record<string, string> = { DEPOSIT: 'Deposit', LENDER_REMITTANCE: 'Lender remittance', FIRST_INSTALMENT: 'Customer top-up', BALANCE: 'Customer top-up' };
export function ByoLenderStep({ o, onAddPayment }: { o: Order; onAddPayment: () => void }) {
  const t = task(o, 'payment')!;
  const b = o.byo!;
  const now = Date.now();
  const total = orderTotal(o);
  const remitted = o.payments.filter((x) => x.type === 'LENDER_REMITTANCE').reduce((a, x) => a + x.amount, 0);
  const topups = o.payments.filter((x) => !['DEPOSIT', 'LENDER_REMITTANCE'].includes(x.type)).reduce((a, x) => a + x.amount, 0);
  const left = outstanding(o);
  const gfd = financeGfd(o);
  const pays: Row[] = o.payments.map((x) => ({
    type: PAY_LABEL[x.type] || x.type, src: x.method || '—', ref: <span className="mono">{x.ref}</span>, amt: money(x.amount), when: `${fmtAge(now - x.at)} ago`, by: x.type === 'LENDER_REMITTANCE' ? b.lender : x.receivedBy || x.by,
    st: { label: x.type === 'LENDER_REMITTANCE' && t.stage !== 'settled' ? 'Awaiting funds' : 'Received', variant: x.type === 'LENDER_REMITTANCE' && t.stage !== 'settled' ? 'warning' : 'success' },
  }));
  const breakup: Row[] = [
    { k: 'Total payable', v: money(total), $cls: 'sum' },
    { k: 'Deposit paid', v: '− ' + money(o.depositPaid) },
    { k: 'Approved by lender', v: b.approvedAmount != null ? money(b.approvedAmount) : 'Waiting for the letter', s: 'Not money yet: the ceiling of the loan', $cls: 'sub' },
    { k: 'Remitted by lender', v: remitted ? '− ' + money(remitted) : '—' },
    { k: 'Paid by the customer (gap)', v: topups ? '− ' + money(topups) : '—' },
    { k: 'Outstanding', v: money(left), $cls: 'due' + (left ? '' : ' paid') },
  ];
  const created = (j: Parameters<typeof task>[1]) => !!task(o, j);
  const trig: Row[] = [
    { when: 'Approved from 3P lender', what: o.interstate ? 'Interstate inspection (transit)' : 'RWC / refurb task', team: o.interstate ? 'Delivery' : 'Refurb · Registration & RWC', st: created(o.interstate ? 'transit' : 'rwc') ? { label: 'Created', variant: 'success' } : { label: 'Waiting', variant: 'neutral' } },
    { when: 'Remittance advice received (Finance GFD)', what: `VAS install tasks${o.vas.filter((v) => !v.base && v.status !== 'CANCELLED').length ? '' : ' (none opted)'}`, team: 'Refurb', st: gfd ? { label: 'Created', variant: 'success' } : { label: 'Waiting', variant: 'neutral' } },
    { when: 'Remittance advice received (Finance GFD)', what: 'Finance gate for the handover slot', team: 'RM · Delivery', st: gfd ? { label: 'Open', variant: 'success' } : { label: 'Blocked', variant: 'warning' } },
    { when: 'Remittance advice received (Finance GFD)', what: 'Confirm the funds land', team: 'FinOps', st: t.stage === 'settled' ? { label: 'Done', variant: 'success' } : gfd ? { label: 'Open', variant: 'information' } : { label: 'Waiting', variant: 'neutral' } },
    { when: 'Contract signed (any time)', what: 'Counter-sign in DocuSign', team: 'RM', st: task(o, 'contract')?.stage === 'signed' ? { label: 'Done', variant: 'success' } : { label: 'Parallel', variant: 'neutral' } },
  ];
  const hist: Row[] = [...b.history].reverse().map((h) => ({
    st: { label: byoLabel(h.stage), variant: BYO_TONE[h.stage] || 'neutral' }, when: `${fmtAge(now - h.at)} ago`, by: h.by, src: { label: h.source, variant: h.source === 'Workflow' ? 'neutral' : h.source === 'FinOps' ? 'information' : 'success' }, note: <span className="wrap">{h.note}</span>,
  }));
  return (
    <Dls>
      <div className="tu-stack">
        <SectionCard part="payments" title="Payments" subtitle="Deposit, the lender’s remittance and any gap the customer pays" right={t.stage === 'remitShort' || (t.stage === 'approved' && left > (b.approvedAmount ?? 0)) ? <LinkButton icon="plus-large-outline" onClick={onAddPayment}>Add payment entry</LinkButton> : undefined}>
          <DataTable columns={[{ key: 'type', label: 'Payment type' }, { key: 'src', label: 'Source' }, { key: 'ref', label: 'Reference' }, { key: 'amt', label: 'Amount', align: 'right' }, { key: 'when', label: 'Received' }, { key: 'by', label: 'By' }, { key: 'st', label: 'Status', isBadge: true }]} rows={pays} />
        </SectionCard>
        <SectionCard part="price" title="Price breakup" subtitle="What the lender covers and what is left for the customer">
          <DataTable columns={[{ key: 'k', label: 'Item', subTextKey: 's' }, { key: 'v', label: 'Amount', align: 'right' }]} rows={breakup} />
        </SectionCard>
        <SectionCard part="opens" title="What each status opens for other teams" subtitle="Tasks are created by the status, never by which RM step is open">
          <DataTable columns={[{ key: 'when', label: 'When the status reaches' }, { key: 'what', label: 'Task' }, { key: 'team', label: 'Team' }, { key: 'st', label: 'Now', isBadge: true }]} rows={trig} />
        </SectionCard>
        <SectionCard part="history" title="Status history" subtitle="Every move, who made it and the evidence behind it">
          <DataTable columns={[{ key: 'st', label: 'Status', isBadge: true }, { key: 'when', label: 'When' }, { key: 'by', label: 'By' }, { key: 'src', label: 'From', isBadge: true }, { key: 'note', label: 'Evidence' }]} rows={hist} />
        </SectionCard>
      </div>
    </Dls>
  );
}
