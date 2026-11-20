const originalRender = render;
const originalSignedEffect = signedEffect;
const accountHistory = { selectedId: null };
let submittingCustomType = null;

state.adminDefaultAccountId = state.adminDefaultAccountId || '';
state.customOperationTypes = Array.isArray(state.customOperationTypes) ? state.customOperationTypes : [];

const adminStyles = document.createElement('style');
adminStyles.textContent = `
#admin-page{display:none}.admin-page-active> :not(#admin-page){display:none!important}.admin-page-active>#admin-page{display:block!important}
#admin-page .admin-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:18px;margin-top:22px}
#admin-page .admin-card{background:#fff;border:1px solid var(--line,#e6e9e3);border-radius:16px;padding:22px;box-shadow:0 6px 20px #18241808}
#admin-page .admin-card h2{margin:0 0 8px}#admin-page .admin-card p{color:#69736a;line-height:1.5}
#admin-page .admin-form{display:grid;gap:12px;margin-top:18px}#admin-page .admin-form .field{display:grid;gap:6px}
#admin-page .admin-form input,#admin-page .admin-form select{box-sizing:border-box;width:100%;min-height:42px;padding:9px 11px;border:1px solid #dfe4dc;border-radius:9px;background:#fff;font:inherit;color:inherit}
#admin-page .admin-list{display:grid;gap:8px;margin:14px 0 0;padding:0;list-style:none}#admin-page .admin-list li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid #edf0eb;border-radius:9px}
#admin-page .admin-list button{border:0;background:transparent;color:#9b332e;font:inherit;cursor:pointer;padding:8px}
#admin-page .admin-note{font-size:13px}.admin-nav-link{cursor:pointer}
@media(max-width:700px){#admin-page .admin-card{padding:17px}#admin-page .admin-grid{gap:12px}}
.account-actions #add-account,.account-actions #edit-balances{display:none!important}
`;
document.head.append(adminStyles);

const sidebar = document.querySelector('.sidebar');
if (sidebar && !document.getElementById('admin-nav-link')) {
  const link = document.createElement('a');
  link.className = 'nav-link admin-nav-link';
  link.id = 'admin-nav-link';
  link.href = '#admin';
  link.innerHTML = '<span class="nav-icon" aria-hidden="true">⚙</span> Administration';
  sidebar.querySelector('.sidebar-bottom')?.before(link);
}
const main = document.querySelector('.main-content');
if (main && !document.getElementById('admin-page')) {
  main.insertAdjacentHTML('beforeend', `<section id="admin-page" aria-labelledby="admin-title"><header class="topbar"><div><p class="eyebrow">CONFIGURATION</p><h1 id="admin-title">Administration</h1></div><button class="button button-secondary" id="admin-back" type="button">Retour au tableau</button></header><div class="admin-grid"><section class="admin-card"><p class="eyebrow">AFFICHAGE</p><h2>Compte affiché au lancement</h2><p>Choisissez un compte à afficher seul dans le tableau et les formulaires. « Tous les comptes » rétablit l’affichage complet.</p><label class="field">Compte par défaut<select id="admin-default-account"></select></label></section><section class="admin-card"><p class="eyebrow">COMPTES</p><h2>Gérer les comptes et soldes</h2><p>Créez un compte avec son solde de démarrage ou ajustez les soldes existants.</p><div class="dialog-actions"><button class="button button-primary" id="admin-add-account" type="button">Ajouter un compte</button><button class="button button-secondary" id="admin-edit-balances" type="button">Modifier les soldes</button></div><ul id="admin-account-list" class="admin-list"></ul></section><section class="admin-card"><p class="eyebrow">OPÉRATIONS</p><h2>Types de dépense et de crédit</h2><p>Ajoutez des types qui apparaîtront dans le choix du type lors de la création d’une opération.</p><form id="admin-type-form" class="admin-form"><label class="field">Nom du type<input id="admin-type-name" type="text" maxlength="40" placeholder="Ex. Dividendes, Courses…" required></label><label class="field">Nature<select id="admin-type-kind"><option value="expense">Dépense</option><option value="credit">Crédit</option></select></label><button class="button button-primary" type="submit">Ajouter le type</button></form><ul id="admin-type-list" class="admin-list"></ul></section></div></section>`);
}

const brand = document.querySelector('.brand');
if (brand) {
  brand.innerHTML = '<img class="brand-emblem" src="./logo.svg" alt=""><span class="brand-word">Plata<span>.</span></span>';
  brand.setAttribute('aria-label', 'Plata, accueil');
}

