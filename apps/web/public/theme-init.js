// Apply the saved theme before first paint so there is no flash. Dark is the default look.
(function () {
  var pref = 'dark';
  try { pref = localStorage.getItem('spendly-theme') || 'dark'; } catch (e) {}
  var dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  var root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.dataset.theme = dark ? 'dark' : 'light';
  try {
    var face = localStorage.getItem('spendly-typeface');
    if (/^(studio|jakarta|grotesk)$/.test(face)) root.dataset.typeface = face;
  } catch (e) {}
  var meta = document.querySelectorAll('meta[name="theme-color"]');
  meta.forEach(function (m) { m.setAttribute('content', dark ? '#08090B' : '#F5F6FA'); m.removeAttribute('media'); });
})();
