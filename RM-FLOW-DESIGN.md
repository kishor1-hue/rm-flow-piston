# AU RM post-deposit flow: design spec

The LeadVerse screens a Cars24 Australia Relationship Manager (RM) uses from the moment a customer pays a deposit to the moment the car is booked for delivery. Each step replaces work the RM does today across HubSpot ticket pipelines and the B2C admin panel.

- **Live prototype:** https://claude.ai/artifact/VQHgVrJq5HpnWamUgacp5X (private; share from the page)
- **Code:** https://github.com/kishor1-hue/rm-flow (`app/` is Vite + React + TypeScript; `rm-flow.html` is the single-file build)
- **Evidence behind each rule:** [RM-MAPPING.md](RM-MAPPING.md) (HubSpot workflows, pipeline settings, the RM shadow session)

All customer data in the prototype is invented. Prices, fees and limits marked *placeholder* need real values before build.

---

## 1. Personas

| Persona | Person in the demo | Owns | Sees |
|---|---|---|---|
| **RM** (Relationship manager) | Priyanka A. | The order, steps 1–10 below, contract ticket | Everything; other teams' work read-only |
| **FinOps** | FinOps | Finance ticket (01a/01b/01d) | Finance board |
| **Registration & RWC** | Hannah L. | Roadworthy (RWC) and Registration tickets | Their board |
| **Refurb** | Marco D. | Refurb, detail & QC; VAS installs | Their board |
| **Delivery** | Josh K. | Interstate transit, Handover | Their board |
| **Trade-In team** | Sam R. | Trade-in valuation (02c), the final trade-in price | Trade-In board |
| **CX / Aftercare** | CX team | Warranty, post-delivery check-ins | Their board |

A persona switcher in the top bar changes the board and the side menu. The RM is the only persona with the 10-step order flow.

---

## 2. Screen layout

```
┌ icon rail ┬─────────────── top bar: breadcrumb · Appointment ID search · persona ───────────────┐
│           │ ┌ left panel ──────┐ ┌ order header: ID · car · payment mode · state · HubSpot deal ─┐ │
│           │ │ Contact · Order   │ │ step bar (1 … 10, done / pending / in progress)               │ │
│           │ │ Car · Pricing     │ │                                                                │ │
│           │ │ Document Workflow │ │ N. Step title          [Done]                                  │ │
│           │ │ Teams · Activity  │ │ where it happens today (grey guide line)                       │ │
│           │ │ AI summary        │ │ step body                                                      │ │
│           │ │ Notes             │ │ "When you do this, LeadVerse will…" (effects list)             │ │
│           │ └───────────────────┘ │ blocked reason (amber), if any                                 │ │
│           │                       │ footer: Previous · Step n of N · Next: <primary action> ▾      │ │
└───────────┴───────────────────────┴────────────────────────────────────────────────────────────────┘
```

- **Step bar**: every step is clickable. A finished step shows a green tick. When a step finishes, the flow moves to the next open step automatically (only once per step, so going back to a finished step does not bounce you forward).
- **Footer**: the main action is a primary button ("Next: …"); the ▾ menu holds the other actions (call the customer, nudge a team, cancel the sale…). When the action can't run yet, the button is disabled and the reason shows in an amber bar above the footer.
- **Effects list**: under each step, a short list of what the backend does when the RM acts (ticket moves, documents regenerated, tasks created for other teams). This is how the RM learns the rules without reading them.
- **Ticket status field**: wherever a HubSpot ticket appears, it is shown as a form block (Ticket, Pipeline with "in stage 4h", Ticket status dropdown). The dropdown lists every stage of that pipeline; stages the ticket can't reach from where it is are greyed with "not reachable from this stage".

### Left panel tabs

| Tab | Content |
|---|---|
| ☺ Contact | First/last name, email, phone, suburb, state, RM. **Sales promise** section: "Sales promise? Yes/No" and "Promised by the ground team" (moved here from the checklist) |
| ▤ Order | Order ID, appointment ID, payment mode, lender, delivery mode, dates |
| ⛟ Car | Make, model, year, odometer, colour, VIN, hub, car state |
| $ Pricing | EGC, discount, VAS, DAP, outstanding |
| ▣ Document Workflow | Every customer document with version, status and an **Outdated** badge when the order changed after it was generated, plus **↻ Regenerate** (calls the regenerate API). Rows: Contract of sale (DocuSign), Tax invoice, Driver's licence + customer reference number, Form 4 (trade-in). The tab label shows "·!" when something is outdated |
| Teams | Which persona owns each open ticket |
| Activity | Every stage change, rule firing (R-xx) and comms, newest first |

The AI summary card and a free-text note box sit under the tabs.

---

## 3. The RM steps

