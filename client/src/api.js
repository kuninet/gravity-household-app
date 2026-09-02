const API_BASE = '/api';

export async function fetchTransactions(month, isRecent = false) {
    let url = `${API_BASE}/transactions`;
    const params = new URLSearchParams();
    if (month) params.append('month', month);
    if (isRecent) params.append('type', 'recent');

    if (Array.from(params).length > 0) {
        url += `?${params.toString()}`;
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

export async function fetchMultiYearAnalysis(from, to) {
    const res = await fetch(`${API_BASE}/analysis/multi_year?from=${from}&to=${to}`);
    if (!res.ok) throw new Error('Failed to fetch multi-year analysis');
    return res.json();
}

export async function fetchFixedCostMatrix(year) {
    const res = await fetch(`${API_BASE}/fixed_costs/matrix?year=${year}`);
    if (!res.ok) throw new Error('Failed to fetch fixed cost matrix');
    return res.json();
}

// data: { year, month, category_code, amount, type }
// type は省略時サーバー側で 'EXPENSE' 扱い (後方互換)。呼び出し側から伝搬させる。
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

// data: { year, cells: [{ month, category_code, amount, type }] }
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

// 給与 (INCOME/700) は 1 会計月に複数明細を許容するため、update_cell とは別に
// id ベースの CRUD を叩く。data: { year, month, amount, description? }
export async function addSalaryEntry({ year, month, amount, description }) {
    const res = await fetch(`${API_BASE}/fixed_costs/salary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, amount, description }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add salary entry');
    }
    return res.json();
}

// data: { amount, description? } — 会計月は変更不可 (月変更は削除+追加で対応)
export async function updateSalaryEntry(id, { amount, description }) {
    const res = await fetch(`${API_BASE}/fixed_costs/salary/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, description }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update salary entry');
    }
    return res.json();
}

export async function deleteSalaryEntry(id) {
    const res = await fetch(`${API_BASE}/fixed_costs/salary/${id}`, {
        method: 'DELETE',
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to delete salary entry');
    }
    return res.json();
}

// レシート照合。fileNames はファイル名のみ（画像本体は送信しない）。
// month 省略時はファイル名の日付範囲から自動判定される。
export async function checkReceipts({ fileNames, month }) {
    const res = await fetch(`${API_BASE}/receipts/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileNames, month: month || undefined }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'レシートの照合に失敗しました');
    }
    return res.json();
}
