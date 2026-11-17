// The token radar's model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// A protocol is PRE-TOKEN when its DefiLlama record carries no market cap, no CoinGecko id and no
// symbol. The board ranks those protocols only; protocols whose token already trades are kept in a
// separate live set and shown with the market's own market cap, never mixed into the ranking.
//
// IMPLIED VALUE (model "radar-2")
//
//   tvl        = tvl_usd from the snapshot, whole dollars
//   growth     = clamp(change_7d, -50, +100) per cent; null counts as 0
//   age        = days from listed_at to as_of, clamped to 0..1460; null counts as 365
//   implied    = round( tvl x TVL_MULTIPLE x growthMult x maturityMult )
//   growthMult = 1 + (growth / 100) x 0.35          -> 0.825 at -50%, 1.35 at +100%
//   maturityMult = 0.70 + 0.30 x age/1460           -> 0.70 at day 0, 1.00 at four years
//
// Why these three inputs and nothing else:
//   - TVL is the protocol's own size: the revenue base a token would be issued against. The board's
//     implied value is a share of that base (30%), the multiple at which a mature DeFi protocol's
//     fully diluted value has lately sat against its TVL.
//   - change_7d is the only momentum the snapshot carries. It is clamped hard, so one freak week can
//     move a row by at most a third of its TVL-derived value either way.
//   - age is how long the protocol has run with no token on record. A protocol listed for years has
//     proven it can hold TVL without a token, so it keeps the full multiple; a protocol listed last
//     month is discounted to 70%, because its TVL is the least tested. An unknown age is treated as
//     one year (the middle of the distribution), never as the best case.
// Every constant is stated here, in the dashboard and in each row's `model` block. No protocol name,
// category or chain is special-cased: one function scores every row, so the board is reproducible.
//
// The board covers all 40 watchlist slugs, then every other pre-token protocol the snapshot lists
// that is not a wrapped, staked or bridged product of a live token (the early rows below the floor),
// so the watchlist is the floor and never the ceiling.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  tvl_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  value_cap_usd: number;
}

