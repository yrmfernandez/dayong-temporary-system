"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readPreference, writePreference } from "@/lib/ui-preferences";

/** Who a row is, for the filters: the employee's ID, name, primary branch and roles. */
export type FilterPerson = { id: string; name: string; branch: string; roles: string[] };

export const NO_BRANCH = "No primary branch";
// The people chosen to show (owner, October 20, 2026), kept in this browser and shared by the attendance sheet and
// Payroll (runs and pay rates); none chosen = everyone.
const PEOPLE_KEY = "dayong-attendance-sheet-people";
const readPeople = () => { try { const saved: unknown = JSON.parse(readPreference(PEOPLE_KEY, "[]")); return Array.isArray(saved) ? saved.map(String) : []; } catch { return []; } };
const haystack = (person: FilterPerson) => `${person.name} ${person.id} ${person.branch} ${person.roles.join(" ")}`.toLowerCase();

/**
 * The attendance sheet's filters (owner, October 17 and 20, 2026), for any list of employees: Choose people, role,
 * primary branch and a search. `controls` goes in the toolbar, `picker` above the table; `shown` is the filtered list.
 */
export function usePeopleFilter<T>(items: T[], personOf: (item: T) => FilterPerson) {
  const [people, setPeople] = useState<string[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [role, setRole] = useState("");
  const [branch, setBranch] = useState("");
  const [search, setSearch] = useState("");
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the saved choice is read after mount (no storage on the server)
  useEffect(() => { setPeople(readPeople()); }, []);
  const choosePeople = (ids: string[]) => { setPeople(ids); writePreference(PEOPLE_KEY, JSON.stringify(ids)); };

  const persons = useMemo(() => items.map((item) => ({ item, person: personOf(item) })), [items, personOf]);
  const shown = useMemo(() => {
    const chosen = new Set(people), needle = search.trim().toLowerCase();
    return persons.filter(({ person }) => (!chosen.size || chosen.has(person.id)) && (!role || person.roles.includes(role))
      && (!branch || (person.branch || NO_BRANCH) === branch) && (!needle || haystack(person).includes(needle))).map(({ item }) => item);
  }, [persons, people, role, branch, search]);
  const roleOptions = useMemo(() => [...new Set(persons.flatMap(({ person }) => person.roles))].filter(Boolean).sort((a, b) => a.localeCompare(b)), [persons]);
  const branchOptions = useMemo(() => [...new Set(persons.map(({ person }) => person.branch || NO_BRANCH))].sort((a, b) => a.localeCompare(b)), [persons]);
  // Chosen people not in this list (left, or not in this payroll) do not count.
  const chosenShown = persons.filter(({ person }) => people.includes(person.id)).length;
  const filtered = Boolean(search.trim() || role || branch || people.length);

  const controls = <>
    <Button type="button" variant={people.length ? "default" : "outline"} aria-expanded={choosing} onClick={() => setChoosing((open) => !open)}><Users className="size-4" />{people.length ? `${chosenShown} chosen` : "Choose people"}</Button>
    <select aria-label="Filter by role" className="h-9 rounded-md border bg-background px-2 text-sm" value={role} onChange={(event) => setRole(event.target.value)}><option value="">All roles</option>{roleOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select>
    <select aria-label="Filter by branch" className="h-9 rounded-md border bg-background px-2 text-sm" value={branch} onChange={(event) => setBranch(event.target.value)}><option value="">All branches</option>{branchOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select>
    <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input aria-label="Search employees" className="w-56 pl-8" placeholder="Search name, ID, branch" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
  </>;
  const picker = choosing ? <PeoplePicker persons={persons.map(({ person }) => person)} chosen={people} onChange={choosePeople} onClose={() => setChoosing(false)} /> : null;
  return { shown, filtered, role, branch, controls, picker };
}

/** Tick the people the list shows (owner, October 20, 2026); with none ticked it shows everyone. */
function PeoplePicker({ persons, chosen, onChange, onClose }: { persons: FilterPerson[]; chosen: string[]; onChange: (ids: string[]) => void; onClose: () => void }) {
  const [find, setFind] = useState("");
  const needle = find.trim().toLowerCase();
  const listed = [...new Map(persons.map((person) => [person.id, person])).values()].filter((person) => !needle || haystack(person).includes(needle));
  const toggle = (id: string) => onChange(chosen.includes(id) ? chosen.filter((item) => item !== id) : [...chosen, id]);
  return <div className="mb-4 space-y-3 rounded-lg border bg-muted/30 p-3 print:hidden">
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-sm font-medium">Show only these people</p>
      <span className="text-xs text-muted-foreground">{chosen.length ? `${chosen.length} ticked` : "None ticked: everyone is shown"}. Kept on this device, for the attendance sheet and Payroll.</span>
      <div className="ml-auto flex flex-wrap gap-2">
        <Input aria-label="Find people" className="h-8 w-52" placeholder="Find name, ID, branch, role" value={find} onChange={(event) => setFind(event.target.value)} />
        <Button type="button" size="sm" variant="outline" disabled={!listed.length} onClick={() => onChange([...new Set([...chosen, ...listed.map((person) => person.id)])])}>Tick {needle ? "found" : "all"}</Button>
        <Button type="button" size="sm" variant="outline" disabled={!chosen.length} onClick={() => onChange([])}>Show everyone</Button>
        <Button type="button" size="sm" onClick={onClose}>Done</Button>
      </div>
    </div>
    <div className="grid max-h-64 gap-1 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
      {listed.map((person) => <label key={person.id} className="flex items-start gap-2 rounded px-2 py-1 text-sm hover:bg-muted">
        <input type="checkbox" className="mt-1" checked={chosen.includes(person.id)} onChange={() => toggle(person.id)} />
        <span><span className="font-medium">{person.name}</span><span className="block text-xs text-muted-foreground">{person.id}{person.branch ? ` · ${person.branch}` : ""}</span></span>
      </label>)}
      {!listed.length && <p className="p-2 text-sm text-muted-foreground">No one matches.</p>}
    </div>
  </div>;
}
