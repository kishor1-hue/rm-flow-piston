# AU RM persona — HubSpot → LeadVerse mapping (draft for review)

Sources: live HubSpot portal 20450426 (pipelines + properties, pulled 15 Nov 2026), AUS-CARS24 repos
(b2c-oms-au, b2c-refurb-service-au, slot-planner-au, b2c-admin-web-au), and the AU-Finance-Handoff zip
(RM & Finance reimagine doc, HubSpot pipeline map, LeadVerse AU views prototype).

## 1. How it works today (the one fact that shapes everything)

HubSpot is the system of record for post-deposit milestones. Teams move **tickets**; HubSpot workflows
stamp dates on the deal and call OMS `hubspotBackSync` (`ExternalWebhookServiceImpl`), which writes onto the order:

| Order field (OMS)        | Set when HubSpot ticket reaches                     | Owner persona |
|--------------------------|-----------------------------------------------------|---------------|
| `financeGfdDate`         | 01a Finance GFD / 01b Loan Settled / 01d Loan Settled-GFD | FinOps / Finance |
| `contractSignedDate`     | 02 Sales Contracts → Contract Signed                | RM            |
| `refurbGfdDate`          | 05 Refurb Pre-GFD → Refurb GFD                      | Refurb        |
| `rwcStatus`              | 05 RWC WIP / RWC Complete                           | Refurb (RWC)  |
| `regoStatus/regoNumber/regoExpiry` | 06 Registration stages                    | Registration  |
| `inTransitToHubDate / arrivedAtHubDate` | 03/04 interstate pipelines           | Logistics     |
| `deliveredDate`          | 07 Active Deliveries → Delivered                    | Delivery / RM |
| `rmEmail`                | deal `assigned_rm`                                   | System        |

**Slot gate** (`OrderUtility.isDeliveryBookingAllowed`):
`refurbGfd ✓ AND contractSigned ✓ AND financeGfd ✓ AND (arrivedAtHub ✓ OR not interstate) AND not delivered`.
→ In LeadVerse these become native order milestones; the back-sync webhook disappears.

## 2. RM journey on the order (Primary Deal Pipeline stages 1–9)

| # | LeadVerse RM stage | HubSpot deal stage(s) | RM does (write) | RM watches (read-only, other persona) |
|---|---|---|---|---|
| 1 | Deposit paid · assigned | 1: Deposit Paid | Accept, intro call (Aircall), recap email template | Automated comms timeline |
| 2 | Payment | 01a / 01b / 01d by `payment_mode` | Match remittance, raise "mark paid" to FinOps, chase additional deposit | FinOps ticket stage, finance loan stage (masked) |
| 3 | Contract | 02 Sales Contracts | Send / resend DocuSign, recall check, Form 4 / trade-in docs | DocuSign status, signed PDF |
| 4 | Roadworthy & refurb | 4: Awaiting RWC, 6: Awaiting Refurb GFD | Chase with SLA nudge (no edit) | **Refurb**: 05 stage, RWC status, rework ETA (new, R1), work log, VAS ops 05b |
| 5 | Registration & transit | 2/3 interstate, 5: Awaiting Registration | — | **Registration**: 06 stage, rego no./expiry; **Logistics**: transit ETA |
| 6 | Blockers / slot | 7: Awaiting on blockers → 8: Delivery Booked | Book slot (gate above, with RM override R3), confirm to customer | Gate checklist |
| 7 | Handover | 9: Delivered (07 Active Deliveries) | Handover form, trade-in form (02c), mark delivered | Warranty 07b, VAS install |

Payment-mode branches (deal `payment_mode` values seen live): `100% Online` → 01a Cash ·
`BYO` → 01b BYO · `GLOBAL CARS AUS CREDIT PTY LTD` → 01d In-house · (01c Consumer — unused).

## 3. RM left panel (static, from DB) — proposed

