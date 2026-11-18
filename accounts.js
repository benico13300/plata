const accountHistory = { selectedId: null };
const originalRender = render;

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
  const relevant = state.operations.filter(operation => operation.accountId === selected.id || ((operation.type === 'transfer' || operation.type === 'savings') && operation.destinationAccountId === selected.id)).filter(operation => statusFilter === 'all' || operation.status === statusFilter).sort((a, b) => b.date.localeCompare(a.date));
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
  const rows = document.querySelectorAll('#accounts-list .account-row');
  rows.forEach(row => {
    const name = row.querySelector('.account-meta strong')?.textContent || '';
    const account = state.accounts.find(item => item.name === name);
    if (!account) return;
    row.classList.toggle('account-row-selected', account.id === accountHistory.selectedId);
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', `Voir toutes les opérations du compte ${account.name}`);
    row.dataset.accountId = account.id;
  });
  renderAccountHistory();
};

function openNewAccountDialog() {
  document.getElementById('new-account-form').reset();
  document.getElementById('new-account-balance').value = '0.00';
  document.getElementById('new-account-dialog').showModal();
  document.getElementById('new-account-name').focus();
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

document.getElementById('accounts-list').addEventListener('click', event => {
  const row = event.target.closest('[data-account-id]');
  if (!row) return;
  accountHistory.selectedId = accountHistory.selectedId === row.dataset.accountId ? null : row.dataset.accountId;
  render();
  if (accountHistory.selectedId) document.getElementById('operations').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.getElementById('accounts-list').addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-account-id]')) {
    event.preventDefault();
    event.target.click();
  }
});
document.getElementById('clear-account-filter').addEventListener('click', () => { accountHistory.selectedId = null; render(); });

render();
