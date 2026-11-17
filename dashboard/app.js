// Token Radar's page. It reads window.RADAR (written beside dashboard/ by main.ts) and renders the
// ranked pre-token board, a filterable and sortable table, and a per-protocol drawer with the model
// inputs and the exact farm plan board.json carries. No fetch, no network: every byte is in data.js.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) {
    document.getElementById('boardpanel').textContent = 'No data.js: run main.ts to write the radar data.';
    return;
  }
  var M = DATA.model;
  var state = { q: '', category: 'all', chain: 'all', watch: false, tab: 'pre', sort: 'implied', dir: -1, selected: null };

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else if (typeof c === 'string' || typeof c === 'number') node.appendChild(document.createTextNode(String(c)));
      else node.appendChild(c);
    }
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function age(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 730) return (d / 365).toFixed(1) + 'y';
    if (d >= 365) return '1y ' + Math.round(d - 365) + 'd';
    return Math.round(d) + 'd';
  }
  // The page's own copy of the model: rebuilds a row from the snapshot figures so the drawer can show
  // that the number board.json carries is the number this arithmetic produces.
  function recompute(row) {
    var g = Math.min(M.growth_cap, Math.max(M.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var gm = 1 + (g / 100) * M.growth_weight;
    var a = Math.min(Math.max(row.age_days === null || row.age_days === undefined ? M.unknown_age_days : row.age_days, 0), M.maturity_days);
    var mm = M.maturity_floor + (a / M.maturity_days) * M.maturity_range;
    return { growth: g, growthMult: gm, maturityMult: mm, value: Math.min(M.value_cap_usd, Math.max(1, Math.round(row.tvl_usd * M.tvl_multiple * gm * mm))) };
  }

  var categories = [], chains = [];
  DATA.rows.forEach(function (r) {
    var c = r.category || 'Other';
    if (categories.indexOf(c) < 0) categories.push(c);
    (r.chains || []).forEach(function (ch) { if (chains.indexOf(ch) < 0) chains.push(ch); });
  });
  categories.sort(); chains.sort();

  function hashParams() { return new URLSearchParams(window.location.hash.replace(/^#/, '')); }
  function readHash() {
    var p = hashParams();
    ['q', 'category', 'chain'].forEach(function (k) { if (p.get(k)) state[k] = p.get(k); });
    if (p.get('watch') === '1') state.watch = true;
    if (p.get('tab') === 'live') state.tab = 'live';
    if (p.get('p')) state.selected = p.get('p');
  }
  function writeHash() {
    var p = hashParams();
    ['q', 'category', 'chain', 'p'].forEach(function (k) { p.delete(k); });
    p.delete('watch'); p.delete('tab');
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.watch) p.set('watch', '1');
    if (state.tab === 'live') p.set('tab', 'live');
    if (state.selected) p.set('p', state.selected);
    var s = p.toString();
    window.history.replaceState(null, '', s ? '#' + s : window.location.pathname + window.location.search);
  }

  function visible() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !r.on_watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var k = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (k === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (k === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (k === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (k === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (k === 'category') { av = (a.category || '').toLowerCase(); bv = (b.category || '').toLowerCase(); }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function renderSnap() {
    var node = document.getElementById('snap');
    clear(node);
    [['snapshot', DATA.as_of], ['source', 'DefiLlama'], ['model', DATA.model_version], ['floor', usd(DATA.floor_usd)]].forEach(function (row) {
      node.appendChild(el('div', null, el('dt', { text: row[0] }), el('dd', { text: row[1] })));
    });
  }

  function topShare() {
    var total = 0;
    DATA.rows.forEach(function (r) { total += r.implied_value_usd; });
    var top = 0;
    DATA.rows.slice(0, 25).forEach(function (r) { top += r.implied_value_usd; });
    return total > 0 ? Math.round((top / total) * 100) : 0;
  }

  function renderBrief() {
    var node = document.getElementById('brief');
    clear(node);
    var left = el('div', null,
      el('div', { class: 'kicker', text: 'Pre-token radar · ' + DATA.board_size + ' protocols scored' }),
      el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by the value a token could carry' }),
      el('p', { class: 'lede' },
        'Every protocol here records no token, so a launch is still ahead of it. The board covers the full ',
        el('b', { text: DATA.watchlist_size + '-protocol watchlist' }),
        ' and adds ',
        el('b', { text: DATA.early_size + ' early protocols' }),
        ' the watchlist leaves out, ranked by a model of the snapshot alone: TVL, seven-day growth and how long the protocol has run with no token. Implied value is a claim, not a promise or a price.'
      )
    );
    var totalValue = DATA.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var stats = el('div', { class: 'stats' },
      el('div', { class: 'stat accent' }, el('b', { text: usd(DATA.rows[0].implied_value_usd) }), el('span', { text: 'top implied value · ' + DATA.rows[0].name })),
      el('div', { class: 'stat watch' }, el('b', { text: String(DATA.watchlist_size) + ' / ' + DATA.watchlist_size }), el('span', { text: 'watchlist covered' })),
      el('div', { class: 'stat' }, el('b', { text: usd(totalValue) }), el('span', { text: 'implied value across the board' })),
      el('div', { class: 'stat' }, el('b', { text: topShare() + '%' }), el('span', { text: 'held by the top 25 rows' }))
    );
    node.appendChild(left);
    node.appendChild(stats);
  }

  function renderModelBar() {
    var node = document.getElementById('modelbar');
    clear(node);
    node.appendChild(el('span', { class: 'badge', text: DATA.model_version }));
    node.appendChild(el('div', { class: 'formula' },
      'implied = round( ', el('b', { text: 'TVL' }), ' × ' + M.tvl_multiple + ' × (1 + clamp(', el('b', { text: '7d growth' }),
      ', ' + M.growth_floor + ', ' + M.growth_cap + ')% × ' + M.growth_weight + ') × (' + M.maturity_floor + ' + min(', el('b', { text: 'age' }),
      ', ' + M.maturity_days + ') / ' + M.maturity_days + ' × ' + M.maturity_range + ') )'
    ));
    node.appendChild(el('div', { class: 'note', text: 'One function, three snapshot fields, no name list. Live-token protocols are shown apart, never ranked.' }));
  }

  function option(value, label, selected) {
    return el('option', { value: value, text: label, selected: value === selected ? 'selected' : null });
  }

  function renderControls() {
    var node = document.getElementById('controls');
    clear(node);
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); renderTable(); });
    var cat = el('select', { id: 'cat' }, option('all', 'All categories', state.category), categories.map(function (c) { return option(c, c, state.category); }));
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); renderTable(); });
    var chain = el('select', { id: 'chain' }, option('all', 'All chains', state.chain), chains.map(function (c) { return option(c, c, state.chain); }));
    chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); renderTable(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre' ? 'true' : 'false', text: 'Pre-token' });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token' });
    pre.addEventListener('click', function () { state.tab = 'pre'; writeHash(); renderTable(); });
    live.addEventListener('click', function () { state.tab = 'live'; writeHash(); renderTable(); });
    var watch = el('button', { type: 'button', class: 'toggle', 'aria-pressed': state.watch ? 'true' : 'false', text: 'Watchlist only' });
    watch.addEventListener('click', function () { state.watch = !state.watch; writeHash(); renderAll(); });
    var n = state.tab === 'pre' ? visible().length : DATA.live.length;
    node.appendChild(el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search));
    node.appendChild(el('div', { class: 'field' }, el('label', { for: 'cat', text: 'Category' }), cat));
    node.appendChild(el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain));
    node.appendChild(el('div', { class: 'field' }, el('span', { text: 'Ranking set' }), el('div', { class: 'seg' }, pre, live)));
    node.appendChild(el('div', { class: 'field' }, el('span', { text: 'Filter' }), watch));
    node.appendChild(el('div', { class: 'count' }, el('b', { text: String(n) }), state.tab === 'pre' ? ' pre-token rows' : ' live-token protocols'));
  }

  function th(key, label, right) {
    return el('th', { scope: 'col', class: right ? 'right' : null }, el('button', {
      type: 'button', 'data-active': state.sort === key ? 'true' : 'false',
      onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' || key === 'age' || key === 'category' ? 1 : -1; }
        renderTable();
      }
    }, label, el('span', { class: 'arrow', text: state.sort === key ? (state.dir > 0 ? '▲' : '▼') : '·' })));
  }

  function renderTable() {
    renderControls();
    var host = document.getElementById('boardpanel');
    clear(host);
    if (state.tab === 'live') {
      var body = el('tbody');
      DATA.live.forEach(function (r) {
        body.appendChild(el('tr', { class: 'live-row' },
          el('td', { class: 'rank', text: 'live' }),
          el('td', null, el('div', { class: 'who' }, el('b', { text: r.name }), el('div', { class: 'meta' }, el('span', { text: r.category || 'Other' }), el('span', { text: '·' }), el('span', { text: (r.chains || []).slice(0, 2).join(', ') })))),
          el('td', { class: 'num', text: usd(r.tvl_usd) }),
          el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
          el('td', { class: 'num', text: usd(r.mcap_usd) }),
          el('td', null, el('span', { class: 'pill', text: 'already trades' }))
        ));
      });
      host.appendChild(el('div', { class: 'table-wrap' }, el('table', null,
        el('caption', { text: 'Token live: these protocols record a token, so their market cap is the market\'s number, not this model\'s. They are excluded from the ranking on purpose.' }),
        el('thead', null, el('tr', null, el('th', { text: 'Status' }), el('th', { text: 'Protocol' }), el('th', { text: 'TVL' }), el('th', { text: '7d' }), el('th', { text: 'Market cap' }), el('th', { text: 'Token' }))),
        body
      )));
      return;
    }
    var list = sorted(visible());
    if (list.length === 0) {
      host.appendChild(el('div', { class: 'empty' },
        el('h2', { text: 'Nothing matches that filter' }),
        el('p', { text: 'Clear the search, or widen the category and chain filters.' }),
        el('button', { class: 'btn primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watch = false; writeHash(); renderAll(); } })
      ));
      return;
    }
    var max = DATA.rows[0].implied_value_usd || 1;
    var body = el('tbody');
    list.forEach(function (r) {
      var row = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'rank' + (r.rank <= 10 ? ' top' : ''), text: String(r.rank) }),
        el('td', null, el('div', { class: 'who' },
          el('b', { text: r.name }),
          el('div', { class: 'meta' },
            el('span', { text: r.category || 'Uncategorised' }),
            el('span', { text: '·' }),
            el('span', { text: (r.chains || []).slice(0, 2).join(', ') || 'chain not named' }),
            r.on_watchlist ? el('span', { class: 'pill watch', text: 'watchlist' }) : el('span', { class: 'pill', text: 'early' })
          )
        )),
        el('td', { class: 'num right', text: usd(r.tvl_usd) }),
        el('td', { class: 'num right ' + (r.change_7d === null ? 'muted' : r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
        el('td', { class: 'num right ' + (r.age_days === null ? 'muted' : ''), text: age(r.age_days) }),
        el('td', null, el('div', { class: 'value' },
          el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('b', { text: usd(r.implied_value_usd) })
        ))
      );
      body.appendChild(row);
    });
    host.appendChild(el('div', { class: 'table-wrap' }, el('table', null,
      el('caption', { text: 'Pre-token protocols ranked by implied value. Click any row for the model inputs and a seven-step farm plan. Rank stays the model\'s rank when the table is re-sorted.' }),
      el('thead', null, el('tr', null,
        th('rank', 'Rank'), th('name', 'Protocol'), th('tvl', 'TVL', true), th('growth', '7d growth', true), th('age', 'Age, no token', true), th('implied', 'Implied value', true)
      )),
      body
    )));
  }

  function renderMethod() {
    var node = document.getElementById('method');
    clear(node);
    node.appendChild(el('article', { class: 'card' },
      el('h2', { text: 'Why these three inputs' }),
      el('p', null, 'TVL is the protocol\'s own size and the base a token would be issued against. Seven-day growth is the only momentum the snapshot carries, clamped to −50…+100% so one week can move a row by at most a third. Age is how long it has run with no token: a protocol listed four years has held TVL without a token and keeps the full multiple; one listed last month is discounted to ' + M.maturity_floor + '.')
    ));
    node.appendChild(el('article', { class: 'card' },
      el('h2', { text: 'What the board does not claim' }),
      el('p', null, 'It does not predict that a token is issued, or when. A protocol may have a token its DefiLlama record does not carry. Implied value is this entry\'s own estimate of what a token would be worth if the record stayed as it is, not a price, not advice, and not a make.fun claim.')
    ));
    node.appendChild(el('article', { class: 'card' },
      el('h2', { text: 'What a farm plan costs' }),
      el('p', null, 'Each plan is generated from the protocol\'s category, chains, TVL and age: the action, the capital, the gas tier of its chain, the weekly cadence, the hold and the exit. The drawer shows the same strings board.json carries, so the page and the data cannot disagree.')
    ));
  }

  function renderFoot() {
    var node = document.getElementById('foot');
    clear(node);
    node.appendChild(el('span', { text: 'Token Radar · model ' + DATA.model_version + ' · snapshot ' + DATA.as_of + ' · ' + DATA.source.replace(/^DefiLlama\s+/, 'DefiLlama ') }));
    node.appendChild(el('span', { text: 'Generated offline from one sealed snapshot. No network, no tracking, no external assets.' }));
  }

  /* drawer */
  var drawer = document.getElementById('drawer');
  var scrim = el('div', { class: 'scrim' });
  scrim.addEventListener('click', closeDetail);

  function splitStep(s) {
    var at = s.indexOf(' Cost: ');
    if (at < 0) return { action: s, rest: '' };
    return { action: s.slice(0, at), rest: s.slice(at + 1) };
  }
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var calc = recompute(row);
    var ok = calc.value === row.implied_value_usd;
    clear(drawer);
    drawer.appendChild(el('div', { class: 'drawer-inner' },
      el('div', { class: 'dhead' },
        el('div', null,
          el('div', { class: 'rankline', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.on_watchlist ? ' · watchlist' : ' · early radar') }),
          el('h2', { id: 'drawer-title', text: row.name }),
          el('p', { text: (row.category || 'Uncategorised') + ' · ' + ((row.chains || []).join(', ') || 'chain not named') + ' · listed ' + (row.listed_at || 'date not recorded') })
        ),
        el('button', { class: 'x', type: 'button', 'aria-label': 'Close the detail view', text: '×', onclick: closeDetail })
      ),
      el('div', { class: 'hero-value' },
        el('div', null, el('span', { text: 'Implied value if the record holds' }), el('b', { text: usd(row.implied_value_usd) })),
        el('em', { text: 'pre-token · no token on record' })
      ),
      el('section', { class: 'sec' },
        el('h3', { text: 'Model inputs and the arithmetic' }),
        el('div', { class: 'eq' },
          el('div', null, el('span', { text: 'TVL (snapshot)' }), el('b', { text: usd(row.tvl_usd) })),
          el('div', null, el('span', { text: '7d growth (clamped to ' + M.growth_floor + '…' + M.growth_cap + '%)' }), el('b', { class: 'num ' + (calc.growth >= 0 ? 'pos' : 'neg'), text: pct(calc.growth) })),
          el('div', null, el('span', { text: 'Age with no token' }), el('b', { text: age(row.age_days) })),
          el('div', null, el('span', { text: 'TVL multiple' }), el('b', { text: '× ' + M.tvl_multiple })),
          el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { text: '× ' + calc.growthMult.toFixed(4) })),
          el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { text: '× ' + calc.maturityMult.toFixed(4) })),
          el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: usd(calc.value) }))
        ),
        el('div', { class: 'factors' },
          el('div', { class: 'factor' }, el('span', { text: 'TVL' }), el('b', { text: usd(row.tvl_usd) })),
          el('div', { class: 'factor' }, el('span', { text: 'Growth' }), el('b', { text: pct(row.change_7d) })),
          el('div', { class: 'factor' }, el('span', { text: 'Age' }), el('b', { text: age(row.age_days) }))
        ),
        el('p', { class: 'verdict' + (ok ? '' : ' bad'), text: ok ? 'The page recomputes ' + usd(calc.value) + ' from these inputs: the same number board.json and data.js carry. No name, category or chain enters the arithmetic.' : 'The page computes ' + usd(calc.value) + ', which differs from the board row: the data would be stale.' })
      ),
      el('section', { class: 'sec' },
        el('h3', { text: 'Farm plan before the launch · 7 steps' }),
        el('ol', { class: 'plan' }, (row.farm_steps || []).map(function (s) {
          var parts = splitStep(s);
          return el('li', null, el('div', null,
            el('p', { text: parts.action }),
            parts.rest ? el('div', { class: 'tags' }, el('span', { class: 'tag cost', text: parts.rest.replace(/\.$/, '') })) : null
          ));
        }))
      ),
      el('section', { class: 'sec' },
        el('h3', { text: 'Snapshot record' }),
        el('div', { class: 'eq' },
          el('div', null, el('span', { text: 'Slug' }), el('b', { text: row.slug })),
          el('div', null, el('span', { text: 'Market cap on record' }), el('b', { text: row.mcap_usd === null ? 'none' : usd(row.mcap_usd) })),
          el('div', null, el('span', { text: 'Token status' }), el('b', { text: 'no token recorded (pre-token)' }))
        ),
        el('p', { class: 'verdict', text: 'DefiLlama records no token for this protocol. That is the record, not proof: it may issue one later, or already have one the record does not carry.' })
      )
    ));
    drawer.hidden = false;
    document.body.appendChild(scrim);
    document.getElementById('board').setAttribute('aria-busy', 'false');
  }
  function closeDetail() {
    drawer.hidden = true;
    state.selected = null;
    if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
    writeHash();
    renderTable();
  }
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !drawer.hidden) closeDetail(); });

  function renderAll() { renderSnap(); renderBrief(); renderModelBar(); renderMethod(); renderFoot(); renderTable(); }

  readHash();
  renderAll();
  if (state.selected) openDetail(state.selected);
  document.getElementById('board').setAttribute('aria-busy', 'false');
})();
