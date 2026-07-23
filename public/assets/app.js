const $ = id => document.getElementById(id);
const updateFields = ['date','title','score','verdict','confidence','capabilities','automation','compute','geopolitics','model','model_note','scenario_marker','scenario_date','reality_marker','body','sources'];
const publishedUpdatesUrl = 'https://github.com/jemil-suleimanov/ai-2027-signal/tree/main/content/updates';

function setBusy(isBusy) {
  for (const id of ['score-note','tracks','updates']) $(id).setAttribute('aria-busy', String(isBusy));
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

  $('updates').innerHTML = data.map((update, index) => `
    <article class="update ${index ? '' : 'latest'}">
      <div class="update-meta"><time>${update.date}</time><span>${index ? 'Archive' : 'Latest signal'}</span></div>
      <div><h3>${update.title}</h3>${update.body.split('\n\n').map(p => `<p>${p}</p>`).join('')}
        <div class="sources">${update.sources.map(s => `<a href="${s.url}" target="_blank" rel="noreferrer">${s.title} ↗</a>`).join('')}</div>
      </div>
      <div class="mini-score"><b>${update.score}</b><span>${update.verdict}</span></div>
    </article>
  `).join('');
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
