const accountHistory = { selectedId: null };
const originalRender = render;

// The edit dialog is created here so the account controls remain usable even
// when the page HTML was served from an older cached version.
if (!document.getElementById('edit-account-dialog')) {
  document.body.insertAdjacentHTML('beforeend', `<dialog id="edit-account-dialog" class="operation-dialog compact-dialog account-dialog"><form id="edit-account-form"><input id="edit-account-id" type="hidden"><div class="dialog-heading"><div><p class="eyebrow">VOS COMPTES</p><h2>Modifier le compte</h2></div><button class="icon-button close-button" type="button" id="close-edit-account" aria-label="Fermer">×</button></div><div class="form-grid"><label class="field field-wide">Nom du compte<input id="edit-account-name" type="text" maxlength="50" required></label><label class="field field-wide">Type<select id="edit-account-kind"><option value="Compte courant">Compte courant</option><option value="Épargne">Épargne</option><option value="Autre compte">Autre compte</option></select></label></div><p class="form-hint">Le solde initial et les opérations de ce compte seront conservés.</p><div class="dialog-actions"><button class="button button-secondary" type="button" id="cancel-edit-account">Annuler</button><button class="button button-primary" type="submit">Enregistrer</button></div></form></dialog>`);
}

const accountStyles = document.createElement('style');
accountStyles.textContent = `
.account-row{display:flex;align-items:center;gap:8px;cursor:default!important;touch-action:manipulation}
.account-select-button{display:flex;align-items:center;gap:0;flex:1;min-width:0;padding:0;border:0;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer;touch-action:manipulation}
.account-select-button:focus-visible,.edit-account-button:focus-visible{outline:2px solid #78a88a;outline-offset:2px;border-radius:8px}
.account-select-button .account-meta{min-width:0}.account-select-button .account-balance{margin-left:auto;padding-left:8px;white-space:nowrap}
.edit-account-button{flex:0 0 38px;width:38px;height:38px;display:grid;place-items:center;border:1px solid #e9ece7;border-radius:9px;background:#fff;color:#256c4d;font-size:19px;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.edit-account-button:hover{background:#edf4ef}
.operation-dialog.account-dialog,.operation-dialog#new-account-dialog{box-sizing:border-box;width:min(430px,calc(100vw - 32px));max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);overflow-y:auto;overscroll-behavior:contain;margin:auto}
@media(max-width:700px){.operation-dialog.account-dialog,.operation-dialog#new-account-dialog{width:calc(100vw - 28px);max-width:calc(100vw - 28px);max-height:calc(100vh - 28px);max-height:calc(100dvh - 28px);padding:19px 16px}.account-row{gap:6px;padding-left:5px;padding-right:5px}.edit-account-button{flex-basis:42px;width:42px;height:42px}.account-select-button{min-height:44px}}
.brand{display:flex;align-items:center;gap:10px!important;text-decoration:none}
.brand .brand-mark{display:none!important}
.brand .brand-word{font-family:'Manrope',sans-serif;font-size:23px;font-weight:800;letter-spacing:-1.3px;color:#39200e}
.brand .brand-word span{color:#d58a17}
.brand .brand-emblem{display:block;width:42px;height:42px;flex:0 0 42px;object-fit:contain;border-radius:11px}
@media(max-width:700px){.brand{gap:7px!important}.brand .brand-emblem{width:34px;height:34px;flex-basis:34px}.brand .brand-word{font-size:20px}}
`;
document.head.append(accountStyles);

