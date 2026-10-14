# Ciara New Sales MAS correction, October 14, 2026

**Superseding owner clarification:** the intended split is four New Sales under AMORA, NESTOR (PH-49964148, PH-49964158, PH-49964163, PH-49964168), and only PH-54964332 under NALANGAN, MERLENE. `scripts/correct-ciara-mas-split-20261014.mjs` returned the four sales and accounts to Amora, preserving correction/transfer history. Lorna's sale, account and pending slip remain Nalangan. Production dry run, application and repeat verification passed: four Amora sales/accounts and one Nalangan sale/account/slip. The collection remains unchanged. The earlier five-sale reassignment below is historical and has been superseded. Do not rerun `reassign-ciara-ns-20261014.mjs`, which reflects the earlier interpretation.

Owner requested that Ciara's today New Sales/report under AMORA, NESTOR be assigned to NALANGAN, MERLENE. Scope is October 14 encoding date in Asia/Manila, Entry Clerk PACIOS, CIARA JOI (DNDO-2026-0075), and the five New Sales recorded under Nestor. Other MAS entries encoded by Ciara are outside this correction.

Applied in production with `scripts/reassign-ciara-ns-20261014.mjs` after a successful dry run. Target LEG-2026-0099 is active and assigned to MONKAYO. Five sales total PHP 2,320: PH-49964148, PH-49964158, PH-49964163, PH-49964168 (PHP 500 each), and PH-54964332 (PHP 320).

Updated sale MAS display/link and accountable employee. Four member-program assignments were transferred with member-transfer records; the fifth account already belonged to Merlene. The linked pending New Sales slip REM-20261014051605-6A1P was updated to Merlene after checking that it contained no other entries. Four sales remain Outstanding and the fifth remains pending approval; no approval state, amount, incentive, original date, encoding identity or report cash input changed. Reports derive the MAS label from these records.

The repeat run verified five sales and five accounts under Merlene and reported zero changes. The correction is recorded in Audit Log and Record Corrections. The script defaults to rollback and commits only with `--apply`.

Ciara also encoded one collection under Nestor today. Its assignment and the mixed (Both) clearing were left pending the owner's clarification on whether the collection is included. The clarification is separate from the completed New Sales correction.
