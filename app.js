'use strict';

/* ==========================================================================
   Plata — gestion de comptes personnels
   Un seul fichier : données, calculs, affichage, administration.
   ========================================================================== */

/* ---------- Constantes ---------- */
const LEGACY_KEY = 'plata.local.v1';   // anciennes données (avant Firebase), lues une seule fois pour l'import
const PREFS_KEY = 'plata.prefs.v1';    // préférences d'affichage propres à chaque appareil
const IS_WINDOWS = /Windows/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.userAgent);
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
  check: { label: 'Chèque', icon: '▭', category: 'Autres dépenses' },
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
const cloud = window.PlataCloud;
function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (error) { return {}; } }
function emptyState() {
  return { accounts: [], operations: [], categories: [...DEFAULT_CATEGORIES], places: [], adminDefaultAccountId: loadPrefs().adminDefaultAccountId || '' };
}
let state = emptyState();
let displayedMonth = new Date();
displayedMonth.setDate(1);
const typeFilter = new Set(); // types d'opération affichés (vide = tous) — vue temporaire
let viewAccountId = ''; // compte cliqué dans « Vos comptes » (vue temporaire, non enregistrée)
let editingOperationId = null; // opération en cours de modification (null = nouvelle opération)

// Remet des données (ancien stockage local, sauvegarde importée) au bon format.
function normalizeState(stored) {
  const data = {
    accounts: stored.accounts.map(account => ({ ...account })),
    operations: stored.operations.map(operation => ({ ...operation })),
    categories: Array.isArray(stored.categories) ? stored.categories.filter(c => typeof c === 'string' && c.trim()) : [...DEFAULT_CATEGORIES],
    places: Array.isArray(stored.places) ? stored.places.filter(p => typeof p === 'string' && p.trim()) : [],
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
function readLegacyLocal() {
  try {
    const stored = JSON.parse(localStorage.getItem(LEGACY_KEY));
    if (stored && Array.isArray(stored.accounts) && Array.isArray(stored.operations) && (stored.operations.length || stored.accounts.some(account => Number(account.balance)))) return normalizeState(stored);
  } catch (error) { console.warn('Impossible de lire les anciennes données locales.', error); }
  return null;
}

/* ---------- Synchronisation cloud (Firestore) ----------
   Chaque compte et chaque opération est un document ; les catégories et lieux sont dans un document « réglages ».
   state reste la référence pour l'affichage ; saveState() envoie uniquement ce qui a changé. */
const sync = { user: null, stop: null, loaded: {}, meta: {}, initDone: false, ready: false, error: '', synced: null };
function freshSynced() { return { accounts: new Map(), operations: new Map(), settings: '' }; }
sync.synced = freshSynced();

function stable(value) { // JSON à clés triées, pour comparer deux documents
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value === undefined ? null : value);
}
function clean(object) { return JSON.parse(JSON.stringify(object)); } // retire les undefined (refusés par Firestore)
function accountDoc(account, index) { const { id, ...rest } = account; return clean({ ...rest, order: index }); }
function operationDoc(operation) { const { id, ...rest } = operation; return clean(rest); }
function settingsDoc() { return { categories: [...state.categories], places: [...state.places], schemaVersion: 1 }; }

function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ adminDefaultAccountId: state.adminDefaultAccountId || '' })); } catch (error) { /* stockage plein ou refusé */ } }
function saveState() {
  savePrefs();
  if (!sync.user || !sync.ready) return;
  const changes = [];
  const nextAccounts = new Map(state.accounts.map((account, index) => [account.id, accountDoc(account, index)]));
  const nextOperations = new Map(state.operations.map(operation => [operation.id, operationDoc(operation)]));
  const next = { accounts: new Map(), operations: new Map(), settings: stable(settingsDoc()) };
  [['accounts', nextAccounts], ['operations', nextOperations]].forEach(([kind, docs]) => {
    docs.forEach((data, id) => {
      const json = stable(data);
      next[kind].set(id, json);
      if (sync.synced[kind].get(id) !== json) changes.push({ op: 'set', kind, id, data });
    });
    sync.synced[kind].forEach((json, id) => { if (!docs.has(id)) changes.push({ op: 'delete', kind, id }); });
  });
  if (sync.synced.settings !== next.settings) changes.push({ op: 'set', kind: 'settings', id: 'main', data: settingsDoc() });
  sync.synced = next;
  if (!changes.length) return;
  cloud.commit(changes).catch(error => { console.error('Écriture cloud refusée.', error); sync.error = 'write'; updateSyncStatus(); });
  updateSyncStatus();
}

function applyCloudChanges(kind, changes, meta) {
  sync.loaded[kind] = true;
  sync.meta[kind] = meta;
  let changed = false;
  changes.forEach(change => {
    if (kind === 'settings') {
      if (change.pending) return;
      state.categories = Array.isArray(change.data.categories) ? change.data.categories : state.categories;
      state.places = Array.isArray(change.data.places) ? change.data.places : state.places;
      sync.synced.settings = stable(settingsDoc());
      changed = true;
      return;
    }
    const list = state[kind];
    const index = list.findIndex(item => item.id === change.id);
    if (change.type === 'removed') {
      if (index >= 0) { list.splice(index, 1); changed = true; }
      sync.synced[kind].delete(change.id);
      return;
    }
    if (change.pending) return; // écriture locale en cours : l'écran la contient déjà
    const item = { id: change.id, ...change.data };
    if (index >= 0) list[index] = item; else list.push(item);
    sync.synced[kind].set(change.id, stable(change.data));
    changed = true;
  });
  if (changed && kind === 'accounts') state.accounts.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
  const allLoaded = ['accounts', 'operations', 'settings'].every(name => sync.loaded[name]);
  if (allLoaded && !sync.initDone && ['accounts', 'operations', 'settings'].every(name => sync.meta[name] && !sync.meta[name].fromCache)) {
    sync.initDone = true;
    if (sync.meta.settings.empty && sync.meta.accounts.empty && sync.meta.operations.empty) { seedCloud(); changed = true; }
  }
  // L'écran n'apparaît qu'une fois le serveur consulté, ou si le cache de l'appareil contient déjà des données.
  const wasReady = sync.ready;
  sync.ready = allLoaded && (sync.initDone || state.accounts.length > 0);
  if (sync.ready && (changed || !wasReady)) { unlockApp(); render(); }
  updateSyncStatus();
}

// Cloud vide : on y importe les données locales de cet appareil (une seule fois), sinon des comptes de départ.
function seedCloud() {
  const legacy = localStorage.getItem('plata.migrated') ? null : readLegacyLocal();
  if (legacy) {
    state.accounts = legacy.accounts; state.operations = legacy.operations; state.categories = legacy.categories; state.places = legacy.places;
    if (legacy.adminDefaultAccountId && !state.adminDefaultAccountId) state.adminDefaultAccountId = legacy.adminDefaultAccountId;
    try { localStorage.setItem('plata.migrated', new Date().toISOString()); } catch (error) { /* ignoré */ }
    notify(`Vos données locales ont été importées dans le cloud (${legacy.accounts.length} compte${legacy.accounts.length > 1 ? 's' : ''}, ${legacy.operations.length} opération${legacy.operations.length > 1 ? 's' : ''}).`);
  } else {
    state.accounts = ACCOUNT_SEEDS.map(account => ({ ...account }));
    state.operations = []; state.categories = [...DEFAULT_CATEGORIES]; state.places = [];
  }
  sync.ready = true; // saveState() a besoin de ce drapeau pour partir
  saveState();
}

