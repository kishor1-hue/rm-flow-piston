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
