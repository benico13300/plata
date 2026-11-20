# Plata

Gestion de comptes personnels : PWA (Windows + téléphone) synchronisée avec Firebase.

## Fonctionnement

- **Connexion** : Google, un seul compte autorisé (voir `ALLOWED_EMAIL` dans `src/cloud.js` et `firestore.rules`).
- **Données** : Firestore, sous `users/<uid>/` — `accounts`, `operations`, `settings/main`.
- **Windows** : cache durable (IndexedDB) + service worker → consultation et saisie hors ligne, synchronisation au retour du réseau.
- **Téléphone** : en ligne uniquement. Cache en mémoire, aucun service worker de cache, rien n'est conservé sur l'appareil.
- **Sauvegarde** : Administration → export JSON (complet, restaurable) et CSV (opérations, pour Excel).

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html`, `styles.css`, `app.js` | Application |
| `src/cloud.js` | Connexion Google + Firestore (assemblé avec le SDK Firebase) |
| `cloud.bundle.js` | Résultat de l'assemblage (**à régénérer** si `src/cloud.js` change) |
| `sw.js` | Service worker (cache hors ligne seulement sur Windows) |
| `firestore.rules` | Règles de sécurité à publier dans la console Firebase |

## Régénérer `cloud.bundle.js`

```
npm install
npm run build
```

## Règles de sécurité Firestore

Console Firebase → Firestore Database → onglet **Règles** → coller le contenu de `firestore.rules` → **Publier**.

## Configuration Firebase

La clé `apiKey` de `src/cloud.js` est publique par conception : la protection vient des règles Firestore et de la liste des domaines autorisés (Authentication → Paramètres).
