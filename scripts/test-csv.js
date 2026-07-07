import { readCsv } from '../pipeline/csv.js';
const rows = await readCsv('./data/csv/FEP_2013.csv');
console.log('Total filas:', rows.length);
rows.slice(0, 4).forEach(r => console.log(JSON.stringify(r)));
