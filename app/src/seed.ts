// Invented demo orders. Each one is replayed through the engine from its deposit,
// so tasks, timestamps and the activity feed are produced by the same rules the UI uses.
import { JOURNEYS, type JourneyId } from './model';
import { bookSlot, createOrder, HOUR, move, setBypass, task, type Order, type PaymentMode, type State } from './engine';

type Step =
  | [number, JourneyId, string, Record<string, string | boolean>?, string?]
  | [number, 'slot', string, string]
  | [number, 'bypass'];

const HUBS: Record<State, string> = { VIC: 'Melbourne hub · Altona North', NSW: 'Sydney hub · Chullora', QLD: 'Brisbane hub · Eagle Farm' };
const VAS = {
  tint: { name: 'Ceramic tint', price: 499 },
  ppf: { name: 'Exterior paint protection', price: 899 },
  cam: { name: 'Dash cam (front + rear)', price: 399 },
  ew: { name: 'Extended warranty · 3 yr', price: 1499 },
};

interface SeedDef {
  id: string; name: string; state: State; suburb: string; carState?: State; mode: PaymentMode; lender?: string;
  car: [string, string, number, number, string]; price: number; deposit: number; vas?: (keyof typeof VAS)[];
  promises?: string[]; tradeIn?: [string, number]; home?: boolean; depositH: number; steps: Step[];
}

