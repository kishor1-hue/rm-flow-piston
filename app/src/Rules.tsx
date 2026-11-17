import { useState } from 'react';
import { GATES, JOURNEYS, PERSONAS, RULES, type JourneyId } from './model';

const LIVE = [
  ['1: Deposit Paid', 151], ['2–3: Interstate', 16], ['4: Awaiting RWC', 116], ['5: Awaiting Registration', 62],
  ['6: Awaiting Refurb GFD', 15], ['7: Awaiting on blockers', 7], ['8: Delivery Booked', 3], ['9: Delivered', 186],
] as const;

const RM_PROPS = [
  ['Customer', 'Name, phone, email, suburb + state, assigned RM', 'firstname, phone, email, state, assigned_rm, relationshipmanagernumber'],
  ['Car', 'Order ID, appointment ID, year/make/model, VIN, km, hub', 'order_id, appointment_id, vehicle_make, vehicle_vin, vehicle_location'],
  ['Money', 'Payment mode, lender, price, VAS lines, trade-in, outstanding', 'payment_mode, total_vas_price, trade_in_value, outstanding_amount__hs_calculated_'],
  ['Handover', 'Pick-up / home delivery, slot, booked by, sales promises', 'delivery_mode, booked_delivery_date, booked_delivery_time_slot, delivery_date_booked_by, sales_refurb_promise'],
  ['Gates', 'Finance GFD, contract signed, refurb GFD, hub arrival', 'finance_gfd_date, contractSignedDate, refurb_gfd_date, arrivedAtHubDate'],
  ['Other teams (read-only)', 'RWC no. + rework ETA, rego no., QC result, VAS install, transit ETA', 'rwc_number, NEW rework_eta, regoNumber, hub_delivery_eta, eta_date'],
];

// HubSpot ticket pipelines: what creates the ticket, what moves it, what completes it (read 16 Nov 2026).
const PIPES: [string, string, string, string, string][] = [
  ['01a Cash', '01_START · deal Booked/Reserved, payment mode 100% Online / Bank Transfer', 'Full → Finance GFD · bank transfer → Deposit remittance · split → First Instalment Paid', 'TW01a: each deposit → outstanding 0 ? Finance GFD : Awaiting Additional Deposit', 'Finance GFD → deal finance_gfd_date (DW01e). GFR already at First Instalment (DW01b)'],
  ['01b BYO', '01_START · payment mode BYO', 'Awaiting Approval from 3P Lender', '—', 'Loan Settled. GFR at Approved from 3P Lender; GFD date at Remittance Advice'],
  ['01c Consumer finance', '01_START · payment mode Consumer Finance', 'Deposit Paid', '—', 'Loan Settled (or Declined / Withdrawn). GFR from Medium Confidence'],
  ['01d In-house finance', '01_START · GLOBAL CARS AUS CREDIT (BAD cohort: own flow)', 'Awaiting Documents, or Application completed if docs + application done', 'INHF full payment: outstanding 0 → Loan Settled-GFD', 'Loan Settled-GFD. GFR at Approved, Ready for Rego (or prime/stable + interstate)'],
  ['02 Sales contracts', '01_START · every booking', 'Vehicle Sold · owner by delivery state', 'Labels only: Contract not sent / not signed', 'Contract Signed (6 fields) → deal contract_signed_date (TW02a)'],
  ['03 Pre-interstate inspection', 'DW02 · GFR ∧ interstate', 'To Be Inspected · owner by car state', '—', 'Refurb GFIT → deal refurb_gfit_date (TW03a)'],
  ['04 Interstate transit', 'DW03 · Finance GFIT ∧ Refurb GFIT', 'GFIT', 'ETA → deal; Cars in Transit → departure date, deal 3', 'Interstate Arrival → deal 4 + creates 05 (TW03d)'],
  ['05 Refurb pre-GFD', 'DW02 (local) or TW03d (after arrival)', 'Awaiting Refurb · owner by delivery state', 'VIC: → Transported to delivery hub at a finance milestone', 'RWC confirmed → creates 06 (TW04). Refurb GFD → deal refurb_gfd_date (TW06) → DW06a'],
  ['05b VAS operations', 'One workflow per product · IHF at GFR, Cash/BYO at Finance GFD, NSW once car local', 'Selected Products (scratch & dent, servicing: Post delivery – Schmick)', 'Auto-cancel when product un-ticked or deal cancelled', 'Partially installed / All completed — by hand only'],
  ['06 Registration', 'TW04 · RWC confirmed', 'To be Registered · owner by delivery state', '—', 'Registration Complete or Submitted (QLD) → deal registered_date (TW05)'],
  ['07 Active deliveries', 'DW06a / DW06b · Finance GFD ∧ Registered ∧ Refurb GFD ∧ Contract signed', 'To be Delivered · owner by delivery state; deal 8', 'delivery_mode → 3PL / Carcierge / pick-up date', 'Delivered → deal actual_delivery_date, deal 9, creates 08 (TW08)'],
  ['07b Warranty', 'DW07b · deal 9/10, +5 min', 'Default warranty (+ extended if EW / Integrity / RSA)', '—', 'Warranty sent to customer — by hand'],
  ['08 Check-ins', 'TW08 · delivered', 'Delivered to Customer', '—', 'Day 7 Check Completed — by hand'],
  ['09 Transfers', 'DW10 · 6 days after delivery', 'Awaiting Transfer · owner by state', '—', 'Transferred / No transfer required'],
];

