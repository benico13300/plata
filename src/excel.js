// Lecteur Excel chargé à la demande (assistant d'import). Le fichier est lu dans le navigateur, rien n'est envoyé.
import * as XLSX from 'xlsx';

// Retourne [{ name, rows }] : chaque onglet sous forme de lignes de cellules (nombres, textes ou null).
// Les dates restent des numéros de série Excel (convertis ensuite par l'application, sans décalage de fuseau).
function read(buffer) {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  return workbook.SheetNames.map(name => ({
    name,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true })
  }));
}
window.PlataExcel = { read };
