/** MAM account status colours, shared by the MAM page, the MAS collection list and the member payment card. */
export function mamStatusClass(status?: string) {
  switch (status) {
    case "ADV":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-200";
    case "NS":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-200";
    case "U":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-200";
    case "60D":
    case "90D":
      return "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-200";
    case "120D":
    case "150D":
    case "Forfeited":
      return "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-200";
    default:
      return "bg-secondary text-secondary-foreground";
  }
}
