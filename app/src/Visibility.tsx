import { Fragment } from 'react';
import { fmtAge, gateStatus, govtCharges, HOUR, isDone, money, stageDef, task, type Order, type Task } from './engine';
import { JOURNEYS, PERSONAS, type JourneyId } from './model';

// Read-only "Car prep status": what the Ops teams are doing on this order, straight from their HubSpot pipelines.
// The RM watches; nothing here can be edited.

type Tone = 'done' | 'fail' | 'late' | 'live' | 'wait';
const TONE_CHIP: Record<Tone, string> = { done: 'c-green', fail: 'c-red', late: 'c-amber', live: 'c-blue', wait: 'c-grey' };

function toneOf(t?: Task): Tone {
  if (!t) return 'wait';
  const s = stageDef(t);
  if (s.kind === 'done') return 'done';
  if (s.kind === 'fail') return 'fail';
  if (s.slaHours && Date.now() - t.enteredAt > s.slaHours * HOUR) return 'late';
  return 'live';
}
const toneText = (tone: Tone) => (tone === 'done' ? 'Done' : tone === 'fail' ? 'Blocked' : tone === 'late' ? 'Over SLA' : tone === 'live' ? 'In progress' : 'Not started');
const Chip = ({ tone, label }: { tone: Tone; label?: string }) => <span className={'chip ' + TONE_CHIP[tone]}>{label || toneText(tone)}</span>;
const val = (v?: string | boolean) => (v === true ? 'Yes' : v ? String(v) : '—');
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

function KV({ items }: { items: [string, React.ReactNode, string?][] }) {
  return (
    <dl className="vz-kv">
      {items.map(([k, v, hs]) => <div key={k}><dt>{k}</dt><dd>{v}</dd>{hs && <small>{hs}</small>}</div>)}
    </dl>
  );
}

