// The RM order journey, in the same structure as the PISTON spec (phases → steps → screen, source, entry, exits,
// states, anatomy, fields) but with its own phases: Verify, Deal, Contract, Funds, Handover. Two tracks: Cash and BYOF.
import type { RmStep } from '../RmFlow';

export type Track = 'cash' | 'byo';
export type PhaseId = 'V' | 'D' | 'C' | 'F' | 'H';
export type Tone = 'brand' | 'green' | 'amber' | 'red' | 'grey';

export interface Phase { id: PhaseId; name: string; who: string; why: string; entry: string; exit: string }
export interface Exit { when: string; to?: string; state?: string; main?: boolean }
export interface Part { label: string; widget: string; note: string; sel: string }
export interface Field { name: string; type: string; req: 'Required' | 'No' | 'Read only'; source: string; rule: string }
export interface Step {
  id: string; key: RmStep; phase: PhaseId; name: string; screen: string; route: string; owner: string;
  branch?: boolean; isNew?: string; desc: string; trigger: string; data: string[]; entry: string[]; exits: Exit[];
  hubspot: string; rules: string[]; parts: Part[]; fields: Field[]; demo: string;
}

export const TRACKS: Record<Track, { label: string; dot: string; pipeline: string; base: string }> = {
  cash: { label: 'Cash', dot: '#4736FE', pipeline: '01a Cash Customer Finance', base: 'LV-7Q2K' },
  byo: { label: 'BYOF', dot: '#E17100', pipeline: '01b BYO Finance Customer', base: 'LV-6BY3' },
};

export const STATES: Record<string, Tone> = {
  'DEPOSIT PAID': 'brand', GFR: 'brand', 'AWAITING 3P LENDER': 'amber', 'LENDER APPROVED': 'brand', 'OUTSTANDING DEPOSIT': 'amber',
  'FINANCE GFD': 'green', 'LOAN SETTLED': 'green', 'READY TO BOOK': 'green', 'DELIVERY BOOKED': 'green', 'SALE CANCELLED': 'red', 'ON HOLD': 'grey',
};

export const PHASES: Phase[] = [
  { id: 'V', name: 'Verify', who: 'RM, the day the deposit lands', why: 'Confirm the money and the customer before anything is built on them.', entry: 'A deposit on the order (Stripe, card or a bank transfer with proof) and an RM assigned by payment mode and state', exit: 'Deposit confirmed and the finance ticket at its first status; the licence checked or a customer ID requested' },
  { id: 'D', name: 'Deal', who: 'RM, with the Trade-In team', why: 'Settle what the customer is buying: price, add-ons, promises and their trade-in.', entry: 'Deposit verified', exit: 'Discount, VAS, sales promise and trade-in agreed: the order total is final' },
  { id: 'C', name: 'Contract', who: 'RM, the customer on DocuSign', why: 'The contract and the tax invoice match the order as it is now.', entry: 'The order total is final', exit: 'Contract signed and the invoice current, the customer ID collected if one was asked for' },
  { id: 'F', name: 'Funds', who: 'RM and FinOps (BYOF: the customer’s lender)', why: 'Collect the balance. Cash pays it; BYOF waits on the lender’s approval and remittance.', entry: 'Contract and invoice checked', exit: 'Finance GFD: the balance is in, or the lender’s remittance covers it' },
  { id: 'H', name: 'Handover', who: 'RM, with Refurb, Registration and Delivery', why: 'The car is ready and the customer has a slot.', entry: 'GFR: car prep started (from the deposit, or the lender approval)', exit: 'Every gate clear and a handover slot booked' },
];

const SHELL_TOP: Part[] = [
  { label: 'Lead pane', widget: 'LEFT_PANE', note: 'Status pill, AI summary, Call / WhatsApp / Email, Details, States and Activity. Payment mode lives here and can change at any step until handover', sel: '.ws-left' },
  { label: 'Phase bar', widget: 'STAGE_STEPPER', note: 'Verify, Deal, Contract, Funds, Handover; the steps of the phase you are in sit under it, a dashed one is a branch', sel: '.rm-phases' },
  { label: 'Step title', widget: '@cspl/badge', note: 'Step name and ID, then the order’s state as a badge', sel: '.rm-title' },
  { label: 'Money strip', widget: '@cspl/fetched-info-card', note: 'Order total, paid, outstanding and handover gates, on every step: the four numbers the RM is asked about on every call', sel: '[data-part="money"]' },
];
const SHELL_END: Part[] = [
  { label: 'LeadVerse will', widget: 'INFO_LIST', note: 'What the backend does on the main exit, in place of a HubSpot workflow', sel: '.fx' },
  { label: 'Footer actions', widget: 'SHELL_CTAS', note: 'Previous, the exit count with the state the main exit sets, Next for the main exit; the arrow holds every other exit', sel: '.ws-foot' },
];
const BYO_PIN: Part = { label: 'BYO status, pinned', widget: '@cspl/section-card + @cspl/badge', note: 'The one BYO status, on every step after Verify: lender, approved, remitted, outstanding and both lender deadlines. Update status opens the same forms from any step', sel: '[data-part="byo"]' };

