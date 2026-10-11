// Public RPCs cap the block span of one eth_getLogs call and report it with non-standard errors
// (ethers shows "could not coalesce error"), so long histories are read in windows. A rejected
// window is halved and retried; the narrower span is kept for later reads.
const MIN_SPAN = 100;
let span = 5000;

export async function getLogsInRange(provider, filter, fromBlock, toBlock) {
  const logs = [];
  for (let start = fromBlock; start <= toBlock;) {
    const end = Math.min(toBlock, start + span - 1);
    try {
      logs.push(...await provider.getLogs({ ...filter, fromBlock: start, toBlock: end }));
      start = end + 1;
    } catch (error) {
      if (span <= MIN_SPAN) throw error;
      span = Math.max(MIN_SPAN, Math.floor(span / 2));
    }
  }
  return logs;
}