The order of steps is fixed. **Trade-in only appears when the RM answered Yes to "Consumer opted Trade-In?" in step 1.**

| # | Step | Done when |
|---|---|---|
| 1 | Verify deposit | Finance ticket past *Deposit remittance advice received* **and** the trade-in question answered |
| 2 | Discount | Discount generated (and approved, if above the limit), or skipped |
| 3 | Add VAS | VAS confirmed |
| 4 | Customer documents | Licence Verified, or a customer ID requested/received |
| 5 | Sales promise | Checklist submitted |
| 6 | Trade-in *(only if opted in)* | Customer agreed the final trade-in price |
| 7 | Contract & invoice | Contract signed, contract and invoice current, customer ID saved if needed |
| 8 | Balance payment | Finance ticket at Finance GFD |
| 9 | Car prep status *(read-only)* | RWC complete, Refurb GFD, Registered |
| 10 | Book delivery | Slot booked |

### Step 1: Verify deposit
*Today: HubSpot finance ticket (pipeline 01a).*

- **Payment method decides the work.**
  - **Card or Stripe:** the ticket moves to **First Instalment Paid** automatically when the order is created. The step shows it as already confirmed.
  - **Bank transfer:** the customer's proof screenshot is shown as a real image (a banking-app receipt: amount, date, from/to BSB and account, reference = order ID, receipt number). Clicking it opens a lightbox. The RM checks it and moves the ticket to First Instalment Paid.
- **Ticket status block** (form style, see §2).
- **Payments table:** Payment type · Method · Reference · Amount · When · By.
- **Price breakdown table**, ending with the pending balance.
- **"Consumer opted Trade-In?"** Yes / No, with a hint from what the customer entered at booking. Yes creates the Trade-In team's valuation request (rule R-14) and adds step 6.
- Removed on purpose: the "Payment proof matches the bank statement" checkbox.

### Step 2: Discount
*Today: B2C admin → Discount codes.* One page, two sections.

1. **Discount calculator.** Shows the full price breakup (DAP, EGC, govt charges, interstate, home delivery, discount, VAS, trade-in, total, paid, current outstanding). The RM types the **outstanding amount they want**; LeadVerse back-calculates the discount needed and offers "Use this discount".
2. **Generate discount.**
   - Discount type: **Flat** / **Percentage**
   - Value
   - Discount description: EW, VAS Sales, Car Discount, Eligible Stock, Service History Missing, Referral, Promotional, Finance rate match, Deposit contribution
   - Valid till (optional)
   - A live line shows the discount in dollars and the new outstanding.
- **Above $500** (*placeholder limit*) the discount goes to the sales manager for approval and the step waits ("Awaiting approval").
- **Effects:** outstanding recalculated, tax invoice regenerated (contract and invoice marked Outdated in Document Workflow), `discount_value` synced (rule R-13).

### Step 3: Add VAS
*Today: B2C admin → VAS Sales.*

- **Value Added Services table:** VAS item · Total amount · Status · Details, with a + button per row to expand plan type, install task status and Remove. Every car has the **Cars24 Base Warranty** at $0, which can't be removed.
- **Add VAS** (button and footer action) opens a popup:
  - Plan Type: SERVICE_CONTRACT, TINTING, COATING, WARRANTY, INSURANCE, ILOE
  - VAS Plan: filtered by type, shows price and details; plans already on the order are disabled
  - **Add VAS item**
- **Price breakup – DAP (Drive away price):** EGC, govt charges, delivery fees, VAS, DAP.
- **Registration section:** Registration opted, months, total charges, stamp duty, CTP, transfer fee, registration fee, number plates type, handling fee.
- Adding or removing VAS changes DAP straight away (e.g. Sophie: $26,867 → $27,266 → back).

| Plan type | Plans in the prototype (*placeholder prices*) |
|---|---|
| TINTING | 3M Color Stable $449 · Global NR Quick Dry PLUS $349 · 3M FX-ST $399 · 3M Crystalline $899 · Global Nano Ceramic IR $599 · Global NR Quick Dry $299 |
| COATING | Ceramic 3 yr $990 · Paint Protection Film (front) $1,490 |
| SERVICE_CONTRACT | 1 yr / 15,000 km $690 · 2 yr / 30,000 km $1,290 |
| WARRANTY | Extended 1 yr $699 · 2 yr $1,099 · 3 yr $1,499 |
| INSURANCE | Comprehensive 12 months $1,250 · GAP 36 months $450 |
| ILOE | Loan Protection 12 months $299 |

Only tinting, coating and accessories get an install task (pipeline 05b). Warranty, insurance, ILOE and service contracts don't.

### Step 4: Customer documents (driver's licence)
*First of the two document stages; the second is step 7.*

