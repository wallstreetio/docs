document.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-feedback-form]");
  if (!form) return;

  event.preventDefault();

  if (!form.reportValidity()) return;

  const container = form.closest("[data-feedback-form-container]");
  if (!container) return;

  const data = Object.fromEntries(new FormData(form));
  fetch(form.action, {
    method: form.method,
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(data),
  }).catch((error) => {
    console.error("Feedback submission failed:", error);
  });

  container.innerHTML = "<p>Thank you for your feedback!</p>";
});