function accountIsVisibleOperation(operation, accountId) {
  return operation.accountId === accountId || ((operation.type === 'transfer' || operation.type === 'savings') && operation.destinationAccountId === accountId);
}
function isCustomCredit(operation) {
  const type = state.customOperationTypes.find(item => item.id === operation.type);
  return type?.kind === 'credit';
}
function isCreditOperation(operation) { return operation.type === 'income' || isCustomCredit(operation); }

signedEffect = function (operation, accountId) {
  if (state.adminDefaultAccountId && operation.type !== 'transfer' && operation.type !== 'savings' && operation.accountId === accountId && isCustomCredit(operation)) return Number(operation.amount) || 0;
  return originalSignedEffect(operation, accountId);
};

function setAdminView(active) {
  main.classList.toggle('admin-page-active', active);
  document.getElementById('admin-page').style.display = active ? 'block' : 'none';
  document.getElementById('admin-nav-link').classList.toggle('active', active);
  document.querySelectorAll('.sidebar .nav-link:not(#admin-nav-link)').forEach(link => link.classList.toggle('active', !active && link.getAttribute('href') === '#dashboard'));
  if (!active && location.hash === '#admin') history.replaceState(null, '', location.pathname + location.search);
}
function updateAdminControls() {
  const select = document.getElementById('admin-default-account');
  if (!select) return;
  const current = state.adminDefaultAccountId || '';
  select.innerHTML = '<option value="">Tous les comptes</option>' + state.accounts.map(account => `<option value="${escapeHTML(account.id)}">${escapeHTML(account.name)}</option>`).join('');
  select.value = state.accounts.some(account => account.id === current) ? current : '';
  document.getElementById('admin-account-list').innerHTML = state.accounts.map(account => `<li><span><strong>${escapeHTML(account.name)}</strong><br><small>${escapeHTML(account.kind || 'Autre compte')} · ${money(Number(account.balance) || 0)}</small></span></li>`).join('');
  document.getElementById('admin-type-list').innerHTML = state.customOperationTypes.map(type => `<li><span>${escapeHTML(type.name)} <small>— ${type.kind === 'credit' ? 'Crédit' : 'Dépense'}</small></span><button type="button" data-remove-operation-type="${escapeHTML(type.id)}" aria-label="Supprimer le type ${escapeHTML(type.name)}">Supprimer</button></li>`).join('');
  updateOperationTypes();
}
function updateOperationTypes() {
  const select = document.getElementById('operation-type');
  if (!select) return;
  select.querySelectorAll('[data-custom-operation-type]').forEach(option => option.remove());
  state.customOperationTypes.forEach(type => {
    const option = document.createElement('option');
    option.value = type.id;
    option.textContent = type.name;
    option.dataset.customOperationType = 'true';
    select.append(option);
    TYPE_INFO[type.id] = { label: type.name, icon: type.kind === 'credit' ? '↙' : '▣', category: type.name };
  });
}
function updateRenderedTotals() {
  const accountIds = state.adminDefaultAccountId ? [state.adminDefaultAccountId] : state.accounts.map(account => account.id);
  const operations = state.operations.filter(operation => !state.adminDefaultAccountId || accountIsVisibleOperation(operation, state.adminDefaultAccountId));
  const monthKey = toMonthKey(displayedMonth);
  const monthOps = operations.filter(operation => operation.date.startsWith(monthKey));
  const monthEnd = dateEndOfMonth(displayedMonth);
  const actual = accountIds.reduce((sum, id) => { const account = state.accounts.find(item => item.id === id); return sum + (account ? accountBalance(account, monthEnd, false) : 0); }, 0);
  const forecast = accountIds.reduce((sum, id) => { const account = state.accounts.find(item => item.id === id); return sum + (account ? accountBalance(account, monthEnd, true) : 0); }, 0);
  document.getElementById('actual-total').textContent = money(actual);
  document.getElementById('forecast-total').textContent = money(forecast);
  const credits = monthOps.filter(isCreditOperation).reduce((sum, operation) => sum + Number(operation.amount || 0), 0);
  const expenses = monthOps.filter(operation => !isInternal(operation) && !isCreditOperation(operation)).reduce((sum, operation) => sum + Number(operation.amount || 0), 0);
  document.getElementById('month-income').textContent = money(credits);
  document.getElementById('month-expenses').textContent = money(expenses);
  const upcoming = monthOps.filter(operation => operation.status !== 'realized');
  document.getElementById('upcoming-total').textContent = money(upcoming.reduce((sum, operation) => sum + (isInternal(operation) ? 0 : (isCreditOperation(operation) ? 1 : -1) * Number(operation.amount || 0)), 0));
  document.getElementById('upcoming-count').textContent = upcoming.length ? `${upcoming.length} opération${upcoming.length > 1 ? 's' : ''} prévue${upcoming.length > 1 ? 's' : ''}` : 'Aucune opération prévue';
  document.querySelectorAll('#transactions-list .transaction-row').forEach(row => {
    const button = row.querySelector('[data-toggle]');
    const operation = button && state.operations.find(item => item.id === button.dataset.toggle);
    if (!operation || !isCustomCredit(operation)) return;
    const amount = row.querySelector('.transaction-amount');
    if (amount) { amount.textContent = `+${money(Number(operation.amount))}`; amount.classList.add('positive'); }
  });
}