- **Licence images:** front and back the customer uploaded, with a SAMPLE watermark in the demo; click to zoom.
- **Licence data:** name, number, state, expiry, date of birth.
- **Four Yes/No checks**, each with a **System suggestion** (from OCR and order data) the agent can accept or override:
  1. Name matches the buyer
  2. Licence valid (not expiring within 30 days)
  3. Images clear and readable
  4. **Licence state matches the car registration state**
- **Images unreadable** → "Request re-upload" sends the customer a link; status *Re-upload requested*.
- **State check = No** (e.g. NSW licence, car registered in VIC) → **raise a customer ID request**. The customer gets the state road authority's number themselves and shares it:
  - VIC: VicRoads customer number
  - NSW: Service NSW customer number
  - QLD: TMR customer reference number
- Raising the request **completes this step** so the RM isn't stuck; the ID is collected in step 7. A small tracker shows Requested → Reminded → Received.
- All Yes → **Verify licence**.

### Step 5: Sales promise
*Today: free text in the deal property `sales_promise_`.*

- Renders the **Sales Promise Refurbishment Checklist** from the form-builder JSON (`app/src/forms/sales-promise-checklist.json`: 38 fields, 3 API sources, AND-ed visible/required conditions).
- **Stepper widget:** fields before the first category stay on top; each category is a tab with a **blue underline on the active tab** and a count badge of what's ticked. Tabs: AC, Brake/Acceleration, Electrical, Engine, Exteriors, Interiors, Lights, Servicing, … and **Other comments** last. Previous / Next buttons and dots at the bottom.
- Inside a category: a flat checkbox list, a remark field, and an **upload card** (title, *Pending* / *Uploaded* badge, helper text, **Upload** / **Replace** button).
- Submit validates required fields; tabs with errors turn red.
- Submitted values go to the Refurb team's detail task.

### Step 6: Trade-in (only if opted in)
*Today: HubSpot 02c_Trade in ops, Base44 form.*

- **The Trade-In team owns the form and the price.** The RM sees the **Trade-in Details** read-only: VIN, value, rego, state, make, model, variant, year, odometer (km), pending finance, written off, PPSR document uploaded. Note: changes by the Trade-In team are stored in the B2C database only, not in C2B.
- Status line at the top: *Valuation requested 3h ago* → *Final price $4,800 set by the Trade-In team ($5,200 at booking, −$400). Confirm it with the customer.*
- **Customer decision on the trade-in price:**
  - **Customer agrees with $X?** Agree / Not agree (required)
  - **Agree** → primary button "Confirm customer agreed $X" → balance payment unblocked.
  - **Not agree** → three more fields:
    - Reason (dropdown): Expects a higher price · Service history / extras not valued · Better offer elsewhere · Changed mind · keeping the car · Changed mind · selling privately · Other
    - Customer expected price (AUD), optional
    - Note for the Trade-In team (required)
    - → **Raise price conflict to Trade-In team**
- On a conflict the Trade-In ticket moves to **Price conflict** with the reason, expected price and note at the top of the team's form. They re-value and set a revised price; it comes back to the RM for another Agree / Not agree. Balance payment stays blocked until the customer agrees (rule R-15).

### Step 7: Contract & invoice
*Today: HubSpot 02_Sales Contracts. Second document stage, just before the final payment.*

- Ticket status block for the contract ticket: Vehicle Sold → Recall check pending → passed/failed → No automated envelope in DocuSign / CX action required → Contract Sent to Customer → Pending Form 4 / trade-in docs → For Review → Contract Signed.
- **Checks:** Contract signed · Contract up to date (version) · Tax invoice correct (version, total). If the order changed after a document was generated (discount, VAS, trade-in price), it shows as **Outdated** with a Regenerate button.
- **Customer ID** (only when step 4 raised one): input for the state's customer number, then **Save & verify**.

### Step 8: Balance payment
*Today: HubSpot finance ticket, TW01a counts split payments.*

- Blocked until the trade-in price is agreed and step 7 is done. The reason shows on the disabled button.
- **Payments** section header with an **Add payment entry** link at the top right.
- **Payments table:** Payment type · Source · Transaction ID · Reference · Amount · Paid · By (Received by when given). Remarks show on hover.
- **Add payment entry** popup:
  - Amount (AUD) *: prefilled with the outstanding, can't exceed it
  - Payment Source *: Bank transfer, Card, Stripe, Finance payout, Trade-in settlement
  - Transaction ID * (e.g. TXN-12345)
  - Reference ID * (e.g. PO-67890)
  - Payment date *: defaults to today, no future dates, helper "Use ISO format expected by API"
  - Received by: Finance team, RM, Customer (self-serve), helper "Not sent to the current API"
  - Remarks: internal note
  - **Add Payment entry**; errors show under each field
