export function getFiscalMonth(dateStr) {
    const date = new Date(dateStr);
    const day = date.getDate();
    let year = date.getFullYear();
    let month = date.getMonth() + 1; // 0-indexed

    if (day >= 23) {
        month++;
        if (month > 12) {
            month = 1;
            year++;
        }
    }
    return `${year}-${String(month).padStart(2, '0')}`;
}
