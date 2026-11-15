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

export function Rules() {
  const [tab, setTab] = useState<'rules' | 'map' | 'gate' | 'props'>('rules');
  return (
    <>
      <div className="tabs">
        {([['rules', 'Trigger rules'], ['map', 'Pipeline → journey map'], ['gate', 'Slot gate & back-sync'], ['props', 'RM left panel']] as const).map(([k, l]) => (
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

      {tab === 'map' && (
        <>
          <div className="card">
            <div className="ct">Live volume · Primary Deal Pipeline</div>
            <div className="cs">Deals created since 1 Aug 2026, pulled from HubSpot on 15 Nov 2026.</div>
            <div className="kpis" style={{ marginTop: 12, marginBottom: 0 }}>
              {LIVE.map(([l, n]) => <div key={l} className="kpi"><div className="n">{n}</div><div className="l">{l}</div></div>)}
            </div>
          </div>
          {(Object.keys(JOURNEYS) as JourneyId[]).map((j) => {
            const d = JOURNEYS[j];
            return (
              <div key={j} className="card">
                <div className="ct"><span className="who" style={{ background: PERSONAS[d.persona].color }} />{d.name}<span className="chip c-lv">{PERSONAS[d.persona].label}</span>{d.blocksSlot ? <span className="chip c-amber">Slot gate</span> : <span className="chip c-grey">Non-blocking</span>}</div>
                <div className="hs" style={{ marginTop: 4 }}>{d.hsObject} pipeline: {d.hsPipeline}</div>
                <div className="why">{d.why}</div>
                <table className="t" style={{ marginTop: 10 }}>
                  <thead><tr><th>LeadVerse stage</th><th>HubSpot stage</th><th>Properties captured</th><th>SLA</th><th>Moves to</th></tr></thead>
                  <tbody>
                    {d.stages.map((s) => (
                      <tr key={s.key}>
                        <td><span className={'chip ' + (s.kind === 'done' ? 'c-green' : s.kind === 'fail' ? 'c-red' : 'c-grey')}>{s.label}</span></td>
                        <td className="mono">{s.hs}</td>
                        <td>{(s.fields || []).map((f) => <div key={f.key}>{f.label}{f.hs ? <span className="mono" style={{ color: f.hs === 'NEW' ? 'var(--amber-ink)' : 'var(--mute-2)' }}> · {f.hs === 'NEW' ? 'new field' : f.hs}</span> : null}</div>)}</td>
                        <td>{s.slaHours ? `${s.slaHours}h` : '—'}</td>
                        <td style={{ fontSize: 12.5 }}>{(s.next || []).map((n) => <div key={n.label}>{n.label}</div>)}</td>
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
          <div className="statusline" style={{ marginTop: 12 }}>HubSpot's own check is stricter: <b>DW06a</b> waits 5 minutes after Refurb GFD, then needs Finance GFD ∧ <b>Registered Date</b> ∧ Refurb GFD ∧ Contract Signed and no open 07 ticket. Only then does it set 8: Delivery Booked: GFD and create the 07 delivery ticket (owner by delivery state). Otherwise the deal goes to 7: Awaiting on blockers, and <b>DW06b</b> keeps re-checking. In LeadVerse, Refurb GFD cannot be given before rego is complete, so the registration check is built in.</div>
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
