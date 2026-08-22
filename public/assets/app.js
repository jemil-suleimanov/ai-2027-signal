const $ = id => document.getElementById(id);
const updateFields = ['date','title','score','verdict','confidence','capabilities','automation','compute','geopolitics','model','model_note','scenario_marker','scenario_date','reality_marker','body','sources'];
const publishedUpdatesUrl = 'https://github.com/jemil-suleimanov/ai-2027-signal/tree/main/content/updates';
const sourceHosts = {
  'Scenario reference': new Set(['ai-2027.com', 'lesswrong.com']),
  'Independent research': new Set(['artificialanalysis.ai', 'arcprize.org', 'epoch.ai', 'metr.org', 'transluce.org']),
  'News reporting': new Set(['apnews.com', 'reuters.com']),
  'Research paper': new Set(['arxiv.org']),
  'First-party': new Set(['anthropic.com', 'api-docs.deepseek.com', 'huggingface.co', 'kimi.com', 'news.samsung.com', 'nvidianews.nvidia.com', 'openai.com', 'thinkingmachines.ai'])
};

function describeSource(source) {
  try {
    const host = new URL(source.url).hostname.replace(/^www\./, '');
    return Object.entries(sourceHosts).find(([, hosts]) => hosts.has(host))?.[0] || 'Other source';
  } catch {
    return 'Other source';
  }
}

function setBusy(isBusy) {
  for (const id of ['score-note','tracks','history','updates']) $(id).setAttribute('aria-busy', String(isBusy));
}

function hasValidShape(data) {
  return Array.isArray(data) && data.every(update =>
    update && typeof update === 'object' && updateFields.every(field => field in update) && Array.isArray(update.sources)
  );
}

function formatAssessmentDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
}

function describeScoreChange(data) {
  if (data.length < 2) return 'First assessment';

  const delta = data[0].score - data[1].score;
  const previousDate = formatAssessmentDate(data[1].date);
  if (delta === 0) return `No score change vs ${previousDate}`;

  const points = Math.abs(delta);
  return `${delta > 0 ? 'Up' : 'Down'} ${points} ${points === 1 ? 'point' : 'points'} vs ${previousDate}`;
}

function renderHistory(data) {
  const history = [...data].reverse();
  const width = 600;
  const chartTop = 28;
  const chartBottom = 138;
  const chartLeft = 42;
  const chartRight = 558;
  const x = index => history.length === 1
    ? width / 2
    : chartLeft + (index * (chartRight - chartLeft) / (history.length - 1));
  const y = score => chartBottom - (score / 100 * (chartBottom - chartTop));
  const points = history.map((update, index) => `${x(index)},${y(update.score)}`).join(' ');

  $('history-summary').textContent = history.length === 1
    ? 'First published assessment'
    : `${history.length} published assessments · ${history[0].score} → ${history.at(-1).score}`;
  $('history').innerHTML = `
    <svg class="history-chart" viewBox="0 0 ${width} 170" aria-hidden="true" focusable="false">
      <line class="history-grid" x1="${chartLeft}" y1="${y(100)}" x2="${chartRight}" y2="${y(100)}"></line>
      <line class="history-grid" x1="${chartLeft}" y1="${y(50)}" x2="${chartRight}" y2="${y(50)}"></line>
      <line class="history-grid" x1="${chartLeft}" y1="${y(0)}" x2="${chartRight}" y2="${y(0)}"></line>
      <text class="history-axis" x="4" y="${y(100) + 4}">100</text>
      <text class="history-axis" x="10" y="${y(50) + 4}">50</text>
      <text class="history-axis" x="16" y="${y(0) + 4}">0</text>
      ${history.length > 1 ? `<polyline class="history-line" points="${points}"></polyline>` : ''}
      ${history.map((update, index) => `
        <g class="history-point">
          <circle cx="${x(index)}" cy="${y(update.score)}" r="5"></circle>
          <text x="${x(index)}" y="${y(update.score) - 12}" text-anchor="middle">${update.score}</text>
        </g>
      `).join('')}
    </svg>
    <ol class="history-values" aria-label="Published scenario alignment scores">
      ${history.map(update => `<li><time datetime="${update.date}">${formatAssessmentDate(update.date)}</time><b>${update.score}/100</b></li>`).join('')}
    </ol>
    <p class="history-note">Published editorial assessments, shown on the full 0–100 scale. This is a record, not a forecast.</p>
  `;
}

