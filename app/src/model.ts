// Journeys, stages and trigger rules for the AU post-deposit flow.
// Every stage carries the HubSpot pipeline/stage it replaces, so the demo can show
// "this is how it works in HubSpot today" next to "this is the LeadVerse task".

export type PersonaId = 'rm' | 'refurb' | 'rego' | 'delivery' | 'finops' | 'cx';

export const PERSONAS: Record<PersonaId, { label: string; user: string; short: string; color: string }> = {
  rm: { label: 'Relationship manager', user: 'Priyanka A.', short: 'RM', color: '#4736FE' },
  refurb: { label: 'Refurb', user: 'Marco D.', short: 'Refurb', color: '#128274' },
  rego: { label: 'Registration & RWC', user: 'Hannah L.', short: 'Rego', color: '#AE3F08' },
  delivery: { label: 'Delivery', user: 'Josh K.', short: 'Delivery', color: '#1358A8' },
  finops: { label: 'FinOps', user: 'FinOps', short: 'FinOps', color: '#566077' },
  cx: { label: 'CX / Aftercare', user: 'CX team', short: 'CX', color: '#566077' },
};

export const WORKING_PERSONAS: PersonaId[] = ['rm', 'refurb', 'rego', 'delivery'];

export type FieldType = 'text' | 'date' | 'select' | 'check' | 'number' | 'textarea';
export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  hs?: string; // HubSpot property it replaces
  hint?: string;
}

export interface TransitionDef {
  label: string;
  to: string;
  tone?: 'primary' | 'danger' | 'ghost';
  requires?: string[]; // field keys that must be filled first (HubSpot conditional stage properties)
  states?: string[]; // only offered for these customer states
  tradeIn?: boolean; // only offered when the order has a trade-in
}

export interface StageDef {
  key: string;
  label: string;
  hs: string; // HubSpot stage label
  kind?: 'fail' | 'done' | 'cancel';
  fields?: FieldDef[];
  next?: TransitionDef[];
  slaHours?: number;
  slaText?: string;
  guide?: string; // what the agent does at this stage
  auto?: string; // what moves it automatically today in HubSpot
}

export type JourneyId =
  | 'onboard' | 'contract' | 'payment' | 'rwc' | 'rego' | 'refurb' | 'vas' | 'transit' | 'delivery' | 'warranty' | 'checkin';

export interface JourneyDef {
  id: JourneyId;
  name: string;
  persona: PersonaId;
  hsPipeline: string;
  hsObject: 'Ticket' | 'Deal';
  blocksSlot: boolean;
  why: string;
  stages: StageDef[];
}

const f = (key: string, label: string, type: FieldType, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type, ...extra });

