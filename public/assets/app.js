const data = await fetch('./data/updates.json').then(r => r.json());
const latest = data[0];
const $ = id => document.getElementById(id);

$('score').textContent = latest.score;
$('verdict').textContent = latest.verdict;
$('verdict').dataset.verdict = latest.verdict;
$('confidence').textContent = `${latest.confidence} confidence`;
$('meter').style.width = `${latest.score}%`;
$('score-note').textContent = latest.body.split('\n\n')[0];
$('week-title').textContent = latest.title;
$('model').textContent = latest.model;
$('model-note').textContent = latest.model_note;
$('updated').textContent = `Assessment · ${new Date(`${latest.date}T12:00:00`).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })}`;
$('scenario-marker').textContent = latest.scenario_marker;
$('scenario-date').textContent = latest.scenario_date;
$('reality-marker').textContent = latest.reality_marker;

const trackNames = { capabilities:'Model capabilities', automation:'AI R&D automation', compute:'Compute scale-up', geopolitics:'Race dynamics' };
$('tracks').innerHTML = Object.entries(trackNames).map(([key, label]) => `
  <div class="track"><div><span>${label}</span><b>${latest[key]}</b></div><div class="track-meter"><i style="width:${latest[key]}%"></i></div></div>
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
