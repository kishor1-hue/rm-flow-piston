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