const SEEDS: SeedDef[] = [
  { id: 'LV-7Q2K', name: 'Ava Thompson', state: 'VIC', suburb: 'Footscray', mode: 'Cash', car: ['Mazda', 'CX-5 Maxx Sport', 2021, 48210, 'Soul Red'], price: 32990, deposit: 1000, vas: ['tint'], depositH: 0.4, steps: [] },
  { id: 'LV-3M9D', name: 'Daniel Nguyen', state: 'NSW', suburb: 'Parramatta', mode: 'Cash', car: ['Toyota', 'Corolla Ascent Sport', 2020, 61200, 'Silver'], price: 22490, deposit: 1000, depositH: 2.3, steps: [] },
  {
    id: 'LV-8RT1', name: 'Chloe Martin', state: 'QLD', suburb: 'Chermside', mode: 'BYO', lender: 'Latitude', car: ['Hyundai', 'Tucson Elite', 2022, 33900, 'White'], price: 36990, deposit: 1000, depositH: 26,
    steps: [[25.5, 'onboard', 'recap', { callOutcome: 'Connected', prefDelivery: 'Pick up at hub', licenceOk: true }], [25, 'onboard', 'done', { recapTemplate: 'Welcome + outstanding amount' }], [24, 'contract', 'recall'], [20, 'payment', 'instalment'], [6, 'rwc', 'wip']],
  },
  {
    id: 'LV-5KX4', name: "Liam O'Brien", state: 'VIC', suburb: 'Box Hill', mode: 'Cars24 finance', lender: 'Plenti', car: ['Volkswagen', 'Tiguan 110TSI', 2019, 72400, 'Grey'], price: 29990, deposit: 1000, vas: ['ew'], depositH: 70,
    promises: ['Replace front tyres', 'Second key'],
    steps: [[69, 'onboard', 'recap', { callOutcome: 'Connected' }], [68, 'onboard', 'done', { recapTemplate: 'Welcome + finance next steps' }], [66, 'contract', 'recall', { recallStatus: 'No active recall' }], [64, 'contract', 'sent', { envelope: 'DS-88213' }], [48, 'payment', 'instalment'], [40, 'rwc', 'wip'], [30, 'rwc', 'fail', { roadworthyItem: 'Yes', delayType: 'Mechanical', panelInfo: 'Front brake pads and discs below limit', reworkEta: '2026-11-18' }]],
  },
  {
    id: 'LV-2PL7', name: 'Mia Patel', state: 'NSW', suburb: 'Ryde', mode: 'Cash', car: ['Kia', 'Sportage SX+', 2022, 28750, 'Blue'], price: 38990, deposit: 1000, vas: ['tint', 'ppf', 'cam'], depositH: 75,
    promises: ['Fix scratch on rear bumper'],
    steps: [[74, 'onboard', 'recap', { callOutcome: 'Connected' }], [73, 'onboard', 'done', { recapTemplate: 'Welcome + outstanding amount' }], [72, 'contract', 'recall', { recallStatus: 'No active recall' }], [70, 'contract', 'sent', { envelope: 'DS-88190' }], [50, 'contract', 'signed'], [60, 'payment', 'instalment'], [40, 'payment', 'final'], [39, 'payment', 'gfd'], [44, 'rwc', 'wip'], [30, 'rwc', 'complete', { rwcNumber: 'RW-2219841', rwcConfirm: true, rwcExpiry: '2027-11-14' }], [8, 'vas', 'booked', { installDate: '2026-11-17' }, 'Ceramic tint']],
  },
  {
    id: 'LV-9HG3', name: 'Noah Wilson', state: 'VIC', suburb: 'Geelong', carState: 'NSW', mode: 'Cash', car: ['Ford', 'Ranger XLT', 2021, 55100, 'Black'], price: 52990, deposit: 1000, depositH: 96,
    steps: [[95, 'onboard', 'recap', { callOutcome: 'Connected' }], [94, 'onboard', 'done', { recapTemplate: 'Welcome + outstanding amount' }], [90, 'transit', 'booked'], [60, 'transit', 'moving', { transitEta: '2026-11-17' }], [93, 'contract', 'recall', { recallStatus: 'No active recall' }], [92, 'contract', 'sent'], [70, 'contract', 'signed'], [92, 'payment', 'instalment'], [50, 'rwc', 'wip']],
  },
  {
    id: 'LV-4WS8', name: 'Isla Brown', state: 'QLD', suburb: 'Southport', mode: 'Cash', car: ['Toyota', 'RAV4 GX Hybrid', 2022, 41000, 'White'], price: 42490, deposit: 1000, depositH: 100,
    promises: ['Full service', 'New wiper blades'],
    steps: [[99, 'onboard', 'recap', { callOutcome: 'Connected' }], [98, 'onboard', 'done', { recapTemplate: 'Welcome + outstanding amount' }], [97, 'contract', 'recall', { recallStatus: 'No active recall' }], [96, 'contract', 'sent'], [80, 'contract', 'signed'], [90, 'payment', 'instalment'], [60, 'payment', 'final'], [59, 'payment', 'gfd'], [80, 'rwc', 'wip'], [70, 'rwc', 'complete', { rwcNumber: 'QLD-55120', rwcConfirm: true, rwcExpiry: '2027-11-12' }], [50, 'rego', 'qld'], [30, 'rego', 'complete', { regoNumber: '512 KXQ', regoExpiry: '2027-11-13' }], [40, 'refurb', 'qc', { promiseDone: true, detailConfirm: true, workLog: 'Full service, wipers replaced' }], [20, 'refurb', 'qcFail', { qcNote: 'Scuff on rear bumper still visible' }]],
  },
  {
    id: 'LV-6CJ5', name: 'Jack Taylor', state: 'NSW', suburb: 'Penrith', mode: 'Cars24 finance', lender: 'Now Finance', car: ['Mitsubishi', 'Outlander ES', 2020, 66300, 'Grey'], price: 26990, deposit: 1000, vas: ['cam'], depositH: 120,
    steps: [[119, 'onboard', 'recap', { callOutcome: 'Connected' }], [118, 'onboard', 'done', { recapTemplate: 'Welcome + finance next steps' }], [117, 'contract', 'recall', { recallStatus: 'No active recall' }], [116, 'contract', 'sent'], [100, 'contract', 'signed'], [110, 'payment', 'instalment'], [100, 'rwc', 'wip'], [96, 'rwc', 'complete', { rwcNumber: 'RW-2219500', rwcConfirm: true, rwcExpiry: '2027-11-11' }], [60, 'rego', 'complete', { regoNumber: 'EVR-21K', regoExpiry: '2027-11-12' }], [70, 'refurb', 'qc', { promiseDone: true, detailConfirm: true }], [40, 'refurb', 'gfd', { qcPassed: true }]],
  },
  {
    id: 'LV-1ZN6', name: 'Grace Lee', state: 'VIC', suburb: 'Richmond', mode: 'Cash', car: ['Honda', 'CR-V VTi', 2021, 39800, 'Silver'], price: 33490, deposit: 1000, vas: ['tint'], depositH: 110,
    steps: [[109, 'onboard', 'recap', { callOutcome: 'Connected' }], [108, 'onboard', 'done', { recapTemplate: 'Welcome + outstanding amount' }], [107, 'contract', 'recall', { recallStatus: 'No active recall' }], [106, 'contract', 'sent'], [90, 'contract', 'signed'], [100, 'payment', 'instalment'], [70, 'payment', 'final'], [69, 'payment', 'gfd'], [95, 'rwc', 'wip'], [90, 'rwc', 'complete', { rwcNumber: 'RW-2219377', rwcConfirm: true, rwcExpiry: '2027-11-11' }], [70, 'rego', 'vic'], [40, 'rego', 'complete', { regoNumber: '1XY 4ZT', regoExpiry: '2027-11-13' }], [50, 'refurb', 'qc', { promiseDone: true, detailConfirm: true }], [5, 'refurb', 'gfd', { qcPassed: true }]],
  },
  {
    id: 'LV-7BY2', name: 'Ethan Walker', state: 'NSW', suburb: 'Chatswood', mode: 'BYO', lender: 'Angle Auto', car: ['Subaru', 'Forester 2.5i-L', 2020, 58900, 'Green'], price: 30990, deposit: 1000, tradeIn: ['2012 Holden Cruze', 4500], depositH: 140,
    steps: [[139, 'onboard', 'recap', { callOutcome: 'Connected' }], [138, 'onboard', 'done', { recapTemplate: 'Welcome + trade-in paperwork' }], [137, 'contract', 'recall', { recallStatus: 'No active recall' }], [136, 'contract', 'sent'], [120, 'contract', 'form4'], [100, 'contract', 'signed'], [130, 'payment', 'instalment'], [90, 'payment', 'final'], [89, 'payment', 'gfd'], [128, 'rwc', 'wip'], [120, 'rwc', 'complete', { rwcNumber: 'RW-2218760', rwcConfirm: true, rwcExpiry: '2027-11-10' }], [80, 'rego', 'complete', { regoNumber: 'FRS-88P', regoExpiry: '2027-11-11' }], [90, 'refurb', 'qc', { promiseDone: true, detailConfirm: true }], [60, 'refurb', 'gfd', { qcPassed: true }], [50, 'slot', 'Today', '2:00 pm'], [2, 'delivery', 'today']],
  },
  {
    id: 'LV-3DF9', name: 'Zoe Harris', state: 'QLD', suburb: 'Toowong', mode: 'Cash', car: ['Mazda', '3 G20 Evolve', 2021, 35500, 'Machine Grey'], price: 25990, deposit: 1000, vas: ['ew', 'tint'], depositH: 170,
    steps: [[169, 'onboard', 'recap', { callOutcome: 'Connected' }], [168, 'onboard', 'done', { recapTemplate: 'Welcome + outstanding amount' }], [167, 'contract', 'recall', { recallStatus: 'No active recall' }], [166, 'contract', 'sent'], [150, 'contract', 'signed'], [160, 'payment', 'instalment'], [130, 'payment', 'final'], [129, 'payment', 'gfd'], [150, 'rwc', 'wip'], [140, 'rwc', 'complete', { rwcNumber: 'QLD-55001', rwcConfirm: true, rwcExpiry: '2027-11-09' }], [120, 'rego', 'qld'], [100, 'rego', 'complete', { regoNumber: '497 JDP', regoExpiry: '2027-11-10' }], [110, 'refurb', 'qc', { promiseDone: true, detailConfirm: true }], [80, 'refurb', 'gfd', { qcPassed: true }], [70, 'slot', 'Sat 14 Nov', '10:30 am'], [30, 'delivery', 'today'], [26, 'delivery', 'delivered', { odometer: '35512', condition: 'All good', signed: true }]],
  },
  {
    id: 'LV-5TR0', name: 'Oliver King', state: 'VIC', suburb: 'Frankston', mode: 'Cars24 finance', lender: 'Plenti', car: ['Nissan', 'X-Trail ST', 2020, 70100, 'White'], price: 27490, deposit: 1000, tradeIn: ['2014 Toyota Yaris', 5200], depositH: 90,
    promises: ['Paint touch-up driver door'],
    steps: [[89, 'onboard', 'recap', { callOutcome: 'Connected' }], [88, 'onboard', 'done', { recapTemplate: 'Welcome + trade-in paperwork' }], [87, 'contract', 'recall', { recallStatus: 'No active recall' }], [86, 'contract', 'sent'], [60, 'contract', 'form4'], [80, 'payment', 'instalment'], [79, 'rwc', 'wip'], [78, 'rwc', 'complete', { rwcNumber: 'RW-2219102', rwcConfirm: true, rwcExpiry: '2027-11-12' }], [60, 'rego', 'vic'], [30, 'rego', 'complete', { regoNumber: '2AB 7QW', regoExpiry: '2027-11-14' }], [10, 'refurb', 'qc', { promiseDone: true, detailConfirm: true, workLog: 'Door touch-up, detail' }]],
  },
  {
    id: 'LV-8LM4', name: 'Ruby Scott', state: 'NSW', suburb: 'Bondi', mode: 'Cash', car: ['Volkswagen', 'Golf 110TSI', 2019, 64300, 'White'], price: 24990, deposit: 1000, depositH: 34,
    steps: [[33.5, 'onboard', 'recap', { callOutcome: 'No answer — SMS sent' }], [32, 'onboard', 'done', { recapTemplate: 'Welcome + outstanding amount' }], [31, 'contract', 'recall']],
  },
  {
    id: 'LV-2QE7', name: 'Lucas Green', state: 'VIC', suburb: 'Bendigo', mode: 'Cash', car: ['Toyota', 'Camry Ascent', 2022, 30200, 'Blue'], price: 34990, deposit: 1000, vas: ['ppf'], depositH: 130,
    steps: [[129, 'onboard', 'recap', { callOutcome: 'Connected' }], [128, 'onboard', 'done', { recapTemplate: 'Welcome + outstanding amount' }], [127, 'contract', 'recall', { recallStatus: 'No active recall' }], [60, 'contract', 'sent', { envelope: 'DS-88001' }], [120, 'payment', 'instalment'], [90, 'payment', 'final'], [89, 'payment', 'gfd'], [118, 'rwc', 'wip'], [110, 'rwc', 'complete', { rwcNumber: 'RW-2218999', rwcConfirm: true, rwcExpiry: '2027-11-10' }], [90, 'rego', 'vic'], [70, 'rego', 'complete', { regoNumber: '1QE 2LG', regoExpiry: '2027-11-12' }], [80, 'refurb', 'qc', { promiseDone: true, detailConfirm: true }], [24, 'refurb', 'gfd', { qcPassed: true }]],
  },
];

