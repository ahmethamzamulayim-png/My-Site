const yearElement = document.getElementById("year");
const revealElements = document.querySelectorAll("[data-reveal]");

if (yearElement) {
  yearElement.textContent = `© ${new Date().getFullYear()} Ahmet Hamza Mülayim`;
}

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.16 }
  );

  revealElements.forEach((element) => observer.observe(element));
} else {
  revealElements.forEach((element) => element.classList.add("visible"));
}

const contactForm = document.getElementById("contact-form");
if (contactForm) {
  const status = contactForm.querySelector(".form-status");
  const submitBtn = contactForm.querySelector("button[type=submit]");
  const t = window.t || ((en) => en);

  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (contactForm.elements._honey.value) return;

    submitBtn.disabled = true;
    status.className = "form-status";
    status.textContent = t("Sending…", "Gönderiliyor…");

    try {
      const res = await fetch("https://formsubmit.co/ajax/ahmet.mulayim@marun.edu.tr", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          name: contactForm.elements.name.value,
          email: contactForm.elements.email.value,
          message: contactForm.elements.message.value,
          _subject: "New message from ahmethmzamlym.engineer",
          _template: "table",
          _captcha: "false",
        }),
      });
      if (!res.ok) throw new Error("request failed");
      status.classList.add("ok");
      status.textContent = t("Sent — I'll get back to you soon.", "Gönderildi — en kısa sürede dönüş yapacağım.");
      contactForm.reset();
    } catch {
      status.classList.add("err");
      status.textContent = t(
        "Something went wrong — email me directly instead.",
        "Bir şeyler ters gitti — bunun yerine doğrudan e-posta gönder."
      );
    } finally {
      submitBtn.disabled = false;
    }
  });
}
