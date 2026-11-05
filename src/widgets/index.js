// Registro de widgets. Para criar um novo, adicione um arquivo nesta pasta e importe aqui.
import capture from './capture.js';
import brain from './brain.js';
import ask from './ask.js';
import reminders from './reminders.js';
import weather from './weather.js';
import quotes from './quotes.js';
import shortcuts from './shortcuts.js';
import clock from './clock.js';
import calc from './calc.js';
import browsing from './browsing.js';

export const WIDGETS = Object.fromEntries([capture, reminders, brain, ask, weather, quotes, clock, calc, browsing, shortcuts].map((w) => [w.id, w]));
