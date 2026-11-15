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
  requires?: string[]; // field keys that must be filled first
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
        key: 'sold', label: 'Vehicle sold', hs: 'Vehicle Sold', slaHours: 24,
        next: [{ label: 'Start recall check', to: 'recall', tone: 'primary' }],
      },
      {
        key: 'recall', label: 'Recall check', hs: 'Recall check pending (Dealership)', slaHours: 24,
        fields: [f('recallResult', 'Recall result', 'select', { options: ['No active recall', 'Recall found — dealership booked'] })],
        next: [
          { label: 'Recall passed · send contract', to: 'sent', tone: 'primary', requires: ['recallResult'] },
          { label: 'Recall failed', to: 'recallFail', tone: 'danger', requires: ['recallResult'] },
        ],
      },
      {
        key: 'recallFail', label: 'Recall check failed', hs: 'Recall check failed', kind: 'fail',
        fields: [f('recallEta', 'Dealership fix ETA', 'date')],
        next: [{ label: 'Fixed · send contract', to: 'sent', tone: 'primary', requires: ['recallEta'] }],
      },
      {
        key: 'sent', label: 'Contract sent', hs: 'Contract Sent to Customer', slaHours: 48, slaText: 'Nudge customer after 48h',
        fields: [f('envelope', 'DocuSign envelope', 'text', { hint: 'Auto-filled when sent from LeadVerse' })],
        next: [
          { label: 'Mark signed', to: 'signed', tone: 'primary' },
          { label: 'Trade-in docs pending (Form 4)', to: 'form4', tone: 'ghost' },
        ],
      },
      {
        key: 'form4', label: 'Form 4 / trade-in docs', hs: 'Pending Form 4/Trade-in Documents Signature', slaHours: 48,
        next: [{ label: 'All signed', to: 'signed', tone: 'primary' }],
      },
      { key: 'signed', label: 'Contract signed', hs: 'Contract Signed', kind: 'done' },
    ],
  },

  payment: {
    id: 'payment', name: 'Payment / finance', persona: 'finops', hsObject: 'Ticket', blocksSlot: true,
    hsPipeline: '01a Cash · 01b BYO · 01d In-house finance',
    why: 'Finance GFD is one of the four slot gates. RMs today screenshot bank statements and ask FinOps to mark payments.',
    stages: [
      { key: 'deposit', label: 'Deposit received', hs: 'Deposit remittance advice received', next: [{ label: 'Instalment / lender approval received (GFR)', to: 'instalment', tone: 'primary' }] },
      { key: 'instalment', label: 'GFR · balance in progress', hs: 'First Instalment Paid / Approved from 3P Lender / Approved, Ready for Rego', slaHours: 72, next: [{ label: 'Final remittance received', to: 'final', tone: 'primary' }, { label: 'Short payment', to: 'short', tone: 'danger' }] },
      { key: 'short', label: 'Awaiting additional deposit', hs: 'Awaiting Additional Deposit', kind: 'fail', slaHours: 48, next: [{ label: 'Balance received', to: 'final', tone: 'primary' }] },
      { key: 'final', label: 'Final remittance', hs: 'Final remittance received / Loan settled', next: [{ label: 'Confirm Finance GFD', to: 'gfd', tone: 'primary' }] },
      { key: 'gfd', label: 'Finance GFD', hs: 'Finance GFD / Loan Settled - GFD', kind: 'done' },
    ],
  },

  rwc: {
    id: 'rwc', name: 'Roadworthy (RWC)', persona: 'rego', hsObject: 'Ticket', blocksSlot: true,
    hsPipeline: '05_Refurb Pre-GFD (RWC stages) · Bne Production RWC for QLD — created by DW02 at GFR',
    why: 'A failed roadworthy has no ETA in HubSpot today, so RMs chase the rework team. LeadVerse makes the ETA mandatory (R1).',
    stages: [
      { key: 'awaiting', label: 'Awaiting RWC', hs: 'Awaiting Refurb / Awaiting RWC', slaHours: 24, next: [{ label: 'Start inspection', to: 'wip', tone: 'primary' }] },
      {
        key: 'wip', label: 'RWC in progress', hs: 'RWC WIP', slaHours: 24,
        fields: [f('rwcNumber', 'RWC number', 'text', { hs: 'rwc_number' }), f('rwcIssue', 'RWC issue date', 'date', { hs: 'rwc_issue_date' })],
        next: [
          { label: 'RWC passed', to: 'complete', tone: 'primary', requires: ['rwcNumber', 'rwcIssue'] },
          { label: 'Fail · needs mechanical/panel', to: 'fail', tone: 'danger' },
        ],
      },
      {
        key: 'fail', label: 'Requires mechanical / panel', hs: 'Requires Mechanical/Panel', kind: 'fail', slaHours: 48, slaText: 'Reminder to rework team if ETA missing after 48h',
        fields: [
          f('failReason', 'Fail reason', 'select', { options: ['Brakes', 'Tyres', 'Suspension', 'Panel / body', 'Lights / electrical', 'Windscreen'] }),
          f('reworkEta', 'Rework ETA (mandatory)', 'date', { hint: 'New field — not in HubSpot today', hs: 'NEW' }),
        ],
        next: [{ label: 'Rework done · re-inspect', to: 'wip', tone: 'primary', requires: ['failReason', 'reworkEta'] }],
      },
      { key: 'complete', label: 'RWC complete', hs: 'RWC Complete - To be Detailed', kind: 'done' },
    ],
  },

  rego: {
    id: 'rego', name: 'Registration', persona: 'rego', hsObject: 'Ticket', blocksSlot: true,
    hsPipeline: '06_Registration',
    why: 'Rego follows the roadworthy. VIC needs a certificate generated; QLD is submitted to TMR. The deal sits in 5: Awaiting Registration.',
    stages: [
      { key: 'todo', label: 'To be registered', hs: 'To be Registered', slaHours: 24, next: [{ label: 'Submit registration', to: 'submitted', tone: 'primary' }] },
      {
        key: 'submitted', label: 'Submitted / VIC cert', hs: 'Generate VIC certificate · Registration Submitted (QLD)', slaHours: 48,
        fields: [f('regoNumber', 'Rego number', 'text', { hs: 'regoNumber' }), f('regoExpiry', 'Rego expiry', 'date', { hs: 'regoExpiry' })],
        next: [{ label: 'Registration complete', to: 'complete', tone: 'primary', requires: ['regoNumber', 'regoExpiry'] }],
      },
      { key: 'complete', label: 'Registration complete', hs: 'Registration Complete', kind: 'done' },
    ],
  },

  refurb: {
    id: 'refurb', name: 'Refurb, detail & QC', persona: 'refurb', hsObject: 'Ticket', blocksSlot: true,
    hsPipeline: '05_Refurb Pre-GFD (detail + inspection stages)',
    why: 'Sales promises (e.g. "new tyres", "fix scratch") are free text today and nobody tracks them to done. QC fails loop back with no owner.',
    stages: [
      {
        key: 'detail', label: 'To be detailed', hs: 'RWC Complete - To be Detailed', slaHours: 24,
        fields: [f('promiseDone', 'Sales promises delivered', 'check', { hs: 'sales_refurb_promise' }), f('workLog', 'Work log (servicing, pads, tint…)', 'textarea', { hs: 'refurbishment_notes' })],
        next: [{ label: 'Detail complete · request QC', to: 'qc', tone: 'primary', requires: ['promiseDone'] }],
      },
      {
        key: 'qc', label: 'QC inspection', hs: 'Detail Complete - Inspection Required', slaHours: 24,
        fields: [
          f('qcExterior', 'Exterior & panels', 'select', { options: ['Pass', 'Fail'] }),
          f('qcInterior', 'Interior & detail', 'select', { options: ['Pass', 'Fail'] }),
          f('qcMech', 'Test drive & warning lights', 'select', { options: ['Pass', 'Fail'] }),
        ],
        next: [
          { label: 'QC passed · Refurb GFD', to: 'gfd', tone: 'primary', requires: ['qcExterior', 'qcInterior', 'qcMech'] },
          { label: 'QC failed', to: 'qcFail', tone: 'danger' },
        ],
      },
      {
        key: 'qcFail', label: 'QC failed', hs: 'QC FAIL / Inspection Failed', kind: 'fail', slaHours: 24,
        fields: [f('qcNote', 'What failed', 'textarea'), f('qcEta', 'Fix ETA', 'date')],
        next: [{ label: 'Fixed · re-inspect', to: 'qc', tone: 'primary', requires: ['qcNote', 'qcEta'] }],
      },
      { key: 'gfd', label: 'Refurb GFD', hs: 'Refurb GFD', kind: 'done' },
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
      { key: 'booked', label: 'To be delivered', hs: 'To be Delivered', next: [{ label: 'Delivering today', to: 'today', tone: 'primary' }], slaText: 'Needs a booked slot' },
      {
        key: 'today', label: 'Deliver today', hs: 'Deliver Today',
        fields: [
          f('odometer', 'Odometer at handover', 'number'),
          f('condition', 'Condition checklist', 'select', { options: ['All good', 'Issue noted — failed QC raised'] }),
          f('signed', 'Customer signed handover', 'check', { hs: 'handover_doc_url' }),
        ],
        next: [{ label: 'Mark delivered', to: 'delivered', tone: 'primary', requires: ['odometer', 'condition', 'signed'] }],
      },
      { key: 'delivered', label: 'Delivered', hs: 'Delivered', kind: 'done' },
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
