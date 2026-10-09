import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translate } from '../src/i18n.js';

test('static labels use formal Indonesian', () => {
  assert.equal(translate('Connect wallet'), 'Hubungkan dompet');
  assert.equal(translate('Buy Sol Coins'), 'Beli Sol Coin');
  assert.equal(translate('Switch to Sepolia'), 'Beralih ke Sepolia');
});

test('numbers, dates and test money follow Indonesian conventions', () => {
  assert.equal(translate('Rp1,234,567'), 'Rp1.234.567');
  assert.equal(translate('1.0%'), '1,0%');
  assert.equal(translate('0.0001 test ETH'), '0,0001 ETH uji coba');
  assert.equal(translate('September 2026'), 'September 2026');
  assert.equal(translate('Last published: October 2026.'), 'Terakhir diterbitkan: Oktober 2026.');
  assert.equal(translate('9 Oct 2026, 14:00 UTC'), '9 Okt 2026, 14:00 UTC');
});

test('hex strings and IP addresses are not reformatted', () => {
  assert.equal(translate('0x1234…abcd'), '0x1234…abcd');
  assert.equal(translate('http://127.0.0.1:5173/'), 'http://127.0.0.1:5173/');
});

test('strings built from parts are translated', () => {
  assert.equal(translate('Buy 10 Sol Coins'), 'Beli 10 Sol Coin');
  assert.equal(translate('Alice bought 5 Sol Coins'), 'Alice membeli 5 Sol Coin');
  assert.equal(translate('You sent 2 Sol Coins to Budi'), 'Anda mengirim 2 Sol Coin kepada Budi');
  assert.equal(translate('Purchase · 5 min ago'), 'Pembelian · 5 menit lalu');
  assert.equal(translate('3 days overdue'), 'Terlambat 3 hari');
  assert.equal(translate('Opens in under a day'), 'Dibuka dalam kurang dari sehari');
});

test('several sentences in one string are translated one by one', () => {
  assert.equal(
    translate("Your next payout arrives when the operator publishes the first monthly report. We'll show it here as soon as it lands."),
    'Pembayaran berikutnya Anda akan tiba ketika operator menerbitkan laporan bulanan pertama. Kami akan menampilkannya di sini segera setelah tersedia.');
  assert.equal(
    translate('2 Sol Coins are now with Budi. Income you earned before sending stays with you.'),
    '2 Sol Coin kini berada pada Budi. Pendapatan yang Anda peroleh sebelum mengirim tetap menjadi milik Anda.');
});

test('surrounding whitespace is kept, but not before a continuing sentence', () => {
  assert.equal(translate(' of the project'), ' dari proyek');
  assert.equal(translate(' late. Purchases stay blocked until you publish it.'), '. Pembelian tetap diblokir sampai Anda menerbitkannya.');
});

test('unknown text is left alone', () => {
  assert.equal(translate('Something nobody translated'), 'Something nobody translated');
  assert.equal(translate('   '), '   ');
});