Customer: name, phone, email, state, `assigned_rm`, `relationshipmanagernumber` ·
Car: `order_id`, `appointment_id`, make/model/year/VIN, `vehicle_location` (hub), interstate flag ·
Money: `payment_mode`, `outstanding_amount__hs_calculated_`, `total_vas_price`, trade-in value ·
Delivery: `delivery_mode` (PICK_UP/HOME_DELIVERY), `booked_delivery_date` + slot, `delivery_date_booked_by` ·
GFD gate: Finance / Contract / Refurb / Hub-arrival dates as four ticks.

## 4. Other personas (each gets its own board; RM sees them read-only)

- **Refurb** — 05 Refurb Pre-GFD (Awaiting Refurb → RWC WIP → Requires Mech/Panel → RWC Complete → Detail → Inspection → Refurb GFD), 05b VAS Ops, Bne RWC. Refurb service states: TRIAGE → JOB_CART, jobs PENDING/APPROVED/REJECTED, repairs IN_PROGRESS/DONE.
- **Registration** — 06 Registration (To be Registered → Generate VIC cert → Submitted (QLD) → Complete / No Rego-EGC), then 09 Transfers.

## 5. Live volumes (Primary pipeline, deals created since 1 Aug 2026)
Deposit Paid 151 · Awaiting RWC 116 · Awaiting Registration 62 · Awaiting Refurb GFD 15 · Blockers 7 ·
Interstate 16 · Delivery Booked 3 · Delivered 186. 307 deals in RM working stages created since 15 Oct.

## 6. Trigger chain observed in live data (one cash QLD order, deposit → delivered in 4 days)

Ticket `createdate` lands 2–30 s after the deal-stage or ticket-close event, so these are HubSpot workflows:

| Event | Creates | Persona |
|---|---|---|
| Deal → 1: Deposit Paid | Finance ticket (01a/01b/01d by `payment_mode`) + Contract ticket "Customer Documents" (02, Vehicle Sold) + Suncorp insurance lead | FinOps/Finance, RM |
| GFR stamped (DW01b) → DW02 sets 4: Awaiting RWC — see §7 | Refurb ticket 05 "[Required]" at Awaiting Refurb | Registration (RWC part) → Refurb |
| Finance ticket → Finance GFD | One 05b VAS ticket **per product** (tint, PPF, dashcam…) at Selected Products | Refurb (VAS ops) |
| 05 reaches RWC Complete → deal 5: Awaiting Registration | Registration ticket 06 | Registration |
| 06 → Registration Complete → deal 6: Awaiting Refurb GFD | — (05 continues: detail → inspection/QC) | Refurb |
| 05 → Refurb GFD (+ finance GFD + contract signed) → deal 8: Delivery Booked | Delivery ticket 07 To be Delivered | Delivery |
| 07 → Delivered → deal 9 | Post-delivery check-in 08 + Warranty 07b | CX / Warranty |

VAS tickets were still at Selected Products after delivery — confirms "nobody moves VAS tickets".
Persona split used in the prototype: **RM** · **Refurb** (sales promise, detail, QC/inspection, VAS ops) ·
**Registration** (RWC + rego + VIC cert/QLD submit) · **Delivery** (slot, interstate transit, handover, trade-in).

## 7. Confirmed from the HubSpot workflow definitions (read in Chrome, 15 Nov 2026)

Naming: `DWxx` = deal workflows, `TWxx` = ticket-swimlane workflows, numbered by journey step (author mostly Quentin Ngai, 2022).