// One pipeline section: header (name + what it covers on the left, status + time in stage on the right), then the data.
function Section({ c, j, title, desc, tone, t, label, children }: { c: string; j: JourneyId; title: string; desc: string; tone: Tone; t?: Task; label?: string; children: React.ReactNode }) {
  const owner = PERSONAS[JOURNEYS[j].persona];
  return (
    <section className={'vz-sec ' + c}>
      <header className="vz-head">
        <div><h3>{title}</h3><p>{desc} · {owner.user}</p></div>
        <div className="vz-chips">
          <Chip tone={tone} label={label} />
          {t && <span className="chip c-grey">{isDone(t) ? `Closed ${fmtAge(Date.now() - t.enteredAt)} ago` : `In stage ${fmtAge(Date.now() - t.enteredAt)}`}</span>}
        </div>
      </header>
      <div className="vz-main">{children}</div>
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <div className="vz-empty">{children}</div>;

export function PrepStatus({ o }: { o: Order }) {
  const rwc = task(o, 'rwc');
  const ref = task(o, 'refurb');
  const rego = task(o, 'rego');
  const transit = task(o, 'transit');
  const vasTasks = o.tasks.filter((t) => t.journey === 'vas');
  const installable = o.vas.filter((v) => v.status !== 'CANCELLED' && !v.base && !/warranty|insurance|iloe|service contract/i.test(v.name + ' ' + (v.type || '')));
  const gates = gateStatus(o).filter((g) => !('na' in g && g.na));
  const g = govtCharges(o);

  // Pipeline overview: one row per HubSpot pipeline on this order.
  const rows: { j: JourneyId; name: string; pipe: string; t?: Task; note?: string }[] = [
    { j: 'payment', name: 'Finance', pipe: o.paymentMode === 'Cash' ? '01a_Cash Customer Finance' : o.paymentMode === 'BYO' ? '01b_BYO Finance Customer' : '01d_Inhouse Finance Customer', t: task(o, 'payment') },
    { j: 'contract', name: 'Sales contract', pipe: '02_Sales Contracts', t: task(o, 'contract') },
    ...(o.tradeInOpted === 'Yes' ? [{ j: 'tradein' as JourneyId, name: 'Trade-in', pipe: '02c_Trade in ops', t: task(o, 'tradein') }] : []),
    ...(o.interstate ? [{ j: 'transit' as JourneyId, name: 'Interstate transit', pipe: '04_Interstate Customer Orders Transit', t: transit }] : []),
    { j: 'rwc', name: 'Roadworthy (RWC)', pipe: '05_Refurb Pre-GFD', t: rwc, note: rwc ? undefined : 'Created when the GFR date is set' },
    { j: 'refurb', name: 'Refurb & detail', pipe: '05_Refurb Pre-GFD', t: ref, note: ref ? undefined : 'Starts after the RWC passes' },
    { j: 'rego', name: 'Registration', pipe: '06_Registration', t: rego, note: rego ? undefined : 'Starts after the RWC passes' },
    ...vasTasks.map((t) => ({ j: 'vas' as JourneyId, name: `VAS · ${t.item}`, pipe: '05b_VAS Operations', t })),
  ];

  const rf = rwc?.fields || {};
  const ff = ref?.fields || {};
  const gf = rego?.fields || {};
  const refRows: { task: string; detail: string; t?: Task; done: boolean; fail?: boolean }[] = [
    ...(o.promises.length ? o.promises : []).map((p) => ({ task: 'Sales promise', detail: p, t: ref, done: !!ff.promiseDone })),
    { task: 'Detailing', detail: 'Fresh detail before handover', t: ref, done: !!ff.detailConfirm },
    { task: 'Pre-GFD QC inspection', detail: ff.qcNote ? String(ff.qcNote) : 'Passed Pre-Refurb GFD Inspection', t: ref, done: !!ff.qcPassed || ref?.stage === 'gfd', fail: ref?.stage === 'qcFail' },
  ];

  return (
    <div className="vz">
      <div className="vz-ro"><span>👁</span> Read-only. Status comes live from the Ops teams' HubSpot pipelines; ask the owner to change anything.</div>

      <div className="vz-gates">
        <b>{gates.filter((x) => x.ok).length} of {gates.length} delivery gates clear</b>
        {gates.map((x) => <span key={x.key} className={'vz-gate' + (x.ok ? ' ok' : '')}>{x.ok ? '✓' : '○'} {x.label}</span>)}
      </div>

      <section className="vz-sec vz-c-pipe">
        <header className="vz-head">
          <div><h3>Pipelines on this order</h3><p>{rows.length} HubSpot tickets across Finance, Contracts and Ops</p></div>
          <div className="vz-chips">
            {(['done', 'live', 'late', 'fail', 'wait'] as Tone[]).map((tn) => { const n = rows.filter((r) => toneOf(r.t) === tn).length; return n ? <span key={tn} className={'chip ' + TONE_CHIP[tn]}>{n} {tn === 'late' ? 'over SLA' : toneText(tn).toLowerCase()}</span> : null; })}
          </div>
        </header>
        <div className="vz-main">
          <div className="vz-tbl"><table>
            <thead><tr><th>Pipeline</th><th>Current stage</th><th>Owner</th><th>In stage</th><th>Status</th></tr></thead>
            <tbody>{rows.map((r) => {
              const tn = toneOf(r.t);
              return (
                <tr key={r.name}>
                  <td><b>{r.name}</b><small className="vz-code">{r.pipe}</small></td>
                  <td>{r.t ? stageDef(r.t).hs : <span className="vz-dim">{r.note || 'Not created yet'}</span>}</td>
                  <td>{PERSONAS[JOURNEYS[r.j].persona].short}</td>
                  <td>{r.t ? fmtAge(Date.now() - r.t.enteredAt) : '—'}</td>
                  <td><Chip tone={tn} /></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </div>
      </section>

      <Section c="vz-c-rwc" j="rwc" title="Roadworthy (RWC)" desc="Roadworthy inspection and any mechanical or panel rework · HubSpot 05_Refurb Pre-GFD" tone={toneOf(rwc)} t={rwc}>
        {!rwc ? <Empty>No RWC ticket yet. DW02 creates it at Awaiting Refurb when the GFR date is stamped{o.interstate ? ', or TW03d when the car arrives interstate' : ''}.</Empty> : (
          <>
            <KV items={[
              ['HubSpot stage', stageDef(rwc).hs, 'hs_pipeline_stage'],
              ['RWC status', rwc.stage === 'complete' ? 'Passed' : rwc.stage === 'fail' ? 'Failed' : stageDef(rwc).label, 'rwc_status'],
              ['RWC serial number', val(rf.rwcNumber), 'rwc_serial_number'],
              ['RWC issue date', rwc.stage === 'complete' ? fmtDate(rwc.enteredAt) : '—', 'rwc_issue_date'],
              ['RWC expiry date', val(rf.rwcExpiry), 'previous_rwc_date__ticket_'],
              ['Completed confirmation', rf.rwcConfirm ? 'Yes' : 'No', 'rwc_completed_confirmation'],
              ['Submitted by', rwc.stage === 'complete' ? PERSONAS.rego.user : '—', 'rwc_submitted_by'],
            ]} />
            {(rwc.stage === 'fail' || rf.panelInfo) && (
              <div className={'vz-alert' + (rwc.stage === 'fail' ? '' : ' past')}>
                <b>{rwc.stage === 'fail' ? 'Requires mechanical / panel' : 'Earlier rework'}</b>
                <KV items={[
                  ['Roadworthy item?', val(rf.roadworthyItem)],
                  ['Delay', val(rf.delayType)],
                  ['Rework ETA', val(rf.reworkEta)],
                ]} />
                <p>{val(rf.panelInfo)}</p>
              </div>
            )}
          </>
        )}
      </Section>

      <Section c="vz-c-ref" j="refurb" title="Refurb & detail" desc="Sales promises, detailing and pre-GFD QC · HubSpot 05_Refurb Pre-GFD" tone={toneOf(ref)} t={ref}>
        {!ref ? <Empty>Refurb starts once the RWC passes (TW04 moves the ticket to RWC Complete - To be Detailed).</Empty> : (
          <>
            <div className="vz-tbl"><table>
              <thead><tr><th>Task</th><th>Detail</th><th>Owner</th><th>Status</th></tr></thead>
              <tbody>{refRows.map((r, i) => (
                <tr key={i}><td><b>{r.task}</b></td><td>{r.detail}</td><td>{PERSONAS.refurb.user}</td>
                  <td><span className={'chip ' + (r.done ? 'c-green' : r.fail ? 'c-red' : 'c-blue')}>{r.done ? 'Done' : r.fail ? 'QC failed' : 'Pending'}</span></td></tr>
              ))}</tbody>
            </table></div>
            <KV items={[
              ['HubSpot stage', stageDef(ref).hs, 'hs_pipeline_stage'],
              ['Refurbishment notes', val(ff.workLog), 'refurbishment_notes'],
              ['Sales refurb promise', o.promises.join(' · ') || '—', 'sales_refurb_promise'],
              ['Passed pre-refurb GFD inspection', ff.qcPassed || ref.stage === 'gfd' ? 'Yes' : 'No', 'refurb_gfd_confirmation'],
              ...(ref.stage === 'qcFail' ? [['Fix ETA', val(ff.qcEta), 'NEW'] as [string, string, string]] : []),
            ]} />
          </>
        )}
      </Section>

      <Section c="vz-c-vas" j="vas" title="VAS operations" desc="Tinting, coating and accessory installs, one ticket per product · HubSpot 05b_VAS Operations" label={!installable.length ? 'Nothing to install' : undefined} tone={!installable.length ? 'wait' : vasTasks.length && vasTasks.every(isDone) && vasTasks.length >= installable.length ? 'done' : vasTasks.some((t) => toneOf(t) === 'late') ? 'late' : vasTasks.length ? 'live' : 'wait'}>
        {!installable.length ? <Empty>No tinting, coating or accessory on this order. Warranty and insurance products don't need an install.</Empty> : (
          <div className="vz-tbl"><table>
            <thead><tr><th>Product</th><th>Plan type</th><th>HubSpot stage</th><th>Install date</th><th>Updated</th><th>Status</th></tr></thead>
            <tbody>{installable.map((v) => {
              const t = vasTasks.find((x) => x.item === v.name);
              const tn = toneOf(t);
              return (
                <Fragment key={v.name}>
                  <tr>
                    <td><b>{v.name}</b></td><td>{v.type || '—'}</td>
                    <td>{t ? stageDef(t).hs : <span className="vz-dim">Created at {o.paymentMode === 'Cars24 finance' ? 'GFR' : 'Finance GFD'}</span>}</td>
                    <td>{val(t?.fields.installDate)}</td>
                    <td>{t ? fmtAge(Date.now() - t.enteredAt) + ' ago' : '—'}</td>
                    <td>{t ? <Chip tone={tn} /> : <span className="chip c-grey">Not created</span>}</td>
                  </tr>
                </Fragment>
              );
            })}</tbody>
          </table></div>
        )}
        <div className="vz-foot">VAS never blocks the delivery slot; anything not installed in time moves to Post delivery - Schmick.</div>
      </Section>

      <Section c="vz-c-rego" j="rego" title="Registration" desc="Registration in the customer’s state · HubSpot 06_Registration" tone={toneOf(rego)} t={rego}>
        {!rego ? <Empty>Registration starts once the RWC passes (TW04 creates the 06 ticket, owner by delivery state).</Empty> : null}
        <KV items={[
          ...(rego ? [['HubSpot stage', stageDef(rego).hs, 'hs_pipeline_stage'] as [string, string, string]] : []),
          ['Registration state', o.customer.state],
          ['Registration number', val(gf.regoNumber), 'registration_number'],
          ...(o.customer.state === 'VIC' ? [['Check digit', val(gf.checkDigit), 'check_digit'] as [string, string, string]] : []),
          ['Registration expiry', val(gf.regoExpiry), 'registration_expiry_date'],
          ['Fees charged', gf.regoFees ? money(Number(gf.regoFees)) : '—', 'registration_fees_charged'],
          ...(o.customer.state === 'VIC' ? [['TAC charge', gf.tac ? money(Number(gf.tac)) : '—', 'tac_charge'] as [string, string, string]] : []),
          ...(o.customer.state === 'QLD' ? [['Payment mode', val(gf.regoPayMode), 'registration_payment_mode'] as [string, string, string]] : []),
          ['Months registered', `${g.months} months`],
          ['CTP insurance', money(g.ctp)],
          ['Number plates', g.plates],
        ]} />
        {rego?.stage === 'egc' && <div className="vz-foot">EGC sale: no registration on this car.</div>}
      </Section>
    </div>
  );
}
