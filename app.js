'use strict';

/* ==========================================================================
   Plata — gestion de comptes personnels
   Un seul fichier : données, calculs, affichage, administration.
   ========================================================================== */

/* ---------- Constantes ---------- */
const STORAGE_KEY = 'plata.local.v1';
const ACCOUNT_SEEDS = [
  { id: 'checking', name: 'Compte courant', kind: 'Compte courant', icon: '▤', balance: 0 },
  { id: 'savings', name: 'Livret épargne', kind: 'Épargne', icon: '◈', balance: 0 }
];
const ACCOUNT_ICONS = { 'Compte courant': '▤', 'Épargne': '◈', 'Autre compte': '◫' };
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

/* ---------- Petits outils ---------- */
const $ = id => document.getElementById(id);
const sameName = (a, b) => a.toLocaleLowerCase('fr') === b.toLocaleLowerCase('fr');
function money(value) { return euro.format(value || 0); }
function toMonthKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
function operationDate(operation) { return new Date(`${operation.date}T12:00:00`); }
function escapeHTML(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function makeId() { return globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function dateEndOfMonth(date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999); }
function addMonths(dateString, count) {
  const [year, month, day] = dateString.split('-').map(Number);
  const firstOfTarget = new Date(year, month - 1 + count, 1);
  const lastDay = new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth() + 1, 0).getDate();
  return `${firstOfTarget.getFullYear()}-${String(firstOfTarget.getMonth() + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

/* ---------- Données ---------- */
let state = loadState();
let displayedMonth = new Date();
displayedMonth.setDate(1);
let editingCategory = null; // nom de la catégorie en cours de modification

// Remet les données lues dans le navigateur au bon format (et reprend l'ancien format).
function normalizeState(stored) {
  const data = {
    accounts: stored.accounts.map(account => ({ ...account })),
    operations: stored.operations.map(operation => ({ ...operation })),
    categories: Array.isArray(stored.categories) ? stored.categories.filter(c => typeof c === 'string' && c.trim()) : [...DEFAULT_CATEGORIES],
    adminDefaultAccountId: typeof stored.adminDefaultAccountId === 'string' ? stored.adminDefaultAccountId : ''
  };
  // Les anciens « types personnalisés » n'existent plus : l'opération redevient
  // une carte bancaire (dépense) ou une entrée d'argent (crédit), sa catégorie est conservée.
  data.operations.forEach(operation => {
    if (typeof operation.type === 'string' && operation.type.startsWith('custom-')) {
      const credit = operation.customKind === 'credit' || operation.type.startsWith('custom-credit');
      operation.type = credit ? 'income' : 'card';
      delete operation.customKind;
    }
    if (operation.category && !data.categories.some(c => sameName(c, operation.category)) && !isInternal(operation)) {
      data.categories.push(operation.category);
    }
  });
  return data;
}
function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored && Array.isArray(stored.accounts) && Array.isArray(stored.operations)) return normalizeState(stored);
  } catch (error) { console.warn('Impossible de lire les données locales.', error); }
  return { accounts: ACCOUNT_SEEDS.map(account => ({ ...account })), operations: [], categories: [...DEFAULT_CATEGORIES], adminDefaultAccountId: '' };
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

/* ---------- Règles de calcul ---------- */
function isInternal(operation) { return operation.type === 'transfer' || operation.type === 'savings'; }
function accountName(id) { return state.accounts.find(account => account.id === id)?.name || 'Compte supprimé'; }
function touchesAccount(operation, accountId) {
  return operation.accountId === accountId || (isInternal(operation) && operation.destinationAccountId === accountId);
}
// Effet d'une opération sur le solde d'un compte (+ ou −).
function signedEffect(operation, accountId) {
  const amount = Number(operation.amount) || 0;
  if (operation.accountId === accountId) return operation.type === 'income' ? amount : -amount;
  if (isInternal(operation) && operation.destinationAccountId === accountId) return amount;
  return 0;
}
// planned = true : solde prévisionnel (tout) ; false : solde réalisé (opérations réalisées seulement).
function accountBalance(account, monthEnd, planned) {
  return Number(account.balance || 0) + state.operations.reduce((total, operation) => {
    if (operationDate(operation) > monthEnd || (!planned && operation.status !== 'realized')) return total;
    return total + signedEffect(operation, account.id);
  }, 0);
}
// « Compte affiché au lancement » (Administration) : un seul compte, ou tous.
function selectedAccountId() {
  return state.accounts.some(account => account.id === state.adminDefaultAccountId) ? state.adminDefaultAccountId : '';
}
function visibleAccounts() {
  const id = selectedAccountId();
  return id ? state.accounts.filter(account => account.id === id) : state.accounts;
}
function visibleOperations() {
  const id = selectedAccountId();
  return id ? state.operations.filter(operation => touchesAccount(operation, id)) : state.operations;
}

/* ---------- Affichage : tableau de bord ---------- */
function render() {
  const monthKey = toMonthKey(displayedMonth);
  const monthEnd = dateEndOfMonth(displayedMonth);
  $('month-label').textContent = monthFormatter.format(displayedMonth);

  const accounts = visibleAccounts();
  const monthOperations = visibleOperations().filter(operation => operation.date.startsWith(monthKey)).sort((a, b) => a.date.localeCompare(b.date));
  const filter = $('operation-filter').value || 'all';
  const shown = monthOperations.filter(operation => filter === 'all' || operation.status === filter);

  const forecast = accounts.reduce((total, account) => total + accountBalance(account, monthEnd, true), 0);
  const actual = accounts.reduce((total, account) => total + accountBalance(account, monthEnd, false), 0);
  $('forecast-total').textContent = money(forecast);
  $('actual-total').textContent = money(actual);
  $('accounts-total').textContent = money(actual);

  const upcoming = monthOperations.filter(operation => operation.status !== 'realized');
  $('upcoming-total').textContent = money(upcoming.reduce((total, operation) => total + (isInternal(operation) ? 0 : (operation.type === 'income' ? 1 : -1) * Number(operation.amount)), 0));
  $('upcoming-count').textContent = upcoming.length ? `${upcoming.length} opération${upcoming.length > 1 ? 's' : ''} prévue${upcoming.length > 1 ? 's' : ''}` : 'Aucune opération prévue';

  $('accounts-list').innerHTML = accounts.map(account => `<div class="account-row"><span class="account-avatar">${escapeHTML(account.icon || '▤')}</span><div class="account-meta"><strong>${escapeHTML(account.name)}</strong><span>Solde au ${escapeHTML(dateFormatter.format(new Date()))}</span></div><strong class="account-balance">${money(accountBalance(account, monthEnd, false))}</strong></div>`).join('');

  const sum = list => list.reduce((total, operation) => total + Number(operation.amount), 0);
  $('month-income').textContent = money(sum(monthOperations.filter(operation => operation.type === 'income')));
  $('month-expenses').textContent = money(sum(monthOperations.filter(operation => !isInternal(operation) && operation.type !== 'income')));
  $('month-transfers').textContent = money(sum(monthOperations.filter(isInternal)));
  $('activity-count').textContent = `${monthOperations.length} opération${monthOperations.length === 1 ? '' : 's'}`;

  $('transactions-list').innerHTML = shown.map(operation => {
    const info = TYPE_INFO[operation.type] || TYPE_INFO.card;
    const prefix = operation.type === 'income' ? '+' : isInternal(operation) ? '⇄ ' : '−';
    const destination = isInternal(operation) ? ` → ${accountName(operation.destinationAccountId)}` : '';
    return `<article class="transaction-row"><span class="transaction-symbol">${info.icon}</span><div class="transaction-name"><strong>${escapeHTML(operation.title)}</strong><span>${escapeHTML(info.label)} · ${escapeHTML(accountName(operation.accountId))}${escapeHTML(destination)}</span></div><span class="transaction-category">${escapeHTML(operation.category || info.label)}</span><time class="transaction-date" datetime="${escapeHTML(operation.date)}">${escapeHTML(dateFormatter.format(operationDate(operation)))}</time><strong class="transaction-amount ${operation.type === 'income' ? 'positive' : ''}">${prefix}${money(Number(operation.amount))}</strong><button class="status-button ${operation.status === 'realized' ? 'realized' : ''}" type="button" data-toggle="${escapeHTML(operation.id)}" aria-label="${operation.status === 'realized' ? 'Marquer comme prévue' : 'Marquer comme réalisée'}">${operation.status === 'realized' ? 'Réalisée' : 'Prévue'}</button><button class="delete-button" type="button" data-delete="${escapeHTML(operation.id)}" aria-label="Supprimer ${escapeHTML(operation.title)}">×</button></article>`;
  }).join('');
  $('empty-state').hidden = shown.length > 0;
  $('transactions-list').hidden = shown.length === 0;

  // Listes de comptes du formulaire : le compte source suit l'affichage choisi ;
  // le compte destinataire d'un virement propose toujours tous les comptes.
  const optionsFor = list => list.map(account => `<option value="${escapeHTML(account.id)}">${escapeHTML(account.name)}</option>`).join('');
  $('source-account').innerHTML = optionsFor(accounts);
  $('destination-account').innerHTML = optionsFor(state.accounts);
  renderCategories();
  renderAdmin();
}

/* ---------- Formulaire d'opération ---------- */
function renderCategories() {
  const type = $('operation-type').value;
  const select = $('operation-category');
  const previous = select.value;
  $('category-field').classList.toggle('hidden', isInternal({ type }));
  select.innerHTML = state.categories.map(category => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`).join('');
  const suggested = TYPE_INFO[type]?.category;
  if (suggested && state.categories.includes(suggested)) select.value = suggested;
  else if (previous && state.categories.includes(previous)) select.value = previous;
}
function updateTypeFields() {
  const type = $('operation-type').value;
  const internal = isInternal({ type });
  $('destination-account-field').classList.toggle('hidden', !internal);
  $('operation-recurring').disabled = internal;
  $('operation-recurring').checked = false;
  $('occurrences-field').classList.add('hidden');
  $('type-hint').textContent = internal ? 'Choisissez le compte de destination. Ce mouvement ne modifie pas la trésorerie totale.' : type === 'income' ? 'Une entrée augmente automatiquement le solde du compte choisi.' : 'Cette opération diminue automatiquement le solde du compte choisi.';
  renderCategories();
}
function openOperationDialog() {
  $('operation-form').reset();
  const now = new Date();
  $('operation-date').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  $('occurrences-field').classList.add('hidden');
  $('operation-dialog').showModal();
  updateTypeFields();
}
function submitOperation(event) {
  event.preventDefault();
  const type = $('operation-type').value;
  const internal = isInternal({ type });
  const recurring = $('operation-recurring').checked;
  const count = recurring ? Number($('operation-occurrences').value) : 1;
  const date = $('operation-date').value;
  const amount = Math.round(Number($('operation-amount').value) * 100) / 100;
  const sourceId = $('source-account').value;
  const destinationId = $('destination-account').value;
  if (!date || !(amount > 0) || !sourceId || (internal && (!destinationId || sourceId === destinationId))) {
    alert('Vérifiez les informations saisies et choisissez deux comptes différents pour un virement ou une épargne.');
    return;
  }
  if (recurring && !(Number.isInteger(count) && count >= 2 && count <= 120)) {
    alert('Le nombre d’occurrences doit être compris entre 2 et 120.');
    return;
  }
  const seriesId = recurring ? makeId() : null;
  for (let index = 0; index < count; index += 1) {
    state.operations.push({
      id: makeId(), type, amount, date: addMonths(date, index),
      accountId: sourceId,
      destinationAccountId: internal ? destinationId : null,
      category: internal ? TYPE_INFO[type].label : $('operation-category').value,
      title: $('operation-title').value.trim(),
      status: $('operation-realized').checked && index === 0 ? 'realized' : 'planned',
      seriesId
    });
  }
  saveState();
  $('operation-dialog').close();
  render();
}