| Workflow | Trigger (enrolment) | Does |
|---|---|---|
| 01_START – Create ticket in Finance and Contract Creations Pipelines | Order Status Booked/Reserved | Finance ticket by payment type + 02 contract ticket |
| 01_a – Deal Owner Assignment for Post BC Orders | — | Assigns RM by payment mode + delivery state, messages customer |
| **DW01b** – GFR Date & L09_GFR | Order Booked/Reserved AND finance ticket in: Cash *First Instalment Paid / Awaiting Additional Deposit / Finance GFD*; BYO *Approved from 3P Lender / Remittance (GFD) / Loan Settled*; IHF *Approved, Ready for Rego / Settled – outstanding deposit / Loan Settled-GFD*; Consumer *Medium/High Confidence / Conditional / Approved / GFD / Settled* — OR IHF prime/stable cohort + interstate | Stamps **GFR Date** (Go For Refurb) |
| **DW02** – GFR moves deal to Interstate/RWC | GFR Date known AND Interstate Transit Required known AND Booked/Reserved | Branch: not interstate → L03 Awaiting RWC, deal 4, 05 refurb ticket (by state + tint); interstate → 03 pre-transit inspection ticket |
| DW03 | Finance GFIT or Refurb GFIT date known | 04 interstate transit ticket |
| VAS ticket pipelines – Tinting / Exterior Protection / Servicing / Scratch n dent | product opted + deposit known + **GFR** (IHF/BYO) or **Finance GFD** (Cash) | One 05b ticket per product |
| TW04 – RWC → Awaiting Registration | RWC completed confirmation | RWC Completed Date, deal 5, registration ticket owner by state |
| TW05 – Registration Complete | 06 status Registration Complete / Submitted (QLD) | Registered Date, deal 6 if Refurb GFD unknown |
| **DW06a** – Refurb GFD, check other fields | Refurb GFD Date known → delay 5 min | If Finance GFD ∧ Registered ∧ Refurb GFD ∧ Contract Signed ∧ no 07 ticket → deal 8 + 07 delivery ticket (owner per state); else deal 7 Awaiting on blockers |
| DW06b – constantly check dates | Deal in Delivery Booked + dates | Creates the 07 ticket when blockers clear later |
| TW08 – Delivered | 07 Delivered | Actual Delivery Date, deal 10, post-delivery tickets |
| DW07b | Deal stage 9/10 | Warranty ticket (07b) |
| Update Refurb GFD to BE – HS BE Back Sync | Refurb GFD known, 1 min delay | Calls OMS back-sync API |

**Corrections to §6:** refurb/RWC starts at **GFR** (a payment milestone), not after the RM intro call; IHF/BYO VAS tickets are created at GFR; the delivery ticket is created when all gates clear (DW06a), not at slot booking.

## 8. Stage-entry rules from HubSpot pipeline settings (15 Nov 2026)

No post-deposit pipeline has *pipeline rules*, so cards can be dragged freely; what stops a move is the **conditional stage properties** (required to enter a stage). Automatic moves come from workflows (e.g. TW01a counts cash split payments).

| Pipeline → stage | Required to enter |
|---|---|
| 05 → Requires Mechanical/Panel | RWC Completed Confirmation, Is this a roadworthy item?, Delay (Cosmetic/Mechanical), Panel Information |
| 05 → RWC Complete – To be Detailed | RWC Completed Confirmation (+ RWC serial number, RWC expiry date shown) |
| 05 → Detail Complete – Inspection Required | Detailing Complete Confirmation |
| 05 → Inspection Failed | Failed Pre-Refurb GFD Inspection Notes |
| 05 → Refurb GFD | Passed Pre-Refurb GFD Inspection, RWC Completed Confirmation |
| 06 → Generate VIC certificate | Rego number, Check digit, Vehicle year/make/model, Body type, VIN, Engine number, Rego fees, Rego expiry, TAC charge, Rego created date |
| 06 → Registration Submitted (QLD) | Rego created date, expiry, number, fees, payment mode, RWC number, RWC issue date, RWC link |
| 06 → Registration Complete | Rego number, Rego expiry (+ public certificate) |
| 07 → Delivered | Actual delivery date (+3 more) |
| 02 → Recall check passed / failed | Recall check status |
| 02 → CX Action Required | Reason for CX action (+1) |
| 02 → No Automated Envelope in DocuSign | Tax invoice link |
| 02 → Contract Sent / Form 4 / For Review | Recall check status, Document handling, Tax invoice link |
| 02 → Contract Signed | Contract signed confirmation, Recall check status, Contract of sale link, Tax invoice link, Transfer document link, Document handling |
| 01a → Finance GFD | Finance GFD Confirmation |

TW01a (cash): when the ticket is at First Instalment Paid / Awaiting Additional Deposit and a deposit-type payment lands, it increments Split Payment Count and branches on >1 / =1.

## 9. Full ticket-pipeline logic: create → move → complete (read 16 Nov 2026)

