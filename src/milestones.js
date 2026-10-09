import { keccak256, toUtf8Bytes } from 'ethers';

export const milestoneNames = ['Equipment purchase', 'Installation complete', 'System handover'];
const portions = [30, 40, 30];
const needs = [
  'Records showing the panels and inverter have been ordered.',
  'Records showing the system is mounted, wired and safety-checked.',
  'Records showing the system is commissioned and handed over.',
];
const statuses = ['Not submitted', 'Awaiting review', 'Changes requested', 'Approved'];
const tones = ['muted', 'warn', 'bad', 'ok'];
const samples = [
  'DEMO ONLY — Equipment purchase. Sample purchase order SOL-001: 10 kWp panel package and inverter; supplier quote reviewed; delivery planned. Fictional records, no real supplier or equipment.',
  'DEMO ONLY — Installation complete. Sample inspection SOL-002: panels mounted, inverter installed, wiring and safety checks recorded. Fictional inspection, no actual site visit.',
  'DEMO ONLY — System handover. Sample handover SOL-003: commissioning checks recorded, operating instructions handed over, project accepted. Fictional acceptance, no authenticated engineer or utility.',
];
const unlocked = approved => [0, 30, 70, 100][approved];
const bytes = text => toUtf8Bytes(text).length;

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

// Where the stages stand, for the Safeguards summary and the project page.
export function milestoneSummary(m) {
  if (!m) return null;
  const done = m.approved >= 3, status = done ? 3 : m.rows[m.approved].status;
  return { done, tone: tones[status], status: statuses[status], stage: Math.min(m.approved + 1, 3), pct: unlocked(m.approved) };
}

