/* meridian shell behaviors — mobile sidebar toggle. */
(function () {
  var app = document.getElementById('app');
  var btn = document.getElementById('menuBtn');
  if (btn && app) {
    btn.addEventListener('click', function () { app.classList.toggle('menu-open'); });
    document.addEventListener('click', function (e) {
      if (!app.classList.contains('menu-open')) return;
      if (e.target.closest('.sidebar') || e.target.closest('#menuBtn')) return;
      app.classList.remove('menu-open');
    });
  }
})();
