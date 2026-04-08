const https = require('https');
(async () => {
    const htmlRes = await fetch('https://lumina-j0uk8cqt3-zjttdingrouyin-3271s-projects.vercel.app');
    const html = await htmlRes.text();
    const scriptMatch = html.match(/<script type="module" crossorigin src="(.*?)">/);
    if (!scriptMatch) return console.log('no script found');
    const jsUrl = new URL(scriptMatch[1], 'https://lumina-j0uk8cqt3-zjttdingrouyin-3271s-projects.vercel.app').href;
    console.log('Fetching', jsUrl);
    const jsRes = await fetch(jsUrl);
    const js = await jsRes.text();
    if (js.includes('handleHeaderMove') && js.includes('e.target===panelRef.current')) {
        console.log('✅ Fix is present in prod bundle');
    } else {
        console.log('❌ Fix is MISSING in prod bundle');
    }
})();
