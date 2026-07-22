import { supabase } from './lib/supabaseClient';

export { supabase };

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('email, role, is_active')
    .eq('id', user.id)
    .single();
  if (!profile) return { userId: user.id, email: user.email, role: 'preparer' };
  return { userId: user.id, email: profile.email, role: profile.role };
}

export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUp(email, password) {
  return supabase.auth.signUp({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}

export async function listClients() {
  const { data, error } = await supabase.from('clients').select('*').order('name');
  if (error) throw error;
  return data;
}

export async function getClient(id) {
  const { data: client, error } = await supabase.from('clients').select('*').eq('id', id).single();
  if (error) throw error;
  const { data: accounts } = await supabase.from('accounts').select('*').eq('client_id', id).order('name');
  return { ...client, accounts: accounts || [] };
}

export async function createClient(payload) {
  const { data: client, error } = await supabase.from('clients')
    .insert({ name: payload.name, entity_type: payload.entity_type, storage_provider: payload.storage_provider })
    .select().single();
  if (error) throw error;

  await supabase.rpc('rpc_seed_default_accounts', { p_client_id: client.id, p_entity_type: client.entity_type });

  const { data: owner, error: ownerErr } = await supabase.from('owners')
    .insert({ client_id: client.id, customer_id: payload.customer_id, owner_type: payload.owner_type, ownership_percentage: payload.ownership_percentage, name: payload.owner_name || '' })
    .select().single();
  if (ownerErr) throw ownerErr;

  return { ...client, owner };
}

export async function updateClient(id, updates) {
  const { data, error } = await supabase.from('clients').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function listCustomers() {
  const { data, error } = await supabase.from('customers').select('*').order('name');
  if (error) throw error;
  return data;
}

export async function getCustomer(id) {
  const { data: customer, error } = await supabase.from('customers').select('*').eq('id', id).single();
  if (error) throw error;
  const { data: owners } = await supabase.from('owners').select('*, clients(*)').eq('customer_id', id);
  const businesses = (owners || []).map((o) => ({ ...o.clients, ownership_percentage: o.ownership_percentage, owner_type: o.owner_type }));
  return { ...customer, businesses };
}

export async function createCustomer(name) {
  const { data, error } = await supabase.from('customers').insert({ name }).select().single();
  if (error) throw error;
  return data;
}

export async function listOwners(clientId) {
  const { data, error } = await supabase.from('owners').select('*').eq('client_id', clientId).order('name');
  if (error) throw error;
  return data;
}

export async function createOwner(payload) {
  const { data, error } = await supabase.from('owners').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function addCapitalEntry(ownerId, entryType, entryDate, amount) {
  const { data, error } = await supabase.from('capital_account_entries')
    .insert({ owner_id: ownerId, entry_type: entryType, entry_date: entryDate, amount })
    .select().single();
  if (error) throw error;
  return data;
}

export async function listVendors(clientId) {
  const { data, error } = await supabase.from('vendors').select('*').eq('client_id', clientId).order('name');
  if (error) throw error;
  return data;
}

export async function createVendor(payload) {
  const { data, error } = await supabase.from('vendors').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateVendor(id, updates) {
  const { data, error } = await supabase.from('vendors').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function listWorkers(clientId) {
  const { data, error } = await supabase.from('workers').select('*').eq('client_id', clientId).order('name');
  if (error) throw error;
  return data;
}

export async function createWorker(payload) {
  const { data, error } = await supabase.from('workers').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function listPayrollPayments(clientId) {
  const { data, error } = await supabase.from('payroll_payments').select('*, workers(name)').eq('client_id', clientId).order('pay_date', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createPayrollPayment(payload) {
  const { data, error } = await supabase.from('payroll_payments').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function deletePayrollPayment(id) {
  const { error } = await supabase.from('payroll_payments').delete().eq('id', id);
  if (error) throw error;
}

export async function listFixedAssets(clientId) {
  const { data, error } = await supabase.from('fixed_assets').select('*').eq('client_id', clientId).order('purchase_date');
  if (error) throw error;
  return data;
}

export async function createFixedAsset(payload) {
  const { data, error } = await supabase.from('fixed_assets').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateFixedAsset(id, updates) {
  const { data, error } = await supabase.from('fixed_assets').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteFixedAsset(id) {
  const { error } = await supabase.from('fixed_assets').delete().eq('id', id);
  if (error) throw error;
}

export async function listLoans(clientId) {
  const { data, error } = await supabase.from('loans').select('*').eq('client_id', clientId).order('origination_date');
  if (error) throw error;
  return data;
}

export async function createLoan(payload) {
  const { data, error } = await supabase.from('loans').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function deleteLoan(id) {
  const { error } = await supabase.from('loans').delete().eq('id', id);
  if (error) throw error;
}

export async function listJournalEntries(clientId) {
  const { data: entries, error } = await supabase.from('journal_entries').select('*').eq('client_id', clientId).order('entry_date', { ascending: false });
  if (error) throw error;
  const entryIds = (entries || []).map((e) => e.id);
  if (entryIds.length === 0) return [];
  const { data: txns } = await supabase.from('transactions').select('id, journal_entry_id, amount, account_id, accounts(name)').in('journal_entry_id', entryIds);
  const lineMap = {};
  (txns || []).forEach((t) => {
    if (!lineMap[t.journal_entry_id]) lineMap[t.journal_entry_id] = [];
    lineMap[t.journal_entry_id].push({ id: t.id, amount: t.amount, account_name: t.accounts?.name || '' });
  });
  return (entries || []).map((e) => ({ ...e, lines: lineMap[e.id] || [] }));
}

export async function createJournalEntry(payload) {
  const { data, error } = await supabase.rpc('rpc_create_journal_entry', {
    p_client_id: payload.client_id,
    p_entry_date: payload.entry_date,
    p_description: payload.description,
    p_entry_type: payload.entry_type || 'adjustment',
    p_lines: payload.lines,
    p_auto_balance_account_id: payload.auto_balance_account_id || null,
    p_override_lock: payload.override_lock || false,
  });
  if (error) throw error;
  return data;
}

export async function deleteJournalEntry(id, overrideLock = false) {
  const { data: entry, error: entryErr } = await supabase.from('journal_entries').select('client_id, entry_date').eq('id', id).single();
  if (entryErr) throw entryErr;
  if (overrideLock) {
    await supabase.rpc('rpc_write_audit_log', { p_action: 'period_lock.override', p_resource_type: 'journal_entry', p_resource_id: id, p_metadata: { route: 'delete_journal_entry' } });
  }
  const { error: txnErr } = await supabase.from('transactions').delete().eq('journal_entry_id', id);
  if (txnErr) throw txnErr;
  const { error: entryErr2 } = await supabase.from('journal_entries').delete().eq('id', id);
  if (entryErr2) throw entryErr2;
}

export async function listTransactions({ clientId, customerId, needsReview, search, limit = 100, offset = 0 }) {
  let query = supabase.from('transactions').select('*', { count: 'exact' });
  if (clientId) query = query.eq('client_id', clientId);
  if (customerId) query = query.eq('customer_id', customerId);
  if (needsReview !== undefined) query = query.eq('needs_review', needsReview);
  if (search) query = query.ilike('description', `%${search}%`);
  query = query.order('txn_date', { ascending: false }).range(offset, offset + limit - 1);
  const { data, count, error } = await query;
  if (error) throw error;
  const accountIds = [...new Set((data || []).map((t) => t.account_id).filter(Boolean))];
  let accountMap = {};
  if (accountIds.length > 0) {
    const { data: accounts } = await supabase.from('accounts').select('id, name').in('id', accountIds);
    accountMap = (accounts || []).reduce((m, a) => { m[a.id] = a.name; return m; }, {});
  }
  const clientIds = [...new Set((data || []).map((t) => t.flagged_for_client_id).filter(Boolean))];
  let clientMap = {};
  if (clientIds.length > 0) {
    const { data: clients } = await supabase.from('clients').select('id, name').in('id', clientIds);
    clientMap = (clients || []).reduce((m, c) => { m[c.id] = c.name; return m; }, {});
  }
  return {
    transactions: (data || []).map((t) => ({
      ...t,
      account_name: accountMap[t.account_id] || null,
      claimed_by_business_name: clientMap[t.flagged_for_client_id] || null,
    })),
    total: count || 0,
    limit,
    offset,
  };
}

export async function listCustomerTransactions(customerId) {
  const { data, error } = await supabase.from('transactions').select('*').eq('customer_id', customerId).order('txn_date', { ascending: false });
  if (error) throw error;
  const clientIds = [...new Set((data || []).map((t) => t.flagged_for_client_id).filter(Boolean))];
  let clientMap = {};
  if (clientIds.length > 0) {
    const { data: clients } = await supabase.from('clients').select('id, name').in('id', clientIds);
    clientMap = (clients || []).reduce((m, c) => { m[c.id] = c.name; return m; }, {});
  }
  return (data || []).map((t) => ({ ...t, claimed_by_business_name: clientMap[t.flagged_for_client_id] || null }));
}

export async function updateTransaction(id, updates) {
  const { data, error } = await supabase.from('transactions').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function updatePersonalCategory(id, personalCategory) {
  const { data, error } = await supabase.from('transactions').update({ personal_category: personalCategory, needs_review: false }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteTransaction(id, overrideLock = false) {
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) throw error;
}

export async function flagBusinessExpense(txnId, ownerId, accountId, overrideLock = false) {
  const { data, error } = await supabase.rpc('rpc_flag_business_expense', {
    p_txn_id: txnId, p_owner_id: ownerId, p_account_id: accountId, p_override_lock: overrideLock,
  });
  if (error) throw error;
  return data;
}

export async function unflagBusinessExpense(txnId, overrideLock = false) {
  const { data, error } = await supabase.rpc('rpc_unflag_business_expense', { p_txn_id: txnId, p_override_lock: overrideLock });
  if (error) throw error;
  return data;
}

export async function bulkCategorize(transactionIds, accountId, isBusiness) {
  const { data, error } = await supabase.rpc('rpc_bulk_categorize', {
    p_transaction_ids: transactionIds, p_account_id: accountId || null, p_is_business: isBusiness,
  });
  if (error) throw error;
  return data;
}

export async function listDocuments({ clientId, customerId, status, search, limit = 50, offset = 0 }) {
  let query = supabase.from('documents').select('*', { count: 'exact' });
  if (clientId) query = query.eq('client_id', clientId);
  if (customerId) query = query.eq('customer_id', customerId);
  if (status) query = query.eq('status', status);
  if (search) query = query.ilike('original_filename', `%${search}%`);
  query = query.order('uploaded_at', { ascending: false }).range(offset, offset + limit - 1);
  const { data, count, error } = await query;
  if (error) throw error;
  return { documents: data || [], total: count || 0, limit, offset };
}

export async function deleteDocument(docId, overrideLock = false) {
  const { data, error } = await supabase.rpc('rpc_delete_document', { p_doc_id: docId, p_override_lock: overrideLock });
  if (error) throw error;
  return data;
}

export async function listStaff(clientId) {
  const { data, error } = await supabase.from('user_client_access').select('user_id, granted_at, profiles(email, role)').eq('client_id', clientId);
  if (error) throw error;
  return (data || []).map((s) => ({ id: s.user_id, email: s.profiles?.email, role: s.profiles?.role, granted_at: s.granted_at }));
}

export async function listAllUsers() {
  const { data, error } = await supabase.from('profiles').select('id, email, role').order('email');
  if (error) throw error;
  return data || [];
}

export async function grantStaffAccess(clientId, userId) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('user_client_access')
    .insert({ client_id: clientId, user_id: userId, granted_by: user.id }).select().single();
  if (error) throw error;
  return data;
}

export async function revokeStaffAccess(clientId, userId) {
  const { error } = await supabase.from('user_client_access').delete().eq('client_id', clientId).eq('user_id', userId);
  if (error) throw error;
}

export async function lockPeriod(clientId, lockedThroughDate) {
  return updateClient(clientId, { locked_through_date: lockedThroughDate });
}

export async function unlockPeriod(clientId) {
  return updateClient(clientId, { locked_through_date: null });
}

export async function updateUserRole(userId, role) {
  const { data, error } = await supabase.from('profiles').update({ role }).eq('id', userId).select().single();
  if (error) throw error;
  return data;
}

export async function toggleUserActive(userId, isActive) {
  const { data, error } = await supabase.from('profiles').update({ is_active: isActive }).eq('id', userId).select().single();
  if (error) throw error;
  return data;
}

export async function runReport(reportType, params) {
  const rpcMap = {
    pl: { fn: 'rpc_pl_report', args: { p_client_id: params.client_id, p_start_date: params.start_date || null, p_end_date: params.end_date || null } },
    'balance-sheet': { fn: 'rpc_balance_sheet_report', args: { p_client_id: params.client_id, p_as_of_date: params.end_date || null } },
    'general-ledger': { fn: 'rpc_general_ledger', args: { p_client_id: params.client_id, p_start_date: params.start_date || null, p_end_date: params.end_date || null } },
    'capital-accounts': { fn: 'rpc_capital_accounts', args: { p_client_id: params.client_id, p_start_date: params.start_date || null, p_end_date: params.end_date || null } },
    'personal-statement': { fn: 'rpc_personal_statement', args: { p_owner_id: params.owner_id, p_start_date: params.start_date || null, p_end_date: params.end_date || null } },
    '1099-summary': { fn: 'rpc_1099_summary', args: { p_client_id: params.client_id, p_year: Number(params.year) } },
    'depreciation-schedule': { fn: 'rpc_depreciation_schedule', args: { p_client_id: params.client_id, p_year: Number(params.year) } },
    'loan-amortization': { fn: 'rpc_loan_amortization', args: { p_loan_id: params.loan_id } },
    'payroll-summary': { fn: 'rpc_payroll_summary', args: { p_client_id: params.client_id, p_year: Number(params.year) } },
    'ar-aging': { fn: 'rpc_ar_aging', args: { p_client_id: params.client_id } },
    'ap-aging': { fn: 'rpc_ap_aging', args: { p_client_id: params.client_id } },
  };
  const rpc = rpcMap[reportType];
  if (!rpc) throw new Error(`Unknown report type: ${reportType}`);
  const { data, error } = await supabase.rpc(rpc.fn, rpc.args);
  if (error) throw error;
  return data;
}

export async function uploadDocument(file, { clientId, customerId, docType, aiProvider }) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('doc_type', docType);
  formData.append('ai_provider', aiProvider);
  if (clientId) formData.append('client_id', clientId);
  if (customerId) formData.append('customer_id', customerId);

  const { data: sessionData } = await supabase.auth.getSession();
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/document-upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessionData.session.access_token}`,
    },
    body: formData,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Upload failed');
  return result;
}

export async function exportExcel(clientId, startDate, endDate) {
  const { data: sessionData } = await supabase.auth.getSession();
  const params = new URLSearchParams({ client_id: clientId });
  if (startDate) params.append('start_date', startDate);
  if (endDate) params.append('end_date', endDate);
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/excel-export?${params}`, {
    headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
  });
  if (!response.ok) throw new Error('Export failed');
  return response.blob();
}

export async function downloadExport(clientId, startDate, endDate) {
  const blob = await exportExcel(clientId, startDate, endDate);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'eyneya-bookkeeping-export.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export function isLockError(error) {
  return error && error.message && error.message.toLowerCase().includes('locked period');
}
