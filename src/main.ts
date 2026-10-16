import { StateMachine } from './ui/state-machine';
import { SettingsScreen } from './ui/settings';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/src/sw.ts').then(
      (registration) => console.log('SW registered: ', registration.scope),
      (err) => console.error('SW registration failed: ', err)
    );
  });
}

const settings = new SettingsScreen();
const stateMachine = new StateMachine();

console.log("Medicine Reader App Initialised.");