const phone = (i: number) => `04${(12 + i * 7) % 100} ${String(300 + i * 37).padStart(3, '0')} ${String(100 + i * 53).slice(0, 3)}`;

export function buildSeed(now: number): Order[] {
  return SEEDS.map((s, i) => {
    const carState = s.carState || s.state;
    const o = createOrder({
      id: s.id,
      apptId: String(23527504837504 + i * 1934772311),
      customer: { name: s.name, phone: phone(i), email: s.name.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com', state: s.state, suburb: s.suburb },
      car: { make: s.car[0], model: s.car[1], year: s.car[2], km: s.car[3], colour: s.car[4], vin: 'JM0' + (s.id.replace(/\W/g, '') + 'X8812345').slice(0, 14).toUpperCase(), hub: HUBS[carState], hubState: carState },
      paymentMode: s.mode,
      lender: s.lender,
      price: s.price,
      depositPaid: s.deposit,
      vas: (s.vas || []).map((k) => VAS[k]),
      promises: s.promises || [],
      tradeIn: s.tradeIn ? { car: s.tradeIn[0], value: s.tradeIn[1] } : undefined,
      deliveryMode: s.home ? 'Home delivery' : 'Pick up',
      interstate: carState !== s.state,
      depositAt: now - s.depositH * HOUR,
    });
    // replay in time order so rule-created tasks exist before they are moved
    const steps = [...s.steps].sort((a, b) => b[0] - a[0]);
    for (const st of steps) {
      const at = now - st[0] * HOUR;
      if (st[1] === 'slot') { bookSlot(o, st[2] as string, st[3] as string, 'rm', at); continue; }
      if (st[1] === 'bypass') { setBypass(o, true, at); continue; }
      const [, j, to, fields, item] = st as [number, JourneyId, string, Record<string, string | boolean>?, string?];
      const t = task(o, j, item);
      if (!t) continue;
      Object.assign(t.fields, fields || {});
      move(o, t, to, JOURNEYS[j].persona, at);
    }
    return o;
  });
}