type Def = Omit<Step, 'demo'> & { demo: Record<Track, string>; byo?: Partial<Omit<Step, 'demo'>> };

const DEFS: Def[] = [
  {
    id: 'V1', key: 'deposit', phase: 'V', name: 'Verify deposit', screen: 'RM order › Verify deposit', route: '/orders/:id/verify-deposit', owner: 'RM',
    desc: 'The order lands with the RM the moment the deposit does. Stripe and card deposits are already confirmed; a bank transfer comes with the customer’s proof, which the RM matches against the statement. The RM also asks whether a trade-in is coming, because that adds a step and a valuation request.',
    trigger: 'Order booked or reserved with a deposit (R-01): the finance ticket is created and the RM assigned by payment mode and delivery state',
    data: ['OMS: the order, the car and the payments', 'Stripe: card and payment-link deposits', 'The customer’s bank transfer proof (proof_of_payment_link)', 'HubSpot 01a: the finance ticket and its status', 'Booking: the trade-in the customer entered, if any'],
    entry: ['A deposit on the order', 'RM assigned'],
    exits: [{ when: 'Deposit verified, trade-in answered', to: 'V2', state: 'GFR', main: true }, { when: 'Proof does not match the statement: ask the customer', to: 'V1', state: 'ON HOLD' }, { when: 'Customer cancels', state: 'SALE CANCELLED' }],
    hubspot: 'Finance ticket moved by hand to First Instalment Paid; workflow DW01b stamps the GFR date and DW02 creates the RWC ticket.',
    rules: ['R-01', 'R-03', 'R-14'],
    parts: [
      { label: 'Trade-in', widget: '@cspl/section-card + @cspl/segment-tabs', note: 'Yes or No; what they entered at booking shows under the title. Yes adds D4 and sends a valuation request', sel: '[data-part="tradein"]' },
      { label: 'Finance ticket', widget: '@cspl/section-card + @cspl/dropdown', note: 'The HubSpot pipeline’s own statuses; only the moves the current one allows can be picked', sel: '[data-part="ticket"]' },
      { label: 'Payments', widget: '@cspl/table, status as @cspl/badge', note: 'Every payment from OMS; a bank transfer shows To verify until the RM confirms it', sel: '[data-part="payments"]' },
      { label: 'Price breakdown', widget: '@cspl/table', note: 'Car, government charges, add-ons, discount, trade-in, then what is paid and pending', sel: '[data-part="price"]' },
      { label: 'Payment proof', widget: '@cspl/section-card', note: 'Bank transfer only: the customer’s receipt, opens full size', sel: '[data-part="proof"]' },
    ],
    fields: [
      { name: 'Trade-in opted', type: 'Segment (Yes / No)', req: 'Required', source: 'Booking, then the RM', rule: 'Locked once the trade-in price is final' },
      { name: 'Ticket status', type: 'Single select', req: 'Required', source: 'HubSpot 01a pipeline', rule: 'Only the next status the current one allows' },
      { name: 'Payments', type: 'Table', req: 'Read only', source: 'OMS', rule: 'Bank transfer deposits are To verify until confirmed' },
      { name: 'Payment proof', type: 'Image', req: 'Read only', source: 'Customer upload', rule: 'Bank transfer only' },
    ],
    demo: { cash: 'LV-7Q2K', byo: 'LV-6BY3' },
    byo: {
      desc: 'Same as Cash, with one more property on this screen: the BYO status. Most orders leave here at Awaiting approval from 3P lender. A bank-transfer deposit starts one status earlier, at Deposit remittance advice received, until the RM verifies it.',
      trigger: 'BYO order booked (R-B1): the finance ticket opens in the 01b BYO pipeline, owned by the RM',
      data: ['OMS: the order, the car and the payments', 'Stripe or the bank transfer proof', 'HubSpot 01b: the BYO status', 'The customer’s lender, if they named one at booking'],
      exits: [{ when: 'Deposit verified · awaiting the 3P lender', to: 'V2', state: 'AWAITING 3P LENDER', main: true }, { when: 'Lender approval already in hand', to: 'V2', state: 'LENDER APPROVED' }, { when: 'Customer cancels', state: 'SALE CANCELLED' }],
      hubspot: 'The 01_START workflow creates the ticket at Awaiting Approval from 3P Lender (or Deposit remittance for a bank transfer). Every later move is by hand, by FinOps or the RM.',
      rules: ['R-B1', 'R-14'],
      isNew: 'The BYO status is a field on this screen, with only the next value open. It is the same property the pinned card shows on every later step, so it is never kept in two places.',
    },
  },
  {
    id: 'V2', key: 'docs', phase: 'V', name: 'Customer documents', screen: 'RM order › Customer documents', route: '/orders/:id/documents', owner: 'RM',
    desc: 'The customer uploads both sides of their licence on the portal. The RM answers four checks, each with the system’s suggestion beside it. A licence from another state than the registration needs a customer ID from that state’s road authority, so the RM raises the request here and collects the number in C1.',
    trigger: 'Deposit verified; the licence upload from the customer portal',
    data: ['Customer portal: licence front and back', 'OCR: name, number, state, expiry', 'Order: the registration state'],
    entry: ['Licence uploaded by the customer'],
    exits: [{ when: 'All four checks pass: licence verified', to: 'D1', main: true }, { when: 'Licence from another state: raise the customer ID request', to: 'D1' }, { when: 'Name, expiry or image fails: request a re-upload', to: 'V2' }],
    hubspot: 'Checked by eye in the HubSpot deal’s attachments; no record of what was checked.',
    rules: [],
    isNew: 'Four checks with the system’s suggestion, and a tracked customer ID request with a 24h SLA.',
    parts: [
      { label: 'Driver’s licence', widget: '@cspl/section-card + @cspl/fetched-info-card', note: 'Both sides, then what OCR read off the card', sel: '[data-part="licence"]' },
      { label: 'Agent checks', widget: '@cspl/segment-tabs per row', note: 'Name, valid, readable, same state; the system’s answer beside each, and Use the system’s answers to fill all four at once', sel: '[data-part="checks"]' },
      { label: 'Customer ID request', widget: 'TRACKER', note: 'Requested, awaiting the customer, received, verified', sel: '[data-part="crn"]' },
    ],
    fields: [
      { name: 'Name matches the buyer', type: 'Segment (Yes / No)', req: 'Required', source: 'RM, system suggests', rule: 'No asks for a re-upload' },
      { name: 'Licence valid', type: 'Segment (Yes / No)', req: 'Required', source: 'RM, system suggests', rule: 'Not expired or within 30 days of it' },
      { name: 'Front and back readable', type: 'Segment (Yes / No)', req: 'Required', source: 'RM', rule: 'No asks for a re-upload' },
      { name: 'Licence state = registration state', type: 'Segment (Yes / No)', req: 'Required', source: 'RM, system suggests', rule: 'No raises the customer ID request' },
    ],
    demo: { cash: 'LV-7Q2K', byo: 'LV-6BY3' },
  },
  {
    id: 'D1', key: 'discount', phase: 'D', name: 'Discount', screen: 'RM order › Discount', route: '/orders/:id/discount', owner: 'RM',
    desc: 'Discounts promised on the lot land here. The RM can type the outstanding amount the customer agreed to and let the calculator work out the discount, or enter one directly. Above the limit, the sales manager approves before it applies.',
    trigger: 'Deposit verified; a discount in the deal’s sales promise prefills the value',
    data: ['B2C admin: discount codes and the final DAP', 'Deal: the sales promise', 'Order: payments and outstanding'],
    entry: ['Deposit verified'],
    exits: [{ when: 'Discount generated', to: 'D2', main: true }, { when: 'No discount on this order', to: 'D2' }, { when: 'Above the limit: sales manager approves', to: 'D1' }],
    hubspot: 'Made in the B2C admin Discount codes page; HubSpot only gets discount_value later.',
    rules: ['R-13'],
    isNew: 'Back-calculate from the outstanding amount the customer agreed to.',
    parts: [
      { label: '1 · Discount calculator', widget: '@cspl/section-card', note: 'The DAP rows, then the required outstanding amount; the result fills section 2', sel: '[data-part="calc"]' },
      { label: '2 · Generate discount', widget: '@cspl/section-card + @cspl/dropdown + @cspl/text-input', note: 'Type, description, value, valid till; the new outstanding underneath', sel: '[data-part="generate"]' },
    ],
    fields: [
      { name: 'Required outstanding', type: 'Money', req: 'No', source: 'RM', rule: 'Below the current outstanding' },
      { name: 'Discount type', type: 'Single select', req: 'Required', source: 'RM', rule: 'Flat or percentage' },
      { name: 'Discount description', type: 'Single select', req: 'Required', source: 'B2C admin list', rule: 'EW, VAS Sales, Car Discount…' },
      { name: 'Discount value', type: 'Money or %', req: 'Required', source: 'RM or the calculator', rule: 'Above the limit waits for the sales manager' },
    ],
    demo: { cash: 'LV-7Q2K', byo: 'LV-6BY3' },
  },
  {
    id: 'D2', key: 'vas', phase: 'D', name: 'Add VAS', screen: 'RM order › VAS', route: '/orders/:id/vas', owner: 'RM',
    desc: 'Tint, paint protection, dash cams and warranties. Each one changes the drive-away price and the invoice. Products that need fitting get an install task for VAS ops once the money gate clears; warranty and insurance need none.',
    trigger: 'Deposit verified; VAS the customer picked at checkout is already on the order',
    data: ['B2C admin: VAS Sales catalogue', 'Order: DAP and registration charges'],
    entry: ['Deposit verified'],
    exits: [{ when: 'VAS confirmed with the customer', to: 'D3', main: true }, { when: 'Add another VAS', to: 'D2' }],
    hubspot: 'Added in the B2C admin; the VAS ticket is made by hand when Finance GFD is set.',
    rules: ['R-04'],
    parts: [
      { label: 'Value added services', widget: '@cspl/section-card + @cspl/table + @cspl/button', note: 'Each product, its amount and status; + opens the plan type and install task', sel: '[data-part="vas"]' },
      { label: 'Price breakup · DAP', widget: '@cspl/table', note: 'Recalculated on every change', sel: '[data-part="dap"]' },
      { label: 'Registration', widget: '@cspl/fetched-info-card', note: 'Months, duty, CTP, transfer, plates', sel: '[data-part="rego"]' },
    ],
    fields: [
      { name: 'Plan type', type: 'Single select', req: 'Required', source: 'VAS catalogue', rule: 'Tinting, coating, accessory, warranty' },
      { name: 'VAS plan', type: 'Single select', req: 'Required', source: 'VAS catalogue', rule: 'One already on the order can’t be picked again' },
    ],
    demo: { cash: 'LV-7Q2K', byo: 'LV-6BY3' },
    byo: { desc: 'Same as Cash. On BYOF the install tasks wait for Finance GFD, which is the lender’s remittance advice, not a customer payment.' },
  },
  {
    id: 'D3', key: 'promise', phase: 'D', name: 'Sales promise', screen: 'RM order › Sales promise', route: '/orders/:id/sales-promise', owner: 'RM',
    desc: 'What the ground team promised (new tyres, a scratch fixed, a second key) becomes a checklist the Refurb team ticks off before QC, instead of a line in a deal note.',
    trigger: 'Deposit verified; prefilled from the deal property sales_promise_',
    data: ['Deal: sales_promise_ and notes_to_add_sales_promise', 'CMS form: sales-promise-checklist'],
    entry: ['Deposit verified'],
    exits: [{ when: 'Checklist submitted to Refurb', to: 'D4 or C1', main: true }],
    hubspot: 'A free-text deal property; Refurb reads it if they open the deal.',
    rules: ['R-05'],
    isNew: 'A checklist form handed to the Refurb detail task.',
    parts: [{ label: 'Sales promise checklist', widget: '@cspl/section-card + FORM_BUILDER', note: 'Tyres, exterior, servicing, brakes and other; photos upload to a presigned URL', sel: '[data-part="checklist"]' }],
    fields: [
      { name: 'Refurbishment promised?', type: 'Yes / No', req: 'Required', source: 'Prefilled from the deal', rule: 'No skips the rest' },
      { name: 'Items per area', type: 'Multi select', req: 'No', source: 'RM', rule: 'Attached to the Refurb detail task' },
    ],
    demo: { cash: 'LV-7Q2K', byo: 'LV-6BY3' },
  },
  {
    id: 'D4', key: 'tradein', phase: 'D', name: 'Trade-in', screen: 'RM order › Trade-in', route: '/orders/:id/trade-in', owner: 'RM, Trade-In team sets the price', branch: true,
    desc: 'Only when the customer opted in at V1. The Trade-In team inspects the car and sets the final price; the RM asks the customer and records Agree, or Not agree with a reason, which sends it back for re-valuation.',
    trigger: 'Trade-in opted = Yes (R-14): valuation request to the Trade-In team',
    data: ['HubSpot 02c Trade-in ops ticket', 'Trade-In team: inspection and final price'],
    entry: ['Customer opted in to a trade-in'],
    exits: [{ when: 'Customer agrees the final price', to: 'C1', main: true }, { when: 'Customer does not agree: price conflict', to: 'D4' }],
    hubspot: 'Trade-in ticket in 02c; the agreed price is typed into the deal by hand.',
    rules: ['R-14', 'R-15'],
    parts: [
      { label: 'Trade-in details', widget: '@cspl/section-card', note: 'Read-only, owned by the Trade-In team', sel: '[data-part="details"]' },
      { label: 'Customer decision', widget: '@cspl/section-card + @cspl/dropdown', note: 'Agree, or Not agree with reason, expected price and a note', sel: '[data-part="decision"]' },
    ],
    fields: [
      { name: 'Customer agrees?', type: 'Single select', req: 'Required', source: 'RM', rule: 'Not agree sends it back to the Trade-In team' },
      { name: 'Reason', type: 'Single select', req: 'Required', source: 'RM', rule: 'Only when Not agree' },
      { name: 'Expected price', type: 'Money', req: 'No', source: 'RM', rule: '' },
    ],
    demo: { cash: 'LV-3M9D', byo: 'LV-7BY2' },
  },
  {
    id: 'C1', key: 'final', phase: 'C', name: 'Contract & invoice', screen: 'RM order › Contract & invoice', route: '/orders/:id/contract', owner: 'RM, the customer signs',
    desc: 'The contract goes out on DocuSign and can be signed in parallel with anything else. Before the final payment the RM checks it is signed and that the contract and invoice still match the order; anything that changed after they were generated is regenerated in one click.',
    trigger: 'Deal phase done; the contract ticket is created with the order',
    data: ['HubSpot 02 Sales Contracts', 'DocuSign envelope', 'Documents service: contract and tax invoice versions'],
    entry: ['The order total is final'],
    exits: [{ when: 'Contract & invoice confirmed', to: 'F1', main: true }, { when: 'Regenerate an outdated document', to: 'C1' }, { when: 'Save the customer ID', to: 'C1' }],
    hubspot: 'Contract status set by hand; outdated invoices are spotted only when the customer complains.',
    rules: [],
    parts: [
      { label: 'Customer documents ticket', widget: '@cspl/section-card + @cspl/dropdown', note: 'DocuSign status, the HubSpot 02 pipeline’s values', sel: '[data-part="ticket"]' },
      { label: 'Before the final payment', widget: 'CHECKLIST', note: 'Signed, contract current, invoice current, Form 4, customer ID', sel: '[data-part="checks"]' },
      { label: 'Customer ID', widget: 'TRACKER + @cspl/text-input', note: 'Only when V2 raised a request', sel: '[data-part="crn"]' },
    ],
    fields: [
      { name: 'Contract status', type: 'Single select', req: 'Required', source: 'DocuSign', rule: 'Signed before the final payment' },
      { name: 'Customer ID number', type: 'Text, 6–10 digits', req: 'Required', source: 'RM or the customer portal', rule: 'Only when the licence is from another state' },
    ],
    demo: { cash: 'LV-7Q2K', byo: 'LV-1BY5' },
  },
  {
    id: 'F1', key: 'balance', phase: 'F', name: 'Balance payment', screen: 'RM order › Balance payment', route: '/orders/:id/balance', owner: 'RM and FinOps',
    desc: 'The RM sends a Stripe payment link for the outstanding amount, by SMS and email; the customer pays on their phone and the payment lands in the ledger on its own. Bank transfers still go in as a payment entry with a transaction and reference ID. When the ledger covers the total, the ticket moves to Final remittance received and Finance GFD is stamped.',
    isNew: 'A Stripe payment link is the main way to collect the balance, so most payments need no manual entry and no reconciliation.',
    trigger: 'Contract & invoice confirmed',
    data: ['OMS: payments', 'Bank statement (FinOps)', 'HubSpot 01a: finance ticket'],
    entry: ['Contract signed, invoice current', 'Trade-in price agreed, if any'],
    exits: [{ when: 'Send the payment link; the customer pays it', to: 'H1', state: 'FINANCE GFD', main: true }, { when: 'Bank transfer: add a payment entry', to: 'F1' }, { when: 'Part paid: awaiting additional deposit', to: 'F1', state: 'OUTSTANDING DEPOSIT' }, { when: 'Resend the link', to: 'F1' }],
    hubspot: 'The customer is sent bank details; FinOps matches the transfer and moves the ticket (TW01a); DW01e stamps Finance GFD.',
    rules: ['R-12', 'R-04'],
    parts: [
      { label: 'Payments', widget: '@cspl/section-card + @cspl/table + @cspl/link-button', note: 'The ledger, with Add payment entry while anything is outstanding', sel: '[data-part="payments"]' },
      { label: 'Payment link', widget: '@cspl/section-card + @cspl/checkbox + @cspl/payment-details-card', note: 'SMS and email ticked, then the link amount; once sent, the link with a copy action and Waiting or Paid', sel: '[data-part="paylink"]' },
      { label: 'Price breakup', widget: '@cspl/table', note: 'DAP, charges, discount, VAS, trade-in, paid and outstanding', sel: '[data-part="price"]' },
    ],
    fields: [
      { name: 'Amount', type: 'Money', req: 'Required', source: 'RM', rule: 'Not more than the outstanding' },
      { name: 'Payment source', type: 'Single select', req: 'Required', source: 'RM', rule: 'Bank transfer, card, Stripe, finance payout, trade-in' },
      { name: 'Transaction ID', type: 'Text', req: 'Required', source: 'Bank or Stripe', rule: '' },
      { name: 'Reference ID', type: 'Text', req: 'Required', source: 'Bank', rule: '' },
      { name: 'Send by', type: 'Checkbox (SMS, email)', req: 'Required', source: 'RM', rule: 'At least one' },
      { name: 'Payment link', type: 'URL', req: 'Read only', source: 'Stripe', rule: 'For the full outstanding amount; resent links replace the old one' },
    ],
    demo: { cash: 'LV-8LM4', byo: 'LV-8RT1' },
    byo: {
      name: 'Lender finance', screen: 'RM order › Lender finance', route: '/orders/:id/lender-finance', owner: 'RM, FinOps confirms funds',
      desc: 'The balance comes from the customer’s lender, so this step follows the BYO status. The lender’s approval letter means GFR; the remittance advice covering the balance means Finance GFD; FinOps confirms Loan settled when the funds land. If the lender pays less than the balance, the order moves to the new outstanding-deposit status and the customer pays the gap here.',
      trigger: 'BYO status moves: approval letter (R-B2), remittance advice (R-B3), funds received (R-B4)',
      data: ['HubSpot 01b: BYO status', 'Lender: approval letter and remittance advice (hello.au inbox today)', 'OMS: payments', 'Bank statement (FinOps)'],
      entry: ['Deposit verified, BYO status at Awaiting approval from 3P lender'],
      exits: [
        { when: 'Approval letter uploaded', to: 'F1', state: 'LENDER APPROVED' },
        { when: 'Remittance covers the balance: Finance GFD', to: 'H1', state: 'FINANCE GFD', main: true },
        { when: 'Remittance short: customer owes the gap', to: 'F1', state: 'OUTSTANDING DEPOSIT' },
        { when: 'FinOps sees the funds', state: 'LOAN SETTLED' },
        { when: 'Correct the status, with a reason', to: 'F1' },
        { when: 'Cancel sale', state: 'SALE CANCELLED' },
      ],
      hubspot: 'FinOps (and sometimes the RM) move the 01b dropdown by hand, in any order, often after the RM has moved on. Remittance advice is read from the shared inbox.',
      rules: ['R-B2', 'R-B3', 'R-B4'],
      isNew: 'A remittance short of the balance gets its own status, and every move needs its evidence: the letter, the advice, or FinOps’ confirmation.',
      parts: [
        { label: 'Payments', widget: '@cspl/table', note: 'Deposit, the lender’s remittance and any gap the customer pays', sel: '[data-part="payments"]' },
        { label: 'Price breakup', widget: '@cspl/table', note: 'Approved by the lender (not money yet), remitted, outstanding', sel: '[data-part="price"]' },
        { label: 'What each status opens', widget: '@cspl/table', note: 'The task each status creates for other teams; tasks follow the status, never the RM’s step', sel: '[data-part="opens"]' },
        { label: 'Status history', widget: '@cspl/table', note: 'Every move, who made it and the evidence', sel: '[data-part="history"]' },
      ],
      fields: [
        { name: 'Lender', type: 'Single select', req: 'Required', source: 'RM', rule: 'At Approved' },
        { name: 'Application number', type: 'Text', req: 'Required', source: 'Approval letter', rule: '' },
        { name: 'Approved amount', type: 'Money', req: 'Required', source: 'Approval letter', rule: 'Short of the balance: warn the customer now' },
        { name: 'Approval letter', type: 'File', req: 'Required', source: 'Lender', rule: 'Moves the status to Approved' },
        { name: 'Remitted amount', type: 'Money', req: 'Required', source: 'Remittance advice', rule: 'Decides Finance GFD or outstanding deposit' },
        { name: 'Remittance advice', type: 'File', req: 'Required', source: 'Lender', rule: '' },
        { name: 'Funds received', type: 'Checkbox', req: 'Required', source: 'FinOps', rule: 'Loan settled' },
      ],
    },
  },
  {
    id: 'H1', key: 'prep', phase: 'H', name: 'Car prep status', screen: 'RM order › Car prep', route: '/orders/:id/car-prep', owner: 'RM reads; Refurb, Registration and Delivery own it',
    desc: 'Car prep runs in parallel from GFR: roadworthy, registration, refurb and detailing, interstate transit if the car is elsewhere, and VAS fitting. The RM sees every team’s status, ETA and failure reason in one place and can nudge the owner.',
    trigger: 'GFR (cash: first instalment; BYOF: lender approval) creates the RWC / refurb task',
    data: ['HubSpot 04, 05, 05b, 06 tickets', 'OMS: hub arrival for interstate cars'],
    entry: ['GFR'],
    exits: [{ when: 'RWC, registration and refurb all done', to: 'H2', state: 'READY TO BOOK', main: true }, { when: 'Nudge a team on its status', to: 'H1' }],
    hubspot: 'The RM opens five tickets to see where the car is.',
    rules: ['R-02', 'R-03', 'R-05', 'R-06', 'R-10'],
    parts: [{ label: 'Car prep', widget: '@cspl/section-card + @cspl/table', note: 'One row per team’s task, read-only, with ETAs and failure reasons', sel: '[data-part="prep"]' }],
    fields: [{ name: 'Team task status', type: 'Badge', req: 'Read only', source: 'Each team’s task', rule: 'RWC fail requires a rework ETA' }],
    demo: { cash: 'LV-9HG3', byo: 'LV-8RT1' },
  },
  {
    id: 'H2', key: 'delivery', phase: 'H', name: 'Book delivery', screen: 'RM order › Book delivery', route: '/orders/:id/handover', owner: 'RM',
    desc: 'Pick up or home delivery, then the slot. The slot opens only when every gate is clear: Finance GFD, contract signed, registered, refurb GFD, and the car at the hub if interstate. A full day or a taken time shows as a disabled slot, so the RM never offers what the hub can’t do.',
    trigger: 'All gates clear (R-07): the Handover task is created for Delivery',
    data: ['OMS: isDeliveryBookingAllowed and hub capacity', 'Order: gates', 'B2C admin: delivery slots'],
    entry: ['Every gate clear, or the contract gate bypassed by the RM'],
    exits: [{ when: 'Book & confirm slot', state: 'DELIVERY BOOKED', main: true }, { when: 'Send the customer a slot picker', to: 'H2' }, { when: 'Bypass the contract gate', to: 'H2' }],
    hubspot: 'DW06a parks the deal at 7: Awaiting on blockers; the slot is booked in the B2C admin.',
    rules: ['R-07', 'R-08'],
    isNew: 'Day and time as DLS selection slots: a full day and a taken time are disabled, the earliest open day is marked. The RM can also send the customer a slot picker on the same capacity.',
    parts: [
      { label: 'Delivery mode', widget: '@cspl/segment-tabs', note: 'Pick up or home delivery; shipping goes on the invoice', sel: '[data-part="mode"]' },
      { label: 'Handover gates', widget: '@cspl/table + @cspl/badge', note: 'Each gate, its owner and whether it is clear', sel: '[data-part="gates"]' },
      { label: 'Handover slot', widget: '@cspl/selection-slots ×2', note: 'Day, then time; disabled slots for a full day or a taken time, and every slot while a gate is open', sel: '[data-part="slot"]' },
    ],
    fields: [
      { name: 'Delivery mode', type: 'Segment', req: 'Required', source: 'RM', rule: 'Home delivery adds shipping' },
      { name: 'Day', type: 'Selection slot', req: 'Required', source: 'Hub capacity', rule: 'Full days disabled' },
      { name: 'Time', type: 'Selection slot', req: 'Required', source: 'Hub capacity', rule: 'Taken times disabled' },
    ],
    demo: { cash: 'LV-1ZN6', byo: 'LV-9BY4' },
  },
];

