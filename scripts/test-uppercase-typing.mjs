import assert from "node:assert/strict";
import { test } from "node:test";
import { typesInCapitals } from "../lib/uppercase-typing.ts";

const field = (tagName, props = {}, attributes = {}) => ({ tagName, type: "text", id: "", name: "", autocomplete: "", placeholder: "", ...props, getAttribute: (name) => attributes[name] ?? null, hasAttribute: (name) => name in attributes });

test("text a person types becomes capitals: names, addresses, notes, reasons", () => {
  assert.equal(typesInCapitals(field("INPUT", { placeholder: "Surname" })), true);
  assert.equal(typesInCapitals(field("INPUT", { placeholder: "Application number" })), true);
  assert.equal(typesInCapitals(field("TEXTAREA", { type: "textarea", placeholder: "Optional notes about this enrollment" })), true);
  assert.equal(typesInCapitals(field("INPUT", { id: "branch-name" })), true);
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