render = function () {
  const allAccounts = state.accounts;
  const allOperations = state.operations;
  const selectedId = state.adminDefaultAccountId;
  if (selectedId && allAccounts.some(account => account.id === selectedId)) {
    state.accounts = allAccounts.filter(account => account.id === selectedId);
    state.operations = allOperations.filter(operation => accountIsVisibleOperation(operation, selectedId));
  } else {
    state.adminDefaultAccountId = '';
  }
  accountHistory.selectedId = null;
  try { originalRender(); }
  finally { state.accounts = allAccounts; state.operations = allOperations; }
  updateAdminControls();
  updateRenderedTotals();
};

// The first operation created after loading defaults to a card payment.
const operationTypeSelect = document.getElementById('operation-type');
if (operationTypeSelect) {
  const incomeOption = operationTypeSelect.querySelector('option[value="income"]');
  const cardOption = operationTypeSelect.querySelector('option[value="card"]');
  if (incomeOption) incomeOption.defaultSelected = false;
  if (cardOption) cardOption.defaultSelected = true;
}

// Add/edit account dialogs already exist in the page; expose them only from administration.
document.getElementById('admin-add-account')?.addEventListener('click', () => document.getElementById('add-account').click());
document.getElementById('admin-edit-balances')?.addEventListener('click', () => document.getElementById('edit-balances').click());
document.getElementById('admin-default-account')?.addEventListener('change', event => {
  state.adminDefaultAccountId = event.target.value;
  saveState();
  render();
});
document.getElementById('admin-type-form')?.addEventListener('submit', event => {
  event.preventDefault();
  const name = document.getElementById('admin-type-name').value.trim();
  if (!name) return;
  if (state.customOperationTypes.some(type => type.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'))) { alert('Ce type existe déjà.'); return; }
  const kind = document.getElementById('admin-type-kind').value;
  const id = `custom-${kind}-${makeId()}`;
  state.customOperationTypes.push({ id, name, kind });
  saveState();
  document.getElementById('admin-type-form').reset();
  render();
});
document.getElementById('admin-type-list')?.addEventListener('click', event => {
  const button = event.target.closest('[data-remove-operation-type]');
  if (!button) return;
  if (!confirm('Supprimer ce type de la liste ? Les opérations déjà créées seront conservées.')) return;
  state.customOperationTypes = state.customOperationTypes.filter(type => type.id !== button.dataset.removeOperationType);
  saveState();
  render();
});
document.getElementById('admin-account-list')?.addEventListener('click', () => {});
document.getElementById('admin-back')?.addEventListener('click', () => setAdminView(false));
document.getElementById('admin-nav-link')?.addEventListener('click', event => { event.preventDefault(); setAdminView(true); history.replaceState(null, '', '#admin'); updateAdminControls(); });
document.querySelectorAll('.sidebar .nav-link:not(#admin-nav-link)').forEach(link => link.addEventListener('click', () => setAdminView(false)));
window.addEventListener('hashchange', () => setAdminView(location.hash === '#admin'));

// When a custom type is submitted, let the existing operation handler do its
// normal validation, then replace the created operation type with the custom one.
const operationForm = document.getElementById('operation-form');
operationForm?.addEventListener('submit', () => {
  const typeId = operationTypeSelect.value;
  const custom = state.customOperationTypes.find(type => type.id === typeId);
  submittingCustomType = custom ? { ...custom, previousCount: state.operations.length } : null;
}, true);
operationForm?.addEventListener('submit', () => {
  if (!submittingCustomType) return;
  const { previousCount, ...custom } = submittingCustomType;
  state.operations.slice(previousCount).forEach(operation => { operation.type = custom.id; operation.customKind = custom.kind; operation.category = custom.name; });
  submittingCustomType = null;
  saveState();
  render();
});

// Add a custom type's label/category safely after the app rebuilds its category list.
const originalRenderCategories = renderCategories;
renderCategories = function () {
  originalRenderCategories();
  const type = state.customOperationTypes.find(item => item.id === operationTypeSelect.value);
  if (type) {
    const category = document.getElementById('operation-category');
    if (category && !Array.from(category.options).some(option => option.value === type.name)) category.add(new Option(type.name, type.name));
    if (category) category.value = type.name;
    const hint = document.getElementById('type-hint');
    if (hint) hint.textContent = type.kind === 'credit' ? 'Ce crédit augmente le solde du compte.' : 'Cette dépense diminue le solde du compte.';
  }
};

// Keep the existing account editing and creation features intact.
if (!document.getElementById('edit-account-dialog')) {
  document.body.insertAdjacentHTML('beforeend', `<dialog id="edit-account-dialog" class="operation-dialog compact-dialog"><form id="edit-account-form"><input id="edit-account-id" type="hidden"><div class="dialog-heading"><div><p class="eyebrow">VOS COMPTES</p><h2>Modifier le compte</h2></div><button class="icon-button" type="button" id="close-edit-account" aria-label="Fermer">×</button></div><div class="form-grid"><label class="field field-wide">Nom du compte<input id="edit-account-name" type="text" maxlength="50" required></label><label class="field field-wide">Type<select id="edit-account-kind"><option>Compte courant</option><option>Épargne</option><option>Autre compte</option></select></label></div><div class="dialog-actions"><button class="button button-secondary" type="button" id="cancel-edit-account">Annuler</button><button class="button button-primary" type="submit">Enregistrer</button></div></form></dialog>`);
}
function openEditAccount(accountId) {
  const account = state.accounts.find(item => item.id === accountId);
  if (!account) return;
  document.getElementById('edit-account-id').value = account.id;
  document.getElementById('edit-account-name').value = account.name;
  document.getElementById('edit-account-kind').value = account.kind || 'Autre compte';
  document.getElementById('edit-account-dialog').showModal();
}
document.getElementById('accounts-list').addEventListener('click', event => {
  const edit = event.target.closest('[data-edit-account]');
  if (edit) { event.stopPropagation(); openEditAccount(edit.dataset.editAccount); return; }
  const row = event.target.closest('.account-row');
  if (row && !state.adminDefaultAccountId) {
    const account = state.accounts.find(item => item.name === row.querySelector('.account-meta strong')?.textContent);
    if (account) { accountHistory.selectedId = account.id; }
  }
});
document.getElementById('edit-account-form')?.addEventListener('submit', event => {
  event.preventDefault();
  const account = state.accounts.find(item => item.id === document.getElementById('edit-account-id').value);
  const name = document.getElementById('edit-account-name').value.trim();
  const kind = document.getElementById('edit-account-kind').value;
  if (!account || !name) return;
  if (state.accounts.some(item => item.id !== account.id && item.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'))) { alert('Un compte porte déjà ce nom.'); return; }
  account.name = name; account.kind = kind;
  account.icon = ({ 'Compte courant': '▤', 'Épargne': '◈', 'Autre compte': '◫' })[kind] || '▤';
  saveState(); document.getElementById('edit-account-dialog').close(); render();
});
document.getElementById('close-edit-account')?.addEventListener('click', () => document.getElementById('edit-account-dialog').close());
document.getElementById('cancel-edit-account')?.addEventListener('click', () => document.getElementById('edit-account-dialog').close());
document.getElementById('new-account-form')?.addEventListener('submit', event => {
  event.preventDefault();
  const name = document.getElementById('new-account-name').value.trim();
  const kind = document.getElementById('new-account-kind').value;
  if (!name) return;
  if (state.accounts.some(account => account.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'))) { alert('Un compte porte déjà ce nom.'); return; }
  const icons = { 'Compte courant': '▤', 'Épargne': '◈', 'Autre compte': '◫' };
  state.accounts.push({ id: `account-${makeId()}`, name, kind, icon: icons[kind] || '▤', balance: Math.round(Number(document.getElementById('new-account-balance').value || 0) * 100) / 100 });
  saveState(); document.getElementById('new-account-dialog').close(); render();
});
document.getElementById('add-account')?.addEventListener('click', () => { document.getElementById('new-account-form').reset(); document.getElementById('new-account-balance').value = '0.00'; document.getElementById('new-account-dialog').showModal(); });

updateOperationTypes();
render();
if (location.hash === '#admin') setAdminView(true);
