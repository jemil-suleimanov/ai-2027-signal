export const sourceKinds = [
  'Scenario reference',
  'Government source',
  'Independent research',
  'News reporting',
  'Research paper',
  'First-party',
  'Other source'
];

const sourceHosts = {
  'Scenario reference': new Set(['ai-2027.com', 'lesswrong.com']),
  'Government source': new Set(['cisa.gov']),
  'Independent research': new Set(['artificialanalysis.ai', 'arcprize.org', 'epoch.ai', 'metr.org', 'transluce.org']),
  'News reporting': new Set(['apnews.com', 'reuters.com']),
  'Research paper': new Set(['arxiv.org']),
  'First-party': new Set(['anthropic.com', 'api-docs.deepseek.com', 'huggingface.co', 'kimi.com', 'news.samsung.com', 'nvidianews.nvidia.com', 'openai.com', 'thinkingmachines.ai'])
};

export function describeSource(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return Object.entries(sourceHosts).find(([, hosts]) => hosts.has(host))?.[0] || 'Other source';
  } catch {
    return 'Other source';
  }
}
