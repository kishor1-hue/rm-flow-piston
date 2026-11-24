import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Journey } from './journey/Journey'
import type { RmStep } from './RmFlow'

// #app… is the live Leadverse app; everything else is the journey viewer (PISTON structure), which opens first.
function Root() {
  const [hash, setHash] = useState(location.hash);
  const [start, setStart] = useState<{ id: string; step: RmStep } | undefined>();
  useEffect(() => { const f = () => setHash(location.hash); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  if (hash.startsWith('#app')) return <App start={start} toJourney={() => { location.hash = '#cash-V1'; }} />;
  return <Journey openApp={(id, step) => { setStart({ id, step }); location.hash = '#app'; }} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