function renderAccountHistory() {
  const selected = state.accounts.find(account => account.id === accountHistory.selectedId);
  const title = document.getElementById('operations-title');
  const count = document.getElementById('account-history-count');
  const clear = document.getElementById('clear-account-filter');
  if (!selected) {
    accountHistory.selectedId = null;
    title.textContent = 'Opérations';
    count.classList.add('hidden');
    clear.classList.add('hidden');
    return;
  }
  title.textContent = `Opérations — ${selected.name}`;
  clear.classList.remove('hidden');
  const statusFilter = document.getElementById('operation-filter').value;
  const relevant = state.operations
    .filter(operation => operation.accountId === selected.id || ((operation.type === 'transfer' || operation.type === 'savings') && operation.destinationAccountId === selected.id))
    .filter(operation => statusFilter === 'all' || operation.status === statusFilter)
    .sort((a, b) => b.date.localeCompare(a.date));
  count.textContent = `${relevant.length} opération${relevant.length === 1 ? '' : 's'} · tous les mois`;
  count.classList.remove('hidden');
  const list = document.getElementById('transactions-list');
  list.innerHTML = relevant.map(operation => {
    const info = TYPE_INFO[operation.type] || TYPE_INFO.card;
    const incoming = operation.accountId !== selected.id;
    let prefix = operation.type === 'income' ? '+' : '−';
    let positive = operation.type === 'income';
    if ((operation.type === 'transfer' || operation.type === 'savings') && incoming) { prefix = '+'; positive = true; }
    const destination = operation.type === 'transfer' || operation.type === 'savings' ? ` → ${accountName(operation.destinationAccountId)}` : '';
    return `<article class="transaction-row"><span class="transaction-symbol">${info.icon}</span><div class="transaction-name"><strong>${escapeHTML(operation.title)}</strong><span>${escapeHTML(info.label)} · ${escapeHTML(accountName(operation.accountId))}${escapeHTML(destination)}</span></div><span class="transaction-category">${escapeHTML(operation.category || info.label)}</span><time class="transaction-date" datetime="${escapeHTML(operation.date)}">${escapeHTML(dateFormatter.format(operationDate(operation)))}</time><strong class="transaction-amount ${positive ? 'positive' : ''}">${prefix}${money(Number(operation.amount))}</strong><button class="status-button ${operation.status === 'realized' ? 'realized' : ''}" type="button" data-toggle="${escapeHTML(operation.id)}" aria-label="${operation.status === 'realized' ? 'Marquer comme prévue' : 'Marquer comme réalisée'}">${operation.status === 'realized' ? 'Réalisée' : 'Prévue'}</button><button class="delete-button" type="button" data-delete="${escapeHTML(operation.id)}" aria-label="Supprimer ${escapeHTML(operation.title)}">×</button></article>`;
  }).join('');
  const empty = document.getElementById('empty-state');
  const hasOperations = relevant.length > 0;
  empty.hidden = hasOperations;
  list.hidden = !hasOperations;
  if (!hasOperations) {
    empty.querySelector('h3').textContent = 'Aucune opération pour ce compte';
    empty.querySelector('p').textContent = 'Les opérations associées à ce compte apparaîtront ici, tous mois confondus.';
  }
}

render = function () {
  originalRender();
  document.querySelectorAll('#accounts-list .account-row').forEach(row => {
    const account = state.accounts.find(item => item.name === row.querySelector('.account-meta strong')?.textContent);
    if (!account) return;
    row.classList.toggle('account-row-selected', account.id === accountHistory.selectedId);
    row.removeAttribute('role');
    row.removeAttribute('tabindex');
    row.removeAttribute('aria-label');
    row.dataset.accountId = account.id;

    const avatar = row.querySelector('.account-avatar');
    const meta = row.querySelector('.account-meta');
    const balance = row.querySelector('.account-balance');
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'account-select-button';
    select.setAttribute('aria-label', `Voir toutes les opérations du compte ${account.name}`);
    if (avatar) select.append(avatar);
    if (meta) select.append(meta);
    if (balance) select.append(balance);
    row.replaceChildren(select);

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'edit-account-button';
    edit.dataset.editAccount = account.id;
    edit.setAttribute('aria-label', `Modifier le compte ${account.name}`);
    edit.title = 'Modifier le compte';
    edit.textContent = '✎';
    row.append(edit);
  });
  renderAccountHistory();
};

