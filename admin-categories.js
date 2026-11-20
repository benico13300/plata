(function () {
  const adminPage = document.getElementById('admin-page');
  const cards = adminPage?.querySelectorAll('.admin-card');
  const categoryCard = cards?.[2];
  if (categoryCard) {
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
  }

  // Use the provided SVG directly as an image. Avoid an SVG embedding another
  // SVG, which some mobile browsers and installed PWAs fail to render.
  const brand = document.querySelector('.brand');
  if (brand) {
    brand.replaceChildren();
    const logo = document.createElement('img');
    logo.className = 'brand-emblem';
    logo.src = './logo1.svg';
    logo.alt = '';
    logo.width = 44;
    logo.height = 44;
    logo.decoding = 'async';
    brand.append(logo);
    brand.setAttribute('aria-label', 'Plata, accueil');
    brand.setAttribute('title', 'Plata');
  }

  const style = document.createElement('style');
  style.textContent = `
    .sidebar .brand{box-sizing:border-box;display:flex!important;align-items:center!important;justify-content:flex-start!important;gap:0!important;width:100%;min-width:0!important;min-height:52px;padding:4px!important;overflow:visible!important}
    .sidebar .brand .brand-mark,.sidebar .brand>span{display:none!important}
    .sidebar .brand .brand-emblem{display:block!important;visibility:visible!important;opacity:1!important;box-sizing:border-box;width:44px!important;height:44px!important;max-width:100%!important;max-height:44px!important;flex:0 0 44px!important;object-fit:contain!important;object-position:left center!important}
    @media(max-width:700px){.sidebar .brand{width:44px!important;min-width:44px!important;height:50px!important;min-height:50px!important;padding:3px!important}.sidebar .brand .brand-emblem{width:38px!important;height:38px!important;max-height:38px!important;flex-basis:38px!important}}
  `;
  document.head.append(style);
})();
