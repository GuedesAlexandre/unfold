import { createRoot } from 'react-dom/client';
import './theme.css';
import { App } from './App';

// Réveille le serveur s'il est en veille (hébergement gratuit), sans attendre la première exécution.
fetch('/api/health').catch(() => {});

createRoot(document.getElementById('root')!).render(<App />);
