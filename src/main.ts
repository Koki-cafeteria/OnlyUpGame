import { Game } from './game/Game';

// Prevent context menu and default touch behaviors on mobile
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

window.onload = () => {
  new Game();
};