const OBJECTS: [string, string, string][] = [
  ['Deal (= order)', 'Where the logic lives', 'Triggers: status, dealstage, payment_mode, payment_method, deposit_amount, outstanding amount, trade_in, delivery_state, car_location_at_time_of_sale, interstate_transit_required, finance_score, VAS *_opted. Dates stamped by workflows: gfr_date, finance_gfd_date, refurb_gfit_date, interstate_arrival_date, rwc, registered_date, refurb_gfd_date, contract_signed_date, actual_delivery_date. Labels L01–L11. Owner = RM'],
  ['Ticket (= team task)', 'Team input', 'hs_pipeline_stage plus the confirmations each team fills: finance_gfd, recall_check_status, contract_signed, contract/tax/transfer links, passed_inspection, eta_date, rwc_completed_confirmation, rwc_serial_number, refurb_gfd_confirmation, rego fields, actual_delivery_date. Copies from the deal: payment mode, finance GFD date, split payment count'],
  ['Contact', 'Not a gate', 'lifecyclestage → opportunity at booking; check-in / walk-in date synced'],
  ['Car (custom object)', 'Not a gate', 'cars24_rwc_date copied from the ticket rwc_issue_date'],
];

export function Rules() {
  const [tab, setTab] = useState<'rules' | 'pipes' | 'map' | 'gate' | 'props'>('rules');
  return (
    <>
      <div className="tabs">
        {([['rules', 'Trigger rules'], ['pipes', 'Ticket pipelines: create → complete'], ['map', 'Pipeline → journey map'], ['gate', 'Slot gate & back-sync'], ['props', 'RM left panel']] as const).map(([k, l]) => (
          <button key={k} className={'fchip' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'rules' && (
        <div className="card">
          <div className="ct">When X happens on the order, create a task for persona Y</div>
          <div className="cs">Each rule replaces a HubSpot workflow. The evidence column is from live ticket timestamps (ticket created seconds after the stage change), not from documentation.</div>
          <table className="t" style={{ marginTop: 12 }}>
            <thead><tr><th>#</th><th>When</th><th>Then (LeadVerse)</th><th>For</th><th>HubSpot today</th><th>Evidence</th></tr></thead>
            <tbody>
              {RULES.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.id}</td>
                  <td><b>{r.when}</b></td>
                  <td>{r.then}</td>
                  <td>{r.persona.map((p) => <span key={p} className="chip c-lv" style={{ marginRight: 4 }}>{PERSONAS[p].short}</span>)}</td>
                  <td style={{ color: 'var(--mute)', fontSize: 12.5 }}>{r.hsToday}</td>
                  <td style={{ color: 'var(--mute)', fontSize: 12.5 }}>{r.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'pipes' && (
        <>
          <div className="card">
            <div className="ct">How every HubSpot ticket pipeline is created, moved and completed</div>
            <div className="cs">From the 67 enabled post-deposit workflow definitions. A team fills a ticket field or moves its ticket → a deal workflow stamps a date on the deal and moves the deal stage → another deal workflow creates the next team's ticket. "Complete" is the stage HubSpot marks CLOSED.</div>
            <div style={{ overflowX: 'auto' }}>
              <table className="t" style={{ marginTop: 12 }}>
                <thead><tr><th>Pipeline</th><th>Created by</th><th>Entry stage</th><th>Moves by itself</th><th>Complete → triggers</th></tr></thead>
                <tbody>{PIPES.map((r) => <tr key={r[0]}><td><b>{r[0]}</b></td>{r.slice(1).map((c, i) => <td key={i} style={{ fontSize: 12.5 }}>{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <div className="ct">Which object holds what</div>
            <table className="t" style={{ marginTop: 12 }}>
              <thead><tr><th>Object</th><th>Role</th><th>Properties used by the logic</th></tr></thead>
              <tbody>{OBJECTS.map((r) => <tr key={r[0]}><td><b>{r[0]}</b></td><td>{r[1]}</td><td style={{ fontSize: 12.5 }}>{r[2]}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'map' && (
        <>
          <div className="card">
            <div className="ct">Live volume · Primary Deal Pipeline</div>
            <div className="cs">Deals created since 1 Aug 2026, pulled from HubSpot on 15 Nov 2026.</div>
            <div className="kpis" style={{ marginTop: 12, marginBottom: 0 }}>
              {LIVE.map(([l, n]) => <div key={l} className="kpi"><div className="n">{n}</div><div className="l">{l}</div></div>)}
            </div>
          </div>
          <div className="statusline" style={{ marginBottom: 14 }}>
            Read from HubSpot pipeline settings on 15 Nov 2026. Properties marked <b>*</b> are HubSpot conditional stage properties: the team cannot drag a ticket into the next stage until they are filled. None of the post-deposit pipelines has pipeline rules, so a stage moves either by a person dragging the card or by a workflow (the "Moves today" column).
          </div>
          {(Object.keys(JOURNEYS) as JourneyId[]).map((j) => {
            const d = JOURNEYS[j];
            return (
              <div key={j} className="card">
                <div className="ct"><span className="who" style={{ background: PERSONAS[d.persona].color }} />{d.name}<span className="chip c-lv">{PERSONAS[d.persona].label}</span>{d.blocksSlot ? <span className="chip c-amber">Slot gate</span> : <span className="chip c-grey">Non-blocking</span>}</div>
                <div className="hs" style={{ marginTop: 4 }}>{d.hsObject} pipeline: {d.hsPipeline}</div>
                <div className="why">{d.why}</div>
                <table className="t" style={{ marginTop: 10 }}>
                  <thead><tr><th>LeadVerse stage</th><th>HubSpot stage</th><th>Properties captured</th><th>Moves today</th><th>SLA</th><th>Next actions</th></tr></thead>
                  <tbody>
                    {d.stages.map((s) => (
                      <tr key={s.key}>
                        <td><span className={'chip ' + (s.kind === 'done' ? 'c-green' : s.kind === 'fail' ? 'c-red' : 'c-grey')}>{s.label}</span></td>
                        <td className="mono">{s.hs}</td>
                        <td>{(s.fields || []).map((f) => <div key={f.key}>{f.label}{f.hs ? <span className="mono" style={{ color: f.hs === 'NEW' ? 'var(--amber-ink)' : 'var(--mute-2)' }}> · {f.hs === 'NEW' ? 'new field' : f.hs}</span> : null}</div>)}</td>
                        <td style={{ fontSize: 12.5, color: 'var(--mute)' }}>{s.auto || 'Manual drag'}</td>
                        <td>{s.slaHours ? `${s.slaHours}h` : '—'}</td>
                        <td style={{ fontSize: 12.5 }}>{(s.next || []).map((n) => <div key={n.label}>{n.label}{n.states ? ` (${n.states.join('/')})` : ''}{n.tradeIn ? ' (trade-in)' : ''}</div>)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </>
      )}

      {tab === 'gate' && (
        <div className="card">
          <div className="ct">How the delivery slot opens today</div>
          <div className="cs">b2c-oms-au · <span className="mono">OrderUtility.isDeliveryBookingAllowed(order)</span></div>
          <pre className="mono" style={{ background: '#0F172B', color: '#E2E8F0', padding: 14, borderRadius: 12, marginTop: 12, overflowX: 'auto' }}>{`return order.refurbGfdDate     != null
    && order.contractSignedDate != null
    && order.financeGfdDate     != null
    && (order.arrivedAtHubDate  != null || !order.isInterstateOrder)
    && order.deliveredDate      == null;`}</pre>
          <div className="why" style={{ marginTop: 12 }}>
            Every one of those dates is written by HubSpot. Teams move tickets; HubSpot workflows stamp the deal and call OMS
            <span className="mono"> POST hubspotBackSync</span> (<span className="mono">ExternalWebhookServiceImpl</span>), which copies
            contractSignedDate, financeGfdDate, refurbGfdDate, regoStatus, arrivedAtHubDate, deliveredDate, rwcStatus and rmEmail onto the order.
            If a workflow skips — which the AU leads say happens — the customer's app never opens the slot.
          </div>
          <table className="t" style={{ marginTop: 14 }}>
            <thead><tr><th>Gate</th><th>OMS field</th><th>Owner today</th><th>In LeadVerse</th></tr></thead>
            <tbody>
              {GATES.map((g) => (
                <tr key={g.key}><td><b>{g.label}</b></td><td className="mono">{g.hs}</td><td>{PERSONAS[g.owner].label} moves a HubSpot ticket</td><td>{JOURNEYS[g.journey].name} task reaches its done stage on the order — no webhook</td></tr>
              ))}
            </tbody>
          </table>
          <div className="statusline" style={{ marginTop: 12 }}>HubSpot's own check is stricter: <b>DW06a</b> waits 5 minutes after Refurb GFD, then needs Finance GFD ∧ <b>Registered Date</b> ∧ Refurb GFD ∧ Contract Signed and no open 07 ticket. Only then does it set 8: Delivery Booked: GFD and create the 07 delivery ticket (owner by delivery state). Otherwise the deal goes to 7: Awaiting on blockers, and <b>DW06b</b> keeps re-checking. LeadVerse uses both: Registered is a gate (HubSpot) and so is hub arrival for interstate cars (OMS).</div>
          <div className="statusline" style={{ marginTop: 8 }}>Proposed change (R3): VAS, warranty and tint never block. RM can bypass the contract gate (the existing HubSpot property <span className="mono">by_pass_contract_gfd_for_delivery_slots</span>), logged on the timeline.</div>
        </div>
      )}

      {tab === 'props' && (
        <div className="card">
          <div className="ct">What the RM needs on screen every day</div>
          <div className="cs">Left panel is static data already in our DB; the middle is where the RM acts; the right shows other teams read-only.</div>
          <table className="t" style={{ marginTop: 12 }}>
            <thead><tr><th>Group</th><th>Shown</th><th>HubSpot / OMS source</th></tr></thead>
            <tbody>{RM_PROPS.map(([g, s, h]) => <tr key={g}><td><b>{g}</b></td><td>{s}</td><td className="mono" style={{ color: 'var(--mute)' }}>{h}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
