const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Determine the database file path
const dbPath = path.resolve(__dirname, 'household.db');
console.log(`Connecting to database at: ${dbPath}`);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Failed to open database:', err.message);
        process.exit(1);
    }
});

// Run the update query
db.serialize(() => {
    // Check current state before update (optional but helpful)
    db.get('SELECT * FROM categories WHERE code = 901', (err, row) => {
        if (err) {
            console.error('Error selecting data:', err.message);
            db.close();
            return;
        }

        if (row) {
            console.log('Current state before update:', row);

            // Perform the update
            db.run(`UPDATE categories SET group_name = '固定費' WHERE code = 901`, function (updateErr) {
                if (updateErr) {
                    console.error('Error updating data:', updateErr.message);
                } else {
                    console.log(`Successfully updated ${this.changes} row(s).`);
                    console.log('Update detail: group_name set to \'固定費\' for code = 901 (小遣い).');
                }

                // Verify the changes
                db.get('SELECT * FROM categories WHERE code = 901', (verifyErr, newRow) => {
                    if (newRow) {
                        console.log('State after update:   ', newRow);
                    }
                    db.close();
                });
            });
        } else {
            console.log('Category with code 901 not found.');
            db.close();
        }
    });
});
