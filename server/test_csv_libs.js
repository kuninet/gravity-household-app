const { stringify } = require('csv-stringify');
const { parse } = require('csv-parse');
const iconv = require('iconv-lite');

console.log('stringify is:', typeof stringify);
console.log('parse is:', typeof parse);

const data = [{ a: 1, b: 'test' }];
try {
    stringify(data, { header: true }, (err, out) => {
        if (err) console.error('Stringify Error:', err);
        else console.log('Stringify Output:', out.trim());
    });
} catch (e) {
    console.error('Stringify Exception:', e);
}

const csv = 'col1,col2\nval1,val2';
try {
    parse(csv, { columns: true }, (err, records) => {
        if (err) console.error('Parse Error:', err);
        else console.log('Parse Output:', records);
    });
} catch (e) {
    console.error('Parse Exception:', e);
}
