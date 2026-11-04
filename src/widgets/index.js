// Registro de widgets. Para criar um novo, adicione um arquivo nesta pasta e importe aqui.
import capture from './capture.js';
import brain from './brain.js';
import ask from './ask.js';
import reminders from './reminders.js';
import weather from './weather.js';
import quotes from './quotes.js';
import shortcuts from './shortcuts.js';

export const WIDGETS = Object.fromEntries([capture, reminders, brain, ask, weather, quotes, shortcuts].map((w) => [w.id, w]));
