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
import traffic from './traffic.js';
import photos from './photos.js';
import imageLibrary from './image-library.js';
import habits from './habits.js';
import news from './news.js';
import focus from './focus.js';
import agenda from './agenda.js';
import clipboard from './clipboard.js';
import email from './email.js';
import mood from './mood.js';
import network from './network.js';

export const WIDGETS = Object.fromEntries([capture, focus, reminders, agenda, email, clipboard, brain, ask, weather, quotes, clock, calc, browsing, traffic, photos, imageLibrary, habits, mood, network, news, shortcuts].map((w) => [w.id, w]));