export const JOURNEYS: Record<JourneyId, JourneyDef> = {
  onboard: {
    id: 'onboard', name: 'Intro call & onboarding', persona: 'rm', hsObject: 'Deal', blocksSlot: false,
    hsPipeline: 'Primary Deal Pipeline · 1: Deposit Paid',
    why: 'RM congratulates the customer, confirms outstanding amount, paperwork and timeline. Today the recap email is typed from scratch.',
    stages: [
      {
        key: 'assigned', label: 'Assigned · to call', hs: '1: Deposit Paid', slaHours: 1, slaText: 'First contact within 1 working hour',
        fields: [
          f('callOutcome', 'Call outcome', 'select', { options: ['Connected', 'No answer — SMS sent', 'Call back requested'] }),
          f('prefDelivery', 'Preferred handover', 'select', { options: ['Pick up at hub', 'Home delivery'], hs: 'delivery_mode' }),
          f('licenceOk', "Driver's licence verified on portal", 'check'),
        ],
        next: [{ label: 'Log intro call', to: 'recap', tone: 'primary', requires: ['callOutcome'] }],
      },
      {
        key: 'recap', label: 'Recap email', hs: '1: Deposit Paid', slaHours: 4,
        fields: [f('recapTemplate', 'Template', 'select', { options: ['Welcome + outstanding amount', 'Welcome + finance next steps', 'Welcome + trade-in paperwork'] })],
        next: [{ label: 'Send recap & start car prep', to: 'done', tone: 'primary', requires: ['recapTemplate'] }],
      },
      { key: 'done', label: 'Onboarded', hs: 'Deal stays at 1 until GFR', kind: 'done' },
    ],
  },

  contract: {
    id: 'contract', name: 'Contract of sale', persona: 'rm', hsObject: 'Ticket', blocksSlot: true,
    hsPipeline: '02_Sales Contracts',
    why: 'Contract must be signed before a delivery slot opens. Today the signed PDF is copied from DocuSign to Google Drive by hand.',
    stages: [
      {
        key: 'sold', label: 'Vehicle sold', hs: 'Vehicle Sold', slaHours: 24, guide: 'Order is in. Start the dealership recall check before anything goes to the customer.',
        auto: 'Created by 01_START when the order is Booked/Reserved',
        next: [{ label: 'Start recall check', to: 'recall', tone: 'primary' }],
      },
      {
        key: 'recall', label: 'Recall check', hs: 'Recall check pending (Dealership)', slaHours: 24, guide: 'Check the VIN for open manufacturer recalls with the dealership.',
        fields: [f('recallStatus', 'Recall check status', 'select', { options: ['No active recall', 'Recall found'], hs: 'Recall check status*' })],
        next: [
          { label: 'Recall passed', to: 'passed', tone: 'primary', requires: ['recallStatus'] },
          { label: 'Recall failed', to: 'recallFail', tone: 'danger', requires: ['recallStatus'] },
        ],
      },
      {
        key: 'recallFail', label: 'Recall check failed', hs: 'Recall check failed', kind: 'fail', guide: 'Dealership fixes the recall before the contract goes out.',
        fields: [f('recallEta', 'Dealership fix ETA', 'date', { hs: 'NEW' })],
        next: [{ label: 'Fixed · recall passed', to: 'passed', tone: 'primary', requires: ['recallEta'] }],
      },
      {
        key: 'passed', label: 'Recall passed', hs: 'Recall check passed', slaHours: 24, guide: 'Send the contract of sale. The DocuSign envelope is generated with the tax invoice.',
        fields: [
          f('docHandling', 'Document handling', 'select', { options: ['DocuSign', 'Manual (in person)'], hs: 'Document Handling*' }),
          f('taxInvoice', 'Tax invoice link', 'text', { hs: 'Tax invoice link*', hint: 'Generated from the order' }),
        ],
        next: [
          { label: 'Send contract to customer', to: 'sent', tone: 'primary', requires: ['docHandling', 'taxInvoice'] },
          { label: 'No automated envelope in DocuSign', to: 'noEnvelope', tone: 'ghost', requires: ['taxInvoice'] },
          { label: 'CX action required', to: 'cx', tone: 'danger' },
        ],
      },
      {
        key: 'noEnvelope', label: 'No automated envelope', hs: 'No Automated Envelope in Docusign', kind: 'fail', guide: 'DocuSign did not create the envelope. Send it manually.',
        next: [{ label: 'Sent manually', to: 'sent', tone: 'primary' }],
      },
      {
        key: 'cx', label: 'CX action required', hs: 'CX Action Required', kind: 'fail', guide: 'Something must be fixed with the customer before the contract can go.',
        fields: [f('cxReason', 'Reason for CX action', 'textarea', { hs: 'Reason for CX action*' })],
        next: [{ label: 'Resolved · send contract', to: 'sent', tone: 'primary', requires: ['cxReason'] }],
      },
      {
        key: 'sent', label: 'Contract sent', hs: 'Contract Sent to Customer', slaHours: 48, slaText: 'Nudge customer after 48h', guide: 'Waiting for the customer to sign. Nudge after 48 hours.',
        auto: 'TW02b sets the deal contract status to "Contract not signed"',
        fields: [
          f('signedConfirm', 'Contract signed confirmation', 'check', { hs: 'Contract Signed Confirmation*' }),
          f('cosLink', 'Contract of sale link', 'text', { hs: 'Contract of Sale Link*', hint: 'Pulled from DocuSign — no Drive copy (R7)' }),
          f('transferLink', 'Transfer document link', 'text', { hs: 'Transfer document link*' }),
        ],
        next: [
          { label: 'Contract signed', to: 'signed', tone: 'primary', requires: ['signedConfirm', 'cosLink', 'transferLink'] },
          { label: 'Trade-in docs pending (Form 4)', to: 'form4', tone: 'ghost', tradeIn: true },
          { label: 'Send for review', to: 'review', tone: 'ghost' },
        ],
      },
      {
        key: 'form4', label: 'Form 4 / trade-in docs', hs: 'Pending Form 4/Trade-in Documents Signature', slaHours: 48, guide: 'Trade-in transfer form still to be signed.',
        fields: [
          f('signedConfirm', 'Contract signed confirmation', 'check', { hs: 'Contract Signed Confirmation*' }),
          f('cosLink', 'Contract of sale link', 'text', { hs: 'Contract of Sale Link*' }),
          f('transferLink', 'Transfer document link', 'text', { hs: 'Transfer document link*' }),
        ],
        next: [{ label: 'All signed', to: 'signed', tone: 'primary', requires: ['signedConfirm', 'cosLink', 'transferLink'] }],
      },
      {
        key: 'review', label: 'For review', hs: 'For Review', guide: 'Contract lead checks the paperwork before it is marked signed.',
        fields: [
          f('signedConfirm', 'Contract signed confirmation', 'check', { hs: 'Contract Signed Confirmation*' }),
          f('cosLink', 'Contract of sale link', 'text', { hs: 'Contract of Sale Link*' }),
          f('transferLink', 'Transfer document link', 'text', { hs: 'Transfer document link*' }),
        ],
        next: [{ label: 'Review passed · signed', to: 'signed', tone: 'primary', requires: ['signedConfirm', 'cosLink', 'transferLink'] }],
      },
      { key: 'signed', label: 'Contract signed', hs: 'Contract Signed', kind: 'done', auto: 'TW02a stamps Contract Signed Date on the deal' },
    ],
  },

  payment: {
    id: 'payment', name: 'Payment / finance', persona: 'finops', hsObject: 'Ticket', blocksSlot: true,
    hsPipeline: '01a Cash · 01b BYO · 01d In-house finance',
    why: 'Finance GFD is one of the slot gates. RMs today screenshot bank statements and ask FinOps to mark payments.',
    stages: [
      { key: 'deposit', label: 'Deposit received', hs: 'Deposit remittance advice received', guide: 'Deposit in. Waiting for the first instalment or lender approval.', auto: 'Created by 01_START', next: [{ label: 'Instalment / lender approval received (GFR)', to: 'instalment', tone: 'primary' }] },
      { key: 'instalment', label: 'GFR · balance in progress', hs: 'First Instalment Paid / Approved from 3P Lender / Approved, Ready for Rego', slaHours: 72, guide: 'Customer money is committed, so car prep starts (GFR).', auto: 'Cash: TW01a counts split payments and moves the ticket. DW01b stamps GFR', next: [{ label: 'Final remittance received', to: 'final', tone: 'primary' }, { label: 'Short payment', to: 'short', tone: 'danger' }] },
      { key: 'short', label: 'Awaiting additional deposit', hs: 'Awaiting Additional Deposit', kind: 'fail', slaHours: 48, guide: 'Customer paid less than due. RM chases the balance.', auto: 'TW01a: split payment count > 1', next: [{ label: 'Balance received', to: 'final', tone: 'primary' }] },
      { key: 'final', label: 'Final remittance', hs: 'Final remittance received / Loan settled', guide: 'FinOps confirms the money has cleared.', fields: [f('gfdConfirm', 'Finance GFD confirmation', 'check', { hs: 'Finance GFD Confirmation*' })], next: [{ label: 'Confirm Finance GFD', to: 'gfd', tone: 'primary', requires: ['gfdConfirm'] }] },
      { key: 'gfd', label: 'Finance GFD', hs: 'Finance GFD / Loan Settled - GFD', kind: 'done', auto: 'DW01e stamps Finance GFD Date on the deal' },
    ],
  },

  rwc: {
    id: 'rwc', name: 'Roadworthy (RWC)', persona: 'rego', hsObject: 'Ticket', blocksSlot: true,
    hsPipeline: '05_Refurb Pre-GFD (RWC stages) · Bne Production RWC for QLD — created by DW02 at GFR',
    why: 'A failed roadworthy has no ETA in HubSpot today, so RMs chase the rework team. LeadVerse makes the ETA mandatory (R1).',
    stages: [
      { key: 'awaiting', label: 'Awaiting RWC', hs: 'Awaiting Refurb / Awaiting RWC', slaHours: 24, guide: 'Car is cleared for prep. Book it into the roadworthy bay.', auto: 'Created by DW02 when GFR Date is set', next: [{ label: 'Start inspection', to: 'wip', tone: 'primary' }] },
      {
        key: 'wip', label: 'RWC in progress', hs: 'RWC WIP', slaHours: 24, guide: 'Inspect the car. Pass it with the certificate details, or fail it with what needs fixing.',
        fields: [
          f('rwcConfirm', 'RWC completed confirmation', 'check', { hs: 'RWC Completed Confirmation*' }),
          f('rwcNumber', 'RWC serial number', 'text', { hs: 'RWC serial number' }),
          f('rwcExpiry', 'RWC expiry date', 'date', { hs: 'RWC expiry date' }),
        ],
        next: [
          { label: 'RWC passed', to: 'complete', tone: 'primary', requires: ['rwcConfirm', 'rwcNumber'] },
          { label: 'Fail · needs mechanical/panel', to: 'fail', tone: 'danger' },
        ],
      },
      {
        key: 'fail', label: 'Requires mechanical / panel', hs: 'Requires Mechanical/Panel', kind: 'fail', slaHours: 48, slaText: 'Reminder to rework team if ETA missing after 48h', guide: 'Rework team fixes the car. The ETA is visible to the RM.',
        fields: [
          f('roadworthyItem', 'Is this a roadworthy item?', 'select', { options: ['Yes', 'No'], hs: 'Is this a roadworthy item?*' }),
          f('delayType', 'Delay', 'select', { options: ['Mechanical', 'Cosmetic'], hs: 'Delay (Cosmetic/Mechanical)*' }),
          f('panelInfo', 'Panel information (detailed issue)', 'textarea', { hs: 'Panel Information*' }),
          f('reworkEta', 'Rework ETA (mandatory)', 'date', { hint: 'New field — not in HubSpot today', hs: 'NEW' }),
        ],
        next: [{ label: 'Rework done · re-inspect', to: 'wip', tone: 'primary', requires: ['roadworthyItem', 'delayType', 'panelInfo', 'reworkEta'] }],
      },
      { key: 'complete', label: 'RWC complete', hs: 'RWC Complete - To be Detailed', kind: 'done', auto: 'TW04 stamps RWC Completed Date, moves the deal to 5 and creates the 06 ticket' },
    ],
  },

  rego: {
    id: 'rego', name: 'Registration', persona: 'rego', hsObject: 'Ticket', blocksSlot: true,
    hsPipeline: '06_Registration',
    why: 'Rego follows the roadworthy. VIC needs a certificate generated; QLD is submitted to TMR; NSW goes straight to complete.',
    stages: [
      {
        key: 'todo', label: 'To be registered', hs: 'To be Registered', slaHours: 24, guide: "Register the car in the customer's state. Year, make, model, body, VIN and engine number come from the order (HubSpot makes you type them).",
        auto: 'Created by TW04 when RWC is complete (owner by delivery state)',
        fields: [
          f('regoNumber', 'Registration number', 'text', { hs: 'Registration Number*' }),
          f('checkDigit', 'Check digit (VIC)', 'text', { hs: 'Check digit*' }),
          f('regoFees', 'Registration fees charged', 'number', { hs: 'Registration Fees Charged*' }),
          f('tac', 'TAC charge (VIC)', 'number', { hs: 'TAC charge*' }),
          f('regoPayMode', 'Registration payment mode (QLD)', 'select', { options: ['Company card', 'BPAY'], hs: 'Registration Payment Mode*' }),
          f('regoExpiry', 'Registration expiry date', 'date', { hs: 'Registration Expiry Date*' }),
        ],
        next: [
          { label: 'Generate VIC certificate', to: 'vic', tone: 'primary', states: ['VIC'], requires: ['regoNumber', 'checkDigit', 'regoFees', 'tac', 'regoExpiry'] },
          { label: 'Submit registration to TMR', to: 'qld', tone: 'primary', states: ['QLD'], requires: ['regoNumber', 'regoFees', 'regoPayMode', 'regoExpiry'] },
          { label: 'Registration complete', to: 'complete', tone: 'primary', states: ['NSW'], requires: ['regoNumber', 'regoExpiry'] },
          { label: 'No rego — EGC sale', to: 'egc', tone: 'ghost' },
        ],
      },
      { key: 'vic', label: 'VIC certificate', hs: 'Generate VIC certificate', guide: 'Certificate generated. Attach the public registration certificate.', fields: [f('regoCert', 'Public registration certificate', 'text', { hs: 'Publicly shared registration certificate' })], next: [{ label: 'Registration complete', to: 'complete', tone: 'primary' }] },
      { key: 'qld', label: 'Submitted (QLD)', hs: 'Registration Submitted (QLD)', guide: 'Submitted to TMR with the RWC number, issue date and link, taken from the RWC task.', next: [{ label: 'Registration complete', to: 'complete', tone: 'primary' }] },
      { key: 'egc', label: 'No rego — EGC sale', hs: 'No Rego - EGC Sale', kind: 'done' },
      { key: 'complete', label: 'Registration complete', hs: 'Registration Complete', kind: 'done', auto: 'TW05 stamps Registered Date and moves the deal to 6' },
    ],
  },

  refurb: {
    id: 'refurb', name: 'Refurb, detail & QC', persona: 'refurb', hsObject: 'Ticket', blocksSlot: true,
    hsPipeline: '05_Refurb Pre-GFD (detail + inspection stages)',
    why: 'Sales promises (e.g. "new tyres", "fix scratch") are free text today and nobody tracks them to done. QC fails loop back with no owner.',
    stages: [
      {
        key: 'detail', label: 'To be detailed', hs: 'RWC Complete - To be Detailed', slaHours: 24, guide: 'Deliver every sales promise, log the work, then detail the car.',
        fields: [f('promiseDone', 'Sales promises delivered', 'check', { hs: 'sales_refurb_promise' }), f('detailConfirm', 'Detailing complete confirmation', 'check', { hs: 'Detailing Complete Confirmation*' }), f('workLog', 'Work log (servicing, pads, tint…)', 'textarea', { hs: 'refurbishment_notes' })],
        next: [{ label: 'Detail complete · request QC', to: 'qc', tone: 'primary', requires: ['promiseDone', 'detailConfirm'] }],
      },
      {
        key: 'qc', label: 'QC inspection', hs: 'Detail Complete - Inspection Required', slaHours: 24, guide: 'Pre-GFD inspection. A pass gives Refurb GFD; a fail goes back with notes.',
        fields: [
          f('qcPassed', 'Passed pre-refurb GFD inspection', 'check', { hs: 'Passed Pre-Refurb GFD Inspection*' }),
          f('qcNote', 'Failed inspection notes', 'textarea', { hs: 'Failed Pre-Refurb GFD Inspection Notes*' }),
        ],
        next: [
          { label: 'QC passed · Refurb GFD', to: 'gfd', tone: 'primary', requires: ['qcPassed'] },
          { label: 'QC failed', to: 'qcFail', tone: 'danger', requires: ['qcNote'] },
        ],
      },
      {
        key: 'qcFail', label: 'QC failed', hs: 'QC FAIL / Inspection Failed', kind: 'fail', slaHours: 24, guide: 'Fix what QC found and set a date.',
        fields: [f('qcEta', 'Fix ETA', 'date', { hs: 'NEW' })],
        next: [{ label: 'Fixed · re-inspect', to: 'qc', tone: 'primary', requires: ['qcEta'] }],
      },
      { key: 'gfd', label: 'Refurb GFD', hs: 'Refurb GFD', kind: 'done', auto: 'TW06 stamps Refurb GFD Date; DW06a checks the other gates 5 min later' },
    ],
  },

  vas: {
    id: 'vas', name: 'VAS install', persona: 'refurb', hsObject: 'Ticket', blocksSlot: false,
    hsPipeline: '05b_VAS Operations (one ticket per product)',
    why: 'Created per product when Finance GFD lands. Most sit at "Selected Products" forever. VAS never blocks the slot (R3).',
    stages: [
      { key: 'selected', label: 'Selected', hs: 'Selected Products', slaHours: 72, next: [{ label: 'Booked with installer', to: 'booked', tone: 'primary' }] },
      { key: 'booked', label: 'Booked', hs: 'All booked', fields: [f('installDate', 'Install date', 'date')], next: [{ label: 'Installed', to: 'installed', tone: 'primary', requires: ['installDate'] }, { label: 'Install after handover', to: 'post', tone: 'ghost' }] },
      { key: 'post', label: 'Post delivery', hs: 'Post delivery - Schmick', next: [{ label: 'Installed', to: 'installed', tone: 'primary' }] },
      { key: 'installed', label: 'Installed', hs: 'All completed', kind: 'done' },
    ],
  },

  transit: {
    id: 'transit', name: 'Interstate transit', persona: 'delivery', hsObject: 'Ticket', blocksSlot: true,
    hsPipeline: '03_Pre-Interstate Inspection → 04_Interstate Customer Orders Transit',
    why: 'Only when the car is in another state. Arrival at the hub is one of the slot gates.',
    stages: [
      { key: 'inspect', label: 'Pre-transit inspection', hs: 'To Be Inspected', slaHours: 24, next: [{ label: 'Good for interstate transit', to: 'booked', tone: 'primary' }] },
      { key: 'booked', label: 'Booked for transit', hs: 'GFIT / Booked for Transit', fields: [f('transitEta', 'Hub arrival ETA', 'date', { hs: 'eta_date' })], next: [{ label: 'Car picked up', to: 'moving', tone: 'primary', requires: ['transitEta'] }] },
      { key: 'moving', label: 'In transit', hs: 'Cars in Transit', next: [{ label: 'Arrived at hub', to: 'arrived', tone: 'primary' }] },
      { key: 'arrived', label: 'Arrived at hub', hs: 'Interstate Arrival', kind: 'done' },
    ],
  },

  delivery: {
    id: 'delivery', name: 'Handover', persona: 'delivery', hsObject: 'Ticket', blocksSlot: false,
    hsPipeline: '07_Active Deliveries (+ 02c Trade-in ops, Base44 form today)',
    why: 'Handover and trade-in forms live in Base44 and a Google Sheet today. Here they are part of the task (R8).',
    stages: [
      { key: 'booked', label: 'To be delivered', hs: 'To be Delivered', guide: 'All gates are clear. Wait for the slot, then prep the car for handover.', auto: 'Created by DW06a when every gate is set (owner by delivery state)', next: [{ label: 'Delivering today', to: 'today', tone: 'primary' }, { label: 'Picked up by regional 3PL', to: 'threepl', tone: 'ghost' }] },
      {
        key: 'today', label: 'Deliver today', hs: 'Deliver Today', guide: 'Hand the car over. Capture odometer, condition and the customer\'s signature.',
        fields: [
          f('deliveredAt', 'Actual delivery date', 'date', { hs: 'Actual delivery date*' }),
          f('odometer', 'Odometer at handover', 'number'),
          f('condition', 'Condition checklist', 'select', { options: ['All good', 'Issue noted — failed QC raised'] }),
          f('signed', 'Customer signed handover', 'check', { hs: 'handover_doc_url' }),
        ],
        next: [{ label: 'Mark delivered', to: 'delivered', tone: 'primary', requires: ['deliveredAt', 'odometer', 'condition', 'signed'] }],
      },
      { key: 'threepl', label: 'Picked up · regional 3PL', hs: 'Picked up - Regional 3PL', guide: 'Car is on the truck to a regional customer.', fields: [f('deliveredAt', 'Actual delivery date', 'date', { hs: 'Actual delivery date*' })], next: [{ label: 'Mark delivered', to: 'delivered', tone: 'primary', requires: ['deliveredAt'] }] },
      { key: 'delivered', label: 'Delivered', hs: 'Delivered', kind: 'done', auto: 'TW08 stamps Actual Delivery Date, deal → 10, creates check-in tickets' },
    ],
  },

  warranty: {
    id: 'warranty', name: 'Warranty generation', persona: 'cx', hsObject: 'Ticket', blocksSlot: false, hsPipeline: '07b_Warranty Generation',
    why: 'Created on delivery.',
    stages: [{ key: 'gen', label: 'To be generated', hs: 'Extended warranty to be generated' }, { key: 'sent', label: 'Sent to customer', hs: 'Extended warranty sent to Customer', kind: 'done' }],
  },
  checkin: {
    id: 'checkin', name: 'Post-delivery check-ins', persona: 'cx', hsObject: 'Ticket', blocksSlot: false, hsPipeline: '08_Post Delivery Check-ins',
    why: 'Day 3 and day 7 calls.',
    stages: [{ key: 'd0', label: 'Delivered to customer', hs: 'Delivered to Customer' }, { key: 'd3', label: 'Day 3 done', hs: 'Day 3 Check Completed' }, { key: 'd7', label: 'Day 7 done', hs: 'Day 7 Check Completed', kind: 'done' }],
  },
};

