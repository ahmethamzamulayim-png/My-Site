// Site-wide language helpers. Each page's language is now fixed - real
// static HTML per language, each at its own URL (bare = English, /tr/ =
// Turkish) - declared by <html lang="en|tr">. This just exposes
// t()/fmt()/getLang() for pages that render content at runtime (live data,
// charts, tooltips) so that code keeps picking the right language without
// re-detecting it everywhere.
// Load this script synchronously in <head> so inline page scripts can use t().
(function () {
  const lang = document.documentElement.lang === "tr" ? "tr" : "en";
  window.getLang = () => lang;
  window.t = (en, tr) => (lang === "tr" ? tr : en);
  window.fmt = (n) => (n ?? 0).toLocaleString(lang === "tr" ? "tr-TR" : "en-US");
})();
