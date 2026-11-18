const STORAGE_KEY = 'plata.local.v1';
const ACCOUNT_SEEDS = [{ id: 'checking', name: 'Compte courant', kind: 'Compte courant', icon: '▤', balance: 0 }, { id: 'savings', name: 'Livret épargne', kind: 'Épargne', icon: '◈', balance: 0 }];
const DEFAULT_CATEGORIES = ['Salaire', 'Revenus locatifs', 'Remboursement', 'Autres revenus', 'Logement', 'Alimentation', 'Transport', 'Assurance', 'Impôts', 'Abonnements', 'Santé', 'Loisirs', 'Autres dépenses'];
const TYPE_INFO = {
  income: { label: 'Entrée d’argent', icon: '↙', category: 'Salaire' },
  card: { label: 'Carte bancaire', icon: '▣', category: 'Alimentation' },
  'direct-debit': { label: 'Prélèvement', icon: '↗', category: 'Logement' },
  withdrawal: { label: 'Retrait', icon: '↗', category: 'Autres dépenses' },
  transfer: { label: 'Virement', icon: '⇄', category: 'Virement' },
  savings: { label: 'Épargne', icon: '◈', category: 'Épargne' }
};
const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const dateFormatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const monthFormatter = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
let state = loadState();
let displayedMonth = new Date();
displayedMonth.setDate(1);

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored && Array.isArray(stored.accounts) && Array.isArray(stored.operations)) return { ...stored, categories: Array.isArray(stored.categories) ? stored.categories : [...DEFAULT_CATEGORIES] };
  } catch (error) { console.warn('Impossible de lire les données locales.', error); }
  return { accounts: ACCOUNT_SEEDS.map(account => ({ ...account })), operations: [], categories: [...DEFAULT_CATEGORIES] };
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function money(value) { return euro.format(value || 0); }
function toMonthKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
function operationDate(operation) { return new Date(`${operation.date}T12:00:00`); }
function escapeHTML(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function accountName(id) { return state.accounts.find(account => account.id === id)?.name || 'Compte supprimé'; }
function isInternal(operation) { return operation.type === 'transfer' || operation.type === 'savings'; }
function signedEffect(operation, accountId) {
  const amount = Number(operation.amount) || 0;
  if (operation.accountId === accountId) return operation.type === 'income' ? amount : -amount;
  if (isInternal(operation) && operation.destinationAccountId === accountId) return amount;
  return 0;
}
function dateEndOfMonth(date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999); }
function accountBalance(account, monthEnd, planned) {
  return Number(account.balance || 0) + state.operations.reduce((total, operation) => {
    const date = operationDate(operation);
    if (date > monthEnd || (!planned && operation.status !== 'realized')) return total;
    return total + signedEffect(operation, account.id);
  }, 0);
}
function render() {
  const monthKey = toMonthKey(displayedMonth);
  const monthEnd = dateEndOfMonth(displayedMonth);
  document.getElementById('month-label').textContent = monthFormatter.format(displayedMonth);
  const monthOperations = state.operations.filter(operation => operation.date.startsWith(monthKey)).sort((a, b) => a.date.localeCompare(b.date));
  const filtered = document.getElementById('operation-filter')?.value || 'all';
  const shown = monthOperations.filter(operation => filtered === 'all' || operation.status === filtered);
  const forecast = state.accounts.reduce((total, account) => total + accountBalance(account, monthEnd, true), 0);
  const actual = state.accounts.reduce((total, account) => total + accountBalance(account, monthEnd, false), 0);
  document.getElementById('forecast-total').textContent = money(forecast);
  document.getElementById('actual-total').textContent = money(actual);
  const upcoming = monthOperations.filter(operation => operation.status !== 'realized');
  document.getElementById('upcoming-total').textContent = money(upcoming.reduce((total, operation) => total + (isInternal(operation) ? 0 : (operation.type === 'income' ? 1 : -1) * Number(operation.amount)), 0));
  document.getElementById('upcoming-count').textContent = upcoming.length ? `${upcoming.length} opération${upcoming.length > 1 ? 's' : ''} prévue${upcoming.length > 1 ? 's' : ''}` : 'Aucune opération prévue';
  const accountsList = document.getElementById('accounts-list');
  accountsList.innerHTML = state.accounts.map(account => `<div class="account-row"><span class="account-avatar">${escapeHTML(account.icon || '▤')}</span><div class="account-meta"><strong>${escapeHTML(account.name)}</strong><span>Solde au ${escapeHTML(dateFormatter.format(new Date()))}</span></div><strong class="account-balance">${money(accountBalance(account, monthEnd, false))}</strong></div>`).join('');
  document.getElementById('accounts-total').textContent = money(actual);
  const incomes = monthOperations.filter(operation => operation.type === 'income').reduce((sum, operation) => sum + Number(operation.amount), 0);
  const expenses = monthOperations.filter(operation => !isInternal(operation) && operation.type !== 'income').reduce((sum, operation) => sum + Number(operation.amount), 0);
  const internal = monthOperations.filter(isInternal).reduce((sum, operation) => sum + Number(operation.amount), 0);
  document.getElementById('month-income').textContent = money(incomes);
  document.getElementById('month-expenses').textContent = money(expenses);
  document.getElementById('month-transfers').textContent = money(internal);
  document.getElementById('activity-count').textContent = `${monthOperations.length} opération${monthOperations.length === 1 ? '' : 's'}`;
  const list = document.getElementById('transactions-list');
  const empty = document.getElementById('empty-state');
  list.innerHTML = shown.map(operation => {
    const info = TYPE_INFO[operation.type] || TYPE_INFO.card;
    const amountPrefix = operation.type === 'income' ? '+' : isInternal(operation) ? '⇄ ' : '−';
    const destination = isInternal(operation) ? ` → ${accountName(operation.destinationAccountId)}` : '';
    return `<article class="transaction-row"><span class="transaction-symbol">${info.icon}</span><div class="transaction-name"><strong>${escapeHTML(operation.title)}</strong><span>${escapeHTML(info.label)} · ${escapeHTML(accountName(operation.accountId))}${escapeHTML(destination)}</span></div><span class="transaction-category">${escapeHTML(operation.category || info.label)}</span><time class="transaction-date" datetime="${escapeHTML(operation.date)}">${escapeHTML(dateFormatter.format(operationDate(operation)))}</time><strong class="transaction-amount ${operation.type === 'income' ? 'positive' : ''}">${amountPrefix}${money(Number(operation.amount))}</strong><button class="status-button ${operation.status === 'realized' ? 'realized' : ''}" type="button" data-toggle="${escapeHTML(operation.id)}" aria-label="${operation.status === 'realized' ? 'Marquer comme prévue' : 'Marquer comme réalisée'}">${operation.status === 'realized' ? 'Réalisée' : 'Prévue'}</button><button class="delete-button" type="button" data-delete="${escapeHTML(operation.id)}" aria-label="Supprimer ${escapeHTML(operation.title)}">×</button></article>`;
  }).join('');
  empty.hidden = shown.length > 0;
  list.hidden = shown.length === 0;
  document.getElementById('source-account').innerHTML = state.accounts.map(account => `<option value="${escapeHTML(account.id)}">${escapeHTML(account.name)}</option>`).join('');
  document.getElementById('destination-account').innerHTML = state.accounts.map(account => `<option value="${escapeHTML(account.id)}">${escapeHTML(account.name)}</option>`).join('');
  renderCategories();
}
function renderCategories() {
  const type = document.getElementById('operation-type').value;
  const categorySelect = document.getElementById('operation-category');
  const isTransferType = type === 'transfer' || type === 'savings';
  document.getElementById('category-field').classList.toggle('hidden', isTransferType);
  categorySelect.innerHTML = state.categories.map(category => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`).join('');
  const suggested = TYPE_INFO[type]?.category;
  if (suggested && state.categories.includes(suggested)) categorySelect.value = suggested;
}
function openOperationDialog() {
  const form = document.getElementById('operation-form');
  form.reset();
  const now = new Date();
  document.getElementById('operation-date').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  document.getElementById('occurrences-field').classList.add('hidden');
  document.getElementById('operation-dialog').showModal();
  renderCategories();
  updateTypeFields();
}
function updateTypeFields() {
  const type = document.getElementById('operation-type').value;
  const internal = type === 'transfer' || type === 'savings';
  document.getElementById('destination-account-field').classList.toggle('hidden', !internal);
  document.getElementById('operation-recurring').disabled = internal;
  document.getElementById('operation-recurring').checked = false;
  document.getElementById('occurrences-field').classList.add('hidden');
  document.getElementById('type-hint').textContent = internal ? 'Choisissez le compte de destination. Ce mouvement ne modifie pas la trésorerie totale.' : type === 'income' ? 'Une entrée augmente automatiquement le solde du compte choisi.' : 'Cette opération diminue automatiquement le solde du compte choisi.';
  renderCategories();
}
function addMonths(dateString, count) {
  const [year, month, day] = dateString.split('-').map(Number);
  const firstOfTarget = new Date(year, month - 1 + count, 1);
  const lastDay = new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth() + 1, 0).getDate();
  return `${firstOfTarget.getFullYear()}-${String(firstOfTarget.getMonth() + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}
function makeId() { return globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function submitOperation(event) {
  event.preventDefault();
  const type = document.getElementById('operation-type').value;
  const recurring = document.getElementById('operation-recurring').checked;
  const count = recurring ? Number(document.getElementById('operation-occurrences').value) : 1;
  const date = document.getElementById('operation-date').value;
  const amount = Math.round(Number(document.getElementById('operation-amount').value) * 100) / 100;
  const sourceId = document.getElementById('source-account').value;
  const destinationId = document.getElementById('destination-account').value;
  if (!date || amount <= 0 || !sourceId || ((type === 'transfer' || type === 'savings') && (!destinationId || sourceId === destinationId))) {
    alert('Vérifiez les informations saisies et choisissez deux comptes différents pour un virement ou une épargne.');
    return;
  }
  for (let index = 0; index < count; index += 1) {
    state.operations.push({
      id: makeId(), type, amount, date: addMonths(date, index),
      accountId: sourceId,
      destinationAccountId: type === 'transfer' || type === 'savings' ? destinationId : null,
      category: type === 'transfer' || type === 'savings' ? TYPE_INFO[type].label : document.getElementById('operation-category').value,
      title: document.getElementById('operation-title').value.trim(),
      status: document.getElementById('operation-realized').checked && index === 0 ? 'realized' : 'planned',
      seriesId: recurring ? (state.operations.length ? state.operations[state.operations.length - 1].seriesId || makeId() : makeId()) : null
    });
  }
  saveState();
  document.getElementById('operation-dialog').close();
  render();
}
function showBalancesDialog() {
  const fields = document.getElementById('balance-fields');
  fields.innerHTML = state.accounts.map(account => `<label class="field">${escapeHTML(account.name)} (€)<input type="number" step="0.01" data-balance="${escapeHTML(account.id)}" value="${Number(account.balance || 0).toFixed(2)}" required></label>`).join('');
  document.getElementById('balances-dialog').showModal();
}
function changeMonth(offset) { displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() + offset, 1); render(); }

document.getElementById('previous-month').addEventListener('click', () => changeMonth(-1));
document.getElementById('next-month').addEventListener('click', () => changeMonth(1));
document.getElementById('current-month').addEventListener('click', () => { displayedMonth = new Date(); displayedMonth.setDate(1); render(); });
document.getElementById('open-operation').addEventListener('click', openOperationDialog);
document.getElementById('empty-add').addEventListener('click', openOperationDialog);
document.getElementById('close-dialog').addEventListener('click', () => document.getElementById('operation-dialog').close());
document.getElementById('cancel-dialog').addEventListener('click', () => document.getElementById('operation-dialog').close());
document.getElementById('operation-type').addEventListener('change', updateTypeFields);
document.getElementById('operation-recurring').addEventListener('change', event => document.getElementById('occurrences-field').classList.toggle('hidden', !event.target.checked));
document.getElementById('operation-form').addEventListener('submit', submitOperation);
document.getElementById('operation-filter').addEventListener('change', render);
document.getElementById('edit-balances').addEventListener('click', showBalancesDialog);
document.getElementById('close-balances').addEventListener('click', () => document.getElementById('balances-dialog').close());
document.getElementById('cancel-balances').addEventListener('click', () => document.getElementById('balances-dialog').close());
document.getElementById('balances-form').addEventListener('submit', event => {
  event.preventDefault();
  document.querySelectorAll('[data-balance]').forEach(input => {
    const account = state.accounts.find(item => item.id === input.dataset.balance);
    if (account) account.balance = Math.round(Number(input.value) * 100) / 100;
  });
  saveState();
  document.getElementById('balances-dialog').close();
  render();
});
document.getElementById('transactions-list').addEventListener('click', event => {
  const toggleButton = event.target.closest('[data-toggle]');
  const deleteButton = event.target.closest('[data-delete]');
  if (toggleButton) {
    const operation = state.operations.find(item => item.id === toggleButton.dataset.toggle);
    if (operation) operation.status = operation.status === 'realized' ? 'planned' : 'realized';
    saveState(); render();
  }
  if (deleteButton && confirm('Supprimer cette opération ?')) {
    state.operations = state.operations.filter(item => item.id !== deleteButton.dataset.delete);
    saveState(); render();
  }
});
window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) { state = loadState(); render(); } });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker non enregistré.', error)));
}
render();