export const MODEL: ModelConstants = {
  tvl_multiple: 0.3,
  growth_weight: 0.35,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1460,
  unknown_age_days: 365,
  value_cap_usd: 100_000_000_000_000,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 2_000;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 40;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    tvl_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, carrying the farm plan board.json carries. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = Math.min(Math.max(age ?? model.unknown_age_days, 0), model.maturity_days);
  const maturityMult = model.maturity_floor + (ageForModel / model.maturity_days) * model.maturity_range;
  const base = protocol.tvl_usd * model.tvl_multiple;
  const implied = Math.min(model.value_cap_usd, Math.max(1, Math.round(base * growthMult * maturityMult)));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Exchange-branded products are not independent launches. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** A wrapped, staked or bridged product of a token that already trades is not a token still to come. */
const PRODUCT_NAME = /\b(wrapped|staked|staking)\b/i;

/** Categories that describe a derivative of an existing asset rather than a protocol awaiting a token. */
const PRODUCT_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Anchor BTC', 'Stablecoin Wrapper']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the early radar may rank: pre-token, and not a product of a live token. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !PRODUCT_CATEGORIES.has(p.category ?? '') && !VERSIONED.test(p.name) && !EXCHANGE_PREFIX.test(p.name) && !PRODUCT_NAME.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug. A chosen protocol is never displaced by an early row.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other pre-token protocol the snapshot lists, by TVL, capped. This carries
  // protocols both below the floor and at or above it that the watchlist rule left out.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, model);
    return { p, implied, growthPct, growthMult, maturityMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    on_watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      tvl_multiple: model.tvl_multiple,
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A second chain, when the protocol spans more than one. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** Gas tier from the chain the action lands on; the plan's costs follow it. */
function gasTier(chain: string): { cheap: boolean; deposit: number; weekly: number; claim: number } {
  const cheap = ['Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'BNB', 'Binance', 'Avalanche', 'Sonic', 'Mantle', 'Unichain', 'Linea', 'Scroll', 'Monad', 'Sui', 'Aptos'].includes(chain);
  return cheap ? { cheap, deposit: 1, weekly: 1, claim: 1 } : { cheap, deposit: 9, weekly: 6, claim: 5 };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 250_000_000) return 100;
  if (p.tvl_usd >= 50_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category family a plan is written for. */
export type FarmFamily = 'lending' | 'dex' | 'bridge' | 'staking' | 'perps' | 'rwa' | 'vaults' | 'stable' | 'insurance' | 'prediction' | 'chain' | 'launchpad' | 'other';

/** Map DefiLlama's category string onto a plan family, by keyword, never by protocol name. */
export function farmFamily(p: SnapshotProtocol): FarmFamily {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('dex') || c.includes('liquidity') || c.includes('farm') || c.includes('yield aggregator')) return 'dex';
  if (c.includes('bridge') || c.includes('cross chain')) return 'bridge';
  if (c.includes('staking') || c.includes('restak') || c.includes('anchor btc')) return 'staking';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis') || c.includes('option') || c.includes('synthetic')) return 'perps';
  if (c.includes('rwa') || c.includes('decentralized btc')) return 'rwa';
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield') || c.includes('index')) return 'vaults';
  if (c.includes('stable') || c.includes('reserve currency')) return 'stable';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('chain') || c.includes('payments') || c.includes('privacy')) return 'chain';
  if (c.includes('launchpad') || c.includes('governance')) return 'launchpad';
  return 'other';
}

/** The family's core action, in the words a farmer can follow, at this capital and chain. */
export function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const n = p.name;
  switch (farmFamily(p)) {
    case 'lending':
      return `Supply $${capital} of USDC to ${n} on ${chain} as a lender, then borrow $${Math.round(capital * 0.4)} of the chain's major asset against it and supply that too.`;
    case 'dex':
      return `Add $${capital} of liquidity to ${n}'s deepest USDC pair on ${chain} within the stated range, and keep the LP receipt in the wallet you farm with.`;
    case 'bridge':
      return `Bridge $${capital} of USDC from Ethereum to ${chain} through ${n}, then swap half into the chain's gas token and hold both sides in the app.`;
    case 'staking':
      return `Mint $${capital} of ${n}'s receipt token on ${chain} (stake the chain's asset, keep the receipt), and do not sell the receipt.`;
    case 'perps':
      return `Deposit $${capital} of USDC as margin on ${n} on ${chain}, open a $${capital} notional hedge and keep the position through two funding cycles.`;
    case 'rwa':
      return `Mint or subscribe to $${capital} of ${n}'s yield-bearing asset on ${chain} and hold the claim token in the farm wallet.`;
    case 'vaults':
      return `Deposit $${capital} of USDC into ${n}'s largest curated vault on ${chain} and keep the vault shares, not the underlying.`;
    case 'stable':
      return `Mint $${capital} of ${n}'s stable asset on ${chain} against the collateral it accepts, and hold the minted balance for the season.`;
    case 'insurance':
      return `Buy $${capital} of cover from ${n} on ${chain} for a position you already hold, and keep the policy NFT.`;
    case 'prediction':
      return `Fund $${capital} of USDC on ${n} on ${chain} and place one position on each side of a liquid market to establish volume.`;
    case 'chain':
      return `Bridge $${capital} of USDC onto ${chain} through ${n}'s canonical route, then use the chain's main DEX and lending market with it.`;
    case 'launchpad':
      return `Stake $${capital} of the assets ${n} accepts on ${chain}, then commit to one launch it runs and claim the allocation.`;
    default:
      return `Deposit $${capital} of USDC into ${n} on ${chain}, keep the receipt, and use the app's own earn or points page once a week.`;
  }
}

/** The family's second, differentiating action. */
function deepenFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const n = p.name;
  switch (farmFamily(p)) {
    case 'lending':
      return `Repay a fifth of the borrow and re-borrow it on a second market ${n} runs, so both markets count the wallet as active.`;
    case 'dex':
      return `Rebalance the range once the price leaves it, and add a $${Math.round(capital * 0.25)} stable-stable position for volume without direction.`;
    case 'bridge':
      return `Send one small transfer back across ${n} in the opposite direction, then use the received asset in a ${chain} pool.`;
    case 'staking':
      return `Delegate the receipt to a ${n} validator or operator if it offers one, so the position earns and stays visible.`;
    case 'perps':
      return `Trade one round trip on a second ${n} market (spot hedge or a different expiry) to widen the wallet's history.`;
    case 'rwa':
      return `Reinvest one distribution from the ${n} position instead of withdrawing it, keeping the position compounding.`;
    case 'vaults':
      return `Split the deposit across two ${n} vaults with different curators, so the wallet is not one vault's single depositor.`;
    case 'stable':
      return `Use the minted ${n} balance in one ${chain} pool, then repay part of the mint and mint again next week.`;
    case 'insurance':
      return `Renew the ${n} cover once it expires rather than letting it lapse; renewal is the activity a snapshot sees.`;
    default:
      return `Repeat the same action with a second asset ${n} supports on ${chain}, so the wallet holds two positions, not one.`;
  }
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. Every line is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const chain2 = secondChainOf(p);
  const gas = gasTier(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const years = age === null ? null : age / 365;
  const steps: FarmStep[] = [
    {
      text: `Make a fresh wallet for ${p.name} only, fund it with $${capital + 20} (the position plus a gas buffer) and keep the seed phrase offline.`,
      cost: `$${capital + 20} moved in, of which about $${gas.deposit + 4} is spent on gas`,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital plus about $${gas.deposit} of ${chain} gas`,
      time: '20 minutes for the first transaction',
    },
    {
      text: deepenFor(p, capital, chain),
      cost: `about $${gas.weekly * 2} of gas, no new capital beyond the $${capital} already in`,
      time: '15 minutes, once',
    },
    {
      text: `Return once a week for four weeks: one deposit, borrow, swap or vote on ${p.name}${chain2 === null ? '' : `, and one action on ${chain2} if the app is live there`}. Small and regular beats one large transaction.`,
      cost: `about $${gas.weekly} of gas a week, so $${gas.weekly * 4} over the month`,
      time: '10 minutes a week, 4 weeks',
    },
    {
      text: `Hold the position for at least ${hold} days${years === null ? '' : `; ${p.name} has been listed about ${years.toFixed(1)} years, so the snapshot has seen it through several cycles already`}, and do not move the funds between wallets.`,
      cost: `the $${capital} stays at work, and no fee is paid to hold`,
      time: `${hold} days`,
    },
    {
      text: `Check ${p.name}'s own site, governance forum and X account for a points, quest or airdrop programme; register the farm wallet there and claim only from the protocol's own published page.`,
      cost: 'free to register; never pay a claim fee to a third party',
      time: '15 minutes, then 5 minutes a week',
    },
    {
      text: `Log the wallet address, every transaction hash, the dates and the cost in one file, then unwind in reverse order (repay, remove liquidity, bridge back) when you stop farming.`,
      cost: `about $${gas.claim + gas.deposit} of gas to exit the position`,
      time: '20 minutes to exit',
    },
  ];
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, carrying the same farm plan board.json carries. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    on_watchlist: row.on_watchlist,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.on_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