export function createMilestoneScreen({ $, esc, eth, getContext, transact, notify, setActionButton, chooseWallet }) {
  let formKey = '';
  const context = () => { const c = getContext(); return { ...c, m: c.state?.milestones }; };
  const countRecord = () => { $('#milestone-record-count').textContent = String(bytes($('#milestone-record').value)); };
  $('#milestone-sample').onclick = () => {
    const { m } = context();
    if (m?.approved < 3) { $('#milestone-record').value = samples[m.approved]; countRecord(); }
  };
  $('#milestone-record').oninput = countRecord;
  $('#milestone-submit-form').onsubmit = async event => {
    event.preventDefault();
    const { m, operator } = context();
    if (!m || !operator) return;
    const record = $('#milestone-record').value.trim();
    if (!record || bytes(record) > 512) return notify(new Error('Enter supporting records of 1–512 bytes. Use the labelled sample for this demo.'));
    await transact('milestone-submit', `Request review: ${milestoneNames[m.approved]}`,
      c => c.submitMilestone(m.approved, keccak256(toUtf8Bytes(record)), record),
      () => 'Submitted. Funding stays locked until the separate reviewer approves.');
  };
  $('#milestone-demo-operator').onclick = () => chooseWallet(0).catch(notify);
  $('#milestone-demo-reviewer').onclick = () => chooseWallet(3).catch(notify);
  $('#milestone-review-confirm').onchange = () => render();
  $('#milestone-review-note').oninput = () => render();
  function review(approve) {
    const { m, reviewer } = context();
    if (!m || !reviewer || !$('#milestone-review-confirm').checked) return;
    const stage = m.approved, row = m.rows[stage], note = $('#milestone-review-note').value.trim();
    if (bytes(note) > 280 || (!approve && !note)) return notify(new Error('Explain the changes needed in 1–280 bytes.'));
    transact('milestone-review', approve ? `Approve ${milestoneNames[stage]}` : 'Request changes',
      c => c.reviewMilestone(stage, row.revision, row.hash, approve, note),
      () => approve ? 'Approved. The operator can withdraw the newly unlocked funding.' : 'Changes requested. This stage’s funding stays locked.');
  }
  $('#milestone-approve').onclick = () => review(true);
  $('#milestone-changes').onclick = () => review(false);

  function stageCard(i, row, m) {
    const done = m ? i < m.approved : false, current = m ? i === m.approved : false;
    const state = !m ? 'idle' : done ? 'done' : current ? 'current' : 'locked';
    const mark = done ? '<svg class="icon" aria-hidden="true"><use href="#i-check" /></svg>' : !m || current ? String(i + 1) : '<svg class="icon" aria-hidden="true"><use href="#i-lock" /></svg>';
    const [tone, label] = !m ? ['', ''] : done ? ['ok', `Approved · ${unlocked(i + 1)}% unlocked`] : current ? [tones[row.status], statuses[row.status]] : ['muted', `Waits for Stage ${i}`];
    const next = !current ? '' : row.status === 1 ? 'Next: the reviewer checks the records.' : row.status === 2 ? 'Next: the operator fixes the records and submits again.' : 'Next: the operator submits records for review.';
    const record = row?.record ? `<div class="sg-record"><div class="sg-record-h">Submission ${row.revision}</div><p class="milestone-record-text">${esc(row.record)}</p><details><summary>Record fingerprint</summary><code class="evidence-hash">${esc(row.hash)}</code><p>Calculated from the exact text above. It shows the text hasn't changed, not who wrote it or whether the work happened.</p></details></div>` : '';
    const note = row?.note ? `<div class="sg-note"><b>Reviewer’s note</b><p>${esc(row.note)}</p></div>` : '';
    return `<li class="sg-stage" data-state="${state}"${current ? ' aria-current="step"' : ''}><div class="sg-stage-top"><span class="sg-stage-n">${mark}</span><span class="sg-stage-pct">+${portions[i]}%</span></div>`
      + `<div class="overline">Stage ${i + 1}</div><h3>${milestoneNames[i]}</h3><p class="sg-stage-need">${needs[i]}</p>`
      + `${label ? `<span class="op-state" data-tone="${tone}"><i aria-hidden="true"></i>${label}</span>` : ''}${next ? `<p class="sg-stage-next">${next}</p>` : ''}${record}${note}</li>`;
  }

  function render() {
    const { m, loaded, supported, operator, reviewer, local, address, wrong, busy } = context();
    $('#milestone-unavailable').hidden = Boolean(m);
    $('#milestone-unavailable').textContent = !loaded || supported ? 'Loading funding stages…' : 'Not active on this deployment. Milestone funding runs in the local blockchain demo started with npm start. The public Sepolia contract and the browser simulation don’t include it, so the stages below show how it works without locking any funds.';
    $('#milestone-content').hidden = !m;
    $('#sg-fund').hidden = !m;
    const cards = [0, 1, 2].map(i => stageCard(i, m?.rows[i], m)).join('');
    if ($('#milestone-stages').innerHTML !== cards) $('#milestone-stages').innerHTML = cards;
    if (!m) return;

    const raised = m.raised, pctOf = value => raised > 0n ? Number(value * 10000n / raised) / 100 : 0;
    $('#sg-fund-raised').textContent = eth(raised);
    $('#sg-fund-unlocked').textContent = `${unlocked(m.approved)}%`;
    $('#sg-meter-rel').style.width = `${pctOf(m.released)}%`;
    $('#sg-meter-avail').style.width = `${pctOf(m.available)}%`;
    $('#milestone-totals').innerHTML = [['m-rel', 'Withdrawn by the operator', m.released], ['m-avail', 'Unlocked, not yet withdrawn', m.available], ['m-lock', 'Still locked in the contract', m.held - m.available]]
      .map(([cls, label, value]) => `<div><span><i class="${cls}" aria-hidden="true"></i>${label}</span><b>${eth(value)}</b></div>`).join('');

    const next = m.rows[m.approved], pending = next?.status === 1, changes = next?.status === 2, stage = next ? `Stage ${m.approved + 1}: ${milestoneNames[m.approved]}` : '';
    $('#milestone-role-pill').textContent = operator ? 'Solar operator' : reviewer ? 'Milestone reviewer' : address ? 'Investor' : 'Visitor';
    $('#milestone-role-pill').dataset.role = operator ? 'operator' : reviewer ? 'reviewer' : 'viewer';
    $('#milestone-role').textContent = !next ? 'All three stages are approved and all funding is unlocked. There is nothing left to submit or review.'
      : operator ? (pending ? `You submitted ${stage}. Only the separate reviewer can approve it; you can’t approve your own submission.`
        : changes ? `The reviewer asked for changes to ${stage}. Read their note on the stage card above, update the records and resubmit.` : `Submit the records for ${stage}. Funding stays locked until the reviewer approves them.`)
      : reviewer ? (pending ? `${stage} is waiting for your review. Read the records, then approve the stage or ask for changes.`
        : changes ? `You asked for changes to ${stage}. You’ll be able to review it again once the operator resubmits.` : `Nothing to review yet. You’ll be able to review ${stage} once the operator submits it.`)
      : address ? 'Nothing to do here. Your payment stays locked in the contract until each stage is approved, and your monthly income doesn’t depend on these stages.'
      : 'You can follow every stage without a wallet. Only the operator can submit records, and only the reviewer can approve them.';
    $('#milestone-demo-roles').hidden = !local;
    for (const [id, active] of [['#milestone-demo-operator', operator], ['#milestone-demo-reviewer', reviewer]]) {
      $(id).disabled = Boolean(busy);
      $(id).setAttribute('aria-pressed', String(Boolean(active)));
    }

    const key = `${address}:${m.approved}:${next?.revision}:${next?.status}`;
    if (key !== formKey) {
      $('#milestone-review-confirm').checked = false;
      $('#milestone-review-note').value = '';
      $('#milestone-record').value = next?.status === 2 ? next.record : '';
      countRecord();
      formKey = key;
    }
    $('#milestone-submit-form').hidden = !operator || !next || pending;
    $('#milestone-request-title').textContent = changes ? `Resubmit ${stage}` : `Submit ${stage}`;
    $('#milestone-review-form').hidden = !reviewer || !pending;
    $('#milestone-review-title').textContent = pending ? `Review ${stage} · submission ${next.revision}` : 'No pending review';
    $('#milestone-review-evidence').textContent = pending ? next.record : '';
    const waiting = !next ? '' : operator && pending ? 'Waiting for the reviewer.' : reviewer && !pending ? `Waiting for the operator to ${changes ? 'resubmit' : 'submit'}.` : '';
    $('#milestone-waiting').hidden = !waiting;
    $('#milestone-waiting').textContent = waiting;
    $('#milestone-withdraw').hidden = !(operator && m.available > 0n);
    $('#milestone-withdraw').textContent = `Withdraw ${eth(m.available)} in the Operator lab`;
    setActionButton($('#milestone-submit'), 'milestone-submit', changes ? 'Resubmit for review' : 'Submit for review', operator && Boolean(next) && !pending && !wrong);
    const ready = reviewer && pending && $('#milestone-review-confirm').checked && !wrong;
    setActionButton($('#milestone-approve'), 'milestone-review', 'Approve this stage', ready);
    setActionButton($('#milestone-changes'), 'milestone-review', 'Request changes', ready && Boolean($('#milestone-review-note').value.trim()));
  }
  return { render };
}