export function stepsOf(track: Track): Step[] {
  return DEFS.map(({ byo, demo, ...d }) => {
    const s: Step = { ...d, ...(track === 'byo' ? byo : {}), demo: demo[track] };
    const pin = track === 'byo' && s.phase !== 'V' ? [BYO_PIN] : [];
    return { ...s, parts: [...SHELL_TOP, ...pin, ...s.parts, ...SHELL_END] };
  });
}
export const stepById = (track: Track, id: string) => stepsOf(track).find((s) => s.id === id) || stepsOf(track)[0];
export const stepByKey = (track: Track, key: RmStep) => stepsOf(track).find((s) => s.key === key);

export const FLOWS: Record<Track, { source: string[]; entry: string[]; exits: [string, string][]; path: string }> = {
  cash: {
    source: ['Booked online with a deposit (Stripe or card)', 'Reserved on the call with a bank transfer deposit (PISTON P7d)', 'Checkout at the hub after a test drive (PISTON N2)'],
    entry: ['Payment mode Cash', 'A deposit on the order, the RM assigned by state'],
    exits: [['DELIVERY BOOKED', 'every gate clear, slot booked'], ['SALE CANCELLED', 'refund per policy'], ['ON HOLD', 'proof or licence waiting on the customer']],
    path: 'V1 → V2 → D1 → D2 → D3 → (D4) → C1 → F1 → H1 → H2',
  },
  byo: {
    source: ['Booked online with payment mode BYO', 'Changed to BYO by the RM or Finance at any step (R-B5)'],
    entry: ['Payment mode BYO, the customer’s own lender', 'A deposit on the order'],
    exits: [['DELIVERY BOOKED', 'lender remittance in, slot booked'], ['LOAN SETTLED', 'FinOps confirms the funds'], ['OUTSTANDING DEPOSIT', 'the lender paid less; the customer owes the gap'], ['SALE CANCELLED', 'lender declined or customer withdrew']],
    path: 'V1 → V2 → D1 → D2 → D3 → (D4) → C1 → F1 Lender finance → H1 → H2',
  },
};