/* ---------- Comptes (dialogues) ---------- */
function showBalancesDialog() {
  $('balance-fields').innerHTML = state.accounts.map(account => `<label class="field">${escapeHTML(account.name)} (€)<input type="number" step="0.01" data-balance="${escapeHTML(account.id)}" value="${Number(account.balance || 0).toFixed(2)}" required></label>`).join('');
  $('balances-dialog').showModal();
}
function openEditAccount(accountId) {
  const account = state.accounts.find(item => item.id === accountId);
  if (!account) return;
  $('edit-account-id').value = account.id;
  $('edit-account-name').value = account.name;
  $('edit-account-kind').value = account.kind || 'Autre compte';
  $('edit-account-dialog').showModal();
}

/* ---------- Administration ---------- */
function setAdminView(active) {
  $('dashboard').classList.toggle('admin-active', active);
  $('admin-nav-link').classList.toggle('active', active);
  $('nav-dashboard').classList.toggle('active', !active);
  if (active) renderAdmin();
}
function renderAdmin() {
  const current = selectedAccountId();
  $('admin-default-account').innerHTML = '<option value="">Tous les comptes</option>' + state.accounts.map(account => `<option value="${escapeHTML(account.id)}">${escapeHTML(account.name)}</option>`).join('');
  $('admin-default-account').value = current;

  $('admin-account-list').innerHTML = state.accounts.map(account => `<li><span><strong>${escapeHTML(account.name)}</strong><br><small>${escapeHTML(account.kind || 'Autre compte')} · ${money(Number(account.balance) || 0)}</small></span><span class="admin-row-actions"><button type="button" data-edit-account="${escapeHTML(account.id)}" aria-label="Modifier le compte ${escapeHTML(account.name)}">Modifier</button></span></li>`).join('');

  $('admin-category-list').innerHTML = state.categories.map((category, index) => {
    if (category === editingCategory) {
      return `<li class="editing"><input type="text" maxlength="40" value="${escapeHTML(category)}" data-category-input="${index}" aria-label="Nouveau nom de la catégorie ${escapeHTML(category)}"><span class="admin-row-actions"><button type="button" data-save-category="${index}">Enregistrer</button><button type="button" class="muted" data-cancel-category>Annuler</button></span></li>`;
    }
    const used = state.operations.filter(operation => operation.category === category).length;
    return `<li><span>${escapeHTML(category)}${used ? ` <small>· ${used} opération${used > 1 ? 's' : ''}</small>` : ''}</span><span class="admin-row-actions"><button type="button" data-edit-category="${index}" aria-label="Modifier la catégorie ${escapeHTML(category)}">Modifier</button><button type="button" data-remove-category="${index}" aria-label="Supprimer la catégorie ${escapeHTML(category)}">Supprimer</button></span></li>`;
  }).join('');
}

