(() => {
  const brand = document.querySelector('.sidebar .brand');
  if (!brand) return;

  // Remove any text wordmark left by the older page/scripts and show only the
  // supplied logo asset. The image is kept inside the sidebar's compact brand area.
  const image = document.createElement('img');
  image.className = 'brand-emblem';
  image.src = './logo1.svg';
  image.alt = '';
  image.width = 44;
  image.height = 44;
  image.setAttribute('aria-hidden', 'true');
  brand.replaceChildren(image);
  brand.setAttribute('aria-label', 'Plata, accueil');
  brand.title = 'Plata';

  const style = document.createElement('style');
  style.textContent = `
    .sidebar .brand{box-sizing:border-box!important;display:flex!important;align-items:center!important;justify-content:flex-start!important;width:100%!important;min-width:0!important;min-height:54px!important;padding:4px!important;gap:0!important;overflow:visible!important}
    .sidebar .brand>*:not(.brand-emblem){display:none!important}
    .sidebar .brand .brand-emblem{display:block!important;visibility:visible!important;opacity:1!important;width:48px!important;height:48px!important;max-width:48px!important;max-height:48px!important;flex:0 0 48px!important;object-fit:contain!important;object-position:center!important}
    @media(max-width:700px){.sidebar .brand{width:48px!important;min-width:48px!important;height:54px!important;min-height:54px!important;padding:3px!important}.sidebar .brand .brand-emblem{width:44px!important;height:44px!important;max-width:44px!important;max-height:44px!important;flex-basis:44px!important}}
  `;
  document.head.append(style);
})();
