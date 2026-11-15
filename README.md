# rm-flow — LeadVerse AU post-deposit journeys

Prototype of how the AU HubSpot ticket pipelines become persona journeys on a LeadVerse **order**:
RM · Refurb (sales promise, detail, QC, VAS ops) · Registration & RWC · Delivery.

- `app/` — Vite + React + TypeScript. `npm --prefix app install && npm --prefix app run dev`
  - `src/model.ts` — journeys, stages (each mapped to its HubSpot pipeline/stage), trigger rules, slot gates
  - `src/engine.ts` — order state + workflow engine (stage change → rules → tasks for other personas)
  - `src/seed.ts` — invented demo orders, replayed through the engine
- `RM-MAPPING.md` — the HubSpot → LeadVerse mapping and the live-data evidence behind each rule

Live demo (private, share from the page): https://claude.ai/artifact/VQHgVrJq5HpnWamUgacp5X — `rm-flow.html` is the single-file build of `app/`.

All customer data is invented. HubSpot volumes and trigger timings were read from the live AU portal on 15 Nov 2026.
