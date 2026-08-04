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
  const resultFrame = document.querySelector('iframe[name="contact-frame"]');
  const t = window.t || ((en) => en);
  const maxAttachBytes = 10 * 1024 * 1024;
  let submitted = false;

  // File uploads only work via a real multipart POST (FormSubmit's AJAX/JSON
  // endpoint rejects them), so this submits natively into a hidden iframe
  // instead of using fetch. That means the response body can't be read back —
  // "load" fires the same for a FormSubmit success page as an error page, so
  // the confirmation below is optimistic, not a verified delivery receipt.
  contactForm.addEventListener("submit", (event) => {
    if (contactForm.elements._honey.value) {
      event.preventDefault();
      return;
    }

    const attachBytes = Array.from(contactForm.elements.attachment.files).reduce(
      (sum, file) => sum + file.size,
      0
    );
    if (attachBytes > maxAttachBytes) {
      event.preventDefault();
      status.className = "form-status err";
      status.textContent = t("Attachment too large — 10MB max.", "Ek çok büyük — en fazla 10MB.");
      return;
    }

    submitted = true;
    submitBtn.disabled = true;
    status.className = "form-status";
    status.textContent = t("Sending…", "Gönderiliyor…");
  });

  resultFrame.addEventListener("load", () => {
    if (!submitted) return;
    submitted = false;
    submitBtn.disabled = false;
    status.className = "form-status ok";
    status.textContent = t("Sent — I'll get back to you soon.", "Gönderildi — en kısa sürede dönüş yapacağım.");
    contactForm.reset();
  });
}