function renderUnavailable(title, message) {
  $('score').textContent = '—';
  $('verdict').textContent = 'unavailable';
  delete $('verdict').dataset.verdict;
  $('confidence').textContent = 'data unavailable';
  $('meter').style.width = '0%';
  $('alignment-meter').removeAttribute('aria-valuenow');
  $('alignment-meter').setAttribute('aria-valuetext', 'Assessment unavailable');
  $('score-note').hidden = false;
  $('score-note').textContent = message;
  $('week-title').textContent = title;
  $('model').textContent = 'Tracker status';
  $('model-note').textContent = message;
  $('updated').textContent = 'Reload this page to retry';
  $('scenario-marker').textContent = 'Latest scenario milestone unavailable';
  $('scenario-date').textContent = '';
  $('reality-marker').textContent = 'Latest observation unavailable';
  $('tracks').innerHTML = `
    <div class="track"><div><span>Track data unavailable</span><b>—</b></div><div class="track-meter"></div></div>
  `;
  $('history-summary').textContent = 'Assessment history unavailable';
  $('history').innerHTML = '<p class="history-note">Published score history could not be loaded.</p>';
  $('updates').innerHTML = `
    <article class="update">
      <div class="update-meta"><span>Data status</span></div>
      <div><h3>${title}</h3><p>${message}</p>
        <div class="sources"><a href="${publishedUpdatesUrl}" target="_blank" rel="noreferrer">View published updates ↗</a></div>
      </div>
      <div class="mini-score"><b>—</b><span>unavailable</span></div>
    </article>
  `;
}

function renderUpdates(data) {
  const latest = data[0];

  $('score').textContent = latest.score;
  $('verdict').textContent = latest.verdict;
  $('verdict').dataset.verdict = latest.verdict;
  $('confidence').textContent = `Evidence confidence: ${latest.confidence}`;
  $('meter').style.width = `${latest.score}%`;
  $('alignment-meter').setAttribute('aria-valuenow', String(latest.score));
  $('alignment-meter').setAttribute('aria-valuetext', `${latest.score} out of 100 — ${latest.verdict}`);
  $('score-note').hidden = true;
  $('week-title').textContent = latest.title;
  $('model').textContent = latest.model;
  $('model-note').textContent = latest.model_note;
  $('updated').textContent = `Assessment · ${formatAssessmentDate(latest.date)} · ${describeScoreChange(data)}`;
  $('scenario-marker').textContent = latest.scenario_marker;
  $('scenario-date').textContent = latest.scenario_date;
  $('reality-marker').textContent = latest.reality_marker;

  const trackNames = { capabilities:'Model capabilities', automation:'AI R&D automation', compute:'Compute scale-up', geopolitics:'Race dynamics' };
  $('tracks').innerHTML = Object.entries(trackNames).map(([key, label]) => `
    <div class="track"><div><span>${label}</span><b>${latest[key]}</b></div><div class="track-meter" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${latest[key]}" aria-valuetext="${latest[key]} out of 100"><i style="width:${latest[key]}%"></i></div></div>
  `).join('');

  renderHistory(data);

  $('updates').innerHTML = data.map((update, index) => `
    <article id="update-${update.date}" class="update ${index ? '' : 'latest'}">
      <div class="update-meta"><time>${update.date}</time><span>${index ? 'Archive' : 'Latest signal'}</span></div>
      <div><h3>${update.title}</h3>${update.body.split('\n\n').map(p => `<p>${p}</p>`).join('')}
        <div class="sources" aria-label="Sources">${update.sources.map(s => {
          const kind = describeSource(s);
          return `<a href="${s.url}" target="_blank" rel="noreferrer"><span class="source-kind">${kind}</span><span>${s.title} ↗</span></a>`;
        }).join('')}</div>
      </div>
      <div class="mini-score"><b>${update.score}</b><span>${update.verdict}</span></div>
    </article>
  `).join('');

  const requestedUpdate = decodeURIComponent(location.hash.slice(1));
  if (/^update-\d{4}-\d{2}-\d{2}$/.test(requestedUpdate)) {
    document.getElementById(requestedUpdate)?.scrollIntoView();
  }
}

async function loadUpdates() {
  try {
    const response = await fetch('./data/updates.json');
    if (!response.ok) throw new Error(`Updates request failed with ${response.status}`);

    const data = await response.json();
    if (!hasValidShape(data)) throw new Error('Updates data has an invalid shape');

    if (!data.length) {
      renderUnavailable(
        'No assessment published yet',
        'The tracker will display its first evidence-led assessment here once it is available.'
      );
      return;
    }

    renderUpdates(data);
  } catch (error) {
    console.error('Could not load weekly assessments.', error);
    renderUnavailable(
      'Assessment temporarily unavailable',
      'The latest assessment could not be loaded. Please retry shortly or inspect the published updates in the repository.'
    );
  } finally {
    setBusy(false);
  }
}

void loadUpdates();
