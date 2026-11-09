// Teste num Firefox de verdade (roda no CI do GitHub, que tem Firefox e geckodriver).
// Instala o pacote do Firefox como extensão temporária e usa as páginas como uma pessoa usaria.
// Rodar localmente: ./scripts/build.sh && npm run test:firefox  (precisa do Firefox 140+ instalado)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const ID = 'neurotab@mpjbiologo.github.io';
const UUID = '6f1c2e9a-3b4d-4e5f-8a7b-1c2d3e4f5a6b';
const XPI = fileURLToPath(new URL('../../dist/neurotab-firefox.zip', import.meta.url));
const BASE = `moz-extension://${UUID}/`;
let driver;

// Lê o chrome.storage da extensão a partir de uma página dela.
const storage = (key) => driver.executeAsyncScript((k, done) => { browser.storage.local.get(k).then((r) => done(r[k] ?? null)); }, key);
// Erros de JavaScript da página (coletados por um ouvinte instalado logo após abrir).
const errors = () => driver.executeScript('return window.__ffErrors || []');
// O Firefox não deixa o WebDriver navegar direto para moz-extension://. Abrimos a aba pela interface
// do próprio Firefox (contexto privilegiado), como se a pessoa tivesse aberto, e então controlamos a página.
async function open(path) {
  await driver.setContext(firefox.Context.CHROME);
  await driver.executeScript('gBrowser.selectedTab = gBrowser.addTrustedTab(arguments[0]);', BASE + path);
  await driver.setContext(firefox.Context.CONTENT);
  const handles = await driver.getAllWindowHandles();
  await driver.switchTo().window(handles[handles.length - 1]);
  await driver.wait(async () => (await driver.getCurrentUrl()).startsWith(BASE), 10000);
  await driver.executeScript("window.__ffErrors = []; addEventListener('error', (e) => __ffErrors.push(e.message)); addEventListener('unhandledrejection', (e) => __ffErrors.push(String(e.reason?.message || e.reason)));");
  await driver.sleep(1500);
}

before(async () => {
  assert.ok(existsSync(XPI), 'gere o pacote antes: ./scripts/build.sh');
  const opts = new firefox.Options()
    .addArguments('-headless')
    .setPreference('extensions.webextensions.uuids', JSON.stringify({ [ID]: UUID }))
    .setPreference('intl.locale.requested', 'pt-BR')
    .setPreference('intl.accept_languages', 'pt-BR');
  // --allow-system-access: permite usar o contexto privilegiado para abrir as páginas da extensão.
  const service = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(opts).setFirefoxService(service).build();
  await driver.installAddon(XPI, true);
  await driver.sleep(1500);
});

after(async () => { await driver?.quit(); });

test('Firefox: versão e consentimento de dados declarados', async () => {
  const caps = await driver.getCapabilities();
  console.log('Firefox', caps.get('browserVersion'));
  await open('src/options.html');
  const info = await driver.executeAsyncScript((done) => { browser.permissions.getAll().then((p) => done({ data: p.data_collection || null, version: browser.runtime.getManifest().version })); });
  console.log('permissões de dados concedidas:', JSON.stringify(info));
  assert.match(info.version, /^\d+\.\d+\.\d+$/);
});

test('Firefox: nova aba abre com relógio e widgets', async () => {
  await open('src/newtab.html');
  const clock = await driver.findElement(By.id('clock')).getText();
  assert.match(clock, /\d{1,2}:\d{2}/);
  const widgets = await driver.findElements(By.css('.widget'));
  assert.ok(widgets.length >= 3, `widgets: ${widgets.length}`);
  assert.deepEqual(await errors(), []);
});

test('Firefox: Captura rápida salva uma nota com lembrete', async () => {
  await open('src/newtab.html');
  const ta = await driver.wait(until.elementLocated(By.css('.widget[data-id=capture] textarea')), 5000);
  await ta.sendKeys('me lembre amanhã às 9h de testar no Firefox');
  await driver.findElement(By.css('.widget[data-id=capture] .btn.primary')).click();
  await driver.sleep(800);
  const brain = await storage('nt_brain');
  const it = brain.find((i) => /testar no Firefox/.test(i.text));
  assert.ok(it, 'nota salva');
  assert.ok(it.remindAt > Date.now(), 'lembrete definido');
  const alarms = await driver.executeAsyncScript((done) => { browser.alarms.getAll().then((a) => done(a.map((x) => x.name))); });
  assert.ok(alarms.some((n) => n.includes(it.id) || n.startsWith('rem')), `alarme criado: ${alarms.join(', ')}`);
  assert.deepEqual(await errors(), []);
});

test('Firefox: configurações abrem todas as abas; permissões e migração', async () => {
  await open('src/options.html');
  const tabs = await driver.findElements(By.css('[data-tab]'));
  for (const tab of tabs) await tab.click();
  const perm = await driver.findElement(By.id('permList')).getText();
  assert.match(perm, /Cotações/);
  const meta = await storage('nt_meta');
  assert.ok(meta?.schema >= 2, 'esquema de dados registrado');
  // a palavra de ativação some no Firefox (sem reconhecimento de voz)
  assert.equal(await driver.findElement(By.id('wakeRow')).isDisplayed(), false);
  assert.deepEqual(await errors(), []);
});

test('Firefox: popup e janela de permissão abrem', async () => {
  await open('src/popup.html');
  assert.deepEqual(await errors(), []);
  await open('src/grant.html?src=' + encodeURIComponent('https://example.com/a.png'));
  assert.equal(await driver.findElement(By.id('host')).getText(), 'example.com');
  assert.deepEqual(await errors(), []);
});
