import './style.css'

document.addEventListener("DOMContentLoaded", () => {
  // Show page after brief delay
  setTimeout(() => {
    document.body.style.opacity = '1';
  }, 100);

  const observerOptions = {
    threshold: 0.15,
    rootMargin: "0px 0px -50px 0px"
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("reveal-visible");
      }
    });
  }, observerOptions);

  document.querySelectorAll(".reveal").forEach(el => {
    observer.observe(el);
  });
});
