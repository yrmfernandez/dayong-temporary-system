// A New Sale for an existing member must be that member (owner, November 19, 2026; lib/member-identity.ts).
// Invented names, in the patterns seen on production: corrections pass, another person typed over a member does not.
import assert from "node:assert/strict";
import { test } from "node:test";
import { anotherPersonProblem, isSamePerson } from "../lib/member-identity.ts";

const same = (recorded, typed) => isSamePerson({ surname: recorded[0], firstName: recorded[1] }, { surname: typed[0], firstName: typed[1] });

test("corrections of the same person pass", () => {
  assert.ok(same(["SANTOS", "ROBERTO"], ["SANTOS", "ROBERTO"]));
  assert.ok(same(["SANTOS", "ROBERTO"], ["santos ", " Roberto"]), "case and spaces");
  assert.ok(same(["SANTOS", "ALIBERTO"], ["SANTOS", "ALBERTO"]), "a typo in the first name");
  assert.ok(same(["SANTOS", "RICARDU"], ["SANTOS", "RICARDO"]));
  assert.ok(same(["SANTUS", "ROBERTO"], ["SANTOS", "ROBERTO"]), "a typo in the surname");
  assert.ok(same(["DELA CRUZ", "ROSA BELLO"], ["DELA CRUZ", "ROSA"]), "the import joined the middle name to the first name");
  assert.ok(same(["DELA CRUZ", "ROSA"], ["DELA CRUZ", "ROSA LINDA"]), "a second first name added");
  assert.ok(same(["DELA CRUZ", "BELLO ROSA"], ["DELA CRUZ", "ROSA"]), "a word joined in front of the first name");
  assert.ok(same(["ROSA", "DELACRUZ"], ["DELACRUZ", "ROSA"]), "surname and first name the wrong way round");
  assert.ok(same(["REYES", "MARIO SANTOS"], ["SANTOS", "MARIO REYES"]), "the same words split differently");
  assert.ok(same(["NUÑEZ", "MA. LUISA"], ["NUNEZ", "MARIA LUISA"]), "Ma. is Maria, ñ is n");
  assert.ok(same(["", ""], ["SANTOS", "ROBERTO"]), "nothing on record to compare");
});

test("another person typed over a member is refused", () => {
  assert.ok(!same(["SANTOS", "ALBERTO DUMAGAT"], ["SANTOS", "JOCELYN"]), "same surname, another first name (the Padilla case)");
  assert.ok(!same(["MORALES", "RENALDO DIAZ"], ["MORAL", "LEONORA"]), "another first name and surname");
  assert.ok(!same(["VILLAMOR", "VILMA"], ["VILLA", "CRISTOBAL"]));
  assert.ok(!same(["SANTOS", "MARIBEL"], ["SANTOS", "MARI JOY"]), "a different first name that starts alike");
  assert.ok(!same(["SANTOS", "JUAN"], ["REYES", "JUAN"]), "another surname");
  const message = anotherPersonProblem("PH-00000001", { surname: "SANTOS", firstName: "ALBERTO DUMAGAT" }, { surname: "SANTOS", firstName: "JOCELYN" });
  assert.match(message, /^SANTOS, JOCELYN is not member PH-00000001 \(SANTOS, ALBERTO DUMAGAT\)\. .*Not this member.*Members first/);
  assert.equal(anotherPersonProblem("PH-00000001", { surname: "SANTOS", firstName: "ALIBERTO" }, { surname: "SANTOS", firstName: "ALBERTO" }), "");
});