- **Price breakup** (detailed):

| Row | Ava's order (LV-7Q2K) |
|---|---|
| **DAP** | **$35,847** |
| EGC | $32,990 |
| **Govt charges** | **$2,358** |
| · Motor vehicle duty | $1,393 |
| · 3 months registration | $173 |
| · CTP insurance | $147 |
| · Transfer fee | $46 |
| · Handling fee | $599 |
| Interstate charges | $0 |
| Home delivery charges | $0 |
| Discount value | — |
| VAS | $499 |
| Trade-in value *(only when present, shown as −)* | — |
| **Total amount to be paid** | **$35,847** |
| Total amount paid | $1,000 |
| **Outstanding balance** *(amber while owed, green when paid)* | **$34,847** |

- **Effects:** each entry → Finance ticket to *Final remittance received* when fully paid, otherwise *Awaiting additional deposit* (rule R-12). At full payment the RM confirms **Finance GFD**.
- The finance ticket status block is not shown on this step.

### Step 9: Car prep status (read-only)
*Visibility of the Ops teams' HubSpot pipelines. Nothing here can be edited; the RM can only nudge a team from the ▾ menu.*

- Grey banner: "Read-only. Status comes live from the Ops teams' HubSpot pipelines; ask the owner to change anything."
- **Delivery gates strip:** "2 of 4 delivery gates clear" + pills: Finance GFD, Contract signed, Registered, Refurb GFD (+ At hub for interstate).
- Five sections. Each is a white card with a **coloured left border** and a header: **name** in bold, a grey line with what it covers · HubSpot pipeline · owner, and on the right a **status chip** (Done, In progress, Over SLA, Blocked, Not started) and a grey **"In stage 30h" / "Closed 4d ago"** chip. No steppers.

| Section | Border colour | Content |
|---|---|---|
| Pipelines on this order | Indigo `#4736FE` | One row per HubSpot ticket: Finance (01a/01b/01d by payment mode), Sales contract (02), Trade-in (02c), Interstate transit (04), RWC and Refurb (05), Registration (06), one row per VAS product (05b). Columns: Pipeline (+ code), Current stage, Owner, In stage, Status. Header shows counts, e.g. "1 blocked · 1 over SLA" |
| Roadworthy (RWC) | Orange `#C2560C` | HubSpot stage, RWC status, RWC serial number, issue date, expiry date, completed confirmation, submitted by. On a failed RWC a red box: roadworthy item?, delay (mechanical/cosmetic), rework ETA, panel information |
| Refurb & detail | Teal `#128274` | Task table (Task · Detail · Owner · Status): one row per sales promise, Detailing, Pre-GFD QC inspection. Then HubSpot stage, refurbishment notes, sales refurb promise, passed pre-refurb GFD inspection, fix ETA on a QC fail |
| VAS operations | Violet `#8B3FD9` | One row per tinting / coating / accessory: Product · Plan type · HubSpot stage (Selected Products, All booked, Post delivery - Schmick, All completed) · Install date · Updated · Status. "Nothing to install" when there are none |
| Registration | Blue `#1358A8` | HubSpot stage, registration state, number, check digit (VIC), expiry, fees charged, TAC (VIC), payment mode (QLD), months registered, CTP, number plates |

- Each value shows its HubSpot property name underneath in small grey mono text (`rwc_serial_number`, `registration_expiry_date`, `refurb_gfd_confirmation`…).
- A ticket that doesn't exist yet says what creates it ("Created when the GFR date is set", "Starts after the RWC passes").

### Step 10: Book delivery
*Today: B2C admin → Book delivery slots.*

- Delivery mode: Pick up / Home delivery (adds a $299 shipping charge, *placeholder*).
- Gate box with the five gates; **Book & confirm slot** is blocked until all are clear, with the missing gates named.
- RM can bypass the contract gate (`by_pass_contract_gfd_for_delivery_slots`).
- **Effects:** slot booked, Handover task created or moved for Delivery, email + SMS confirmation (rule R-08).

---

## 4. Money

```
govt charges = transfer $46 + duty (price × 4.223%) + 3 months rego $173 + CTP $147 + handling $599
DAP          = EGC + govt charges + home delivery + VAS
total to pay = DAP − applied discount − trade-in value
outstanding  = total to pay − sum of payments
```

Rates and fees are *placeholders* (duty ≈ 4.22%, plates STANDARD, 3 months).

---

## 5. Rules (what the backend does)

