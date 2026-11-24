// Break out of the Shopify admin iframe to run the install (OAuth) in the top window.
const a = document.getElementById('go');
if (a) { try { window.top.location.href = new URL(a.getAttribute('href'), window.location.href).href; } catch { a.click(); } }
