/**
 * depreciation.js
 *
 * Straight-line depreciation only. Real MACRS depreciation (what the IRS
 * actually requires for most business assets) uses fixed percentage tables
 * by asset class and a half-year/mid-quarter/mid-month averaging
 * convention depending on when assets were placed in service — genuinely
 * complex, and this build does NOT implement it. Use this schedule as a
 * working baseline, and verify final depreciation figures against IRS
 * Publication 946 tables or your tax software's depreciation module before
 * filing.
 *
 * Convention used here: mid-month, i.e. an asset placed in service partway
 * through a year gets a partial first year proportional to the number of
 * months remaining (counting the placed-in-service month as a half month,
 * matching the general MACRS mid-month convention used for most property).
 */

/**
 * @param {object} asset - a row from fixed_assets
 * @param {number} year - the calendar year to calculate depreciation for
 * @returns {{annualDepreciation: number, accumulatedDepreciation: number, bookValue: number}}
 */
function calculateDepreciationForYear(asset, year) {
  const purchaseDate = new Date(asset.purchase_date);
  const purchaseYear = purchaseDate.getFullYear();
  const depreciableBasis =
    Number(asset.purchase_amount) - Number(asset.section_179_amount || 0) - Number(asset.bonus_depreciation_amount || 0);
  const usefulLife = Number(asset.useful_life_years);
  const annualStraightLine = usefulLife > 0 ? depreciableBasis / usefulLife : 0;

  if (year < purchaseYear || depreciableBasis <= 0) {
    return { annualDepreciation: 0, accumulatedDepreciation: 0, bookValue: Number(asset.purchase_amount) };
  }

  // First-year proration: months remaining in the purchase year, mid-month convention
  const purchaseMonth = purchaseDate.getMonth() + 1; // 1-12
  const firstYearFraction = (12 - purchaseMonth + 0.5) / 12;
  const firstYearDepreciation = annualStraightLine * firstYearFraction;

  const yearsElapsed = year - purchaseYear;
  let accumulatedDepreciation = 0;
  let thisYearDepreciation = 0;

  if (yearsElapsed === 0) {
    thisYearDepreciation = firstYearDepreciation;
    accumulatedDepreciation = firstYearDepreciation;
  } else {
    accumulatedDepreciation = firstYearDepreciation + annualStraightLine * Math.min(yearsElapsed - 1, usefulLife - 1);
    const remainingBasis = depreciableBasis - accumulatedDepreciation;
    thisYearDepreciation = remainingBasis > 0 ? Math.min(annualStraightLine, remainingBasis) : 0;
    accumulatedDepreciation += thisYearDepreciation;
  }

  // Immediately-expensed amounts (Sec. 179 + bonus) count as "depreciation" taken in the purchase year for book value purposes
  const immediateExpense = Number(asset.section_179_amount || 0) + Number(asset.bonus_depreciation_amount || 0);
  const totalAccumulated = accumulatedDepreciation + (year >= purchaseYear ? immediateExpense : 0);
  const bookValue = Math.max(Number(asset.purchase_amount) - totalAccumulated, 0);

  return {
    annualDepreciation: Math.round((thisYearDepreciation + (yearsElapsed === 0 ? immediateExpense : 0)) * 100) / 100,
    accumulatedDepreciation: Math.round(totalAccumulated * 100) / 100,
    bookValue: Math.round(bookValue * 100) / 100,
  };
}

module.exports = { calculateDepreciationForYear };
