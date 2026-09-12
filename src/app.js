/* Shared navigation and UI helpers. Project content is populated by platform.js. */
const state = { page: 'analysis', selectedIssue: null, actions: [], toastTimer: null };
const issues = [];
const risks = [];
const pages = {};
function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c])); }
function pageHead(eyebrow, title, sub, actions = '') {
  return `<div class="page-head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><div class="page-sub">${sub}</div></div><div class="head-actions">${actions}</div></div>`;
}
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message; toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), 4200);
}
function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }
function bindPage() {
  document.querySelectorAll('[data-page],[data-go]').forEach(button => button.onclick = () => {
    state.page = button.dataset.page || button.dataset.go; render();
  });
  document.querySelectorAll('[data-import]').forEach(button => button.onclick = showImport);
  document.querySelectorAll('[data-settings]').forEach(button => button.onclick = showSettings);
  document.querySelectorAll('[data-close]').forEach(button => button.onclick = closeModal);
}