| Rule | When | Then |
|---|---|---|
| R-01 | Deposit paid | Assign RM by payment mode + delivery state; create the Finance ticket (cash: at Deposit remittance received, with proof) and the Customer documents ticket at Vehicle sold. Card / Stripe: Finance ticket straight to First Instalment Paid |
| R-02 | GFR and car in another state | Create Interstate transit task for Delivery |
| R-03 | GFR, car local | Create Roadworthy task for Registration & RWC |
| R-04 | VAS opted and money committed | One VAS install task per product (in-house finance at GFR, cash/BYO at Finance GFD, NSW once the car is local) |
| R-05 | RWC complete | Create Registration task + Refurb detail & QC task (with sales promises) |
| R-06 | Registration complete (or QLD submitted) | Registered gate green |
| R-07 | All gates clear | Create Handover task for Delivery; open slot booking; notify RM |
| R-08 | Slot booked | Email + SMS confirmation |
| R-09 | Handover delivered | Warranty + post-delivery check-in tasks for CX |
| R-10 | RWC fails | Rework ETA mandatory; reminder at 48h; RM sees the ETA |
| R-11 | Interstate car arrives at hub | Create the Roadworthy task at the destination |
| R-12 | Balance payment recorded | Outstanding recalculated; Final remittance received or Awaiting additional deposit |
| R-13 | Discount applied / trade-in value set | Outstanding and tax invoice recalculated; above the limit → sales manager approval |
| R-14 | RM records trade-in opted in | Valuation request for the Trade-In team, prefilled from booking; Trade-in step appears |
| R-15 | Trade-In team sets the final price, or a price conflict is raised | Price flows into DAP, outstanding and documents (flagged for regenerate); a conflict sends the ticket back to the Trade-In team and blocks the balance payment |

---

## 6. HubSpot ticket pipelines used

| Pipeline | Stages |
|---|---|
| 01a_Cash Customer Finance | Deposit remittance advice received (Bank Transfer) → First Instalment Paid → Awaiting Additional Deposit → Final remittance received → Finance GFD · Cancelled Sale |
| 02_Sales Contracts | Vehicle Sold → Priority Queue → Recall check pending → passed / failed → CX Action Required → No Automated Envelope in Docusign → Contract Sent to Customer → Pending Form 4/Trade-in Documents Signature → For Review → Contract Signed · Cancelled Sale |
| 02c_Trade in ops | Customer Opted for Trade-in → JotForm Link Sent (2K–10K) → Virtual Inspection Link (≥10K) → Awaiting final valuation → Valuation finalised → Car physically acquired → Rego acquired · Cancelled |
| 04_Interstate Customer Orders Transit | GFIT → Booked for Transit → Cars in Transit → Interstate Arrival |
| 05_Refurb Pre-GFD | Awaiting Refurb → Transported to delivery hub → QC FAIL → RWC WIP → Requires Mechanical/Panel → RWC Complete - To be Detailed → Detail Complete - Inspection Required → Inspection Failed → Refurb GFD |
| 05b_VAS Operations | Selected Products → Partially booked → All booked → Partially installed → Post delivery - Schmick → All completed · Deal cancelled |
| 06_Registration | To be Registered → Generate VIC certificate → Registration Submitted (QLD) → No Rego - EGC Sale → Registration Complete |
| 07_Active Deliveries | To be Delivered → Deliver Today → Picked up - Regional 3PL → Delivered |

Key properties shown in the UI: `rwc_status`, `rwc_serial_number`, `rwc_issue_date`, `previous_rwc_date__ticket_` (RWC expiry), `rwc_completed_confirmation`, `rwc_submitted_by`, `panel_information`, `refurbishment_notes`, `sales_refurb_promise`, `refurb_gfd_confirmation`, `refurb_inspection_failed_notes`, `registration_number`, `registration_expiry_date`, `registration_fees_charged`, `registration_payment_mode`, `trade_in_value`, `total_vas_price`.

New fields LeadVerse adds (not in HubSpot today): rework ETA on a failed RWC, QC fix ETA, trade-in conflict reason / expected price / note, payment Received by.

---

## 7. Visual design

- **Theme:** white by default; dark only via the Light/Dark toggle.
- **Type:** system UI sans (`ui-sans-serif, system-ui, -apple-system, "Segoe UI"`), 14px base; HubSpot property names in small mono grey.
- **Colours:**

| Token | Value | Use |
|---|---|---|
| `--lv` | `#4736FE` | LeadVerse primary: buttons, links, active tab underline, rail |
| `--ink` / `--mute` | `#0F172B` / `#62748E` | Text / secondary text |
| `--line` / `--line-2` | `#EEF1F6` / `#E2E8F0` | Dividers / input borders |
| `--bg` | `#F8FAFC` | Page background |
| Green | `#17A34A` on `#EBFAF3` | Done, paid |
| Amber | `#AE3F08` on `#FFF0DB` | Over SLA, blocked reason, outstanding owed |
| Red | `#C02626` on `#FDE7E7` | Failed, conflict, errors |
| Blue | `#1358A8` on `#E7F1FD` | In progress |
| Grey | `#566077` on `#EDF1F5` | Not started, neutral info |