function openNewAccountDialog() {
  document.getElementById('new-account-form').reset();
  document.getElementById('new-account-balance').value = '0.00';
  document.getElementById('new-account-dialog').showModal();
  document.getElementById('new-account-name').focus();
}
function openEditAccountDialog(accountId) {
  const account = state.accounts.find(item => item.id === accountId);
  if (!account) return;
  document.getElementById('edit-account-id').value = account.id;
  document.getElementById('edit-account-name').value = account.name;
  document.getElementById('edit-account-kind').value = account.kind || 'Autre compte';
  document.getElementById('edit-account-dialog').showModal();
  document.getElementById('edit-account-name').focus();
  document.getElementById('edit-account-name').select();
}

// Replace the placeholder wordmark with the supplied gold-themed emblem and
// keep the application name as live, accessible text.
const brand = document.querySelector('.brand');
if (brand) {
  brand.innerHTML = '<img class="brand-emblem" src="./logo.svg" alt=""><span class="brand-word">Plata<span>.</span></span>';
  brand.setAttribute('aria-label', 'Plata, accueil');
}

document.getElementById('add-account').addEventListener('click', openNewAccountDialog);
document.getElementById('close-new-account').addEventListener('click', () => document.getElementById('new-account-dialog').close());
document.getElementById('cancel-new-account').addEventListener('click', () => document.getElementById('new-account-dialog').close());
document.getElementById('new-account-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = document.getElementById('new-account-name').value.trim();
  if (!name) return;
  if (state.accounts.some(account => account.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'))) {
    alert('Un compte porte déjà ce nom. Choisissez un autre nom.');
    return;
  }
  const kind = document.getElementById('new-account-kind').value;
  const icons = { 'Compte courant': '▤', 'Épargne': '◈', 'Autre compte': '◫' };
  state.accounts.push({ id: `account-${makeId()}`, name, kind, icon: icons[kind] || '▤', balance: Math.round(Number(document.getElementById('new-account-balance').value || 0) * 100) / 100 });
  saveState();
  document.getElementById('new-account-dialog').close();
  render();
});
document.getElementById('close-edit-account').addEventListener('click', () => document.getElementById('edit-account-dialog').close());
document.getElementById('cancel-edit-account').addEventListener('click', () => document.getElementById('edit-account-dialog').close());
document.getElementById('edit-account-form').addEventListener('submit', event => {
  event.preventDefault();
  const id = document.getElementById('edit-account-id').value;
  const account = state.accounts.find(item => item.id === id);
  const name = document.getElementById('edit-account-name').value.trim();
  const kind = document.getElementById('edit-account-kind').value;
  if (!account || !name) return;
  if (state.accounts.some(item => item.id !== id && item.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'))) {
    alert('Un compte porte déjà ce nom. Choisissez un autre nom.');
    return;
  }
  const icons = { 'Compte courant': '▤', 'Épargne': '◈', 'Autre compte': '◫' };
  account.name = name;
  account.kind = kind;
  account.icon = icons[kind] || '▤';
  saveState();
  document.getElementById('edit-account-dialog').close();
  render();
});

document.getElementById('accounts-list').addEventListener('click', event => {
  const editButton = event.target.closest('[data-edit-account]');
  if (editButton) { event.stopPropagation(); openEditAccountDialog(editButton.dataset.editAccount); return; }
  const selectButton = event.target.closest('.account-select-button');
  if (!selectButton) return;
  const row = selectButton.closest('[data-account-id]');
  if (!row) return;
  accountHistory.selectedId = accountHistory.selectedId === row.dataset.accountId ? null : row.dataset.accountId;
  render();
  if (accountHistory.selectedId) document.getElementById('operations').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.getElementById('clear-account-filter').addEventListener('click', () => { accountHistory.selectedId = null; render(); });

render();
