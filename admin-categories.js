(function () {
  const adminPage = document.getElementById('admin-page');
  const cards = adminPage?.querySelectorAll('.admin-card');
  const categoryCard = cards?.[2];
  if (!categoryCard) return;

  categoryCard.innerHTML = `
    <p class="eyebrow">OPÉRATIONS</p>
    <h2>Gérer les catégories</h2>
    <p>Ajoutez des catégories à sélectionner lors de la création d’une opération.</p>
    <form id="admin-category-form" class="admin-form">
      <label class="field">Nom de la catégorie
        <input id="admin-category-name" type="text" maxlength="40" placeholder="Ex. Animaux, Cadeaux…" required>
      </label>
      <button class="button button-primary" type="submit">Ajouter la catégorie</button>
    </form>
    <ul id="admin-category-list" class="admin-list"></ul>`;

  const brand = document.querySelector('.brand');
  if (brand) {
    brand.innerHTML = '<img class="brand-emblem" src="./logo1.svg" alt="">';
    brand.setAttribute('aria-label', 'Plata, accueil');
  }

  const style = document.createElement('style');
  style.textContent = `
    .brand{display:flex!important;align-items:center!important;justify-content:flex-start!important;gap:0!important;min-width:0!important;overflow:hidden}
    .brand .brand-emblem{display:block!important;width:42px!important;height:42px!important;max-width:100%!important;flex:0 0 42px!important;object-fit:contain!important}
    @media(max-width:700px){.brand{width:38px!important;min-width:38px!important;padding:0!important}.brand .brand-emblem{width:34px!important;height:34px!important;flex-basis:34px!important}}
  `;
  document.head.append(style);

  const list = document.getElementById('admin-category-list');
  function renderCategoriesAdmin() {
    if (!Array.isArray(state.categories)) state.categories = [];
    list.innerHTML = state.categories.map((category, index) =>
      `<li><span>${escapeHTML(category)}</span><button type="button" data-remove-category="${index}" aria-label="Supprimer la catégorie ${escapeHTML(category)}">Supprimer</button></li>`
    ).join('');
  }

  document.getElementById('admin-category-form').addEventListener('submit', event => {
    event.preventDefault();
    const input = document.getElementById('admin-category-name');
    const name = input.value.trim();
    if (!name) return;
    if (state.categories.some(category => category.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'))) {
      alert('Cette catégorie existe déjà.');
      return;
    }
    state.categories.push(name);
    saveState();
    input.value = '';
    renderCategoriesAdmin();
    if (typeof render === 'function') render();
  });

  list.addEventListener('click', event => {
    const button = event.target.closest('[data-remove-category]');
    if (!button) return;
    const category = state.categories[Number(button.dataset.removeCategory)];
    if (!confirm(`Supprimer la catégorie « ${category} » de la liste ? Les opérations existantes seront conservées.`)) return;
    state.categories.splice(Number(button.dataset.removeCategory), 1);
    saveState();
    renderCategoriesAdmin();
    if (typeof render === 'function') render();
  });

  renderCategoriesAdmin();
})();