// RM's view of the whole order — derived, never set by hand.
export const RM_STAGES = [
  { key: 'new', label: 'Deposit paid', hs: '1: Deposit Paid' },
  { key: 'prep', label: 'Car prep', hs: '2–6: Transit / RWC / Rego / Refurb' },
  { key: 'blockers', label: 'Awaiting blockers', hs: '7: Awaiting on blockers' },
  { key: 'ready', label: 'Ready to book', hs: '7 → 8 (slot opens)' },
  { key: 'booked', label: 'Delivery booked', hs: '8: Delivery Booked: GFD' },
  { key: 'delivered', label: 'Delivered', hs: '9: Delivered' },
] as const;
export type RmStageKey = (typeof RM_STAGES)[number]['key'];

// Trigger rules: HubSpot workflow today → LeadVerse event rule.
export interface RuleDef {
  id: string;
  when: string;
  then: string;
  persona: PersonaId[];
  hsToday: string;
  evidence: string;
}

export const RULES: RuleDef[] = [
  { id: 'R-01', when: 'Order booked or reserved (deposit paid)', then: 'Assign RM by payment mode + delivery state; create RM onboarding task (1h SLA), Contract task and Payment task by payment mode', persona: ['rm', 'finops'], hsToday: '01_START – Create ticket in Finance and Contract Creations Pipelines · 01_a – Deal Owner Assignment for Post BC Orders', evidence: 'Workflow trigger: Order Status is Booked or Reserved. Tickets land 2–7 s after deposit' },
  { id: 'R-02', when: 'GFR reached and the car is in another state', then: 'Create Interstate transit task for Delivery (pre-transit inspection first)', persona: ['delivery'], hsToday: 'DW02 branches on Interstate Transit Required → 03 Pre-Interstate Inspection ticket; DW03 creates 04 transit ticket on Finance/Refurb GFIT date', evidence: 'DW02 + DW03 enrolment criteria' },
  { id: 'R-03', when: 'GFR — Go For Refurb (customer money committed)', then: 'Create Roadworthy task for Registration & RWC; deal leaves 1: Deposit Paid', persona: ['rego'], hsToday: 'DW01b stamps GFR Date when the finance ticket reaches: Cash First Instalment Paid / Awaiting Additional Deposit / Finance GFD · BYO Approved from 3P Lender / Remittance / Loan Settled · IHF Approved, Ready for Rego / Settled (or prime-cohort IHF interstate). DW02 then sets 4: Awaiting RWC and creates the 05 ticket', evidence: 'DW01b + DW02 trigger conditions, read 15 Nov 2026' },
  { id: 'R-04', when: 'VAS opted: IHF/BYO at GFR · Cash at Finance GFD', then: 'Create one VAS install task per product for Refurb (non-blocking)', persona: ['refurb'], hsToday: '"VAS ticket pipelines – Tinting / Exterior Protection / Servicing / Scratch n dent" — one workflow per product. Exterior Protection: "Group 1 INHF/BYO > use GFR, Group 2 Cash > use Finance GFD"', evidence: '3 VAS tickets on a cash order created 34 s after Finance GFD' },
  { id: 'R-05', when: 'RWC complete (confirmation = Yes)', then: 'Create Registration task + Refurb detail & QC task (with sales promises)', persona: ['rego', 'refurb'], hsToday: 'TW04_RWC Ticket → RWC Completed Date, L03, deal 5: Awaiting Registration; registration ticket owner set by delivery state', evidence: '06 ticket created 3 s after deal entered 5' },
  { id: 'R-06', when: 'Registration complete (or QLD submitted)', then: 'Refurb GFD can be given; deal waits on refurb', persona: ['refurb'], hsToday: 'TW05 Registration Complete → Registered Date, L04, deal 6: Awaiting Refurb GFD if Refurb GFD unknown', evidence: 'TW05 workflow description' },
  { id: 'R-07', when: 'Refurb GFD + Finance GFD + Registered + Contract signed (+ hub arrival if interstate)', then: 'Create Handover task for Delivery (owner by delivery state); open slot booking; notify RM. If any is missing → Awaiting blockers', persona: ['delivery', 'rm'], hsToday: 'DW06a: Refurb GFD known → wait 5 min → branch "GFD" (Finance GFD ∧ Registered ∧ Refurb GFD ∧ Contract Signed ∧ no 07 ticket) → 8: Delivery Booked: GFD + 07 ticket; else 7: Awaiting on blockers. DW06b keeps re-checking. OMS isDeliveryBookingAllowed() mirrors it', evidence: 'DW06a branch conditions, read 15 Nov 2026' },
  { id: 'R-08', when: 'RM or customer books a slot', then: 'Instant email + SMS confirmation (R4); Handover task can move to Deliver today', persona: ['delivery'], hsToday: 'Slot sits on booked_delivery_date / time slot; manual bookings in HubSpot or B2C send no confirmation', evidence: 'Reimagine doc R4 (P0)' },
  { id: 'R-09', when: 'Handover marked delivered', then: 'Create Warranty + Post-delivery check-in tasks for CX; close the RM order', persona: ['cx'], hsToday: 'TW08 Delivered → Actual Delivery Date, deal 10: Awaiting Transfer, post-delivery tickets; DW07b warranty ticket at stage 9/10', evidence: '08 created 17 s, 07b 5 min after delivery' },
  { id: 'R-10', when: 'RWC fails', then: 'ETA required to save; reminder to rework team at 48h; RM sees ETA on the order', persona: ['rego', 'rm'], hsToday: 'Requires Mechanical/Panel stage exists, no ETA property', evidence: 'Reimagine doc R1 (P0)' },
];

export const GATES = [
  { key: 'finance', label: 'Finance GFD', journey: 'payment' as JourneyId, hs: 'finance_gfd_date', owner: 'finops' as PersonaId },
  { key: 'contract', label: 'Contract signed', journey: 'contract' as JourneyId, hs: 'contractSignedDate', owner: 'rm' as PersonaId },
  { key: 'refurb', label: 'Refurb GFD', journey: 'refurb' as JourneyId, hs: 'refurb_gfd_date', owner: 'refurb' as PersonaId },
  { key: 'hub', label: 'At hub', journey: 'transit' as JourneyId, hs: 'arrivedAtHubDate', owner: 'delivery' as PersonaId },
];
