// Shared by app transactions and maintenance scripts. query(text, parameters) must use the caller's transaction.
import { calculateRemittance, calculateSaleIncentive, tiersForBranch } from './remittance.ts';
import { isDeepStrictEqual } from 'node:util';

const money = value => Math.round(Number(value ?? 0) * 100) / 100;
const idsJson = ids => JSON.stringify([...new Set(ids)]);
const json = value => typeof value === 'string' ? JSON.parse(value) : value;

/** Reprice corrected entries using their current program/NOPs, without changing gross payments or actual cash. */
export async function repriceEntries(query, { collectionIds = [], saleIds = [] } = {}) {
  const collections = collectionIds.length ? await query(`select c.collection_id as id, c.program_id, c.branch,
      coalesce(c.branch_id, b.branch_id, '') as pricing_branch_id, c.amount_collected::float8 as amount,
      c.nop_from, c.nop_to, c.collected_by_role, c.accountable_role, c.reactivation,
      c.remittance_amount::float8 as remittance_amount, c.remittance_breakdown, c.forfeited_incentive::float8 as forfeited_incentive, c.no_incentive_reason,
      p.base_pay::float8 as rate, p.flexible, p.max_monthly_payment::float8 as maximum
    from collections c join programs p on p.program_id=c.program_id
    left join branches b on lower(trim(b.branch_name_code))=lower(trim(c.branch))
    where c.collection_id in (select jsonb_array_elements_text($1::text::jsonb)) and c.status='Posted' order by c.collection_id for update of c`, [idsJson(collectionIds)]) : [];
  const sales = saleIds.length ? await query(`select s.sale_id as id, s.program_id, s.branch,
      coalesce(s.branch_id, b.branch_id, '') as pricing_branch_id, s.amount_paid::float8 as amount,
      s.remittance_amount::float8 as remittance_amount, s.mas_incentive::float8 as mas_incentive, s.forfeited_incentive::float8 as forfeited_incentive, s.no_incentive_reason,
      p.base_pay::float8 as rate, p.flexible, p.max_monthly_payment::float8 as maximum,
      p.registration_fee_required, p.new_sale_incentive_type, p.new_sale_incentive_amount::float8 as new_sale_incentive_amount
    from sales s join programs p on p.program_id=s.program_id
    left join branches b on lower(trim(b.branch_name_code))=lower(trim(s.branch))
    where s.sale_id in (select jsonb_array_elements_text($1::text::jsonb)) order by s.sale_id for update of s`, [idsJson(saleIds)]) : [];
  if (collections.length !== new Set(collectionIds).size || sales.length !== new Set(saleIds).size) throw new Error('A selected finance entry is missing, unposted, or has no program.');
  const programIds = [...new Set([...collections, ...sales].map(row => row.program_id))];
  if (!programIds.length) return { changes: [], slips: [], incentiveChange: 0, companyShareChange: 0 };
  const tierRows = await query(`select * from program_incentives where program_id in (select jsonb_array_elements_text($1::text::jsonb)) order by incentive_id`, [idsJson(programIds)]);
  const tiersOf = row => tiersForBranch(tierRows.filter(tier => tier.program_id === row.program_id).map(tier => ({
    id: tier.incentive_id, role: tier.role, fromMonth: Number(tier.from_month), toMonth: Number(tier.to_month),
    incentiveType: tier.incentive_type, markUp: Number(tier.mark_up || 0), incentiveAmount: Number(tier.incentive_amount || 0),
    branchId: tier.branch_id || '', nonCommissionable: Boolean(tier.non_commissionable),
  })), row.pricing_branch_id);
  const changes = [];
  let companyShareTotal = 0, grossTotal = 0;
  // Calculate the complete plan before writing: a missing/overlapping tier stops the correction.
  for (const [kind, rows] of [['Collection', collections], ['New Sale', sales]]) for (const row of rows) {
    const tiers = tiersOf(row), oldBreakdown = json(row.remittance_breakdown);
    const channel = row.collected_by_role || row.accountable_role || 'MAS';
    const role = channel === 'Collector' ? 'Collector' : channel === 'DTO' ? 'DTO' : 'MAS';
    const orc = role === 'Collector' && Array.isArray(oldBreakdown) && oldBreakdown.some(part => part?.orc === true);
    const quote = kind === 'Collection'
      ? calculateRemittance(row.rate, tiers, role, row.nop_from, row.nop_to, row.amount, row.flexible, row.maximum, { orc, reactivation: row.reactivation === true })
      : calculateSaleIncentive({ basePay: row.rate, flexible: row.flexible, maxMonthlyPayment: row.maximum,
          registrationFeeRequired: row.registration_fee_required, saleIncentiveType: row.new_sale_incentive_type || '',
          saleIncentiveAmount: row.new_sale_incentive_amount || 0, incentiveTiers: tiers }, row.amount);
    // Marked No incentive (owner, October 20, 2026) stays remitted whole, as a forfeited incentive does.
    const forfeited = Number(row.forfeited_incentive || 0) > 0 || Boolean(String(row.no_incentive_reason ?? '').trim());
    const share = money(forfeited ? row.amount : quote.remittance);
    companyShareTotal = money(companyShareTotal + share);
    grossTotal = money(grossTotal + row.amount);
    const before = { remittance: row.remittance_amount, forfeited: row.forfeited_incentive,
      ...(kind === 'Collection' ? { breakdown: oldBreakdown } : { incentive: row.mas_incentive }) };
    const after = { remittance: share, forfeited: forfeited ? money(row.amount - quote.remittance) : row.forfeited_incentive,
      ...(kind === 'Collection' ? { breakdown: quote.breakdown } : { incentive: money(row.amount - share) }) };
    if (!isDeepStrictEqual(before, after)) changes.push({ kind, id: row.id, programId: row.program_id, amount: row.amount, before, after });
  }
  const slipDeltas = new Map();
  for (const change of changes) {
    if (change.kind === 'Collection') await query(`update collections set remittance_amount=$2, forfeited_incentive=$3, remittance_breakdown=$4::text::jsonb where collection_id=$1`,
      [change.id, change.after.remittance, change.after.forfeited, JSON.stringify(change.after.breakdown)]);
    else await query(`update sales set remittance_amount=$2, forfeited_incentive=$3, mas_incentive=$4 where sale_id=$1`,
      [change.id, change.after.remittance, change.after.forfeited, change.after.incentive]);
    // Link amounts contain each entry's expected company share. Fidelity is held on the parent and stays intact.
    const links = await query(`select remittance_id, amount::float8 as amount from remittance_collections where collection_id=$1 order by remittance_id for update`, [change.id]);
    for (const link of links) {
      const delta = money(change.after.remittance - Number(link.amount || 0));
      if (!delta) continue;
      await query(`update remittance_collections set amount=$3 where collection_id=$1 and remittance_id=$2`, [change.id, link.remittance_id, change.after.remittance]);
      slipDeltas.set(link.remittance_id, money((slipDeltas.get(link.remittance_id) || 0) + delta));
    }
  }
  const slips = [];
  for (const [id, delta] of [...slipDeltas].sort(([a], [b]) => a.localeCompare(b))) {
    if (!delta) continue;
    const [slip] = await query(`update remittances set gross_collection=coalesce(gross_collection,0)+$2::numeric,
        difference=coalesce(total_remittance,0)-coalesce(gross_collection,0)-$2::numeric
      where remittance_id=$1 returning gross_collection::float8 as expected, total_remittance::float8 as actual, difference::float8 as difference`, [id, delta]);
    if (!slip) throw new Error(`Linked remittance ${id} is missing.`);
    slips.push({ id, expectedChange: delta, ...slip });
  }
  const previouslyUnpriced = changes.filter(change => change.before.remittance == null).length;
  const companyShareChange = money(changes.filter(change => change.before.remittance != null).reduce((sum, change) => sum + change.after.remittance - Number(change.before.remittance), 0));
  return { changes, slips, previouslyUnpriced, companyShareChange, incentiveChange: money(-companyShareChange), companyShareTotal, incentiveTotal: money(grossTotal - companyShareTotal) };
}
