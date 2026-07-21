/**
 * journalBalance.js
 *
 * Validates that a manual journal entry's lines actually balance, using
 * this app's existing signed-amount convention (the same one used
 * throughout transactions/reports):
 *   - Asset increase   = positive amount
 *   - Liability increase = positive amount
 *   - Equity increase  = positive amount
 *   - Income increase  = positive amount
 *   - Expense increase = NEGATIVE amount (matches flag-as-business-expense
 *     and every other place expenses get posted in this app)
 *
 * Because of that convention, a balanced entry satisfies:
 *   sum(asset lines) - sum(liability lines) - sum(equity lines)
 *     - sum(income lines) - sum(expense lines, as stored) = 0
 *
 * Equivalently: weight(asset) = +1, everything else = -1, and
 * sum(weight(account_type) * amount) must be ~0 across all lines.
 *
 * Example — recording $10,000 loan proceeds deposited to checking:
 *   Business Checking (asset):    +10,000
 *   Loan Payable (liability):     +10,000
 *   weighted sum = (+1 * 10000) + (-1 * 10000) = 0  balanced
 *
 * Example — recording a $500 cash expense:
 *   Business Checking (asset):    -500
 *   Office Supplies (expense):    -500
 *   weighted sum = (+1 * -500) + (-1 * -500) = -500 + 500 = 0  balanced
 */

const EPSILON = 0.01; // tolerance for floating point rounding

function weightForAccountType(accountType) {
  return accountType === 'asset' ? 1 : -1;
}

/**
 * @param {Array<{account_type: string, amount: number}>} lines
 * @returns {{ balanced: boolean, weightedSum: number }}
 */
function checkJournalEntryBalance(lines) {
  const weightedSum = lines.reduce((sum, line) => sum + weightForAccountType(line.account_type) * Number(line.amount), 0);
  return { balanced: Math.abs(weightedSum) < EPSILON, weightedSum: Math.round(weightedSum * 100) / 100 };
}

/**
 * Given all-but-one line already decided, compute the amount needed on a
 * final "plug" account (e.g. Opening Balance Equity) to make the entry
 * balance. Used by the opening-balances quick-entry flow.
 */
function calculatePlugAmount(existingLines, plugAccountType) {
  const existingWeightedSum = existingLines.reduce(
    (sum, line) => sum + weightForAccountType(line.account_type) * Number(line.amount),
    0
  );
  const plugWeight = weightForAccountType(plugAccountType);
  // plugWeight * plugAmount + existingWeightedSum = 0
  return Math.round((-existingWeightedSum / plugWeight) * 100) / 100;
}

module.exports = { checkJournalEntryBalance, calculatePlugAmount, weightForAccountType };
