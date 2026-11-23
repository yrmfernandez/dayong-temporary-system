import assert from "node:assert/strict";
import { test } from "node:test";
import { typesInCapitals } from "../lib/uppercase-typing.ts";

const field = (tagName, props = {}, attributes = {}) => ({ tagName, type: "text", id: "", name: "", autocomplete: "", placeholder: "", ...props, getAttribute: (name) => attributes[name] ?? null, hasAttribute: (name) => name in attributes });

test("names, places and codes become capitals (owner, November 23, 2026)", () => {
  assert.equal(typesInCapitals(field("INPUT", { placeholder: "Surname" })), true);
  assert.equal(typesInCapitals(field("INPUT"), "First Name *"), true, "a <Label> just before the field");
  assert.equal(typesInCapitals(field("INPUT", { id: "sp-ext" }), "Extension (Jr, Sr)"), true);
  assert.equal(typesInCapitals(field("INPUT"), "Complete Address *"), true);
  assert.equal(typesInCapitals(field("INPUT"), "Birthplace"), true);
  assert.equal(typesInCapitals(field("INPUT", { id: "branch-name" })), true);
  assert.equal(typesInCapitals(field("INPUT", { id: "ins-mas" }), "MAS / Collector name"), true);
  assert.equal(typesInCapitals(field("INPUT"), "Who approved it"), true);
  assert.equal(typesInCapitals(field("INPUT", { placeholder: "Application number" })), true);
  assert.equal(typesInCapitals(field("INPUT", { id: "or-number-COL1" }), "OR Number *"), true);
  assert.equal(typesInCapitals(field("INPUT", { id: "ins-or", placeholder: "e.g. 12665 B" })), true);
  assert.equal(typesInCapitals(field("INPUT", { name: "employeeId" }), "Employee ID"), true);
  assert.equal(typesInCapitals(field("INPUT", { id: "payment-reference", placeholder: "Transaction / deposit slip number" })), true);
  assert.equal(typesInCapitals(field("INPUT"), "Type DELETE"), false, "asks with data-caps instead");
  assert.equal(typesInCapitals(field("INPUT", {}, { "data-caps": "" }), "Type DELETE"), true);
});

test("reasons, notes, remarks and other text stay as typed", () => {
  assert.equal(typesInCapitals(field("TEXTAREA", { type: "textarea", placeholder: "Optional notes about this enrollment" })), false);
  assert.equal(typesInCapitals(field("INPUT", { id: "clock-out-reason", placeholder: "e.g. Forgot to clock out; left at 5:00 PM per supervisor" }), "Reason *"), false);
  assert.equal(typesInCapitals(field("INPUT", { name: "idReason" }), "Reason for an ID change"), false, "a reason, though it names the ID");
  assert.equal(typesInCapitals(field("INPUT", { id: "clearing-notes", placeholder: "e.g. 12 receipts, 1 bank slip" }), "Notes"), false);
  assert.equal(typesInCapitals(field("INPUT"), "Reference or notes (optional)"), false);
  assert.equal(typesInCapitals(field("INPUT", { id: "pay-remarks" }), "Remarks"), false);
  assert.equal(typesInCapitals(field("TEXTAREA", { type: "textarea", placeholder: "What was checked (receipts, slips, cash) and anything that does not match." })), false);
  assert.equal(typesInCapitals(field("INPUT"), "Purpose *"), false);
  assert.equal(typesInCapitals(field("INPUT"), "Role name"), false, "roles are saved as named (Entry Clerk)");
  assert.equal(typesInCapitals(field("INPUT", { id: "holiday-name" }), "Holiday name"), false);
  assert.equal(typesInCapitals(field("INPUT", { id: "coordinates-B1", placeholder: "e.g. 7.447500, 125.807800" }), "Latitude, longitude"), false);
  assert.equal(typesInCapitals(field("INPUT", {}, { "data-keep-case": "" }), "Surname"), false);
});

test("the word or is not an OR number", () => {
  assert.equal(typesInCapitals(field("INPUT", { placeholder: "Optional, or leave blank" })), false);
  assert.equal(typesInCapitals(field("INPUT"), "OR or application number"), true);
});

test("what is not plain text is left alone", () => {
  for (const type of ["number", "date", "month", "time", "tel", "email", "password", "search", "checkbox", "file"]) assert.equal(typesInCapitals(field("INPUT", { type })), false, type);
  assert.equal(typesInCapitals(field("SELECT", { type: "select-one" })), false);
});

test("a password stays as typed even when Show password makes it a text field", () => {
  for (const id of ["current-password", "new-password", "confirm-password"]) assert.equal(typesInCapitals(field("INPUT", { id, type: "text" })), false, id);
  assert.equal(typesInCapitals(field("INPUT", { autocomplete: "new-password" })), false);
  assert.equal(typesInCapitals(field("INPUT", { autocomplete: "one-time-code" })), false);
});

test("an email stays as typed whatever the field is called; search boxes only look things up", () => {
  assert.equal(typesInCapitals(field("INPUT", { name: "email" })), false);
  assert.equal(typesInCapitals(field("INPUT", { id: "branch-email" })), false);
  assert.equal(typesInCapitals(field("INPUT", { placeholder: "Search name, ID, branch" })), false);
  assert.equal(typesInCapitals(field("INPUT", { placeholder: "All employees - search ID or name" })), false);
  assert.equal(typesInCapitals(field("INPUT", { placeholder: "Find a page" })), false);
  assert.equal(typesInCapitals(field("INPUT", {}, { role: "combobox" })), false);
  assert.equal(typesInCapitals(field("INPUT", {}, { "data-keep-case": "" })), false);
});
