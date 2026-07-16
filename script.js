const yearElement = document.getElementById("year");
const revealElements = document.querySelectorAll("[data-reveal]");
const gaugeFill = document.querySelector(".gauge-fill");
const gaugeCenter = document.querySelector(".gauge-center strong");

if (yearElement) {
  yearElement.textContent = `© ${new Date().getFullYear()} Ahmet Hamza Mülayim`;
}

if (gaugeFill) {
  const circumference = 2 * Math.PI * 84;
  const dashOffset = circumference - 0.87 * circumference; // decorative arc
  gaugeFill.style.strokeDasharray = `${circumference}`;
  gaugeFill.style.strokeDashoffset = `${dashOffset}`;
}

if (gaugeCenter) {
  const targetValue = Number(gaugeCenter.textContent) || 0;
  let currentValue = 0;

  const animate = () => {
    currentValue += 1;
    gaugeCenter.textContent = currentValue;
    if (currentValue < targetValue) {
      requestAnimationFrame(animate);
    }
  };

  requestAnimationFrame(animate);
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