export interface Change { quote: string; who: string; title: string; before: string; after: string; body: [string, string][]; links: [Track, string][] }
export const CHANGES: Change[] = [
  {
    quote: 'Collecting the balance without a manual entry for every payment', who: 'Design decision',
    title: 'The balance is collected with a Stripe payment link',
    before: 'Bank details sent → customer transfers → screenshot by email → FinOps matches the statement → ticket moved by hand',
    after: 'F1 › Send payment link (SMS, email) → customer pays on their phone → Stripe records it → Final remittance received on its own',
    body: [['Bank transfers stay.', 'Add payment entry is still there, now in the exits menu, with transaction and reference IDs required.'], ['Part payments.', 'If the customer pays less, the order shows Outstanding deposit and the RM sends a new link for what is left.']],
    links: [['cash', 'F1']],
  },
  {
    quote: 'The four numbers every customer call is about, always in view', who: 'Design decision',
    title: 'A money strip on every step',
    before: 'Outstanding amount found in the Pricing tab or the B2C admin, gates on the HubSpot deal',
    after: 'Under every step title → order total · paid · outstanding · handover gates',
    body: [['Why every step.', 'Discount, VAS, trade-in and contract all change the outstanding amount; the RM sees it move as they work.']],
    links: [['cash', 'D1'], ['byo', 'F1']],
  },
  {
    quote: 'The RM or the BM must be able to change the payment mode at any step, and the website must follow', who: 'FinOps call, second half (paraphrased)',
    title: 'Payment mode changes at any step, with a confirm popup',
    before: 'Deal property edited → a new finance ticket made by hand → website still shows the old mode',
    after: 'Lead pane › Payment mode → popup lists what moves → ticket moves pipeline, payments kept → website updated',
    body: [['Who and why.', 'The popup asks who changed it (RM or Finance) and why: bringing their own loan, in-house withdrawn, paying cash instead, lender declined.'], ['Nothing is lost.', 'Payments already received stay on the order. BYO starts at Awaiting approval, with the lender clocks from the deposit.']],
    links: [['cash', 'V1'], ['byo', 'V1']],
  },
  {
    quote: 'HubSpot lets this property be updated in parallel; the new platform has to keep it right after the RM has moved on from that step', who: 'Your brief (paraphrased)',
    title: 'One BYO status, owned by the finance ticket, visible on every step',
    before: 'A dropdown on the HubSpot ticket → FinOps, the RM and the BM all move it, in any order → no evidence, no history',
    after: 'V1 sets it once → pinned card on every later step → each move needs its evidence → backwards only as a correction with a reason → full history',
    body: [['Tasks follow the status.', 'Approved creates the RWC / refurb task (GFR). Remittance covering the balance is Finance GFD: VAS install tasks, the handover slot and FinOps’ settle task. Never which RM step is open.'], ['Lender deadlines.', 'Pre-approval within 2 business days of the deposit, funds within 5. The card shows On time, Due or Overdue.']],
    links: [['byo', 'V1'], ['byo', 'F1'], ['byo', 'H1']],
  },
  {
    quote: 'A new stage for a remittance that arrives with a deposit still outstanding', who: 'FinOps call (paraphrased)',
    title: 'A short remittance gets its own status',
    before: 'Remittance Advice Received → RM chases the gap from memory',
    after: 'Remittance short → Lender remittance received · outstanding deposit → customer pays the gap in F1 → Finance GFD on its own',
    body: [['Warned early.', 'If the approval letter is already short of the balance, the RM is told at Approved, so the customer hears about the gap days before the remittance.']],
    links: [['byo', 'F1']],
  },
  {
    quote: 'Agreeing the outstanding amount, then working out the discount', who: 'Design decision',
    title: 'Discount back-calculated from the outstanding amount',
    before: 'B2C admin › Discount codes → work it out on a calculator → type the discount',
    after: 'D1 › Required outstanding → calculator fills the discount → generate; above the limit the sales manager approves',
    body: [['Invoice follows.', 'The tax invoice is flagged for regeneration in C1 as soon as the discount applies.']],
    links: [['cash', 'D1']],
  },
  {
    quote: 'Finding the licence-state mismatch on day one, not at registration', who: 'Design decision',
    title: 'Licence checks, and the customer ID asked for on day one',
    before: 'Licence checked by eye → registration finds the state mismatch → customer chased',
    after: 'V2 four checks with suggestions → customer ID request with a 24h SLA → collected in C1 before the final payment',
    body: [],
    links: [['cash', 'V2'], ['cash', 'C1']],
  },
  {
    quote: 'Never offering a slot the hub can’t do', who: 'Design decision',
    title: 'Handover slots on the DLS, full days and taken times disabled',
    before: 'HubSpot DW06a parks the deal → RM books in the B2C admin → hub rejects',
    after: 'H2 gates table → @cspl/selection-slots for day and time → disabled where the hub is full',
    body: [['Gates first.', 'Every slot stays disabled until Finance GFD, contract, registration and refurb are clear (and the car is at the hub if interstate).']],
    links: [['cash', 'H2'], ['byo', 'H2']],
  },
];