- **Components:** form-style fields (label above, 8px radius, 10–12px padding); dropdowns with a chevron; chips (pill, 11.5px semibold); tables with a tinted header row; modals with header (title + "Complete the form to continue." + ×), a grey body and a white card, full-width primary button at the bottom; lightbox for images; section headers (13px bold).
- Persona colours: RM `#4736FE`, Refurb `#128274`, Registration & RWC `#AE3F08`, Delivery `#1358A8`, Trade-In `#0E7490`, FinOps/CX `#566077`.

---

## 8. Demo orders

| Order | Customer | What it shows |
|---|---|---|
| LV-7Q2K | Ava Thompson | Bank transfer proof, NSW licence + VIC car → customer ID flow; breakup matches the spec numbers |
| LV-3M9D | Daniel Nguyen | Card payment (auto First Instalment Paid), trade-in opted in |
| LV-4ST9 | Sophie Clarke | Card payment, PPF coating, VAS add/remove |
| LV-8LM4 | Ruby Scott | Stripe payment |
| LV-5TR0 | Oliver King | Trade-in final $4,800 awaiting the customer's decision |
| LV-7BY2 | Ethan Walker | Trade-in agreed, delivery today |
| LV-9HG3 | Noah Wilson | Interstate car; contract done → balance payment open |
| LV-6CJ5 | Jack Taylor | Cars24 finance; contract done → balance payment open |
| LV-5KX4 | Liam O'Brien | Failed RWC with rework ETA (Car prep status) |
| LV-2PL7 | Mia Patel | Tint booked, PPF and dash cam selected; registration over SLA |
| LV-1ZN6 | Grace Lee | All gates clear, ready to book; discount → documents outdated → regenerate |

---

## 9. Open items

- Real values for: VAS plan prices, stamp duty rate and fixed fees, the $500 discount approval limit, the $299 home delivery charge.
- Real APIs for: proof and document upload, Regenerate, payment entry (the Received by field is not sent today).
- Not built (deferred): raising the customer ID request at booking, 24h auto-reminders with escalation for missing customer IDs.
- Decide: should "Changed mind" trade-in reasons remove the trade-in from the order instead of raising a price conflict?

---

## 10. BYO journey (bring your own finance)

BYO is the cash journey with one difference: the balance comes from the customer's own lender, not from the customer. Every RM step stays the same. The finance ticket uses HubSpot's **01b_BYO Finance Customer** pipeline instead of 01a. Sources:

- HubSpot 01b stages and ticket histories (e.g. PT4Y7X-Alice, 4SHKIC-Ajay, AI3ORP-Steven).
- The 19 Nov FinOps call (Sirivaishnavi / Kishor recording, second half).

### The BYO status (the extra property)

| Status (HubSpot stage) | Moved by (HubSpot today) | Evidence in LeadVerse | What it triggers |
| --- | --- | --- | --- |
| Deposit remittance advice received (Bank Transfer) | 01_START, bank transfer deposits only | Payment proof | RM verifies, then → Awaiting approval |
| **Awaiting Approval from 3P Lender** | 01_START (card / Stripe) or RM. Most orders move on from here | – | Lender clocks start: pre-approval due in **2 business days**, funds in **5** (from the deposit) |
| Approved from 3P Lender | FinOps or RM, by hand | Approval letter, lender, application no., approved amount | **GFR**: RWC / refurb task (or interstate inspection). If the approved amount is short, RM warns the customer now (R-B2) |
| Lender remittance received · outstanding deposit (**new**) | Doesn't exist; the RM keeps the ticket at Approved | Remittance advice + amount (short of the balance) | RM collects the gap (Add payment entry). Outstanding $0 → Finance GFD on its own |
| Remittance Advice Received (Finance GFD) | RM, by hand | Remittance advice + amount (covers the balance) | **Finance GFD**: VAS install tasks, finance gate ✓ for the handover slot, FinOps task to confirm the funds (R-B3) |
| Loan Settled | FinOps, ticking `loan_settled_confirmation` | Funds matched in the bank account | Finance ticket closes (R-B4) |
| Cancelled Sale | anyone | Reason | Sale cancelled |

Unchanged from cash:
- **Registration:** starts when the RWC passes, not at Finance GFD.
- **Contract signing:** happens in parallel at any time.
- **Discount, VAS and trade-in:** can change before and after settlement.
- **Payment receipts:** customer receipts that arrive by email stay a manual entry.

### Keeping one status when several people move it (the parallel-update problem)

