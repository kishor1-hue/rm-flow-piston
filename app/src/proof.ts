// Dummy proof-of-payment screenshot: a banking-app transfer receipt drawn on a canvas and returned as a PNG data URL.
import { money, type Order } from './engine';

const cache = new Map<string, string>();

export function proofPng(o: Order): string {
  const key = o.id + o.depositPaid;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = 390, H = 700, S = 2;
  const cv = document.createElement('canvas');
  cv.width = W * S; cv.height = H * S;
  const g = cv.getContext('2d')!;
  g.scale(S, S);
  const font = (w: number, px: number) => `${w} ${px}px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  const text = (s: string, x: number, y: number, f: string, c: string, align: CanvasTextAlign = 'left') => { g.font = f; g.fillStyle = c; g.textAlign = align; g.fillText(s, x, y); };
  const rrect = (x: number, y: number, w: number, h: number, r: number, c: string) => { g.beginPath(); g.roundRect(x, y, w, h, r); g.fillStyle = c; g.fill(); };

  // page + status bar
  g.fillStyle = '#F2F4F7'; g.fillRect(0, 0, W, H);
  text('9:41', 28, 30, font(600, 15), '#111');
  text('5G  ▮▮▮  85%', W - 26, 30, font(600, 12), '#111', 'right');
  // app header
  text('‹', 22, 78, font(400, 30), '#0B5CAD');
  text('Payment receipt', W / 2, 74, font(600, 17), '#111', 'center');
  text('Share', W - 22, 74, font(500, 15), '#0B5CAD', 'right');

  // success card
  rrect(16, 100, W - 32, 210, 16, '#FFFFFF');
  g.beginPath(); g.arc(W / 2, 146, 24, 0, Math.PI * 2); g.fillStyle = '#16A34A'; g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(W / 2 - 10, 147); g.lineTo(W / 2 - 3, 154); g.lineTo(W / 2 + 11, 139); g.stroke();
  text('Transfer successful', W / 2, 200, font(600, 16), '#16A34A', 'center');
  text(money(o.depositPaid) + '.00', W / 2, 248, font(700, 38), '#111', 'center');
  const d = new Date(o.depositAt);
  const when = d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  text(when, W / 2, 280, font(400, 13), '#6B7280', 'center');

  // detail rows
  const seed = [...o.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
  const acct = String(10000000 + (seed % 89999999)).slice(0, 8);
  const rows: [string, string][] = [
    ['From', o.customer.name],
    ['', `BSB 063-${String(100 + (seed % 899))}  ·  Acc ••••${acct.slice(-4)}`],
    ['To', 'CARS24 AUS PTY LTD'],
    ['', 'BSB 062-000  ·  Acc 1094 5521'],
    ['Reference', o.id],
    ['Description', `Deposit ${o.car.year} ${o.car.make} ${o.car.model}`.slice(0, 34)],
    ['Payment type', 'Osko / PayID fast payment'],
    ['Receipt no.', 'N' + String(seed).padStart(10, '0').slice(0, 10)],
  ];
  rrect(16, 326, W - 32, 322, 16, '#FFFFFF');
  let y = 362;
  rows.forEach(([k, v], i) => {
    if (k) {
      if (i > 0) { g.fillStyle = '#EEF0F3'; g.fillRect(32, y - 26, W - 64, 1); }
      text(k, 32, y, font(400, 13), '#6B7280');
      text(v, W - 32, y, font(600, 14), '#111', 'right');
      y += 22;
    } else {
      text(v, W - 32, y - 2, font(400, 12), '#6B7280', 'right');
      y += 24;
    }
    y += k && rows[i + 1]?.[0] === '' ? 0 : 20;
  });
  text('Funds usually arrive within 60 seconds.', W / 2, H - 22, font(400, 11), '#9CA3AF', 'center');

  const url = cv.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

// Dummy driver's licence (front / back) for the licence check. Generic layout with a SAMPLE mark, not a real state design.
const TINT: Record<string, [string, string]> = { NSW: ['#DCEBFA', '#1E4E8C'], VIC: ['#E3F1E6', '#1F6B3A'], QLD: ['#F6E7EF', '#7A1F4E'] };
export function dlPng(o: Order, side: 'front' | 'back'): string {
  const key = `dl-${o.id}-${o.dl.state}-${side}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = 428, H = 270, S = 2;
  const cv = document.createElement('canvas');
  cv.width = W * S; cv.height = H * S;
  const g = cv.getContext('2d')!;
  g.scale(S, S);
  const font = (w: number, px: number) => `${w} ${px}px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  const text = (s: string, x: number, y: number, f: string, c: string, align: CanvasTextAlign = 'left') => { g.font = f; g.fillStyle = c; g.textAlign = align; g.fillText(s, x, y); };
  const [bg, ink] = TINT[o.dl.state] || TINT.NSW;
  // photo backdrop: the card lying on a desk
  g.fillStyle = '#C9CDD3'; g.fillRect(0, 0, W, H);
  g.save(); g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 14; g.shadowOffsetY = 4;
  g.beginPath(); g.roundRect(14, 14, W - 28, H - 28, 14); g.fillStyle = bg; g.fill(); g.restore();
  g.save(); g.beginPath(); g.roundRect(14, 14, W - 28, H - 28, 14); g.clip();
  for (let i = -H; i < W; i += 14) { g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(i, 14); g.lineTo(i + H, H); g.stroke(); }
  g.fillStyle = ink; g.fillRect(14, 14, W - 28, 34);
  const [first, ...rest] = o.customer.name.toUpperCase().split(' ');
  if (side === 'front') {
    text(`${o.dl.state} · DRIVER LICENCE`, 28, 37, font(700, 14), '#fff');
    text('CLASS C', W - 28, 37, font(600, 11), '#fff', 'right');
    // photo
    g.fillStyle = '#B8C0CC'; g.beginPath(); g.roundRect(28, 62, 96, 122, 8); g.fill();
    g.fillStyle = '#8E98A8'; g.beginPath(); g.arc(76, 108, 22, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(76, 172, 38, 26, 0, Math.PI, 0); g.fill();
    const row = (k: string, v: string, y: number) => { text(k, 138, y, font(500, 9), '#5B6475'); text(v, 138, y + 15, font(700, 14), '#111'); };
    row('NAME', `${rest.join(' ')} ${first}`.trim(), 70);
    row('ADDRESS', `${(3 + o.id.charCodeAt(4) % 90)} SAMPLE ST, ${o.customer.suburb.toUpperCase()}`, 104);
    row('LICENCE NO.', o.dl.number, 138);
    text('EXPIRY', 300, 138, font(500, 9), '#5B6475'); text(o.dl.expiry, 300, 153, font(700, 14), '#111');
    text('DATE OF BIRTH', 138, 182, font(500, 9), '#5B6475'); text(`1${o.id.charCodeAt(3) % 10}/0${1 + (o.id.charCodeAt(4) % 9)}/199${o.id.charCodeAt(5) % 10}`, 138, 197, font(700, 14), '#111');
    g.strokeStyle = '#333'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(30, 222); g.bezierCurveTo(50, 200, 70, 236, 92, 214); g.bezierCurveTo(104, 204, 112, 226, 124, 216); g.stroke();
    text('signature', 28, 238, font(400, 8), '#5B6475');
  } else {
    text('CONDITIONS / ENDORSEMENTS', 28, 37, font(700, 12), '#fff');
    text('Conditions: NIL', 28, 72, font(600, 13), '#111');
    text(`Card number: ${o.dl.state}${o.dl.number.split('').reverse().join('')}`, 28, 94, font(500, 12), '#333');
    text(`Issued in ${o.dl.state}. Change of address must be reported to the issuing state.`, 28, 114, font(400, 10), '#444');
    for (let x = 28, k = 0; x < W - 40; x += 3, k++) { const w = (o.dl.number.charCodeAt(k % 8) + k) % 3 === 0 ? 2 : 1; g.fillStyle = '#111'; g.fillRect(x, 140, w, 60); }
    text(`${o.dl.state}-${o.dl.number}-${o.dl.expiry.replace('/', '')}`, W / 2, 218, font(500, 10), '#333', 'center');
  }
  g.restore();
  g.save(); g.translate(W / 2, H / 2); g.rotate(-0.32); text('SAMPLE', 0, 16, font(800, 52), 'rgba(200,30,30,.16)', 'center'); g.restore();
  const url = cv.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
