import { StateMachine } from './ui/state-machine';
import { SettingsScreen } from './ui/settings';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(
      (registration) => console.log('SW registered: ', registration.scope),
      (err) => console.warn('SW registration info: ', err)
    );
  });
}

const settings = new SettingsScreen();
const stateMachine = new StateMachine();

console.log("EchoSight App Initialised.");
