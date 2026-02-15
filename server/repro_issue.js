
const sheetName = "2025年1月";
const matchDaily = sheetName.match(/^(\d{4})年(\d{1,2})月$/);
const year = parseInt(matchDaily[1], 10);
const sheetMonth = parseInt(matchDaily[2], 10);

console.log(`Sheet: ${sheetName}, SheetYear: ${year}, SheetMonth: ${sheetMonth}`);

// Scenario: Data is Dec 23 (which technically belongs to 2024)
// xlsx.utils.sheet_to_json with dateNF='yyyy-mm-dd' likely returns "2024-12-23" if the cell has correct year,
// or "2025-12-23" if the user entered it in 2025 without year?
// Let's assume the input string is "2024-12-23" (since user implies it's "previous year's data").
const testInputs = [
    "2024-12-23", // Correct Input
    "2025-12-23"  // Incorrect Input (if Excel defaulted to 2025)
];

testInputs.forEach(dateStr => {
    console.log(`\nTesting Input: ${dateStr}`);

    // CURRENT BROKEN LOGIC
    let dateObj = new Date(dateStr);
    dateObj.setFullYear(year);
    const brokenResult = dateObj.toISOString().split('T')[0];
    console.log(`[Current Logic] Result: ${brokenResult} (Should be 2024-12-23 if strictly following fiscal logic?)`);

    // PROPOSED FIXED LOGIC
    let targetYear = year;
    let d = new Date(dateStr);
    let recordMonth = d.getMonth() + 1;

    // If Sheet is Jan (1) and Record is Dec (12), it must be Prev Year
    if (sheetMonth === 1 && recordMonth === 12) {
        targetYear = year - 1;
    }

    d.setFullYear(targetYear);
    const fixedResult = d.toISOString().split('T')[0];
    console.log(`[Fixed Logic]   Result: ${fixedResult}`);
});
