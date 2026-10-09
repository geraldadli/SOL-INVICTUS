// Language switch (English / Bahasa Indonesia).
//
// The app writes English straight into the DOM from many places. Instead of threading a translate call
// through each of them, this module translates text nodes and a few attributes in place and keeps doing
// so as the app re-renders (MutationObserver). The English original of every translated node is kept, so
// switching back restores it exactly. The dictionary and rules live in i18n-id.js.
import { dictionary, rules, longMonths, shortMonths } from './i18n-id.js';

const STORAGE_KEY = 'sol-invictus-language';
const LANGUAGES = ['en', 'id'];
const ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt'];
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);
const PUNCTUATION_START = /^[.,;:!?]/;

const exact = new Map(dictionary);
const cache = new Map();
const nodeState = new WeakMap(); // Text node -> { en, id }
const attributeState = new WeakMap(); // Element -> Map(attribute -> { en, id })
let language = 'en';
let observer;

function readStoredLanguage() {
  try { const stored = localStorage.getItem(STORAGE_KEY); return LANGUAGES.includes(stored) ? stored : 'en'; } catch { return 'en'; }
}
function storeLanguage(value) {
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* A blocked store only means the choice is not remembered. */ }
}

// Indonesian writes 1.234,5 where English writes 1,234.5. Hex strings and IP addresses never match.
const NUMBER = /(?<![\d.,])(\d+(?:,\d{3})+(?:\.\d+)?|\d+\.\d+)(?!\d|\.\d)/g;
const swapSeparators = number => number.replace(/[,.]/g, c => c === ',' ? '.' : ',');

// Wording that appears inside already-built English sentences (dates, units, test money).
function localize(text) {
  return text
    .replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)(?=\s\d{4}\b)/g, m => longMonths[m])
    .replace(/\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\b/g, (_, day, m) => `${day} ${shortMonths[m]}`)
    .replace(/\btest ETH\b/g, 'ETH uji coba')
    .replace(/\bsimulated ETH\b/g, 'ETH simulasi')
    .replace(/(\d[\d,]*) Sol Coins?\b/g, '$1 Sol Coin')
    .replace(/(\d[\d,]*) coins?\b/g, '$1 koin')
    .replace(/(\d[\d,]*) reports?\b/g, '$1 laporan')
    .replace(/(\d[\d,]*) investors?\b/g, '$1 investor')
    .replace(/(\d[\d,]*) block confirmations?\b/g, '$1 konfirmasi blok')
    .replace(/(\d+) min ago\b/g, '$1 menit lalu')
    .replace(/(\d+) hours? ago\b/g, '$1 jam lalu')
    .replace(/(\d+) days? ago\b/g, '$1 hari lalu')
    .replace(/(\d+) days?\b/g, '$1 hari')
    .replace(NUMBER, swapSeparators);
}

function translateCore(text) {
  const direct = exact.get(text);
  if (direct !== undefined) return direct;
  for (const [pattern, build] of rules) {
    const match = pattern.exec(text);
    if (match) return build(translateCore, ...match.slice(1));
  }
  if (text.includes(' · ')) {
    const parts = text.split(' · ');
    const translated = parts.map(translateCore);
    return translated.some((part, i) => part !== parts[i]) ? translated.join(' · ') : text;
  }
  const pieces = text.split(/(?<=[.!?])(\s+)/);
  if (pieces.length > 1) {
    const translated = pieces.map((piece, i) => i % 2 ? piece : translateCore(piece));
    return translated.some((piece, i) => piece !== pieces[i]) ? translated.join('') : text;
  }
  return text;
}

export function translate(raw) {
  const [, lead, body, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
  if (!body) return raw;
  const key = body.replace(/\s+/g, ' ');
  let result = cache.get(key);
  if (result === undefined) {
    if (cache.size > 3000) cache.clear();
    result = localize(translateCore(key));
    cache.set(key, result);
  }
  // A sentence that continues after inline markup starts with punctuation: do not keep a space before it.
  return (PUNCTUATION_START.test(result) ? '' : lead) + result + trail;
}

function translateText(node) {
  const value = node.nodeValue, state = nodeState.get(node);
  if (state && (value === state.id || value === state.en)) {
    if (language === 'id' && value === state.en && state.id !== value) node.nodeValue = state.id;
    else if (language === 'en' && value === state.id) node.nodeValue = state.en;
    return;
  }
  // The app wrote new English text into this node.
  if (language === 'en') { nodeState.delete(node); return; }
  const id = translate(value);
  nodeState.set(node, { en: value, id });
  if (id !== value) node.nodeValue = id;
}

function translateAttribute(element, name) {
  const value = element.getAttribute(name);
  if (value === null) return;
  let states = attributeState.get(element);
  const state = states?.get(name);
  if (state && (value === state.id || value === state.en)) {
    if (language === 'id' && value === state.en && state.id !== value) element.setAttribute(name, state.id);
    else if (language === 'en' && value === state.id) element.setAttribute(name, state.en);
    return;
  }
  if (language === 'en') { states?.delete(name); return; }
  const id = translate(value);
  if (!states) attributeState.set(element, states = new Map());
  states.set(name, { en: value, id });
  if (id !== value) element.setAttribute(name, id);
}

const isDescription = element => element.localName === 'meta' && element.name === 'description';

function translateElementAttributes(element) {
  for (const name of ATTRIBUTES) if (element.hasAttribute(name)) translateAttribute(element, name);
  if (isDescription(element)) translateAttribute(element, 'content');
}

function translateTree(root) {
  if (root.nodeType === Node.TEXT_NODE) { if (!SKIPPED_TAGS.has(root.parentElement?.tagName)) translateText(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) {
    if (SKIPPED_TAGS.has(root.tagName)) return;
    translateElementAttributes(root);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.nodeType === Node.ELEMENT_NODE && SKIPPED_TAGS.has(node.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) translateText(node); else translateElementAttributes(node);
  }
}

function onMutations(records) {
  for (const record of records) {
    if (record.type === 'childList') record.addedNodes.forEach(translateTree);
    else if (record.type === 'characterData') { if (!SKIPPED_TAGS.has(record.target.parentElement?.tagName)) translateText(record.target); }
    else if (record.type === 'attributes' && (record.attributeName !== 'content' || isDescription(record.target))) translateAttribute(record.target, record.attributeName);
  }
}

function syncToggle() {
  document.documentElement.lang = language;
  document.querySelectorAll('[data-lang]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.lang === language)));
}

export function getLanguage() { return language; }

export function setLanguage(next) {
  if (!LANGUAGES.includes(next)) return;
  language = next;
  storeLanguage(next);
  // Changing the text and attributes below would otherwise be reported back to the observer.
  observer.takeRecords();
  translateTree(document.documentElement);
  observer.takeRecords();
  syncToggle();
}

function start() {
  language = readStoredLanguage();
  observer = new MutationObserver(onMutations);
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTES, 'content'] });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-lang]');
    if (button) setLanguage(button.dataset.lang);
  });
  syncToggle();
  if (language !== 'en') translateTree(document.documentElement);
}

if (typeof document !== 'undefined') start();
