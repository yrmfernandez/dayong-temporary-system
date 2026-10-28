import { BrandLogo } from "@/components/brand-logo";
import type { buildMamReport } from "@/lib/mam-report";
import { formatDate as showDate } from "@/lib/date-format";

type Report = ReturnType<typeof buildMamReport>;
type Row = Report["rows"][number];
type Period = Row["periods"][number];

// Months per printed table: more would make the cells unreadable on A4 landscape, so longer ranges print in blocks.
const MONTHS_PER_BLOCK = 6;
const STATUSES = ["NS", "U", "ADV", "60D", "90D", "120D", "150D", "Fully Paid", "Forfeited"];

const peso = (value: number) => `₱${value.toLocaleString("en-PH", { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const monthLabel = (value: string) =>
  new Intl.DateTimeFormat("en-PH", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}-01T00:00:00Z`));

/** The last payment on or before the end of the range (and never after today). */
function lastPaymentDate(row: Row, report: Report) {
  const cutoff = [report.today, `${report.to}-31`].sort()[0];
  return row.history.filter((payment) => payment.orDate <= cutoff).at(-1)?.orDate ?? "";
}

function MonthCell({ period }: { period: Period }) {
  if (period.error) return <td className={`mam-print-month${period.projected ? " is-projected" : ""}`}><strong>Needs review</strong></td>;
  if (!period.state) return <td className={`mam-print-month${period.projected ? " is-projected" : ""}`}>—</td>;
  const { state } = period;
  return (
    <td className={`mam-print-month${period.projected ? " is-projected" : ""}`}>
      <div className="mam-print-cell-head"><strong>{state.status}{state.temporarilySuspended ? "*" : ""}</strong><span>{period.collected ? peso(period.collected) : "—"}</span></div>
      <div>{period.receipts.length ? `${period.receipts.map((receipt) => receipt.orNumber).join(", ")} · NOP ${state.nop}` : "no payment"}</div>
      <div>Bal {state.balance === null ? "—" : peso(state.balance)}</div>
    </td>
  );
}

/**
 * MAM on paper (owner, October 28, 2026): A4 landscape, one section per MAS starting on a new page, each with the
 * company header, a status summary, numbered members with DOI, rate and last payment date, three short lines per month,
 * MAS totals, the Waiver key and signature lines. Ranges longer than six months print in blocks of six. Shown only
 * when printing; the screen view is unchanged.
 */
export function MamPrint({ report, groups, printedBy }: { report: Report; groups: Row[][]; printedBy: string }) {
  // Even blocks, so seven months print as 4 + 3 rather than 6 + 1 lone month.
  const size = Math.ceil(report.months.length / Math.ceil(report.months.length / MONTHS_PER_BLOCK));
  const blocks: string[][] = [];
  for (let i = 0; i < report.months.length; i += size) blocks.push(report.months.slice(i, i + size));
  const range = report.from === report.to ? monthLabel(report.from) : `${monthLabel(report.from)} – ${monthLabel(report.to)}`;

  return (
    <div className="mam-print hidden print:block">
      {groups.map((group) => {
        const first = group[0];
        const counts = STATUSES.map((status) => [status, group.filter((row) => row.periods.at(-1)?.state?.status === status).length] as const).filter(([, count]) => count);
        const quota = group.reduce((sum, row) => sum + (row.periods.at(-1)?.state?.balance ?? 0), 0);
        const collected = group.reduce((sum, row) => sum + (row.periods.at(-1)?.collected ?? 0), 0);
        return (
          <section key={`${first.branch}\u0000${first.mas}`} className="mam-print-section">
            <header className="mam-print-header">
              <div className="mam-print-brand">
                <BrandLogo className="mam-print-logo" priority />
                <div><p className="mam-print-company">D&apos; San Roque Dayong Providers Inc.</p><p>{first.branch} Branch</p></div>
              </div>
              <div className="mam-print-title">
                <p className="mam-print-name">MEMBER ACCOUNT MONITORING (MAM)</p>
                <p>{range}</p>
                <p>Printed {showDate(report.today)}{printedBy ? ` by ${printedBy}` : ""}</p>
              </div>
            </header>
            <div className="mam-print-mas">
              <p><strong>MAS: {first.mas || "—"}</strong> · {group.length} {group.length === 1 ? "account" : "accounts"}</p>
              <p>Summary at {monthLabel(report.to)}: {counts.map(([status, count]) => `${status} ${count}`).join(" · ") || "—"} · Quota {peso(quota)} · Collected {peso(collected)}</p>
            </div>

            {blocks.map((months) => {
              const offset = report.months.indexOf(months[0]);
              return (
                <table key={months[0]} className="mam-print-table">
                  <colgroup>
                    <col className="mam-col-no" /><col className="mam-col-member" /><col className="mam-col-date" /><col className="mam-col-rate" /><col className="mam-col-date" />
                    {months.map((month) => <col key={month} />)}
                  </colgroup>
                  <thead>
                    <tr>
                      <th>#</th><th>Member / Program</th><th>DOI</th><th>Rate</th><th>Last payment</th>
                      {months.map((month) => <th key={month} className={month > report.today.slice(0, 7) ? "is-projected" : ""}>{monthLabel(month)}{month > report.today.slice(0, 7) ? " (Projected)" : ""}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {group.map((row, index) => {
                      const last = lastPaymentDate(row, report);
                      return (
                        <tr key={row.id}>
                          <td className="mam-print-no">{index + 1}</td>
                          <td><strong>{row.memberName}</strong><div>{row.memberNumber} · {row.programName}</div></td>
                          <td>{row.doi ? showDate(row.doi) : "—"}</td>
                          <td>{peso(row.basePay)}</td>
                          <td>{last ? showDate(last) : "—"}</td>
                          {months.map((month, i) => <MonthCell key={month} period={row.periods[offset + i]} />)}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5} className="mam-print-total-label">MAS totals</td>
                      {months.map((month, i) => (
                        <td key={month} className="mam-print-month">
                          <div>Coll {peso(group.reduce((sum, row) => sum + row.periods[offset + i].collected, 0))}</div>
                          <div>Quota {peso(group.reduce((sum, row) => sum + (row.periods[offset + i].state?.balance ?? 0), 0))}</div>
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              );
            })}

            <p className="mam-print-key">* Waiver needed (temporarily suspended). Bal = amount due that month; Quota = total due; NOP = number of payments made.</p>
            <div className="mam-print-signatures">
              {["Prepared by", "Checked by", "Noted by"].map((label) => <div key={label}><span className="mam-print-line" /><p>{label}</p></div>)}
            </div>
          </section>
        );
      })}
    </div>
  );
}
