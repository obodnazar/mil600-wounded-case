import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './app/App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/components.css';
import './styles/panels/patient.css';
import './styles/panels/staff.css';
import './styles/panels/analytics.css';
import './styles/panels/dev.css';
import './styles/panels/welcome.css';

const root = document.getElementById('root');
if (!root) throw new Error('Кореневий елемент #root не знайдено');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