function startSync() {
  stopSync();
  sync.stop = cloud.subscribe({
    onChanges: applyCloudChanges,
    onError: error => { console.error('Synchronisation interrompue.', error); sync.error = error.code || 'sync'; updateSyncStatus(); showAuth(sync.error === 'permission-denied' ? 'Accès refusé par les règles de sécurité Firestore. Vérifiez qu’elles sont bien publiées.' : 'Erreur de synchronisation. Rechargez la page.'); }
  });
}
function stopSync() {
  if (sync.stop) sync.stop();
  Object.assign(sync, { stop: null, loaded: {}, meta: {}, initDone: false, ready: false, error: '', synced: freshSynced() });
}

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
  if (state.accounts.some(account => account.id === state.adminDefaultAccountId)) return state.adminDefaultAccountId;
  return state.accounts.some(account => account.id === viewAccountId) ? viewAccountId : '';
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
  const byType = type => monthOperations.filter(operation => operation.type === type).length;
  $('type-filters').innerHTML = Object.entries(TYPE_INFO).map(([type, info]) => {
    const count = byType(type);
    return `<button type="button" class="type-chip${typeFilter.has(type) ? ' is-active' : ''}${count === 0 ? ' is-empty' : ''}" data-type-filter="${type}" aria-pressed="${typeFilter.has(type)}">${info.icon} ${escapeHTML(info.label)} <span class="chip-count">${count}</span></button>`;
  }).join('');
  const shown = monthOperations.filter(operation => (filter === 'all' || operation.status === filter) && (typeFilter.size === 0 || typeFilter.has(operation.type)));
  const filtering = typeFilter.size > 0 || filter !== 'all';
  $('filter-summary').classList.toggle('hidden', !filtering);
  if (filtering) {
    // Total des opérations affichées : entrées − sorties ; les virements/épargne ne comptent que s'ils sont seuls.
    const real = shown.filter(operation => !isInternal(operation));
    const net = real.reduce((total, operation) => total + (operation.type === 'income' ? 1 : -1) * Number(operation.amount), 0);
    const moved = shown.filter(isInternal).reduce((total, operation) => total + Number(operation.amount), 0);
    const totalText = real.length ? `solde ${net > 0 ? '+' : ''}${money(net)}` : shown.length ? `${money(moved)} déplacés` : '';
    $('filter-summary-text').textContent = `${shown.length} opération${shown.length > 1 ? 's' : ''} affichée${shown.length > 1 ? 's' : ''} sur ${monthOperations.length}${totalText ? ` · ${totalText}` : ''}`;
  }

  const forecast = accounts.reduce((total, account) => total + accountBalance(account, monthEnd, true), 0);
  const actual = accounts.reduce((total, account) => total + accountBalance(account, monthEnd, false), 0);
  $('forecast-total').textContent = money(forecast);
  $('actual-total').textContent = money(actual);
  $('accounts-total').textContent = money(actual);

  const upcoming = monthOperations.filter(operation => operation.status !== 'realized');
  $('upcoming-total').textContent = money(upcoming.reduce((total, operation) => total + (isInternal(operation) ? 0 : (operation.type === 'income' ? 1 : -1) * Number(operation.amount)), 0));
  $('upcoming-count').textContent = upcoming.length ? `${upcoming.length} opération${upcoming.length > 1 ? 's' : ''} prévue${upcoming.length > 1 ? 's' : ''}` : 'Aucune opération prévue';

  // Quand tous les comptes sont affichés, un clic sur un compte ne garde que celui-ci.
  const canPick = !selectedAccountId() && state.accounts.length > 1;
  $('accounts-list').innerHTML = accounts.map(account => `<div class="account-row${canPick ? ' is-clickable' : ''}"${canPick ? ` role="button" tabindex="0" data-pick-account="${escapeHTML(account.id)}" aria-label="Afficher uniquement ${escapeHTML(account.name)}"` : ''}><span class="account-avatar">${escapeHTML(account.icon || '▤')}</span><div class="account-meta"><strong>${escapeHTML(account.name)}</strong><span>Solde au ${escapeHTML(dateFormatter.format(new Date()))}</span></div><strong class="account-balance">${money(accountBalance(account, monthEnd, false))}</strong>${canPick ? '<span class="account-open" aria-hidden="true">›</span>' : ''}</div>`).join('');
  const viewing = !state.adminDefaultAccountId && selectedAccountId() === viewAccountId && viewAccountId !== '';
  $('clear-account-filter').classList.toggle('hidden', !viewing);
  $('accounts-total-label').textContent = accounts.length === 1 && state.accounts.length > 1 ? 'Solde du compte' : 'Total des comptes';
  $('operations-title').textContent = accounts.length === 1 && state.accounts.length > 1 ? `Opérations · ${accounts[0].name}` : 'Opérations';

  const sum = list => list.reduce((total, operation) => total + Number(operation.amount), 0);
  $('month-income').textContent = money(sum(monthOperations.filter(operation => operation.type === 'income')));
  $('month-expenses').textContent = money(sum(monthOperations.filter(operation => !isInternal(operation) && operation.type !== 'income')));
  $('month-transfers').textContent = money(sum(monthOperations.filter(isInternal)));
  $('activity-count').textContent = `${monthOperations.length} opération${monthOperations.length === 1 ? '' : 's'}`;

  $('transactions-list').innerHTML = shown.map(operation => {
    const info = TYPE_INFO[operation.type] || TYPE_INFO.card;
    const prefix = operation.type === 'income' ? '+' : isInternal(operation) ? '⇄ ' : '−';
    const destination = isInternal(operation) ? ` → ${operation.destinationAccountId ? accountName(operation.destinationAccountId) : 'destination à définir'}` : '';
    const place = operation.place ? ` · 📍 ${operation.place}` : '';
    const id = escapeHTML(operation.id);
    const title = escapeHTML(operation.title);
    return `<article class="transaction-row"><span class="transaction-symbol">${info.icon}</span><div class="transaction-name"><strong>${title}</strong><span>${escapeHTML(info.label)} · ${escapeHTML(accountName(operation.accountId))}${escapeHTML(destination)}${escapeHTML(place)}</span></div><span class="transaction-category">${escapeHTML(operation.category || info.label)}</span><time class="transaction-date" datetime="${escapeHTML(operation.date)}">${escapeHTML(dateFormatter.format(operationDate(operation)))}</time><strong class="transaction-amount ${operation.type === 'income' ? 'positive' : ''}">${prefix}${money(Number(operation.amount))}</strong><button class="status-button ${operation.status === 'realized' ? 'realized' : ''}" type="button" data-toggle="${id}" title="${operation.status === 'realized' ? 'Cliquer pour repasser en prévue' : 'Cliquer pour passer en réalisée'}" aria-label="${operation.status === 'realized' ? 'Réalisée, cliquer pour marquer comme prévue' : 'Prévue, cliquer pour marquer comme réalisée'}">${operation.status === 'realized' ? '✓ Réalisée' : '◷ Prévue'}</button><span class="row-actions"><button class="row-button edit-button" type="button" data-edit="${id}" title="Modifier" aria-label="Modifier ${title}">✎</button><button class="row-button delete-button" type="button" data-delete="${id}" title="Supprimer" aria-label="Supprimer ${title}">🗑</button></span></article>`;
  }).join('');
  const filteredOut = monthOperations.length > 0 && shown.length === 0;
  $('empty-title').textContent = filteredOut ? 'Aucune opération ne correspond' : 'Rien à afficher pour le moment';
  $('empty-text').textContent = filteredOut ? 'Modifiez ou effacez les filtres pour voir les autres opérations du mois.' : 'Ajoutez une opération pour commencer à suivre votre budget.';
  $('empty-state').hidden = shown.length > 0;
  $('transactions-list').hidden = shown.length === 0;

  // Listes de comptes du formulaire : le compte source suit l'affichage choisi ;
  // le compte destinataire d'un virement propose toujours tous les comptes.
  const optionsFor = list => list.map(account => `<option value="${escapeHTML(account.id)}">${escapeHTML(account.name)}</option>`).join('');
  if (!$('operation-dialog').open) { // un formulaire en cours de saisie n'est pas réinitialisé par une synchronisation
    $('source-account').innerHTML = optionsFor(accounts);
    $('destination-account').innerHTML = optionsFor(state.accounts);
    renderCategories();
    renderPlaceOptions();
  }
  renderAdmin();
}