Source: every enabled post-deposit workflow definition (67 of 952 enabled workflows, read through HubSpot's own workflow API in the signed-in browser) plus the ticket pipeline definitions from the HubSpot MCP. Supersedes §7 where they differ.

### 9.1 How the machine works (one pattern, repeated)

1. **A team fills a field or moves its ticket** (ticket property / ticket stage).
2. A **deal workflow** listens for "associated ticket entered stage X" or "ticket field = Yes" and **stamps a date on the deal** (descriptions say "Timestamped by Ticket"), sets an **L0x label** and moves the **deal stage**.
3. A second **deal workflow** listens for that deal date and **creates the next team's ticket** (owner chosen by `delivery_state`).
4. A **"… to BE – HS BE Back Sync"** deal workflow (custom code) pushes the date to OMS.

So completion is never a single field: it is *ticket stage reached* (CLOSED stage) → *deal date known* → *next ticket created*. A ticket pipeline is "complete" when it reaches a stage whose state is **CLOSED**.

### 9.2 Per pipeline

| Pipeline | Created by (workflow · condition) | Entry stage · owner | Moves automatically | Complete (CLOSED) → what it triggers |
|---|---|---|---|---|
| **01a Cash** | `01_START` · deal `status` = BOOKED/RESERVED while deal is in a pre-booking stage, `payment_mode` 100% Online / Bank Transfer, deposit > 0 | Full payment → **Finance GFD**; bank transfer / `proof_of_payment_link` → *Deposit remittance advice received*; split → **First Instalment Paid** (`split_payment_count`=1) | `TW01a` (ticket): each new deposit → outstanding = 0 ? **Finance GFD** : *Awaiting Additional Deposit* | **Finance GFD** (needs `finance_gfd`) → `DW01e` deal `finance_gfd_date`; `DW01b` deal `gfr_date` already at First Instalment |
| **01b BYO** | `01_START` · `payment_mode` = BYO | *Awaiting Approval from 3P Lender* (or *Deposit remittance…* if bank transfer) | — | **Loan Settled**. GFR at *Approved from 3P Lender*; `finance_gfd_date` at *Remittance Advice Received (Finance GFD)* / Loan Settled |
| **01c Consumer finance** | `01_START` · `payment_mode` = Consumer Finance | *Deposit Paid* | — | **Loan Settled** (or Declined / Withdrawn / Non-responsive). GFR from *Medium Confidence* onward; GFD date at *Finance GFD* |
| **01d In-house finance** | `01_START` · `payment_mode` = GLOBAL CARS AUS CREDIT; separate flow for `user_cohort` = BAD | *Awaiting Documents/Information*, or *Application completed* if `document_upload_status` + `loan_application_status` = COMPLETED | `INHF – Full payment received`: at *Approved, Ready for Rego* / *Settled – outstanding deposit* and outstanding = 0 → **Loan Settled-GFD** | **Loan Settled-GFD** (or Application closed). GFR at *Approved, Ready for Rego*; also GFR straight away if `finance_score` Prime Elite/Stable **and** interstate. If already approved at booking, 01_START moves the deal to 4 (or 2 if interstate) itself |
| **02 Sales contracts** | `01_START` · every booking ("Customer Documents") | **Vehicle Sold** · owner by `delivery_state` (`02_Sale Contracts Ticket Owner`) | Labels only: Vehicle Sold/For Review → deal `l11` "Contract not sent"; Contract Sent → "Contract not signed" | **Contract Signed** (6 required fields, §8) → `TW02a` deal `contract_signed_date`, `l11` = Contract Signed. Links copied to deal: contract of sale, tax invoice, transfer document |
| **03 Pre-interstate inspection** | `DW02` · deal `gfr_date` known ∧ `interstate_transit_required` = true | **To Be Inspected** · owner by `car_location_at_time_of_sale` (origin state). Deal → 2, `l02` = Awaiting Refurb GFIT | — | **Refurb GFIT** (needs `passed_inspection`) → `TW03a` deal `refurb_gfit_date` |
| **04 Interstate transit** | `DW03` · deal `finance_gfit` ∧ `refurb_gfit_date` known | **GFIT**. Deal `gfit_date`, `l02` = Refurb GFIT | Ticket `eta_date` → deal `eta_date` + `transit_booked_date`; *Cars in Transit* → deal `interstate_departure_date`, deal 3 | **Interstate Arrival** → `TW03d` deal `interstate_arrival_date`, deal 4, **creates the 05 refurb ticket** (if none) |
| **05 Refurb pre-GFD** (RWC + detail + QC) | `DW02` (not interstate) or `TW03d` (after arrival) | **Awaiting Refurb** · owner by `delivery_state` (tint branch picks a different ticket template) | VIC only: when the finance ticket reaches First Instalment / Approved Ready for Rego / Approved from 3P lender → *Transported to delivery hub*. `pre_refurb_qc_date` stamped at Transported / QC FAIL | Mid-pipeline trigger: ticket `rwc_completed_confirmation` = Yes → `TW04` deal `rwc` (RWC Completed Date), `l03`, deal 5, **creates 06**; RWC issue date copied to the **Car** object. **Refurb GFD** (needs `refurb_gfd_confirmation` + RWC confirmation) → `TW06` deal `refurb_gfd_date`, `l05` → `DW06a` |
| **05b VAS operations** | One deal workflow per product (tint, exterior, interior, dashcam, scratch & dent, servicing) · product `*_opted` ∧ deposit known ∧ `gfr_date` ∧ Booked/Reserved ∧ (IHF: nothing more; others: `finance_gfd_date`; **NSW** also needs the car local or `interstate_arrival_date`; NSW cash may use `final_remittance_received_date__cash_`) | **Selected Products**; scratch & dent and servicing at GFR only, straight to **Post delivery – Schmick** | Auto-cancel → *Deal cancelled* when product un-ticked or deal 15 Cancelled. `VAS Added Post BC`: product added after booking and finance GFD known → **deal back to 7 Awaiting on blockers** | **Partially installed** / **All completed** — moved by hand only; nothing downstream waits on it |
| **06 Registration** | `TW04` · RWC confirmed | **To be Registered** · owner by `delivery_state` | — | **Registration Complete** or **Registration Submitted (QLD)** → `TW05` deal `registered_date`, `l04`, deal 6 if refurb not yet GFD. VIC complete also copies rego no., expiry, engine no., TAC, check digit, fees to the deal. **No Rego – EGC Sale** also closes |
| **07 Active deliveries** | `DW06a` (5 min after `refurb_gfd_date`) or `DW06b` (re-check) · deal `finance_gfd_date` ∧ `registered_date` ∧ `refurb_gfd_date` ∧ `contract_signed_date` known ∧ no 07 ticket | **To be Delivered** · owner by `delivery_state`. Deal → 8. If a date is missing → deal 7 Awaiting on blockers | Ticket `delivery_mode` → deal 3PL / Carcierge / pick-up date | **Delivered** (needs `actual_delivery_date` + 3) → `TW08` deal `actual_delivery_date`, `l06`, deal 9, **creates 08**, sets day-3/7/14 dates; `DW07b` warranty |
| **07b Warranty generation** | `DW07b` · deal enters 9 or 10, wait 5 min | **Default Warranty to be generated**; plus *Extended warranty to be generated* if `extended_warranty_opted`, `integrity_warranty` or `rsa_opted` | Docs/link copied to deal | **Warranty / Extended warranty / AWN warranty sent to customer** |
| **08 Post-delivery check-ins** | `TW08` | **Delivered to Customer** | — (deal gets `day_7_date`, `day_14_date`) | **Day 7 Check Completed** — moved by hand |
| **09 Transfers** | `DW10` · 6 days after `actual_delivery_date`, deal → 10 | **Awaiting Transfer** · owner by state ("FLAGGED WITH ISSUE" if the customer raised an issue / asked for a return) | — | **Transferred** or **No Transfer Required** (→ deal `no_transfer_flag`) |

### 9.3 Which object holds what

| Object | Properties used by the logic |
|---|---|
| **Deal** (= the order) | **Triggers:** `status` (BOOKED/RESERVED), `dealstage`, `payment_mode`, `payment_method`, `deposit_payment_type`, `deposit_amount`, `outstanding_amount_to_be_paid_by_customer`, `total_amount_to_be_paid_by_customer`, `trade_in`, `proof_of_payment_link`, `delivery_state`, `car_location_at_time_of_sale`, `interstate_transit_required` (calculated by DW14 from the two states), `finance_score`, `user_cohort`, `loan_application_status`, `document_upload_status`, VAS `*_opted` flags, `extended_warranty_opted`, `integrity_warranty`, `rsa_opted`, `by_pass_contract_gfd_for_delivery_slots`. **Milestone dates stamped by workflows:** `gfr_date`, `finance_gfit`, `finance_gfd_date`, `refurb_gfit_date`, `gfit_date`, `eta_date`, `interstate_departure_date`, `interstate_arrival_date`, `rwc`, `registered_date`, `refurb_gfd_date`, `contract_signed_date`, `actual_delivery_date`. **Status labels:** `finance_status` (L01), `l02_refurb_gfit`, `l03_rwc_status`, `l04_registration_status`, `l05_refurb_gfd_status`, `l06_delivery_status`, `l07_transfer_status`, `l09_gfr`, `l11_contract_status`, plus `sl0x` shadow labels and `awaiting` (a joined list of open blockers). Owner = RM (`hubspot_owner_id`, set by 01_a by payment mode + state) |
| **Ticket** (= one team's task) | `hs_pipeline`, `hs_pipeline_stage`, and the confirmation/data fields each team fills: `finance_gfd`, `recall_check_status`, `contract_signed`, `contract_handling`, `contract_of_sales_link`, `tax_invoice_link`, `transfer_document_link`, `passed_inspection`, `failed_inspection_notes`, `eta_date`, `rwc_completed_confirmation`, `rwc_serial_number`, `rwc_issue_date`, RWC expiry, `panel_information`, `detailing_complete_confirmation`, `refurb_gfd_confirmation`, rego fields (`registration_number`, expiry, check digit, TAC, fees, engine no.), `actual_delivery_date`, `delivery_mode`, `warranty_and_rsa_docs`. Copies pushed down from the deal: `payment_mode__imported_from_deal_`, `finance_gfd_date`, `split_payment_count__do_not_edit_`, `deposit_amount__do_not_edit_`, `delivery_state` |
| **Contact** | Not a gate. `lifecyclestage` → opportunity at booking; check-in / walk-in date synced deal ↔ contact |
| **Car** (custom object `p20450426_Cars`) | Not a gate. Only `cars24_rwc_date`, copied from the ticket's `rwc_issue_date` when RWC is confirmed. (MCP can't read this object until the HubSpot connector is re-authorised) |

### 9.4 Things that matter for LeadVerse

- **Deal workflows trigger on the associated ticket's stage**, e.g. `DW01b`, `DW01e`, `TW02a`, `TW05`, `TW06`, `TW08`. In LeadVerse that is simply "task reached stage X on this order".
- **Two delivery gates:**
  - HubSpot's DW06a requires `registered_date`.
  - OMS `isDeliveryBookingAllowed` does not check registration, but does check hub arrival.
  - Pick one in LeadVerse.
- **QLD:** *Registration Submitted* already counts as registered.
- **VIC:** the refurb ticket auto-moves at a finance milestone.
- **NSW VAS:** tickets wait for the car to be local.
- **Moved by hand only, with no workflow:** VAS install progress, check-ins and warranty sent. These are the "nobody moves it" tickets.
- **Back-sync to OMS:** dedicated custom-code deal workflows push finance GFD, refurb GFD, RWC status, contract signed (or bypass), interstate departure/arrival, delivered and transfer dates.
- Unknown stage ids in some filters (22937968, 14894894, 19770448) point at stages that no longer exist.

## 10. RM cash action flow (from the RM shadow session, 17 Nov 2026)

Source: the RM shadow recording (HubSpot screens for R5NSB7, 77KK4W, E1Z5HY), the example deal 9KRW1Y, and the B2C admin panel code (`b2c-admin-web-au`: Orders, DiscountCodes, DeliverySlotManagement).

In HubSpot the RM works on the deal and moves tickets in the side panel; workflows then react. In LeadVerse each step is an **action** in the middle panel, and the backend does what the workflows did.

| # | RM action (LeadVerse) | Where it happens today | What the backend does on the action |
|---|---|---|---|
| 1 | **Verify deposit**: open the payment proof, match it to the bank statement, set the Finance ticket status (same dropdown as HubSpot 01a) to *First Instalment Paid*. Or cancel the sale | HubSpot finance ticket (owner = RM, e.g. "9KRW1Y-Dani (Finance Ticket)" at *Deposit remittance advice received (Bank Transfer)*, `proof_of_payment_link` on deal + ticket) | Stamp GFR (DW01b) → create the Refurb/RWC task, or the interstate inspection (DW02) → order to Car prep (deal 4) → sync GFR to OMS. Seen live: R5NSB7 finance ticket → First Instalment Paid 11:29, deal 1 → 4 and refurb ticket at 11:30 |
| 2 | **Discount** (one page, two sections): 1) calculator — enter the required outstanding amount, LeadVerse back-calculates the discount; 2) generate discount — type Flat/Percentage, description (EW, VAS Sales, Car Discount, Eligible Stock, Service History Missing, Referral, Promotional, Finance rate match, Deposit contribution), value, valid till. Above the limit it needs approval | B2C admin *Discount Codes* (discount calculator `api/admin/getDiscount/{orderId}?finalDap`, "Approval Required" modal, credit note). HubSpot only receives `discount_value` | Recalculate outstanding, regenerate tax invoice, approval request when above the limit (the $500 limit is an assumption) |
| 3 | **Customer documents**: status dropdown of HubSpot 02 (Vehicle Sold → recall check → contract sent → Form 4 → review → Contract Signed). Customer gives the documents on the portal (licence); RM checks DocuSign status | HubSpot "(Customer Documents)" ticket, `contract_handling` = Contract sent through Portal; B2C *Manage Document* (DocuSign) | Signed → contract signed date (TW02a), contract gate ✓, sync to OMS |
| 4 | **Sales promise**: fill the *Sales Promise Refurbishment Checklist* (form-builder JSON in `app/src/forms/sales-promise-checklist.json`): "Does this category need refurbishment?" Yes/No/NA, then per category (AC, Brake/Acceleration, Electrical, Engine, Exteriors, Interiors, Lights, Servicing, Steering Wheel, Suspension, Transmission, Tyres) a multi-select, an "Other remarks" box (required when Others is picked) and optional photo upload; plus Other Refurbish Comments | Deal properties `sales_promise_`, `notes_to_add_sales_promise`, `formatted_sales_promise` (left panel) | GET_SALES_PROMISE_CHECKLIST prefills on load (dummy: mapped from the deal promises); uploads via GENERATE_REFURB_DOC_UPLOAD_URL (presigned PUT); Submit → SUBMIT_SALES_PROMISE_CHECKLIST (POST /api/v1/lead-verse/sales-promise-checklist-submit) → items attached to the Refurb detail task; discount promises carry into the Discount step |
| 5 | **Trade-in**: set the final value after inspection | B2C admin *Add Trade-in*; HubSpot `trade_in_value`, 02c Trade-in ops | Outstanding recalculated; final valuation to the trade-in ops task; Form 4 added |
| 6 | **Balance payment**: call the customer, record each payment; at full payment confirm *Finance GFD* | Finance ticket; TW01a counts split payments | Each payment → Final remittance received or Awaiting additional deposit (TW01a). Finance GFD → date stamped (DW01e), VAS tasks (cash), finance gate ✓, sync to OMS |
| 7 | **Book delivery**: pick-up or home delivery (shipping charge), then a slot once the gates are clear | B2C admin *Book Delivery Slots*; `delivery_mode`, `shipping_charges` | Slot + handover task, email/SMS confirmation |

Verify deposit and Customer documents run in parallel from the moment of booking; Discount sits right after Verify deposit. Refurb, registration and delivery tasks are other personas; the RM sees them read-only in the Teams tab.
