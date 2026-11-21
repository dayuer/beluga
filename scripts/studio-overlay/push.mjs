const { views } = await import(new URL('../../packages/studio-app/e2e/fixtures/views.ts', import.meta.url).href);
const name = process.argv[2];
if (!views[name]) throw new Error('no view ' + name + ': ' + Object.keys(views).join(','));
const res = await fetch('http://127.0.0.1:8792/view', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: 'dp1', view: views[name] }) });
console.log('push', name, res.status);