/* ---------- Formulaire d'opération ---------- */
function renderCategories() {
  const type = $('operation-type').value;
  const select = $('operation-category');
  const previous = select.value;
  const editing = editingOperationId && state.operations.find(operation => operation.id === editingOperationId);
  $('category-field').classList.toggle('hidden', isInternal({ type }));
  $('place-field').classList.toggle('hidden', isInternal({ type }));
  updatePlaceOther();
  const choices = editing && editing.category && !isInternal(editing) && !state.categories.includes(editing.category) ? [...state.categories, editing.category] : state.categories;
  select.innerHTML = choices.map(category => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`).join('');
  const suggested = TYPE_INFO[type]?.category;
  if (suggested && state.categories.includes(suggested)) select.value = suggested;
  else if (previous && choices.includes(previous)) select.value = previous;
}
function updateTypeFields() {
  const type = $('operation-type').value;
  const internal = isInternal({ type });
  $('destination-account-field').classList.toggle('hidden', !internal);
  if (!editingOperationId) {
    $('operation-recurring').disabled = internal;
    $('operation-recurring').checked = false;
    $('occurrences-field').classList.add('hidden');
  }
  $('type-hint').textContent = internal ? 'Choisissez le compte de destination. Ce mouvement ne modifie pas la trésorerie totale.' : type === 'income' ? 'Une entrée augmente automatiquement le solde du compte choisi.' : 'Cette opération diminue automatiquement le solde du compte choisi.';
  renderCategories();
}

// Lieu : liste issue de l'administration, ou saisie libre via « Autre lieu ».
const PLACE_OTHER = '__other__';
function renderPlaceOptions(selected) {
  const select = $('operation-place');
  const keep = selected !== undefined ? selected : select.value;
  select.innerHTML = '<option value="">— Aucun lieu —</option>' + state.places.map(place => `<option value="${escapeHTML(place)}">${escapeHTML(place)}</option>`).join('') + `<option value="${PLACE_OTHER}">Autre lieu (saisie libre)…</option>`;
  select.value = [...select.options].some(option => option.value === keep) ? keep : '';
  updatePlaceOther();
}
function updatePlaceOther() {
  const other = $('operation-place').value === PLACE_OTHER;
  const internal = isInternal({ type: $('operation-type').value });
  $('place-other-field').classList.toggle('hidden', !other || internal);
  $('place-save-field').classList.toggle('hidden', !other || internal);
}
function chosenPlace() {
  if (isInternal({ type: $('operation-type').value })) return '';
  const value = $('operation-place').value;
  return value === PLACE_OTHER ? $('operation-place-other').value.trim() : value;
}

// Mêmes opérations d'une série à partir d'une date (pour modifier ou supprimer « les suivantes »).
function followingInSeries(operation) {
  if (!operation.seriesId) return [];
  return state.operations.filter(other => other.id !== operation.id && other.seriesId === operation.seriesId && other.date > operation.date && other.title === operation.title && other.accountId === operation.accountId && other.type === operation.type);
}

function openOperationDialog(operation) {
  editingOperationId = operation ? operation.id : null;
  $('operation-form').reset();
  const now = new Date();
  $('operation-date').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  $('operation-place-other').value = '';
  $('operation-place-save').checked = true;
  $('occurrences-field').classList.add('hidden');
  $('recurring-field').classList.toggle('hidden', Boolean(operation));
  $('series-field').classList.add('hidden');
  $('operation-dialog-title').textContent = operation ? 'Modifier l’opération' : 'Nouvelle opération';
  $('operation-submit').textContent = 'Enregistrer';
  renderPlaceOptions('');
  $('operation-dialog').showModal();
  updateTypeFields();
  if (!operation) return;
  $('operation-type').value = operation.type;
  updateTypeFields();
  $('operation-amount').value = Number(operation.amount);
  $('operation-date').value = operation.date;
  if (![...$('source-account').options].some(option => option.value === operation.accountId)) $('source-account').add(new Option(accountName(operation.accountId), operation.accountId));
  $('source-account').value = operation.accountId;
  if (operation.destinationAccountId) $('destination-account').value = operation.destinationAccountId;
  if (!isInternal(operation)) $('operation-category').value = operation.category || '';
  $('operation-title').value = operation.title;
  $('operation-realized').checked = operation.status === 'realized';
  if (operation.place) {
    if (state.places.includes(operation.place)) { renderPlaceOptions(operation.place); }
    else { renderPlaceOptions(PLACE_OTHER); $('operation-place-other').value = operation.place; $('operation-place-save').checked = false; }
  }
  const following = followingInSeries(operation);
  $('series-field').classList.toggle('hidden', following.length === 0);
  $('series-label').textContent = `Appliquer aussi aux ${following.length} occurrence${following.length > 1 ? 's' : ''} suivante${following.length > 1 ? 's' : ''} de la série`;
}
function submitOperation(event) {
  event.preventDefault();
  const type = $('operation-type').value;
  const internal = isInternal({ type });
  const editing = editingOperationId ? state.operations.find(operation => operation.id === editingOperationId) : null;
  const recurring = !editing && $('operation-recurring').checked;
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
  let place = chosenPlace();
  if (place && $('operation-place').value === PLACE_OTHER) {
    const known = state.places.find(item => sameName(item, place));
    if (known) place = known; // même lieu déjà dans la liste : on reprend son orthographe
    else if ($('operation-place-save').checked) state.places.push(place);
  }
  const common = {
    type, amount,
    accountId: sourceId,
    destinationAccountId: internal ? destinationId : null,
    category: internal ? TYPE_INFO[type].label : $('operation-category').value,
    place,
    title: $('operation-title').value.trim()
  };
  if (editing) {
    const following = $('operation-apply-series').checked ? followingInSeries(editing) : [];
    Object.assign(editing, common, { date, status: $('operation-realized').checked ? 'realized' : 'planned' });
    following.forEach(operation => Object.assign(operation, common, { date: operation.date, status: operation.status }));
  } else {
    const seriesId = recurring ? makeId() : null;
    for (let index = 0; index < count; index += 1) {
      state.operations.push({ id: makeId(), ...common, date: addMonths(date, index), status: $('operation-realized').checked && index === 0 ? 'realized' : 'planned', seriesId });
    }
  }
  editingOperationId = null;
  saveState();
  $('operation-dialog').close();
  render();
}
function deleteOperation(operationId) {
  const operation = state.operations.find(item => item.id === operationId);
  if (!operation || !confirm(`Supprimer l’opération « ${operation.title} » ?`)) return;
  const following = followingInSeries(operation);
  const ids = new Set([operation.id]);
  if (following.length && confirm(`Supprimer aussi les ${following.length} occurrence${following.length > 1 ? 's' : ''} suivante${following.length > 1 ? 's' : ''} de cette série ?\n\nOK : tout supprimer — Annuler : seulement celle-ci.`)) following.forEach(item => ids.add(item.id));
  state.operations = state.operations.filter(item => !ids.has(item.id));
  saveState(); render();
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

  categoriesAdmin.render();
  placesAdmin.render();
}

/* ---------- Écouteurs ---------- */
function changeMonth(offset) { displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() + offset, 1); render(); }

$('previous-month').addEventListener('click', () => changeMonth(-1));
$('next-month').addEventListener('click', () => changeMonth(1));
$('current-month').addEventListener('click', () => { displayedMonth = new Date(); displayedMonth.setDate(1); render(); });
$('open-operation').addEventListener('click', () => openOperationDialog());
$('empty-add').addEventListener('click', () => openOperationDialog());
$('operation-place').addEventListener('change', () => { updatePlaceOther(); if ($('operation-place').value === PLACE_OTHER) $('operation-place-other').focus(); });
const closeOperationDialog = () => { editingOperationId = null; $('operation-dialog').close(); };
$('close-dialog').addEventListener('click', closeOperationDialog);
$('cancel-dialog').addEventListener('click', closeOperationDialog);
$('operation-dialog').addEventListener('cancel', () => { editingOperationId = null; });
$('operation-type').addEventListener('change', updateTypeFields);
$('operation-recurring').addEventListener('change', event => $('occurrences-field').classList.toggle('hidden', !event.target.checked));
$('operation-form').addEventListener('submit', submitOperation);
$('operation-filter').addEventListener('change', render);

$('transactions-list').addEventListener('click', event => {
  const toggleButton = event.target.closest('[data-toggle]');
  const editButton = event.target.closest('[data-edit]');
  const deleteButton = event.target.closest('[data-delete]');
  if (toggleButton) {
    const operation = state.operations.find(item => item.id === toggleButton.dataset.toggle);
    if (operation) operation.status = operation.status === 'realized' ? 'planned' : 'realized';
    saveState(); render();
  } else if (editButton) {
    const operation = state.operations.find(item => item.id === editButton.dataset.edit);
    if (operation) openOperationDialog(operation);
  } else if (deleteButton) {
    deleteOperation(deleteButton.dataset.delete);
  }
});

// Filtre par type d'opération
$('type-filters').addEventListener('click', event => {
  const chip = event.target.closest('[data-type-filter]');
  if (!chip) return;
  const type = chip.dataset.typeFilter;
  if (typeFilter.has(type)) typeFilter.delete(type); else typeFilter.add(type);
  render();
});
$('clear-filters').addEventListener('click', () => { typeFilter.clear(); $('operation-filter').value = 'all'; render(); });

// Vue sur un seul compte
function pickAccount(id) { viewAccountId = id; render(); }
$('accounts-list').addEventListener('click', event => {
  const row = event.target.closest('[data-pick-account]');
  if (row) pickAccount(row.dataset.pickAccount);
});
$('accounts-list').addEventListener('keydown', event => {
  const row = event.target.closest('[data-pick-account]');
  if (row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); pickAccount(row.dataset.pickAccount); }
});
$('clear-account-filter').addEventListener('click', () => pickAccount(''));

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

// Administration : listes modifiables (catégories, lieux) — ajouter, modifier, supprimer.
function createListAdmin(cfg) {
  const list = $(cfg.listId);
  let editing = null;
  const items = () => state[cfg.stateKey];
  const usage = name => state.operations.filter(operation => operation[cfg.opKey] === name).length;
  function renderList() {
    list.innerHTML = items().map((name, index) => {
      if (name === editing) {
        return `<li class="editing"><input type="text" maxlength="60" value="${escapeHTML(name)}" data-item-input aria-label="Nouveau nom : ${escapeHTML(name)}"><span class="admin-row-actions"><button type="button" data-save-item="${index}">Enregistrer</button><button type="button" class="muted" data-cancel-item>Annuler</button></span></li>`;
      }
      const used = usage(name);
      return `<li><span>${escapeHTML(name)}${used ? ` <small>· ${used} opération${used > 1 ? 's' : ''}</small>` : ''}</span><span class="admin-row-actions"><button type="button" data-edit-item="${index}" aria-label="Modifier : ${escapeHTML(name)}">Modifier</button><button type="button" data-remove-item="${index}" aria-label="Supprimer : ${escapeHTML(name)}">Supprimer</button></span></li>`;
    }).join('');
  }
  $(cfg.formId).addEventListener('submit', event => {
    event.preventDefault();
    const input = $(cfg.inputId);
    const name = input.value.trim();
    if (!name) return;
    if (items().some(item => sameName(item, name))) { alert(cfg.exists); return; }
    items().push(name);
    saveState(); input.value = ''; render();
  });
  list.addEventListener('click', event => {
    const edit = event.target.closest('[data-edit-item]');
    const save = event.target.closest('[data-save-item]');
    const cancel = event.target.closest('[data-cancel-item]');
    const remove = event.target.closest('[data-remove-item]');
    if (edit) {
      editing = items()[Number(edit.dataset.editItem)];
      renderList();
      list.querySelector('input')?.focus();
    } else if (cancel) {
      editing = null; renderList();
    } else if (save) {
      const index = Number(save.dataset.saveItem);
      const oldName = items()[index];
      const newName = save.closest('li').querySelector('input').value.trim();
      if (!newName) return;
      if (items().some((item, i) => i !== index && sameName(item, newName))) { alert(cfg.exists); return; }
      items()[index] = newName;
      // Les opérations déjà saisies suivent le nouveau nom.
      state.operations.forEach(operation => { if (operation[cfg.opKey] === oldName) operation[cfg.opKey] = newName; });
      editing = null;
      saveState(); render();
    } else if (remove) {
      const index = Number(remove.dataset.removeItem);
      if (!confirm(cfg.confirmDelete(items()[index]))) return;
      items().splice(index, 1);
      saveState(); render();
    }
  });
  list.addEventListener('keydown', event => {
    if (!event.target.matches('[data-item-input]')) return;
    if (event.key === 'Enter') { event.preventDefault(); event.target.closest('li').querySelector('[data-save-item]').click(); }
    if (event.key === 'Escape') { editing = null; renderList(); }
  });
  return { render: renderList };
}
const categoriesAdmin = createListAdmin({ stateKey: 'categories', opKey: 'category', listId: 'admin-category-list', formId: 'admin-category-form', inputId: 'admin-category-name', exists: 'Cette catégorie existe déjà.', confirmDelete: name => `Supprimer la catégorie « ${name} » de la liste ? Les opérations existantes seront conservées.` });
const placesAdmin = createListAdmin({ stateKey: 'places', opKey: 'place', listId: 'admin-place-list', formId: 'admin-place-form', inputId: 'admin-place-name', exists: 'Ce lieu existe déjà.', confirmDelete: name => `Supprimer le lieu « ${name} » de la liste ? Les opérations existantes seront conservées.` });


/* ---------- Connexion, statut de synchronisation, sauvegarde ---------- */
function showAuth(message, { canSignIn = false } = {}) {
  document.body.classList.add('app-locked');
  $('auth-message').textContent = message;
  $('sign-in').classList.toggle('hidden', !canSignIn);
  $('sign-in').disabled = false;
}
function unlockApp() { document.body.classList.remove('app-locked'); }
let toastTimer = null;
function notify(text) {
  const toast = $('toast');
  toast.textContent = text;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 9000);
}
function syncStatus() {
  if (!sync.user) return { level: 'off', text: 'Non connecté' };
  if (sync.error) return { level: 'error', text: 'Erreur de synchronisation' };
  const pending = Object.values(sync.meta).some(meta => meta && meta.pending);
  if (!navigator.onLine) return { level: 'offline', text: IS_WINDOWS ? (pending ? 'Hors ligne · modifications en attente' : 'Hors ligne · données de cet appareil') : 'Hors ligne' };
  if (pending) return { level: 'saving', text: 'Synchronisation…' };
  return { level: 'ok', text: 'Synchronisé' };
}
function updateSyncStatus() {
  const status = syncStatus();
  ['sync-status', 'sync-status-footer', 'admin-sync-status'].forEach(id => {
    const element = $(id);
    if (!element) return;
    element.dataset.level = status.level;
    element.querySelector('.sync-text').textContent = status.text;
  });
  $('admin-user').textContent = sync.user ? sync.user.email : '—';
  const offline = sync.user && !navigator.onLine;
  $('offline-banner').classList.toggle('hidden', !offline);
  $('offline-banner').textContent = IS_WINDOWS
    ? 'Mode hors ligne : vous pouvez consulter et saisir. Vos modifications seront synchronisées au retour du réseau.'
    : 'Hors ligne : sur téléphone, Plata nécessite une connexion. Ne fermez pas l’application, vos modifications seraient perdues.';
  if (sync.user && !sync.ready && !sync.error) {
    showAuth(navigator.onLine ? 'Synchronisation en cours…' : (IS_WINDOWS ? 'Hors ligne et aucune donnée sur cet appareil : connectez-vous une première fois au réseau.' : 'Une connexion Internet est nécessaire sur téléphone.'));
  }
}
window.addEventListener('online', updateSyncStatus);
window.addEventListener('offline', updateSyncStatus);
window.addEventListener('beforeunload', event => {
  // Sur téléphone, rien n'est conservé localement : on prévient si des modifications n'ont pas encore atteint le cloud.
  if (!IS_WINDOWS && Object.values(sync.meta).some(meta => meta && meta.pending)) { event.preventDefault(); event.returnValue = ''; }
});

const AUTH_MESSAGES = {
  unauthorized: 'Ce compte Google n’est pas autorisé à accéder à Plata.',
  'auth/popup-closed-by-user': 'Connexion annulée.',
  'auth/cancelled-popup-request': 'Connexion annulée.',
  'auth/network-request-failed': 'Pas de connexion réseau : réessayez une fois en ligne.',
  'auth/unauthorized-domain': 'Ce site n’est pas dans les « domaines autorisés » de Firebase Authentication.'
};
function onAuthChange(user, error) {
  if (!user) {
    stopSync();
    sync.user = null;
    state = emptyState();
    showAuth(error ? (AUTH_MESSAGES[error] || `Connexion impossible (${error}).`) : 'Connectez-vous avec votre compte Google pour accéder à vos comptes.', { canSignIn: true });
    updateSyncStatus();
    return;
  }
  sync.user = user;
  showAuth('Synchronisation en cours…');
  startSync();
  updateSyncStatus();
}
$('sign-in').addEventListener('click', async () => {
  $('sign-in').disabled = true;
  try { await cloud.signIn(); } catch (error) { showAuth(AUTH_MESSAGES[error.code] || `Connexion impossible (${error.code || error.message}).`, { canSignIn: true }); }
});
$('sign-out').addEventListener('click', () => {
  if (confirm('Se déconnecter de Plata ?')) cloud.signOut();
});

// Sauvegardes : export JSON (complet) et CSV (opérations), import JSON (restauration).
function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const todayStamp = () => new Date().toISOString().slice(0, 10);
function exportJson() {
  const data = {
    application: 'Plata', format: 1, exportedAt: new Date().toISOString(),
    accounts: state.accounts.map(({ order, ...account }) => account),
    operations: state.operations, categories: state.categories, places: state.places
  };
  download(`plata-sauvegarde-${todayStamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
  notify(`Sauvegarde exportée : ${state.accounts.length} compte(s), ${state.operations.length} opération(s).`);
}
function exportCsv() {
  const cell = value => { const text = String(value ?? ''); return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  const header = ['Date', 'Type', 'Libellé', 'Montant', 'Sens', 'Compte', 'Compte destinataire', 'Catégorie', 'Lieu', 'Statut'];
  const rows = [...state.operations].sort((a, b) => a.date.localeCompare(b.date)).map(operation => [
    operation.date, (TYPE_INFO[operation.type] || TYPE_INFO.card).label, operation.title,
    Number(operation.amount).toFixed(2).replace('.', ','),
    operation.type === 'income' ? 'Entrée' : isInternal(operation) ? 'Mouvement interne' : 'Sortie',
    accountName(operation.accountId), isInternal(operation) && operation.destinationAccountId ? accountName(operation.destinationAccountId) : '',
    isInternal(operation) ? '' : operation.category || '', operation.place || '',
    operation.status === 'realized' ? 'Réalisée' : 'Prévue'
  ]);
  // BOM + séparateur « ; » : s'ouvre directement dans Excel en français.
  download(`plata-operations-${todayStamp()}.csv`, '﻿' + [header, ...rows].map(row => row.map(cell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  notify(`${rows.length} opération(s) exportée(s) en CSV.`);
}
async function importJson(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (error) { alert('Ce fichier n’est pas une sauvegarde Plata valide (JSON illisible).'); return; }
  const valid = data && Array.isArray(data.accounts) && Array.isArray(data.operations)
    && data.accounts.every(account => account && account.id && account.name)
    && data.operations.every(operation => operation && operation.id && operation.type && operation.date && operation.accountId && Number.isFinite(Number(operation.amount)));
  if (!valid) { alert('Ce fichier n’est pas une sauvegarde Plata valide.'); return; }
  const incoming = normalizeState(data);
  if (!confirm(`Restaurer cette sauvegarde ?\n\nElle REMPLACE toutes les données actuelles (${state.accounts.length} compte(s), ${state.operations.length} opération(s)) par ${incoming.accounts.length} compte(s) et ${incoming.operations.length} opération(s).\n\nPensez à exporter une sauvegarde de l’état actuel avant.`)) return;
  state.accounts = incoming.accounts; state.operations = incoming.operations; state.categories = incoming.categories; state.places = incoming.places;
  viewAccountId = '';
  saveState(); render();
  notify('Sauvegarde restaurée.');
}
$('export-json').addEventListener('click', exportJson);
$('export-csv').addEventListener('click', exportCsv);
$('import-json').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; if (file) importJson(file); });

/* ---------- Effacer toutes les données ---------- */
const CLEAR_WORD = 'EFFACER';
function clearAllData() {
  state.accounts = []; state.operations = []; state.categories = []; state.places = [];
  state.adminDefaultAccountId = '';
  viewAccountId = ''; typeFilter.clear();
  sync.synced.settings = ''; // force la réécriture du document « réglages » (il doit rester, sinon l'application recrée des comptes de départ)
  saveState(); render();
}
$('open-clear').addEventListener('click', () => { $('clear-form').reset(); $('clear-submit').disabled = true; $('clear-dialog').showModal(); });
$('clear-confirm').addEventListener('input', () => { $('clear-submit').disabled = $('clear-confirm').value.trim().toUpperCase() !== CLEAR_WORD; });
['close-clear', 'cancel-clear'].forEach(id => $(id).addEventListener('click', () => $('clear-dialog').close()));
$('clear-form').addEventListener('submit', event => {
  event.preventDefault();
  if ($('clear-confirm').value.trim().toUpperCase() !== CLEAR_WORD) return;
  clearAllData();
  $('clear-dialog').close();
  notify('Toutes les données ont été effacées.');
});

/* ---------- Import Excel (assistant, ligne par ligne) ----------
   Le fichier est lu dans le navigateur (excel.bundle.js, chargé à la demande).
   Chaque ligne devient une « ligne d'import » vérifiable, corrigeable et décochable avant d'écrire quoi que ce soit. */
const EXCEL_TYPES = { VER: 'income', PRL: 'direct-debit', CB: 'card', RET: 'withdrawal', CHQ: 'check', EPA: 'savings' };
const IMPORT_ACCOUNT_NAME = 'Caisse d’Epargne';
// Catégories déduites du libellé (première règle qui correspond). Le dernier champ limite la règle aux entrées d'argent.
const CATEGORY_RULES = [
  [/REMB\.?\s?EMPR/, 'Crédits'],
  [/SALAIRE/, 'Salaire'],
  [/LOYER/, 'Revenus locatifs'],
  [/REMB|REGUL|ERREUR/, 'Remboursement', true],
  [/IMPOT|IMPÔT|ACOMPTE MENSUEL|DGFIP/, 'Impôts'],
  [/CPAM|AG2R/, 'Santé'],
  [/MATMUT|MACIF|APRIL|ASSURANCE/, 'Assurance'],
  [/UBER ?EAT/, 'Restaurants'],
  [/AIR ?FRANCE|VOL AF|PAYPAL AF\b|IBERIA|AVIANCA|HOTEL|HÔTEL|VALISE|SNCF/, 'Voyages'],
  [/VINCI|PEAGE|PÉAGE|\bASF\b|NAVIGO|PARKING|INDIGO|QPARK|EFFIA|UBER|CARBURANT|ESSENCE|PNEU|LAVAGE AUTO|CONTR[ÔO]LE TECHNIQUE/, 'Transport'],
  [/VETERINAIRE|VÉTÉRINAIRE/, 'Animaux'],
  [/PHARMACIE|DENTISTE|^DOC |LABORATOIRE/, 'Santé'],
  [/\bFREE\b|SOSH|SATELLIS|ICLOUD|CHATGPT|MICROSOFT|NORDVPN|MUSIC|IPTVX|LINKEDIN|PRIME|APPSTORE|APPLESTORE/, 'Abonnements'],
  [/\bEDF\b|EAUX|CHARGE DOM|CHARGES FONCIA|VERISURE|WELDOM|JARDI|LAVERIE|NOTAIRE/, 'Logement'],
  [/CHG CB|FRAIS BANCAIRES|CEPAC/, 'Frais bancaires'],
  [/ACHAT ACTION|\bPEE\b/, 'Épargne et placements'],
  [/BOURSO|REVOLUT|BRSM/, 'Virements perso'],
  [/\bKDO\b|WERO|NATHY|MARIAGE|POT COMMUN|\bCLEM\b|CARLA|\bISA\b|DELPHINE|LIONEL|\bLIVA\b|\bDON\b/, 'Famille et cadeaux'],
  [/INTERMARCH|LECLERC|GRAND FRAIS|CARREFOUR|BOULANGERIE|PAIN DE|^PAUL$|CHOCOLATERIE|MY ?BEER|INTERCAVES|BOISSON|BLACHERE|BLACHÈRE|NESPRESSO/, 'Alimentation'],
  [/RESTO|PIZZA|CAF[ÉE]|^BAR |FIVE GUYS|SUSHI|PR[ÊE]T [ÀA] MANGER|STARBUCK|SPLENDIDO|PHENIX|COMPTOIR|AU FUT|BAHIA|YELLOW MONKEYS|PYRAME|FOODTRUCK/, 'Restaurants'],
  [/CINEPLANET|FDJ|LOTO|FNAC|DECATHLON|INTERSPORT|SUMUP/, 'Loisirs']
];
function guessCategory(title, type) {
  if (isInternal({ type })) return '';
  const text = String(title || '').toLocaleUpperCase('fr').trim();
  const found = CATEGORY_RULES.find(([pattern, , onlyIncome]) => (!onlyIncome || type === 'income') && pattern.test(text));
  if (found) return found[1];
  return type === 'income' ? 'Autres revenus' : 'Autres dépenses';
}

function plain(value) { return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase(); }
function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : '';
}
// Date Excel (numéro de série, texte jj/mm/aaaa ou aaaa-mm-jj) → « AAAA-MM-JJ », ou '' si illisible.
function excelDate(value) {
  if (typeof value === 'number' && value > 20000 && value < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  const text = String(value ?? '').trim();
  let match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (match) return isoDate(Number(match[3]), Number(match[2]), Number(match[1]));
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? isoDate(Number(match[1]), Number(match[2]), Number(match[3])) : '';
}
// Montant Excel → nombre, null si vide, NaN si illisible.
function excelAmount(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  if (typeof value === 'number') return value;
  const number = Number(String(value).replace(/[\s€ ]/g, '').replace(',', '.'));
  return Number.isFinite(number) ? number : NaN;
}
const round2 = value => Math.round(Number(value) * 100) / 100;

// Lit un onglet : repère la ligne d'en-têtes (DATE, TYPE, MONTANT…) puis chaque opération. Retourne null si ce n'est pas un onglet d'opérations.
function parseSheet(sheet, fileName) {
  const rows = sheet.rows;
  let header = -1; let cols = null;
  for (let r = 0; r < Math.min(rows.length, 40) && header < 0; r += 1) {
    const names = (rows[r] || []).map(plain);
    const find = test => names.findIndex(name => name && test(name));
    const candidate = { date: find(n => n === 'DATE'), type: find(n => n === 'TYPE'), title: find(n => /^(NATURE|LIBELLE)/.test(n)), place: find(n => /^LIEU/.test(n)), amount: find(n => /^MONTANT/.test(n)), mark: find(n => n === '<>' || n === '✓' || n === '✔' || /^POINT/.test(n)) };
    if (candidate.date >= 0 && candidate.type >= 0 && candidate.amount >= 0) { header = r; cols = candidate; }
  }
  if (header < 0) return null;
  let opening = null;
  for (let r = 0; r < header; r += 1) {
    const row = rows[r] || [];
    if (/SOLDE PRECEDENT/.test(plain(row[0]))) { const value = row.slice(1).find(cell => typeof cell === 'number'); if (value !== undefined) opening = value; }
  }
  const lines = [];
  for (let r = header + 1; r < rows.length; r += 1) {
    const row = rows[r] || [];
    const rawDate = row[cols.date]; const rawType = row[cols.type]; const rawAmount = row[cols.amount];
    const empty = value => value === null || value === undefined || String(value).trim() === '';
    if (empty(rawDate) && empty(rawType) && empty(rawAmount)) continue;
    const code = plain(rawType);
    lines.push({
      file: fileName, sheet: sheet.name, row: r + 1,
      mark: cols.mark >= 0 && !empty(row[cols.mark]),
      date: excelDate(rawDate), rawDate: empty(rawDate) ? '' : String(rawDate),
      code, type: EXCEL_TYPES[code] || '',
      title: String(row[cols.title] ?? '').replace(/\s+/g, ' ').trim(),
      place: cols.place >= 0 ? String(row[cols.place] ?? '').replace(/\s+/g, ' ').trim() : '',
      amount: excelAmount(rawAmount)
    });
  }
  return { name: sheet.name, lines, opening };
}

const importState = { lines: [], opening: null, files: [], skipped: [], filter: 'all', categoriesTouched: false };
function loadExcelReader() {
  if (window.PlataExcel) return Promise.resolve(window.PlataExcel);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = './excel.bundle.js';
    script.onload = () => (window.PlataExcel ? resolve(window.PlataExcel) : reject(new Error('Lecteur Excel indisponible.')));
    script.onerror = () => reject(new Error('Le lecteur Excel n’a pas pu être chargé (connexion requise la première fois).'));
    document.head.appendChild(script);
  });
}

function importTargetAccountId() { const value = $('import-account').value; return value === '__new__' ? '' : value; }
// Contrôle d'une ligne : erreurs (non importable) et points à vérifier. Recalculé après chaque correction.
function checkImportLine(line, all) {
  const issues = []; let level = 'ok';
  const raise = (kind, text) => { issues.push(text); if (kind === 'error') level = 'error'; else if (level === 'ok') level = 'warn'; };
  if (!line.date) raise('error', line.rawDate ? `Date illisible (« ${line.rawDate} »)` : 'Date manquante');
  if (!line.type) raise('error', line.code ? `Type inconnu (« ${line.code} »)` : 'Type manquant');
  if (Number.isNaN(line.amount)) raise('error', 'Montant illisible');
  else if (line.amount === null) raise('warn', 'Montant vide');
  else if (line.amount === 0) raise('warn', 'Montant à zéro');
  else if (line.amount < 0) raise('warn', 'Montant négatif (le sens est donné par le type)');
  if (!line.title) raise('warn', 'Libellé vide');
  if (line.date && line.sheetMonth && line.date.slice(0, 7) !== line.sheetMonth) raise('warn', `Date hors du mois de l’onglet (${line.sheetMonth})`);
  if (line.date && line.type && typeof line.amount === 'number' && !Number.isNaN(line.amount)) {
    const key = `${line.date}|${line.type}|${plain(line.title)}|${round2(line.amount)}`;
    if (all.get(key) !== line) raise('warn', 'Doublon probable dans l’import');
    const accountId = importTargetAccountId();
    if (accountId && state.operations.some(op => op.accountId === accountId && op.date === line.date && op.type === line.type && plain(op.title) === plain(line.title) && round2(op.amount) === round2(line.amount))) raise('warn', 'Existe déjà dans l’application');
  }
  if (line.type === 'savings' && !$('import-savings-account').value) issues.push('Épargne : destination à définir plus tard');
  line.issues = issues; line.level = level;
}
function checkAllImportLines() {
  const first = new Map();
  importState.lines.forEach(line => {
    if (line.date && line.type && typeof line.amount === 'number') { const key = `${line.date}|${line.type}|${plain(line.title)}|${round2(line.amount)}`; if (!first.has(key)) first.set(key, line); }
  });
  importState.lines.forEach(line => checkImportLine(line, first));
}
function importCategoryChoices() {
  const names = [...state.categories];
  importState.lines.forEach(line => { if (line.category && !names.some(name => sameName(name, line.category))) names.push(line.category); });
  CATEGORY_RULES.forEach(([, name]) => { if (!names.some(item => sameName(item, name))) names.push(name); });
  ['Autres revenus', 'Autres dépenses'].forEach(name => { if (!names.some(item => sameName(item, name))) names.push(name); });
  return names;
}
function importRowHTML(line, index, categories) {
  const internal = isInternal({ type: line.type });
  const typeOptions = `<option value="">—</option>` + Object.entries(TYPE_INFO).filter(([type]) => type !== 'transfer').map(([type, info]) => `<option value="${type}"${line.type === type ? ' selected' : ''}>${escapeHTML(info.label)}</option>`).join('');
  const categoryOptions = categories.map(name => `<option value="${escapeHTML(name)}"${line.category === name ? ' selected' : ''}>${escapeHTML(name)}</option>`).join('');
  const amountValue = typeof line.amount === 'number' && !Number.isNaN(line.amount) ? line.amount : '';
  return `<tr data-i="${index}" class="import-${line.level}"><td><input type="checkbox" data-f="checked" aria-label="Importer la ligne ${line.row} de ${escapeHTML(line.sheet)}"${line.checked ? ' checked' : ''}${line.level === 'error' ? ' disabled' : ''}></td>${importStatusCell(line)}<td><input type="date" data-f="date" value="${escapeHTML(line.date)}"></td><td><select data-f="type">${typeOptions}</select></td><td><input type="text" data-f="title" value="${escapeHTML(line.title)}"></td><td><input type="text" data-f="place" value="${escapeHTML(internal ? '' : line.place)}"${internal ? ' disabled' : ''}></td><td><select data-f="category"${internal ? ' disabled' : ''}><option value=""></option>${categoryOptions}</select></td><td><input type="number" step="0.01" data-f="amount" value="${amountValue}"></td><td><select data-f="status"><option value="realized"${line.status === 'realized' ? ' selected' : ''}>Réalisée</option><option value="planned"${line.status === 'planned' ? ' selected' : ''}>Prévue</option></select></td></tr>`;
}
function importStatusCell(line) {
  const label = { ok: 'Valide', warn: 'À vérifier', error: 'Erreur' }[line.level];
  const detail = line.issues.length ? `<span class="import-issue">${escapeHTML(line.issues.join(' · '))}</span>` : '';
  return `<td class="import-status-cell"><span class="import-badge ${line.level}">${label}</span>${detail}<span class="import-origin">${escapeHTML(line.sheet)} · l.${line.row}</span></td>`;
}
function importVisible(line) {
  const filter = importState.filter;
  return filter === 'all' || (filter === 'unchecked' ? !line.checked : line.level === filter);
}
function renderImportRows() {
  const categories = importCategoryChoices();
  $('import-rows').innerHTML = importState.lines.map((line, index) => importVisible(line) ? importRowHTML(line, index, categories) : '').join('');
  updateImportSummary();
}
function refreshImportRow(index) {
  const line = importState.lines[index];
  const row = $('import-rows').querySelector(`tr[data-i="${index}"]`);
  if (!row) return;
  row.className = `import-${line.level}`;
  row.querySelector('.import-status-cell').outerHTML = importStatusCell(line);
  const box = row.querySelector('[data-f="checked"]');
  box.checked = line.checked; box.disabled = line.level === 'error';
  const internal = isInternal({ type: line.type });
  const place = row.querySelector('[data-f="place"]'); place.disabled = internal; if (internal) place.value = '';
  const category = row.querySelector('[data-f="category"]'); category.disabled = internal;
  if (!internal) { if (![...category.options].some(option => option.value === line.category)) category.add(new Option(line.category, line.category)); category.value = line.category; }
}
function updateImportSummary() {
  const lines = importState.lines;
  const count = level => lines.filter(line => line.level === level).length;
  const selected = lines.filter(line => line.checked && line.level !== 'error');
  const money2 = value => money(round2(value));
  $('import-counters').innerHTML = `<span class="import-chip"><strong>${lines.length}</strong> lignes lues</span><span class="import-chip ok"><strong>${count('ok')}</strong> valides</span><span class="import-chip warn"><strong>${count('warn')}</strong> à vérifier</span><span class="import-chip error"><strong>${count('error')}</strong> en erreur</span><span class="import-chip"><strong>${selected.length}</strong> cochées</span>`;
  const target = importTargetAccountId();
  const existing = target ? state.accounts.find(account => account.id === target) : null;
  const opening = existing ? Number(existing.balance || 0) : Number($('import-balance').value) || 0;
  const effect = filterFn => selected.filter(filterFn).reduce((total, line) => total + (line.type === 'income' ? 1 : -1) * (Number(line.amount) || 0), 0);
  const incomes = selected.filter(line => line.type === 'income').reduce((total, line) => total + (Number(line.amount) || 0), 0);
  const outgoing = selected.filter(line => line.type !== 'income').reduce((total, line) => total + (Number(line.amount) || 0), 0);
  const dates = selected.map(line => line.date).filter(Boolean).sort();
  const newCategories = new Set(selected.filter(line => !isInternal({ type: line.type }) && line.category && !state.categories.some(name => sameName(name, line.category))).map(line => line.category));
  const newPlaces = new Set(selected.filter(line => !isInternal({ type: line.type }) && line.place && !state.places.some(name => sameName(name, line.place))).map(line => plain(line.place)));
  $('import-recap').innerHTML = `<h3>Récapitulatif avant import</h3><ul>
    <li><strong>${selected.length}</strong> opérations seront importées${dates.length ? ` (du ${dateFormatter.format(new Date(`${dates[0]}T12:00:00`))} au ${dateFormatter.format(new Date(`${dates[dates.length - 1]}T12:00:00`))})` : ''}.</li>
    <li>Entrées : <strong>${money2(incomes)}</strong> · Sorties : <strong>${money2(outgoing)}</strong></li>
    <li>Solde initial : <strong>${money2(opening)}</strong> → solde réalisé après import : <strong>${money2(opening + effect(line => line.status === 'realized'))}</strong> · solde prévisionnel : <strong>${money2(opening + effect(() => true))}</strong></li>
    <li>À créer : ${newCategories.size} catégorie(s), ${newPlaces.size} lieu(x)${target ? '' : `, le compte « ${escapeHTML(IMPORT_ACCOUNT_NAME)} »`}.</li></ul>`;
  $('import-confirm').textContent = `Importer ${selected.length} opération${selected.length > 1 ? 's' : ''}`;
  $('import-confirm').disabled = selected.length === 0;
}

function fillImportSettings() {
  const existing = state.accounts.find(account => sameName(account.name, IMPORT_ACCOUNT_NAME));
  $('import-account').innerHTML = `<option value="__new__">Créer « ${escapeHTML(IMPORT_ACCOUNT_NAME)} »</option>` + state.accounts.map(account => `<option value="${escapeHTML(account.id)}">${escapeHTML(account.name)}</option>`).join('');
  $('import-account').value = existing ? existing.id : '__new__';
  const balance = importState.opening === null ? 0 : round2(importState.opening);
  $('import-balance').value = balance.toFixed(2);
  updateImportAccountFields();
}
function updateImportAccountFields() {
  const isNew = !importTargetAccountId();
  $('import-balance-field').classList.toggle('hidden', !isNew);
  const target = importTargetAccountId();
  const others = state.accounts.filter(account => account.id !== target);
  const keep = $('import-savings-account').value;
  $('import-savings-account').innerHTML = `<option value="">— À définir plus tard —</option>` + others.map(account => `<option value="${escapeHTML(account.id)}">${escapeHTML(account.name)}</option>`).join('');
  $('import-savings-account').value = others.some(account => account.id === keep) ? keep : '';
  $('import-savings-field').classList.toggle('hidden', !importState.lines.some(line => line.type === 'savings'));
}

async function readImportFiles(files) {
  const status = $('import-file-status');
  status.textContent = 'Lecture en cours…';
  try {
    const reader = await loadExcelReader();
    const lines = []; const names = []; const skipped = []; const openings = [];
    for (const file of files) {
      const sheets = reader.read(await file.arrayBuffer());
      sheets.forEach(sheet => {
        const parsed = parseSheet(sheet, file.name);
        if (!parsed) { skipped.push(`${file.name} › ${sheet.name}`); return; }
        if (parsed.lines.length) {
          lines.push(...parsed.lines);
          if (parsed.opening !== null) openings.push({ value: parsed.opening, date: parsed.lines.map(line => line.date).filter(Boolean).sort()[0] || '9999' });
        }
      });
      names.push(file.name);
    }
    if (!lines.length) { status.textContent = 'Aucune opération reconnue : il faut des colonnes DATE, TYPE et MONTANT dans l’en-tête d’un onglet.'; return; }
    lines.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.sheet.localeCompare(b.sheet) || a.row - b.row);
    openings.sort((a, b) => a.date.localeCompare(b.date));
    const monthCount = new Map(); // mois dominant de chaque onglet : une ligne datée d'un autre mois est signalée
    lines.forEach(line => { if (line.date) { const key = `${line.file}|${line.sheet}`; const counts = monthCount.get(key) || new Map(); counts.set(line.date.slice(0, 7), (counts.get(line.date.slice(0, 7)) || 0) + 1); monthCount.set(key, counts); } });
    lines.forEach(line => { const counts = monthCount.get(`${line.file}|${line.sheet}`); if (counts) line.sheetMonth = [...counts.entries()].sort((x, y) => y[1] - x[1])[0][0]; });
    lines.forEach(line => {
      line.status = line.mark ? 'realized' : 'planned';
      line.category = guessCategory(line.title, line.type);
    });
    Object.assign(importState, { lines, opening: openings.length ? openings[0].value : null, files: names, skipped, filter: 'all' });
    $('import-filter').value = 'all';
    fillImportSettings();
    checkAllImportLines();
    lines.forEach(line => { line.checked = line.level === 'ok'; });
    $('import-sources').textContent = `${names.join(' · ')} — ${lines.length} lignes lues` + (importState.opening !== null ? ` · solde précédent lu : ${money(round2(importState.opening))}` : '') + (skipped.length ? ` · onglets ignorés (pas d’opérations) : ${skipped.length}` : '');
    $('import-step-file').classList.add('hidden');
    $('import-step-review').classList.remove('hidden');
    renderImportRows();
  } catch (error) {
    console.error(error);
    status.textContent = `Lecture impossible : ${error.message || error}`;
  }
}
function showImportDialog() {
  $('import-step-file').classList.remove('hidden');
  $('import-step-review').classList.add('hidden');
  $('import-file-status').textContent = '';
  $('import-dialog').showModal();
}
function applyImportEdit(line, field, target) {
  if (field === 'checked') { line.checked = target.checked; return; }
  if (field === 'date') { line.date = target.value; line.rawDate = ''; }
  else if (field === 'type') {
    line.type = target.value;
    if (!line.categoryEdited) line.category = guessCategory(line.title, line.type);
  } else if (field === 'title') { line.title = target.value; if (!line.categoryEdited) line.category = guessCategory(line.title, line.type); }
  else if (field === 'place') line.place = target.value.trim();
  else if (field === 'category') { line.category = target.value; line.categoryEdited = true; }
  else if (field === 'amount') line.amount = target.value === '' ? null : Number(target.value);
  else if (field === 'status') line.status = target.value;
  if (!['checked', 'status', 'category', 'place'].includes(field)) {
    const before = line.level;
    checkAllImportLines();
    if (line.level === 'error') line.checked = false;
    else if (line.level === 'ok' && before !== 'ok') line.checked = true;
  }
}
function onImportEdit(event) {
  const target = event.target; const field = target.dataset.f;
  const row = target.closest('tr[data-i]');
  if (!field || !row) return;
  const index = Number(row.dataset.i);
  applyImportEdit(importState.lines[index], field, target);
  if (field === 'type') updateImportAccountFields();
  importState.lines.forEach((line, i) => refreshImportRow(i)); // un doublon ou une erreur peut changer l'état d'autres lignes
  updateImportSummary();
}
function confirmImport() {
  const selected = importState.lines.filter(line => line.checked && line.level !== 'error');
  if (!selected.length) return;
  const targetId = importTargetAccountId();
  const dates = selected.map(line => line.date).sort();
  if (!confirm(`Importer ${selected.length} opération(s) du ${dates[0]} au ${dates[dates.length - 1]} ?\n\n${targetId ? 'Elles seront ajoutées au compte existant.' : `Le compte « ${IMPORT_ACCOUNT_NAME} » sera créé (solde initial : ${money(round2(Number($('import-balance').value) || 0))}).`}`)) return;
  let accountId = targetId;
  if (!accountId) {
    accountId = makeId();
    state.accounts.push({ id: accountId, name: IMPORT_ACCOUNT_NAME, kind: 'Compte courant', icon: ACCOUNT_ICONS['Compte courant'], balance: round2(Number($('import-balance').value) || 0) });
  }
  const savingsDestination = $('import-savings-account').value || null;
  selected.forEach(line => {
    const internal = isInternal({ type: line.type });
    let category = line.category; let place = line.place;
    if (!internal) {
      const knownCategory = state.categories.find(name => sameName(name, category));
      if (knownCategory) category = knownCategory; else if (category) state.categories.push(category);
      const knownPlace = state.places.find(name => sameName(name, place));
      if (knownPlace) place = knownPlace; else if (place) state.places.push(place);
    }
    state.operations.push({
      id: makeId(), type: line.type, amount: round2(line.amount || 0), accountId,
      destinationAccountId: internal ? savingsDestination : null,
      category: internal ? TYPE_INFO[line.type].label : category, place: internal ? '' : place,
      title: line.title, date: line.date, status: line.status, seriesId: null
    });
  });
  saveState(); render();
  $('import-dialog').close();
  setAdminView(false);
  history.replaceState(null, '', location.pathname + location.search);
  notify(`${selected.length} opération(s) importée(s) dans « ${accountName(accountId)} ».`);
}
$('open-import').addEventListener('click', showImportDialog);
$('close-import').addEventListener('click', () => $('import-dialog').close());
$('import-pick').addEventListener('click', () => $('import-excel-file').click());
$('import-excel-file').addEventListener('change', event => { const files = [...event.target.files]; event.target.value = ''; if (files.length) readImportFiles(files); });
$('import-back').addEventListener('click', showImportDialog);
$('import-rows').addEventListener('change', onImportEdit);
$('import-filter').addEventListener('change', () => { importState.filter = $('import-filter').value; renderImportRows(); });
$('import-check-valid').addEventListener('click', () => { importState.lines.forEach(line => { if (line.level === 'ok') line.checked = true; }); renderImportRows(); });
$('import-uncheck-all').addEventListener('click', () => { importState.lines.forEach(line => { line.checked = false; }); renderImportRows(); });
$('import-account').addEventListener('change', () => { updateImportAccountFields(); checkAllImportLines(); renderImportRows(); });
$('import-balance').addEventListener('input', updateImportSummary);
$('import-savings-account').addEventListener('change', () => { checkAllImportLines(); renderImportRows(); });
$('import-confirm').addEventListener('click', confirmImport);

/* ---------- Démarrage ---------- */
setAdminView(location.hash === '#admin');
if (!cloud) {
  showAuth('Le module de connexion n’a pas pu être chargé. Vérifiez votre connexion et rechargez la page.');
} else {
  cloud.init({ persistent: IS_WINDOWS });
  cloud.onAuth(onAuthChange);
}
// Mode hors ligne : uniquement sur Windows. Sur téléphone, le service worker ne met rien en cache.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register(IS_WINDOWS ? './sw.js?offline=1' : './sw.js').catch(error => console.warn('Service worker non enregistré.', error)));
}