In HubSpot the 01b stage is one dropdown on the ticket. The RM (ticket owner) and FinOps each move it by hand, from any screen, days apart. The ticket histories show exactly this: Workflow → FinOps (Approved) → RM (Remittance) → FinOps (Settled). Because the stage is just a field, it drifts from what the RM is doing and is easy to forget once the RM has moved past step 1.

LeadVerse treats it as **one status owned by the order's finance task, not by an RM step**:

1. **Set once, shown everywhere.**
   - Step 1 sets the starting value, Awaiting approval.
   - After that, the *BYO status* card is pinned at the top of every RM step: status, lender, approved / remitted / outstanding, and both deadlines with on-time / overdue.
   - "Update status" works from wherever the RM is. Nobody has to go back to step 1, and there is no second copy to keep in sync.
2. **A move is an event with its evidence, not a dropdown edit.**
   - Approved needs the approval letter and amount.
   - Remittance needs the advice and amount; the amount decides Finance GFD or outstanding deposit.
   - Settled needs FinOps to confirm the funds.
   - Only the next move is offered.
3. **Backwards only as a correction**, with a reason, kept in the history.
4. **Downstream tasks hang off the status event**, never off which RM step is open (see "What each status opens for other teams" on the Lender finance step).
5. **Full audit**: every move with who, when, from where (RM / FinOps / Workflow) and the evidence.

### Screens (middle area on the DLS, Turbo UI)

- **Step 1 · Verify deposit** gets a *BYO status* SectionCard:
  - the Ticket status Dropdown (same values as 01b, only the next one enabled);
  - deposit and lender, as a FetchedInfoCard.
  
  A bank transfer is verified as for cash ("Deposit verified · awaiting 3P lender").
- **Pinned BYO status card** on every other step:
  - SectionCard with a status Badge, a FetchedInfoCard (lender, approved, remitted, outstanding) and deadline Badges;
  - an InformationMessage when the approval leaves a gap;
  - Update status, with a Chip per move, FileUploadCard for the letter or advice, TextInputs, the live preview of what the move triggers, and a Button.
- **Step 8 becomes "Lender finance"** (instead of Balance payment). It has four DataTables:
  - Payments: deposit, lender remittance, customer top-ups;
  - Price breakup: total, deposit, approved (not money yet), remitted, customer gap, outstanding;
  - What each status opens for other teams;
  - Status history.
  
  The footer runs the next move.
- **Payment mode** (left panel, Order tab) can be changed at any step until handover, by the RM or Finance, through a confirm popup. The finance ticket moves to the new mode's pipeline and keeps what was paid. To in-house finance: Finance team task. From in-house finance: RM assigned. The website order follows, so the customer stops seeing the old mode's document steps (R-B5).

### Demo orders (BYO)

| Order | Shows |
| --- | --- |
| LV-6BY3 Alice Morgan | Bank transfer deposit to verify; step 1's BYO status property |
| LV-1BY5 Kenji Ito | Awaiting approval, pre-approval overdue |
| LV-8RT1 Chloe Martin | Approved from 3P lender (Latitude) with a $2,500 gap |
| LV-4BY8 Emma Davis | Lender remittance short by $3,200: outstanding deposit |
| LV-7BY2 Ethan Walker | Loan settled |

### Open (from the call)

- **Lender emails:**
  - Lender approval letters and remittances arrive at hello.au: about 1,500 unassigned emails, and family members email too.
  - How they reach the order in LeadVerse is still open; a separate discussion with tech.
- **Website sync:** the payment mode change has to sync to the website (a tech dependency).
- **Lender deadlines:** the 2 / 5 business-day deadlines aren't enforced with customers yet; the charges are undecided.
- **Unused 01b stages:** to be cleaned up once everything is on stage.

## 11. Journey viewer, in the PISTON structure

The app now opens on a journey viewer laid out like the PISTON spec (piston-leadverse-proto): journey rail on the left,
the Leadverse screen at that step in a browser frame with numbered anatomy pins, and Spec or Anatomy on the right.
It uses the PISTON *structure* only. The phases and steps are the RM order journey's own, not PISTON's P-I-S-T-O-N.

| Phase | Steps | Who |
| --- | --- | --- |
| V · Verify | V1 Verify deposit, V2 Customer documents | RM, the day the deposit lands |
| D · Deal | D1 Discount, D2 Add VAS, D3 Sales promise, D4 Trade-in (branch) | RM, with the Trade-In team |
| C · Contract | C1 Contract & invoice | RM, the customer on DocuSign |
| F · Funds | F1 Balance payment (Cash) or Lender finance (BYOF) | RM and FinOps; BYOF: the customer's lender |
| H · Handover | H1 Car prep status, H2 Book delivery | RM, with Refurb, Registration and Delivery |

- **Tracks:** Cash and BYOF, switched at the top like PISTON's Booked / Walk-in / Video TD. BYOF changes V1 (the BYO status
  property), F1 (Lender finance) and adds the pinned BYO status card to every step after Verify.
