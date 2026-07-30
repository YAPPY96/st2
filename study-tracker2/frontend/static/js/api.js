async function api(path, method='GET', body=null) {
    const url = '/api' + path;
    const opts = {method, headers:{'Content-Type':'application/json'}};
    if (body !== null) opts.body = JSON.stringify(body);
    try {
        const r = await fetch(url, opts);
        if (!r.ok) {
            const errText = await r.text();
            console.error(`API Error: ${method} ${url} -> ${r.status}`, errText);
            throw new Error(`HTTP ${r.status}: ${errText}`);
        }
        const data = await r.json();
        return data;
    } catch (e) {
        console.error(`Fetch error for ${method} ${url}:`, e);
        throw e;
    }
}
