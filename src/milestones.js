import { keccak256, toUtf8Bytes } from 'ethers';

export const milestoneNames = ['Equipment purchase', 'Installation complete', 'System handover'];
const portions = [30, 40, 30];
const statuses = ['Not submitted', 'Awaiting review', 'Changes requested', 'Approved'];
const samples = [
  'DEMO ONLY — Equipment purchase. Sample purchase order SOL-001: 10 kWp panel package and inverter; supplier quote reviewed; delivery planned. Fictional records, no real supplier or equipment.',
  'DEMO ONLY — Installation complete. Sample inspection SOL-002: panels mounted, inverter installed, wiring and safety checks recorded. Fictional inspection, no actual site visit.',
  'DEMO ONLY — System handover. Sample handover SOL-003: commissioning checks recorded, operating instructions handed over, project accepted. Fictional acceptance, no authenticated engineer or utility.',
];

export async function readMilestones(contract, provider) {
  const block = await provider.getBlockNumber(), opts = { blockTag: block };
  const [reviewer, approved, raised, released, available, held, ...rows] = await Promise.all([
    contract.milestoneReviewer(opts), contract.approvedMilestones(opts), contract.totalSaleProceeds(opts),
    contract.releasedSaleProceeds(opts), contract.availableSaleProceeds(opts), contract.saleProceeds(opts),
    ...[0, 1, 2].map(i => contract.milestones(i, opts)),
  ]);
  if (held !== raised - released || available > held) throw new Error('Funding totals do not match. Refresh before continuing.');
  return { reviewer, approved: Number(approved), raised, released, available, held,
    rows: rows.map(r => ({ status: Number(r.status), revision: Number(r.revision), hash: r.evidenceHash, record: r.evidenceReference, note: r.reviewNote })) };
}

export function createMilestoneScreen({ $, esc, eth, getContext, transact, notify, setActionButton, chooseWallet }) {
  let formKey = '';
  const context = () => { const c = getContext(); return { ...c, m: c.state?.milestones }; };
  $('#milestone-sample').onclick = () => {
    const { m } = context();
    if (m?.approved < 3) $('#milestone-record').value = samples[m.approved];
  };
  $('#milestone-submit-form').onsubmit = async event => {
    event.preventDefault();
    const { m, operator } = context();
    if (!m || !operator) return;
    const record = $('#milestone-record').value.trim();
    if (!record || toUtf8Bytes(record).length > 512) return notify(new Error('Enter a supporting statement of 1–512 bytes. Use the labeled sample for this demo.'));
    await transact('milestone-submit', `Request review: ${milestoneNames[m.approved]}`,
      c => c.submitMilestone(m.approved, keccak256(toUtf8Bytes(record)), record),
      () => 'Submitted. Funding stays locked until the separate reviewer approves.');
  };
  $('#milestone-demo-operator').onclick = () => chooseWallet(0).catch(notify);
  $('#milestone-demo-reviewer').onclick = () => chooseWallet(3).catch(notify);
  $('#milestone-review-confirm').onchange = () => render();
  function review(approve) {
    const { m, reviewer } = context();
    if (!m || !reviewer || !$('#milestone-review-confirm').checked) return;
    const stage = m.approved, row = m.rows[stage], note = $('#milestone-review-note').value.trim();
    if (toUtf8Bytes(note).length > 280 || (!approve && !note)) return notify(new Error('Explain the changes needed in 1–280 bytes.'));
    transact('milestone-review', approve ? `Approve ${milestoneNames[stage]}` : 'Request changes',
      c => c.reviewMilestone(stage, row.revision, row.hash, approve, note),
      () => approve ? 'Approved. The operator can withdraw the newly available funding.' : 'Changes requested. This stage’s funding stays locked.');
  }
  $('#milestone-approve').onclick = () => review(true);
  $('#milestone-changes').onclick = () => review(false);
  function render() {
    const { m, supported, operator, reviewer, local, address, wrong, busy } = context();
    $('#milestone-unavailable').hidden = Boolean(m);
    $('#milestone-unavailable').textContent = supported ? 'Loading funding stages…' : 'Milestone funding controls are not active on this deployment. Use the version 4 Sepolia project or the local blockchain demo. Older contracts and the browser simulation do not support this flow.';
    $('#milestone-content').hidden = !m;
    if (!m) return;
    $('#milestone-role').textContent = operator ? 'You are the operator. Submit records for review.' : reviewer ? 'You are the milestone reviewer. Check the records before deciding.' : address ? 'You can view all funding stages and decisions.' : 'Connect a wallet to submit or review. Anyone can view progress.';
    $('#milestone-reviewer-address').textContent = m.reviewer;
    $('#milestone-demo-roles').hidden = !local;
    $('#milestone-demo-operator').disabled = Boolean(busy);
    $('#milestone-demo-reviewer').disabled = Boolean(busy);
    $('#milestone-totals').innerHTML = `<p><strong>Raised:</strong> ${eth(m.raised)}<br><strong>Already released:</strong> ${eth(m.released)}<br><strong>Available to withdraw:</strong> ${eth(m.available)}<br><strong>Still locked:</strong> ${eth(m.held - m.available)}</p>`;
    const cards = m.rows.map((row, i) => `<article class="card milestone-stage"><p class="overline">Stage ${i + 1} · ${portions[i]}%</p><h2>${milestoneNames[i]}</h2><p><strong>${statuses[row.status]}</strong>${row.revision ? ` · Submission ${row.revision}` : ''}</p>${row.record ? `<p class="milestone-record-text">${esc(row.record)}</p><details><summary>Record fingerprint</summary><code class="evidence-hash">${esc(row.hash)}</code><p>This fingerprint identifies the submitted text. It does not authenticate a supplier, inspection, or real-world work.</p></details>` : '<p>The operator must submit supporting records for this stage.</p>'}${row.note ? `<p><strong>Reviewer’s note:</strong> ${esc(row.note)}</p>` : ''}</article>`).join('');
    if ($('#milestone-stages').innerHTML !== cards) $('#milestone-stages').innerHTML = cards;
    const next = m.rows[m.approved], pending = next?.status === 1;
    const key = `${address}:${m.approved}:${next?.revision}:${next?.status}`;
    if (key !== formKey) {
      $('#milestone-review-confirm').checked = false;
      $('#milestone-review-note').value = '';
      $('#milestone-record').value = next?.status === 2 ? next.record : '';
      formKey = key;
    }
    $('#milestone-submit-form').hidden = !operator || !next || pending;
    $('#milestone-request-title').textContent = next ? `Request review: ${milestoneNames[m.approved]}` : 'All stages approved';
    $('#milestone-review-form').hidden = !reviewer || !pending;
    $('#milestone-review-title').textContent = pending ? `Review: ${milestoneNames[m.approved]}` : 'No pending review';
    $('#milestone-review-evidence').textContent = pending ? next.record : '';
    $('#milestone-waiting').textContent = !next ? 'All three stages are approved.' : pending ? 'The operator cannot approve this request. The designated reviewer must check it.' : reviewer ? 'Waiting for the operator to submit this stage.' : '';
    setActionButton($('#milestone-submit'), 'milestone-submit', 'Submit for review', operator && Boolean(next) && !pending && !wrong);
    const ready = reviewer && pending && $('#milestone-review-confirm').checked && !wrong;
    setActionButton($('#milestone-approve'), 'milestone-review', 'Approve this stage', ready);
    setActionButton($('#milestone-changes'), 'milestone-review', 'Request changes', ready);
  }
  return { render };
}