- **The frame is live:** it renders the real RM order view for a demo order at that step, so every action works. Stepping
  inside the frame moves the rail with it.
- **Spec:** description, owner, the "New:" change from HubSpot, source (triggered by, data from), screen and route, entry
  conditions, exits with the state each one sets, HubSpot today, and the rules that fire.
- **Anatomy:** numbered parts, each with its `@cspl/*` component; the numbers match the pins on the screen.
- **Blueprint:** the two flows (source, entry, exit states, main path), then every phase as a table of steps.
- **Fields:** every field on every screen, per phase. **What changed:** six changes from HubSpot, each with before and after.
  Sources are labelled: paraphrased from the FinOps call, from the brief, or a design decision.
- **Order states** (the badge beside each step title, and the lead pane's States tab): DEPOSIT PAID, GFR, AWAITING 3P LENDER,
  LENDER APPROVED, OUTSTANDING DEPOSIT, FINANCE GFD, READY TO BOOK, DELIVERY BOOKED, LOAN SETTLED, SALE CANCELLED.
- **Routes:** `#cash-V1`, `#byo-F1`, `#blueprint-cash`, `#fields-byo`, `#changes-cash`; `#app` is the full Leadverse app
  (Open the app, or Screen only, from the viewer; Journey spec in the app's rail goes back).

**The RM screen itself now follows the PISTON screen layout:** a phase bar with the steps of the current phase as chips,
the title with its step ID and the order-state badge, every block of the step as a DLS `SectionCard`, the "When you take
the main exit, LeadVerse will" box, "Show the spec for V1", and a footer with the exit count and the state the main exit
sets. The lead pane has a status pill, Call / WhatsApp / Email, and Details / States / Teams / Activity; the right panel
has CarGPT and a Customer view (the order page the customer sees).

**DLS:** every step's action area is Turbo UI: `SectionCard`, `Table`, `Badge`, `SegmentTabs` (yes/no checks, delivery
mode), `FetchedInfoCard`, `InformationMessage`, `Button`, `LinkButton`, and `SelectionSlots` for the handover day and time,
where a fully booked day and a taken time are disabled slots, and every slot stays disabled while a gate is open.


### 11.1 DLS pass and flow improvements (24 Nov 2026)

Every block inside the steps is now a Turbo UI component, not a restyled legacy one:

| Where | Before | Now (`@cspl/*`) |
| --- | --- | --- |
| Finance and contract tickets | read-only boxes and a native select | `fetched-info-card` (ticket, pipeline, time in status) + `dropdown`, with the moves still open as the hint |
| D1 Discount | hand-made calculator lists and form | two `payment-details-card` breakups, `text-input` with a $ prefix, `segment-tabs` (Flat / %), `dropdown`, and an outstanding now → after card |
| D2 VAS | expandable legacy table | `table` with type as sub-text, a status badge, the install task and Remove as a `link-button`; Add VAS is a `modal` |
| D4 Trade-in | legacy form | `fetched-info-card` for the Trade-In team's fields; Agrees / Does not agree as `segment-tabs`, then `dropdown`, `text-input`, `text-area` |
| C1 checks | coloured rows | `table` with a status badge and Regenerate as a `link-button` |
| Customer ID request | hand-made tracker | `stepper` (Requested, Awaiting customer, Received, Verified) + `text-input` with validation |
| Add payment entry | legacy modal | `modal` with `text-input`, `dropdown`, `text-area` and inline errors |

**Flow changes, as a PM:**

1. **Money strip on every step.** Order total, paid, outstanding and handover gates sit under each step's title. Discount,
   VAS, trade-in and the contract all move the outstanding amount, and it is the first thing a customer asks on a call.
2. **The balance is collected with a Stripe payment link (F1, Cash).** SMS and email are ticked by default; the link is for
   the full outstanding amount. The customer pays on their phone, Stripe records the payment, and the ticket moves on its own.
   Bank transfers still go in through Add payment entry, now in the exits menu. The Customer view shows "Pay $X with the link".
3. **The customer can pick their own handover slot (H2).** "Send the customer a slot picker" shares the same capacity; whoever
   books first takes the slot. The earliest open day is marked.
4. **V2: Use the system's answers** fills all four licence checks at once; the RM only changes the ones they disagree with.

The journey spec carries all of it: the money strip is a shell part on every step, F1 and H2 have the new exits, parts and
fields, and What changed has two more entries (both marked as design decisions).

## 12. Run it

```bash
npm --prefix app install
npm --prefix app run dev
```

Build the single-file artifact: `npm --prefix app run build`, then inline `app/dist/assets/*.css` and `*.js` into `rm-flow.html`.
