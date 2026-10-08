// bob-main.jsx — the playground entry for the drop-in component.
// Mounts ONLY src/components/Bob.jsx (no demo UI), so the component can be
// verified in isolation: `npm run dev` then open /bob.html.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Bob from './components/Bob.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Bob size={340} />
  </StrictMode>,
)
