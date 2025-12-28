const API_BASE = '/api';

export async function fetchTransactions(month) {
    let url = `${API_BASE}/transactions`;
    if (month) {
        url += `?month=${month}`;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch transactions');
    return res.json();
}

export async function createTransaction(data) {
    const res = await fetch(`${API_BASE}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create transaction');
    }
    return res.json();
}

export async function deleteTransaction(id) {
    const res = await fetch(`${API_BASE}/transactions/${id}`, {
        method: 'DELETE'
    });
    if (!res.ok) throw new Error('Failed to delete transaction');
    return res.json();
}

export async function deleteTransactionsBatch(ids) {
    const res = await fetch(`${API_BASE}/transactions/batch_delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
    });
    if (!res.ok) throw new Error('Failed to delete transactions');
    return res.json();
}

export async function updateTransaction(id, data) {
    const res = await fetch(`${API_BASE}/transactions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update transaction');
    }
    return res.json();
}

export async function fetchCategories() {
    const res = await fetch(`${API_BASE}/categories`);
    if (!res.ok) throw new Error('Failed to fetch categories');
    return res.json();
}

export async function fetchSummary(month) {
    let url = `${API_BASE}/summary`;
    if (month) url += `?month=${month}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch summary');
    return res.json();
}

export async function fetchYearlyAnalysis(year) {
    const res = await fetch(`${API_BASE}/analysis/yearly?year=${year}`);
    if (!res.ok) throw new Error('Failed to fetch yearly analysis');
    return res.json();
}

export async function fetchFixedCostMatrix(year) {
    const res = await fetch(`${API_BASE}/fixed_costs/matrix?year=${year}`);
    if (!res.ok) throw new Error('Failed to fetch fixed cost matrix');
    return res.json();
}

export async function updateFixedCostCell(data) {
    const res = await fetch(`${API_BASE}/fixed_costs/update_cell`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update fixed cost');
    return res.json();
}

export async function updateFixedCostBatch(data) {
    const res = await fetch(`${API_BASE}/fixed_costs/batch_update`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to batch update fixed cost');
    return res.json();
}