/* ---------- Écouteurs ---------- */
function changeMonth(offset) { displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() + offset, 1); render(); }

$('previous-month').addEventListener('click', () => changeMonth(-1));
$('next-month').addEventListener('click', () => changeMonth(1));
$('current-month').addEventListener('click', () => { displayedMonth = new Date(); displayedMonth.setDate(1); render(); });
$('open-operation').addEventListener('click', openOperationDialog);
$('empty-add').addEventListener('click', openOperationDialog);
$('close-dialog').addEventListener('click', () => $('operation-dialog').close());
$('cancel-dialog').addEventListener('click', () => $('operation-dialog').close());
$('operation-type').addEventListener('change', updateTypeFields);
$('operation-recurring').addEventListener('change', event => $('occurrences-field').classList.toggle('hidden', !event.target.checked));
$('operation-form').addEventListener('submit', submitOperation);
$('operation-filter').addEventListener('change', render);

$('transactions-list').addEventListener('click', event => {
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

// Soldes initiaux
$('close-balances').addEventListener('click', () => $('balances-dialog').close());
$('cancel-balances').addEventListener('click', () => $('balances-dialog').close());
$('balances-form').addEventListener('submit', event => {
  event.preventDefault();
  document.querySelectorAll('[data-balance]').forEach(input => {
    const account = state.accounts.find(item => item.id === input.dataset.balance);
    if (account) account.balance = Math.round(Number(input.value) * 100) / 100;
  });
  saveState(); $('balances-dialog').close(); render();
});

// Nouveau compte
$('close-new-account').addEventListener('click', () => $('new-account-dialog').close());
$('cancel-new-account').addEventListener('click', () => $('new-account-dialog').close());
$('new-account-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('new-account-name').value.trim();
  const kind = $('new-account-kind').value;
  if (!name) return;
  if (state.accounts.some(account => sameName(account.name, name))) { alert('Un compte porte déjà ce nom.'); return; }
  state.accounts.push({ id: `account-${makeId()}`, name, kind, icon: ACCOUNT_ICONS[kind] || '▤', balance: Math.round(Number($('new-account-balance').value || 0) * 100) / 100 });
  saveState(); $('new-account-dialog').close(); render();
});

// Modifier un compte
$('close-edit-account').addEventListener('click', () => $('edit-account-dialog').close());
$('cancel-edit-account').addEventListener('click', () => $('edit-account-dialog').close());
$('edit-account-form').addEventListener('submit', event => {
  event.preventDefault();
  const account = state.accounts.find(item => item.id === $('edit-account-id').value);
  const name = $('edit-account-name').value.trim();
  const kind = $('edit-account-kind').value;
  if (!account || !name) return;
  if (state.accounts.some(item => item.id !== account.id && sameName(item.name, name))) { alert('Un compte porte déjà ce nom.'); return; }
  account.name = name; account.kind = kind; account.icon = ACCOUNT_ICONS[kind] || '▤';
  saveState(); $('edit-account-dialog').close(); render();
});

// Administration : navigation
$('admin-nav-link').addEventListener('click', event => { event.preventDefault(); history.replaceState(null, '', '#admin'); setAdminView(true); window.scrollTo(0, 0); });
$('admin-back').addEventListener('click', () => { history.replaceState(null, '', location.pathname + location.search); setAdminView(false); });
document.querySelectorAll('.sidebar .nav-link:not(#admin-nav-link)').forEach(link => link.addEventListener('click', () => setAdminView(false)));
window.addEventListener('hashchange', () => setAdminView(location.hash === '#admin'));

// Administration : compte affiché et comptes
$('admin-default-account').addEventListener('change', event => { state.adminDefaultAccountId = event.target.value; saveState(); render(); });
$('admin-add-account').addEventListener('click', () => { $('new-account-form').reset(); $('new-account-balance').value = '0.00'; $('new-account-dialog').showModal(); });
$('admin-edit-balances').addEventListener('click', showBalancesDialog);
$('admin-account-list').addEventListener('click', event => {
  const edit = event.target.closest('[data-edit-account]');
  if (edit) openEditAccount(edit.dataset.editAccount);
});

// Administration : catégories (ajouter, modifier, supprimer)
$('admin-category-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = $('admin-category-name');
  const name = input.value.trim();
  if (!name) return;
  if (state.categories.some(category => sameName(category, name))) { alert('Cette catégorie existe déjà.'); return; }
  state.categories.push(name);
  saveState(); input.value = ''; render();
});
$('admin-category-list').addEventListener('click', event => {
  const edit = event.target.closest('[data-edit-category]');
  const save = event.target.closest('[data-save-category]');
  const cancel = event.target.closest('[data-cancel-category]');
  const remove = event.target.closest('[data-remove-category]');
  if (edit) {
    editingCategory = state.categories[Number(edit.dataset.editCategory)];
    renderAdmin();
    $('admin-category-list').querySelector('input')?.focus();
  } else if (cancel) {
    editingCategory = null; renderAdmin();
  } else if (save) {
    const index = Number(save.dataset.saveCategory);
    const oldName = state.categories[index];
    const newName = save.closest('li').querySelector('input').value.trim();
    if (!newName) return;
    if (state.categories.some((category, i) => i !== index && sameName(category, newName))) { alert('Cette catégorie existe déjà.'); return; }
    state.categories[index] = newName;
    // Les opérations déjà saisies suivent le nouveau nom.
    state.operations.forEach(operation => { if (operation.category === oldName) operation.category = newName; });
    editingCategory = null;
    saveState(); render();
  } else if (remove) {
    const index = Number(remove.dataset.removeCategory);
    const category = state.categories[index];
    if (!confirm(`Supprimer la catégorie « ${category} » de la liste ? Les opérations existantes seront conservées.`)) return;
    state.categories.splice(index, 1);
    saveState(); render();
  }
});
$('admin-category-list').addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.matches('[data-category-input]')) { event.preventDefault(); event.target.closest('li').querySelector('[data-save-category]').click(); }
  if (event.key === 'Escape' && event.target.matches('[data-category-input]')) { editingCategory = null; renderAdmin(); }
});

// Synchronisation entre onglets
window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) { state = loadState(); render(); } });

// Mode hors ligne (service worker)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker non enregistré.', error)));
}

render();
setAdminView(location.hash === '#admin');
