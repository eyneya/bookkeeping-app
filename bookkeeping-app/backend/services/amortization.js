/**
 * amortization.js
 *
 * Standard fixed-rate, fixed-term amortization (equal payment each period,
 * split differently between principal and interest over time). Does not
 * handle variable rates, balloon payments, or interest-only periods — if a
 * loan has those features, this schedule will not be accurate for it.
 */

/**
 * @param {object} loan - a row from loans (original_principal, annual_interest_rate, origination_date, term_months)
 * @returns {Array<{payment_number, date, payment_amount, principal, interest, remaining_balance}>}
 */
function calculateAmortizationSchedule(loan) {
  const principal = Number(loan.original_principal);
  const monthlyRate = Number(loan.annual_interest_rate) / 100 / 12;
  const termMonths = Number(loan.term_months);

  // Standard fixed-payment formula. Handle 0% interest as a special case (avoid divide-by-zero).
  const paymentAmount =
    monthlyRate === 0
      ? principal / termMonths
      : (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -termMonths));

  const schedule = [];
  let balance = principal;
  const startDate = new Date(loan.origination_date);

  for (let i = 1; i <= termMonths; i++) {
    const interestPortion = balance * monthlyRate;
    let principalPortion = paymentAmount - interestPortion;
    // Last payment absorbs any rounding drift so the balance hits exactly zero
    if (i === termMonths) principalPortion = balance;

    balance = Math.max(balance - principalPortion, 0);

    const paymentDate = new Date(startDate);
    paymentDate.setMonth(paymentDate.getMonth() + i);

    schedule.push({
      payment_number: i,
      date: paymentDate.toISOString().slice(0, 10),
      payment_amount: Math.round((principalPortion + interestPortion) * 100) / 100,
      principal: Math.round(principalPortion * 100) / 100,
      interest: Math.round(interestPortion * 100) / 100,
      remaining_balance: Math.round(balance * 100) / 100,
    });
  }

  return schedule;
}

module.exports = { calculateAmortizationSchedule };
