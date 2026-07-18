// Site-wide EN/TR switch. Each page keeps its base-language text in the HTML
// and declares translations into the other language before </body>:
//   window.I18N_LANG = "tr";        // the language the dict translates INTO
//   window.I18N = { key: "html" };  // innerHTML replacement per data-i18n key
// Elements opt in with data-i18n="key" (data-i18n-placeholder for inputs).
// The chosen language persists in localStorage and follows across pages.
// Load this script synchronously in <head> so inline page scripts can use t().
(function () {
  let lang;
  try { lang = localStorage.getItem("site-lang"); } catch {}
  if (!lang) lang = (navigator.language || "").toLowerCase().startsWith("tr") ? "tr" : "en";

  window.getLang = () => lang;
  window.t = (en, tr) => (lang === "tr" ? tr : en);
  window.fmt = (n) => (n ?? 0).toLocaleString(lang === "tr" ? "tr-TR" : "en-US");

  function apply() {
    const dict = window.I18N || {};
    const toOther = lang === window.I18N_LANG;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      if (el.dataset.orig === undefined) el.dataset.orig = el.innerHTML;
      const v = dict[el.dataset.i18n];
      el.innerHTML = toOther && v !== undefined ? v : el.dataset.orig;
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      if (el.dataset.origPh === undefined) el.dataset.origPh = el.placeholder;
      const v = dict[el.dataset.i18nPlaceholder];
      el.placeholder = toOther && v !== undefined ? v : el.dataset.origPh;
    });
    document.documentElement.lang = lang;
    document.querySelectorAll(".lang-toggle").forEach((b) => {
      b.textContent = lang === "tr" ? "EN" : "TR";
      b.setAttribute("aria-label", lang === "tr" ? "Switch to English" : "Türkçeye geç");
    });
    document.dispatchEvent(new CustomEvent("langchange", { detail: lang }));
  }

  window.setLang = (l) => {
    lang = l;
    try { localStorage.setItem("site-lang", l); } catch {}
    apply();
  };

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".lang-toggle").forEach((b) =>
      b.addEventListener("click", () => setLang(lang === "tr" ? "en" : "tr")));
    apply();
  });
})();
